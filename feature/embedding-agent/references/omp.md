# Engine: omp (oh-my-pi)

Checked against the oh-my-pi repository (https://github.com/can1357/oh-my-pi, `docs/rpc.md`, `docs/cli-reference.md`, `docs/approval-mode.md`, `docs/providers.md`, `docs/extension-loading.md`, `docs/sdk.md`) on 2026-10-14. omp releases often: run `omp --version` and `omp --help`, and re-read those pages before you rely on a command, flag or event.

## What omp is, and how it differs from pi

omp is an open-source (MIT) coding agent forked from pi (`pi.md`), maintained by Can Bölük and Stencil Labs, published as `@oh-my-pi/pi-coding-agent`. It keeps pi's multi-provider model and much of pi's RPC protocol, and adds many built-in tools (LSP, debugger, subagents, browser, memory), an ACP server, and a tool approval system.

| Topic | pi | omp |
| --- | --- | --- |
| License | MIT | MIT. Keep omp's copyright notice and its `THIRD-PARTY-NOTICES.txt` (it vendors code under other licenses) |
| Model access terms | Each provider's | Each provider's, the same as pi. See `compliance.md`, section *pi and omp* |
| Permissions | None | **Approval tiers** (`read`, `write`, `exec`) with modes `always-ask`, `write`, `yolo`. **The default is `yolo`**, so set a mode explicitly. Approvals are not containment: an approved command keeps the shell's full file, network and process access |
| End of a run | `agent_settled` | `prompt_result` for one prompt, `session_settled` when the session is idle. omp has no `agent_settled` |
| Startup | Ready to read commands | Writes a `ready` frame first; wait for it |
| Project inputs | Trust-gated (`--no-approve`) | Loaded from the project by design (settings, extensions, hooks, tools, MCP config), with no trust prompt. Turn each off explicitly (below) |
| Credentials | `~/.pi/agent/auth.json` | Auth store `~/.omp/agent/agent.db` (moved by `--profile` or `PI_CODING_AGENT_DIR`), plus `.env` files |

## Detection, install and credentials

| Need | How | Notes |
| --- | --- | --- |
| Find it | `omp` on the login-shell `PATH` | Other tools also install a binary or alias called `omp`. Check that `omp --version` reports oh-my-pi before you use it |
| Version | `omp --version` | |
| Install | `curl -fsSL https://omp.sh/install \| sh` (Windows: `irm https://omp.sh/install.ps1 \| iex`), `brew install can1357/tap/omp`, `bun install -g @oh-my-pi/pi-coding-agent`, Nix `github:can1357/oh-my-pi` | Show the command to the user before running it. The installer falls back to a prebuilt binary when Bun (1.3.14 or newer) is missing |
| Models available | `omp models` | |
| Credentials | `--api-key <key>` for one process (never persisted), provider environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, …), `.env` files (`<project>/.env`, `~/.omp/agent/.env`, `~/.omp/.env`, `~/.env`), or OAuth logins (`/login`, `omp login <provider>`) stored in the auth store | **Stored OAuth logins outrank environment variables.** A user who once logged in to a subscription in their own omp would have the app's runs use that login instead of the key the app passed. Run the app's runs under an app-owned profile (`--profile <app>`), whose auth store holds no logins, so the key the app passes is the one used |

Never call `omp token` (it prints a provider's API key or OAuth token), never read the auth store, and never use `auth-broker` or `auth-gateway` to share one user's logins with other users or machines. For an embedded engine, take the user's own API key per provider into the OS keychain and pass it only to that user's runs.

## Interfaces

| Interface | Use |
| --- | --- |
| `omp --mode rpc-ui` | Long-lived process, JSON lines on stdin and stdout, with dialogs (approvals, `ask`) sent to the host as `extension_ui_request`. Use this for an in-app chat in any language |
| `omp --mode rpc` | The same protocol, but extension UI is disabled (except the `login` method, which the host never issues). Approvals that need a dialog then fail closed. Use it only when nothing in the product asks the user |
| `omp acp` | Agent Client Protocol (JSON-RPC over stdio), as editors such as Zed use it. Approvals arrive as `session/request_permission`. Use it when the app already speaks ACP |
| SDK (`createAgentSession()` from `@oh-my-pi/pi-coding-agent`) | In-process for a Bun host only: `session.subscribe()`, `prompt()`, `steer()`, `followUp()`, `abort()`, `dispose()`, `Settings.isolated({...})`, `disableExtensionDiscovery`, `toolNames` with `restrictToolNames: true`. Runtime keys with `keys.setRuntime` |
| `omp --mode json "<prompt>"` | One-shot: runs, prints JSON-lines events, exits |
| `omp -p "<prompt>"` | Final text only |

## Starting an RPC run

```bash
omp --mode rpc-ui \
  --profile <app> \
  --cwd <project> \
  --model <provider/model> --thinking <level> \
  --session-dir <project>/.<app>/omp-sessions \
  --append-system-prompt <app-owned rules file> \
  --no-extensions -e <app-owned extension> \
  --no-skills --no-rules \
  --config <app-owned overlay.yml> \
  --approval-mode always-ask \
  --tools <allowlist>
```

| Flag | Why |
| --- | --- |
| `--mode rpc-ui` | Headless, JSON over stdio, with approval dialogs routed to the host |
| `--profile <app>` | Separate auth store, sessions, settings and caches for the app's runs, so the user's own omp logins and settings do not apply |
| `--cwd`, `--add-dir` | Working folder, and extra folders the agent may reach. Do not pass `--allow-home` |
| `--model`, `--thinking` | Model (an ID, `provider/model`, or a role such as `@slow`) and reasoning level (`off` … `max`, or `auto`) |
| `--session-dir`, `--session <id>`, `--fork <id>`, `--no-session` | Keep conversations in the app's folder, resume one, branch one, or run without saving |
| `--append-system-prompt` | Product rules, keeping omp's own prompt. `--system-prompt` and `--system-prompt-template` replace it |
| `--no-extensions` plus `-e` | Ignore ambient extensions (project `.omp/extensions`, user extensions, installed plugins); load only the app's. `--trusted-extension <abs-path>` is the stricter form: only the named files, but it cannot be combined with `-e` or `--hook` |
| `--no-skills`, `--skills <globs>`, `--no-rules` | Keep the user's and the project's skills and rules out, or allow only named ones |
| `--config <file>` | An app-owned settings overlay, for settings that have no flag, for example `mcp.enableProjectConfig: false` so the project's MCP servers do not load, and `tools.approval.<tool>` policies |
| `--approval-mode always-ask` or `write` | `always-ask` prompts for `write` and `exec` tools; `write` prompts only for `exec`. Never pass `--yolo` or `--auto-approve` for a product run |
| `--tools <a,b,c>`, `--no-tools`, `--no-lsp` | Allowlist tools |
| `--max-time <duration>` | Upper bound on a run |

## RPC framing

- One JSON object per line, ended by LF. Split on LF only, as for pi.
- On startup omp writes `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[…],"maxFrameBytes":1048576,…}`. Send nothing before it.
- A stdout frame is at most `maxFrameBytes` (1 MiB). Under protocol 1 an oversized response fails. To receive large objects, send `{"id":"p1","type":"negotiate_protocol","protocolVersion":2}`, then reassemble `rpc_chunk` frames (`chunkId`, `index`, `count`, `byteLength`, base64 `data`) and validate the total.
- Every command may carry a string `id`; its `response` repeats it: `{"id":"r1","type":"response","command":"prompt","success":true,"data":{"agentInvoked":true}}`, or `"success":false` with `error` and an optional `code`.
- A malformed line gets `{"type":"response","command":"parse","success":false,…}` and the loop continues.
- `@file` arguments are rejected in RPC mode; send attachments as `images` or as text.
- Close stdin for an orderly shutdown: omp finishes accepted commands, flushes stdout and exits.

## Commands

| Command | Shape | Notes |
| --- | --- | --- |
| Send a message | `{"id":"r1","type":"prompt","message":"…","images":[…]}` | The response only means the prompt was admitted. While a run streams, add `streamingBehavior` (`"steer"` or `"followUp"`) |
| Steer | `{"type":"steer","message":"…"}` | Queued into the running turn |
| Queue | `{"type":"follow_up","message":"…"}` | Runs after the current turn; `remove_queued_message`, `promote_queued_message` manage the queue |
| Cancel | `{"type":"abort"}` | `abort_and_prompt` cancels and then sends a new message; `abort_and_restore_queue` cancels and returns the queued messages |
| State | `{"type":"get_state"}` | Includes `isSettled` |
| Sessions | `new_session`, `switch_session {sessionPath}`, `open_session {sessionDir}`, `fork {entryId}`, `branch {entryId}`, `get_messages_page`, `get_entries` | History entries use omp's own payloads, not pi's |
| Model | `set_model {provider, modelId}`, `set_thinking_level`, `get_available_models` | |
| Other | `compact`, `set_auto_retry`, `set_event_filter`, `bash`, `abort_bash` | `bash` runs a command for the user, not for the agent |

## Events

| Event | Use it for |
| --- | --- |
| `agent_start` | Run began |
| `message_start`, `message_update`, `message_end` | `message_update` carries `messageId` and `assistantMessageEvent` (`text_delta`, thinking and tool-call deltas). `message_end` is authoritative |
| `tool_execution_start` / `_update` / `_end` | Tool rows |
| `agent_end` | A low-level run ended. `yielded: false` means omp continues (retry, compaction, reminder); older versions omit `yielded` |
| `prompt_result` | **The end of one prompt for the UI**: `id`, `agentInvoked`, `status` (`completed`, `aborted`, `error`), `error` (`message`, `provider`, `model`, `httpStatus`, `retryable`), `sessionSettled` |
| `session_settled` | The session is idle; nothing more will happen on its own |
| `queue_update` | `steering` and `followUp` queues, for a "queued" indicator |
| `auto_retry_*`, `auto_compaction_*`, `notice` | Status lines |
| `extension_ui_request` | A dialog: approvals and questions (below) |
| `extension_error` | An extension failed (`extensionPath`, `event`, `error`); show it as a diagnostic |

## Approvals and limits

1. **Approval mode.** Launch with `--approval-mode always-ask` (or `write` when edits inside the project need no ask), and add per-tool policies (`tools.approval.<toolName>: allow | deny | prompt`) in the app's `--config` overlay. A `deny` always wins. Gate `eval` too: it can start a shell, and `bash.patterns` rules do not cover it.
2. **The approval card.** In `rpc-ui` mode an approval arrives as `extension_ui_request` with `method` `confirm` (`title`, `message`, `timeout`) or `select` (`options`, `optionDetails`) with the full details. Show it as an approval card and answer `{"type":"extension_ui_response","id":"…","confirmed":true}`, `{"…","value":"<option>"}` for a `select`, or `{"…","cancelled":true}`. When the dialog times out or the run is aborted, omp sends `{"method":"cancel","targetId":"…"}`: close the card; a later answer is ignored. `ask` dialogs (`questions`, answered with `answers`) appear only after the host enables them with `set_ask_dialog`.
3. **No UI, fail closed.** Under `--mode rpc` or `--no-ui`, a call that still needs approval fails instead of running. Rely on this for unattended runs.
4. **Path rules and isolation.** omp approvals decide per tool call, not per path. Enforce "write only these folders" in the app-owned extension (its `tool_call` handlers see each call's input before it runs, and approval is re-checked on the input they leave; check omp's `docs/extensions.md` for how a handler blocks a call in your version), and run omp in a sandbox or container holding only the project, as for pi.
5. **Subagents** run in `yolo`. Remove the subagent tool from `--tools` unless the product needs it and the sandbox contains it.

Product actions go in the app-owned extension as custom tools, or on the app's MCP server (omp's MCP tools have tier `write`, so they ask under `always-ask`; allow them with `tools.approval.mcp__<server>_<tool>: allow`).
