// market tally: coded posts counted per theme, dimension, segment and phrase, from the data file.
// Every number comes from the data file. A coding line that names a post that was never
// collected, or quotes words that are not in the post, is an error, so the result cannot rest
// on an invented post or quote.

import type { Command, Values } from "./args";
import { UsageError, compare, head, isDigits, lstrip, print, splitLines, squeeze, strip, stripChars, universalNewlines } from "./core";
import { COUNTS, engagement, loadPosts, readText } from "./list";
import { type Json, type JsonMap, type JsonObject, PyFloat, dumps, get, or, pyRepr, pyStr, round1, toInt, truthy } from "./pyjson";

export const DIMENSIONS = [
  "pain",
  "job",
  "wish",
  "delight",
  "behavior",
  "alternative",
  "trigger",
  "criteria",
  "objection",
  "switching-cost",
  "decision",
  "price",
  "identity",
  "success",
  "source",
] as const;
const SENTIMENTS: Record<string, string> = {
  neg: "negative",
  negative: "negative",
  "-": "negative",
  neu: "neutral",
  neutral: "neutral",
  "0": "neutral",
  pos: "positive",
  positive: "positive",
  "+": "positive",
};
export const TABLES = ["themes", "dimensions", "segments", "words"] as const;

type Row = {
  number: number;
  post: Json;
  dimension: string;
  theme: string;
  sentiment: string;
  intensity: number;
  segment: string | null;
  phrases: string[];
};
type Problem = JsonObject & { line: number; problem: string; text: string };

/** Lower-case with single spaces, so that a quoted phrase is compared the way it reads. */
function squash(text: Json) {
  return squeeze(pyStr(text).toLowerCase());
}

/** The valid coding lines, and a problem for each line that cannot be counted. */
export function readCoding(file: string, posts: Json[]): [Row[], Problem[]] {
  const lines = splitLines(universalNewlines(readText(file, `coding file ${file}`)));
  const byUrl = new Map<string, number>();
  posts.forEach((post, index) => byUrl.set(squash(get(post, "url", "")), index + 1));
  const rows: Row[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!strip(line) || lstrip(line).startsWith("#")) return;
    const fields = line.split("|").map(strip);
    if (["post", "n", "number"].includes(fields[0]!.toLowerCase())) return; // header
    const problem = (message: string) =>
      problems.push({ line: lineNumber, problem: message, text: head(strip(line), 120) });
    if (fields.length < 5) return problem("needs at least: post | dimension | theme | sentiment | intensity");
    while (fields.length < 7) fields.push("");
    const [ref, rawDimension, theme, sentiment, intensity, segment] = fields as [string, string, string, string, string, string];
    const words = fields.slice(6).join("|");
    const number = isDigits(ref) ? Number(ref) : byUrl.get(squash(ref));
    if (!number || number > posts.length) return problem(`post ${pyRepr(ref)} is not in the data file`);
    const post = posts[number - 1]!;
    const dimension = rawDimension.toLowerCase();
    if (!(DIMENSIONS as readonly string[]).includes(dimension)) {
      return problem(`dimension ${pyRepr(dimension)} is not one of: ${DIMENSIONS.join(", ")}`);
    }
    if (!theme) return problem("the theme is empty");
    if (!Object.hasOwn(SENTIMENTS, sentiment.toLowerCase())) {
      return problem(`sentiment ${pyRepr(sentiment)} must be neg, neu or pos`);
    }
    if (!["1", "2", "3"].includes(intensity)) return problem(`intensity ${pyRepr(intensity)} must be 1, 2 or 3`);
    const phrases = words
      .split(";")
      .filter((phrase) => stripChars(phrase, ' -"“”'))
      .map((phrase) => stripChars(strip(phrase), '"“”'));
    const text = squash(get(post, "text", ""));
    const missing = phrases.filter((phrase) => !text.includes(squash(phrase)));
    if (missing.length) return problem(`these words are not in post ${number}: ${missing.join("; ")}`);
    const key = `${number}\u0000${dimension}\u0000${squash(theme)}`;
    if (seen.has(key)) return problem(`post ${number} already has this dimension and theme`);
    seen.add(key);
    rows.push({
      number,
      post,
      dimension,
      theme,
      sentiment: SENTIMENTS[sentiment.toLowerCase()]!,
      intensity: Number(intensity),
      segment: segment && segment !== "-" ? segment : null,
      phrases,
    });
  });
  return [rows, problems];
}

function group<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const members = groups.get(name);
    if (members) members.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}

/** A value that can be counted as distinct, as Python's set() does with the author handles. */
function distinct(values: Json[]) {
  return new Set(values.map((value) => (typeof value === "string" ? "s" + value : "r" + pyRepr(value)))).size;
}

type Measure = {
  posts: number;
  authors: number;
  days: number;
  first: string | null;
  last: string | null;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  engagement: number;
  top_posts?: JsonObject[];
};

/** Posts, authors, days and engagement of a group of rows, counting each post once. */
function measure(rows: Row[], top = 0): Measure {
  const posts = new Map<number, Json>();
  for (const row of rows) posts.set(row.number, row.post);
  const all = [...posts.values()];
  const dates = all
    .map((post) => get(post, "date"))
    .filter(truthy)
    .map((date) => pyStr(date))
    .sort(compare);
  const sum = (field: string) => all.reduce<number>((total, post) => total + toInt(or(get(post, field), 0)), 0);
  const result: Measure = {
    posts: posts.size,
    authors: distinct(all.map((post) => get(post, "author"))),
    days: new Set(dates.map((date) => head(date, 10))).size, // distinct days with a post: does it recur?
    first: dates.length ? head(dates[0]!, 10) : null,
    last: dates.length ? head(dates[dates.length - 1]!, 10) : null,
    likes: sum("likes"),
    reposts: sum("reposts"),
    replies: sum("replies"),
    quotes: sum("quotes"),
    engagement: 0,
  };
  result.engagement = COUNTS.reduce((total, field) => total + result[field], 0);
  if (top) {
    const ranked = [...all].sort((a, b) => engagement(b) - engagement(a)).slice(0, top);
    result.top_posts = ranked.map((post) => ({ url: get(post, "url"), engagement: engagement(post) }));
  }
  return result;
}

const themeKey = (row: Row) => `${row.dimension}\u0000${squash(row.theme)}`;
const sizes = (found: Measure) => ({ posts: found.posts, authors: found.authors, engagement: found.engagement });
const descending = <T>(...keys: ((item: T) => number)[]) => (a: T, b: T) => {
  for (const key of keys) {
    const difference = key(b) - key(a);
    if (difference) return difference;
  }
  return 0;
};

export function tally(posts: Json[], rows: Row[], top: number): JsonObject {
  const themes: (JsonObject & { posts: number; engagement: number; intensity: PyFloat })[] = [];
  for (const members of group(rows, themeKey).values()) {
    const segments = group(members.filter((row) => row.segment), (row) => row.segment!);
    const counted: JsonMap = new Map();
    for (const name of [...segments.keys()].sort(compare)) {
      counted.set(name, new Set(segments.get(name)!.map((row) => row.number)).size);
    }
    const mean = members.reduce((total, row) => total + row.intensity, 0) / members.length;
    themes.push({
      dimension: members[0]!.dimension,
      theme: members[0]!.theme,
      ...measure(members, top),
      intensity: new PyFloat(round1(mean)),
      negative: members.filter((row) => row.sentiment === "negative").length,
      neutral: members.filter((row) => row.sentiment === "neutral").length,
      positive: members.filter((row) => row.sentiment === "positive").length,
      segments: counted,
    });
  }
  themes.sort(descending((t) => t.posts, (t) => t.intensity.value, (t) => t.engagement));

  const dimensions: (JsonObject & { posts: number })[] = [];
  for (const [dimension, members] of group(rows, (row) => row.dimension)) {
    dimensions.push({ dimension, themes: new Set(members.map((row) => squash(row.theme))).size, ...sizes(measure(members)) });
  }
  dimensions.sort(descending((d) => d.posts));

  const segments: (JsonObject & { posts: number })[] = [];
  for (const [segment, members] of group(rows.filter((row) => row.segment), (row) => row.segment!)) {
    const found: (JsonObject & { posts: number; engagement: number })[] = [];
    for (const same of group(members, themeKey).values()) {
      found.push({ dimension: same[0]!.dimension, theme: same[0]!.theme, ...sizes(measure(same)) });
    }
    found.sort(descending((t) => t.posts, (t) => t.engagement));
    segments.push({ segment, ...sizes(measure(members)), themes: found });
  }
  segments.sort(descending((s) => s.posts));

  const words: (JsonObject & { words: string; posts: number })[] = [];
  const phraseRows = rows.flatMap((row) => row.phrases.map((phrase) => ({ ...row, phrase })));
  for (const members of group(phraseRows, (row) => squash(row.phrase)).values()) {
    words.push({
      words: members[0]!.phrase,
      posts: new Set(members.map((row) => row.number)).size,
      dimensions: [...new Set(members.map((row) => row.dimension))].sort(compare),
      themes: [...new Set(members.map((row) => row.theme))].sort(compare),
      example: get(members[0]!.post, "url"),
    });
  }
  words.sort((a, b) => b.posts - a.posts || compare(a.words.toLowerCase(), b.words.toLowerCase()));

  const coded = new Set(rows.map((row) => row.number));
  const audience = posts.map((post, index) => [post, index + 1] as const).filter(([post]) => !truthy(get(post, "from_account")));
  const own = new Map<string, Json>();
  for (const row of rows) {
    if (truthy(get(row.post, "from_account"))) own.set(pyRepr(get(row.post, "url")), get(row.post, "url"));
  }
  return {
    themes,
    dimensions,
    segments,
    words,
    posts_in_file: posts.length,
    audience_posts: audience.length,
    coded_posts: coded.size,
    audience_posts_not_coded: audience.filter(([, number]) => !coded.has(number)).length,
    written_by_the_account: [...own.values()].sort((a, b) => compare(pyStr(a), pyStr(b))),
  };
}

function table(header: string[], alignment: string[], rows: Json[][]) {
  const cell = (value: Json) => pyStr(value).replace(/\|/g, "\\|");
  return [
    "| " + header.join(" | ") + " |",
    "| " + alignment.join(" | ") + " |",
    ...rows.map((row) => "| " + row.map(cell).join(" | ") + " |"),
  ].join("\n");
}

function markdown(result: JsonObject, which: string) {
  const items = (key: string) => result[key] as JsonObject[];
  if (which === "dimensions") {
    return table(
      ["Dimension", "Posts", "Authors", "Themes", "Engagement"],
      ["---", "---:", "---:", "---:", "---:"],
      items("dimensions").map((d) => [d.dimension!, d.posts!, d.authors!, d.themes!, d.engagement!]),
    );
  }
  if (which === "segments") {
    return table(
      ["Segment", "Dimension", "Theme", "Posts", "Authors", "Engagement"],
      ["---", "---", "---", "---:", "---:", "---:"],
      items("segments").flatMap((s) =>
        (s.themes as JsonObject[]).map((t) => [s.segment!, t.dimension!, t.theme!, t.posts!, t.authors!, t.engagement!]),
      ),
    );
  }
  if (which === "words") {
    return table(
      ["Words", "Posts", "Dimensions", "Example"],
      ["---", "---:", "---", "---"],
      items("words").map((w) => [w.words!, w.posts!, (w.dimensions as string[]).join(", "), w.example!]),
    );
  }
  return table(
    ["Dimension", "Theme", "Posts", "Authors", "Days", "Intensity", "Neg", "Neu", "Pos", "Engagement"],
    ["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"],
    items("themes").map((t) => [
      t.dimension!,
      t.theme!,
      t.posts!,
      t.authors!,
      t.days!,
      t.intensity!,
      t.negative!,
      t.neutral!,
      t.positive!,
      t.engagement!,
    ]),
  );
}

export function runTally(args: Values): number {
  const top = args.top as number;
  if (top < 0) throw new UsageError("--top must be 0 or more.");
  const posts = loadPosts(args.posts as string);
  const coding = args.coding as string;
  const [rows, problems] = readCoding(coding, posts);
  if (!rows.length && !problems.length) throw new UsageError(`coding file ${coding} has no coding lines.`);
  if (problems.length) {
    print(dumps({ error: "Correct these lines of the coding file, then run again.", problems }, 2));
    return 1;
  }
  let result: JsonObject;
  try {
    result = tally(posts, rows, top);
  } catch (error) {
    throw new Error(`data file ${args.posts as string}: ${(error as Error).message}`);
  }
  const which = args.markdown as string | null;
  print(which ? markdown(result, which) : dumps(result, 2));
  return 0;
}

export const TALLY: Command = {
  name: "tally",
  summary: "count the coded posts per theme, dimension, segment and phrase",
  description:
    "Count the coded posts per theme, dimension, segment and phrase, from the data file `market " +
    "collect` wrote and a coding file. The coding file has one line per observation, with fields " +
    "separated by `|`: `post | dimension | theme | sentiment | intensity | segment | exact words`, " +
    "for example `12 | pain | Top-up never arrives | neg | 3 | prepaid users | money gone; still " +
    "pending`. `post` is the number `market list` prints, or the post URL. A post may have several " +
    "lines, one per dimension it shows. `segment` and `exact words` may be left empty or written `-`; " +
    "several phrases are separated by `;`. Blank lines, lines starting with # and a header line are skipped." +
    "\n\n" +
    `Dimensions: ${DIMENSIONS.join(", ")}. Sentiment: neg, neu or pos (also negative, neutral, ` +
    "positive, -, 0, +). Intensity: 1, 2 or 3. Every number comes from the data file: a line that " +
    "names a post that was never collected, or quotes words that are not in the post, is an error.",
  positionals: [
    { dest: "posts", metavar: "POSTS_FILE", help: "data file written by market collect" },
    {
      dest: "coding",
      metavar: "CODING_FILE",
      help: "one line per observation: post | dimension | theme | sentiment | intensity | segment | exact words",
    },
  ],
  options: [
    { name: "--top", dest: "top", metavar: "N", type: "int", default: 3, help: "most-engaged posts to list per theme; 0 lists none" },
    {
      name: "--markdown",
      dest: "markdown",
      metavar: "TABLE",
      choices: TABLES,
      optional: "themes",
      help: "print one Markdown table instead of JSON",
    },
  ],
  output:
    "Prints JSON to stdout: `themes` (per dimension and theme: posts, distinct authors, distinct " +
    "days, first and last date, likes, reposts, replies, quotes, engagement, top_posts, mean " +
    "intensity, sentiment split and segments), `dimensions`, `segments`, `words` (each quoted phrase " +
    "with how many posts use it), `posts_in_file`, `audience_posts`, `coded_posts`, " +
    "`audience_posts_not_coded` and `written_by_the_account` (coded posts the analyzed accounts wrote; " +
    "remove their lines). With --markdown, one table instead. Engagement is likes + reposts + replies " +
    "+ quotes. When lines cannot be counted, prints `error` and `problems` (line, problem, text) " +
    "instead, and counts nothing. Writes nothing.",
  exitCodes: [
    ["0", "counted"],
    [
      "1",
      "the coding file has lines that cannot be counted (an unknown post, words that are not in " +
        "the post, a wrong value); correct the listed lines and run again. Also when a post in the " +
        "data file, or the coding file, cannot be read; the message names which",
    ],
    ["2", "wrong usage, or a data or coding file that cannot be read or has no coding lines"],
  ],
  examples: [
    "market tally posts.json coding.txt",
    "market tally posts.json coding.txt --markdown",
    "market tally posts.json coding.txt --markdown segments",
    "market tally posts.json coding.txt --markdown words",
  ],
  run: runTally,
};
