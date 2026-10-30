export type LoopMode = "dynamic" | "interval";

export interface TickFlags {
  interval: boolean;
  dynamic: boolean;
}

export function emptyTickFlags(): TickFlags {
  return { interval: false, dynamic: false };
}

/**
 * Decide whether a firing tick may be injected.
 * At most one tick per job may be waiting for pi to process it:
 * a tick fires into `inject` only when its job has no pending prompt.
 * `busy` is the observed session state at fire time (used for logging by
 * the caller); the decision depends only on `pending`, so an idle session
 * and a busy session with nothing pending both inject and mark pending.
 * The flag is cleared when pi starts handling that tick.
 */
export function decideTick(input: { busy: boolean; pending: boolean }): { inject: boolean; pending: boolean } {
  void input.busy;
  if (input.pending) return { inject: false, pending: true };
  return { inject: true, pending: true };
}

/** Clear one job's flag when pi starts handling its tick. */
export function consumeTick(flags: TickFlags, mode: LoopMode): TickFlags {
  return { ...flags, [mode]: false };
}

/**
 * Extract the comparable text of a user message.
 * `message_start` carries `message.content` either as a string or as an
 * array of text/image blocks; tick matching joins text blocks with "\n",
 * mirroring how `sendUserMessage` normalizes array content. Returns
 * undefined for non-user messages or unrecognized shapes.
 */
export function userMessageText(message: { role: string; content: unknown }): string | undefined {
  if (message?.role !== "user") return undefined;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part !== null && typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string") {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.join("\n");
  }
  return undefined;
}

/**
 * Max age of a pending flag before it is treated as stuck.
 * Default is 3x the job's interval with a 60 s floor; a finite positive
 * override (from ROSTER_PENDING_MAX_MS) wins as-is.
 */
export function pendingMaxMs(intervalMs: number, overrideMs?: number): number {
  if (overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0) return Math.floor(overrideMs);
  const base = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
  return Math.max(60000, 3 * base);
}

/** Parse the ROSTER_PENDING_MAX_MS override; falls back to the default. */
export function pendingMaxMsFromEnv(intervalMs: number, envValue: string | undefined): number {
  if (envValue !== undefined) {
    const n = Number(envValue);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return pendingMaxMs(intervalMs);
}

/** True when a pending flag set at `injectedAtMs` is older than `maxMs`. */
export function isPendingExpired(injectedAtMs: number | undefined, nowMs: number, maxMs: number): boolean {
  if (injectedAtMs === undefined) return false;
  if (!Number.isFinite(injectedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(maxMs)) return false;
  return nowMs - injectedAtMs >= maxMs;
}

/**
 * Idle safety valve: a pending flag may clear once the session is idle
 * (agent_end) with nothing left queued. Queued work must keep the flag.
 */
export function shouldClearOnIdle(pending: boolean, hasPendingMessages: boolean): boolean {
  return pending && !hasPendingMessages;
}

/** Clear all flags: used by `/loop stop` and when a fresh loop starts. */
export function clearTickFlags(): TickFlags {
  return emptyTickFlags();
}

export function replaceTimer<T>(current: T | undefined, clear: (timer: T) => void, next: () => T): T {
  if (current !== undefined) clear(current);
  return next();
}

export function tickMessage(mode: "dynamic" | "interval", prompt: string): string {
  return mode === "interval" ? prompt : `Perform one iteration of this dynamic loop, then call Schedule with the same input verbatim and a context-appropriate delay, or stop if complete: /loop ${prompt}`;
}

export function parseInterval(input: string): { milliseconds: number; prompt: string } | null {
  const m = input.match(/^(\d+)(s|m|h)\s+(.+)$/s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const factor = m[2] === "s" ? 1000 : m[2] === "m" ? 60000 : 3600000;
  const prompt = (m[3] ?? "").trim();
  if (!prompt) return null;
  return { milliseconds: n * factor, prompt };
}
export function clampDelay(seconds: number): number {
  if (!Number.isFinite(seconds)) throw new Error("delaySeconds must be finite");
  return Math.max(1, Math.min(3600, Math.floor(seconds)));
}

export function maxLoopsFromEnv(envValue: string | undefined): number {
  if (envValue !== undefined) {
    const n = Number(envValue);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return 10;
}

export function nextLoopId(seq: number): string {
  return `loop-${seq}`;
}

export function shortenTask(task: string, maxLen = 60): string {
  if (task.length <= maxLen) return task;
  return `${task.slice(0, maxLen - 1)}…`;
}

export interface LoopSummary {
  id: string;
  kind: LoopMode;
  task: string;
  intervalMs?: number;
  dueMs: number;
  noopStreak: number;
  pending: boolean;
}

export function findIntervalDuplicate(
  loops: readonly LoopSummary[],
  intervalMs: number,
  task: string,
): LoopSummary | undefined {
  return loops.find((loop) => loop.kind === "interval" && loop.intervalMs === intervalMs && loop.task === task);
}

export function findDynamicByTask(
  loops: readonly LoopSummary[],
  task: string,
): LoopSummary | undefined {
  return loops.find((loop) => loop.kind === "dynamic" && loop.task === task);
}

export function findLoopById(
  loops: readonly LoopSummary[],
  id: string,
): LoopSummary | undefined {
  return loops.find((loop) => loop.id === id);
}

export function isCapReached(loopCount: number, maxLoops: number): boolean {
  return loopCount >= maxLoops;
}

export function earliestDueMs(loops: readonly Pick<LoopSummary, "dueMs">[]): number | undefined {
  let earliest: number | undefined;
  for (const loop of loops) {
    if (earliest === undefined || loop.dueMs < earliest) earliest = loop.dueMs;
  }
  return earliest;
}

export function statusText(loopCount: number, earliestDue: number | undefined): string {
  if (loopCount === 0) return "No loops scheduled.";
  const plural = loopCount === 1 ? "loop" : "loops";
  if (earliestDue === undefined) return `${loopCount} ${plural} scheduled.`;
  return `${loopCount} ${plural} · next ${new Date(earliestDue).toISOString()}`;
}

export function formatLoopList(loops: readonly LoopSummary[]): string {
  if (loops.length === 0) return "No loops scheduled.";
  return loops.map((loop) => {
    const when = loop.kind === "interval"
      ? `every=${loop.intervalMs ?? 0}ms next=${new Date(loop.dueMs).toISOString()}`
      : `next=${new Date(loop.dueMs).toISOString()}`;
    const pending = loop.pending ? "pending=yes" : "pending=no";
    return `${loop.id} ${loop.kind} ${when} task="${shortenTask(loop.task)}" noop=${loop.noopStreak} ${pending}`;
  }).join("\n");
}

export type ParsedLoopCommand =
  | { action: "list" }
  | { action: "stopAll" }
  | { action: "stopOne"; id: string }
  | { action: "create"; text: string };

export function parseLoopCommand(input: string): ParsedLoopCommand {
  const text = input.trim();
  if (text === "" || text === "list") return { action: "list" };
  if (text === "stop") return { action: "stopAll" };
  if (text.startsWith("stop ")) {
    const id = text.slice("stop ".length).trim();
    if (!id) return { action: "stopAll" };
    return { action: "stopOne", id };
  }
  return { action: "create", text };
}

export function resolveDynamicTarget(
  loops: readonly LoopSummary[],
  prompt?: string,
): LoopSummary | undefined {
  if (prompt !== undefined && prompt.trim() !== "") {
    return findDynamicByTask(loops, prompt.trim());
  }
  for (let i = loops.length - 1; i >= 0; i--) {
    const loop = loops[i];
    if (loop?.kind === "dynamic") return loop;
  }
  return undefined;
}
