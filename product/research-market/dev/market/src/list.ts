// market list: the posts of a data file one per line, for reading and coding.

import type { Command, Values } from "./args";
import { FORMAT } from "./collect";
import { PY_SPACE, UsageError, head, isDigits, length, print, readBytes, squeeze, strip, universalNewlines } from "./core";
import { DecodeError, type Json, decodeUtf8, get, isDict, loads, or, pyStr, toInt, truthy } from "./pyjson";

export const COUNTS = ["likes", "reposts", "replies", "quotes"] as const;
const URL = new RegExp(`https?://[^${PY_SPACE}]+`, "gu");

/** The posts of a data file written by `market collect`. */
export function loadPosts(file: string): Json[] {
  const bytes = readBytes(file, `data file ${file}`);
  let doc: Json;
  try {
    doc = loads(decodeUtf8(bytes));
  } catch (error) {
    if (error instanceof DecodeError) throw new UsageError(`data file ${file} is not valid JSON: ${error.message}`);
    throw error;
  }
  const posts = get(doc, "posts");
  if (!isDict(doc) || get(doc, "format") !== FORMAT || !Array.isArray(posts)) {
    throw new UsageError(`data file ${file} was not written by market collect.`);
  }
  return posts;
}

/** A text file the user wrote; text that is not UTF-8 fails the run (exit 1), naming the file. */
export function readText(file: string, label: string) {
  try {
    return decodeUtf8(readBytes(file, label));
  } catch (error) {
    if (error instanceof DecodeError) throw new Error(`${label} is not UTF-8 text: ${error.message}`);
    throw error;
  }
}

/** Likes, reposts, replies and quotes added up. */
export function engagement(post: Json) {
  return COUNTS.reduce((sum, field) => sum + toInt(or(get(post, field), 0)), 0);
}

/** The post numbers that already have a line in the coding file. */
function codedNumbers(file: string) {
  const numbers = new Set<number>();
  for (const line of universalNewlines(readText(file, `coding file ${file}`)).split("\n")) {
    const first = strip(line.split("|")[0]!);
    if (isDigits(first)) numbers.add(Number(first));
  }
  return numbers;
}

function lineOf(number: number, post: Json, width: number) {
  const raw = or(get(post, "text"), "");
  if (typeof raw !== "string") throw new Error("its text is not a string");
  let text = squeeze(raw.replace(URL, "<url>"));
  if (length(text) > width) text = head(text, width - 1) + "…";
  const date = or(get(post, "date"), "");
  return [
    String(number),
    head(pyStr(date), 10) || "-",
    "@" + pyStr(or(get(post, "author"), "-")),
    String(engagement(post)),
    pyStr(or(get(post, "goal"), get(post, "account"), get(post, "source"), "-")),
    (truthy(get(post, "reply_to")) ? ">" : "") + text,
  ].join(" | ");
}

export function runList(args: Values): number {
  const first = args.first as number;
  const width = args.width as number;
  if (first < 1 || width < 20) throw new UsageError("--from must be at least 1 and --width at least 20.");
  const posts = loadPosts(args.posts as string);
  const uncoded = args.uncoded as string | null;
  const done = uncoded ? codedNumbers(uncoded) : new Set<number>();
  const to = args.last as number | null;
  const last = Math.min(to || posts.length, posts.length);
  const wanted = ((args.goal as string | null) ?? "").toLowerCase();
  let shown = 0;
  for (let number = first; number <= last; number++) {
    const post = posts[number - 1]!;
    if (truthy(get(post, "from_account")) && !args.all) continue;
    if (done.has(number)) continue;
    const goal = pyStr(or(get(post, "goal"), "")).toLowerCase();
    const account = pyStr(or(get(post, "account"), "")).toLowerCase();
    if (wanted && wanted !== goal && wanted !== account) continue;
    let line: string;
    try {
      line = lineOf(number, post, width);
    } catch (error) {
      throw new Error(`data file ${args.posts as string}, post ${number}: ${(error as Error).message}`);
    }
    print(line);
    shown++;
  }
  print(`# ${shown} of ${posts.length} posts shown (numbers ${first} to ${last})`);
  return 0;
}

export const LIST: Command = {
  name: "list",
  summary: "print the posts of the data file one per line, for reading and coding",
  description:
    "Print the posts of a data file one per line, for reading and coding: " +
    "`number | date | @author | engagement | goal | text`. The number is the post's position in " +
    "the file; it never changes, because new posts are added at the end, and the coding file refers " +
    "to posts by it. Engagement is likes + reposts + replies + quotes; the goal column falls back to " +
    "the account, then the source. A `>` before the text marks a reply. Links are shown as <url>." +
    "\n\n" +
    "Posts written by the analyzed accounts themselves are left out unless --all is given. Read a " +
    "long file in ranges with --from and --to, and use --uncoded after an interruption or a later " +
    "collection to see what has no coding line yet.",
  positionals: [{ dest: "posts", metavar: "POSTS_FILE", help: "data file written by market collect" }],
  options: [
    { name: "--from", dest: "first", metavar: "N", type: "int", default: 1, help: "first post number to print" },
    { name: "--to", dest: "last", metavar: "N", type: "int", defaultText: "the last post", help: "last post number to print" },
    { name: "--goal", dest: "goal", metavar: "GOAL", help: "only posts collected for this goal, or sent to this account (any case)" },
    { name: "--uncoded", dest: "uncoded", metavar: "CODING_FILE", help: "only posts that have no line yet in this coding file" },
    { name: "--all", dest: "all", flag: true, help: "include posts written by the analyzed accounts themselves" },
    { name: "--width", dest: "width", metavar: "N", type: "int", default: 280, help: "longest text to print per post, at least 20" },
  ],
  output:
    "Prints one line per post to stdout, then `# S of T posts shown (numbers F to L)`. Writes nothing.",
  exitCodes: [
    ["0", "listed"],
    ["1", "a post in the data file, or the coding file, cannot be read; the message names which"],
    ["2", "wrong usage, or a data or coding file that cannot be read"],
  ],
  examples: [
    "market list posts.json",
    "market list posts.json --from 201 --to 400",
    "market list posts.json --goal wish",
    "market list posts.json --uncoded coding.txt",
  ],
  run: runList,
};
