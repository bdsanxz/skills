---
name: agent-shell
description: |
  Runs shell commands in the background with a fire-and-forget approach and delivers one notify turn to the agent session when each finishes, through the `agent-shell` command (a separate Bun project, installed to `~/.local/bin`). Use when a long command, build, test run or server must keep going without blocking the session, with the result read only after the notify turn arrives. Do not use for a quick command that finishes inside one turn, or for work that needs progress watched while it runs.
---

# Agent Shell

Background shell execution for agent sessions. Instead of holding a turn open on a long command, start it with `agent-shell run` and end your response. The command keeps running under a detached supervisor; when it finishes, your session gets one notify turn naming the job and its exit, and you read the output with `agent-shell show`. A muse member always runs with `muse --yolo`, so it asks no approval prompts.

Words used throughout:

- A **job** is one background command. Its **id** (such as `sh-1234-5678`) is the only reliable way to name it; its **name** (such as `build`) is a short human label.
- A **notify turn** is the one message your session gets when a job finishes: `shell job '<name>' done (exit <code>, <time>). Read with: agent-shell show <id>`. It never carries the full output.

Everything goes through the `agent-shell` command, one global binary on `PATH`. Before you first call it, run `agent-shell --version`. If that fails, stop and tell the user the `agent-shell` CLI is not installed: `curl -fsSL https://raw.githubusercontent.com/bdsanxz/agent-shell/main/install.sh | sh` installs it at `~/.local/bin/agent-shell` and needs [Bun](https://bun.sh) on `PATH`. Do not install it yourself. Then run `agent-shell --help`, and `agent-shell <command> --help` for the command you need, to learn its arguments, defaults, output and exit codes; help runs nothing else.

## Operating rules (must follow)

1. **Separate the task from the wait.** Put the whole command, its directory and the expected output on the `run` line. A job carries no standing duties; its notify turn only says it finished.
2. **Never wait by sleeping or polling.** After you start a job, end your response normally. The notify turn arrives as an ordinary turn; a job still running is not a failure. Do not call `sleep`, loop over `agent-shell list` or `agent-shell show`, or hold a blocking shell.
3. **Fire and forget.** `run` returns the job id at once and never blocks. Do not pass anything like `--wait`, and do not tail a log while the job runs.
4. **Read once, from the notify.** When the notify turn names a job, read it with `agent-shell show <id>`. Do not re-read it after that unless you start new work from it.

## Step 1: Know who you are

Print your caller context and find your notify target:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

Your notify target is your pane ID (`$HERDR_PANE_ID`): `run` uses it by default, so the notify turn reaches this session. When the user names another member to receive it (a herdr agent name or pane ID), pass it with `--notify <target>` instead. If you are not inside herdr (no `HERDR_PANE_ID`), the job still runs, but its notify is skipped; say so, and read the job back explicitly.

## Step 2: Start a job

```bash
agent-shell run --name build -- bun test
agent-shell run --notify framesmith-lead --cwd /path/to/dir -- sh -c 'sleep 30; echo done'
```

The command is everything after `--`; use `sh -c '...'` for shell features (pipes, redirects, `&&`). Give a short kebab-case `--name` (`build`, `test-e2e`), and `--cwd` when the command must run elsewhere. The output prints the job id, the notify target and the read command. End your turn there.

## Step 3: Read the result

The notify turn arrives on its own. Read the job once:

```bash
agent-shell show <id>
agent-shell tail <id> --lines 50
```

`show` prints the state (`done`, `failed`, `killed`), the exit code, the notify detail and the tail of the output. Act on it in your next turn: report the failure, fix it, or continue the work that needed it.

## Step 4: Manage jobs

```bash
agent-shell list             # running first, then newest done
agent-shell kill <id>        # stop a running job; a killed job gets no notify
agent-shell clean            # remove finished jobs
agent-shell clean --older-than 7d
```

A killed job keeps its partial output readable. `clean` never touches running jobs.
