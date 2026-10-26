// Errors, output, places, settings and the text helpers every part uses.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MIB = 1024 * 1024;
export const HOME_ENV = "GET_KNOWLEDGE_HOME";
export const DEFAULT_HOME = "~/.get-knowledge";

/** The command was used wrongly. */
export class UsageError extends Error {}

/** The request could not be carried out. */
export class Problem extends Error {}

/** Where the commands write. The tests replace both. */
export const io = {
  out: (text: string) => void process.stdout.write(text + "\n"),
  err: (text: string) => void process.stderr.write(text + "\n"),
};

export function print(text: string) {
  io.out(text);
}

export function note(text: string) {
  io.err(text);
}

// --------------------------------------------------------------------------- places

export function expandUser(value: string) {
  if (value === "~" || value.startsWith("~/")) return os.homedir() + value.slice(1);
  return value;
}

export function home() {
  const configured = (process.env[HOME_ENV] ?? "").trim();
  return path.resolve(expandUser(configured || DEFAULT_HOME));
}

export const wikisDir = () => path.join(home(), "wikis");
export const filesDir = () => path.join(home(), "files");
export const reposDir = () => path.join(home(), "repos");
export const referencesFile = () => path.join(home(), "references.json");
export const settingsFile = () => path.join(home(), "settings.json");

export function isDir(target: string) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function realpath(target: string) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

export function atomicWrite(target: string, content: string | Uint8Array) {
  const folder = path.dirname(target);
  fs.mkdirSync(folder, { recursive: true });
  const temporary = path.join(folder, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temporary, content, { flag: "wx" });
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** The message of an error from the system, such as "ENOENT: no such file ...". */
export function reason(error: unknown) {
  return error instanceof Error ? error.message || error.name : String(error);
}

// --------------------------------------------------------------------------- settings

export const PROVIDERS = ["exa", "keenable", "parallel"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const SEARCH_TYPES = ["auto", "fast", "deep"] as const;
export const LIVECRAWL = ["fallback", "preferred"] as const;
export const MAX_NUM_RESULTS = 20;
export const MAX_FETCH_SECONDS = 3600;

/** Values the tests lower so that a slow server fails quickly. */
export const bounds = { minFetchSeconds: 30 };

export const DEFAULTS = {
  provider: "exa" as Provider,
  searchTimeoutMs: 30000,
  fetchTimeoutSeconds: 30,
  maxResponseBytes: 5 * MIB,
  defaultNumResults: 5,
  defaultSearchType: "auto" as string,
  defaultLivecrawl: "fallback" as string,
  pageChars: 24000,
  exaApiKey: "",
  keenableApiKey: "",
  parallelApiKey: "",
};
export type Settings = typeof DEFAULTS;

const whole = (low: number, high: number) => (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && low <= value && value <= high;
const text = (value: unknown) => typeof value === "string";
const oneOf = (choices: readonly string[]) => (value: unknown) =>
  typeof value === "string" && choices.includes(value);

const ACCEPTS: Record<keyof Settings, (value: unknown) => boolean> = {
  provider: oneOf(PROVIDERS),
  searchTimeoutMs: whole(1000, 3600 * 1000),
  fetchTimeoutSeconds: whole(30, MAX_FETCH_SECONDS),
  maxResponseBytes: whole(1, 512 * MIB),
  defaultNumResults: whole(1, MAX_NUM_RESULTS),
  defaultSearchType: oneOf(SEARCH_TYPES),
  defaultLivecrawl: oneOf(LIVECRAWL),
  pageChars: whole(2000, 400000),
  exaApiKey: text,
  keenableApiKey: text,
  parallelApiKey: text,
};

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The settings in effect, and what is wrong with the settings file. */
export function loadSettings(): [Settings, string[]] {
  const settings: Settings = { ...DEFAULTS };
  const file = settingsFile();
  let stored: unknown;
  try {
    stored = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [settings, []];
    return [settings, [`${file} cannot be read (${reason(error)}); the defaults are used.`]];
  }
  if (!isRecord(stored)) return [settings, [`${file} must hold one JSON object; the defaults are used.`]];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in ACCEPTS)) {
      problems.push(`${file}: unknown setting '${key}' is ignored.`);
    } else if (!ACCEPTS[key as keyof Settings](value)) {
      const shown = key.endsWith("ApiKey") ? "(hidden)" : JSON.stringify(value);
      problems.push(`${file}: ${key} = ${shown} is not allowed; the default is used.`);
    } else {
      (settings as any)[key] = value;
    }
  }
  return [settings, problems];
}

export function settingsOrWarn() {
  const [settings, problems] = loadSettings();
  for (const problem of problems) note("note: " + problem);
  return settings;
}

export type Keys = Record<Provider, [key: string, origin: string]>;

/** Each provider's key and where it comes from. The environment wins. */
export function apiKeys(settings: Settings): Keys {
  const keys = {} as Keys;
  for (const [provider, variable, setting] of [
    ["exa", "EXA_API_KEY", "exaApiKey"],
    ["keenable", "KEENABLE_API_KEY", "keenableApiKey"],
    ["parallel", "PARALLEL_API_KEY", "parallelApiKey"],
  ] as const) {
    const fromEnv = (process.env[variable] ?? "").trim();
    const stored = settings[setting].trim();
    if (fromEnv) keys[provider] = [fromEnv, `environment variable ${variable}`];
    else if (stored) keys[provider] = [stored, "settings.json"];
    else keys[provider] = ["", ""];
  }
  return keys;
}

// --------------------------------------------------------------------------- text

export const BREAK = "\x00";
export const SPACE = /[ \t\r\n\f\v\xa0]+/g;

export function squeeze(value: string) {
  return value.replace(SPACE, " ").trim();
}

/** Remove any of `chars` from both ends, as Python's str.strip(chars) does. */
export function stripChars(value: string, chars: string) {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start]!)) start++;
  while (end > start && chars.includes(value[end - 1]!)) end--;
  return value.slice(start, end);
}

export function rstrip(value: string) {
  return value.replace(/\s+$/, "");
}

const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]");

/** Lines as Python's str.splitlines gives them. */
export function splitLines(value: string) {
  const lines = value.split(LINE_BREAK);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Percent-decode as UTF-8, putting U+FFFD in place of what is not UTF-8. */
export function unquote(value: string) {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
    }
    return new TextDecoder().decode(bytes);
  });
}

/** Percent-encode everything but letters, digits and _.-~ */
export function quoteAll(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export type Split = {
  scheme: string;
  netloc: string;
  path: string;
  query: string;
  fragment: string;
  username: string | null;
  password: string | null;
  hostname: string | null;
  port: number | null;
};

/** A URL cut into its parts without changing any of them, as Python's urlsplit. */
export function urlsplit(value: string): Split {
  let rest = value.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  let scheme = "";
  const found = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(rest);
  if (found) {
    scheme = found[1]!.toLowerCase();
    rest = rest.slice(found[0].length);
  }
  let netloc = "";
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/);
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, end + 2);
    rest = end < 0 ? "" : rest.slice(end + 2);
    if (netloc.includes("[") !== netloc.includes("]")) throw new Problem("Invalid IPv6 URL");
  }
  let fragment = "";
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  let query = "";
  const mark = rest.indexOf("?");
  if (mark >= 0) {
    query = rest.slice(mark + 1);
    rest = rest.slice(0, mark);
  }
  const at = netloc.lastIndexOf("@");
  const userinfo = at >= 0 ? netloc.slice(0, at) : null;
  const hostport = at >= 0 ? netloc.slice(at + 1) : netloc;
  let username: string | null = null;
  let password: string | null = null;
  if (userinfo !== null) {
    const colon = userinfo.indexOf(":");
    username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
    password = colon >= 0 ? userinfo.slice(colon + 1) : null;
  }
  let host = hostport;
  let portText = "";
  const bracket = /^\[([^\]]*)\](?::(.*))?$/.exec(hostport);
  if (bracket) {
    host = bracket[1]!;
    portText = bracket[2] ?? "";
  } else if (hostport.includes(":")) {
    host = hostport.slice(0, hostport.indexOf(":"));
    portText = hostport.slice(hostport.indexOf(":") + 1);
  }
  let port: number | null = null;
  if (portText) {
    if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new Problem("Port out of range");
    port = Number(portText);
  }
  return {
    scheme,
    netloc,
    path: rest,
    query,
    fragment,
    username,
    password,
    hostname: host ? host.toLowerCase() : null,
    port,
  };
}

/** The pairs of a query, decoded, keeping the ones with no value. */
export function parseQuery(query: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const field of query.split("&")) {
    if (!field) continue;
    const equals = field.indexOf("=");
    const key = equals >= 0 ? field.slice(0, equals) : field;
    const value = equals >= 0 ? field.slice(equals + 1) : "";
    pairs.push([unquote(key.replace(/\+/g, " ")), unquote(value.replace(/\+/g, " "))]);
  }
  return pairs;
}

/** A link resolved against the page's address, or the link as it is when it cannot be. */
export function urljoin(base: string, href: string) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}
