// A TOML parser ported from Python's tomllib (CPython 3.12, which comes from tomli by
// Taneli Hukkinen, MIT license: see NOTICE.md). It accepts and rejects the same documents
// and gives the same error messages, such as "Invalid value (at line 3, column 9)".
// Positions are UTF-16 indexes; the column of a message is counted in code points, as in Python.

import { repr, tupleRepr } from "./py";

export class TOMLDecodeError extends Error {}

/** A dotted key of more parts than Python allows, which it reports as a RecursionError. */
export class KeyTooLong extends Error {}

/** A parsed value. Dates, times and numbers are kept as plain objects or numbers: the checks only use strings. */
export type Value = string | number | bigint | boolean | Value[] | Table | TomlDate;
export type Table = Map<string, Value>;
export class TomlDate {
  constructor(readonly text: string) {}
}

type Key = string[];

const MAX_KEY_PARTS = 1000; // sys.getrecursionlimit()

const charSet = (chars: string) => new Set(chars);
const range = (low: number, high: number) => Array.from({ length: high - low + 1 }, (_, i) => String.fromCharCode(low + i)).join("");
const ASCII_CTRL = range(0, 31) + "\x7f";
const ILLEGAL_BASIC_STR_CHARS = charSet(ASCII_CTRL.replace("\t", ""));
const ILLEGAL_MULTILINE_BASIC_STR_CHARS = charSet(ASCII_CTRL.replace("\t", "").replace("\n", ""));
const ILLEGAL_LITERAL_STR_CHARS = ILLEGAL_BASIC_STR_CHARS;
const ILLEGAL_MULTILINE_LITERAL_STR_CHARS = ILLEGAL_MULTILINE_BASIC_STR_CHARS;
const ILLEGAL_COMMENT_CHARS = ILLEGAL_BASIC_STR_CHARS;

const TOML_WS = charSet(" \t");
const TOML_WS_AND_NEWLINE = charSet(" \t\n");
const BARE_KEY_CHARS = charSet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_");
const KEY_INITIAL_CHARS = charSet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_\"'");
const HEX = /^[0-9A-Fa-f]*$/;

const BASIC_STR_ESCAPE_REPLACEMENTS: Record<string, string> = {
  "\\b": "\u0008",
  "\\t": "\u0009",
  "\\n": "\u000A",
  "\\f": "\u000C",
  "\\r": "\u000D",
  '\\"': '"',
  "\\\\": "\\",
};

const TIME = "([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\\.([0-9]{1,6})[0-9]*)?";
const RE_NUMBER = new RegExp(
  "0(?:x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|b[01](?:_?[01])*|o[0-7](?:_?[0-7])*)" +
    "|[+-]?(?:0|[1-9](?:_?[0-9])*)((?:\\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?)",
  "y",
);
const RE_LOCALTIME = new RegExp(TIME, "y");
const RE_DATETIME = new RegExp(
  `([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(?:[Tt ]${TIME}(?:([Zz])|([+-])([01][0-9]|2[0-3]):([0-5][0-9]))?)?`,
  "y",
);

function at(src: string, pos: number): string | undefined {
  return pos < src.length ? src[pos] : undefined;
}

function suffixedErr(src: string, pos: number, msg: string) {
  let where: string;
  if (pos >= src.length) {
    where = "end of document";
  } else {
    const before = src.slice(0, pos);
    const line = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const column = Array.from(src.slice(lineStart, pos)).length + 1;
    where = `line ${line}, column ${column}`;
  }
  return new TOMLDecodeError(`${msg} (at ${where})`);
}

function match(re: RegExp, src: string, pos: number) {
  re.lastIndex = pos;
  return re.exec(src);
}

type Node = { flags: Set<number>; recursive: Set<number>; nested: Map<string, Node> };
const newNode = (): Node => ({ flags: new Set(), recursive: new Set(), nested: new Map() });

class Flags {
  static FROZEN = 0;
  static EXPLICIT_NEST = 1;
  private root = new Map<string, Node>();
  private pending: [Key, number][] = [];

  addPending(key: Key, flag: number) {
    this.pending.push([key, flag]);
  }

  finalizePending() {
    for (const [key, flag] of this.pending) this.set(key, flag, false);
    this.pending = [];
  }

  unsetAll(key: Key) {
    let cont = this.root;
    for (const k of key.slice(0, -1)) {
      const node = cont.get(k);
      if (!node) return;
      cont = node.nested;
    }
    cont.delete(key[key.length - 1]!);
  }

  set(key: Key, flag: number, recursive: boolean) {
    let cont = this.root;
    for (const k of key.slice(0, -1)) {
      if (!cont.has(k)) cont.set(k, newNode());
      cont = cont.get(k)!.nested;
    }
    const stem = key[key.length - 1]!;
    if (!cont.has(stem)) cont.set(stem, newNode());
    (recursive ? cont.get(stem)!.recursive : cont.get(stem)!.flags).add(flag);
  }

  is(key: Key, flag: number) {
    if (!key.length) return false;
    let cont = this.root;
    for (const k of key.slice(0, -1)) {
      const inner = cont.get(k);
      if (!inner) return false;
      if (inner.recursive.has(flag)) return true;
      cont = inner.nested;
    }
    const node = cont.get(key[key.length - 1]!);
    return node ? node.flags.has(flag) || node.recursive.has(flag) : false;
  }
}

class NoNest extends Error {}

const isTable = (value: Value | undefined): value is Table => value instanceof Map;

class NestedDict {
  dict: Table = new Map();

  getOrCreateNest(key: Key, accessLists = true): Table {
    let cont: Value = this.dict;
    for (const k of key) {
      const table = cont as Table;
      if (!table.has(k)) table.set(k, new Map());
      cont = table.get(k)!;
      if (accessLists && Array.isArray(cont)) cont = cont[cont.length - 1]!;
      if (!isTable(cont)) throw new NoNest("There is no nest behind this key");
    }
    return cont as Table;
  }

  appendNestToList(key: Key) {
    const cont = this.getOrCreateNest(key.slice(0, -1));
    const last = key[key.length - 1]!;
    if (cont.has(last)) {
      const list = cont.get(last)!;
      if (!Array.isArray(list)) throw new NoNest("An object other than list found behind this key");
      list.push(new Map());
    } else {
      cont.set(last, [new Map()]);
    }
  }
}

type Output = { data: NestedDict; flags: Flags };

/** Parse a TOML document. Throws TOMLDecodeError, or KeyTooLong for a key of too many parts. */
export function loads(s: string): Table {
  const src = s.replaceAll("\r\n", "\n");
  let pos = 0;
  const out: Output = { data: new NestedDict(), flags: new Flags() };
  let header: Key = [];
  for (;;) {
    pos = skipChars(src, pos, TOML_WS);
    let char = at(src, pos);
    if (char === undefined) break;
    if (char === "\n") {
      pos += 1;
      continue;
    }
    if (KEY_INITIAL_CHARS.has(char)) {
      pos = keyValueRule(src, pos, out, header);
      pos = skipChars(src, pos, TOML_WS);
    } else if (char === "[") {
      const second = at(src, pos + 1);
      out.flags.finalizePending();
      [pos, header] = second === "[" ? createListRule(src, pos, out) : createDictRule(src, pos, out);
      pos = skipChars(src, pos, TOML_WS);
    } else if (char !== "#") {
      throw suffixedErr(src, pos, "Invalid statement");
    }
    pos = skipComment(src, pos);
    char = at(src, pos);
    if (char === undefined) break;
    if (char !== "\n") throw suffixedErr(src, pos, "Expected newline or end of document after a statement");
    pos += 1;
  }
  return out.data.dict;
}

function skipChars(src: string, pos: number, chars: Set<string>) {
  while (pos < src.length && chars.has(src[pos]!)) pos++;
  return pos;
}

function skipUntil(src: string, pos: number, expect: string, errorOn: Set<string>, errorOnEof: boolean) {
  let newPos = src.indexOf(expect, pos);
  if (newPos < 0) {
    newPos = src.length;
    if (errorOnEof) throw suffixedErr(src, newPos, `Expected ${repr(expect)}`);
  }
  for (let i = pos; i < newPos; i++) {
    if (errorOn.has(src[i]!)) throw suffixedErr(src, i, `Found invalid character ${repr(src[i]!)}`);
  }
  return newPos;
}

function skipComment(src: string, pos: number) {
  if (at(src, pos) === "#") return skipUntil(src, pos + 1, "\n", ILLEGAL_COMMENT_CHARS, false);
  return pos;
}

function skipCommentsAndArrayWs(src: string, pos: number) {
  for (;;) {
    const before = pos;
    pos = skipChars(src, pos, TOML_WS_AND_NEWLINE);
    pos = skipComment(src, pos);
    if (pos === before) return pos;
  }
}

function createDictRule(src: string, pos: number, out: Output): [number, Key] {
  pos += 1;
  pos = skipChars(src, pos, TOML_WS);
  let key: Key;
  [pos, key] = parseKey(src, pos);
  if (out.flags.is(key, Flags.EXPLICIT_NEST) || out.flags.is(key, Flags.FROZEN)) {
    throw suffixedErr(src, pos, `Cannot declare ${tupleRepr(key)} twice`);
  }
  out.flags.set(key, Flags.EXPLICIT_NEST, false);
  try {
    out.data.getOrCreateNest(key);
  } catch (error) {
    if (error instanceof NoNest) throw suffixedErr(src, pos, "Cannot overwrite a value");
    throw error;
  }
  if (!src.startsWith("]", pos)) throw suffixedErr(src, pos, "Expected ']' at the end of a table declaration");
  return [pos + 1, key];
}

function createListRule(src: string, pos: number, out: Output): [number, Key] {
  pos += 2;
  pos = skipChars(src, pos, TOML_WS);
  let key: Key;
  [pos, key] = parseKey(src, pos);
  if (out.flags.is(key, Flags.FROZEN)) throw suffixedErr(src, pos, `Cannot mutate immutable namespace ${tupleRepr(key)}`);
  out.flags.unsetAll(key);
  out.flags.set(key, Flags.EXPLICIT_NEST, false);
  try {
    out.data.appendNestToList(key);
  } catch (error) {
    if (error instanceof NoNest) throw suffixedErr(src, pos, "Cannot overwrite a value");
    throw error;
  }
  if (!src.startsWith("]]", pos)) throw suffixedErr(src, pos, "Expected ']]' at the end of an array declaration");
  return [pos + 2, key];
}

function keyValueRule(src: string, pos: number, out: Output, header: Key) {
  let key: Key;
  let value: Value;
  [pos, key, value] = parseKeyValuePair(src, pos);
  const keyParent = key.slice(0, -1);
  const keyStem = key[key.length - 1]!;
  const absKeyParent = [...header, ...keyParent];
  for (let i = 1; i < key.length; i++) {
    const contKey = [...header, ...key.slice(0, i)];
    if (out.flags.is(contKey, Flags.EXPLICIT_NEST)) {
      throw suffixedErr(src, pos, `Cannot redefine namespace ${tupleRepr(contKey)}`);
    }
    out.flags.addPending(contKey, Flags.EXPLICIT_NEST);
  }
  if (out.flags.is(absKeyParent, Flags.FROZEN)) {
    throw suffixedErr(src, pos, `Cannot mutate immutable namespace ${tupleRepr(absKeyParent)}`);
  }
  let nest: Table;
  try {
    nest = out.data.getOrCreateNest(absKeyParent);
  } catch (error) {
    if (error instanceof NoNest) throw suffixedErr(src, pos, "Cannot overwrite a value");
    throw error;
  }
  if (nest.has(keyStem)) throw suffixedErr(src, pos, "Cannot overwrite a value");
  if (isTable(value) || Array.isArray(value)) out.flags.set([...header, ...key], Flags.FROZEN, true);
  nest.set(keyStem, value);
  return pos;
}

function parseKeyValuePair(src: string, pos: number): [number, Key, Value] {
  let key: Key;
  [pos, key] = parseKey(src, pos);
  if (at(src, pos) !== "=") throw suffixedErr(src, pos, "Expected '=' after a key in a key/value pair");
  pos += 1;
  pos = skipChars(src, pos, TOML_WS);
  let value: Value;
  [pos, value] = parseValue(src, pos);
  return [pos, key, value];
}

function parseKey(src: string, pos: number): [number, Key] {
  let part: string;
  [pos, part] = parseKeyPart(src, pos);
  const key: Key = [part];
  pos = skipChars(src, pos, TOML_WS);
  for (;;) {
    if (at(src, pos) !== ".") return [pos, key];
    pos += 1;
    pos = skipChars(src, pos, TOML_WS);
    [pos, part] = parseKeyPart(src, pos);
    key.push(part);
    if (key.length > MAX_KEY_PARTS) throw new KeyTooLong(`TOML key has more than the allowed ${MAX_KEY_PARTS} parts`);
    pos = skipChars(src, pos, TOML_WS);
  }
}

function parseKeyPart(src: string, pos: number): [number, string] {
  const char = at(src, pos);
  if (char !== undefined && BARE_KEY_CHARS.has(char)) {
    const start = pos;
    pos = skipChars(src, pos, BARE_KEY_CHARS);
    return [pos, src.slice(start, pos)];
  }
  if (char === "'") return parseLiteralStr(src, pos);
  if (char === '"') return parseBasicStr(src, pos + 1, false);
  throw suffixedErr(src, pos, "Invalid initial character for a key part");
}

function parseArray(src: string, pos: number): [number, Value[]] {
  pos += 1;
  const array: Value[] = [];
  pos = skipCommentsAndArrayWs(src, pos);
  if (src.startsWith("]", pos)) return [pos + 1, array];
  for (;;) {
    let value: Value;
    [pos, value] = parseValue(src, pos);
    array.push(value);
    pos = skipCommentsAndArrayWs(src, pos);
    const c = src.slice(pos, pos + 1);
    if (c === "]") return [pos + 1, array];
    if (c !== ",") throw suffixedErr(src, pos, "Unclosed array");
    pos += 1;
    pos = skipCommentsAndArrayWs(src, pos);
    if (src.startsWith("]", pos)) return [pos + 1, array];
  }
}

function parseInlineTable(src: string, pos: number): [number, Table] {
  pos += 1;
  const nested = new NestedDict();
  const flags = new Flags();
  pos = skipChars(src, pos, TOML_WS);
  if (src.startsWith("}", pos)) return [pos + 1, nested.dict];
  for (;;) {
    let key: Key;
    let value: Value;
    [pos, key, value] = parseKeyValuePair(src, pos);
    const keyStem = key[key.length - 1]!;
    if (flags.is(key, Flags.FROZEN)) throw suffixedErr(src, pos, `Cannot mutate immutable namespace ${tupleRepr(key)}`);
    let nest: Table;
    try {
      nest = nested.getOrCreateNest(key.slice(0, -1), false);
    } catch (error) {
      if (error instanceof NoNest) throw suffixedErr(src, pos, "Cannot overwrite a value");
      throw error;
    }
    if (nest.has(keyStem)) throw suffixedErr(src, pos, `Duplicate inline table key ${repr(keyStem)}`);
    nest.set(keyStem, value);
    pos = skipChars(src, pos, TOML_WS);
    const c = src.slice(pos, pos + 1);
    if (c === "}") return [pos + 1, nested.dict];
    if (c !== ",") throw suffixedErr(src, pos, "Unclosed inline table");
    if (isTable(value) || Array.isArray(value)) flags.set(key, Flags.FROZEN, true);
    pos += 1;
    pos = skipChars(src, pos, TOML_WS);
  }
}

function parseBasicStrEscape(src: string, pos: number, multiline: boolean): [number, string] {
  const escapeId = src.slice(pos, pos + 2);
  pos += 2;
  if (multiline && (escapeId === "\\ " || escapeId === "\\\t" || escapeId === "\\\n")) {
    if (escapeId !== "\\\n") {
      pos = skipChars(src, pos, TOML_WS);
      const char = at(src, pos);
      if (char === undefined) return [pos, ""];
      if (char !== "\n") throw suffixedErr(src, pos, "Unescaped '\\' in a string");
      pos += 1;
    }
    pos = skipChars(src, pos, TOML_WS_AND_NEWLINE);
    return [pos, ""];
  }
  if (escapeId === "\\u") return parseHexChar(src, pos, 4);
  if (escapeId === "\\U") return parseHexChar(src, pos, 8);
  const replacement = BASIC_STR_ESCAPE_REPLACEMENTS[escapeId];
  if (replacement === undefined) throw suffixedErr(src, pos, "Unescaped '\\' in a string");
  return [pos, replacement];
}

function parseHexChar(src: string, pos: number, hexLen: number): [number, string] {
  const hexStr = src.slice(pos, pos + hexLen);
  if (hexStr.length !== hexLen || !HEX.test(hexStr)) throw suffixedErr(src, pos, "Invalid hex value");
  pos += hexLen;
  const code = parseInt(hexStr, 16);
  if (!((0 <= code && code <= 55295) || (57344 <= code && code <= 1114111))) {
    throw suffixedErr(src, pos, "Escaped character is not a Unicode scalar value");
  }
  return [pos, String.fromCodePoint(code)];
}

function parseLiteralStr(src: string, pos: number): [number, string] {
  pos += 1;
  const start = pos;
  pos = skipUntil(src, pos, "'", ILLEGAL_LITERAL_STR_CHARS, true);
  return [pos + 1, src.slice(start, pos)];
}

function parseMultilineStr(src: string, pos: number, literal: boolean): [number, string] {
  pos += 3;
  if (src.startsWith("\n", pos)) pos += 1;
  let delim: string;
  let result: string;
  if (literal) {
    delim = "'";
    const end = skipUntil(src, pos, "'''", ILLEGAL_MULTILINE_LITERAL_STR_CHARS, true);
    result = src.slice(pos, end);
    pos = end + 3;
  } else {
    delim = '"';
    [pos, result] = parseBasicStr(src, pos, true);
  }
  if (!src.startsWith(delim, pos)) return [pos, result];
  pos += 1;
  if (!src.startsWith(delim, pos)) return [pos, result + delim];
  pos += 1;
  return [pos, result + delim + delim];
}

function parseBasicStr(src: string, pos: number, multiline: boolean): [number, string] {
  const errorOn = multiline ? ILLEGAL_MULTILINE_BASIC_STR_CHARS : ILLEGAL_BASIC_STR_CHARS;
  let result = "";
  let start = pos;
  for (;;) {
    const char = at(src, pos);
    if (char === undefined) throw suffixedErr(src, pos, "Unterminated string");
    if (char === '"') {
      if (!multiline) return [pos + 1, result + src.slice(start, pos)];
      if (src.startsWith('"""', pos)) return [pos + 3, result + src.slice(start, pos)];
      pos += 1;
      continue;
    }
    if (char === "\\") {
      result += src.slice(start, pos);
      let escaped: string;
      [pos, escaped] = parseBasicStrEscape(src, pos, multiline);
      result += escaped;
      start = pos;
      continue;
    }
    if (errorOn.has(char)) throw suffixedErr(src, pos, `Illegal character ${repr(char)}`);
    pos += 1;
  }
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Whether the date of a RE_DATETIME match exists, as Python's date() and datetime() check. */
function validDate(groups: RegExpExecArray) {
  const year = Number(groups[1]);
  const month = Number(groups[2]);
  const day = Number(groups[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && day <= (month === 2 && leap ? 29 : DAYS[month - 1]!);
}

function parseValue(src: string, pos: number): [number, Value] {
  const char = at(src, pos);
  if (char === '"') {
    if (src.startsWith('"""', pos)) return parseMultilineStr(src, pos, false);
    return parseBasicStr(src, pos + 1, false);
  }
  if (char === "'") {
    if (src.startsWith("'''", pos)) return parseMultilineStr(src, pos, true);
    return parseLiteralStr(src, pos);
  }
  if (char === "t" && src.startsWith("true", pos)) return [pos + 4, true];
  if (char === "f" && src.startsWith("false", pos)) return [pos + 5, false];
  if (char === "[") return parseArray(src, pos);
  if (char === "{") return parseInlineTable(src, pos);
  const datetime = match(RE_DATETIME, src, pos);
  if (datetime) {
    if (!validDate(datetime)) throw suffixedErr(src, pos, "Invalid date or datetime");
    return [pos + datetime[0].length, new TomlDate(datetime[0])];
  }
  const localtime = match(RE_LOCALTIME, src, pos);
  if (localtime) return [pos + localtime[0].length, new TomlDate(localtime[0])];
  const number = match(RE_NUMBER, src, pos);
  if (number) {
    const text = number[0].replaceAll("_", "");
    if (number[1]) return [pos + number[0].length, Number(text)];
    const negative = text.startsWith("-");
    const digits = text.replace(/^[+-]/, "");
    const big = BigInt(digits);
    return [pos + number[0].length, negative ? -big : big];
  }
  const firstThree = src.slice(pos, pos + 3);
  if (firstThree === "inf" || firstThree === "nan") return [pos + 3, firstThree === "inf" ? Infinity : NaN];
  const firstFour = src.slice(pos, pos + 4);
  if (["-inf", "+inf", "-nan", "+nan"].includes(firstFour)) {
    return [pos + 4, firstFour.endsWith("nan") ? NaN : firstFour.startsWith("-") ? -Infinity : Infinity];
  }
  throw suffixedErr(src, pos, "Invalid value");
}
