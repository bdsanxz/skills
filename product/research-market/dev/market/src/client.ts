// GET JSON from the FxEmbed API, pacing requests, retrying, and recording what failed.
// Data comes from https://docs.fxembed.com/api/introduction/: FxTwitter at
// api.fxtwitter.com and FxBluesky at api.fxbsky.app. Neither needs a key or a login.

import os from "node:os";
import { DecodeError, type Json, type JsonMap, type JsonObject, decodeUtf8, get, isDict, loads, pyStr, truthy } from "./pyjson";

export type Platform = "x" | "bluesky";
export type Dict = JsonObject | JsonMap;
export type Params = Record<string, Json | undefined>;

export const HOSTS: Record<Platform, string> = { x: "https://api.fxtwitter.com", bluesky: "https://api.fxbsky.app" };
export const USER_AGENT = "research-market-skill/1.0";
export const MIN_INTERVAL = 0.25; // seconds between requests; the API allows 1000 per minute per IP
export const RETRY_WAITS = [2, 6]; // seconds to wait before the second and third attempt
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER = 60;
const TIMEOUT_MS = 30_000;

/** One request that could not be fetched, as the summary lists it under `could_not_fetch`. */
export type Failure = JsonObject & { what: string; status: Json; message: string; url: string | null };

/** What the collection needs from a client; the tests put a fake in its place. */
export interface Getter {
  errors: Failure[];
  requests: number;
  get(platform: Platform, path: string, params: Params, what: string, missingOk?: boolean): Promise<Dict | null>;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Python's urllib.parse.quote: letters, digits, _.-~ and `safe` stay; the rest is %XX of its UTF-8. */
export function quote(value: string, safe = "/") {
  let text = "";
  for (const byte of new TextEncoder().encode(value)) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(char) || (byte < 0x80 && safe.includes(char))) text += char;
    else text += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return text;
}

/** Python's urllib.parse.urlencode of a dict, with quote_plus. */
export function urlencode(params: [string, Json][]) {
  const plus = (value: string) => quote(value, " ").replace(/ /g, "+");
  return params.map(([key, value]) => `${plus(key)}=${plus(pyStr(value))}`).join("&");
}

/** A short reason for a failed response, for the error list the agent reports to the user. */
export function describe(status: number | null, body: Json) {
  if (isDict(body) && truthy(get(body, "message"))) return pyStr(get(body, "message"));
  const known: Record<number, string> = {
    400: "the API rejected the request",
    401: "private or unavailable",
    404: "not found (deleted, private, or a wrong URL or handle)",
    429: "rate limited",
  };
  if (status !== null && status in known) return known[status]!;
  return status && status >= 500 ? "server or upstream failure" : `HTTP ${status === null ? "None" : status}`;
}

type Attempt = { status: number | null; body: Json | undefined; message: string; retryAfter: number | null };

export class Client implements Getter {
  errors: Failure[] = [];
  requests = 0;
  private last: number | null = null;
  private readonly fetcher: Fetcher;
  private readonly sleep: (seconds: number) => Promise<void> | void;
  private readonly clock: () => number;

  constructor(
    options: {
      fetcher?: Fetcher;
      sleep?: (seconds: number) => Promise<void> | void;
      clock?: () => number;
    } = {},
  ) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((seconds) => Bun.sleep(seconds * 1000));
    this.clock = options.clock ?? (() => performance.now() / 1000);
  }

  /**
   * The response body as a dict, or null after recording an error. With `missingOk`, a 404
   * is returned as an empty dict: for list endpoints it only means that nothing matched.
   */
  async get(platform: Platform, path: string, params: Params, what: string, missingOk = false) {
    let url = HOSTS[platform] + path;
    const query = Object.entries(params).filter((entry): entry is [string, Json] => entry[1] != null);
    if (query.length) url += "?" + urlencode(query);
    let status: number | null = null;
    let message = "no response";
    for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
      let body: Json | undefined;
      let retryAfter: number | null;
      ({ status, body, message, retryAfter } = await this.request(url));
      if (status === 200 && isDict(body)) return body;
      if (status === 204 || (status === 404 && missingOk)) return {};
      if (status !== null && !RETRY_STATUSES.has(status)) break;
      if (attempt < RETRY_WAITS.length) {
        let wait = RETRY_WAITS[attempt]!;
        if (retryAfter !== null) wait = Math.max(wait, Math.min(retryAfter, MAX_RETRY_AFTER));
        await this.sleep(wait);
      }
    }
    this.errors.push({ what, status, message, url });
    return null;
  }

  /** One attempt; the status is null on a network failure. */
  private async request(url: string): Promise<Attempt> {
    if (this.last !== null) {
      const pause = MIN_INTERVAL - (this.clock() - this.last);
      if (pause > 0) await this.sleep(pause);
    }
    this.requests++;
    let status: number;
    let raw: Uint8Array;
    let retryAfter: number | null = null;
    try {
      const response = await this.fetcher(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Accept-Encoding": "identity",
          Connection: "close",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      if (status < 200 || status > 299) {
        const header = (response.headers.get("Retry-After") ?? "").trim();
        if (/^[0-9]+$/.test(header)) retryAfter = Number(header);
      }
      raw = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return { status: null, body: undefined, message: `network error: ${networkReason(error)}`, retryAfter: null };
    } finally {
      this.last = this.clock();
    }
    let body: Json;
    try {
      body = raw.length ? loads(decodeUtf8(raw)) : {};
    } catch (error) {
      if (!(error instanceof DecodeError)) throw error;
      return { status, body: undefined, message: `HTTP ${status} with a body that is not JSON`, retryAfter };
    }
    return { status, body, message: describe(status, body), retryAfter };
  }
}

/** The reason of a network failure, in the words Python's urllib uses for the common ones. */
export function networkReason(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const errno = os.constants.errno as Record<string, number>;
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT") return "timed out";
  if (code === "ConnectionRefused" || code === "ECONNREFUSED") return `[Errno ${errno.ECONNREFUSED}] Connection refused`;
  if (code === "ECONNRESET" || code === "ConnectionClosed") return `[Errno ${errno.ECONNRESET}] Connection reset by peer`;
  if (code === "ENOTFOUND" || code === "DNSException" || code === "EAI_NONAME") {
    return process.platform === "darwin"
      ? "[Errno 8] nodename nor servname provided, or not known"
      : "[Errno -2] Name or service not known";
  }
  return error instanceof Error ? error.message || name : String(error);
}
