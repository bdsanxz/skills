# Platform: OpenCode

Checked against the OpenCode agents documentation (https://opencode.ai/docs/agents, V2 configuration) on 2026-10-16. OpenCode is moving from V1 to V2 field names: re-read that page before you rely on a field, and never mix the two.

An agent in OpenCode is a named profile: instructions, a model preference, permissions and display details. A subagent runs in a child session with a fresh context, in the foreground or the background, and returns its result to the session that launched it.

## Where the file goes

| Location | Who can use it |
| --- | --- |
| `.opencode/agents/<name>.md` | The current project. The default of this skill |
| `~/.config/opencode/agents/<name>.md` | All of the user's projects |
| `agents` in an OpenCode configuration file (`opencode.jsonc`) | Wherever that configuration applies |

- OpenCode finds project `.opencode` directories from the working directory up to the project root.
- A subfolder becomes part of the agent's ID: `.opencode/agents/team/reviewer.md` is `team/reviewer`. Write directly into `agents/` unless the user asks for a subfolder.
- Definitions merge in configuration order: a later scalar value replaces an earlier one, `request` maps merge by key, and `permissions` rules are appended. Global `permissions` apply before an agent's own, so the agent's rules can refine them.
- An agent with the ID of a built-in agent replaces that built-in.

## The file

```markdown
---
description: |
  <what it does, when to use it, how to instruct it, examples>
mode: subagent
model: anthropic/claude-sonnet-4-5
permissions:
  - action: shell
    resource: "*"
    effect: deny
---

<instructions>
```

- YAML frontmatter between `---` lines, then the instructions in Markdown. The body becomes the agent's `system` prompt.
- The frontmatter takes the same fields as an entry of `agents` in the JSONC configuration. This skill writes Markdown files.
- The same agent in JSONC, for reference:

  ```jsonc
  {
    "$schema": "https://opencode.ai/config.json",
    "agents": {
      "reviewer": {
        "description": "Reviews current changes",
        "mode": "subagent",
        "system": "Report findings in severity order.",
        "permissions": [{ "action": "edit", "resource": "*", "effect": "deny" }],
      },
    },
  }
  ```

## Frontmatter fields

| Field | What it does |
| --- | --- |
| `description` | The agent's purpose. OpenCode shows it to the model that chooses which agent to launch. Required for a subagent in practice. See "Description" |
| `mode` | `primary`, `subagent` or `all`. See "Mode" |
| `model` | `provider/model`, with an optional `#variant`: `anthropic/claude-sonnet-4-5#high` |
| `permissions` | An ordered list of rules. See "Permissions" |
| `steps` | A positive maximum number of model steps. On the last step tools are removed and the model is asked to sum up in text. New user input resets it |
| `hidden` | `true` removes the agent from listings, discovery and the subagent catalog. Visibility only, not security |
| `color` | Six-digit hex color for the UI: `"#ff6b6b"` |
| `disabled` | `true` removes a built-in or custom agent at that point of loading |
| `request` | `headers` and `body` overlays per agent. The V2 runner keeps them but does not send them yet: set request options on the provider or model instead |
| `system` | The instructions, in JSONC only. In a Markdown file, write them in the body |

Do not use the V1 fields `temperature`, `top_p`, `prompt`, `permission`, `tools`, `disable` or `maxSteps` in a new agent.

## Name

- The ID is the file name without `.md`, plus any subfolder. There is no `name` field. Use kebab-case, named after the role: `code-reviewer.md`.
- Reuse a built-in ID (`build`, `plan`, `general`, `explore`) only to replace that built-in on purpose.

## Description

- The launching model decides from the description whether to use this agent. Make it specific enough that it picks this agent and no other one.
- It is shown for every subagent, so keep it short and put detail in the body.

## Mode

| Mode | Behavior |
| --- | --- |
| `primary` | Runs as the main agent of a session. The default for a new custom agent |
| `subagent` | Runs only in a child session, launched through the `subagent` tool |
| `all` | Either |

- An agent made with this skill is invoked by another agent, so it is `subagent`, or `all` when the user also wants to select it as the main agent.
- `default_agent` in the configuration picks the primary agent of a new session. It must exist, be visible and support primary use.

## Model

- A subagent uses its `model`, or inherits the parent session's model when it has none. Leave it out unless the user asks.
- In JSONC the expanded form is `{ "providerID": "anthropic", "model": "claude-sonnet-4-5", "variant": "high" }`.

## Permissions

```yaml
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: read
    resource: "src/**"
    effect: allow
```

| Field | Meaning |
| --- | --- |
| `action` | The tool or permission action. Wildcards work |
| `resource` | The path, command, agent ID or other value the action is matched on. Wildcards work |
| `effect` | `allow`, `ask` or `deny` |

| Action | Covers |
| --- | --- |
| `shell` | Shell commands |
| `edit` | Editing, writing and patching files |
| `subagent` | Launching child agents. The parent's rules decide which agents it may launch; the child then uses its own rules |
| `read`, `glob`, `grep` | Reading and searching files |
| `webfetch`, `websearch` | Web tools |
| `skill` | Loading skills |
| `external_directory` | Access outside the workspace |

- The last rule that matches wins. Put broad rules first and exceptions after them.
- For `read`, `edit` and `external_directory`, `~` and `$HOME` in a resource are expanded. In `shell` resources they are not: a shell resource is the raw command text.
- To let an agent launch only some subagents: deny `subagent` on `*`, then allow it on each agent ID.

## Built-in agents

| Agent | Mode | Purpose |
| --- | --- | --- |
| `build` | `primary` | The default coding agent |
| `plan` | `primary` | Explores and plans without editing project files |
| `general` | `subagent` | Research and multi-step work, with broad tools; cannot launch subagents |
| `explore` | `subagent` | Searches and reads code or the web without editing |

Hidden maintenance agents (`compaction`, `title`, `summary`) cannot be selected.

## How an agent is invoked

- The primary agent launches a subagent through its `subagent` tool when the description fits, or when the user asks: "Use the reviewer subagent to review my changes."
- The subagent starts with a fresh context: it knows only the task the parent gives it and its own instructions. Project instructions, skills and references are still added.

## Report file checklist

- `mode` is `subagent` or `all`.
- An agent that may not change the project denies `edit` on `*`, then allows `edit` on every place its report file can be: `**/_agent-reports/**` for the fallback path, and the directory its callers name report files in. The description tells callers to name the report file inside that directory.
- No rule after those denies `edit` on the report locations again.
