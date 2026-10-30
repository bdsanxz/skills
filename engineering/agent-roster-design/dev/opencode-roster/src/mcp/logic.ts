import { appendFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { buildGoalAckPrompt, buildGoalCapPrompt, buildGoalContinuePrompt, buildGoalEvalFailedPrompt, formatGoalStatus, goalMaxChecks, goalMaxEvalFailures, type GoalState } from "./goal"

export const autonomousSentinel = "<<autonomous-loop-dynamic>>"

export function parseInterval(value: string): number | undefined {
  const match = /^(\d+)(s|m|h)$/.exec(value)
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) return undefined
  return Number(match[1]) * ({ s: 1, m: 60, h: 3600 } as const)[match[2] as "s" | "m" | "h"]
}

export function clampDelay(seconds: number): number {
  if (!Number.isFinite(seconds)) throw new Error("delaySeconds must be finite")
  return Math.max(1, Math.min(3600, Math.round(seconds)))
}

export function normalizeScheduleCreatePrompt(prompt: string): { text: string; stripped: boolean } {
  const before = prompt ?? ""
  if (!/^\s*\/loop\b/i.test(before)) return { text: before, stripped: false }
  let rest = before.replace(/^\s*\/loop\b/i, "")
  // Strip chained prefixes (e.g. a tick that already carries "/loop ...")
  // so the stored prompt can never look like a new /loop command.
  for (let i = 0; i < 5; i++) {
    const intervalMatch = /^\s*\d+[smh]\b/i.exec(rest)
    if (intervalMatch) rest = rest.slice(intervalMatch[0].length)
    const again = /^\s*\/loop\b/i.exec(rest)
    if (!again) break
    rest = rest.slice(again[0].length)
  }
  return { text: rest.trim(), stripped: true }
}

function maxJobsPerSession(): number {
  const raw = Number(process.env.ROSTER_MAX_JOBS ?? 10)
  if (!Number.isFinite(raw) || Math.floor(raw) < 1) return 10
  return Math.floor(raw)
}

export type Injector = (sessionID: string, prompt: string) => Promise<void>
export type Log = (event: string, sessionID?: string, details?: Record<string, unknown>) => Promise<void>
export type Job = { id: string; sessionID: string; prompt: string; intervalSeconds?: number; intervalLabel?: string; timer: ReturnType<typeof setTimeout>; due: number; source: string; kind: "interval" | "dynamic"; noopStreak: number }

export function shortTask(prompt: string, max = 80): string {
  const flat = (prompt ?? "").replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}

export function loopKindOf(source: string): "interval" | "dynamic" {
  return source === "Schedule" ? "dynamic" : "interval"
}

export function createRosterHandlers(inject: Injector, log: Log, clock = () => Date.now(), options: { maxBusyMs?: number; probeIdle?: (sessionID: string) => Promise<boolean>; evaluate?: (sessionID: string, condition: string) => Promise<{ met: boolean; reason: string }> } = {}) {
  const jobs = new Map<string, Job>()
  const goals = new Map<string, GoalState>()
  const goalGenerations = new Map<string, number>()
  const helpers = new Set<string>()
  const goalChecks = new Set<Promise<void>>()
  const busy = new Set<string>()
  const pending = new Map<string, { prompt: string; source: string }>()
  const noopStreak = new Map<string, number>()
  const injectQueue = new Map<string, Promise<void>>()
  const pendingByKey = new Map<string, { sessionID: string; prompt: string; source: string }>()
  const busySince = new Map<string, number>()
  const maxBusyMs = options.maxBusyMs ?? Number(process.env.ROSTER_BUSY_MAX_MS || process.env.ROSTER_MAX_BUSY_MS || 120000)

  async function releaseBusy(sessionID: string, reason: string, details: Record<string, unknown> = {}) {
    if (!busy.has(sessionID) && !busySince.has(sessionID)) return false
    busy.delete(sessionID)
    busySince.delete(sessionID)
    await log("busy_released", sessionID, { reason, ...details })
    return true
  }

  async function deliver(sessionID: string, prompt: string, source: string, key = source) {
    if (busy.has(sessionID)) {
      // Probe before queuing so a stale busy flag never blocks delivery.
      if (options.probeIdle) {
        try {
          if (await options.probeIdle(sessionID)) {
            await releaseBusy(sessionID, "probe_idle_before_queue", { source, job_key: key })
          }
        } catch (error) {
          await log("error", sessionID, { source: "busy_probe_before_queue", message: String(error), stack: error instanceof Error ? error.stack : undefined })
          await releaseBusy(sessionID, "probe_error_before_queue", { source, job_key: key })
        }
      }
    }
    if (busy.has(sessionID)) {
      if (pendingByKey.has(key)) {
        await log("timer_skipped", sessionID, { source, prompt, job_key: key, reason: "previous_prompt_still_queued" })
        return { queued: true, skipped: true }
      }
      pendingByKey.set(key, { sessionID, prompt, source })
      const item = pendingByKey.get(key)!
      pending.set(sessionID, item)
      await log("message_injected", sessionID, { busy: true, queued: true, source, prompt: item.prompt, job_key: key })
      return { queued: true }
    }
    busy.add(sessionID)
    busySince.set(sessionID, clock())
    await log("message_injected", sessionID, { busy: false, queued: false, source, prompt })
    try {
      const prior = injectQueue.get(sessionID) ?? Promise.resolve()
      let finish!: () => void
      const gate = new Promise<void>((resolve) => { finish = resolve })
      injectQueue.set(sessionID, prior.then(() => gate))
      await prior
      try { await inject(sessionID, prompt) } finally { finish() }
      await log("first_iteration_sent", sessionID, { source, prompt })
      return { queued: false }
    } catch (error) {
      await releaseBusy(sessionID, "inject_error", { source })
      await log("error", sessionID, { source: "injector", message: String(error), stack: error instanceof Error ? error.stack : undefined })
      throw error
    }
  }

  function removeJob(id: string) {
    const job = jobs.get(id)
    if (job) clearTimeout(job.timer)
    jobs.delete(id)
    return job
  }

  const goalKey = (sessionID: string) => `goal:${sessionID}`

  async function clearGoal(sessionID: string, reason: string, condition?: string) {
    const existing = goals.get(sessionID)
    goalGenerations.set(sessionID, (goalGenerations.get(sessionID) ?? 0) + 1)
    goals.delete(sessionID)
    await log("goal_cleared", sessionID, { condition: condition ?? existing?.condition, reason })
  }

  function sessionHasPendingTick(sessionID: string): boolean {
    if (pending.has(sessionID)) return true
    for (const item of pendingByKey.values()) if (item.sessionID === sessionID) return true
    return false
  }

  async function runGoalCheck(sessionID: string): Promise<void> {
    const goal = goals.get(sessionID)
    // Helper sessions run the evaluator itself: they never trigger checks.
    if (!goal || helpers.has(sessionID)) return
    if (busy.has(sessionID)) {
      await log("goal_skipped_busy", sessionID, { condition: goal.condition, reason: "session_busy" })
      return
    }
    if (sessionHasPendingTick(sessionID)) {
      await log("goal_skipped_busy", sessionID, { condition: goal.condition, reason: "pending_tick" })
      return
    }
    if (goal.evalInFlight) {
      await log("goal_skipped_busy", sessionID, { condition: goal.condition, reason: "eval_in_flight" })
      return
    }
    const maxChecks = goalMaxChecks()
    if (goal.checks >= maxChecks) {
      const condition = goal.condition
      const checks = goal.checks
      await clearGoal(sessionID, "cap_reached", condition)
      await log("goal_cap_reached", sessionID, { condition, checks, max_checks: maxChecks })
      await deliver(sessionID, buildGoalCapPrompt(condition, checks), "Goal", goalKey(sessionID))
      return
    }
    if (!options.evaluate) {
      await log("goal_eval_failed", sessionID, { condition: goal.condition, error: "no evaluator configured", failures: goal.checks })
      return
    }
    const generation = goal.generation
    goal.evalInFlight = true
    const started = clock()
    try {
      const verdict = await options.evaluate(sessionID, goal.condition)
      const current = goals.get(sessionID)
      // Clear/replace/stop during the evaluation wins: never inject stale turns.
      if (!current || current.generation !== generation) return
      const durationMs = clock() - started
      if (verdict.met) {
        goals.delete(sessionID)
        await log("goal_check", sessionID, { condition: current.condition, met: true, reason: verdict.reason, duration_ms: durationMs, checks: current.checks })
        await log("goal_achieved", sessionID, { condition: current.condition, reason: verdict.reason, checks: current.checks, elapsed_ms: clock() - current.setAt })
        return
      }
      current.checks += 1
      current.evalFailures = 0
      current.lastReason = verdict.reason
      await log("goal_check", sessionID, { condition: current.condition, met: false, reason: verdict.reason, duration_ms: durationMs, checks: current.checks })
      await log("goal_continue", sessionID, { condition: current.condition, reason: verdict.reason, checks: current.checks })
      if (busy.has(sessionID) || sessionHasPendingTick(sessionID) || goals.get(sessionID)?.generation !== generation) {
        await log("goal_skipped_busy", sessionID, { condition: current.condition, reason: "became_busy_during_eval" })
        return
      }
      await deliver(sessionID, buildGoalContinuePrompt(current.condition, verdict.reason), "Goal", goalKey(sessionID))
    } catch (error) {
      const current = goals.get(sessionID)
      if (!current || current.generation !== generation) return
      current.evalFailures += 1
      const message = error instanceof Error ? error.message : String(error)
      await log("goal_eval_failed", sessionID, { condition: current.condition, error: message, failures: current.evalFailures })
      if (current.evalFailures >= goalMaxEvalFailures()) {
        const condition = current.condition
        const failures = current.evalFailures
        await clearGoal(sessionID, "eval_failed", condition)
        await log("goal_cap_reached", sessionID, { condition, reason: "eval_failed", failures })
        await deliver(sessionID, buildGoalEvalFailedPrompt(condition), "Goal", goalKey(sessionID))
      }
    } finally {
      const current = goals.get(sessionID)
      if (current && current.generation === generation) current.evalInFlight = false
    }
  }

  async function schedule(sessionID: string, prompt: string, delaySeconds: number, source: string, noop = false) {
    const delay = clampDelay(delaySeconds)
    // Dynamic wakeups are keyed by prompt text: replacing the pending wakeup
    // of the SAME prompt never touches other loops' wakeups.
    const prior = [...jobs.values()].find((j) => j.sessionID === sessionID && j.source === "Schedule" && j.prompt === prompt)
    let baseStreak = 0
    if (prior) {
      baseStreak = prior.noopStreak ?? noopStreak.get(prior.id) ?? noopStreak.get(sessionID) ?? 0
      removeJob(prior.id)
      // A reschedule replaces the pending wakeup of the same prompt as well,
      // keeping one pending tick per loop.
      if (pendingByKey.has(prior.id)) pendingByKey.delete(prior.id)
      const legacy = pending.get(sessionID)
      if (legacy && legacy.prompt === prompt && legacy.source === source) pending.delete(sessionID)
      noopStreak.delete(prior.id)
    } else {
      const maxJobs = maxJobsPerSession()
      const owned = [...jobs.values()].filter((j) => j.sessionID === sessionID).length
      if (owned >= maxJobs) {
        await log("schedule_cap_reached", sessionID, { max_jobs: maxJobs, owned, source, prompt })
        throw new Error(`job limit reached for this session (max ${maxJobs} loops); delete a job or stop a loop before creating another`)
      }
    }
    const due = clock() + delay * 1000
    const id = `wake-${clock()}-${Math.random().toString(36).slice(2, 8)}`
    const count = noop ? baseStreak + 1 : 0
    const job: Job = { id, sessionID, prompt, due, source: "Schedule", kind: "dynamic", noopStreak: count, timer: undefined as any }
    job.timer = setTimeout(() => {
      void (async () => {
        jobs.delete(id)
        await log("timer_fired", sessionID, { job_id: id, loop_id: id, source, due: new Date(due).toISOString() })
        await deliver(sessionID, prompt, source, id)
      })()
    }, delay * 1000) as ReturnType<typeof setTimeout>
    jobs.set(id, job)
    noopStreak.set(id, count)
    noopStreak.set(sessionID, count)
    await log("timer_scheduled", sessionID, { job_id: id, loop_id: id, delay_seconds: delay, due: new Date(due).toISOString(), source, noop_streak: count, prompt })
    return { id, due: new Date(due).toISOString(), delaySeconds: delay }
  }

  async function call(name: string, args: any, sessionID?: string) {
    await log("tool_call", sessionID, { tool: name, params: args })
    if (!sessionID) {
      await log("error", undefined, { source: name, message: "OpenCode session id missing from params._meta[ai.opencode/sessionID]" })
      throw new Error("OpenCode session id missing; this tool must be called from an OpenCode session")
    }
    if (helpers.has(sessionID)) {
      await log("error", sessionID, { source: name, message: "goal helper sessions may not call roster tools" })
      throw new Error("goal helper sessions may not call roster tools")
    }
    try {
      if (name === "Schedule") {
        if (args.stop) {
          const stopPrompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt : undefined
          const owned = stopPrompt === undefined
            ? [...jobs.values()].filter((job) => job.sessionID === sessionID)
            : [...jobs.values()].filter((job) => job.sessionID === sessionID && job.prompt === stopPrompt)
          for (const job of owned) {
            removeJob(job.id)
            noopStreak.delete(job.id)
            await log("cancel_stop", sessionID, { action: "stop", id: job.id, loop_id: job.id, kind: job.kind ?? loopKindOf(job.source), source: job.source, result: `Cancelled ${job.source} job ${job.id}` })
          }
          if (stopPrompt === undefined) {
            pending.delete(sessionID)
            for (const [key, item] of pendingByKey) if (item.sessionID === sessionID) pendingByKey.delete(key)
            noopStreak.delete(sessionID)
          } else {
            for (const [key, item] of [...pendingByKey]) {
              if (item.sessionID !== sessionID) continue
              if (key === stopPrompt || owned.some((job) => job.id === key) || item.prompt === stopPrompt) pendingByKey.delete(key)
            }
            const legacy = pending.get(sessionID)
            if (legacy && legacy.prompt === stopPrompt) pending.delete(sessionID)
          }
          // A stop ends the session goal too: a goal never outlives Schedule stop.
          if (goals.has(sessionID)) await clearGoal(sessionID, "schedule_stop")
          if (stopPrompt !== undefined && owned.length === 0) {
            // Also drop a queued-but-fired wakeup of the same prompt that no
            // longer has a timer.
            await log("cancel_stop", sessionID, { action: "stop", prompt: stopPrompt, result: "No loop with that prompt for this session" })
            return { content: [{ type: "text", text: `No loop with that prompt for this session.` }] }
          }
          await log("cancel_stop", sessionID, { action: "stop", prompt: stopPrompt, result: `Loop stopped; cancelled ${owned.length} job(s) and pending wakeups` })
          return { content: [{ type: "text", text: `Loop stopped; cancelled ${owned.length} job(s) and pending wakeups.` }] }
        }
        if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("prompt is required unless stop=true")
        const scheduled = await schedule(sessionID, args.prompt, args.delaySeconds ?? 1500, "Schedule", args.noop === true)
        const result = `Scheduled wakeup ${scheduled.id} in ${scheduled.delaySeconds}s for ${scheduled.due}. Reason: ${args.reason ?? "next iteration"}`
        await log("tool_result", sessionID, { tool: name, result })
        return { content: [{ type: "text", text: result }] }
      }
      if (name === "ScheduleCreate") {
        const intervalSeconds = parseInterval(args.interval)
        if (!intervalSeconds || intervalSeconds < 1 || intervalSeconds > 3600) throw new Error("schedule interval must be from 1s through 1h")
        if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("ScheduleCreate prompt must be the task text only (without the leading /loop command and interval); e.g. /loop 5s run sleep 12 seconds -> {interval:\"5s\", prompt:\"run sleep 12 seconds\"}")
        const before = args.prompt
        const { text: prompt, stripped } = normalizeScheduleCreatePrompt(before)
        if (stripped) await log("prompt_normalized", sessionID, { before, after: prompt })
        if (!prompt) throw new Error("ScheduleCreate prompt must be the task text only (without the leading /loop command and interval); e.g. /loop 5s run sleep 12 seconds -> {interval:\"5s\", prompt:\"run sleep 12 seconds\"}")
        const existing = [...jobs.values()].find((j) => j.sessionID === sessionID && j.source === "ScheduleCreate" && j.intervalSeconds === intervalSeconds && j.prompt === prompt)
        if (existing) {
          await log("schedule_duplicate", sessionID, { existing_id: existing.id, loop_id: existing.id, interval: args.interval, prompt })
          const dupResult = { id: existing.id, due: new Date(existing.due).toISOString(), interval: args.interval, status: `already scheduled (already running as ${existing.id})` }
          await log("tool_result", sessionID, { tool: name, result: dupResult })
          return { content: [{ type: "text", text: JSON.stringify(dupResult) }] }
        }
        const maxJobs = maxJobsPerSession()
        const owned = [...jobs.values()].filter((j) => j.sessionID === sessionID).length
        if (owned >= maxJobs) {
          await log("schedule_cap_reached", sessionID, { max_jobs: maxJobs, owned, interval: args.interval, prompt })
          throw new Error(`job limit reached for this session (max ${maxJobs} loops); delete a job or stop a loop before creating another`)
        }
        const id = `cron-${clock()}-${Math.random().toString(36).slice(2, 8)}`
        const due = clock() + intervalSeconds * 1000
        const job: Job = { id, sessionID, prompt, intervalSeconds, intervalLabel: args.interval, due, source: "ScheduleCreate", kind: "interval", noopStreak: 0, timer: undefined as any }
        job.timer = setTimeout(() => void fireCron(id), intervalSeconds * 1000)
        jobs.set(id, job)
        noopStreak.set(id, 0)
        const result = { id, due: new Date(due).toISOString(), interval: args.interval }
        await log("timer_scheduled", sessionID, { job_id: id, loop_id: id, kind: "interval", delay_seconds: intervalSeconds, due: result.due, source: "ScheduleCreate", prompt })
        await log("tool_result", sessionID, { tool: name, result })
        return { content: [{ type: "text", text: JSON.stringify(result) }] }
      }
      if (name === "ScheduleList") {
        const sessionJobs = [...jobs.values()].filter((j) => j.sessionID === sessionID)
        const result = sessionJobs.map((job) => {
          const kind = job.kind ?? loopKindOf(job.source)
          const dueIso = new Date(job.due).toISOString()
          const pendingFlag = pendingByKey.has(job.id)
          return {
            id: job.id,
            kind,
            source: job.source,
            prompt: job.prompt,
            task: shortTask(job.prompt),
            intervalSeconds: job.intervalSeconds,
            interval: job.intervalLabel ?? (job.intervalSeconds ? `${job.intervalSeconds}s` : undefined),
            due: dueIso,
            nextFire: dueIso,
            noopStreak: job.noopStreak ?? noopStreak.get(job.id) ?? 0,
            pending: pendingFlag,
            pendingState: pendingFlag ? "pending" : "ready",
          }
        }).sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
        const count = result.length
        const nextFire = count ? result[0]!.due : undefined
        await log("tool_result", sessionID, { tool: name, result, count, next_fire: nextFire })
        return { content: [{ type: "text", text: JSON.stringify(result) }] }
      }
      if (name === "ScheduleDelete") {
        const job = jobs.get(args.id)
        const deleted = Boolean(job && job.sessionID === sessionID)
        if (deleted) {
          removeJob(args.id)
          noopStreak.delete(args.id)
          if (pendingByKey.has(args.id)) pendingByKey.delete(args.id)
        }
        const result = deleted ? `Deleted ${args.id}` : `No job ${args.id} for this session`
        await log("cancel_stop", sessionID, { action: "ScheduleDelete", id: args.id, loop_id: args.id, kind: job ? (job.kind ?? loopKindOf(job.source)) : undefined, result })
        await log("tool_result", sessionID, { tool: name, result })
        return { content: [{ type: "text", text: result }] }
      }
      if (name === "Goal") {
        const condition = typeof args.condition === "string" && args.condition.trim() ? args.condition.trim() : undefined
        if (args.clear === true) {
          const existing = goals.get(sessionID)
          if (!existing) {
            await log("goal_cleared", sessionID, { cleared: false, reason: "clear" })
            const empty = "No goal set"
            await log("tool_result", sessionID, { tool: name, result: empty })
            return { content: [{ type: "text", text: empty }] }
          }
          await clearGoal(sessionID, "clear", existing.condition)
          const result = `Goal cleared: ${existing.condition}`
          await log("tool_result", sessionID, { tool: name, result })
          return { content: [{ type: "text", text: result }] }
        }
        if (condition !== undefined) {
          const replaced = goals.has(sessionID)
          const generation = (goalGenerations.get(sessionID) ?? 0) + 1
          goalGenerations.set(sessionID, generation)
          goals.set(sessionID, { condition, setAt: clock(), checks: 0, evalFailures: 0, evalInFlight: false, generation, lastReason: undefined })
          await log("goal_set", sessionID, { condition, replaced })
          await deliver(sessionID, buildGoalAckPrompt(condition), "Goal", goalKey(sessionID))
          const result = `Goal set: ${condition}`
          await log("tool_result", sessionID, { tool: name, result })
          return { content: [{ type: "text", text: result }] }
        }
        const result = formatGoalStatus(goals.get(sessionID), clock())
        await log("tool_result", sessionID, { tool: name, result })
        return { content: [{ type: "text", text: result }] }
      }
      throw new Error(`Unknown tool ${name}`)
    } catch (error) {
      await log("error", sessionID, { source: name, params: args, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
      throw error
    }
  }

  async function fireCron(id: string) {
    const job = jobs.get(id)
    if (!job?.intervalSeconds) return
    job.due = clock() + job.intervalSeconds * 1000
    job.timer = setTimeout(() => void fireCron(id), job.intervalSeconds * 1000)
    await log("timer_fired", job.sessionID, { job_id: id, loop_id: id, kind: "interval", source: "ScheduleCreate", due: new Date(job.due).toISOString() })
    await deliver(job.sessionID, job.prompt, `ScheduleCreate:${id}`, id)
  }

  function frameTypeOf(payload: unknown): string | undefined {
    const type = (payload as any)?.type
    return typeof type === "string" && type.length > 0 ? type : undefined
  }

  return {
    call,
    async onIdle(sessionID?: string, payload?: unknown) {
      const frameType = frameTypeOf(payload)
      await log(frameType ?? "session.idle", sessionID, { raw_payload: payload })
      if (!sessionID) return
      await releaseBusy(sessionID, frameType ? frameType.replace(/\./g, "_") : "session_idle", {})
      const queued = [...pendingByKey.entries()].filter(([, item]) => item.sessionID === sessionID)
      pending.delete(sessionID)
      for (const [key, item] of queued) {
        pendingByKey.delete(key)
        await deliver(sessionID, item.prompt, item.source, key)
      }
      // A loop tick is just another turn: after pending delivery the goal
      // check either runs (idle) or skips (the tick made us busy again).
      // Fire-and-forget so slow helper-model evaluations never stall SSE.
      if (goals.has(sessionID) && !helpers.has(sessionID)) {
        const check = runGoalCheck(sessionID)
        goalChecks.add(check)
        void check.then(() => goalChecks.delete(check), () => goalChecks.delete(check))
      }
    },
    async onBusy(sessionID?: string, payload?: unknown) {
      await log(frameTypeOf(payload) ?? "session.status", sessionID, { raw_payload: payload })
      if (sessionID) { busy.add(sessionID); busySince.set(sessionID, clock()) }
    },
    async onDeleted(sessionID?: string, payload?: unknown) {
      await log("session.deleted", sessionID, { raw_payload: payload })
      if (!sessionID) return
      for (const [id, job] of jobs) {
        if (job.sessionID !== sessionID) continue
        removeJob(id)
        noopStreak.delete(id)
      }
      if (goals.has(sessionID)) await clearGoal(sessionID, "session_deleted")
      helpers.delete(sessionID)
      await releaseBusy(sessionID, "session_deleted", {})
      pending.delete(sessionID); noopStreak.delete(sessionID)
      for (const [key, item] of pendingByKey) if (item.sessionID === sessionID) pendingByKey.delete(key)
      await log("cancel_stop", sessionID, { action: "session_deleted", result: "cleared session timers and pending delivery" })
    },
    async onReconnect(reason = "sse_reconnect") {
      const sessions = [...busy]
      busy.clear(); busySince.clear()
      for (const sessionID of sessions) await log("busy_released", sessionID, { reason, action: "reset_busy_on_reconnect" })
      await log("busy_safety_valve", undefined, { action: "reset_busy_on_reconnect", sessions, reason })
      for (const [sessionID, item] of [...pending]) {
        pending.delete(sessionID)
        const keyed = [...pendingByKey.entries()].filter(([, value]) => value.sessionID === sessionID)
        for (const [key, value] of keyed) {
          pendingByKey.delete(key)
          await deliver(sessionID, value.prompt, value.source, key)
        }
        if (!keyed.length) await deliver(sessionID, item.prompt, item.source)
      }
    },
    async safetyValve() {
      for (const [sessionID, since] of [...busySince]) {
        const elapsed = clock() - since
        if (elapsed < maxBusyMs) {
          let idle = false
          try { idle = options.probeIdle ? await options.probeIdle(sessionID) : false }
          catch (error) {
            await log("error", sessionID, { source: "busy_safety_probe", message: String(error), stack: error instanceof Error ? error.stack : undefined })
            await releaseBusy(sessionID, "probe_error", { busy_ms: elapsed })
            await this.onIdle(sessionID, { source: "safety_valve_probe_error" })
            continue
          }
          if (idle) {
            await releaseBusy(sessionID, "probe_idle", { busy_ms: elapsed })
            await this.onIdle(sessionID, { source: "safety_valve" })
          } else {
            await log("busy_safety_valve", sessionID, { action: "probe_still_busy", busy_ms: elapsed })
          }
          continue
        }
        await releaseBusy(sessionID, "max_busy_timeout", { busy_ms: elapsed, max_busy_ms: maxBusyMs })
        await log("busy_safety_valve", sessionID, { action: "max_busy_timeout", busy_ms: elapsed, max_busy_ms: maxBusyMs })
        await this.onIdle(sessionID, { source: "safety_valve_timeout" })
      }
    },
    listForTest(sessionID: string) { return [...jobs.values()].filter((job) => job.sessionID === sessionID) },
    isBusyForTest(sessionID: string) { return busy.has(sessionID) },
    flushForTest(sessionID: string) { return this.onIdle(sessionID, { type: "session.idle" }) },
    goalForTest(sessionID: string) { return goals.get(sessionID) },
    isGoalEvalInFlightForTest(sessionID: string) { return goals.get(sessionID)?.evalInFlight ?? false },
    isHelperForTest(sessionID: string) { return helpers.has(sessionID) },
    setHelper(sessionID: string, active: boolean) { if (active) helpers.add(sessionID); else helpers.delete(sessionID) },
    async flushGoalsForTest() { for (let i = 0; i < 50 && goalChecks.size > 0; i++) await Promise.all([...goalChecks]) },
  }
}

export function createJsonlLogger(path = process.env.ROSTER_LOG || resolve(process.cwd(), "logs/roster.jsonl")): Log {
  return async (event, sessionID, details = {}) => {
    try {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), event, ...(sessionID ? { session_id: sessionID } : {}), details })}\n`)
    } catch { /* Never let logging break scheduled behavior. */ }
  }
}
