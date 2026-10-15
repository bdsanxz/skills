# Platform: Claude Code

Checked against the Claude Code subagents documentation (https://code.claude.com/docs/en/sub-agents) on 2026-10-16. Fields and defaults gain version minimums over time: run `claude --version`, and re-read that page before you rely on a field this reference marks as new or that the user's version may lack.

A subagent runs in its own context window, with its own system prompt, tools and permissions, and returns one result to the agent that invoked it.

## Where the file goes

When two agents have the same name, the one from the higher location wins.

| Location | Who can use it | Priority |
| --- | --- | --- |
| Managed settings (`.claude/agents/` in the managed settings directory) | The whole organization | 1, highest |
| `--agents` flag, as JSON | The current session only, not saved | 2 |
| `.claude/agents/<name>.md` | The current project | 3 |
| `~/.claude/agents/<name>.md` | All of the user's projects | 4 |
| A plugin's `agents/` directory | Where the plugin is enabled | 5, lowest |

- **Project scope** is the default of this skill. Put the file in `.claude/agents/` at the root of the repository, so that it can be checked in and shared.
- Claude Code finds project agents by walking up from the working directory to the repository root, and reads every `.claude/agents/` on the way. When two of them define the same name, the one closest to the working directory wins.
- A directory added with `--add-dir` or `/add-dir` has its `.claude/agents/` loaded too.
- Both `agents/` directories are read recursively. Subfolders such as `agents/review/` help to organize, and do not change the agent's name.
- Two files in the same tree with the same `name`: only one loads, and which one is not defined. Keep names unique. `/doctor` reports such files.
- In a plugin, a subfolder does become part of the name: `agents/review/security.md` in plugin `my-plugin` is `my-plugin:review:security`. Plugin agents ignore `hooks`, `mcpServers` and `permissionMode`.
- The `--agents` JSON maps each name to a definition with `prompt` (the instructions) and the frontmatter fields below, except `color` and `experimental`. In non-interactive mode (`-p`) it also takes the path to a JSON file.

## When a new or changed file is loaded

Claude Code watches `.claude/agents/` and `~/.claude/agents/`, and picks up a new or edited file within seconds. A restart is needed when:

- the `agents/` directory did not exist when the session started;
- the file is in the `.claude/agents/` of a directory added with `--add-dir`;
- the session was started with `--disable-slash-commands`.

## The file

```markdown
---
name: code-reviewer
description: |
  <what it does, when to use it, how to instruct it, examples>
tools: Read, Grep, Glob, Bash, Write, Edit
model: sonnet
---

<instructions>
```

- YAML frontmatter between `---` lines, then the instructions in Markdown.
- The body becomes the agent's whole system prompt. The agent does not get Claude Code's own system prompt, only its body and some details about the environment, such as the working directory.
- The agent starts in the working directory of the main conversation. A `cd` does not carry over from one shell command to the next.

## Frontmatter fields

Only `name` and `description` are required. Field names are camelCase and must be spelled exactly as here: an unknown field is ignored without any message. `claude --debug` writes the unknown fields of a loaded agent to `~/.claude/debug/<session-id>.txt`, after the words `does not recognize or apply`.

| Field | What it does |
| --- | --- |
| `name` | The agent's identifier. See "Name". |
| `description` | When to delegate to the agent, and how. See "Description". |
| `tools` | Allowlist of tools, as `Read, Grep, Bash` or a YAML list. Left out: every tool a subagent can have. See "Tools". |
| `disallowedTools` | Tools to remove from the inherited or listed tools. Same format. |
| `model` | `sonnet`, `opus`, `haiku`, `fable`, a full model ID such as `claude-opus-5-5`, or `inherit`. |
| `effort` | `low`, `medium`, `high`, `xhigh` or `max`, as far as the model supports it. |
| `permissionMode` | `default` (or `manual`), `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` or `plan`. See "Permission mode". |
| `maxTurns` | Most agentic turns before the agent stops. Its output is then marked partial, and it can be resumed. |
| `autoCompactWindow` | A token count from `100000` to `1000000` at which the agent compacts earlier. See "Compaction". |
| `skills` | Skills whose full content is loaded into the agent at start. See "Skills". |
| `mcpServers` | MCP servers for this agent only. See "MCP servers". |
| `hooks` | Hooks that run only while this agent runs. See "Hooks". |
| `memory` | `user`, `project` or `local`: a memory directory that lasts across sessions. See "Memory". |
| `background` | `true` keeps the agent in the background even when the caller asks for the foreground. |
| `omitClaudeMd` | `true` starts the agent without the user, project and local CLAUDE.md files. For agents that take everything from their prompt. |
| `isolation` | `worktree` runs the agent in a temporary git worktree. See "Isolation in a worktree". |
| `color` | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink` or `cyan`, for the task list and transcript. |
| `initialPrompt` | Sent as the first user turn when the agent runs as the main session (`--agent`). Ignored for a subagent. |
| `experimental` | A map. Its key `cacheTtl` takes `5m` or `1h`, the prompt cache lifetime for the agent's requests. Write it inside the map, not at the top level. |

## Files that are skipped

Claude Code skips a file in an `agents/` directory without telling the session when:

- it has no `name`: it is taken for documentation;
- its opening `---` is not on the first line: it is read as having no frontmatter;
- its `name` starts with `-`, contains `:`, or is longer than 256 characters;
- it has a `name` and no `description`;
- its YAML does not parse. A multi-line description that is not a block scalar is the usual cause.

`claude --debug` writes the reason to the debug log. `claude plugin validate .claude/agents` finds files whose frontmatter does not parse, but not a missing `name`.

## Name

- At most 256 characters, no `:` (reserved for plugin names), does not start with `-`. Use kebab-case, named after the role: `code-reviewer`, `test-runner`.
- Identity comes from `name` alone. The file name does not have to match, but this skill names the file `<name>.md`.
- Hooks receive the name as `agent_type`, and permission rules match it in `Agent(<name>)`.

## Description

- Claude decides from the description when to delegate to the agent. Make it specific enough that it picks this agent and no other one.
- To have Claude delegate without being asked, say so in it, with words like "use proactively".
- The descriptions of all custom agents are loaded into every session. Above 15,000 tokens together, Claude Code warns at startup. Keep each one short, and put detail in the body, which is loaded only when the agent runs.

## Model and effort

The model is the first of:

1. the `model` the caller passes when it invokes the agent;
2. the `model` field, where `inherit` means the main conversation's model;
3. the environment variable `CLAUDE_CODE_SUBAGENT_MODEL`;
4. the main conversation's model.

- A family alias such as `opus` resolves to the main conversation's exact model when that model is of the same family, so that the agent gets the same context window.
- With `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, the `model` field is ignored for every agent.
- A model that the organization's `availableModels` does not allow is replaced by an allowed one, with a warning.
- The agent inherits the main conversation's extended thinking setting. There is no thinking setting per agent.
- `effort` sets the agent's effort level. The caller can pass another for one invocation. `CLAUDE_CODE_EFFORT_LEVEL` overrides both.
- A smaller model can mean a smaller context window: the agent's window is sized by its own model.
- Leave `model` and `effort` out unless the user asks. The agent then follows the main conversation.

## Tools

A subagent inherits the main conversation's built-in and MCP tools, with two filters.

Removed from every subagent, even when listed in `tools`:

- `AskUserQuestion`: the agent cannot ask the user anything. Its instructions must say what to do when something is unclear: record it and stop as blocked.
- `EnterPlanMode`, and `ExitPlanMode` unless `permissionMode` is `plan`.
- `ScheduleWakeup`, `WaitForMcpServers`, `Workflow`, `EndConversation`.
- `Agent`, when the agent is at the nesting limit.

In the background, which is the default, a subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`, `LSP`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage` and `Artifact`. Any other built-in tool is removed without a message, so the same file can get different tools in the foreground and the background.

To narrow the tools:

- `tools` is an allowlist. Example, read and search with shell access but no file edits and no MCP tools: `tools: Read, Grep, Glob, Bash`.
- `disallowedTools` is a denylist on top of what the agent would inherit. Example: `disallowedTools: Write, Edit`.
- When both are set, `disallowedTools` is applied first, and `tools` is matched against what remains.
- Both accept `mcp__<server>` or `mcp__<server>__*` for every tool of one MCP server. In `disallowedTools`, `mcp__*` removes every MCP tool.
- An entry with a specifier, such as `Bash(git push *)`, in `disallowedTools` removes the whole tool. To block only some commands, use a deny rule in the settings' `permissions.deny` instead.
- When no entry in `tools` names a real tool, the agent fails to launch, and the error names the entries.
- To preload skills, use `skills`, not `Skill` in `tools`. Leave `Skill` out of `tools`, or put it in `disallowedTools`, to stop the agent from loading skills at all.
- `Agent` in `tools` lets the agent start its own subagents. `Agent(worker, researcher)` limits which types it may start, but only for an agent that runs as the main session with `--agent`. In a subagent, the list in parentheses is ignored. Leave `Agent` out to keep an agent from delegating.

## MCP servers

```yaml
mcpServers:
  - playwright:          # defined here, for this agent only
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  - github               # an already configured server, by name
```

- An inline definition has the same form as an entry of `.mcp.json` (`stdio`, `http`, `sse` or `ws`). It connects when the agent starts and disconnects when it ends, and its tools stay out of the main conversation's context.
- An inline server in a project agent loads only after the user has trusted the folder the file is in. A parent folder's trust does not count.
- The session's MCP restrictions apply: `--strict-mcp-config`, `--bare`, managed MCP configuration, and the allow and deny lists for MCP servers.

## Permission mode

Left out, the agent runs in the main conversation's mode.

| Mode | Behavior |
| --- | --- |
| `default` | Asks for permission. `manual` is the same. |
| `acceptEdits` | Accepts file edits and common file system commands in the working directory without asking. |
| `auto` | A classifier reviews commands and writes to protected directories. |
| `dontAsk` | Denies whatever would ask. Tools that are allowed explicitly still work. |
| `bypassPermissions` | Asks for nothing. Takes effect only when the main conversation is in this mode too. |
| `plan` | Read-only exploration. |

- When the main conversation is in `bypassPermissions`, `acceptEdits` or `auto`, the agent runs in that mode, whatever its field says.
- A report file is a file write. Under `dontAsk`, the agent can only write it when writes to that path are allowed in the settings. Under `plan`, it cannot write it at all: do not give a report-writing agent `permissionMode: plan`.

## Skills

```yaml
skills:
  - api-conventions
  - error-handling-patterns
```

- The full content of each skill is loaded at start, up to 32 names. The agent can still load other skills with the Skill tool unless it lacks that tool.
- A skill with `disable-model-invocation: true` cannot be preloaded. A missing or disabled skill is skipped, with a warning in the debug log.

## Memory

| Scope | Directory | Use when |
| --- | --- | --- |
| `user` | `~/.claude/agent-memory/<name>/` | The agent should remember across all projects. |
| `project` | `.claude/agent-memory/<name>/` | The knowledge belongs to the project and can be checked in. The recommended scope. |
| `local` | `.claude/agent-memory-local/<name>/` | The knowledge belongs to the project but is not checked in. |

- With memory, the agent's system prompt gets instructions for its memory directory and the first 200 lines or 25 KB of its `MEMORY.md`, and `Read`, `Write` and `Edit` are turned on.
- It has no effect when auto memory is turned off.
- Memory is for what the agent learns across tasks. The report file is for one task. They do not replace each other. If the user asks for memory, add to the instructions when to consult it and what to save in it.

## Hooks

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
```

- Frontmatter hooks run only while this agent runs. Every hook event is supported. The common ones are `PreToolUse` and `PostToolUse` (matched on the tool name) and `Stop`, which becomes `SubagentStop` for a subagent.
- A `PreToolUse` command gets the call as JSON on stdin (the command is in `tool_input.command`). Exit code 2 blocks the call, and what the script writes to stderr is shown to the agent. This allows part of a tool and blocks the rest, such as read-only SQL. On macOS and Linux the script must be executable.
- Hooks in a project agent run only after the user has trusted the folder the file is in. Until then the agent runs without them.
- Hooks in `settings.json` also run inside subagents. `SubagentStart` and `SubagentStop` in the settings match on the agent's name.

## Isolation in a worktree

- `isolation: worktree` gives the agent its own copy of the repository, branched from the default branch, not from the session's `HEAD`. The copy is removed when the agent made no changes.
- Its shell commands must stay inside the copy. A command that would run in the main checkout, or that redirects git there, is refused.
- Its report file must be given by an absolute path outside the copy, or it is lost when the copy is removed.

## What the agent starts with

A subagent starts fresh. It does not see the conversation, the files the caller read, or the skills the caller loaded. It gets:

- its own system prompt, from the body;
- the task prompt the caller writes;
- the CLAUDE.md files and project instructions of the main conversation, unless `omitClaudeMd` is set;
- a snapshot of the git status;
- the skills in its `skills` field;
- a list of the other named agents in the session, when it has `SendMessage`.

It does not get the main conversation's output style or auto memory. So the instructions must hold everything the agent needs that the prompt will not, and the description must tell the caller what to put in the prompt.

## How an agent is invoked

- **By its description:** Claude delegates when a task matches it.
- **By name in a message:** "Use the code-reviewer agent to ...".
- **By @-mention:** `@agent-code-reviewer`, or the picker. This guarantees the agent runs. Claude still writes the prompt.
- **As the whole session:** `claude --agent code-reviewer`, or `"agent": "code-reviewer"` in `.claude/settings.json`. The body then replaces Claude Code's system prompt.
- `permissions.deny` with `Agent(code-reviewer)` blocks the agent.

## Foreground and background

- In an interactive session subagents run in the background by default. Their permission prompts appear in the main session, and their result arrives as a notification in a later turn.
- A foreground subagent blocks the main conversation until it is done.
- A background subagent has the smaller tool set listed under "Tools". `Write` and `Edit` are in it, so the report file can always be written.

## Nesting and limits

- A subagent can start subagents of its own, up to three levels below the main conversation by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). At the limit it has no `Agent` tool.
- At most 20 subagents run at once by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).

## Resuming and follow-ups

- Each invocation starts a new agent. To continue one, the caller sends it a message with `SendMessage` and its ID or name. It resumes with its whole history.
- The built-in Explore and Plan agents cannot be resumed. A custom agent can.
- An agent that stopped at `maxTurns` returns output marked partial, and can be resumed.
- A new agent can also continue earlier work when it is given the same report file: the report protocol has it read the file and go on from the last entry.

## Compaction

- A subagent compacts its own context as it fills, like the main conversation. This is why its results go to the report file as soon as it has them.
- `autoCompactWindow` makes it compact earlier. Write a plain integer such as `200000`: `200k` is read as 200, which is out of range and ignored. It has no effect when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set, or when the agent runs as the main session.

## Report file checklist

- `tools`, when set, includes `Write` and `Edit`. `disallowedTools` does not remove them.
- `permissionMode` is not `plan`.
- With `isolation: worktree`, the description tells the caller to give a report path outside the worktree.
- The instructions say what to do when something is unclear, since the agent cannot ask the user.
