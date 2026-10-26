// How a saved test log reports one test: a JUnit XML report, or the lines a test runner prints.

import { SaxesParser, type SaxesTagNS } from "saxes";
import { EDGE, WORD, escapeRegExp, lstrip, splitLines } from "./core";

export type State = "passed" | "failed" | "skipped" | "unknown" | "absent";

const FAIL = new RegExp(
  `not ok${EDGE}|${EDGE}FAIL(ED|URE)?${EDGE}|${EDGE}failed${EDGE}|${EDGE}ERROR${EDGE}|${EDGE}panicked${EDGE}|[✗✕✘×]`,
  "u",
);
// Matched against pyLower(text), which is how Python's IGNORECASE compares letters.
const SKIP = new RegExp(`${EDGE}(ignored|skipped|skip(ped)?|pending|todo|disabled)${EDGE}|[○↓]`, "u");

/**
 * Each character in its simple lower case, as Python's IGNORECASE compares them, with the two
 * letters Python also takes for i and s in such a match: dotless i and long s.
 */
function pyLower(text: string) {
  let lowered = "";
  for (const char of text) {
    const lower = char === "\u0130" ? "i" : char.toLowerCase();
    lowered += Array.from(lower).length === 1 ? lower : char;
  }
  return lowered.replace(/\u0131/g, "i").replace(/\u017f/g, "s");
}
const PASS = new RegExp(`${EDGE}ok${EDGE}|${EDGE}PASS(ED)?${EDGE}|${EDGE}passed${EDGE}|[✓✔√]`, "u");

/** One state out of several: the worst one within a log, the best one across logs. */
export function best(states: Iterable<State>, worstFirst = false): State {
  const found = new Set(states);
  const order: State[] = worstFirst
    ? ["failed", "skipped", "passed", "unknown"]
    : ["passed", "failed", "skipped", "unknown"];
  return order.find((state) => found.has(state)) ?? "absent";
}

/** How a test log reports one test: passed, failed, skipped, unknown or absent. */
export function testState(name: string, log: string): State {
  if (lstrip(log).startsWith("<")) {
    const state = junitState(name, log);
    if (state) return state;
  }
  const named = new RegExp(`(?<!${WORD})${escapeRegExp(name)}(?![\\p{L}\\p{N}_./-])`, "gu");
  const states = new Set<State>();
  for (const line of splitLines(log)) {
    named.lastIndex = 0;
    if (!named.test(line)) continue;
    const rest = line.replace(named, () => " ");
    if (FAIL.test(rest)) states.add("failed");
    else if (SKIP.test(pyLower(rest))) states.add("skipped");
    else if (PASS.test(rest)) states.add("passed");
    else states.add("unknown");
  }
  return best(states, true);
}

type Element = { tag: string; attributes: Map<string, string>; children: string[] };

/** The elements of an XML document in document order, or null when it is not well-formed XML. */
export function parseXml(text: string): Element[] | null {
  const parser = new SaxesParser({ xmlns: true });
  const elements: Element[] = [];
  const open: Element[] = [];
  let broken = false;
  parser.on("error", (error) => {
    // Python's parser takes any XML version number; every other error ends the parse.
    if (!error.message.includes("version number must match")) broken = true;
  });
  parser.on("doctype", (doctype) => {
    // Entities declared in the document's own DTD, which Python's parser expands.
    const declared = /<!ENTITY\s+([^\s%"'>]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
    for (const found of doctype.matchAll(declared)) {
      const replacement = (found[2] ?? found[3] ?? "").replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (_, code: string) =>
        String.fromCodePoint(code[0] === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10)),
      );
      parser.ENTITIES[found[1]!] = replacement;
    }
  });
  parser.on("opentag", (node: SaxesTagNS) => {
    const tag = (uri: string, local: string) => (uri ? `{${uri}}${local}` : local);
    const attributes = new Map<string, string>();
    for (const attribute of Object.values(node.attributes)) {
      if (attribute.prefix === "xmlns" || (attribute.prefix === "" && attribute.local === "xmlns")) continue;
      attributes.set(tag(attribute.uri, attribute.local), attribute.value);
    }
    const element: Element = { tag: tag(node.uri, node.local), attributes, children: [] };
    open.at(-1)?.children.push(element.tag);
    open.push(element);
    elements.push(element);
  });
  parser.on("closetag", () => void open.pop());
  try {
    parser.write(text).close();
  } catch {
    return null;
  }
  return broken || !elements.length ? null : elements;
}

/** How a JUnit XML report gives one test; null when the log is not XML. */
export function junitState(name: string, log: string): State | null {
  const elements = parseXml(log);
  if (!elements) return null;
  const states = new Set<State>();
  for (const element of elements) {
    if (element.tag !== "testcase") continue;
    const own = element.attributes.get("name") ?? "";
    const joined = `${element.attributes.get("classname") ?? ""}.${own}`;
    if (name !== own && name !== joined && !joined.endsWith("." + name) && !joined.endsWith("::" + name)) continue;
    const children = new Set(element.children);
    if (children.has("failure") || children.has("error")) states.add("failed");
    else if (children.has("skipped")) states.add("skipped");
    else states.add("passed");
  }
  return states.size ? best(states, true) : "absent";
}
