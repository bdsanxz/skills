# Engine: Claude Code (`claude`)

Checked against the Claude Code CLI reference and headless docs on 2026-10-14. Flags gain version minimums over time: run `claude --version` and `claude --help`, and check https://code.claude.com/docs/en/cli-reference and https://code.claude.com/docs/en/headless for anything you rely on.

## Detection and sign-in

| Need | Command | Notes |
| --- | --- | --- |
| Find it | Look up `claude` on the user's login-shell `PATH`, then the installer's default location in the home folder | A GUI app on macOS does not inherit the shell `PATH`; resolve it through the user's login shell once and cache the path |
| Version | `claude --version` | Compare against the minimum your flags need |
| Signed in? | `claude auth status` | JSON; exit 0 when signed in, 1 when not. `authMethod` is one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party` |
| Sign in | `claude auth login` | Opens Anthropic's sign-in in the browser. Run it in a terminal the user can see, or give the user the command. `--console` signs in for API billing instead of a subscription |
| Install | Anthropic's official installer, shown to the user before it runs | Never bundle a modified binary |
| Health | `claude doctor` | Read-only diagnostics for the *Installed but will not start* state |

## Starting a run

Run in the project folder as the working directory. Build the child's environment explicitly: pass what the engine needs (HOME, PATH, locale, proxy settings, the secret for your MCP server) and leave out vendor API-key variables unless the user chose the API-key path for this engine, because a key in the environment changes which account pays.

```bash
claude --print \
  --input-format stream-json \
  --output-format stream-json --verbose --include-partial-messages \
  --model <model> --effort <level> \
  --append-system-prompt-file <app-owned rules file> \
  --plugin-dir <app-owned plugin folder> \
  --strict-mcp-config --mcp-config <app MCP config JSON> \
  --setting-sources user \
  --permission-mode acceptEdits \
  --allowedTools "<scoped allow rules>" \
  --disallowedTools "<removed tools and deny rules>" \
  --permission-prompt-tool mcp__<app-server>__<approval-tool> \
  [--resume <session_id>]
```

| Flag | Why |
| --- | --- |
| `--print` | No terminal UI; the host drives it |
| `--input-format stream-json` | User messages arrive on stdin as JSON lines |
| `--output-format stream-json --verbose` | One JSON event per line on stdout |
| `--include-partial-messages` | Text and thinking deltas while they stream |
| `--append-system-prompt[-file]` | Adds product rules and keeps Claude Code's own prompt, tool guidance and safety rules. Use `--system-prompt` only if the agent is no longer a coding agent, and then supply all of that yourself |
| `--plugin-dir` | Loads the app's skills, agents and commands for this run only |
| `--mcp-config` with `--strict-mcp-config` | Only the app's MCP servers connect; the project's `.mcp.json` does not |
| `--setting-sources user` | Skips the project's and local settings, and with them the project's hooks. Add `project` only if the product wants the repository's own settings |
| `--settings <json>` | Per-run settings overrides, for example turning off the user's own plugins or skills the product does not want. Never override anything about sign-in |
| `--permission-mode` | `acceptEdits` for an editor that lets the agent edit; `dontAsk` to deny anything not pre-allowed; `default` to send everything to approvals. Avoid `bypassPermissions`: path deny rules are the only guard left |
| `--allowedTools` / `--disallowedTools` | Permission rule syntax. A bare tool name in `--disallowedTools` removes the tool; a scoped rule denies matching calls. A leading `//` makes a path absolute, for example `Edit(//abs/project/.app/**)` |
| `--tools` | Restricts built-in tools to a list, when the product wants a small set |
| `--permission-prompt-tool` | Sends every remaining approval to an MCP tool of the app's server, which asks the user in the app's UI |
| `--permission-prompts none` | For unattended runs: deny anything that would prompt instead of waiting |
| `--resume <session_id>` | Continue the conversation. `--fork-session` branches it instead |
| `--session-id <uuid>` | Choose the session ID up front so the host knows it before the first event |
| `--add-dir` | Extra folders the agent may read or edit (grants access, does not load their configuration) |
| `--max-turns`, `--max-budget-usd` | Guards for runaway runs. Budget is a client-side estimate |
| `--no-session-persistence` | Throwaway runs that never resume |

Do not use `--bare` for a run on the user's subscription: bare mode never reads OAuth credentials. It suits API-key runs.

Without `--bare`, a `--print` run executes the project's hooks and connects its `.mcp.json` servers with no trust prompt. Only start runs in folders the user opened in the app, and keep `--setting-sources user` and `--strict-mcp-config` unless the product deliberately trusts the repository.

The system prompt is recorded on the conversation's first request. A resumed conversation keeps the recorded prompt until it is compacted, so a changed rules file reaches old conversations late. While iterating on the rules, pass `--system-prompt-snapshot off`.

## Sending a message

Write one JSON line to stdin per user message:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<user text>\n\n<app_context>\n...\n</app_context>"}]}}
```

Images go in the same `content` array as image blocks. Two ways to hold a conversation:

| Model | How | Use when |
| --- | --- | --- |
| Process per message | Start the process, write one message, close stdin, read until `result` and exit. The next message starts a new process with `--resume <session_id>` | Simplest; nothing to keep alive; recovers from crashes and app restarts for free. Each message pays process start-up |
| Long-lived process | Keep stdin open and write each new message when the user sends it. Messages sent during a turn queue | Lower latency for chatty use. The host must watch the process and restart it with `--resume` if it dies |

## Reading events

Each stdout line is one JSON object. Switch on `type`, then `subtype`; ignore anything you do not recognize.

| Event | Use it for |
| --- | --- |
| `system` / `init` | Session ID, model, tools, `mcp_servers` (each with `status`), `mcp_server_errors`, `plugins`, `plugin_errors`, permission mode, `apiKeySource`, `capabilities`. Fail the run visibly when the app's MCP server or plugin did not load |
| `system` / `status` | Progress state such as `requesting` |
| `stream_event` | Partial output: `event.delta.type` `text_delta` carries streamed text; thinking deltas likewise |
| `assistant` | A complete assistant message: text, thinking and `tool_use` blocks. Show tool activity from `tool_use` names and inputs |
| `user` | Tool results (`tool_result`) going back to the model. `parent_tool_use_id` is set for subagent traffic |
| `rate_limit_event` | Usage windows of the user's plan; drives a "used N% of the limit" indicator |
| `system` / `api_retry` | Retry progress, with `attempt`, `retry_delay_ms` and an `error` category such as `rate_limit`, `authentication_failed`, `billing_error` |
| `system` / `permission_denied` | A call that was denied |
| `result` | The end of the turn: `subtype` (success or an error kind), final `result` text, `session_id`, `duration_ms`, `total_cost_usd`, `usage`, `permission_denials` |

Exit code 0 is success. A failure inside the run, such as a missing sign-in, is reported as the `result` on stdout, so read it before you look at stderr.

## Approvals through the app's MCP server

The tool named by `--permission-prompt-tool` receives the tool name and its input, asks the user in the app, and returns allow or deny. Its JSON answer, in the shape the Claude Code docs specify for permission prompt tools, is either an allow that may carry the (possibly edited) input, or a deny with a message the agent sees. Check the current shape in the Claude Code docs before you implement it. Keep the request pending in the UI with the tool, the file or command, and Allow / Deny; time out to deny.

## Cancel and stop

- Send **SIGINT** to end the current turn cleanly; the session stays resumable.
- **SIGTERM** exits with code 143 and leaves the turn unfinished; Claude Code ends the process tree of running shell commands first.
- Closing stdin on a long-lived process lets it finish and exit.

## API-key and Agent SDK runs

When the chosen path is an API key, the host may also use the Agent SDK packages (TypeScript, Python), which offer typed messages, an approval callback and interrupt. Run them with the API key the path names, never with a user's Claude.ai login. `--bare` is appropriate here.
