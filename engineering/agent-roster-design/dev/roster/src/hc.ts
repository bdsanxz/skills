// herdr-core backend: start members with `hc run --bg` in their cwd, notify
// them with `hc send`. Used when the old herdr server is stopped but `hc`
// lists a live core. Tabs are not arranged here; the launch output names the
// `herdr-app` commands that show the terminals.

import {
  LaunchError,
  dumps,
  isObject,
  print,
  repr,
  run,
  shlexJoin,
  strip,
  tail,
  which,
} from "./core";
import { FIRST_PROMPT, type Dialog } from "./herdr";

const TIMEOUT_MS = 120000;

/** The hc terminal name for a member: squad-member, lowercased for hc's charset. */
export function hcName(squad: string, member: string): string {
  const raw = `${squad}-${member}`.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  const name = raw === "" ? "member" : raw;
  const prefixed = /^[a-z]/.test(name) ? name : `s-${name}`;
  return prefixed.slice(0, 32);
}

/** Whether the hc command exists. */
export function haveHc(): boolean {
  return which("hc") !== null;
}

export type HcTerminal = { address: string; name: string; cwd: string };

/** Live hc terminals, or null when the core cannot be listed. */
export function hcTerminals(): HcTerminal[] | null {
  if (!haveHc()) return null;
  const done = run(["hc", "ls", "--json"], { timeoutMs: TIMEOUT_MS });
  if (done.timedOut || done.code !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(done.stdout);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.terminals)) return null;
  const out: HcTerminal[] = [];
  for (const t of parsed.terminals) {
    if (!isObject(t)) continue;
    const address = typeof t.address === "string" ? t.address : "";
    if (address === "") continue;
    if (t.state !== undefined && t.state !== "live") continue;
    const name = typeof t.name === "string" && t.name !== "" ? t.name : address;
    out.push({ address, name, cwd: typeof t.cwd === "string" ? t.cwd : "" });
  }
  return out;
}

/** Runs hc commands, or only prints them with --dry-run. */
export class Hc {
  constructor(readonly dryRun: boolean) {}

  call(args: string[], note?: string): [number, string] {
    const cmd = ["hc", ...args];
    if (this.dryRun) {
      print("RUN " + shlexJoin(cmd) + (note ? `   # ${note}` : ""));
      return [0, ""];
    }
    const done = run(cmd, { timeoutMs: TIMEOUT_MS });
    if (done.timedOut) throw new LaunchError(`\`${shlexJoin(cmd)}\` did not answer within 120 s`);
    return [done.code, done.stdout + done.stderr];
  }

  run(args: string[], note?: string): string {
    const [code, output] = this.call(args, note);
    if (code !== 0) {
      throw new LaunchError(`\`hc ${shlexJoin(args)}\` failed (exit ${code}): ${tail(strip(output), 800)}`);
    }
    return output;
  }

  /** Start a terminal with `hc run --bg --json`; return its address. */
  startTerminal(cwd: string, name: string, argv: string[]): string {
    if (this.dryRun) {
      this.run(["run", "--bg", "--cwd", cwd, "--name", name, ...argv]);
      return `<${name}>`;
    }
    const output = this.run(["run", "--bg", "--json", "--cwd", cwd, "--name", name, ...argv]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new LaunchError(`\`hc run --bg --name ${name}\` printed no JSON: ${tail(strip(output), 400)}`);
    }
    if (!isObject(parsed)) throw new LaunchError(`\`hc run --bg --name ${name}\` printed no JSON object`);
    const address = typeof parsed.address === "string" ? parsed.address : "";
    if (address === "") throw new LaunchError(`\`hc run --bg --name ${name}\` reported no terminal address`);
    return address;
  }

  /** Wait until the terminal stops working (idle) or exits; timeouts only check in. */
  settle(name: string) {
    const [code, output] = this.call(["wait", name, "--timeout", "90"]);
    if (code !== 0 && /no such terminal|not found|unknown/i.test(output)) {
      throw new LaunchError(`terminal ${name} is gone while waiting for it: ${tail(strip(output), 400)}`);
    }
  }

  readScreen(name: string): string {
    if (this.dryRun) return "";
    const [code, output] = this.call(["read", name]);
    if (code !== 0) throw new LaunchError(`\`hc read ${name}\` failed: ${tail(strip(output), 400)}`);
    return output;
  }

  sendPrompt(name: string, promptText: string) {
    this.run(["send", name, promptText]);
  }

  sendKeys(name: string, keys: string[], note?: string) {
    this.run(["keys", name, ...keys], note);
  }

  /** Run `opencode api <operation>` against OpenCode's background service; return its JSON. */
  opencodeApi(cwd: string, operation: string, params: Record<string, string> = {}, data: object = {}): Record<string, unknown> {
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(done.stdout) as unknown;
    } catch {
      throw new LaunchError(`\`${shlexJoin(cmd)}\` printed no JSON: ${tail(strip(done.stdout), 400)}`);
    }
    if (!isObject(parsed)) throw new LaunchError(`\`${shlexJoin(cmd)}\` printed ${repr(parsed)}, not a JSON object`);
    return parsed;
  }

  /** Send the first prompt, answering the agent's known dialogs from its screen. */
  firstPrompt(name: string, dialogs: Dialog[]) {
    if (this.dryRun) {
      for (const [marker, keys] of dialogs) {
        this.sendKeys(name, keys, `only when the screen shows ${repr(marker)}`);
      }
    }
    for (let attempt = 0; attempt < dialogs.length + 2; attempt++) {
      this.settle(name);
      const screen = this.readScreen(name).toLowerCase();
      const answer = dialogs.find(([marker]) => screen.includes(marker))?.[1];
      if (!answer) {
        this.sendPrompt(name, FIRST_PROMPT);
        return;
      }
      this.sendKeys(name, answer);
    }
    throw new LaunchError(`${name} still waits for input after its known dialogs were answered`);
  }
}
