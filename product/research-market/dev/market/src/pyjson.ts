// JSON read and written exactly as Python's json module does, so that the data file, the
// summaries and the error messages stay the same as the Python scripts gave:
// - a float stays a float (2.0 is written 2.0, not 2), and a large integer stays exact;
// - object keys keep their order, also when they look like numbers (a Map is written in order);
// - strings are written with ensure_ascii=False;
// - a file that cannot be read gives Python's message, with its line, column and character.

/** A JSON number written with a fraction or an exponent: Python reads and writes it as a float. */
export class PyFloat {
  constructor(readonly value: number) {}
}

export type Json = null | boolean | number | bigint | string | PyFloat | Json[] | JsonObject | JsonMap;
export interface JsonObject {
  [key: string]: Json;
}
export type JsonMap = Map<string, Json>;

/** Text that is not UTF-8, or not JSON. The message is the one Python gives. */
export class DecodeError extends Error {}

// --------------------------------------------------------------------------- values

/** Python's isinstance(value, dict). A Map is an object read from JSON whose keys look like numbers. */
export function isDict(value: Json | undefined): value is JsonObject | JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof PyFloat);
}

/** Python's dict.get: the value, or `fallback` when the key is not there or `value` is no dict. */
export function get(value: Json | undefined, key: string, fallback: Json = null): Json {
  if (!has(value, key)) return fallback;
  return value instanceof Map ? value.get(key)! : (value as JsonObject)[key]!;
}

/** Python's `key in value` for a dict. */
export function has(value: Json | undefined, key: string) {
  if (value instanceof Map) return value.has(key);
  return isDict(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/** Python's bool(). */
export function truthy(value: Json | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "string" || Array.isArray(value)) return value.length > 0;
  if (value instanceof PyFloat) return value.value !== 0;
  if (value instanceof Map) return value.size > 0;
  return Object.keys(value).length > 0;
}

/** Python's `a or b`. */
export function or(...values: Json[]): Json {
  for (const value of values.slice(0, -1)) if (truthy(value)) return value;
  return values[values.length - 1]!;
}

/** Python's isinstance(value, (int, float)); bool counts as int, as it does in Python. */
export function isNumber(value: Json | undefined): value is number | bigint | boolean | PyFloat {
  return (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof PyFloat
  );
}

/** The value of a number for arithmetic. */
export function numeric(value: number | bigint | boolean | PyFloat) {
  if (value instanceof PyFloat) return value.value;
  return Number(value);
}

/** Python's int(): numbers are cut toward zero, and text must be a whole number. */
export function toInt(value: Json): number {
  if (isNumber(value)) {
    const number = numeric(value);
    if (Number.isNaN(number)) throw new Error("cannot convert float NaN to integer");
    if (!Number.isFinite(number)) throw new Error("cannot convert float infinity to integer");
    return Math.trunc(number);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^[+-]?[0-9]+(_[0-9]+)*$/.test(text)) return Number(text.replace(/_/g, ""));
    throw new Error(`invalid literal for int() with base 10: ${pyRepr(value)}`);
  }
  throw new Error(`int() argument must be a string or a number, not ${typeName(value)}`);
}

function typeName(value: Json) {
  if (value === null) return "'NoneType'";
  if (Array.isArray(value)) return "'list'";
  return "'dict'";
}

/** Python's str() of a value. */
export function pyStr(value: Json): string {
  if (typeof value === "string") return value;
  return pyRepr(value);
}

/** Python's repr() of a value. */
export function pyRepr(value: Json): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : floatStr(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return reprText(value);
  if (value instanceof PyFloat) return floatStr(value.value);
  if (Array.isArray(value)) return "[" + value.map(pyRepr).join(", ") + "]";
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return "{" + entries.map(([key, item]) => `${reprText(key)}: ${pyRepr(item)}`).join(", ") + "}";
}

// Python's repr of a str, kept here so that this module needs nothing else.
function reprText(value: string) {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let text = quote;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === quote || char === "\\") text += "\\" + char;
    else if (char === "\n") text += "\\n";
    else if (char === "\r") text += "\\r";
    else if (char === "\t") text += "\\t";
    else if (char !== " " && /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u.test(char)) {
      if (code < 0x100) text += "\\x" + code.toString(16).padStart(2, "0");
      else if (code < 0x10000) text += "\\u" + code.toString(16).padStart(4, "0");
      else text += "\\U" + code.toString(16).padStart(8, "0");
    } else text += char;
  }
  return text + quote;
}

/** Python's repr() of a float: the shortest digits, with .0 or an exponent as Python writes them. */
export function floatStr(value: number) {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  return floatDigits(value);
}

function floatDigits(value: number) {
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const [mantissa, exponentText] = Math.abs(value).toExponential().split("e") as [string, string];
  const exponent = Number(exponentText);
  const digits = mantissa.replace(".", "");
  const sign = value < 0 ? "-" : "";
  if (exponent < -4 || exponent >= 16) {
    const shown = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${shown}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  if (exponent >= 0) {
    const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
    return `${sign}${whole}.${digits.slice(exponent + 1) || "0"}`;
  }
  return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
}

/** Python's round(value, 1): exact halves go to the even digit. */
export function round1(value: number) {
  if (Number.isInteger(value * 4) && !Number.isInteger(value * 2)) {
    const low = Math.floor(value * 10);
    return (low % 2 === 0 ? low : low + 1) / 10;
  }
  return Number(value.toFixed(1));
}

// --------------------------------------------------------------------------- writing

/** Python's json.dumps(value, ensure_ascii=False), with indent=2 when `indent` is given. */
export function dumps(value: Json, indent?: number): string {
  return write(value, indent, 0);
}

function write(value: Json, indent: number | undefined, level: number): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : jsonFloat(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof PyFloat) return jsonFloat(value.value);
  const entries: [string | null, Json][] = Array.isArray(value)
    ? value.map((item) => [null, item])
    : value instanceof Map
      ? [...value.entries()]
      : Object.entries(value);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return open + close;
  const items = entries.map(
    ([key, item]) => (key === null ? "" : JSON.stringify(key) + ": ") + write(item, indent, level + 1),
  );
  if (indent === undefined) return open + items.join(", ") + close;
  const inner = "\n" + " ".repeat(indent * (level + 1));
  return open + inner + items.join("," + inner) + "\n" + " ".repeat(indent * level) + close;
}

function jsonFloat(value: number) {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  return floatDigits(value);
}

// --------------------------------------------------------------------------- reading

/** Text from UTF-8 bytes, or an error with the message of Python's 'utf-8' codec. */
export function decodeUtf8(bytes: Uint8Array): string {
  const size = bytes.length;
  const fail = (start: number, end: number, why: string): never => {
    const where =
      start === end
        ? `byte 0x${bytes[start]!.toString(16).padStart(2, "0")} in position ${start}`
        : `bytes in position ${start}-${end}`;
    throw new DecodeError(`'utf-8' codec can't decode ${where}: ${why}`);
  };
  const within = (index: number, low: number, high: number) => bytes[index]! >= low && bytes[index]! <= high;
  for (let index = 0; index < size; ) {
    const lead = bytes[index]!;
    let needed = 0;
    let low = 0x80;
    let high = 0xbf;
    if (lead < 0x80) {
      index++;
      continue;
    } else if (lead >= 0xc2 && lead <= 0xdf) needed = 1;
    else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      if (lead === 0xe0) low = 0xa0;
      if (lead === 0xed) high = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      if (lead === 0xf0) low = 0x90;
      if (lead === 0xf4) high = 0x8f;
    } else fail(index, index, "invalid start byte");
    for (let step = 1; step <= needed; step++) {
      const at = index + step;
      if (at >= size) fail(index, size - 1, "unexpected end of data");
      const ok = step === 1 ? within(at, low, high) : within(at, 0x80, 0xbf);
      if (!ok) fail(index, at - 1, "invalid continuation byte");
    }
    index += needed + 1;
  }
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

const WHITESPACE = " \t\n\r";
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class Stop {
  constructor(readonly at: number) {}
}

/** Python's json.loads, with its error messages. */
export function loads(text: string): Json {
  const fail = (message: string, at: number): never => {
    const before = text.slice(0, at);
    const line = before.split("\n").length;
    const newline = before.lastIndexOf("\n");
    const position = codePoints(before);
    const column = newline < 0 ? position + 1 : position - codePoints(text.slice(0, newline));
    throw new DecodeError(`${message}: line ${line} column ${column} (char ${position})`);
  };
  const skip = (at: number) => {
    while (at < text.length && WHITESPACE.includes(text[at]!)) at++;
    return at;
  };

  const scanString = (start: number): [string, number] => {
    const begin = start - 1;
    let result = "";
    let at = start;
    for (;;) {
      let next = at;
      while (next < text.length) {
        const char = text[next]!;
        if (char === '"' || char === "\\" || char.charCodeAt(0) <= 0x1f) break;
        next++;
      }
      if (next >= text.length) fail("Unterminated string starting at", begin);
      result += text.slice(at, next);
      const char = text[next]!;
      if (char === '"') return [result, next + 1];
      if (char !== "\\") fail("Invalid control character at", next);
      next++;
      if (next >= text.length) fail("Unterminated string starting at", begin);
      const escape = text[next]!;
      if (escape !== "u") {
        if (!(escape in ESCAPES)) fail("Invalid \\escape", next - 1);
        result += ESCAPES[escape];
        at = next + 1;
        continue;
      }
      next++;
      let end = next + 4;
      if (end >= text.length) fail("Invalid \\uXXXX escape", next - 1);
      const hex = (from: number) => {
        const digits = text.slice(from, from + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(digits)) fail("Invalid \\uXXXX escape", from - 1);
        return parseInt(digits, 16);
      };
      let code = hex(next);
      if (code >= 0xd800 && code <= 0xdbff && end + 6 < text.length && text[end] === "\\" && text[end + 1] === "u") {
        const second = hex(end + 2);
        if (second >= 0xdc00 && second <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (second - 0xdc00);
          end += 6;
        }
      }
      result += String.fromCodePoint(code);
      at = end;
    }
  };

  const scan = (at: number): [Json, number] => {
    if (at >= text.length) throw new Stop(at);
    const char = text[at]!;
    if (char === '"') return scanString(at + 1);
    if (char === "{") return scanObject(at + 1);
    if (char === "[") return scanArray(at + 1);
    for (const [word, value] of [
      ["null", null],
      ["true", true],
      ["false", false],
      ["NaN", new PyFloat(NaN)],
      ["Infinity", new PyFloat(Infinity)],
      ["-Infinity", new PyFloat(-Infinity)],
    ] as const) {
      if (text.startsWith(word, at)) return [value, at + word.length];
    }
    NUMBER.lastIndex = at;
    const found = NUMBER.exec(text);
    if (!found) throw new Stop(at);
    const literal = found[0];
    const end = at + literal.length;
    if (found[1] !== undefined || found[2] !== undefined) return [new PyFloat(Number(literal)), end];
    const number = Number(literal);
    if (Number.isSafeInteger(number)) return [number === 0 ? 0 : number, end];
    return [BigInt(literal), end];
  };

  const value = (at: number): [Json, number] => {
    try {
      return scan(at);
    } catch (error) {
      if (error instanceof Stop) return fail("Expecting value", error.at);
      throw error;
    }
  };

  const scanObject = (start: number): [Json, number] => {
    const pairs: [string, Json][] = [];
    const done = (end: number): [Json, number] => {
      // A key such as "10" would be moved to the front of a JavaScript object; a Map keeps the order.
      if (pairs.some(([key]) => /^(0|[1-9][0-9]{0,8})$/.test(key))) return [new Map(pairs), end];
      const result: JsonObject = {};
      for (const [key, item] of pairs) {
        if (key === "__proto__") {
          Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
        } else result[key] = item;
      }
      return [result, end];
    };
    let end = skip(start);
    if (text[end] === "}") return done(end + 1);
    if (text[end] !== '"') fail("Expecting property name enclosed in double quotes", end);
    end++;
    for (;;) {
      let key: string;
      [key, end] = scanString(end);
      end = skip(end);
      if (text[end] !== ":") fail("Expecting ':' delimiter", end);
      end = skip(end + 1);
      let item: Json;
      [item, end] = value(end);
      pairs.push([key, item]);
      end = skip(end);
      const next = text[end];
      end++;
      if (next === "}") return done(end);
      if (next !== ",") fail("Expecting ',' delimiter", end - 1);
      end = skip(end);
      if (text[end] !== '"') fail("Expecting property name enclosed in double quotes", end);
      end++;
    }
  };

  const scanArray = (start: number): [Json, number] => {
    const result: Json[] = [];
    let end = skip(start);
    if (text[end] === "]") return [result, end + 1];
    for (;;) {
      let item: Json;
      [item, end] = value(end);
      result.push(item);
      end = skip(end);
      const next = text[end];
      end++;
      if (next === "]") return [result, end];
      if (next !== ",") fail("Expecting ',' delimiter", end - 1);
      end = skip(end);
    }
  };

  if (text.startsWith("\ufeff")) fail("Unexpected UTF-8 BOM (decode using utf-8-sig)", 0);
  const [result, end] = value(skip(0));
  const rest = skip(end);
  if (rest !== text.length) fail("Extra data", rest);
  return result;
}

function codePoints(text: string) {
  let count = 0;
  for (const _ of text) count++;
  return count;
}
