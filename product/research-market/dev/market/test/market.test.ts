// Tests for the market script. Run: bun test (in dev/market)
//
// Nothing leaves the machine: the collection tests answer from a fake client, and the client
// tests and the built script talk to a fake FxEmbed API served on this machine.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArgumentError, type Command, WIDTH, parseCommand } from "../src/args";
import { Client, type Dict, type Failure, type Fetcher, type Getter, type Params, type Platform, USER_AGENT } from "../src/client";
import {
  COLLECT,
  Collector,
  FORMAT,
  maskPrivate,
  mentionsQuery,
  parseAccount,
  parsePostRef,
  parseQuery,
  runCollect,
  withDates,
  withoutAuthors,
} from "../src/collect";
import { COMMANDS, PROG, main } from "../src/commands";
import { UsageError, io } from "../src/core";
import { LIST } from "../src/list";
import { DecodeError, type Json, type JsonObject, PyFloat, decodeUtf8, dumps, loads, round1 } from "../src/pyjson";
import { TALLY } from "../src/tally";
import { iso, parseTime } from "../src/time";

const SCRIPT = path.resolve(import.meta.dir, "..", "..", "..", "scripts", "market.js");
const REDIRECT = path.join(import.meta.dir, "redirect.ts");
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0) * 1000;

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "market-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const file = (name: string) => path.join(dir, name);
function write(name: string, value: string | Json) {
  fs.writeFileSync(file(name), typeof value === "string" ? value : JSON.stringify(value));
  return file(name);
}
const readJson = (target: string) => JSON.parse(fs.readFileSync(target, "utf8"));

/** Runs the command line and returns its exit code, stdout and stderr. */
async function cli(...args: string[]): Promise<[number, string, string]> {
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

// ------------------------------------------------------------------------- collect helpers

function stamp(text: string) {
  return Date.parse(text.replace(" ", "T") + ":00Z") / 1000;
}

function xPost(
  id: number,
  author: string,
  when: string,
  extra: { text?: string; replies?: number; likes?: number; replyTo?: string; repostedBy?: JsonObject } = {},
): JsonObject {
  return {
    type: "status",
    id: String(id),
    url: `https://x.com/${author}/status/${id}`,
    text: extra.text ?? "hello",
    created_timestamp: stamp(when),
    likes: extra.likes ?? 0,
    reposts: 0,
    replies: extra.replies ?? 0,
    quotes: 0,
    lang: "en",
    reposted_by: extra.repostedBy ?? null,
    author: { screen_name: author, name: "Real Name", description: "bio", location: "Jakarta" },
    replying_to: extra.replyTo ? { screen_name: "Acme", status: "1", url: extra.replyTo } : null,
  };
}

function bskyPost(rkey: string, author: string, when: string, replies = 0): JsonObject {
  return {
    type: "status",
    id: rkey,
    at_uri: `at://did:plc:${author.split(".")[0]}/app.bsky.feed.post/${rkey}`,
    url: `https://bsky.app/profile/${author}/post/${rkey}`,
    text: "hello",
    created_timestamp: stamp(when),
    likes: 1,
    reposts: 0,
    replies,
    lang: "en",
    author: { screen_name: author },
    replying_to: null,
    reposted_by: null,
  };
}

type Answer = (platform: Platform, route: string, params: Record<string, Json>) => Dict | null;

/** Answers `get` from a function and records the calls. */
class FakeClient implements Getter {
  calls: [Platform, string, Record<string, Json>][] = [];
  errors: Failure[] = [];
  requests = 0;
  constructor(private readonly answer: Answer) {}
  async get(platform: Platform, route: string, params: Params, what: string) {
    this.requests++;
    const given = Object.fromEntries(Object.entries(params).filter((entry): entry is [string, Json] => entry[1] != null));
    this.calls.push([platform, route, given]);
    const body = this.answer(platform, route, given);
    if (body === null) this.errors.push({ what, status: 500, message: "server or upstream failure", url: route });
    return body;
  }
}

async function collect(argv: string[], client: Getter): Promise<[number, any]> {
  const out: string[] = [];
  const kept = { ...io };
  io.out = (text) => void out.push(text);
  try {
    const code = await runCollect(parseCommand(PROG, COLLECT, argv), client, NOW);
    return [code, JSON.parse(out.join("\n"))];
  } finally {
    Object.assign(io, kept);
  }
}

async function usageError(argv: string[]) {
  const client = new FakeClient(() => ({}));
  const outcome = runCollect(parseCommand(PROG, COLLECT, argv), client, NOW);
  await expect(outcome).rejects.toBeInstanceOf(UsageError);
}

// ------------------------------------------------------------------------- collect: parsing

describe("collect: parsing", () => {
  test("account forms", () => {
    expect(parseAccount("x:NotionHQ")).toEqual(["x", "NotionHQ"]);
    expect(parseAccount("twitter:@NotionHQ")).toEqual(["x", "NotionHQ"]);
    expect(parseAccount("@NotionHQ")).toEqual(["x", "NotionHQ"]);
    expect(parseAccount("https://x.com/NotionHQ")).toEqual(["x", "NotionHQ"]);
    expect(parseAccount("bsky.app")).toEqual(["bluesky", "bsky.app"]);
    expect(parseAccount("bsky:@name.bsky.social")).toEqual(["bluesky", "name.bsky.social"]);
    expect(parseAccount("https://bsky.app/profile/bsky.app")).toEqual(["bluesky", "bsky.app"]);
  });

  test("accounts rejected", () => {
    for (const bad of ["x:has.dot", "bsky:nodot", "x:way_too_long_for_a_handle", ""]) {
      expect(() => parseAccount(bad)).toThrow(UsageError);
    }
    expect(() => parseAccount("x:has.dot")).toThrow(
      "--account 'x:has.dot': not an X/Twitter handle (letters, digits and _, at most 15). Use x:<handle> or bsky:<handle>.",
    );
  });

  test("post references", () => {
    for (const url of [
      "https://x.com/user/status/2108011878639378578",
      "https://twitter.com/user/status/2108011878639378578?s=20",
      "https://mobile.twitter.com/user/status/2108011878639378578/photo/1",
      "https://fxtwitter.com/user/status/2108011878639378578",
      "2108011878639378578",
    ]) {
      expect([url, parsePostRef(url).id, parsePostRef(url).platform]).toEqual([url, "2108011878639378578", "x"]);
    }
    const bsky = parsePostRef("https://bsky.app/profile/bsky.app/post/3mwolmfws5k2r");
    expect([bsky.platform, bsky.handle, bsky.id]).toEqual(["bluesky", "bsky.app", "3mwolmfws5k2r"]);
    const uri = parsePostRef("at://did:plc:abc/app.bsky.feed.post/3mwolmfws5k2r");
    expect([uri.handle, uri.id]).toEqual(["did:plc:abc", "3mwolmfws5k2r"]);
  });

  test("post references rejected", () => {
    for (const bad of ["https://x.com/NotionHQ", "https://example.com/a/status/1", "not a url"]) {
      expect(() => parsePostRef(bad)).toThrow(UsageError);
    }
  });

  test("times", () => {
    expect(iso(parseTime("2026-10-07"))).toBe("2026-10-07T00:00:00Z");
    expect(iso(parseTime("2026-10-07", true))).toBe("2026-10-08T00:00:00Z");
    expect(iso(parseTime("2026-10-07T12:00:00+07:00"))).toBe("2026-10-07T05:00:00Z");
    expect(iso(parseTime("2026-10-07T12:00:00Z"))).toBe("2026-10-07T12:00:00Z");
    expect(iso(parseTime("2026-10-07 12"))).toBe("2026-10-07T12:00:00Z");
    expect(iso(parseTime("2026-10-07T12:00:00.123456+07:00:30"))).toBe("2026-10-07T04:59:30Z");
    for (const bad of ["last week", "2026-02-30", "2026-10-07T1200", "2026-10-07T12:00:00+07", "20261007", "2026-10-07T24:00"]) {
      expect(() => parseTime(bad)).toThrow(UsageError);
    }
    expect(() => parseTime("last week")).toThrow(
      "time 'last week': use YYYY-MM-DD or an ISO 8601 date-time such as 2026-10-07T12:00:00Z.",
    );
  });

  test("times stay within the years 1 to 9999", async () => {
    expect(iso(parseTime("9999-12-30", true))).toBe("9999-12-31T00:00:00Z");
    expect(() => parseTime("9999-12-31", true)).toThrow("date value out of range");
    expect(() => parseTime("0001-01-01T00:00+01:00")).toThrow("date value out of range");
    // The search adds a day to --until, which passes the year 9999 here: the run fails (exit 1).
    const [code, , err] = await cli("collect", "--out", file("p.json"), "--query", "a", "--until", "9999-12-30", "--dry");
    expect(code).toBe(1);
    expect(err).toBe("market collect: failed: date value out of range (dates must fall in the years 1 to 9999)\n");
  });

  test("search strings", () => {
    const range: [number, number] = [parseTime("2026-10-01"), parseTime("2026-10-07", true)];
    expect(withDates(mentionsQuery("x", "Acme", "bug OR broken"), range)).toBe(
      "@Acme -from:Acme (bug OR broken) since:2026-10-01 until:2026-10-09",
    );
    expect(mentionsQuery("bluesky", "acme.test", "billing")).toBe("mentions:acme.test billing");
    expect(withDates("budget app", null)).toBe("budget app");
    expect(withoutAuthors("@Acme -from:Acme", "x", new Set(["acme", "acmebot"]))).toBe("@Acme -from:Acme -from:acmebot");
    expect(withoutAuthors("mentions:a.test", "bluesky", new Set(["bot"]))).toBe("mentions:a.test");
  });

  test("queries", () => {
    expect(parseQuery(' wish |  "i wish"   budget app ')).toEqual({ goal: "wish", query: '"i wish" budget app' });
    expect(parseQuery("budget app hassle")).toEqual({ goal: null, query: "budget app hassle" });
    expect(() => parseQuery("wish | ")).toThrow(UsageError);
  });

  test("text options may start with a dash", () => {
    const args = parseCommand(PROG, COLLECT, ["--out", "o", "--terms", "-from:Acme", "--query", "-x y", "--max", "5"]);
    expect([args.terms, args.query, args.max]).toEqual(["-from:Acme", ["-x y"], 5]);
    expect(() => parseCommand(PROG, COLLECT, ["--out", "o", "--terms"])).toThrow("argument --terms: expected one argument");
  });

  test("masks numbers and emails only", () => {
    const tally = { numbers: 0, emails: 0 };
    const text =
      "call 0817 0123442 or +62-812-3456-7890, acct 1234567890123, mail me@example.co.id, paid Rp 1.250.000 " +
      "and 217.856 on 2026-10-08, see https://x.com/a/status/2108011878639378578 ref 12345678";
    expect(maskPrivate(text, tally)).toBe(
      "call [number] or [number], acct [number], mail [email], paid Rp 1.250.000 " +
        "and 217.856 on 2026-10-08, see https://x.com/a/status/2108011878639378578 ref 12345678",
    );
    expect(tally).toEqual({ numbers: 3, emails: 1 });
  });
});

describe("collect: posts", () => {
  test("keeps only the handle of the author", () => {
    const raw = xPost(5, "someone", "2026-10-07 10:00", { text: "it broke", likes: 3, replyTo: "https://x.com/Acme/status/1" });
    const post = new Collector(new FakeClient(() => null), [], 10, ["Acme"]).normalize(raw, "x", "search", { account: "Acme" })!;
    expect(post.author).toBe("someone");
    expect(post.date).toBe("2026-10-07T10:00:00Z");
    expect([post.likes, post.reposts, post.replies, post.quotes]).toEqual([3, 0, 0, 0]);
    expect(post.reply_to).toBe("https://x.com/Acme/status/1");
    expect(post.from_account).toBe(false);
    const dumped = dumps(post);
    for (const secret of ["Real Name", "bio", "Jakarta"]) expect(dumped).not.toContain(secret);
  });

  test("skips what is not a post", () => {
    const collector = new Collector(new FakeClient(() => null), [], 10);
    expect(collector.normalize({ type: "tombstone", reason: "deleted" }, "x", "thread")).toBeNull();
    expect(collector.normalize(null, "x", "thread")).toBeNull();
  });
});

// ------------------------------------------------------------------------- collect: accounts

describe("collect: accounts", () => {
  test("search pages, filters and stops at --max", async () => {
    const pages: Record<string, Dict> = {
      none: {
        results: [
          xPost(10, "u1", "2026-10-08 09:00"),
          xPost(11, "Acme", "2026-10-08 08:00"), // the account itself
          xPost(12, "u2", "2026-10-08 07:00", { repostedBy: { screen_name: "u9" } }),
          xPost(13, "u3", "2026-09-01 07:00"), // before the range
        ],
        cursor: { top: "t", bottom: "c1" },
      },
      c1: {
        results: [0, 1, 2, 3, 4].map((i) => xPost(20 + i, `u${i}`, `2026-10-07 0${i}:00`)),
        cursor: { top: "t", bottom: "c2" },
      },
    };
    const client = new FakeClient((_, __, params) => pages[(params.cursor as string | undefined) ?? "none"]!);
    const out = file("posts.json");
    const [code, summary] = await collect(["--out", out, "--account", "x:Acme", "--days", "3", "--max", "4", "--source", "search"], client);
    expect(code).toBe(0);
    expect(summary.added).toBe(4);
    expect(summary.skipped.by_account_or_repost).toBe(2);
    expect(summary.skipped.outside_time_range).toBe(1);
    expect(client.calls.length).toBe(2);
    expect(client.calls[0]![2].q).toBe("@Acme -from:Acme since:2026-10-05 until:2026-10-09");
    expect(summary.notes.some((note: string) => note.includes("--max 4"))).toBe(true);
    const doc = readJson(out);
    expect(doc.posts.map((post: JsonObject) => post.id)).toEqual(["x:10", "x:20", "x:21", "x:22"]);
    expect(doc.runs[0].accounts).toEqual(["x:Acme"]);
  });

  test("search stops when a page is older than the range", async () => {
    const client = new FakeClient(() => ({ results: [xPost(1, "u1", "2026-09-01 07:00")], cursor: { bottom: "more" } }));
    const out = file("posts.json");
    const [code] = await collect(["--out", out, "--account", "x:Acme", "--source", "search"], client);
    expect(code).toBe(1);
    expect(client.calls.length).toBe(1);
    expect(fs.existsSync(out)).toBe(false);
  });

  test("a failed search falls back to replies, one page per parent in turn", async () => {
    const first = bskyPost("aaa", "acme.test", "2026-10-06 10:00", 50);
    const second = bskyPost("bbb", "acme.test", "2026-10-07 10:00", 3);
    const silent = bskyPost("ccc", "acme.test", "2026-10-07 11:00", 0);
    const reposted = { ...bskyPost("ddd", "other.test", "2026-10-07 12:00", 9), reposted_by: { screen_name: "acme.test" } };
    const client = new FakeClient((_, route, params): Dict | null => {
      if (route === "/2/search") return null;
      if (route.endsWith("/statuses")) return { results: [second, silent, reposted, first], cursor: { top: null, bottom: null } };
      const rkey = route.split("/").pop()!;
      const page = (params.cursor as string | undefined) ?? "p0";
      const replies = [0, 1].map((i) => bskyPost(`${rkey}${page}${i}`, `fan${i}.test`, "2026-10-07 13:00"));
      const following = rkey === "aaa" ? ({ p0: "p1", p1: null } as Record<string, string | null>)[page]! : null;
      return { status: {}, thread: [], replies, cursor: { bottom: following } };
    });
    const out = file("posts.json");
    const [code, summary] = await collect(["--out", out, "--account", "bsky:acme.test", "--max", "50"], client);
    expect(code).toBe(0);
    expect(summary.added_by_source).toEqual({ account: 2, reply: 6 });
    expect(summary.could_not_fetch.length).toBe(1);
    expect(summary.notes[0]).toContain("Search failed");
    const conversations = client.calls.map(([, route]) => route).filter((route) => route.includes("/conversation/"));
    expect(conversations).toEqual([
      "/2/conversation/acme.test/aaa",
      "/2/conversation/acme.test/bbb",
      "/2/conversation/acme.test/aaa",
    ]);
    const own = readJson(out).posts.filter((post: JsonObject) => post.from_account);
    expect(own.map((post: JsonObject) => post.source).sort()).toEqual(["account", "account"]);
  });

  test("--terms keeps auto to the search", async () => {
    const client = new FakeClient(() => ({ results: [xPost(1, "u1", "2026-10-08 07:00")], cursor: { bottom: null } }));
    const [code, summary] = await collect(["--out", file("posts.json"), "--account", "x:Acme", "--terms", "billing"], client);
    expect(code).toBe(0);
    expect(client.calls.map(([, route]) => route)).toEqual(["/2/search"]);
    expect(client.calls[0]![2].q).toContain("@Acme -from:Acme (billing) since:");
    expect(summary.notes.some((note: string) => note.includes("--source replies"))).toBe(true);
  });

  test("a second run adds to the file without duplicates", async () => {
    const answer: Answer = () => ({ results: [xPost(1, "u1", "2026-10-08 07:00"), xPost(2, "u2", "2026-10-08 06:00")], cursor: {} });
    const out = file("posts.json");
    await collect(["--out", out, "--account", "x:Acme", "--source", "search"], new FakeClient(answer));
    const [code, summary] = await collect(["--out", out, "--account", "x:Acme", "--source", "search"], new FakeClient(answer));
    expect(code).toBe(0);
    expect([summary.added, summary.total_in_file, summary.skipped.duplicate]).toEqual([0, 2, 2]);
    const doc = readJson(out);
    expect([doc.posts.length, doc.runs.length]).toEqual([2, 2]);
    const lines = fs.readFileSync(out, "utf8").split("\n");
    expect(lines.filter((line) => line.startsWith('  {"id"')).length).toBe(2); // one post per line
  });
});

// ------------------------------------------------------------------------- collect: queries

describe("collect: queries", () => {
  test("queries tag posts and report per query", async () => {
    const client = new FakeClient((_, __, params): Dict | null => {
      const q = params.q as string;
      if (q.includes('"i wish"')) {
        const found = [0, 1, 2, 3, 4].map((i) => xPost(50 + i, `u${i}`, `2026-10-0${i + 1} 07:00`));
        found[1] = xPost(51, "BrandBot", "2026-10-02 07:00");
        return { results: found, cursor: { bottom: null } };
      }
      if (q.includes("hassle")) {
        return {
          results: [xPost(50, "u0", "2026-10-01 07:00"), xPost(60, "u9", "2026-10-03 07:00", { text: "call 081234567890" })],
          cursor: { bottom: null },
        };
      }
      return null;
    });
    const queries = write("queries.txt", '# library\nwish | "i wish" budget app\n\npain | budget app hassle\nobjection | budget app scam\n');
    const out = file("posts.json");
    const [code, summary] = await collect(
      ["--out", out, "--queries-file", queries, "--per-query", "3", "--feed", "top", "--exclude-from", "@BrandBot", "--since", "2026-10-01", "--until", "2026-10-07"],
      client,
    );
    expect(code).toBe(0);
    expect(client.calls[0]![2].q).toBe('"i wish" budget app -from:brandbot since:2026-10-01 until:2026-10-09');
    expect(client.calls[0]![2].feed).toBe("top");
    expect(summary.by_query.map((q: JsonObject) => [q.goal, q.added, q.failed])).toEqual([
      ["wish", 3, false],
      ["pain", 1, false],
      ["objection", 0, true],
    ]);
    expect(summary.skipped.excluded_author).toBe(1);
    expect(summary.skipped.duplicate).toBe(1);
    expect(summary.masked).toEqual({ numbers: 1, emails: 0 });
    expect(summary.could_not_fetch.length).toBe(1);
    const doc = readJson(out);
    expect(doc.posts.map((post: JsonObject) => [post.id, post.goal])).toEqual([
      ["x:50", "wish"],
      ["x:52", "wish"],
      ["x:53", "wish"],
      ["x:60", "pain"],
    ]);
    expect(doc.posts[0].query).toBe('"i wish" budget app');
    expect(doc.posts[3].text).toBe("call [number]");
    expect(doc.runs[0].by_query[0].query).toBe('"i wish" budget app');
  });

  test("--keep-numbers and --terms starting with a dash", async () => {
    const client = new FakeClient(() => ({ results: [xPost(70, "u1", "2026-10-08 07:00", { text: "call 081234567890" })], cursor: {} }));
    const out = file("posts.json");
    const [code] = await collect(
      ["--out", out, "--account", "x:Acme", "--terms", "-from:AcmeNews", "--keep-numbers", "--source", "search"],
      client,
    );
    expect(code).toBe(0);
    expect(client.calls[0]![2].q).toContain("(-from:AcmeNews)");
    expect(readJson(out).posts[0].text).toBe("call 081234567890");
  });

  test("a query too long", async () => {
    await usageError(["--out", file("posts.json"), "--query", "word ".repeat(120)]);
  });
});

// ------------------------------------------------------------------------- collect: listed posts

describe("collect: listed posts", () => {
  test("a listed post with its thread and replies", async () => {
    const parent = xPost(41, "Acme", "2026-10-01 10:00", { replies: 2 });
    const listed = xPost(42, "u1", "2026-10-01 11:00", { replyTo: parent.url as string });
    const client = new FakeClient((_, route, params): Dict | null => {
      if (route === "/2/conversation/42" && !("cursor" in params)) {
        return {
          code: 200,
          status: listed,
          thread: [parent, listed, { type: "tombstone" }],
          replies: [xPost(43, "u2", "2026-10-01 12:00")],
          cursor: { bottom: "n" },
        };
      }
      if (route === "/2/conversation/42") return { code: 200, status: listed, thread: [], replies: [], cursor: { bottom: "n2" } };
      return null;
    });
    const [code, summary] = await collect(
      ["--out", file("posts.json"), "--post", listed.url as string, "--post", "42", "--post", "999", "--replies"],
      client,
    );
    expect(code).toBe(0);
    expect(summary.added_by_source).toEqual({ listed: 1, thread: 1, reply: 1 });
    expect(summary.scope.listed_posts).toBe(2); // the same post given twice is fetched once
    expect(summary.could_not_fetch.map((error: JsonObject) => error.what)).toEqual(["post 999"]);
    expect(client.calls.filter(([, route]) => route === "/2/conversation/42").length).toBe(2);
  });

  test("a listed post without replies uses the thread", async () => {
    const post = bskyPost("3abc", "u1.test", "2026-10-01 11:00");
    const client = new FakeClient(() => ({ code: 200, status: post, thread: [post] }));
    const [code, summary] = await collect(["--out", file("posts.json"), "--post", post.url as string], client);
    expect(code).toBe(0);
    expect(client.calls).toEqual([["bluesky", "/2/thread/u1.test/3abc", {}]]);
    expect(summary.added_by_source).toEqual({ listed: 1 });
  });

  test("a missing post is reported", async () => {
    const client = new FakeClient(() => ({ code: 404, status: null, thread: null }));
    const [code, summary] = await collect(["--out", file("posts.json"), "--post", "123456"], client);
    expect(code).toBe(1);
    expect(summary.out).toBeNull();
    expect(summary.could_not_fetch[0].what).toBe("post 123456");
  });
});

// ------------------------------------------------------------------------- collect: usage

describe("collect: usage", () => {
  test("usage errors", async () => {
    await usageError(["--out", "x.json"]);
    await usageError(["--out", "x.json", "--account", "x:Acme", "--max", "0"]);
    await usageError(["--out", "x.json", "--account", "x:Acme", "--days", "2", "--since", "2026-10-01"]);
    await usageError(["--out", "x.json", "--account", "x:Acme", "--since", "2026-10-07", "--until", "2026-10-01"]);
    await usageError(["--out", "x.json", "--account", "x:Acme", "--replies"]);
    await usageError(["--out", "x.json", "--query", "a", "--per-query", "0"]);
  });

  test("refuses a file it did not write", async () => {
    await usageError(["--out", write("other.json", '{"something": "else"}'), "--account", "x:Acme"]);
    const [code, , err] = await cli("collect", "--out", write("bad.json", "{oops"), "--account", "x:Acme");
    expect(code).toBe(2);
    expect(err).toContain(
      `market collect: error: --out ${file("bad.json")} exists but cannot be read as JSON ` +
        "(Expecting property name enclosed in double quotes: line 1 column 2 (char 1)). Choose another file.",
    );
    const bom = write("bom.json", `\ufeff{"format": "${FORMAT}", "posts": []}`);
    const [bomCode, , bomErr] = await cli("collect", "--out", bom, "--account", "x:Acme");
    expect(bomCode).toBe(2);
    expect(bomErr).toContain(
      `--out ${bom} exists but cannot be read as JSON (Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)).`,
    );
  });

  test("the command line reports usage errors with exit code 2", async () => {
    const [code, out, err] = await cli("collect", "--out", "x.json");
    expect([code, out]).toEqual([2, ""]);
    expect(err).toContain("market collect: error: nothing to collect");
    expect(err).toContain("usage: market collect [-h] --out FILE");
    expect(err).toContain("Run 'market collect --help' for help.");
  });

  test("--dry makes no request and writes nothing", async () => {
    const client = new FakeClient(() => {
      throw new Error("request made");
    });
    const out = file("x.json");
    const [code, plan] = await collect(["--out", out, "--account", "x:Acme", "--dry"], client);
    expect(code).toBe(0);
    expect(plan.dry).toBe(true);
    expect(plan.searches).toEqual(["@Acme -from:Acme since:2026-10-01 until:2026-10-09"]);
    expect(fs.existsSync(out)).toBe(false);
  });

  test("a missing queries file names the option and the file", async () => {
    const missing = file("nope.txt");
    const [code, , err] = await cli("collect", "--out", file("o.json"), "--queries-file", missing);
    expect(code).toBe(2);
    expect(err).toContain(`market collect: error: --queries-file ${missing}: [Errno 2] No such file or directory: '${missing}'`);
  });
});

// ------------------------------------------------------------------------- client, against a fake API

type Reply = [status: number, body: string, headers?: Record<string, string>];

describe("client", () => {
  let server: ReturnType<typeof Bun.serve>;
  let replies: Reply[] = [];
  let seen: { url: string; headers: Record<string, string> }[] = [];
  let waits: number[] = [];

  beforeEach(() => {
    replies = [];
    seen = [];
    waits = [];
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        seen.push({ url: request.url, headers: Object.fromEntries(request.headers.entries()) });
        const [status, body, headers] = replies.shift() ?? [500, "{}"];
        return new Response(status === 204 ? null : body, { status, headers });
      },
    });
  });
  afterEach(() => server.stop(true));

  const toFake: Fetcher = (url, init) =>
    fetch(url.replace(/^https:\/\/api\.[a-z]+\.[a-z]+/, `http://127.0.0.1:${server.port}`), init);
  const client = (fetcher: Fetcher = toFake) =>
    new Client({ fetcher, sleep: (seconds) => void waits.push(seconds), clock: () => 0 });

  test("retries, then succeeds", async () => {
    replies = [
      [429, "{}", { "Retry-After": "30" }],
      [503, ""],
      [200, '{"code":200}'],
    ];
    const getter = client();
    expect(await getter.get("x", "/2/search", { q: "a b", cursor: null }, "search")).toEqual({ code: 200 });
    expect(getter.errors).toEqual([]);
    expect(waits).toContain(30);
    expect(getter.requests).toBe(3);
    expect(seen[0]!.url).toEndWith("/2/search?q=a+b");
    expect(seen[0]!.headers["user-agent"]).toBe(USER_AGENT);
    expect(seen[0]!.headers.accept).toBe("application/json");
  });

  test("gives up and records the failure", async () => {
    replies = [0, 1, 2].map(() => [500, '{"code":500}'] as Reply);
    const getter = client();
    expect(await getter.get("bluesky", "/2/search", { q: "mentions:a.test" }, "search for a.test")).toBeNull();
    expect(getter.requests).toBe(3);
    expect(waits.filter((wait) => wait >= 1)).toEqual([2, 6]);
    const error = getter.errors[0]!;
    expect([error.what, error.status, error.message]).toEqual(["search for a.test", 500, "server or upstream failure"]);
    expect(error.url).toBe("https://api.fxbsky.app/2/search?q=mentions%3Aa.test");
  });

  test("does not retry a missing post", async () => {
    replies = [[404, '{"code":404,"status":null}']];
    const getter = client();
    expect(await getter.get("x", "/2/status/1", {}, "post 1")).toBeNull();
    expect(getter.requests).toBe(1);
    expect(getter.errors[0]!.message).toContain("not found");
  });

  test("missing_ok and the API's own message", async () => {
    replies = [
      [404, '{"code":404,"results":[]}'],
      [400, '{"code":400,"message":"q: required"}'],
      [204, ""],
    ];
    const getter = client();
    expect(await getter.get("x", "/2/search", { q: "a" }, "search", true)).toEqual({});
    expect(await getter.get("x", "/2/search", { q: "" }, "search")).toBeNull();
    expect(getter.errors[0]!.message).toBe("q: required");
    expect(await getter.get("x", "/2/search", { q: "b" }, "search")).toEqual({});
  });

  test("a network failure and a body that is not JSON", async () => {
    const refused: Fetcher = (url, init) => fetch(url.replace(/^https:\/\/[^/]+/, "http://127.0.0.1:1"), init);
    const failing = client(refused);
    expect(await failing.get("x", "/2/status/1", {}, "post 1")).toBeNull();
    expect(failing.requests).toBe(3);
    expect(failing.errors[0]!.message).toBe(`network error: [Errno ${os.constants.errno.ECONNREFUSED}] Connection refused`);
    replies = [[200, "<html>"]];
    const getter = client();
    expect(await getter.get("x", "/2/status/1", {}, "post 1")).toBeNull();
    expect(getter.errors[0]!.message).toBe("HTTP 200 with a body that is not JSON");
  });

  test("requests are paced", async () => {
    replies = [
      [200, "{}"],
      [200, "{}"],
    ];
    let now = 10;
    const getter = new Client({ fetcher: toFake, sleep: (seconds) => void waits.push(seconds), clock: () => now });
    await getter.get("x", "/2/a", {}, "a");
    now = 10.1;
    await getter.get("x", "/2/b", {}, "b");
    expect(waits.length).toBe(1);
    expect(waits[0]!).toBeCloseTo(0.15);
  });
});

// ------------------------------------------------------------------------- list

const LIST_POSTS: JsonObject[] = [
  {
    id: "x:1",
    url: "https://x.com/u1/status/1",
    author: "u1",
    date: "2026-10-01T10:00:00Z",
    text: "first\n\nline  two https://t.co/abc",
    likes: 2,
    reposts: 1,
    replies: 0,
    quotes: 0,
    reply_to: null,
    source: "query",
    goal: "wish",
    account: null,
    from_account: false,
  },
  {
    id: "x:2",
    url: "https://x.com/Acme/status/2",
    author: "Acme",
    date: "2026-10-02T10:00:00Z",
    text: "official",
    likes: 9,
    reposts: 0,
    replies: 0,
    quotes: 0,
    reply_to: null,
    source: "account",
    account: "Acme",
    from_account: true,
  },
  {
    id: "x:3",
    url: "https://x.com/u2/status/3",
    author: "u2",
    date: null,
    text: "x".repeat(400),
    likes: 0,
    reposts: 0,
    replies: 4,
    quotes: 0,
    reply_to: "https://x.com/Acme/status/2",
    source: "search",
    account: "Acme",
    from_account: false,
  },
];

describe("list", () => {
  let posts = "";
  beforeEach(() => {
    posts = write("posts.json", { format: FORMAT, runs: [], posts: LIST_POSTS });
  });
  const listing = async (...args: string[]) => {
    const [code, out, err] = await cli("list", posts, ...args);
    return [code, out.split("\n").filter(Boolean), err] as const;
  };

  test("lists the audience's posts", async () => {
    const [code, lines] = await listing("--width", "40");
    expect(code).toBe(0);
    expect(lines[0]).toBe("1 | 2026-10-01 | @u1 | 3 | wish | first line two <url>");
    expect(lines[1]!.startsWith("3 | - | @u2 | 4 | Acme | >xxx")).toBe(true);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(lines[2]).toBe("# 2 of 3 posts shown (numbers 1 to 3)");
  });

  test("filters", async () => {
    expect((await listing("--all"))[1].length).toBe(4);
    expect((await listing("--from", "2", "--to", "9"))[1].at(-1)).toBe("# 1 of 3 posts shown (numbers 2 to 3)");
    expect((await listing("--goal", "ACME"))[1][0]!.startsWith("3 |")).toBe(true);
    const coding = write("coding.txt", "# header\n1 | wish | Offline | pos | 2\n");
    expect((await listing("--uncoded", coding))[1][0]!.startsWith("3 |")).toBe(true);
  });

  test("truncates by characters, not UTF-16 units", async () => {
    write("posts.json", { format: FORMAT, runs: [], posts: [{ ...LIST_POSTS[0]!, text: "😀".repeat(30) }] });
    const [, lines] = await listing("--width", "20");
    expect(lines[0]).toBe(`1 | 2026-10-01 | @u1 | 3 | wish | ${"😀".repeat(19)}…`);
  });

  test("bad input", async () => {
    const missing = file("missing.txt");
    let [code, , err] = await listing("--uncoded", missing);
    expect(code).toBe(2);
    expect(err).toContain(`market list: error: coding file ${missing}: [Errno 2] No such file or directory: '${missing}'`);
    write("posts.json", "{}");
    [code, , err] = await listing();
    expect(code).toBe(2);
    expect(err).toContain(`data file ${posts} was not written by market collect.`);
    write("posts.json", '{"format": 1,');
    [code, , err] = await listing();
    expect(err).toContain(`data file ${posts} is not valid JSON: Expecting property name enclosed in double quotes: line 1 column 14 (char 13)`);
    [code, , err] = await listing("--width", "5");
    expect(code).toBe(2);
    expect(err).toContain("--from must be at least 1 and --width at least 20.");
  });

  test("a post or a coding file it cannot read fails the run and names it", async () => {
    write("posts.json", `{"format": "${FORMAT}", "posts": [{"text": "a"}, {"text": "b", "likes": "many"}, {"likes": NaN}]}`);
    let [code, , err] = await listing();
    expect(code).toBe(1);
    expect(err).toBe(`market list: failed: data file ${posts}, post 2: invalid literal for int() with base 10: 'many'\n`);
    [code, , err] = await listing("--from", "3");
    expect(err).toBe(`market list: failed: data file ${posts}, post 3: cannot convert float NaN to integer\n`);
    write("posts.json", { format: FORMAT, posts: [{ text: 5 }] });
    [code, , err] = await listing();
    expect(err).toBe(`market list: failed: data file ${posts}, post 1: its text is not a string\n`);
    const coding = file("coding.txt");
    fs.writeFileSync(coding, Buffer.from([0x31, 0x20, 0x7c, 0xff, 0x0a]));
    [code, , err] = await listing("--uncoded", coding);
    expect(code).toBe(1);
    expect(err).toBe(
      `market list: failed: coding file ${coding} is not UTF-8 text: ` +
        "'utf-8' codec can't decode byte 0xff in position 3: invalid start byte\n",
    );
  });
});

// ------------------------------------------------------------------------- tally

function tallyPost(n: number, author: string, text: string, extra: { likes?: number; replies?: number; date?: string; fromAccount?: boolean } = {}) {
  return {
    id: `x:${n}`,
    platform: "x",
    url: `https://x.com/${author}/status/${n}`,
    author,
    date: extra.date ?? `2026-10-0${n}T10:00:00Z`,
    text,
    likes: extra.likes ?? 0,
    reposts: 0,
    replies: extra.replies ?? 0,
    quotes: 0,
    from_account: extra.fromAccount ?? false,
  };
}

const TALLY_POSTS = [
  tallyPost(1, "u1", "So tired of this app, top up  pending again. I usually track in a spreadsheet", { likes: 5, replies: 1 }),
  tallyPost(2, "u2", "Top up pending for 3 days, money gone", { likes: 1 }),
  tallyPost(3, "u1", "I wish there was a budget app that works offline", { likes: 10 }),
  tallyPost(4, "u3", "Switched from AppA to AppB, no regrets", { date: "2026-10-01T23:00:00Z" }),
  tallyPost(5, "Acme", "We are sorry to hear that", { likes: 99, fromAccount: true }),
];

const CODING = `
# post | dimension | theme | sentiment | intensity | segment | exact words
post | dimension | theme | sentiment | intensity | segment | exact words
1 | pain | Top-up stays pending | neg | 3 | students | so tired of; top up pending
1 | behavior | Tracks spending in a spreadsheet | neu | 1 | students | I usually track in a spreadsheet
2 | pain | top-up stays pending | negative | 2 | workers | "money gone"
https://x.com/u1/status/3 | wish | Works offline | pos | 2 | - | I wish there was
4 | alternative | Moved to AppB | + | 1
`;

describe("tally", () => {
  let posts = "";
  beforeEach(() => {
    posts = write("posts.json", { format: FORMAT, runs: [], posts: TALLY_POSTS });
  });
  const tally = (coding: string, ...extra: string[]) => cli("tally", posts, write("coding.txt", coding), ...extra);

  test("counts", async () => {
    const [code, out] = await tally(CODING);
    expect(code).toBe(0);
    const result = JSON.parse(out);
    const top = result.themes[0];
    expect([top.dimension, top.theme]).toEqual(["pain", "Top-up stays pending"]); // spelling of first use
    expect([top.posts, top.authors, top.days]).toEqual([2, 2, 2]);
    expect([top.first, top.last]).toEqual(["2026-10-01", "2026-10-02"]);
    expect([top.likes, top.replies, top.engagement]).toEqual([6, 1, 7]);
    expect(top.intensity).toBe(2.5);
    expect([top.negative, top.neutral, top.positive]).toEqual([2, 0, 0]);
    expect(top.segments).toEqual({ students: 1, workers: 1 });
    expect(top.top_posts[0]).toEqual({ url: "https://x.com/u1/status/1", engagement: 6 });
    expect(result.themes.length).toBe(4);
    const dims = Object.fromEntries(result.dimensions.map((d: JsonObject) => [d.dimension, d]));
    expect([dims.pain.posts, dims.pain.themes, dims.wish.posts]).toEqual([2, 1, 1]);
    const students = result.segments[0];
    expect([students.segment, students.posts, students.themes.length]).toEqual(["students", 1, 2]);
    const words = Object.fromEntries(result.words.map((w: JsonObject) => [w.words, w]));
    expect(words["so tired of"].dimensions).toEqual(["pain"]);
    expect(words["money gone"].example).toBe("https://x.com/u2/status/2");
    expect([result.posts_in_file, result.audience_posts]).toEqual([5, 4]);
    expect([result.coded_posts, result.audience_posts_not_coded]).toEqual([4, 0]);
  });

  test("intensity is written as a float, as Python writes it", async () => {
    const [, out] = await tally(CODING);
    expect(out).toContain('"intensity": 2.5,');
    expect(out).toContain('"intensity": 1.0,');
  });

  test("segment names that look like numbers keep their sorted order", async () => {
    const [, out] = await tally("1 | pain | A | neg | 1 | 2024\n2 | pain | A | neg | 1 | 10\n");
    expect(out).toContain('"segments": {\n        "10": 1,\n        "2024": 1\n      }');
  });

  test("problems stop the count", async () => {
    const coding = [
      "9 | pain | A | neg | 2",
      "1 | pains | A | neg | 2",
      "1 | pain | A | sad | 2",
      "1 | pain | A | neg | 5",
      "1 | pain | A | neg | 2 | - | never said this",
      "1 | pain |  | neg | 2",
      "1 | pain | A",
      "2 | pain | B | neg | 2",
      "2 | pain | b | neg | 3",
      "https://x.com/made/status/up | pain | A | neg | 1",
    ].join("\n");
    const [code, out] = await tally(coding);
    expect(code).toBe(1);
    const result = JSON.parse(out);
    expect(result.themes).toBeUndefined();
    expect(result.problems.map((p: JsonObject) => p.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10]);
    expect(result.problems[4].problem).toContain("not in post 1: never said this");
    expect(result.problems[0].problem).toBe("post '9' is not in the data file");
  });

  test("flags posts by the account", async () => {
    const [code, out] = await tally("5 | delight | Friendly replies | pos | 1");
    expect(code).toBe(0);
    expect(JSON.parse(out).written_by_the_account).toEqual(["https://x.com/Acme/status/5"]);
  });

  test("markdown tables", async () => {
    let [code, out] = await tally(CODING, "--markdown");
    expect(code).toBe(0);
    expect(out).toContain("| pain | Top-up stays pending | 2 | 2 | 2 | 2.5 | 2 | 0 | 0 | 7 |");
    expect(out).toContain("| behavior | Tracks spending in a spreadsheet | 1 | 1 | 1 | 1.0 | 0 | 1 | 0 | 6 |");
    [code, out] = await tally(CODING, "--markdown", "segments");
    expect(out).toContain("| students | pain | Top-up stays pending | 1 | 1 | 6 |");
    [code, out] = await tally(CODING, "--markdown", "words");
    expect(out).toContain("| I wish there was | 1 | wish | https://x.com/u1/status/3 |");
    [code, out] = await tally(CODING, "--markdown", "dimensions");
    expect(out).toContain("| pain | 2 | 2 | 1 | 7 |");
    [code, out] = await tally(CODING, "--markdown=words");
    expect(out).toContain("| Words | Posts | Dimensions | Example |");
  });

  test("bad input", async () => {
    let [code, , err] = await tally("# nothing yet\n");
    expect(code).toBe(2);
    expect(err).toContain("no coding lines");
    posts = write("other.json", { posts: [] });
    [code, , err] = await tally(CODING);
    expect(code).toBe(2);
    expect(err).toContain("not written by market collect");
    [code, , err] = await tally(CODING, "--top", "-1");
    expect(code).toBe(2);
    expect(err).toContain("--top must be 0 or more.");
  });

  test("a coding file that is not UTF-8, or likes that are not a number, fail the run", async () => {
    const coding = file("coding.txt");
    fs.writeFileSync(coding, Buffer.from([0x31, 0xc3, 0x28, 0x0a]));
    let [code, , err] = await cli("tally", posts, coding);
    expect(code).toBe(1);
    expect(err).toBe(
      `market tally: failed: coding file ${coding} is not UTF-8 text: ` +
        "'utf-8' codec can't decode byte 0xc3 in position 1: invalid continuation byte\n",
    );
    posts = write("posts.json", { format: FORMAT, posts: [{ url: "https://x.com/a/status/1", text: "hi", likes: "many" }] });
    [code, , err] = await tally("1 | pain | A | neg | 2\n");
    expect(code).toBe(1);
    expect(err).toBe(`market tally: failed: data file ${posts}: invalid literal for int() with base 10: 'many'\n`);
  });
});

// ------------------------------------------------------------------------- JSON as Python writes it

describe("Python's JSON", () => {
  test("floats, integers and strings are written as Python writes them", () => {
    const value: Json = {
      a: [1, new PyFloat(2), {}, [], new PyFloat(1e16), new PyFloat(1e-5), new PyFloat(0.1), new PyFloat(-0)],
      b: "\x7f\u2028\x1f é\"\\",
      c: 123456789012345678901234567890n,
    };
    expect(dumps(value)).toBe(
      '{"a": [1, 2.0, {}, [], 1e+16, 1e-05, 0.1, -0.0], "b": "\x7f\u2028\\u001f é\\"\\\\", "c": 123456789012345678901234567890}',
    );
    expect(dumps({ a: [1, new PyFloat(2.5)], b: [] }, 2)).toBe('{\n  "a": [\n    1,\n    2.5\n  ],\n  "b": []\n}');
  });

  test("a file read and written again keeps its numbers and key order", () => {
    const text = '{"b": 1.0, "10": 2, "a": 12345678901234567890, "n": NaN}';
    expect(dumps(loads(text))).toBe('{"b": 1.0, "10": 2, "a": 12345678901234567890, "n": NaN}');
  });

  test("round to one digit as Python does", () => {
    expect([round1(2.25), round1(2.75), round1(1.25), round1(5 / 3), round1(7 / 3), round1(2)]).toEqual([2.2, 2.8, 1.2, 1.7, 2.3, 2]);
  });

  test("errors carry Python's messages", () => {
    const cases: [string, string][] = [
      ["", "Expecting value: line 1 column 1 (char 0)"],
      ["{", "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"],
      ['{"a"', "Expecting ':' delimiter: line 1 column 5 (char 4)"],
      ['{"a":1', "Expecting ',' delimiter: line 1 column 7 (char 6)"],
      ['{"a":1,}', "Expecting property name enclosed in double quotes: line 1 column 8 (char 7)"],
      ["[1,]", "Expecting value: line 1 column 4 (char 3)"],
      ['"abc', "Unterminated string starting at: line 1 column 1 (char 0)"],
      ['"a\x01"', "Invalid control character at: line 1 column 3 (char 2)"],
      ['"\\x"', "Invalid \\escape: line 1 column 2 (char 1)"],
      ['"\\u12"', "Invalid \\uXXXX escape: line 1 column 3 (char 2)"],
      ["01", "Extra data: line 1 column 2 (char 1)"],
      ["\ufeff{}", "Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)"],
      ["[1,\n2,\n x]", "Expecting value: line 3 column 2 (char 8)"],
      ['"😀" x', "Extra data: line 1 column 5 (char 4)"],
    ];
    for (const [text, message] of cases) expect(() => loads(text)).toThrow(message);
    expect(loads('"\\ud83d\\ude00"')).toBe("😀");
  });

  test("UTF-8 errors carry Python's messages", () => {
    const cases: [number[], string][] = [
      [[0xe4, 0x41], "can't decode byte 0xe4 in position 0: invalid continuation byte"],
      [[0xe4, 0xb8], "can't decode bytes in position 0-1: unexpected end of data"],
      [[0x61, 0x62, 0xff], "can't decode byte 0xff in position 2: invalid start byte"],
      [[0xf0, 0x90, 0x80, 0x41], "can't decode bytes in position 0-2: invalid continuation byte"],
      [[0xed, 0xa0, 0x80], "can't decode byte 0xed in position 0: invalid continuation byte"],
    ];
    for (const [bytes, message] of cases) {
      expect(() => decodeUtf8(new Uint8Array(bytes))).toThrow(`'utf-8' codec ${message}`);
      expect(() => decodeUtf8(new Uint8Array(bytes))).toThrow(DecodeError);
    }
  });
});

// ------------------------------------------------------------------------- help and wrong usage

/** The words of an example, as a shell would split it (the examples use no quotes). */
const words = (example: string) => example.split(" ");

describe("help", () => {
  test("no command prints the help and is wrong usage", async () => {
    const [code, out] = await cli();
    expect(code).toBe(2);
    expect(out).toContain("usage: market [-h] COMMAND ...");
  });

  test("--help, -h and help describe the tool, its commands, workflow, files and exit codes", async () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const [code, out, err] = await cli(...args);
      expect([code, err]).toEqual([0, ""]);
      for (const command of COMMANDS) expect(out).toContain(`  ${command.name}  `);
      for (const part of ["typical workflow:", "files:", "exit codes:", "market COMMAND --help"]) expect(out).toContain(part);
    }
  });

  test("every command has full help at every way of asking", async () => {
    for (const command of COMMANDS) {
      for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name], [command.name, "x", "--help"]]) {
        const [code, out, err] = await cli(...args);
        expect([args, code, err]).toEqual([args, 0, ""]);
        expect(out).toStartWith(`usage: market ${command.name} [-h]`);
        for (const part of ["options:", "output:", "exit codes:", "examples:", "-h, --help"]) expect(out).toContain(part);
        for (const option of command.options) {
          expect([command.name, out.includes(option.name)]).toEqual([command.name, true]);
          if (option.default !== undefined) expect(out).toContain(`[default: ${option.default}]`);
          if (option.choices) expect(out.replace(/\s+/g, " ")).toContain(`[choices: ${option.choices.join(", ")}]`);
        }
        for (const positional of command.positionals) expect(out).toContain(positional.metavar);
      }
    }
  });

  test("help lines fit in 88 columns", async () => {
    const pages = [["--help"], ...COMMANDS.map((command) => [command.name, "--help"])];
    for (const page of pages) {
      const [, out] = await cli(...page);
      for (const line of out.split("\n")) expect([page, line, line.length <= WIDTH]).toEqual([page, line, true]);
    }
  });

  test("every example parses without a usage error", () => {
    const parse = (command: Command, example: string) => {
      const [prog, name, ...rest] = words(example);
      expect([prog, name]).toEqual([PROG, command.name]);
      return parseCommand(PROG, command, rest);
    };
    for (const command of COMMANDS) {
      expect(command.examples.length).toBeGreaterThanOrEqual(2);
      for (const example of command.examples) expect(() => parse(command, example)).not.toThrow();
    }
  });

  test("the examples of the top-level workflow parse too", async () => {
    const [, out] = await cli("--help");
    const workflow = out.slice(out.indexOf("typical workflow:"), out.indexOf("files:"));
    const lines = workflow.split("\n").filter((line) => /^\s+(\d\. )?market /.test(line));
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      const [, name, ...rest] = words(line.replace(/^\s+(\d\. )?/, "").replace(/\s+\(.*$/, ""));
      const command = COMMANDS.find((item) => item.name === name)!;
      expect(() => parseCommand(PROG, command, rest)).not.toThrow();
    }
  });

  test("help for a command that does not exist", async () => {
    const [code, , err] = await cli("help", "colect");
    expect(code).toBe(2);
    expect(err).toContain("did you mean 'collect'?");
  });
});

describe("wrong usage", () => {
  test("names the command, the usage line and the help", async () => {
    const [code, out, err] = await cli("tally", "posts.json");
    expect([code, out]).toEqual([2, ""]);
    expect(err).toBe(
      "usage: market tally [-h] POSTS_FILE CODING_FILE [--top N] [--markdown [TABLE]]\n" +
        "market tally: error: the following arguments are required: CODING_FILE\n" +
        "Run 'market tally --help' for help.\n",
    );
  });

  test("an unknown command or option suggests the closest one", async () => {
    let [code, , err] = await cli("tallly");
    expect(code).toBe(2);
    expect(err).toContain("market: error: argument COMMAND: invalid choice: 'tallly' (choose from 'collect', 'list', 'tally'); did you mean 'tally'?");
    expect(err).toContain("Run 'market --help' for help.");
    [code, , err] = await cli("collect", "--out", "o.json", "--acount", "x:Acme");
    expect(code).toBe(2);
    expect(err).toContain("market collect: error: unrecognized arguments: --acount (did you mean --account?)");
    [code, , err] = await cli("collect", "--out", "o.json", "--feed", "tpo");
    expect(err).toContain("invalid choice: 'tpo' (choose from 'latest', 'top'); did you mean 'top'?");
  });

  test("wrong values", async () => {
    let [code, , err] = await cli("list", "p.json", "--from", "x");
    expect(code).toBe(2);
    expect(err).toContain("argument --from: invalid int value: 'x'");
    [code, , err] = await cli("collect", "--account", "x:Acme");
    expect(err).toContain("the following arguments are required: --out FILE");
    [code, , err] = await cli("collect", "--out", "o.json", "--po", "1234567890");
    expect(err).toContain("ambiguous option: --po could match --post, --posts-file");
    [code, , err] = await cli("collect", "--out", "o.json", "--dry=yes", "--query", "a");
    expect(err).toContain("argument --dry: ignored explicit argument");
    expect(() => parseCommand(PROG, TALLY, ["a", "b", "--markdown", "pie"])).toThrow(ArgumentError);
    expect(() => parseCommand(PROG, LIST, ["a", "b"])).toThrow("unrecognized arguments: b");
  });
});

// ------------------------------------------------------------------------- the built script

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
    let [code, out, err] = runBuilt("--help");
    expect([code, err]).toEqual([0, ""]);
    expect(out).toContain("typical workflow:");
    [code, out] = runBuilt("collect", "--help");
    expect(code).toBe(0);
    expect(out).toContain("--exclude-from HANDLE");
    [code, , err] = runBuilt("tally");
    expect(code).toBe(2);
    expect(err).toContain("the following arguments are required: POSTS_FILE, CODING_FILE");
    [code, out] = runBuilt("collect", "--out", file("o.json"), "--query", "wish | budget app", "--since", "2026-10-01", "--until", "2026-10-07", "--dry");
    expect(code).toBe(0);
    expect(JSON.parse(out).searches).toEqual(["budget app since:2026-10-01 until:2026-10-09"]);
  });

  test("it collects, lists and tallies through a real process", async () => {
    const posts = [xPost(101, "u1", "2026-10-02 07:00", { text: "I wish my budget app worked offline" }), xPost(102, "u2", "2026-10-03 07:00")];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/x/2/search" && request.headers.get("user-agent") === USER_AGENT) {
          return Response.json({ results: posts, cursor: { bottom: null } });
        }
        return Response.json({ code: 404 }, { status: 404 });
      },
    });
    try {
      const out = file("posts.json");
      const spawn = (...args: string[]) =>
        Bun.spawn(["bun", "--preload", REDIRECT, SCRIPT, ...args], {
          env: { ...process.env, MARKET_TEST_API: `http://127.0.0.1:${server.port}` },
          stdout: "pipe",
          stderr: "pipe",
        });
      const done = spawn("collect", "--out", out, "--query", "wish | budget app", "--since", "2026-10-01", "--until", "2026-10-07");
      const [code, text] = await Promise.all([done.exited, new Response(done.stdout).text()]);
      expect(code).toBe(0);
      expect(JSON.parse(text).added).toBe(2);
      const listed = spawn("list", out);
      expect(await new Response(listed.stdout).text()).toContain("1 | 2026-10-02 | @u1 | 0 | wish | I wish my budget app worked offline");
      const coding = write("coding.txt", "1 | wish | Works offline | pos | 2 | - | worked offline\n");
      const counted = spawn("tally", out, coding, "--markdown");
      expect(await new Response(counted.stdout).text()).toContain("| wish | Works offline | 1 | 1 | 1 | 2.0 | 0 | 0 | 1 | 0 |");
    } finally {
      server.stop(true);
    }
  });
});
