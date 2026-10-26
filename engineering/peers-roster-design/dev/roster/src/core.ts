// Errors, output, places, processes and the text helpers every part uses.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROG = "roster.js";

/** The command was used wrongly (exit 2). */
export class UsageError extends Error {}

/** The request failed; the message says why and what to do (exit 1). */
export class Problem extends Error {}

/** Stop with this exit code; everything to say was printed already. */
export class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** A launch step failed; launch reports which members run and which did not start. */
export class LaunchError extends Error {}

/** Where the commands write. The tests replace both. */
export const io = {
  out: (text: string) => void process.stdout.write(text + "\n"),
  err: (text: string) => void process.stderr.write(text + "\n"),
};

export function print(text: string) {
  io.out(text);
}

export function fail(message: string): never {
  throw new Problem(message);
}

// --------------------------------------------------------------------------- places

/** The skill's directory: the built file sits in its scripts/, the source in dev/roster/src/. */
const HERE = import.meta.dir;
export const SKILL_DIR =
  path.basename(HERE) === "scripts" ? path.dirname(HERE) : path.resolve(HERE, "..", "..", "..");
export const SCRIPT = path.join(SKILL_DIR, "scripts", "roster.js");
// The peers skill sits next to this skill, both in this repository and where installers put
// skills; roster.json can name another source.
export const DEFAULT_PEERS = path.resolve(SKILL_DIR, "..", "peers");

/** os.path.join: an absolute part starts over, and nothing is normalized. */
export function join(first: string, ...rest: string[]) {
  let joined = first;
  for (const part of rest) {
    if (part.startsWith("/")) joined = part;
    else if (!joined || joined.endsWith("/")) joined += part;
    else joined += "/" + part;
  }
  return joined;
}

export function isFile(target: string) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

export function isExecutable(target: string) {
  if (!isFile(target)) return false;
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function readText(target: string) {
  return fs.readFileSync(target, "utf8");
}

/** The command's path on PATH, like shutil.which, or null. */
export function which(command: string) {
  if (command.includes("/")) return isExecutable(command) ? command : null;
  for (const folder of (process.env.PATH ?? "").split(":")) {
    const candidate = join(folder || ".", command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function home() {
  return process.env.HOME || os.homedir();
}

export function expandUser(value: string) {
  if (value === "~" || value.startsWith("~/")) return home() + value.slice(1);
  return value;
}

// --------------------------------------------------------------------------- processes

export type Ran = { code: number; stdout: string; stderr: string; timedOut: boolean };

export type RunOptions = {
  cwd?: string;
  input?: Uint8Array | string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Give the child this process's stdin, as Python's subprocess does by default. */
  inheritStdin?: boolean;
};

/** Run a command and capture its output. A command that cannot start is a Problem. */
export function run(cmd: string[], options: RunOptions = {}): Ran {
  let done: ReturnType<typeof Bun.spawnSync>;
  try {
    done = Bun.spawnSync({
      cmd,
      cwd: options.cwd,
      env: options.env ?? { ...process.env },
      stdin: options.input !== undefined ? new Blob([options.input]) : options.inheritStdin ? "inherit" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs,
    });
  } catch (error) {
    fail(`could not run \`${shlexJoin(cmd)}\`${options.cwd ? ` in ${options.cwd}` : ""}: ${reason(error)}`);
  }
  return {
    code: done.exitCode ?? -1,
    stdout: done.stdout ? done.stdout.toString() : "",
    stderr: done.stderr ? done.stderr.toString() : "",
    timedOut: Boolean(done.exitedDueToTimeout),
  };
}

export function sleep(ms: number) {
  Bun.sleepSync(ms);
}

/** The message of an error, such as "ENOENT: no such file or directory ...". */
export function reason(error: unknown) {
  return error instanceof Error ? error.message || error.name : String(error);
}

// --------------------------------------------------------------------------- JSON values

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isText(value: unknown): value is string {
  return typeof value === "string";
}

/** A non-empty string after strip(). */
export function isFilled(value: unknown): value is string {
  return typeof value === "string" && strip(value) !== "";
}

/** Python truthiness of a JSON value. */
export function truthy(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/** Parse JSON text; a Problem names the file and what is wrong with it. */
export function parseJsonFile(file: string, advice: string): Json {
  let text: string;
  try {
    text = readText(file);
  } catch (error) {
    fail(`${file} cannot be read: ${reason(error)}; ${advice}`);
  }
  try {
    return JSON.parse(text) as Json;
  } catch (error) {
    fail(`${file} is not valid JSON (${reason(error).replace(/^JSON Parse error: /, "")}); ${advice}`);
  }
}

// --------------------------------------------------------------------------- Python's text forms

const WHITESPACE = " \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000";
const LEADING = new RegExp(`^[${WHITESPACE}]+`);
const TRAILING = new RegExp(`[${WHITESPACE}]+$`);

/** str.strip(): Python's whitespace, which includes \x1c-\x1f. */
export function strip(text: string) {
  return text.replace(LEADING, "").replace(TRAILING, "");
}

/** str.splitlines(), without the line ends. */
export function splitlines(text: string) {
  const lines = text.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The last count characters (code points), like text[-count:]. */
export function tail(text: string, count: number) {
  const chars = Array.from(text);
  return chars.length <= count ? text : chars.slice(-count).join("");
}

export function length(text: string) {
  return Array.from(text).length;
}

/** str.rpartition(sep): [before, sep, after], or ["", "", text] without sep. */
export function rpartition(text: string, sep: string): [string, string, string] {
  const at = text.lastIndexOf(sep);
  return at < 0 ? ["", "", text] : [text.slice(0, at), sep, text.slice(at + sep.length)];
}

/** str.partition(sep): [before, sep, after], or [text, "", ""] without sep. */
export function partition(text: string, sep: string): [string, string, string] {
  const at = text.indexOf(sep);
  return at < 0 ? [text, "", ""] : [text.slice(0, at), sep, text.slice(at + sep.length)];
}

const UNPRINTABLE = /[\p{C}\p{Z}]/u;

function hex(code: number, width: number) {
  return code.toString(16).padStart(width, "0");
}

/** repr() of a string. */
export function reprString(text: string) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === quote || char === "\\") out += "\\" + char;
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (char !== " " && UNPRINTABLE.test(char)) {
      out += code < 0x100 ? `\\x${hex(code, 2)}` : code < 0x10000 ? `\\u${hex(code, 4)}` : `\\U${hex(code, 8)}`;
    } else out += char;
  }
  return out + quote;
}

/** repr() of a JSON value, as Python prints the dict, list or string it parsed. */
export function repr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return reprString(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(repr).join(", ")}]`;
  if (isObject(value)) {
    return `{${Object.entries(value)
      .map(([key, item]) => `${reprString(key)}: ${repr(item)}`)
      .join(", ")}}`;
  }
  return String(value);
}

function dumpString(text: string) {
  let out = '"';
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const code = text.charCodeAt(index);
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (char === "\b") out += "\\b";
    else if (char === "\f") out += "\\f";
    else if (code < 0x20 || code > 0x7e) out += `\\u${hex(code, 4)}`;
    else out += char;
  }
  return out + '"';
}

/** json.dumps(value) or json.dump(value, indent=...): Python's separators and ASCII escapes. */
export function dumps(value: unknown, indent?: number, level = 0): string {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return dumpString(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  const items: string[] = Array.isArray(value)
    ? value.map((item) => dumps(item, indent, level + 1))
    : isObject(value)
      ? Object.entries(value).map(([key, item]) => `${dumpString(key)}: ${dumps(item, indent, level + 1)}`)
      : [];
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (!items.length) return open + close;
  if (indent === undefined) return open + items.join(", ") + close;
  const inner = "\n" + " ".repeat(indent * (level + 1));
  return open + inner + items.join("," + inner) + "\n" + " ".repeat(indent * level) + close;
}

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** shlex.quote */
export function shlexQuote(text: string) {
  if (!text) return "''";
  if (SAFE.test(text)) return text;
  return "'" + text.replaceAll("'", `'"'"'`) + "'";
}

/** shlex.join */
export function shlexJoin(parts: readonly string[]) {
  return parts.map(shlexQuote).join(" ");
}

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
}

// --------------------------------------------------------------------------- names

/** What every name-bearing part of a member needs. */
export type Named = { name: string; display_name?: unknown };

/** The member's human-readable name: its display_name, else its member name. */
export function display(member: Named) {
  return (isText(member.display_name) ? strip(member.display_name) : "") || member.name;
}

/** " (<display name>)" after the member name, when the roster sets one. */
export function shown(member: Named) {
  return truthy(member.display_name) ? ` (${display(member)})` : "";
}

/** What herdr, Claude Code and OpenCode show for the member's session. */
export function sessionLabel(member: Named, name: string) {
  return truthy(member.display_name) ? `${display(member)} [${name}]` : name;
}
