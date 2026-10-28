---
name: herdr-roster-design
description: |
  Designs and launches a squad of long-lived agent sessions that live in one herdr workspace and talk through herdr-peers, using only the herdr CLI. Use when the user wants to create, staff, extend or reorganize a team of agents without any CLI besides herdr. Do not use to message members or schedule work; use the herdr-peers skill.
---

# Herdr roster design

A **squad** is one herdr workspace holding a team of agent sessions that work toward one goal. Each **member** is one named herdr agent (`herdr agent start <name> --kind <kind>`) running in its own tab with its own role and working directory. A member's address is its agent name. Members talk to each other through the herdr-peers skill: any session inside herdr prompts another member by name with `herdr agent prompt`. Nothing here needs any CLI besides `herdr`: no inbox database, no channel, no extension, no build script. The live workspace is the roster: after a compaction, `herdr workspace list`, `herdr tab list` and `herdr agent list` recover it.

**You** are the designer. You are not a member: no member reports to you, and no tab is yours. The squad reports to `user`, the person or session that gives it work.

The installed `herdr` binary is the authority for command syntax. Before you first call it, run `herdr --help`, then `herdr agent`, `herdr pane`, `herdr workspace` and `herdr tab` (each group without a subcommand prints its syntax), and read IDs from the JSON each command returns instead of predicting them.

## Rules

- Verify you run inside herdr first: `test "${HERDR_ENV:-}" = 1`. If it fails, say you are not running inside herdr and stop.
- Create nothing (no workspace, tab, pane or agent) until the user has confirmed the full roster in Step 4.
- One member per tab, one tab per member. Never place members in split panes of one tab, in another workspace, or with your own ad-hoc `herdr` commands outside the launch step: the layout below keeps the hierarchy readable.
- One member per directory, one directory per member: `<root>/<slug>-<member>/` (the full member name) holds its `ROLE.md`, `COMMUNICATIONS.md`, `PROJECT.md` and `MEMORY.md`. The files are the member's durable identity: a restarted member reads them again through its instruction file. Edit the four member files; never edit a generated `CLAUDE.md` or `AGENTS.md`: rewrite it from the confirmed design instead.
- Install skills only through the skills CLI (`npx -y skills@latest`), only into a member's directory (never globally with `-g`), and only the skills the user agreed to. It needs Node.js (checked in Step 1); when `npx` is missing, ask the user to install it.
- Name everything from one slug. Derive `<slug>` from the squad's goal in Step 2: 2-4 kebab-case words (goal "simulasi debat TDD" gives `debat-tdd`). The workspace is `squad-<slug>`; each member's full name is `<slug>-<member>`, where `<member>` names its role in kebab-case (`pro`, `api`, `web`); each tab is `<slug>-<member>: <short role>`. The full member name is the member's identity everywhere: agent name, directory name, `reports_to`/`talks_to`, and `FROM`/`TO` headers.
- Agent names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. The `<slug>-<member>` form keeps them unique across squads. Count the characters: when the full name would pass 31, shorten the slug first, never the member part.
- A muse member always runs with `muse --yolo`: pass `-- --yolo` after the pane flag of `herdr agent start`. Never launch a muse member without it.
- Keep the design in a draft file outside any workspace: your scratch or plan directory when your runtime gives you one, otherwise `/tmp/<squad>-draft.md`. Update it after each settled answer. When your conversation was compacted or the work is resumed, read the draft and continue from the first open question. Delete the draft once the squad is launched.

## Step 1: Read the request and check what herdr offers

1. Read the request and every file it names.
2. Confirm herdr is usable: `HERDR_ENV=1`, `herdr status`, and `herdr agent` for the installed kind list (it includes `muse`, `claude`, `opencode`, `agy`, `pi` and others). Propose only kinds that are installed and signed in. Muse Code lists no models: a muse member's model is whatever its own defaults give it, since `herdr agent start` passes native agent arguments after `--` and muse picks its model itself.
3. List the current state: `herdr workspace list` and `herdr agent list`. A workspace labelled `squad-<squad>` that already exists means the squad, or part of it, still runs: launch only missing members, or ask the user before replacing anything.
4. Check for `npx` with `command -v npx`: Step 5 installs each member's skills through it, so when it is missing, ask the user to install Node.js before continuing.
5. Decide how much to ask:
   - The request settles the goal and the members (each with role, kind and working directory): fill any small gap with a sensible default, then go to Step 4.
   - Anything else: guide the user through Steps 2 to 3. Skip each question the request or your lookups already answer, and state what you found instead.

Ask in this way throughout the guided steps:

- One question per message. Use your runtime's question tool when it has one.
- Propose a default with every question: draft it from the goal and the earlier answers, put it first, and mark it as recommended. Offer two or three real alternatives, and let the user write their own.
- When the user answers "you decide", take your default and say so.

## Step 2: Clarify the squad's goal

Settle these, in order:

1. **Goal:** what the squad is for, in one or two sentences, and what "done" means for it.
2. **Members:** propose the fewest members that cover the goal without overlapping, as a list: short name, one-line summary, agent kind, and repository. Design them this way:
   - Give each member one area of ownership (a directory, a layer or a kind of work). Two members must never own the same files.
   - Default to one lead that reports to `user`, assigns work and reviews results, with every other member reporting to the lead.
   - Name each member after its role in kebab-case (`pro`, `kontra`, `api`); its full name is `<slug>-<member>`, used for its agent, directory, links and message headers.
   - Pick each member's kind by what the member's work needs and what is installed and signed in. When the user has no preference, make the lead a `claude` or `muse` member. Keep the team small: more than three members makes relay routing and debugging much harder.
3. **Workspace:** derive `<slug>` from the goal (2-4 kebab-case words) and settle it with the user. The squad lives in one herdr workspace labelled `squad-<slug>`. Default: the slug of the goal, in the current session.
4. **Standing preferences** that members follow, such as code style, branch rules or review rules. Keep them to what the user asked for explicitly; members add their own lessons later.

## Step 3: Design each member, one at a time

Take the members in order, the lead first. For each one, settle these six topics in order, each as one question with a drafted default. Four topics map to one file each in the member's directory: role to `ROLE.md`, communications to `COMMUNICATIONS.md`, project to `PROJECT.md`, memory to `MEMORY.md`. The instruction file (`CLAUDE.md`/`AGENTS.md`, written in Step 5) loads them. The first prompt and the skills agreement are not files: the prompt gives the opening task, and Step 5 installs the skills.

1. **Role:** the tasks the member owns, its scope (what it may change, and what it leaves to whom), what "done" means for its tasks, and which decisions it makes alone or asks about.
2. **Communications:** whom it reports to (`reports_to`), whom it may message directly and about what (`talks_to`), and how it answers. Default: it reports to the lead, the lead reports to `user`, and `talks_to` links only members whose work meets, such as a front end and the API it calls. Every member follows the herdr-peers skill for the message format and the bounded request-to-receipt protocol.
3. **Project:** the repository the member works on, where it sits relative to the squad root, and the branch rule. Default: the squad root itself; the member's directory is `<root>/<member>/`, named after it. The member's tab opens in its own directory, where its instruction file loads its four files and project skills on start.
4. **Memory** (`MEMORY.md`): at design time, only what the user asked for explicitly, such as standing preferences and special behaviours; the member adds its own lessons later. Default: the standing preferences from Step 2 that apply to this member, or only the `# Memory` heading when there are none.
5. **First prompt:** the exact first task the member gets at launch, starting with: your instruction file already loaded your four files, introduce yourself with your full member name (`<slug>-<member>`), run `herdr agent list` to see the squad, then end your turn if there is nothing else to do.
6. **Skills** (besides the herdr-peers protocol, which every member gets through its first prompt with no install): follow `references/finding-skills.md` to find, check and propose skills for this member, then ask which ones it gets.

Then show the member's design in one short summary: its name, kind, role summary, reports to, talks to, and working directory. Ask the user to approve it or name what to change.

When a later member's design changes an earlier one, for example a new `talks_to` link the other member must know about, update the earlier member's draft and tell the user.

## Step 4: Confirm the full roster

Show the whole design in one message:

- the squad's goal, the `<slug>`, and the workspace label (`squad-<slug>`);
- a table with one row per member: full name (`<slug>-<member>`), kind, role summary, reports to, talks to, repository, skills;
- what Step 5 will do: write each member's four files and its `CLAUDE.md` or `AGENTS.md`, run `npx -y skills@latest add ...` in each member's directory for its agreed skills, create the workspace, rename it `squad-<slug>`, open one semantic tab per member in hierarchy order (the supervisor first), start each member's agent under its full name, and send each member its first prompt.

Ask one question: launch the squad as shown, or change something. Apply each change, show the changed rows, and ask again until the user confirms. When the request itself said to launch the squad without asking, the summary is enough: show it and go on.

## Step 5: Launch the squad (only when the user confirmed)

1. Create each member's directory and write its files: `<root>/<slug>-<member>/` (the full member name) holds `ROLE.md`, `COMMUNICATIONS.md`, `PROJECT.md` and `MEMORY.md` from the confirmed design. Each file holds only its topic; `ROLE.md` never copies the others. Then write the instruction file the agent loads on start: `CLAUDE.md` for a `claude` member, `AGENTS.md` for every other kind. `CLAUDE.md` imports the four files by path with `@<path>`, which Claude Code loads itself; `AGENTS.md` lists their paths and tells the member to read them first in every session. A member's repository checkout, when it has one, lives in a subdirectory of its own directory, never the directory itself, so a checked-in `AGENTS.md` or `CLAUDE.md` cannot clash with the generated one. Then install the member's agreed skills in its directory:

   ```bash
   cd <root>/<slug>-<member> && npx -y skills@latest add <source> --skill <skill> -a <agent> -y --copy
   ```

   `<agent>` is the skills CLI's name for the member's kind: `claude-code` for claude, `opencode` for opencode, `antigravity` for agy, `pi` for pi. The skills CLI names no muse agent yet, so a muse member installs with `-a opencode`, which writes the same shared `.agents/skills/` directory that Muse Code reads as its project skills. For any other herdr kind, check `npx -y skills@latest add --help` for its agent name, defaulting to `opencode`. A failed install prints the exact command and its output; fix the source or skill name in the draft and run it again. "did not install" usually means the skill's `SKILL.md` frontmatter is not valid YAML (for example, an unquoted `: ` in its description); check with `npx -y skills@latest add <source> --list`. Then create the workspace on the supervisor's directory without taking the user's focus, preserving the caller's working directory:

   ```bash
   herdr workspace create --cwd <root>/<slug>-<supervisor> --label squad-<slug> --no-focus
   ```

   Read the workspace ID, the root pane ID and the tab ID from `.result.workspace`, `.result.root_pane` and `.result.tab`. The root pane's tab hosts the supervisor, already in its directory. Then pin meaningful labels; never leave default names, because members filter each other by the workspace label and humans tell tabs apart by theirs:

   ```bash
   herdr workspace rename <workspace-id> squad-<slug>
   herdr tab rename <tab-id> "<slug>-<supervisor>:<short-role>"
   ```
2. For each further member, open its tab in the squad's workspace, already in its directory with a semantic label, and read the new pane ID from the response:

   ```bash
   herdr tab create --workspace <workspace-id> --cwd <root>/<slug>-<member> --label "<slug>-<member>:<short-role>"
   ```

   The label is `"<slug>-<member>:<short-role>"`, for example `"debat-tdd-api:backend-endpoints"`: the full member name first so it stays in sync with the agent name, then a 2-4 word kebab-case role summary from the confirmed design. No spaces anywhere: the label stays one selectable, greppable token. Keep it short: long labels truncate in the tab bar, so shorten the role words before touching the name. Rename a tab any time with `herdr tab rename <tab-id> "<slug>-<member>:<short-role>"`. Agent names allow hyphens but no colon, and the `<slug>-<member>` form already fits: rename an agent only while it is idle with no open exchange, then tell the squad its new address, because prompts and `FROM`/`TO` headers target the name. Match tabs by order, never by parsing the label.

3. Each new pane needs a moment to start its shell: when `herdr agent start` answers `agent_pane_busy`, wait a second and retry. Start each member in its tab's pane under its full name:

   ```bash
   herdr agent start <slug>-<member> --kind <kind> --pane <pane-id> [-- <agent-args...>]
   ```

   Native agent arguments go only after `--`. A muse member always gets `-- --yolo`. A successful start returns only after herdr detects the expected agent ready for interactive input. `agent start` never creates, splits or moves layout: it needs the pane from steps 1 to 2.
4. Send each member its first prompt from Step 3 through the agent surface, and wait for it to settle:

   ```bash
   herdr agent prompt <slug>-<member> "<first task>" --wait --timeout 120000
   ```

   The member's instruction file already loaded its four files and project skills on start. The first task names the squad's workspace label (`squad-<slug>`), the member list with full names and kinds, and the herdr-peers protocol duties, so it can filter its teammates and talk to the squad with nothing besides herdr and its installed skills.
5. Verify the squad: `herdr agent list` shows every member, and `herdr tab list --workspace <workspace-id>` shows one tab per member with the supervisor first.
6. Read one generated instruction file per kind in full, as the member will see it, and fix the member files for anything that reads wrong.

Give the user the lead's agent name, and say that the squad's work starts with a request to the lead through the herdr-peers skill. Do not watch the panes or poll the members afterwards: members answer through `herdr agent prompt`, and each reply arrives as a turn. A member that stops or stalls is diagnosed by the herdr-peers rules for a stalled exchange; relaunch it by opening its tab's pane again and starting its agent with the same name and kind, which reloads its instruction file and four files; re-send its first prompt to put it back to work.

## Step 6: Change the squad later

Guide each change the way Step 3 designs a member: one question at a time with a drafted default, then a summary to approve before you touch herdr.

- A member's role, project, communications or memory change: edit its files (and every linked member's `COMMUNICATIONS.md` when a link changes), then send each affected member a prompt naming which file changed. A running member picks the change up in its next session, or at once when you tell it which file changed.
- A member is added: design it per Step 3, confirm, write its four files and its instruction file, install its skills, then open its tab (`tab create --cwd`) and start its agent per Step 5. It joins the workspace behind the existing tabs.
- A member needs another skill: find and propose it with `references/finding-skills.md`, add the agreed skill to its draft entry, then run the Step 5 install command in its directory.
- A member is removed: fix the other members' `COMMUNICATIONS.md` files, tell the members that linked to it, then stop its session and close its tab's pane (which closes its tab), only for panes you created, and delete its directory only if the user agrees. Never close workspaces, tabs or panes you did not create unless the user explicitly asked.
- Members keep their own `MEMORY.md`: their first prompt tells them to add lessons there. Do not rewrite a member's `MEMORY.md` without the user's request.

## Report

Tell the user, briefly: the workspace label and ID; each member's name, kind, role summary and whom it reports to; the skills each received; and, when launched, the lead's agent name and the session holding it. Delete the draft file once the squad is launched.
