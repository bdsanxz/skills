#!/usr/bin/env node

import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SESSION_EXTENSIONS = new Set([".jsonl", ".json"]);
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_DISCOVERY_JSON_BYTES = 8 * 1024 * 1024;

export function validateSessionId(value) {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    throw new Error(
      "Session ID must be non-empty, contain only letters, numbers, '.', '-', or '_', and must not be a path",
    );
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandTilde(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function defaultSessionsRoot(env = process.env) {
  const configuredSessionDir = env.PI_CODING_AGENT_SESSION_DIR;
  if (configuredSessionDir) return resolve(expandTilde(configuredSessionDir));

  const configuredAgentDir = env.PI_CODING_AGENT_DIR;
  const agentDir = configuredAgentDir ? resolve(expandTilde(configuredAgentDir)) : join(homedir(), ".pi", "agent");
  return resolve(agentDir, "sessions");
}

function isWithin(root, target) {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function assertOutputPathInsideProject(projectRoot, outputPath) {
  const root = resolve(projectRoot);
  const target = resolve(outputPath);
  if (!isWithin(root, target)) {
    throw new Error(`Output path must stay inside the active project: ${target}`);
  }

  let existingAncestor = target;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }

  try {
    const realRoot = realpathSync(root);
    const realAncestor = realpathSync(existingAncestor);
    if (!isWithin(realRoot, realAncestor)) {
      throw new Error(`Output path escapes the active project through a symlink: ${target}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Output path escapes")) throw error;
    // The active project normally exists. A disappearing project is rejected
    // by the subsequent mkdir/write rather than redirected elsewhere.
  }
}

function sessionIdFromFilename(filePath) {
  const fileName = basename(filePath);
  const extension = extname(fileName).toLowerCase();
  const stem = fileName.slice(0, -extension.length);
  const separator = stem.lastIndexOf("_");
  return separator >= 0 && separator < stem.length - 1 ? stem.slice(separator + 1) : stem;
}

function readFirstSessionHeaderFromJsonl(filePath) {
  const fd = openSync(filePath, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = "";
  let scannedBytes = 0;

  const parseCandidate = (line) => {
    const normalized = line.replace(/^\uFEFF/, "");
    if (!normalized.trim()) return undefined;
    try {
      const value = JSON.parse(normalized);
      return isRecord(value) && value.type === "session" && typeof value.id === "string" ? value : null;
    } catch {
      // Pi skips malformed physical lines while looking for the first entry.
      return undefined;
    }
  };

  try {
    while (scannedBytes < MAX_HEADER_BYTES) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, MAX_HEADER_BYTES - scannedBytes), null);
      if (bytesRead === 0) break;
      scannedBytes += bytesRead;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      while (true) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const candidate = parseCandidate(line);
        if (candidate !== undefined) return candidate;
      }
    }

    pending += decoder.end();
    const candidate = parseCandidate(pending);
    return candidate && candidate !== null ? candidate : null;
  } finally {
    closeSync(fd);
  }
}

function recordsFromJsonValue(value) {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) throw new Error("JSON session source must be an object or an array");

  if (Array.isArray(value.entries)) {
    const header = isRecord(value.header)
      ? value.header
      : isRecord(value.session) && value.session.type === "session"
        ? value.session
        : null;
    if (header && (value.entries.length === 0 || !isRecord(value.entries[0]) || value.entries[0].type !== "session")) {
      return [header, ...value.entries];
    }
    return value.entries;
  }

  return [value];
}

function validateHeader(records, sourcePath) {
  const header = records[0];
  if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string" || header.id.length === 0) {
    throw new Error(`Session source has no valid first session header: ${sourcePath}`);
  }
  return header;
}

function parseJsonlText(text, sourcePath) {
  const records = [];
  const warnings = [];
  const lines = text.split(/\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = index === 0 ? lines[index].replace(/^\uFEFF/, "") : lines[index];
    if (!raw.trim()) continue;
    try {
      records.push(JSON.parse(raw));
    } catch (error) {
      warnings.push({
        line: lineNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (records.length === 0) throw new Error(`Session source is empty or contains no valid JSON records: ${sourcePath}`);
  const header = validateHeader(records, sourcePath);
  return { format: "jsonl", records, header, warnings, nonEmptyLines: lines.filter((line) => line.trim()).length };
}

export function parseSessionText(text, { extension = ".jsonl", sourcePath = "<input>" } = {}) {
  const normalized = text.replace(/^\uFEFF/, "");
  if (extension.toLowerCase() === ".json") {
    let value;
    try {
      value = JSON.parse(normalized);
    } catch (error) {
      if (error instanceof SyntaxError) return parseJsonlText(normalized, sourcePath);
      throw error;
    }
    const records = recordsFromJsonValue(value);
    const header = validateHeader(records, sourcePath);
    return {
      format: "json",
      records,
      header,
      warnings: [],
      nonEmptyLines: normalized.split(/\n/).filter((line) => line.trim()).length,
    };
  }

  return parseJsonlText(normalized, sourcePath);
}

function readHeaderForDiscovery(filePath) {
  const extension = extname(filePath).toLowerCase();
  try {
    if (extension === ".jsonl") return readFirstSessionHeaderFromJsonl(filePath);
    if (statSync(filePath).size > MAX_DISCOVERY_JSON_BYTES) return null;
    const parsed = parseSessionText(readFileSync(filePath, "utf8"), { extension, sourcePath: filePath });
    return parsed.header;
  } catch {
    return null;
  }
}

function walkSessionFiles(root) {
  if (!existsSync(root)) throw new Error(`Pi session directory does not exist: ${root}`);
  if (!statSync(root).isDirectory()) throw new Error(`Pi session path is not a directory: ${root}`);

  const files = [];
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && SESSION_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files;
}

function queryMatches(id, query) {
  return id === query || id.startsWith(query);
}

export function findSessionCandidates(sessionId, sessionsRoot = defaultSessionsRoot()) {
  const query = validateSessionId(sessionId);
  const root = resolve(sessionsRoot);
  const candidates = new Map();

  for (const filePath of walkSessionFiles(root)) {
    const filenameId = sessionIdFromFilename(filePath);
    const header = readHeaderForDiscovery(filePath);
    const headerId = header?.id;
    const filenameMatches = queryMatches(filenameId, query);
    const headerMatches = typeof headerId === "string" && queryMatches(headerId, query);

    // A readable header is authoritative. Retain a filename-only match so a
    // malformed/truncated candidate produces a useful error when opened.
    if (headerId && !headerMatches) continue;
    if (!filenameMatches && !headerMatches) continue;

    const matchedId = headerId ?? filenameId;
    const exact = matchedId === query || filenameId === query;
    candidates.set(filePath, { path: filePath, id: matchedId, exact });
  }

  return [...candidates.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function resolveSessionFile(sessionId, sessionsRoot = defaultSessionsRoot()) {
  const candidates = findSessionCandidates(sessionId, sessionsRoot);
  const exact = candidates.filter((candidate) => candidate.exact);
  const matches = exact.length > 0 ? exact : candidates;

  if (matches.length === 1) return matches[0].path;
  if (matches.length === 0) {
    throw new Error(`No Pi session found for ID '${sessionId}' under ${resolve(sessionsRoot)}`);
  }

  const details = matches
    .map((candidate) => `- ${candidate.id}: ${relative(resolve(sessionsRoot), candidate.path) || "."}`)
    .join("\n");
  throw new Error(`Session ID '${sessionId}' is ambiguous; provide the full ID. Candidates:\n${details}`);
}

function inlineCode(value) {
  const text = (value === null ? "null" : value === undefined ? "undefined" : String(value)).replace(/\r?\n/g, " ");
  let maximum = 0;
  for (const match of text.matchAll(/`+/g)) maximum = Math.max(maximum, match[0].length);
  const fence = "`".repeat(Math.max(1, maximum + 1));
  return `${fence}${text}${fence}`;
}

function fenced(text, language = "text") {
  const value = String(text ?? "");
  let maximum = 0;
  for (const match of value.matchAll(/`+/g)) maximum = Math.max(maximum, match[0].length);
  const fence = "`".repeat(Math.max(3, maximum + 1));
  const content = value.endsWith("\n") ? value : `${value}\n`;
  return `${fence}${language}\n${content}${fence}`;
}

function displayTimestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return String(value);
}

function displayParentId(value) {
  if (value === undefined || value === null) return "null";
  if (value === "") return '""';
  return String(value);
}

function event(kind, title, body, timestamp, parentId, extra = {}) {
  const time = displayTimestamp(timestamp);
  const heading = `### ${title}${time ? ` — ${inlineCode(time)}` : ""}`;
  const parent = `- **parentId:** ${inlineCode(displayParentId(parentId))}`;
  return { kind, markdown: [heading, parent, body].filter(Boolean).join("\n\n"), ...extra };
}

function prettyLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^[a-z]|\s+[a-z]/g, (match) => match.toUpperCase());
}

function toolLanguage(key) {
  return /command|script|shell/i.test(key) ? "sh" : "text";
}

function readableValue(value, depth = 0) {
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}_(empty)_`;
    return value
      .map((item) => {
        if (isRecord(item) || Array.isArray(item)) return `${indent}-\n${readableValue(item, depth + 1)}`;
        return `${indent}- ${inlineCode(item)}`;
      })
      .join("\n");
  }
  if (isRecord(value)) {
    const fields = Object.entries(value);
    if (fields.length === 0) return `${indent}_(empty)_`;
    return fields.map(([key, child]) => readableField(key, child, depth)).join("\n");
  }
  return `${indent}${inlineCode(value)}`;
}

function readableField(key, value, depth = 0) {
  const indent = "  ".repeat(depth);
  const label = prettyLabel(key);
  if (typeof value === "string") {
    if (value.includes("\n")) return `${indent}- **${label}:**\n\n${fenced(value, toolLanguage(key))}`;
    return `${indent}- **${label}:** ${inlineCode(value)}`;
  }
  if (isRecord(value) || Array.isArray(value)) {
    return `${indent}- **${label}:**\n${readableValue(value, depth + 1)}`;
  }
  return `${indent}- **${label}:** ${inlineCode(value)}`;
}

function renderToolCall(block, timestamp, parentId) {
  const title = `Tool call${block.name ? ` — ${inlineCode(block.name)}` : ""}`;
  const argumentsText = block.arguments === undefined
    ? "_(no arguments)_"
    : isRecord(block.arguments) || Array.isArray(block.arguments)
      ? readableValue(block.arguments)
      : fenced(block.arguments, "text");
  return event("toolCall", title, argumentsText, timestamp, parentId, { toolCalls: 1 });
}

function renderImageMarker(block) {
  const mimeType = typeof block.mimeType === "string" ? block.mimeType : "unknown";
  return `_[Image content: ${inlineCode(mimeType)}]_`;
}

function readableContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : "_[Unsupported content block: unknown]_";
  const sections = [];
  for (const block of content) {
    if (!isRecord(block)) {
      sections.push("_[Unsupported content block: unknown]_");
    } else if (block.type === "text" && typeof block.text === "string") {
      sections.push(block.text);
    } else if (block.type === "image") {
      sections.push(renderImageMarker(block));
    } else if (block.type !== "thinking" && block.type !== "toolCall") {
      sections.push(`_[Unsupported content block: ${inlineCode(block.type ?? "unknown")}]_`);
    }
  }
  return sections.join("\n\n");
}

function renderMessageEvents(message, fallbackTimestamp, parentId) {
  const role = typeof message.role === "string" ? message.role : "unknown";
  const title = role === "user" ? "User" : role === "assistant" ? "Assistant" : `Message — ${inlineCode(role)}`;
  const timestamp = message.timestamp ?? fallbackTimestamp;
  const content = message.content;
  if (typeof content === "string") return content.trim() ? [event("message", title, content.trim(), timestamp, parentId)] : [];
  if (!Array.isArray(content)) {
    const text = readableContent(content).trim();
    return text ? [event("message", title, text, timestamp, parentId)] : [];
  }

  const events = [];
  for (const block of content) {
    if (!isRecord(block)) {
      events.push(event("message", title, "_[Unsupported content block: unknown]_", timestamp, parentId));
    } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      events.push(event("message", title, block.text.trim(), timestamp, parentId));
    } else if (block.type === "toolCall") {
      events.push(renderToolCall(block, timestamp, parentId));
    } else if (block.type === "image") {
      events.push(event("message", title, renderImageMarker(block), timestamp, parentId));
    } else if (block.type !== "thinking") {
      events.push(event("message", title, `_[Unsupported content block: ${inlineCode(block.type ?? "unknown")}]_`, timestamp, parentId));
    }
  }
  return events;
}

function renderToolResult(message, fallbackTimestamp, parentId) {
  const title = `Tool result${message.toolName ? ` — ${inlineCode(message.toolName)}` : ""}`;
  const output = readableContent(message.content).trim() || "_(no textual output)_";
  const sections = [fenced(output, "text")];
  if (message.isError === true) sections.push("> Tool reported an error.");
  return event("toolResult", title, sections.join("\n\n"), message.timestamp ?? fallbackTimestamp, parentId);
}

function renderBashExecution(message, fallbackTimestamp, parentId) {
  const sections = [];
  if (typeof message.command === "string" && message.command) sections.push(`**Command**\n\n${fenced(message.command, "sh")}`);
  if (typeof message.output === "string" && message.output) sections.push(`**Output**\n\n${fenced(message.output, "text")}`);
  if (message.exitCode !== undefined) sections.push(`- **Exit code:** ${inlineCode(message.exitCode)}`);
  if (message.truncated === true) sections.push("> Output was truncated.");
  if (typeof message.fullOutputPath === "string") sections.push(`- **Full output:** ${inlineCode(message.fullOutputPath)}`);
  if (message.cancelled === true) sections.push("> Command was cancelled.");
  return event("toolCall", "Tool call — `bash`", sections.join("\n\n") || "_(no command output)_", message.timestamp ?? fallbackTimestamp, parentId, { toolCalls: 1 });
}

function cleanEntry(entry) {
  if (!isRecord(entry)) return [];

  if (entry.type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    if (message.role === "toolResult") return [renderToolResult(message, entry.timestamp, entry.parentId)];
    if (message.role === "bashExecution") return [renderBashExecution(message, entry.timestamp, entry.parentId)];
    return renderMessageEvents(message, entry.timestamp, entry.parentId);
  }

  if (entry.type === "custom_message") {
    const text = readableContent(entry.content).trim();
    return text ? [event("context", "Context", text, entry.timestamp, entry.parentId)] : [];
  }

  if ((entry.type === "compaction" || entry.type === "branch_summary") && typeof entry.summary === "string" && entry.summary.trim()) {
    return [event("context", "Context summary", entry.summary.trim(), entry.timestamp, entry.parentId)];
  }

  return [];
}

function renderPreamble(header, { sourcePath, sourceFormat } = {}) {
  const fields = [
    `**Session:** ${inlineCode(header.id)}`,
    header.timestamp !== undefined ? `**Started:** ${inlineCode(header.timestamp)}` : null,
    header.cwd !== undefined ? `**Project:** ${inlineCode(header.cwd)}` : null,
  ].filter(Boolean);
  return [
    "# Pi Session Transcript",
    "",
    fields.join("\n"),
    "",
    `<!-- source: ${sourcePath ?? "unknown"} | format: ${sourceFormat ?? "unknown"} -->`,
    "",
    "> Clean chronological export: conversation, tool calls, and tool results are rendered in timestamp order without JSON envelope metadata or role grouping.",
    "",
    "",
  ].join("\n");
}

function renderWarnings(warnings) {
  if (warnings.length === 0) return "";
  const lines = ["## Export warnings", "", "Some source lines could not be parsed and were omitted:", ""];
  for (const warning of warnings) lines.push(`- Source line ${inlineCode(warning.line)}: ${inlineCode(warning.error)}`);
  return lines.join("\n");
}

function cleanDocument(parsed, metadata = {}) {
  const sections = [];
  const stats = { parsedEntries: 0, messages: 0, toolCalls: 0, toolResults: 0, contextNotes: 0, omittedEntries: 0, warnings: parsed.warnings ?? [] };
  for (const entry of parsed.records.slice(1)) {
    stats.parsedEntries += 1;
    const renderedEvents = cleanEntry(entry);
    if (renderedEvents.length === 0) stats.omittedEntries += 1;
    for (const rendered of renderedEvents) {
      if (rendered.kind === "message") stats.messages += 1;
      else if (rendered.kind === "toolCall") stats.toolCalls += rendered.toolCalls ?? 1;
      else if (rendered.kind === "toolResult") stats.toolResults += 1;
      else if (rendered.kind === "context") stats.contextNotes += 1;
      sections.push(rendered.markdown);
    }
  }

  const body = sections.length > 0 ? sections.join("\n\n") : "_(No readable conversation or tool activity was found in this session.)_";
  const warnings = renderWarnings(stats.warnings);
  const markdown = `${renderPreamble(parsed.header, metadata)}${body}${warnings ? `\n\n${warnings}` : ""}\n`;
  return { markdown, stats };
}

export function renderMarkdown(parsed, { sourcePath = "", sourceFormat = parsed.format } = {}) {
  return cleanDocument(parsed, { sourcePath, sourceFormat }).markdown;
}

function createStats() {
  return {
    parsedEntries: 0,
    messages: 0,
    toolCalls: 0,
    toolResults: 0,
    contextNotes: 0,
    omittedEntries: 0,
    nonEmptyLines: 0,
    warnings: [],
  };
}

function writeChunk(stream, chunk) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const cleanup = () => {
      stream.removeListener("drain", onDrain);
      stream.removeListener("error", onError);
    };
    const onDrain = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise();
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    stream.once("error", onError);
    try {
      if (stream.write(chunk, "utf8")) {
        settled = true;
        cleanup();
        resolvePromise();
      } else {
        stream.once("drain", onDrain);
      }
    } catch (error) {
      onError(error);
    }
  });
}

function finishStream(stream) {
  return new Promise((resolvePromise, reject) => {
    const onFinish = () => {
      cleanup();
      resolvePromise();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.removeListener("finish", onFinish);
      stream.removeListener("error", onError);
    };
    stream.once("finish", onFinish);
    stream.once("error", onError);
    stream.end();
  });
}

function nextAvailablePath(basePath) {
  const extension = extname(basePath);
  const stem = extension ? basePath.slice(0, -extension.length) : basePath;
  for (let number = 1; number <= 10000; number += 1) {
    const candidate = number === 1 ? basePath : `${stem}-${number}${extension}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find an available output filename near ${basePath}`);
}

async function writeAtomic(basePath, producer) {
  mkdirSync(dirname(basePath), { recursive: true });
  let targetPath = nextAvailablePath(basePath);
  let temporaryPath = join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let stream;

  try {
    stream = createWriteStream(temporaryPath, { encoding: "utf8", flags: "wx" });
    await once(stream, "open");
    await producer(async (chunk) => writeChunk(stream, chunk));
    await finishStream(stream);
    if (existsSync(targetPath)) targetPath = nextAvailablePath(basePath);
    renameSync(temporaryPath, targetPath);
    temporaryPath = "";
    return targetPath;
  } catch (error) {
    if (stream) stream.destroy();
    if (temporaryPath) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the conversion error if cleanup races with process shutdown.
      }
    }
    throw error;
  }
}

function outputBasePath({ outputPath, projectRoot, sessionId }) {
  const root = resolve(projectRoot);
  const candidate = outputPath
    ? isAbsolute(outputPath)
      ? resolve(outputPath)
      : resolve(root, outputPath)
    : join(root, "_swe", "session-reader", `${sessionId}.md`);
  const withExtension = extname(candidate) ? candidate : `${candidate}.md`;
  if (extname(withExtension).toLowerCase() !== ".md") throw new Error("Session reader output must be a Markdown file ending in .md");
  assertOutputPathInsideProject(root, withExtension);
  return withExtension;
}

function recordStats(stats, renderedEvents) {
  stats.parsedEntries += 1;
  if (renderedEvents.length === 0) stats.omittedEntries += 1;
  for (const rendered of renderedEvents) {
    if (rendered.kind === "message") stats.messages += 1;
    else if (rendered.kind === "toolCall") stats.toolCalls += rendered.toolCalls ?? 1;
    else if (rendered.kind === "toolResult") stats.toolResults += 1;
    else if (rendered.kind === "context") stats.contextNotes += 1;
  }
}

async function convertJsonlFile(sourcePath, header, metadata, basePath) {
  const stats = createStats();
  const outputPath = await writeAtomic(basePath, async (write) => {
    await write(renderPreamble(header, metadata));
    const input = createReadStream(sourcePath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    let sawHeader = false;

    try {
      for await (const line of lines) {
        lineNumber += 1;
        const raw = lineNumber === 1 ? line.replace(/^\uFEFF/, "") : line;
        if (!raw.trim()) continue;
        stats.nonEmptyLines += 1;
        let entry;
        try {
          entry = JSON.parse(raw);
        } catch (error) {
          stats.warnings.push({ line: lineNumber, error: error instanceof Error ? error.message : String(error) });
          continue;
        }

        if (!sawHeader) {
          sawHeader = true;
          if (!isRecord(entry) || entry.type !== "session" || entry.id !== header.id) {
            throw new Error(`Session header changed while reading ${sourcePath}`);
          }
          continue;
        }

        const renderedEvents = cleanEntry(entry);
        recordStats(stats, renderedEvents);
        for (const rendered of renderedEvents) {
          await write(`${rendered.markdown}\n\n`);
        }
      }
    } finally {
      input.destroy();
    }

    if (!sawHeader) throw new Error(`Session source has no readable header: ${sourcePath}`);
    stats.warnings.sort((a, b) => a.line - b.line);
    await write(renderWarnings(stats.warnings));
    await write("\n");
  });
  return { outputPath, stats };
}

async function convertJsonFile(sourcePath, metadata, basePath) {
  const parsed = parseSessionText(readFileSync(sourcePath, "utf8"), {
    extension: extname(sourcePath).toLowerCase(),
    sourcePath,
  });
  const rendered = cleanDocument(parsed, { ...metadata, sourceFormat: parsed.format });
  const outputPath = await writeAtomic(basePath, async (write) => {
    await write(rendered.markdown);
  });
  return { outputPath, stats: { ...rendered.stats, nonEmptyLines: parsed.nonEmptyLines ?? 0 } };
}

export async function convertSession({
  sessionId,
  sessionsRoot = defaultSessionsRoot(),
  projectRoot = process.cwd(),
  outputPath,
} = {}) {
  const query = validateSessionId(sessionId);
  const sourcePath = resolveSessionFile(query, sessionsRoot);
  const extension = extname(sourcePath).toLowerCase();
  const header = readHeaderForDiscovery(sourcePath);
  if (!header) throw new Error(`Could not read a valid session header from ${sourcePath}`);
  if (!queryMatches(header.id, query)) throw new Error(`Resolved session header ID '${header.id}' does not match '${query}'`);

  const basePath = outputBasePath({ outputPath, projectRoot, sessionId: header.id });
  const metadata = { sourcePath, sourceFormat: extension.slice(1) || "unknown" };
  const result = extension === ".jsonl"
    ? await convertJsonlFile(sourcePath, header, metadata, basePath)
    : await convertJsonFile(sourcePath, metadata, basePath);

  return {
    sessionId: header.id,
    sourcePath,
    outputPath: result.outputPath,
    entries: result.stats.parsedEntries,
    messages: result.stats.messages,
    toolCalls: result.stats.toolCalls,
    toolResults: result.stats.toolResults,
    contextNotes: result.stats.contextNotes,
    omittedEntries: result.stats.omittedEntries,
    warnings: result.stats.warnings.length,
  };
}

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--session-id") {
      options.sessionId = argv[++index];
    } else if (argument === "--sessions-root") {
      options.sessionsRoot = argv[++index];
    } else if (argument === "--project-root") {
      options.projectRoot = argv[++index];
    } else if (argument === "--output") {
      options.outputPath = argv[++index];
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (!options.sessionId) options.sessionId = positional.shift();
  if (positional.length > 0) throw new Error("Provide exactly one Pi session ID");
  if (!options.sessionId) throw new Error("A Pi session ID is required");
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log("Usage: node session-to-markdown.mjs <session-id> [--output <file.md>] [--sessions-root <dir>] [--project-root <dir>]");
      return 0;
    }
    const result = await convertSession(options);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`session-reader: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
