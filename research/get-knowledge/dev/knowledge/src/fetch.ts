// Fetch a URL and turn what it brings into text or an image.

import { Problem } from "./core";
import { type Answer, BROWSER_AGENT, PLAIN_AGENT, httpRequest } from "./http";
import { convertHtml } from "./html";

const RASTER_SKIPPED = ["image/svg+xml", "image/vnd.fastbidsheet"];
export const IMAGE_SUFFIX: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "image/tiff": ".tiff",
};

export function normalUrl(value: string) {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) throw new Problem("URL must start with http:// or https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Problem("Invalid URL");
  }
  if (!url.hostname) throw new Problem("Invalid URL");
  url.hash = "";
  return url.href;
}

const GITHUB_FILE = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/(?:blob|raw)\/([^?#]+)/i;

/** The address of the file itself, where a URL is known to show a file inside a page
 * of buttons: a GitHub file page becomes its raw file. */
export function directSource(url: string) {
  const found = GITHUB_FILE.exec(url);
  if (found) return `https://raw.githubusercontent.com/${found[1]}/${found[2]}/${found[3]}`;
  return url;
}

/** Where a page is fetched from. The tests replace it. */
export const sources = { direct: directSource };

function accept(format: string) {
  if (format === "text") return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
  return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
}

function isText(mime: string) {
  return (
    mime.startsWith("text/") ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    [
      "application/xhtml+xml",
      "application/json",
      "application/xml",
      "application/javascript",
      "application/ld+json",
      "image/svg+xml",
    ].includes(mime)
  );
}

function decode(body: Uint8Array, contentType: string, html: boolean) {
  const found = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType);
  const names = found ? [found[1]!] : [];
  if (!found && html) {
    const head = new TextDecoder("latin1" as any).decode(body.subarray(0, 4096));
    const declared = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    if (declared) names.push(declared[1]!);
  }
  for (const name of names) {
    try {
      return new TextDecoder(name as any).decode(body);
    } catch {
      // an unknown character set: try the next, then UTF-8
    }
  }
  return new TextDecoder().decode(body);
}

/** Fetch one URL. Returns the answer, or throws Problem. */
export async function download(url: string, format: string, timeoutSeconds: number, limit: number) {
  const deadline = performance.now() + timeoutSeconds * 1000;
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_AGENT,
    Accept: accept(format),
    "Accept-Language": "en-US,en;q=0.9",
  };
  let response = await httpRequest("GET", url, headers, null, deadline, limit);
  if (response.status === 403 && response.header("cf-mitigated") === "challenge") {
    // A challenge page answers the browser-like agent; an honest plain agent is
    // tried once, within the same time limit.
    headers["User-Agent"] = PLAIN_AGENT;
    response = await httpRequest("GET", url, headers, null, deadline, limit);
  }
  if (!response.ok) throw new Problem(`HTTP ${response.status}: ${response.reason || "Request failed"}`);
  return response;
}

export type Fetched = {
  url: string;
  requested: string;
  type: string;
  format: string;
  title: string;
  trimmed: boolean;
  kind: "text" | "image" | "empty";
  mime?: string;
  body?: Uint8Array;
  text?: string;
};

/** Turn an answer into what is kept. */
export function fetched(url: string, response: Answer, format: string, wholePage: boolean): Fetched {
  const contentType = response.header("content-type");
  const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
  const final = response.url || url;
  const base = {
    url: final,
    requested: url !== final ? url : "",
    type: contentType,
    format,
    title: "",
    trimmed: false,
  };
  if (mime.startsWith("image/") && !RASTER_SKIPPED.includes(mime)) {
    return { ...base, kind: response.body.length ? "image" : "empty", mime, body: response.body };
  }
  if (!isText(mime)) throw new Problem(`Unsupported binary content-type: ${mime || "unknown"}`);
  const html = mime === "text/html" || mime === "application/xhtml+xml";
  let text = decode(response.body, contentType, html);
  if (html) [base.title, text, base.trimmed] = convertHtml(text, final, format, wholePage);
  text = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  return { ...base, kind: text.trim() ? "text" : "empty", text };
}
