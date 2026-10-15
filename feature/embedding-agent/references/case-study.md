# Studying how another app embeds an agent

## Method: find out from the outside

Most apps that embed an agent keep that part closed. Gather evidence in this order, strongest first, and label every claim with its source.

1. **The app's open code**, if any. Search it for the engine flags and protocol names (`stream-json`, `--append-system-prompt`, `--permission-prompt-tool`, `app-server`, `turn/start`). Their absence means the integration lives in a closed part.
2. **The app's own run records.** Apps that keep run histories often write them into the project folder (look for a hidden app folder with `*.jsonl`). A trace with the exact arguments, the prompt sent and every raw event is near-proof.
3. **The running process.** `ps -o args= -p <pid>` (or the platform's process tool) shows the engine's full command line while it runs.
4. **The engine's init event**, from a trace: the tools, MCP servers, plugins, permission mode and auth source the app gave it.
5. **The app's user documentation.**
6. **Asking the embedded agent about itself.** Weakest: an agent can be wrong about its own setup. Ask a question-only message so nothing changes.

Do not unpack or read a closed app's bundled code (for example an `app.asar`); learn from behaviour and records, and describe the pattern in your own words. Do not copy the app's system prompt, skills or other text into a new product.

When you drive the app's UI to send a test message, check that the app is frontmost and the chat input has focus before typing, and read the input's value back before pressing Enter; otherwise keystrokes land in the editor as shortcuts. Expect side effects (an app may rename the project after the first message) and report them.

## Worked example: HyperFrames desktop app (observed 2026-10-14)

Sources: the open-source repository (`heygen-com/hyperframes`, which holds the editor library, preview server and CLI, but not the desktop app), the desktop app's process list, its run records in a project folder, and its user docs. The desktop app (Electron) is closed source.

| Finding | Source |
| --- | --- |
| The desktop app runs the user's own installed `claude`; usage counts against the user's Claude plan (the chat shows the plan's weekly limit; init reports no API key) | Run trace, screen |
| One process per chat message: `claude --print --input-format stream-json --output-format stream-json --verbose …`; later messages add `--resume <session_id>` | Run trace (`args`) |
| Product rules appended with `--append-system-prompt` (about 8.5k characters): answer questions without editing; edit only the composition files and assets; never start servers or render; keep the timeline length consistent; short plain replies; markers for cards | Process command line, trace |
| Product skills loaded from the app's own folder with `--plugin-dir`; the user's own skills and plugins mostly switched off with `--settings` and `--setting-sources user` | Process command line, init event |
| A local MCP server on `127.0.0.1` with a bearer secret from an environment variable, exposing about 22 product tools (media generation, background removal, imports, app help) | Process command line, init event |
| Unwanted engine features removed with `--disallowedTools`, plus `Edit`/`Write` deny rules on the project's reference folders | Process command line |
| `bypassPermissions` with approvals routed back over the stdio protocol | Process command line |
| Each message carries an `<app_context>` block with the playhead time | Run trace (`prompt`) |
| Per project: `agent-runs.jsonl` (instruction, engine, effort, playhead, marks, attachments, session, status, reply) and `run-traces/<run>.jsonl` (start record with binary, arguments, prompt and system prompt; every raw event; exit record with `changedFiles`) | Project folder |
| Agent edits reach the editor through files only: a recursive file watcher (debounced, app folders excluded) pushes `file-change` server-sent events, and the editor reloads the preview and thumbnails | Open code (preview server and editor) |
| Cards come from HTML-comment markers in the reply; the parser scans the whole reply, so a marker the agent only mentioned broke the card ("could not be shown") | System prompt, screen |
| Onboarding: *Install Claude Code* runs Anthropic's official installer; *Sign in* runs Claude's own sign-in in the browser; *Check* confirms it answers. Codex is not auto-installed; the user copies its install and sign-in commands | User docs |
| Sending during a run: *Queue* or *Steer* (interrupt and restart with the new words). Each run has its own Undo | User docs |
| The open editor library also offers non-embedded routes: WebMCP tools in the page for an outside agent, and a "copy prompt with context" button | Open code |

Lessons this skill takes from it: run the user's own unmodified engine headless, configure it only by flags, give it the product through an appended prompt, skills and a loopback MCP server, let files be the only edit channel, record every run, and avoid two of its weak spots (`bypassPermissions` as the baseline, and markers parsed from anywhere in the text).
