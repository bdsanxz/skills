// Text and path helpers that behave like the Python built-ins the checks were first written
// with, so that every message stays the same byte for byte.

import os from "node:os";

/** The characters Python's str.isspace() and the regex \s accept. */
export const WS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const LEADING = new RegExp(`^[${WS}]+`);
const TRAILING = new RegExp(`[${WS}]+$`);
const RUNS = new RegExp(`[${WS}]+`, "g");

/** str.strip(), or str.strip(chars) when chars is given. */
export function strip(text: string, chars?: string) {
  if (chars === undefined) return rstrip(lstrip(text));
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start]!)) start++;
  while (end > start && chars.includes(text[end - 1]!)) end--;
  return text.slice(start, end);
}

export const lstrip = (text: string) => text.replace(LEADING, "");
export const rstrip = (text: string) => text.replace(TRAILING, "");

/** Every run of whitespace made one space, and the ends stripped. */
export const squash = (text: string) => strip(text.replace(RUNS, " "));

/** len() of a str: the number of code points. */
export const length = (text: string) => Array.from(text).length;

/** text[:count] of a str, counted in code points. */
export const head = (text: string, count: number) => Array.from(text).slice(0, count).join("");

/** sorted() of strings: by code point. */
export function sorted(items: Iterable<string>) {
  return [...items].sort((a, b) => {
    const left = Array.from(a, (c) => c.codePointAt(0)!);
    const right = Array.from(b, (c) => c.codePointAt(0)!);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return left[i]! - right[i]!;
    }
    return left.length - right.length;
  });
}

const UNPRINTABLE = /[\p{C}\p{Z}]/u;

/** repr() of a str. */
export function repr(text: string) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === quote || char === "\\") out += "\\" + char;
    else if (char === "\t") out += "\\t";
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char !== " " && UNPRINTABLE.test(char)) {
      if (code < 0x100) out += "\\x" + code.toString(16).padStart(2, "0");
      else if (code < 0x10000) out += "\\u" + code.toString(16).padStart(4, "0");
      else out += "\\U" + code.toString(16).padStart(8, "0");
    } else out += char;
  }
  return out + quote;
}

/** repr() of a tuple of str, such as ('a',) or ('a', 'b'). */
export function tupleRepr(items: readonly string[]) {
  if (items.length === 1) return `(${repr(items[0]!)},)`;
  return `(${items.map(repr).join(", ")})`;
}

/** str() of pathlib.Path(value).expanduser(). */
export function pathString(value: string) {
  let text = value;
  if (text === "~" || text.startsWith("~/")) text = os.homedir() + text.slice(1);
  if (!text) return ".";
  const lead = text.startsWith("//") && !text.startsWith("///") ? "//" : text.startsWith("/") ? "/" : "";
  const parts = text.split("/").filter((part) => part && part !== ".");
  return lead + parts.join("/") || ".";
}

/** Path.name, Path.stem and Path.suffix of a path string. */
export function pathParts(text: string) {
  const name = text === "." || text === "/" || text === "//" ? "" : text.slice(text.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const hasSuffix = dot > 0 && dot < name.length - 1;
  return { name, stem: hasSuffix ? name.slice(0, dot) : name, suffix: hasSuffix ? name.slice(dot) : "" };
}

const STRERROR: Record<string, string> = {
  ENOENT: "No such file or directory",
  EISDIR: "Is a directory",
  ENOTDIR: "Not a directory",
  EACCES: "Permission denied",
  EPERM: "Operation not permitted",
  ELOOP: "Too many levels of symbolic links",
  ENAMETOOLONG: "File name too long",
  EIO: "Input/output error",
  EMFILE: "Too many open files",
};

/** str() of the OSError Python raises for a failed open(): "[Errno 2] No such file ...: 'x'". */
export function osError(error: unknown, filename: string) {
  const code = (error as { code?: unknown } | null)?.code;
  const errno = typeof code === "string" ? (os.constants.errno as Record<string, number>)[code] : undefined;
  if (typeof code === "string" && errno !== undefined && STRERROR[code]) {
    return `[Errno ${errno}] ${STRERROR[code]}: ${repr(filename)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
