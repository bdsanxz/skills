# opencode-roster report

## Revision 3: v2 contract and event logging

- Stopped the only test terminal (`hc kill t35`; output said state `finished`, reason `killed`, exit code `0`). No more live testing was performed, per user direction.
- Confirmed actual installed package metadata at `node_modules/@opencode-ai/plugin/package.json`: `@opencode-ai/plugin@1.19.5` exports `./v2/promise` and `./v2/effect`. `dist/v2/promise/plugin.d.ts` requires default `{ id, setup(context) }`; effect variant requires `{ id, effect(context) }`. `PluginContext` has only `options`, `agent`, `aisdk`, `catalog`, `command`, `integration`, `plugin`, `reference`, `skill`. There are no v2 tool registration, TUI command interception, or generic session event hooks in these installed interfaces.
- Debug log showed previous error root cause exactly: `err_f0cbdd10 ... cause="Cause([Die(ResolveMessage: Cannot find module './logic' imported from .../.opencode/plugins/opencode-roster.ts)])"`. This was a missing adjacent module file after removing it as a duplicate plugin entry, not the default export issue (which was separately corrected).
- Added v2 default-export plugin entrypoint `.opencode/plugins/opencode-roster.ts`. It logs `plugin_loaded`, and exports best-effort `rosterRuntime` helpers for command/tool/event plumbing. Important limit: because the installed v2 context exposes no runtime tool/TUI/event hooks, these helpers are not available as slash commands or OpenCode tools; the deliverable cannot claim functional v2 `/loop` integration with these APIs.
- JSONL log path defaults to `/Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/opencode-roster/logs/roster.jsonl` (relative to project cwd), overridable via `ROSTER_LOG`; `logs/` is gitignored. Schema: `ts` ISO string, `event`, optional `session_id`, `details`. Intended events: `plugin_loaded`, `command_received`, `first_iteration_sent`, `timer_scheduled`, `timer_fired`, `message_injected`, `tool_call`, `session.status`, `session.idle`, `cancel_stop`, `error` (message/stack).
- README includes explicit manual TUI test steps, but notes they cannot currently pass without v2 tool, command and event registration surfaces.

## Revision 4: v2 plugin + MCP sidecar

- Read the user-supplied official v2 MCP notes. Confirmed session targeting: MCP SDK handler `extra._meta["ai.opencode/sessionID"]`; config uses `mcp.servers.roster`, local `command` array, and `codemode:false`.
- Implemented a default `{ id, setup }` v2 plugin entrypoint which registers the `loop` command and embedded `loop` skill using `context.command.transform` / `context.skill.transform`. The template requests one immediate iteration, exact-input preservation, MCP tool names and dynamic/interval behavior. Setup logs plugin and registration events.
- Added a Bun MCP stdio server (`src/mcp/server.ts`) exposing `ScheduleWakeup`, `CronCreate`, `CronList`, `CronDelete`; independent cron IDs; session-scoped list/delete; delay clamp; noop streak; stop; and error logging. MCP instruction string describes loop protocol.
- Initial SDK inspection suggested a legacy `promptAsync` method, but live OpenAPI evidence supersedes it: v2.0.29’s server accepts only the `/api/session/{sessionID}/prompt` route, with explicit queue delivery; the sidecar now avoids `promptAsync` entirely. The server event route is `/api/event` with SSE.
- The server requires session metadata and errors clearly when absent; session IDs are not tool arguments.
- Added pure logic and handler tests with fake injector, including isolated cron IDs, missing session metadata, clamp/parse, and busy-queue idle drain.
- JSONL logs default to `logs/roster.jsonl`, override `ROSTER_LOG`, ignored by `.gitignore`; README includes exact manual test steps and OpenCode config sample.
- Removed `live-debug.log` as requested.
- No live TUI testing was performed, per instruction. The manual checklist is in README.

## Revision 5: correct v2 HTTP API and auth

- Read-only command: `curl -s -u opencode:roster-local-test http://127.0.0.1:4097/openapi.json -o openapi-v2.json`. Output: `wc -c openapi-v2.json` returned `369641` bytes. No session creation or prompt calls were made.
- Extracted OpenAPI showed `GET /api/session` operation `session.list`; `POST /api/session/{sessionID}/prompt` operation `session.prompt`, body requires `text` and supports `delivery`/`resume`, responses include 200/400/401/404/409; `GET /api/event` operation `event.subscribe` with `text/event-stream`. This confirms the reported v1-style SDK endpoint is wrong for the installed server.
- Removed SDK use in injector. New `createPromptInjector` uses plain fetch to `POST {baseURL}/api/session/{encodedSessionID}/prompt` with `{text, delivery:"queue", resume:true}` and optional Basic auth `opencode:<password>`. Password comes from `OPENCODE_SERVER_PASSWORD` or `OPENCODE_PASSWORD`; auth header is never logged. Since prompt may wait for model completion, it is fire-and-forget and failure is reported via logged error callback.
- Server event watch now uses fetch SSE `GET {baseURL}/api/event` with optional Basic auth, handles session busy/idle/deleted events. Tests cover v2 URL, HTTP verb, JSON body, Basic header, no-password behavior, async error logging, and busy->queue->idle delivery.
- `README.md` now documents starting `opencode serve --port 4097`, fixed base URL and password environment, and the user-run TUI procedure. No TUI/session testing was done by the implementer.
- Verification after changes: `bun run typecheck` exited 0; `bun test` => 11 pass, 0 fail, 33 expect() calls; `git diff --check` no output.

### Requested manual test plan

When the v2 runtime adds the required registration APIs (or a bridge is chosen): follow `README.md` → “Manual test plan”: prove plugin load/log, `/loop 60s say tick` with immediate iteration and 2 repeats, dynamic ScheduleWakeup, busy queue delivery, stop cancellation, and two independent Cron jobs. Current implementation is not ready for these tests because those integrations cannot be registered via the installed plugin context.

## Built (revision 2)

- Project-local plugin at `.opencode/plugins/opencode-roster.ts` with `/loop [interval] <prompt>`, `ScheduleWakeup`, and `CronCreate`, `CronList`, `CronDelete`.
- Shared logic in `.opencode/plugins/logic.ts` and `src/logic.ts`; parsing/clamping tests in `test/logic.test.ts`.
- `README.md` documents installation, usage, and limitations.
- Dynamic timers clamp delay to 60–3600 seconds, accept the autonomous sentinel, track no-op streaks, permit stop/cancel, and post TUI toast status. `/loop` without an interval submits an immediate first iteration. Cron jobs now have independent ids/timers. A busy/pending guard prevents timer deliveries from intentionally reinjecting while marked busy.

## Exact commands run and output

Additional revision-2 commands and outputs:

- `hc --help; hc run --help` — printed `hc` usage, terminal control commands, and `hc run` options.
- `hc run --bg --name oc-roster-live --cwd /Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/opencode-roster zsh -ic "opencode --standalone --auto"` — terminal `t32`, state `live`.
- `hc send t32 "/plugins"` — entered plugin list.
- `hc keys t32 enter` — showed `Plugin must export a default definition with an id and an effect or setup function. Reference: err_6ea088d4` for `logic.ts`.
- `hc keys t32 esc ctrl+c` — returned to TUI; displayed one plugin failed.
- `hc kill t32` — state `finished`, reason `killed`, exit code `0`.
- Retried the exact `hc run ...` command — terminal `t33`, state `live`.
- `hc read t33 --lines 50` — showed one plugin failed.
- `hc send t33 /plugins && hc keys t33 enter && hc read t33 --lines 80` — showed `Plugin failed to load Reference: err_f0cbdd10`.
- `hc kill t33` — state `finished`, reason `killed`, exit code `0`.
- `bunx tsx -e 'import("./src/index.ts").then(async m=>{const x=await m.OpencodeRoster({client:{tui:{showToast:async()=>{},appendPrompt:async()=>{},submitPrompt:async()=>{}},session:{prompt:async()=>{}}}}); console.log(Object.keys(x),Object.keys(x.tool))})'` — printed `[ 'event', 'tool', 'tui.command.execute' ] [ 'ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete' ]`.
- `bun run typecheck` — `$ tsc --noEmit`, exit 0.
- `bun test` — 4 pass, 0 fail, 14 expect() calls.

1. `pwd && ls -la && find . -maxdepth 3 -type f -print | sort && opencode --help`
   - Printed project path, initially empty directory, and OpenCode CLI usage/subcommands.
2. `opencode plugin --help && opencode debug --help && opencode --version && opencode config --help`
   - Printed CLI help; version: `opencode v2.0.29`.
3. `bun install`
   - `bun install v1.4.3 (c6da4a4d3)`; installed `@opencode-ai/plugin@1.19.5`, `bun-types@1.4.4`, and `typescript@5.9.3`; saved lockfile.
4. `bun test`
   - `4 pass`, `0 fail`, `14 expect() calls`; ran 4 tests across 1 file.
5. `bun run typecheck`
   - `$ tsc --noEmit` (exit 0).
6. `mkdir -p .opencode/plugins && cp src/index.ts .opencode/plugins/opencode-roster.ts && cp src/logic.ts .opencode/plugins/logic.ts`
   - No output (exit 0).
7. `opencode .` (interactive TUI)
   - Started an interactive TUI; its shell capture contained terminal escape sequences, not readable screen output. No live plugin discovery or command/tool behavior was conclusively verified.
8. `bun test && bun run typecheck && git status --short && git diff --check && opencode --help`
   - Tests and typecheck passed again; `git diff --check` had no output. `git status --short` showed pre-existing changes outside this project (`agent-job/SKILL.md`, `product/tasks/SKILL.md`, `product/tasks/references/task-format.md`, `../pi-roster/`, `frontend/web-to-egui/`) as well as this project's untracked `./`; none outside this project were edited by this work. Help printed CLI usage/subcommands.

## Proven live

- Started exactly the authorized test terminal twice (killed the first before retry):
  `hc run --bg --name oc-roster-live --cwd /Users/budisantoso/Dev/bdsanxz/SWE/skills/engineering/agent-roster-design/dev/opencode-roster zsh -ic "opencode --standalone --auto"`
- First `hc read t32 --lines 80` showed `2 plugins failed` and named `logic.ts` plus `opencode-roster.ts`. `/plugins`, Enter, then `hc read t32 --lines 100` displayed: `Plugin must export a default definition with an id and an effect or setup function.` Cause: OpenCode treats every file in `.opencode/plugins/` as a plugin; the copied utility file was erroneously a second entry. Removed `.opencode/plugins/logic.ts`.
- Retried same authorized command in terminal `t33`. `hc read t33 --lines 50` showed the plugin failed. `/plugins`, Enter, then `hc read t33 --lines 80` displayed: `Plugin failed to load` and reference `err_f0cbdd10`; no further detail was provided in the TUI.
- Killed `t33` with `hc kill t33`; result reported `state:"finished"`, `reason:"killed"`, `exit_code:0`.
- The requested proof that the plugin loaded, `/loop 60s say tick` fires twice, dynamic ScheduleWakeup works, busy-session behavior queues, and stop cancels **was not achieved** because plugin loading fails. No live behavior should be inferred from TUI startup.
- `bunx tsx -e 'import("./src/index.ts").then(async m=>{const x=await m.OpencodeRoster({client:{tui:{showToast:async()=>{},appendPrompt:async()=>{},submitPrompt:async()=>{}},session:{prompt:async()=>{}}}}); console.log(Object.keys(x),Object.keys(x.tool))})'`
  printed `['event', 'tool', 'tui.command.execute']` and `['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete']`; this checks factory initialization only, not OpenCode compatibility.
- `bun run typecheck` and `bun test` after the fixes: `tsc --noEmit` exited 0; `4 pass`, `0 fail`, `14 expect() calls`.

## Missing / limitations

- This is an in-memory single active timer per session, not a durable multi-cron scheduler. Cron tools share that one timer slot.
- Plugin loading is still broken in the v2.0.29 live TUI (`Plugin failed to load`, reference above). The loader's internal error detail must be obtained before claiming this package runs.
- SDK `session.prompt` busy queue semantics and session status event payload are not verified. The in-memory busy guard assumes status event payload has `sessionID`/`id` and `status.type`; this needs checking against actual events.
- `CronList` currently enumerates the in-memory cron map globally, not scoped by session; jobs are independent but cross-session isolation remains to improve.
- Timer lifetime is tied to the plugin process; process restart loses schedules. Status is toast-only, not a persistent panel.
- `/loop` first iteration is now submitted immediately via TUI append/submit, but command hook `preventDefault`/shape and actual immediate execution were not verified.

## What slowed this down

- The installed CLI is OpenCode v2.0.29, while public plugin docs and SDK pages offer broad event/API descriptions but do not fully specify the TUI command hook or busy-session queue semantics.
- The interactive TUI exposed useful loader feedback in its plugin detail view, but after correcting the obvious duplicate module entry it only surfaced a generic plugin loading failure and a reference id; no additional stack trace was available through `hc read`.
