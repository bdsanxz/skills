// Session-scoped goal (/goal) pure logic: prompt building, verdict parsing,
// transcript compaction, and caps. Everything here is side-effect-free; the
// MCP sidecar (logic.ts, server.ts) wires it to the OpenCode HTTP API.
export const GOAL_MAX_CHECKS_DEFAULT = 30
export const GOAL_EVAL_TIMEOUT_MS_DEFAULT = 60_000
export const GOAL_TRANSCRIPT_CHARS_DEFAULT = 12_000
export const GOAL_MAX_EVAL_FAILURES_DEFAULT = 3
export const GOAL_HELPER_TITLE_PREFIX = "roster-goal-eval"

function envInt(name: string, fallback: number, min: number): number {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || Math.floor(raw) < min) return fallback
  return Math.floor(raw)
}

/** Cap on consecutive unmet goal checks before the goal stops itself. */
export function goalMaxChecks(): number {
  return envInt("ROSTER_GOAL_MAX_CHECKS", GOAL_MAX_CHECKS_DEFAULT, 1)
}

/** Milliseconds before one goal evaluation counts as failed. */
export function goalEvalTimeoutMs(): number {
  return envInt("ROSTER_GOAL_EVAL_TIMEOUT_MS", GOAL_EVAL_TIMEOUT_MS_DEFAULT, 1000)
}

/** Max transcript characters sent to the evaluator per check. */
export function goalTranscriptChars(): number {
  return envInt("ROSTER_GOAL_TRANSCRIPT_CHARS", GOAL_TRANSCRIPT_CHARS_DEFAULT, 500)
}

/** Consecutive evaluator failures before the goal gives up. */
export function goalMaxEvalFailures(): number {
  return envInt("ROSTER_GOAL_MAX_EVAL_FAILURES", GOAL_MAX_EVAL_FAILURES_DEFAULT, 1)
}

/** The one meta turn injected when a goal is set (verbatim from the spec). */
export function buildGoalAckPrompt(condition: string): string {
  return `A session-scoped Stop hook is now active with condition: "${condition}". Briefly acknowledge the goal, then immediately start (or continue) working toward it — treat the condition itself as your directive and do not pause to ask the user what to do. The hook will block stopping until the condition holds. It auto-clears once the condition is met — do not tell the user to run \`/goal clear\` after success; that's only for clearing a goal early.`
}

/** The turn injected after each unmet check so the agent continues. */
export function buildGoalContinuePrompt(condition: string, reason: string): string {
  return `Stop hook feedback:\n[${condition}]: ${reason}`
}

/** The final turn injected when the check cap stops the goal. */
export function buildGoalCapPrompt(condition: string, checks: number): string {
  return `Goal stopped after ${checks} checks without meeting the condition: "${condition}".`
}

/** The final turn injected when repeated evaluator failures stop the goal. */
export function buildGoalEvalFailedPrompt(condition: string): string {
  return `Goal evaluation failed repeatedly; stopping goal: "${condition}".`
}

/** The prompt sent to the helper-session evaluator (never to the user). */
export function buildEvaluatorPrompt(condition: string, transcript: string): string {
  return `You are a session Stop-hook evaluator. Decide whether the session's goal condition already holds, using ONLY the transcript below as evidence. Never write to the user's session. Reply with strict JSON only, no other text: {"met":boolean,"reason":string}. "reason" must cite concrete transcript evidence in one short sentence.\n\nGoal condition: "${condition}"\n\nSession transcript (most recent last, truncated):\n${transcript}`
}

/** Parse the evaluator's strict `{"met":bool,"reason":string}` reply. */
export function parseGoalVerdict(raw: string): { met: boolean; reason: string } {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("evaluator returned empty output")
  let text = raw.trim()
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(text)
  if (fence?.[1] !== undefined) text = fence[1].trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start < 0 || end <= start) throw new Error("evaluator returned non-JSON output")
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      throw new Error("evaluator returned non-JSON output")
    }
  }
  const met = (parsed as Record<string, unknown>)?.met
  const reason = (parsed as Record<string, unknown>)?.reason
  if (typeof met !== "boolean" || typeof reason !== "string" || !reason.trim()) {
    throw new Error('evaluator verdict must be {"met":boolean,"reason":string}')
  }
  return { met, reason: reason.trim() }
}

function partText(part: unknown): string | undefined {
  if (typeof part === "string") return part
  if (part !== null && typeof part === "object") {
    const text = (part as Record<string, unknown>).text
    if (typeof text === "string" && text.length > 0) return text
  }
  return undefined
}

/**
 * One `{role, text}` line for a message. Live `/api` shapes (probed
 * 2026-10-30, OpenCode v2.0.29) are flat: user messages carry
 * `{type:"user", text}` (prompt replies echo as
 * `{type:"user", payload:{text}}`), assistant messages carry
 * `{type:"assistant", content:[{type:"text", text}, …]}`. The older
 * `{info:{role}, parts:[…]}` form and plain `{role, text|content|body}`
 * objects are still understood.
 */
export function describeMessage(message: unknown): { role: string; text: string } {
  if (typeof message === "string") return { role: "unknown", text: message }
  const record = (message ?? {}) as Record<string, unknown>
  const info = (record.info ?? {}) as Record<string, unknown>
  const role =
    (typeof info.role === "string" && info.role) ||
    (typeof record.role === "string" && record.role) ||
    (typeof record.type === "string" && record.type) ||
    "unknown"
  const chunks: unknown[] = []
  if (Array.isArray(record.parts)) chunks.push(...record.parts)
  // Assistant content entries (`{type:"text", text}`, reasoning parts with
  // text) use the same `{text}` shape `partText` already reads; tool entries
  // carry no text and are skipped.
  if (Array.isArray(record.content)) chunks.push(...record.content)
  const texts = chunks.map(partText).filter((entry): entry is string => entry !== undefined)
  if (texts.length > 0) return { role, text: texts.join("\n") }
  for (const key of ["content", "text", "body"]) {
    if (typeof record[key] === "string" && (record[key] as string).length > 0) {
      return { role, text: record[key] as string }
    }
  }
  const payload = record.payload as Record<string, unknown> | undefined
  if (payload !== null && typeof payload === "object" && typeof payload.text === "string" && payload.text.length > 0) {
    return { role, text: payload.text }
  }
  return { role, text: "" }
}

/**
 * Flatten messages to `role: text` lines, keeping the most recent `maxChars`
 * characters. The transcript sent to the evaluator is never logged.
 */
export function compactTranscript(messages: unknown[], maxChars: number): string {
  const lines = (messages ?? [])
    .map(describeMessage)
    .filter((entry) => entry.text.trim().length > 0)
    .map((entry) => `${entry.role}: ${entry.text.replace(/\s+/g, " ").trim()}`)
  const full = lines.join("\n")
  if (full.length <= maxChars) return full
  return `…(truncated)\n${full.slice(full.length - maxChars)}`
}

/**
 * Best-effort text of a `session.prompt` HTTP result (`{data: ...}`
 * unwrapped). Live `/api` returns the submitted user message immediately
 * (`{data:{type:"user", payload:{text}}}`), NOT the assistant reply, so a
 * user-typed result is never verdict text: it yields `undefined` and the
 * caller polls `session.message.list` for the assistant message instead.
 */
export function extractTextFromPromptResult(body: unknown): string | undefined {
  const root = ((body ?? {}) as Record<string, unknown>).data ?? body
  if (typeof root === "string") return root.length > 0 ? root : undefined
  if (root !== null && typeof root === "object") {
    const record = root as Record<string, unknown>
    const info = (record.info ?? {}) as Record<string, unknown>
    const kind =
      (typeof info.role === "string" && info.role) ||
      (typeof record.role === "string" && record.role) ||
      (typeof record.type === "string" && record.type)
    if (kind === "user") return undefined
    if (typeof record.text === "string" && record.text.length > 0) return record.text
    const chunks: unknown[] = []
    if (Array.isArray(record.parts)) chunks.push(...record.parts)
    if (Array.isArray(record.content)) chunks.push(...record.content)
    if (chunks.length > 0) {
      const texts = chunks.map(partText).filter((entry): entry is string => entry !== undefined)
      if (texts.length > 0) return texts.join("\n")
    }
  }
  return undefined
}

/** Newest assistant text in a `session.message.list` result, if any (live flat `{type:"assistant", content:[…]}` or `{info, parts}` forms; user echoes never match). */
export function extractTextFromMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const described = describeMessage(messages[index])
    if (described.role === "assistant" && described.text.trim().length > 0) return described.text
  }
  return undefined
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${seconds % 60 ? `${seconds % 60}s` : ""}`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60 ? `${minutes % 60}m` : ""}`
}

export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0"
  if (tokens < 1000) return `${Math.floor(tokens)}`
  return `${(tokens / 1000).toFixed(1)}k`
}

export type GoalState = {
  condition: string
  setAt: number
  checks: number
  evalFailures: number
  evalInFlight: boolean
  generation: number
  lastReason?: string
}

/** The `/goal` (bare) / `Goal(status)` panel text for one session. */
export function formatGoalStatus(goal: GoalState | undefined, now: number): string {
  if (!goal) return "No goal set\n/goal <condition> to set one"
  const turns = goal.checks + 1
  const lines = [
    "Goal active",
    `running ${formatElapsed(now - goal.setAt)} · ${turns} turn${turns === 1 ? "" : "s"}`,
    `Goal: ${goal.condition}`,
    `Last check: ${goal.lastReason ?? "pending"}`,
    "/goal clear to stop early",
  ]
  return lines.join("\n")
}
