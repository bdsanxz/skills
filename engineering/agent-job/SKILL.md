---
name: agent-job
description: |
  Puts instructions into a live agent session at the right moment: natively through `/loop` and `/goal` for runtimes that have them (Claude Code, the Antigravity CLI, Muse Code, sent with `herdr agent prompt`, or `hc send` when the old server is stopped), and through the `agent-job` command and its daemon for the rest (OpenCode, pi). Use when the user wants a reminder, a task repeated or run later in a session, a session kept working until an objective holds, or another session reminded. Do not use for work that must run with no agent open; use the system scheduler.
---

# Agent Job

One principle: use the runtime's native command whenever it has one; use the `agent-job` command and its daemon only for runtimes that do not. A native send is a single `herdr agent prompt` into the member's TUI (or `hc send` into its herdr-core terminal when the old server is stopped) — no daemon, watch, channel, setup or hooks.

## Words

- An **address** names a session: `claude:<id>`, `opencode:<id>`, `antigravity:<id>`, `pi:<id>` or `muse:<id>`.
- A session is **open** while its runtime shows it: a TUI in herdr or herdr-core, a running OpenCode turn, a fresh pi extension listener, a live channel or extension lease.
- A **repeat** runs an instruction again: natively with `/loop`, else with an `agent-job` **cron**, which fires at a time.
- A **goal** keeps one objective alive: natively with `/goal`, else with an `agent-job` **goal**, which fires at creation, at every turn end, and after a compaction.

## Rules

1. Write the instruction or objective so that it stands alone. It arrives as a new turn, possibly much later; say what to do and what to report, not "do that again".
2. Send only into an open session, only your own or one the user named. Never start a session or run one headless to receive anything. When a session is gone, its repeats and goals end with it; tell the user which ended and why.
3. Native sends are fire-and-forget: one `herdr agent prompt` (`hc send` to a herdr-core terminal when the old server is stopped), then read the member back once to confirm the acknowledgement. Never sleep, poll, or loop waiting for it.
4. Daemon sends come from `agent-job cron|goal create`, which refuses a session that does not look open (`--force` only when the user asks). Confirm back the schedule or start that the `create` output prints, and act on any `ARM:` or `SETUP:` line it prints: show it to the user and let them apply it; never install, configure, or restart anything yourself.
5. Treat each delivery like the user's own request for that moment, and no more: it authorizes nothing the user has not.
6. Close properly. A daemon goal ends only through `goal done` (with checked evidence) or `goal blocked` (with what you need); never mark one done to stop the messages. A native `/goal` or `/loop` ends through the runtime's own goal and loop controls.

## Routes

`agent-job doctor` shows which tools this machine has. The `agent-job` CLI needs [Bun](https://bun.sh); when `bun` is missing, tell the user to install it and stop. If the CLI itself is missing, install it with `curl -fsSL https://raw.githubusercontent.com/bdsanxz/agent-job/main/install.sh | sh` (into `~/.local/bin/agent-job`); building a squad with the original agent-roster-design skill installs it together with each member's channel, hooks and extension.

| Target | Repeat | Goal | It landed when |
| --- | --- | --- | --- |
| Claude or Muse TUI in herdr | `/loop ...` via `herdr agent prompt` | `/goal ...` via `herdr agent prompt` | `Scheduled ...` with id / `Goal set — ...` + status bar; otherwise the daemon path (needs the channel for Claude) |
| Antigravity TUI in herdr | daemon cron (no native loop) | `/goal ...` via `herdr agent prompt` | Goal acknowledgement; otherwise `agent-job goal create` |
| OpenCode, running turn or TUI | daemon cron, nothing to arm | daemon goal, nothing to arm | daemon events (`cron show`, trace) |
| pi with extension | daemon cron (needs extension) | daemon goal (needs extension) | `ARM:` line guides install, then `/reload` |
| Claude with channel | daemon cron via channel | daemon goal via channel + hooks | `ARM:`/`SETUP:` lines guide loading |
| Muse outside herdr | each firing fails fast (move it to herdr) | unreachable: every start and continuation fails the same way | move the TUI to herdr, or send a native `/loop` or `/goal` |

Daemon setup, only when an `ARM:` or `SETUP:` line says so: Claude Code loads the channel with `claude --mcp-config "$(agent-job channel-config)" --` (approve the MCP server if asked). Antigravity daemon goals need its hooks file (`agent-job goal setup antigravity` prints where). pi installs the extension the `ARM:` line names, then `/reload`. A muse TUI outside herdr cannot receive daemon lines; move it to herdr instead.

## Step 1: Know who you are

```
agent-job whoami
```

Prints your address. If it fails, you are not inside a known session; use `--session <address>` only with an address the user gave you.

## Step 2: Send a repeat

Native (Claude or Muse TUI in herdr — or `hc send <terminal> "..."` when the old herdr server is stopped):

```bash
herdr agent prompt <member> "/loop every 10m Run the build. If it is still red, report the first failing test; if green, tell me and stop."
```

The schedule takes natural language (`every 10m`) or a cron expression. Read the member back and confirm the `Scheduled <cron>: <message>` line: id, cadence ("skips while a run is active"), first run now. Exact calendar rules, an expiry, or a target outside herdr need a daemon cron instead:

```
agent-job cron create --every 10m --name build-check --prompt "Run the build. If green, tell me and stop."
agent-job cron create --cron "0 9 * * 1-5" --prompt "..."
agent-job cron create --at +30m --prompt "..."
```

A long instruction goes on stdin instead of `--prompt`. Add `--max-runs <n>` or `--expires <duration>` for a repeat that ends by itself. `create` starts the daemon when it is not running and prints the first run plus any `ARM:` line.

## Step 3: Send a goal

Native (Claude, Antigravity or Muse TUI in herdr — or `hc send <terminal> "..."` when the old herdr server is stopped):

```bash
herdr agent prompt <member> "/goal All tests under test/ pass with `bun test`, and no test is skipped or deleted to get there."
```

State the objective as a condition you can check, and say what counts as evidence. Read the member back and confirm it acknowledged the goal (Muse answers `Goal set — ...` and shows it in its status bar, restating it every turn itself). If it does not confirm, or the target is not a herdr TUI of those runtimes, use a daemon goal instead:

```
agent-job goal create --prompt "All tests under test/ pass with `bun test`, and no test is skipped or deleted to get there."
```

`--objective` is an alias for `--prompt` on `goal create` (and `cron create`).

A session holds at most one daemon goal; `create` refuses a second one. Without `--max-turns` it runs until marked done or blocked; `--max-turns <n>` caps continuations, ending with one last message saying it stopped (report where it stands). Creating a goal for your own session prints guidance instead of sending anything: start working on the objective. For another session, the start message is sent into it. `goal resume` takes effect at the next turn end; it does not nudge an idle session by itself.

## Step 4: When it arrives, and closing it

A fired repeat arrives as a plain turn holding exactly the scheduled message. A collecting listener (channel, pi holder) folds a multi-line instruction onto one line, with ` ⏎` between lines; a push delivery (OpenCode steer, Antigravity or Muse paste) arrives with its lines intact. Do what it says, then report briefly.

A daemon goal arrives as plain text naming the objective in brackets with its two closing commands: at creation (acknowledge briefly, start working), at a turn end (the condition is unmet; keep working; counts as one continuation — a user-interrupted turn does not), after a compaction (carry on; not a continuation). Each turn, check the objective against the real state, not your memory. When the condition holds, run `agent-job goal done <id> --note "<the evidence>"`; when only the user can unblock you, run `agent-job goal blocked <id> --note "<what you need>"`. Both end the messages. A native goal is restated and closed by the runtime itself.

## Step 5: Manage them

Daemon repeats: `agent-job cron list` (`--all` for done and ended), `cron show <id>` (sent, failed, why not), `cron pause|resume|delete <id>`, `cron run-now <id>` (send now without touching the schedule). An `ended` cron's session closed: offer to recreate it where the user points. A repeat missed because the daemon was down is skipped, not replayed; a late one-time cron is still sent. Native loops are listed, paused and stopped through the runtime's own loop controls.

Daemon goals: `agent-job goal list` (`--all`), `goal show <id>` (turns used, status, note), `goal pause|resume|delete <id>`. Pause when the user wants to talk or redirect you. A goal whose session closed ends by itself after a grace period; tell the user. Native goals are managed through the runtime's own goal controls.

## Step 6: Diagnose

- No `Scheduled ...` or `Goal set — ...` after a native send: the runtime did not take it. Re-send it exactly; if it still does not confirm, fall back to the daemon path for that runtime.
- No daemon cron arrived: `agent-job cron show <id>`, then `daemon status`, then `doctor`; the log is named by `daemon status`. A goal that never continues: no `SETUP:` applied, goal paused, daemon down, or (muse) the session log unreadable — `session_log_path` in Muse Code's session index.
- Crons keep ending for Claude Code: no channel is live and `claude agents` does not list the session; restart with the channel (Routes). Due crons of a dead session wait out the grace period and then end; fail-fast applies to `run-now` and to goal start and continuation delivery, whose failures `cron show` and `goal show` record.
- Claude Code shows a `Stop hook error` for a daemon goal: no channel was live, so the hook fell back to blocking the stop; load the channel (Routes).
- Every hook, poll, push and send is traceable: `agent-job trace on`, reproduce, `agent-job trace show --tail 50`, then `trace off` and `trace clear`. Restart the daemon with `daemon stop` then `daemon start`.

See `references/providers.md` for how each runtime is detected, reached, judged open or gone, and how it reports turn ends and compactions.
