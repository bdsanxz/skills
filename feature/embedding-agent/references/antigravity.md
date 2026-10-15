# Engine: Antigravity CLI (`agy`)

Checked against https://antigravity.google/docs (FAQ, CLI headless mode, Enterprise, Plans, CLI features and reference), the Antigravity terms at https://antigravity.google/terms, and the changelog of https://github.com/google-antigravity/antigravity-cli (version 1.3.5) on 2026-10-14. Google changes both the CLI and its terms often: re-read the FAQ, the terms and the headless page before every design.

## Read this first: Google does not allow wrapping it on consumer plans

The Antigravity CLI is Google's closed-source terminal agent, the CLI side of Antigravity. Unlike Claude Code and Codex, its terms rule out the normal embedding path:

- The FAQ says headless mode (`agy -p`) is meant for direct scripting and CI. It also says that wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans.
- The Antigravity terms (section 6) call using third-party software, tools or services to access the Service a breach, and name using the Service in connection with products Google does not provide. The penalty is suspension or termination of the user's Antigravity and Gemini CLI accounts.
- For a third-party agent that needs Gemini models, the FAQ points to a Gemini Enterprise or Google AI Studio API key instead.

So for any Google account on a consumer plan (individual, Google AI Pro, Google AI Ultra), **do not build an app that runs `agy` for the user**, whether the app is commercial or not, and even when the user signs in through `agy`'s own flow. Use one of these instead:

| Need | Path |
| --- | --- |
| The user wants their own Antigravity in the loop | The reverse direction: the app serves its actions as an MCP server (`architecture.md`, *Host placement*), and the user adds it to their own `agy` themselves (a plugin's `mcp_config.json`, or `/mcp`). The user runs `agy` in their own terminal; the app never starts it |
| Gemini models in the app's chat | Another engine with the user's own Gemini API key (from Google AI Studio or Gemini Enterprise): pi (`pi.md`) or omp (`omp.md`) with `GEMINI_API_KEY`, under the Gemini API terms |
| Organization on Gemini Enterprise | Possibly `agy` itself (below), only when the company's own Google Cloud agreement allows it and its administrator confirms in writing |

## When embedding may be possible: Gemini Enterprise

The terms say that a user who signs in through an organization's Google Cloud account, or with a Gemini Enterprise API key, is bound by the terms the organization's administrator accepted, not by the consumer terms. The Enterprise page says such sessions run under the organization's Google Cloud Terms of Service with central admin controls, and it describes Application Default Credentials (ADC) for headless and automated terminal use. Neither page says that running `agy` inside another application is allowed. Treat it as allowed only when:

1. the app is the organization's own internal tool, or the organization has a written agreement with Google that covers the product;
2. each user signs in with their own organization identity (Google Cloud SSO, Workforce Identity Federation, or their own ADC), never a shared account;
3. the administrator has confirmed this in writing, and the user has confirmed that to you.

Otherwise stop, tell the user that this needs the organization's written agreement, and offer the paths in the table above.

The changelog (1.1.13) also mentions that `agy` can run against the Gemini API directly with `GEMINI_API_KEY`, without a Google sign-in, but the Plans page says there is no bring-your-own-key support. Neither page says whether an app may run `agy` this way. Do not rely on it unless Google confirms it in writing; the pi or omp path above gives the same models without the doubt.

## Technical reference, for the allowed enterprise case

### Detection, install and sign-in

| Need | How | Notes |
| --- | --- | --- |
| Install | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (macOS, Linux); `irm https://antigravity.google/cli/install.ps1 \| iex` (Windows) | Installs `~/.local/bin/agy` (Windows: `%LOCALAPPDATA%\agy\bin`). Show the command to the user before running it |
| Models, agents | `agy models`, `agy agents` | |
| Sign-in | Interactive only: `agy`, then *Business account*, *Continue with Google Cloud*, and pick the license; or `gcloud auth application-default login --project <project>` with `AGY_ADC_AUTH=true` set for `agy`. `agy --project <id>` picks the project; `GOOGLE_CLOUD_LOCATION` sets the location | Credentials live in the system keyring. A headless run uses the cached credentials and exits with an "authentication required" error instead of waiting, so treat that error as *Not signed in* and send the user to a visible terminal to sign in |
| Settings | `~/.gemini/antigravity-cli/settings.json` | Never edit the sign-in or account parts |

### The headless protocol

`agy` has no long-lived RPC server. Its headless mode reads prompts as JSON lines on stdin and keeps one conversation per process:

```bash
agy -p --input-format stream-json --output-format stream-json \
  --model <slug> --effort <low|medium|high> [--agent <name>] \
  [--conversation <id>]
```

| Flag | Why |
| --- | --- |
| `-p` (`--print`, `--prompt`) | Headless |
| `--input-format stream-json` | Read `{"event":"user","message":{"content":"…"}}` lines from stdin, one turn per line. `content` is a string or a list of `text` blocks only. Requires `--output-format stream-json` |
| `--output-format stream-json` | JSON-lines events (below). `json` gives one envelope at the end |
| `--model`, `--effort`, `--agent` | An unknown model or agent fails the run (exit 1) instead of falling back |
| `--conversation <id>`, `--continue` | Resume a conversation by the `conversation_id` the app stored |
| `--json-schema` | Structured output for one-shot runs |
| `--print-timeout` | No limit by default. When it expires mid-turn, the run returns partial output and exits 0 with a warning |
| `--sandbox` | Terminal sandbox restrictions for the run |
| `--dangerously-skip-permissions` | Approves every tool call. Never for a product run |

Input rules: lines with an unknown `event` are skipped with a warning; `control_request` and `control_response` lines, slash commands, invalid JSON and non-text blocks end the session with an error. Closing stdin ends the session after the current turn. Attachments other than text are not accepted on this path.

Events:

| Event | Fields |
| --- | --- |
| `init` | `cwd`, `tools`, `permission_mode`, and `model`, `agent`, `json_schema` when set |
| `step_update` | `conversation_id`, `step_index`, `state` (`ACTIVE`, `DONE`), `step_type` (`user_input`, `agent_response`, `tool`, `checkpoint`, …), `tool_name`, `text_delta`, `duration_seconds`, `usage`, `tool_info` (`name`, `parameters`, `output`, `error`), `subagent_info` |
| `result` | One per turn: `conversation_id`, `status` (`SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, …), `response` (this turn), `error`, `duration_seconds`, `num_turns`, `usage` (cumulative), `denied_actions` |

Exit codes: `0` success, `1` run failure (unknown model or agent, malformed input), `2` usage error (control messages, slash commands), `3` model or agent error, with an `AGY_ERROR: {…}` JSON line on stderr.

### Approvals and limits

Headless mode **cannot ask**: there is no approval request in the protocol. A tool call that needs an approval it does not have is skipped (soft-denied), the run continues, and the refusals appear in `denied_actions` and on stderr. So there are no approval cards; decide everything before the run:

- Workspace file reads and writes are allowed; shell commands default to ask, which headless turns into deny.
- Allow the commands the product needs with `permissions.allow` rules (`command(npm test)`) and block others with `permissions.deny` in the settings; keep `allowNonWorkspaceAccess` off.
- Turn on the terminal sandbox (`--sandbox`, or `enableTerminalSandbox`), which uses the OS sandbox (`sandbox-exec`, `nsjail`, AppContainer).
- Show `denied_actions` to the user after the run, with what to allow if they want it next time.
- Steer and queue do not exist: queue the next message as the next stdin line, and cancel by ending the process (no documented interrupt).

Product rules, skills and MCP tools reach `agy` as a plugin (`plugin.json` with `rules/`, `skills/`, `mcp_config.json`, `hooks.json`), installed with `agy plugin install <path>`. That installs it into the user's own `agy` for every project, so ask first, and check the plugin docs for a per-run way to load it before you rely on a global install.
