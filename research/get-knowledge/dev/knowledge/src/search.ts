// Web search through Exa, Keenable and Parallel, each falling back to the next at its limit.

import { type Keys, type Provider, Problem, isRecord, note, quoteAll, splitLines, squeeze } from "./core";
import { type Answer, PLAIN_AGENT, httpRequest } from "./http";

/** The services asked. The tests point them at a server on this machine. */
export const endpoints = {
  exaMcp: "https://mcp.exa.ai/mcp",
  exaRest: "https://api.exa.ai/search",
  keenable: "https://api.keenable.ai/v1/search",
  keenablePublic: "https://api.keenable.ai/v1/search/public",
  parallel: "https://api.parallel.ai/v1/search",
  parallelMcp: "https://search.parallel.ai/mcp",
};
const KEENABLE_TITLE = "get-knowledge";
const PARALLEL_MODE = "advanced";
const PARALLEL_QUERY_CHARS = 200;
const PARALLEL_OBJECTIVE_CHARS = 5000;
export const NO_RESULTS = "No search results found. Please try a different query.";
export const LABELS: Record<Provider, string> = { exa: "Exa", keenable: "Keenable", parallel: "Parallel" };

const BEEN = String.raw`(?:(?:has|have|is|are|was|were)\s+(?:been\s+)?)?`;
const CREDIT_GONE = [
  String.raw`\b(?:insufficient|out\s+of)\s+(?:credits?|quota)\b`,
  String.raw`\bno\s+(?:more\s+)?(?:credits?|quota)\b(?!\s+` +
    BEEN +
    String.raw`(?:required|configured|needed|requested|necessary|spent|used|consumed)\b)`,
  String.raw`\b(?:credit|credits|quota|budget)\s+(?:exhaustion|depletion)\b`,
  String.raw`\b(?:credits?|quota|budget)(?:\s+(?:limit|budget))?\s+` +
    BEEN +
    String.raw`(?:exhausted|depleted|unavailable|used\s+up|run\s+out|ran\s+out)\b`,
].map((pattern) => new RegExp(pattern));
const THROTTLED =
  String.raw`requests?\s+(?:(?:has|have|is|are|was|were)\s+)?(?:currently\s+)?` +
  String.raw`(?:been\s+|being\s+)?throttl(?:ed|ing)`;
const LIMIT_HIT = CREDIT_GONE.concat(
  [
    String.raw`\brate\s+limit(?:ed|ing)?\b`,
    String.raw`\btoo\s+many\s+requests?\b`,
    String.raw`\b(?:request|requests|usage|monthly|team|account|api\s+key)\s+` +
      BEEN +
      String.raw`limit\s+(?:exceeded|exhausted|depleted|reached|hit)\b`,
    String.raw`\b(?:quota|credit|credits|budget)(?:\s+(?:limit|budget))?\s+` +
      BEEN +
      String.raw`(?:exceeded|reached|hit)\b`,
    String.raw`\b` + THROTTLED + String.raw`\b`,
  ].map((pattern) => new RegExp(pattern)),
);
const NOT_A_LIMIT = new RegExp(
  String.raw`\b(?:not|never)\s+(?:(?:currently|actually|yet)\s+)?(?:out\s+of\s+(?:credits?|quota)|` +
    String.raw`too\s+many\s+requests?|(?:rate\s+)?limit(?:ed|ing)?|(?:credits?|quota|budget)\s+` +
    String.raw`(?:exceeded|exhausted|depleted|unavailable|reached|hit|used\s+up|ran\s+out)|` +
    THROTTLED +
    String.raw`)\b`,
);

export class ProviderError extends Problem {
  constructor(
    message: string,
    readonly limit = false,
  ) {
    super(message);
  }
}

/** Whether a failure says the provider's rate, quota or credit ran out. Only then is
 * the next provider tried. */
export function isLimit(status: number | null = null, message = "", tag = "") {
  if (status === 429) return true;
  if ([400, 401, 403, 422].includes(status ?? 0) || (status !== null && 500 <= status && status < 600)) {
    return false;
  }
  const text = `${tag || ""} ${message || ""}`.toLowerCase().replace(/[_-]+/g, " ");
  if (text.includes("payment required") || NOT_A_LIMIT.test(text)) return false;
  return (status === 402 ? CREDIT_GONE : LIMIT_HIT).some((pattern) => pattern.test(text));
}

export type Result = { title: string; url: string; published?: string; author?: string; snippet?: string };
export type Found = { results: Result[]; text: string };
export type Request = {
  query: string;
  numResults: number;
  type: string;
  livecrawl: string;
  contextMaxCharacters: number | null;
};

const record = (value: unknown): Record<string, any> => (isRecord(value) ? value : {});

function words(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "N/A" ? "" : text;
}

/** [message, tag] of an error body. */
function errorOf(parsed: Record<string, any>): [string, string] {
  const raw = parsed.error;
  const messages: string[] = [];
  if (typeof raw === "string" && raw.trim()) messages.push(raw.trim());
  const inner = record(raw).message;
  if (typeof inner === "string" && inner.trim()) messages.push(inner.trim());
  const top = parsed.message;
  if (typeof top === "string" && top.trim() && !messages.includes(top.trim())) messages.push(top.trim());
  const tags = [parsed.tag, record(raw).tag, record(record(raw).data).tag, record(parsed.data).tag];
  const tag = tags.find((item) => typeof item === "string" && item.trim());
  return [messages.join(": "), tag ? tag.trim() : ""];
}

function loadJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function httpFailure(response: Answer) {
  const [message, tag] = errorOf(record(loadJson(response.text())));
  let detail = `HTTP ${response.status}: ${response.reason || "Request failed"}`;
  if (message) detail += ` (${message.slice(0, 200)})`;
  return new ProviderError(detail, isLimit(response.status, message, tag));
}

function normalize(
  items: unknown[],
  limit: number,
  publishedKey: string,
  snippetOf: (item: Record<string, any>) => string,
) {
  const results: Result[] = [];
  for (const entry of items) {
    const item = record(entry);
    const url = words(item.url);
    if (!url) continue;
    const result: Result = { title: words(item.title) || url, url };
    const published = words(item[publishedKey]);
    const author = words(item.author);
    const snippet = snippetOf(item);
    if (published) result.published = published;
    if (author) result.author = author;
    if (snippet) result.snippet = snippet;
    results.push(result);
  }
  return results.slice(0, limit);
}

function exaSnippet(item: Record<string, any>) {
  const highlights = item.highlights;
  if (Array.isArray(highlights)) {
    const joined = highlights.map(words).filter(Boolean).join("\n\n");
    if (joined) return joined;
  }
  return words(highlights) || words(item.summary) || words(item.text);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  deadline: number,
  limit: number,
) {
  const merged = { ...headers, "Content-Type": "application/json", "User-Agent": PLAIN_AGENT };
  const response = await httpRequest("POST", url, merged, JSON.stringify(payload), deadline, limit, [429]);
  if (!response.ok) throw httpFailure(response);
  return response.text();
}

/** The results of a JSON answer that lists them under `results`. */
function answered(body: string, resultsFrom: (items: unknown[]) => Result[]): Found {
  const parsed = loadJson(body);
  if (!isRecord(parsed)) throw new ProviderError("Malformed search response body");
  const [message, tag] = errorOf(parsed);
  if (message || tag) {
    throw new ProviderError(`Search request failed: ${message || tag}`, isLimit(null, message, tag));
  }
  if (!Array.isArray(parsed.results)) throw new ProviderError("Malformed search response body");
  return { results: resultsFrom(parsed.results), text: "" };
}

async function searchExaRest(request: Request, deadline: number, limit: number, key: string) {
  const contents: Record<string, unknown> = { highlights: true };
  if (request.contextMaxCharacters) {
    contents.highlights = { query: request.query, maxCharacters: request.contextMaxCharacters };
  }
  if (request.livecrawl === "preferred") contents.maxAgeHours = 0;
  const payload = {
    query: request.query,
    type: request.type,
    numResults: request.numResults,
    stream: false,
    contents,
  };
  const headers = { Accept: "application/json", Authorization: `Bearer ${key}` };
  const body = await postJson(endpoints.exaRest, headers, payload, deadline, limit);
  return answered(body, (items) => normalize(items, request.numResults, "publishedDate", exaSnippet));
}

/** The results in the text an Exa MCP call answers with. */
function exaTextResults(text: string, limit: number) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const results: Result[] = [];
  for (const section of normalized.split(/\n{2,}---\n{2,}(?=Title:\s*)/)) {
    const lines = section.trim().split("\n");
    if (!lines[0]!.startsWith("Title:")) continue;
    const value = (label: string) => {
      const line = lines.find((entry) => entry.startsWith(label + ":")) ?? "";
      return words(line.slice(label.length + 1));
    };
    const url = value("URL");
    if (!url) continue;
    const result: Result = { title: value("Title") || url, url };
    if (value("Published")) result.published = value("Published");
    if (value("Author")) result.author = value("Author");
    const mark = lines.findIndex((line) => /^Highlights:\s*$/.test(line.trim()));
    const snippet = mark >= 0 ? lines.slice(mark + 1).join("\n").trim() : "";
    if (snippet) result.snippet = snippet;
    results.push(result);
  }
  return results.slice(0, limit);
}

/** [result, text] of one JSON-RPC answer to a tool call, or null when it holds
 * nothing usable. */
function toolAnswer(parsed: unknown): [Record<string, any>, string] | null {
  if (!isRecord(parsed)) return null;
  if ("error" in parsed) {
    const [message, tag] = errorOf(parsed);
    throw new ProviderError(
      `Search request failed: ${message || "Unknown JSON-RPC error"}`,
      isLimit(null, message, tag),
    );
  }
  const result = parsed.result;
  if (!isRecord(result)) return null;
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content
    .map((item: unknown) => record(item).text)
    .filter((text: unknown): text is string => typeof text === "string" && !!text.trim());
  return [result, texts[0] ?? ""];
}

function toolFailed(result: Record<string, any>, text: string) {
  if (result.isError !== true) return;
  let [message, tag] = errorOf(result);
  if (!message) [message, tag] = errorOf(record(loadJson(text)));
  message = message || text.trim() || "MCP tool request failed";
  throw new ProviderError(`Search request failed: ${message.slice(0, 300)}`, isLimit(null, message, tag));
}

/** Call one tool of a provider's keyless service. The answer comes as JSON or as an
 * event stream; `read` turns one JSON-RPC answer into the results, or null. */
async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  deadline: number,
  limit: number,
  read: (parsed: unknown) => Found | null,
): Promise<Found> {
  const payload = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const headers = { Accept: "application/json, text/event-stream" };
  const body = (await postJson(url, headers, payload, deadline, limit)).trim();
  if (!body) return { results: [], text: "" };
  const direct = loadJson(body);
  if (direct !== null) {
    const answer = read(direct);
    if (answer === null) throw new ProviderError("Malformed search response body");
    return answer;
  }
  let sawData = false;
  for (const line of splitLines(body)) {
    if (!line.startsWith("data:")) continue;
    sawData = true;
    const payloadText = line.slice(5).trim();
    if (!payloadText || payloadText === "[DONE]") continue;
    const answer = read(loadJson(payloadText));
    if (answer !== null) return answer;
  }
  if (sawData) return { results: [], text: "" };
  throw new ProviderError("Malformed search response body");
}

/** One JSON-RPC answer of Exa as a result, or null when it holds nothing usable. */
function exaPayload(parsed: unknown, limit: number): Found | null {
  const found = toolAnswer(parsed);
  if (!found) return null;
  const [result, text] = found;
  if (record(result._meta)["ai.exa/rateLimited"] === true) {
    throw new ProviderError("Exa's free rate limit is reached", true);
  }
  toolFailed(result, text);
  if (!Array.isArray(result.content)) return null;
  const results = exaTextResults(text, limit);
  if (!results.length && isLimit(null, text.slice(0, 400))) {
    throw new ProviderError(`Search request failed: ${squeeze(text).slice(0, 200)}`, true);
  }
  return { results, text };
}

/** Exa's keyless tool takes the query, an objective and the number of results, and
 * no other option; the search options reach Exa only with a key. */
function searchExaMcp(request: Request, deadline: number, limit: number) {
  const args = { query: request.query, objective: request.query, numResults: request.numResults };
  return callTool(endpoints.exaMcp, "web_search_exa", args, deadline, limit, (parsed) =>
    exaPayload(parsed, request.numResults),
  );
}

async function searchKeenable(request: Request, deadline: number, limit: number, key: string) {
  const payload: Record<string, unknown> = { query: request.query, max_results: request.numResults };
  if (request.contextMaxCharacters) {
    payload.snippet_max_length = Math.min(10000, Math.max(180, request.contextMaxCharacters));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["X-API-Key"] = key;
  else headers["X-Keenable-Title"] = KEENABLE_TITLE;
  const body = await postJson(key ? endpoints.keenable : endpoints.keenablePublic, headers, payload, deadline, limit);
  return answered(body, (items) =>
    normalize(items, request.numResults, "published_at", (item) => words(item.snippet) || words(item.description)),
  );
}

/** The query as one keyword query of Parallel, which takes 200 characters. */
export function parallelQuery(query: string) {
  const text = squeeze(query);
  if (text.length <= PARALLEL_QUERY_CHARS) return text;
  const cut = text.slice(0, PARALLEL_QUERY_CHARS + 1);
  return (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut.slice(0, PARALLEL_QUERY_CHARS)).trim();
}

function parallelResults(items: unknown[], request: Request) {
  const excerpts = (item: Record<string, any>) =>
    (Array.isArray(item.excerpts) ? item.excerpts : []).map(words).filter(Boolean).join("\n\n");
  return normalize(items, request.numResults, "publish_date", excerpts);
}

/** Parallel is always asked in its advanced mode and with no other option; the search
 * options only cut its list to the number of results asked for. */
async function searchParallelRest(request: Request, deadline: number, limit: number, key: string) {
  const payload = {
    objective: request.query.slice(0, PARALLEL_OBJECTIVE_CHARS),
    search_queries: [parallelQuery(request.query)],
    mode: PARALLEL_MODE,
  };
  const headers = { Accept: "application/json", "x-api-key": key };
  const body = await postJson(endpoints.parallel, headers, payload, deadline, limit);
  return answered(body, (items) => parallelResults(items, request));
}

/** One JSON-RPC answer of Parallel's keyless service as a result, or null. */
function parallelPayload(parsed: unknown, request: Request): Found | null {
  const found = toolAnswer(parsed);
  if (!found) return null;
  const [result, text] = found;
  toolFailed(result, text);
  if (!Array.isArray(result.content)) return null;
  const structured = record(result.structuredContent);
  const data = Object.keys(structured).length ? structured : record(loadJson(text));
  if (Array.isArray(data.results)) return { results: parallelResults(data.results, request), text: "" };
  let [message, tag] = errorOf(data);
  message = message || squeeze(text);
  if (!message) return { results: [], text: "" };
  throw new ProviderError(`Search request failed: ${message.slice(0, 200)}`, isLimit(null, message.slice(0, 400), tag));
}

function searchParallelMcp(request: Request, deadline: number, limit: number) {
  const args = {
    objective: request.query.slice(0, PARALLEL_OBJECTIVE_CHARS),
    search_queries: [parallelQuery(request.query)],
  };
  return callTool(endpoints.parallelMcp, "web_search", args, deadline, limit, (parsed) =>
    parallelPayload(parsed, request),
  );
}

function searchWith(provider: Provider, request: Request, deadline: number, limit: number, keys: Keys) {
  const key = keys[provider][0];
  if (provider === "keenable") return searchKeenable(request, deadline, limit, key);
  if (provider === "parallel") {
    return key ? searchParallelRest(request, deadline, limit, key) : searchParallelMcp(request, deadline, limit);
  }
  return key ? searchExaRest(request, deadline, limit, key) : searchExaMcp(request, deadline, limit);
}

/** An error message without any API key in it. */
export function redact(message: string, keys: Keys) {
  const secrets = Object.values(keys)
    .map(([key]) => key)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    message = message.split(secret).join("[REDACTED]").split(quoteAll(secret)).join("[REDACTED]");
  }
  return message;
}

function brief(message: string) {
  const text = squeeze(message);
  return text.length <= 240 ? text : text.slice(0, 239).trimEnd() + "...";
}

/** Ask the providers in order. The next one is asked only when the one before says its
 * limit is reached; any other failure ends the search. Returns the provider that
 * answered and its answer. */
export async function searchInTurn(
  order: Provider[],
  request: Request,
  deadline: number,
  limit: number,
  keys: Keys,
): Promise<[Provider, Found]> {
  const failed: [Provider, string][] = [];
  for (const provider of order) {
    if (failed.length) {
      note(`note: ${LABELS[failed[failed.length - 1]![0]]}'s limit is reached; trying ${LABELS[provider]}.`);
    }
    try {
      return [provider, await searchWith(provider, request, deadline, limit, keys)];
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      failed.push([provider, redact(error.message, keys)]);
      if (!(error instanceof ProviderError && error.limit)) break;
    }
  }
  if (failed.length === 1) throw new Problem(failed[0]![1]);
  const parts = [`Search failed with ${LABELS[failed[0]![0]]} (${brief(failed[0]![1])})`];
  for (const [provider, message] of failed.slice(1)) {
    parts.push(`the ${LABELS[provider]} fallback failed: ${brief(message)}`);
  }
  throw new Problem(parts.join("; "));
}

export function formatResults(results: Result[]) {
  return results
    .map((result) => {
      const lines = [`Title: ${result.title}`, `URL: ${result.url}`];
      if (result.published) lines.push(`Published: ${result.published}`);
      if (result.author) lines.push(`Author: ${result.author}`);
      if (result.snippet) lines.push("Highlights:", result.snippet);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}
