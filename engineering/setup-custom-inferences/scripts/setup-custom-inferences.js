#!/usr/bin/env bun
// setup-custom-inferences: enumerate a custom OpenAI-compatible provider,
// probe each model's capabilities, and build pi + opencode provider entries.
//
// Zero dependencies. Runs with Bun or Node 18+. Never prints the API key:
// the key is read from the environment variable named by --key-env and only
// the variable NAME is ever written to drafts, state, or logs.
//
// Commands: probe | build | apply. `probe --help` etc. print per-command help.
// Exit codes: 0 done, 1 the request failed, 2 wrong usage.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
// Delta keys that carry reasoning, in tie-break order: completions first,
// then responses summaries, then Anthropic thinking blocks.
const REASON_FIELDS = ["reasoning_content", "reasoning", "reasoning_text", "reasoning_summary_text", "thinking"];
// Anthropic adaptive effort probed per pi level (pi clamps xhigh/max to high
// for budgets; adaptive max is universal, native xhigh is model-specific).
const ADAPTIVE_EFFORT = { minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
// opencode provider package per wire protocol (verified against opencode
// itself; see references/opencode-fields.md).
const OC_PACKAGE = {
  "openai-completions": "@opencode/ai/providers/openai-compatible",
  "openai-responses": "@opencode/ai/providers/openai-compatible/responses",
  "anthropic-messages": "@opencode/ai/providers/anthropic",
};

function ignoredEffort(a, b) {
  if (!a || !b || isRejected(a) || isRejected(b)) return false;
  const x = a.reasoningChars || 0;
  const y = b.reasoningChars || 0;
  return x > 0 && y > 0 && Math.abs(x - y) <= Math.max(32, 0.15 * Math.max(x, y));
}
const APIS = ["openai-completions", "openai-responses", "anthropic-messages"];
const TRAIN_PROMPT =
  "A train leaves at 3:40pm going 62 mph. A second leaves 25 minutes later " +
  "at 74 mph on the same route. When does the second catch up? Show the arithmetic.";
// Reasoning probe knobs per protocol. Anthropic budgets are pi's built-in
// thinkingBudgets (minimal/low/medium/high); xhigh/max clamp to high in pi,
// so they probe the high tier.
const ANTHROPIC_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384 };
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

function fail(msg, code = 1) {
  process.stderr.write(`setup-custom-inferences: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) opts[key] = true;
        else {
          opts[key] = next;
          i++;
        }
      } else opts[a.slice(2, eq)] = a.slice(eq + 1);
    } else rest.push(a);
  }
  return { opts, rest };
}

function need(opts, name, helpText) {
  if (opts[name] === undefined || opts[name] === true)
    fail(`missing --${name}.\n\n${helpText}`, 2);
  return String(opts[name]);
}

function needApi(opts, helpText) {
  if (opts.api === undefined || opts.api === true) return null;
  const api = String(opts.api);
  if (!APIS.includes(api)) fail(`bad --api ${api}; want ${APIS.join(" | ")}.\n\n${helpText}`, 2);
  return api;
}

// Extra request headers from the environment: --header-env "H1=E1,H2=E2"
// sends H1/H2 with the values of $E1/$E2. Only the NAME mapping is stored;
// values are read per request and never printed or written.
function parseHeaderEnvs(opts, helpText) {
  const raw = opts["header-env"];
  if (raw === undefined || raw === true || raw === "false") return {};
  const map = {};
  for (const pair of String(raw).split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1 || !pair.slice(0, eq).trim() || !pair.slice(eq + 1).trim())
      fail(`bad --header-env ${pair}; want HEADER=ENV_NAME pairs.\n\n${helpText}`, 2);
    map[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  for (const [h, e] of Object.entries(map))
    if (!process.env[e]) fail(`header env ${e} (for ${h}) is not set. Export it first.`);
  return map;
}

function extraHeaders(headerEnvs) {
  const out = {};
  for (const [h, e] of Object.entries(headerEnvs)) out[h] = process.env[e];
  return out;
}

function requestHeaders(api, key, headerEnvs) {
  const extra = extraHeaders(headerEnvs);
  if (api === "anthropic-messages")
    return {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

function ensureFetch() {
  if (typeof fetch !== "function")
    fail("no global fetch. Run with Bun or Node 18+.");
}

function readKey(envName) {
  const key = process.env[envName];
  if (!key)
    fail(
      `environment variable ${envName} is not set. Export it first; the key is never passed as a flag.`
    );
  return key;
}

function safeName(id) {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`cannot read JSON ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1) + "\n");
}

function loadState(workDir) {
  const file = path.join(workDir, "state.json");
  if (fs.existsSync(file)) return readJson(file);
  return null;
}

function saveState(workDir, state) {
  writeJson(path.join(workDir, "state.json"), state);
}

async function fetchJson(url, { headers, body, timeoutMs, stream = false, parse = parseStream }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(stream ? { ...body, stream } : body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok)
      return { httpError: `${res.status} ${text.slice(0, 160)}` };
    if (stream) return parse(text);
    try {
      const data = JSON.parse(text);
      return { data };
    } catch {
      return { httpError: `200 non-JSON ${text.slice(0, 160)}` };
    }
  } catch (err) {
    const cause = err && err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : "";
    return { httpError: `request failed: ${err.message}${cause}`.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function parseStream(text) {
  const reasoningByField = {};
  let contentChars = 0;
  let toolCalls = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (evt.error) return { httpError: `stream error: ${JSON.stringify(evt.error).slice(0, 160)}` };
    for (const choice of evt.choices || []) {
      const delta = choice.delta || {};
      for (const f of REASON_FIELDS)
        if (typeof delta[f] === "string")
          reasoningByField[f] = (reasoningByField[f] || 0) + delta[f].length;
      if (typeof delta.content === "string") contentChars += delta.content.length;
      if (delta.tool_calls) toolCalls += delta.tool_calls.length;
    }
  }
  let reasoningChars = 0;
  let reasoningField = null;
  for (const f of REASON_FIELDS) {
    const n = reasoningByField[f] || 0;
    reasoningChars += n;
    if (n > 0 && (reasoningField === null || n > (reasoningByField[reasoningField] || 0)))
      reasoningField = f;
  }
  return { reasoningChars, reasoningField, reasoningByField, contentChars, toolCalls };
}

// Provider-level connection problem (TLS/certificate), never a per-model
// result. fetch() hides the cause in err.cause, so match both. Patterns stay
// narrow: a false positive aborts the whole run.
export function isTlsError(message) {
  return /CERT|VERIFY|handshake|self[-_ ]?signed|ERR_SSL|ERR_TLS|certificate/i.test(
    String(message || "")
  );
}

function parseResponsesStream(text) {
  const reasoningByField = {};
  let contentChars = 0;
  let toolCalls = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    const type = String(evt.type || "");
    if (evt.error || type === "response.failed")
      return { httpError: `stream error: ${JSON.stringify(evt.error || evt).slice(0, 160)}` };
    const parts = type.split(".");
    const key = parts.length >= 2 ? parts[parts.length - 2] : "";
    if (type.includes("reasoning") && typeof evt.delta === "string")
      reasoningByField[key || "reasoning_summary_text"] =
        (reasoningByField[key || "reasoning_summary_text"] || 0) + evt.delta.length;
    if (type.includes("output_text") && typeof evt.delta === "string")
      contentChars += evt.delta.length;
    if (type.includes("function_call")) toolCalls++;
  }
  return finishParse(reasoningByField, contentChars, toolCalls);
}

function parseAnthropicStream(text) {
  const reasoningByField = {};
  let contentChars = 0;
  let toolCalls = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (evt.type === "error" || evt.error)
      return { httpError: `stream error: ${JSON.stringify(evt.error || evt).slice(0, 160)}` };
    if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "tool_use")
      toolCalls++;
    const delta = evt.delta || {};
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string")
      reasoningByField.thinking = (reasoningByField.thinking || 0) + delta.thinking.length;
    if (delta.type === "text_delta" && typeof delta.text === "string")
      contentChars += delta.text.length;
  }
  return finishParse(reasoningByField, contentChars, toolCalls);
}

function finishParse(reasoningByField, contentChars, toolCalls) {
  let reasoningChars = 0;
  let reasoningField = null;
  for (const f of REASON_FIELDS) {
    const n = reasoningByField[f] || 0;
    reasoningChars += n;
    if (n > 0 && (reasoningField === null || n > (reasoningByField[reasoningField] || 0)))
      reasoningField = f;
  }
  return { reasoningChars, reasoningField, reasoningByField, contentChars, toolCalls };
}

function listPathFor(api) {
  return api === "anthropic-messages" ? "/v1/models" : "/models";
}

async function tryGet(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 160) };
    try {
      return { ok: true, status: 200, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: 200, text: "non-JSON" };
    }
  } catch (err) {
    return { ok: false, status: 0, text: `request failed: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function listModels(baseUrl, api, headers, timeoutMs) {
  const origin = baseUrl.replace(/\/+$/, "");
  const listPath = listPathFor(api);
  const got = await tryGet(`${origin}${listPath}`, headers, timeoutMs);
  if (!got.ok) {
    const where = `GET ${listPath} -> ${got.status} ${got.text}`;
    fail(
      isTlsError(where)
        ? `${where}. Provider TLS/certificate problem: check http vs https and certificates; no per-model results recorded.`
        : got.status === 403
          ? `${where}. The endpoint refuses listing (key or plan); nothing probed.`
          : `${where}. The provider is unreachable or misconfigured; nothing probed.`
    );
  }
  return ((got.data && got.data.data) || []).filter(
    (m) => m && typeof m.id === "string" && !m.id.endsWith("/")
  );
}

// Auto-detect the wire protocol: try each endpoint shape against a listed
// model and report which respond (HTTP 2xx). Exactly one -> select it; none
// or several -> fail with guidance (the SKILL.md step asks the user).
async function detectApi(baseUrl, key, headerEnvs, timeoutMs, onlyIds) {
  const origin = baseUrl.replace(/\/+$/, "");
  const heads = (api) => requestHeaders(api, key, headerEnvs);
  const l1 = await tryGet(`${origin}/models`, heads("openai-completions"), timeoutMs);
  const l2 = await tryGet(`${origin}/v1/models`, heads("anthropic-messages"), timeoutMs);
  const ids1 = l1.ok ? ((l1.data.data || []).map((m) => m.id).filter((id) => !onlyIds || onlyIds.includes(id))) : [];
  const ids2 = l2.ok ? ((l2.data.data || []).map((m) => m.id).filter((id) => !onlyIds || onlyIds.includes(id))) : [];
  const responding = [];
  const denied = [];
  async function tryPost(api, url, body) {
    const r = await fetchJson(url, {
      headers: heads(api),
      body,
      timeoutMs: Math.min(timeoutMs, 30000),
    });
    if (!r.httpError) responding.push(api);
    else if (String(r.httpError).startsWith("403")) denied.push(api);
    return r;
  }
  if (ids1.length > 0) {
    const id = ids1[0];
    await tryPost("openai-completions", `${origin}/chat/completions`, {
      model: id,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 8,
    });
    await tryPost("openai-responses", `${origin}/responses`, {
      model: id,
      input: "ok",
      max_output_tokens: 8,
      store: false,
    });
  }
  if (ids2.length > 0) {
    const id = ids2[0];
    await tryPost("anthropic-messages", `${origin}/v1/messages`, {
      model: id,
      max_tokens: 8,
      messages: [{ role: "user", content: "ok" }],
    });
  }
  const found = [...new Set(responding)];
  if (found.length === 1) {
    process.stdout.write(`auto-detected API: ${found[0]}\n`);
    return found[0];
  }
  if (found.length === 0 && denied.length > 0)
    fail(
      "auto-detect: every protocol answered HTTP 403 (key may not access these models). " +
        "Pass --api explicitly and check key access, or probe an accessible model."
    );
  if (found.length === 0)
    fail(
      "auto-detect: no protocol responded (tried chat/completions, responses, v1/messages). " +
        "Check the base URL (OpenAI-style root vs Anthropic host root), the key, and network; or pass --api explicitly."
    );
  fail(
    `auto-detect ambiguous: ${found.join(" and ")} both respond. ` +
      `Re-run with --api one of: ${found.join(", ")}.`
  );
}

const PROBE_HELP = `usage: setup-custom-inferences.js probe --base-url URL --provider ID --key-env NAME --work-dir DIR [options]

Enumerate the provider's models (GET <baseURL>/models, or <baseURL>/v1/models
for anthropic-messages), then probe each model over its wire protocol.
Resumable: models with a probe/<model>.json result are skipped unless --redo
is passed. The key is read from NAME, never printed.

  --api A             ${APIS.join(" | ")} (default: auto-detect)
  --header-env H=E,.. extra request headers from env vars (custom auth)
  --models A,B        only probe these model ids (default: all enumerated)
  --levels L,..       thinking levels to try (default: ${LEVELS.join(",")})
  --concurrency N     parallel probes (default 4)
  --timeout-ms MS     per-request timeout (default 120000)
  --probe-tokens N    max_tokens for reasoning probes (default 2000)
  --prompt TEXT       override the reasoning probe prompt
  --redo              re-probe even when a result file exists

Models that answer HTTP 403 are recorded inaccessible and skipped.
TLS/certificate failures abort the run as a provider problem, never as
per-model results.`;

async function cmdProbe(argv) {
  const { opts } = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(PROBE_HELP + "\n");
    return;
  }
  ensureFetch();
  const baseUrl = need(opts, "base-url", PROBE_HELP);
  const provider = need(opts, "provider", PROBE_HELP);
  const keyEnv = need(opts, "key-env", PROBE_HELP);
  const workDir = need(opts, "work-dir", PROBE_HELP);
  const key = readKey(keyEnv);
  const headerEnvs = parseHeaderEnvs(opts, PROBE_HELP);
  const concurrency = Number(opts.concurrency || 4);
  const timeoutMs = Number(opts["timeout-ms"] || 120000);
  const probeTokens = Number(opts["probe-tokens"] || 2000);
  const prompt = opts.prompt ? String(opts.prompt) : TRAIN_PROMPT;
  const only = opts.models ? String(opts.models).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const levels = opts.levels ? String(opts.levels).split(",").map((s) => s.trim()).filter(Boolean) : LEVELS;
  const redo = Boolean(opts.redo) && opts.redo !== "false";

  let api = needApi(opts, PROBE_HELP);
  if (!api) api = await detectApi(baseUrl, key, headerEnvs, timeoutMs, only);
  const heads = requestHeaders(api, key, headerEnvs);

  const listed = await listModels(baseUrl, api, heads, timeoutMs);
  const ids = [...new Set(listed.map((m) => m.id))].filter((id) => !only || only.includes(id));
  if (ids.length === 0) fail("no models to probe (empty list or --models matched nothing).");
  const ctxOf = Object.fromEntries(listed.map((m) => [m.id, m.context_window]));

  let state = loadState(workDir) || {
    provider,
    baseUrl,
    keyEnv,
    api,
    headerEnvs,
    step: "probe",
    compat: null,
    models: {},
  };
  state.provider = provider;
  state.baseUrl = baseUrl;
  state.keyEnv = keyEnv;
  state.api = api;
  state.headerEnvs = headerEnvs;

  const origin = baseUrl.replace(/\/+$/, "");
  function throwIfTls(result, id) {
    if (result && result.httpError && isTlsError(result.httpError))
      fail(
        `provider TLS/certificate problem probing ${id}: ${result.httpError}. ` +
          "Check http vs https and certificates; no per-model results recorded."
      );
  }
  function postCompletions(body, streamFlag) {
    return fetchJson(`${origin}/chat/completions`, { headers: heads, body, timeoutMs, stream: streamFlag });
  }
  function postResponses(body, streamFlag) {
    // store:false always: probe traffic must never train the provider.
    return fetchJson(`${origin}/responses`, {
      headers: heads,
      body: { store: false, ...body },
      timeoutMs,
      stream: streamFlag,
      parse: parseResponsesStream,
    });
  }
  function postMessages(body, streamFlag) {
    return fetchJson(`${origin}/v1/messages`, {
      headers: heads,
      body,
      timeoutMs,
      stream: streamFlag,
      parse: parseAnthropicStream,
    });
  }
  function recordInaccessible(out, file, id, httpError) {
    out.inaccessible = true;
    out.httpError = httpError;
    writeJson(file, out);
    return { id, inaccessible: true };
  }
  async function probeOne(id) {
    const file = path.join(workDir, "probe", `${safeName(id)}.json`);
    if (!redo && fs.existsSync(file)) return { id, skipped: true };
    if (api === "openai-responses") return probeResponses(id, file);
    if (api === "anthropic-messages") return probeAnthropic(id, file);
    return probeCompletions(id, file);
  }
  async function probeCompletions(id, file) {
    const base = { model: id, messages: [{ role: "user", content: prompt }], max_tokens: probeTokens };
    const out = { id, api, contextWindow: ctxOf[id] ?? null };
    const off = await postCompletions({ ...base, thinking: { type: "disabled" } }, true);
    throwIfTls(off, id);
    // 403 on the base probe means the key may not access this model: record
    // it as inaccessible (an access problem, not a capability finding) and
    // skip the remaining probes for it.
    if (off.httpError && off.httpError.startsWith("403"))
      return recordInaccessible(out, file, id, off.httpError);
    out.off = summarize(off);
    out.levels = {};
    for (const level of levels) {
      const r = await postCompletions({ ...base, thinking: { type: "enabled" }, reasoning_effort: level }, true);
      throwIfTls(r, id);
      out.levels[level] = summarize(r);
    }
    const none = await postCompletions({ ...base, reasoning_effort: "none" }, true);
    throwIfTls(none, id);
    out.effortNone = summarize(none);
    const tool = await postCompletions({
      model: id,
      messages: [{ role: "user", content: "What is the weather in Jakarta? Use the tool." }],
      max_tokens: probeTokens,
      tools: [TOOL],
    }, true);
    throwIfTls(tool, id);
    out.tool = { called: (tool.toolCalls || 0) > 0, httpError: tool.httpError || null };
    const replay = await postCompletions({
      model: id,
      messages: [
        { role: "user", content: "2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "plus 1?" },
      ],
      max_tokens: 200,
    }, false);
    throwIfTls(replay, id);
    out.replay = replay.httpError
      ? { ok: false, httpError: replay.httpError }
      : { ok: true, httpError: null };
    writeJson(file, out);
    return { id, skipped: false };
  }
  async function probeResponses(id, file) {
    const base = { model: id, input: prompt, max_output_tokens: probeTokens };
    const out = { id, api, contextWindow: ctxOf[id] ?? null };
    const off = await postResponses({ ...base }, true);
    throwIfTls(off, id);
    if (off.httpError && off.httpError.startsWith("403"))
      return recordInaccessible(out, file, id, off.httpError);
    out.off = summarize(off);
    out.levels = {};
    for (const level of levels) {
      const r = await postResponses({ ...base, reasoning: { effort: level, summary: "auto" } }, true);
      throwIfTls(r, id);
      out.levels[level] = summarize(r);
    }
    const none = await postResponses({ ...base, reasoning: { effort: "none" } }, true);
    throwIfTls(none, id);
    out.effortNone = summarize(none);
    const tool = await postResponses({
      model: id,
      input: "What is the weather in Jakarta? Use the tool.",
      max_output_tokens: probeTokens,
      tools: [{ type: "function", name: "get_weather", description: "Get the weather for a city.", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    }, true);
    throwIfTls(tool, id);
    out.tool = { called: (tool.toolCalls || 0) > 0, httpError: tool.httpError || null };
    // Full-input replay: assistant history WITHOUT reasoning items, mirroring
    // the completions replay that omits reasoning_content.
    const replayFull = await postResponses({
      model: id,
      input: [
        { role: "user", content: "2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "plus 1?" },
      ],
      max_output_tokens: 200,
    }, false);
    throwIfTls(replayFull, id);
    out.replayFull = replayFull.httpError
      ? { ok: false, httpError: replayFull.httpError }
      : { ok: true, httpError: null };
    // Server-side history via previous_response_id.
    const first = await postResponses({ model: id, input: "2+2?", max_output_tokens: 200 }, false);
    throwIfTls(first, id);
    const prevId = first.data && first.data.id;
    const replayPrev = prevId
      ? await postResponses({ model: id, input: "plus 1?", previous_response_id: prevId, max_output_tokens: 200 }, false)
      : { httpError: first.httpError || "no response id" };
    throwIfTls(replayPrev, id);
    out.replayPrevId = replayPrev.httpError
      ? { ok: false, httpError: replayPrev.httpError }
      : { ok: true, httpError: null };
    writeJson(file, out);
    return { id, skipped: false };
  }
  const ANTH_TOOL = {
    name: "get_weather",
    description: "Get the weather for a city.",
    input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  };
  async function probeAnthropic(id, file) {
    const base = { model: id, messages: [{ role: "user", content: prompt }], max_tokens: probeTokens };
    const out = { id, api, contextWindow: ctxOf[id] ?? null };
    const off = await postMessages({ ...base, thinking: { type: "disabled" } }, true);
    throwIfTls(off, id);
    if (off.httpError && off.httpError.startsWith("403"))
      return recordInaccessible(out, file, id, off.httpError);
    out.off = summarize(off);
    // Budget tiers (pi's built-in thinkingBudgets) for minimal..high; xhigh
    // and max clamp to high in pi, so they probe the high tier.
    out.budgets = {};
    for (const level of ["minimal", "low", "medium", "high"]) {
      const r = await postMessages({ ...base, thinking: { type: "enabled", budget_tokens: ANTHROPIC_BUDGETS[level] } }, true);
      throwIfTls(r, id);
      out.budgets[level] = summarize(r);
    }
    for (const level of ["xhigh", "max"]) {
      const r = await postMessages({ ...base, thinking: { type: "enabled", budget_tokens: ANTHROPIC_BUDGETS.high } }, true);
      throwIfTls(r, id);
      out.budgets[level] = summarize(r);
    }
    // Newer effort/adaptive form, one probe per pi level.
    out.efforts = {};
    for (const level of levels) {
      const r = await postMessages({
        ...base,
        thinking: { type: "adaptive" },
        output_config: { effort: ADAPTIVE_EFFORT[level] || level },
      }, true);
      throwIfTls(r, id);
      out.efforts[level] = summarize(r);
    }
    const tool = await postMessages({
      model: id,
      messages: [{ role: "user", content: "What is the weather in Jakarta? Use the tool." }],
      max_tokens: probeTokens,
      tools: [ANTH_TOOL],
    }, true);
    throwIfTls(tool, id);
    out.tool = { called: (tool.toolCalls || 0) > 0, httpError: tool.httpError || null };
    const replayPlain = await postMessages({
      model: id,
      messages: [
        { role: "user", content: "2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "plus 1?" },
      ],
      max_tokens: 200,
    }, false);
    throwIfTls(replayPlain, id);
    out.replayPlain = replayPlain.httpError
      ? { ok: false, httpError: replayPlain.httpError }
      : { ok: true, httpError: null };
    // Replay WITH a thinking block carrying a signature, and with an empty
    // one (the latter decides pi allowEmptySignature).
    async function replayThinking(signature) {
      return postMessages({
        model: id,
        messages: [
          { role: "user", content: "2+2?" },
          { role: "assistant", content: [{ type: "thinking", thinking: "it is 4", signature }] },
          { role: "user", content: "plus 1?" },
        ],
        max_tokens: 200,
      }, false);
    }
    const replaySig = await replayThinking("sig-probe");
    throwIfTls(replaySig, id);
    out.replayThinking = replaySig.httpError
      ? { ok: false, httpError: replaySig.httpError }
      : { ok: true, httpError: null };
    const replayEmpty = await replayThinking("");
    throwIfTls(replayEmpty, id);
    out.emptySig = replayEmpty.httpError
      ? { ok: false, httpError: replayEmpty.httpError }
      : { ok: true, httpError: null };
    writeJson(file, out);
    return { id, skipped: false };
  }

  function summarize(r) {
    if (r.httpError) return { reasoningChars: 0, reasoningField: null, httpError: r.httpError };
    return {
      reasoningChars: r.reasoningChars || 0,
      reasoningField: r.reasoningField || null,
      reasoningByField: r.reasoningByField || {},
      httpError: null,
    };
  }

  const queue = [...ids];
  const results = [];
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      try {
        const r = await probeOne(id);
        results.push(r);
        state.models[id] = r.inaccessible
          ? { status: "inaccessible", file: `probe/${safeName(id)}.json` }
          : { status: "done", file: `probe/${safeName(id)}.json` };
      } catch (err) {
        results.push({ id, error: err.message });
        state.models[id] = { status: "error" };
      }
      saveState(workDir, state);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  if (!state.compat) {
    const compatModel = ids[0];
    const flag = (r) => (r.httpError ? { ok: false, httpError: r.httpError } : { ok: true, httpError: null });
    if (api === "openai-responses") {
      const dev = await postResponses({ model: compatModel, input: [{ role: "developer", content: "be terse" }, { role: "user", content: "say ok" }], max_output_tokens: 32 }, false);
      const mo = await postResponses({ model: compatModel, input: "say ok", max_output_tokens: 32 }, false);
      const mt = await postResponses({ model: compatModel, input: "say ok", max_tokens: 32 }, false);
      state.compat = { model: compatModel, developerRole: flag(dev), maxOutputTokens: flag(mo), maxTokens: flag(mt) };
    } else if (api === "anthropic-messages") {
      state.compat = { model: compatModel };
    } else {
      const dev = await postCompletions({
        model: compatModel,
        messages: [
          { role: "developer", content: "be terse" },
          { role: "user", content: "say ok" },
        ],
        max_tokens: 32,
      }, false);
      const mt = await postCompletions(
        { model: compatModel, messages: [{ role: "user", content: "say ok" }], max_tokens: 32 },
        false
      );
      const mct = await postCompletions(
        { model: compatModel, messages: [{ role: "user", content: "say ok" }], max_completion_tokens: 32 },
        false
      );
      state.compat = {
        model: compatModel,
        developerRole: flag(dev),
        maxTokens: flag(mt),
        maxCompletionTokens: flag(mct),
      };
    }
    state.step = "probed";
    saveState(workDir, state);
  }

  const failed = results.filter((r) => r.error);
  const denied = results.filter((r) => r.inaccessible);
  process.stdout.write(
    `probed ${results.length - failed.length}/${ids.length} models into ${workDir}/probe/` +
      (denied.length > 0 ? ` (${denied.length} inaccessible, HTTP 403)` : "") +
      "\n"
  );
  if (failed.length > 0)
    fail(`${failed.length} probes crashed: ${failed.map((r) => `${r.id}: ${r.error}`).join("; ")}`);
}

function isRejected(entry) {
  return Boolean(entry && entry.httpError);
}

function hasReasoning(entry) {
  return Boolean(entry && !entry.httpError && (entry.reasoningChars || 0) > 0);
}

function isAnthropicId(id) {
  return id.startsWith("anthropic/") || id.startsWith("claude");
}

const BUILD_HELP = `usage: setup-custom-inferences.js build --work-dir DIR --provider ID --base-url URL --key-env NAME [options]

Read probe/<model>.json results and write draft/pi.json (pi provider entry)
and draft/opencode.json (opencode provider entry). Pure function of the work
dir: merge-safe, writes drafts only, never touches live config.

  --name TEXT        provider display name (default: the provider id)
  --context-cap N    cap context windows at N tokens (default: advertised size)
  --max-tokens N     pi maxTokens and opencode limit.output (default 16384)
  --target T         pi | opencode | both (default both)
  --api A            ${APIS.join(" | ")} (default: the API probe recorded)
  --key-file PATH    opencode reads its key from {file:PATH} instead of env;
                     the file is never read or printed, only referenced`;

function cmdBuild(argv) {
  const { opts } = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(BUILD_HELP + "\n");
    return;
  }
  const workDir = need(opts, "work-dir", BUILD_HELP);
  const provider = need(opts, "provider", BUILD_HELP);
  const baseUrl = need(opts, "base-url", BUILD_HELP);
  const keyEnv = need(opts, "key-env", BUILD_HELP);
  const displayName = opts.name ? String(opts.name) : provider;
  const cap = opts["context-cap"] ? Number(opts["context-cap"]) : null;
  const maxTokens = Number(opts["max-tokens"] || 16384);
  const target = String(opts.target || "both");
  if (!["pi", "opencode", "both"].includes(target)) fail(`bad --target ${target}.\n\n${BUILD_HELP}`, 2);
  const keyFile = opts["key-file"] && opts["key-file"] !== "false" ? String(opts["key-file"]) : null;
  if (keyFile !== null && keyFile.length === 0) fail(`bad --key-file ${opts["key-file"]}.\n\n${BUILD_HELP}`, 2);

  const state = loadState(workDir);
  if (!state) fail(`no state.json in ${workDir}. Run probe first.`);
  let api = needApi(opts, BUILD_HELP);
  const stateApi = state.api && APIS.includes(state.api) ? state.api : null;
  if (api && stateApi && api !== stateApi)
    fail(`work dir was probed with ${stateApi}; re-probe or drop --api.`);
  api = api || stateApi;
  if (!api) fail("no API recorded in state.json (old work dir?). Re-probe; probe records --api in state.json.");
  const probeDir = path.join(workDir, "probe");
  const files = fs.existsSync(probeDir) ? fs.readdirSync(probeDir).filter((f) => f.endsWith(".json")) : [];
  if (files.length === 0) fail(`no probe results in ${probeDir}. Run probe first.`);
  const probes = files
    .map((f) => readJson(path.join(probeDir, f)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const warnings = [];
  const excluded = probes.filter((p) => p.inaccessible);
  for (const p of excluded)
    warnings.push(`${p.id}: inaccessible (${p.httpError || "HTTP 403"}), excluded from drafts`);
  const included = probes.filter((p) => !p.inaccessible);
  if (included.length === 0)
    fail(
      `all ${probes.length} probed models are inaccessible (HTTP 403). ` +
        "Fix key access, then re-probe; nothing to build."
    );

  // Model keys: short alias (text after the last /) unless two models share
  // it, then the full upstream id. opencode references read provider/key.
  const shorts = included.map((p) =>
    p.id.includes("/") ? p.id.slice(p.id.lastIndexOf("/") + 1) : p.id
  );
  const seen = {};
  for (const s of shorts) seen[s] = (seen[s] || 0) + 1;
  const collide = Object.values(seen).some((n) => n > 1);
  if (collide) warnings.push("short model aliases collide; model keys use full upstream ids");
  const keyOf = (p) =>
    collide ? p.id : p.id.includes("/") ? p.id.slice(p.id.lastIndexOf("/") + 1) : p.id;
  const shortOf = (p) => (p.id.includes("/") ? p.id.slice(p.id.lastIndexOf("/") + 1) : p.id);

  function addFields(total, entry) {
    const byField = (entry && entry.reasoningByField) || {};
    for (const f of REASON_FIELDS) total[f] = (total[f] || 0) + (byField[f] || 0);
  }
  function topField(total) {
    let best = null;
    for (const f of REASON_FIELDS)
      if ((total[f] || 0) > 0 && (best === null || total[f] > total[best])) best = f;
    return best;
  }
  const providerFieldTotal = {};
  const modelFieldOf = {};
  for (const p of included) {
    const total = {};
    addFields(total, p.off);
    for (const e of Object.values(p.levels || {})) addFields(total, e);
    addFields(total, p.effortNone);
    for (const e of Object.values(p.budgets || {})) addFields(total, e);
    for (const e of Object.values(p.efforts || {})) addFields(total, e);
    modelFieldOf[p.id] = topField(total);
    if (modelFieldOf[p.id]) addFields(providerFieldTotal, { reasoningByField: total });
  }
  const providerField = topField(providerFieldTotal);

  const piModels = [];
  const ocModels = {};
  const adaptiveOf = {};
  for (const p of included) {
    if (p.api && p.api !== api) {
      warnings.push(`${p.id}: probed with ${p.api}; re-probe with --api ${api} to include it`);
      continue;
    }
    if (api === "anthropic-messages") {
      buildAnthropic(p);
      continue;
    }
    if (api === "openai-responses") {
      buildResponses(p);
      continue;
    }
    const levelEntries = p.levels || {};
    const anyReasoning =
      hasReasoning(p.off) ||
      Object.values(levelEntries).some(hasReasoning) ||
      hasReasoning(p.effortNone);
    const reasoning = anyReasoning;
    const offWorks = reasoning && p.off && !p.off.httpError && (p.off.reasoningChars || 0) === 0;
    const short = shortOf(p);
    const contextWindow = Math.min(p.contextWindow || 128000, cap || Infinity);

    // Graded effort silently ignored: low and high both reason but with about
    // the same output, so the endpoint does not grade. Null every graded
    // level (only on/off stays meaningful); per-level rejection still applies.
    let effortIgnored = false;
    const lowEntry = levelEntries.low;
    const highEntry = levelEntries.high;
    if (
      lowEntry && highEntry &&
      !isRejected(lowEntry) && !isRejected(highEntry) &&
      (lowEntry.reasoningChars || 0) > 0 && (highEntry.reasoningChars || 0) > 0
    ) {
      const a = lowEntry.reasoningChars;
      const b = highEntry.reasoningChars;
      if (Math.abs(a - b) <= Math.max(32, 0.15 * Math.max(a, b))) effortIgnored = true;
    }

    if (reasoning) {
      const map = {};
      for (const level of Object.keys(levelEntries)) {
        const e = levelEntries[level];
        map[level] =
          !effortIgnored && !isRejected(e) && (e.reasoningChars || 0) > 0 ? level : null;
      }
      map.off = offWorks ? "none" : null;
      if (effortIgnored)
        warnings.push(
          `${p.id}: effort ignored (low ${lowEntry.reasoningChars} vs high ${highEntry.reasoningChars} chars); graded levels unsupported`
        );
      piModels.push({
        id: p.id,
        name: short,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
        reasoning: true,
        thinkingLevelMap: map,
      });
    } else {
      piModels.push({
        id: p.id,
        name: short,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
      });
    }

    // Request-body fields go in body (variant settings has no extraBody:
    // the schema forbids additional properties there). The explicit "none"
    // variant is what exposes the off switch on custom providers: opencode
    // 2.0.29 does not auto-add one from toggle alone ("Variant unavailable"
    // without it). No toggle key and no none variant means cannot turn off.
    const workingLevels = effortIgnored
      ? []
      : Object.entries(levelEntries)
          .filter(([, e]) => !isRejected(e) && (e.reasoningChars || 0) > 0)
          .map(([level]) => level);
    const variants = workingLevels.map((level) => ({
      id: level,
      body: { thinking: { type: "enabled" }, reasoning_effort: level },
    }));
    if (reasoning && offWorks)
      variants.push({ id: "none", body: { thinking: { type: "disabled" } } });
    const ocEntry = {
      modelID: p.id,
      name: short,
      limit: { context: contextWindow, output: maxTokens },
      capabilities: reasoning
        ? offWorks
          ? { tools: Boolean(p.tool && p.tool.called), reasoning: { supported: true, toggle: true, effort: workingLevels } }
          : { tools: Boolean(p.tool && p.tool.called), reasoning: { supported: true, effort: workingLevels } }
        : { tools: Boolean(p.tool && p.tool.called), reasoning: { supported: false } },
      variants,
    };
    if (modelFieldOf[p.id] && modelFieldOf[p.id] !== providerField) {
      ocEntry.compatibility = { reasoningField: modelFieldOf[p.id] };
    }
    if (isAnthropicId(p.id)) {
      ocEntry.compatibility = { ...(ocEntry.compatibility || {}), cacheFormat: "anthropic" };
    }
    ocModels[keyOf(p)] = ocEntry;

    if (p.tool && p.tool.httpError) warnings.push(`${p.id}: tool probe ${p.tool.httpError}`);
    if (p.replay && !p.replay.ok) warnings.push(`${p.id}: replay without reasoning_content ${p.replay.httpError}`);
    for (const [level, e] of Object.entries(levelEntries))
      if (isRejected(e)) warnings.push(`${p.id}: level ${level} rejected (${e.httpError})`);
  }

  function buildAnthropic(p) {
    const short = shortOf(p);
    const contextWindow = Math.min(p.contextWindow || 128000, cap || Infinity);
    const toolCalled = Boolean(p.tool && p.tool.called);
    const budgets = p.budgets || {};
    const efforts = p.efforts || {};
    const aWorks = (l) => { const e = efforts[l]; return Boolean(e && !e.httpError && (e.reasoningChars || 0) > 0); };
    const bWorks = (l) => { const e = budgets[l]; return Boolean(e && !e.httpError && (e.reasoningChars || 0) > 0); };
    const shape = LEVELS.some(aWorks)
      ? "adaptive"
      : ["minimal", "low", "medium", "high", "xhigh", "max"].some(bWorks) ? "budget" : null;
    adaptiveOf[p.id] = shape === "adaptive";
    const works = (l) => (shape === "adaptive" ? aWorks(l) : shape === "budget" ? bWorks(l) : false);
    const reasoning =
      hasReasoning(p.off) ||
      Object.values(budgets).some(hasReasoning) ||
      Object.values(efforts).some(hasReasoning);
    const offWorks = Boolean(reasoning && p.off && !p.off.httpError && (p.off.reasoningChars || 0) === 0);
    const effortIgnored = shape === "adaptive"
      ? ignoredEffort(efforts.low, efforts.high)
      : ignoredEffort(budgets.low, budgets.high);
    const workingLevels = effortIgnored ? [] : LEVELS.filter(works);
    const piEntry = {
      id: p.id,
      name: short,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
    };
    if (reasoning) {
      const map = {};
      for (const level of LEVELS) {
        if (effortIgnored || !works(level)) map[level] = null;
        else if (shape === "adaptive") map[level] = ADAPTIVE_EFFORT[level] || level;
        else map[level] = level; // budget-based: pi sends thinkingBudgets; the value only marks support
      }
      map.off = offWorks ? "none" : null;
      if (effortIgnored)
        warnings.push(`${p.id}: effort ignored (low vs high about equal); graded levels unsupported`);
      piEntry.reasoning = true;
      piEntry.thinkingLevelMap = map;
    }
    const mCompat = {};
    if (shape === "adaptive") mCompat.forceAdaptiveThinking = true;
    if (p.emptySig && p.emptySig.ok) mCompat.allowEmptySignature = true;
    if (Object.keys(mCompat).length > 0) piEntry.compat = mCompat;
    piModels.push(piEntry);
    const variants = workingLevels.map((level) =>
      shape === "adaptive"
        ? { id: level, body: { thinking: { type: "adaptive" }, output_config: { effort: ADAPTIVE_EFFORT[level] || level } } }
        : { id: level, body: { thinking: { type: "enabled", budget_tokens: ANTHROPIC_BUDGETS[level] ?? ANTHROPIC_BUDGETS.high } } }
    );
    if (reasoning && offWorks)
      variants.push({ id: "none", body: { thinking: { type: "disabled" } } });
    const ocEntry = {
      modelID: p.id,
      name: short,
      limit: { context: contextWindow, output: maxTokens },
      capabilities: reasoning
        ? offWorks
          ? { tools: toolCalled, reasoning: { supported: true, toggle: true, effort: workingLevels } }
          : { tools: toolCalled, reasoning: { supported: true, effort: workingLevels } }
        : { tools: toolCalled, reasoning: { supported: false } },
      variants,
    };
    if (modelFieldOf[p.id] && modelFieldOf[p.id] !== providerField)
      ocEntry.compatibility = { reasoningField: modelFieldOf[p.id] };
    ocModels[keyOf(p)] = ocEntry;
    if (p.tool && p.tool.httpError) warnings.push(`${p.id}: tool probe ${p.tool.httpError}`);
    if (p.replayPlain && !p.replayPlain.ok) warnings.push(`${p.id}: plain replay ${p.replayPlain.httpError}`);
    if (p.replayThinking && !p.replayThinking.ok)
      warnings.push(`${p.id}: thinking-history replay ${p.replayThinking.httpError}`);
    for (const [level, e] of [...Object.entries(budgets), ...Object.entries(efforts)])
      if (isRejected(e)) warnings.push(`${p.id}: ${level} rejected (${e.httpError})`);
  }

  function buildResponses(p) {
    const levelEntries = p.levels || {};
    const short = shortOf(p);
    const contextWindow = Math.min(p.contextWindow || 128000, cap || Infinity);
    const toolCalled = Boolean(p.tool && p.tool.called);
    // Off means omitting reasoning; pi off sends effort "none", so pi needs
    // BOTH to disable. opencode off omits reasoning, so omission suffices.
    const omitWorks = Boolean(p.off && !p.off.httpError && (p.off.reasoningChars || 0) === 0);
    const noneDisables = Boolean(p.effortNone && !p.effortNone.httpError && (p.effortNone.reasoningChars || 0) === 0);
    const reasoning =
      hasReasoning(p.off) ||
      Object.values(levelEntries).some(hasReasoning) ||
      hasReasoning(p.effortNone);
    const piOff = Boolean(reasoning && omitWorks && noneDisables);
    const toggleWorks = Boolean(reasoning && omitWorks);
    let effortIgnored = false;
    const lowEntry = levelEntries.low;
    const highEntry = levelEntries.high;
    if (ignoredEffort(lowEntry, highEntry)) effortIgnored = true;
    const workingLevels = effortIgnored
      ? []
      : Object.entries(levelEntries)
          .filter(([, e]) => !isRejected(e) && (e.reasoningChars || 0) > 0)
          .map(([level]) => level);
    const piEntry = {
      id: p.id,
      name: short,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
    };
    if (reasoning) {
      const map = {};
      for (const level of Object.keys(levelEntries)) {
        const e = levelEntries[level];
        map[level] =
          !effortIgnored && !isRejected(e) && (e.reasoningChars || 0) > 0 ? level : null;
      }
      map.off = piOff ? "none" : null;
      if (effortIgnored)
        warnings.push(
          `${p.id}: effort ignored (low ${lowEntry.reasoningChars} vs high ${highEntry.reasoningChars} chars); graded levels unsupported`
        );
      piEntry.reasoning = true;
      piEntry.thinkingLevelMap = map;
    }
    piModels.push(piEntry);
    const variants = workingLevels.map((level) => ({
      id: level,
      body: { reasoning: { effort: level, summary: "auto" } },
    }));
    if (toggleWorks)
      variants.push({ id: "none", body: noneDisables ? { reasoning: { effort: "none" } } : {} });
    const ocEntry = {
      modelID: p.id,
      name: short,
      limit: { context: contextWindow, output: maxTokens },
      capabilities: reasoning
        ? toggleWorks
          ? { tools: toolCalled, reasoning: { supported: true, toggle: true, effort: workingLevels } }
          : { tools: toolCalled, reasoning: { supported: true, effort: workingLevels } }
        : { tools: toolCalled, reasoning: { supported: false } },
      variants,
    };
    if (modelFieldOf[p.id] && modelFieldOf[p.id] !== providerField)
      ocEntry.compatibility = { reasoningField: modelFieldOf[p.id] };
    ocModels[keyOf(p)] = ocEntry;
    if (p.tool && p.tool.httpError) warnings.push(`${p.id}: tool probe ${p.tool.httpError}`);
    if (p.replayFull && !p.replayFull.ok) warnings.push(`${p.id}: full-input replay ${p.replayFull.httpError}`);
    if (p.replayPrevId && !p.replayPrevId.ok)
      warnings.push(`${p.id}: previous_response_id replay ${p.replayPrevId.httpError}`);
    for (const [level, e] of Object.entries(levelEntries))
      if (isRejected(e)) warnings.push(`${p.id}: level ${level} rejected (${e.httpError})`);
    if (p.effortNone && isRejected(p.effortNone))
      warnings.push(`${p.id}: effort none rejected (${p.effortNone.httpError})`);
  }

  const compatProbe = state.compat || {};
  const headerEnvs = state.headerEnvs || {};
  const extraPiHeaders = {};
  for (const [h, e] of Object.entries(headerEnvs)) extraPiHeaders[h] = `$${e}`;
  const extraOcHeaders = {};
  for (const [h, e] of Object.entries(headerEnvs)) extraOcHeaders[h] = `{env:${e}}`;
  const compat = {};
  if (api === "anthropic-messages") {
    // forceAdaptiveThinking provider-level only when every reasoning model
    // is adaptive; mixed providers keep it per model (set in buildAnthropic).
    const reasoners = included.filter((p) => piModels.some((m) => m.id === p.id && m.reasoning));
    if (reasoners.length > 0 && reasoners.every((p) => adaptiveOf[p.id])) {
      compat.forceAdaptiveThinking = true;
      for (const m of piModels) {
        if (m.compat && m.compat.forceAdaptiveThinking && Object.keys(m.compat).length === 1) delete m.compat;
        else if (m.compat) delete m.compat.forceAdaptiveThinking;
      }
    }
  } else if (api === "openai-responses") {
    if (included.some((p) => Object.values(p.levels || {}).some(hasReasoning)))
      compat.supportsReasoningEffort = true;
    else compat.supportsReasoningEffort = false;
    if (compatProbe.developerRole) compat.supportsDeveloperRole = Boolean(compatProbe.developerRole.ok);
    if (compatProbe.maxOutputTokens && compatProbe.maxOutputTokens.ok) {
      // Native max_output_tokens works: nothing to set (pi default).
    } else if (compatProbe.maxTokens && compatProbe.maxTokens.ok) {
      compat.supportsMaxOutputTokens = false;
      compat.maxTokensField = "max_tokens";
    }
  } else {
    // Decide the wire shape from models where both the off and the
    // effort-none probes are clean (HTTP 2xx), so one always-reasoning model
    // cannot veto the provider-level finding. Per-model differences stay in
    // thinkingLevelMap.
    const clean = included.filter(
      (p) => p.off && !p.off.httpError && p.effortNone && !p.effortNone.httpError
    );
    const deepseekEvidence = clean.some(
      (p) => (p.off.reasoningChars || 0) === 0 && (p.effortNone.reasoningChars || 0) > 0
    );
    const openaiEvidence =
      clean.some((p) => (p.effortNone.reasoningChars || 0) === 0) &&
      included.some((p) => Object.values(p.levels || {}).some(hasReasoning));
    if (deepseekEvidence) {
      compat.thinkingFormat = "deepseek";
      compat.supportsReasoningEffort = true;
    } else if (openaiEvidence) {
      compat.supportsReasoningEffort = true;
    } else {
      compat.supportsReasoningEffort = included.some((p) =>
        Object.values(p.levels || {}).some(hasReasoning)
      );
    }
    if (compatProbe.developerRole) compat.supportsDeveloperRole = Boolean(compatProbe.developerRole.ok);
    if (compatProbe.maxTokens && !compatProbe.maxTokens.ok && compatProbe.maxCompletionTokens && compatProbe.maxCompletionTokens.ok)
      compat.maxTokensField = "max_completion_tokens";
  }

  // opencode provider-level compatibility: only what the probes decided.
  // cacheFormat anthropic covers Claude served through an OpenAI-style
  // proxy, and only when every included model id looks like Claude; mixed
  // providers get it per model instead. Never for native anthropic-messages.
  const ocCompat = {};
  if (providerField) ocCompat.reasoningField = providerField;
  if (compat.maxTokensField) ocCompat.maxTokensField = compat.maxTokensField;
  if (api !== "anthropic-messages" && included.every((p) => isAnthropicId(p.id)))
    ocCompat.cacheFormat = "anthropic";

  const ocHeaders = Object.keys(extraOcHeaders).length > 0 ? { headers: extraOcHeaders } : {};
  // opencode's anthropic package appends /messages itself, so its baseURL
  // carries the /v1 root; probe and pi use the host root.
  const ocBaseUrl = api === "anthropic-messages"
    ? baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1"
    : baseUrl;
  if (target === "pi" || target === "both") {
    const piProvider =
      api === "anthropic-messages"
        ? {
            name: displayName,
            baseUrl,
            api,
            headers: {
              "x-api-key": `$${keyEnv}`,
              "anthropic-version": ANTHROPIC_VERSION,
              ...extraPiHeaders,
            },
            compat,
            models: piModels,
          }
        : {
            name: displayName,
            baseUrl,
            api,
            authHeader: true,
            apiKey: `$${keyEnv}`,
            ...(Object.keys(extraPiHeaders).length > 0 ? { headers: extraPiHeaders } : {}),
            compat,
            models: piModels,
          };
    writeJson(path.join(workDir, "draft", "pi.json"), { providers: { [provider]: piProvider } });
  }
  if (target === "opencode" || target === "both")
    writeJson(path.join(workDir, "draft", "opencode.json"), {
      $schema: "https://opencode.ai/config.json",
      providers: {
        [provider]: {
          name: displayName,
          ...(keyFile ? {} : { env: [keyEnv] }),
          package: OC_PACKAGE[api],
          settings: keyFile
            ? { baseURL: ocBaseUrl, apiKey: `{file:${keyFile}}` }
            : { baseURL: ocBaseUrl },
          ...ocHeaders,
          ...(Object.keys(ocCompat).length > 0 ? { compatibility: ocCompat } : {}),
          models: ocModels,
        },
      },
    });

  state.step = "built";
  state.warnings = warnings;
  saveState(workDir, state);
  process.stdout.write(
    `built ${piModels.length} pi models and ${Object.keys(ocModels).length} opencode models into ${workDir}/draft/\n`
  );
  for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
}

const APPLY_HELP = `usage: setup-custom-inferences.js apply --draft FILE --target FILE --provider ID [--as-settings --model MID]

Back up FILE to FILE.bak-<timestamp>, then merge one provider entry.
Default: copy draft providers.ID into target providers.ID, keeping every
other provider. With --as-settings: set defaultProvider/defaultModel in a
pi settings.json instead (draft is still required for --provider).`;

function cmdApply(argv) {
  const { opts } = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(APPLY_HELP + "\n");
    return;
  }
  const draftFile = need(opts, "draft", APPLY_HELP);
  const targetFile = need(opts, "target", APPLY_HELP);
  const provider = need(opts, "provider", APPLY_HELP);
  const asSettings = Boolean(opts["as-settings"]) && opts["as-settings"] !== "false";
  if (!fs.existsSync(targetFile)) fail(`target ${targetFile} does not exist. Refusing to create config from scratch.`);
  const draft = readJson(draftFile);
  const target = readJson(targetFile);
  const backup = `${targetFile}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(targetFile, backup);
  if (asSettings) {
    const model = need(opts, "model", APPLY_HELP);
    target.defaultProvider = provider;
    target.defaultModel = model;
  } else {
    const entry = draft.providers && draft.providers[provider];
    if (!entry) fail(`draft ${draftFile} has no providers.${provider}.`);
    target.providers = target.providers || {};
    target.providers[provider] = entry;
  }
  fs.writeFileSync(targetFile, JSON.stringify(target, null, 2) + "\n");
  process.stdout.write(`backup ${backup}\nmerged providers.${provider} into ${targetFile}\n`);
}

const TOP_HELP = `setup-custom-inferences.js probe | build | apply

probe: enumerate the provider's models and probe each one's capabilities.
build: probe results -> draft pi + opencode provider entries.
apply: back up a live config file, then merge one provider entry.

Run with --help after a command for its options. Exit codes: 0 done,
1 the request failed, 2 wrong usage.`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "probe") return cmdProbe(rest);
  if (cmd === "build") return cmdBuild(rest);
  if (cmd === "apply") return cmdApply(rest);
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    process.stdout.write(TOP_HELP + "\n");
    return;
  }
  fail(`unknown command ${cmd}.\n\n${TOP_HELP}`, 2);
}

const invoked =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main().catch((err) => fail(err && err.message ? err.message : String(err)));
