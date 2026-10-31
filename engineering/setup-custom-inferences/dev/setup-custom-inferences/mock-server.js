// Mock OpenAI-compatible server for setup-custom-inferences development.
// Serves GET /models and POST /chat/completions (streaming and plain) with
// per-model behaviors that exercise every probe decision. Development only:
// never pointed at by SKILL.md, never run against a real endpoint.
import http from "node:http";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const eq = argv[i].indexOf("=");
      if (eq === -1) opts[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      else opts[argv[i].slice(2, eq)] = argv[i].slice(eq + 1);
    }
  }
  return { opts };
}

const MODELS = [
  { id: "reason/think-on", context_window: 200000, kind: "deepseek", api: "c" },
  { id: "reason/always", context_window: 200000, kind: "always", api: "c" },
  { id: "plain/no-reason", context_window: 64000, kind: "plain", api: "c" },
  { id: "reason/text-field", context_window: 128000, kind: "textfield", api: "c" },
  { id: "strict/history", context_window: 96000, kind: "history", api: "c" },
  { id: "flat/effort", context_window: 128000, kind: "flat", api: "c" },
  { id: "denied/gated", context_window: 128000, kind: "deepseek", api: "c" },
  { id: "x/same", context_window: 64000, kind: "deepseek", api: "c" },
  { id: "y/same", context_window: 64000, kind: "plain", api: "c" },
  { id: "resp/think", context_window: 200000, kind: "deepseek", api: "r" },
  { id: "resp/always", context_window: 200000, kind: "always", api: "r" },
  { id: "resp/flat", context_window: 128000, kind: "flat", api: "r" },
  { id: "resp/gated", context_window: 128000, kind: "deepseek", api: "r" },
  { id: "anth/think", context_window: 200000, kind: "budget", api: "a" },
  { id: "anth/fluent", context_window: 200000, kind: "adaptive", api: "a" },
  { id: "anth/picky", context_window: 96000, kind: "budget-history", api: "a" },
  { id: "anth/stubborn", context_window: 128000, kind: "always", api: "a" },
  { id: "anth/gated", context_window: 128000, kind: "budget", api: "a" },
  { id: "junk/", context_window: 1000, kind: "plain", api: "c" },
];

const RESP_SIZE = { minimal: 24, low: 44, medium: 64, high: 84, xhigh: 104, max: 124 };
const TIER_SIZE = { 1024: 24, 2048: 44, 8192: 64, 16384: 84 };
const ADAPT_SIZE = { low: 44, medium: 64, high: 84, max: 124 };

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function handleChat(body, res) {
  if (String(body.model || "").startsWith("denied/"))
    return sendJson(res, 403, { error: "forbidden: key may not access this model" });
  const model = MODELS.find((m) => m.id === body.model && m.api === "c");
  if (!model) return sendJson(res, 404, { error: `unknown model ${body.model} for chat/completions` });
  if (body.reasoning_effort === "bogus")
    return sendJson(res, 400, { error: "invalid reasoning_effort" });
  if ((model.kind === "deepseek" || model.kind === "textfield") &&
      (body.reasoning_effort === "xhigh" || body.reasoning_effort === "max"))
    return sendJson(res, 400, { error: "unsupported reasoning_effort" });
  if (Array.isArray(body.messages) && body.messages.some((m) => m.role === "developer"))
    return sendJson(res, 400, { error: "developer role not supported" });
  if (Array.isArray(body.messages) && body.messages.length === 3 && model.kind === "history")
    return sendJson(res, 400, { error: "multi-turn replay rejected" });
  // Graded levels produce graded output; flat ignores effort (same always).
  const LEVEL_SIZE = { minimal: 24, low: 44, medium: 64, high: 84, xhigh: 104, max: 124, none: 84 };
  const size = LEVEL_SIZE[body.reasoning_effort] ?? 44;
  if (model.kind === "plain")
    return finish(res, body, { reasoning: 0, tools: false });
  if (model.kind === "history")
    return finish(res, body, { reasoning: size, tools: true });
  const disabled = body.thinking && body.thinking.type === "disabled";
  // flat: graded effort is silently ignored (HTTP 200, same output always).
  if (model.kind === "flat")
    return disabled ? finish(res, body, { reasoning: 0, tools: true }) : finish(res, body, { reasoning: 44, tools: true });
  if (model.kind === "always")
    return finish(res, body, { reasoning: size, tools: true, field: "reasoning" });
  if (disabled) return finish(res, body, { reasoning: 0, tools: true });
  if (model.kind === "textfield")
    return finish(res, body, { reasoning: size, tools: true, field: "reasoning_text" });
  return finish(res, body, { reasoning: size, tools: true });
}

function finish(res, body, { reasoning, tools, field = "reasoning_content" }) {
  // Only answer the probe's own get_weather tool. Unknown tool lists (for
  // example an agent harness sending its own tools) get plain content.
  const wantsTools =
    Array.isArray(body.tools) &&
    body.tools.some((t) => t && t.function && t.function.name === "get_weather");
  if (body.stream) {
    const chunks = [];
    if (reasoning > 0) {
      chunks.push({ choices: [{ delta: { [field]: "r".repeat(reasoning) } }] });
      chunks.push({ choices: [{ delta: { [field]: "more" } }] });
    }
    if (wantsTools && tools)
      chunks.push({ choices: [{ delta: { tool_calls: [{ id: "call_1", function: { name: "get_weather", arguments: "{}" } }] } }] });
    else chunks.push({ choices: [{ delta: { content: "ok" } }] });
    return sse(res, chunks);
  }
  const message = { role: "assistant", content: "ok" };
  if (wantsTools && tools)
    message.tool_calls = [{ id: "call_1", function: { name: "get_weather", arguments: "{}" } }];
  return sendJson(res, 200, { choices: [{ message }], usage: { prompt_tokens: 5, completion_tokens: 10 } });
}

function wantsWeatherTools(tools) {
  return (
    Array.isArray(tools) &&
    tools.some((t) => t && ((t.function && t.function.name === "get_weather") || t.name === "get_weather"))
  );
}

// POST /responses. Stream events: response.reasoning_summary_text.delta,
// response.output_text.delta, response.function_call_arguments.delta.
function handleResponses(body, res) {
  const id = String(body.model || "");
  if (id.endsWith("/gated")) return sendJson(res, 403, { error: "forbidden" });
  const model = MODELS.find((m) => m.id === id && m.api === "r");
  if (!model) return sendJson(res, 404, { error: `unknown model ${id} for responses` });
  const items = Array.isArray(body.input) ? body.input : [];
  if (items.some((i) => i && (i.role === "developer" || i.type === "developer")))
    return sendJson(res, 400, { error: "developer role not supported" });
  const effort = body.reasoning ? body.reasoning.effort : undefined;
  if (effort === "bogus") return sendJson(res, 400, { error: "invalid reasoning effort" });
  if (model.kind === "deepseek" && (effort === "xhigh" || effort === "max"))
    return sendJson(res, 400, { error: "unsupported reasoning effort" });
  let size;
  if (model.kind === "always") size = 44;
  else if (model.kind === "flat") size = effort === undefined ? 0 : 44;
  else if (effort === undefined || effort === "none") size = 0;
  else size = RESP_SIZE[effort] ?? 44;
  const tools = wantsWeatherTools(body.tools) && model.kind !== "plain";
  const echo = `ok effort=${effort ?? "off"}`;
  if (body.stream) {
    const chunks = [];
    let n = 0;
    if (size > 0) {
      chunks.push({ type: "response.output_item.added", sequence_number: n++, output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } });
      chunks.push({ type: "response.reasoning_summary_part.added", sequence_number: n++, item_id: "rs_1", summary_index: 0, part: { type: "summary_text", text: "" } });
      chunks.push({ type: "response.reasoning_summary_text.delta", sequence_number: n++, item_id: "rs_1", output_index: 0, summary_index: 0, delta: "r".repeat(size) });
      chunks.push({ type: "response.reasoning_summary_text.delta", sequence_number: n++, item_id: "rs_1", output_index: 0, summary_index: 0, delta: "more" });
      chunks.push({ type: "response.reasoning_summary_part.done", sequence_number: n++, item_id: "rs_1", output_index: 0, summary_index: 0, part: { type: "summary_text", text: "r".repeat(size) + "more" } });
      chunks.push({ type: "response.output_item.done", sequence_number: n++, output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "r".repeat(size) + "more" }] } });
    }
    if (tools) {
      chunks.push({ type: "response.output_item.added", sequence_number: n++, output_index: size > 0 ? 1 : 0, item: { id: "fc_1", type: "function_call", call_id: "fc_1", name: "get_weather", arguments: "" } });
      chunks.push({ type: "response.function_call_arguments.delta", sequence_number: n++, item_id: "fc_1", output_index: size > 0 ? 1 : 0, delta: "{}" });
      chunks.push({ type: "response.output_item.done", sequence_number: n++, output_index: size > 0 ? 1 : 0, item: { id: "fc_1", type: "function_call", call_id: "fc_1", name: "get_weather", arguments: "{}" } });
    } else {
      const oi = size > 0 ? 1 : 0;
      chunks.push({ type: "response.output_item.added", sequence_number: n++, output_index: oi, item: { id: "m_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] } });
      chunks.push({ type: "response.output_text.delta", sequence_number: n++, item_id: "m_1", output_index: oi, content_index: 0, delta: echo });
      chunks.push({ type: "response.output_text.done", sequence_number: n++, item_id: "m_1", output_index: oi, content_index: 0, text: echo });
      chunks.push({ type: "response.output_item.done", sequence_number: n++, output_index: oi, item: { id: "m_1", type: "message", role: "assistant", content: [{ type: "output_text", text: echo }] } });
    }
    chunks.push({ type: "response.completed", sequence_number: n++, response: { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 5, output_tokens: 10 } } });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  const output = [];
  if (size > 0) output.push({ type: "reasoning", summary: [{ type: "summary_text", text: "r".repeat(size) }] });
  if (tools) output.push({ type: "function_call", call_id: "fc_1", name: "get_weather", arguments: "{}" });
  else output.push({ type: "message", content: [{ type: "output_text", text: echo }] });
  return sendJson(res, 200, { id: "resp_1", status: "completed", output, usage: { input_tokens: 5, output_tokens: 10 } });
}

// POST /v1/messages. Stream deltas: thinking_delta, text_delta,
// signature_delta; tool_use blocks for tools. Thinking history with a
// missing or empty signature is rejected by picky models.
function handleMessages(body, res) {
  const id = String(body.model || "");
  if (id.endsWith("/gated")) return sendJson(res, 403, { error: "forbidden" });
  const model = MODELS.find((m) => m.id === id && m.api === "a");
  if (!model) return sendJson(res, 404, { error: `unknown model ${id} for messages` });
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.some((m) => m && m.role !== "user" && m.role !== "assistant"))
    return sendJson(res, 400, { error: "role must be user or assistant" });
  // Strict endpoints (budget-history) reject any replayed thinking block;
  // lenient ones accept it with or without a signature.
  for (const m of messages) {
    if (m && m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === "thinking" && model.kind === "budget-history")
          return sendJson(res, 400, { error: "thinking history needs a signature" });
      }
    }
  }
  const th = body.thinking || {};
  let size = 0;
  let echo = "ok off";
  if (th.type === "adaptive") {
    const effort = body.output_config && body.output_config.effort;
    if (model.kind !== "adaptive" || ADAPT_SIZE[effort] === undefined)
      return sendJson(res, 400, { error: "adaptive effort not supported" });
    size = ADAPT_SIZE[effort];
    echo = `ok effort=${effort}`;
  } else if (th.type === "enabled") {
    if (model.kind === "adaptive" || TIER_SIZE[th.budget_tokens] === undefined)
      return sendJson(res, 400, { error: "budget_tokens not supported" });
    size = TIER_SIZE[th.budget_tokens];
    echo = `ok budget=${th.budget_tokens}`;
  } else if (th.type !== undefined && th.type !== "disabled") {
    return sendJson(res, 400, { error: "unknown thinking type" });
  }
  if (model.kind === "always" && size === 0) {
    size = 44;
    echo = "ok always";
  }
  const tools = wantsWeatherTools(body.tools);
  if (body.stream) {
    const wire = [];
    const put = (event, data) => wire.push({ event, data });
    put("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: id, stop_reason: null, usage: { input_tokens: 5, output_tokens: 10 } } });
    let index = 0;
    if (size > 0) {
      put("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      put("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: "t".repeat(size) } });
      put("content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } });
      put("content_block_stop", { type: "content_block_stop", index });
      index++;
    }
    if (tools) {
      put("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: "tu_1", name: "get_weather", input: {} } });
      put("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: "{}" } });
      put("content_block_stop", { type: "content_block_stop", index });
      index++;
    } else {
      put("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      put("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: echo } });
      put("content_block_stop", { type: "content_block_stop", index });
      index++;
    }
    put("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { input_tokens: 5, output_tokens: 10 } });
    put("message_stop", { type: "message_stop" });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const w of wire) {
      res.write(`event: ${w.event}\n`);
      res.write(`data: ${JSON.stringify(w.data)}\n\n`);
    }
    return res.end();
  }
  const content = [];
  if (size > 0) content.push({ type: "thinking", thinking: "t".repeat(size), signature: "sig" });
  if (tools) content.push({ type: "tool_use", id: "tu_1", name: "get_weather", input: {} });
  else content.push({ type: "text", text: echo });
  return sendJson(res, 200, { id: "msg_1", content, stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 10 } });
}

export function startMock() {
  const server = http.createServer((req, res) => {
    if (!req.headers.authorization && !req.headers["x-api-key"])
      return sendJson(res, 401, { error: "missing auth" });
    if (req.method === "GET" && req.url === "/models")
      return sendJson(res, 200, { data: MODELS.filter((m) => m.api !== "a" && !m.id.endsWith("/")).map(({ id, context_window }) => ({ id, context_window, object: "model" })) });
    if (req.method === "GET" && req.url === "/v1/models")
      return sendJson(res, 200, { data: MODELS.filter((m) => m.api === "a").map(({ id, context_window }) => ({ id, context_window, object: "model" })) });
    if (req.method === "POST" && ["/chat/completions", "/responses", "/v1/messages"].includes(req.url)) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          const body = JSON.parse(raw);
          if (req.url === "/responses") handleResponses(body, res);
          else if (req.url === "/v1/messages") handleMessages(body, res);
          else handleChat(body, res);
        } catch {
          sendJson(res, 400, { error: "bad json" });
        }
      });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  return server;
}

const { opts } = parseArgs(process.argv.slice(2));
if (process.argv[1] && process.argv[1].endsWith("mock-server.js")) {
  const port = Number(opts.port || 0);
  const server = startMock();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`mock ${server.address().port}\n`);
  });
}
