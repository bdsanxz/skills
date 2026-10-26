// References: local directories and git repositories to look in before the web.

import fs from "node:fs";
import path from "node:path";
import {
  Problem,
  atomicWrite,
  compare,
  expandUser,
  isDir,
  isRecord,
  quoteAll,
  realpath,
  reason,
  referencesFile,
  reposDir,
  splitLines,
  unquote,
  urlsplit,
} from "./core";

export const SKIPPED_CHILDREN = new Set(["node_modules", ".git"]);
export const MAX_CHILDREN = 300;
export const HANDOFF =
  "Read, search and list this root with your own file tools. Read a file in full " +
  "before you rely on it.";

export type Repository = { host: string; segments: string[]; remote: string };
export type Source = {
  description: string;
  hidden: boolean;
  type: "local" | "git";
  path?: string;
  repository?: string;
  branch?: string | null;
};
export type Reference = Source & { alias: string; root: string; why: string };

export function validAlias(alias: string) {
  return !!alias && !/[/\\\s`,]/.test(alias);
}

export function validBranch(branch: string) {
  return (
    /^[A-Za-z0-9/_.-]+$/.test(branch) &&
    !branch.startsWith("-") &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    branch.split("/").every((part) => !["", ".", ".."].includes(part))
  );
}

/** A repository as {host, segments, remote}, or null when the value is not one.
 * Takes owner/name (GitHub), github:owner/name, host/path, user@host:path and URLs. */
export function parseRepository(value: string): Repository | null {
  if (!value.trim() || /[\s\\;`$\x00]/.test(value)) return null;
  const cleaned = value
    .trim()
    .replace(/^git\+/, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
  if (!cleaned || cleaned.split(/[/\\]+/).some((part) => part === "." || part === "..")) return null;

  const parts = (text: string) =>
    text
      .split("/")
      .map((part) => part.replace(/\.git$/, "").trim())
      .filter(Boolean);

  const remote = (host: string, segments: string[], given?: string): Repository | null => {
    host = host.toLowerCase();
    if (!host || host.startsWith("-") || !segments.length) return null;
    for (const segment of segments) {
      const decoded = unquote(segment);
      if (decoded === "." || decoded === ".." || segment.includes(":") || /[\s/\\\x00]/.test(decoded)) {
        return null;
      }
    }
    return { host, segments, remote: given || `https://${host}/${segments.join("/")}.git` };
  };

  const prefixed = /^github:([^/\s]+)\/([^/\s]+)$/.exec(cleaned);
  if (prefixed) return remote("github.com", parts(`${prefixed[1]}/${prefixed[2]}`));
  if (!cleaned.includes("://")) {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(cleaned);
    if (scp) return remote(scp[1]!, parts(scp[2]!), cleaned);
    const direct = parts(cleaned);
    if (direct.length >= 2 && (direct[0]!.includes(".") || direct[0] === "localhost")) {
      return remote(direct[0]!, direct.slice(1));
    }
    if (direct.length === 2) return remote("github.com", direct);
    return null;
  }
  let url;
  try {
    url = urlsplit(cleaned);
  } catch {
    return null;
  }
  if (url.scheme === "file") {
    const segments = unquote(url.path).split("/").filter(Boolean);
    return segments.length ? { host: "file", segments, remote: cleaned } : null;
  }
  if (!["https", "http", "ssh", "git"].includes(url.scheme) || !url.hostname) return null;
  const hostport = url.netloc.slice(url.netloc.lastIndexOf("@") + 1);
  return remote(hostport, parts(url.path), url.hostname === "github.com" ? undefined : cleaned);
}

export function cachePath(repository: Repository, branch?: string | null) {
  const base = path.join(reposDir(), repository.host.replace(/:/g, "_"), ...repository.segments);
  return branch ? `${base}@${quoteAll(branch)}` : base;
}

/** A stored entry as a source, or the reason it is not valid. */
export function readSource(entry: unknown): [Source | null, string] {
  if (typeof entry === "string") {
    entry = "~./".includes(entry[0] ?? "x") ? { path: entry } : { repository: entry };
  }
  if (!isRecord(entry)) return [null, "the entry must be a string or an object"];
  if ("path" in entry === "repository" in entry) {
    return [null, "the entry must have exactly one of path and repository"];
  }
  const description = entry.description ?? "";
  const hidden = entry.hidden ?? false;
  if (typeof description !== "string" || typeof hidden !== "boolean") {
    return [null, "description must be text, and hidden true or false"];
  }
  if ("path" in entry) {
    const local = entry.path;
    if (typeof local !== "string" || !(local.startsWith("/") || local.startsWith("~/"))) {
      return [null, "a local path must be absolute or begin with ~/"];
    }
    if ("branch" in entry) return [null, "a local reference has no branch"];
    return [{ description, hidden, type: "local", path: local }, ""];
  }
  const repository = entry.repository;
  const branch = entry.branch ?? null;
  if (typeof repository !== "string" || !parseRepository(repository)) {
    return [null, "the repository is not a valid git reference"];
  }
  if (branch !== null && !(typeof branch === "string" && validBranch(branch))) {
    return [null, "the branch is not a safe git branch name"];
  }
  return [{ description, hidden, type: "git", repository, branch }, ""];
}

/** [root, why it is unavailable] for a source. */
export function locate(source: Source): [string, string] {
  if (source.type === "git") {
    const target = cachePath(parseRepository(source.repository!)!, source.branch);
    if (isDir(target)) return [realpath(target), ""];
    return ["", "the repository is not cloned; run ref-refresh"];
  }
  const local = expandUser(source.path!);
  if (!isDir(local)) return ["", `the directory ${local} does not exist`];
  return [realpath(local), ""];
}

/** The references file as [map of alias to entry, problem]. */
export function readDocument(): [Record<string, unknown>, string] {
  const file = referencesFile();
  let document: unknown;
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [{}, ""];
    return [{}, `${file} cannot be read: ${reason(error)}`];
  }
  const entries = isRecord(document) ? document.references : null;
  if (!isRecord(entries)) return [{}, `${file} must hold an object named references`];
  return [entries, ""];
}

export function readCatalog(): [Reference[], string[]] {
  const [entries, problem] = readDocument();
  const notes = problem ? [problem] : [];
  const references: Reference[] = [];
  for (const alias of Object.keys(entries).sort(compare)) {
    if (!validAlias(alias)) {
      notes.push("an alias with a space, a slash, a comma or a backtick is ignored");
      continue;
    }
    const [source, why] = readSource(entries[alias]);
    if (!source) {
      notes.push(`reference '${alias}' is ignored: ${why}`);
      continue;
    }
    const [root, unavailable] = locate(source);
    references.push({ ...source, alias, root, why: unavailable });
  }
  return [references, notes];
}

export function writeDocument(entries: Record<string, unknown>) {
  atomicWrite(referencesFile(), JSON.stringify({ references: entries }, null, 2) + "\n");
}

function git(args: string[], cwd?: string) {
  let done;
  try {
    done = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 900_000,
    });
  } catch {
    throw new Problem("git is not installed, and a git reference needs it.");
  }
  if (done.exitedDueToTimeout) throw new Problem(`git ${args[0]} did not finish in 15 minutes.`);
  if (done.exitCode !== 0) {
    const lines = splitLines(done.stderr.toString().trim()).filter((line) => line.trim());
    throw new Problem(`git ${args[0]} failed: ${lines.slice(-3).join(" ") || "no output"}`);
  }
  return done.stdout.toString().trim();
}

/** Clone a git source into its place in the cache. Returns the root. */
export function clone(source: Source) {
  const repository = parseRepository(source.repository!)!;
  const target = cachePath(repository, source.branch);
  if (isDir(target)) return realpath(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), ".clone-"));
  try {
    const args = ["clone", "--depth", "1", "--single-branch"];
    if (source.branch) args.push("--branch", source.branch);
    git([...args, "--", repository.remote, staging]);
    fs.renameSync(staging, target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return realpath(target);
}

/** Bring a cloned git source up to date. Returns the commit it is at. */
export function refresh(source: Source) {
  const target = cachePath(parseRepository(source.repository!)!, source.branch);
  if (!isDir(target)) {
    clone(source);
  } else {
    git(["fetch", "--depth", "1", "origin", source.branch || "HEAD"], target);
    git(["reset", "--hard", "FETCH_HEAD"], target);
  }
  return git(["rev-parse", "--short", "HEAD"], target);
}
