// A trace of the real events agent-job sees and what it decided about each, one JSON line per event
// in `trace.log` of the data directory. It is off unless `AGENT_JOB_TRACE=1` or `agent-job trace on`
// (a marker file, so a hook that inherits no environment still writes). Tracing never fails the caller.

import fs from "node:fs";
import path from "node:path";
import { homeDir } from "./store.ts";

export function traceFile(dir = homeDir()): string {
  return path.join(dir, "trace.log");
}

export function traceMarker(dir = homeDir()): string {
  return path.join(dir, "trace.on");
}

export function traceOn(dir = homeDir()): boolean {
  return process.env.AGENT_JOB_TRACE === "1" || fs.existsSync(traceMarker(dir));
}

/** `source` is where the event came from (claude-hook, agy-hook, pi, opencode-poll, daemon, channel, goal). */
export function trace(source: string, event: string, data: Record<string, unknown> = {}): void {
  try {
    const dir = homeDir();
    if (!traceOn(dir)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(traceFile(dir), JSON.stringify({ ...data, ts: new Date().toISOString(), pid: process.pid, source, event }) + "\n");
  } catch {}
}
