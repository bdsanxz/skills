# Engine: Codex (`codex`)

Checked against the Codex app-server documentation on 2026-10-14 (https://learn.chatgpt.com/docs/app-server). The protocol is versioned with Codex itself and parts are marked experimental: generate the types for the version you support and re-read the page before you rely on a method.

## Which interface

| Interface | Use |
| --- | --- |
| `codex app-server` | The interface for deep integration into your own product: threads, turns, streamed items, approvals, sign-in, rate limits. Use this for an in-app chat |
| `codex exec` (one-shot, with JSON output) | Scripts and CI. Check `codex exec --help` for the JSON flag and resume form of your version |
| Codex SDK | Automation and CI from code |

## Starting the server

```bash
codex app-server            # stdio, newline-delimited JSON
```

- Stdio is the supported transport. `--listen ws://127.0.0.1:<port>` and unix sockets exist; WebSocket is experimental and unsupported, and a non-loopback listener accepts unauthenticated connections by default. Use stdio from the host.
- Generate types for the installed version: `codex app-server generate-ts --out <dir>` or `codex app-server generate-json-schema --out <dir>`. Pin your code to them.
- Messages are JSON-RPC 2.0 without the `jsonrpc` field: requests have `method`, `params`, `id`; responses echo `id`; notifications have no `id`. The server also sends *requests* to the client (approvals); answer them by `id`.

## Handshake

1. Send `initialize` with `clientInfo` `{ name, title, version }`. `name` is stable and identifies your app in OpenAI's compliance logs; never use another app's name. Set `capabilities.experimentalApi` only if you use experimental methods.
2. Send the `initialized` notification. Requests before this fail with *Not initialized*.

## Sign-in

| Method | Purpose |
| --- | --- |
| `account/read` | Current account and whether OpenAI auth is required |
| `account/login/start` `{type:"chatgpt"}` | Browser sign-in: returns `authUrl` and `loginId`; open the URL in the user's browser; the app-server hosts the callback |
| `account/login/start` `{type:"chatgptDeviceCode"}` | Device sign-in: show `verificationUrl` and `userCode` |
| `account/login/start` `{type:"apiKey"}` | The user's own API key, stored by Codex |
| `account/login/start` `{type:"chatgptAuthTokens"}` | Experimental: the host supplies tokens. Only within Sign in with ChatGPT; answer `account/chatgptAuthTokens/refresh` within about 10 seconds |
| `account/login/completed` (notification) | Result of the attempt with that `loginId` |
| `account/login/cancel`, `account/logout` | Cancel or sign out; `account/updated` reports the new auth mode |
| `account/rateLimits/read`, `account/rateLimits/updated` | Plan usage for a limit indicator |

Which of these a commercial or hosted product may use is decided in `compliance.md`.

## Conversation

| Method | Purpose |
| --- | --- |
| `thread/start` | New conversation; keep `result.thread.id` with the project |
| `thread/resume` | Continue a stored thread, for example after restarting the server |
| `thread/fork`, `thread/read`, `thread/list`, `thread/archive` | Branch, read back, list, archive |
| `turn/start` | Send a user message (text plus attachments) to a thread |
| `turn/steer` | Add input to the turn in progress (the *Steer* behaviour) |
| `turn/interrupt` | Cancel the turn in progress; it ends with `status: "interrupted"` |

## Streamed notifications

`thread/started`, `thread/status/changed`, `turn/started`, `item/started`, `item/agentMessage/delta` (streamed text), `item/completed`, `turn/completed`. Only `turn.status == "completed"` is success; `failed` and `interrupted` are not. Items include agent messages, reasoning, command executions, file changes and MCP tool calls; map each item type to the neutral events in `architecture.md`.

## Approvals

The server asks the client, scoped to a `threadId` and `turnId`:

| Request | Decisions |
| --- | --- |
| `item/commandExecution/requestApproval` | `accept`, `acceptForSession`, `decline`, `cancel`, `acceptWithExecpolicyAmendment` |
| `item/fileChange/requestApproval` | `accept`, `acceptForSession`, `decline`, `cancel` |
| `item/permissions/requestApproval` | Network or filesystem permission grants. When `networkApprovalContext` is present, show a network prompt; the command is not a meaningful preview |
| `mcpServer/elicitation/request` | An MCP server asking the user for input |

`serverRequest/resolved` confirms the request was cleared, then `item/completed` gives the final status (`completed`, `failed` or `declined`).

## Product configuration

Give Codex the product the same way as Claude Code, with Codex's own mechanisms: project instructions (`AGENTS.md` in the project, or Codex configuration), the app's MCP server in Codex's configuration or as a config override at launch, and sandbox and approval policy settings. Check the Codex configuration docs of your version for the exact keys; do not copy Claude Code flags.
