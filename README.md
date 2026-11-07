# Skills

Agent skills for Claude Code, OpenCode, Codex, pi and other coding agents that support the [Agent Skills](https://skills.sh) format.

Each skill gives your agent a complete workflow for one kind of work: designing a typeface, writing specifications, building UI to the pixel, or running a squad of agents that message each other. A skill bundles the instructions, references and scripts it needs, so it works the same way in every project.

## Quick start

Install with the [skills CLI](https://skills.sh). It needs Node.js.

```bash
# Choose skills from a list
npx skills@latest add bdsanxz/skills

# Install one skill
npx skills@latest add bdsanxz/skills --skill font-design

# Install every skill, for all your agents, in your home directory
npx skills@latest add bdsanxz/skills --skill '*' --agent '*' --global
```

To see what is available without installing anything, run `npx skills@latest add bdsanxz/skills --list`.

An installed skill starts by itself when your request matches it. To start one on purpose, name it, as in "use font-design to make a geometric sans".

Update installed skills with `npx skills@latest update`. Remove one with `npx skills@latest remove <skill>`.

## Catalog

### Design

| Skill | What it does |
| --- | --- |
| [`figma-access`](design/figma-access/SKILL.md) | Reads and changes Figma designs from the shell, without an MCP server, through one bundled CLI that runs on Bun. From a Figma URL and a personal access token it reads any file through the REST API: frames, full node data with hidden layers pruned, a compact CSS-ready `spec` of a frame (boxes, export bounds, fonts, gradients, auto layout, stale layout flagged), exact renders and original image fills. With the bundled Desktop Bridge plugin running in Figma Desktop, it also runs Figma Plugin API code in the open file, takes screenshots and reads the selection, logs and changes. Output is KDL, one node per line, so `grep` works on it. |
| [`font-design`](design/font-design/SKILL.md) | Designs a complete typeface from a text brief. It records every design decision, draws each glyph as code, and judges its work on rendered proof sheets, with an independent critic worker (the `font-design-critic` template) reviewing each round. It spaces and kerns the font, then delivers a Latin family (about 240 glyphs) as OTF, TTF and WOFF2 for each weight, plus a variable font, an HTML specimen and a QA report. |

### Engineering

| Skill | What it does |
| --- | --- |
| [`edd`](engineering/edd/SKILL.md) | Evidence-Driven Development. Every acceptance criterion gets a passing test and evidence from the real, running product. The evidence goes in a ledger that a script checks for missing, misquoted and stale entries, and the final report claims only what the evidence shows. |
| [`tdd`](engineering/tdd/SKILL.md) | Test-Driven Development in Red-Green-Refactor cycles. Each failing test is committed as `[red]` and each passing implementation as `[green]`. |
| [`peers`](engineering/peers/SKILL.md) | Lets separate agent sessions on one machine message each other, across Claude Code, OpenCode, the Antigravity CLI and pi. Messages work like an inbox: each session keeps its history and receives a short notification when something arrives. Sessions can be resumed, and a peer started from it is visible in [herdr](https://herdr.dev) rather than hidden in the background. |
| [`agent-roster-design`](engineering/agent-roster-design/SKILL.md) | Designs and launches a squad of long-lived agents that work in their own directories and talk through `peers`. It guides you through the goal, the members, their roles and their skills, writes each member's instructions, then starts the whole squad in herdr. Each member can run its own agent, model and effort level; pi and OpenCode members get `/loop` for repeated work and `/goal` for completion conditions. |
| [`agent-roster-template`](engineering/agent-roster-template/SKILL.md) | Ready-made roster members you can pick when designing a squad: a codebase explorer, a font critic, a drift auditor and a codebase scout, each with a role, communication rules and a default effort. A script puts a template into a squad's roster, and other skills run one as a one-off worker. |
| [`computer-use`](engineering/computer-use/SKILL.md) | Operates a local desktop app like a person: captures each screen, reads exact click coordinates from a labeled grid reference, moves, clicks, drags and scrolls, focuses apps, types and presses keys, and checks every action against a fresh capture before going on. A failed step is recovered from the current state without redoing finished ones, and missing screen or input permission stops the work with plain repair steps. A bundled Python package (`scripts/computer_use`) sets up its own isolated environment on first use. |
| [`session-reader`](engineering/session-reader/SKILL.md) | Exports one Pi agent session, found by its ID, as a clean Markdown transcript in `_swe/session-reader/`: each message, tool call and tool result is its own entry in time order, without the JSONL envelope noise. A bundled Node script (`scripts/session-to-markdown.mjs`) resolves the ID, never overwrites an earlier export and counts anything it had to skip. |
| [`herdr-peers`](engineering/herdr-peers/SKILL.md) | Lets agent sessions in one herdr workspace message each other using only the `herdr` CLI. Messages are fire-and-forget prompts that arrive as ordinary turns, with a bounded request-to-receipt protocol and no extra CLI. |
| [`herdr-roster-design`](engineering/herdr-roster-design/SKILL.md) | Designs and launches a squad of agent sessions in one herdr workspace using only the `herdr` CLI. It guides you through the goal and the members, writes each member's files and generated instructions, installs their skills, and starts the squad with semantic `squad-<slug>` and `<slug>-<member>` names. |
| [`hcx`](engineering/hcx/SKILL.md) | Messages another agent session by tab name and spawns new agents in tabs of their own, without the `<hc from>` tag and with no parent terminal. Everything else passes through to `hc`, with tab names accepted wherever `hc` takes a terminal. |
| [`leading`](engineering/leading/SKILL.md) | Leads another agent through a prepared list of instructions, one at a time. After each one it verifies the work itself, in the code and in UI snapshots, and sends corrections until the step holds. Its progress is kept in files, so a run can be resumed. |
| [`setup-custom-inferences`](engineering/setup-custom-inferences/SKILL.md) | Sets up a custom inference provider for pi and opencode over OpenAI chat-completions, OpenAI responses, or Anthropic messages: auto-detects the protocol, enumerates models, probes reasoning, thinking levels, tool calling and multi-turn replay, and writes a validated provider config for each runtime, resumable from files on disk. |

### Feature

| Skill | What it does |
| --- | --- |
| [`embedding-agent`](feature/embedding-agent/SKILL.md) | Builds an in-app agent feature that runs a coding-agent CLI (Claude Code, Codex, pi, omp, the Antigravity CLI or Grok Build) inside a desktop or web app without breaking the vendors' terms. It covers the compliance path, sign-in, an engine-neutral adapter, tools, chat UI, edits and undo, and verifies the result against two checklists. |

### Frontend

| Skill | What it does |
| --- | --- |
| [`build-vite-inline`](frontend/build-vite-inline/SKILL.md) | Builds any Vite web project into one self-contained HTML file, encoded behind a small loader and optionally obfuscated, compatible with Google Gemini Canvas and any static host, and checks or decodes the result. |
| [`egui-knowledges`](frontend/egui-knowledges/SKILL.md) | Translates a web UI (HTML/CSS, React, Tailwind, a live page or design images) into idiomatic egui Rust code with equivalent layout, style and components, verified by `cargo check`. |
| [`gpui-shell-knowledges`](frontend/gpui-shell-knowledges/SKILL.md) | Ports React code or a Tailwind mockup to idiomatic gpui-shell JavaScript, or writes and reviews gpui-shell scripts, using equivalents taken from the official gpui-shell docs. Each mapping shows the React version, the correct gpui-shell version and the habit to avoid. |
| [`nextjs-knowledges`](frontend/nextjs-knowledges/SKILL.md) | Finds accurate, version-matched Next.js facts from the bundled docs, project agent files, online Markdown docs and error pages, follows the official best practices, and verifies changes against the running app. |
| [`pixel-perfect`](frontend/pixel-perfect/SKILL.md) | Implements UI design images as real, reusable code on web, desktop or mobile, and proves the match with measured values and a per-pixel diff. |
| [`solidjs-knowledges`](frontend/solidjs-knowledges/SKILL.md) | Ports React code to idiomatic SolidJS, or writes and reviews Solid code, using React-to-Solid equivalents taken from the official Solid docs. Each mapping shows the React version, the correct Solid version and the React habit to avoid, with a review checklist for the bugs those habits cause. |

### Product

| Skill | What it does |
| --- | --- |
| [`specifications`](product/specifications/SKILL.md) | Turns the product idea and decisions in a conversation into one behavior-first specification with a fixed twelve-section structure and stable `CAP-`, `J-`, `STATE-`, `INT-` and `REC-` identifiers. It covers normal, failure and recovery behavior with Mermaid diagrams, keeps scope, non-goals, deferred and unknown items apart, and prescribes no implementation. It saves the result to `_swe/specifications/<name>/specification.md`. |
| [`tasks`](product/tasks/SKILL.md) | Turns one finalized specification into small, end-to-end tasks with observable acceptance criteria and explicit blocking edges, each traced to the behavior it delivers. It validates the specification first, can gather evidence from your codebase with a scout agent, and writes the task index and one file per task to `_swe/tasks/<name>/`. A script validates the set and tracks it as a dependency graph, showing which tasks are ready, which can run in parallel and which are blocked. |
| [`drifting-check`](product/drifting-check/SKILL.md) | Checks whether a set of tasks still matches the specifications and the target outcome. It reports over-engineering, uncovered requirements, contradictions and tasks that no longer serve the goal, each with quotes from both sides. |
| [`research-market`](product/research-market/SKILL.md) | Researches a market from what its audience posts in public on X/Twitter and Bluesky. It codes posts for pains, wishes, alternatives and price signals, counts the themes, and ranks product opportunities. |

### Prompting

| Skill | What it does |
| --- | --- |
| [`agents-creator`](prompting/agents-creator/SKILL.md) | Creates subagent definitions for Claude Code, OpenCode or Codex. Every agent it creates writes a report file as it works, so its results survive context compaction. A script validates each file. |
| [`based-on-gemini-canvas`](prompting/based-on-gemini-canvas/SKILL.md) | Deep-dive knowledge for AI agents about Google Gemini Canvas: its sandboxed single-file environment and limits, browser features, storage and sharing, and every Gemini model usable inside it with its abilities, limits, status, errors and fallbacks. |
| [`hand-hold-me`](prompting/hand-hold-me/SKILL.md) | Guides you through building a project from first idea to release by writing every copy-paste-ready prompt for your AI coding agent, from the first to the last, in one `instructions.md`. Each prompt stands on its own, covers one small flow and says what it leaves out, describes the outcome you want rather than how to build it, and is written from the conversation and facts in your codebase; failures and missing parts you report get a fix prompt. |
| [`improve-my-instruction`](prompting/improve-my-instruction/SKILL.md) | Rewrites an instruction so that it is clear, well organized and unambiguous, using facts from your codebase, without changing what it asks for. |
| [`nanobanana-knowledges`](prompting/nanobanana-knowledges/SKILL.md) | Writes, reviews and fixes prompts for Google's Nano Banana image models. It covers generation and editing, combining reference images, text and layouts, and consistent series. Its prompt guide and pattern catalog are curated from Google's prompting tips and two community galleries of tested prompts, and it comes with a library of complete, original example prompts to draw ideas from. |

### Research

| Skill | What it does |
| --- | --- |
| [`get-knowledge`](research/get-knowledge/SKILL.md) | Finds the knowledge a task needs in your local references first, then on the web (Exa, Keenable or Parallel). It keeps every search and page in a local wiki for the next lookup. |

## Requirements

Most skills need nothing beyond your agent. The rest bring their own scripts and need one runtime.

| Skill | Needs |
| --- | --- |
| `font-design`, `pixel-perfect`, `computer-use` | Python 3.9 or newer. On first use, the bundled tool creates its own environment and installs its dependencies, which needs network access. |
| `edd`, `tasks`, `agent-roster-template`, `research-market`, `agents-creator`, `get-knowledge` | [Bun](https://bun.sh) |
| `setup-custom-inferences` | [Bun](https://bun.sh) |
| `session-reader` | [Node.js](https://nodejs.org) |
| `build-vite-inline` | [Node.js](https://nodejs.org) and a Vite project (Vite 6 to 8) |
| `leading` | The `hcx` command on your `PATH`, and a browser or screen-capture tool your agent can use for UI snapshots. |
| `peers` | The [`peers`](https://github.com/bdsanxz/peers) command on your `PATH` (see below). [herdr](https://herdr.dev) is needed to start visible peers. |
| `agent-roster-design` | Bun, herdr, and the agents you choose for the squad (`claude`, `opencode`, `agy`, `pi`, `muse` or `qodercli`). `peers` is installed when it is missing. |

Install the `peers` command at `~/.local/bin/peers` with:

```bash
curl -fsSL https://raw.githubusercontent.com/bdsanxz/peers/main/install.sh | sh
```

`get-knowledge` searches the web through three providers. When one reaches its limit, the next is tried, in the order below. Each works without an API key through its free service, which allows only a few searches in a short time. Set a provider's key in your environment to lift its limit:

| Provider | Environment variable | Get a key |
| --- | --- | --- |
| [Exa](https://exa.ai) | `EXA_API_KEY` | [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) |
| [Keenable](https://keenable.ai) | `KEENABLE_API_KEY` | [app.keenable.ai](https://app.keenable.ai) |
| [Parallel](https://parallel.ai) | `PARALLEL_API_KEY` | [platform.parallel.ai](https://platform.parallel.ai) |

## How a skill is built

Every skill is a directory with a `SKILL.md`: the workflow your agent follows, step by step. Next to it, a skill may bundle:

- **references:** guidance it reads at the step that needs it;
- **scripts:** ready-to-run tools that need only their runtime;
- **subagents:** focused reviewers or workers that write their findings to a report file, so the work survives context compaction and can be resumed.

Skills that work over many steps keep their progress in files, so you can stop and pick up later in a new session.

## License

[Apache License 2.0](LICENSE). Third-party material bundled in a skill is listed, with its origin and license, in that skill's `NOTICE.md`.

The `peers` command used by the `peers` skills is a separate project with its own license; see [bdsanxz/peers](https://github.com/bdsanxz/peers).
