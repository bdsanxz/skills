---
name: agent-shell
description: |
  Runs shell commands in the background with a fire-and-forget approach and delivers progress notify turns every 2 minutes plus one notify turn to the agent session when each finishes, through the `agent-shell` command (a separate Bun project, installed to `~/.local/bin`). Use when a long command, build, test run or server must keep going without blocking the session, with the result read only after the completion notify turn arrives. Do not use for a quick command that finishes inside one turn.
---

# Agent Shell

Background shell execution for agent sessions. Instead of holding a turn open on a long command, start it with `agent-shell run` and end your response. The command keeps running under a detached supervisor; while it runs your session gets a progress notify turn every 2 minutes with the last output line, and when it finishes one completion notify turn naming the job and its exit, and you read the output with `agent-shell show`. A muse member always runs with `muse --yolo`, so it asks no approval prompts.

Words used throughout:

- A **job** is one background command. Its **id** (such as `sh-1234-5678`) is the only reliable way to name it; its **name** (such as `build`) is a short human label.
- A **progress turn** is the message your session gets every 2 minutes while a job runs: `shell job '<name>' still running (<elapsed> elapsed). Last line: ...`. It tells you whether the shell is stuck or working; no action is needed.
- A **completion turn** is the one message your session gets when a job finishes: `shell job '<name>' done (exit <code>, <time>). Read with: agent-shell show <id>`. It never carries the full output.

Everything goes through the `agent-shell` command, one global binary on `PATH`. Before you first call it, run `agent-shell --version` (want 0.6.1). If that fails, stop and tell the user the `agent-shell` CLI is not installed: `curl -fsSL https://raw.githubusercontent.com/bdsanxz/agent-shell/main/install.sh | sh` installs it at `~/.local/bin/agent-shell` (options `--version`, `--dir`, `--force` for a symlinked target; env `AGENT_SHELL_VERSION`, `AGENT_SHELL_INSTALL_DIR`; checksum verified with `sha256sum` else `shasum -a 256`; a private-repo token never goes on the command line) and needs [Bun](https://bun.sh) on `PATH`. Do not install it yourself. Every command takes `--json`: stdout is exactly one JSON document (`list` keeps JSON lines) with stable snake_case fields; errors print `{"error":{"kind","message","hint"}}` on stdout with the same exit codes (kinds `usage`, `not_found`, `running`, `not_running`, `failed`). Human output without `--json` is unchanged. Then run `agent-shell --help`, and `agent-shell <command> --help` for the command you need, to learn its arguments, defaults, output and exit codes; help runs nothing else.

## Operating rules (must follow)

1. **Separate the task from the wait.** Put the whole command, its directory and the expected output on the `run` line. A job carries no standing duties; its completion turn only says it finished.
2. **Never wait by sleeping or polling.** After you start a job, end your response normally. Progress and completion turns arrive as ordinary turns; a job still running is not a failure. Do not call `sleep`, loop over `agent-shell list` or `agent-shell show`, or hold a blocking shell.
3. **Fire and forget.** `run` returns the job id at once and never blocks. Do not pass anything like `--wait`, and do not tail a log while the job runs.
4. **Read once, from the completion.** A progress turn needs no action: it only shows the last output line. When the completion turn names a job, read it with `agent-shell show <id>`. Do not re-read it after that unless you start new work from it.

## Step 1: Know who you are

Print your caller context and find your notify target:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

Your notify target is your pane ID (`$HERDR_PANE_ID`), or your herdr-core terminal (`$HC_TERMINAL_ID`) when you run outside the old herdr: `run` uses it by default. When the user names another member to receive it (a herdr agent name, pane ID, hc terminal or tab name — hcx resolves tab names), pass it with `--notify <target>` instead. If you are in neither (no `HERDR_PANE_ID` and no `HC_TERMINAL_ID`), the job still runs, but its notify is skipped; say so, and read the job back explicitly.

Notify turns go over the old herdr server (`herdr agent prompt`) when it runs, else herdr-core via `hcx send --agent-only --no-footer --json` only: there is no `hc send` fallback. It needs hcx 0.3.0 or newer, detected once per process with `hcx --version --json`. When hcx is missing or older, the notify is recorded as not delivered and the job result stays stored. hcx looks the target kind up before sending and refuses a plain shell or unknown kind, so a plain-shell target is never notified. Tip: install hcx >= 0.3.0 first. Tip: never send the notify yourself with `hc` or `hcx`; `run` already routes it.

## Step 2: Start a job

```bash
agent-shell run --name build -- bun test
agent-shell run --notify framesmith-lead --cwd /path/to/dir -- sh -c 'sleep 30; echo done'
agent-shell run --name e2e --heartbeat 5m -- sh -c './scripts/e2e.sh'
agent-shell run --name quick --no-heartbeat -- sh -c './scripts/fast.sh'
```

The command is everything after `--`; use `sh -c '...'` for shell features (pipes, redirects, `&&`). Give a short kebab-case `--name` (`build`, `test-e2e`), and `--cwd` when the command must run elsewhere. A bad `--cwd` (missing or not a directory) or a missing executable exits 2 at `run` and creates no job. Tip: fix the directory or command and run again; do not `show` or `check` an id that was never printed.

Every job sends a progress turn with its last output line every 2 minutes by default, so you can tell stuck from working. `--heartbeat <duration>` (minimum `1s`, e.g. `30s`, `5m`) changes the interval. `--no-heartbeat`, `--heartbeat 0` and `--heartbeat off` all disable progress turns, leaving only the completion turn. When the last line is unchanged the turns back off: the interval doubles after each unchanged beat up to 30m, and resets on new output; `--heartbeat-fixed` keeps the fixed interval. `show` prints the current interval (`heartbeat_current_ms` with `--json`). Each beat first reads the target status via `hcx ls --json`: when the agent is busy (`working` or `blocked`) the turn waits, re-checking every few seconds up to 80% of the interval, then sends once with the latest line when the agent is free; a beat still busy at its deadline is skipped, not failed. `show` reports `heartbeats_deferred` for a sent-after-wait beat, and `show`/`check` report counters (`heartbeats sent S (deferred D), skipped K (backoff B, busy U), failed F`); zero progress turns with sent=0 and skipped>0 is expected, not broken. Completion sends unconditionally. Tip: a short job with heartbeats disabled sends no progress turn; do not read that as stuck.

The output prints the job id, the notify target, the heartbeat setting and the read command. When you script the start or parse it, add `--json` and read `id`. When hcx cannot find an explicit `--notify` target, `run` prints a warning line; the job still runs and the completion notify reports the real result. Tip: do not start the job again over a notify-target warning; read the completion notify. For a quick command, pass `--wait <duration>` (e.g. `5s`) to wait for it to finish and print its output and exit status inline instead of ending your turn. It exits with the job's exit code, and 124 on timeout. Tip: use `--wait` only for a quick command; a long job still needs fire and forget. End your turn there.

## Step 3: Read the result

Progress turns arrive while the job runs and need no action: a fresh last line means working. Every progress turn ends with `Next progress in ~Ns.` using the current (possibly backed-off) interval: an unchanged last line only spaces the turns out (back-off), so silence shorter than that is normal, not stuck by itself. The completion turn arrives on its own. Verify the job once before using its result:

```bash
agent-shell check <id>
agent-shell show <id>
```

`check` prints one `ok`/`FAIL` line per record — finished state, recorded exit code, readable output, completion notify outcome — then a `check <id>: 4/4 pass` summary, then a `success` line for the job's own outcome (separate from the records). When you script the verify or parse it, add `--json` and read `state`, `exit_code`, and `notify_outcome`. The notify outcome is typed: `delivered`, `not_started` (a confirmed send that started no turn), `unconfirmed` (a send with no turn status, e.g. opencode TUI), `plain_shell` (the target refused before sending) or `failed`. The notify line is `ok` only for `delivered` or `unconfirmed`. It exits 0 only when all four records pass and the job succeeded (exit 0). It exits 1 when any record fails or the job itself failed. A job with no notify target prints `ok notify: n/a`, not a failure. A completion notify that timed out is `unconfirmed` (it may have landed): `check` reports `ok notify: unconfirmed (delivery not verified)` and does not fail the job. Tip: read the `success` line, not just the `4/4` count; a failed job can pass its records and still exit 1. Tip: never resend a job notification; a `not_started`, `unconfirmed` or `failed` send may already have landed, and the stored result stays readable either way.

A killed or `lost` job fails the check: its partial output stays readable, and no completion notify will ever arrive for a `lost` job (its supervisor died without a final status), so do not wait for one — report it to the user. `clean` removes `lost` jobs like finished ones. A running or unknown job exits 2. When progress notifies were sent, the last one prints as `progress notify: ...` after the notify line; it is informational and changes no pass count. When the check passes, read the output with `show` or `tail`. `show` prints state (including `lost`), exit code, the `error` field, the notify result with its typed outcome (`notify_outcome`, plus `notify_route`, `notify_agent` and `notify_note` when the send ran), the heartbeat setting and current interval, and the output tail. The tail `show`, `tail` and `check` print is sanitised (carriage-return progress collapsed, ANSI stripped) and bounded to the last 256 KiB with a truncation note when cut; the stored `output.log` stays raw. Job storage is private (directories 0700, files 0600). When you script the read or parse it, add `--json` and read `state`, `exit_code`, `output`, and `notify_outcome`. The completion turn still names the `agent-shell show <id>` command that reads the job: follow it. `command_string` is POSIX shell-quoted: paste it to rerun the same command. Tip: a non-integer `--tail` / `--lines` exits 2; pass a positive integer.

A job that fails to start is still recorded as `failed` with its start error in the `error` field, and still sends its completion notify. The final status is written before the completion notify is sent, so `show` after the completion turn already sees the final state. Tip: trust `show` once the completion turn arrives; do not re-read it as still running. Act on it in your next turn: report the failure, fix it, or continue the work that needed it.

## Step 4: Manage jobs

```bash
agent-shell list             # running first, then newest done (your own jobs)
agent-shell kill <id>        # stop a running job (lost clears orphans only); a killed job gets no notify
agent-shell clean            # remove your own finished and lost jobs
agent-shell clean --older-than 7d
```

Jobs are owned by the session that started them (`$HC_TERMINAL_ID` / `$HERDR_PANE_ID`). `list` and `clean` show and remove only your own jobs; `--all` covers every job on the machine and must not be used on shared machines unless the user asks (it deletes other sessions' finished job records). Commands with an explicit job id (`show`, `tail`, `check`, `kill`) work on any job. Jobs from before 0.6.0 have no owner and appear only with `--all`.

`kill` refuses with exit 2 unless the job is running or lost, leaving a finished job's result untouched. It signals the job's whole process group, so children of `sh -c` die too, but only when the leader's start time still matches, so a reused PID is never killed. When the leader is gone the job is marked `lost` with the hint `pgid <n> not signalled: its leader is gone`; orphan children may remain — tell the user, do not hunt them with `kill -9`. Tip: do not `kill` a finished job to clean it up; use `clean`.

A killed or `lost` job keeps its partial output readable and gets no completion notify. `show` prints the heartbeat setting (`heartbeat 120000ms` or `heartbeat off`), the current interval once back-off applies, plus the progress count once one was sent. `clean` never touches running jobs. Tip: `clean` removes your own finished and `lost` jobs; a running job survives it. When you script the list or parse it, add `--json`: it keeps JSON lines, one object per line with `id`, `state`, and `exit_code`.
