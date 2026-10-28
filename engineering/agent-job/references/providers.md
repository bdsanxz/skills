# Providers: reaching a session and knowing it is gone

Verified on this machine (Claude Code 2.1.312, OpenCode 2.0.29, agy 1.4.9, pi 1.4.0, herdr 0.9.5, Muse Code 1.4.14).

| Provider | Address from | Reached by | Open while | Gone when |
| --- | --- | --- | --- | --- |
| claude | `CLAUDE_CODE_SESSION_ID` | the daemon queues it in the outbox; the `agent-job channel` MCP server pushes it as a `notifications/claude/channel` turn | the channel's lease is fresh, or `claude agents --json` lists the session | no channel runs and `claude agents` does not list the session |
| opencode | `OPENCODE_SESSION_ID` | `opencode api post /api/session/<id>/prompt` with `delivery: steer`, `resume: true` | `/api/session/active` has it, a process `opencode ... <id>` exists, a herdr pane is titled `OC \| <title>` with a unique title, or (a new session with no title) it is the only untitled session of its directory and a herdr pane there is titled `OpenCode` | none of those |
| antigravity | `ANTIGRAVITY_CONVERSATION_ID` | `herdr agent prompt <pane> <text>` (typed into the TUI) | `~/.gemini/antigravity-cli/presence/<id>.lock` is held by a process on a tty | nobody holds the lock |
| pi | `PI_SESSION_ID` | the extension runs `_pi-hold pi:<id>` as a child and turns each line into a user message | the extension holder's lease is fresh | `session_shutdown` stops the holder |
| muse | `MUSE_SESSION_ID` | natively: `/loop` and `/goal` typed into the herdr TUI with `herdr agent prompt` (preferred, verified live on Muse Code 1.4.14: `Scheduled ...` and `Goal set — ...` acknowledgements); the daemon fails a firing fast when the TUI is not in herdr | the TUI shows it in herdr; otherwise the socket lease pid in `runtime/muse/sessions/<id>.json` still runs | neither, and the session index has no such session |

## What the experiments showed

Each provider was tested with a real TUI in herdr: a cron is delivered, the model answers it, and the cron ends after the TUI is closed, without another send.

| Provider | Delivered as | Ended after the TUI closed |
| --- | --- | --- |
| claude | a channel push, shown as `← agent-job: ...` | 83 s after the tab closed, reason "no channel and not listed by `claude agents`" |
| opencode | a user turn in the TUI, the model replied | about 100 s, reason "no TUI shows the session" |
| antigravity | text typed into the TUI, the model replied | about 117 s, reason "no agy TUI holds the session's presence lock" |
| pi | a user message, the model replied | about 125 s, reason "no pi extension listener" |

(Muse Code is not in this table: its daemon delivery is push-only (paste into the herdr TUI, covered by unit tests) and its poll continuation is covered by unit tests, not yet by a live TUI experiment. Its native `/loop` and `/goal` were verified live instead: a herdr prompt of `/loop every 60s ...` answers `Scheduled * * * * *: ...` with an id, and `/goal ...` answers `Goal set — ...` with a status-bar goal.)

- **Delivered text:** exactly the cron's prompt, as `CronCreate` delivers it: no header. The daemon folds newlines into ` ⏎` for collecting listeners, because they deliver one line per cron; the channel unfolds back to newlines before pushing the turn, so only the pi holder's lines stay folded. Push deliveries (OpenCode steer, Antigravity or Muse paste) keep the prompt's lines.
- **pi:** a new session has no session file, and so no address, until its first turn ends. The extension therefore also starts its holder on `agent_end`; a pi session receives crons after its first turn.
- **Muse Code:** a session is indexed in `session-index.db` (sid, `workspace_root` for its directory, `session_log_path`) once it has run, and counts as live while the pid holding its socket lease (from `runtime/muse/sessions/<id>.json` `endpoint_hint`) still runs. `muse session-message` is not used: external agent ingress is unavailable in current builds, so a daemon firing never steers a muse session from outside; it fails fast. The skill's preferred path does not go through the daemon at all: like `peers`, it reaches a live muse TUI in herdr by typing the native `/loop` or `/goal` into it with `herdr agent prompt`. A muse TUI outside herdr cannot receive daemon lines at all.

- **Claude channel:** `agent-job channel` is an MCP stdio server that declares the `claude/channel` capability, takes the session's lease, and pushes each outbox row; the lease ends when its parent process dies. The session id comes from `CLAUDE_CODE_SESSION_ID`, else from `claude agents --json` by parent pid. It is loaded with `--mcp-config` (the JSON `agent-job channel-config` prints).
- **Claude Code:** when a session is terminated, Claude Code closes the channel's stdin and stops it; the channel drops its lease on exit, so the daemon learns the session is gone without any hook.
- **OpenCode:** sessions live in the background service (`opencode serve --service`), not in a process of their own, so no event says a session ended. "Open" therefore means a TUI shows it.
- **Grace period:** a session must stay gone for 30 seconds (`AGENT_JOB_GRACE_MS`) before its crons end, so a restarted channel or a `/reload` does not end them. A due cron waits during the grace period instead of being sent.
- **Unknown:** when a tool is missing or does not answer, the session's state is unknown; nothing is sent and nothing ends.

## Goals: reporting turn ends and compactions

A goal is sent at creation, at each turn end and after a compaction. Each runtime reports those events differently; the text is the same everywhere (`goal event` / `goal hook` prints it, the runtime puts it into the session).

| Provider | Turn end | Compaction | Needs setup |
| --- | --- | --- | --- |
| claude | `Stop` hook; with a live channel the hook queues the text and replies nothing, so it arrives as a channel turn; otherwise the reply `{"decision":"block","reason":text}` keeps the agent going (shown as "Stop hook error", with a duplicated reminder to the model). No `Stop` fires on a user interrupt | `SessionStart` hook with `source:"compact"` (and `resume`); queued for the channel the same way, else `additionalContext` (seen only at the next turn) | hooks in a Claude settings file, found by the string `goal hook claude` |
| opencode | the daemon polls `GET /api/session/<id>/message?limit=30&order=desc` every 3 s; an `idle` message with `outcome: succeeded` continues, `interrupted` and `failed` do not | a `compaction` message in the same poll | none |
| antigravity | `Stop` hook (`terminationReason` in its input); reply `{"decision":"continue","reason":text}`; a user cancel does not continue | every compaction adds a `"type":"CHECKPOINT"` step to the transcript. `/compact` ends with a `Stop` of `TERMINAL_CUSTOM_HOOK`; the hook sees the count rise and restates at once. A compaction in the middle of a turn is caught by a `PreInvocation` hook, which injects the text as a system message | `hooks.json` (`~/.gemini/config/` or `<workspace>/.agents/`); the event name is passed as a command argument because stdin does not carry it |
| pi | the extension's `agent_settled` event (`aborted` is skipped) runs `goal event turn-end` and sends the output as a user message | `session_compact` runs `goal event compacted` | the agent-job extension in `~/.pi/agent/extensions/` |
| muse | natively: the runtime restates its own `/goal` every turn (preferred, verified live; no daemon involved). Daemon fallback: the daemon polls the session log every 3 s; each `assistant_message_committed` record since the goal (cursor: the envelope `sequence`) continues, a user interrupt does not | native: the runtime carries the goal itself. Daemon fallback: `CompactionInstalled`, `preCompact` or `postCompact` run events in the same poll | none |

Verified live with a real session of each (a goal set from outside, the model working until it ran `goal done`):

| Provider | Turn end | Compaction |
| --- | --- | --- |
| claude | channel turns after each `Stop`: 2 continuations, then `goal done`; no "Stop hook error" | `SessionStart` `source=compact`, then a channel turn and the agent resumed work |
| opencode | 2 continuations, 3 files created, then `goal done` | text found in the session after `/compact` |
| antigravity | 2 continuations through `Stop`, then `goal done` | text restated right after `/compact` (checkpoints 2 to 3) and the agent continued |
| pi | 2 continuations (goal done at 2/8) | text arrived after `/compact` and the agent resumed work |

(Muse Code is not in this table either: its poll counts `assistant_message_committed` records and looks for the compaction run events above, covered by unit tests. The compaction event shape is the schema's hook vocabulary; if a future build records compactions differently, the poll still continues at every turn end and only misses the compaction text. Its native `/goal` was verified live instead and needs no row here: set with `herdr agent prompt <member> "/goal ..."`, acknowledged with `Goal set — ...`, restated by the runtime itself.)

- **Native format:** the creation text is `A goal is now active with condition: "<cond>". ... Stopping is blocked until the condition holds.`, and a continuation follows the form `[<cond>]: <why it is not met>`, with the `goal done` / `goal blocked` commands appended.
- **Limits:** one active goal per session. `turns` counts continuations, not compactions; `max_turns` 0 (no `--max-turns`) is unlimited; at a set `max_turns` the goal ends after one last text (`limit-text`) saying it stopped, and sends nothing more.
- **Hooks never fail the runtime:** they exit 0, and stay silent when the database does not exist.
- **pi compaction:** pi stays busy until the `session_compact` handler returns, and a message sent while it is busy has no run to join and is dropped. The extension therefore returns at once and sends from a separate task once the session is idle.
- **Goal ends with the session:** the daemon's sweep ends an active or paused goal whose session stays gone for the grace period, as it does for crons.
- **Paused goals:** the daemon still polls OpenCode and muse for a paused goal and advances its cursor without acting, so `goal resume` on an idle session sends nothing until the next turn end.
- **Compaction across polls:** an OpenCode compaction message and the `idle` that follows may be read in different polls; the daemon remembers the compaction and sends the compacted text at the turn end. A muse compaction record and a later assistant message behave the same way through the same cursor.
- **Trace:** `agent-job trace on` (or `AGENT_JOB_TRACE=1`) writes one JSON line per hook, poll, push and decision to `trace.log` in the data directory; `trace show --tail n` reads it.

## Data

One SQLite database per machine at `~/.local/share/agent-job/` (`AGENT_JOB_HOME` overrides it), plus `daemon.pid`, `daemon.log` and, when tracing, `trace.log`.
