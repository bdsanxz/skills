// Figma REST API commands: work from a file URL or key without Figma Desktop or the plugin.
// Read-only: file and node JSON, rendered images, and the original image fills.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { EXIT_FAILED, EXIT_UNAVAILABLE, EXIT_USAGE, HOME } from "./config";
import { showHelp } from "./help";
import { fail, out, parseArgs, str, writeData } from "./util";

export const TOKEN_VARS = ["FIGMA_TOKEN_KEY", "FIGMA_ACCESS_TOKEN", "FIGMA_TOKEN"];
const API = process.env.FIGMA_API_BASE || "https://api.figma.com";

function token(): string {
  for (const name of TOKEN_VARS) {
    const v = process.env[name];
    if (v?.trim()) return v.trim();
  }
  fail(EXIT_UNAVAILABLE, `No Figma personal access token in the environment (${TOKEN_VARS.join(", ")}).`, {
    help: [
      "Create one in Figma: Settings > Security > Personal access tokens (file content: read).",
      "Export it, e.g. `export FIGMA_TOKEN_KEY=...`. If it is set in a shell profile that this shell did not load, run the command as `source ~/.zshrc >/dev/null 2>&1; figma-access ...`.",
    ],
  });
}

/** Accepts a Figma URL or a bare file key; returns the key and the node id from the URL, if any. */
export function parseTarget(input: string): { fileKey: string; nodeId?: string } {
  const m = /figma\.com\/(?:design|file|proto|board|slides)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/.exec(input);
  if (m) {
    let nodeId: string | undefined;
    try {
      const raw = new URL(input).searchParams.get("node-id");
      if (raw) nodeId = raw.replace(/-/g, ":");
    } catch {
      // not a full URL; no node id
    }
    return { fileKey: m[2] ?? m[1]!, nodeId };
  }
  if (/^[A-Za-z0-9]{10,}$/.test(input)) return { fileKey: input };
  fail(EXIT_USAGE, `"${input}" is neither a Figma file URL nor a file key.`);
}

const CACHE_DIR = join(HOME, "cache");

/**
 * GET a Figma REST endpoint. File and node reads are cached on disk (they are large and the
 * API rate-limits them); pass refresh to bypass. A 429 is retried after its Retry-After.
 */
export async function getJson(path: string, opts: { cache?: boolean; refresh?: boolean } = {}): Promise<any> {
  const cacheFile = join(CACHE_DIR, createHash("sha1").update(path).digest("hex") + ".json");
  if (opts.cache && !opts.refresh && existsSync(cacheFile)) {
    try {
      return JSON.parse(readFileSync(cacheFile, "utf8"));
    } catch {
      // unreadable cache entry: fetch again
    }
  }
  let waited = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(API + path, { headers: { "X-Figma-Token": token() }, signal: AbortSignal.timeout(120000) });
    } catch (e) {
      fail(EXIT_UNAVAILABLE, `Figma API request failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (res.status === 429) {
      const retry = Math.min(Number(res.headers.get("retry-after")) || 20, 60);
      if (waited + retry <= 120) {
        process.stderr.write(`figma-access: rate limited by Figma, retrying in ${retry} s\n`);
        await Bun.sleep(retry * 1000);
        waited += retry;
        continue;
      }
    }
    if (!res.ok) {
      const hint =
        res.status === 403 ? "The token is invalid, expired, or lacks access to this file." :
        res.status === 404 ? "No such file or node, or the token's account cannot see it." :
        res.status === 429 ? "Still rate limited after waiting. Wait a few minutes; reuse a saved node file (spec --from) instead of fetching again." : undefined;
      fail(EXIT_FAILED, `Figma API ${res.status} for ${path}: ${body.err ?? body.message ?? body.raw ?? ""}`.trim(), hint ? { hint } : undefined);
    }
    if (opts.cache) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, text);
    }
    return body;
  }
}

async function download(url: string, path: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) fail(EXIT_FAILED, `Download failed (${res.status}) for ${path}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

function outDir(flag: string | undefined, fileKey: string, sub: string): string {
  return resolve(flag ?? join(process.cwd(), "_swe", "figma-access", fileKey, sub));
}

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "-");

function summarize(node: any, depth: number, max: number): any {
  const s: any = { id: node.id, name: node.name, type: node.type };
  if (node.visible === false) s.hidden = true;
  const b = node.absoluteBoundingBox;
  if (b) s.box = [b.x, b.y, b.width, b.height];
  if (node.children?.length) {
    if (depth < max) s.children = node.children.map((c: any) => summarize(c, depth + 1, max));
    else s.childCount = node.children.length;
  }
  return s;
}

/** Removes hidden subtrees in place; returns how many nodes were removed. */
function pruneHidden(node: any): number {
  if (!node.children) return 0;
  let removed = 0;
  const count = (n: any): number => 1 + (n.children ?? []).reduce((a: number, c: any) => a + count(c), 0);
  node.children = node.children.filter((c: any) => {
    if (c.visible === false) {
      removed += count(c);
      return false;
    }
    return true;
  });
  for (const c of node.children) removed += pruneHidden(c);
  return removed;
}

/** What a design-to-code job needs to plan: text styles, image fills and node counts of the visible tree. */
function inventory(root: any) {
  const fonts = new Map<string, number>();
  const imageRefs = new Set<string>();
  const types = new Map<string, number>();
  let hidden = 0;
  const walk = (n: any, visible: boolean) => {
    const v = visible && n.visible !== false;
    if (!v) hidden++;
    else {
      types.set(n.type, (types.get(n.type) ?? 0) + 1);
      if (n.type === "TEXT" && n.style) {
        const key = `${n.style.fontFamily} ${n.style.fontWeight} ${n.style.fontSize}px`;
        fonts.set(key, (fonts.get(key) ?? 0) + 1);
      }
      for (const f of n.fills ?? []) if (f.type === "IMAGE" && f.imageRef && f.visible !== false) imageRefs.add(f.imageRef);
    }
    for (const c of n.children ?? []) walk(c, v);
  };
  walk(root, true);
  const families = [...new Set([...fonts.keys()].map((k) => k.replace(/ \d+ [\d.]+px$/, "")))];
  return {
    fontFamilies: families,
    textStyles: Object.fromEntries([...fonts.entries()].sort((a, b) => b[1] - a[1])),
    imageFills: imageRefs.size,
    visibleNodeTypes: Object.fromEntries([...types.entries()].sort((a, b) => b[1] - a[1])),
    hiddenNodes: hidden,
  };
}

/** Width and height from a PNG header, or null for other formats. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export async function api(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, { value: ["out"], bool: ["help"], alias: { h: "help", o: "out" } });
  if (flags.help || !positionals[0]) showHelp("api");
  const path = positionals[0]!.startsWith("/") ? positionals[0]! : `/${positionals[0]}`;
  const body = await getJson(path);
  const file = str(flags.out);
  if (file) {
    mkdirSync(dirname(resolve(file)), { recursive: true });
    writeData(resolve(file), body);
    out({ ok: true, path: resolve(file) });
  } else out(body);
}

export async function file(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, { value: ["depth"], bool: ["help", "refresh"], alias: { h: "help" } });
  if (flags.help || !positionals[0]) showHelp("file");
  const { fileKey } = parseTarget(positionals[0]!);
  const depth = Number(str(flags.depth) ?? 2);
  const body = await getJson(`/v1/files/${fileKey}?depth=${depth}`, { cache: true, refresh: !!flags.refresh });
  out({
    ok: true,
    fileKey,
    name: body.name,
    lastModified: body.lastModified,
    version: body.version,
    pages: (body.document?.children ?? []).map((p: any) => summarize(p, 0, Math.max(0, depth - 1))),
  });
}

/** Node ids from the command line ("1-2" or "1:2"); an empty one is a shell mistake, such as an unset array. */
function nodeIds(args: string[]): string[] {
  const ids = args.flatMap((a) => a.split(/[\s,]+/)).map((i) => i.trim().replace(/-/g, ":"));
  if (args.length && ids.every((i) => !i)) fail(EXIT_USAGE, "The node ids are empty: check the variable or array that should hold them.");
  return ids.filter(Boolean);
}

export async function node(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, { value: ["depth", "out", "outline"], bool: ["help", "geometry", "keep-hidden", "refresh"], alias: { h: "help", o: "out" } });
  if (flags.help || !positionals[0]) showHelp("node");
  const target = parseTarget(positionals[0]!);
  const ids = nodeIds(positionals.slice(1));
  if (!ids.length && target.nodeId) ids.push(target.nodeId);
  if (!ids.length) fail(EXIT_USAGE, "Name the node: a URL with node-id, or node ids after the file.");
  const q = new URLSearchParams({ ids: ids.join(",") });
  if (flags.depth !== undefined) q.set("depth", String(str(flags.depth)));
  if (flags.geometry) q.set("geometry", "paths");
  const body = await getJson(`/v1/files/${target.fileKey}/nodes?${q}`, { cache: true, refresh: !!flags.refresh });
  const reports: Record<string, unknown>[] = [];
  for (const [id, v] of Object.entries(body.nodes ?? {}) as [string, any][]) {
    if (!v) continue;
    const doc = v.document;
    const report: Record<string, unknown> = { id, ...inventory(doc) };
    if (doc.visible === false) report.warning = "This node itself is hidden in the design.";
    if (!flags["keep-hidden"]) report.prunedHiddenNodes = pruneHidden(doc);
    if (doc.type === "PAGE" || doc.type === "CANVAS") {
      report.hint = "This is a page, not a design frame. Pick the frame to implement from `frames` and run `node` on its id.";
      report.frames = (doc.children ?? []).map((c: any) => summarize(c, 0, 0));
    }
    reports.push(report);
  }
  const path = resolve(str(flags.out) ?? join(outDir(undefined, target.fileKey, "nodes"), `${ids.map(safeId).join("_")}.kdl`));
  mkdirSync(dirname(path), { recursive: true });
  writeData(path, body);
  const outlineDepth = Number(str(flags.outline) ?? 2);
  const nodes = Object.entries(body.nodes ?? {}).map(([id, v]: [string, any]) =>
    v ? summarize(v.document, 0, outlineDepth) : { id, error: "not found" },
  );
  out({ ok: true, fileKey: target.fileKey, path, keptHidden: !!flags["keep-hidden"], reports, nodes });
}

export async function render(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, { value: ["scale", "format", "out"], bool: ["help"], alias: { h: "help", o: "out" } });
  if (flags.help || !positionals[0]) showHelp("render");
  const target = parseTarget(positionals[0]!);
  const ids = nodeIds(positionals.slice(1));
  if (!ids.length && target.nodeId) ids.push(target.nodeId);
  if (!ids.length) fail(EXIT_USAGE, "Name the node: a URL with node-id, or node ids after the file.");
  const format = (str(flags.format) ?? "png").toLowerCase();
  if (!["png", "jpg", "svg", "pdf"].includes(format)) fail(EXIT_USAGE, "--format must be png, jpg, svg or pdf.");
  const scale = Number(str(flags.scale) ?? 1);
  if (!(scale >= 0.01 && scale <= 4)) fail(EXIT_USAGE, "--scale must be between 0.01 and 4.");
  const q = new URLSearchParams({ ids: ids.join(","), format, scale: String(scale) });
  if (format === "svg") {
    q.set("svg_outline_text", "false");
    q.set("svg_include_id", "true");
  }
  const body = await getJson(`/v1/images/${target.fileKey}?${q}`);
  const dir = outDir(str(flags.out), target.fileKey, "renders");
  // Download eight at a time, in the order asked; report progress on stderr for long batches.
  const files: Record<string, unknown>[] = new Array(ids.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < ids.length) {
      const k = next++;
      const id = ids[k]!;
      const url = body.images?.[id];
      if (!url) {
        files[k] = { id, error: "Figma could not render this node (missing, invisible or empty)." };
      } else {
        const path = join(dir, `${safeId(id)}@${scale}x.${format}`);
        const buf = await download(url, path);
        const size = pngSize(buf);
        const entry: Record<string, unknown> = { id, path, bytes: buf.length, ...size };
        if (size && Math.max(size.width, size.height) > 2000) {
          entry.note = "Larger than 2000 px on a side: an image viewer shows it to you shrunk. Read it in parts (crop strips of at most ~1500 px) before you judge details.";
        }
        files[k] = entry;
      }
      done++;
      if (ids.length > 4 && (done % 10 === 0 || done === ids.length)) process.stderr.write(`figma-access: downloaded ${done}/${ids.length}\n`);
    }
  };
  if (ids.length > 4) process.stderr.write(`figma-access: Figma rendered ${ids.length} nodes; downloading\n`);
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  out({ ok: files.every((f) => !("error" in f)), fileKey: target.fileKey, scale, format, files });
}

export async function imageFills(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, { value: ["out"], bool: ["help"], alias: { h: "help", o: "out" } });
  if (flags.help || !positionals[0]) showHelp("image-fills");
  const { fileKey } = parseTarget(positionals[0]!);
  const body = await getJson(`/v1/files/${fileKey}/images`);
  const images: Record<string, string> = body.meta?.images ?? {};
  const dir = outDir(str(flags.out), fileKey, "image-fills");
  const files = [];
  for (const [ref, url] of Object.entries(images)) {
    if (!url) continue;
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : type.includes("gif") ? "gif" : type.includes("svg") ? "svg" : "bin";
    const buf = Buffer.from(await res.arrayBuffer());
    const path = join(dir, `${ref}.${ext}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, buf);
    files.push({ imageRef: ref, path, bytes: buf.length });
  }
  out({ ok: true, fileKey, dir, count: files.length, files });
}
