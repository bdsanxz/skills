# pi field contract

Read this at the step that builds the pi draft. It states the fields the
`build` command writes and the rules it applies per wire protocol
(`openai-completions`, `openai-responses`, `anthropic-messages`). The
authoritative sources are the installed pi docs:

- `models-configuration.md` (every `models.json` field),
- `models.md` ("Configure a compatible endpoint", thinking levels, sampling),
- `custom-provider.md` (prefer `models.json` over an extension here),
- `settings.md` (`defaultProvider`, `defaultModel`).

Paths below are under the pi install, for example
`~/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/docs/`.

## Where the files live

- Provider and model entries: `~/.pi/agent/models.json`, under
  `providers.<providerId>`.
- Startup defaults: `~/.pi/agent/settings.json`
  (`defaultProvider`, `defaultModel`).

## API protocols

`--api` is one of `openai-completions` (default wire: `POST
<baseURL>/chat/completions`), `openai-responses` (`POST <baseURL>/responses`,
always with `store:false`), or `anthropic-messages` (`POST
<baseURL>/v1/messages`, model list from `GET <baseURL>/v1/models`). Omitting
`--api` auto-detects: each endpoint shape is tried against the first model and
the run continues only when exactly one responds; none or several is a fatal
message naming `--api`. Give the OpenAI-style root (for example
`.../v1`) for the first two, the host root (for example
`https://api.anthropic.com`) for Anthropic. Custom auth headers come from
`--header-env H=ENV_NAME` (names only; values stay in the environment).

## Provider entry

| Field | Value the build writes |
| --- | --- |
| `name` | Display name the user gave (defaults to the provider id). |
| `baseUrl` | The base URL the user gave, unchanged. |
| `api` | The probed `--api` value, unchanged. |
| `apiKey` / `authHeader` | `"$NAME"` and `true` for the OpenAI protocols (key as `Authorization: Bearer`). |
| `headers` | For `anthropic-messages`: `{"x-api-key": "$NAME", "anthropic-version": "2023-06-01"}`, plus one `"$ENV"` entry per `--header-env` mapping. Extra `--header-env` mappings also land here for the OpenAI protocols. No `apiKey`/`authHeader` on Anthropic entries. |
| `compat` | Only the compat fields the probes decided (see below). |

## Compat decision tables

Probe each row on the endpoint before choosing. Do not copy these values from
another provider.

### openai-completions

| Probe | Compat field |
| --- | --- |
| `thinking: {"type": "disabled"}` stops reasoning, but `reasoning_effort: "none"` alone does not | `thinkingFormat: "deepseek"`, `supportsReasoningEffort: true`. Pi then sends `thinking: {type: ...}` plus `reasoning_effort` per level. |
| `reasoning_effort` alone (no `thinking` field) controls reasoning on and off | Omit `thinkingFormat` (pi sends OpenAI-style `reasoning_effort`), set `supportsReasoningEffort: true`. |
| Varying `reasoning_effort` changes nothing in the responses | `supportsReasoningEffort: false` (or omit it) and do not rely on effort values. |
| A `developer`-role message is rejected (HTTP 4xx) | `supportsDeveloperRole: false`. Accepted means `true`. |
| `max_tokens` is rejected but `max_completion_tokens` is accepted | Set `maxTokensField: "max_completion_tokens"`. When both work, omit it: pi auto-detects. |

### openai-responses

Effort is native (`reasoning.effort`); there is no `thinkingFormat`. Pi sends
`reasoning: {effort, summary: "auto"}` per level and `reasoning:
{effort: "none"}` for off.

| Probe | Compat field |
| --- | --- |
| Some level probe emits reasoning summaries | `supportsReasoningEffort: true`, else `false`. |
| A `developer` input item is rejected (HTTP 4xx) | `supportsDeveloperRole: false`. Accepted means `true`. |
| `max_output_tokens` is rejected but `max_tokens` is accepted | `supportsMaxOutputTokens: false` plus `maxTokensField: "max_tokens"`. When `max_output_tokens` works, omit both (pi default). |

### anthropic-messages

Levels are budget tiers (`thinking: {type: "enabled", budget_tokens}`,
pi's built-in budgets minimal 1024 / low 2048 / medium 8192 / high 16384;
xhigh/max clamp to high) or the newer effort form (`thinking:
{type: "adaptive"}` plus `output_config: {effort}`). The probe tries both
shapes per level; the winning shape decides the mapping. `developer` does not
exist on this wire (roles are user/assistant), so it is never probed.

| Probe | Compat field |
| --- | --- |
| Adaptive efforts reason but budgets are rejected | `forceAdaptiveThinking: true` (provider-level when every reasoning model agrees, else per model). Pi sends `output_config.effort` from the map, with `effort` as the final fallback for models with no map value. |
| Budgets reason but adaptive is rejected | Omit `forceAdaptiveThinking` (budget default). |
| Replaying a thinking block with an empty signature is accepted | Per-model `allowEmptySignature: true`. Rejected means omit it. |

## Model entry

| Field | Value the build writes |
| --- | --- |
| `id` | The model id from `GET <baseURL>/models`, unchanged. |
| `name` | The short name (text after the last `/`), unless the user names it. |
| `input` | `["text"]`, always. The probes never send images, so image input is never claimed no matter what the provider advertises. |
| `cost` | `{input: 0, output: 0, cacheRead: 0, cacheWrite: 0}`. All four are required by the schema; zero means unpriced, not free. |
| `contextWindow` | The model's advertised `context_window`, capped at the user's cap when one was given. |
| `maxTokens` | The user's value (default `16384`). |
| `reasoning` | `true` when any probe emitted reasoning text, else `false`. A model with `false` gets no `thinkingLevelMap`. |
| `thinkingLevelMap` | Only for `reasoning: true` models. See the mapping table. |

## thinkingLevelMap mapping table

Pi levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
`null` marks a level unsupported: pi hides it and clamps requests to the
nearest supported level (`getSupportedThinkingLevels` / `clampThinkingLevel`
in `pi-ai`). `xhigh` and `max` are unsupported unless mapped explicitly.

Map VALUE shapes differ per protocol (the value is what pi sends on the wire
for that level):

- `openai-completions`: effort strings (`<level>: "<level>"`); `off: "none"`
  accompanies the `thinking: {type: "disabled"}` pi sends (the `"none"` value
  itself does not disable).
- `openai-responses`: effort strings as well (`reasoning.effort`), except
  `off` needs `effort: "none"` to be honored by the endpoint; when the
  endpoint only disables on omission, `off` is `null` even though opencode
  still gets an empty-body `none` variant (see `references/opencode-fields.md`).
- `anthropic-messages`: adaptive models map to the probed effort strings
  (for example `high: "high"`, `minimal: "low"`); budget-based models map
  working tiers to the level name (`low: "low"` — pi sends the amount from
  `thinkingBudgets`, so the value only marks support).

| Probe outcome for a model | Map entry |
| --- | --- |
| Off probe yields no reasoning (and, for responses, `effort: "none"` also disables) | `off: "none"`. |
| Off still yields reasoning (or, for responses, `effort: "none"` is rejected or reasons) | `off: null` (cannot be turned off in pi). |
| Level returns reasoning (HTTP 2xx) with output that differs from sibling levels | `<level>: <protocol value above>`. |
| Level rejected (HTTP 4xx), silently ignored (2xx but no reasoning while siblings reason), or graded but indistinguishable from siblings (low vs high about equal) | `<level>: null`. |

## Settings

`defaultProvider` and `defaultModel` are set only when the user asked for a
default. They are startup values in `settings.json`, not per-model data.
