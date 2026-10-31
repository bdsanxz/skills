// herdr-core backend: open one Herdr app tab per member with `herdr-app do
// tab.new`, notify them with `hcx send` (untagged; `hc send` when hcx is
// missing or fails). Used when the old herdr server is stopped but `hc`
// lists a live core. Terminals opened by herdr-app have no parent, so
// members never stick to the runner's tab; never start them with `hc run`
// from inside an agent.

import {
  LaunchError,
  type JsonObject,
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
import { type Screen, pollScreen, waitConfig } from "./wait";

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

/** Whether the hcx helper exists (it sends without the `<hc from>` tag). */
export function haveHcx(): boolean {
  return which("hcx") !== null;
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

/** Whether a failed first-prompt send was refused because a dialog is up: hc exit 9
 * (blocked, typing would answer the dialog). Only these failures are retried. */
function isBlockedSend(error: unknown): boolean {
  return error instanceof LaunchError && /(exit 9|blocked)/i.test(error.message);
}

/** Runs hc commands, or only prints them with --dry-run. */
export class Hc {
  constructor(readonly dryRun: boolean) {}

  call(args: string[], note?: string, timeoutMs: number = TIMEOUT_MS): [number, string] {
    const cmd = ["hc", ...args];
    if (this.dryRun) {
      print("RUN " + shlexJoin(cmd) + (note ? `   # ${note}` : ""));
      return [0, ""];
    }
    const done = run(cmd, { timeoutMs });
    if (done.timedOut) throw new LaunchError(`\`${shlexJoin(cmd)}\` did not answer within ${Math.round(timeoutMs / 1000)} s`);
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

  /** Wait until the terminal is ready: a short status wait first (agents that report
   * one behave as before), then a bounded screen poll for runtimes `hc wait`
   * reports no turn status for. The poll stops when the terminal is gone, a
   * known dialog or the agent's idle input line appears, the screen settles, or
   * the overall cap is reached; a vanished terminal throws, anything else
   * carries on to the first prompt. Tabs that may show a trust dialog get one extra
   * settle window (twice ROSTER_SETTLE_MS, no new knob) so a late dialog is seen
   * before the first prompt. Dry runs print the short wait and return. */
  settle(name: string, want?: { dialogs?: Dialog[]; ready?: string | null }) {
    const cfg = waitConfig();
    const timeout = String(Math.max(1, Math.ceil(cfg.shortMs / 1000)));
    if (this.dryRun) {
      this.call(["wait", name, "--timeout", timeout]);
      return;
    }
    const deadline = Date.now() + cfg.waitMs;
    if (cfg.shortMs > 0) {
      const [code, output] = this.call(["wait", name, "--timeout", timeout], undefined, cfg.shortMs + 30000);
      if (code === 0) return;
      if (/no such terminal|not found|unknown/i.test(output)) {
        throw new LaunchError(`terminal ${name} is gone while waiting for it: ${tail(strip(output), 400)}`);
      }
      // No turn status (idle agents, runtimes hc misclassifies): poll the screen instead.
    }
    const effective =
      want?.dialogs?.length ? { ...cfg, settleMs: cfg.settleMs * 2 } : cfg;
    if (pollScreen(() => this.peekScreen(name), want?.dialogs ?? [], want?.ready, effective, deadline) === "gone") {
      throw new LaunchError(`terminal ${name} is gone while waiting for it`);
    }
  }

  /** Read the screen, reporting a vanished terminal as gone instead of throwing. A
   * read that fails any other way reads as empty: the poll keeps waiting, and
   * the cap bounds it. */
  private peekScreen(name: string): Screen {
    const [code, output] = this.call(["read", name]);
    if (code !== 0) {
      if (/no such terminal|not found|unknown/i.test(output)) return { gone: true, text: "" };
      return { gone: false, text: "" };
    }
    return { gone: false, text: output };
  }

  readScreen(name: string): string {
    if (this.dryRun) return "";
    const [code, output] = this.call(["read", name]);
    if (code !== 0) throw new LaunchError(`\`hc read ${name}\` failed: ${tail(strip(output), 400)}`);
    return output;
  }

  /** Send the first prompt untagged via `hcx send`, falling back to `hc send`. */
  sendPrompt(name: string, promptText: string) {
    if (!haveHcx()) {
      this.run(["send", name, promptText]);
      return;
    }
    const hcxCmd = ["hcx", "send", name, promptText];
    if (this.dryRun) {
      print("RUN " + shlexJoin(hcxCmd));
      return;
    }
    const done = run(hcxCmd, { timeoutMs: TIMEOUT_MS });
    if (!done.timedOut && done.code === 0) return;
    const detail = done.timedOut
      ? "`hcx send` did not answer within 120 s"
      : `\`hcx send ${name}\` failed (exit ${done.code}): ${tail(strip(done.stdout + done.stderr), 400)}`;
    print(`WARN ${detail}; falling back to \`hc send\``);
    this.run(["send", name, promptText]);
  }

  sendKeys(name: string, keys: string[], note?: string) {
    this.run(["keys", name, ...keys], note);
  }

  /** Run `opencode api <operation>` against OpenCode's background service; return its JSON. */
  opencodeApi(cwd: string, operation: string, params: Record<string, string> = {}, data?: JsonObject): Record<string, unknown> {
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

  /** Send the first prompt, answering the agent's known dialogs from its screen. The
   * prompt is sent only once no dialog is on screen; when the send itself is refused
   * because a dialog came up after the read (hc exit 9 / blocked), the screen is
   * re-read, a known dialog is answered, and the send is retried within the same
   * attempt bound. A blocked screen with no known dialog still fails with hc's message. */
  firstPrompt(name: string, dialogs: Dialog[], ready?: string | null) {
    if (this.dryRun) {
      for (const [marker, keys] of dialogs) {
        this.sendKeys(name, keys, `only when the screen shows ${repr(marker)}`);
      }
    }
    for (let attempt = 0; attempt < dialogs.length + 2; attempt++) {
      this.settle(name, { dialogs, ready });
      const screen = this.readScreen(name).toLowerCase();
      const answer = dialogs.find(([marker]) => screen.includes(marker))?.[1];
      if (!answer) {
        try {
          this.sendPrompt(name, FIRST_PROMPT);
          return;
        } catch (error) {
          if (!isBlockedSend(error)) throw error;
          const retry = this.readScreen(name).toLowerCase();
          const retryAnswer = dialogs.find(([marker]) => retry.includes(marker))?.[1];
          if (!retryAnswer) throw error;
          this.sendKeys(name, retryAnswer);
          continue;
        }
      }
      this.sendKeys(name, answer);
    }
    throw new LaunchError(`${name} still waits for input after its known dialogs were answered`);
  }
}
