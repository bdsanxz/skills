# Engine: Grok Build (`grok`)

Checked on 2026-10-14 against:
- the xAI docs at https://docs.x.ai/build (overview, headless and scripting, modes and commands, enterprise);
- the user guide in https://github.com/xai-org/grok-build (`crates/codegen/xai-grok-pager/docs/user-guide/`, files `02-authentication.md`, `14-headless-mode.md`, `15-agent-mode.md`, `18-sandbox.md`, `22-permissions-and-safety.md`);
- xAI's consumer terms (last updated 2026-10-12) and enterprise terms (last updated 2026-08-14).

Grok Build changes often: run `grok --version` and `grok --help`, and re-read those pages before you rely on a flag, event or method.

## What Grok Build is, and how it differs

Grok Build is xAI's terminal coding agent, installed as `grok`. Its first-party source is published under Apache-2.0 (`xai-org/grok-build`, a periodic sync of xAI's monorepo, no outside contributions), with third-party code under its own licenses (`THIRD-PARTY-NOTICES`, `third_party/NOTICE`). It runs xAI's Grok models, signed in with the user's xAI account or an xAI API key.

| Topic | Grok Build |
| --- | --- |
| Interfaces | **ACP** (`grok agent stdio`, or a WebSocket server) for apps and editors; headless `grok -p` for scripts. The docs present ACP as the way to use it in other apps |
| Permissions | Claude-Code-like modes and rules: `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` (always-approve), with `--allow`/`--deny` rules (`Edit(src/**)`, `Bash(git *)`). Deny beats ask beats allow |
| Sandbox | Built in: `--sandbox workspace` or `strict`, using Landlock and seccomp on Linux and Seatbelt on macOS. **The default is `off`.** On macOS child network blocking does nothing |
| Project inputs | Reads Claude Code's files too: `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`, and part of Claude Code's managed settings. A user's or project's Claude Code rules therefore also apply to the app's runs |
| Credentials | `~/.grok/auth.json` (browser or device sign-in), `XAI_API_KEY`; a session token outranks `XAI_API_KEY` |

## Terms

The terms are less explicit than Anthropic's, OpenAI's or Google's. As of the dates above:

- **Consumer terms (Grok and SuperGrok subscriptions).** They contain no clause about third-party apps that run Grok Build. They do say that the user may not share their account credentials or make the account available to anyone else. Using xAI's names, logos or brand needs xAI's permission under its Brand Guidelines, and beta features are not meant for production use. The consumer FAQ tells users to revoke and change credentials that a third-party app has used.
- **Enterprise terms (developers and businesses, including the API).** These let a business customer build integrations between xAI's services and its own product (a *Bundled Service*) and make it available to its end users, as long as:
  - the customer keeps terms and an acceptable-use policy with those end users that protect xAI at least as much;
  - the customer stays liable for what those end users do.

What follows for a host:

| Situation | Path |
| --- | --- |
| Personal or open-source tool on the user's machine, user's own xAI account | The user's own `grok` over ACP, signed in through `grok`'s own sign-in at xAI's page. The app never touches the token |
| Commercial product, user's own xAI subscription | The consumer terms do not forbid it, but they do not grant it either. Ask xAI for written confirmation before relying on it, and offer the API-key path |
| Any product, user pays per token | The user's own xAI API key, passed as `XAI_API_KEY` to that user's runs only |
| Commercial product, app maker pays | The maker's own xAI API account under the Enterprise Terms (Bundled Service), with end-user terms that carry xAI's acceptable-use policy |

## Detection, install and sign-in

| Need | How | Notes |
| --- | --- | --- |
| Install | `curl -fsSL https://x.ai/cli/install.sh \| bash` (macOS, Linux); `irm https://x.ai/cli/install.ps1 \| iex` (Windows) | Show the command to the user before running it. Add `--no-auto-update` to app runs, so an update does not happen mid-session |
| Version | `grok --version` | |
| Sign in | `grok login` (browser, `auth.x.ai`), or `grok login --device-auth` (prints a URL and a code for another device). Over ACP, `--reauth` signs in before the agent starts, and the `x.ai/auth/get_url` and `x.ai/auth/submit_code` methods run the sign-in from the client | Show the vendor's URL, let the user complete it on xAI's page. If a code must pass through the app, forward it to `grok` only; never log or store it |
| Signed in? | No status command is documented. Over ACP, `initialize` lists the auth methods the agent offers (`cached_token` when a sign-in is cached, `xai.api_key` when `XAI_API_KEY` is set). A headless run without either fails with exit code 1 | Map "no usable method" to *Not signed in* |
| Credentials | `~/.grok/auth.json`, `~/.grok/mcp_credentials.json` (mode 0600) | Never read, copy or edit them. Do not set `auth_provider_command` to feed the app's own tokens into the user's `grok` |

## Interfaces

| Interface | Use |
| --- | --- |
| `grok agent stdio` | ACP over JSON-RPC on stdio. Use this for an in-app chat: streamed updates, approvals, sessions, model changes. Official ACP client libraries exist for TypeScript, Rust, Python, Go and Kotlin |
| `grok agent serve --bind 127.0.0.1:<port> --secret <token>` | The same over WebSocket, for a host that cannot keep a child's stdio. Bind to loopback and always pass a secret (or `GROK_AGENT_SECRET`) |
| `grok -p "<prompt>" --output-format streaming-json` | One-shot, read-only event stream. It cannot ask for approval; use it only with rules decided before the run |

Agent flags go between `agent` and the transport: `grok agent --sandbox workspace stdio`.

## ACP session

1. `initialize` with `protocolVersion: 1` and the client capabilities you implement (`fs.readTextFile`, `fs.writeTextFile`, `terminal`). Offer only what the host really implements.
2. `authenticate` with a `methodId` from the `initialize` result (`xai.api_key` or `cached_token`).
3. `session/new` with `cwd` (the project), `mcpServers` (the app's loopback MCP server), and `_meta`:
   - `rules`: the product rules, appended to the system prompt. `systemPromptOverride` replaces the prompt; do not use it.
   - `agentProfile`: optional.
   - Leave out `yoloMode` (always-approve). `autoMode` enables the classifier mode.
4. `session/prompt` with `sessionId` and a `prompt` array of content blocks (`{"type":"text","text":"…"}`); it returns a `stopReason` when the turn ends.
5. Read `session/update` notifications. `sessionUpdate` is one of:
   - `agent_message_chunk`: streamed text;
   - `agent_thought_chunk`: reasoning;
   - `tool_call` and `tool_call_update`: tool rows;
   - `plan`: the agent's plan.
6. Change model or effort mid-session with `session/set_config_option` (`configId` `model` or `reasoning_effort`).
7. Load or resume sessions with the ACP session methods the agent advertises (`session/load`).

Approvals and cancel use the standard ACP methods:
- The agent asks with `session/request_permission`, sending the options it offers. The host answers with the option the user picked, or with *cancelled* when the card times out.
- The host cancels a turn with `session/cancel`.

The Grok docs do not spell these two methods out, so check them against the ACP specification and a test session with your `grok` version.

## Headless reference

```bash
grok -p "<prompt>" --output-format streaming-json \
  --cwd <project> -m <model> --effort <level> \
  -s <new-uuid> | -r <id> \
  --permission-mode dontAsk --allow 'Edit(src/**)' --allow 'Bash(npm test)' \
  --sandbox workspace --rules "<product rules>" \
  --max-turns <n> --no-auto-update
```

Events (one JSON object per line, switch on `type`, ignore unknown types):

| Event | Fields |
| --- | --- |
| `text` | `data` |
| `thought` | `data` |
| `tool_call` | `toolCallId`, `title`, `kind`, `status`, `toolName`, `rawInput`, `content`, `locations` |
| `tool_call_update` | `toolCallId`, `status`, `content`, `rawOutput`, `locations` |
| `usage` | `messageId`, `stopReason`, `usage` |
| `plan` | `entries` |
| `end` | Always last: `stopReason`, `sessionId`, `requestId`, `usage`, `num_turns`, `modelUsage`, cost when reported |
| `error` | `message` |

Exit codes:
- `0`: done;
- `1`: error (sign-in, network, runtime);
- `130`: SIGINT;
- `143`: SIGTERM.

On a signal, `grok` saves the session up to the last finished tool call; files the tools changed stay changed.

## Approvals and limits

1. **Mode.** Use `default` (asks for edits and commands) or `acceptEdits` (edits inside the allowed paths, asks for commands) over ACP. Use `dontAsk` with explicit `--allow` rules for headless runs. Never pass `--always-approve` or `--yolo`, and never set `yoloMode`.
2. **Path rules.** Grant edits with `--allow 'Edit(<editable>/**)'` and refuse the app's own folders with `--deny 'Edit(.<app>/**)'`. `Edit` covers `Write`, and `Read`/`Edit` deny rules also apply to paths that shell commands touch.
3. **Sandbox.** Start with `--sandbox workspace` (writes only in the project, `~/.grok/` and temp folders) or `strict`, or a custom profile in an app-owned `sandbox.toml` with `deny` paths. If a built-in profile cannot be applied, `grok` warns and runs unenforced, so check stderr and refuse to run in that case. A session keeps its profile when resumed.
4. **Claude Code settings leak in.** `grok` reads `.claude/settings.json` files, so rules and hooks the user set for Claude Code also shape the app's runs. Record the effective permission mode from the session and test with the user's real project.
5. **Hooks fail open.** A `PreToolUse` hook can deny a call, but if it crashes the call goes on. Do not make a hook the only gate.
6. **Subagents and plan mode.** Pass `--no-subagents` unless the product needs them, and `--no-plan` when the product has its own planning.
