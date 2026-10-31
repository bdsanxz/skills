# PLAN_01: opencode-roster /goal stalls after one evaluator failure

## Observed (live test, OpenCode v2.0.29, model vikey/deepseek-v4-flash)
Goal "append ONE character per turn to sentence.txt". Turn 1 appended `g`, turn 2 `o`, then `goal_eval_failed` with `error: "evaluator returned non-JSON output", failures: 1`. No next turn ever came, so no check ran again: the goal stayed set but the session idled forever (the design retries "at the next turn end", but a failed check ends the chain of turns). Earlier checks ("goal_check met:true" for a one-shot goal) worked, and `goal_skipped_busy` plus many `busy_safety_valve` events appeared during the run (log: /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/goal-oc/roster.jsonl; never print the `condition`/transcript fields beyond what you need).

## Steps
1. Read `README.md`, `src/mcp/goal.ts`, `src/mcp/api.ts`, `src/mcp/logic.ts`, `test/goal.test.ts`.
2. Diagnostics (no transcript content): on a verdict parse failure log `reply_chars`, whether the reply equals or contains the evaluator prompt text (an echo of the user message), the message roles/part types seen, and the first 120 characters of the evaluator's REPLY only.
3. Reply extraction (`extractTextFromMessages` / the polling in `api.ts`): use only the final assistant message text; ignore the user echo and non-text (reasoning/tool) parts; wait until that assistant message is complete before reading. Add unit tests with flat shapes from the README (user echo containing `{"met":boolean,...}`, partial assistant message, reasoning part).
4. Retry on evaluator failure: after a `goal_eval_failed` (not cap reached) schedule one retry check after `ROSTER_GOAL_RETRY_MS` (default 10000), cancelled by clear/replace/stop/session end (generation guard), still bounded by the existing max evaluator failures. Test with fake timers/clock injected as existing tests do.
5. Same stall in `pi-roster` (`index.ts`/`logic.ts`): read how `agent_end` handles evaluator failure; apply the same retry timer with the same env name, with tests in `logic.test.ts`.
6. Update both READMEs (new env, retry rule, new log fields). Run `bun run typecheck`, `bun run test`, and `bun run build` in both projects (the built files land in ../../scripts); report sha256 of the built outputs and that rebuilding gives identical bytes.

## Rules
- Work only in /Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/opencode-roster and /Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/pi-roster and their built outputs in /Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/../scripts. Read each file before editing; edit in place. English only. No secrets, never print the OpenCode password or provider settings. No live sessions (the lead runs the live test). No commits, pushes, installs. Do not touch other files in the skills repo (there are unrelated uncommitted changes).
- Finish with `git status --short` for these paths.
- Write the report to /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-goalfix.md, then run: `hcx send --no-footer Zytra "goalfix done, report: /private/tmp/claude-501/-Users-budisantoso-Dev-bdsanxz-SWE/b22ac8cc-e39c-43ce-8990-7eda0c4d7dfc/scratchpad/report-goalfix.md"`
