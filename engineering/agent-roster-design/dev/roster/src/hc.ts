// herdr-core backend: open one Herdr app tab per member with `herdr-app do
// tab.new`, notify them with `hc send`. Used when the old herdr server is
// stopped but `hc` lists a live core. Terminals opened by herdr-app have no
// parent, so members never stick to the runner's tab; never start them with
// `hc run` from inside an agent.

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

/** Whether the Herdr app CLI exists. */
export function haveApp(): boolean {
  return which("herdr-app") !== null;
}

/** Herdr app spaces by name, or null when the app cannot be listed. */
export function appSpaces(): Map<string, string> | null {
  if (!haveApp()) return null;
  const done = run(["herdr-app", "ls"], { timeoutMs: TIMEOUT_MS });
  if (done.timedOut || done.code !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(done.stdout);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.spaces)) return null;
  const out = new Map<string, string>();
  for (const s of parsed.spaces) {
    if (isObject(s) && typeof s.id === "string" && typeof s.name === "string") out.set(s.name, s.id);
  }
  return out;
}

/** The Herdr app space name for a squad. */
export function hcSpaceName(squad: string): string {
  return `squad-${squad}`;
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

  /** Run a `herdr-app do` command and return its stdout. */
  app(argv: string[], note?: string): string {
    const cmd = ["herdr-app", "do", ...argv];
    if (this.dryRun) {
      print("RUN " + shlexJoin(cmd) + (note ? `   # ${note}` : ""));
      return "";
    }
    const done = run(cmd, { timeoutMs: TIMEOUT_MS });
    if (done.timedOut) throw new LaunchError(`\`${shlexJoin(cmd)}\` did not answer within 120 s`);
    if (done.code !== 0) {
      throw new LaunchError(`\`${shlexJoin(cmd)}\` failed (exit ${done.code}): ${tail(strip(done.stdout + done.stderr), 800)}`);
    }
    return done.stdout;
  }

  /** Parse a `herdr-app do` call that returns {space, tab, terminal}. */
  appTerminal(argv: string[], note: string, dryTerminal: string): string {
    if (this.dryRun) {
      this.app(argv, note);
      return dryTerminal;
    }
    const output = this.app(argv);
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new LaunchError(`\`herdr-app do ${shlexJoin(argv)}\` printed no JSON: ${tail(strip(output), 400)}`);
    }
    if (!isObject(parsed) || typeof parsed.terminal !== "string" || parsed.terminal === "") {
      throw new LaunchError(`\`herdr-app do ${shlexJoin(argv)}\` reported no terminal: ${tail(strip(output), 400)}`);
    }
    return parsed.terminal;
  }

  /** Parse a `herdr-app do` call that returns {space, tab, terminal}. */
  appSpace(argv: string[], note: string, dry: { space: string; terminal: string }): { space: string; terminal: string } {
    if (this.dryRun) {
      this.app(argv, note);
      return dry;
    }
    const output = this.app(argv);
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new LaunchError(`\`herdr-app do ${shlexJoin(argv)}\` printed no JSON: ${tail(strip(output), 400)}`);
    }
    if (!isObject(parsed) || typeof parsed.terminal !== "string" || parsed.terminal === "") {
      throw new LaunchError(`\`herdr-app do ${shlexJoin(argv)}\` reported no terminal: ${tail(strip(output), 400)}`);
    }
    const space = typeof parsed.space === "string" && parsed.space !== "" ? parsed.space : "";
    if (space === "") {
      throw new LaunchError(`\`herdr-app do ${shlexJoin(argv)}\` reported no space: ${tail(strip(output), 400)}`);
    }
    return { space, terminal: parsed.terminal };
  }

  /** Open the squad's space with its first tab running argv; return the space id and terminal. */
  spaceNew(space: string, folder: string, tab: string, argv: string[]): { space: string; terminal: string } {
    return this.appSpace(
      ["space.new", "--name", space, "--folder", folder, "--tab", tab, "--argv", dumps(argv)],
      `space ${space}`,
      { space: `<${space}>`, terminal: `<${tab}>` },
    );
  }

  /** Open one more tab in the squad's space running argv; return the terminal. */
  tabNew(space: string, tab: string, folder: string, argv: string[]): string {
    return this.appTerminal(
      ["tab.new", "--space", space, "--name", tab, "--folder", folder, "--argv", dumps(argv)],
      `tab ${tab}`,
      `<${tab}>`,
    );
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
