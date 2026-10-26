// The commands, and main.

import fs from "node:fs";
import path from "node:path";
import {
  ArgumentError,
  type Command,
  HelpRequested,
  commandHelp,
  parseCommand,
  topHelp,
  topUsage,
} from "./args";
import {
  DEFAULTS,
  DEFAULT_HOME,
  HOME_ENV,
  LIVECRAWL,
  MAX_FETCH_SECONDS,
  MAX_NUM_RESULTS,
  PROVIDERS,
  type Provider,
  Problem,
  SEARCH_TYPES,
  type Settings,
  UsageError,
  apiKeys,
  atomicWrite,
  bounds,
  compare,
  expandUser,
  filesDir,
  home,
  isDir,
  loadSettings,
  note,
  print,
  realpath,
  reason,
  referencesFile,
  reposDir,
  settingsFile,
  settingsOrWarn,
  wikisDir,
} from "./core";
import { type Answer } from "./http";
import { type Fetched, IMAGE_SUFFIX, download, fetched, normalUrl, sources } from "./fetch";
import {
  HANDOFF,
  MAX_CHILDREN,
  type Reference,
  SKIPPED_CHILDREN,
  cachePath,
  clone,
  locate,
  parseRepository,
  readCatalog,
  readDocument,
  readSource,
  refresh,
  validAlias,
  validBranch,
  writeDocument,
} from "./references";
import { LABELS, NO_RESULTS, type Request, formatResults, searchInTurn } from "./search";
import {
  MAX_PAGES,
  type Meta,
  PAGE_NAME,
  age,
  nowStamp,
  oneLine,
  pageNumber,
  readPageFile,
  readWiki,
  removeTopics,
  saveTopic,
  searchWiki,
  slugify,
  subject,
  topicFiles,
  urlTopic,
} from "./wiki";

export const PROG = "knowledge";
const DESCRIPTION =
  "Get knowledge from local sources first and from the web second. Reference roots and a " +
  "local wiki are looked in first. What a web search or a fetch brings is kept in the wiki, " +
  "so that the next lookup is local.";
const FOOTER =
  `Run '${PROG} COMMAND --help' for the options of a command.\n` +
  "Exit code: 0 done, 1 the request failed, 2 the command was used wrongly.\n" +
  `Everything is kept under ${DEFAULT_HOME} (or $${HOME_ENV}); '${PROG} config' shows where.`;

const wikiDirectory = () => wikisDir();
const wikiPath = (name: string) => path.join(wikiDirectory(), name);

/** A saved page as the text to print: its content and where it continues. */
function firstPage(name: string) {
  const [meta, text] = readPageFile(name)!;
  return text + pageFooter(meta);
}

/** The line that tells where a page's text continues. */
function pageFooter(meta: Meta) {
  const number = meta.page ?? "1";
  const total = meta.totalPages ?? "1";
  if (total === "1") return "";
  if (meta.next) return `\n\n[Page ${number} of ${total}. The text continues in ${wikiPath(meta.next)}]`;
  return `\n\n[Page ${number} of ${total}, the last one.]`;
}

function savedLines(files: string[], cut: boolean, size: number) {
  const extent =
    files.length > 1 ? `page 1 of ${files.length}, ${size} characters in all` : `1 page, ${size} characters`;
  const lines = [`Saved: ${wikiPath(files[0]!)} (${extent})`];
  if (cut) lines.push(`note: the text was cut after ${MAX_PAGES} pages.`);
  return lines;
}

function listReferences(references: Reference[], notes: string[]) {
  const shown = references.filter((reference) => !reference.hidden);
  const lines: string[] = [];
  for (const reference of shown) {
    let line = `- ${reference.alias} (${reference.type})`;
    if (reference.description.trim()) line += `: ${oneLine(reference.description)}`;
    lines.push(line);
    lines.push(reference.root ? `  root: ${reference.root}` : `  unavailable: ${reference.why}`);
  }
  if (!shown.length) lines.push("No references are set up.");
  for (const text of notes) lines.push(`note: ${text}`);
  return lines.join("\n");
}

function showReference(alias: string) {
  const [references] = readCatalog();
  const reference = references.find((item) => item.alias === alias);
  if (!reference) {
    const known = references
      .filter((item) => !item.hidden)
      .map((item) => item.alias)
      .join(", ");
    throw new Problem(
      `There is no reference named '${alias}'. ` +
        (known ? `The references are: ${known}.` : "No references are set up."),
    );
  }
  if (!reference.root) throw new Problem(`Reference '${alias}' is unavailable: ${reference.why}.`);
  let children: [string, string][];
  try {
    children = fs
      .readdirSync(reference.root, { withFileTypes: true })
      .filter((entry) => !SKIPPED_CHILDREN.has(entry.name))
      .map((entry): [string, string] => [entry.name, isDir(path.join(reference.root, entry.name)) ? "directory" : "file"])
      .sort(([a], [b]) => compare(a, b));
  } catch (error) {
    throw new Problem(`Reference '${alias}' cannot be listed: ${reason(error)}`);
  }
  const lines = [`Reference: ${reference.alias} (${reference.type})`];
  if (reference.description.trim()) lines.push(`Description: ${oneLine(reference.description)}`);
  lines.push(`Root: ${reference.root}`, "Immediate children:");
  for (const [name, kind] of children.slice(0, MAX_CHILDREN)) lines.push(`  - ${name} (${kind})`);
  if (!children.length) lines.push("  (empty root)");
  if (children.length > MAX_CHILDREN) lines.push(`  ... and ${children.length - MAX_CHILDREN} more entries`);
  lines.push(HANDOFF);
  return lines.join("\n");
}

function browseWiki(limit: number) {
  const topics = new Map<string, ReturnType<typeof readWiki>>();
  for (const page of readWiki()) {
    const topic = page.meta.topic ?? "";
    if (!topics.has(topic)) topics.set(topic, []);
    topics.get(topic)!.push(page);
  }
  if (!topics.size) return "No local wiki pages found.";
  const first = [...topics.values()]
    .map((pages) => [...pages].sort((a, b) => pageNumber(a.file) - pageNumber(b.file))[0]!)
    .sort((a, b) => compare(b.meta.saved ?? "", a.meta.saved ?? "") || compare(a.file, b.file));
  const lines: string[] = [];
  for (const page of first.slice(0, limit)) {
    const meta = page.meta;
    const count = topics.get(meta.topic ?? "")!.length;
    const pages = count > 1 ? `, ${count} pages` : "";
    lines.push(`- ${page.file} (saved ${age(meta.saved ?? "")}${pages}): ${subject(meta)}`);
  }
  if (first.length > limit) {
    lines.push(`... and ${first.length - limit} older topics; search with --query to find them.`);
  }
  lines.push(`Wiki directory: ${wikiDirectory()}`);
  return lines.join("\n");
}

function findInWiki(query: string, limit: number) {
  const ranked = searchWiki(query, limit);
  if (!ranked.length) return "No local wiki matches found.";
  const lines = ranked.map(({ score, page, matched, asked }) => {
    const meta = page.meta;
    const part = (meta.totalPages ?? "1") !== "1" ? `, page ${meta.page ?? "?"} of ${meta.totalPages ?? "?"}` : "";
    return (
      `- ${page.file} (score ${score.toFixed(3)}, has ${matched} of ${asked} words, ` +
      `saved ${age(meta.saved ?? "")}${part}): ${subject(meta)}`
    );
  });
  lines.push(`Wiki directory: ${wikiDirectory()}`);
  return lines.join("\n");
}

/** The page file named by `name`, which may also be its full path inside the wiki. */
function pageName(name: string, message: string) {
  const trimmed = name.trim();
  const base = path.basename(trimmed);
  const folder = path.dirname(trimmed);
  const inside = !trimmed.includes("/") || realpath(folder) === realpath(wikiDirectory());
  const found = PAGE_NAME.exec(base);
  if (!found || !inside) throw new UsageError(message);
  return found;
}

function openPage(name: string, withContent: boolean) {
  const found = pageName(
    name,
    "--page takes the file name of a wiki page as this script prints it, " +
      "such as react-dev-learn.md or react-dev-learn.part-002.md.",
  );
  const base = found[0];
  const parsed = readPageFile(base);
  if (!parsed) throw new Problem(`There is no wiki page named ${base} in ${wikiDirectory()}.`);
  const [meta, text] = parsed;
  const lines = [
    `Page: ${wikiPath(base)} (page ${meta.page ?? "1"} of ${meta.totalPages ?? "1"})`,
    `Holds: ${subject(meta)}`,
    `Saved: ${age(meta.saved ?? "")}`,
  ];
  if (meta.previous) lines.push(`Previous: ${wikiPath(meta.previous)}`);
  if (meta.next) lines.push(`Next: ${wikiPath(meta.next)}`);
  if (!withContent) return lines.join("\n");
  return lines.join("\n") + "\n\n" + text + pageFooter(meta);
}

function cmdLocal(args: Record<string, any>) {
  const kind = args.type as string | null;
  if (args.page !== null) {
    if (kind === "references" || args.alias !== null || args.query !== null) {
      throw new UsageError("--page opens one wiki page; it goes with no --query, no --alias and no --type references.");
    }
    print(openPage(args.page, !args.no_content));
    return 0;
  }
  if (args.alias !== null) {
    if (kind === "wikis") throw new UsageError("--alias selects a reference; it does not go with --type wikis.");
    print(showReference(args.alias));
    return 0;
  }
  const limit = Math.min(Math.max(args.max_results || 20, 1), 50);
  const query = (args.query ?? "").trim();
  const browsing = query === "" || query === "*";
  const parts: string[] = [];
  if (kind === null || kind === "references") {
    const text = listReferences(...readCatalog());
    parts.push(kind === null ? "--references--\n" + text : text);
  }
  if (kind === null || kind === "wikis") {
    const text = browsing ? browseWiki(limit) : findInWiki(query, limit);
    parts.push(kind === null ? "--wikis--\n" + text : text);
  }
  print(parts.join("\n---\n"));
  return 0;
}

async function cmdWebSearch(args: Record<string, any>) {
  const query = (args.query as string).trim();
  if (!query) throw new UsageError("The query is empty.");
  const settings = settingsOrWarn();
  const keys = apiKeys(settings);
  const count = args.num_results ?? settings.defaultNumResults;
  const request: Request = {
    query,
    numResults: Math.min(MAX_NUM_RESULTS, Math.max(1, count)),
    type: args.type || settings.defaultSearchType,
    livecrawl: args.livecrawl || settings.defaultLivecrawl,
    contextMaxCharacters: args.context_max_characters,
  };
  const characters = request.contextMaxCharacters;
  if (characters !== null && !(1 <= characters && characters <= 50000)) {
    throw new UsageError("--context-max-characters takes a number from 1 to 50000.");
  }
  const first: Provider = args.provider || settings.provider;
  const order = [first, ...PROVIDERS.filter((name) => name !== first)];
  const deadline = performance.now() + settings.searchTimeoutMs;
  const [provider, answer] = await searchInTurn(order, request, deadline, settings.maxResponseBytes, keys);
  const text = answer.results.length ? formatResults(answer.results) : answer.text.trim();
  if (!text || text === NO_RESULTS) {
    print(NO_RESULTS);
    return 0;
  }
  const meta = {
    source: "web_search",
    query,
    provider,
    title: `Web Search: ${query}`,
    format: "markdown",
    saved: nowStamp(),
  };
  const lines = [`Web Search: ${query}`, `Provider: ${LABELS[provider]}, ${answer.results.length} results`];
  let files: string[];
  let cut: boolean;
  try {
    [files, cut] = await saveTopic(slugify(query), meta, text, settings.pageChars);
  } catch (error) {
    lines.push(`Not saved to the wiki: ${reason(error)}`);
    print(lines.join("\n") + "\n\n" + text);
    return 0;
  }
  lines.push(...savedLines(files, cut, text.length));
  print(lines.join("\n") + "\n\n" + firstPage(files[0]!));
  return 0;
}

/** Save what one fetch brought. Returns the lines to print and the first page. */
async function keepFetch(result: Fetched, settings: Settings): Promise<[string[], string | null]> {
  let described = result.type || "no content type";
  const mime = result.type.split(";")[0]!.trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    described += `, as ${result.format}`;
    if (result.trimmed) described += ", main content only (--whole-page gives everything)";
  }
  const lines = [`URL: ${result.url}`];
  if (result.requested) lines.push(`Redirected from: ${result.requested}`);
  if (result.title) lines.push(`Title: ${result.title}`);
  lines.push(`Type: ${described}`);
  if (result.kind === "empty") {
    lines.push("The page has no content. Nothing was saved.");
    return [lines, null];
  }
  const meta = { source: "web_fetch", url: result.url, title: result.title, format: result.format, saved: nowStamp() };
  const topic = urlTopic(result.url);
  let text = result.text ?? "";
  if (result.kind === "image") {
    const file = path.join(filesDir(), topic + (IMAGE_SUFFIX[result.mime!] ?? ".img"));
    atomicWrite(file, result.body!);
    lines.push(`Image: ${file} (${result.body!.length} bytes). Open this file to see it.`);
    meta.format = "image";
    text = `Image fetched from ${result.url} and saved as ${file}`;
  }
  const [files, cut] = await saveTopic(topic, meta, text, settings.pageChars);
  lines.push(...savedLines(files, cut, text.length));
  for (const name of files.slice(1)) lines.push(`  ${wikiPath(name)}`);
  return [lines, result.kind === "image" ? null : files[0]!];
}

/** Run `work` on every item, at most `width` at a time, keeping their order. */
async function eachAtOnce<T, R>(items: T[], width: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}

async function cmdWebFetch(args: Record<string, any>) {
  const settings = settingsOrWarn();
  let timeout = settings.fetchTimeoutSeconds;
  if (args.timeout !== null) timeout = Math.min(Math.max(args.timeout, bounds.minFetchSeconds), MAX_FETCH_SECONDS);
  const urls = [...new Set(args.url as string[])];

  const attempt = async (value: string): Promise<[string, Answer | Problem]> => {
    try {
      const url = normalUrl(value);
      const direct = sources.direct(url);
      if (direct !== url) {
        try {
          return [url, await download(direct, args.format, timeout, settings.maxResponseBytes)];
        } catch (error) {
          if (!(error instanceof Problem)) throw error;
        }
      }
      return [url, await download(url, args.format, timeout, settings.maxResponseBytes)];
    } catch (error) {
      if (error instanceof Problem) return [value, error];
      throw error;
    }
  };

  const answers = await eachAtOnce(urls, 8, attempt);
  let failures = 0;
  const sections: string[] = [];
  const show = urls.length === 1 && !args.no_content;
  for (const [url, answer] of answers) {
    let lines: string[];
    let first: string | null;
    try {
      if (answer instanceof Problem) throw answer;
      [lines, first] = await keepFetch(fetched(url, answer, args.format, args.whole_page), settings);
    } catch (error) {
      if (!(error instanceof Problem) && !(error as any)?.code) throw error;
      failures++;
      sections.push(`URL: ${url}\nFailed: ${reason(error)}`);
      continue;
    }
    let section = lines.join("\n");
    if (show && first) section += "\n\n" + firstPage(first);
    sections.push(section);
  }
  print(sections.join("\n\n"));
  if (failures && urls.length > 1) note(`${failures} of ${urls.length} URLs failed.`);
  return failures ? 1 : 0;
}

async function cmdForget(args: Record<string, any>) {
  const root = wikiDirectory();
  const topics: string[] = [];
  for (const name of args.page as string[]) {
    const found = pageName(
      name,
      "forget takes the file name of a wiki page as this script prints it, such as react-dev-learn.md.",
    );
    if (!topics.includes(found[1]!)) topics.push(found[1]!);
  }
  const missing = topics.filter((topic) => !topicFiles(root, topic).length);
  if (missing.length) {
    throw new Problem(`There is no wiki topic named ${missing.join(", ")} in ${root}. Nothing was removed.`);
  }
  for (const [topic, count] of await removeTopics(root, topics)) {
    print(`Forgot ${topic} (${count} page${count === 1 ? "" : "s"})`);
  }
  return 0;
}

function cmdRefAdd(args: Record<string, any>) {
  const alias = args.alias as string;
  if (!validAlias(alias)) throw new UsageError("The alias must be one word with no space, slash, comma or backtick.");
  const [entries, problem] = readDocument();
  if (problem) throw new Problem(problem + ". Repair or remove the file first.");
  if (alias in entries && !args.replace) {
    throw new Problem(`A reference named '${alias}' exists. Add --replace to change it.`);
  }
  const value = (args.source as string).trim();
  const entry: Record<string, unknown> = {};
  if ("~./".includes(value[0] ?? "x")) {
    if (args.branch) throw new UsageError("--branch goes with a git repository, not with a directory.");
    const directory = path.resolve(expandUser(value));
    if (!isDir(directory)) throw new Problem(`${directory} is not a directory.`);
    entry.path = directory;
  } else {
    if (!parseRepository(value)) {
      throw new UsageError(
        `'${value}' is not a git repository. A repository is owner/name for GitHub, host/path, ` +
          "user@host:path, or a URL. A directory begins with /, ~/ or ./.",
      );
    }
    if (args.branch && !validBranch(args.branch)) throw new UsageError(`'${args.branch}' is not a safe git branch name.`);
    entry.repository = value;
    if (args.branch) entry.branch = args.branch;
  }
  if (args.description) entry.description = args.description;
  if (args.hidden) entry.hidden = true;
  const [source, why] = readSource(entry);
  if (!source) throw new UsageError(`The reference is not valid: ${why}.`);
  const root = source.type === "git" ? clone(source) : locate(source)[0];
  entries[alias] = entry;
  writeDocument(entries);
  print(`Added reference ${alias} (${source.type})\nRoot: ${root}`);
  return 0;
}

function cmdRefRemove(args: Record<string, any>) {
  const [entries, problem] = readDocument();
  if (problem) throw new Problem(problem + ". Repair or remove the file first.");
  if (!(args.alias in entries)) throw new Problem(`There is no reference named '${args.alias}'.`);
  const [removed] = readSource(entries[args.alias]);
  delete entries[args.alias];
  writeDocument(entries);
  print(`Removed reference ${args.alias}`);
  if (removed && removed.type === "git") {
    const target = cachePath(parseRepository(removed.repository!)!, removed.branch);
    const stillUsed = Object.values(entries).some((entry) => {
      const [other] = readSource(entry);
      return (
        other?.type === "git" && target === cachePath(parseRepository(other.repository!)!, other.branch)
      );
    });
    const inside = realpath(target).startsWith(realpath(reposDir()) + path.sep);
    if (isDir(target) && inside && !stillUsed) {
      fs.rmSync(target, { recursive: true, force: true });
      print(`Removed its clone ${target}`);
    }
  }
  return 0;
}

function cmdRefRefresh(args: Record<string, any>) {
  const [references, notes] = readCatalog();
  for (const text of notes) note("note: " + text);
  const asked = args.alias as string[];
  const wanted = references.filter((item) => item.type === "git" && (!asked.length || asked.includes(item.alias)));
  const unknown = asked.filter((alias) => !wanted.some((item) => item.alias === alias));
  if (unknown.length) throw new Problem(`Not a git reference: ${unknown.join(", ")}.`);
  if (!wanted.length) {
    print("There are no git references to refresh.");
    return 0;
  }
  let failures = 0;
  for (const reference of wanted) {
    try {
      print(`${reference.alias}: at ${refresh(reference)}`);
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      failures++;
      print(`${reference.alias}: ${error.message}`);
    }
  }
  return failures ? 1 : 0;
}

function cmdConfig() {
  const [settings, problems] = loadSettings();
  const keys = apiKeys(settings);
  const pages = readWiki();
  const topics = new Set(pages.map((page) => page.meta.topic ?? "")).size;
  const [references] = readCatalog();
  const lines = [
    `Home: ${home()} (change it with the environment variable ${HOME_ENV})`,
    `Wiki: ${wikiDirectory()} (${topics} topics, ${pages.length} pages)`,
    `References: ${referencesFile()} (${references.length})`,
    `Settings: ${settingsFile()}${fs.existsSync(settingsFile()) ? "" : " (not there)"}`,
    "",
    "Settings in effect:",
  ];
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (!key.endsWith("ApiKey")) lines.push(`  ${key}: ${JSON.stringify(settings[key])}`);
  }
  for (const provider of PROVIDERS) {
    const origin = keys[provider][1];
    lines.push(
      `  ${LABELS[provider]} API key: ${origin ? `set, from the ${origin}` : "not set; the keyless service is used"}`,
    );
  }
  for (const problem of problems) lines.push(`note: ${problem}`);
  print(lines.join("\n"));
  return 0;
}

export const COMMANDS: Command[] = [
  {
    name: "local",
    summary: "search or browse the local wiki and the reference roots",
    description:
      "With nothing: list the references and the newest wiki topics. With --query: list the " +
      "references and the wiki pages that match. The lists only identify; open a page or a root " +
      "before relying on it.",
    options: [
      { name: "--query", dest: "query", metavar: "TEXT", help: "what to look for, as distinctive words; * or nothing browses" },
      { name: "--type", dest: "type", metavar: "KIND", choices: ["wikis", "references"], help: "look in one of the two only" },
      { name: "--page", dest: "page", metavar: "FILE", help: "open this wiki page in full" },
      { name: "--alias", dest: "alias", metavar: "NAME", help: "show this reference's root and what is directly in it" },
      { name: "--max-results", dest: "max_results", type: "int", metavar: "N", help: "wiki pages or topics to list (default 20, at most 50)" },
      { name: "--no-content", dest: "no_content", flag: true, help: "with --page: print where the page is and not its text" },
    ],
    positionals: [],
    examples: [
      `${PROG} local`,
      `${PROG} local --query "tokio runtime spawn_blocking"`,
      `${PROG} local --page docs-rs-tokio.md`,
      `${PROG} local --alias handbook`,
    ],
    run: cmdLocal,
  },
  {
    name: "web-search",
    summary: "search the web; the results are kept in the local wiki",
    description:
      "Search the web and print each result's title, URL and highlights. Exa is asked first " +
      "unless the provider setting or --provider says otherwise; when a provider's limit is " +
      "reached, the next one is asked. The same query asked again replaces the copy kept before.",
    options: [
      { name: "--num-results", dest: "num_results", type: "int", metavar: "N", help: `results to return (default 5, at most ${MAX_NUM_RESULTS})` },
      { name: "--type", dest: "type", metavar: "TYPE", choices: SEARCH_TYPES, help: "how deep to search; Exa with a key only" },
      { name: "--livecrawl", dest: "livecrawl", metavar: "MODE", choices: LIVECRAWL, help: "preferred asks for pages crawled now; Exa with a key only" },
      { name: "--context-max-characters", dest: "context_max_characters", type: "int", metavar: "N", help: "how much text to return for the highlights (1 to 50000); Exa with a key, and Keenable" },
      { name: "--provider", dest: "provider", metavar: "NAME", choices: PROVIDERS, help: "the provider to ask first, for this search only" },
    ],
    positionals: [{ dest: "query", metavar: "QUERY", help: "the search query, as one argument in quotes" }],
    examples: [
      `${PROG} web-search "bun build single file executable"`,
      `${PROG} web-search "react 19 use hook" --num-results 10`,
      `${PROG} web-search "rust async cancellation safety" --type deep --provider exa`,
    ],
    run: cmdWebSearch,
  },
  {
    name: "web-fetch",
    summary: "fetch pages as markdown or text; they are kept in the local wiki",
    description:
      "Fetch one URL and print its first page, or fetch several URLs at the same time and print " +
      "where each was saved. A URL fetched again replaces the copy kept before.",
    options: [
      { name: "--format", dest: "format", metavar: "FORMAT", choices: ["markdown", "text"], default: "markdown", help: "what HTML is converted to (default markdown)" },
      { name: "--timeout", dest: "timeout", type: "float", metavar: "SECONDS", help: `time allowed for each URL (30 to ${MAX_FETCH_SECONDS}, default 30)` },
      { name: "--whole-page", dest: "whole_page", flag: true, help: "keep navigation and everything around the main content" },
      { name: "--no-content", dest: "no_content", flag: true, help: "print where the page was saved and not its text" },
    ],
    positionals: [{ dest: "url", metavar: "URL", nargs: "+", help: "an http or https URL; give several to fetch them together" }],
    examples: [
      `${PROG} web-fetch https://bun.com/docs/bundler`,
      `${PROG} web-fetch https://a.example/one https://b.example/two`,
      `${PROG} web-fetch https://example.com/long-page --no-content`,
    ],
    run: cmdWebFetch,
  },
  {
    name: "forget",
    summary: "remove a topic from the local wiki",
    description:
      "Remove every page of the topic a wiki page belongs to: a fetched page that turned out " +
      "useless, or one the user wants gone.",
    options: [],
    positionals: [{ dest: "page", metavar: "FILE", nargs: "+", help: "a page file of the topic, as the other commands print it" }],
    examples: [`${PROG} forget github-com-o-r-blob-main-a-py.md`],
    run: cmdForget,
  },
  {
    name: "ref-add",
    summary: "add a reference root: a local directory or a git repository",
    description:
      "Add a reference. A directory (beginning with /, ~/ or ./) is used in place. A git " +
      "repository is cloned once, at its newest commit only, into the home directory.",
    options: [
      { name: "--branch", dest: "branch", metavar: "BRANCH", help: "the branch of a repository" },
      { name: "--description", dest: "description", metavar: "TEXT", help: "what the reference holds and when to look in it" },
      { name: "--hidden", dest: "hidden", flag: true, help: "leave it out of the lists; --alias still selects it" },
      { name: "--replace", dest: "replace", flag: true, help: "replace a reference of this name" },
    ],
    positionals: [
      { dest: "alias", metavar: "ALIAS", help: "the short name of the reference: one word" },
      { dest: "source", metavar: "SOURCE", help: "a directory, or a repository: owner/name, host/path, user@host:path or a URL" },
    ],
    examples: [
      `${PROG} ref-add handbook ~/work/handbook --description "The team's handbook"`,
      `${PROG} ref-add react facebook/react --branch main --description "React source"`,
    ],
    run: cmdRefAdd,
  },
  {
    name: "ref-remove",
    summary: "remove a reference root",
    description: "Remove a reference, and its clone when it had one. A local directory is never touched.",
    options: [],
    positionals: [{ dest: "alias", metavar: "ALIAS", help: "the reference to remove" }],
    examples: [`${PROG} ref-remove react`],
    run: cmdRefRemove,
  },
  {
    name: "ref-refresh",
    summary: "update the git reference roots",
    description: "Fetch the newest commit of every git reference, or of the ones named.",
    options: [],
    positionals: [{ dest: "alias", metavar: "ALIAS", nargs: "*", help: "the references to refresh; all git references when none is named" }],
    examples: [`${PROG} ref-refresh`, `${PROG} ref-refresh react`],
    run: cmdRefRefresh,
  },
  {
    name: "config",
    summary: "show where everything is kept and the settings in effect",
    description: "Show the home directory, its files and the settings in effect.",
    options: [],
    positionals: [],
    examples: [`${PROG} config`],
    run: cmdConfig,
  },
];

const top = () => topHelp(PROG, DESCRIPTION, COMMANDS, FOOTER);

function wrongUsage(message: string, usage: string, command?: string) {
  const help = command ? `${PROG} ${command} --help` : `${PROG} --help`;
  note(`${usage}\n${PROG}${command ? " " + command : ""}: error: ${message}\nRun '${help}' for help.`);
  return 2;
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined) {
    print(top());
    return 2;
  }
  if (name === "-h" || name === "--help") {
    print(top());
    return 0;
  }
  if (name === "help") {
    const asked = COMMANDS.find((command) => command.name === rest[0]);
    if (rest.length && !asked) return wrongUsage(`there is no command named '${rest[0]}'`, topUsage(PROG));
    print(asked ? commandHelp(PROG, asked) : top());
    return 0;
  }
  const command = COMMANDS.find((item) => item.name === name);
  if (!command) {
    const choices = COMMANDS.map((item) => `'${item.name}'`).join(", ");
    return wrongUsage(`argument COMMAND: invalid choice: '${name}' (choose from ${choices})`, topUsage(PROG));
  }
  try {
    const args = parseCommand(PROG, command, rest);
    return await command.run(args);
  } catch (error) {
    if (error instanceof HelpRequested) {
      print(error.message);
      return 0;
    }
    if (error instanceof ArgumentError) return wrongUsage(error.message, error.usage, command.name);
    if (error instanceof UsageError) {
      note(`usage: ${error.message}`);
      return 2;
    }
    if (error instanceof Problem || (error as any)?.code) {
      note(`failed: ${reason(error)}`);
      return 1;
    }
    throw error;
  }
}
