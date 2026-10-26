// Output, errors, and the helpers that make strings, paths and files behave as they did in
// the Python script this tool replaces: its whitespace, its word characters, its repr().

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROG = "ledger";

/** The input is wrong: the caller is told why, and the command exits 2. */
export class UsageError extends Error {}

/** Where the commands write. The tests replace both. */
export const io = {
  out: (text: string) => void process.stdout.write(text + "\n"),
  err: (text: string) => void process.stderr.write(text + "\n"),
};

export function print(text = "") {
  io.out(text);
}

export function note(text: string) {
  io.err(text);
}

// --------------------------------------------------------------------------- text

/** The characters Python counts as whitespace (str.isspace, and \s in a pattern). */
export const WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** The characters Python counts as word characters (\w in a pattern). */
export const WORD = "[\\p{L}\\p{N}_]";
/** Python's \b: a place between a word character and anything else. */
export const EDGE = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;

const RUNS = new RegExp(`[${WS}]+`, "gu");
const LEADING = new RegExp(`^[${WS}]+`, "u");
const TRAILING = new RegExp(`[${WS}]+$`, "u");

/** Runs of whitespace squashed to one space, and the ends stripped. */
export function squash(text: string) {
  return strip(text.replace(RUNS, " "));
}

export function strip(text: string) {
  return text.replace(LEADING, "").replace(TRAILING, "");
}

export function lstrip(text: string) {
  return text.replace(LEADING, "");
}

/** True when the text is empty or only whitespace: what `not text.strip()` meant. */
export function blank(text: string) {
  return strip(text) === "";
}

const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]");

/** Lines as Python's str.splitlines gives them. */
export function splitLines(text: string) {
  const lines = text.split(LINE_BREAK);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Text read as Python reads a file in text mode: every \r\n and \r becomes \n. */
export function universalNewlines(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

/** A regular expression that matches the text literally. */
export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Orders strings by code point, as Python's sorted() does. */
export function byCodePoint(a: string, b: string) {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index]!.codePointAt(0)!;
    const y = right[index]!.codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return left.length - right.length;
}

/** Python's "%.1f": the value rounded to one decimal, with an exact tie going to the even digit. */
export function oneDecimal(value: number) {
  const tenfold = value * 10;
  if (Number.isInteger(tenfold * 2) && !Number.isInteger(tenfold)) {
    const below = Math.floor(tenfold);
    return ((below % 2 === 0 ? below : below + 1) / 10).toFixed(1);
  }
  return value.toFixed(1);
}

/** Python's "%g" for the small whole and decimal numbers this tool prints. */
export function general(value: number) {
  return String(Number(value.toPrecision(6)));
}

const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function reprString(text: string) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let shown = quote;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === quote || char === "\\") shown += "\\" + char;
    else if (char === "\t") shown += "\\t";
    else if (char === "\n") shown += "\\n";
    else if (char === "\r") shown += "\\r";
    else if (code < 0x20 || code === 0x7f) shown += "\\x" + code.toString(16).padStart(2, "0");
    else if (code < 0x7f || char === " " || !UNPRINTABLE.test(char)) shown += char;
    else if (code <= 0xff) shown += "\\x" + code.toString(16).padStart(2, "0");
    else if (code <= 0xffff) shown += "\\u" + code.toString(16).padStart(4, "0");
    else shown += "\\U" + code.toString(16).padStart(8, "0");
  }
  return shown + quote;
}

/**
 * A number read from JSON, keeping what Python kept: whether it was an int or a float, and an
 * int's exact digits.
 */
export class PyNumber {
  constructor(
    readonly value: number,
    readonly float: boolean,
    readonly text: string,
  ) {}
}

function reprFloat(value: number) {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  // Python's repr of a float: the shortest digits, in exponent form below 1e-4 and from 1e16.
  const [digits, exponentText] = Math.abs(value).toExponential().split("e") as [string, string];
  const exponent = Number(exponentText);
  const mantissa = digits.replace(".", "");
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  if (exponent < -4 || exponent >= 16) {
    const shown = mantissa.length > 1 ? `${mantissa[0]}.${mantissa.slice(1)}` : mantissa;
    return `${sign}${shown}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${mantissa}`;
  const whole = mantissa.padEnd(exponent + 1, "0");
  const point = whole.slice(0, exponent + 1);
  const rest = whole.slice(exponent + 1);
  return `${sign}${point}.${rest || "0"}`;
}

/** A value read from JSON, shown as Python's repr() showed it. */
export function repr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return reprString(value);
  if (value instanceof PyNumber) return value.float ? reprFloat(value.value) : BigInt(value.text).toString();
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : reprFloat(value);
  if (Array.isArray(value)) return "[" + value.map(repr).join(", ") + "]";
  if (isRecord(value)) {
    return "{" + Object.entries(value).map(([key, item]) => `${reprString(key)}: ${repr(item)}`).join(", ") + "}";
  }
  return String(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof PyNumber);
}

// --------------------------------------------------------------------------- errors from the system

const STRERROR: Record<string, string> = {
  EPERM: "Operation not permitted",
  ENOENT: "No such file or directory",
  EIO: "Input/output error",
  EACCES: "Permission denied",
  EEXIST: "File exists",
  ENOTDIR: "Not a directory",
  EISDIR: "Is a directory",
  EINVAL: "Invalid argument",
  EMFILE: "Too many open files",
  ENOSPC: "No space left on device",
  EROFS: "Read-only file system",
  ELOOP: "Too many levels of symbolic links",
  ENAMETOOLONG: "File name too long",
  ENOTEMPTY: "Directory not empty",
};

/** An error from the system, worded as Python words it: "[Errno 2] No such file or directory: 'x'". */
export function systemMessage(error: unknown, filename?: string) {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code in STRERROR) {
    const number = (os.constants.errno as Record<string, number>)[code];
    const head = `[Errno ${number ?? "?"}] ${STRERROR[code]}`;
    return filename === undefined ? head : `${head}: ${repr(filename)}`;
  }
  if (error instanceof DecodeError) return error.message;
  return error instanceof Error ? error.message || error.name : String(error);
}

export function isSystemError(error: unknown) {
  return typeof (error as { code?: unknown } | null)?.code === "string";
}

// --------------------------------------------------------------------------- UTF-8

/** Bytes that are not UTF-8, with Python's message for them. */
export class DecodeError extends Error {}

const STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const LENIENT = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/** The bytes as text, with U+FFFD for what is not UTF-8 (Python's errors="replace"). */
export function decodeLenient(bytes: Uint8Array) {
  return LENIENT.decode(bytes);
}

/** The bytes as text; a DecodeError worded as Python's when they are not UTF-8. */
export function decodeStrict(bytes: Uint8Array) {
  try {
    return STRICT.decode(bytes);
  } catch {
    throw new DecodeError(decodeFailure(bytes));
  }
}

const isContinuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80;

/** Where and why the bytes stop being UTF-8, as CPython's decoder reports it. */
function decodeFailure(bytes: Uint8Array) {
  const say = (start: number, end: number, reason: string) =>
    end === start + 1
      ? `'utf-8' codec can't decode byte 0x${bytes[start]!.toString(16).padStart(2, "0")} in position ${start}: ${reason}`
      : `'utf-8' codec can't decode bytes in position ${start}-${end - 1}: ${reason}`;
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index]!;
    if (lead < 0x80) {
      index++;
      continue;
    }
    const left = bytes.length - index;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const fourth = bytes[index + 3];
    if (lead < 0xc2 || lead > 0xf4) return say(index, index + 1, "invalid start byte");
    if (lead < 0xe0) {
      if (left < 2) return say(index, bytes.length, "unexpected end of data");
      if (!isContinuation(second)) return say(index, index + 1, "invalid continuation byte");
      index += 2;
      continue;
    }
    if (lead < 0xf0) {
      const secondBad = (byte: number) =>
        !isContinuation(byte) || (lead === 0xe0 && byte < 0xa0) || (lead === 0xed && byte >= 0xa0);
      if (left < 3) {
        if (left >= 2 && secondBad(second!)) return say(index, index + 1, "invalid continuation byte");
        return say(index, bytes.length, "unexpected end of data");
      }
      if (secondBad(second!)) return say(index, index + 1, "invalid continuation byte");
      if (!isContinuation(third)) return say(index, index + 2, "invalid continuation byte");
      index += 3;
      continue;
    }
    const secondBad = (byte: number) =>
      !isContinuation(byte) || (lead === 0xf0 && byte < 0x90) || (lead === 0xf4 && byte >= 0x90);
    if (left < 4) {
      if (left >= 2 && secondBad(second!)) return say(index, index + 1, "invalid continuation byte");
      if (left >= 3 && !isContinuation(third)) return say(index, index + 2, "invalid continuation byte");
      return say(index, bytes.length, "unexpected end of data");
    }
    if (secondBad(second!)) return say(index, index + 1, "invalid continuation byte");
    if (!isContinuation(third)) return say(index, index + 2, "invalid continuation byte");
    if (!isContinuation(fourth)) return say(index, index + 3, "invalid continuation byte");
    index += 4;
  }
  return "'utf-8' codec can't decode the input";
}

// --------------------------------------------------------------------------- paths and files

/** Python's os.path.relpath: "." for the same place. */
export function relpath(target: string, start = process.cwd()) {
  return path.relative(path.resolve(start), path.resolve(target)) || ".";
}

/** True when `target` is `folder` or lies under it. Both are absolute and normalized. */
export function inside(target: string, folder: string) {
  const full = path.resolve(target);
  return full === folder || full.startsWith(folder.endsWith("/") ? folder : folder + "/");
}

function statOrNull(target: string) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

export function isDir(target: string) {
  return statOrNull(target)?.isDirectory() ?? false;
}

export function isFile(target: string) {
  return statOrNull(target)?.isFile() ?? false;
}

export function exists(target: string) {
  return statOrNull(target) !== null;
}

export function isLink(target: string) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The file's modification time in seconds, rounded exactly as Python's os.path.getmtime. */
export function mtime(target: string) {
  const nanoseconds = fs.statSync(target, { bigint: true }).mtimeNs;
  const seconds = nanoseconds / 1_000_000_000n;
  const rest = nanoseconds % 1_000_000_000n;
  return Number(seconds) + Number(rest) * 1e-9;
}

/** A time stamp as local "YYYY-MM-DD HH:MM:SS". */
export function clock(stamp: number) {
  const date = new Date(Math.floor(stamp) * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

/**
 * The folders under `top` as Python's os.walk gives them, top first: each folder with its
 * subfolders and its other entries. A symbolic link to a folder is listed with the folders
 * and not entered. The caller may remove names from `folders` to skip them.
 */
export function* walk(top: string): Generator<[string, string[], string[]]> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(top, { withFileTypes: true });
  } catch {
    return;
  }
  const folders: string[] = [];
  const names: string[] = [];
  for (const entry of entries) {
    const linked = entry.isSymbolicLink() && isDir(path.join(top, entry.name));
    (entry.isDirectory() || linked ? folders : names).push(entry.name);
  }
  yield [top, folders, names];
  for (const name of folders) {
    const next = path.join(top, name);
    if (!isLink(next)) yield* walk(next);
  }
}
