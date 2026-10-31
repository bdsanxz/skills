---
name: setup-custom-inferences
description: |
  Set up a custom inference provider (a user-supplied baseURL plus API key) for pi and opencode over OpenAI chat-completions, OpenAI responses, or Anthropic messages: detect the wire protocol, enumerate the provider's models, probe each model's capabilities (reasoning, which thinking levels work, whether thinking can be turned off, tool calling, multi-turn replay), and write a correct provider config for each runtime. Use when the user names a custom provider, base URL, or gateway they want wired into pi or opencode, or names this skill. Do not use for built-in providers that only need a login.
---

# Setup Custom Inferences

Wire one custom inference provider into pi, opencode, or both, over
`openai-completions`, `openai-responses`, or `anthropic-messages`. Every
probe result lives in a work directory on disk, so a run that spans dozens of
models survives context compaction and restarts: the agent never relies on
conversation memory for what was probed.

## Running the script

`setup` below stands for this shell function:

```
setup() { bun "<this skill's directory>/scripts/setup-custom-inferences.js" "$@"; }
```

Define it at the start of every shell command that uses it, because shell
state does not carry over between commands. It needs [Bun](https://bun.sh)
and nothing else; when `bun` is not found, tell the user to install it and
stop. `setup --help` lists the commands, and `setup <command> --help` gives a
command's options. Exit codes: 0 done, 1 the request failed, 2 wrong usage.

The script reads the API key from the environment variable named by
`--key-env`. The key itself never appears in a flag, a file the script writes
(they hold only the variable NAME), or the transcript: export the variable,
never paste the value.

## Resume

The work directory is `<cwd>/_work/setup-custom-inferences/<provider>/` (or a
path the user names). It holds `state.json` (inputs, step reached, per-model
status, compat probe results, warnings), `probe/<model>.json` (one result per
model), `draft/pi.json`, `draft/opencode.json`, and `report.md`.

Before anything else, read `state.json` when the work directory already
exists and continue from the first incomplete step: `probe` skips models that
already have a result file (pass `--redo` to re-probe one), `build` is a pure
function of the results, and `apply` always backs up first. Each step records
its completion in `state.json` before moving on.

## Step 1: Gather inputs

Ask the user only for what is missing, one question per call with the
question tool:

1. The wire protocol: `openai-completions`, `openai-responses`, or
   `anthropic-messages`. Default to auto-detect: the probe tries each
   endpoint shape and continues only when exactly one responds; when several
   respond, ask the user and re-run with `--api`.
2. The provider's base URL: the OpenAI-style root (for example
   `https://api.example.com/v1`) for the OpenAI protocols, the host root
   (for example `https://api.anthropic.com`) for Anthropic.
3. How opencode should authenticate: an environment variable NAME holding the
   key (offer to default to `<PROVIDER>_API_KEY`), or a `{file:<path>}`
   reference opencode reads itself. Prefer the file when the opencode
   background daemon may not inherit the shell env (a provider that works for
   one key and not another usually means the daemon never saw the variable).
   pi always uses the env var; the key itself is never asked for. Custom
   auth headers come from `--header-env H=ENV_NAME` pairs when the user
   names them.
4. Which runtimes: pi, opencode, or both.
5. An optional context-window cap (a provider whose advertised windows exceed
   what the user wants to pay for) and an optional max-output value.
6. Whether pi should switch its startup default to one of the new models,
   and which one.

## Step 2: Enumerate

```
export KEY_ENV_NAME="placeholder"   # the real key stays outside the transcript
setup probe --base-url "<url>" --provider "<id>" --key-env KEY_ENV_NAME \
  --work-dir "<work dir>" [--api <protocol>] [--header-env H=ENV_NAME,...]
```

Without `--api` the probe auto-detects first (see Step 1 item 1) and records
the winner in `state.json`. This lists `GET <baseURL>/models` (or
`<baseURL>/v1/models` for Anthropic), then probes every model. `--models`
limits a run to named ids, `--concurrency` sets the parallel probes,
`--levels` sets the thinking levels to try. Probing a real paid endpoint
spends money: it runs because the user asked for this setup, but say so
before a long sweep and offer `--models` for a trial on one model first.

## Step 3: Probe

`probe` is resumable: re-running it after a compaction or restart picks up
where `state.json` left off. What it records per model depends on the
protocol (`state.json` holds the `api`):

- `openai-completions`, over streaming `chat/completions`: one request with
  `thinking: {"type": "disabled"}` and one per thinking level with
  `thinking: {"type": "enabled"}` plus `reasoning_effort`, counting
  `reasoning_content` | `reasoning` | `reasoning_text` in the stream deltas;
  whether `reasoning_effort: "none"` alone disables thinking (it does not on
  every endpoint) and whether a `developer`-role message is accepted;
  whether `tools` produce `tool_calls`, and whether a multi-turn replay of an
  assistant message WITHOUT `reasoning_content` is accepted.
- `openai-responses`, over streaming `/responses` (always `store:false`):
  one request with no `reasoning` field and one per level with
  `reasoning: {effort, summary: "auto"}`, counting
  `reasoning_summary_text` deltas and `output_text`; a `reasoning:
  {effort: "none"}` probe; `function_call` items for the tool probe; full-input
  replay without reasoning items and `previous_response_id` replay.
- `anthropic-messages`, over streaming `/v1/messages` (key as `x-api-key`
  plus `anthropic-version`): one request with `thinking: {type: disabled}` and,
  per level, both the budget tier (`thinking: {type: enabled, budget_tokens}`)
  and the newer effort form (`thinking: {type: adaptive}` plus
  `output_config: {effort}`), counting `thinking` deltas; `tool_use` blocks
  for the tool probe; plain replay, replay with a thinking block carrying a
  signature, and replay with an empty signature (decides pi
  `allowEmptySignature`).

A model that still emits reasoning when thinking is disabled cannot be turned
off. A level the endpoint rejects (HTTP 4xx) or silently ignores is
unsupported: 2xx with no reasoning while sibling levels reason, or graded
levels whose low and high probes return about the same reasoning output (the
endpoint ignores effort, so `build` nulls every graded level). A model that
answers HTTP 403 is recorded inaccessible and excluded from the drafts: that
is an access problem, not a capability finding. TLS or certificate failures
abort the run as a provider problem, never as per-model results. Model input
stays `["text"]`: images are never claimed unless a probe sends them, and no
probe does.

## Step 4: Build

Read `references/pi-fields.md` first: it defines every pi field the draft
holds and the decision tables the script applies (compat choice, the
`thinkingLevelMap` mapping, cost, caps). Then read
`references/opencode-fields.md`: it defines the opencode provider, model,
capabilities, and thinking-level variant fields.

```
setup build --work-dir "<work dir>" --provider "<id>" --base-url "<url>" \
  --key-env KEY_ENV_NAME [--name "<display>"] [--context-cap N] \
  [--max-tokens N] [--target pi|opencode|both] [--key-file "<path>"]
```

`--key-file` writes `settings.apiKey: "{file:<path>}"` for opencode (no
`env` key) without ever reading the file; it is the choice from Step 1 item
2 when the daemon may not inherit the shell env.

`build` writes `draft/pi.json` (the pi provider entry) and
`draft/opencode.json` (the opencode provider entry) into the work directory.
It writes drafts only and never touches live config. Read both drafts back
and check them against the two references before moving on; warnings (rejected
levels, failed tool or replay probes) are in `state.json` under `warnings`
and must be reported, not hidden.

## Step 5: Validate

Validate the drafts before they touch a live file:

1. Both drafts are valid JSON whose shape matches the two references (every
   pi model has `id`, `cost`, `contextWindow`, `maxTokens`; every opencode
   model has `modelID` and `capabilities`; opencode `limit.context` and
   `limit.output` are optional with 200k/32k fallbacks but are always
   written). Variant items hold only `id`/`body`/`settings`/`headers`.
2. For opencode, install the draft into a scratch config and ask opencode
   itself, following `references/opencode-fields.md` ("Validation"): the
   provider's models must appear in `opencode models --standalone`. Then
   resolve at least one thinking level variant and the `none` variant per
   reasoning model through `opencode run --standalone --model
   "<providerId>/<key>#<variant>"` with a short prompt; the mock echoes the
   received thinking params in its answer, and a live endpoint should show
   the effort taking effect (or at least generate). Never point this at the
   user's real config, and never overwrite the user's real config to
   validate: use a scratch `HOME`/`XDG_CONFIG_HOME`.
3. For pi, the gate is the shape check in item 1 above plus a successful load
   of the entry by the runtime in Step 7. A live smoke test of one model per
   runtime (one short prompt, thinking on and off) is required before calling
   the setup done; it spends a little money and needs the user's go-ahead in
   the same question that approves writing the live files.

## Step 6: Write with backup

Get the user's go-ahead before writing any live file, and back up every file
written. Merge only the one provider key; every other provider stays
untouched.

```
setup apply --draft "<work dir>/draft/pi.json" \
  --target ~/.pi/agent/models.json --provider "<id>"
setup apply --draft "<work dir>/draft/opencode.json" \
  --target ~/.config/opencode/opencode.json --provider "<id>"
```

`apply` copies the target to `<target>.bak-<timestamp>` first and prints the
backup path. It refuses to create a config file from scratch. Set pi startup
defaults only when the user asked in Step 1:

```
setup apply --draft "<work dir>/draft/pi.json" \
  --target ~/.pi/agent/settings.json --provider "<id>" \
  --as-settings --model "<model id>"
```

## Step 7: Verify with the runtime

After writing, prove the setup on the final files: `opencode models` shows
the new models (real config this time), and pi loads the provider (open
`/model` or send one short prompt on the default model when one was set).
Report the backup paths, the model count per runtime, and any warnings from
`state.json`. If a runtime rejects the entry, restore from the backup, fix
the draft, and repeat from Step 4.

## Step 8: Report

Write `report.md` in the work directory: the provider, the inputs, the model
count and per-model outcome (reasoning, off support, working levels, tools,
replay), the compat chosen and why, the backup paths, the exact validation
commands and their output, and the open questions. Give the user the short
version: what was added, where, and what still needs them.
