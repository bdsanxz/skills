---
name: agent-roster-template
description: |
  Offers ready-made roster member templates (role, communications, memory, default effort) that fill a squad's members or run once as a worker for another skill: a codebase explorer, a font critic, a drift auditor and a codebase scout. Use when the user designing a squad wants to pick members from existing templates, asks what member templates exist, wants to add a template, or when a skill tells you to run one of these templates as a worker. Do not use to design a whole squad from nothing; use agent-roster-design or herdr-roster-design.
---

# Agent roster template

A **template** is a member that is already designed: its `ROLE.md`, `COMMUNICATIONS.md` and `MEMORY.md`, the effort it needs, and the requests it understands. It lacks only what depends on the squad: the project and the links to other members.

Run the script as `bun scripts/template.js`, with this skill's directory as the base. It needs only Bun; when `bun` is not found, ask the user to install it (https://bun.sh). `bun scripts/template.js help` lists the commands.

Choose the workflow that fits the request.

## Pick templates for a squad

Use this when a squad is being designed and the user wants to choose members from templates.

1. Run `bun scripts/template.js list` and show the user each template's name and summary. Ask which ones the squad needs, one question per message, with your recommendation first.
2. For each template picked, run `bun scripts/template.js show <name>` and `bun scripts/template.js role <name>`, and tell the user in two sentences what the member does and what it needs from the requester. Ask for the member's name (default: the template name), its reporting line and its `talks_to` links.
3. Put each picked member into the design the same way as a member you designed yourself: its `reports_to` and `talks_to` must resolve inside the roster, and the roster must still be confirmed in full before anything is created.
4. After the workspace and `roster.json` exist, run for each picked member:

   ```bash
   bun scripts/template.js apply <template> --workspace <workspace> --member <member> --reports-to <member|user> --talks-to <a,b>
   ```

   It writes `ROLE.md`, `COMMUNICATIONS.md` and `MEMORY.md` into `<workspace>/<member>/`, adds the member to `roster.json`, and refuses to overwrite a file or add an unknown link. Write the member's `PROJECT.md` yourself, and edit the other three files when the user asked for a change; never put project details into a template.
5. Run the roster check of the design skill you are following, and fix every problem it reports.

## Run a template once as a worker

Use this when another skill says to run a template, such as `explore`, `font-design-critic`, `drifting-check-auditor` or `tasks-scout`.

1. Run `bun scripts/template.js role <name>` and `bun scripts/template.js requests <name>`. The first is the worker's instructions; the second shows how to word the request and what to name in it.
2. Start one fresh worker with the role as its instructions, at the template's effort when your runtime lets you choose one. Use your runtime's subagent tool; when it has none, start a peer session in its own directory. A fresh worker has no memory of any earlier one.
3. Send it the request written as in `requests`: every input by absolute path, and the report file the calling skill names. Add no opinion about what the answer should be.
4. Read the report file. Do not rely on the worker's reply or on your memory of it. When its status is not done, start a new worker with the same role and a request that tells it to continue from the report file.

## Add a template

Use this when the user wants a member they keep reusing to become a template.

1. Create `templates/<name>/` in this skill's directory, with a lowercase kebab-case name, holding:
   - `template.json`: `name` (equal to the directory), a one-line `summary`, optional `agent`, `model` and `effort`, `reports_to` (usually `lead`), `talks_to` and `skills`;
   - `ROLE.md`: the member's instructions as steps, with no project details;
   - `COMMUNICATIONS.md`: it must use `{{reports_to}}` and may use `{{talks_to}}` on a line of its own;
   - `MEMORY.md`: the `# Memory` heading, plus only lessons that hold in every squad;
   - `REQUESTS.md`: one example request per kind of work, each with its inputs by absolute path.
2. Run `bun scripts/template.js validate` and fix every problem.
3. Apply the template once to a scratch workspace and read the three written files before telling the user it is ready.
