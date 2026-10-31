# Tips from earlier squads

Every tip here comes from a real squad: a mistake the designer made, or one the members made because of how the squad was designed. Each gives the situation, what to do, and why it matters. Read the part for a step before you start that step. When you make a new mistake, or catch one, tell the user so it can be added here.

## Step 1: choose how to proceed

### A list of members is not a design

- **Situation:** The request names the members and their agents, and it looks complete enough to skip the guided steps.
- **Practice:** Go straight to Step 4 only when the request settles each member's role, links, project and skills. Names, agents and a one-line purpose do not settle them, so design each member in Step 3. Ask only the questions the request leaves open.
- **Why:** Skipped, Step 3's topics fall back to generic defaults. Members then start with roles that overlap and communications that name nobody in particular, and the gaps show up only once they are working.

### Check that each agent can answer, not only that it is installed

- **Situation:** A member's agent is installed and signed in, so the squad is built on it. At launch its model answers the first prompt with "Individual quota reached … Resets in 74h59m", and the member never takes a turn.
- **Practice:** Before you propose an agent and model, run one short prompt on each, such as `agy --model <model> -p "Reply OK" </dev/null`, `opencode run -m <model> "Reply OK"` or `pi --model <model> -p "Reply OK" </dev/null`. Propose another model or agent for any that fails, and tell the user why.
- **Why:** A member out of quota reads no message and sends none, so nothing reports it. Its lead assigns it work and waits for an answer that never comes, until someone notices the silence.

## Step 3: design each member

### Leave a task's interfaces out of ROLE.md

- **Situation:** A member's ROLE.md names a concrete function or payload, such as `render_stats(stats)`, and the lead's first request names it differently.
- **Practice:** In ROLE.md, say what the member owns and whom it agrees interfaces with. Leave function names, field names and other details of one task to the lead's requests and the project's spec.
- **Why:** When the role file and the request disagree, each member that reads both stops to ask which one counts. In one sprint two members each spent a round settling a single function name.

### Write COMMUNICATIONS.md from the member's own side

- **Situation:** Several members get the same communications text, or one written from the lead's point of view.
- **Practice:** Write each member's COMMUNICATIONS.md as that member would read it. Say whom it reports to, which members it may message and about what, and what it sends back and when. Name the real members of this squad.
- **Why:** A member acts only on its own file. A text written for someone else tells it neither whom to answer nor who decides for it.
- **Example:** "You report to `lead`. Send `api` a notice when a screen needs a new field; ask `lead`, not `api`, when the scope is unclear."

### One boss for each member

- **Situation:** A member does work for one member and also answers to another, such as a tester that reports to both a senior worker and the lead.
- **Practice:** Give each member exactly one `reports_to`, and say in its COMMUNICATIONS.md that only that member decides its scope. Use `talks_to` for information, not for decisions.
- **Why:** Two bosses each decide the same question, often differently. The member then follows whichever answer came last, and the two bosses spend turns undoing each other.

### Give each member its own share of the machine

- **Situation:** Several members run servers, databases or test suites on the same machine.
- **Practice:** Name each member's own port, database name or other shared resource in its PROJECT.md or ROLE.md. Say that it stops only the processes it started, by their exact process ID.
- **Why:** Members that share a port or kill processes by a broad name pattern stop each other's servers and test runs. Each then reports a failure that the other one caused.
- **Example:** "Your dev server runs on port 8082. Stop it with `kill <pid>` when you are done; never `pkill -f node`."

### Do not give file-writing goals to a member that cannot edit files

- **Situation:** A member whose instructions forbid file edits, such as an OpenCode member set up read-only, receives a goal that needs file writes.
- **Practice:** Give file-writing goals only to members allowed to edit files; give a member that cannot edit files goals it can satisfy by reading, reporting or reviewing.
- **Why:** The member cannot do what its instructions forbid, so the goal's evaluator keeps finding the condition unmet and the goal never clears.

## Step 5: build the squad

### Test the loop and goal before calling it done

- **Situation:** A squad with opencode or pi members is built, `/loop` and `/goal` look present, and the member finishes the work, so the loop and goal are assumed working.
- **Practice:** Test them in order, in a scratch folder, with the user's go-ahead first: a live test starts real sessions. Close every test session afterwards (`hcx done`), and report only what the roster log shows:
  1. Confirm `ROSTER_LOG` is set for the session under test (the build writes it into the opencode member's `opencode.json` loop entry; pi falls back to its default log path). No log file means the sidecar or extension is not running, so the hook is not working.
  2. Never kill the OpenCode sidecar process or stop the OpenCode service from a test, and never delete or truncate a roster log a running sidecar writes to. The service is shared by every squad on the machine and loads each folder's plugin and MCP sidecar (`roster`) once: killing either leaves the folder still showing `roster` in the sidebar while its tools are dead, so `/goal` and `/loop` silently do nothing.
  3. After rebuilding the sidecar, the plugin, or the loop extension, restart the session before testing the new code: for opencode, test in a fresh folder or restart the service (`opencode service restart`; confirm with `opencode service --help`), warning the user first since it drops every squad's sessions; for pi, start a new session.
  4. Set a goal that cannot finish in one turn, for example "append exactly one character per turn until the sentence is complete", so the continuation hook is really exercised.
  5. Read the log, not the final result: a working goal shows `goal_set`, `goal_check`, `goal_continue` and `goal_achieved` (`timer_scheduled` and `timer_fired` for loops). No events means the sidecar is not running. The model can do the work by itself, so the result alone proves nothing.
  6. When a goal goes quiet, look for `goal_eval_failed`: an evaluator failure (a non-JSON verdict) is retried after `ROSTER_GOAL_RETRY_MS` (default 10000, in both opencode and pi) up to the failure cap (default 3), then the goal stops.
- **Why:** The log is the only witness that the hook ran. Every shortcut — trusting the result, reusing a stale session, or touching the shared service — produces a test that passes while the loop and goal are dead.

## Step 6: launch the squad

### Keep the whole squad in one workspace, one tab per member

- **Situation:** Members are started by hand, one at a time, or each relaunch opens its own workspace. Or members are split into panes that share one tab, and each pane is too narrow to read.
- **Practice:** Start members only through `launch`. It puts the whole squad in one workspace, each member in a tab of its own, in hierarchy order with the supervisor first. Relaunch one member with `launch --member <name>`, which puts its tab back in its place. Read the `TAB` lines of `--dry-run` with the user before the real launch.
- **Why:** In one workspace, the user finds every member in one place, and the tab order shows who leads. Members scattered over workspaces are hard to find. Panes split side by side are narrow, and a narrow pane wraps an agent's start-up dialogs so that they can no longer be recognised and answered.

### Preview before you launch

- **Situation:** A full launch is started before anything has been tried on this machine.
- **Practice:** Run `launch --dry-run` first and fix every `PROBLEM`. Then launch. When a member fails, `launch` stops there: fix the cause, close the tabs of the panes it names, and start each missing member with `--member <name>`. Do not start the whole squad again.
- **Why:** The dry run catches a missing agent, an unknown model or an unbuilt member before any pane opens. Resuming with `--member` keeps the members that already run, with their sessions and history.

### Start the OpenCode service from a login shell

- **Situation:** The OpenCode background service was started from a non-login shell (such as an hc terminal without `~/.zshrc`), so it lacks a provider API key; an opencode member then fails with "API key is required".
- **Practice:** Before `launch`, check the service process has each opencode member's provider key (`launch` does this itself and prints a WARN naming the missing variable). When it warns, restart the service from a shell that sets the key (`opencode service stop && opencode service start`), then launch again.
- **Why:** The member inherits the service's environment, not yours. A key set in your shell never reaches a service started without it.

### Restart the OpenCode service after a sidecar change

- **Situation:** The loop sidecar or plugin was rebuilt, or a sidecar died, and an opencode member's `/loop` or `/goal` tools stop working or behave oddly.
- **Practice:** Tell the user to run `opencode service stop && opencode service start` from a login shell, then try again.
- **Why:** The OpenCode background service keeps one MCP sidecar per project and does not restart it when the plugin build changes, so the member keeps talking to the old or dead sidecar until the service restarts.

### A relaunched member has a new address

- **Situation:** A member is relaunched, and its old session still shows in `peers list` next to the new one.
- **Practice:** After a relaunch, take the newest session in the member's cwd as its address. Give that address to the members that message it, and stop the old session.
- **Why:** A message sent to the old session goes to a conversation nobody runs. Its sender then waits for a reply that never comes.

### Do not watch the squad after the launch

- **Situation:** The squad runs, and you want to know whether the members work.
- **Practice:** Give the user the lead's address and end your turn. React only to what reaches you: a message, the user, or a notification.
- **Why:** Members report through peers, and each reply arrives as a turn. Sleeping, polling or reading their panes holds your turn and finds nothing that their messages would not have told you.
