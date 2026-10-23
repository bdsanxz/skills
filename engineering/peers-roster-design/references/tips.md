# Tips from earlier squads

Every tip here comes from a real squad: a mistake the designer made, or one the members made because of how the squad was designed. Each gives the situation, what to do, and why it matters. Read the part for a step before you start that step. When you make a new mistake, or catch one, tell the user so it can be added here.

## Step 1: choose how to proceed

### A list of members is not a design

- **Situation:** The request names the members and their agents, and it looks complete enough to skip the guided steps.
- **Practice:** Go straight to Step 4 only when the request settles each member's role, links, project and skills. Names, agents and a one-line purpose do not settle them, so design each member in Step 3. Ask only the questions the request leaves open.
- **Why:** Skipped, Step 3's topics fall back to generic defaults. Members then start with roles that overlap and communications that name nobody in particular, and the gaps show up only once they are working.

### Check that each agent can answer, not only that it is installed

- **Situation:** A member's agent is installed and signed in, so the squad is built on it. At launch its model answers the first prompt with "Individual quota reached … Resets in 74h59m", and the member never takes a turn.
- **Practice:** Before you propose an agent and model, run one short prompt on each, such as `agy --model <model> -p "Reply OK" </dev/null` or `opencode run -m <model> "Reply OK"`. Propose another model or agent for any that fails, and tell the user why.
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

## Step 6: launch the squad

### Keep the whole squad in one laid-out workspace

- **Situation:** Members are started by hand, one at a time, or each relaunch opens its own workspace. Or so many panes share one tab that each is too narrow to read.
- **Practice:** Start members only through `launch`. It puts the whole squad in one workspace laid out by the hierarchy: the supervisor's pane largest, across the top, and at most five members per window. Relaunch one member with `launch --member <name>`, which puts it back in its own window. Read the `WINDOW` lines of `--dry-run` with the user before the real launch.
- **Why:** In one workspace, the user sees the squad's hierarchy at a glance and finds every member in one place. Panes scattered over workspaces, or squeezed into one tab, hide who leads. Narrow panes also wrap an agent's start-up dialogs so that they can no longer be recognised and answered.

### Preview before you launch

- **Situation:** A full launch is started before anything has been tried on this machine.
- **Practice:** Run `launch --dry-run` first and fix every `PROBLEM`. Then launch. When a member fails, `launch` stops there: fix the cause, close the panes it names, and start each missing member with `--member <name>`. Do not start the whole squad again.
- **Why:** The dry run catches a missing agent, an unknown model or an unbuilt member before any pane opens. Resuming with `--member` keeps the members that already run, with their sessions and history.

### A relaunched member has a new address

- **Situation:** A member is relaunched, and its old session still shows in `peers list --all-dirs` next to the new one.
- **Practice:** After a relaunch, take the newest session in the member's cwd as its address. Give that address to the members that message it, and stop the old session.
- **Why:** A message sent to the old session goes to a conversation nobody runs. Its sender then waits for a reply that never comes.

### Do not watch the squad after the launch

- **Situation:** The squad runs, and you want to know whether the members work.
- **Practice:** Give the user the lead's address and end your turn. React only to what reaches you: a message, the user, or a notification.
- **Why:** Members report through peers, and each reply arrives as a turn. Sleeping, polling or reading their panes holds your turn and finds nothing that their messages would not have told you.
