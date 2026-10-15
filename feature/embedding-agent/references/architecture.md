# Architecture of an embedded agent

The parts, from the user's keystroke to the edited file:

```text
 App UI (chat panel, editor)            Host (main process or backend)               Engine (child process)
 ───────────────────────────            ──────────────────────────────               ──────────────────────
 user text + editor state  ──IPC/HTTP──▶ run queue ─▶ adapter ─ stdin JSON ────────▶ claude / codex / pi / omp
 chat bubbles, tool rows   ◀─push─────── neutral events ◀── stdout JSON lines ─────── events
 approval card             ◀─push─────── pending approval ◀── approval request ───── (permission tool / server request)
                                          app MCP server (loopback, secret) ◀─ tool calls ─ product actions
 preview reloads           ◀─push─────── file watcher ◀── project folder ◀────────── file edits
                                          run record + raw trace ─▶ <project>/.<app>/
```

## Host placement

| Delivery | Host | Page ↔ host | Notes |
| --- | --- | --- | --- |
| Desktop (Electron, Tauri, native) | Main process or a backend process the app starts | The framework's IPC | Never start the engine from a renderer or webview; keep process control in the trusted process |
| Web app, local | A companion process on the user's machine (often the app's own CLI or dev server) | HTTP + server-sent events or WebSocket on `127.0.0.1` | Bind to loopback only. Require a random per-launch secret on every request (put it in the URL fragment or an injected global the page reads once, not in a cookie). Check `Origin` against the app's own origin. Reject DNS-rebinding by checking `Host` |
| Web app, hosted | A per-user sandbox (container or VM) the app runs for that user | The app's own backend | Only on a path `compliance.md` allows: the user signs in to the unmodified engine inside their own sandbox, or the run uses the user's API key. Never one engine for several users |

A browser page alone cannot embed an engine. When no host is possible, offer the reverse direction instead: expose the app's actions as an MCP server (or WebMCP tools in the page) and let the user's own agent, running elsewhere, connect to it; or copy a ready-made prompt with the editor context to the clipboard. These need no compliance path because the app never runs the engine.

## Onboarding

One status object per engine, refreshed on app start, on focus, and after each fix:

| State | Detected by | Action shown |
| --- | --- | --- |
| Not installed | Binary not found | *Install* (official installer, after consent) or *Copy install command* |
| Installed but will not start | Version or status command fails | *Show details* (stderr, the engine's doctor command) and *Copy command* to run it in a terminal |
| Not signed in | Status command or `account/read` says so, or (pi, omp) no working key for the chosen provider, or (Antigravity CLI) a headless run exits with "authentication required", or (Grok Build) ACP `initialize` offers no usable auth method | *Sign in*, which runs the engine's own sign-in and opens the vendor's page |
| Ready | Status OK and a tiny test turn completed | Engine picker shows it as usable |

- Resolve the binary through the user's login shell once, because GUI apps do not inherit the shell `PATH`, and cache the absolute path. Re-resolve when it disappears.
- Keep the user's first request while onboarding runs, and send it when the engine becomes *Ready*.
- When a step fails, show the exact command the user can run in a terminal, with a *Copy* button and an *Open terminal* button.

## Engine adapter

One adapter per engine implements:

```text
start(run: RunInput) -> RunHandle            # spawns or reuses the engine, sends the message
events(run) -> stream of NeutralEvent        # parsed, normalized, in order
answerApproval(run, requestId, decision)
cancel(run)                                  # clean end of the turn
sessionIdOf(run) -> string | null            # to resume the conversation later
```

`RunInput`: project folder, conversation ID or null, user text, editor context, attachments, model, effort, engine.

Neutral events (the UI only knows these):

| Event | Fields |
| --- | --- |
| `session` | engine, session ID, model, tools, MCP servers with status, loaded plugins, auth source name |
| `status` | short state: starting, requesting, thinking, running tool, retrying (with delay) |
| `text.delta` / `text.done` | message ID, text |
| `thinking.delta` / `thinking.done` | summary text |
| `tool.start` / `tool.end` | tool call ID, tool name, a one-line human summary ("Reading index.html"), input, result status |
| `approval.request` | request ID, kind (command, file change, network, other), what exactly, choices |
| `usage` | plan windows and percentage used, if the engine reports them |
| `result` | success or error kind, final text, duration, cost, token usage, denials |
| `error` | engine stderr or a parse failure, for diagnostics only |

Write the summary text for `tool.start` in the adapter, from the tool name and its input, so every engine shows the same wording.

## Product configuration

1. **Rules file.** A system-prompt addition owned by the app and versioned with it. Keep it short and specific to the product:
   - what the agent may edit and what it must only read (and enforce the same with permission rules);
   - what the app does itself, so the agent must not (start servers, render, export);
   - when to answer with text only (questions, plans, explanations) and when to edit;
   - the product's invariants (for example, a total duration that must match the content);
   - the voice of replies (plain words, short);
   - which product tools exist and when to use them.
2. **Skills.** The product's domain knowledge (file formats, conventions, workflows) as skills in a folder the app owns and loads per run. Version them with the app. If the app also copies them into the project for other agents, record which version was copied.
3. **App MCP server.** (For pi and omp, the same tools usually ship as custom tools in the app-owned extension.) The host serves the product's actions as MCP tools (inspect the canvas, render a frame to an image, generate media, import, look up app help). Bind to loopback, require a per-session secret passed to the engine through its MCP config and an environment variable, and give each tool a clear name, description and schema. A tool that writes must go through the same code path, validation and undo history as a user's edit, and return what happened.
4. **Limits.** Remove engine features the product does not want (scheduling, background agents, publishing, notifications). Deny writes to the app's own folders. Keep the user's unrelated personal plugins and project hooks out of the run when the product needs predictable behaviour, using the engine's documented isolation flags. Never touch sign-in settings.
5. **Approvals.** Pick the permission baseline that matches the product (edits allowed inside the project, everything else asks), and route every remaining approval to an approval card in the chat. Time out to *deny*. An engine with no permission system (pi) gets the same card from an app-owned extension that gates tool calls, and runs inside a sandbox that holds only the project and the credentials the run needs. omp has approval modes but no path rules and defaults to approving everything: set its mode explicitly, and add the same extension and sandbox. An engine that cannot ask in headless mode (the Antigravity CLI soft-denies) gets its allow and deny rules before the run; show its refused actions after the run instead of a card.

## Context injection

Append a delimited block after the user's text:

```text
<user's words, unchanged>

<app_context>
Selected element: <path or ID> in <file>
Cursor / playhead: <value with unit>
Open file: <path relative to project>
Marks: <what the user drew or commented, in words or as coordinates with a legend>
</app_context>
```

- Only facts the editor knows at send time; never instructions the user did not write.
- Use paths the agent can open (absolute, or relative to its working directory).
- For larger context (a source snippet, a screenshot), attach it, or give the agent a tool to fetch it, instead of pasting it every turn.
- Tell the agent in the rules file what the block means.

## Structured cards

Cards in the chat (choices, plans, previews) come in two ways:

1. **Tool calls (preferred).** The app's MCP server has a tool such as `propose_options` whose input schema is the card. The UI renders the call as a card; the user's pick is sent as the next message or returned as the tool result. Validated, typed, never confused with prose.
2. **Markers in the text (only if a tool is impossible).** The rules file defines a marker, for example `<!-- app:card {json} -->`. Then:
   - parse markers only from the final text of a completed message, never from streamed deltas;
   - accept a marker only when it stands on its own line, outside code blocks and inline code, and its JSON validates against the schema;
   - when a marker fails to parse, show the surrounding text normally and log the failure, instead of an error card. (An agent that merely *mentions* a marker while explaining it must not break the chat.)

## Edits and sync

- **Watcher.** Watch the project folder recursively. Ignore the app's own folders, caches, build output, version-control folders and temporary atomic-write files. Debounce: emit after writes go quiet for a short interval (tens of milliseconds), and at most once per longer interval (hundreds of milliseconds), so a multi-file edit reloads once.
- **Push.** Send one change event per batch to the UI (IPC, or server-sent events for a page), with the path, a version, the project ID, and what it affects, so the UI reloads only what changed and a stale tab ignores another project's events.
- **Self-writes.** Tag writes the app makes itself, so the UI does not treat its own save as an external change and reload over the user's work.
- **Per-run changes.** Before a run, record a snapshot (content hash or copy) of the editable files. After the run, compare and store `changedFiles`. Show *no changes* when it is empty, and offer *Undo this run*, which restores the snapshot when the files still match the run's result, and asks first when the user edited them since.
- **Project lock.** Commands the agent or the app may run at the same time on one project (render, export, browser checks) take a lock file holding the owner's process ID, wait with a timeout, and report the holder when they give up.

## Lifecycle

- **Queue or steer.** When the user sends during a run: *Queue* runs it next; *Steer* interrupts the turn and starts again with the new words (Codex has `turn/steer`; pi and omp have `steer` and `follow_up`; for Claude Code, cancel and resume with the new message). Make it a setting; queue picks and attachments always.
- **Cancel.** Use the engine's clean interrupt (SIGINT for Claude Code, `turn/interrupt` for Codex, `abort` for pi, then wait for `agent_settled`; `abort` for omp, then wait for `prompt_result`; the Antigravity CLI has no documented interrupt, so end its process and resume with `--conversation`; `session/cancel` for Grok Build over ACP). Escalate to terminate only after a grace period, and record the run as interrupted.
- **Crash and restart.** Store each conversation's session or thread ID with the project. After the app restarts, resume with it. Mark runs that were in progress when the app died as interrupted.
- **One engine per chat lane.** A project has one active conversation per lane; a new project gets its own engine run.
- **Records.** Per project, in the app's folder:
  - `agent-runs.jsonl`: one line per run: ID, number, engine, model, effort, session ID, user text, editor context, attachments, status, final text, changed files, timestamps;
  - `run-traces/<run-id>.jsonl`: a `start` line (binary, arguments, the exact prompt sent), every raw engine line with a timestamp offset, and an `exit` line (status, exit code, changed files).
  These make bugs reproducible and let support see exactly what was sent. Store no credentials and redact secrets from arguments and environment.

## Verification checklist

Run each against the real app, not a mock:

- [ ] Fresh machine: *Not installed* shows, install runs only after consent, sign-in opens the vendor's page, *Connected* appears only after a test turn.
- [ ] Signed out mid-session: the next run reports *Not signed in* with the fix, not a raw error.
- [ ] A question ("what does this file do?") gets an answer and `changedFiles` is empty.
- [ ] An edit request changes only allowed files, the preview updates once, and *Undo this run* restores them.
- [ ] A write to a read-only folder is denied by permission rules, even when the user asks for it.
- [ ] The editor context in the trace matches what the editor showed when the message was sent.
- [ ] An approval card appears for a gated action; *Deny* leaves the files untouched; no answer times out to deny.
- [ ] Cancel ends the turn within seconds; the next message resumes the same conversation.
- [ ] Killing the app mid-run, then reopening: the run is marked interrupted and the conversation resumes.
- [ ] The app MCP server's tools are listed in the engine's init event; a wrong secret is refused.
- [ ] A reply that mentions a marker in prose renders as text, not as a broken card.
- [ ] Two engines (if supported) produce the same neutral events and the same UI for the same task.
- [ ] The run record and trace exist, hold the arguments and prompt, and contain no credentials.
