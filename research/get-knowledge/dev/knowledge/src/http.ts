// One HTTP request with a deadline for the whole exchange and a bounded body.

import { MIB, Problem } from "./core";

export const BROWSER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
export const PLAIN_AGENT = "get-knowledge";

/** Encodings the runtime inflates by itself. */
const READABLE = new Set(["", "identity", "gzip", "x-gzip", "deflate", "br", "zstd"]);

export class Answer {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly headers: Headers,
    readonly url: string,
    readonly body: Uint8Array,
  ) {}

  get ok() {
    return 200 <= this.status && this.status < 300;
  }

  header(name: string) {
    return this.headers.get(name) ?? "";
  }

  text() {
    return new TextDecoder().decode(this.body);
  }
}

function tooLarge(limit: number) {
  if (limit === 5 * MIB) return "Response too large (exceeds 5MB limit)";
  return `Response too large (exceeds the maxResponseBytes setting of ${limit} bytes)`;
}

/** `deadline` is a time of performance.now(). A status listed in `noBody` is
 * returned without its body being read. */
export async function httpRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  data: string | null,
  deadline: number,
  limit: number,
  noBody: number[] = [],
): Promise<Answer> {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new Problem("Request timed out");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(url, {
      method,
      headers: { "Accept-Encoding": "gzip", ...headers },
      body: data,
      redirect: "follow",
      signal: controller.signal,
    });
    const answer = (body: Uint8Array) =>
      new Answer(response.status, response.statusText, response.headers, response.url || url, body);
    if (noBody.includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      return answer(new Uint8Array());
    }
    const encoding = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
    if (!READABLE.has(encoding)) {
      await response.body?.cancel().catch(() => {});
      throw new Problem(
        `Request failed: the server answered with the content encoding '${encoding}', which cannot be read`,
      );
    }
    const declared = (response.headers.get("content-length") ?? "").trim();
    if (["", "identity"].includes(encoding) && /^\d+$/.test(declared) && Number(declared) > limit) {
      await response.body?.cancel().catch(() => {});
      throw new Problem(tooLarge(limit));
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        if (performance.now() > deadline) throw new Problem("Request timed out");
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          throw new Problem(tooLarge(limit));
        }
        chunks.push(value);
      }
    }
    return answer(Buffer.concat(chunks));
  } catch (error: any) {
    if (error instanceof Problem) throw error;
    if (controller.signal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Problem("Request timed out");
    }
    const message = error?.message || error?.name || String(error);
    throw new Problem(`Request failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
