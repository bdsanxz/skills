// herdr and OpenCode's API: the commands launch runs, or only prints with --dry-run.

import {
  type Json,
  type JsonObject,
  LaunchError,
  dumps,
  isObject,
  print,
  repr,
  run,
  shlexJoin,
  sleep,
  strip,
  tail,
  truthy,
  which,
} from "./core";

export const FIRST_PROMPT = "Read your instructions, then wait for messages from your squad.";
export const WAIT_MS = "60000";
const TIMEOUT_MS = 120000;

/** One dialog an agent may show before its first prompt: a text on screen, and the keys that answer it. */
export type Dialog = [marker: string, keys: string[]];

/** The object at key, or an empty one. */
export function field(value: unknown, key: string): JsonObject {
  const found = isObject(value) ? value[key] : undefined;
  return isObject(found) ? found : {};
}

/** The list at key, keeping only its objects. */
export function list(value: unknown, key: string): JsonObject[] {
  const found = isObject(value) ? value[key] : undefined;
  return Array.isArray(found) ? found.filter(isObject) : [];
}

/** The string at key, or "". */
export function text(value: unknown, key: string) {
  const found = isObject(value) ? value[key] : undefined;
  return typeof found === "string" ? found : "";
}

/** Runs herdr commands in one session, or only prints them with --dry-run. */
export class Herdr {
  count = 0;

  constructor(
    readonly session: string,
    readonly dryRun: boolean,
  ) {}

  call(args: string[], note?: string): [number, string] {
    const cmd = ["herdr", "--session", this.session, ...args];
    if (this.dryRun) {
      print("RUN " + shlexJoin(cmd) + (note ? `   # ${note}` : ""));
      return [0, ""];
    }
    const done = run(cmd, { timeoutMs: TIMEOUT_MS });
    if (done.timedOut) throw new LaunchError(`\`${shlexJoin(cmd)}\` did not answer within 120 s`);
    return [done.code, done.stdout + done.stderr];
  }

  run(args: string[], note?: string) {
    const [code, output] = this.call(args, note);
    if (code !== 0) {
      throw new LaunchError(`\`herdr ${shlexJoin(args)}\` failed (exit ${code}): ${tail(strip(output), 800)}`);
    }
    return output;
  }

  text(args: string[]) {
    return this.dryRun ? "" : this.run(args);
  }

  /** Create a workspace, tab or pane; return the "result" of herdr's JSON reply. */
  created(args: string[]): JsonObject {
    const output = this.run(args);
    if (this.dryRun) {
      this.count++;
      const n = this.count;
      return {
        workspace: { workspace_id: "<workspace>" },
        tab: { tab_id: `<tab-${n}>` },
        root_pane: { pane_id: `<pane-${n}>` },
        pane: { pane_id: `<pane-${n}>` },
        move_result: { created_tab: { tab_id: `<tab-${n}>` } },
      };
    }
    let parsed: Json;
    try {
      parsed = JSON.parse(output) as Json;
    } catch {
      parsed = null;
    }
    if (!isObject(parsed) || !("result" in parsed)) {
      throw new LaunchError(`\`herdr ${shlexJoin(args)}\` printed no result: ${tail(strip(output), 400)}`);
    }
    return isObject(parsed.result) ? parsed.result : {};
  }

  /** Run a herdr command that only reads, also with --dry-run; return its "result", or {}. */
  query(args: string[]): JsonObject {
    const done = run(["herdr", "--session", this.session, ...args], { timeoutMs: TIMEOUT_MS });
    if (done.timedOut || done.code !== 0) return {};
    try {
      return field(JSON.parse(done.stdout), "result");
    } catch {
      return {};
    }
  }

  /** Return once herdr reports the agent idle or blocked on a dialog; never polls. */
  settle(name: string, pane: string) {
    const [code, output] = this.call(["agent", "wait", name, "--until", "idle", "--until", "blocked", "--timeout", "90000"]);
    if (code !== 0) throw new LaunchError(`${name} in pane ${pane} did not settle within 90 s: ${tail(strip(output), 400)}`);
  }

  /** Run `opencode api <operation>` against OpenCode's background service; return its JSON. */
  opencodeApi(cwd: string, operation: string, params: Record<string, string> = {}, data?: JsonObject): JsonObject {
    const cmd = ["opencode", "api", operation];
    for (const [key, value] of Object.entries(params)) cmd.push("--param", `${key}=${value}`);
    if (data !== undefined) cmd.push("-d", dumps(data));
    if (this.dryRun) {
      print("RUN " + shlexJoin(cmd));
      return { data: { id: "<session>", model: {} } };
    }
    const done = run(cmd, { cwd, timeoutMs: TIMEOUT_MS });
    if (done.timedOut) throw new LaunchError(`\`${shlexJoin(cmd)}\` did not answer within 120 s`);
    if (done.code !== 0) {
      throw new LaunchError(
        `\`${shlexJoin(cmd)}\` failed (exit ${done.code}): ${tail(strip(done.stderr + done.stdout), 600)}; ` +
          "is OpenCode's background service running (`opencode service status`)?",
      );
    }
    if (!strip(done.stdout)) return {};
    let parsed: Json;
    try {
      parsed = JSON.parse(done.stdout) as Json;
    } catch {
      throw new LaunchError(`\`${shlexJoin(cmd)}\` printed no JSON: ${tail(strip(done.stdout), 400)}`);
    }
    if (!isObject(parsed)) throw new LaunchError(`\`${shlexJoin(cmd)}\` printed ${repr(parsed)}, not a JSON object`);
    return parsed;
  }

  /** Send the first prompt, answering the agent's known dialogs while herdr says it is blocked. */
  firstPrompt(name: string, pane: string, dialogs: Dialog[]) {
    if (this.dryRun) {
      for (const [marker, keys] of dialogs) {
        this.run(["agent", "send-keys", name, ...keys], `only when the screen shows ${repr(marker)}`);
      }
    }
    for (let attempt = 0; attempt < dialogs.length + 2; attempt++) {
      this.settle(name, pane);
      const [code, output] = this.call(["agent", "prompt", name, FIRST_PROMPT]);
      if (code === 0) return;
      if (!output.includes("agent_blocked") && !output.includes("agent_not_ready")) {
        throw new LaunchError(`\`herdr agent prompt ${name}\` failed: ${tail(strip(output), 800)}`);
      }
      const screen = this.run(["agent", "read", name, "--source", "visible"]);
      const answer = dialogs.find(([marker]) => screen.toLowerCase().includes(marker))?.[1];
      if (!answer) {
        throw new LaunchError(
          `${name} in pane ${pane} waits for input this script does not know how to ` +
            `answer; its screen ends:\n${tail(strip(screen), 800)}`,
        );
      }
      this.run(["agent", "send-keys", name, ...answer]);
    }
    throw new LaunchError(`${name} in pane ${pane} still waits for input after its known dialogs were answered`);
  }

  startAgent(name: string, kind: string, pane: string, args: string[], allowNotReady = false) {
    const cmd = ["agent", "start", name, "--kind", kind, "--pane", pane, ...(args.length ? ["--", ...args] : [])];
    // A new pane's shell takes a moment to start; herdr says so with agent_pane_busy.
    // This bounded retry waits for a shell to come up, never for a member's work.
    for (let attempt = 0; attempt < 20; attempt++) {
      const [code, output] = this.call(cmd);
      if (code === 0) return "started";
      if (output.includes("agent_pane_busy")) {
        sleep(1000);
        continue;
      }
      if (allowNotReady && output.includes("agent_not_ready")) return "not_ready";
      throw new LaunchError(`\`herdr ${shlexJoin(cmd)}\` failed: ${tail(strip(output), 800)}`);
    }
    throw new LaunchError(`pane ${pane} stayed busy for 20 s; its shell did not start`);
  }
}

/** The running herdr session to launch in, or a problem: [session, null] or [null, why]. */
export function herdrSession(requested: string | null): [string | null, string | null] {
  if (!which("herdr")) return [null, "herdr is not on PATH; install it, or start the members by hand"];
  const done = run(["herdr", "session", "list", "--json"], { inheritStdin: true });
  let parsed: Json;
  try {
    parsed = JSON.parse(done.stdout) as Json;
  } catch {
    return [null, `\`herdr session list --json\` printed no JSON: ${tail(strip(done.stderr || done.stdout), 300)}`];
  }
  for (const session of list(parsed, "sessions")) {
    const name = text(session, "name");
    if (requested ? name === requested : truthy(session.default)) {
      if (truthy(session.running)) return [name, null];
      return [
        null,
        `herdr session ${repr(name)} is not running; ask the user to start it from their own ` +
          `terminal (\`herdr --session ${name}\`, or \`herdr\` for the default session)`,
      ];
    }
  }
  return [
    null,
    requested
      ? `no herdr session named ${repr(requested)}; \`herdr session list\` shows the sessions`
      : "no default herdr session; ask the user to start herdr from their own terminal",
  ];
}
