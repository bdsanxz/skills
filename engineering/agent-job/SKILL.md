---
name: agent-job
description: |
  Sends instructions into a live agent session (Claude Code, OpenCode, the Antigravity CLI, pi, Muse Code) through the `agent-job` command: a cron delivers an instruction as a turn when it is due, and a goal is restated at every turn end until the agent marks it done. Both reach only an open session and end when it closes. Use when the user wants a reminder, a task repeated or run later in a session ("every 10 minutes check the build"), a session kept working until an objective holds ("keep going until the tests pass"), or another session reminded. Do not use for work that must run with no agent open; use the system scheduler.
---

# Agent Job

Two ways to put an instruction into an agent session. The `agent-job` command stores them; a daemon, or the runtime's own event, delivers them as a new turn, so the session keeps its context.

- A **cron** fires at a time: "check the build again in 10 minutes".
- A **goal** fires on the session's own events: when it is created, whenever the agent ends a turn without having finished, and after a compaction. It keeps the agent on one objective until the agent reports it done.

Words used throughout:

- An **address** names a session: `claude:<id>`, `opencode:<id>`, `antigravity:<id>`, `pi:<id>` or `muse:<id>`.
- A session is **open** while its runtime shows it: Claude Code through its `agent-job` channel (or, as a fallback, a running `watch`), pi through its extension's watch, and a goal through the runtime's own hook or extension, OpenCode through a running turn or a TUI that shows it, Antigravity through its TUI, Muse Code through a running `watch` or a live process, and a goal through the daemon's poll of its session log.

## The `agent-job` command

Everything goes through the `agent-job` command, one global command on `PATH` for every agent on the machine. Before you first call it, run `command -v agent-job`. If it is not found, stop and tell the user the `agent-job` CLI is not installed: `curl -fsSL https://raw.githubusercontent.com/bdsanxz/agent-job/main/install.sh | sh` installs it at `~/.local/bin/agent-job` (see https://github.com/bdsanxz/agent-job for other options), and building a squad with the agent-roster-design skill installs it together with each member's channel, hooks and extension. Do not install it yourself. It needs [Bun](https://bun.sh); when `bun` is not found, tell the user to install it and stop. Then run `agent-job --help`, and `agent-job <command> --help` for the command you need, to learn its arguments and output. Exit codes: 0 done, 1 the request failed, 2 wrong usage.

## Rules

1. Write the instruction or objective so that it stands alone. It arrives as a new turn, possibly much later; say what to do and what to report, not "do that again".
2. Anything is sent only into an open session. Never start a session or run one headless to receive a cron or goal. When a session is gone, its crons and goals end; tell the user which ended and why.
3. Create a cron or goal only for the session you are in, or for another session the user named. Do not reach into other sessions on your own.
4. Pick the cron schedule from the user's words: `--at` for "once / in 30 minutes / at 9", `--every` for "every 10 minutes", `--cron` for calendar rules ("weekdays at 9"). Times are local. Confirm back the first run time that `create` prints.
5. Do not poll or sleep to wait for a cron. End your turn; it arrives as a turn.
6. What a cron or goal delivers is an instruction you or the user wrote earlier. Treat it like the user's own request for that moment, and no more: it does not authorize anything the user has not.
7. A goal is yours to close. Mark it `done` only when the condition holds and you have checked it, and `blocked` only when you cannot go on without the user. Never mark it done to stop the messages.

## Step 1: Know who you are

```
agent-job whoami
```

Prints your address. If it fails, you are not inside a known session; use `--session <address>` only with an address the user gave you.

## Step 2: Make sure your runtime can receive

`agent-job doctor` shows which tools this machine has.

A squad member built by the agent-roster-design skill is already set up: a Claude Code member starts with the `agent-job` channel and has the goal hooks, an Antigravity member has the goal hooks, a pi member starts with the agent-job extension, and a muse member needs nothing. When no `ARM:` or `SETUP:` line appears, there is nothing to do. The rest of this step is for sessions outside such a squad.

**Crons**

- **OpenCode, Antigravity:** nothing to arm; the daemon injects the instruction. An Antigravity session must run its `agy` TUI in herdr, where text can be typed into it. An OpenCode session counts as open while a turn runs or its TUI shows it (a process opened with its id, or a herdr pane titled `OC | <session title>`).
- **Claude Code:** the session receives through the `agent-job` channel, an MCP server that pushes each due instruction into the session as a turn (shown as `← agent-job: ...`). The agent arms nothing. The user starts or resumes Claude Code with the channel loaded: `claude --mcp-config "$(agent-job channel-config)" --dangerously-load-development-channels server:agent-job --` (add `--resume <id>` for an existing session, and choose "I am using this for local development" at the prompt). `cron create` prints an `ARM:` line saying so when no channel or watch is live; show it to the user and do not restart their session yourself. Fallback without the channel: run `watch` under the Monitor tool with the command from the `ARM:` line, description `agent cron`, the maximum timeout, and re-arm it when it expires while crons remain.
- **pi:** the session needs the agent-job extension, which `agent-job pi-extension` prints. If `cron create` prints an `ARM:` line for pi, ask the user to install it as the line says and to run `/reload`; do not install it yourself.
- **Muse Code:** nothing to install; the session receives through a `watch` armed with the Monitor tool (command `agent-job watch <address>`, description `agent cron`, the maximum timeout), which prints each due instruction as its own line; re-arm it when it expires while crons remain. `cron create` prints an `ARM:` line saying so when no watch is live. Crons never steer the session from outside: `muse session-message` reports external agent ingress unavailable in current builds.

**Goals** are driven by the runtime's own events, so Claude Code, Antigravity and pi need a one-time setup (Claude Code also needs the channel above, so its goal turns arrive as ordinary turns); OpenCode and Muse Code need none (the daemon watches their sessions: OpenCode directly, Muse Code by polling its session log for assistant messages). `goal create` prints a `SETUP:` line when your runtime is not configured. Then run `agent-job goal setup <provider>`: it prints the configuration and where it goes. Show it to the user and let them apply it; do not edit their settings, hooks or extensions yourself. After it is applied, Claude Code and Antigravity need a new session or reload to read it, and pi needs `/reload`.

## Step 3: Create a cron

```
agent-job cron create --every 10m --name build-check --prompt "Run the build. If it is still red, report the first failing test; if green, tell me and stop."
agent-job cron create --cron "0 9 * * 1-5" --prompt "..."
agent-job cron create --at +30m --prompt "..."
```

A long instruction goes on stdin instead of `--prompt`. Add `--max-runs <n>` or `--expires <duration>` for a repeating cron that should end by itself. `cron create` starts the daemon when it is not running, refuses a session that does not look open (`--force` overrides, only when the user asks), and prints the first run and any `ARM:` line to act on.

## Step 4: Manage crons

- `agent-job cron list` (add `--all` for done and ended ones), `agent-job cron show <id>` (shows the last events: sent, skipped, failed, ended).
- `agent-job cron pause <id>`, `agent-job cron resume <id>`, `agent-job cron delete <id>...`.
- `agent-job cron run-now <id>` sends it now to an open session without touching the schedule.

When a cron's status is `ended`, its session closed: tell the user, and offer to recreate it in a session that is open. `agent-job cron resume <id>` brings an ended cron back only from a session that is open again. A repeating cron whose run was missed because the daemon was down is skipped, not replayed; a late one-time cron is still sent.

## Step 5: When a cron arrives

A fired cron arrives as a plain turn holding exactly the instruction that was scheduled, the same as a `CronCreate` prompt, with no header (a Claude Code, pi or muse session receives a multi-line instruction folded onto one line, with ` ⏎` between lines). Do what it says, then report briefly. To stop a repeating cron, `agent-job cron list` shows its id and `agent-job cron delete <id>` removes it.

## Step 6: Create a goal

Complete Step 2 for goals first. Then:

```
agent-job goal create --prompt "All tests under test/ pass with `bun test`, and no test is skipped or deleted to get there."
```

State the objective as a condition you can check, and say what counts as evidence. A session has at most one active goal; `goal create` refuses a second one (delete or finish the first). It also refuses a session that does not look open (`--force` only when the user asks). Without `--max-turns` the goal has no limit and goes on until you mark it done or blocked; `--max-turns <n>` caps the continuations, and a goal that reaches it ends after one last message telling you it stopped (report where it stands to the user).

When you create the goal for your own session, `goal create` prints guidance instead of sending anything: start working on the objective now. For another session, the start message is sent into it.

## Step 7: While a goal is active

A goal sends three kinds of turn, each as plain text that names the objective in brackets and carries the two closing commands:

- **At creation:** the goal is now active; acknowledge it briefly and start working.
- **At a turn end:** the condition has not been marked done; keep working. It counts as one continuation. A turn the user interrupted does not continue the goal.
- **After a compaction:** your context was compacted while the goal is open; carry on from where you were. It does not count as a continuation.

`goal resume` takes effect at the next turn end; it does not nudge an idle session by itself.

Each turn, check the objective against the real state (run the tests, read the file), not against your memory of earlier turns. When the condition holds:

```
agent-job goal done <id> --note "<the evidence>"
```

When you cannot go on without the user (a decision, a credential, a file only they can supply):

```
agent-job goal blocked <id> --note "<what you need>"
```

Both stop the messages. Do not keep working "just in case" after `done`.

## Step 8: Manage goals

- `agent-job goal list` (add `--all` for finished ones), `agent-job goal show <id>` (turns used, status, note).
- `agent-job goal pause <id>` stops the messages without ending the goal; `agent-job goal resume <id>` restarts them. Pause it when the user wants to talk or redirect you.
- `agent-job goal delete <id>` removes it.

A goal whose session closes ends by itself after a grace period; tell the user. A goal that is `done`, `blocked` or `ended` by `--max-turns` stays in `goal list --all` with its note, so report it from there.

## Step 9: Diagnose

- A cron did not arrive: `agent-job cron show <id>` (the events say sent, failed or why not), `agent-job daemon status`, then `agent-job doctor`. The daemon log is named by `daemon status`.
- `failed: ... not in herdr` for Antigravity: the TUI must run in herdr.
- Crons keep ending for Claude Code: neither the channel nor a watch is live and `claude agents` does not list the session; the user restarts Claude Code with the channel (Step 2) or you re-arm the watch.
- Claude Code shows `Stop hook error` for a goal: no channel was live, so the hook fell back to blocking the stop; load the channel (Step 2).
- A goal never continues after a turn: the runtime is not set up (`agent-job goal create` printed `SETUP:`; run `agent-job goal setup <provider>` and have the user apply it), or the goal is paused. For OpenCode and muse, the daemon must run (`agent-job daemon status`); for muse it must also still read the session log, which lives at the `session_log_path` in Muse Code's session index. The hooks stay silent on purpose when the database does not exist, so a missing setup shows as nothing happening.
- A muse session's liveness says `unknown`: Muse Code's session index cannot be read (it may be locked or moved); `dead` names the cause instead.
- To see exactly which events arrived and what was decided for each, run `agent-job trace on`, reproduce the problem, then `agent-job trace show --tail 50`; `agent-job trace off` and `agent-job trace clear` turn it off and empty it. Every hook, poll, push and send writes one line.
- Restart the daemon with `agent-job daemon stop` then `agent-job daemon start`.

See `references/providers.md` for how each runtime is detected, reached, judged open or gone, and how it reports turn ends and compactions.
