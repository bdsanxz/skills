// Errors, output, and the text helpers that keep results the same as the Python scripts gave.

import fs from "node:fs";
import os from "node:os";
import { pyRepr } from "./pyjson";

/** The command was used wrongly or given input it cannot use: exit code 2. */
export class UsageError extends Error {}

/** Where the commands write. The tests replace both. */
export const io = {
  out: (text: string) => void process.stdout.write(text + "\n"),
  err: (text: string) => void process.stderr.write(text + "\n"),
};

export function print(text: string) {
  io.out(text);
}

export function note(text: string) {
  io.err(text);
}

// --------------------------------------------------------------------------- text

/** The characters Python counts as whitespace in str.split(), str.strip() and \s. */
export const PY_SPACE = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACE_RUN = new RegExp(`[${PY_SPACE}]+`, "gu");
const LEADING = new RegExp(`^[${PY_SPACE}]+`, "u");
const TRAILING = new RegExp(`[${PY_SPACE}]+$`, "u");

/** Python's str.split() with no argument. */
export function splitWords(value: string) {
  return value.split(SPACE_RUN).filter(Boolean);
}

/** Python's " ".join(value.split()). */
export function squeeze(value: string) {
  return splitWords(value).join(" ");
}

/** Python's str.strip() with no argument. */
export function strip(value: string) {
  return value.replace(LEADING, "").replace(TRAILING, "");
}

export function lstrip(value: string) {
  return value.replace(LEADING, "");
}

/** Python's str.strip(chars). */
export function stripChars(value: string, chars: string) {
  const set = [...chars];
  const points = [...value];
  let start = 0;
  let end = points.length;
  while (start < end && set.includes(points[start]!)) start++;
  while (end > start && set.includes(points[end - 1]!)) end--;
  return points.slice(start, end).join("");
}

/** Python's str.lstrip(chars). */
export function lstripChars(value: string, chars: string) {
  const points = [...value];
  let start = 0;
  while (start < points.length && chars.includes(points[start]!)) start++;
  return points.slice(start).join("");
}

/** Length in code points, as Python's len() of a str. */
export function length(value: string) {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

/** The first `count` code points, as Python's value[:count]. */
export function head(value: string, count: number) {
  if (count <= 0) return "";
  return [...value].slice(0, count).join("");
}

/** Python's str.partition. */
export function partition(value: string, separator: string): [string, string, string] {
  const at = value.indexOf(separator);
  if (at < 0) return [value, "", ""];
  return [value.slice(0, at), separator, value.slice(at + separator.length)];
}

/** Python's str.isdigit() for ASCII digits. */
export function isDigits(value: string) {
  return /^[0-9]+$/.test(value);
}

/** Lines of a text file as Python reads them: \r\n and \r become \n first. */
export function universalNewlines(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** Lines as Python's str.splitlines gives them. */
export function splitLines(value: string) {
  const lines = value.split(LINE_BREAK);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Compare by code point, as Python compares strings. */
export function compare(a: string, b: string) {
  if (a === b) return 0;
  const left = [...a];
  const right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index]!.codePointAt(0)!;
    const y = right[index]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
}

/** The message Python gives for a failed file operation, such as "[Errno 2] No such file or directory: 'a.json'". */
export function osError(error: unknown, file: string) {
  const code = (error as { code?: unknown } | null)?.code;
  const known: Record<string, string> = {
    ENOENT: "No such file or directory",
    EACCES: "Permission denied",
    EISDIR: "Is a directory",
    ENOTDIR: "Not a directory",
    ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long",
    EPERM: "Operation not permitted",
  };
  const errnos = os.constants.errno as Record<string, number>;
  if (typeof code === "string" && code in known && code in errnos) {
    return `[Errno ${errnos[code]}] ${known[code]}: ${pyRepr(file)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The bytes of a file, or a UsageError that starts with `label` and gives Python's reason. */
export function readBytes(file: string, label: string) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    throw new UsageError(`${label}: ${osError(error, file)}`);
  }
}

/** The closest of `choices` to `value`, when one is close enough to be a likely typo. */
export function closest(value: string, choices: readonly string[]) {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const choice of choices) {
    const distance = editDistance(value.toLowerCase(), choice.toLowerCase());
    if (distance < bestDistance) {
      best = choice;
      bestDistance = distance;
    }
  }
  if (best === null) return null;
  return bestDistance <= Math.max(1, Math.floor(best.length / 3)) ? best : null;
}

/** Edits from one word to the other, where swapping two neighbouring letters is one edit. */
function editDistance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}
