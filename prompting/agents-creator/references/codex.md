# Platform: Codex

Checked against the Codex subagents documentation (https://learn.chatgpt.com/docs/subagents) and its configuration reference (https://learn.chatgpt.com/docs/config-file/config-reference) on 2026-10-16. Model names and reasoning levels change with each release: re-read the models page (https://learn.chatgpt.com/docs/models) before you name a model.

A custom agent in Codex is one TOML file. Codex spawns it as a subagent in its own agent thread, and collects its summary into the main thread.

## Where the file goes

| Location | Who can use it |
| --- | --- |
| `.codex/agents/<name>.toml` | The current project. The default of this skill |
| `~/.codex/agents/<name>.toml` | All of the user's projects |

- Each file defines one agent.
- A custom agent with the name of a built-in agent (`default`, `worker`, `explorer`) takes precedence over the built-in.

## The file

```toml
name = "code_reviewer"
description = '''
<what it does, when to use it, how to instruct it, examples>
'''
model = "gpt-6.1-sol"
model_reasoning_effort = "high"
developer_instructions = '''
<instructions>
'''

[features]
apps = false
```

- Write every multi-line value as a literal string between `'''`, so that backslashes and quotes in it are kept as they are. A literal string cannot hold `'''`.
- Put the top-level keys before the first table such as `[features]`: a key after a table header belongs to that table.

## Fields

| Field | Required | What it does |
| --- | --- | --- |
| `name` | Yes | The name Codex uses to spawn and refer to the agent. The source of truth, not the file name |
| `description` | Yes | When Codex should use the agent. See "Description" |
| `developer_instructions` | Yes | The agent's instructions |
| `model` | No | The model. See "Model and reasoning" |
| `model_reasoning_effort` | No | The reasoning effort. See "Model and reasoning" |
| `model_reasoning_summary`, `model_verbosity` | No | Further model behavior; values in the configuration reference |
| `[features]` | No | Set `shell_tool`, `apps`, `plugins`, `memories` or `request_permissions_tool` to `false` to take that capability away |
| `[[skills.config]]` | No | `path` to a skill's `SKILL.md` and `enabled = false` to turn one skill off. Skills are otherwise inherited from the parent |
| `skills.bundled.enabled` | No | `false` turns off the bundled skills |
| `skills.include_instructions` | No | `false` leaves out the automatic block of skills instructions |

These have no effect in an agent file, because the agent inherits them from the parent session: `sandbox_mode`, `approval_policy`, `model_provider`, `mcp_servers`, and the service tier. Managed requirements still apply.

## Name

- Use snake_case, named after the role: `code_reviewer`. Name the file with the same words in kebab-case: `code-reviewer.toml`.

## Description

- The description tells Codex when to use the agent. Make it specific enough that Codex picks this agent and no other one.
- The best agents are narrow: one clear job, the capabilities that job needs, and instructions that keep it from drifting into nearby work.

## Model and reasoning

Without `model` and `model_reasoning_effort` in the file, the agent inherits the parent's model and effort. The order Codex resolves them in:

1. a value set in the agent file wins;
2. otherwise an explicit value in the spawn request;
3. otherwise the `[agents]` default in the configuration (`default_subagent_model`, `default_subagent_reasoning_effort`);
4. otherwise the parent's value.

- When a model is chosen and no effort is, that model's default effort is used. A file that sets only `model` keeps the effort resolved before it. Set `model_reasoning_effort` too when the model does not support that effort.
- `gpt-6.1-sol`: demanding, ambiguous, multi-step work. `gpt-6-luna`: fast, narrow, repeatable work.
- Effort: `low` for straightforward work, `medium` to balance, `high` for tracing logic and edge cases (reviewers, security), `xhigh` and `max` for especially demanding work, `ultra` for the deepest reasoning, each where the model supports it.
- Leave both out unless the user asks.

## Permissions and sandbox

- The agent inherits the parent session's sandbox policy, approval mode, provider and MCP servers. Its file cannot change them, and cannot make the agent read-only: instructions can only ask it not to edit.
- Configure MCP servers in the parent session for the agent to use them.

## Global settings

These live under `[agents]` in the user's or project's `config.toml`, not in the agent file.

| Field | What it does |
| --- | --- |
| `agents.enabled` | `false` turns multi-agent tools off. Default `true` |
| `agents.max_concurrent_threads_per_session` | The most spawned agent threads open at once. `agents.max_threads` is the old name |
| `agents.default_subagent_model` | Default model of spawned agents |
| `agents.default_subagent_reasoning_effort` | Default effort of spawned agents |
| `agents.interrupt_message` | `false` leaves out the message the model sees when an agent turn is interrupted. Default `true` |

## How an agent is invoked

- Codex spawns subagents only when the user asks for it, or when an `AGENTS.md` or skill instruction that applies asks for it: "Have code_reviewer review this branch against main."
- A good spawning prompt says how to split the work, whether to wait for all agents, and what to return.
- The user can open each agent thread to inspect it, and ask Codex to steer, stop or close one.
- Each subagent does its own model and tool work, so it costs tokens of its own.

## Report file checklist

- Do not turn off, under `[features]`, the capability the agent writes files with.
- The report file needs a sandbox that allows writes to the workspace. When the parent session runs read-only, the report cannot be written. Tell the user.
