// market collect: public posts from X/Twitter or Bluesky, through the FxEmbed API, into one
// JSON file. Running it again with the same --out adds to the file; posts already there are skipped.

import fs from "node:fs";
import path from "node:path";
import type { Command, Values } from "./args";
import { Client, type Dict, type Failure, type Getter, type Platform, describe, quote } from "./client";
import {
  PY_SPACE,
  UsageError,
  length,
  lstripChars,
  osError,
  partition,
  print,
  squeeze,
  strip,
  universalNewlines,
} from "./core";
import {
  DecodeError,
  type Json,
  type JsonObject,
  decodeUtf8,
  dumps,
  get,
  has,
  isDict,
  isNumber,
  loads,
  numeric,
  or,
  pyRepr,
  pyStr,
  toInt,
  truthy,
} from "./pyjson";
import { type Moment, addDays, fromTimestamp, iso, isoDay, parseTime } from "./time";

export const FORMAT = "research-market/posts@1";
const PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 30;
const MAX_TIMELINE_PAGES = 10;
const MAX_REPLY_PAGES = 10; // per parent post
export const MAX_QUERY_LENGTH = 512; // limit of the search endpoint
export const DEFAULT_DAYS = 7;
const DEFAULT_MAX = 100;
const DEFAULT_PER_QUERY = 25;

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const BSKY_HANDLE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const X_HOSTS = String.raw`(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com`;
const X_POST_URL = new RegExp(
  String.raw`^https?://(?:www\.|mobile\.)?` + X_HOSTS + String.raw`/(?:[^/]+|i/web)/status(?:es)?/(\p{Nd}{2,20})(?:[/?#].*)?$`,
  "iu",
);
const X_PROFILE_URL = new RegExp(
  String.raw`^https?://(?:www\.|mobile\.)?` + X_HOSTS + String.raw`/([A-Za-z0-9_]{1,15})/?(?:[?#].*)?$`,
  "iu",
);
const BSKY_POST_URL =
  /^https?:\/\/(?:www\.)?(?:bsky\.app|fxbsky\.app)\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)(?:[/?#].*)?$/iu;
const BSKY_PROFILE_URL = /^https?:\/\/(?:www\.)?(?:bsky\.app|fxbsky\.app)\/profile\/([^/?#]+)\/?(?:[?#].*)?$/iu;
const AT_URI = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9]+)$/u;
const BARE_ID = /^\p{Nd}{2,20}$/u;
const PLATFORM_NAMES: Record<string, Platform> = { x: "x", twitter: "x", bsky: "bluesky", bluesky: "bluesky" };

const URL_IN_TEXT = new RegExp(`https?://[^${PY_SPACE}]+`, "gu");
const EMAIL = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu;
const NUMBER_RUN = /\+?\p{Nd}(?:[ .\-]?\p{Nd}){8,}/gu; // nine or more digits, single separators allowed
const AMOUNT = /^\p{Nd}{1,3}(?:[.,]\p{Nd}{3})+$/u; // 1.250.000 or 1,250,000 is an amount, not an identifier

export type Range = [Moment, Moment];
export type PostRef = { platform: Platform; handle: string | null; id: string; text?: string; url?: Json };
export type Query = { goal: string | null; query: string };
type Tags = { account?: string | null; goal?: string | null; query?: string | null };

// --------------------------------------------------------------------------- arguments

/** [platform, handle] for `x:Name`, `bsky:name.tld`, `@Name`, a bare handle or a profile URL. */
export function parseAccount(text: string): [Platform, string] {
  let value = strip(text);
  const profile = X_PROFILE_URL.exec(value);
  if (profile) return ["x", profile[1]!];
  const bsky = BSKY_PROFILE_URL.exec(value);
  if (bsky) value = "bsky:" + bsky[1]!;
  let platform: Platform | null = null;
  const [prefix, separator, rest] = partition(value, ":");
  if (separator && Object.hasOwn(PLATFORM_NAMES, prefix.toLowerCase())) {
    platform = PLATFORM_NAMES[prefix.toLowerCase()]!;
    value = rest;
  }
  const handle = lstripChars(strip(value), "@");
  platform ??= handle.includes(".") ? "bluesky" : "x";
  if (platform === "x" && !X_HANDLE.test(handle)) {
    throw new UsageError(
      `--account ${pyRepr(text)}: not an X/Twitter handle (letters, digits and _, at most 15). ` +
        "Use x:<handle> or bsky:<handle>.",
    );
  }
  if (platform === "bluesky" && !BSKY_HANDLE.test(handle)) {
    throw new UsageError(
      `--account ${pyRepr(text)}: not a Bluesky handle. Use the full handle, for example bsky:name.bsky.social.`,
    );
  }
  return [platform, handle];
}

/** The platform, handle and id of a post URL, an at:// URI or a bare X post ID. */
export function parsePostRef(text: string): PostRef {
  const value = strip(text);
  const x = X_POST_URL.exec(value);
  if (x) return { platform: "x", handle: null, id: x[1]! };
  if (BARE_ID.test(value)) return { platform: "x", handle: null, id: value };
  const bsky = BSKY_POST_URL.exec(value) ?? AT_URI.exec(value);
  if (bsky) return { platform: "bluesky", handle: bsky[1]!, id: bsky[2]! };
  throw new UsageError(
    `post ${pyRepr(text)}: not recognized. Give an X/Twitter post URL or numeric ID, ` +
      "a bsky.app post URL, or an at:// post URI.",
  );
}

/** {goal, query} for a line `goal | search text`, or a search text alone. */
export function parseQuery(text: string): Query {
  let [goal, separator, query] = partition(text, "|");
  if (!separator) [goal, query] = ["", text];
  goal = strip(goal);
  query = squeeze(query);
  if (!query) throw new UsageError(`query ${pyRepr(text)}: the search text is empty.`);
  return { goal: goal || null, query };
}

/** [since, until], or null when no time range was given. */
export function resolveRange(days: number | null, since: string | null, until: string | null, now: Moment): Range | null {
  if (days !== null && since) throw new UsageError("give --days or --since, not both.");
  if (days === null && !since && !until) return null;
  const end = until ? parseTime(until, true) : now;
  const start = since ? parseTime(since) : addDays(end, -(days ?? DEFAULT_DAYS));
  if (start >= end) {
    throw new UsageError(`the time range is empty: it starts ${iso(start)} and ends ${iso(end)}.`);
  }
  return [start, end];
}

// --------------------------------------------------------------------------- posts

function postKey(raw: Json, platform: Platform) {
  if (platform === "x") return "x:" + pyStr(get(raw, "id"));
  return "bsky:" + pyStr(or(get(raw, "at_uri"), pyStr(get(raw, "url", "")).toLowerCase()));
}

/** The post's creation time, or null when the API gave none. */
function postTime(raw: Json): Moment | null {
  const stamp = get(raw, "created_timestamp");
  if (!isNumber(stamp)) return null;
  let seconds = numeric(stamp);
  if (!(seconds > 0)) return null;
  if (seconds >= 1e12) seconds /= 1000;
  return fromTimestamp(seconds);
}

function count(raw: Json, field: string) {
  const value = get(raw, field);
  return isNumber(value) ? toInt(value) : 0;
}

function authorOf(raw: Json) {
  return pyStr(or(get(or(get(raw, "author"), {}), "screen_name"), ""));
}

/**
 * Phone, account and ticket numbers and email addresses replaced with a placeholder.
 * Links, amounts written with thousands separators and dates are left as they are.
 * `tally` counts what was replaced.
 */
export function maskPrivate(text: string, tally: { numbers: number; emails: number }) {
  const clean = (part: string) =>
    part
      .replace(EMAIL, () => {
        tally.emails++;
        return "[email]";
      })
      .replace(NUMBER_RUN, (found) => {
        if (AMOUNT.test(found)) return found;
        tally.numbers++;
        return "[number]";
      });
  const parts: string[] = [];
  let last = 0;
  for (const link of text.matchAll(URL_IN_TEXT)) {
    parts.push(clean(text.slice(last, link.index)), link[0]);
    last = link.index + link[0].length;
  }
  parts.push(clean(text.slice(last)));
  return parts.join("");
}

function inRange(moment: Moment | null, range: Range | null) {
  if (range === null) return true;
  return moment !== null && range[0] <= moment && moment < range[1];
}

/** Date operators added. They only narrow the search; the exact range is applied to the results. */
export function withDates(query: string, range: Range | null) {
  if (!range) return query;
  return `${query} since:${isoDay(range[0])} until:${isoDay(addDays(range[1], 1))}`;
}

/** The search for posts written to an account. */
export function mentionsQuery(platform: Platform, handle: string, terms: string | null) {
  if (platform === "x") {
    // X reads `a OR b` across the whole query unless the terms are grouped.
    return `@${handle} -from:${handle}` + (terms ? ` (${strip(terms)})` : "");
  }
  return `mentions:${handle}` + (terms ? " " + strip(terms) : "");
}

/** `-from:` added for each excluded author while the query stays within the length limit. X only. */
export function withoutAuthors(query: string, platform: Platform, excluded: Set<string>) {
  if (platform !== "x") return query;
  for (const handle of [...excluded].sort(codePointOrder)) {
    const operator = ` -from:${handle}`;
    if (
      !query.toLowerCase().includes(strip(operator).toLowerCase()) &&
      length(query) + length(operator) <= MAX_QUERY_LENGTH - 40
    ) {
      query += operator;
    }
  }
  return query;
}

function codePointOrder(a: string, b: string) {
  const left = [...a].map((char) => char.codePointAt(0)!);
  const right = [...b].map((char) => char.codePointAt(0)!);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

function conversationPath(ref: PostRef) {
  if (ref.platform === "x") return `/2/conversation/${ref.id}`;
  return `/2/conversation/${quote(ref.handle!, ":")}/${ref.id}`;
}

function threadPath(ref: PostRef) {
  return conversationPath(ref).replace("/2/conversation/", "/2/thread/");
}

/** A post reference for a status the API returned, or null when its URL cannot be parsed. */
function refOf(raw: Dict, platform: Platform): PostRef | null {
  let ref: PostRef;
  try {
    ref = parsePostRef(pyStr(get(raw, "url", "")));
  } catch (error) {
    if (error instanceof UsageError) return null;
    throw error;
  }
  ref.url = get(raw, "url");
  return ref.platform === platform ? ref : null;
}

function results(data: Dict, field: string): Dict[] {
  const found = get(data, field);
  return Array.isArray(found) ? found.filter(isDict) : [];
}

function bottomCursor(data: Dict) {
  return get(or(get(data, "cursor"), {}), "bottom");
}

// --------------------------------------------------------------------------- collection

type Queued = [ref: PostRef, account: string | null, cursor: Json, pages: number];
type SearchResult = { ok: boolean; added: number; seen: number; pages: number };

/** One run: the posts of the file, how many more may be added, and the rules for what is kept. */
export class Collector {
  readonly posts = new Map<Json, Json>();
  left: number;
  readonly own: Set<string>;
  readonly excluded: Set<string>;
  readonly added: JsonObject = {};
  readonly skipped = { duplicate: 0, outside_time_range: 0, by_account_or_repost: 0, excluded_author: 0 };
  readonly masked = { numbers: 0, emails: 0 };
  readonly notes: string[] = [];

  constructor(
    readonly client: Getter,
    posts: Json[],
    limit: number,
    ownHandles: Iterable<string> = [],
    excluded: Iterable<string> = [],
    readonly mask = true,
  ) {
    for (const post of posts) {
      if (!isDict(post)) throw new Error("a post in the data file is not an object");
      if (!has(post, "id")) throw new Error("a post in the data file has no id");
      this.posts.set(get(post, "id"), post);
    }
    this.left = limit;
    this.own = new Set([...ownHandles].map((handle) => handle.toLowerCase()));
    this.excluded = new Set([...excluded].map((handle) => handle.toLowerCase()));
  }

  /**
   * An API status reduced to the fields this skill keeps, or null for anything that is not a
   * post. Of the author only the public handle is kept: no name, bio, location or avatar.
   */
  normalize(raw: Json, platform: Platform, source: string, tags: Tags = {}): JsonObject | null {
    if (!isDict(raw) || get(raw, "type") !== "status" || !truthy(get(raw, "url"))) return null;
    const author = authorOf(raw);
    const moment = postTime(raw);
    return {
      id: postKey(raw, platform),
      platform,
      url: get(raw, "url"),
      author,
      date: moment !== null ? iso(moment) : null,
      text: or(get(raw, "text"), ""),
      likes: count(raw, "likes"),
      reposts: count(raw, "reposts"),
      replies: count(raw, "replies"),
      quotes: count(raw, "quotes"),
      lang: get(raw, "lang"),
      reply_to: get(or(get(raw, "replying_to"), {}), "url"),
      source,
      account: tags.account ?? null,
      goal: tags.goal ?? null,
      query: tags.query ?? null,
      from_account: this.own.has(author.toLowerCase()),
    };
  }

  private store(post: JsonObject) {
    if (this.posts.has(post.id!)) {
      this.skipped.duplicate++;
      return false;
    }
    if (this.mask) post.text = maskPrivate(pyStr(post.text!), this.masked);
    this.posts.set(post.id!, post);
    const source = post.source as string;
    this.added[source] = ((this.added[source] as number | undefined) ?? 0) + 1;
    return true;
  }

  /** One post written by the audience, if it is in range, allowed and new. Counts against --max. */
  addIncoming(raw: Json, platform: Platform, source: string, range: Range | null, tags: Tags = {}) {
    if (this.left <= 0) return false;
    const post = this.normalize(raw, platform, source, tags);
    if (post === null) return false;
    if (post.from_account || truthy(get(raw, "reposted_by"))) {
      this.skipped.by_account_or_repost++;
      return false;
    }
    if (this.excluded.has((post.author as string).toLowerCase())) {
      this.skipped.excluded_author++;
      return false;
    }
    if (!inRange(postTime(raw), range)) {
      this.skipped.outside_time_range++;
      return false;
    }
    if (!this.store(post)) return false;
    this.left--;
    return true;
  }

  /** A post kept for context (an account's own post, a listed post, its thread). Not counted against --max. */
  addContext(raw: Json, platform: Platform, source: string, tags: Tags = {}) {
    const post = this.normalize(raw, platform, source, tags);
    return post !== null && this.store(post);
  }

  /** Pages through one search. `ok` is false when it could not be run. */
  async search(
    platform: Platform,
    text: string,
    feed: string,
    range: Range | null,
    cap: number,
    what: string,
    source: string,
    tags: Tags = {},
  ): Promise<SearchResult> {
    const result = { ok: true, added: 0, seen: 0, pages: 0 };
    let cursor: Json = null;
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      if (this.left <= 0 || result.added >= cap) break;
      const params = { q: text, feed, count: PAGE_SIZE, cursor };
      const data = await this.client.get(platform, "/2/search", params, what, true);
      if (data === null) {
        result.ok = false;
        break;
      }
      const found = results(data, "results");
      if (!found.length) break;
      result.pages++;
      result.seen += found.length;
      for (const raw of found) {
        if (result.added >= cap) break;
        if (this.addIncoming(raw, platform, source, range, tags)) result.added++;
      }
      const times = found.map(postTime);
      if (feed === "latest" && range && times.every((time) => time !== null && time < range[0])) {
        break; // newest first: everything further back is older than the range
      }
      const following = bottomCursor(data);
      if (!truthy(following) || following === cursor) break;
      cursor = following;
    }
    return result;
  }

  /** The account's own posts published in the time range, most replied-to first. */
  async accountPosts(platform: Platform, handle: string, range: Range) {
    const what = `timeline of @${handle} on ${platform}`;
    const route = `/2/profile/${quote(handle, "")}/statuses`;
    const found = new Map<string, Dict>();
    let cursor: Json = null;
    for (let page = 0; page < MAX_TIMELINE_PAGES; page++) {
      const data = await this.client.get(platform, route, { count: PAGE_SIZE, cursor }, what);
      if (data === null) break;
      const statuses = results(data, "results").filter((raw) => get(raw, "type") === "status");
      if (!statuses.length) break;
      const own = statuses.filter(
        (raw) => authorOf(raw).toLowerCase() === handle.toLowerCase() && !truthy(get(raw, "reposted_by")),
      );
      for (const raw of own) if (inRange(postTime(raw), range)) found.set(postKey(raw, platform), raw);
      const times = own.map(postTime);
      if (own.length && times.every((time) => time !== null && time < range[0])) break;
      const following = bottomCursor(data);
      if (!truthy(following) || following === cursor) break;
      cursor = following;
    }
    return [...found.values()].sort((a, b) => count(b, "replies") - count(a, "replies"));
  }

  /**
   * Replies fetched one page per parent post in turn, so that one busy post does not use the
   * whole budget. The first page of a parent has cursor null.
   */
  async replies(queue: Queued[], range: Range | null) {
    while (queue.length && this.left > 0) {
      const [ref, account, cursor, pages] = queue.shift()!;
      const what = `replies to ${pyStr(ref.url ?? null)}`;
      const data = await this.client.get(ref.platform, conversationPath(ref), { ranking_mode: "likes", cursor }, what);
      if (data === null) continue;
      const replies = results(data, "replies");
      for (const raw of replies) this.addIncoming(raw, ref.platform, "reply", range, { account });
      const following = bottomCursor(data);
      if (replies.length && truthy(following) && following !== cursor && pages + 1 < MAX_REPLY_PAGES) {
        queue.push([ref, account, following, pages + 1]);
      }
    }
  }

  /** Posts written to an account: a search for its mentions, then replies under its own posts. */
  async account(platform: Platform, handle: string, range: Range, source: string, terms: string | null, feed: string) {
    let searched = true;
    if (source === "auto" || source === "search") {
      const query = withDates(withoutAuthors(mentionsQuery(platform, handle, terms), platform, this.excluded), range);
      const what = `search for posts mentioning @${handle} on ${platform}`;
      searched = (await this.search(platform, query, feed, range, this.left, what, "search", { account: handle })).ok;
      if (!searched && source === "auto") {
        this.notes.push(
          `Search failed for @${handle} on ${platform}; collected replies to its own posts instead. ` +
            "Posts that only mention the account are missing.",
        );
      }
    }
    if (source === "search" || this.left <= 0) return;
    if (source === "auto" && terms && searched) {
      this.notes.push(
        `--terms narrows the search only, so replies under @${handle}'s own posts were not collected. ` +
          "Run again with --source replies to add them.",
      );
      return;
    }
    const queue: Queued[] = [];
    for (const raw of await this.accountPosts(platform, handle, range)) {
      const ref = refOf(raw, platform);
      if (ref === null || count(raw, "replies") === 0) continue;
      this.addContext(raw, platform, "account", { account: handle });
      queue.push([ref, handle, null, 0]);
    }
    await this.replies(queue, range);
  }

  /** Each topic search, with what it brought in, so that useful queries can be kept. */
  async queries(platform: Platform, queries: Query[], feed: string, range: Range | null, perQuery: number) {
    const report: JsonObject[] = [];
    for (const item of queries) {
      if (this.left <= 0) break;
      const query = withDates(withoutAuthors(item.query, platform, this.excluded), range);
      const what = `search ${pyRepr(item.query)} on ${platform}`;
      const found = await this.search(platform, query, feed, range, perQuery, what, "query", item);
      report.push({
        goal: item.goal,
        query: item.query,
        feed,
        added: found.added,
        seen: found.seen,
        pages: found.pages,
        failed: !found.ok,
      });
    }
    return report;
  }

  /** Each listed post with the thread it belongs to and, on request, its replies. */
  async listed(refs: PostRef[], range: Range | null, withReplies: boolean) {
    const queue: Queued[] = [];
    for (const ref of refs) {
      const what = `post ${ref.text}`;
      const route = withReplies ? conversationPath(ref) : threadPath(ref);
      const data = await this.client.get(ref.platform, route, withReplies ? { ranking_mode: "likes" } : {}, what);
      if (data === null) continue;
      const status = get(data, "status");
      if (!isDict(status) || get(status, "type") !== "status") {
        this.client.errors.push({ what, status: get(data, "code"), message: describe(404, {}), url: null });
        continue;
      }
      this.addContext(status, ref.platform, "listed");
      const thread = get(data, "thread");
      for (const raw of truthy(thread) && Array.isArray(thread) ? thread : []) {
        if (isDict(raw) && postKey(raw, ref.platform) !== postKey(status, ref.platform)) {
          this.addContext(raw, ref.platform, "thread");
        }
      }
      if (!withReplies) continue;
      const replies = get(data, "replies");
      for (const raw of Array.isArray(replies) ? replies : []) {
        if (isDict(raw)) this.addIncoming(raw, ref.platform, "reply", range);
      }
      const following = bottomCursor(data);
      const parent = refOf(status, ref.platform);
      if (truthy(replies) && truthy(following) && parent) queue.push([parent, null, following, 1]);
    }
    await this.replies(queue, range);
  }
}

// --------------------------------------------------------------------------- data file

export type Doc = { format: string; runs: Json; posts: Json[] };

/** The data file, or a new one when it is not there yet. */
export function load(file: string): Doc {
  if (!fs.existsSync(file)) return { format: FORMAT, runs: [], posts: [] };
  let doc: Json;
  try {
    doc = loads(decodeUtf8(fs.readFileSync(file)));
  } catch (error) {
    const why = error instanceof DecodeError ? error.message : osError(error, file);
    throw new UsageError(`--out ${file} exists but cannot be read as JSON (${why}). Choose another file.`);
  }
  const posts = get(doc, "posts");
  if (!isDict(doc) || get(doc, "format") !== FORMAT || !Array.isArray(posts)) {
    throw new UsageError(`--out ${file} exists and is not a file this script wrote. Choose another file.`);
  }
  return { format: FORMAT, runs: get(doc, "runs", []), posts };
}

/** The file written with one run and one post per line, so it stays readable line by line. */
export function save(file: string, runs: Json[], posts: Json[]) {
  const block = (name: string, items: Json[], last: boolean) => [
    ` "${name}": [`,
    ...items.map((item, index) => `  ${dumps(item)}${index < items.length - 1 ? "," : ""}`),
    last ? " ]" : " ],",
  ];
  const lines = ["{", ` "format": ${JSON.stringify(FORMAT)},`, ...block("runs", runs, false), ...block("posts", posts, true), "}"];
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, lines.join("\n") + "\n");
  fs.renameSync(temporary, file);
}

// --------------------------------------------------------------------------- command

function readLines(file: string, option: string) {
  let text: string;
  try {
    text = decodeUtf8(fs.readFileSync(file));
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new UsageError(`${option} ${file}: ${osError(error, file)}`);
  }
  return universalNewlines(text)
    .split("\n")
    .map(strip)
    .filter((line) => line && !line.startsWith("#"));
}

function readRefs(posts: string[], postsFile: string | null) {
  const texts = [...posts, ...(postsFile ? readLines(postsFile, "--posts-file") : [])];
  const refs: PostRef[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const ref = parsePostRef(text);
    ref.text = text;
    const key = `${ref.platform}\u0000${ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

function readQueries(queries: string[], queriesFile: string | null) {
  const texts = [...queries, ...(queriesFile ? readLines(queriesFile, "--queries-file") : [])];
  const found: Query[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const item = parseQuery(text);
    if (!seen.has(item.query.toLowerCase())) {
      seen.add(item.query.toLowerCase());
      found.push(item);
    }
  }
  return found;
}

const text = (args: Values, key: string) => (args[key] as string | null) ?? null;
const whole = (args: Values, key: string) => args[key] as number;
const list = (args: Values, key: string) => args[key] as string[];

/** Runs the command. `client` and `now` are replaced by the tests. */
export async function runCollect(args: Values, client?: Getter, now: Moment = Date.now() * 1000): Promise<number> {
  const out = text(args, "out")!;
  const accounts: [Platform, string][] = [];
  for (const value of list(args, "account")) {
    const account = parseAccount(value);
    if (!accounts.some(([platform, handle]) => platform === account[0] && handle === account[1])) accounts.push(account);
  }
  const refs = readRefs(list(args, "post"), text(args, "posts_file"));
  const queries = readQueries(list(args, "query"), text(args, "queries_file"));
  if (!accounts.length && !refs.length && !queries.length) {
    throw new UsageError("nothing to collect: give at least one --query, --queries-file, --account, --post or --posts-file.");
  }
  const max = whole(args, "max");
  const perQuery = whole(args, "per_query");
  const days = args.days as number | null;
  const replies = args.replies as boolean;
  if (max < 1) throw new UsageError("--max must be at least 1.");
  if (perQuery < 1) throw new UsageError("--per-query must be at least 1.");
  if (days !== null && days < 1) throw new UsageError("--days must be at least 1.");
  if (replies && !refs.length) throw new UsageError("--replies applies to --post; for an account use --source replies.");
  const excluded = list(args, "exclude_from")
    .map((handle) => lstripChars(strip(handle), "@"))
    .filter(Boolean);
  const givenRange = resolveRange(days, text(args, "since"), text(args, "until"), now);
  const accountRange: Range = givenRange ?? [addDays(now, -DEFAULT_DAYS), now];
  for (const item of queries) {
    const size = length(withDates(item.query, givenRange));
    if (size > MAX_QUERY_LENGTH) {
      throw new UsageError(
        `query ${pyRepr(item.query)} is ${size} characters with its date range; ` +
          `the search accepts ${MAX_QUERY_LENGTH}. Split it into two queries.`,
      );
    }
  }
  const doc = load(out);

  const feed = text(args, "feed")!;
  const platform = text(args, "platform") as Platform;
  const source = text(args, "source")!;
  const terms = text(args, "terms");
  const timed = accounts.length > 0 || givenRange !== null;
  const scope: JsonObject = {
    queries: queries.length,
    accounts: accounts.map(([where, handle]) => `${where}:${handle}`),
    listed_posts: refs.length,
    since: timed ? iso(accountRange[0]) : null,
    until: timed ? iso(accountRange[1]) : null,
    max,
    per_query: queries.length ? perQuery : null,
    feed: queries.length || accounts.length ? feed : null,
    platform: queries.length ? platform : null,
    source: accounts.length ? source : null,
    terms,
    excluded_authors: excluded,
    replies_of_listed_posts: replies,
  };
  const lowered = new Set(excluded.map((handle) => handle.toLowerCase()));
  if (args.dry) {
    const plan: JsonObject = { ...scope, out, dry: true, posts_already_in_file: doc.posts.length };
    plan.searches = [
      ...queries.map((item) => withDates(withoutAuthors(item.query, platform, lowered), givenRange)),
      ...accounts
        .filter(() => source === "auto" || source === "search")
        .map(([where, handle]) => withDates(withoutAuthors(mentionsQuery(where, handle, terms), where, lowered), accountRange)),
    ];
    print(dumps(plan, 2));
    return 0;
  }

  if (!Array.isArray(doc.runs)) throw new Error(`--out ${out}: "runs" in the data file is not a list`);
  const runs = doc.runs;
  const getter = client ?? new Client();
  const ownHandles = new Set(accounts.map(([, handle]) => handle));
  for (const earlier of runs) {
    // accounts of earlier runs stay marked in posts added now
    const names = or(get(earlier, "accounts"), []);
    for (const name of Array.isArray(names) ? names : []) ownHandles.add(partition(pyStr(name), ":")[2]);
  }
  const collector = new Collector(getter, doc.posts, max, ownHandles, excluded, !args.keep_numbers);
  if (refs.length) await collector.listed(refs, givenRange, replies);
  const byQuery = queries.length ? await collector.queries(platform, queries, feed, givenRange, perQuery) : [];
  for (const [where, handle] of accounts) await collector.account(where, handle, accountRange, source, terms, feed);
  const notes = collector.notes;
  if (collector.left <= 0) notes.push(`Stopped at --max ${max}; more posts may exist in this scope.`);

  const added = Object.values(collector.added).reduce<number>((sum, value) => sum + (value as number), 0);
  const failures: Failure[] = getter.errors;
  const summary: JsonObject = {
    out,
    added,
    added_by_source: collector.added,
    total_in_file: collector.posts.size,
    skipped: collector.skipped,
    masked: collector.masked,
    by_query: byQuery,
    scope,
    requests: getter.requests,
    could_not_fetch: failures,
    notes,
  };
  if (added === 0 && !doc.posts.length) {
    summary.out = null;
    notes.push("Nothing was collected, so no file was written.");
    print(dumps(summary, 2));
    return 1;
  }
  runs.push({ ...scope, at: iso(now), added, by_query: byQuery, could_not_fetch: failures, notes });
  save(out, runs, [...collector.posts.values()]);
  print(dumps(summary, 2));
  return 0;
}

// --------------------------------------------------------------------------- help

const TOPIC = "topic search";
const ACCOUNT = "posts sent to an account";
const LISTED = "a list of posts";
const LIMITS = "limits and filters";

export const COLLECT: Command = {
  name: "collect",
  summary: "collect public posts from X/Twitter or Bluesky into the data file",
  description:
    "Collect public posts from X/Twitter or Bluesky, through the FxEmbed API (no key or login), " +
    "into one JSON data file: by topic search (--query, --queries-file), by the posts sent to an " +
    "account (--account), or from a list of posts (--post, --posts-file). Give at least one of them. " +
    "Running it again with the same --out adds to the file and skips the posts already in it. " +
    "Phone, account and ticket numbers and email addresses are masked in the saved text." +
    "\n\n" +
    "Times are UTC. Without --since, --until or --days, topic searches and listed posts have no " +
    `time range, and an account search covers the last ${DEFAULT_DAYS} days. ` +
    "Check a plan with --dry before collecting.",
  positionals: [],
  options: [
    { name: "--out", dest: "out", metavar: "FILE", required: true, help: "data file to create or add to, such as _swe/research-market/<name>/posts.json" },
    {
      name: "--query",
      dest: "query",
      metavar: "TEXT",
      repeat: true,
      anyValue: true,
      group: TOPIC,
      help: "a search to run, written `goal | search text` or as the search text alone; the text may begin with -",
    },
    {
      name: "--queries-file",
      dest: "queries_file",
      metavar: "FILE",
      group: TOPIC,
      help: "text file with one `goal | search text` per line; blank lines and lines starting with # are skipped",
    },
    { name: "--per-query", dest: "per_query", metavar: "N", type: "int", default: DEFAULT_PER_QUERY, group: TOPIC, help: "most posts to add per query" },
    { name: "--platform", dest: "platform", choices: ["x", "bluesky"], default: "x", group: TOPIC, help: "where the queries are run" },
    {
      name: "--account",
      dest: "account",
      metavar: "ACCOUNT",
      repeat: true,
      group: ACCOUNT,
      help: "account whose incoming posts to collect: x:<handle>, bsky:<handle>, @<handle> or a profile URL",
    },
    {
      name: "--source",
      dest: "source",
      choices: ["auto", "search", "replies"],
      default: "auto",
      group: ACCOUNT,
      help:
        "`search` for posts mentioning the account, `replies` for replies under its own posts, " +
        "`auto` for search first and replies for what is left of --max",
    },
    {
      name: "--terms",
      dest: "terms",
      metavar: "TEXT",
      anyValue: true,
      group: ACCOUNT,
      help: "extra search terms that narrow the account search, such as a product name or -giveaway; with --source auto, replies are then not collected",
    },
    {
      name: "--post",
      dest: "post",
      metavar: "URL",
      repeat: true,
      group: LISTED,
      help: "a post to fetch with its thread: an X/Twitter or bsky.app post URL, an at:// URI or an X post ID",
    },
    { name: "--posts-file", dest: "posts_file", metavar: "FILE", group: LISTED, help: "text file with one post URL or ID per line" },
    { name: "--replies", dest: "replies", flag: true, group: LISTED, help: "also collect the replies to every listed post" },
    { name: "--since", dest: "since", metavar: "TIME", group: LIMITS, help: "start of the time range: YYYY-MM-DD or ISO 8601 such as 2026-10-07T12:00:00Z, UTC" },
    {
      name: "--until",
      dest: "until",
      metavar: "TIME",
      defaultText: "now",
      group: LIMITS,
      help: "end of the time range, same forms; a plain date is included in full",
    },
    {
      name: "--days",
      dest: "days",
      metavar: "N",
      type: "int",
      group: LIMITS,
      help: `time range of the last N days before --until; not with --since (without any range, --account uses ${DEFAULT_DAYS})`,
    },
    { name: "--max", dest: "max", metavar: "N", type: "int", default: DEFAULT_MAX, group: LIMITS, help: "most posts to add in this run" },
    {
      name: "--feed",
      dest: "feed",
      choices: ["latest", "top"],
      default: "latest",
      group: LIMITS,
      help: "search tab: `latest` for recent posts, `top` for the most resonant",
    },
    {
      name: "--exclude-from",
      dest: "exclude_from",
      metavar: "HANDLE",
      repeat: true,
      group: LIMITS,
      help: "drop posts written by this account, such as a brand's own accounts or a bot",
    },
    {
      name: "--keep-numbers",
      dest: "keep_numbers",
      flag: true,
      group: LIMITS,
      help: "do not mask phone, account and ticket numbers and email addresses in the saved text",
    },
    { name: "--dry", dest: "dry", flag: true, group: LIMITS, help: "check the arguments and print the plan with its searches, without any request" },
  ],
  output:
    "Prints a JSON summary: `added`, `added_by_source`, `total_in_file`, `skipped`, `masked`, " +
    "`by_query` (what each query brought in), `scope`, `requests`, `could_not_fetch` (every request " +
    "that failed, with the reason) and `notes` (what that leaves out). With --dry it prints the plan " +
    "and the exact `searches` instead, and writes nothing." +
    "\n\n" +
    "Writes --out: one JSON object with a line per run and a line per post. Each post keeps its id, " +
    "platform, url, author handle, date, text, likes, reposts, replies, quotes, lang, reply_to, " +
    "source, account, goal, query and from_account.",
  exitCodes: [
    ["0", "the file was written (read `could_not_fetch` for what is missing), or the --dry plan was printed"],
    ["1", "nothing could be collected, so no file was written; read `could_not_fetch`"],
    ["2", "wrong usage: a bad option, handle, post URL or time, or an --out file this command did not write"],
  ],
  examples: [
    "market collect --out posts.json --queries-file queries.txt --dry",
    "market collect --out posts.json --queries-file queries.txt --days 30 --max 300",
    "market collect --out posts.json --account x:AcmeHelp --days 14 --exclude-from Acme",
    "market collect --out posts.json --post https://x.com/user/status/1234567890 --replies",
  ],
  run: (args) => runCollect(args),
};

