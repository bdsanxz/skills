---
name: agents-creator
description: Create a subagent definition file for Claude Code, OpenCode or Codex, in the location the platform's documentation gives or in the directory the user names. Every agent created writes a report file, and writes it while it works, one entry per step or finding, so that its results survive the compaction of its own context and of the caller's, and so that its context stays small. Covers where each platform keeps agent files, the fields and permissions of each format, the description the caller reads, the instructions the agent follows, and a check of the finished file. Use when the user asks to create, write, define or add an agent, a subagent or a custom agent, or names this skill. Do not use to run an agent, or to edit an agent that this skill did not create, unless the user asks for it to get a report file.
---

# Agents Creator

Write the definition file of one agent: a subagent that another agent invokes with a prompt, that does one job in its own context, and that keeps a report file of its work. You write the file. You do not run the agent.

Four words are used throughout:

- The **platform** is the agent tool the file is for: Claude Code, OpenCode or Codex.
- The **caller** is whatever invokes the agent: the user's main agent, a skill, a workflow.
- The **report file** is the Markdown file the agent writes its work to, at the path the caller's prompt names.
- The **protocol** is the block of instructions, the same in every agent, that says how the agent keeps its report file.

## Rules

1. **Every agent keeps a report file, written as it works.** It creates the file before its first step, adds an entry after each step and each finding, and finishes the file before it replies. Its context window is limited and can be compacted at any time, and so can the caller's. What is in the file stays, so the agent does not hold it in mind, and the caller reads the file, not the reply. This has no exception: if the user wants an agent without a report file, tell them that this skill always adds one, and stop unless they still want it.
2. **The protocol is copied, never rewritten.** Every agent carries the protocol word for word, with only its name filled in. The script prints it and checks it.
3. **The documented location, unless the user names another.** Write the file where the platform's documentation puts agents of the project, or in the output directory the user names. Never overwrite a file without the user's answer.
4. **Least privilege, except for the report.** Give the agent the tools its job needs and no more. Whatever else it may not do, it must be able to create and edit its report file.
5. **Self-contained.** The agent knows only the caller's prompt and its own instructions. Everything else it needs goes into the instructions, and everything the caller must give it goes into the description.
6. **Docs change; check them.** Each platform reference says when it was checked against which page. When the user's version or a field matters to the agent, re-read that page, and when it disagrees with the reference, follow the page and tell the user what changed.

## Running the script

`check_agent` below stands for this shell function:

```
check_agent() { bun "<this skill's directory>/scripts/check_agent.js" "$@"; }
```

Define it at the start of every shell command that uses it, because shell state does not carry over between commands. It needs [Bun](https://bun.sh) and nothing else; when `bun` is not found, tell the user to install it and stop. `check_agent --help` gives its options, how it tells the platform, what it prints, and its exit codes.

## Step 1: Learn the job

1. Take from the user's request what the agent is for:
   - its one job, and what it produces or changes;
   - who the caller is, and what its prompt will give the agent;
   - what the agent must not do, such as change files, push, or install;
   - the tools, MCP servers, model and effort it needs, when the user names them.
2. Read the project's instruction files, such as `AGENTS.md` and `CLAUDE.md`. Note any rule they set for agent names, descriptions or locations. Where such a rule differs from this skill, the project's rule holds, except for Rules 1 and 2.
3. Ask only what the request, the project and a sensible default do not settle, one question at a time. A missing model or effort is not a question: leave it out, and the agent inherits its parent's.
4. If the request describes more than one job, propose one agent for each, and create them one after the other.

## Step 2: Choose the platform, the name and the file

1. The platform is the one you are running on. When the user names another, use theirs. When they name several, write one file for each, the same agent in each format.
2. Read the platform's reference in full: `references/claude-code.md`, `references/opencode.md` or `references/codex.md`. The steps below point to its sections.
3. Name the agent after its role, without an `-agent` suffix, as the reference's section *Name* says: kebab-case such as `code-reviewer`, or snake_case such as `code_reviewer` in Codex.
4. Choose the directory:
   - When the user names an output directory, write the file there, under the file name the platform needs. Create the directory if it does not exist.
   - Otherwise use the project location in the reference's section *Where the file goes*.
   - Use the user location only when the user asks for a personal agent, a global one, or one for all their projects.
5. Look for an agent with the same name in that directory, its subfolders, and the platform's other locations. If one exists, show it to the user and ask whether to replace it, choose another name, or stop.

## Step 3: Decide what the agent may use

1. Choose its tools and permissions with the reference: sections *Tools* and *Permission mode* for Claude Code, *Permissions* for OpenCode, *Fields* and *Permissions and sandbox* for Codex.
2. Go through the reference's section *Report file checklist*. Every item must hold, whatever the agent may not do otherwise.
3. An agent that may not change the project still writes its report file. Its instructions say that the report file is the only file it writes.
4. Add a model, an effort, MCP servers, skills, memory or hooks only when the user asks for them or the job cannot be done without them, as the reference describes each.

## Step 4: Write the description

The description is read by the caller, to decide whether to invoke the agent and how to prompt it. Write it in this order:

1. What the agent does, and that it reports back in one line with its status and the path of its report file.
2. When to invoke it, starting with "Use this agent when".
3. How to instruct it: what the prompt must contain, and that the prompt names the report file by its absolute path.
4. `Examples:`, then one `<example>` block for each kind of task the agent takes. Each block has a `Context:` line with the situation, an `assistant:` line with what the caller says when it invokes the agent, a `prompt:` line with the exact prompt it sends, which names the report file, and a `<commentary>` on why the prompt is written that way. For an agent whose tasks can be long, add an example that continues an earlier task by giving the same report file.

In Markdown, write the description as a YAML block scalar, `description: |`, with every line indented: a line such as `Context: ...` is not valid YAML otherwise. In Codex, write it as a literal string between `'''`. Keep it short, as the reference's section *Description* says: descriptions are loaded for every session, and the detail belongs in the instructions.

## Step 5: Write the instructions

The instructions are the body of a Markdown file and `developer_instructions` in Codex. `examples/claude-code/code-reviewer.md`, `examples/opencode/code-reviewer.md` and `examples/codex/code-reviewer.toml` are the same finished agent on each platform. Follow their shape.

1. Open with the agent's role in one or two sentences, and say that it knows only its prompt and its instructions.
2. Write its work as numbered steps, in the order it does them:
   - The first step is to find and start the report file.
   - Every step that produces a result ends with adding that result to the log.
   - The last step is to finish the report file.
   - A step that can go wrong says what to do then: record it and stop as blocked. The agent cannot ask the user.
3. State its limits: where it may work, what it may change, what it must never run.
4. Add a heading `## Report sections` that lists the sections of the report's final "Result", in order, with what each one holds. Choose them for what the caller needs to act on: a verdict, findings with paths and lines, what was changed, what is not done.
5. End with the protocol. Print it with the agent's name filled in, and paste the output as it is, markers included:

   ```
   check_agent --protocol <agent-name>
   ```

   Do not retype, shorten or reword it. `references/report-protocol.md` explains what it is for, if the user asks.

## Step 6: Write the file and check it

1. Write the file in the directory from Step 2.
2. Check it:

   ```
   check_agent <path of the agent file>
   ```

   Add `--platform claude-code`, `--platform opencode` or `--platform codex` when the file is not in a location the platform's documentation gives, such as a directory the user named. The script exits 0 when nothing is wrong, 1 when it found problems, and 2 on wrong usage. Fix each problem it prints, and run it again until it exits 0.
3. Read the file once as the caller, and once as the agent. The description's examples must fit the instructions, every prompt in them must name a report file, and every step that finds or changes something must log it.

## Step 7: Hand over

Tell the user, in a few lines:

1. The path of each file you wrote, and its platform.
2. A prompt that invokes the agent, with a report file named by its absolute path.
3. Where the agent writes its report when a prompt names none: `_agent-reports/<agent-name>/` in its working directory.
4. That the caller reads the report file and not the reply, which only gives the status and the path.
5. What the user must do before the agent runs, from the reference: for Claude Code, its section *When a new or changed file is loaded*; for OpenCode and Codex, its section *Report file checklist*.
