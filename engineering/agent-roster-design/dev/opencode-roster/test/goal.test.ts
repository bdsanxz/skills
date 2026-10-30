import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRosterHandlers } from "../src/mcp/logic"
import {
  buildEvaluatorPrompt,
  buildGoalAckPrompt,
  buildGoalContinuePrompt,
  compactTranscript,
  describeMessage,
  extractTextFromMessages,
  extractTextFromPromptResult,
  formatElapsed,
  formatGoalStatus,
  formatTokens,
  goalMaxChecks,
  parseGoalVerdict,
} from "../src/mcp/goal"
import { createGoalEvaluator } from "../src/mcp/api"

type Verdict = { met: boolean; reason: string }

const tracked: Array<{ handlers: ReturnType<typeof createRosterHandlers>; session: string }> = []

function setup(evaluate?: (sessionID: string, condition: string) => Promise<Verdict>, session = `goal-${Math.random().toString(36).slice(2, 8)}`) {
  const received: Array<{ sessionID: string; prompt: string }> = []
  const logs: Array<{ event: string; sessionID?: string; details?: Record<string, unknown> }> = []
  let now = Date.now()
  const handlers = createRosterHandlers(
    async (sessionID, prompt) => { received.push({ sessionID, prompt }) },
    async (event, sessionID, details) => { logs.push({ event, sessionID, details }) },
    () => now,
    { evaluate: evaluate ?? (async () => ({ met: false, reason: "not yet" })) },
  )
  tracked.push({ handlers, session })
  return { handlers, received, logs, advance: (ms: number) => { now += ms } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

afterEach(async () => {
  for (const { handlers, session } of tracked.splice(0)) {
    await handlers.call("Schedule", { stop: true }, session).catch(() => {})
    await handlers.call("Goal", { clear: true }, session).catch(() => {})
  }
})

describe("Goal commands", () => {
  test("status with no goal, set, status while active, clear", async () => {
    const { handlers, received, logs } = setup()
    const session = tracked[tracked.length - 1]!.session
    const empty = await handlers.call("Goal", {}, session)
    expect(empty.content[0].text).toBe("No goal set\n/goal <condition> to set one")
    const set = await handlers.call("Goal", { condition: "tests pass" }, session)
    expect(set.content[0].text).toBe("Goal set: tests pass")
    expect(logs.some((entry) => entry.event === "goal_set" && entry.details?.condition === "tests pass")).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0]!.prompt).toBe(buildGoalAckPrompt("tests pass"))
    expect(received[0]!.prompt).toContain('condition: "tests pass"')
    expect(received[0]!.prompt).toContain("do not tell the user to run `/goal clear` after success")
    const status = await handlers.call("Goal", { status: true }, session)
    expect(status.content[0].text).toContain("Goal active")
    expect(status.content[0].text).toContain("Goal: tests pass")
    expect(status.content[0].text).toContain("/goal clear to stop early")
    const cleared = await handlers.call("Goal", { clear: true }, session)
    expect(cleared.content[0].text).toBe("Goal cleared: tests pass")
    expect(handlers.goalForTest(session)).toBeUndefined()
    expect(logs.some((entry) => entry.event === "goal_cleared")).toBe(true)
    const clearedAgain = await handlers.call("Goal", { clear: true }, session)
    expect(clearedAgain.content[0].text).toBe("No goal set")
  })

  test("requires session ID like the loop tools", async () => {
    const { handlers } = setup()
    await expect(handlers.call("Goal", { condition: "x" }, undefined)).rejects.toThrow("session id missing")
  })

  test("replacing the condition resets checks and logs replaced", async () => {
    const { handlers, logs } = setup(async () => ({ met: false, reason: "still working" }))
    const session = tracked[tracked.length - 1]!.session
    await handlers.call("Goal", { condition: "first" }, session)
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    await handlers.flushGoalsForTest()
    expect(handlers.goalForTest(session)?.checks).toBe(1)
    await handlers.call("Goal", { condition: "second" }, session)
    expect(handlers.goalForTest(session)?.condition).toBe("second")
    expect(handlers.goalForTest(session)?.checks).toBe(0)
    expect(logs.some((entry) => entry.event === "goal_set" && entry.details?.replaced === true)).toBe(true)
  })
})

describe("Goal verdict parsing and prompt building", () => {
  test("parses strict JSON, fenced JSON, and JSON with surrounding text", () => {
    expect(parseGoalVerdict('{"met":true,"reason":"tests green in log"}')).toEqual({ met: true, reason: "tests green in log" })
    expect(parseGoalVerdict('```json\n{"met": false, "reason": "no test output yet"}\n```')).toEqual({ met: false, reason: "no test output yet" })
    expect(parseGoalVerdict('done thinking\n{"met":true,"reason":"built ok"}\ntrailer')).toEqual({ met: true, reason: "built ok" })
  })

  test("rejects empty, non-JSON, and wrong-shaped verdicts", () => {
    expect(() => parseGoalVerdict("")).toThrow("empty")
    expect(() => parseGoalVerdict("looks good to me")).toThrow("non-JSON")
    expect(() => parseGoalVerdict('{"met":"yes","reason":"x"}')).toThrow('{"met":boolean,"reason":string}')
    expect(() => parseGoalVerdict('{"met":false}')).toThrow()
    expect(() => parseGoalVerdict('{"met":false,"reason":"  "}')).toThrow()
  })

  test("continue prompt shape and evaluator prompt carry condition plus transcript", () => {
    expect(buildGoalContinuePrompt("ship it", "no build log yet")).toBe("Stop hook feedback:\n[ship it]: no build log yet")
    const prompt = buildEvaluatorPrompt("ship it", "user: start\nassistant: working")
    expect(prompt).toContain('"ship it"')
    expect(prompt).toContain("assistant: working")
    expect(prompt).toContain('{"met":boolean,"reason":string}')
  })

  test("transcript compaction keeps the tail and understands v2 messages", () => {
    expect(describeMessage({ info: { role: "assistant" }, parts: [{ type: "text", text: "did the thing" }] })).toEqual({ role: "assistant", text: "did the thing" })
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "old work" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "new work" }] },
    ]
    expect(compactTranscript(messages, 1000)).toBe("user: old work\nassistant: new work")
    const capped = compactTranscript(messages, 10)
    expect(capped.length).toBeLessThanOrEqual(10 + "…(truncated)\n".length)
    expect(capped).toContain("new work")
    expect(extractTextFromPromptResult({ data: { text: '{"met":true,"reason":"ok"}' } })).toBe('{"met":true,"reason":"ok"}')
    expect(extractTextFromPromptResult({ data: { parts: [{ type: "text", text: "hi" }] } })).toBe("hi")
    expect(extractTextFromMessages([...messages, { info: { role: "user" }, parts: [{ type: "text", text: "after" }] }])).toBe("new work")
  })

  test("status formatting, elapsed, tokens, and max-check default", () => {
    expect(formatGoalStatus(undefined, Date.now())).toContain("No goal set")
    const active = formatGoalStatus({ condition: "c", setAt: 1000, checks: 6, evalFailures: 0, evalInFlight: false, generation: 1, lastReason: "waiting on tests" }, 25000)
    expect(active).toContain("Goal active")
    expect(active).toContain("7 turns")
    expect(active).toContain("waiting on tests")
    expect(formatElapsed(24_000)).toBe("24s")
    expect(formatTokens(1800)).toBe("1.8k")
    const prev = process.env.ROSTER_GOAL_MAX_CHECKS
    delete process.env.ROSTER_GOAL_MAX_CHECKS
    expect(goalMaxChecks()).toBe(30)
    process.env.ROSTER_GOAL_MAX_CHECKS = "0"
    expect(goalMaxChecks()).toBe(30)
    if (prev === undefined) delete process.env.ROSTER_GOAL_MAX_CHECKS
    else process.env.ROSTER_GOAL_MAX_CHECKS = prev
  })
})

describe("Goal checking loop", () => {
  test("unmet check injects the continue turn; met check clears without injecting", async () => {
    let verdict: Verdict = { met: false, reason: "no passing run in the transcript" }
    const { handlers, received, logs } = setup(async () => verdict)
    const session = tracked[tracked.length - 1]!.session
    await handlers.call("Goal", { condition: "tests pass" }, session)
    received.splice(0)
    await handlers.onBusy(session, { type: "session.execution.started" })
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    await handlers.flushGoalsForTest()
    expect(received).toHaveLength(1)
    expect(received[0]!.prompt).toBe("Stop hook feedback:\n[tests pass]: no passing run in the transcript")
    expect(logs.some((entry) => entry.event === "goal_check" && entry.details?.met === false)).toBe(true)
    expect(logs.some((entry) => entry.event === "goal_continue")).toBe(true)
    expect(typeof logs.find((entry) => entry.event === "goal_check")?.details?.duration_ms).toBe("number")
    verdict = { met: true, reason: "passing run at line 9" }
    received.splice(0)
    await handlers.onBusy(session, { type: "session.execution.started" })
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    await handlers.flushGoalsForTest()
    expect(handlers.goalForTest(session)).toBeUndefined()
    expect(received).toHaveLength(0)
    expect(logs.some((entry) => entry.event === "goal_check" && entry.details?.met === true)).toBe(true)
    expect(logs.some((entry) => entry.event === "goal_achieved")).toBe(true)
  })

  test("cap stops the goal after ROSTER_GOAL_MAX_CHECKS unmet checks", async () => {
    const prev = process.env.ROSTER_GOAL_MAX_CHECKS
    process.env.ROSTER_GOAL_MAX_CHECKS = "2"
    try {
      const { handlers, received, logs } = setup(async () => ({ met: false, reason: "still not done" }))
      const session = tracked[tracked.length - 1]!.session
      await handlers.call("Goal", { condition: "finish" }, session)
      received.splice(0)
      for (let i = 0; i < 2; i++) {
        await handlers.onIdle(session, { type: "session.execution.succeeded" })
        await handlers.flushGoalsForTest()
      }
      expect(handlers.goalForTest(session)?.checks).toBe(2)
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      await handlers.flushGoalsForTest()
      expect(handlers.goalForTest(session)).toBeUndefined()
      expect(logs.some((entry) => entry.event === "goal_cap_reached")).toBe(true)
      expect(received[received.length - 1]!.prompt).toContain("Goal stopped after 2 checks")
    } finally {
      if (prev === undefined) delete process.env.ROSTER_GOAL_MAX_CHECKS
      else process.env.ROSTER_GOAL_MAX_CHECKS = prev
    }
  })

  test("a stale evaluation never injects after replace", async () => {
    const first = deferred<Verdict>()
    let calls = 0
    const { handlers, received } = setup((_, condition) => {
      calls += 1
      return condition === "first" ? first.promise : Promise.resolve({ met: false, reason: "second pending" })
    })
    const session = tracked[tracked.length - 1]!.session
    await handlers.call("Goal", { condition: "first" }, session)
    received.splice(0)
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    expect(handlers.isGoalEvalInFlightForTest(session)).toBe(true)
    await handlers.call("Goal", { condition: "second" }, session)
    received.splice(0)
    first.resolve({ met: false, reason: "stale verdict" })
    await handlers.flushGoalsForTest()
    expect(calls).toBe(1)
    expect(handlers.goalForTest(session)?.condition).toBe("second")
    expect(handlers.goalForTest(session)?.checks).toBe(0)
    expect(received.every((item) => !item.prompt.includes("stale verdict"))).toBe(true)
  })

  test("no injection after clear while an evaluation is in flight", async () => {
    const gate = deferred<Verdict>()
    let calls = 0
    const { handlers, received } = setup(() => { calls += 1; return gate.promise })
    const session = tracked[tracked.length - 1]!.session
    await handlers.call("Goal", { condition: "vanish" }, session)
    received.splice(0)
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    await handlers.call("Goal", { clear: true }, session)
    gate.resolve({ met: false, reason: "too late" })
    await handlers.flushGoalsForTest()
    expect(calls).toBe(1)
    expect(handlers.goalForTest(session)).toBeUndefined()
    expect(received).toHaveLength(0)
  })

  test("skips the check while busy or while another evaluation is in flight", async () => {
    jest.useFakeTimers()
    try {
      const gate = deferred<Verdict>()
      let calls = 0
      const { handlers, received, logs } = setup(() => { calls += 1; return gate.promise })
      const session = tracked[tracked.length - 1]!.session
      await handlers.call("Goal", { condition: "calm" }, session)
      // A loop tick fired while busy queues; idle delivers it, re-busies the
      // session, and the goal check must skip instead of evaluating.
      await handlers.call("Schedule", { prompt: "/loop watch the queue", delaySeconds: 5 }, session)
      jest.advanceTimersByTime(5000)
      for (let i = 0; i < 10; i++) await Promise.resolve()
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      await handlers.flushGoalsForTest()
      expect(calls).toBe(0)
      expect(logs.some((entry) => entry.event === "goal_skipped_busy")).toBe(true)
      expect(received.some((item) => item.prompt === "/loop watch the queue")).toBe(true)
      // A second turn end while the first evaluation runs must skip as well.
      // (No flush here: the first evaluation still holds its gate open.)
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(calls).toBe(1)
      expect(logs.some((entry) => entry.event === "goal_skipped_busy" && entry.details?.reason === "eval_in_flight")).toBe(true)
      gate.resolve({ met: true, reason: "done" })
      await handlers.flushGoalsForTest()
      expect(handlers.goalForTest(session)).toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })

  test("Schedule stop and session end cancel the goal", async () => {
    const { handlers, logs } = setup(async () => ({ met: false, reason: "x" }))
    const session = tracked[tracked.length - 1]!.session
    await handlers.call("Goal", { condition: "doomed" }, session)
    await handlers.call("Schedule", { stop: true }, session)
    expect(handlers.goalForTest(session)).toBeUndefined()
    expect(logs.some((entry) => entry.event === "goal_cleared" && entry.details?.reason === "schedule_stop")).toBe(true)
    await handlers.call("Goal", { condition: "revived" }, session)
    await handlers.onDeleted(session, { type: "session.deleted" })
    expect(handlers.goalForTest(session)).toBeUndefined()
    expect(logs.some((entry) => entry.event === "goal_cleared" && entry.details?.reason === "session_deleted")).toBe(true)
  })

  test("helper sessions are ignored and may not call roster tools", async () => {
    let calls = 0
    const { handlers, logs } = setup(async () => { calls += 1; return { met: true, reason: "helper says so" } })
    const session = tracked[tracked.length - 1]!.session
    handlers.setHelper("helper-1", true)
    expect(handlers.isHelperForTest("helper-1")).toBe(true)
    await expect(handlers.call("Goal", { condition: "sneaky" }, "helper-1")).rejects.toThrow("helper")
    await handlers.onBusy("helper-1", { type: "session.execution.started" })
    await handlers.onIdle("helper-1", { type: "session.execution.succeeded" })
    await handlers.flushGoalsForTest()
    expect(calls).toBe(0)
    expect(logs.every((entry) => entry.sessionID !== "helper-1" || (entry.event !== "goal_check" && entry.event !== "goal_continue"))).toBe(true)
    expect(handlers.goalForTest(session)).toBeUndefined()
    handlers.setHelper("helper-1", false)
  })

  test("three evaluator failures (the default cap) stop the goal", async () => {
    const prev = process.env.ROSTER_GOAL_MAX_EVAL_FAILURES
    delete process.env.ROSTER_GOAL_MAX_EVAL_FAILURES
    try {
      let calls = 0
      const { handlers, received, logs } = setup(async () => { calls += 1; throw new Error("helper blew up") })
      const session = tracked[tracked.length - 1]!.session
      await handlers.call("Goal", { condition: "fragile default" }, session)
      received.splice(0)
      for (let i = 0; i < 3; i++) {
        await handlers.onIdle(session, { type: "session.execution.succeeded" })
        await handlers.flushGoalsForTest()
      }
      expect(calls).toBe(3)
      expect(handlers.goalForTest(session)).toBeUndefined()
      expect(logs.filter((entry) => entry.event === "goal_eval_failed")).toHaveLength(3)
      expect(logs.some((entry) => entry.event === "goal_cap_reached" && entry.details?.reason === "eval_failed")).toBe(true)
      expect(received[received.length - 1]!.prompt).toContain("stopping goal")
    } finally {
      if (prev === undefined) delete process.env.ROSTER_GOAL_MAX_EVAL_FAILURES
      else process.env.ROSTER_GOAL_MAX_EVAL_FAILURES = prev
    }
  })

  test("a second SSE idle during an in-flight eval does not start a second eval", async () => {
    const gate = deferred<Verdict>()
    let calls = 0
    const { handlers, logs } = setup(() => { calls += 1; return gate.promise })
    const session = tracked[tracked.length - 1]!.session
    await handlers.call("Goal", { condition: "patient" }, session)
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    expect(calls).toBe(1)
    await handlers.onIdle(session, { type: "session.execution.succeeded" })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(calls).toBe(1)
    expect(logs.some((entry) => entry.event === "goal_skipped_busy" && entry.details?.reason === "eval_in_flight")).toBe(true)
    gate.resolve({ met: false, reason: "still going" })
    await handlers.flushGoalsForTest()
    expect(handlers.goalForTest(session)?.checks).toBe(1)
  })

  test("repeated evaluator failures log goal_eval_failed and give up", async () => {
    const prev = process.env.ROSTER_GOAL_MAX_EVAL_FAILURES
    process.env.ROSTER_GOAL_MAX_EVAL_FAILURES = "2"
    try {
      const { handlers, received, logs } = setup(async () => { throw new Error("model blew up") })
      const session = tracked[tracked.length - 1]!.session
      await handlers.call("Goal", { condition: "fragile" }, session)
      received.splice(0)
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      await handlers.flushGoalsForTest()
      expect(handlers.goalForTest(session)?.evalFailures).toBe(1)
      await handlers.onIdle(session, { type: "session.execution.succeeded" })
      await handlers.flushGoalsForTest()
      expect(handlers.goalForTest(session)).toBeUndefined()
      expect(logs.filter((entry) => entry.event === "goal_eval_failed")).toHaveLength(2)
      expect(logs.some((entry) => entry.event === "goal_cap_reached" && entry.details?.reason === "eval_failed")).toBe(true)
      expect(received[received.length - 1]!.prompt).toContain("stopping goal")
    } finally {
      if (prev === undefined) delete process.env.ROSTER_GOAL_MAX_EVAL_FAILURES
      else process.env.ROSTER_GOAL_MAX_EVAL_FAILURES = prev
    }
  })
})

describe("Goal evaluator HTTP calls", () => {
  test("uses session.get without a body, reuses the model, and deletes the helper", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith("/api/session/s1") && (!init?.method || init.method === "GET")) {
        expect("body" in (init ?? {})).toBe(false)
        return Response.json({ data: { id: "s1", model: { providerID: "p", id: "m" } } })
      }
      if (url.includes("/api/session/s1/message")) {
        return Response.json({ data: [{ info: { role: "user" }, parts: [{ type: "text", text: "do the thing" }] }] })
      }
      if (url.endsWith("/api/session") && init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        expect(body.title).toContain("roster-goal-eval")
        expect(body.model).toEqual({ providerID: "p", id: "m" })
        return Response.json({ data: { id: "helper-9" } })
      }
      if (url.includes("/api/session/helper-9/prompt")) {
        return Response.json({ data: { text: '{"met":true,"reason":"evidence at line 1"}' } })
      }
      if (url.endsWith("/api/session/helper-9") && init?.method === "DELETE") {
        return Response.json(true)
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const evaluate = createGoalEvaluator({ baseURL: "http://127.0.0.1:4097", password: "pw", fetchImpl: fetchMock })
    await expect(evaluate("s1", "do the thing")).resolves.toEqual({ met: true, reason: "evidence at line 1" })
    const promptCall = calls.find((entry) => entry.url.includes("/prompt"))!
    expect(JSON.parse(String(promptCall.init?.body)).text).toContain("do the thing")
    expect(calls.some((entry) => entry.url.endsWith("/api/session/helper-9") && entry.init?.method === "DELETE")).toBe(true)
    expect(promptCall.init?.headers).toMatchObject({ authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}` })
  })

  test("live /api shapes: prompt echoes the user message, verdict is polled from message.list", async () => {
    // Fixtures probed 2026-10-30 against OpenCode v2.0.29 (no secrets):
    // session.get -> {data:{id, model:{id, providerID}}}; session.create with
    // {providerID, id}; prompt -> {data:{type:"user", payload:{text}}} at once,
    // then message.list shows only the user echo until the assistant replies.
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let helperLists = 0
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith("/api/session/s-live") && (!init?.method || init.method === "GET")) {
        return Response.json({ data: { id: "s-live", model: { id: "gpt-6-luna", providerID: "vikey" } } })
      }
      if (url.includes("/api/session/s-live/message")) {
        return Response.json({ data: [{ id: "m1", time: { created: 1 }, text: "do the thing", type: "user" }], cursor: {} })
      }
      if (url.endsWith("/api/session") && init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        expect(body.model).toEqual({ providerID: "vikey", id: "gpt-6-luna" })
        return Response.json({ data: { id: "helper-live", projectID: "p", title: body.title } })
      }
      if (url.includes("/api/session/helper-live/prompt")) {
        return Response.json({ data: { id: "m-echo", sessionID: "helper-live", time: { created: 2 }, type: "user", payload: { text: "evaluator prompt", delivery: "steer" } } })
      }
      if (url.includes("/api/session/helper-live/message")) {
        helperLists += 1
        if (helperLists === 1) {
          return Response.json({ data: [{ id: "m-echo", time: { created: 2 }, text: "evaluator prompt", type: "user" }], cursor: {} })
        }
        return Response.json({
          data: [
            { id: "m-echo", time: { created: 2 }, text: "evaluator prompt", type: "user" },
            { id: "m-reply", time: { created: 3 }, type: "assistant", content: [{ type: "text", id: "p1", text: '{"met":false,"reason":"only h so far"}' }] },
          ],
          cursor: {},
        })
      }
      if (url.endsWith("/api/session/helper-live") && init?.method === "DELETE") {
        return new Response(null, { status: 204 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const evaluate = createGoalEvaluator({ baseURL: "http://127.0.0.1:4097", fetchImpl: fetchMock })
    await expect(evaluate("s-live", "spell hello")).resolves.toEqual({ met: false, reason: "only h so far" })
    expect(helperLists).toBeGreaterThan(1)
    expect(calls.some((entry) => entry.url.endsWith("/api/session/helper-live") && entry.init?.method === "DELETE")).toBe(true)
  })

  test("flat live message shapes: role from type, text from content, user echo ignored", async () => {
    expect(describeMessage({ id: "m1", time: { created: 1 }, text: "do it", type: "user" })).toEqual({ role: "user", text: "do it" })
    expect(describeMessage({ id: "m2", time: { created: 2 }, type: "assistant", content: [{ type: "text", id: "p1", text: "did it" }] })).toEqual({ role: "assistant", text: "did it" })
    expect(describeMessage({ id: "m3", time: { created: 3 }, type: "user", payload: { text: "echo", delivery: "steer" } })).toEqual({ role: "user", text: "echo" })
    // session.prompt user echoes are never verdict text, even with a body.
    expect(extractTextFromPromptResult({ data: { id: "m3", type: "user", payload: { text: '{"met":true,"reason":"x"}' } } })).toBeUndefined()
    expect(extractTextFromPromptResult({ data: { id: "m3", type: "user", text: '{"met":true,"reason":"x"}' } })).toBeUndefined()
    // Assistant content arrays extract; user-only lists yield nothing.
    expect(extractTextFromPromptResult({ data: { id: "m2", type: "assistant", content: [{ type: "text", id: "p1", text: '{"met":true,"reason":"ok"}' }] } })).toBe('{"met":true,"reason":"ok"}')
    const onlyUser = [{ id: "m1", time: { created: 1 }, text: "waiting", type: "user" }]
    expect(extractTextFromMessages(onlyUser)).toBeUndefined()
    expect(extractTextFromMessages([...onlyUser, { id: "m2", time: { created: 2 }, type: "assistant", content: [{ type: "text", id: "p1", text: '{"met":true,"reason":"ok"}' }] }])).toBe('{"met":true,"reason":"ok"}')
  })

  test("deletes the helper and surfaces failures when the prompt fails", async () => {
    const deleted: string[] = []
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/session/s2")) return Response.json({ data: { id: "s2" } })
      if (url.includes("/message")) return Response.json({ data: [] })
      if (url.endsWith("/api/session") && init?.method === "POST") return Response.json({ data: { id: "helper-10" } })
      if (url.includes("/prompt")) return new Response("bad", { status: 500 })
      if (url.endsWith("/api/session/helper-10") && init?.method === "DELETE") {
        deleted.push(url)
        return Response.json(true)
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const evaluate = createGoalEvaluator({ baseURL: "http://127.0.0.1:4097", fetchImpl: fetchMock })
    await expect(evaluate("s2", "whatever")).rejects.toThrow("session.prompt")
    expect(deleted).toHaveLength(1)
  })
})
