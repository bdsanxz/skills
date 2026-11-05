// The CLI's output format: KDL (https://kdl.dev, v2) in the JSON-in-KDL ("JiK") mapping, so any
// JSON value round-trips. One KDL node per line: an object's plain fields sit on its line as
// properties (`- id="1:2" name=Card type=FRAME`), nested objects and arrays become child blocks,
// and array items are nodes named `-`. That keeps a node and its properties on one greppable line.
// The root object is written as top-level nodes, one per field.

import { parse } from "@bgotink/kdl";
import { toJson } from "@bgotink/kdl/json";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const RESERVED = new Set(["true", "false", "null", "inf", "-inf", "nan"]);
const BARE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// Code points KDL forbids or treats as newlines inside a single-line string, plus controls.
const ESCAPE = /[\u0000-\u001F\u007F\u0085\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF"\\]/g;

function quote(s: string): string {
  return `"${s.replace(ESCAPE, (c) => {
    switch (c) {
      case '"':
        return '\\"';
      case "\\":
        return "\\\\";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\u{${c.codePointAt(0)!.toString(16)}}`;
    }
  })}"`;
}

const name = (s: string) => (s === "-" || (BARE.test(s) && !RESERVED.has(s)) ? s : quote(s));

function literal(v: Json): string {
  if (v === null) return "#null";
  if (typeof v === "boolean") return v ? "#true" : "#false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "#null";
  return name(String(v));
}

const isLiteral = (v: unknown): v is null | boolean | number | string => v === null || typeof v !== "object";

function node(key: string, v: Json, indent: string, lines: string[]): void {
  if (isLiteral(v)) {
    lines.push(`${indent}${name(key)} ${literal(v)}`);
    return;
  }
  if (Array.isArray(v)) {
    if (v.every(isLiteral)) {
      lines.push(`${indent}(array)${name(key)}${v.map((x) => " " + literal(x)).join("")}`);
      return;
    }
    lines.push(`${indent}(array)${name(key)} {`);
    for (const item of v) node("-", item, indent + "  ", lines);
    lines.push(`${indent}}`);
    return;
  }
  const entries = Object.entries(v);
  const props = entries.filter(([, x]) => isLiteral(x));
  const kids = entries.filter(([, x]) => !isLiteral(x));
  const head = `${indent}${entries.length ? "" : "(object)"}${name(key)}${props.map(([k, x]) => ` ${name(k)}=${literal(x)}`).join("")}`;
  if (!kids.length) {
    lines.push(head);
    return;
  }
  lines.push(`${head} {`);
  for (const [k, x] of kids) node(k, x, indent + "  ", lines);
  lines.push(`${indent}}`);
}

export function encode(value: unknown): string {
  const v = JSON.parse(JSON.stringify(value ?? null)) as Json;
  const lines: string[] = [];
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) node(k, x, "", lines);
  else node("-", v, "", lines);
  return lines.join("\n");
}

// One value as an array item (`- ...`), for streams such as `logs --follow`: each printed item is
// a complete KDL node, and the stream as a whole stays one valid document.
export function encodeItem(value: unknown): string {
  const lines: string[] = [];
  node("-", JSON.parse(JSON.stringify(value ?? null)) as Json, "", lines);
  return lines.join("\n");
}

export function decode(text: string): any {
  const doc = parse(text);
  if (doc.nodes.length === 1 && doc.nodes[0]!.getName() === "-") return toJson(doc.nodes[0]!);
  const outObj: Record<string, unknown> = {};
  for (const n of doc.nodes) outObj[n.getName()] = toJson(n);
  return outObj;
}
