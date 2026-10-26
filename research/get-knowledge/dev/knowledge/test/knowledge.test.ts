// Tests for the knowledge script. Run: bun test (in dev/knowledge)
//
// Every test uses its own home directory and a web server on this machine; nothing
// leaves the machine. The last tests run the built scripts/knowledge.js.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME_ENV, bounds, home, io } from "../src/core";
import { directSource, fetched, sources } from "../src/fetch";
import { Answer } from "../src/http";
import { convertHtml } from "../src/html";
import { HANDOFF, MAX_CHILDREN, cachePath, parseRepository } from "../src/references";
import { NO_RESULTS, endpoints, isLimit, parallelQuery } from "../src/search";
import { main } from "../src/commands";
import {
  nowStamp,
  pageNumber,
  parsePage,
  readWiki,
  saveTopic,
  searchWiki,
  slugify,
  splitPages,
  tokenize,
  urlTopic,
} from "../src/wiki";

const SCRIPT = path.resolve(import.meta.dir, "..", "..", "..", "scripts", "knowledge.js");
const KEY_NAMES = ["EXA_API_KEY", "KEENABLE_API_KEY", "PARALLEL_API_KEY"];

type Seen = { method: string; path: string; body: string; headers: Record<string, string> };
type Route = [number, Record<string, string>, string | Uint8Array];
type Handler = Route | ((request: Seen) => Route | Promise<Route>);

// ------------------------------------------------------------------------- harness

let homeDir = "";
let saved: Record<string, string | undefined> = {};
let savedEndpoints = { ...endpoints };
let server: ReturnType<typeof Bun.serve>;
let routes: Record<string, Handler> = {};
let seen: Seen[] = [];
let base = "";
const cleanups: (() => void)[] = [];

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-home-"));
  saved = Object.fromEntries([HOME_ENV, ...KEY_NAMES].map((name) => [name, process.env[name]]));
  process.env[HOME_ENV] = homeDir;
  for (const name of KEY_NAMES) delete process.env[name];
  routes = {};
  seen = [];
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const entry: Seen = {
        method: request.method,
        path: url.pathname + url.search,
        body: await request.text(),
        headers: Object.fromEntries(request.headers.entries()),
      };
      seen.push(entry);
      let route = routes[url.pathname];
      if (typeof route === "function") route = await route(entry);
      const [status, headers, payload] = route ?? [404, { "Content-Type": "text/plain" }, "not here"];
      const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
      return new Response(bytes, { status, headers });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  savedEndpoints = { ...endpoints };
  Object.assign(endpoints, {
    exaMcp: base + "/exa-mcp",
    exaRest: base + "/exa-rest",
    keenable: base + "/keenable",
    keenablePublic: base + "/keenable-public",
    parallel: base + "/parallel",
    parallelMcp: base + "/parallel-mcp",
  });
});

afterEach(() => {
  server.stop(true);
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  Object.assign(endpoints, savedEndpoints);
  bounds.minFetchSeconds = 30;
  sources.direct = directSource;
  while (cleanups.length) cleanups.pop()!();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<[number, string, string]> {
  const out: string[] = [];
  const err: string[] = [];
  const kept = { ...io };
  io.out = (text) => void out.push(text + "\n");
  io.err = (text) => void err.push(text + "\n");
  try {
    return [await main(args), out.join(""), err.join("")];
  } finally {
    Object.assign(io, kept);
  }
}

async function ok(...args: string[]) {
  const [code, out, err] = await run(...args);
  if (code !== 0) throw new Error(`exit ${code}\n${out}\n${err}`);
  return out;
}

function serve(
  route: string,
  body: string | Uint8Array,
  contentType = "text/html; charset=utf-8",
  status = 200,
  headers: Record<string, string> = {},
) {
  routes[route] = [status, { "Content-Type": contentType, ...headers }, body];
  return base + route;
}

function wiki() {
  const root = path.join(homeDir, "wikis");
  return fs.existsSync(root) ? fs.readdirSync(root).filter((name) => name.endsWith(".md")).sort() : [];
}

function page(name: string) {
  return parsePage(fs.readFileSync(path.join(homeDir, "wikis", name), "utf8"))!;
}

function writeSettings(value: unknown) {
  fs.writeFileSync(path.join(homeDir, "settings.json"), typeof value === "string" ? value : JSON.stringify(value));
}

function tempDir(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const sent = (route: string) => seen.filter((request) => request.path === route);
const markdown = (html: string, url = "https://site.test/docs/page", whole = false, format = "markdown") =>
  convertHtml(html, url, format, whole)[1];
const wikis = () => path.join(homeDir, "wikis");

// ------------------------------------------------------------------------- html

describe("html", () => {
  test("headings, paragraphs and inline marks", () => {
    const text = markdown(
      "<h1>Title</h1><p>One <b>bold</b>, <em>soft</em>, <code>x = 1</code> " +
        "and <del>gone</del>.</p><h3>Sub</h3><p>Two<br>lines</p><hr>",
    );
    expect(text).toBe("# Title\n\nOne **bold**, *soft*, `x = 1` and ~~gone~~.\n\n### Sub\n\nTwo\nlines\n\n---");
  });

  test("spaces stay outside marks", () => {
    expect(markdown("<p>a<b> b </b>c</p>")).toBe("a **b** c");
  });

  test("links become absolute and page anchors are dropped", () => {
    const text = markdown(
      '<p><a href="/a/b">rel</a> <a href="c?d=1">near</a> <a href="https://x.test/y">abs</a> ' +
        '<a href="#top">jump</a> <a href="javascript:void(0)">js</a> <a href="/empty"></a></p>',
    );
    expect(text).toBe("[rel](https://site.test/a/b) [near](https://site.test/docs/c?d=1) [abs](https://x.test/y) jump js");
  });

  test("a base element changes where links point", () => {
    expect(markdown('<head><base href="https://cdn.test/root/"></head><a href="x">x</a>')).toBe(
      "[x](https://cdn.test/root/x)",
    );
  });

  test("a link with brackets in the URL is wrapped", () => {
    expect(markdown('<a href="/wiki/A_(b)">a</a>')).toBe("[a](<https://site.test/wiki/A_(b)>)");
  });

  test("heading anchor marks are removed", () => {
    expect(markdown('<h2>Install<a href="#install">\xb6</a></h2>')).toBe("## Install");
  });

  test("images", () => {
    const text = markdown('<p><img src="/i.png" alt="A  chart"> <img src="data:image/png;base64,AA" alt="dot"> <img alt="nothing"></p>');
    expect(text).toBe("![A chart](https://site.test/i.png) dot nothing");
  });

  test("lists nest and number", () => {
    const text = markdown(
      "<ul><li>one<ul><li>inner a<li>inner b</ul></li><li>two</li></ul>" +
        "<ol start='3'><li>three</li><li><p>four</p><p>more</p></li></ol>",
    );
    expect(text).toBe("- one\n  - inner a\n  - inner b\n- two\n\n3. three\n4. four\n\n   more");
  });

  test("unclosed paragraphs and items are closed like a browser does", () => {
    expect(markdown("<p>a<p>b<div>c</div>")).toBe("a\n\nb\n\nc");
    expect(markdown("<ul><li>a<li>b<li>c</ul>")).toBe("- a\n- b\n- c");
  });

  test("a code block keeps its text and language", () => {
    const text = markdown('<pre><code class="language-python">def f():\n    return "&lt;b&gt;"\n</code></pre>');
    expect(text).toBe('```python\ndef f():\n    return "<b>"\n```');
  });

  test("a code block's language from the wrapper", () => {
    expect(markdown('<div class="highlight-shell notranslate"><div class="highlight"><pre>ls -la</pre></div></div>')).toBe(
      "```shell\nls -la\n```",
    );
    expect(markdown('<pre class="brush: js notranslate">let a;</pre>')).toBe("```js\nlet a;\n```");
  });

  test("a code block with a fence inside gets a longer fence", () => {
    expect(markdown("<pre>```\ninner\n```</pre>")).toBe("````\n```\ninner\n```\n````");
  });

  test("inline code with a backtick", () => {
    expect(markdown("<p><code>a`b</code></p>")).toBe("`` a`b ``");
  });

  test("blockquote", () => {
    expect(markdown("<blockquote><p>a</p><p>b</p></blockquote>")).toBe("> a\n>\n> b");
  });

  test("a table becomes a pipe table", () => {
    const text = markdown(
      "<table><thead><tr><th>Name<th>Use</tr></thead><tbody>" +
        "<tr><td>a|b<td><code>x</code></tr><tr><td colspan=2>wide</td></tr></tbody></table>",
    );
    expect(text).toBe("| Name | Use |\n| --- | --- |\n| a\\|b | `x` |\n| wide |  |");
  });

  test("a table with lists or one column is read as blocks", () => {
    expect(markdown("<table><tr><td><ul><li>a</li></ul></td><td>b</td></tr></table>")).toBe("- a\n\nb");
    expect(markdown("<table><tr><td>only</td></tr></table>")).toBe("only");
  });

  test("scripts, styles and hidden decoration are dropped", () => {
    const text = markdown(
      "<p>keep</p><script>var a = '<p>no</p>';</script><style>p{}</style>" +
        "<noscript>no</noscript><svg><title>no</title></svg>" +
        '<span aria-hidden="true">no</span><template><p>no</p></template>',
    );
    expect(text).toBe("keep");
  });

  test("the main content is kept and the rest dropped", () => {
    const html =
      "<title>Doc</title><header><a href='/'>Home</a></header><nav><a href='/a'>A</a></nav>" +
      "<main><h1>Doc</h1><p>" + "word ".repeat(60) + "</p><nav>on this page</nav></main><footer>Legal</footer>";
    let [title, text, trimmed] = convertHtml(html, "https://site.test/", "markdown", false);
    expect(title).toBe("Doc");
    expect(trimmed).toBe(true);
    expect(text.startsWith("# Doc\n\nword word")).toBe(true);
    for (const absent of ["Home", "Legal", "on this page", "[A]"]) expect(text).not.toContain(absent);
    [title, text, trimmed] = convertHtml(html, "https://site.test/", "markdown", true);
    expect(trimmed).toBe(false);
    for (const present of ["Home", "Legal", "on this page", "[A](https://site.test/a)"]) expect(text).toContain(present);
  });

  test("a small or empty main does not hide the page", () => {
    expect(markdown("<main></main><div><p>" + "real ".repeat(80) + "</p></div>")).toContain("real real");
  });

  test("a single large article counts as main", () => {
    expect(markdown("<div>menu</div><article><p>" + "story ".repeat(80) + "</p></article>")).not.toContain("menu");
  });

  test("custom elements do not merge their paragraphs", () => {
    expect(markdown("<my-card><p>one</p><p>two</p></my-card><span><div>three</div></span>")).toBe("one\n\ntwo\n\nthree");
  });

  test("a formula is given once as TeX", () => {
    const text = markdown(
      '<p>So <math><semantics><mrow><mi>k</mi><mn>1</mn></mrow><annotation encoding="application/x-tex">k_{1}</annotation></semantics></math> holds.</p>',
    );
    expect(text).toBe("So $k_{1}$ holds.");
  });

  test("definition list", () => {
    expect(markdown("<dl><dt>Term<dd>Meaning<dt>Next<dd>Other</dl>")).toBe("**Term**\n\nMeaning\n\n**Next**\n\nOther");
  });

  test("the text format has no markup", () => {
    const text = markdown(
      "<h1>T</h1><p>a <b>b</b> <a href='/x'>c</a></p><ul><li>i</li></ul><pre>  keep\n    this</pre><script>no</script>",
      undefined,
      false,
      "text",
    );
    expect(text).toBe("T\n\na b c\n\ni\n\nkeep\nthis");
  });

  test("entities are decoded", () => {
    expect(markdown("<p>a &amp; b &lt;c&gt; &#8212; &nbsp;d</p>")).toBe("a & b <c> — d");
  });

  test("an entity-like text in a link is kept as the page wrote it", () => {
    expect(markdown('<a href="/q?a=1&copy=2">q</a>')).toBe("[q](https://site.test/q?a=1&copy=2)");
  });

  test("very deep and broken markup does not fail", () => {
    const deep = "<div>".repeat(5000) + "bottom" + "</div>".repeat(5000);
    expect(markdown(deep)).toContain("bottom");
    expect(markdown("</p></div><p>fine<b>bold")).toBe("fine**bold**");
    expect(markdown("")).toBe("");
    expect(markdown("a < b and <b")).toBe("a < b and <b");
  });
});

// ------------------------------------------------------------------------- wiki

async function keep(topic: string, title: string, text: string, savedAt = "2026-05-01T00:00:00Z", meta = {}) {
  await saveTopic(topic, { source: "web_fetch", url: "https://x.test/" + topic, title, saved: savedAt, ...meta }, text, 24000);
}

describe("wiki", () => {
  test("slugs", () => {
    expect(slugify("  React 19: What's NEW?  ")).toBe("react-19-what-s-new");
    expect(slugify("caf\xe9 cr\xe8me")).toBe("cafe-creme");
    expect(slugify("???")).toBe("untitled");
    const longA = slugify("a".repeat(90) + " one");
    const longB = slugify("a".repeat(90) + " two");
    expect(longA.length).toBe(80);
    expect(longA).not.toBe(longB);
    expect(longA).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("url topics", () => {
    expect(urlTopic("https://Docs.Example.com/a/b/?z=1&a=2#frag")).toBe("docs-example-com-a-b-a-2-z-1");
    expect(urlTopic("https://x.test:8443/p")).toBe("x-test-8443-p");
    expect(urlTopic("https://x.test:443/p")).toBe("x-test-p");
    expect(urlTopic("https://x.test/p?api_key=SECRET&q=1")).toBe("x-test-p-api-key-redacted-q-1");
    expect(urlTopic("https://me:pw@x.test/p")).toBe("x-test-redacted-p");
    expect(urlTopic("https://x.test/p#a")).toBe(urlTopic("https://x.test/p#b"));
  });

  test("pages are cut between lines and keep every line", () => {
    const lines = Array.from({ length: 900 }, (_, number) => `line ${number} ` + "x".repeat(number % 50));
    const pages = splitPages(lines.join("\n"), 2000);
    expect(pages.length).toBeGreaterThan(5);
    expect(pages.every((item) => item.length <= 2000)).toBe(true);
    expect(pages.join("\n").split("\n")).toEqual(lines);
  });

  test("pages prefer to end at an empty line", () => {
    const paragraph = Array(4).fill("word ".repeat(10)).join("\n");
    const pages = splitPages(Array(30).fill(paragraph).join("\n\n"), 1000);
    expect(pages.every((item) => item.length <= 1000)).toBe(true);
    expect(pages.every((item) => item.endsWith(paragraph))).toBe(true);
  });

  test("a line longer than a page is cut", () => {
    const pages = splitPages("short\n" + "y".repeat(5000) + "\nend", 2000);
    expect(pages.every((item) => item.length <= 2000)).toBe(true);
    expect(pages.join("").replace(/\n/g, "")).toBe("short" + "y".repeat(5000) + "end");
  });

  test("a character outside the basic plane is not cut in half", () => {
    const pages = splitPages("\u{1F600}".repeat(1500), 2001);
    expect(pages.join("")).toBe("\u{1F600}".repeat(1500));
    expect(pages.every((item) => !/[\ud800-\udbff]$/.test(item))).toBe(true);
  });

  test("save and read back", async () => {
    const meta = { source: "web_fetch", url: "https://x.test/a", title: "A\nB --> C", format: "markdown", saved: "2026-01-02T03:04:05Z" };
    const text = "first\n-->\n<!-- knowledge-page\nlast";
    expect(await saveTopic("x-test-a", meta, text, 24000)).toEqual([["x-test-a.md"], false]);
    const [readMeta, readText] = page("x-test-a.md");
    expect(readText).toBe(text);
    expect(readMeta.title).toBe("A B --&gt; C");
    expect(readMeta.url).toBe("https://x.test/a");
    expect([readMeta.page, readMeta.totalPages]).toEqual(["1", "1"]);
    expect(readMeta).not.toHaveProperty("next");
  });

  test("a new copy replaces the old one and its extra pages", async () => {
    const meta = { source: "web_fetch", url: "https://x.test/a", saved: nowStamp() };
    const [files] = await saveTopic("x-test-a", meta, Array(3000).fill("row").join("\n"), 2000);
    expect(files.length).toBeGreaterThan(3);
    expect(wiki()).toEqual([...files].sort());
    const middle = page(files[1]!)[0];
    expect([middle.previous, middle.next]).toEqual([files[0], files[2]]);
    await saveTopic("x-test-a", meta, "short now", 2000);
    expect(wiki()).toEqual(["x-test-a.md"]);
    await saveTopic("x-test-ab", meta, "other topic", 2000);
    await saveTopic("x-test-a", meta, "again", 2000);
    expect(wiki()).toEqual(["x-test-a.md", "x-test-ab.md"]);
    expect(fs.readdirSync(wikis()).filter((name) => name.startsWith("."))).toEqual([]);
  });

  test("saves at the same time each keep their pages", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, n) => keep(`topic-${n}`, `T${n}`, `text ${n}`)));
    expect(wiki().length).toBe(12);
  });

  test("search ranks title above body and newer above older", async () => {
    await keep("body", "Other things", "tokio runtime appears once here among many words");
    await keep("title", "Tokio runtime guide", "an introduction");
    await keep("none", "Unrelated", "nothing to see");
    expect(searchWiki("tokio runtime", 20).map((entry) => entry.page.file)).toEqual(["title.md", "body.md"]);
    await keep("old", "Same words", "same text", "2025-01-01T00:00:00Z");
    await keep("new", "Same words", "same text", "2026-01-01T00:00:00Z");
    expect(searchWiki("same words", 2).map((entry) => entry.page.file)).toEqual(["new.md", "old.md"]);
  });

  test("search words", async () => {
    expect(tokenize("The useEffect of HTMLParser is r\xe9sum\xe9_v2")).toEqual(["use", "effect", "html", "parser", "resume", "v2"]);
    expect(tokenize("actions classes queries boxes class status js")).toEqual(["action", "class", "query", "box", "class", "status", "js"]);
    await keep("hooks", "Hooks", "call useEffect after render");
    expect(searchWiki("effect", 20).length).toBe(1);
    expect(searchWiki("the of and", 20)).toEqual([]);
    expect(searchWiki("absent", 20)).toEqual([]);
    expect(searchWiki("x.test/hooks", 20).length).toBe(1);
  });

  test("a page with few of the words is not a match", async () => {
    await keep("full", "Checkout action", "fetch depth of the checkout action");
    await keep("half", "Readme", "actions run tests; fetch the sources");
    await keep("one", "Notes", "a note about depth");
    const found = Object.fromEntries(searchWiki("actions checkout fetch depth", 20).map((entry) => [entry.page.file, entry]));
    expect(Object.keys(found).sort()).toEqual(["full.md", "half.md"]);
    expect([found["full.md"]!.matched, found["full.md"]!.asked]).toEqual([4, 4]);
    expect([found["half.md"]!.matched, found["half.md"]!.asked]).toEqual([2, 4]);
    expect(found["full.md"]!.score).toBeGreaterThan(2 * found["half.md"]!.score);
    const out = (await ok("local", "--type", "wikis", "--query", "actions checkout fetch depth")).split("\n");
    expect(out[0]).toContain("has 4 of 4 words");
    expect(out[1]).toContain("has 2 of 4 words");
  });

  test("files that are not pages are left alone", async () => {
    fs.mkdirSync(wikis());
    for (const [name, text] of [["notes.md", "# mine"], ["Upper.md", "x"], ["a.txt", "x"]]) {
      fs.writeFileSync(path.join(wikis(), name!), text!);
    }
    expect(readWiki()).toEqual([]);
    expect(await ok("local", "--type", "wikis")).toContain("No local wiki pages found.");
  });
});

// ------------------------------------------------------------------------- local

async function keepLocal(topic: string, text = "body", savedAt?: string) {
  const title = topic[0]!.toUpperCase() + topic.slice(1);
  const meta = { source: "web_fetch", url: "https://x.test/" + topic, title, saved: savedAt ?? nowStamp() };
  return (await saveTopic(topic, meta, text, 2000))[0];
}

const rows = (count: number, line = (n: number) => `row ${n}`) => Array.from({ length: count }, (_, n) => line(n)).join("\n");

describe("local", () => {
  test("nothing yet", async () => {
    expect(await ok("local")).toBe("--references--\nNo references are set up.\n---\n--wikis--\nNo local wiki pages found.\n");
    expect(await ok("local", "--query", "anything", "--type", "wikis")).toBe("No local wiki matches found.\n");
  });

  test("browse lists the newest topics first", async () => {
    await keepLocal("old", "body", "2020-01-01T00:00:00Z");
    await keepLocal("long", Array(2000).fill("row").join("\n"), "2026-01-01T00:00:00Z");
    await saveTopic("how-to", { source: "web_search", query: "how to", saved: "2024-01-01T00:00:00Z" }, "results", 2000);
    let out = (await ok("local", "--type", "wikis")).split("\n");
    expect(out[0]).toMatch(/^- long\.md \(saved 2026-01-01, \d+ days ago, \d+ pages\): Long <https:\/\/x\.test\/long>$/);
    expect(out[1]).toMatch(/^- how-to\.md \(saved 2024-01-01, \d+ days ago\): web search: how to$/);
    expect(out[2]!.startsWith("- old.md (saved 2020-01-01")).toBe(true);
    expect(out[3]).toBe("Wiki directory: " + wikis());
    const text = await ok("local", "--type", "wikis", "--query", "*", "--max-results", "1");
    expect(text).toContain("- long.md");
    expect(text).not.toContain("- old.md");
    expect(text).toContain("... and 2 older topics");
  });

  test("a query lists matching pages with their page number", async () => {
    await keepLocal("guide", Array(600).fill("filler").concat(["zebra crossing"]).join("\n"));
    await keepLocal("other", "no match");
    const out = await ok("local", "--query", "zebra");
    expect(out).toContain("--references--");
    expect(out).toMatch(/- guide\.part-00\d\.md \(score \d+\.\d{3}, has 1 of 1 words, saved \S+, today, page \d of \d\): Guide <https:\/\/x\.test\/guide>/);
    expect(out).not.toContain("other.md");
  });

  test("open a page", async () => {
    const files = await keepLocal("guide", rows(700));
    expect(files.length).toBeGreaterThanOrEqual(3);
    const out = await ok("local", "--page", files[1]!);
    expect(out.startsWith(`Page: ${path.join(wikis(), files[1]!)} (page 2 of ${files.length})\nHolds: Guide <https://x.test/guide>\nSaved: `)).toBe(true);
    expect(out).toContain("Previous: " + path.join(wikis(), files[0]!));
    expect(out).toContain("Next: " + path.join(wikis(), files[2]!));
    expect(out).toContain(`[Page 2 of ${files.length}. The text continues in ${path.join(wikis(), files[2]!)}]`);
    expect(out).toContain("\n\n" + page(files[1]!)[1] + "\n\n[Page");
    const last = await ok("local", "--page", path.join(wikis(), files[files.length - 1]!));
    expect(last).toContain(`[Page ${files.length} of ${files.length}, the last one.]`);
    const short = await ok("local", "--page", files[0]!, "--no-content");
    expect(short).not.toContain("row 0");
    expect(short).toContain("Next: ");
  });

  test("page names are checked", async () => {
    await keepLocal("guide");
    for (const bad of ["../guide.md", "/etc/passwd", "guide", "Guide.md", "guide.part-2.md", path.join(homeDir, "guide.md")]) {
      const [code, , err] = await run("local", "--page", bad);
      expect([bad, code]).toEqual([bad, 2]);
      expect(err).toContain("usage: --page takes the file name");
    }
    const [code, , err] = await run("local", "--page", "absent.md");
    expect(code).toBe(1);
    expect(err).toContain("There is no wiki page named absent.md");
  });

  test("forget removes every page of a topic", async () => {
    const files = await keepLocal("guide", rows(700));
    await keepLocal("guide-two");
    await keepLocal("other");
    const out = await ok("forget", files[1]!, path.join(wikis(), "other.md"), files[0]!);
    expect(out).toBe(`Forgot guide (${files.length} pages)\nForgot other (1 page)\n`);
    expect(wiki()).toEqual(["guide-two.md"]);
    const [code, , err] = await run("forget", "guide-two.md", "absent.md");
    expect(code).toBe(1);
    expect(err).toContain("There is no wiki topic named absent");
    expect(wiki()).toEqual(["guide-two.md"]);
    for (const bad of ["../guide-two.md", "/etc/hosts", "guide-two", "*.md"]) {
      expect((await run("forget", bad))[0]).toBe(2);
    }
    expect(wiki()).toEqual(["guide-two.md"]);
  });

  test("options that do not go together", async () => {
    for (const args of [
      ["--page", "a.md", "--query", "x"],
      ["--page", "a.md", "--type", "references"],
      ["--page", "a.md", "--alias", "x"],
      ["--alias", "x", "--type", "wikis"],
      ["--type", "other"],
    ]) {
      expect((await run("local", ...args))[0]).toBe(2);
    }
  });
});

// ------------------------------------------------------------------------- help

describe("help", () => {
  test("no command prints the help and is wrong usage", async () => {
    const [code, out] = await run();
    expect(code).toBe(2);
    expect(out).toContain("web-fetch");
  });

  test("--help, -h and help list every command", async () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const [code, out] = await run(...args);
      expect(code).toBe(0);
      for (const name of ["local", "web-search", "web-fetch", "forget", "ref-add", "ref-remove", "ref-refresh", "config"]) {
        expect(out).toContain(`  ${name} `);
      }
      expect(out).toContain("knowledge COMMAND --help");
    }
  });

  test("every command has its own help with its options and examples", async () => {
    const expected: Record<string, string[]> = {
      local: ["--query TEXT", "--type KIND", "--page FILE", "--alias NAME", "--max-results N", "--no-content"],
      "web-search": ["QUERY", "--num-results N", "--type TYPE", "--livecrawl MODE", "--context-max-characters N", "--provider NAME", "exa, keenable, parallel"],
      "web-fetch": ["URL [URL ...]", "--format FORMAT", "--timeout SECONDS", "--whole-page", "--no-content"],
      forget: ["FILE [FILE ...]"],
      "ref-add": ["ALIAS", "SOURCE", "--branch BRANCH", "--description TEXT", "--hidden", "--replace"],
      "ref-remove": ["ALIAS"],
      "ref-refresh": ["[ALIAS ...]"],
      config: [],
    };
    for (const [name, parts] of Object.entries(expected)) {
      for (const args of [[name, "--help"], [name, "-h"], ["help", name], [name, "--query", "x", "--help"]]) {
        if (args.includes("--query") && name !== "local") continue;
        const [code, out, err] = await run(...args);
        expect([args, code, err]).toEqual([args, 0, ""]);
        expect(out.startsWith(`usage: knowledge ${name} [-h]`)).toBe(true);
        expect(out).toContain("-h, --help");
        expect(out).toContain(`examples:\n  knowledge ${name}`);
        for (const part of parts) expect(out).toContain(part);
      }
    }
  });

  test("wrong usage names the command and how to get its help", async () => {
    let [code, , err] = await run("web-search", "q", "--type", "slow");
    expect(code).toBe(2);
    expect(err).toContain("knowledge web-search: error: argument --type: invalid choice: 'slow' (choose from 'auto', 'fast', 'deep')");
    expect(err).toContain("Run 'knowledge web-search --help' for help.");
    [code, , err] = await run("nope");
    expect(code).toBe(2);
    expect(err).toContain("invalid choice: 'nope'");
    [code, , err] = await run("help", "nope");
    expect(code).toBe(2);
    [code, , err] = await run("local", "--bogus");
    expect(code).toBe(2);
    expect(err).toContain("unrecognized arguments: --bogus");
    [code, , err] = await run("local", "--max-results", "many");
    expect(code).toBe(2);
    expect(err).toContain("argument --max-results: invalid int value: 'many'");
  });

  test("a unique prefix and the = form are accepted for an option", async () => {
    await keepLocal("guide");
    expect(await ok("local", "--max=1", "--ty", "wikis")).toContain("- guide.md");
  });
});

// ------------------------------------------------------------------------- references

function folder() {
  const root = tempDir("gk-ref-");
  for (const name of ["src", ".git", "node_modules"]) fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, "README.md"), "# hello\n");
  return root;
}

const real = (target: string) => fs.realpathSync(target);
const gitAvailable = Bun.which("git") !== null;

function gitIn(cwd: string, ...args: string[]) {
  const done = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd });
  if (done.exitCode !== 0) throw new Error(done.stderr.toString());
}

describe("references", () => {
  test("add, list, select and remove a directory", async () => {
    const root = folder();
    expect(await ok("ref-add", "docs", root, "--description", "The team's handbook")).toBe(`Added reference docs (local)\nRoot: ${real(root)}\n`);
    expect(await ok("local", "--type", "references")).toBe(`- docs (local): The team's handbook\n  root: ${real(root)}\n`);
    expect(await ok("local", "--alias", "docs")).toBe(
      `Reference: docs (local)\nDescription: The team's handbook\nRoot: ${real(root)}\nImmediate children:\n` +
        `  - README.md (file)\n  - src (directory)\n${HANDOFF}\n`,
    );
    const [code, , err] = await run("ref-add", "docs", root);
    expect(code).toBe(1);
    expect(err).toContain("Add --replace");
    await ok("ref-add", "docs", root, "--replace", "--hidden");
    expect(await ok("local", "--type", "references")).toBe("No references are set up.\n");
    expect(await ok("local", "--alias", "docs")).toContain("Root: ");
    expect(await ok("ref-remove", "docs")).toBe("Removed reference docs\n");
    const [again, , message] = await run("local", "--alias", "docs");
    expect(again).toBe(1);
    expect(message).toContain("There is no reference named 'docs'. No references are set up.");
  });

  test("what cannot be added", async () => {
    const root = folder();
    const cases: [string[], number, string][] = [
      [["has space", root], 2, "alias must be one word"],
      [["a/b", root], 2, "alias must be one word"],
      [["gone", "/no/such/dir"], 1, "is not a directory"],
      [["odd", "not a repo"], 2, "is not a git repository"],
      [["odd", "just-a-word"], 2, "is not a git repository"],
      [["br", root, "--branch", "main"], 2, "--branch goes with a git repository"],
      [["br", "owner/name", "--branch=-x"], 2, "not a safe git branch name"],
    ];
    for (const [args, expected, message] of cases) {
      const [code, , err] = await run("ref-add", ...args);
      expect([args, code]).toEqual([args, expected]);
      expect(err).toContain(message);
    }
    expect(fs.existsSync(path.join(homeDir, "references.json"))).toBe(false);
  });

  test("a directory that went away is listed as unavailable", async () => {
    const root = folder();
    await ok("ref-add", "docs", root);
    fs.rmSync(root, { recursive: true });
    expect(await ok("local", "--type", "references")).toContain("- docs (local)\n  unavailable: the directory");
    const [code, , err] = await run("local", "--alias", "docs");
    expect(code).toBe(1);
    expect(err).toContain("Reference 'docs' is unavailable");
  });

  test("a file written by hand is read with care", async () => {
    const root = folder();
    const document = {
      references: {
        short: root,
        home: "~/",
        "bad alias": root,
        relative: "./x",
        both: { path: root, repository: "a/b" },
        repo: "owner/name",
        typed: { path: root, description: 5 },
      },
    };
    fs.writeFileSync(path.join(homeDir, "references.json"), JSON.stringify(document));
    const out = await ok("local", "--type", "references");
    expect(out).toContain("- short (local)\n  root: " + real(root));
    expect(out).toContain("- home (local)\n  root: ");
    expect(out).toContain("- repo (git)\n  unavailable: the repository is not cloned");
    for (const ignored of ["relative", "both", "typed"]) expect(out).toContain(`note: reference '${ignored}' is ignored`);
    expect(out).toContain("note: an alias with a space");
    fs.writeFileSync(path.join(homeDir, "references.json"), "{not json");
    expect(await ok("local", "--type", "references")).toContain("No references are set up.\nnote: ");
    const [code, , err] = await run("ref-add", "x", root);
    expect(code).toBe(1);
    expect(err).toContain("Repair or remove the file first");
  });

  test("many children are cut", async () => {
    const root = folder();
    for (let number = 0; number < MAX_CHILDREN + 5; number++) {
      fs.writeFileSync(path.join(root, `f${String(number).padStart(4, "0")}`), "");
    }
    await ok("ref-add", "big", root);
    const out = await ok("local", "--alias", "big");
    expect(out.split("\n  - ").length - 1).toBe(MAX_CHILDREN);
    expect(out).toContain("  ... and 7 more entries");
  });

  test("repositories are recognised", () => {
    expect(parseRepository("owner/name")!.remote).toBe("https://github.com/owner/name.git");
    expect(parseRepository("github:owner/name.git")!.segments).toEqual(["owner", "name"]);
    expect(parseRepository("https://github.com/Owner/Name/")!.remote).toBe("https://github.com/Owner/Name.git");
    expect(parseRepository("gitlab.com/group/sub/name")!.remote).toBe("https://gitlab.com/group/sub/name.git");
    const scp = parseRepository("git@example.com:team/name.git")!;
    expect([scp.host, scp.segments, scp.remote]).toEqual(["example.com", ["team", "name"], "git@example.com:team/name.git"]);
    expect(parseRepository("https://git.test:8443/a/b.git")!.host).toBe("git.test:8443");
    for (const bad of ["", "name", "a/b/c", "a b/c", "a/../b", "a/b;rm", "$x/y", "ftp://h/a/b", "https:///a/b", "-x/y:z"]) {
      expect([bad, parseRepository(bad)]).toEqual([bad, null]);
    }
    expect(cachePath(parseRepository("owner/name")!, "feat/x").endsWith(path.join("repos", "github.com", "owner", "name@feat%2Fx"))).toBe(true);
  });

  test.skipIf(!gitAvailable)("a git reference is cloned, refreshed and removed", async () => {
    const origin = tempDir("gk-origin-");
    gitIn(origin, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(origin, "a.txt"), "one\n");
    gitIn(origin, "add", ".");
    gitIn(origin, "commit", "-q", "-m", "one");
    const out = await ok("ref-add", "lib", "file://" + origin, "--branch", "main");
    const root = out.trim().split("Root: ")[1]!;
    expect(root.startsWith(real(path.join(homeDir, "repos")))).toBe(true);
    expect(fs.existsSync(path.join(root, "a.txt"))).toBe(true);
    expect(await ok("local", "--type", "references")).toContain("- lib (git)\n  root: " + root);
    fs.writeFileSync(path.join(origin, "b.txt"), "two\n");
    gitIn(origin, "add", ".");
    gitIn(origin, "commit", "-q", "-m", "two");
    expect(await ok("ref-refresh")).toMatch(/^lib: at [0-9a-f]{7,}\n$/);
    expect(fs.existsSync(path.join(root, "b.txt"))).toBe(true);
    const [code, , err] = await run("ref-refresh", "nope");
    expect(code).toBe(1);
    expect(err).toContain("Not a git reference: nope");
    expect(await ok("ref-remove", "lib")).toContain("Removed its clone");
    expect(fs.existsSync(root)).toBe(false);
  });

  test.skipIf(!gitAvailable)("a repository that cannot be cloned is not added", async () => {
    const [code, , err] = await run("ref-add", "lib", "file:///no/such/repo");
    expect(code).toBe(1);
    expect(err).toContain("git clone failed");
    expect(fs.existsSync(path.join(homeDir, "references.json"))).toBe(false);
    const leftovers = fs.existsSync(path.join(homeDir, "repos"))
      ? (fs.readdirSync(path.join(homeDir, "repos"), { recursive: true }) as string[]).filter((name) => path.basename(name).startsWith(".clone-"))
      : [];
    expect(leftovers).toEqual([]);
    expect(await ok("ref-refresh")).toBe("There are no git references to refresh.\n");
  });
});

// ------------------------------------------------------------------------- fetch

const PAGE =
  "<html><head><title>Guide &amp; more</title></head><body><nav><a href='/'>Home</a></nav>" +
  "<main><h1>Guide</h1><p>" + "Read <a href='next'>this</a> first. ".repeat(12) + "</p></main></body></html>";

describe("fetch", () => {
  test("html is printed as markdown and saved", async () => {
    const url = serve("/docs/guide", PAGE);
    const out = await ok("web-fetch", url);
    const file = path.join(wikis(), `127-0-0-1-${server.port}-docs-guide.md`);
    const [meta, text] = page(path.basename(file));
    expect(out.startsWith(
      `URL: ${url}\nTitle: Guide & more\nType: text/html; charset=utf-8, as markdown, main content only ` +
        `(--whole-page gives everything)\nSaved: ${file} (1 page, ${text.length} characters)\n\n` +
        `# Guide\n\nRead [this](${base}/docs/next) first.`,
    )).toBe(true);
    expect(out).not.toContain("Home");
    expect([meta.source, meta.url, meta.title, meta.format]).toEqual(["web_fetch", url, "Guide & more", "markdown"]);
    expect(out.endsWith(text + "\n")).toBe(true);
    expect(seen[0]!.headers["user-agent"]).toContain("Mozilla/5.0");
    expect(seen[0]!.headers.accept!.startsWith("text/markdown;q=1.0")).toBe(true);
  });

  test("whole page, text format and no content", async () => {
    const url = serve("/g", PAGE);
    const out = await ok("web-fetch", url, "--whole-page", "--format", "text", "--no-content");
    expect(out).toContain("Type: text/html; charset=utf-8, as text\n");
    expect(out).not.toContain("Read this first");
    const [meta, text] = page(wiki()[0]!);
    expect(meta.format).toBe("text");
    expect(text.startsWith("Home\n\nGuide\n\nRead this first.")).toBe(true);
    expect(seen[0]!.headers.accept!.startsWith("text/plain;q=1.0")).toBe(true);
  });

  test("fetching again keeps one copy", async () => {
    const url = serve("/g", PAGE);
    await ok("web-fetch", url);
    serve("/g", "<p>changed</p>");
    expect((await ok("web-fetch", url + "#section")).endsWith("\n\nchanged\n")).toBe(true);
    expect(wiki().length).toBe(1);
    expect(page(wiki()[0]!)[1]).toBe("changed");
  });

  test("a long page is paged", async () => {
    const body = Array.from({ length: 400 }, (_, n) => `<p>paragraph ${n} ${"word ".repeat(30)}</p>`).join("");
    const url = serve("/long", "<main>" + body + "</main>");
    const out = await ok("web-fetch", url);
    const files = wiki();
    expect(files.length).toBeGreaterThan(2);
    expect(out).toMatch(new RegExp(`\\(page 1 of ${files.length}, \\d+ characters in all\\)\\n`));
    for (const name of files.slice(1)) expect(out).toContain("\n  " + path.join(wikis(), name));
    const ordered = [...files].sort((a, b) => pageNumber(a) - pageNumber(b));
    expect(out.trimEnd().endsWith(`[Page 1 of ${files.length}. The text continues in ${path.join(wikis(), ordered[1]!)}]`)).toBe(true);
    expect(out).toContain("paragraph 0 ");
    expect(out).not.toContain("paragraph 399 ");
    expect(out.length).toBeLessThan(26000);
    const whole = ordered.map((name) => page(name)[1]).join("\n\n");
    expect(whole.split("paragraph ").length - 1).toBe(400);
    expect(await ok("local", "--page", ordered[ordered.length - 1]!)).toContain("paragraph 399 ");
  });

  test("other text types are kept as they are", async () => {
    let url = serve("/a.md", "# Already *markdown*\n\n<b>raw</b>\r\nline", "text/markdown; charset=utf-8");
    const out = await ok("web-fetch", url);
    expect(out).toContain("Type: text/markdown; charset=utf-8\n");
    expect(out.endsWith("\n\n# Already *markdown*\n\n<b>raw</b>\nline\n")).toBe(true);
    url = serve("/a.json", '{"a": [1, 2]}', "application/json");
    expect((await ok("web-fetch", url)).endsWith('\n\n{"a": [1, 2]}\n')).toBe(true);
  });

  test("character sets", async () => {
    let url = serve("/latin", Buffer.from("<p>caf\xe9</p>", "latin1"), "text/html; charset=ISO-8859-1");
    expect((await ok("web-fetch", url)).endsWith("\n\ncaf\xe9\n")).toBe(true);
    url = serve("/meta", Buffer.from("<meta charset='windows-1252'><p>na\xefve</p>", "latin1"), "text/html");
    expect((await ok("web-fetch", url)).endsWith("\n\nna\xefve\n")).toBe(true);
    url = serve("/odd", "<p>plain</p>", "text/html; charset=no-such-set");
    expect((await ok("web-fetch", url)).endsWith("\n\nplain\n")).toBe(true);
  });

  test("compressed answers are read", async () => {
    const url = serve("/z", Bun.gzipSync(new TextEncoder().encode("<p>squeezed</p>")), "text/html", 200, { "Content-Encoding": "gzip" });
    expect((await ok("web-fetch", url)).endsWith("\n\nsqueezed\n")).toBe(true);
    expect(seen[0]!.headers["accept-encoding"]).toBe("gzip");
  });

  test("redirects are followed and named", async () => {
    const final = serve("/final", "<p>arrived</p>");
    for (const status of [301, 302, 307, 308]) {
      serve("/start", "", "text/html", status, { Location: "/final" });
      const out = await ok("web-fetch", base + "/start");
      expect([status, out.startsWith(`URL: ${final}\nRedirected from: ${base}/start\n`)]).toEqual([status, true]);
    }
    expect(wiki().length).toBe(1);
    expect(wiki()[0]).toContain("-final.md");
  });

  test("a file page of a code host is fetched as the file", async () => {
    expect(directSource("https://github.com/o/r/blob/main/src/a.py?plain=1#L3")).toBe("https://raw.githubusercontent.com/o/r/main/src/a.py");
    expect(directSource("https://github.com/o/r/raw/v1.2/README.md")).toBe("https://raw.githubusercontent.com/o/r/v1.2/README.md");
    for (const same of ["https://github.com/o/r", "https://github.com/o/r/tree/main/src", "https://github.com/o/r/issues/5", "https://x.test/o/r/blob/main/a.py"]) {
      expect(directSource(same)).toBe(same);
    }
    const pageUrl = serve("/o/r/blob/main/a.py", "<main><p>buttons only</p></main>");
    const raw = serve("/raw/a.py", "print('the file')", "text/plain");
    sources.direct = (url) => (url === pageUrl ? raw : url);
    let out = await ok("web-fetch", pageUrl);
    expect(out.startsWith(`URL: ${raw}\nRedirected from: ${pageUrl}\n`)).toBe(true);
    expect(out.endsWith("\n\nprint('the file')\n")).toBe(true);
    serve("/raw/a.py", "gone", "text/plain", 404);
    out = await ok("web-fetch", pageUrl);
    expect(out.startsWith(`URL: ${pageUrl}\nT`)).toBe(true);
    expect(out.endsWith("\n\nbuttons only\n")).toBe(true);
  });

  test("failures", async () => {
    serve("/gone", "no", "text/plain", 404);
    serve("/pdf", "%PDF-1.7", "application/pdf");
    for (const [route, message] of [
      ["/gone", "Failed: HTTP 404: Not Found"],
      ["/pdf", "Failed: Unsupported binary content-type: application/pdf"],
    ]) {
      const [code, out] = await run("web-fetch", base + route);
      expect([route, code]).toEqual([route, 1]);
      expect(out).toContain(message!);
    }
    for (const [bad, message] of [
      ["ftp://x.test/a", "URL must start with http:// or https://"],
      ["x.test/a", "URL must start with http:// or https://"],
      ["http://", "Invalid URL"],
      ["http://127.0.0.1:1/", "Request failed"],
    ]) {
      const [code, out] = await run("web-fetch", bad!);
      expect([bad, code]).toEqual([bad, 1]);
      expect(out).toContain("Failed: " + message);
    }
    expect(wiki()).toEqual([]);
    // Bun.serve always sends a content type, so an answer without one is built here.
    const untyped = new Answer(200, "OK", new Headers(), base + "/untyped", new TextEncoder().encode("data"));
    expect(() => fetched(base + "/untyped", untyped, "markdown", false)).toThrow("Unsupported binary content-type: unknown");
  });

  test("an empty page is not saved", async () => {
    const url = serve("/empty", "<html><body><script>app()</script></body></html>");
    expect(await ok("web-fetch", url)).toContain("The page has no content. Nothing was saved.");
    expect(wiki()).toEqual([]);
  });

  test("an answer over the limit is refused", async () => {
    writeSettings({ maxResponseBytes: 1000 });
    serve("/big", "<p>" + "x".repeat(5000) + "</p>");
    serve("/bomb", Bun.gzipSync(new TextEncoder().encode("<p>" + "x".repeat(500000) + "</p>")), "text/html", 200, { "Content-Encoding": "gzip" });
    for (const route of ["/big", "/bomb"]) {
      const [code, out] = await run("web-fetch", base + route);
      expect(code).toBe(1);
      expect(out).toContain("Failed: Response too large (exceeds the maxResponseBytes setting of 1000 bytes)");
    }
  });

  test("a slow server times out", async () => {
    bounds.minFetchSeconds = 0.2;
    routes["/slow"] = async () => {
      await Bun.sleep(1500);
      return [200, { "Content-Type": "text/html" }, "<p>late</p>"];
    };
    const started = performance.now();
    const [code, out] = await run("web-fetch", base + "/slow", "--timeout", "0.2");
    expect(code).toBe(1);
    expect(out).toContain("Failed: Request timed out");
    expect(performance.now() - started).toBeLessThan(1400);
  });

  test("a challenge is retried once with a plain agent", async () => {
    routes["/guarded"] = (request) =>
      request.headers["user-agent"]!.includes("Mozilla")
        ? [403, { "Content-Type": "text/html", "cf-mitigated": "challenge" }, "no"]
        : [200, { "Content-Type": "text/html" }, "<p>let in</p>"];
    expect((await ok("web-fetch", base + "/guarded")).endsWith("\n\nlet in\n")).toBe(true);
    const agents = seen.map((request) => request.headers["user-agent"]);
    expect(agents.length).toBe(2);
    expect(agents[1]).toBe("get-knowledge");
    serve("/forbidden", "no", "text/plain", 403);
    const [code, out] = await run("web-fetch", base + "/forbidden");
    expect(code).toBe(1);
    expect(out).toContain("Failed: HTTP 403");
    expect(seen.length).toBe(3);
  });

  test("an image is saved as a file", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(20).fill(0)]);
    const url = serve("/pic.png", png, "image/png");
    const out = await ok("web-fetch", url);
    const file = path.join(homeDir, "files", `127-0-0-1-${server.port}-pic-png.png`);
    expect(out).toContain(`Image: ${file} (28 bytes). Open this file to see it.`);
    expect(new Uint8Array(fs.readFileSync(file))).toEqual(png);
    const [meta, text] = page(wiki()[0]!);
    expect(meta.format).toBe("image");
    expect(text).toContain(file);
    const svg = serve("/v.svg", "<svg><text>hi</text></svg>", "image/svg+xml");
    expect((await ok("web-fetch", svg)).endsWith("<svg><text>hi</text></svg>\n")).toBe(true);
  });

  test("several URLs are fetched together and only summarised", async () => {
    for (const name of "abcd") {
      routes["/" + name] = async () => {
        await Bun.sleep(400);
        return [200, { "Content-Type": "text/html" }, `<p>content of ${name}</p>`];
      };
    }
    serve("/missing", "no", "text/plain", 404);
    const urls = ["a", "b", "missing", "c", "d", "a"].map((name) => base + "/" + name);
    const started = performance.now();
    const [code, out, err] = await run("web-fetch", ...urls);
    expect(performance.now() - started).toBeLessThan(1200);
    expect(code).toBe(1);
    expect(err).toContain("1 of 5 URLs failed.");
    const sections = out.trim().split("\n\n");
    expect(sections.length).toBe(5);
    expect(sections.map((section) => section.split("\n")[0])).toEqual(urls.slice(0, 5).map((url) => "URL: " + url));
    expect(sections[2]).toContain("Failed: HTTP 404");
    expect(out).not.toContain("content of");
    expect(wiki().length).toBe(4);
    expect(page(wiki()[0]!)[1]).toBe("content of a");
  });

  test("addresses with spaces and other alphabets", async () => {
    routes["/a%20b/%C3%A9"] = [200, { "Content-Type": "text/html" }, "<p>ok</p>"];
    const out = await ok("web-fetch", base + "/a b/\xe9?q=x y");
    expect(out.startsWith(`URL: ${base}/a%20b/%C3%A9?q=x%20y\n`)).toBe(true);
    expect(seen[0]!.path).toBe("/a%20b/%C3%A9?q=x%20y");
  });

  test("timeout values are kept in range", async () => {
    const url = serve("/g", PAGE);
    for (const value of ["1", "999999"]) await ok("web-fetch", url, "--timeout", value);
    expect((await run("web-fetch", url, "--timeout", "soon"))[0]).toBe(2);
    expect((await run("web-fetch"))[0]).toBe(2);
  });
});

// ------------------------------------------------------------------------- search

function exaText(...results: [string, string, string][]) {
  return results
    .map(([title, url, highlight]) => `Title: ${title}\nURL: ${url}\nPublished: 2026-01-02\nAuthor: N/A\nHighlights:\n${highlight}`)
    .join("\n\n---\n\n");
}

function exaEvent(text: string, result: Record<string, unknown> = {}) {
  const payload = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }], ...result } };
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

const KEENABLE = JSON.stringify({
  results: [
    { title: "From Keenable", url: "https://k.test/1", snippet: "found here", published_at: "2026-02-03", author: "Ann" },
    { title: "N/A", url: "https://k.test/2", description: "second" },
    { title: "no url" },
  ],
});

const PARALLEL = {
  search_id: "search_1",
  session_id: "session_1",
  results: [
    { url: "https://p.test/1", title: "From Parallel", publish_date: "2026-03-04", excerpts: ["first part", "second part"] },
    { url: "https://p.test/2", title: null, publish_date: null, excerpts: [] },
    { title: "no url", excerpts: ["x"] },
  ],
};

function parallelAnswer(text: string, result: Record<string, unknown> = {}) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }], ...result } });
}

const exa = (body: string, status = 200, contentType = "text/event-stream") => serve("/exa-mcp", body, contentType, status);
const parallel = (body = parallelAnswer(JSON.stringify(PARALLEL)), status = 200) => serve("/parallel-mcp", body, "application/json", status);
const keenable = (body = KEENABLE, status = 200) => serve("/keenable-public", body, "application/json", status);
const sentJson = (route: string, index = 0) => JSON.parse(sent(route)[index]!.body);

describe("search", () => {
  test("results are printed and saved", async () => {
    exa(exaEvent(exaText(["First", "https://a.test/1", "alpha\nbeta"], ["N/A", "https://a.test/2", "gamma"])));
    const out = await ok("web-search", "rust async runtime");
    const file = path.join(wikis(), "rust-async-runtime.md");
    expect(out).toBe(
      `Web Search: rust async runtime\nProvider: Exa, 2 results\nSaved: ${file} (1 page, 171 characters)\n\n` +
        "Title: First\nURL: https://a.test/1\nPublished: 2026-01-02\nHighlights:\nalpha\nbeta" +
        "\n\n---\n\nTitle: https://a.test/2\nURL: https://a.test/2\nPublished: 2026-01-02\nHighlights:\ngamma\n",
    );
    const [meta] = page("rust-async-runtime.md");
    expect([meta.source, meta.query, meta.provider]).toEqual(["web_search", "rust async runtime", "exa"]);
    expect(sentJson("/exa-mcp").params).toEqual({
      name: "web_search_exa",
      arguments: { query: "rust async runtime", objective: "rust async runtime", numResults: 5 },
    });
    expect(await ok("local", "--query", "async runtime")).toContain("- rust-async-runtime.md");
  });

  test("options reach the provider within their bounds", async () => {
    exa(exaEvent(exaText(["A", "https://a.test/1", "x"])));
    await ok("web-search", "q", "--num-results", "99", "--type", "deep", "--livecrawl", "preferred", "--context-max-characters", "3000");
    // Exa's keyless tool takes no other option; only the number of results reaches it.
    expect(sentJson("/exa-mcp").params.arguments).toEqual({ query: "q", objective: "q", numResults: 20 });
    for (const args of [["q", "--context-max-characters", "0"], ["q", "--type", "slow"], ["  "], ["two", "words"], []]) {
      expect([args, (await run("web-search", ...args))[0]]).toEqual([args, 2]);
    }
  });

  test("an answer as plain JSON is read too", async () => {
    const payload = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: exaText(["J", "https://j.test/", "json"]) }] } };
    exa(JSON.stringify(payload), 200, "application/json");
    expect(await ok("web-search", "q")).toContain("Title: J\nURL: https://j.test/");
  });

  test("text that is not a result list is passed on", async () => {
    exa(exaEvent("Here is a summary without the usual shape."));
    const out = await ok("web-search", "q");
    expect(out).toContain("Provider: Exa, 0 results");
    expect(out.endsWith("\n\nHere is a summary without the usual shape.\n")).toBe(true);
  });

  test("nothing found is not saved", async () => {
    for (const body of ["", "data: [DONE]\n\n", exaEvent(""), exaEvent(NO_RESULTS)]) {
      exa(body);
      expect(await ok("web-search", "q")).toBe(NO_RESULTS + "\n");
    }
    expect(wiki()).toEqual([]);
  });

  test("the same query keeps one copy", async () => {
    exa(exaEvent(exaText(["Old", "https://a.test/old", "x"])));
    await ok("web-search", "Same Query!");
    exa(exaEvent(exaText(["New", "https://a.test/new", "y"])));
    await ok("web-search", "same query");
    expect(wiki()).toEqual(["same-query.md"]);
    expect(page("same-query.md")[1]).toContain("https://a.test/new");
    expect(page("same-query.md")[1]).not.toContain("https://a.test/old");
  });

  test("a reached limit moves to the other provider", async () => {
    const limits: [string, number][] = [
      [exaEvent("You've hit Exa's free MCP rate limit. Create your own key.", { _meta: { "ai.exa/rateLimited": true } }), 200],
      [exaEvent("You've hit Exa's free MCP rate limit."), 200],
      [exaEvent("Too many requests", { isError: true }), 200],
      [`data: ${JSON.stringify({ error: { message: "Rate limit exceeded" } })}\n\n`, 200],
      ["slow down", 429],
      [JSON.stringify({ error: "Insufficient credits" }), 402],
    ];
    keenable();
    let out = "";
    for (const [body, status] of limits) {
      exa(body, status);
      let code, err;
      [code, out, err] = await run("web-search", "q");
      expect([body, code]).toEqual([body, 0]);
      expect(err).toContain("note: Exa's limit is reached; trying Keenable.");
      expect(out).toContain("Provider: Keenable, 2 results");
    }
    expect(out.endsWith(
      "Title: From Keenable\nURL: https://k.test/1\nPublished: 2026-02-03\nAuthor: Ann\nHighlights:\nfound here" +
        "\n\n---\n\nTitle: https://k.test/2\nURL: https://k.test/2\nHighlights:\nsecond\n",
    )).toBe(true);
    const request = sent("/keenable-public")[0]!;
    expect(request.headers["x-keenable-title"]).toBe("get-knowledge");
    expect(JSON.parse(request.body)).toEqual({ query: "q", max_results: 5 });
    expect(page("q.md")[0].provider).toBe("keenable");
  });

  test("other failures do not move to the other provider", async () => {
    keenable();
    const failures: [string, number, string][] = [
      ["boom", 500, "HTTP 500"],
      [JSON.stringify({ error: "rate limit exceeded" }), 503, "HTTP 503"],
      [JSON.stringify({ error: "bad key" }), 401, "HTTP 401: Unauthorized (bad key)"],
      [JSON.stringify({ error: "Payment required: credits exhausted" }), 402, "HTTP 402"],
      ["{not json", 200, "Malformed search response body"],
      ["<html>gateway</html>", 200, "Malformed search response body"],
      [exaEvent("The query is not rate limited, it is invalid", { isError: true }), 200, "Search request failed: The query is not rate limited"],
    ];
    for (const [body, status, message] of failures) {
      exa(body, status);
      const [code, out, err] = await run("web-search", "q");
      expect([body, code, out]).toEqual([body, 1, ""]);
      expect(err).toContain("failed: " + message);
    }
    expect(sent("/keenable-public")).toEqual([]);
    expect(wiki()).toEqual([]);
  });

  test("both providers failing is reported as one", async () => {
    exa("", 429);
    keenable(JSON.stringify({ error: "Missing app identifier" }), 400);
    const [code, , err] = await run("web-search", "q");
    expect(code).toBe(1);
    expect(err).toContain(
      "failed: Search failed with Exa (HTTP 429: Too Many Requests); the Keenable fallback failed: HTTP 400: Bad Request (Missing app identifier)",
    );
  });

  test("Keenable first falls back to Exa", async () => {
    writeSettings({ provider: "keenable", defaultNumResults: 3, defaultSearchType: "fast" });
    keenable();
    expect(await ok("web-search", "q")).toContain("Provider: Keenable");
    expect(sentJson("/keenable-public").max_results).toBe(3);
    keenable("", 429);
    exa(exaEvent(exaText(["E", "https://e.test/", "x"])));
    const [code, out, err] = await run("web-search", "q", "--context-max-characters", "50");
    expect(code).toBe(0);
    expect(err).toContain("note: Keenable's limit is reached; trying Exa.");
    expect(out).toContain("Provider: Exa, 1 results");
    expect(sentJson("/keenable-public", 1)).toEqual({ query: "q", max_results: 3, snippet_max_length: 180 });
    expect(sentJson("/exa-mcp").params.arguments).toEqual({ query: "q", objective: "q", numResults: 3 });
    expect(await ok("web-search", "q", "--provider", "exa")).toContain("Provider: Exa");
  });

  test("Parallel without a key", async () => {
    parallel();
    const out = await ok("web-search", "rust async runtime", "--provider", "parallel", "--type", "deep", "--num-results", "9");
    expect(out).toContain("Provider: Parallel, 2 results");
    expect(out.endsWith(
      "Title: From Parallel\nURL: https://p.test/1\nPublished: 2026-03-04\nHighlights:\nfirst part\n\nsecond part" +
        "\n\n---\n\nTitle: https://p.test/2\nURL: https://p.test/2\n",
    )).toBe(true);
    const request = sent("/parallel-mcp")[0]!;
    expect(JSON.parse(request.body).params).toEqual({
      name: "web_search",
      arguments: { objective: "rust async runtime", search_queries: ["rust async runtime"] },
    });
    expect(request.headers).not.toHaveProperty("authorization");
    expect(request.headers).not.toHaveProperty("x-api-key");
    expect(page("rust-async-runtime.md")[0].provider).toBe("parallel");
    expect(sent("/exa-mcp")).toEqual([]);
  });

  test("Parallel excerpts are passed on whole", async () => {
    const long = { results: Array.from({ length: 4 }, (_, n) => ({ url: `https://p.test/${n}`, title: `T${n}`, excerpts: ["word ".repeat(1000)] })) };
    parallel(parallelAnswer("ignored", { structuredContent: long }));
    const out = await ok("web-search", "q", "--provider", "parallel", "--num-results", "2", "--context-max-characters", "1000");
    expect(out).toContain("Provider: Parallel, 2 results");
    expect(page("q.md")[1].split("word").length - 1).toBe(2000);
  });

  test("a long query is cut for Parallel between words", async () => {
    const query = Array(40).fill("keyword").join(" ");
    expect(parallelQuery(query)).toBe(Array(25).fill("keyword").join(" "));
    expect(parallelQuery("x".repeat(300))).toBe("x".repeat(200));
    expect(parallelQuery("  two   words ")).toBe("two words");
    parallel();
    await ok("web-search", query, "--provider", "parallel");
    const args = sentJson("/parallel-mcp").params.arguments;
    expect(args.objective).toBe(query);
    expect(args.search_queries).toEqual([Array(25).fill("keyword").join(" ")]);
  });

  test("Parallel with a key", async () => {
    process.env.PARALLEL_API_KEY = "par-secret-789";
    serve("/parallel", JSON.stringify(PARALLEL), "application/json");
    let out = await ok("web-search", "q", "--provider", "parallel");
    expect(out).toContain("Provider: Parallel, 2 results");
    expect(out).toContain("Title: From Parallel\nURL: https://p.test/1\nPublished: 2026-03-04");
    const request = sent("/parallel")[0]!;
    expect(request.headers["x-api-key"]).toBe("par-secret-789");
    const asked = { objective: "q", search_queries: ["q"], mode: "advanced" };
    expect(JSON.parse(request.body)).toEqual(asked);
    out = await ok("web-search", "q", "--provider", "parallel", "--type", "fast", "--livecrawl", "preferred", "--num-results", "1", "--context-max-characters", "4000");
    expect(sentJson("/parallel", 1)).toEqual(asked);
    expect(out).toContain("Provider: Parallel, 1 results");
    expect(sent("/parallel-mcp")).toEqual([]);
    serve("/parallel", JSON.stringify({ type: "error", error: { ref_id: "r", message: "bad key par-secret-789" } }), "application/json", 401);
    const [code, failed, err] = await run("web-search", "q", "--provider", "parallel");
    expect(code).toBe(1);
    expect(err).toContain("failed: HTTP 401: Unauthorized (bad key [REDACTED])");
    expect(failed + err).not.toContain("par-secret-789");
    const config = await ok("config");
    expect(config).toContain("Parallel API key: set, from the environment variable PARALLEL_API_KEY");
    expect(config).not.toContain("secret");
  });

  test("each reached limit moves to the next provider", async () => {
    exa("", 429);
    keenable("", 429);
    parallel();
    let [code, out, err] = await run("web-search", "q");
    expect(code).toBe(0);
    expect(err).toContain("note: Exa's limit is reached; trying Keenable.");
    expect(err).toContain("note: Keenable's limit is reached; trying Parallel.");
    expect(out).toContain("Provider: Parallel, 2 results");
    for (const [body, status] of [
      ["", 429],
      [parallelAnswer("Rate limit exceeded", { isError: true }), 200],
      [parallelAnswer("You have hit the rate limit. Try later."), 200],
    ] as [string, number][]) {
      parallel(body, status);
      [code, out, err] = await run("web-search", "q");
      expect([body, code, out]).toEqual([body, 1, ""]);
      expect(err).toContain(
        "failed: Search failed with Exa (HTTP 429: Too Many Requests); the Keenable fallback failed: HTTP 429: Too Many Requests; the Parallel fallback failed: ",
      );
    }
    expect(wiki()).toEqual(["q.md"]);
  });

  test("Parallel first falls back to the others in order", async () => {
    writeSettings({ provider: "parallel" });
    parallel("", 429);
    exa(exaEvent(exaText(["E", "https://e.test/", "x"])));
    const [code, out, err] = await run("web-search", "q");
    expect(code).toBe(0);
    expect(err).toContain("note: Parallel's limit is reached; trying Exa.");
    expect(out).toContain("Provider: Exa, 1 results");
    expect(sent("/keenable-public")).toEqual([]);
  });

  test("a Parallel failure that is no limit ends the search", async () => {
    exa(exaEvent(exaText(["E", "https://e.test/", "x"])));
    const failures: [string, number, string][] = [
      [parallelAnswer("Invalid search_queries", { isError: true }), 200, "Search request failed: Invalid search_queries"],
      [parallelAnswer("not what was expected"), 200, "Search request failed: not what was expected"],
      [JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "Unknown tool" } }), 200, "Search request failed: Unknown tool"],
      ["{not json", 200, "Malformed search response body"],
      ["boom", 500, "HTTP 500"],
    ];
    for (const [body, status, message] of failures) {
      parallel(body, status);
      const [code, out, err] = await run("web-search", "q", "--provider", "parallel");
      expect([body, code, out]).toEqual([body, 1, ""]);
      expect(err).toContain("failed: " + message);
    }
    expect(sent("/exa-mcp")).toEqual([]);
    parallel(parallelAnswer(JSON.stringify({ results: [] })));
    expect(await ok("web-search", "q", "--provider", "parallel")).toBe(NO_RESULTS + "\n");
  });

  test("keys select the keyed services and never show", async () => {
    process.env.EXA_API_KEY = "exa-secret-123";
    process.env.KEENABLE_API_KEY = "keen secret/456";
    const rest = {
      results: [
        { title: "R", url: "https://r.test/", publishedDate: "2026", highlights: ["one", "two"], author: "" },
        { title: "S", url: "https://s.test/", summary: "sum" },
      ],
    };
    serve("/exa-rest", JSON.stringify(rest), "application/json");
    const out = await ok("web-search", "q", "--livecrawl", "preferred", "--context-max-characters", "900");
    expect(out).toContain("Title: R\nURL: https://r.test/\nPublished: 2026\nHighlights:\none\n\ntwo");
    expect(out).toContain("Title: S\nURL: https://s.test/\nHighlights:\nsum");
    const request = sent("/exa-rest")[0]!;
    expect(request.headers.authorization).toBe("Bearer exa-secret-123");
    expect(JSON.parse(request.body)).toEqual({
      query: "q",
      type: "auto",
      numResults: 5,
      stream: false,
      contents: { highlights: { query: "q", maxCharacters: 900 }, maxAgeHours: 0 },
    });
    expect(sent("/exa-mcp")).toEqual([]);
    serve("/exa-rest", JSON.stringify({ error: "rate limit for key exa-secret-123" }), "application/json", 429);
    serve("/keenable", JSON.stringify({ error: "bad key keen secret/456 or keen%20secret%2F456" }), "application/json", 401);
    const [code, failed, err] = await run("web-search", "q");
    expect(code).toBe(1);
    expect(sent("/keenable")[0]!.headers["x-api-key"]).toBe("keen secret/456");
    expect(sent("/keenable")[0]!.headers).not.toHaveProperty("x-keenable-title");
    expect(err).toContain("bad key [REDACTED] or [REDACTED]");
    for (const secret of ["exa-secret-123", "keen secret/456", "keen%20secret%2F456"]) expect(failed + err).not.toContain(secret);
    const config = await ok("config");
    expect(config).toContain("Exa API key: set, from the environment variable EXA_API_KEY");
    expect(config).not.toContain("secret");
  });

  test("a key in the settings file is used and the environment wins", async () => {
    writeSettings({ exaApiKey: "from-file" });
    serve("/exa-rest", JSON.stringify({ results: [] }), "application/json");
    expect(await ok("web-search", "q")).toBe(NO_RESULTS + "\n");
    expect(sent("/exa-rest")[0]!.headers.authorization).toBe("Bearer from-file");
    expect(await ok("config")).toContain("Exa API key: set, from the settings.json");
    process.env.EXA_API_KEY = "from-env";
    await ok("web-search", "q");
    expect(sent("/exa-rest")[1]!.headers.authorization).toBe("Bearer from-env");
  });

  test("settings that are wrong are named and not used", async () => {
    writeSettings({ provider: "google", defaultNumResults: 500, pageChars: 10, searchTimeoutMs: true, exaApiKey: 5, colour: "red", defaultLivecrawl: "preferred" });
    exa(exaEvent(exaText(["A", "https://a.test/1", "x"])));
    const [code, out, err] = await run("web-search", "q");
    expect(code).toBe(0);
    expect(out).toContain("Provider: Exa");
    for (const text of ['provider = "google" is not allowed', "defaultNumResults = 500", "pageChars = 10", "searchTimeoutMs = true", "exaApiKey = (hidden)", "unknown setting 'colour'"]) {
      expect(err).toContain(text);
    }
    expect(sentJson("/exa-mcp").params.arguments.numResults).toBe(5);
    writeSettings("[1, 2]");
    expect(await ok("config")).toContain("must hold one JSON object");
  });

  test("long results are paged", async () => {
    writeSettings({ pageChars: 2000 });
    const results = Array.from({ length: 8 }, (_, n): [string, string, string] => [`T${n}`, `https://a.test/${n}`, "text ".repeat(150)]);
    exa(exaEvent(exaText(...results)));
    const out = await ok("web-search", "q", "--num-results", "8");
    expect(out).toContain("q.md (page 1 of ");
    expect(out).toContain("The text continues in " + path.join(wikis(), "q.part-002.md"));
  });

  test("what counts as a limit", () => {
    const yes: [number | null, string, string][] = [
      [429, "", ""], [null, "Rate limit exceeded", ""], [null, "too many requests", ""], [null, "", "RATE_LIMITED"],
      [null, "Monthly limit reached", ""], [null, "You are out of credits", ""], [402, "credits exhausted", ""],
      [null, "requests are being throttled", ""], [null, "quota exceeded", ""],
    ];
    const no: [number | null, string, string][] = [
      [500, "rate limit exceeded", ""], [401, "rate limit", ""], [400, "quota", ""], [402, "rate limit exceeded", ""],
      [402, "Payment required", ""], [null, "payment_required: no credits", ""], [null, "not rate limited", ""],
      [null, "no credits required", ""], [null, "invalid query", ""], [null, "", ""],
    ];
    for (const item of yes) expect([item, isLimit(...item)]).toEqual([item, true]);
    for (const item of no) expect([item, isLimit(...item)]).toEqual([item, false]);
  });
});

// ------------------------------------------------------------------------- config and the built script

describe("config", () => {
  test("config shows places and defaults", async () => {
    const out = await ok("config");
    expect(out).toContain(`Home: ${homeDir} (change it with the environment variable GET_KNOWLEDGE_HOME)`);
    expect(out).toContain(`Wiki: ${wikis()} (0 topics, 0 pages)`);
    expect(out).toContain("settings.json (not there)");
    expect(out).toContain('  provider: "exa"\n');
    expect(out).toContain("  pageChars: 24000\n");
    expect(out).toContain("Keenable API key: not set; the keyless service is used");
  });

  test("the home can be given with a tilde", () => {
    process.env[HOME_ENV] = "~/somewhere-else";
    expect(home()).toBe(path.join(os.homedir(), "somewhere-else"));
    process.env[HOME_ENV] = "  ";
    expect(home()).toBe(path.join(os.homedir(), ".get-knowledge"));
  });
});

describe("the built script", () => {
  const runBuilt = (...args: string[]) => {
    const done = Bun.spawnSync(["bun", SCRIPT, ...args], { env: { ...process.env } });
    return [done.exitCode, done.stdout.toString(), done.stderr.toString()] as const;
  };

  test("it is up to date with the source", () => {
    const built = fs.statSync(SCRIPT).mtimeMs;
    const sourceDir = path.join(import.meta.dir, "..", "src");
    for (const name of fs.readdirSync(sourceDir)) {
      expect([name, fs.statSync(path.join(sourceDir, name)).mtimeMs <= built]).toEqual([name, true]);
    }
  });

  test("it runs as a program", () => {
    let [code, out, err] = runBuilt("local");
    expect([code, err]).toEqual([0, ""]);
    expect(out).toContain("--wikis--");
    [code, out] = runBuilt("--help");
    expect(code).toBe(0);
    expect(out).toContain("ref-refresh");
    [code, out] = runBuilt("web-fetch", "--help");
    expect(code).toBe(0);
    expect(out).toContain("--whole-page");
    [code, , err] = runBuilt("web-search");
    expect(code).toBe(2);
    expect(err).toContain("the following arguments are required: QUERY");
  });

  test("it fetches through a real process", async () => {
    const url = serve("/docs/guide", PAGE);
    const done = Bun.spawn(["bun", SCRIPT, "web-fetch", url], { env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
    const [code, out] = await Promise.all([done.exited, new Response(done.stdout).text()]);
    expect(code).toBe(0);
    expect(out).toContain("# Guide\n\nRead [this](");
  });
});
