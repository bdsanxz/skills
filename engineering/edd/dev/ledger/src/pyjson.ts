import { PyNumber } from "./core";

// JSON read as Python's json module reads it: the same values (NaN and Infinity included,
// the last of two equal keys kept) and the same error messages, with line, column and
// character, so that a mistake in a hand-edited ledger is found where Python found it.

export class JsonError extends Error {}

type Value = null | boolean | PyNumber | string | Value[] | { [key: string]: Value };

const SPACE = new Set([" ", "\t", "\n", "\r"]);
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** A value that is not there: Python's StopIteration, which becomes "Expecting value". */
class Missing {
  constructor(readonly at: number) {}
}

export function parseJson(text: string): Value {
  const chars = Array.from(text); // Python counts positions in code points
  const fail = (message: string, at: number): never => {
    let line = 1;
    let lastBreak = -1;
    for (let index = 0; index < at && index < chars.length; index++) {
      if (chars[index] === "\n") {
        line++;
        lastBreak = index;
      }
    }
    throw new JsonError(`${message}: line ${line} column ${at - lastBreak} (char ${at})`);
  };
  const skip = (at: number) => {
    while (at < chars.length && SPACE.has(chars[at]!)) at++;
    return at;
  };
  const word = (at: number, wanted: string) => chars.slice(at, at + wanted.length).join("") === wanted;

  function string(start: number): [string, number] {
    const begin = start - 1;
    let end = start;
    let result = "";
    for (;;) {
      let next = end;
      let char = "";
      for (; next < chars.length; next++) {
        char = chars[next]!;
        if (char === '"' || char === "\\") break;
        if (char.codePointAt(0)! <= 0x1f) fail("Invalid control character at", next);
      }
      if (next >= chars.length) fail("Unterminated string starting at", begin);
      result += chars.slice(end, next).join("");
      next++;
      if (char === '"') return [result, next];
      if (next === chars.length) fail("Unterminated string starting at", begin);
      char = chars[next]!;
      if (char !== "u") {
        end = next + 1;
        const escaped = ESCAPES[char];
        if (escaped === undefined) fail("Invalid \\escape", end - 2);
        result += escaped;
        continue;
      }
      next++;
      end = next + 4;
      if (end >= chars.length) fail("Invalid \\uXXXX escape", next - 1);
      const hex = (from: number, to: number) => {
        const digits = chars.slice(from, to).join("");
        if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("Invalid \\uXXXX escape", to - 5);
        return parseInt(digits, 16);
      };
      let code = hex(next, end);
      next = end;
      if (code >= 0xd800 && code <= 0xdbff && end + 6 < chars.length && chars[next] === "\\" && chars[next + 1] === "u") {
        const low = hex(next + 2, end + 6);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          end += 6;
        }
      }
      result += String.fromCodePoint(code);
    }
  }

  function value(at: number): [Value, number] {
    if (at >= chars.length) throw new Missing(at);
    const char = chars[at]!;
    if (char === '"') return string(at + 1);
    if (char === "{") return object(at + 1);
    if (char === "[") return array(at + 1);
    if (char === "n" && word(at, "null")) return [null, at + 4];
    if (char === "t" && word(at, "true")) return [true, at + 4];
    if (char === "f" && word(at, "false")) return [false, at + 5];
    if (char === "N" && word(at, "NaN")) return [new PyNumber(NaN, true, "NaN"), at + 3];
    if (char === "I" && word(at, "Infinity")) return [new PyNumber(Infinity, true, "Infinity"), at + 8];
    if (char === "-" && word(at, "-Infinity")) return [new PyNumber(-Infinity, true, "-Infinity"), at + 9];
    return number(at);
  }

  function number(at: number): [Value, number] {
    const digit = (index: number) => /^[0-9]$/.test(chars[index] ?? "");
    let index = at;
    if (chars[index] === "-" && ++index >= chars.length) throw new Missing(at);
    if (/^[1-9]$/.test(chars[index]!)) {
      while (digit(++index));
    } else if (chars[index] === "0") {
      index++;
    } else {
      throw new Missing(at);
    }
    if (chars[index] === "." && digit(index + 1)) {
      index += 2;
      while (digit(index)) index++;
    }
    if (chars[index] === "e" || chars[index] === "E") {
      const start = index++;
      if (chars[index] === "-" || chars[index] === "+") index++;
      const first = index;
      while (digit(index)) index++;
      if (index === first) index = start;
    }
    const text = chars.slice(at, index).join("");
    return [new PyNumber(Number(text), /[.eE]/.test(text), text), index];
  }

  function object(at: number): [Value, number] {
    const result: { [key: string]: Value } = Object.create(null);
    at = skip(at);
    if (at >= chars.length || chars[at] !== "}") {
      for (;;) {
        if (at >= chars.length || chars[at] !== '"') fail("Expecting property name enclosed in double quotes", at);
        const [key, afterKey] = string(at + 1);
        at = skip(afterKey);
        if (at >= chars.length || chars[at] !== ":") fail("Expecting ':' delimiter", at);
        const [item, afterItem] = value(skip(at + 1));
        result[key] = item;
        at = skip(afterItem);
        if (at < chars.length && chars[at] === "}") break;
        if (at >= chars.length || chars[at] !== ",") fail("Expecting ',' delimiter", at);
        at = skip(at + 1);
      }
    }
    return [result, at + 1];
  }

  function array(at: number): [Value, number] {
    const result: Value[] = [];
    at = skip(at);
    if (at >= chars.length || chars[at] !== "]") {
      for (;;) {
        const [item, afterItem] = value(at);
        result.push(item);
        at = skip(afterItem);
        if (at < chars.length && chars[at] === "]") break;
        if (at >= chars.length || chars[at] !== ",") fail("Expecting ',' delimiter", at);
        at = skip(at + 1);
      }
    }
    return [result, at + 1];
  }

  if (chars[0] === "\ufeff") fail("Unexpected UTF-8 BOM (decode using utf-8-sig)", 0);
  try {
    const [result, end] = value(skip(0));
    const after = skip(end);
    if (after !== chars.length) fail("Extra data", after);
    return result;
  } catch (error) {
    if (error instanceof Missing) fail("Expecting value", error.at);
    throw error;
  }
}
