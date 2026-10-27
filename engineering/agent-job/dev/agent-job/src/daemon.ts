// The daemon: fires due crons into live sessions, and ends the crons of sessions that are gone.

import { trace } from "./trace.ts";
import fs from "node:fs";
import path from "node:path";
import { onGoalEvent } from "./goals.ts";
import { ADAPTERS, pidAlive, type Adapter, type Liveness } from "./providers.ts";
import { runAfter } from "./schedule.ts";
import { address, Store, type Cron } from "./store.ts";

export const SWEEP_MS = 60_000;
export const GOAL_POLL_MS = 3_000;
export const MISSED_MS = 90_000;
export const OUTBOX_TTL_MS = 30 * 60_000;

export interface Deps {
  adapters: Record<string, Adapter>;
  now: () => number;
  /** How long a session must stay gone before its crons end; absorbs a restart of a watch. */
  graceMs: number;
}

export interface State {
  deadSince: Map<string, number>;
  lastSweep: number;
  lastGoalPoll: number;
  /** Per goal: the newest message of its session that was already looked at. */
  cursors: Map<string, string | null>;
  /** Goals whose session compacted since their last turn end: that turn end restates the goal. */
  compacted: Set<string>;
}

export function defaultDeps(): Deps {
  return { adapters: ADAPTERS, now: Date.now, graceMs: Number(process.env.AGENT_JOB_GRACE_MS ?? 30_000) };
}

export function newState(): State {
  return { deadSince: new Map(), lastSweep: 0, lastGoalPoll: 0, cursors: new Map(), compacted: new Set() };
}

/**
 * The text a session receives: the cron's prompt exactly as written, as CronCreate delivers it,
 * with no header. A watch delivers one line per cron, so it folds newlines.
 */
export function formatMessage(r: Cron, oneLine: boolean): string {
  const body = r.prompt.trim();
  return oneLine ? body.replace(/\s*\n\s*/g, " ⏎ ") : body;
}

function end(store: Store, r: Cron, reason: string, status: "ended" | "done", now: number): void {
  store.update(r.id, { status, next_run: null, end_reason: reason });
  // A finished cron keeps the line it just queued; only a gone session loses its waiting lines.
  if (status === "ended") store.db.query("DELETE FROM outbox WHERE cron_id = ? AND delivered_at IS NULL").run(r.id);
  store.event(r.id, status, reason, now);
  trace("daemon", `cron-${status}`, { cron: r.id, addr: address(r.provider, r.session_id), why: reason });
}

/** Goals of runtimes without a hook: watch the session's record and send what its turn ends owe. */
export function goalTick(store: Store, deps: Deps, state: State): void {
  const now = deps.now();
  if (now - state.lastGoalPoll < GOAL_POLL_MS) return;
  state.lastGoalPoll = now;
  for (const g of store.goals()) {
    const adapter = deps.adapters[g.provider];
    if ((g.status !== "active" && g.status !== "paused") || !adapter?.poll) continue;
    const seen = state.cursors.get(g.id) ?? null;
    const polled = adapter.poll(g.session_id, seen, g.created_at);
    if (!polled) continue;
    state.cursors.set(g.id, polled.cursor);
    if (polled.turnEnds > 0 || polled.compacted) trace("opencode-poll", "records", { goal: g.id, status: g.status, cursor: polled.cursor, turnEnds: polled.turnEnds, compacted: polled.compacted });
    // A paused goal still reads the record, so the turns that end meanwhile are not owed when it resumes.
    if (g.status === "paused") {
      state.compacted.delete(g.id);
      continue;
    }
    // The compaction and the turn end that follows it can be read in different polls.
    if (polled.compacted) state.compacted.add(g.id);
    if (polled.turnEnds === 0) continue;
    const afterCompaction = state.compacted.delete(g.id);
    const text = onGoalEvent(store, address(g.provider, g.session_id), "turn-end", now, { afterCompaction });
    if (!text) continue;
    const d = adapter.deliver(store, g.session_id, g.id, text);
    if (!d.ok) store.updateGoal(g.id, { note: `continuation not sent: ${d.detail}` }, now);
  }
}

export function tick(store: Store, deps: Deps, state: State): void {
  goalTick(store, deps, state);
  const now = deps.now();
  const sweep = now - state.lastSweep >= SWEEP_MS;
  if (sweep) {
    state.lastSweep = now;
    for (const row of store.expireOutbox(now - OUTBOX_TTL_MS)) store.event(row.cron_id, "dropped", `no watch collected the line within 30 minutes (${row.address})`, now);
  }
  const seen = new Map<string, Liveness>();
  const check = (r: { provider: string; session_id: string }): Liveness => {
    const key = address(r.provider, r.session_id);
    let got = seen.get(key);
    if (!got) {
      const adapter = deps.adapters[r.provider];
      got = adapter ? adapter.liveness(store, r.session_id) : { state: "unknown", detail: `no adapter for provider ${r.provider}` };
      seen.set(key, got);
      if (got.state === "live") state.deadSince.delete(key);
      else if (got.state === "dead" && !state.deadSince.has(key)) state.deadSince.set(key, now);
    }
    return got;
  };

  if (sweep) {
    // A goal is event-driven and needs no firing, but it must not outlive its session.
    for (const g of store.goals()) {
      if (g.status !== "active" && g.status !== "paused") continue; // a paused goal is gone with its session too
      const live = check(g);
      const since = state.deadSince.get(address(g.provider, g.session_id));
      if (live.state === "dead" && since !== undefined && now - since >= deps.graceMs) {
        store.updateGoal(g.id, { status: "ended", note: `session ended: ${live.detail}` }, now);
        trace("daemon", "goal-ended", { goal: g.id, addr: address(g.provider, g.session_id), why: live.detail });
      }
    }
  }

  for (const r of store.active()) {
    if (r.expires_at !== null && now >= r.expires_at) {
      end(store, r, "expired", "done", now);
      continue;
    }
    const isDue = r.next_run !== null && r.next_run <= now;
    if (!isDue && !sweep) continue;
    const key = address(r.provider, r.session_id);
    const live = check(r);
    if (live.state === "dead") {
      const since = state.deadSince.get(key) ?? now;
      if (now - since >= deps.graceMs) end(store, r, `session ended: ${live.detail}`, "ended", now);
      continue; // inside the grace period a due cron waits instead of being sent into a gone session
    }
    if (!isDue) continue;
    fire(store, deps, r, live, now);
  }
}

function fire(store: Store, deps: Deps, r: Cron, live: Liveness, now: number): void {
  const due = r.next_run!;
  const late = now - due;
  const schedule = { kind: r.kind, expr: r.expr };
  let result: string;
  let delivered = false;
  if (live.state === "unknown") {
    result = `not sent: cannot tell whether the session is open (${live.detail})`;
    store.event(r.id, "failed", result, now);
  } else if (r.kind !== "at" && late > MISSED_MS) {
    result = `skipped: due ${Math.round(late / 1000)}s ago while the daemon was not running`;
    store.event(r.id, "missed", result, now);
  } else {
    const adapter = deps.adapters[r.provider]!;
    const text = formatMessage(r, adapter.mode === "watch");
    const d = adapter.deliver(store, r.session_id, r.id, text);
    trace("daemon", "cron-fire", { cron: r.id, addr: address(r.provider, r.session_id), ok: d.ok, detail: d.detail });
    result = d.ok ? `sent: ${d.detail}` : `failed: ${d.detail}`;
    delivered = d.ok;
    store.event(r.id, d.ok ? "sent" : "failed", d.detail, now);
  }
  const runs = r.runs + (delivered ? 1 : 0);
  const next = runAfter(schedule, due, now);
  const finished = next === null || (r.max_runs !== null && runs >= r.max_runs);
  store.update(r.id, { runs, last_run: now, last_result: result, next_run: finished ? null : next });
  if (finished) end(store, { ...r, runs }, next === null ? "schedule finished" : `reached ${r.max_runs} runs`, "done", now);
}

// ---------------------------------------------------------------- process management

export function pidFile(store: Store): string {
  return path.join(store.dir, "daemon.pid");
}

export function logFile(store: Store): string {
  return path.join(store.dir, "daemon.log");
}

export function daemonPid(store: Store): number | null {
  try {
    const pid = Number(fs.readFileSync(pidFile(store), "utf8").trim());
    return pid > 0 && pidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Runs in the foreground until stopped. */
export function runDaemon(store: Store): void {
  const existing = daemonPid(store);
  if (existing && existing !== process.pid) throw new Error(`the daemon already runs (pid ${existing})`);
  fs.writeFileSync(pidFile(store), String(process.pid));
  const deps = defaultDeps();
  const state = newState();
  const stop = () => {
    try {
      if (daemonPid(store) === process.pid) fs.unlinkSync(pidFile(store));
    } catch {}
    process.exit(0);
  };
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(s, stop);
  console.log(`${new Date().toISOString()} daemon started pid=${process.pid}`);
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    try {
      tick(store, deps, state);
    } catch (e) {
      console.error(`${new Date().toISOString()} tick failed: ${e instanceof Error ? e.stack : e}`);
    }
    busy = false;
  }, 1000);
}

/** Starts the daemon detached when it is not running. Returns its pid. */
export function ensureDaemon(store: Store): { pid: number; started: boolean } {
  const pid = daemonPid(store);
  if (pid) return { pid, started: false };
  const script = process.argv[1];
  if (!script) throw new Error("cannot find this script's path to start the daemon");
  const log = fs.openSync(logFile(store), "a");
  const child = Bun.spawn([process.execPath, script, "daemon", "run"], {
    stdin: "ignore",
    stdout: log,
    stderr: log,
    env: { ...process.env, AGENT_JOB_HOME: store.dir },
  });
  child.unref();
  return { pid: child.pid, started: true };
}

export function stopDaemon(store: Store): number | null {
  const pid = daemonPid(store);
  if (pid) process.kill(pid, "SIGTERM");
  return pid;
}

/** Sends a cron now, outside its schedule, to a session that is open. Returns a line for the user. */
export function deliverNow(store: Store, deps: Deps, r: Cron): { ok: boolean; detail: string } {
  const adapter = deps.adapters[r.provider];
  if (!adapter) return { ok: false, detail: `no adapter for provider ${r.provider}` };
  const live = adapter.liveness(store, r.session_id);
  if (live.state !== "live") return { ok: false, detail: `the session is not open (${live.state}: ${live.detail}); nothing was sent` };
  const d = adapter.deliver(store, r.session_id, r.id, formatMessage(r, adapter.mode === "watch"));
  store.event(r.id, d.ok ? "sent" : "failed", `run-now: ${d.detail}`, deps.now());
  return d;
}
