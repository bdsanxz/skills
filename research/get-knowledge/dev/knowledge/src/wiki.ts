// The wiki: one topic for each web search and each fetched URL, kept as page files.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWrite, compare, parseQuery, unquote, urlsplit, wikisDir } from "./core";

export const PAGE_START = "<!-- knowledge-page";
export const PAGE_END = "-->";
export const PAGE_NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.part-(\d{3}))?\.md$/;
const MAX_SLUG = 80;
export const MAX_PAGES = 999;
const SECRET_KEY = new RegExp(
  "token|code|secret|password|credential|api[-_]?key|api[-_]?secret|" +
    "authorization|client[-_]?secret|client[-_]?id|private[-_]?key|signature|sig$",
  "i",
);
const STOPWORDS = new Set(
  (
    "a an and are as at be but by does for from how if in into is it no not of on or such " +
    "that the their then there these they this to was will with"
  ).split(" "),
);
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_WEIGHT = 3;
const META_WEIGHT = 2;
const BODY_WEIGHT = 1;

export type Meta = Record<string, string>;
export type Page = { file: string; meta: Meta; text: string };

export function slugify(value: string) {
  let slug = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SLUG) {
    const digest = createHash("sha1").update(value, "utf8").digest("hex").slice(0, 8);
    slug = slug.slice(0, MAX_SLUG - 9).replace(/^-+|-+$/g, "") + "-" + digest;
  }
  return slug || "untitled";
}

/** A stable topic for a URL: host, port, path and sorted query. The fragment is
 * left out, and so is the value of anything that looks like a secret. */
export function urlTopic(value: string) {
  try {
    const url = urlsplit(value.trim());
    const parts = [url.hostname ?? ""];
    if (url.username || url.password) parts.push("redacted");
    const usual = (url.scheme === "https" && url.port === 443) || (url.scheme === "http" && url.port === 80);
    if (url.port && !usual) parts.push(String(url.port));
    const trimmed = url.path.replace(/^\/+|\/+$/g, "");
    if (trimmed) parts.push(unquote(trimmed));
    const pairs = parseQuery(url.query).sort(
      ([keyA, valueA], [keyB, valueB]) => compare(keyA, keyB) || compare(valueA, valueB),
    );
    for (const [key, item] of pairs) parts.push(key, SECRET_KEY.test(key) ? "redacted" : item);
    return slugify(parts.join("-"));
  } catch {
    return slugify(value);
  }
}

export function pageFile(topic: string, number: number) {
  return number === 1 ? `${topic}.md` : `${topic}.part-${String(number).padStart(3, "0")}.md`;
}

export function oneLine(value: unknown) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/-->/g, "--&gt;").trim();
}

function formatPage(meta: Record<string, unknown>, text: string) {
  const lines = [PAGE_START];
  for (const [key, value] of Object.entries(meta)) {
    if (value !== "" && value !== null && value !== undefined) lines.push(`${key}: ${oneLine(value)}`);
  }
  lines.push(PAGE_END, "", text.replace(/\n+$/, ""), "");
  return lines.join("\n");
}

/** [meta, text] of a page file, or null when the file is not one. */
export function parsePage(document: string): [Meta, string] | null {
  if (!document.startsWith(PAGE_START + "\n")) return null;
  const end = document.indexOf("\n" + PAGE_END + "\n");
  if (end < 0) return null;
  const meta: Meta = {};
  for (const line of document.slice(PAGE_START.length + 1, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon >= 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return [meta, document.slice(end + PAGE_END.length + 2).replace(/^\n+|\n+$/g, "")];
}

/** Cut at `limit` characters, but never between the two halves of one character. */
function cutAt(line: string, limit: number) {
  const code = line.charCodeAt(limit);
  return code >= 0xdc00 && code <= 0xdfff ? limit - 1 : limit;
}

/** Pages of at most `limit` characters, cut between lines and, where one is near,
 * at an empty line. */
export function splitPages(text: string, limit: number) {
  const pages: string[] = [];
  let current: string[] = [];
  let size = 0;
  const close = (keep: number) => {
    pages.push(current.slice(0, keep).join("\n"));
    const rest = current.slice(keep);
    while (rest.length && !rest[0]!.trim()) rest.shift();
    current = rest;
    size = rest.reduce((total, line) => total + line.length + 1, 0);
  };
  for (let line of text.split("\n")) {
    while (line.length > limit) {
      if (current.length) close(current.length);
      const cut = cutAt(line, limit);
      pages.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    if (current.length && size + line.length + 1 > limit) {
      let keep = current.length;
      let tail = 0;
      for (let index = current.length - 1; index > 0; index--) {
        tail += current[index]!.length + 1;
        if (tail > Math.floor(limit / 5)) break;
        if (!current[index]!.trim()) {
          keep = index;
          break;
        }
      }
      close(keep);
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) pages.push(current.join("\n"));
  const kept = pages.filter((page) => page.trim());
  return kept.length ? kept : [""];
}

/** One writer at a time across processes: a lock file that holds the writer's
 * process ID. A lock whose process is gone, or that is old, is taken over. */
async function withLock<T>(root: string, work: () => T): Promise<T> {
  const lock = path.join(root, ".write-lock");
  const started = Date.now();
  let held = false;
  while (!held) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      held = true;
    } catch (error: any) {
      if (error?.code !== "EEXIST") break; // the system cannot lock; write anyway
      if (stale(lock) || Date.now() - started > 30000) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      await Bun.sleep(20);
    }
  }
  try {
    return work();
  } finally {
    if (held) fs.rmSync(lock, { force: true });
  }
}

function stale(lock: string) {
  try {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    if (Date.now() - fs.statSync(lock).mtimeMs > 120000) return true;
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return false;
  } catch (error: any) {
    return error?.code === "ESRCH" || error?.code === "ENOENT";
  }
}

export function pageNumber(name: string) {
  const found = PAGE_NAME.exec(name);
  return found && found[2] ? parseInt(found[2], 10) : 1;
}

export function topicFiles(root: string, topic: string) {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((name) => PAGE_NAME.exec(name)?.[1] === topic)
    .sort((a, b) => pageNumber(a) - pageNumber(b));
}

export function nowStamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** Keep one copy of a search or a page: the newest replaces the one before.
 * Returns the page files and whether the text had to be cut. */
export async function saveTopic(
  topic: string,
  meta: Record<string, string>,
  text: string,
  pageChars: number,
): Promise<[string[], boolean]> {
  const root = wikisDir();
  fs.mkdirSync(root, { recursive: true });
  let pages = splitPages(text, pageChars);
  const cut = pages.length > MAX_PAGES;
  pages = pages.slice(0, MAX_PAGES);
  const files = pages.map((_, index) => pageFile(topic, index + 1));
  await withLock(root, () => {
    pages.forEach((body, index) => {
      const header: Record<string, unknown> = { topic, page: index + 1, totalPages: pages.length };
      Object.assign(header, meta);
      header.previous = index ? files[index - 1] : "";
      header.next = index + 1 < files.length ? files[index + 1] : "";
      atomicWrite(path.join(root, files[index]!), formatPage(header, body));
    });
    for (const old of topicFiles(root, topic)) {
      if (!files.includes(old)) fs.rmSync(path.join(root, old), { force: true });
    }
  });
  return [files, cut];
}

export async function removeTopics(root: string, topics: string[]) {
  return withLock(root, () =>
    topics.map((topic) => {
      const files = topicFiles(root, topic);
      for (const name of files) fs.rmSync(path.join(root, name), { force: true });
      return [topic, files.length] as const;
    }),
  );
}

export function readPageFile(name: string): [Meta, string] | null {
  try {
    return parsePage(fs.readFileSync(path.join(wikisDir(), name), "utf8"));
  } catch {
    return null;
  }
}

/** Every page of the wiki. */
export function readWiki(): Page[] {
  let names: string[];
  try {
    names = fs.readdirSync(wikisDir()).filter((name) => PAGE_NAME.test(name)).sort(compare);
  } catch {
    return [];
  }
  const pages: Page[] = [];
  for (const name of names) {
    const parsed = readPageFile(name);
    if (parsed) pages.push({ file: name, meta: parsed[0], text: parsed[1] });
  }
  return pages;
}

/** A plural and its singular are one word in a search: actions, action. */
function singular(token: string) {
  if (token.length < 4 || !/^\p{L}+$/u.test(token)) return token;
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (["sses", "xes", "ches", "shes"].some((end) => token.endsWith(end))) return token.slice(0, -2);
  if (token.endsWith("s") && !["ss", "us", "is"].some((end) => token.endsWith(end))) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(value: string) {
  const text = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token && !STOPWORDS.has(token))
    .map(singular);
}

function weighted(page: Page): [Map<string, number>, number] {
  const terms = new Map<string, number>();
  let length = 0;
  const meta = page.meta;
  const fields: [string, number][] = [
    [meta.title ?? "", TITLE_WEIGHT],
    [[meta.query ?? "", meta.url ?? ""].join(" "), META_WEIGHT],
    [page.text, BODY_WEIGHT],
  ];
  for (const [value, weight] of fields) {
    for (const token of tokenize(value)) {
      terms.set(token, (terms.get(token) ?? 0) + weight);
      length += weight;
    }
  }
  return [terms, length];
}

export type Ranked = { score: number; page: Page; matched: number; asked: number };

/** Pages ranked by BM25 over title, source and body. A page must hold at least half
 * of the words asked, and one that holds only some of them scores lower by that share. */
export function searchWiki(query: string, limit: number): Ranked[] {
  const pages = readWiki();
  const tokens = [...new Set(tokenize(query))].sort(compare);
  if (!pages.length || !tokens.length) return [];
  const documents = pages.map(weighted);
  const average = documents.reduce((total, [, length]) => total + length, 0) / documents.length || 1;
  const found = new Map(
    tokens.map((token) => [token, documents.filter(([terms]) => terms.has(token)).length]),
  );
  const ranked: Ranked[] = [];
  pages.forEach((page, index) => {
    const [terms, length] = documents[index]!;
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const frequency = terms.get(token) ?? 0;
      if (!frequency) continue;
      matched++;
      const count = found.get(token)!;
      const rarity = Math.log(1 + (documents.length - count + 0.5) / (count + 0.5));
      const norm = frequency + BM25_K1 * (1 - BM25_B + (BM25_B * length) / average);
      score += (rarity * frequency * (BM25_K1 + 1)) / norm;
    }
    if (score > 0 && matched * 2 >= tokens.length) {
      ranked.push({ score: (score * matched) / tokens.length, page, matched, asked: tokens.length });
    }
  });
  const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
  ranked.sort(
    (a, b) =>
      rounded(b.score) - rounded(a.score) ||
      compare(b.page.meta.saved ?? "", a.page.meta.saved ?? "") ||
      compare(a.page.file, b.page.file),
  );
  return ranked.slice(0, limit);
}

/** '2026-10-09, 3 days ago' for a saved stamp. */
export function age(stamp: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(stamp) || isNaN(Date.parse(stamp))) {
    return "at an unknown time";
  }
  const day = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.round((day(new Date()) - day(new Date(stamp))) / 86400000);
  const ago = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  return `${stamp.slice(0, 10)}, ${ago}`;
}

/** What a page holds, in a few words. */
export function subject(meta: Meta) {
  if (meta.source === "web_search") return `web search: ${meta.query ?? ""}`;
  const title = meta.title ?? "";
  const url = meta.url ?? "";
  return title && title !== url ? `${title} <${url}>` : url || title;
}
