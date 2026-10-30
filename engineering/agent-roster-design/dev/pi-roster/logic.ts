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

/** One session-scoped completion condition tracked by /goal. */
export interface GoalState {
  condition: string;
  setAtMs: number;
  checks: number;
  tokens: number;
  lastReason?: string;
  evalFailures: number;
}

export type ParsedGoalCommand =
  | { action: "status" }
  | { action: "clear" }
  | { action: "set"; condition: string };

/** Parse the raw args of /goal: empty shows status, "clear" clears, else sets. */
export function parseGoalCommand(input: string): ParsedGoalCommand {
  const text = input.trim();
  if (text === "") return { action: "status" };
  if (text === "clear") return { action: "clear" };
  return { action: "set", condition: text };
}

/** Max consecutive unmet checks before the goal stops itself. Default 30. */
export function goalMaxChecksFromEnv(envValue: string | undefined): number {
  if (envValue !== undefined) {
    const n = Number(envValue);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return 30;
}

/** Evaluator timeout in ms. Default 60000. */
export function goalEvalTimeoutFromEnv(envValue: string | undefined): number {
  if (envValue !== undefined) {
    const n = Number(envValue);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 60000;
}

/** Max transcript chars sent to the evaluator. Default 12000. */
export function goalTranscriptMaxFromEnv(envValue: string | undefined): number {
  if (envValue !== undefined) {
    const n = Number(envValue);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 12000;
}

/** True once the goal has used up its unmet-check budget. */
export function isGoalCapReached(checks: number, maxChecks: number): boolean {
  return checks >= maxChecks;
}

/** Consecutive evaluator failures tolerated before giving up. */
export const GOAL_MAX_EVAL_FAILURES = 3;

/** True once evaluator failures hit the give-up threshold. */
export function isGoalEvalGiveUp(failures: number): boolean {
  return failures >= GOAL_MAX_EVAL_FAILURES;
}

/**
 * Skip the evaluation when the agent still has background work pending that
 * will re-invoke it (a running Monitor means no check at this stop).
 */
export function shouldSkipGoalCheck(hasPendingMessages: boolean): boolean {
  return hasPendingMessages;
}

/**
 * A stale evaluation must never inject a turn: only apply the verdict when
 * the goal is still the one that was evaluated (generation matches) and the
 * condition text is unchanged.
 */
export function shouldApplyEvalResult(input: {
  goalActive: boolean;
  evalGeneration: number;
  currentGeneration: number;
  evalCondition: string;
  currentCondition: string | undefined;
}): boolean {
  if (!input.goalActive) return false;
  if (input.evalGeneration !== input.currentGeneration) return false;
  return input.evalCondition === input.currentCondition;
}

/** Meta user turn injected once when a goal is set (hidden from the user). */
export function buildGoalAck(condition: string): string {
  return `A session-scoped Stop hook is now active with condition: "${condition}". Briefly acknowledge the goal, then immediately start (or continue) working toward it — treat the condition itself as your directive and do not pause to ask the user what to do. The hook will block stopping until the condition holds. It auto-clears once the condition is met — do not tell the user to run \`/goal clear\` after success; that's only for clearing a goal early. Do not use the Schedule tool for this goal; when you stop, the harness checks the condition and continues you if it is not met.`;
}

/**
 * True when a Schedule call arrives while a goal is active with a prompt that
 * is not a user /loop task (goal-driven pacing): the call still runs (loops
 * must keep working), but the goal logs it so the pacing is visible.
 */
export function shouldLogGoalScheduleCall(input: {
  goalActive: boolean;
  prompt: string | undefined;
  loops: readonly LoopSummary[];
}): boolean {
  if (!input.goalActive) return false;
  if (input.prompt === undefined) return false;
  return findDynamicByTask(input.loops, input.prompt) === undefined;
}

/** Follow-up user turn injected after each unmet check. */
export function buildGoalFeedback(condition: string, reason: string): string {
  return `Stop hook feedback:\n[${condition}]: ${reason}`;
}

/** System prompt for the separate evaluator call. */
export function goalEvaluatorSystemPrompt(): string {
  return [
    "You are a Stop hook evaluator. Decide whether the session has met its completion condition.",
    "Reply with strict JSON only: {\"met\": boolean, \"reason\": string}.",
    "The reason must cite evidence from the transcript.",
  ].join("\n");
}

/** User message for the evaluator: condition plus the compact transcript. */
export function buildEvaluatorPrompt(condition: string, transcript: string): string {
  return [
    `Completion condition: ${condition}`,
    "",
    "<transcript>",
    transcript,
    "</transcript>",
    "",
    'Reply with strict JSON only: {"met": boolean, "reason": string}.',
  ].join("\n");
}

/** Keep the newest tail of the transcript so the evaluator input stays capped. */
export function capTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

interface GoalTranscriptEntry {
  type: string;
  message?: { role?: unknown; content?: unknown };
}

/**
 * Render session branch entries as compact "Role: text" lines for the
 * evaluator. Mirrors the repo's tick text extraction: text blocks joined,
 * tool calls summarized, other roles skipped.
 */
export function transcriptToText(entries: readonly GoalTranscriptEntry[]): string {
  const sections: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const role = entry.message.role;
    const content = entry.message.content;
    const parts: string[] = [];
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part !== null && typeof part === "object") {
          const block = part as { type?: unknown; text?: unknown; name?: unknown; arguments?: unknown };
          if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
          else if (block.type === "toolCall" && typeof block.name === "string") {
            parts.push(`Tool ${block.name} was called with args ${JSON.stringify(block.arguments ?? {})}`);
          }
        }
      }
    } else {
      continue;
    }
    const text = parts.join("\n").trim();
    if (!text) continue;
    if (role === "user") sections.push(`User: ${text}`);
    else if (role === "assistant") sections.push(`Assistant: ${text}`);
  }
  return sections.join("\n\n");
}

export interface EvaluatorVerdict {
  met: boolean;
  reason: string;
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return (fenced[1] ?? "").trim();
  return trimmed;
}

/**
 * Parse the evaluator reply defensively: plain JSON, fenced JSON, or JSON
 * embedded in surrounding prose. Returns null when no valid verdict exists.
 * Never throws.
 */
export function parseEvaluatorVerdict(raw: string): EvaluatorVerdict | null {
  const candidates: string[] = [];
  const stripped = stripCodeFences(raw);
  candidates.push(stripped);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) candidates.push(stripped.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.met !== "boolean") continue;
        const reason = typeof record.reason === "string" ? record.reason : "";
        return { met: record.met, reason };
      }
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** Whole-goal elapsed time in ms (goal set -> now). Clamped at 0. */
export function goalElapsedMs(setAtMs: number, nowMs: number): number {
  if (!Number.isFinite(setAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, nowMs - setAtMs);
}

/** Short elapsed text for goal status lines, e.g. "24s", "2m 5s". */
export function formatGoalElapsed(setAtMs: number, nowMs: number): string {
  const seconds = Math.floor(goalElapsedMs(setAtMs, nowMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** Short token count for goal status lines, e.g. 1800 -> "1.8k". */
export function formatGoalTokens(tokens: number): string {
  if (tokens >= 1000) {
    const rounded = Math.round(tokens / 100) / 10;
    return `${rounded}k`;
  }
  return `${tokens}`;
}

/** Panel text for /goal with no argument. */
export function formatGoalStatus(goal: GoalState | undefined, nowMs: number): string {
  if (!goal) return "No goal set\n/goal <condition> to set one.";
  const lines = [
    "Goal active",
    `running ${formatGoalElapsed(goal.setAtMs, nowMs)} · ${goal.checks} turns · ${formatGoalTokens(goal.tokens)} tokens`,
    `Goal: ${goal.condition}`,
    `Last check: ${goal.lastReason ?? "not yet evaluated"}`,
    "/goal clear to stop early.",
  ];
  return lines.join("\n");
}

/** Create fresh goal state for /goal <condition>, replacing any existing goal. */
export function applyGoalSet(condition: string, nowMs: number): GoalState {
  return { condition, setAtMs: nowMs, checks: 0, tokens: 0, evalFailures: 0 };
}

/** Success line shown when the evaluator confirms the condition. */
export function formatGoalAchieved(goal: GoalState, nowMs: number): string {
  return `✔ Goal achieved (${formatGoalElapsed(goal.setAtMs, nowMs)} · ${goal.checks} turns · ${formatGoalTokens(goal.tokens)} tokens)`;
}
