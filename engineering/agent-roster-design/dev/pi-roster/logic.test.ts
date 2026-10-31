import { strict as assert } from "node:assert";
import { parseInterval, clampDelay, replaceTimer, tickMessage, decideTick, consumeTick, clearTickFlags, emptyTickFlags, userMessageText, pendingMaxMs, pendingMaxMsFromEnv, isPendingExpired, shouldClearOnIdle, maxLoopsFromEnv, nextLoopId, shortenTask, findIntervalDuplicate, findDynamicByTask, findLoopById, isCapReached, earliestDueMs, statusText, formatLoopList, parseLoopCommand, resolveDynamicTarget, parseGoalCommand, goalMaxChecksFromEnv, goalEvalTimeoutFromEnv, goalRetryMsFromEnv, goalTranscriptMaxFromEnv, isGoalCapReached, isGoalEvalGiveUp, shouldScheduleGoalRetry, shouldSkipGoalCheck, shouldApplyEvalResult, applyGoalSet, buildGoalAck, buildGoalFeedback, goalEvaluatorSystemPrompt, buildEvaluatorPrompt, capTranscript, transcriptToText, parseEvaluatorVerdict, formatGoalElapsed, formatGoalTokens, formatGoalStatus, formatGoalAchieved, goalElapsedMs, shouldLogGoalScheduleCall, GOAL_MAX_EVAL_FAILURES } from "./logic.ts";
import type { LoopSummary } from "./logic.ts";
assert.deepEqual(parseInterval("30s hello"), { milliseconds: 30000, prompt: "hello" });
assert.deepEqual(parseInterval("5m /check now"), { milliseconds: 300000, prompt: "/check now" });
assert.deepEqual(parseInterval("2h x"), { milliseconds: 7200000, prompt: "x" });
assert.equal(parseInterval("bad"), null);
assert.equal(clampDelay(0), 1);
assert.equal(clampDelay(5), 5);
assert.equal(clampDelay(99), 99);
assert.equal(clampDelay(9999), 3600);
assert.equal(tickMessage("interval", "run: date"), "run: date");
assert.match(tickMessage("dynamic", "check"), /call Schedule.*\/loop check/);
const cleared: number[] = [];
assert.equal(replaceTimer(1, value => cleared.push(value), () => 2), 2);
assert.deepEqual(cleared, [1]);
assert.deepEqual(decideTick({ busy: false, pending: false }), { inject: true, pending: true });
assert.deepEqual(decideTick({ busy: true, pending: false }), { inject: true, pending: true });
assert.deepEqual(decideTick({ busy: true, pending: true }), { inject: false, pending: true });
assert.deepEqual(decideTick({ busy: false, pending: true }), { inject: false, pending: true });
assert.deepEqual(consumeTick({ interval: true, dynamic: true }, "interval"), { interval: false, dynamic: true });
assert.deepEqual(consumeTick({ interval: true, dynamic: true }, "dynamic"), { interval: true, dynamic: false });
assert.deepEqual(clearTickFlags(), { interval: false, dynamic: false });
assert.deepEqual(emptyTickFlags(), { interval: false, dynamic: false });
assert.equal(userMessageText({ role: "user", content: "run: date" }), "run: date");
assert.equal(userMessageText({ role: "user", content: [{ type: "text", text: "a" }, { type: "image", data: "x", mimeType: "image/png" }, { type: "text", text: "b" }] }), "a\nb");
assert.equal(userMessageText({ role: "assistant", content: "run: date" }), undefined);
assert.equal(pendingMaxMs(5000), 60000);
assert.equal(pendingMaxMs(60000), 180000);
assert.equal(pendingMaxMs(60000, 10000), 10000);
assert.equal(pendingMaxMsFromEnv(5000, undefined), 60000);
assert.equal(pendingMaxMsFromEnv(60000, "10000"), 10000);
assert.equal(pendingMaxMsFromEnv(60000, "bogus"), 180000);
assert.equal(isPendingExpired(0, 59999, 60000), false);
assert.equal(isPendingExpired(0, 60000, 60000), true);
assert.equal(isPendingExpired(0, 180000, 180000), true);
assert.equal(isPendingExpired(undefined, 999999, 60000), false);
assert.equal(shouldClearOnIdle(true, false), true);
assert.equal(shouldClearOnIdle(true, true), false);
assert.equal(shouldClearOnIdle(false, false), false);
assert.deepEqual(decideTick({ busy: true, pending: true }), { inject: false, pending: true });
assert.equal(isPendingExpired(Date.now() - 1000, Date.now(), pendingMaxMs(5000)), false);
// Rule 1: interval loops have sequential ids; duplicates share interval + task.
assert.equal(nextLoopId(1), "loop-1");
assert.equal(nextLoopId(2), "loop-2");
const intervals: LoopSummary[] = [
  { id: "loop-1", kind: "interval", task: "check a", intervalMs: 30000, dueMs: 1000, noopStreak: 0, pending: false },
  { id: "loop-2", kind: "interval", task: "check b", intervalMs: 60000, dueMs: 2000, noopStreak: 0, pending: false },
];
assert.equal(findIntervalDuplicate(intervals, 30000, "check a")?.id, "loop-1");
assert.equal(findIntervalDuplicate(intervals, 30000, "check b"), undefined);
assert.equal(findIntervalDuplicate(intervals, 60000, "check a"), undefined);
assert.equal(findIntervalDuplicate(intervals, 60000, "check b")?.id, "loop-2");
// Rule 2: dynamic loops are keyed by task text.
const dynamics: LoopSummary[] = [
  { id: "loop-1", kind: "dynamic", task: "watch alpha", dueMs: 1000, noopStreak: 1, pending: true },
  { id: "loop-2", kind: "dynamic", task: "watch beta", dueMs: 2000, noopStreak: 0, pending: false },
];
assert.equal(findDynamicByTask(dynamics, "watch alpha")?.id, "loop-1");
assert.equal(findDynamicByTask(dynamics, "watch beta")?.id, "loop-2");
assert.equal(findDynamicByTask(dynamics, "watch gamma"), undefined);
assert.equal(resolveDynamicTarget(dynamics, "watch alpha")?.id, "loop-1");
assert.equal(resolveDynamicTarget(dynamics, "watch beta")?.id, "loop-2");
assert.equal(resolveDynamicTarget(dynamics, "watch gamma"), undefined);
// Schedule without prompt targets the most recent dynamic loop.
assert.equal(resolveDynamicTarget(dynamics, undefined)?.id, "loop-2");
assert.equal(resolveDynamicTarget([], undefined), undefined);
// Same-prompt Schedule replaces only that loop's wakeup.
const replaced = dynamics.map((loop) => loop.id === "loop-1" ? { ...loop, dueMs: 9999 } : loop);
assert.equal(replaced[0]?.dueMs, 9999);
assert.equal(replaced[1]?.dueMs, 2000);
// Schedule stop with prompt removes one loop; stop without prompt removes all dynamics.
const mixed: LoopSummary[] = [
  { id: "loop-9", kind: "interval", task: "poll", intervalMs: 5000, dueMs: 1000, noopStreak: 0, pending: false },
  ...dynamics,
];
const stopOne = mixed.filter((loop) => loop.id !== "loop-1");
assert.equal(stopOne.length, 2);
assert.ok(stopOne.some((loop) => loop.id === "loop-2"));
assert.ok(stopOne.some((loop) => loop.id === "loop-9"));
const stopAllDynamics = mixed.filter((loop) => loop.kind !== "dynamic");
assert.deepEqual(stopAllDynamics.map((loop) => loop.id), ["loop-9"]);
// Rule 3: list/stop parsing and list output.
assert.deepEqual(parseLoopCommand(""), { action: "list" });
assert.deepEqual(parseLoopCommand("list"), { action: "list" });
assert.deepEqual(parseLoopCommand("stop"), { action: "stopAll" });
assert.deepEqual(parseLoopCommand("stop loop-2"), { action: "stopOne", id: "loop-2" });
assert.deepEqual(parseLoopCommand("30s hello"), { action: "create", text: "30s hello" });
assert.deepEqual(parseLoopCommand("watch alpha"), { action: "create", text: "watch alpha" });
assert.equal(findLoopById(mixed, "loop-2")?.task, "watch beta");
assert.equal(findLoopById(mixed, "loop-9")?.task, "poll");
assert.equal(findLoopById(mixed, "loop-99"), undefined);
const listed = formatLoopList(mixed);
assert.match(listed, /loop-9 interval/);
assert.match(listed, /every=5000ms/);
assert.match(listed, /loop-1 dynamic/);
assert.match(listed, /loop-2 dynamic/);
assert.match(listed, /task="watch beta"/);
assert.match(listed, /noop=0/);
assert.match(listed, /pending=(yes|no)/);
assert.match(listed, /next=1970-01-01T00:00:0/);
assert.equal(formatLoopList([]), "No loops scheduled.");
assert.ok(shortenTask("x".repeat(61)).length <= 60);
assert.equal(shortenTask("short"), "short");
// Rule 4: one pending tick per loop; loops never block each other.
const pendingA = decideTick({ busy: true, pending: true });
const pendingB = decideTick({ busy: true, pending: false });
assert.equal(pendingA.inject, false);
assert.equal(pendingB.inject, true);
assert.equal(isPendingExpired(0, 59999, 60000), false);
assert.equal(isPendingExpired(0, 60000, 60000), true);
assert.equal(shouldClearOnIdle(true, false), true);
// Rule 5: cap defaults to 10 and honours ROSTER_MAX_JOBS.
assert.equal(maxLoopsFromEnv(undefined), 10);
assert.equal(maxLoopsFromEnv("3"), 3);
assert.equal(maxLoopsFromEnv("bogus"), 10);
assert.equal(maxLoopsFromEnv("0"), 10);
assert.equal(isCapReached(9, 10), false);
assert.equal(isCapReached(10, 10), true);
assert.equal(isCapReached(3, 3), true);
// Rule 6: status shows the count and the earliest next fire.
assert.equal(earliestDueMs([{ dueMs: 3000 }, { dueMs: 1000 }, { dueMs: 2000 }]), 1000);
assert.equal(earliestDueMs([]), undefined);
assert.match(statusText(0, undefined), /No loops scheduled/);
assert.match(statusText(2, 1000), /2 loops/);
assert.match(statusText(2, 1000), /1970-01-01T00:00:01/);
assert.match(statusText(1, 2000), /1 loop/);
// Rule 7: tick prompts never start with /loop.
assert.equal(tickMessage("dynamic", "check").startsWith("/loop"), false);
assert.equal(tickMessage("interval", "run: date").startsWith("/loop"), false);
assert.match(tickMessage("dynamic", "check"), /\/loop check/);
// Goal: command parsing (/goal, /goal clear, /goal <text>).
assert.deepEqual(parseGoalCommand(""), { action: "status" });
assert.deepEqual(parseGoalCommand("   "), { action: "status" });
assert.deepEqual(parseGoalCommand("clear"), { action: "clear" });
assert.deepEqual(parseGoalCommand("  clear  "), { action: "clear" });
assert.deepEqual(parseGoalCommand("tests pass"), { action: "set", condition: "tests pass" });
assert.deepEqual(parseGoalCommand("  tests pass  "), { action: "set", condition: "tests pass" });
// Goal: verdict parsing (valid, fenced, garbage).
assert.deepEqual(parseEvaluatorVerdict('{"met": true, "reason": "done per transcript"}'), { met: true, reason: "done per transcript" });
assert.deepEqual(parseEvaluatorVerdict('{"met": false, "reason": "still working"}'), { met: false, reason: "still working" });
assert.deepEqual(parseEvaluatorVerdict('```json\n{"met": true, "reason": "cited"}\n```'), { met: true, reason: "cited" });
assert.deepEqual(parseEvaluatorVerdict('```\n{"met": false, "reason": "cited"}\n```'), { met: false, reason: "cited" });
assert.deepEqual(parseEvaluatorVerdict('Some prose {"met": true, "reason": "found it"} trailing'), { met: true, reason: "found it" });
assert.equal(parseEvaluatorVerdict("garbage with no json"), null);
assert.equal(parseEvaluatorVerdict('{"met": "yes", "reason": "wrong type"}'), null);
assert.equal(parseEvaluatorVerdict(""), null);
assert.equal(parseEvaluatorVerdict("[]"), null);
// Goal: cap (default 30, env override, boundary).
assert.equal(goalMaxChecksFromEnv(undefined), 30);
assert.equal(goalMaxChecksFromEnv("5"), 5);
assert.equal(goalMaxChecksFromEnv("bogus"), 30);
assert.equal(goalMaxChecksFromEnv("0"), 30);
assert.equal(isGoalCapReached(29, 30), false);
assert.equal(isGoalCapReached(30, 30), true);
assert.equal(isGoalCapReached(4, 5), false);
assert.equal(isGoalCapReached(5, 5), true);
assert.equal(goalEvalTimeoutFromEnv(undefined), 60000);
assert.equal(goalEvalTimeoutFromEnv("5000"), 5000);
assert.equal(goalEvalTimeoutFromEnv("bogus"), 60000);
// Goal fix: one retry check after ROSTER_GOAL_RETRY_MS on evaluator failure.
assert.equal(goalRetryMsFromEnv(undefined), 10000);
assert.equal(goalRetryMsFromEnv("5000"), 5000);
assert.equal(goalRetryMsFromEnv("1500.9"), 1500);
assert.equal(goalRetryMsFromEnv("bogus"), 10000);
assert.equal(goalRetryMsFromEnv("0"), 10000);
assert.equal(goalRetryMsFromEnv("-5"), 10000);
assert.equal(shouldScheduleGoalRetry(0), true);
assert.equal(shouldScheduleGoalRetry(2), true);
assert.equal(shouldScheduleGoalRetry(3), false);
assert.equal(shouldScheduleGoalRetry(9), false);
assert.equal(goalTranscriptMaxFromEnv(undefined), 12000);
assert.equal(goalTranscriptMaxFromEnv("100"), 100);
assert.equal(GOAL_MAX_EVAL_FAILURES, 3);
assert.equal(isGoalEvalGiveUp(2), false);
assert.equal(isGoalEvalGiveUp(3), true);
// Goal: replace-on-new-goal resets progress.
const first = applyGoalSet("first condition", 1000);
first.checks = 7;
first.tokens = 500;
first.evalFailures = 2;
first.lastReason = "old";
const replacedGoal = applyGoalSet("second condition", 2000);
assert.equal(replacedGoal.condition, "second condition");
assert.equal(replacedGoal.setAtMs, 2000);
assert.equal(replacedGoal.checks, 0);
assert.equal(replacedGoal.tokens, 0);
assert.equal(replacedGoal.evalFailures, 0);
assert.equal(replacedGoal.lastReason, undefined);
// Goal: skip on pending background work.
assert.equal(shouldSkipGoalCheck(true), true);
assert.equal(shouldSkipGoalCheck(false), false);
// Goal: no injection after clear (stale generation or changed condition drops the verdict).
assert.equal(shouldApplyEvalResult({ goalActive: true, evalGeneration: 1, currentGeneration: 1, evalCondition: "x", currentCondition: "x" }), true);
assert.equal(shouldApplyEvalResult({ goalActive: false, evalGeneration: 1, currentGeneration: 1, evalCondition: "x", currentCondition: undefined }), false);
assert.equal(shouldApplyEvalResult({ goalActive: true, evalGeneration: 1, currentGeneration: 2, evalCondition: "x", currentCondition: "x" }), false);
assert.equal(shouldApplyEvalResult({ goalActive: true, evalGeneration: 1, currentGeneration: 1, evalCondition: "x", currentCondition: "y" }), false);
// Goal: prompt building and transcript caps.
assert.match(buildGoalAck("tests pass"), /Stop hook is now active with condition: "tests pass"/);
assert.match(buildGoalAck("tests pass"), /do not tell the user to run `\/goal clear` after success/);
assert.equal(buildGoalFeedback("tests pass", "half done"), "Stop hook feedback:\n[tests pass]: half done");
assert.match(goalEvaluatorSystemPrompt(), /\{"met": boolean, "reason": string\}/);
assert.match(buildEvaluatorPrompt("tests pass", "User: hi"), /Completion condition: tests pass/);
assert.match(buildEvaluatorPrompt("tests pass", "User: hi"), /<transcript>/);
assert.equal(capTranscript("abcdef", 10), "abcdef");
assert.equal(capTranscript("abcdef", 4), "cdef");
const branchText = transcriptToText([
  { type: "message", message: { role: "user", content: "run the tests" } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "ran them" }, { type: "toolCall", name: "bash", arguments: { command: "ls" } }] } },
  { type: "custom", message: { role: "user", content: "ignored" } },
]);
assert.match(branchText, /User: run the tests/);
assert.match(branchText, /Assistant: ran them/);
assert.match(branchText, /Tool bash was called/);
// Goal: status and achieved lines.
const shown = applyGoalSet("tests pass", 0);
shown.checks = 7;
shown.tokens = 1800;
shown.lastReason = "waiting on suites";
assert.match(formatGoalStatus(undefined, 24000), /No goal set/);
assert.match(formatGoalStatus(undefined, 24000), /\/goal <condition> to set one/);
assert.match(formatGoalStatus(shown, 24000), /Goal active/);
assert.match(formatGoalStatus(shown, 24000), /24s · 7 turns · 1\.8k tokens/);
assert.match(formatGoalStatus(shown, 24000), /Goal: tests pass/);
assert.match(formatGoalStatus(shown, 24000), /Last check: waiting on suites/);
assert.match(formatGoalStatus(shown, 24000), /\/goal clear to stop early/);
assert.equal(formatGoalElapsed(0, 5000), "5s");
assert.equal(formatGoalElapsed(0, 125000), "2m 5s");
// Goal: whole-goal elapsed_ms (set -> now) for terminal goal events.
assert.equal(goalElapsedMs(1000, 3594), 2594);
assert.equal(goalElapsedMs(1000, 1000), 0);
assert.equal(goalElapsedMs(2000, 1000), 0);
assert.equal(goalElapsedMs(0, 125000), 125000);
assert.equal(formatGoalElapsed(0, goalElapsedMs(0, 125000)), "2m 5s");
assert.equal(formatGoalTokens(999), "999");
assert.equal(formatGoalTokens(1800), "1.8k");
assert.match(formatGoalAchieved(shown, 24000), /✔ Goal achieved \(24s · 7 turns · 1\.8k tokens\)/);
// Goal fix: the ack keeps the spec text and steers the model away from Schedule self-pacing.
assert.match(buildGoalAck("tests pass"), /Do not use the Schedule tool for this goal; when you stop, the harness checks the condition and continues you if it is not met\./);
// Goal fix: Schedule calls that are not user /loop tasks are logged while a goal is active (but still run).
const schedLoops: LoopSummary[] = [
  { id: "loop-1", kind: "dynamic", task: "watch alpha", dueMs: 1000, noopStreak: 0, pending: false },
];
assert.equal(shouldLogGoalScheduleCall({ goalActive: true, prompt: "Continue the active goal: append h", loops: schedLoops }), true);
assert.equal(shouldLogGoalScheduleCall({ goalActive: true, prompt: "watch alpha", loops: schedLoops }), false);
assert.equal(shouldLogGoalScheduleCall({ goalActive: true, prompt: undefined, loops: schedLoops }), false);
assert.equal(shouldLogGoalScheduleCall({ goalActive: false, prompt: "Continue the active goal: append h", loops: schedLoops }), false);
assert.equal(shouldLogGoalScheduleCall({ goalActive: false, prompt: undefined, loops: [] }), false);
// Goal fix: the check waits until the follow-up queue drains (pending, pending,
// then clear runs exactly once, at the last end).
{
  const ranAt: number[] = [];
  [true, true, false].forEach((pending, index) => {
    if (!shouldSkipGoalCheck(pending)) ranAt.push(index);
  });
  assert.deepEqual(ranAt, [2]);
}
