# Agents, models and effort

Each member runs one agent with one model at one effort level, set on its own, independent of the other members. A squad may mix agents, models and effort levels freely.

| Agent | Runtime | Model names | Lists its models | How `launch` applies the model and effort |
| --- | --- | --- | --- | --- |
| `claude` | Claude Code | an alias (`fable`, `opus`, `sonnet`, `haiku`) or a full name such as `claude-sonnet-5-5` | no list; `check` checks the form | `claude --model <model> --effort <level>` |
| `opencode` | OpenCode | `provider/model`, such as `opencode/beam-free` | `opencode models` | through OpenCode's API, since the TUI takes no model or effort flag (below) |
| `agy` | Antigravity CLI | a model id, such as `gemini-3.8-flash`, or one fixed to a level, such as `gemini-3.8-flash-low` | `agy models` | `agy --model <model> --effort <level>` |
| `pi` | pi | `provider/model` or the bare model, as `pi --list-models` lists them, such as `anthropic/claude-opus-4-8` | `pi --list-models` | `pi --model <model> --thinking <level>`, with `--approve` and the peers extension (`-e`) |
| `muse` | Muse Code | a model id such as `muse-spark-1.3` | no list; `check` checks the form | `muse --yolo --model <model> --effort <level>` |

## OpenCode: model and effort through its API

For an opencode member with a model, `launch`:

1. creates the member's session with `opencode api session.create`, located in the member's cwd;
2. opens the OpenCode TUI on that session (`opencode --session <id>`);
3. once herdr reports the TUI settled, sets the model, with the effort as its variant, with `opencode api session.switchModel`;
4. reads the session back with `opencode api session.get`, and stops the launch if it reports another model or variant;
5. sends the first prompt, so every turn runs on the chosen model.

This needs OpenCode's background service; `opencode service status` shows whether it runs. `switchModel` accepts any name, so `check` validates the model against `opencode models` and the effort against the model's variants before anything starts.

An opencode member with no model in the roster starts plain and uses the model and effort set in its own `opencode.json` or chosen with `/models`. `roster.js` never writes `opencode.json`.

## Effort levels

The effort level sets how hard the member's model thinks before it answers. The levels, lowest first, are `low`, `medium`, `high`, `xhigh` and `max`. `roster.js` maps each level to the agent's own setting:

| Agent | Levels it takes | How `launch` applies the level |
| --- | --- | --- |
| `claude` | every level, for every model | `claude --effort <level>` |
| `opencode` | the model's variants that are levels; `opencode api model.list` lists each model's `variants`. Some models have none, such as `opencode/big-pickle` | the session's model variant, set with `session.switchModel` |
| `agy` | the levels `agy models` lists for the model: `gemini-3.8-flash-low`, `-medium` and `-high` give `gemini-3.8-flash` those three levels. A model without such ids has none. An id fixed to a level takes only that level | `agy --effort <level>` |
| `pi` | every level, for every model; pi clamps it to what the model supports | `pi --thinking <level>` |
| `muse` | every level, for every model | `muse --effort <level>` |

opencode and agy need a model to take an effort level, so that `check` can confirm the level. claude, pi and muse need none.

## Choose them

1. Read what is installed: `command -v claude opencode agy pi muse`, the models each lists (`opencode models`, `agy models`, `pi --list-models`; claude and muse list none), and the levels each model has (above). Propose only installed agents, listed models and levels the model has.
2. Pick by the member's work:
   - The lead plans, reviews and decides, and receives every completion: give it the strongest model the user is willing to pay for, at `high`. Default: `claude` with its default model.
   - A member that reasons through hard problems (architecture, debugging, security review, tricky algorithms): `high`, or `xhigh` or `max` when the user accepts the slower, costlier answers.
   - A member with ordinary implementation work: `medium`, or leave the effort out.
   - A member with narrow, mechanical work (formatting, renaming, docs from a template, running checks): `low` on a cheaper or free model. Higher effort only makes it slower here.
   - Use another agent when the user asks for it, or when a member needs that agent's models or tools.
3. Keep repeated choices in `defaults` instead of on each member: `"defaults": {"agent": "opencode", "models": {"opencode": "opencode/beam-free"}, "effort": "low"}`.
4. Leave a model or effort out when the agent's own default is fine. Say so in the member's summary to the user: "uses agy's default model", "uses the model's default effort", or for opencode "uses its opencode.json or /models".

A mixed team: a claude lead on opus at high effort, an opencode member on beam-free at low effort, an opencode member on whatever its own `opencode.json` or `/models` sets, an agy member on Gemini Flash at medium effort, a pi member on Claude Opus at high effort, and a muse member on muse-spark at high effort.

```json
"members": [
  {"name": "lead", "agent": "claude", "model": "opus", "effort": "high", ...},
  {"name": "api", "agent": "opencode", "model": "opencode/beam-free", "effort": "low", ...},
  {"name": "docs", "agent": "opencode", ...},
  {"name": "web", "agent": "agy", "model": "gemini-3.8-flash", "effort": "medium", ...},
  {"name": "review", "agent": "pi", "model": "anthropic/claude-opus-4-8", "effort": "high", ...},
  {"name": "spike", "agent": "muse", "model": "muse-spark-1.3", "effort": "high", ...}
]
```

## Where a member's agent, model and effort come from

The first that is set wins.

- **Agent:** `--agent <member>=<agent>` at launch; the member's `agent`; `defaults.agent`; otherwise `claude`.
- **Model:** `--model <member>=<model>` at launch; the member's `model`, but only while the member runs the agent that model was written for; `defaults.models.<agent>`; otherwise no model, and the agent starts with its own default model.
- **Effort:** `--effort <member>=<level>` at launch; the member's `effort`; `defaults.effort`; otherwise no level, and the agent uses its own default effort for the model.

`roster.js check` prints one `MEMBER` line per member with the agent, model and effort it will run and where each came from. Read those lines to confirm the fallbacks are what the user agreed to.

## Validation

`check`, `build` and `launch` refuse, with one `PROBLEM` line each:

- an agent that is not `claude`, `opencode`, `agy`, `pi` or `muse`, in a member, in `defaults` or in `--agent`;
- a model that does not have its agent's form, such as `haiku` for `opencode`;
- a model that `opencode models`, `agy models` or `pi --list-models` does not list (claude and muse list none; `check` only checks their form);
- an effort that is not one of the five levels, in a member, in `defaults` or in `--effort`;
- an effort, set on the member or with `--effort`, that the member's agent and model do not support. The line names the levels the model has and the nearest one; nothing is changed for you;
- an effort for an opencode or agy member that has no model;
- a `--agent`, `--model` or `--effort` for a member the roster does not have.

`defaults.effort` is different: it is a squad-wide wish, not a choice for one member. A member whose model lacks that level uses the nearest level the model has (the lower one on a tie), or the agent's own default effort when the model has no levels. `check` prints a `NOTE` for each such member.

When an agent's CLI is not installed, `check` only notes that it cannot confirm the model or effort. `launch` refuses: every agent it starts must be on `PATH`, with every model and effort confirmed, before it starts anything.

## Launch-time overrides

`launch --agent <member>=<agent> --model <member>=<model> --effort <member>=<level>` runs a member on another agent, model or effort for this launch, without editing `roster.json`. Check the override first with the same flags on `check`. A member whose agent changes is rebuilt for the new agent before it starts, a member whose model or effort changes is reconfigured, and every member's squad directory is rewritten to show it. The next `build` or `assemble` returns to `roster.json`; to keep a change, edit `roster.json`.

Older rosters name the agent in `"runtime"`, with `"antigravity"` for agy. `check` accepts them as they are.
