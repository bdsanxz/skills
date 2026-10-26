// Errors, output, and the text helpers that make the parser read text the way Python 3 does.

import fs from "node:fs";

/** The command line was used wrongly. */
export class UsageError extends Error {}

/** The document cannot be used: not a file, unreadable, or without any task. Exit code 2. */
export class DocumentError extends Error {}

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

// --------------------------------------------------------------------------- Python text rules

/** The characters Python's str.isspace() and the regular expression \s accept. */
const SPACE_CHARS =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** Regular expression parts, for patterns with the `u` flag. */
export const W = `[${SPACE_CHARS}]`; // \s
export const S = `[^${SPACE_CHARS}]`; // \S
export const D = "\\p{Nd}"; // \d
export const WORD = "[\\p{L}\\p{N}_]"; // \w

const LEADING = new RegExp(`^${W}+`, "u");
const TRAILING = new RegExp(`${W}+$`, "u");

export function strip(value: string) {
  return value.replace(LEADING, "").replace(TRAILING, "");
}

export function lstrip(value: string) {
  return value.replace(LEADING, "");
}

export function rstrip(value: string) {
  return value.replace(TRAILING, "");
}

/** Remove any of `chars` from both ends, as Python's str.strip(chars) does. */
export function stripChars(value: string, chars: string) {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start]!)) start++;
  while (end > start && chars.includes(value[end - 1]!)) end--;
  return value.slice(start, end);
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** Lines as Python's str.splitlines gives them. */
export function splitLines(value: string) {
  const lines = value.split(LINE_BREAK);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Order strings by code point, as Python compares them. */
export function compareText(a: string, b: string) {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index]!.codePointAt(0)! - right[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return left.length - right.length;
}

/** A string as Python's repr() writes it, for the printable text a path holds. */
export function pyRepr(value: string) {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let body = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === quote) body += "\\" + char;
    else if (char === "\t") body += "\\t";
    else if (char === "\n") body += "\\n";
    else if (char === "\r") body += "\\r";
    else if (code < 0x20 || (code >= 0x7f && code <= 0xa0)) body += "\\x" + code.toString(16).padStart(2, "0");
    else body += char;
  }
  return quote + body + quote;
}

// --------------------------------------------------------------------------- reading a file

const CONTINUATION = (byte: number | undefined) => byte !== undefined && byte >= 0x80 && byte <= 0xbf;

/** Where UTF-8 decoding fails first, as Python's strict decoder reports it, or null. */
export function utf8Error(bytes: Uint8Array): [start: number, end: number, reason: string] | null {
  const end = bytes.length;
  let at = 0;
  while (at < end) {
    const first = bytes[at]!;
    if (first < 0x80) {
      at++;
      continue;
    }
    let size: number;
    if (first < 0xc2) return [at, at + 1, "invalid start byte"];
    else if (first < 0xe0) size = 2;
    else if (first < 0xf0) size = 3;
    else if (first < 0xf5) size = 4;
    else return [at, at + 1, "invalid start byte"];
    const second = bytes[at + 1];
    const secondOk =
      CONTINUATION(second) &&
      !(first === 0xe0 && second! < 0xa0) &&
      !(first === 0xed && second! >= 0xa0) &&
      !(first === 0xf0 && second! < 0x90) &&
      !(first === 0xf4 && second! >= 0x90);
    if (at + 1 >= end) return [at, end, "unexpected end of data"];
    if (!secondOk) return [at, at + 1, "invalid continuation byte"];
    for (let index = 2; index < size; index++) {
      if (at + index >= end) return [at, end, "unexpected end of data"];
      if (!CONTINUATION(bytes[at + index])) return [at, at + index, "invalid continuation byte"];
    }
    at += size;
  }
  return null;
}

/** The message Python gives for a UnicodeDecodeError. */
function decodeMessage(bytes: Uint8Array, [start, end, reason]: [number, number, string]) {
  if (end === start + 1) {
    const hex = bytes[start]!.toString(16).padStart(2, "0");
    return `'utf-8' codec can't decode byte 0x${hex} in position ${start}: ${reason}`;
  }
  return `'utf-8' codec can't decode bytes in position ${start}-${end - 1}: ${reason}`;
}

const STRERROR: Record<string, string> = {
  EACCES: "Permission denied",
  EPERM: "Operation not permitted",
  EIO: "Input/output error",
  ENOENT: "No such file or directory",
  ELOOP: "Too many levels of symbolic links",
  EMFILE: "Too many open files",
  ENAMETOOLONG: "File name too long",
  EISDIR: "Is a directory",
  ENXIO: "Device not configured",
};

function isFile(target: string) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** The text of a UTF-8 file. Throws DocumentError with the message Python's script gave. */
export function readText(target: string) {
  if (!isFile(target)) throw new DocumentError(`${target} is not a file.`);
  let bytes: Uint8Array;
  try {
    bytes = fs.readFileSync(target);
  } catch (error) {
    const { code, errno, message } = error as NodeJS.ErrnoException;
    const text =
      code && errno !== undefined && STRERROR[code]
        ? `[Errno ${-errno}] ${STRERROR[code]}: ${pyRepr(target)}`
        : message;
    throw new DocumentError(`cannot read ${target}: ${text}`);
  }
  const failure = utf8Error(bytes);
  if (failure) throw new DocumentError(`cannot read ${target}: ${decodeMessage(bytes, failure)}`);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}
