---
name: agent-roster-design
description: |
  Designs, sets up and launches a squad: long-lived agent sessions (Claude Code, OpenCode, Antigravity CLI, pi, Muse Code), each in its own directory with its own role, agent, model and effort, that talk through `peers` and receive crons and goals through `agent-job`. Guides the user one question at a time, writes each member's files, installs their skills and tools, and can start the squad in herdr. Use when the user wants to create, staff, extend or reorganize a squad or team of agents, or give agents standing roles. Do not use to message peers or schedule work for a session; use the peers or agent-job skill.
---

# Agent roster design

Words used throughout:

- A **squad** is a team of agent sessions that work toward one goal. Each **member** is one long-lived session of one **agent** (`claude` for Claude Code, `opencode` for OpenCode, `agy` for the Antigravity CLI, `pi` for pi, `muse` for Muse Code) running one **model** at one **effort** level (`low`, `medium`, `high`, `xhigh` or `max`: how hard the model thinks before it answers), started in its own directory, its **cwd**. Each member's agent, model and effort are its own: a squad may mix them freely. An `opencode` member with no model in the roster uses the model and effort its own `opencode.json` or `/models` sets.
- The **workspace** is the squad's root directory. Each member's cwd is `<workspace>/<member cwd>`, one level down.
- The **roster** is `<workspace>/roster.json`: the squad's goal and its members. It is the source of truth for who exists and who talks to whom.
- **You** are the designer. You are not a member: no member reports to you, and you do not appear in the roster. The squad reports to `user`, the person or session that gives it work.

Run the script as `bun scripts/roster.js`, with this skill's directory as the base. It needs only Bun; when `bun` is not found, ask the user to install it (https://bun.sh). Every command takes the workspace path; `--member <name>` limits it to one member. Before you first call it, run `bun scripts/roster.js --help`, and `bun scripts/roster.js <command> --help` (or `bun scripts/roster.js help <command>`) for the command you need, to learn its arguments, output and exit codes; help runs nothing else.

## Rules

- Create nothing (no workspace, directory, file, repository or skill install) until the user has confirmed the full roster in Step 4.
- One member per cwd, one cwd per member. A member's cwd is a plain directory, never a repository checkout: the member clones its repository into a subdirectory of its cwd. The script refuses to overwrite a `CLAUDE.md` or `AGENTS.md` it did not generate.
- Never write secrets (tokens, passwords, keys) into member files. Name the environment variable or file where the member finds them instead.
- Edit the four member files and `roster.json`; never edit a generated `CLAUDE.md` or `AGENTS.md`. Rerun the script instead.
- Install skills only through the skills CLI (`npx -y skills@latest`), only into a member's cwd (never globally with `-g`), and only the skills the user agreed to. `build` runs the installs for you.

Before Steps 1, 3 and 6, read that step's part of `references/tips.md`: the mistakes earlier squads made there, and how to avoid them.

## Step 1: Read the request and choose how to proceed

1. Read the request and every file it names. Check which agents are installed with `command -v claude opencode agy pi muse`, which models they offer with `opencode models`, `agy models` and `pi --list-models` (Muse Code lists none: use a model id such as `muse-spark-1.3`), and which effort levels each model has with `opencode api model.list` (each model's `variants`) and `agy models` (one id per level, such as `gemini-3.8-flash-low`); claude, pi and muse take every level for every model, so their levels need no lookup. Use only agents that are installed and signed in. Check for the `peers` CLI with `command -v peers || ls ~/.local/bin/peers`; when it is missing, `build` installs it in Step 5, so only note it for the summary. Check for the `agent-job` CLI the same way, with `command -v agent-job || ls ~/.local/bin/agent-job`; `build` installs it too when it is missing.
2. Look up what you can instead of asking: the repository's URL, default branch, layout, and build and test commands come from the repository itself.
3. Decide how much to ask:
   - The request settles the goal, the members, and each member's role, links, project and skills: fill any small gap with a sensible default, then go to Step 4.
   - Anything else: guide the user through Steps 2 to 4. Skip each question the request or your lookups already answer, and state what you found instead.

Ask in this way throughout the guided steps:

- One question per message. Use your runtime's question tool when it has one.
- Propose a default with every question: draft it from the goal and the earlier answers, put it first, and mark it as recommended. Offer two or three real alternatives, and let the user write their own.
- When the user answers "you decide", take your default and say so.

Keep the design in a draft file outside the workspace: your scratch or plan directory when your runtime gives you one, otherwise `/tmp/<squad>-roster-draft.md`. Update it after each settled answer. When your conversation was compacted or the work is resumed, read the draft and continue from the first open question.

## Step 2: Clarify the squad's goal

Settle these, in order:

1. **Goal:** what the squad is for, in one or two sentences, and what "done" means for it.
2. **Repositories:** for each, the URL, default branch, and build and test commands. When the work needs a repository that does not exist yet, propose creating one and ask where; it is created in Step 5, after the user confirms.
3. **Members:** propose the fewest members that cover the goal without overlapping, as a list: name, one-line summary, agent, model and effort. Design them this way:
   - Give each member one area of ownership (a directory, a layer or a kind of work). Two members must never own the same files.
   - Default to one lead that reports to `user`, assigns work and reviews results, with every other member reporting to the lead.
   - Pick each member's agent, model and effort by `references/agents-and-models.md`: from what the user wants, what is installed and what the member's work needs. When the user has no preference, make the lead a `claude` member. Give `high` or above to members that plan, review or reason through hard problems, and `low` to members doing simple, mechanical work. Put a choice that several members share in the roster's `defaults`, and leave a model or effort out when the agent's own default is fine.
   - Name members after their role, in kebab-case (`lead`, `api`, `web`, `docs`); the name is also the cwd. Propose a human-readable name for each too, such as `Lena` or `Rina`: what people and the other members call it, shown wherever the member name would be hard to read. Write it without the role: `peers` shows the role next to it in every message (`Rina (api)`), so `Rina (backend)` would show it twice. Leave it out when the user wants none; the member name is then shown.
4. **Workspace:** the path of the squad's root directory. Default: `~/squads/<squad name>`.
5. **Standing preferences** that members follow, such as code style, branch rules or review rules.

## Step 3: Design each member, one at a time

Take the members in order, the lead first. For each one, settle these five topics in order, each as one question with a drafted default. `references/member-files.md` says what each file must contain; draft every default to that contract.

1. **Role** (`ROLE.md`): the tasks the member owns, its scope (what it may change, and what it leaves to whom), what "done" means for its tasks, and which decisions it makes alone or asks about.
2. **Communications** (`COMMUNICATIONS.md`): whom it reports to (`reports_to`), whom it may message directly and about what (`talks_to`), and how it answers. Default: it reports to the lead, the lead reports to `user`, and `talks_to` links only members whose work meets, such as a front end and the API it calls.
3. **Project** (`PROJECT.md`): the repository URL, where the checkout lives in its cwd, the branch rule, and what the project is and contains. Default: the squad's repository from Step 2, with the same text as the members before it.
4. **Memory** (`MEMORY.md`): at design time, only what the user asked for explicitly, such as standing preferences and special behaviours; the member adds its own lessons later. Default: the standing preferences from Step 2 that apply to this member, or only the `# Memory` heading when there are none.
5. **Skills** (besides `peers`, which every member gets): follow `references/finding-skills.md` to find, check and propose skills for this member, then ask which ones it gets.

Then show the member's design in one short summary: its human-readable name, its agent, model and effort (or "the agent's default" for either), the four files in brief, and its skills. Ask the user to approve it or name what to change.

When a later member's design changes an earlier one, for example a new `talks_to` link that the other member's COMMUNICATIONS.md must name, update the earlier member's draft and tell the user.

## Step 4: Confirm the full roster

Show the whole design in one message:

- the squad's goal, the workspace path and the repositories;
- a table with one row per member: name, human-readable name, agent, model and effort (or "agent default"), role summary, reports to, talks to, skills, and any `defaults` the roster sets;
- what Step 5 will do: install the `peers` CLI when Step 1 found it missing and the `agent-job` CLI, create any new repository, the workspace and each member's cwd, write the files, and run `npx -y skills@latest add ...` in each member's cwd for `peers`, `agent-job` and its skills; for Claude Code members, also configure the peers and agent-job channels and the agent-job goal hooks, and for Antigravity members the agent-job goal hooks.

Ask one question: create the squad as shown, or change something. Apply each change, show the changed rows, and ask again until the user confirms. When the request itself said to create the squad without asking, the summary is enough: show it and go on.

## Step 5: Create the squad

1. Create any new repository the confirmed design calls for. Create the workspace and each member's cwd, and write `<workspace>/roster.json` from the confirmed design:

   ```json
   {
     "squad": "shop",
     "goal": "Add saved carts to the Shop storefront, end to end.",
     "defaults": {"agent": "opencode", "models": {"opencode": "opencode/beam-free"}, "effort": "low"},
     "members": [
       {"name": "lead", "display_name": "Lena", "agent": "claude", "model": "opus", "effort": "high", "cwd": "lead",
        "summary": "Plans the work, assigns it, reviews and merges results",
        "reports_to": "user", "talks_to": ["api", "web"]},
       {"name": "api", "cwd": "api",
        "summary": "Builds the saved-cart endpoints in api/",
        "reports_to": "lead", "talks_to": ["web"],
        "skills": [{"source": "acme/agent-skills", "skill": "go-testing"}]},
       {"name": "web", "agent": "agy", "model": "gemini-3.8-flash", "effort": "medium", "cwd": "web",
        "summary": "Builds the saved-cart UI in web/",
        "reports_to": "lead", "talks_to": ["api"]}
     ]
   }
   ```

   - `summary` is one line; it appears in every member's squad directory.
   - `display_name` is optional: the member's human-readable name, 1 to 48 characters on one line, without `|` or a backtick, and unique in the squad. Write a name, not a name with the role: `Lena`, not `Lena (lead)`, since `peers` adds the member name as the role wherever it shows the display name. It heads the member's instruction file, appears in every squad directory and in `check`'s `MEMBER` lines, is sent with every message the member sends, and at launch labels the member's herdr tab and pane and titles its session. Without it, the member name is shown everywhere. `name` stays the member's ID: `reports_to`, `talks_to`, `--member` and every command use it.
   - `reports_to` is a member name or `user`. At least one member reports to `user`, and every report chain must reach it.
   - `agent` is `claude`, `opencode`, `agy`, `pi` or `muse`, `model` a model valid for that agent, and `effort` a level its agent and model support. All three are optional. In this example `lead` runs claude on opus at high effort to plan and review, `api` takes opencode, beam-free and low effort from `defaults` for its narrow endpoint work, and `web` runs agy on Gemini Flash at medium effort. An opencode member with no model at all uses whatever its own `opencode.json` or `/models` sets. A muse member names a model id such as `muse-spark-1.3`; it takes every effort level. `references/agents-and-models.md` gives the fallback order, the model names and the effort levels each agent takes.
   - `skills` is optional. Write each agreed skill `<owner/repo>@<skill>` as `{"source": "<owner/repo>", "skill": "<skill>"}`. Every member gets `peers` and `agent-job` without listing them. To install either from somewhere other than the copy next to this skill, set `"peers_source"` or `"agent_job_source"` at the top level. A local `source`, `peers_source` or `agent_job_source` must be an absolute path, since the install runs in the member's cwd.

2. Write each member's `PROJECT.md`, `ROLE.md`, `COMMUNICATIONS.md` and `MEMORY.md` in its cwd, from its approved design, following `references/member-files.md`.

3. Check the design:

   ```bash
   bun scripts/roster.js check <workspace>
   ```

   It prints `OK <n> members`, one `MEMBER <name>: agent ..., model ..., effort ...` line per member (`MEMBER <name> (<display name>): ...` when it has one), saying where each value came from, and one `TAB` line per member, in the order of its herdr tabs (Step 6), or one `PROBLEM` line per issue: a `layout:` fault, a bad name, display name or cwd, an unknown agent, a model that is not valid for its agent or that the agent does not list, an effort level the member's agent and model do not support, a link to a member that does not exist, a report chain that never reaches `user`, a missing or empty file, a COMMUNICATIONS.md that never names a member the roster links it to, or an existing hand-written `CLAUDE.md`/`AGENTS.md`. Fix every problem and run it again until it prints `OK`. Compare the `MEMBER` lines with the confirmed agents, models and efforts. A `NOTE` that a model or effort cannot be confirmed means that agent's CLI is missing here. A `NOTE` that a member uses the nearest level means `defaults.effort` names a level its model lacks; tell the user, or set that member's own `effort`. When a fix changes what the user confirmed, show the change and get their confirmation before you build.

4. Build the squad:

   ```bash
   bun scripts/roster.js build <workspace>
   ```

   First, when no `peers` binary is on `PATH` or in `~/.local/bin`, it installs the `peers` CLI with its release install script and prints `INSTALLED peers <version> at <path>`. While the `peers` repository is private, the script needs a GitHub token: `GITHUB_TOKEN`, or the token of a GitHub CLI signed in with `gh auth login`. When the install fails, `build` stops before it touches any member and prints the script's output:
   - It cannot fetch the script, or the output says the repository is private: ask the user to sign in with `gh auth login` in their own terminal, or to set `GITHUB_TOKEN`, then build again. Never ask for the token itself.
   - Any other failure: show the user the output and the manual command it prints.

   When the `INSTALLED` line ends with a `WARNING` that the directory is not on `PATH`, members cannot run `peers`. Tell the user to add the directory to `PATH` in their shell profile, and to restart herdr from their own terminal before Step 6, so the members inherit it.

   Next, when no `agent-job` command is on `PATH` or in `~/.local/bin`, it installs the `agent-job` CLI with its release install script and prints `INSTALLED agent-job <version> at <path>`. It needs Bun, which runs `agent-job`. A failed install stops the build before it touches any member and prints the script's output and the manual command; handle it, and a `WARNING` that the directory is not on `PATH`, as for `peers`.

   Then, for each member, it:

   1. Writes the instruction file the agent loads on start: `CLAUDE.md` (claude) or `AGENTS.md` (opencode, agy, pi, muse). It references the four files by path and never copies them, so each stays the one source of truth: `CLAUDE.md` imports them with `@<path>`, which Claude Code loads itself, and `AGENTS.md` lists their paths and tells the member to read them first in every session. It adds a squad directory table (each member's agent, model, effort, summary, directory and boss) and how to find addresses.
   2. Installs `peers`, `agent-job` and the member's skills into its cwd with `npx -y skills@latest add <source> --skill <name> -a <agent> -y --copy`: into `.claude/skills/` for claude, `.agents/skills/` for opencode, agy, pi and muse. The skills CLI names no muse agent yet, so a muse member installs with `-a opencode`, which writes the same shared `.agents/skills/` directory that Muse Code reads as its project skills.
   3. Writes `.peers.json` (`{"role": "<member name>", "display_name": ..., "squad": "<squad>", "agent": ..., "model": ..., "effort": ...}`, with `display_name` only when the roster sets one) into the member's cwd. The `peers` command reads the role and stores it with every message the member sends, and the display name when it has one, so receivers see `<display name> (<member name>)` and know which role wrote it and what to call it; `launch` reads the agent, model and effort it was built for.
   4. Applies the agent's own setup. It never writes an opencode member's `opencode.json`: `launch` sets an opencode member's model and effort through OpenCode's API instead. For a claude member it adds the peers and agent-job channels to the project's `.mcp.json` and approves them in `.claude/settings.local.json`, so the member loads them without a prompt, and adds the agent-job goal hooks (`Stop`, and `SessionStart` after a compaction or resume) to the same `.claude/settings.local.json`. For an agy member it writes the agent-job goal hooks into `<cwd>/.agents/hooks.json`. An opencode member needs no setup: the agent-job daemon reaches it directly, and a muse member needs none either: its notifications arrive through an armed `peers watch`, and agent-job polls its session log. For a pi member it checks that the installed peers CLI writes the peers extension for pi (`peers pi-extension --path`), which launch loads so the member gets notifications as turns, together with the agent-job extension (`agent-job pi-extension --path`) that delivers crons and goals; a peers CLI without it stops the build, fixed by updating peers (rerunning its install script). A claude, agy or muse member's model and effort are passed on its command line at launch (`--model`, `--effort`), a pi member's as `--model` and `--thinking`.

   It prints one `BUILT` line per member. It is safe to run again: it rewrites the generated files and reinstalls the skills. A failed install prints the exact `npx` command and its output; fix the source or skill name in the roster and build again. "did not install" usually means the skill's `SKILL.md` frontmatter is not valid YAML (for example, an unquoted `: ` in its description); check with `npx -y skills@latest add <source> --list`.

5. Read one generated file per agent in full, as the member will see it, and fix the member files for anything that reads wrong.

## Step 6: Launch the squad (only when the user asks)

`roster.js launch` starts the squad in herdr, each member in its own tab and cwd, on its own agent, model and effort, with every agent's prompts answered and its first prompt sent. Every member runs visible in its tab, never headless, so peers and agent-job deliver to it as turns. Claude Code members load both channels (`--dangerously-load-development-channels server:peers server:agent-job`). Claude Code and Antigravity members run with `--dangerously-skip-permissions`; muse members always run with `muse --yolo`, which trusts the member's cwd (so Muse Code loads its `AGENTS.md` and project skills without asking) and asks no approval prompts. A pi member runs with `--approve` (it trusts the member's cwd, so pi loads its skills without asking) and the peers and agent-job extensions from the installed CLIs (`-e`, the files `peers pi-extension --path` and `agent-job pi-extension --path` write); pi asks no permission prompts.

The whole squad lives in one herdr workspace, `squad-<squad>`, with one tab per member. Each tab holds one pane that fills it, and both are labelled with the member's display name, or its member name. The tabs follow the hierarchy: the supervisor, the member that reports to `user`, first, then the others by how far they are from `user` along `reports_to`, then by their order in `roster.json`. `check` and `launch` print one `TAB` line per member and validate the layout before anything starts: every member in exactly one tab, and the supervisor in tab 1. Never place members by hand, in another workspace, in split panes or with your own `herdr` commands: `launch` keeps the layout.

1. Preview it: `bun scripts/roster.js launch <workspace> --dry-run`. It validates everything and prints the herdr commands it would run, and starts and changes nothing. When it prints `PROBLEM` lines, nothing will launch; fix each one:
   - No running herdr session: ask the user to start herdr from their own terminal, and continue once they say it runs. `--session <name>` picks a session other than the default one.
   - An agent's command missing, a model the agent does not list, or an effort level the model does not have: install or sign in to the agent, or choose another model or level with the user and update `roster.json`.
   - A member not built, or the `peers` or `agent-job` CLI not installed: run Step 5's `build` first.
   - The `peers` CLI has no pi or muse support, with a pi or muse member in the squad: ask the user to update it by rerunning its install script, then launch again.
   - The session already holds the squad's workspace: the squad, or part of it, still runs. Start only the members that are missing, each with `--member <name>`. To start the whole squad again, ask the user first, then stop the members' sessions and close the workspace with the command the `PROBLEM` line gives.
   - A member that still has a pane, with `--member`: stop its session and close that pane, which closes its tab, or leave the member running.
   - A `layout:` fault: the layout built into `scripts/roster.js` is wrong. Do not edit the built file; tell the user the script places members wrongly, with the `PROBLEM` line.

   Show the user the `TAB` lines: the tab order, with the supervisor first.
2. Launch: `bun scripts/roster.js launch <workspace>`. It prints one `LAUNCHED <member> (<agent>, model <model>, effort <level>) in herdr session <session>, tab <n> '<label>', pane <pane>` line per member, with its display name after the member name when it has one; that name, or the member name, also labels the member's herdr tab and pane. Each pane fills its tab, so the agent's dialogs are read whole. The OpenCode TUI takes no model or effort flag, so for an opencode member with a model `launch` creates its session, opens the TUI on it, sets the model with the effort as its variant through OpenCode's API (`session.switchModel`), and reads the session back to confirm it before the first prompt. This needs OpenCode's background service (`opencode service status`). To run a member on another agent, model or effort for this launch only, add `--agent <member>=<agent>`, `--model <member>=<model>` and `--effort <member>=<level>`, checked first with the same flags on `check`; the member is rebuilt for its new agent before it starts. Edit `roster.json` instead when the change should last.
3. When a member fails to start, `launch` stops there with a `FAILED` line naming the member and its pane, lists the members already running, and names the panes of the members that did not start. Read the failed pane (`herdr pane read <pane> --source visible`), fix the cause, close the panes it names (each closes its tab), and launch each member that is not running with `--member <name>`. `--member` opens the member's tab in the squad's workspace. herdr adds a new tab last, so `launch` then moves each running member that comes after it into a new tab behind it, without restarting it, and prints a `MOVED` line for each; the tabs stay in hierarchy order. `launch` answers the dialogs it knows (folder trust, one-time notices). When it fails because a member waits for input it does not know how to answer, such as a sign-in, show the user the screen it printed: the user answers it in that pane, and you never type a sign-in code or password for them.
4. Find every member's address with the peers skill's `peers list --all-dirs`, matching each member's cwd; once members have used peers, `peers contacts --squad <workspace>` lists them too, with each session's status: use `live` rows, and treat `replaced` rows (a member restarted on another agent leaves its old session behind) as gone. A claude member missing from the list inherited another agent session's environment from the herdr server: ask the user to restart herdr from their own terminal.

Give the user the lead's address, and say that the squad's work starts with a request to the lead through the peers skill. Do not watch the panes or poll the members afterwards. Whatever their agent, members answer through peers, and each reply arrives in the receiving session as a turn. A member that stops or stalls is diagnosed and restarted by the peers skill's rules for a stalled exchange; relaunch it with `launch --member <name>`, which puts its tab back in its place.

## Step 7: Change the squad later

Guide each change the way Step 3 designs a member: one question at a time with a drafted default, then a summary to approve before you write anything.

- A member's role, project, communications or memory change: edit its files, and its `talks_to` in `roster.json` when its links change, then run `check`. Nothing needs regenerating, since the instruction file only points at the files. When a `summary` or `reports_to` changes, run `assemble <workspace>`, since every member's squad directory shows them. A running member picks up the change in its next session, or at once when you tell it which file changed.
- A member needs another skill: find and propose it with `references/finding-skills.md`, add the agreed skill to its roster entry, then run `build <workspace> --member <name>`.
- A member is added, or its agent, model or effort changes: update `roster.json` and its files, run `check`, then `build <workspace> --member <name>`. Run `assemble <workspace>` too, since every member's squad directory shows each member's agent, model and effort. A running member keeps its old agent, model and effort until it is restarted: stop its session, close its pane (which closes its tab), and launch it again with `launch --member <name>`.
- A member is removed: remove it from `roster.json` and from every `talks_to` and `reports_to`, fix the other members' COMMUNICATIONS.md, run `check` and `assemble`, then delete its cwd only if the user agrees.
- Members keep their own MEMORY.md: their instruction file tells them to add lessons there. Do not rewrite a member's MEMORY.md without the user's request.

## Report

Tell the user, briefly: whether `build` installed the `peers` and `agent-job` CLIs, and where; the workspace path; each member's name and human-readable name, agent, model, effort, role summary and whom it reports to; the skills each received; anything you could not set up and why; and, if you launched the squad, the lead's address and the herdr session holding it. Delete the draft file once the squad is built.
