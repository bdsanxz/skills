---
name: embedding-agent
description: |
  Build an in-app agent feature that runs a coding-agent CLI (Claude Code, Codex, pi, omp, the Antigravity CLI, Grok Build) inside a desktop or web app, so the user chats with it in the app's own panel without breaking the vendor's terms of service. Covers compliance, onboarding, each CLI's headless protocol, chat UI, edits, approvals and undo. Use when the user wants to embed, wrap or drive an agent CLI from their app, add an "ask the agent" panel backed by one, or asks whether that is allowed.
---

# Embedding Agent

Build a feature in which the app runs an agent CLI as a child process, talks to it over its machine-readable protocol, and draws the conversation in the app's own UI. The agent works on the user's files with the user's own account, and the app gives it the product's rules, tools and context.

Three words are used throughout:

- The **host** is the part of the app that starts and talks to the agent process: a desktop app's main process, or a backend process. A browser page can never be the host, because it cannot start processes.
- The **engine** is one agent CLI the host can run, such as `claude`, `codex`, `pi`, `omp`, `agy` or `grok`.
- A **run** is one user message and everything the engine does about it, until it reports a final result.

## Rules

1. **The user's account, the user's sign-in, the vendor's binary.** The engine authenticates as the end user, through the vendor's own sign-in flow or with the user's own API key. Apart from an API key the user chooses to give the app, the app never asks for, reads, stores, copies or forwards the user's credentials or session tokens, and never pays for, pools or resells the engine's usage on the user's behalf. `references/compliance.md` gives the rules and their sources.
2. **Run a vendor's engine unmodified.** Install and run Claude Code, Codex, the Antigravity CLI or Grok Build exactly as the vendor publishes it. Do not patch, repackage, or remove any of its sign-in methods. Configure it only through its documented flags, settings and protocol. An open-source harness such as pi or omp may be bundled under its license, but the model provider behind it still decides which sign-in the app may use.
3. **Terms change; check them.** Before you commit to a design, fetch the current terms pages listed in `references/compliance.md` and check that each rule there still holds. When a page has changed, follow the page and tell the user what changed.
4. **Do not use the vendor's name as yours.** The app may say in plain text that it runs Claude Code, Codex or another engine. It may not put the vendor's name or logo into its own product, feature or company name, or suggest the vendor built or endorses it.
5. **Write files only where the product allows.** Every path rule the product has (what the agent may edit, what is read-only) must be enforced by the engine's permission rules, or, for an engine without them such as pi, by an approval hook and an OS sandbox (omp's approvals decide per tool, not per path, so it needs the same hook and sandbox); never only by asking in the prompt.
6. **Facts over assumptions.** When you study another app that embeds an agent, label each claim by its source (its code, its run records, what you observed, or your guess) and do not present a guess as fact.

## Step 1: Pin down the product facts

Ask the user for anything below that the request and the codebase do not answer. Ask one question at a time.

1. **Delivery:** a desktop app, a web app with a backend on the user's own machine, or a web app hosted by the vendor of the app.
2. **Commercial or not:** sold, given away by a company, or a personal or open-source tool.
3. **Engines:** which agent CLIs to support, and which is the default.
4. **Who pays for the model:** the user's own subscription, the user's own API key, or the app maker's API key.
5. **What the agent may do:** which folders it may edit, which it may only read, whether it may run shell commands, and which product actions it needs (render, export, generate media, inspect the canvas).
6. **What the editor knows that the agent needs:** selection, playhead or cursor position, open document, marks the user drew.

## Step 2: Decide the compliance path

Read `references/compliance.md`. With the answers from Step 1, take its decision table and pick exactly one path for each engine. Write the chosen path and the reason into the design notes you give the user, with the date you checked the terms.

When no path in the table fits, for example a hosted web app that wants the user's Claude subscription, or any app that wants to run the Antigravity CLI on a user's consumer Google account, stop and tell the user that this needs the vendor's written agreement, and offer the paths that do fit.

## Step 3: Choose where the host runs

Read `references/architecture.md`, section *Host placement*, and choose:

- **Desktop app:** the main or backend process of the app is the host.
- **Web app, local:** a companion process on the user's machine is the host. The page reaches it over loopback, protected by a per-launch secret.
- **Web app, hosted:** follow the path from Step 2. Each user's engine runs in that user's own sandbox and signs in there itself, or the run uses an API key the user supplied.

## Step 4: Build detection and onboarding

Follow `references/architecture.md`, section *Onboarding*, and the engine's own reference: `references/claude-code.md`, `references/codex.md`, `references/pi.md`, `references/omp.md`, `references/antigravity.md` or `references/grok-build.md`.

1. Find the engine binary and its version. Refuse a version older than the protocol features you rely on, and say which version is needed.
2. Check whether it is signed in, through the engine's own status command or protocol method. For an engine that uses API keys per provider, such as pi or omp, check that the user's key for the chosen provider is present and works.
3. Show one state per engine: *Ready*, *Not installed*, *Not signed in*, *Installed but will not start*. Give each state the one action that fixes it.
4. Install only with the user's consent, by running the vendor's official installer visibly, or by giving the user the command to run (an open-source engine may instead ship inside the app). Sign in only through the engine's own sign-in, which opens the vendor's page in the user's browser, or take the user's own API key into the OS keychain, as the path from Step 2 says.
5. After sign-in, run a tiny test turn and show *Connected* only when it succeeds.

## Step 5: Build the engine adapter

Write one adapter per engine behind one engine-neutral interface: start a run, stream its events, answer an approval, cancel, resume a conversation, end. The rest of the app talks only to this interface. `references/architecture.md`, section *Engine adapter*, gives the interface and the neutral event model; the engine references give the exact command lines, messages and events.

1. Generate or pin the protocol types for the engine version you support. Ignore event types you do not know instead of failing on them.
2. Keep one conversation per project or chat lane, identified by the engine's session or thread ID, and store that ID with the project.
3. Read stdout as JSON lines, split on LF only, so a U+2028 or U+2029 inside a JSON string does not break a record. Keep stderr separately for diagnostics. A line that does not parse is logged, not fatal.

## Step 6: Give the agent the product

Follow `references/architecture.md`, section *Product configuration*:

1. **Product rules:** append them to the engine's system prompt; do not replace the engine's own prompt.
2. **Product knowledge:** ship it as skills the engine loads from a folder the app owns.
3. **Product actions:** expose them as tools on an MCP server the host runs on loopback, with a per-session secret. Prefer tools over asking the agent to print special text.
4. **Limits:** remove the engine features the product does not want, deny writes outside the editable folders, and isolate the run from the user's own project hooks and MCP servers where the product needs predictable behaviour. Never touch the engine's sign-in settings.
5. **Approvals:** choose a permission mode explicitly (some engines, such as omp, approve everything by default), then route every remaining approval to the app's UI. An engine whose headless mode cannot ask (the Antigravity CLI) gets its allow and deny rules before the run, and the app shows what it refused afterwards. For an engine with no permission system, or none that knows paths, ship an approval extension and run the engine in a sandbox.

## Step 7: Send editor context with each message

Append a clearly delimited context block to the user's text, holding only what the editor knows at send time (selection, position, open file, marks). Keep the user's words unchanged and first. Record exactly what was sent. `references/architecture.md`, section *Context injection*, gives the format.

## Step 8: Turn the event stream into chat UI

Map the neutral events to UI: streamed text, thinking summary, tool activity ("Reading files", "Editing index.html"), approval cards, usage and rate-limit indicators, the final result with duration and cost. When the product needs rich cards, render them from tool calls of the product's MCP server. When it must use markers in the text, follow the marker rules in `references/architecture.md`, section *Structured cards*.

## Step 9: Get the agent's work into the app

Follow `references/architecture.md`, section *Edits and sync*:

1. The agent edits files on disk. A watcher of the project folder, debounced and ignoring the app's own folders, notifies the editor, which reloads what changed.
2. Snapshot the editable files before each run and compute the changed files after it. Use that list for "no changes", a per-run Undo, and the run record.
3. Serialize anything that must not run twice at once (renders, exports, browser checks) with a project lock.

## Step 10: Handle the run lifecycle

Follow `references/architecture.md`, section *Lifecycle*: queue or steer when the user sends during a run, cancel cleanly, recover after a crash, resume the conversation on the next message, and write one run record plus one raw trace per run in the project's app folder.

## Step 11: Verify

Go through the checklist in `references/architecture.md`, section *Verification checklist*, against the running app, and report each item as passed, failed or not applicable with what you observed. Then go through the compliance checklist at the end of `references/compliance.md`. Do not report the feature done while an item of either checklist fails.

## Studying an existing app

When the user asks how a particular app embeds an agent, read `references/case-study.md` first for how to find out from the outside, then apply Rule 6.
