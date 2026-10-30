# pi-roster work report (updated)

## Changes made
- `/loop [interval] <prompt>` sends its first iteration immediately using `deliverAs: "followUp"`, then interval ticks continue on schedule. Dynamic loops receive instructions to perform one iteration and call `ScheduleWakeup`.
- Timer ticks use `deliverAs: "followUp"` so they queue as follow-up work rather than interrupting an active run.
- `/loop stop` cancels the scheduled tick; bare `/loop` reports status.
- README explicitly says cron create/list/delete tools are out of scope.

## Tests / commands run
- `node --experimental-strip-types --test logic.test.ts`: pass (1 test file, 7 assertions; output in first report details).
- `hc run --bg --name pi-roster-live --cwd /Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/pi-roster zsh -ic "pi -e ./index.ts"`: started nested interactive Pi at `t31`.
- `hc send t31 "/loop 60s say tick"`; then waited 125 seconds and `hc read t31` showed two separately scheduled `ScheduleWakeup` calls, each `Wakeup in 60s`, and the status footer. This model invoked the tool and produced multiple tick messages. **Caveat:** model interpreted the interval request via the dynamic tool rather than demonstrating direct interval timers, so this was not an unambiguous interval-mode proof.
- `hc send t31 "/loop look for an interesting fact and report it"`; `hc read t31` showed it ran a task and called `ScheduleWakeup` with 1200 seconds.
- `hc send t31 "/loop stop"`; captured output includes `Loop stopped.`
- `hc send t31 "/loop inspect git status and summarize"` was also used as a status/cancellation check; captured UI output followed by one final `hc send t31 "/loop stop"` and `hc kill t31`. Terminal reports finished, exit_code 0, reason killed.

## Current update: logging and interval coverage

Stopped the two test terminals `t34` and `t36` as requested; user will perform further live tests. Added JSONL logging (override with `ROSTER_LOG`) and `.gitignore` entry for `logs/`. Events: `extension_loaded`, `command_received`, `first_iteration_sent`, `timer_scheduled`, `timer_fired`, `message_injected`, `tool_call_ScheduleWakeup`, `cancel_stop`, `session_shutdown`, and `error` (stack). Logging exceptions are swallowed.

Interval mode code sends the plain prompt immediately and re-arms only its extension timer; interval timer messages are not dynamically wrapped. Scheduling always clears the existing timer first. Added pure tests for plain interval text, dynamic wrapper, and replace-timer clearing, as well as parser/clamp cases. `node --experimental-strip-types --test logic.test.ts` output:

```text
✔ logic.test.ts (114.2735ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 120.282125
```

## Latest interval live check (before the user's stop-testing instruction)

Started `t34` using `hc run --bg --name pi-roster-interval --cwd <project> zsh -ic "pi -e ./index.ts"`. Sent `/loop 60s run: date +%T and print only that`; `hc read t34` showed dates `11:36:56`, `11:37:02`, and `11:38:26`. There were no visible ScheduleWakeup calls in the excerpt, but output also contained unrelated `tick` responses from a prior/repeated prompt. Therefore this was contaminated and does **not** count as reliable proof of distinct interval ticks ~60 seconds apart. Killed `t34` and `t36` immediately after the stop-testing instruction; both terminals reported `reason: killed`, `exit_code: 0`.

Busy queue proof was not completed: the `/loop 60s !sleep 75` test was interrupted by the change of plan. No test terminals remain running. User will test manually.

Earlier live dynamic/stop work and initial report remain above. Cron tools remain out of scope.

```text
<hc from="t2y pi-roster">/loop 60s say tick</hc>

I’ll use the loop scheduler to emit “tick” every 60 seconds.

ScheduleWakeup delaySeconds=60 noop=false prompt="say tick" reason="User requested a repeating 60-second loop th...
Wakeup in 60s. User requested a repeating 60-second loop that says tick.

<hc from="t2y pi-roster">/loop 60s say tick</hc>

ScheduleWakeup delaySeconds=60 noop=false prompt="say tick" reason="Continuing the user's repeating 60-second ti...
Wakeup in 60s. Continuing the user's repeating 60-second tick loop.

ScheduleWakeup delaySeconds=60 noop=false prompt="say tick" reason="Continuing the user's repeating 60-second ti...
Wakeup in 60s. Continuing the user's repeating 60-second tick loop.

tick

Perform one iteration of this dynamic loop, then call ScheduleWakeup with the same input verbatim and a context-appropriate delay, or stop if complete: /loop say tick

ScheduleWakeup delaySeconds=60 noop=false prompt="say tick" reason="Continuing the user's repeating 60-second ti...
Wakeup in 60s. Continuing the user's repeating 60-second tick loop.

tick

Perform one iteration of this dynamic loop, then call ScheduleWakeup with the same input verbatim and a context-appropriate delay, or stop if complete: /loop say tick

<hc from="t2y pi-roster">/loop look for an interesting fact and report it</hc>

$ ls (timeout 10s)
index.ts
logic.test.ts
logic.ts
README.md
REPORT.md
Took 0.0s

read README.md:1-150

ScheduleWakeup delaySeconds=1200 noop=false prompt="look for an interesting fact and report it" reason="Searchin...
Wakeup in 1200s. Searching for an interesting fact to report on the next loop tick.

<hc from="t2y pi-roster">/loop stop</hc>

ScheduleWakeup delaySeconds=0 noop=false prompt="" reason="User requested stopping the active fact loop." stop=true
Loop stopped.
```

## Limits / caveats
Cron tools are out of scope. Live run proved dynamic ScheduleWakeup and stop; interval-mode direct timer delivery wasn't conclusively shown because the model chose ScheduleWakeup. The model's behavior when processing a dynamic prompt can schedule multiple times if the tool is called repeatedly. Busy queue semantics use Pi's documented `followUp` delivery and were not deliberately tested with a slow busy agent. The TUI required roughly two minutes to capture two tick cycles.

## Queued-tick pending flag never cleared (2026-10-30, fix2)

Lead live evidence (`~/.pi/agent/logs/roster.jsonl`, 2026-10-30 06:52 UTC, `/loop 5s run sleep 12 seconds`): the first iteration logged `tick_consumed` via `before_agent_start`, the 06:52:19 tick queued as `followUp` behind the 12 s turn, later ticks correctly skipped as `previous_prompt_pending`, but the queued tick ran after the turn with no `tick_consumed`, so the flag stayed set and every later tick skipped until `/loop stop`. The loop silently died after one queued tick.

### Cause (confirmed in the installed pi 1.4.0 sources)
`before_agent_start` fires once per run in `_prepareRun` (`agent-session.js` `_startRun`/`_prepareRun`); queued `followUp` messages drain inside the same run via the `agent.continue()` loop (`_handlePostAgentRun`), so no new `before_agent_start` ever fires for them. `message_start` fires per message with the full `AgentMessage` (`_handleAgentEvent` removes the queued text before emitting to extensions, then `_emitExtensionEvent` forwards `message_start`), carrying role and content, so it observes queued ticks. `turn_start` carries only turnIndex/timestamp and cannot identify the tick; `agent_end`/`agent_settled` fire once per run after the queues drain, so they suit only the idle safety valve.

### Changes made
- `logic.ts`: new pure helpers `userMessageText` (string or text-block array content, joined as `sendUserMessage` normalizes), `pendingMaxMs` (3x interval, 60 s floor, finite positive override wins), `pendingMaxMsFromEnv` (parses `ROSTER_PENDING_MAX_MS`), `isPendingExpired`, `shouldClearOnIdle`. Schedule parameters and the 1..3600 clamp untouched.
- `index.ts`: per-job `pendingSince`/`lastDelayMs` timestamps; `message_start` handler clears the matching job's flag (logged as `tick_consumed` with `event: "message_start"`); `before_agent_start` kept for the new-run case (now also logs which event consumed); `agent_end` clears a still-pending flag when `hasPendingMessages()` is false (logged as `tick_consumed` with `event: "agent_end"`); each timer fire expires a flag older than its max age first (logged as `tick_pending_expired` with age/max) so a stuck flag delays at most one max age instead of killing the loop. `/loop stop`, fresh starts, and shutdown clear the new timestamps too.
- `logic.test.ts`: new assertions for text extraction (string, mixed text/image blocks, non-user role), max-age default/floor/override/env parsing, expiry boundary and undefined-timestamp, idle clear vs queued/stale cases, and skip-while-pending-and-young.
- `README.md`: "Tick coalescing" documents `message_start` clearing plus the `agent_end` and expiry valves and `ROSTER_PENDING_MAX_MS`.

### Tests / commands run
- `node --experimental-strip-types --test logic.test.ts` in the project dir: pass (1 test file, 1 pass, 0 fail; covers parser/clamp/tick-text/replace-timer plus pending-flag consume/idle/expiry cases).
- No live pi run and no TUI test: per the task, the lead tests live afterwards. Not verified live: `tick_consumed` via `message_start` for a queued tick, `agent_end` idle clear, and `tick_pending_expired` firing.

## What slowed me down
Waiting for the 60-second timer cycles was the main delay. Model interpretation of `/loop 60s` complicated attribution between extension timer and model-triggered scheduler, so proof is qualified rather than definitive.

## Tick-coalescing fix (2026-10-30)

Lead saw seven queued ticks stack during one 12 s turn (`/loop 5s run sleep 12 seconds`): every 5 s tick injected with `deliverAs: followUp` while busy, and all queued prompts ran after `/loop stop`. Fixed per task-pi-fix.md.

### Changes made
- `logic.ts`: new pure helpers `decideTick` (not busy -> inject; busy and nothing pending -> inject and mark pending; pending -> skip), `consumeTick` (clear one job's flag when handling starts), `clearTickFlags`/`emptyTickFlags` (stop / fresh loop clears), plus `LoopMode`/`TickFlags` types. Schedule parameters and the 1..3600 clamp untouched.
- `index.ts`: per-job `pending` flags plus `pendingText`; timer fire goes through `decideTick` and logs `timer_skipped` with reason `previous_prompt_pending` (job, source) instead of injecting, still rescheduling the next tick for interval mode and leaving the one-shot dynamic wakeup cleared; successful injects (first iteration and timer ticks) mark pending; a `before_agent_start` handler clears the matching job's flag (logged as `tick_consumed`) by comparing the run's user prompt to the injected tick text; `/loop stop` (`cancel`) and fresh `/loop` starts clear flags and timers; `timer_scheduled`/`timer_fired`/`message_injected` now carry the `job`.
- `logic.test.ts`: new assertions for all five required cases.
- `README.md`: new "Tick coalescing" section; limits now state that queued `followUp` prompts cannot be retracted after `/loop stop`.

### API finding (queue retraction)
Surveyed the installed pi 1.4.0 extension API (`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`, `agent-session.d.ts`). `ExtensionAPI`/`ExtensionContext` expose `sendUserMessage` (`steer`/`followUp`), `abort()` (aborts the current streaming operation, not the queue) and `hasPendingMessages()` (read-only). `clearQueue()` exists on the internal `AgentSession` class but is not wired into the extension actions, so extensions cannot drop queued follow-ups. `/loop stop` therefore stops future ticks only; ticks already queued still run once each. The clear hook used is `before_agent_start` (`messageType: "user"` run start), matched on the injected tick text; `turn_start` carries no message info so it cannot identify the consumed tick.

### Tests / commands run
- `node --experimental-strip-types --test logic.test.ts` in the project dir: pass (1 test file, 1 pass, 0 fail; covers parser/clamp/tick-text/replace-timer plus the 8 new pending-flag assertions).
- No live pi run and no TUI test: per the task, the lead tests live afterwards. Not verified live: skip-during-busy, `tick_consumed` clearing, and post-stop drain of an already-queued tick.
