# opencode field contract

Read this at the step that builds the opencode draft. It states the fields the
`build` command writes per wire protocol for the installed opencode (v2.0.29
at the time of writing; re-check with the schema when the version changes).
The authoritative source is the live schema at
`https://opencode.ai/config.json` (top-level `providers`), plus
`https://opencode.ai/docs/providers/` (custom provider) and
`https://opencode.ai/docs/models/` (model options, variants).

Do not trust the user's existing `opencode.json` as a schema: older files use
retired keys. The file at `~/.config/opencode/opencode.json` is real user
config, so it is only ever read for shape and backed up before any write.

## Packages and base URLs per protocol

| `--api` | `package` | `settings.baseURL` |
| --- | --- | --- |
| `openai-completions` | `"@opencode/ai/providers/openai-compatible"` | The base URL unchanged. |
| `openai-responses` | `"@opencode/ai/providers/openai-compatible/responses"` | The base URL unchanged (opencode appends `/responses`). |
| `anthropic-messages` | `"@opencode/ai/providers/anthropic"` (verified with `opencode run` against the mock; `anthropic-compatible` also loads but is not the build output) | The base URL plus `/v1` (opencode appends `/messages` itself; probe and pi use the host root). |

`settings.apiKey` appears only with `--key-file` (`"{file:<path>}"`).
`headers` appears only with `--header-env` mappings (`"{env:NAME}"` values).

## Provider entry (under top-level `providers`)

| Field | Value the build writes |
| --- | --- |
| `name` | Display name the user gave (defaults to the provider id). |
| `env` | `[KEY_ENV]`, unless `--key-file` was given (then omitted; see below). `env` is an ordered list: opencode tries each name in order and the provider stays inactive when none resolves. The key itself is never written. |
| `package` | `"@opencode/ai/providers/openai-compatible"` (chat-completions wire). |
| `settings` | `{baseURL: "<the base URL>"}` plus `apiKey: "{file:<path>"}` only with `--key-file` (see below). |
| `compatibility` | Only what the probes decided (see below); omitted when empty. |
| `models` | One entry per accessible probed model (see below). |

The retired singular `provider` key (with `npm` / `options`) is not written.

## Model entry

| Field | Value the build writes |
| --- | --- |
| `modelID` | The full upstream model id from `GET <baseURL>/models` (for example `openai/gpt-6-luna`). |
| `name` | The short name, unless the user names it. |
| `limit.context` | The model's advertised context window, capped at the user's cap when one was given. Optional in the schema (opencode falls back to 200k); always written. |
| `limit.output` | The user's max-output value (default `16384`). Optional in the schema (opencode falls back to 32k); always written. |
| `capabilities.tools` | `true` when the tool probe got `tool_calls`, else `false`. |
| `capabilities.reasoning` | `{supported: true, toggle: true, effort: [<working levels>]}` when thinking turns off; `{supported: true, effort: [<working levels>]}` (no `toggle` key) when it cannot; `{supported: false}` otherwise. `input` stays `["text"]`: image input is never claimed, because the probes never send images. |
| `compatibility` | Only when it differs from the provider entry (see below). |
| `variants` | Array, one `{id, body}` per working thinking level plus an explicit `none` variant when off works (see below). |
| `cost` | Omitted. The provider bills upstream; opencode pulls pricing from models.dev for known models. |

## Thinking-level variants

A variant item holds exactly `{id, settings?, headers?, body?}`: the schema
forbids any other key, so request-body fields always go in `body`. Variants
replay the exact wire shape the probes verified for that protocol:

| `--api` | Level variant body | `none` variant body (only when off works) |
| --- | --- | --- |
| `openai-completions` | `{"thinking": {"type": "enabled"}, "reasoning_effort": "<level>"}` | `{"thinking": {"type": "disabled"}}` |
| `openai-responses` | `{"reasoning": {"effort": "<level>", "summary": "auto"}}` | `{"reasoning": {"effort": "none"}}` when the endpoint honors it, else `{}` (empty: omit reasoning, the only off switch on this wire) |
| `anthropic-messages` | Budget shape: `{"thinking": {"type": "enabled", "budget_tokens": <tier>}}`; adaptive shape: `{"thinking": {"type": "adaptive"}, "output_config": {"effort": "<effort>"}}` | `{"thinking": {"type": "disabled"}}` |

The explicit `none` variant is what exposes the off switch: on a custom
provider, `toggle: true` alone does not make `none` selectable (verified on
opencode 2.0.29: `opencode run --model "<provider>/<model>#none"` answers
`Variant unavailable` without the explicit entry, and succeeds with it).
"Cannot turn off" therefore means `supported: true` with no `toggle` key and
no `none` variant. Explicit `variants` apply on top of the variants opencode
derives from `capabilities.reasoning`, so these entries win by id.

Levels the endpoint rejected (HTTP 4xx) or silently ignored (2xx but no
reasoning, or graded levels whose low and high probes return about the same
output) get no variant and no `effort` entry.

## Compatibility (provider and model level)

`compatibility` accepts `reasoningField`, `maxTokensField`, `cacheFormat`,
`streamUsage`, `mediaInput`, and others. The build sets only what the probes
decide; anything else stays unset:

| Field | Level | Value |
| --- | --- | --- |
| `reasoningField` | Provider: the delta field that carried reasoning across models (`reasoning_content` / `reasoning` / `reasoning_text` for completions, `reasoning_summary_text` for responses, `thinking` for Anthropic). Model: set only when a model's field differs from the provider's. | From the stream probes. |
| `maxTokensField` | Provider only. | `"max_completion_tokens"`, and only when `max_tokens` is rejected while `max_completion_tokens` is accepted. Otherwise omitted (auto-detected). |
| `cacheFormat` | Provider when every included model id starts with `anthropic/` or `claude` (Claude served through a proxy); otherwise per matching model only. | `"anthropic"`. |

## Key handling: env var or file

Two ways to authenticate, chosen in Step 1:

- Env var (default): `env: [KEY_ENV]`. `env` is an ordered list; opencode
  uses the first name that resolves and leaves the provider inactive when
  none does.
- File reference: `settings.apiKey: "{file:<path>}"` with no `env` key
  (build flag `--key-file PATH`). opencode reads the file itself; the build
  writes only the `{file:...}` reference and never reads or prints the file.

Prefer the file reference when the opencode background daemon may not inherit
the shell env: a provider that works for one key and not another is usually a
daemon that never saw the variable. pi always uses the env var regardless.

## Model keys

The key is the short alias (text after the last `/`) when every short alias
is unique; otherwise the full upstream id. References read
`<providerId>/<key>`, so with full ids that is
`provider/anthropic/claude-x`. Both forms resolve in opencode; the build
warns when it falls back to full ids.

## Validation

Validate the generated file with opencode itself, in a scratch config that
never touches the user's real one:

```bash
mkdir -p /tmp/oco-home/.config/opencode
HOME=/tmp/oco-home XDG_CONFIG_HOME=/tmp/oco-home/.config KEY_ENV_NAME="placeholder" \
  opencode models --standalone 2>&1 | grep '<providerId>/'
```

with the draft installed at `/tmp/oco-home/.config/opencode/opencode.json`
and the key env var set (point `baseURL` at the mock server when no live
run is approved). `--standalone` runs a private server so the user's
background service (and its config) stays untouched. The provider's models
must be listed; resolving one variant per model
(`opencode run --standalone --model "<providerId>/<key>#<variant>"`) proves
the variants apply. `opencode debug config` needs the background service and
is optional; the schema check plus `opencode models --standalone` is the
required gate.
