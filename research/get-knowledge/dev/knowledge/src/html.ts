// HTML as markdown or plain text.

import { decodeHTML, decodeHTMLAttribute } from "entities/decode";
import { BREAK, SPACE, squeeze, stripChars, rstrip, urljoin } from "./core";

const words = (text: string) => new Set(text.split(" "));
const VOID = words("area base br col embed hr img input link meta param source track wbr");
const DROP = words(
  "script style meta link noscript iframe object embed template svg canvas head title base",
);
const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const BLOCK = words(
  "address article aside blockquote body center dd details dialog dir div dl dt fieldset " +
    "figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html li main menu nav " +
    "ol p pre section summary table tbody td tfoot th thead tr ul caption",
);
const NOT_CLOSING_P = words("body html td th tr tbody thead tfoot caption");
const CLOSES_P = new Set([...BLOCK].filter((tag) => !NOT_CLOSING_P.has(tag)));
const P_SCOPE = words("table td th caption button");
const CLOSES: Record<string, [string[], string[]]> = {
  li: [["li"], ["ul", "ol", "menu", "dir"]],
  dt: [["dt", "dd"], ["dl"]],
  dd: [["dt", "dd"], ["dl"]],
  tr: [["tr"], ["table"]],
  td: [["td", "th"], ["tr", "table"]],
  th: [["td", "th"], ["tr", "table"]],
  thead: [["thead", "tbody", "tfoot"], ["table"]],
  tbody: [["thead", "tbody", "tfoot"], ["table"]],
  tfoot: [["thead", "tbody", "tfoot"], ["table"]],
  option: [["option"], ["select", "datalist"]],
};
const RICH_CELL = words("table ul ol pre blockquote h1 h2 h3 h4 h5 h6 hr dl");
const CHROME_CLASSES = words("mw-editsection noprint navbox vector-dropdown");
/** Elements whose text is not markup: raw, or with only character references. */
const RAW_TEXT = words("script style xmp iframe noembed noframes");
const ESCAPABLE_RAW_TEXT = words("title textarea");
const MAX_DEPTH = 200;
const STRIPPED = " \t\r\n\f\v\xa0";

type Child = Node | string;

export class Node {
  children: Child[] = [];
  depth: number;
  private blockyCache: boolean | null = null;
  private sizeCache: number | null = null;

  constructor(
    readonly tag: string,
    readonly attrs: Record<string, string>,
    readonly parent: Node | null,
  ) {
    this.depth = parent ? parent.depth + 1 : 0;
  }

  attr(name: string) {
    return this.attrs[name] ?? "";
  }

  /** This node and every element inside it, in document order. */
  *walk(): Generator<Node> {
    const stack: Node[] = [this];
    while (stack.length) {
      const node = stack.pop()!;
      yield node;
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]!;
        if (child instanceof Node) stack.push(child);
      }
    }
  }

  /** Whether a block element is somewhere inside. */
  blocky(): boolean {
    if (this.blockyCache === null) {
      this.blockyCache = this.children.some(
        (child) =>
          child instanceof Node && !DROP.has(child.tag) && (BLOCK.has(child.tag) || child.blocky()),
      );
    }
    return this.blockyCache;
  }

  /** How much readable text is inside. */
  size(): number {
    if (this.sizeCache === null) {
      let total = 0;
      for (const child of this.children) {
        if (typeof child === "string") total += child.trim().length;
        else if (!DROP.has(child.tag)) total += child.size();
      }
      this.sizeCache = total;
    }
    return this.sizeCache;
  }
}

/** A forgiving element tree: enough of the HTML rules to nest lists, tables and
 * paragraphs the way a browser does. */
class Tree {
  root = new Node("root", {}, null);
  here = this.root;

  close(tags: string[], scope: Set<string> | string[]) {
    const inScope = (tag: string) => (scope instanceof Set ? scope.has(tag) : scope.includes(tag));
    let node: Node | null = this.here;
    while (node && node !== this.root && !inScope(node.tag)) {
      if (tags.includes(node.tag)) {
        this.here = node.parent!;
        return;
      }
      node = node.parent;
    }
  }

  start(tag: string, attrs: Record<string, string>) {
    if (CLOSES_P.has(tag)) this.close(["p"], P_SCOPE);
    if (tag in CLOSES) this.close(...CLOSES[tag]!);
    const node = new Node(tag, attrs, this.here);
    this.here.children.push(node);
    if (!VOID.has(tag) && node.depth < MAX_DEPTH) this.here = node;
  }

  startEnd(tag: string, attrs: Record<string, string>) {
    this.start(tag, attrs);
    if (this.here.tag === tag && !VOID.has(tag)) this.here = this.here.parent!;
  }

  end(tag: string) {
    let node: Node | null = this.here;
    while (node && node !== this.root) {
      if (node.tag === tag) {
        this.here = node.parent!;
        return;
      }
      node = node.parent;
    }
  }

  data(text: string) {
    if (text) this.here.children.push(text);
  }
}

const TAG_NAME = /[a-zA-Z][^\t\n\r\f />\x00]*/y;
const ATTR_NAME = /[^\t\n\r\f />][^\t\n\r\f /=>]*/y;
const UNQUOTED = /[^\t\n\r\f >]*/y;
const BLANK = /[\t\n\r\f /]*/y;
const WHITE = /[\t\n\r\f ]*/y;

function match(pattern: RegExp, text: string, at: number) {
  pattern.lastIndex = at;
  const found = pattern.exec(text);
  return found ? found[0] : "";
}

/** A start tag at `at`, where text[at] is "<": its name, attributes, whether it
 * closes itself, and where it ends; or null when the document ends inside it. */
function startTag(text: string, at: number) {
  const name = match(TAG_NAME, text, at + 1);
  let position = at + 1 + name.length;
  const attrs: Record<string, string> = {};
  while (true) {
    position += match(BLANK, text, position).length;
    if (position >= text.length) return null;
    if (text[position] === ">") {
      const closing = text[position - 1] === "/" && position - 1 > at + name.length;
      return { name: name.toLowerCase(), attrs, closing, end: position + 1 };
    }
    const key = match(ATTR_NAME, text, position) || text[position]!;
    position += key.length;
    position += match(WHITE, text, position).length;
    let value = "";
    if (text[position] === "=") {
      position++;
      position += match(WHITE, text, position).length;
      const quote = text[position];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, position + 1);
        if (close < 0) return null;
        value = text.slice(position + 1, close);
        position = close + 1;
      } else {
        value = match(UNQUOTED, text, position);
        position += value.length;
      }
    }
    const lower = key.toLowerCase();
    if (!(lower in attrs)) attrs[lower] = decodeHTMLAttribute(value);
  }
}

/** Read the document into the tree, the way Python's HTMLParser reads it. */
function tokenize(text: string, tree: Tree) {
  let position = 0;
  let pending = "";
  const flush = () => {
    if (pending) tree.data(decodeHTML(pending));
    pending = "";
  };
  while (position < text.length) {
    const open = text.indexOf("<", position);
    if (open < 0) {
      pending += text.slice(position);
      break;
    }
    pending += text.slice(position, open);
    position = open;
    const next = text[open + 1] ?? "";
    if (/[a-zA-Z]/.test(next)) {
      const tag = startTag(text, open);
      if (!tag) {
        pending += text.slice(open);
        break;
      }
      flush();
      position = tag.end;
      if (tag.closing) {
        tree.startEnd(tag.name, tag.attrs);
        continue;
      }
      tree.start(tag.name, tag.attrs);
      if (RAW_TEXT.has(tag.name) || ESCAPABLE_RAW_TEXT.has(tag.name)) {
        const closer = new RegExp(`</${tag.name}(?=[\\t\\n\\r\\f />])`, "ig");
        closer.lastIndex = position;
        const found = closer.exec(text);
        const end = found ? found.index : text.length;
        const inner = text.slice(position, end);
        tree.data(ESCAPABLE_RAW_TEXT.has(tag.name) ? decodeHTML(inner) : inner);
        position = end;
      }
    } else if (next === "/") {
      const closeAt = text.indexOf(">", open + 2);
      flush();
      if (closeAt < 0) {
        position = text.length;
        break;
      }
      const name = match(TAG_NAME, text, open + 2);
      if (name) tree.end(name.toLowerCase());
      position = closeAt + 1;
    } else if (text.startsWith("<!--", open)) {
      flush();
      const end = text.indexOf("-->", open + 4);
      position = end < 0 ? text.length : end + 3;
    } else if (next === "!" || next === "?") {
      flush();
      const end = text.indexOf(">", open + 2);
      position = end < 0 ? text.length : end + 1;
    } else {
      pending += "<";
      position = open + 1;
    }
  }
  flush();
}

export function parseHtml(text: string) {
  const tree = new Tree();
  tokenize(text.split(BREAK).join(""), tree);
  return tree.root;
}

/** Inline markdown as final text: one space between words, real line breaks. */
function tidy(text: string) {
  const lines = text
    .replace(SPACE, " ")
    .split(BREAK)
    .map((line) => line.trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Put a mark around text, keeping the spaces at its ends outside the mark. */
function around(inner: string, mark: string) {
  const core = stripChars(inner, STRIPPED + BREAK);
  if (!core) return inner;
  const start = inner.indexOf(core);
  return inner.slice(0, start) + mark + core + mark + inner.slice(start + core.length);
}

function rawText(node: Node): string {
  let text = "";
  for (const child of node.children) {
    if (typeof child === "string") text += child;
    else if (child.tag === "br") text += "\n";
    else if (!DROP.has(child.tag)) text += rawText(child);
  }
  return text;
}

function pageTitle(root: Node) {
  for (const node of root.walk()) {
    if (node.tag !== "title") continue;
    let above = node.parent;
    while (above && above.tag !== "svg") above = above.parent;
    const title = squeeze(node.children.filter((child) => typeof child === "string").join(""));
    if (!above && title) return title;
  }
  return "";
}

function pageBase(root: Node, url: string) {
  for (const node of root.walk()) {
    if (node.tag === "base" && node.attr("href").trim()) return urljoin(url, node.attr("href").trim());
  }
  return url;
}

function largest(nodes: Node[]) {
  return nodes.reduce((best, node) => (node.size() > best.size() ? node : best));
}

/** The element that holds the page's own content, when the page marks one. */
function mainPart(root: Node) {
  const mains: Node[] = [];
  const articles: Node[] = [];
  for (const node of root.walk()) {
    if (node.tag === "main" || node.attr("role") === "main") mains.push(node);
    else if (node.tag === "article") articles.push(node);
  }
  if (mains.length) {
    const best = largest(mains);
    if (best.size() >= 200) return best;
  }
  if (articles.length) {
    const best = largest(articles);
    if (best.size() >= 200 && best.size() * 2 >= root.size()) return best;
  }
  return null;
}

type Kind = "text" | "list" | "code";
type Block = [Kind, string];

class Markdown {
  leftOut = false;

  constructor(
    readonly base: string,
    readonly wholePage: boolean,
  ) {}

  skipped = (node: Node) => {
    if (DROP.has(node.tag) || node.attr("aria-hidden") === "true") return true;
    if (this.wholePage) return false;
    if (
      node.tag === "nav" ||
      node.attr("role") === "navigation" ||
      node.attr("class").split(/\s+/).some((name) => CHROME_CLASSES.has(name))
    ) {
      this.leftOut = true;
      return true;
    }
    return false;
  };

  render(node: Node) {
    return this.flow(node.children)
      .map(([, text]) => text)
      .join("\n\n");
  }

  /** Block content: a list of [kind, text], kind being text, list or code. */
  flow(children: Child[]): Block[] {
    const blocks: Block[] = [];
    let pending: string[] = [];
    const flush = () => {
      const text = tidy(pending.join(""));
      pending = [];
      if (text) blocks.push(["text", text]);
    };
    for (const child of children) {
      if (typeof child === "string") {
        pending.push(child);
        continue;
      }
      if (this.skipped(child)) continue;
      const tag = child.tag;
      if (!BLOCK.has(tag)) {
        if (child.blocky() && tag !== "a") {
          flush();
          blocks.push(...this.flow(child.children));
        } else {
          pending.push(this.inline(child));
        }
        continue;
      }
      flush();
      if (tag in HEADINGS) {
        let text = tidy(this.inlineAll(child)).replace(/\n/g, " ");
        text = text.replace(/\s*[\xb6#\xa7]+$/, "");
        if (text) blocks.push(["text", "#".repeat(HEADINGS[tag]!) + " " + text]);
      } else if (tag === "hr") {
        blocks.push(["text", "---"]);
      } else if (tag === "pre") {
        const code = this.pre(child);
        if (code) blocks.push(["code", code]);
      } else if (tag === "blockquote") {
        const inner = this.render(child);
        if (inner) {
          const quoted = inner
            .split("\n")
            .map((line) => ">" + (line ? " " + line : ""))
            .join("\n");
          blocks.push(["text", quoted]);
        }
      } else if (["ul", "ol", "menu", "dir"].includes(tag)) {
        const text = this.listing(child);
        if (text) blocks.push(["list", text]);
      } else if (tag === "li") {
        const text = this.item(child.children, "- ");
        if (text) blocks.push(["list", text]);
      } else if (tag === "table") {
        blocks.push(...this.table(child));
      } else if (tag === "dt") {
        const text = tidy(this.inlineAll(child));
        if (text) blocks.push(["text", around(text, "**")]);
      } else {
        blocks.push(...this.flow(child.children));
      }
    }
    flush();
    return blocks;
  }

  inlineAll(node: Node) {
    return node.children.map((child) => this.inline(child)).join("");
  }

  inline(node: Child): string {
    if (typeof node === "string") return node;
    if (this.skipped(node)) return "";
    const tag = node.tag;
    if (tag === "br") return BREAK;
    if (tag === "img") return this.image(node);
    if (tag === "math") return this.math(node);
    if (tag === "pre") return " `" + squeeze(rawText(node)).replace(/`/g, "'") + "` ";
    const inner = this.inlineAll(node);
    if (tag === "strong" || tag === "b") return around(inner, "**");
    if (tag === "em" || tag === "i") return around(inner, "*");
    if (tag === "del" || tag === "s" || tag === "strike") return around(inner, "~~");
    if (["code", "kbd", "samp", "tt"].includes(tag)) {
      const text = squeeze(inner.split(BREAK).join(" "));
      if (!text) return inner;
      return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
    }
    if (tag === "a") return this.link(node, inner);
    if (BLOCK.has(tag)) return " " + inner + " ";
    return inner;
  }

  link(node: Node, inner: string) {
    const href = node.attr("href").trim();
    const text = squeeze(inner.split(BREAK).join(" "));
    if (!text) return "";
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) {
      return ["\xb6", "#", "\xa7"].includes(text) ? "" : inner;
    }
    let url = urljoin(this.base, href);
    if (/[\s()<>]/.test(url)) url = `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
    const edge = " \t\r\n" + BREAK;
    const lead = inner && edge.includes(inner[0]!) ? " " : "";
    const trail = inner && edge.includes(inner[inner.length - 1]!) ? " " : "";
    return `${lead}[${text}](${url})${trail}`;
  }

  /** A formula once, as TeX when the page gives it, and not symbol by symbol. */
  math(node: Node) {
    for (const inner of node.walk()) {
      if (inner.tag === "annotation" && inner.attr("encoding").toLowerCase().includes("tex")) {
        const tex = squeeze(rawText(inner));
        if (tex) return ` $${tex}$ `;
      }
    }
    return ` ${squeeze(node.attr("alttext") || rawText(node))} `;
  }

  image(node: Node) {
    const alt = squeeze(node.attr("alt"));
    const source = (node.attrs.src || node.attrs["data-src"] || "").trim();
    if (!source || source.toLowerCase().startsWith("data:")) return alt;
    return `![${alt}](${urljoin(this.base, source)})`;
  }

  pre(node: Node) {
    let language = "";
    const aroundIt = [node.parent, node.parent?.parent].filter((above): above is Node => !!above);
    for (const inner of [...node.walk(), ...aroundIt]) {
      const brush = /brush:\s*([\w+#.-]+)/.exec(inner.attr("class"));
      if (brush) {
        language = brush[1]!;
        break;
      }
      for (const name of inner.attr("class").split(/\s+/)) {
        const found = /^(?:language|lang|highlight-source|highlight)-([\w+#.-]+)$/.exec(name);
        if (found && !["default", "none", "text"].includes(found[1]!)) {
          language = found[1]!;
          break;
        }
      }
      language = language || inner.attr("data-language") || inner.attr("data-lang");
      if (language) break;
    }
    const text = rstrip(stripChars(rawText(node).replace(/\r\n/g, "\n"), "\n"));
    if (!text.trim()) return "";
    let fence = "```";
    while (text.includes(fence)) fence += "`";
    return `${fence}${squeeze(language)}\n${text}\n${fence}`;
  }

  item(children: Child[], marker: string) {
    const blocks = this.flow(children);
    if (!blocks.length) return "";
    let body = blocks[0]![1];
    for (let index = 1; index < blocks.length; index++) {
      const before = blocks[index - 1]![0];
      const [kind, text] = blocks[index]!;
      body += (before === "list" || kind === "list" ? "\n" : "\n\n") + text;
    }
    const pad = " ".repeat(marker.length);
    const lines = body.split("\n");
    return (
      marker + lines[0] + lines.slice(1).map((line) => "\n" + (line ? pad + line : "")).join("")
    );
  }

  listing(node: Node) {
    const ordered = node.tag === "ol";
    const start = node.attr("start").trim();
    let number = /^-?\d{1,9}$/.test(start) ? parseInt(start, 10) : 1;
    const items: string[] = [];
    for (const child of node.children) {
      let content: Child[];
      if (typeof child === "string") {
        if (!child.trim()) continue;
        content = [child];
      } else if (this.skipped(child)) {
        continue;
      } else if (child.tag === "li") {
        content = child.children;
      } else {
        content = [child];
      }
      const text = this.item(content, ordered ? `${number}. ` : "- ");
      if (text) {
        items.push(text);
        number++;
      }
    }
    return items.join("\n");
  }

  table(node: Node): Block[] {
    const blocks: Block[] = [];
    const rows: Node[] = [];
    for (const child of node.children) {
      if (!(child instanceof Node) || this.skipped(child)) continue;
      if (child.tag === "caption") {
        const text = tidy(this.inlineAll(child));
        if (text) blocks.push(["text", around(text, "**")]);
      } else if (child.tag === "tr") {
        rows.push(child);
      } else if (["thead", "tbody", "tfoot"].includes(child.tag)) {
        for (const row of child.children) {
          if (row instanceof Node && row.tag === "tr") rows.push(row);
        }
      }
    }
    const cells = rows
      .map((row) =>
        row.children.filter(
          (cell): cell is Node => cell instanceof Node && (cell.tag === "td" || cell.tag === "th"),
        ),
      )
      .filter((row) => row.length);
    if (!cells.length) {
      return blocks.concat(
        this.flow(
          node.children.filter(
            (child) => child instanceof Node && !["caption", "colgroup", "col"].includes(child.tag),
          ),
        ),
      );
    }
    const rich = cells.some((row) =>
      row.some((cell) => [...cell.walk()].some((inner) => RICH_CELL.has(inner.tag))),
    );
    if (rich || Math.max(...cells.map((row) => row.length)) < 2) {
      for (const row of cells) for (const cell of row) blocks.push(...this.flow(cell.children));
      return blocks;
    }
    const lines = cells.map((row) => {
      const texts: string[] = [];
      for (const cell of row) {
        texts.push(tidy(this.inlineAll(cell)).replace(/\n/g, " ").replace(/\|/g, "\\|"));
        const span = cell.attr("colspan").trim();
        if (/^\d+$/.test(span)) {
          for (let extra = 1; extra < Math.min(parseInt(span, 10), 50); extra++) texts.push("");
        }
      }
      return texts;
    });
    const width = Math.max(...lines.map((line) => line.length));
    const table: string[] = [];
    lines.forEach((texts, index) => {
      const padded = texts.concat(Array(width - texts.length).fill(""));
      table.push("| " + padded.join(" | ") + " |");
      if (index === 0) table.push("|" + " --- |".repeat(width));
    });
    blocks.push(["text", table.join("\n")]);
    return blocks;
  }
}

function plainText(node: Node, skipped: (node: Node) => boolean, parts: string[]) {
  for (const child of node.children) {
    if (typeof child === "string") {
      parts.push(child.replace(SPACE, " "));
    } else if (skipped(child)) {
      continue;
    } else if (child.tag === "br") {
      parts.push("\n");
    } else if (child.tag === "pre") {
      parts.push("\n\n" + stripChars(rawText(child), "\n") + "\n\n");
    } else if (BLOCK.has(child.tag)) {
      parts.push("\n\n");
      plainText(child, skipped, parts);
      parts.push("\n\n");
    } else {
      plainText(child, skipped, parts);
    }
  }
}

/** HTML as markdown or text: [title, content, whether the page was cut to its main
 * content]. */
export function convertHtml(
  html: string,
  url: string,
  format: string,
  wholePage: boolean,
): [string, string, boolean] {
  const root = parseHtml(html);
  const writer = new Markdown(pageBase(root, url), wholePage);
  const start = wholePage ? null : mainPart(root);
  let content: string;
  if (format === "text") {
    const parts: string[] = [];
    plainText(start ?? root, writer.skipped, parts);
    const text = parts.join("").replace(/[ \t]*\n[ \t]*/g, "\n");
    content = text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    content = writer.render(start ?? root);
  }
  if (start && !content.trim()) return convertHtml(html, url, format, true);
  return [pageTitle(root), content, start !== null || writer.leftOut];
}
