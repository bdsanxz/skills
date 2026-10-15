# Engine: pi (`pi`)

Checked against the pi documentation at https://pi.dev/docs/latest on 2026-10-14. pi changes quickly: run `pi --version` and `pi --help`, and re-read the RPC, JSON, CLI, providers and security pages before you rely on a command or event.

## What pi is, and how it differs

pi is an open-source (MIT) coding-agent harness by Mario Zechner, published as `@earendil-works/pi-coding-agent` (repository `earendil-works/pi`). It is not tied to one model vendor: it talks to many providers (Anthropic, OpenAI, Google, Mistral, Groq, xAI, OpenRouter, local models, and others) with an API key or, for some, a subscription sign-in.

This changes three things compared with Claude Code and Codex:

| Topic | Claude Code / Codex | pi |
| --- | --- | --- |
| Terms that bind the harness | The vendor's terms for its own binary | The MIT license only. Bundling or modifying pi is allowed if the product keeps pi's copyright and license notice |
| Terms that bind the model access | The same vendor | **Each model provider's terms**, separately. Which sign-in pi offers does not decide which sign-in your app may use. See `compliance.md`, section *pi* |
| Permissions | Built-in permission modes, rules and approval requests | **None built in.** pi runs every tool call with the OS permissions of its process and does not ask. Project trust only decides which project resources load. Enforce limits yourself (below) |

## Detection, install and credentials

| Need | How | Notes |
| --- | --- | --- |
| Find it | `pi` on the login-shell `PATH` | Or bundle it (Node 22.19 or newer) |
| Version | `pi --version` | |
| Install | `curl -fsSL https://pi.dev/install.sh \| sh`, or `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, or Nix `github:earendil-works/pi/stable` | Show the command to the user before running it |
| Models available | `pi --list-models [search]` | Shows which providers have working credentials |
| Credentials | Environment variables per provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, …), `--api-key <key>` for one run, or `auth.json` in pi's agent folder (`~/.pi/agent/auth.json`), written by `/login` in interactive pi | `/login` is interactive only. To use it, open interactive `pi` in a terminal the user can see. Never read or write `auth.json` from the host |

For an embedded engine, the clean path is the user's own API key per provider: the user enters it in the app's settings, the host stores it in the OS keychain, and passes it only to that user's runs as an environment variable. Do not drive pi's subscription sign-ins from the app; `compliance.md` explains why.

## Interfaces

| Interface | Use |
| --- | --- |
| `pi --mode rpc` | Long-lived process, JSON commands on stdin, responses and events on stdout. Use this for an in-app chat in any language |
| SDK (`createAgentSession()` from `@earendil-works/pi-coding-agent`) | In-process for a Node.js or Bun host: `session.subscribe()`, `prompt()`, `steer()`, `followUp()`, `dispose()`, custom tools, in-memory sessions and settings. No subprocess, no framing to parse |
| `pi --mode json "<prompt>"` | One-shot: runs, prints JSONL events, exits. Starts with a `session` header line (not emitted in RPC mode) |
| `pi --print` | Final text only |

## Starting an RPC run

```bash
pi --mode rpc \
  --provider <provider> --model <model> --thinking <level> \
  --session-dir <project>/.<app>/pi-sessions --session-id <id> \
  --append-system-prompt <app-owned rules file> \
  --no-extensions -e <app-owned extension> \
  --no-skills --skill <app-owned skills folder> \
  --no-prompt-templates --no-approve \
  --tools <allowlist>
```

| Flag | Why |
| --- | --- |
| `--mode rpc` | Headless, JSON over stdin and stdout |
| `--provider`, `--model`, `--thinking` | Model and reasoning level (`off` … `max`, clamped to the model) |
| `--session-dir`, `--session-id` | Keep the app's conversations in the app's folder with an ID the host chose. `--no-session` for throwaway runs; `--fork <id>` to branch |
| `--append-system-prompt` | Product rules, keeping pi's own prompt. Repeatable; text or a file path. `--system-prompt` replaces it |
| `--no-extensions` plus `-e` | Ignore the user's and the project's extensions; load only the app's own (which carries the approval gate and product tools) |
| `--no-skills` plus `--skill` | Only the app's skills |
| `--no-approve` | Ignore trust-gated project resources (project settings, `.pi/mcp.json` servers, project extensions and skills). Non-interactive modes cannot show the trust prompt; decide explicitly. Context files (`AGENTS.md`, `CLAUDE.md`) still load; `--no-context-files` skips them |
| `--tools`, `--exclude-tools`, `--no-builtin-tools` | Allowlist or remove tools |
| `--no-mcp` | Turn off pi's built-in MCP support when the product gives its tools through the extension instead |
| `--offline` | No automatic network activity such as catalog refreshes |

## RPC framing

- One JSON object per record, ended by LF. Strip an optional CR. **Split on LF only**: generic line readers (Node's `readline` among them) also split on U+2028 and U+2029, which are valid inside JSON strings.
- Stdout carries protocol records only; read it continuously. Stderr is diagnostics; never parse it as protocol.
- Honour stdin backpressure when writing.
- Every command may carry a string `id`; its `response` repeats it. Events carry no `id` (except `bash_execution_update`).
- `{"type":"response","command":…,"success":false,"error":…}` reports a failed command. A successful response only means the command was accepted; provider failures and aborts arrive as events.
- Close stdin for an orderly shutdown.

## Commands

| Command | Shape | Notes |
| --- | --- | --- |
| Send a message | `{"type":"prompt","message":"…","images":[{"type":"image","data":"<base64>","mimeType":"image/png"}]}` | Response `data.disposition`: `started` (a run began), `queued`, or `handled` (an extension consumed it; no run follows, so do not wait for `agent_settled`). While a run streams, `streamingBehavior` (`"steer"` or `"followUp"`) is required |
| Steer | `{"type":"steer","message":"…"}` | Injects into the running turn (the *Steer* behaviour) |
| Queue | `{"type":"follow_up","message":"…"}` | Runs after the current run (the *Queue* behaviour); `clear_queue` empties it |
| Cancel | `{"type":"abort"}` | |
| State | `{"type":"get_state"}` | Model, thinking level, `isStreaming`, `sessionFile`, `sessionId`, pending messages |
| Sessions | `new_session`, `switch_session {sessionPath}`, `fork`, `clone`, `get_messages`, `get_tree` | |
| Model | `set_model {provider, modelId}`, `set_thinking_level {level}`, `get_available_models` | |
| Other | `compact`, `set_auto_retry`, `get_session_stats`, `get_last_assistant_text`, `bash`, `abort_bash` | `bash` runs a command for the user, not for the agent |

## Events

| Event | Use it for |
| --- | --- |
| `agent_start`, `turn_start` | Run and turn began |
| `message_start`, `message_update`, `message_end` | `message_update.assistantMessageEvent` streams `text_delta`, `thinking_delta` and `toolcall_*` per `contentIndex`, plus cumulative `usage`. `message_end.message` is authoritative; replace what you assembled with it |
| `tool_execution_start` / `_update` / `_end` | Tool rows: `toolCallId`, `toolName`, `args`, `partialResult`, `result`, `isError`, `durationMs` |
| `turn_end` | The turn's message and tool results |
| `agent_end` | One low-level run ended; **more may follow** (`willRetry`, queued follow-ups) |
| `agent_settled` | pi will not continue on its own (`aborted` says whether it was cancelled). This is the end of the run for the UI |
| `queue_update` | Current steering and follow-up queues, for a "queued" indicator |
| `auto_retry_start` / `auto_retry_end` | Retry progress |
| `compaction_start` / `compaction_end` | Context compaction |
| `extension_ui_request` | A dialog or notice from an extension (approvals, below) |
| `extension_error` | An extension failed; show it as a diagnostic |

## Approvals and limits

pi has no permission rules, so build the gate yourself, in layers:

1. **Isolation.** pi's own security docs name a container, VM or sandbox as the strongest option. Mount only the project folder (read-only where the product says so), pass only the credentials the run needs, and restrict network access if tools do not need it. Without isolation, at least run under an OS account that cannot reach more than it must.
2. **An approval extension.** Ship an extension (loaded with `-e`) that inspects each tool call before it runs, refuses writes outside the editable folders, and asks the user for anything gated through its UI context. The ask reaches the host as `extension_ui_request` (`confirm` with `title` and `message`, or `select`, `input`, `editor`, each with an `id` and optional `timeout`). The host shows an approval card and answers with `{"type":"extension_ui_response","id":…,"confirmed":true}` or `{"…","cancelled":true}`. Set a `timeout` so an unanswered ask resolves to deny. Check pi's extensions documentation for the tool-call hook of your version.
3. **Tool allowlist.** Start from the smallest `--tools` list the product needs.

Product actions go in the same app-owned extension as custom tools, or (SDK hosts) as `customTools`. Fire-and-forget extension UI (`notify`, `setStatus`, `setWidget`) can drive status lines in the app.
