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

Everything goes through the `agent-shell` command, one global binary on `PATH`. Before you first call it, run `agent-shell --version`. If that fails, stop and tell the user the `agent-shell` CLI is not installed: `curl -fsSL https://raw.githubusercontent.com/bdsanxz/agent-shell/main/install.sh | sh` installs it at `~/.local/bin/agent-shell` and needs [Bun](https://bun.sh) on `PATH`. Do not install it yourself. Then run `agent-shell --help`, and `agent-shell <command> --help` for the command you need, to learn its arguments, defaults, output and exit codes; help runs nothing else.

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

Your notify target is your pane ID (`$HERDR_PANE_ID`), or your herdr-core terminal (`$HC_TERMINAL_ID`) when you run outside the old herdr: `run` uses it by default. When the user names another member to receive it (a herdr agent name, pane ID or hc terminal), pass it with `--notify <target>` instead. If you are in neither (no `HERDR_PANE_ID` and no `HC_TERMINAL_ID`), the job still runs, but its notify is skipped; say so, and read the job back explicitly.

Notify turns go over the old herdr server (`herdr agent prompt`) when it runs, else herdr-core. There, an agent target is notified untagged with `hcx send --no-footer`: no `<hc from>` tag and no sender footer. It needs hcx 0.1.3 or newer; an older hcx falls back to the tagged `hc send`. A plain shell, or a kind that cannot be determined, keeps the tagged `hc send`. An opencode tab counts as an agent even when it is listed as a shell: its foreground program is checked once more. Tip: never send the notify yourself with `hc` or `hcx`; `run` already routes it.

## Step 2: Start a job

```bash
agent-shell run --name build -- bun test
agent-shell run --notify framesmith-lead --cwd /path/to/dir -- sh -c 'sleep 30; echo done'
agent-shell run --name e2e --heartbeat 5m -- sh -c './scripts/e2e.sh'
agent-shell run --name quick --no-heartbeat -- sh -c './scripts/fast.sh'
```

The command is everything after `--`; use `sh -c '...'` for shell features (pipes, redirects, `&&`). Give a short kebab-case `--name` (`build`, `test-e2e`), and `--cwd` when the command must run elsewhere. A bad `--cwd` (missing or not a directory) or a missing executable exits 2 at `run` and creates no job. Tip: fix the directory or command and run again; do not `show` or `check` an id that was never printed.

Every job sends a progress turn with its last output line every 2 minutes by default, so you can tell stuck from working. `--heartbeat <duration>` (minimum `1s`, e.g. `30s`, `5m`) changes the interval. `--no-heartbeat`, `--heartbeat 0` and `--heartbeat off` all disable progress turns, leaving only the completion turn. Tip: a short job with heartbeats disabled sends no progress turn; do not read that as stuck.

The output prints the job id, the notify target, the heartbeat setting and the read command. For a quick command, pass `--wait <duration>` (e.g. `5s`) to wait for it to finish and print its output and exit status inline instead of ending your turn. It exits with the job's exit code, and 124 on timeout. Tip: use `--wait` only for a quick command; a long job still needs fire and forget. End your turn there.

## Step 3: Read the result

Progress turns arrive every 2 minutes while the job runs and need no action: a fresh last line means working, an unchanged last line means possibly stuck. The completion turn arrives on its own. Verify the job once before using its result:

```bash
agent-shell check <id>
agent-shell show <id>
```

`check` prints one `ok`/`FAIL` line per record — finished state, recorded exit code, readable output, delivered completion notify — then a `check <id>: 4/4 pass` summary, then a `success` line for the job's own outcome (separate from the records). It exits 0 only when all four records pass and the job succeeded (exit 0). It exits 1 when any record fails or the job itself failed. A job with no notify target prints `ok notify: n/a`, not a failure. Tip: read the `success` line, not just the `4/4` count; a failed job can pass its records and still exit 1.

A killed job fails the check (partial output, no notify). A running or unknown job exits 2. When progress notifies were sent, the last one prints as `progress notify: ...` after the notify line; it is informational and changes no pass count. When the check passes, read the output with `show` or `tail`. `show` prints state, exit code, the `error` field, the notify result, the heartbeat setting and the output tail. Tip: a non-integer `--tail` / `--lines` exits 2; pass a positive integer.

A job that fails to start is still recorded as `failed` with its start error in the `error` field, and still sends its completion notify. The final status is written before the completion notify is sent, so `show` after the completion turn already sees the final state. Tip: trust `show` once the completion turn arrives; do not re-read it as still running. Act on it in your next turn: report the failure, fix it, or continue the work that needed it.

## Step 4: Manage jobs

```bash
agent-shell list             # running first, then newest done
agent-shell kill <id>        # stop a running job only (exit 2 otherwise); a killed job gets no notify
agent-shell clean            # remove finished jobs
agent-shell clean --older-than 7d
```

`kill` refuses with exit 2 unless the job is still running, leaving a finished job's result untouched. The child is signalled only when its process start time still matches, so a reused PID is never killed. Tip: do not `kill` a finished job to clean it up; use `clean`.

A killed job keeps its partial output readable and gets no completion notify. `show` prints the heartbeat setting (`heartbeat 120000ms` or `heartbeat off`) plus the progress count once one was sent. `clean` never touches running jobs. Tip: `clean` removes only finished jobs; a running job survives it.
