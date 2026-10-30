import { afterEach, describe, expect, test, jest } from "bun:test"
import { clampDelay, createRosterHandlers, parseInterval } from "../src/mcp/logic"
import { handleFrameFor, normalizeEvent } from "../src/mcp/events"

const session = "sess-test"
// Real v2 frame samples copied from logs/roster.jsonl (extra fields tolerated).
const liveSession = "ses_e74799740ffeKSYzPKTuC17U7p"
const executionStarted = { id: "evt_18b8668f400139kgrLccXp0evq", created: 1793342204148, type: "session.execution.started", data: { sessionID: liveSession }, durable: { aggregateID: liveSession, seq: 2, version: 1 } }
const stepStarted = { id: "evt_18b867ab4001V3GnW31aWrIMTx", created: 1793342208692, type: "session.step.started", location: { directory: "/Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/opencode-roster" }, data: { sessionID: liveSession, agent: "build", assistantMessageID: "msg_18b866908001g3A2DxKKXEpJy7" }, durable: { aggregateID: liveSession, seq: 7, version: 1 } }
const stepEndedToolCalls = { id: "evt_18b867c80001nYyh1cjVU0U3aN", created: 1793342209152, type: "session.step.ended", data: { sessionID: liveSession, assistantMessageID: "msg_18b866908001g3A2DxKKXEpJy7", finish: "tool-calls" }, durable: { aggregateID: liveSession, seq: 15, version: 1 } }
const executionSucceeded = { id: "evt_18b86852d001KewBInRS2Ta267", created: 1793342211373, type: "session.execution.succeeded", data: { sessionID: liveSession }, durable: { aggregateID: liveSession, seq: 21, version: 1 } }
const executionFailed = { id: "evt_failed", created: 1793342211374, type: "session.execution.failed", data: { sessionID: liveSession } }
const inboxEnqueued = { id: "evt_18b8668f2001O9N5MBPiIMfwa", created: 1793342204146, type: "session.inbox.enqueued", data: { inboxID: "msg_18b8668c1001uX4Dsk34HZdVfx", sessionID: liveSession } }
// Lead can run the timing-sensitive tests with short ticks, e.g. ROSTER_TEST_INTERVAL=5s.
const TEST_INTERVAL = process.env.ROSTER_TEST_INTERVAL || "1m"
const TEST_INTERVAL_MS = (parseInterval(TEST_INTERVAL) ?? 60) * 1000
const sessions: string[] = []
const scheduled: ReturnType<typeof createRosterHandlers>[] = []
function setup(options: { probeIdle?: (sessionID: string) => Promise<boolean>; maxBusyMs?: number; now?: () => number } = {}) {
  const received: Array<{ sessionID: string; prompt: string }> = []
  const logs: Array<{ event: string; sessionID?: string; details?: Record<string, unknown> }> = []
  let now = Date.now()
  const clock = options.now ?? (() => now)
  const handlers = createRosterHandlers(async (sessionID, prompt) => { received.push({ sessionID, prompt }) }, async (event, sessionID, details) => { logs.push({ event, sessionID, details }) }, clock, { probeIdle: options.probeIdle, maxBusyMs: options.maxBusyMs })
  sessions.push(session)
  scheduled.push(handlers)
  return { handlers, received, logs, advance: (ms: number) => { now += ms } }
}

afterEach(() => {
  for (const handlers of scheduled.splice(0)) for (const job of handlers.listForTest(session)) handlers.call("ScheduleDelete", { id: job.id }, session).catch(() => {})
  sessions.splice(0)
})

describe("MCP loop logic", () => {
  test("parses intervals and clamps delays", () => {
    expect(parseInterval("5s")).toBe(5)
    expect(parseInterval("30s")).toBe(30)
    expect(parseInterval("5m")).toBe(300)
    expect(parseInterval("2h")).toBe(7200)
    expect(parseInterval("3d")).toBeUndefined()
    for (const value of ["0m", "-2m", "2d", "5M", "1.5h", ""]) expect(parseInterval(value)).toBeUndefined()
    expect(clampDelay(0)).toBe(1)
    expect(clampDelay(5)).toBe(5)
    expect(clampDelay(10)).toBe(10)
    expect(clampDelay(60)).toBe(60)
    expect(clampDelay(600)).toBe(600)
    expect(clampDelay(5000)).toBe(3600)
    expect(() => clampDelay(Number.NaN)).toThrow()
  })

  test("accepts a 5s interval", async () => {
    const { handlers } = setup()
    const created = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "fast tick" }, session)).content[0].text)
    expect(created.id.startsWith("cron-")).toBe(true)
    await handlers.call("ScheduleDelete", { id: created.id }, session)
  })

  test("requires session ID and logs the missing metadata", async () => {
    const { handlers, logs } = setup()
    await expect(handlers.call("ScheduleList", {}, undefined)).rejects.toThrow("session id missing")
    expect(logs.some((entry) => entry.event === "error")).toBe(true)
  })

  test("tracks separate cron jobs and deletes one by ID", async () => {
    const { handlers } = setup()
    const one = JSON.parse((await handlers.call("ScheduleCreate", { interval: "1m", prompt: "one" }, session)).content[0].text)
    const two = JSON.parse((await handlers.call("ScheduleCreate", { interval: "2m", prompt: "two" }, session)).content[0].text)
    const list = JSON.parse((await handlers.call("ScheduleList", {}, session)).content[0].text)
    expect(list.map((job: any) => job.id)).toEqual([one.id, two.id])
    await handlers.call("ScheduleDelete", { id: one.id }, session)
    const remaining = JSON.parse((await handlers.call("ScheduleList", {}, session)).content[0].text)
    expect(remaining.map((job: any) => job.id)).toEqual([two.id])
  })

  test("delivers exactly one pending prompt after busy->idle", async () => {
    jest.useFakeTimers()
    const { handlers, received, logs } = setup()
    await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "say tick" }, session)
    await handlers.onBusy(session, { type: "session.status", properties: { status: { type: "busy" } } })
    const cron = handlers.listForTest(session)[0]
    jest.advanceTimersByTime(TEST_INTERVAL_MS)
    await Promise.resolve()
    expect(received).toHaveLength(0)
    expect(logs.some((entry) => entry.event === "message_injected" && entry.details?.queued === true)).toBe(true)
    await handlers.onIdle(session, { type: "session.idle" })
    expect(received).toEqual([{ sessionID: session, prompt: "say tick" }])
    expect(logs.some((entry) => entry.event === "session.idle")).toBe(true)
    expect(logs.some((entry) => entry.event === "busy_released")).toBe(true)
    await handlers.call("ScheduleDelete", { id: cron.id }, session)
    jest.useRealTimers()
  })

  test("drops a second tick per job while queued and logs timer_skipped", async () => {
    jest.useFakeTimers()
    const { handlers, received, logs } = setup()
    await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "say tick" }, session)
    await handlers.onBusy(session, { type: "session.status", data: { status: { type: "busy" } } })
    const cron = handlers.listForTest(session)[0]
    jest.advanceTimersByTime(TEST_INTERVAL_MS)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    jest.advanceTimersByTime(TEST_INTERVAL_MS)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(logs.some((entry) => entry.event === "timer_skipped" && entry.details?.job_key === cron.id)).toBe(true)
    await handlers.onIdle(session, { type: "session.idle" })
    expect(received).toEqual([{ sessionID: session, prompt: "say tick" }])
    await handlers.call("ScheduleDelete", { id: cron.id }, session)
    jest.useRealTimers()
  })

  test("probes before queuing so a stale busy flag does not block delivery", async () => {
    jest.useFakeTimers()
    const { handlers, received, logs } = setup({ probeIdle: async () => true })
    await handlers.onBusy(session, { type: "session.status" })
    await handlers.call("Schedule", { prompt: "probe me", delaySeconds: 5 }, session)
    jest.advanceTimersByTime(5000)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(received).toEqual([{ sessionID: session, prompt: "probe me" }])
    expect(logs.some((entry) => entry.event === "busy_released" && entry.details?.reason === "probe_idle_before_queue")).toBe(true)
    jest.useRealTimers()
  })

  test("releases busy on reconnect and on max-busy timeout", async () => {
    let now = Date.now()
    const { handlers, logs } = setup({ probeIdle: async () => false, maxBusyMs: 120_000, now: () => now })
    await handlers.onBusy(session, { type: "session.status" })
    expect(handlers.isBusyForTest(session)).toBe(true)
    await handlers.onReconnect("sse_error")
    expect(handlers.isBusyForTest(session)).toBe(false)
    expect(logs.some((entry) => entry.event === "busy_released" && entry.details?.reason === "sse_error")).toBe(true)
    await handlers.onBusy(session, { type: "session.status" })
    now += 120_001
    await handlers.safetyValve()
    expect(handlers.isBusyForTest(session)).toBe(false)
    expect(logs.some((entry) => entry.event === "busy_released" && entry.details?.reason === "max_busy_timeout")).toBe(true)
  })

  test("stop cancels every job the session owns and clears its queue", async () => {
    jest.useFakeTimers()
    const { handlers, received, logs } = setup()
    await handlers.call("Schedule", { prompt: "dynamic tick", delaySeconds: 300 }, session)
    const dynamic = handlers.listForTest(session).find((job) => job.source === "Schedule")!
    const one = JSON.parse((await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "one" }, session)).content[0].text)
    const two = JSON.parse((await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "two" }, session)).content[0].text)
    await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "other session" }, "sess-other")
    expect(handlers.listForTest(session)).toHaveLength(3)
    // Queue a cron prompt while busy so stop must drop it too.
    await handlers.onBusy(session, { type: "session.execution.started" })
    const cron = handlers.listForTest(session).find((job) => job.id === one.id)!
    jest.advanceTimersByTime(TEST_INTERVAL_MS)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    // Only the other session's job delivers; this session's ticks queue while busy.
    expect(received).toEqual([{ sessionID: "sess-other", prompt: "other session" }])
    const stopped = await handlers.call("Schedule", { stop: true }, session)
    expect(stopped.content[0].text).toContain("cancelled 3 job(s)")
    expect(handlers.listForTest(session)).toHaveLength(0)
    expect(handlers.listForTest("sess-other")).toHaveLength(1)
    const perJob = logs.filter((entry) => entry.event === "cancel_stop" && entry.details?.action === "stop" && typeof entry.details?.id === "string")
    expect(perJob.map((entry) => entry.details?.id).sort()).toEqual([dynamic.id, one.id, two.id].sort())
    // The queued prompt must not be delivered after stop.
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    expect(received).toEqual([{ sessionID: "sess-other", prompt: "other session" }])
    expect(cron).toBeDefined()
    await handlers.call("ScheduleDelete", { id: handlers.listForTest("sess-other")[0].id }, "sess-other")
    jest.useRealTimers()
  })

  test("maps real v2 execution events to busy and idle", async () => {
    const { handlers, logs } = setup()
    const seen = new Set<string>()
    const sseLog = async (event: string, sessionID?: string, details?: Record<string, unknown>) => { logs.push({ event, sessionID, details }) }
    await handleFrameFor(executionStarted, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(true)
    await handleFrameFor(stepStarted, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(true)
    // A step ending with finish tool-calls means the turn continues: no release.
    await handleFrameFor(stepEndedToolCalls, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(true)
    // Non-turn frames never touch the busy flag.
    await handleFrameFor(inboxEnqueued, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(true)
    await handleFrameFor(executionSucceeded, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(false)
    expect(logs.some((entry) => entry.event === "busy_released" && entry.details?.reason === "session_execution_succeeded")).toBe(true)
    // A failed turn releases busy too.
    await handleFrameFor(executionStarted, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(true)
    await handleFrameFor(executionFailed, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(false)
    expect(logs.some((entry) => entry.event === "busy_released" && entry.details?.reason === "session_execution_failed")).toBe(true)
  })

  test("keeps tolerating the legacy session.status and session.idle shapes", async () => {
    const { handlers, logs } = setup()
    const seen = new Set<string>()
    const sseLog = async (event: string, sessionID?: string, details?: Record<string, unknown>) => { logs.push({ event, sessionID, details }) }
    await handleFrameFor({ id: "1", type: "session.status", data: { sessionID: liveSession, status: { type: "busy" } } }, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(true)
    await handleFrameFor({ id: "2", type: "session.status", data: { sessionID: liveSession, status: { type: "idle" } } }, handlers, sseLog, seen)
    expect(handlers.isBusyForTest(liveSession)).toBe(false)
    await handleFrameFor({ id: "3", type: "session.idle", data: { sessionID: liveSession } }, handlers, sseLog, seen)
    expect(logs.some((entry) => entry.event === "event_type_seen" && entry.details?.type === "session.status")).toBe(true)
  })

  test("logs each event type once per process even for repeat frames", async () => {
    const seen = new Set<string>()
    const calls: string[] = []
    const fakeLog = async (event: string) => { calls.push(event) }
    const noop = { onIdle: async () => {}, onBusy: async () => {}, onDeleted: async () => {} }
    await handleFrameFor(executionStarted, noop, fakeLog, seen)
    await handleFrameFor(executionStarted, noop, fakeLog, seen)
    await handleFrameFor({ ...executionStarted, id: "evt_replay" }, noop, fakeLog, seen)
    expect(calls.filter((entry) => entry === "event_type_seen")).toHaveLength(1)
  })

  test("strips a leading /loop prefix from ScheduleCreate prompts and logs prompt_normalized", async () => {
    const { handlers, logs } = setup()
    const created = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "/loop 5s run sleep 12 seconds" }, session)).content[0].text)
    expect(created.id.startsWith("cron-")).toBe(true)
    expect(handlers.listForTest(session).find((job) => job.id === created.id)!.prompt).toBe("run sleep 12 seconds")
    const entry = logs.find((item) => item.event === "prompt_normalized")
    expect(entry?.details?.before).toBe("/loop 5s run sleep 12 seconds")
    expect(entry?.details?.after).toBe("run sleep 12 seconds")
    const upper = JSON.parse((await handlers.call("ScheduleCreate", { interval: "1m", prompt: "/LOOP 1m Check build" }, session)).content[0].text)
    expect(handlers.listForTest(session).find((job) => job.id === upper.id)!.prompt).toBe("Check build")
    const noInterval = JSON.parse((await handlers.call("ScheduleCreate", { interval: "1m", prompt: "/loop check build" }, session)).content[0].text)
    expect(handlers.listForTest(session).find((job) => job.id === noInterval.id)!.prompt).toBe("check build")
    const normalizedCount = logs.filter((item) => item.event === "prompt_normalized").length
    await handlers.call("ScheduleCreate", { interval: "2m", prompt: "plain task" }, session)
    expect(logs.filter((item) => item.event === "prompt_normalized")).toHaveLength(normalizedCount)
    for (const job of handlers.listForTest(session)) await handlers.call("ScheduleDelete", { id: job.id }, session)
  })

  test("rejects a ScheduleCreate prompt with no task text left", async () => {
    const { handlers, logs } = setup()
    await expect(handlers.call("ScheduleCreate", { interval: "5s", prompt: "/loop 5s" }, session)).rejects.toThrow("task text")
    await expect(handlers.call("ScheduleCreate", { interval: "5s", prompt: "/loop" }, session)).rejects.toThrow("task text")
    expect(handlers.listForTest(session)).toHaveLength(0)
    expect(logs.some((item) => item.event === "prompt_normalized")).toBe(true)
  })

  test("duplicate session/interval/prompt returns the existing id", async () => {
    const { handlers, logs } = setup()
    const first = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "/loop 5s run sleep 12 seconds" }, session)).content[0].text)
    const second = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "run sleep 12 seconds" }, session)).content[0].text)
    expect(second.id).toBe(first.id)
    expect(JSON.stringify(second)).toContain("already scheduled")
    expect(handlers.listForTest(session)).toHaveLength(1)
    expect(logs.some((item) => item.event === "schedule_duplicate")).toBe(true)
    const otherPrompt = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "other task" }, session)).content[0].text)
    const otherInterval = JSON.parse((await handlers.call("ScheduleCreate", { interval: "1m", prompt: "run sleep 12 seconds" }, session)).content[0].text)
    expect(otherPrompt.id).not.toBe(first.id)
    expect(otherInterval.id).not.toBe(first.id)
    expect(handlers.listForTest(session)).toHaveLength(3)
    for (const job of handlers.listForTest(session)) await handlers.call("ScheduleDelete", { id: job.id }, session)
  })

  test("caps jobs per session at ROSTER_MAX_JOBS", async () => {
    const prev = process.env.ROSTER_MAX_JOBS
    process.env.ROSTER_MAX_JOBS = "2"
    try {
      const { handlers, logs } = setup()
      await handlers.call("ScheduleCreate", { interval: "5s", prompt: "task one" }, session)
      await handlers.call("ScheduleCreate", { interval: "1m", prompt: "task two" }, session)
      await expect(handlers.call("ScheduleCreate", { interval: "2m", prompt: "task three" }, session)).rejects.toThrow("job limit")
      expect(handlers.listForTest(session)).toHaveLength(2)
      expect(logs.some((item) => item.event === "schedule_cap_reached")).toBe(true)
      for (const job of handlers.listForTest(session)) await handlers.call("ScheduleDelete", { id: job.id }, session)
    } finally {
      if (prev === undefined) delete process.env.ROSTER_MAX_JOBS
      else process.env.ROSTER_MAX_JOBS = prev
    }
  })

  test("no interval job prompt injected to the session starts with /loop", async () => {
    jest.useFakeTimers()
    const { handlers, received } = setup()
    await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "/loop 5s run sleep 12 seconds" }, "sess-noloop-a")
    await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "plain task" }, "sess-noloop-b")
    jest.advanceTimersByTime(TEST_INTERVAL_MS)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(received.length).toBeGreaterThan(0)
    for (const item of received) expect(item.prompt).not.toMatch(/^\s*\/loop/i)
    for (const job of handlers.listForTest("sess-noloop-a")) expect(job.prompt).not.toMatch(/^\s*\/loop/i)
    for (const job of handlers.listForTest("sess-noloop-b")) expect(job.prompt).not.toMatch(/^\s*\/loop/i)
    for (const job of handlers.listForTest("sess-noloop-a")) await handlers.call("ScheduleDelete", { id: job.id }, "sess-noloop-a")
    for (const job of handlers.listForTest("sess-noloop-b")) await handlers.call("ScheduleDelete", { id: job.id }, "sess-noloop-b")
    jest.useRealTimers()
  })

  test("parses v2 and v1 SSE frames", async () => {
    expect(normalizeEvent({ id: "1", type: "session.status", data: { sessionID: "s", status: { type: "busy" } } })!.data.sessionID).toBe("s")
    expect(normalizeEvent({ id: "1", type: "session.status", properties: { sessionID: "s", status: { type: "busy" } } })!.data.sessionID).toBe("s")
    expect(normalizeEvent({ data: { id: "2", type: "session.idle", data: { sessionID: "s" } } })!.type).toBe("session.idle")
    const calls: string[] = []
    const seen = new Set<string>()
    const fakeLog = async (event: string) => { calls.push(event) }
    const fakeHandlers = {
      onIdle: async (id?: string) => { calls.push(`idle:${id}`) },
      onBusy: async (id?: string) => { calls.push(`busy:${id}`) },
      onDeleted: async () => {},
    }
    await handleFrameFor({ id: "1", type: "session.status", data: { sessionID: "s", status: { type: "busy" } } }, fakeHandlers, fakeLog, seen)
    await handleFrameFor({ id: "1", type: "session.status", properties: { sessionID: "s", status: { type: "idle" } } }, fakeHandlers, fakeLog, seen)
    await handleFrameFor({ id: "2", type: "session.idle", data: { sessionID: "s" } }, fakeHandlers, fakeLog, seen)
    expect(calls).toContain("busy:s")
    expect(calls.filter((entry) => entry === "idle:s").length).toBe(2)
    expect(calls.filter((entry) => entry === "event_type_seen").length).toBe(2)
  })

  test("dynamic wakeups are keyed by prompt: same prompt replaces, different prompt coexists", async () => {
    const { handlers } = setup()
    await handlers.call("Schedule", { prompt: "/loop check the build", delaySeconds: 300 }, session)
    const first = handlers.listForTest(session)
    expect(first).toHaveLength(1)
    const firstId = first[0]!.id
    await handlers.call("Schedule", { prompt: "/loop watch the queue", delaySeconds: 300 }, session)
    expect(handlers.listForTest(session)).toHaveLength(2)
    await handlers.call("Schedule", { prompt: "/loop check the build", delaySeconds: 300 }, session)
    const after = handlers.listForTest(session)
    expect(after).toHaveLength(2)
    const kept = after.find((job) => job.prompt === "/loop watch the queue")!
    const replaced = after.find((job) => job.prompt === "/loop check the build")!
    expect(kept).toBeDefined()
    expect(replaced.id).not.toBe(firstId)
    await handlers.call("Schedule", { stop: true }, session)
    expect(handlers.listForTest(session)).toHaveLength(0)
  })

  test("Schedule stop with prompt stops that dynamic loop only", async () => {
    const { handlers, logs } = setup()
    await handlers.call("Schedule", { prompt: "/loop alpha", delaySeconds: 300 }, session)
    await handlers.call("Schedule", { prompt: "/loop beta", delaySeconds: 300 }, session)
    const beta = handlers.listForTest(session).find((job) => job.prompt === "/loop beta")!
    const stopped = await handlers.call("Schedule", { stop: true, prompt: "/loop alpha" }, session)
    expect(stopped.content[0].text).toContain("cancelled 1 job(s)")
    expect(handlers.listForTest(session).map((job) => job.prompt)).toEqual(["/loop beta"])
    expect(logs.some((entry) => entry.event === "cancel_stop" && typeof entry.details?.id === "string")).toBe(true)
    const missing = await handlers.call("Schedule", { stop: true, prompt: "/loop does-not-exist" }, session)
    expect(missing.content[0].text).toContain("No loop with that prompt")
    expect(handlers.listForTest(session).map((job) => job.id)).toEqual([beta.id])
    await handlers.call("Schedule", { stop: true }, session)
    expect(handlers.listForTest(session)).toHaveLength(0)
  })

  test("ScheduleList shows id, kind, interval or next fire, task, noop streak, pending", async () => {
    const { handlers } = setup()
    const longTask = `task with a very long description ${"x".repeat(100)}`
    await handlers.call("ScheduleCreate", { interval: "5s", prompt: longTask }, session)
    await handlers.call("Schedule", { prompt: "/loop check the build", delaySeconds: 300 }, session)
    const list = JSON.parse((await handlers.call("ScheduleList", {}, session)).content[0].text)
    expect(list).toHaveLength(2)
    const intervalEntry = list.find((job: any) => job.kind === "interval")
    const dynamicEntry = list.find((job: any) => job.kind === "dynamic")
    expect(intervalEntry).toBeDefined()
    expect(dynamicEntry).toBeDefined()
    for (const entry of list) {
      expect(typeof entry.id).toBe("string")
      expect(["interval", "dynamic"]).toContain(entry.kind)
      expect(typeof entry.task).toBe("string")
      expect(entry.task.length).toBeLessThanOrEqual(80)
      expect(typeof entry.due).toBe("string")
      expect(typeof entry.nextFire).toBe("string")
      expect(typeof entry.noopStreak).toBe("number")
      expect(typeof entry.pending).toBe("boolean")
      expect(["pending", "ready"]).toContain(entry.pendingState)
    }
    expect(intervalEntry.prompt).toBe(longTask)
    expect(intervalEntry.task.endsWith("...")).toBe(true)
    expect(intervalEntry.intervalSeconds).toBe(5)
    expect(dynamicEntry.prompt).toBe("/loop check the build")
    // Sorted by next fire and count/earliest derivable from the list.
    const dues = list.map((job: any) => Date.parse(job.due))
    expect([...dues].sort((a, b) => a - b)).toEqual(dues)
    expect(list.length).toBe(2)
    await handlers.call("Schedule", { stop: true }, session)
  })

  test("per-loop pending ticks carry the loop id and do not block other loops", async () => {
    jest.useFakeTimers()
    try {
      const { handlers, received, logs } = setup()
      await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "loop-a task" }, session)
      await handlers.call("ScheduleCreate", { interval: TEST_INTERVAL, prompt: "loop-b task" }, session)
      const ids = handlers.listForTest(session).map((job) => job.id).sort()
      await handlers.onBusy(session, { type: "session.execution.started" })
      jest.advanceTimersByTime(TEST_INTERVAL_MS)
      for (let i = 0; i < 10; i++) await Promise.resolve()
      // Both loops queue their own pending tick while busy.
      expect(received).toHaveLength(0)
      // A second fire while a tick is still queued is dropped per loop.
      jest.advanceTimersByTime(TEST_INTERVAL_MS)
      for (let i = 0; i < 10; i++) await Promise.resolve()
      const skipped = logs.filter((entry) => entry.event === "timer_skipped")
      expect(skipped.length).toBeGreaterThan(0)
      for (const entry of skipped) expect(ids).toContain(entry.details?.job_key as string)
      const listed = JSON.parse((await handlers.call("ScheduleList", {}, session)).content[0].text)
      expect(listed.filter((job: any) => job.pending).length).toBeGreaterThan(0)
      // The normal busy queue delivers one turn at a time: the first idle
      // delivers the first queued tick and the second stays queued behind it.
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      expect(received).toHaveLength(1)
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      const prompts = received.map((item) => item.prompt).sort()
      expect(prompts).toEqual(["loop-a task", "loop-b task"])
      await handlers.call("Schedule", { stop: true }, session)
    } finally {
      jest.useRealTimers()
    }
  })

  test("cap counts dynamic and interval loops together", async () => {
    const prev = process.env.ROSTER_MAX_JOBS
    process.env.ROSTER_MAX_JOBS = "2"
    try {
      const { handlers, logs } = setup()
      await handlers.call("ScheduleCreate", { interval: "5s", prompt: "interval one" }, session)
      await handlers.call("Schedule", { prompt: "/loop dynamic one", delaySeconds: 300 }, session)
      await expect(handlers.call("Schedule", { prompt: "/loop dynamic two", delaySeconds: 300 }, session)).rejects.toThrow("job limit")
      await expect(handlers.call("ScheduleCreate", { interval: "1m", prompt: "interval two" }, session)).rejects.toThrow("job limit")
      expect(logs.some((item) => item.event === "schedule_cap_reached")).toBe(true)
      // Replacing the same dynamic prompt at cap still succeeds.
      await handlers.call("Schedule", { prompt: "/loop dynamic one", delaySeconds: 300 }, session)
      expect(handlers.listForTest(session)).toHaveLength(2)
      await handlers.call("Schedule", { stop: true }, session)
    } finally {
      if (prev === undefined) delete process.env.ROSTER_MAX_JOBS
      else process.env.ROSTER_MAX_JOBS = prev
    }
  })

  test("duplicate interval says already running as <id>", async () => {
    const { handlers, logs } = setup()
    const first = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "dup task" }, session)).content[0].text)
    const second = JSON.parse((await handlers.call("ScheduleCreate", { interval: "5s", prompt: "dup task" }, session)).content[0].text)
    expect(second.id).toBe(first.id)
    expect(second.status).toContain("already running as")
    expect(second.status).toContain(first.id)
    expect(second.status).toContain("already scheduled")
    expect(logs.some((item) => item.event === "schedule_duplicate")).toBe(true)
    await handlers.call("Schedule", { stop: true }, session)
  })

  test("noop streak is tracked per dynamic loop", async () => {
    const { handlers } = setup()
    await handlers.call("Schedule", { prompt: "/loop streak-a", delaySeconds: 300, noop: true }, session)
    await handlers.call("Schedule", { prompt: "/loop streak-b", delaySeconds: 300 }, session)
    await handlers.call("Schedule", { prompt: "/loop streak-a", delaySeconds: 300, noop: true }, session)
    let list = JSON.parse((await handlers.call("ScheduleList", {}, session)).content[0].text)
    expect(list.find((job: any) => job.prompt === "/loop streak-a").noopStreak).toBe(2)
    expect(list.find((job: any) => job.prompt === "/loop streak-b").noopStreak).toBe(0)
    await handlers.call("Schedule", { prompt: "/loop streak-a", delaySeconds: 300, noop: false }, session)
    list = JSON.parse((await handlers.call("ScheduleList", {}, session)).content[0].text)
    expect(list.find((job: any) => job.prompt === "/loop streak-a").noopStreak).toBe(0)
    await handlers.call("Schedule", { stop: true }, session)
  })
})
