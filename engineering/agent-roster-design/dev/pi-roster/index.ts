import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { applyGoalSet, buildEvaluatorPrompt, buildGoalAck, buildGoalFeedback, capTranscript, formatGoalAchieved, formatGoalElapsed, formatGoalStatus, goalEvalTimeoutFromEnv, goalEvaluatorSystemPrompt, goalMaxChecksFromEnv, goalTranscriptMaxFromEnv, isGoalCapReached, isGoalEvalGiveUp, parseEvaluatorVerdict, parseGoalCommand, shouldApplyEvalResult, shouldSkipGoalCheck, transcriptToText, clampDelay, decideTick, earliestDueMs, findDynamicByTask, findIntervalDuplicate, findLoopById, formatLoopList, isCapReached, isPendingExpired, maxLoopsFromEnv, nextLoopId, parseInterval, parseLoopCommand, pendingMaxMsFromEnv, replaceTimer, resolveDynamicTarget, shouldClearOnIdle, statusText, tickMessage, userMessageText, shouldLogGoalScheduleCall } from "./logic";
import type { GoalState, LoopMode, LoopSummary } from "./logic";

export default function (pi: ExtensionAPI) {
  const logPath = process.env.ROSTER_LOG || join(homedir(), ".pi", "agent", "logs", "roster.jsonl");
  const log = (event: string, details: Record<string, unknown> = {}, ctx?: any) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), event, session_id: ctx?.sessionManager?.getSessionId?.(), details }) + "\n");
    } catch { /* Logging must never affect loop behavior. */ }
  };
  interface LoopState {
    id: string;
    kind: LoopMode;
    task: string;
    intervalMs?: number;
    lastDelayMs: number;
    due: number;
    noopStreak: number;
    pending: boolean;
    pendingText?: string;
    pendingSince?: number;
    timer?: ReturnType<typeof setTimeout>;
  }
  const loops = new Map<string, LoopState>();
  let seq = 1;
  let lastDynamicId: string | undefined;
  let goal: GoalState | undefined;
  let goalGeneration = 0;
  let goalEvaluating = false;
  let goalAbort: AbortController | undefined;
  const goalMaxChecks = (): number => goalMaxChecksFromEnv(process.env.ROSTER_GOAL_MAX_CHECKS);
  const goalEvalTimeoutMs = (): number => goalEvalTimeoutFromEnv(process.env.ROSTER_GOAL_EVAL_TIMEOUT_MS);
  const goalTranscriptMax = (): number => goalTranscriptMaxFromEnv(process.env.ROSTER_GOAL_TRANSCRIPT_MAX_CHARS);
  const abortGoalEval = (): void => {
    if (goalAbort) {
      try { goalAbort.abort(); } catch { /* ignore */ }
      goalAbort = undefined;
    }
  };
  const refreshGoalStatus = (ctx: any): void => {
    try {
      if (!goal) { ctx?.ui.setStatus("goal", undefined); return; }
      ctx?.ui.setStatus("goal", `◎ /goal active (${formatGoalElapsed(goal.setAtMs, Date.now())})`);
    } catch { /* Footer ticks must never break the session. */ }
  };
  let goalTimer: ReturnType<typeof setInterval> | undefined;
  let goalTimerCtx: any = undefined;
  const stopGoalTimer = (): void => {
    if (goalTimer !== undefined) clearInterval(goalTimer);
    goalTimer = undefined;
    goalTimerCtx = undefined;
  };
  const startGoalTimer = (ctx: any): void => {
    stopGoalTimer();
    goalTimerCtx = ctx;
    goalTimer = setInterval(() => {
      try {
        if (goal) refreshGoalStatus(goalTimerCtx);
      } catch { /* Footer ticks must never break the session. */ }
    }, 1000);
    try { (goalTimer as unknown as { unref?: () => unknown }).unref?.(); } catch { /* ignore */ }
  };
  const maxLoops = (): number => maxLoopsFromEnv(process.env.ROSTER_MAX_JOBS);
  const pendingMaxForLoop = (loop: LoopState): number =>
    pendingMaxMsFromEnv(loop.lastDelayMs, process.env.ROSTER_PENDING_MAX_MS);
  const clearLoopPending = (loop: LoopState): void => {
    loop.pending = false;
    loop.pendingText = undefined;
    loop.pendingSince = undefined;
  };
  const clearLoopTimer = (loop: LoopState): void => {
    if (loop.timer) clearTimeout(loop.timer);
    loop.timer = undefined;
  };
  const summaries = (): LoopSummary[] =>
    [...loops.values()].map((loop) => ({
      id: loop.id,
      kind: loop.kind,
      task: loop.task,
      intervalMs: loop.intervalMs,
      dueMs: loop.due,
      noopStreak: loop.noopStreak,
      pending: loop.pending,
    }));
  const refreshStatus = (ctx: any): void => {
    if (loops.size === 0) { ctx?.ui.setStatus("pi-roster", undefined); return; }
    const earliest = earliestDueMs(summaries());
    ctx?.ui.setStatus("pi-roster", statusText(loops.size, earliest));
  };
  const cancelOne = (id: string, ctx?: any, reason = "stop"): boolean => {
    const loop = loops.get(id);
    if (!loop) return false;
    clearLoopTimer(loop);
    loops.delete(id);
    if (lastDynamicId === id) lastDynamicId = undefined;
    log("cancel_stop", { reason, id, job: loop.kind }, ctx);
    refreshStatus(ctx);
    return true;
  };
  const cancelAll = (ctx?: any, reason = "stop"): string[] => {
    const ids = [...loops.keys()];
    for (const id of ids) {
      const loop = loops.get(id);
      if (!loop) continue;
      clearLoopTimer(loop);
      loops.delete(id);
      log("cancel_stop", { reason, id, job: loop.kind }, ctx);
    }
    lastDynamicId = undefined;
    refreshStatus(ctx);
    return ids;
  };
  const cancelDynamics = (ctx?: any, reason = "stop"): string[] => {
    const ids = [...loops.values()].filter((loop) => loop.kind === "dynamic").map((loop) => loop.id);
    for (const id of ids) {
      const loop = loops.get(id);
      if (!loop) continue;
      clearLoopTimer(loop);
      loops.delete(id);
      log("cancel_stop", { reason, id, job: loop.kind }, ctx);
    }
    if (lastDynamicId !== undefined && !loops.has(lastDynamicId)) lastDynamicId = undefined;
    refreshStatus(ctx);
    return ids;
  };
  const scheduleLoop = (loop: LoopState, delay: number, ctx: any, source: "command" | "Schedule") => {
    clearLoopTimer(loop);
    loop.lastDelayMs = delay;
    loop.due = Date.now() + delay;
    const id = loop.id;
    const fireMode: LoopMode = loop.kind;
    log("timer_scheduled", { delay_ms: delay, due: new Date(loop.due).toISOString(), source, job: fireMode, id }, ctx);
    loop.timer = replaceTimer(loop.timer, clearTimeout, () => setTimeout(() => {
      const current = loops.get(id);
      if (!current) return;
      log("timer_fired", { source, job: fireMode, id }, ctx);
      const now = Date.now();
      if (current.pending && isPendingExpired(current.pendingSince, now, pendingMaxForLoop(current))) {
        const ageMs = current.pendingSince === undefined ? undefined : now - current.pendingSince;
        clearLoopPending(current);
        log("tick_pending_expired", { job: fireMode, id, age_ms: ageMs, max_ms: pendingMaxForLoop(current) }, ctx);
      }
      const text = tickMessage(fireMode, current.task);
      const busy = Boolean(ctx?.isIdle && !ctx.isIdle());
      const decision = decideTick({ busy, pending: current.pending });
      if (!decision.inject) {
        log("timer_skipped", { reason: "previous_prompt_pending", job: fireMode, id, source }, ctx);
        if (fireMode === "interval") scheduleLoop(current, delay, ctx, source);
        else { current.timer = undefined; refreshStatus(ctx); }
        return;
      }
      try {
        pi.sendUserMessage(text, { deliverAs: "followUp" });
        current.pending = decision.pending;
        current.pendingText = text;
        current.pendingSince = Date.now();
        log("message_injected", { deliverAs: "followUp", busy, job: fireMode, id }, ctx);
      } catch (error) { log("error", { stack: error instanceof Error ? error.stack : String(error) }, ctx); }
      if (fireMode === "interval") scheduleLoop(current, delay, ctx, source);
      else { current.timer = undefined; refreshStatus(ctx); }
    }, delay));
    refreshStatus(ctx);
  };

  log("extension_loaded");
  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType !== "user") return;
    for (const loop of loops.values()) {
      if (loop.pending && loop.pendingText !== undefined && event.prompt === loop.pendingText) {
        clearLoopPending(loop);
        log("tick_consumed", { job: loop.kind, id: loop.id, event: "before_agent_start" }, ctx);
      }
    }
  });
  pi.on("message_start", (event, ctx) => {
    // Queued followUp ticks run inside the same agent loop, so no new
    // before_agent_start fires for them. message_start fires per message
    // (agent-session removes the queued text before emitting) and carries
    // the user message, so it is the hook that observes queued ticks.
    const text = userMessageText(event.message as { role: string; content: unknown });
    if (text === undefined) return;
    for (const loop of loops.values()) {
      if (loop.pending && loop.pendingText !== undefined && text === loop.pendingText) {
        clearLoopPending(loop);
        log("tick_consumed", { job: loop.kind, id: loop.id, event: "message_start" }, ctx);
      }
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    // Idle safety valve: a pending flag left set with nothing queued would
    // otherwise skip every future tick. Queued work keeps the flag.
    let idle = true;
    try {
      idle = typeof ctx?.hasPendingMessages !== "function" || !ctx.hasPendingMessages();
    } catch { idle = false; }
    if (!idle) return;
    for (const loop of loops.values()) {
      if (shouldClearOnIdle(loop.pending, false)) {
        clearLoopPending(loop);
        log("tick_consumed", { job: loop.kind, id: loop.id, event: "agent_end" }, ctx);
      }
    }
  });
  pi.on("agent_end", async (_event, ctx) => {
    // Session Stop hook: evaluate the active goal after every agent turn.
    // Every branch logs (goal_eval_skip / goal_skipped_background /
    // goal_eval_stale / goal_eval_start / goal_check / goal_eval_failed /
    // goal_achieved) so a silent skip is impossible.
    if (!goal) { log("goal_eval_skip", { reason: "no_goal" }, ctx); return; }
    if (goalEvaluating) {
      log("goal_eval_skip", { reason: "already_evaluating", condition: goal.condition }, ctx);
      refreshGoalStatus(ctx);
      return;
    }
    refreshGoalStatus(ctx);
    goalTimerCtx = ctx;
    let queued = false;
    try {
      queued = typeof ctx?.hasPendingMessages === "function" ? ctx.hasPendingMessages() : false;
    } catch { queued = false; }
    if (shouldSkipGoalCheck(queued)) {
      log("goal_skipped_background", { condition: goal.condition }, ctx);
      return;
    }
    let model: any;
    try {
      model = ctx?.model;
    } catch (error) {
      log("goal_eval_failed", { reason: "ctx_stale", detail: error instanceof Error ? error.message : String(error), condition: goal.condition }, ctx);
      return;
    }
    if (!model) {
      log("goal_eval_failed", { reason: "no_model", condition: goal.condition }, ctx);
      return;
    }
    const generation = goalGeneration;
    const condition = goal.condition;
    log("goal_eval_start", { condition, generation }, ctx);
    goalEvaluating = true;
    const abort = new AbortController();
    goalAbort = abort;
    const timer = setTimeout(() => abort.abort(), goalEvalTimeoutMs());
    try { ctx?.ui.setWorkingMessage("running Stop hook"); } catch { /* ignore */ }
    const started = Date.now();
    const clearActiveGoal = (event: string, details: Record<string, unknown>, notice: string, noticeType: "info" | "error"): void => {
      goal = undefined;
      goalGeneration++;
      abortGoalEval();
      stopGoalTimer();
      refreshGoalStatus(ctx);
      log(event, details, ctx);
      try { ctx?.ui.notify(notice, noticeType); } catch { /* ignore */ }
    };
    try {
      const branch = ctx.sessionManager.getBranch();
      const transcript = capTranscript(transcriptToText(branch), goalTranscriptMax());
      const response = await ctx.modelRegistry.complete(
        model,
        {
          systemPrompt: goalEvaluatorSystemPrompt(),
          messages: [{
            role: "user",
            content: [{ type: "text", text: buildEvaluatorPrompt(condition, transcript) }],
            timestamp: Date.now(),
          }],
        },
        { signal: abort.signal },
      );
      const text = Array.isArray(response?.content)
        ? response.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n")
        : "";
      const usage = (response as { usage?: { totalTokens?: unknown } } | undefined)?.usage;
      const tokens = typeof usage?.totalTokens === "number" ? usage.totalTokens : 0;
      const durationMs = Date.now() - started;
      if (!shouldApplyEvalResult({ goalActive: goal !== undefined, evalGeneration: generation, currentGeneration: goalGeneration, evalCondition: condition, currentCondition: goal?.condition })) {
        log("goal_eval_stale", { reason: "generation_or_condition_changed", condition, eval_generation: generation }, ctx);
        return;
      }
      const active = goal;
      if (!active) { log("goal_eval_stale", { reason: "goal_gone", condition, eval_generation: generation }, ctx); return; }
      const verdict = parseEvaluatorVerdict(text);
      if (!verdict) {
        active.evalFailures++;
        log("goal_eval_failed", { reason: "unparseable_verdict", condition, duration_ms: durationMs, eval_failures: active.evalFailures }, ctx);
        if (isGoalEvalGiveUp(active.evalFailures)) {
          clearActiveGoal("goal_cleared", { condition, reason: "eval_failed_giveup" }, `Goal cleared after ${active.evalFailures} failed evaluations: ${condition}`, "error");
        }
        return;
      }
      active.evalFailures = 0;
      active.tokens += tokens;
      active.checks++;
      active.lastReason = verdict.reason;
      if (!verdict.met) {
        log("goal_check", { met: false, condition, reason: verdict.reason, duration_ms: durationMs }, ctx);
        if (isGoalCapReached(active.checks, goalMaxChecks())) {
          clearActiveGoal("goal_cap_reached", { condition, checks: active.checks, max_checks: goalMaxChecks() }, `Goal stopped after ${active.checks} checks without success: ${condition}`, "error");
          return;
        }
        refreshGoalStatus(ctx);
        try { ctx?.ui.notify("◯ Goal not yet met… continuing", "info"); } catch { /* ignore */ }
        try {
          pi.sendUserMessage(buildGoalFeedback(condition, verdict.reason), { deliverAs: "followUp" });
          log("goal_continue", { condition, checks: active.checks }, ctx);
        } catch (error) { log("error", { stack: error instanceof Error ? error.stack : String(error) }, ctx); }
        return;
      }
      log("goal_check", { met: true, condition, reason: verdict.reason, duration_ms: durationMs, iterations: active.checks, tokens: active.tokens }, ctx);
      const achieved = formatGoalAchieved(active, Date.now());
      clearActiveGoal("goal_achieved", { condition, iterations: active.checks, duration_ms: durationMs, tokens: active.tokens }, achieved, "info");
    } catch (error) {
      const durationMs = Date.now() - started;
      if (!shouldApplyEvalResult({ goalActive: goal !== undefined, evalGeneration: generation, currentGeneration: goalGeneration, evalCondition: condition, currentCondition: goal?.condition })) {
        log("goal_eval_stale", { reason: "generation_or_condition_changed", condition, eval_generation: generation }, ctx);
        return;
      }
      if (!goal) { log("goal_eval_stale", { reason: "goal_gone", condition, eval_generation: generation }, ctx); return; }
      goal.evalFailures++;
      log("goal_eval_failed", { reason: error instanceof Error ? error.message : String(error), condition, duration_ms: durationMs, eval_failures: goal.evalFailures }, ctx);
      if (isGoalEvalGiveUp(goal.evalFailures)) {
        clearActiveGoal("goal_cleared", { condition, reason: "eval_failed_giveup" }, `Goal cleared after ${goal.evalFailures} failed evaluations: ${condition}`, "error");
      }
    } finally {
      clearTimeout(timer);
      try { ctx?.ui.setWorkingMessage(); } catch { /* ignore */ }
      if (goalAbort === abort) goalAbort = undefined;
      goalEvaluating = false;
    }
  });
  pi.registerCommand("goal", {
    description: "Set a session completion condition checked by a Stop hook evaluator",
    handler: async (args, ctx) => {
      try {
        const command = parseGoalCommand(args);
        log("command_received", { raw_args: args, parsed_action: `goal_${command.action}` }, ctx);
        if (command.action === "status") {
          refreshGoalStatus(ctx);
          ctx.ui.notify(formatGoalStatus(goal, Date.now()), "info");
          return;
        }
        if (command.action === "clear") {
          if (!goal) { ctx.ui.notify("No goal set.", "info"); return; }
          const condition = goal.condition;
          goal = undefined;
          goalGeneration++;
          abortGoalEval();
          stopGoalTimer();
          refreshGoalStatus(ctx);
          log("goal_cleared", { condition, reason: "user /goal clear" }, ctx);
          ctx.ui.notify(`Goal cleared: ${condition}`, "info");
          return;
        }
        goalGeneration++;
        abortGoalEval();
        goal = applyGoalSet(command.condition, Date.now());
        log("goal_set", { condition: command.condition }, ctx);
        refreshGoalStatus(ctx);
        startGoalTimer(ctx);
        ctx.ui.notify(`Goal set: ${command.condition}`, "info");
        pi.sendUserMessage(buildGoalAck(command.condition), { deliverAs: "followUp" });
      } catch (error) { log("error", { stack: error instanceof Error ? error.stack : String(error) }, ctx); }
    },
  });
  pi.registerCommand("loop", {
    description: "Run recurring or dynamic prompt loops",
    handler: async (args, ctx) => {
      try {
        const input = args.trim();
        const command = parseLoopCommand(input);
        const parsed = command.action === "create" ? parseInterval(command.text) : null;
        log("command_received", { raw_args: args, parsed_action: command.action, parsed_mode: parsed ? "interval" : command.action === "create" ? "dynamic" : command.action, interval_ms: parsed?.milliseconds, prompt: parsed?.prompt ?? input }, ctx);
        if (command.action === "list") {
          refreshStatus(ctx);
          ctx.ui.notify(formatLoopList(summaries()), "info");
          return;
        }
        if (command.action === "stopAll") {
          if (loops.size === 0) { refreshStatus(ctx); ctx.ui.notify("No loops scheduled.", "info"); return; }
          cancelAll(ctx, "user /loop stop");
          ctx.ui.notify("All loops stopped.", "info");
          return;
        }
        if (command.action === "stopOne") {
          const target = loops.get(command.id);
          if (!target) { ctx.ui.notify(`No loop ${command.id}.`, "info"); return; }
          cancelOne(command.id, ctx, "user /loop stop <id>");
          ctx.ui.notify(`Loop ${command.id} stopped.`, "info");
          return;
        }
        if (parsed) {
          const duplicate = findIntervalDuplicate(summaries(), parsed.milliseconds, parsed.prompt);
          if (duplicate) {
            log("schedule_duplicate", { id: duplicate.id, interval_ms: parsed.milliseconds, task: parsed.prompt }, ctx);
            ctx.ui.notify(`Already running as ${duplicate.id}.`, "info");
            return;
          }
          if (isCapReached(loops.size, maxLoops())) {
            log("schedule_cap_reached", { max_loops: maxLoops(), requested: `interval ${parsed.prompt}` }, ctx);
            ctx.ui.notify(`Loop cap reached (${maxLoops()} loops). Stop one first.`, "error");
            return;
          }
          const id = nextLoopId(seq++);
          const loop: LoopState = { id, kind: "interval", task: parsed.prompt, intervalMs: parsed.milliseconds, lastDelayMs: parsed.milliseconds, due: Date.now() + parsed.milliseconds, noopStreak: 0, pending: false };
          loops.set(id, loop);
          log("first_iteration_sent", { mode: "interval", id, text: parsed.prompt }, ctx);
          pi.sendUserMessage(parsed.prompt, { deliverAs: "followUp" });
          loop.pending = true;
          loop.pendingText = parsed.prompt;
          loop.pendingSince = Date.now();
          scheduleLoop(loop, parsed.milliseconds, ctx, "command");
          ctx.ui.notify(`Loop started: ${id} interval ${parsed.prompt}`, "info");
          return;
        }
        const task = command.text;
        const existing = findDynamicByTask(summaries(), task);
        if (existing) {
          log("schedule_duplicate", { id: existing.id, task }, ctx);
          ctx.ui.notify(`Already running as ${existing.id}.`, "info");
          return;
        }
        if (isCapReached(loops.size, maxLoops())) {
          log("schedule_cap_reached", { max_loops: maxLoops(), requested: `dynamic ${task}` }, ctx);
          ctx.ui.notify(`Loop cap reached (${maxLoops()} loops). Stop one first.`, "error");
          return;
        }
        const id = nextLoopId(seq++);
        const loop: LoopState = { id, kind: "dynamic", task, lastDelayMs: 1200000, due: Date.now() + 1200000, noopStreak: 0, pending: false };
        loops.set(id, loop);
        lastDynamicId = id;
        const text = tickMessage("dynamic", task);
        log("first_iteration_sent", { mode: "dynamic", id, text }, ctx);
        pi.sendUserMessage(text, { deliverAs: "followUp" });
        loop.pending = true;
        loop.pendingText = text;
        loop.pendingSince = Date.now();
        scheduleLoop(loop, 1200000, ctx, "command");
        ctx.ui.notify(`Loop started: ${id} dynamic ${task}`, "info");
      } catch (error) { log("error", { stack: error instanceof Error ? error.stack : String(error) }, ctx); }
    },
  });
  pi.registerTool({
    name: "Schedule", label: "Schedule wakeup",
    description: "Schedule the next dynamic loop tick, report noop status, or stop dynamic loops. Calls are keyed by prompt: same prompt replaces that loop's wakeup, a different prompt is a different loop.",
    parameters: { type: "object", properties: { delaySeconds: { type: "number" }, prompt: { type: "string" }, reason: { type: "string" }, noop: { type: "boolean" }, stop: { type: "boolean" } }, required: [] },
    async execute(_id, params: any, _signal, _onUpdate, ctx) {
      try {
        const rawPrompt = typeof params.prompt === "string" && params.prompt.trim() !== "" ? params.prompt.trim() : undefined;
        if (shouldLogGoalScheduleCall({ goalActive: goal !== undefined, prompt: rawPrompt, loops: summaries() })) {
          log("goal_schedule_call", { prompt: rawPrompt, condition: goal?.condition }, ctx);
        }
        if (params.stop) {
          if (rawPrompt !== undefined) {
            const resolved = findDynamicByTask(summaries(), rawPrompt);
            if (!resolved) return { content: [{ type: "text", text: "No dynamic loop for that prompt." }], details: { stopped: false } };
            cancelOne(resolved.id, ctx, "Schedule stop=true prompt");
            return { content: [{ type: "text", text: `Loop ${resolved.id} stopped.` }], details: { stopped: true, id: resolved.id } };
          }
          const stoppedIds = cancelDynamics(ctx, "Schedule stop=true");
          if (stoppedIds.length === 0) return { content: [{ type: "text", text: "No dynamic loops scheduled." }], details: { stopped: false } };
          return { content: [{ type: "text", text: `Stopped ${stoppedIds.length} dynamic loop(s): ${stoppedIds.join(", ")}.` }], details: { stopped: true, ids: stoppedIds } };
        }
        const delay = clampDelay(params.delaySeconds ?? 1500);
        if (rawPrompt !== undefined) {
          const existing = findDynamicByTask(summaries(), rawPrompt);
          if (existing) {
            const loop = loops.get(existing.id);
            if (!loop) throw new Error(`Loop ${existing.id} missing.`);
            loop.noopStreak = params.noop ? loop.noopStreak + 1 : 0;
            lastDynamicId = loop.id;
            log("tool_call_Schedule", { params, clamped_delay_seconds: delay, noop_streak: loop.noopStreak, id: loop.id }, ctx);
            scheduleLoop(loop, delay * 1000, ctx, "Schedule");
            return { content: [{ type: "text", text: `Wakeup in ${delay}s for ${loop.id}. ${params.reason ?? ""}` }], details: { delay_seconds: delay, noop_streak: loop.noopStreak, id: loop.id } };
          }
          if (isCapReached(loops.size, maxLoops())) {
            log("schedule_cap_reached", { max_loops: maxLoops(), requested: `dynamic ${rawPrompt}` }, ctx);
            return { content: [{ type: "text", text: `Loop cap reached (${maxLoops()} loops). Stop one first.` }], details: { error: "cap_reached" } };
          }
          const id = nextLoopId(seq++);
          const loop: LoopState = { id, kind: "dynamic", task: rawPrompt, lastDelayMs: delay * 1000, due: Date.now() + delay * 1000, noopStreak: params.noop ? 1 : 0, pending: false };
          loops.set(id, loop);
          lastDynamicId = id;
          log("tool_call_Schedule", { params, clamped_delay_seconds: delay, noop_streak: loop.noopStreak, id }, ctx);
          scheduleLoop(loop, delay * 1000, ctx, "Schedule");
          return { content: [{ type: "text", text: `Wakeup in ${delay}s for ${id}. ${params.reason ?? ""}` }], details: { delay_seconds: delay, noop_streak: loop.noopStreak, id } };
        }
        const fallback = resolveDynamicTarget(summaries(), undefined) ?? (lastDynamicId !== undefined ? findLoopById(summaries(), lastDynamicId) : undefined);
        if (!fallback || fallback.kind !== "dynamic") return { content: [{ type: "text", text: "No dynamic loop; provide prompt or start one with /loop <task>." }], details: { error: "no_dynamic_loop" } };
        const loop = loops.get(fallback.id);
        if (!loop) throw new Error(`Loop ${fallback.id} missing.`);
        loop.noopStreak = params.noop ? loop.noopStreak + 1 : 0;
        lastDynamicId = loop.id;
        log("tool_call_Schedule", { params, clamped_delay_seconds: delay, noop_streak: loop.noopStreak, id: loop.id }, ctx);
        scheduleLoop(loop, delay * 1000, ctx, "Schedule");
        return { content: [{ type: "text", text: `Wakeup in ${delay}s for ${loop.id}. ${params.reason ?? ""}` }], details: { delay_seconds: delay, noop_streak: loop.noopStreak, id: loop.id } };
      } catch (error) { log("error", { stack: error instanceof Error ? error.stack : String(error) }, ctx); throw error; }
    },
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    log("session_shutdown", {}, ctx);
    for (const loop of loops.values()) clearLoopTimer(loop);
    loops.clear();
    lastDynamicId = undefined;
    refreshStatus(ctx);
    if (goal) log("goal_cleared", { condition: goal.condition, reason: "session_shutdown" }, ctx);
    goal = undefined;
    goalGeneration++;
    abortGoalEval();
    stopGoalTimer();
    refreshGoalStatus(ctx);
  });
}
