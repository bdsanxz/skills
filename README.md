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
| [`font-design`](design/font-design/SKILL.md) | Designs a complete typeface from a text brief. It records every design decision, draws each glyph as code, and judges its work on rendered proof sheets, with an independent critic agent reviewing each round. It spaces and kerns the font, then delivers a Latin family (about 240 glyphs) as OTF, TTF and WOFF2 for each weight, plus a variable font, an HTML specimen and a QA report. |

### Engineering

| Skill | What it does |
| --- | --- |
| [`edd`](engineering/edd/SKILL.md) | Evidence-Driven Development. Every acceptance criterion gets a passing test and evidence from the real, running product. The evidence goes in a ledger that a script checks for missing, misquoted and stale entries, and the final report claims only what the evidence shows. |
| [`tdd`](engineering/tdd/SKILL.md) | Test-Driven Development in Red-Green-Refactor cycles. Each failing test is committed as `[red]` and each passing implementation as `[green]`. |
| [`peers`](engineering/peers/SKILL.md) | Lets separate agent sessions on one machine message each other, across Claude Code, OpenCode, the Antigravity CLI and pi. Messages work like an inbox: each session keeps its history and receives a short notification when something arrives. Sessions can be resumed, and a peer started from it is visible in [herdr](https://herdr.dev) rather than hidden in the background. |
| [`agent-job`](engineering/agent-job/SKILL.md) | Puts instructions into a live agent session at the right moment, across Claude Code, OpenCode, the Antigravity CLI and pi: a cron fires at a time, and a goal keeps the session working until the agent marks it done. Both are sent only while the session is open, and nothing runs headless. |
| [`agent-roster-design`](engineering/agent-roster-design/SKILL.md) | Designs and launches a squad of long-lived agents that work in their own directories and talk through `peers` and receive scheduled instructions and goals through `agent-job`. It guides you through the goal, the members, their roles and their skills, writes each member's instructions, then starts the whole squad in herdr. Each member can run its own agent, model and effort level. |
| [`herdr-peers`](engineering/herdr-peers/SKILL.md) | Lets agent sessions in one herdr workspace message each other using only the `herdr` CLI. Messages are fire-and-forget prompts that arrive as ordinary turns, with a bounded request-to-receipt protocol and no extra CLI. |
| [`herdr-roster-design`](engineering/herdr-roster-design/SKILL.md) | Designs and launches a squad of agent sessions in one herdr workspace using only the `herdr` CLI. It guides you through the goal and the members, writes each member's files and generated instructions, installs their skills, and starts the squad with semantic `squad-<slug>` and `<slug>-<member>` names. |

### Feature

| Skill | What it does |
| --- | --- |
| [`embedding-agent`](feature/embedding-agent/SKILL.md) | Builds an in-app agent feature that runs a coding-agent CLI (Claude Code, Codex, pi, omp, the Antigravity CLI or Grok Build) inside a desktop or web app without breaking the vendors' terms. It covers the compliance path, sign-in, an engine-neutral adapter, tools, chat UI, edits and undo, and verifies the result against two checklists. |

### Frontend

| Skill | What it does |
| --- | --- |
| [`pixel-perfect`](frontend/pixel-perfect/SKILL.md) | Implements UI design images as real, reusable code on web, desktop or mobile, and proves the match with measured values and a per-pixel diff. |

### Product

| Skill | What it does |
| --- | --- |
| [`specifications`](product/specifications/SKILL.md) | Turns the requirements in a conversation into specifications, grounded in facts from your codebase. Features are grouped by actor journey, each with acceptance criteria an observer can check. Anything the conversation leaves unsettled becomes an open question instead of an assumption. |
| [`tasks`](product/tasks/SKILL.md) | Turns a conversation or a specification into end-to-end tasks with acceptance checklists, a coverage table, and dependencies. A script reads the dependencies as a graph and shows which tasks are ready, which can run in parallel, and which are blocked. |
| [`drifting-check`](product/drifting-check/SKILL.md) | Checks whether a set of tasks still matches the specifications and the target outcome. It reports over-engineering, uncovered requirements, contradictions and tasks that no longer serve the goal, each with quotes from both sides. |
| [`research-market`](product/research-market/SKILL.md) | Researches a market from what its audience posts in public on X/Twitter and Bluesky. It codes posts for pains, wishes, alternatives and price signals, counts the themes, and ranks product opportunities. |

### Prompting

| Skill | What it does |
| --- | --- |
| [`agents-creator`](prompting/agents-creator/SKILL.md) | Creates subagent definitions for Claude Code, OpenCode or Codex. Every agent it creates writes a report file as it works, so its results survive context compaction. A script validates each file. |
| [`improve-my-instruction`](prompting/improve-my-instruction/SKILL.md) | Rewrites an instruction so that it is clear, well organized and unambiguous, using facts from your codebase, without changing what it asks for. |

### Research

| Skill | What it does |
| --- | --- |
| [`get-knowledge`](research/get-knowledge/SKILL.md) | Finds the knowledge a task needs in your local references first, then on the web (Exa, Keenable or Parallel). It keeps every search and page in a local wiki for the next lookup. |

## Requirements

Most skills need nothing beyond your agent. The rest bring their own scripts and need one runtime.

| Skill | Needs |
| --- | --- |
| `font-design`, `pixel-perfect` | Python 3.9 or newer. On first use, the bundled tool creates its own environment and installs its dependencies, which needs network access. |
| `edd`, `tasks`, `research-market`, `agents-creator`, `get-knowledge` | [Bun](https://bun.sh) |
| `peers` | The [`peers`](https://github.com/bdsanxz/peers) command on your `PATH` (see below). [herdr](https://herdr.dev) is needed to start visible peers. |
| `agent-job` | The [`agent-job`](https://github.com/bdsanxz/agent-job) command on your `PATH` (see below), which runs with [Bun](https://bun.sh). `agent-roster-design` installs it, with each member's channel, hooks and extension. |
| `agent-roster-design` | Bun, herdr, and the agents you choose for the squad (`claude`, `opencode`, `agy` or `pi`). `peers` and `agent-job` are installed when they are missing. |

Install the `peers` command at `~/.local/bin/peers` with:

```bash
curl -fsSL https://raw.githubusercontent.com/bdsanxz/peers/main/install.sh | sh
```

Install the `agent-job` command at `~/.local/bin/agent-job` with:

```bash
curl -fsSL https://raw.githubusercontent.com/bdsanxz/agent-job/main/install.sh | sh
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
