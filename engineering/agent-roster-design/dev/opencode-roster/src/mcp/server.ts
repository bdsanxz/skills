import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { createGoalEvaluator, createPromptInjector } from "./api"
import { createJsonlLogger, createRosterHandlers } from "./logic"
import { consumeSse as consumeSseShared, exitWhenStdinCloses, handleFrameFor as handleFrameShared, normalizeEvent as normalizeEventShared, nextSseDelay, SSE_BACKOFF_START_MS } from "./events"
import { resolveService } from "./service"

const log = createJsonlLogger()
// The server URL and password are discovered, never guessed: explicit
// environment first, then `opencode service status` / `service get password`,
// then the service state and config files. A stale literal in opencode.json
// would rot when the service restarts on another port, so opencode.json sets
// only ROSTER_LOG and the sidecar finds the service itself.
const service = resolveService({
  env: process.env as Record<string, string | undefined>,
  home: homedir(),
  run: (cmd) => {
    try {
      const done = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" })
      return { code: done.status ?? 1, stdout: typeof done.stdout === "string" ? done.stdout : "" }
    } catch {
      return { code: 1, stdout: "" }
    }
  },
  read: (path) => {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  },
})
const baseURL = service.baseURL
const password = service.password
const authorization = password ? `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` : undefined

const injector = createPromptInjector({ baseURL, password, onError: async (error, sessionID) => log("error", sessionID, { source: "session.prompt", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }) })

let handlers: ReturnType<typeof createRosterHandlers>
const evaluator = createGoalEvaluator({ baseURL, password, onHelper: (id, active) => { handlers?.setHelper(id, active) } })
handlers = createRosterHandlers(injector, log, () => Date.now(), { maxBusyMs: Number(process.env.ROSTER_BUSY_MAX_MS || process.env.ROSTER_MAX_BUSY_MS || 120000), probeIdle, evaluate: evaluator })
const mcp = new McpServer(
  { name: "roster", version: "0.1.0" },
  { instructions: `Loop protocol: for /loop [interval] <task>, perform one useful iteration immediately. A session may run up to 10 loops at once (ROSTER_MAX_JOBS, default 10); each loop has an id (interval loops keep their cron ids) and a kind (interval or dynamic). An interval loop (/loop 5s <task>) means exactly ONE roster_ScheduleCreate call with that interval and prompt equal to the TASK ONLY, without the leading "/loop" and without the interval; e.g. /loop 5s run sleep 12 seconds -> ScheduleCreate {interval:"5s", prompt:"run sleep 12 seconds"}. Never pass the whole /loop input as a ScheduleCreate prompt: injected ticks must never look like a new /loop command, or jobs multiply. Never call Schedule, ScheduleList, or ScheduleDelete alongside an interval loop, and never delete the loop's own job. Two interval loops with different tasks or intervals run side by side; the same interval and task returns the existing id ("already scheduled (already running as <id>)"). A loop without an interval is dynamic: call roster_Schedule once with prompt exactly equal to the original /loop input verbatim, delaySeconds clamped to 1-3600 (idle default 1200-1800; do not poll work the harness notifies about), a short reason, and noop true only when nothing changed. Dynamic wakeups are keyed by prompt text: the SAME prompt replaces that loop's wakeup only, a different prompt is a different loop. Use <<autonomous-loop-dynamic>> for an autonomous loop without a user prompt. /loop list (also bare /loop) lists every loop via roster_ScheduleList (id, kind, interval or next fire, task shortened, noop streak, pending). /loop stop ends ALL loops through roster_Schedule with stop:true, which cancels every job the session owns; roster_Schedule with stop:true and prompt set to a loop's exact prompt stops that dynamic loop only. /loop stop <id> ends one loop via roster_ScheduleDelete. ScheduleCreate is idempotent per session, interval and prompt and each session is capped at ROSTER_MAX_JOBS loops (default 10). Calls must be made within an OpenCode session so the server supplies _meta["ai.opencode/sessionID"]. Goal protocol: for /goal <condition>, call roster_Goal once with that condition (the condition text only); for /goal with no argument call roster_Goal with no params to show the panel; for /goal clear call roster_Goal with clear:true. Do not use Schedule tools for goals.`, capabilities: { tools: {} } },
)

function sessionID(extra: any): string | undefined {
  const value = extra?._meta?.["ai.opencode/sessionID"]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function register(name: string, description: string, schema: any) {
  ;(mcp.registerTool as any)(name, { description, inputSchema: schema }, async (args: any, extra: any) => {
    const id = sessionID(extra)
    await log("mcp_call", id, { tool: name, params: args, metadata_keys: Object.keys(extra?._meta ?? {}) })
    try { return await handlers.call(name, args, id) as any }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] } }
  })
}

register("Schedule", "Schedule the next dynamic /loop iteration in this session (loops without an interval). Dynamic wakeups are keyed by prompt text: the SAME prompt replaces that loop's wakeup only, a different prompt is a new loop. prompt is the exact original /loop input verbatim. delaySeconds is clamped to 1-3600. stop:true without prompt stops ALL loops (cancels every job this session owns); stop:true with prompt set to a loop's exact prompt stops that dynamic loop only. Do not use for interval loops; those use ScheduleCreate with the task text only.", {
  delaySeconds: z.number().optional(), prompt: z.string().optional(), reason: z.string().optional(), noop: z.boolean().optional(), stop: z.boolean().optional(),
})
register("ScheduleCreate", "Create one recurring prompt job for an interval loop (/loop <interval> <task>): call exactly once with that interval and prompt equal to the TASK ONLY, without the leading /loop and without the interval; e.g. /loop 5s run sleep 12 seconds -> {interval:\"5s\", prompt:\"run sleep 12 seconds\"}. Never also call Schedule, ScheduleList, or ScheduleDelete. interval examples: 5s, 5m, 2h (limited to 1s-1h). Different tasks or intervals run side by side; a duplicate session/interval/prompt returns the existing id (already scheduled, already running as <id>); each session is capped at ROSTER_MAX_JOBS loops (default 10).", { interval: z.string(), prompt: z.string() })
register("ScheduleList", "List every loop of this session for /loop list (also bare /loop): each entry has id, kind (interval or dynamic), interval or next fire time, task (shortened), noop streak, and pending state; the list length is the loop count and the earliest due is the next fire. A routine loop must not call this.", {})
register("ScheduleDelete", "Delete one loop by id for /loop stop <id> (for a stale or unwanted job). Never delete the loop's own running job; /loop stop without an id ends every loop via Schedule stop:true.", { id: z.string() })
register("Goal", "Set, clear, or show the session goal for /goal. Goal({condition}) sets (replaces) the ONE session-scoped completion condition and starts evaluator checks at every turn end; Goal({clear:true}) removes it early; Goal({}) or Goal({status:true}) shows No goal set or the active panel. One goal per session; it coexists with /loop jobs and auto-clears when met.", {
  condition: z.string().optional(), clear: z.boolean().optional(), status: z.boolean().optional(),
})

async function probeIdle(sessionID: string): Promise<boolean> {
  const response = await fetch(`${baseURL}/api/session/active`, { headers: authorization ? { authorization } : {} })
  if (!response.ok) throw new Error(`session.active failed (${response.status})`)
  const body: any = await response.json()
  return !(body?.data && Object.hasOwn(body.data, sessionID))
}

const seenTypes = new Set<string>()
export const normalizeEvent = normalizeEventShared

export async function consumeSse(response: Response, handlersArg = handlers): Promise<number> {
  return consumeSseShared(response, (frame) => handleFrameFor(frame, handlersArg))
}
export async function handleFrameFor(frame: any, handlersArg: any) {
  await handleFrameShared(frame, handlersArg, log, seenTypes)
}

let watching = false
async function watch() {
  // One SSE consumer per process: a second loop would handle every frame twice
  // and log each event_type_seen twice.
  if (watching) return
  watching = true
  let delay = SSE_BACKOFF_START_MS
  while (true) {
    let frames = 0
    try {
      const response = await fetch(`${baseURL}/api/event`, { headers: { accept: "text/event-stream", ...(authorization ? { authorization } : {}) } })
      if (!response.ok) throw new Error(`event.subscribe failed (${response.status})`)
      await handlers.onReconnect("sse_connected")
      frames = await consumeSse(response)
      await handlers.onReconnect("sse_ended")
    } catch (error) {
      await log("error", undefined, { source: "event.subscribe", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
      await handlers.onReconnect("sse_error")
    }
    await log("sse_reconnect", undefined, { delay_ms: delay })
    await new Promise((resolve) => setTimeout(resolve, delay))
    // Double the wait after a failure (up to 30 s); reset only after frames.
    delay = nextSseDelay(delay, frames > 0)
  }
}

exitWhenStdinCloses()
await log("service_discovered", undefined, { url_source: service.urlSource, password_source: service.passwordSource ?? "unresolved", has_password: password !== undefined })
for (const warning of service.warnings) await log("service_unresolved", undefined, { message: warning })
await log("mcp_starting", undefined, { server: "roster", baseURL, url_source: service.urlSource, protocol: "legacy stdio", basic_auth: Boolean(authorization), pid: process.pid })
setInterval(() => { void handlers.safetyValve() }, Math.max(250, Math.min(1000, Number(process.env.ROSTER_SAFETY_CHECK_MS || 1000))))
void watch()
await mcp.connect(new StdioServerTransport())
