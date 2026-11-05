// CLI side: start the daemon on demand, wait for a connected file, and relay requests.

import { mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { ENTRY, EXIT_FAILED, EXIT_OK, EXIT_UNAVAILABLE, EXIT_USAGE, HOME, LOG_FILE, PORT_END, PORT_START } from "./config";
import { defaultTimeout } from "./methods";
import { type DaemonState, fail, out, parseDuration, pidAlive, readState, str, type ParsedArgs } from "./util";

export const NOT_CONNECTED_HELP = [
  "Open the file in Figma Desktop and run the plugin there: Plugins > Development > Figma Desktop Bridge.",
  "If that menu item is missing, the plugin is not imported yet: run `figma-access setup` and follow its steps.",
  "The plugin finds the daemon within a few seconds; it keeps running only while its window is open (it may be minimized).",
];

export type Reply = Record<string, any> & { ok: boolean };

export async function daemonReachable(state: DaemonState | null): Promise<boolean> {
  if (!state || !pidAlive(state.pid)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json()) as { server?: string };
    return body.server === "figma-access";
  } catch {
    return false;
  }
}

export async function startDaemon(): Promise<{ state: DaemonState; started: boolean }> {
  mkdirSync(HOME, { recursive: true });
  const existing = readState();
  if (existing && (await daemonReachable(existing))) return { state: existing, started: false };
  const fd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [ENTRY, "__daemon"], { detached: true, stdio: ["ignore", fd, fd], env: process.env });
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await Bun.sleep(150);
    const s = readState();
    if (s && s.pid === child.pid && (await daemonReachable(s))) return { state: s, started: true };
    if (child.exitCode !== null) break;
  }
  fail(EXIT_UNAVAILABLE, `The daemon did not start. Read ${LOG_FILE} for the reason (most often all ports ${PORT_START}-${PORT_END} are taken).`);
}

export async function callDaemon(state: DaemonState, body: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/cli`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-figma-access-token": state.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await res.json()) as Reply;
  } catch (e) {
    fail(EXIT_UNAVAILABLE, `Lost contact with the daemon: ${(e as Error).message}. Run \`figma-access daemon restart\`.`);
  }
}

/** Start the daemon if needed and, unless needFile is false, wait until a file is connected. */
export async function connect(flags: ParsedArgs["flags"], needFile = true): Promise<DaemonState> {
  const { state, started } = await startDaemon();
  if (!needFile) return state;
  let waitMs = started ? 20000 : 12000;
  if (flags.wait !== undefined) {
    const w = parseDuration(str(flags.wait));
    if (w == null) fail(EXIT_USAGE, "--wait takes a duration such as 15s.");
    waitMs = w;
  }
  const status = await callDaemon(state, { op: "wait", waitMs }, waitMs + 5000);
  if (!status.files?.length) {
    fail(EXIT_UNAVAILABLE, `No Figma file connected to the daemon after ${Math.round(waitMs / 1000)} s.`, { help: NOT_CONNECTED_HELP, daemonPort: state.port });
  }
  return state;
}

/** Print the reply and exit with the matching code. */
export function finish(reply: Reply, transform?: (r: Reply) => unknown): never {
  if (!reply.ok) {
    const unavailable = ["no-files", "no-match", "ambiguous"].includes(reply.code);
    if (reply.code === "no-files") reply.help = NOT_CONNECTED_HELP;
    out(reply);
    process.exit(unavailable ? EXIT_UNAVAILABLE : EXIT_FAILED);
  }
  out(transform ? transform(reply) : reply);
  process.exit(EXIT_OK);
}

export async function rpc(flags: ParsedArgs["flags"], method: string, params: unknown, timeoutMs?: number): Promise<Reply> {
  const state = await connect(flags);
  const effective = timeoutMs ?? defaultTimeout(method);
  return callDaemon(state, { op: "rpc", file: str(flags.file), method, params, timeoutMs: effective }, effective + 10000);
}
