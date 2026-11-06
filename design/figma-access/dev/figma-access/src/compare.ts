// compare: capture a page in headless Chrome and measure it against a design render, per section,
// with the shift that explains each section's difference best. Works on any PNG reference.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXIT_FAILED, EXIT_UNAVAILABLE, EXIT_USAGE } from "./config";
import { showHelp } from "./help";
import { decodePng, encodePng, type Image } from "./png";
import { measureNodes, offNodes, renderOrigin, styleSummary } from "./nodes";
import { slug } from "./html";
import { exportBounds } from "./spec";
import { fail, out, parseArgs, readData, str, writeData } from "./util";

interface Rect { x: number; y: number; w: number; h: number }
interface Section extends Rect { name: string }

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const CHROME_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "microsoft-edge"];

function findChrome(): string {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  for (const n of CHROME_NAMES) {
    const p = Bun.which(n);
    if (p) return p;
  }
  fail(EXIT_UNAVAILABLE, "No Chrome, Chromium or Edge found to capture the page.", {
    hint: "Install one, or set CHROME_PATH to its executable. Or capture the page yourself and pass the PNG instead of the page.",
  });
}

async function capture(page: string, width: number, height: number, scale: number, waitMs: number, path: string): Promise<Image> {
  const url = /^(https?|file):/.test(page) ? page : pathToFileURL(resolve(page)).href;
  if (url.startsWith("file:") && !existsSync(new URL(url))) fail(EXIT_USAGE, `No such page: ${page}`);
  const profile = mkdtempSync(join(tmpdir(), "figma-access-chrome-"));
  try {
    const p = Bun.spawn(
      [
        findChrome(), "--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        `--user-data-dir=${profile}`, `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`,
        `--virtual-time-budget=${waitMs}`, `--screenshot=${path}`, url,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const timer = setTimeout(() => p.kill(), waitMs + 60000);
    const err = await new Response(p.stderr).text();
    await p.exited;
    clearTimeout(timer);
    if (!existsSync(path)) fail(EXIT_FAILED, `Chrome did not write a screenshot of ${url}.`, { chrome: err.trim().split("\n").slice(-3) });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  return decodePng(readFileSync(path));
}

function readPng(path: string, what: string): Image {
  if (!existsSync(path)) fail(EXIT_USAGE, `No such ${what}: ${path}`);
  try {
    return decodePng(readFileSync(path));
  } catch (e) {
    fail(EXIT_USAGE, `Cannot read the ${what} ${path}: ${(e as Error).message}`);
  }
}

function crop(img: Image, r: Rect): Image {
  if (r.x < 0 || r.y < 0 || r.x + r.w > img.width || r.y + r.h > img.height) {
    fail(EXIT_USAGE, `Crop ${r.x},${r.y},${r.w},${r.h} falls outside the ${img.width}x${img.height} image.`);
  }
  const data = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) data.set(img.data.subarray(((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data };
}

/** RGB over white, so transparent areas compare as the white page they sit on. */
function flatten(img: Image): Uint8Array {
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    const a = img.data[i + 3]! / 255;
    for (let k = 0; k < 3; k++) rgb[j + k] = Math.round(img.data[i + k]! * a + 255 * (1 - a));
  }
  return rgb;
}

function parseNumbers(text: string, n: number, what: string): number[] {
  const v = text.split(",").map((s) => Number(s.trim()));
  if (v.length !== n || v.some((x) => !Number.isFinite(x))) fail(EXIT_USAGE, `Cannot read ${what} "${text}".`);
  return v;
}

/** "name=x,y,w,h" or "name=y0-y1" (full width), separated by ";". */
function parseSections(text: string, width: number): Section[] {
  return text.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([^=]+)=(.+)$/.exec(s);
    if (!m) fail(EXIT_USAGE, `Cannot read section "${s}". Write name=x,y,w,h or name=top-bottom.`);
    const band = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(m[2]!.trim());
    if (band) return { name: m[1]!.trim(), x: 0, y: Number(band[1]), w: width, h: Number(band[2]) - Number(band[1]) };
    const [x, y, w, h] = parseNumbers(m[2]!, 4, `section "${s}"`) as [number, number, number, number];
    return { name: m[1]!.trim(), x, y, w, h };
  });
}

/**
 * Full-width bands at the boxes of the node's visible children, top to bottom. A child taller than
 * half the node is a wrapper, not a section: its own children take its place.
 */
function childSections(root: any, width: number, height: number): Section[] {
  const b = root.absoluteBoundingBox;
  const shown = (n: any) => (n.children ?? []).filter((c: any) => c.visible !== false && c.absoluteBoundingBox);
  const expand = (n: any): any[] =>
    shown(n).flatMap((c: any) => (c.absoluteBoundingBox.height > height / 2 && shown(c).length ? expand(c) : [c]));
  const kids = b ? expand(root) : [];
  if (!kids.length) return [{ name: "whole", x: 0, y: 0, w: width, h: height }];
  const seen = new Map<string, number>();
  return kids
    .map((c: any) => {
      const top = Math.max(0, Math.round(c.absoluteBoundingBox.y - b.y));
      const bottom = Math.min(height, Math.round(c.absoluteBoundingBox.y - b.y + c.absoluteBoundingBox.height));
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      return { name: n > 1 ? `${c.name} ${n}` : String(c.name), x: 0, y: top, w: width, h: bottom - top };
    })
    .filter((s: Section) => s.h > 0)
    .sort((a: Section, z: Section) => a.y - z.y);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Share of differing pixels (in %) and mean channel difference over a rect, with the capture shifted by dx,dy. */
function measure(ref: Uint8Array, cap: Uint8Array, W: number, H: number, r: Rect, dx: number, dy: number, threshold: number, mask?: Uint8Array) {
  let n = 0, diff = 0, sum = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const cy = y + dy;
    if (cy < 0 || cy >= H) continue;
    for (let x = r.x; x < r.x + r.w; x++) {
      const cx = x + dx;
      if (cx < 0 || cx >= W) continue;
      const i = (y * W + x) * 3, j = (cy * W + cx) * 3;
      const a = Math.abs(ref[i]! - cap[j]!), b = Math.abs(ref[i + 1]! - cap[j + 1]!), c = Math.abs(ref[i + 2]! - cap[j + 2]!);
      n++;
      sum += a + b + c;
      if (Math.max(a, b, c) > threshold) {
        diff++;
        if (mask) mask[y * W + x] = 1;
      }
    }
  }
  return { differing: n ? (100 * diff) / n : 0, mean: n ? sum / (3 * n) : 0 };
}

export async function compare(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, {
    value: ["width", "crop", "sections", "band", "shift", "threshold", "wide", "wait", "out", "nodes", "node"],
    bool: ["help", "full", "apply-css"],
    alias: { h: "help", o: "out" },
  });
  if (flags.help || positionals.length < 2) showHelp("compare");
  const [refPath, page] = positionals as [string, string];
  const applyTo = flags["apply-css"] ? localHtml(page) : undefined;
  if (flags["apply-css"] && !flags.nodes) fail(EXIT_USAGE, "--apply-css needs --nodes <node file>: the css lines come from the text styles it measures.");
  let ref = readPng(resolve(refPath), "reference image");
  let cropAt = { x: 0, y: 0 };
  if (flags.crop) {
    const [x, y, w, h] = parseNumbers(str(flags.crop)!, 4, "--crop");
    ref = crop(ref, { x: x!, y: y!, w: w!, h: h! });
    cropAt = { x: x!, y: y! };
  }
  // The design's nodes, for per-node measurement: a file saved by `node`, and the rendered node.
  let root: any = null;
  if (flags.nodes) {
    const file = resolve(str(flags.nodes)!);
    if (!existsSync(file)) fail(EXIT_USAGE, `No such node file: ${file}`);
    const body = readData(file);
    const want = str(flags.node)?.replace(/-/g, ":");
    const search = (n: any): any => (n.id === want ? n : (n.children ?? []).reduce((hit: any, c: any) => hit ?? search(c), null));
    const docs = Object.values(body.nodes ?? {}).map((v: any) => v?.document).filter(Boolean);
    root = want ? docs.reduce((hit: any, d: any) => hit ?? search(d), null) : docs[0];
    if (!root) fail(EXIT_USAGE, want ? `Node ${want} is not in ${file}.` : `${file} holds no node; save one with \`node <key> <id> -o <file>\`.`);
  }
  // The node's own shadow or blur grows its render past its box; the page has only the box.
  let autoCrop: string | undefined;
  if (root && !flags.crop) {
    const e = exportBounds(root), b = root.absoluteBoundingBox;
    if (e && b && [b.x - e.x, b.y - e.y, e.w - b.width, e.h - b.height].some((d) => Math.abs(d) > 0.5)) {
      const s0 = Math.round((ref.width / e.w) * 4) / 4 || ref.width / e.w; // render scales are round numbers
      const r = { x: Math.round((b.x - e.x) * s0), y: Math.round((b.y - e.y) * s0), w: Math.round(b.width * s0), h: Math.round(b.height * s0) };
      r.w = Math.min(r.w, ref.width - r.x);
      r.h = Math.min(r.h, ref.height - r.y);
      ref = crop(ref, r);
      cropAt = { x: r.x, y: r.y };
      autoCrop = `${r.x},${r.y},${r.w},${r.h}: the reference was cropped to the node's box, which its own shadow or blur had widened`;
    }
  }
  const cssWidth = Number(str(flags.width) ?? ref.width);
  const scale = ref.width / cssWidth;
  if (!(cssWidth > 0) || !(scale > 0)) fail(EXIT_USAGE, "--width must be a positive number of CSS pixels.");
  const cssHeight = Math.round(ref.height / scale);
  const threshold = Number(str(flags.threshold) ?? 24);
  const maxShift = Number(str(flags.shift) ?? 3);
  const waitMs = Number(str(flags.wait) ?? 8000);
  const dir = resolve(str(flags.out) ?? join(process.cwd(), "_swe", "figma-access", "compare"));
  mkdirSync(dir, { recursive: true });

  let cap: Image;
  let capPath: string;
  if (/\.png$/i.test(page) && !/^https?:/.test(page)) {
    capPath = resolve(page);
    cap = readPng(capPath, "capture");
  } else {
    capPath = join(dir, `capture-${cssWidth}.png`);
    rmSync(capPath, { force: true });
    cap = await capture(page, cssWidth, cssHeight, scale, waitMs, capPath);
  }
  if (cap.width < ref.width || cap.height < ref.height) {
    fail(EXIT_FAILED, `The capture is ${cap.width}x${cap.height}, smaller than the reference ${ref.width}x${ref.height}.`, {
      hint: "Capture at the reference's size, or pass --width when the reference was rendered at another scale.",
    });
  }
  cap = crop(cap, { x: 0, y: 0, w: ref.width, h: ref.height });

  const W = ref.width, H = ref.height;
  const refRgb = flatten(ref), capRgb = flatten(cap);
  const sections = flags.sections
    ? parseSections(str(flags.sections)!, cssWidth)
    : root && !flags.band
    ? childSections(root, cssWidth, cssHeight)
    : (() => {
        const band = Number(str(flags.band) ?? 100);
        const list: Section[] = [];
        for (let y = 0; y < cssHeight; y += band) list.push({ name: `${y}-${Math.min(y + band, cssHeight)}`, x: 0, y, w: cssWidth, h: Math.min(band, cssHeight - y) });
        return list;
      })();

  const mask = new Uint8Array(W * H);
  const whole = measure(refRgb, capRgb, W, H, { x: 0, y: 0, w: W, h: H }, 0, 0, threshold, mask);
  const results = sections.map((s) => {
    const r = { x: Math.round(s.x * scale), y: Math.round(s.y * scale), w: Math.round(s.w * scale), h: Math.round(s.h * scale) };
    if (r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) {
      fail(EXIT_USAGE, `Section "${s.name}" (${s.x},${s.y},${s.w},${s.h}) falls outside the ${cssWidth}x${cssHeight} page.`);
    }
    const base = measure(refRgb, capRgb, W, H, r, 0, 0, threshold);
    const entry: Record<string, unknown> = { name: s.name, box: [s.x, s.y, s.w, s.h], differing: r2(base.differing), mean: r2(base.mean) };
    let best = { dx: 0, dy: 0, differing: base.differing };
    const step = Math.max(1, Math.round(scale));
    for (let dy = -maxShift * step; dy <= maxShift * step; dy += step) {
      for (let dx = -maxShift * step; dx <= maxShift * step; dx += step) {
        if (!dx && !dy) continue;
        const m = measure(refRgb, capRgb, W, H, r, dx, dy, threshold);
        if (m.differing < best.differing) best = { dx, dy, differing: m.differing };
      }
    }
    if (best.differing < base.differing * 0.5 && base.differing > 0.5) {
      // The capture's content sits at (x+dx, y+dy): it is dx right / dy down of where the design has it.
      const dxCss = r2(best.dx / scale), dyCss = r2(best.dy / scale);
      entry.shift = { dx: dxCss, dy: dyCss, differing: r2(best.differing) };
      entry.hint = `Matches when shifted: the page draws it ${Math.abs(dxCss) ? `${Math.abs(dxCss)} px ${dxCss > 0 ? "right" : "left"}` : ""}${Math.abs(dxCss) && Math.abs(dyCss) ? " and " : ""}${Math.abs(dyCss) ? `${Math.abs(dyCss)} px ${dyCss > 0 ? "lower" : "higher"}` : ""}. Fix the size of what lies before it, not the section.`;
    }
    return entry;
  });

  // Difference image: the reference faded, with differing pixels in red.
  const diffImg: Image = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  for (let i = 0; i < W * H; i++) {
    const o = i * 4, s = i * 3;
    if (mask[i]) diffImg.data.set([230, 0, 0, 255], o);
    else for (let k = 0; k < 3; k++) diffImg.data[o + k] = 255 - Math.round((255 - refRgb[s + k]!) * 0.3);
    diffImg.data[o + 3] = 255;
  }
  const diffPath = join(dir, "diff.png");
  writeFileSync(diffPath, encodePng(diffImg));

  const report: Record<string, unknown> = {
    ok: true,
    reference: resolve(refPath),
    capture: capPath,
    diff: diffPath,
    page: [cssWidth, cssHeight],
    scale: r2(scale),
    threshold,
    ...(autoCrop ? { crop: autoCrop } : {}),
    whole: { differing: r2(whole.differing), mean: r2(whole.mean) },
    sections: results,
    worst: [...results].sort((a, b) => (b.differing as number) - (a.differing as number))[0]?.name,
  };

  if (root) {
    const o = renderOrigin(root);
    const origin = { x: o.x + cropAt.x / scale, y: o.y + cropAt.y / scale };
    const measured = measureNodes(root, origin, refRgb, capRgb, W, H, scale, threshold);
    const off = offNodes(measured);
    // A style whose copies all sit off by the same small amount: one rule on the class that
    // \`spec --html\` gives every text of that style moves them all.
    const block = slug(root.name) || "page";
    const styles = styleSummary(measured).map((st: any) => {
      if (!String(st.hint ?? "").startsWith("Every copy")) return st;
      const dx = Math.abs(st.dx) >= 0.5 ? -st.dx : 0;
      return { ...st, css: `.${block}__text--${slug(st.style)} { translate: ${r2(dx)}px ${r2(-st.dy)}px; }` };
    });
    if (applyTo) report.applied = applyCss(applyTo, styles);
    report.nodes = {
      root: root.id,
      measured: measured.length,
      off: off.length,
      styles,
      list: off.slice(0, 40),
      ...(off.length > 40 ? { more: `${off.length - 40} more nodes are off; fix the styles and sections above first, then compare again.` } : {}),
    };
  }

  if (flags.wide) {
    const wide = Number(str(flags.wide));
    if (!(wide > cssWidth)) fail(EXIT_USAGE, `--wide is a wider window to try the page in: give more than the page width ${cssWidth}, e.g. --wide ${Math.round(cssWidth * 4 / 3)}.`);
    if (/\.png$/i.test(page) && !/^https?:/.test(page)) fail(EXIT_USAGE, "--wide needs a page to capture, not a PNG.");
    const widePath = join(dir, `capture-${wide}.png`);
    rmSync(widePath, { force: true });
    const wideImg = await capture(page, wide, cssHeight, scale, waitMs, widePath);
    const at = (x: number) => flatten(crop(wideImg, { x, y: 0, w: W, h: H }));
    const centred = measure(refRgb, at(Math.round(((wide - cssWidth) / 2) * scale)), W, H, { x: 0, y: 0, w: W, h: H }, 0, 0, threshold);
    const left = measure(refRgb, at(0), W, H, { x: 0, y: 0, w: W, h: H }, 0, 0, threshold);
    // Full-width backgrounds reach the window's edges: the outermost columns of the wide capture
    // should look like the design's outermost columns. They hold flat colour, so a tight threshold
    // also catches near-white backgrounds that stop short.
    const EDGE_THRESHOLD = 3;
    const WW = wideImg.width;
    const wideRgb = flatten(wideImg);
    // Only rows where the design's edge is flat for a stretch inward count: a decoration that
    // touches the frame's edge is content, and stays with the centred column.
    const FLAT = Math.min(32, Math.floor(W / 4));
    const near = (a: Uint8Array, i: number, b: Uint8Array, j: number) =>
      Math.max(Math.abs(a[i]! - b[j]!), Math.abs(a[i + 1]! - b[j + 1]!), Math.abs(a[i + 2]! - b[j + 2]!)) <= EDGE_THRESHOLD;
    let edgeDiff = 0, edgeRows = 0;
    for (let y = 0; y < H; y++) {
      for (const [rx, wx, step] of [[0, 0, 1], [W - 1, WW - 1, -1]] as const) {
        const i = (y * W + rx) * 3, j = (y * WW + wx) * 3;
        let flat = true;
        for (let k = 1; k < FLAT && flat; k++) flat = near(refRgb, i, refRgb, i + k * step * 3);
        if (!flat) continue;
        edgeRows++;
        if (!near(refRgb, i, wideRgb, j)) edgeDiff++;
      }
    }
    const edge = edgeRows ? (100 * edgeDiff) / edgeRows : 0;
    const w: Record<string, unknown> = {
      width: wide, capture: widePath,
      centredDiffering: r2(centred.differing), leftDiffering: r2(left.differing), edgeDiffering: r2(edge),
    };
    const hints: string[] = [];
    if (left.differing < centred.differing) hints.push("The content stays at the left edge of a wider window. Centre the content column (margin: 0 auto) unless the user asked for a fixed width.");
    if (edge > 2) hints.push(`The window's edges differ from the design's edges in ${r2(edge)}% of rows: backgrounds, bars or dividers stop short of the window. Let them span its full width.`);
    w.hint = hints.length ? hints.join(" ") : "The content stays centred and the backgrounds reach the window's edges.";
    report.wide = w;
  }
  // The full report goes to a file; the summary on stdout is what to act on first.
  const reportPath = join(dir, "report.kdl");
  report.report = reportPath;
  writeData(reportPath, report);
  if (flags.full || !report.nodes) return out(report);
  const nodes = report.nodes as any;
  // Styles with a ready fix first, by how many texts it moves; then the rest by how far off they are.
  const styleRank = (st: any) => (st.css ? 1e6 + st.count : 0) + (st.hint ? 1000 : 0) + Math.abs(st.dy) + Math.abs((st.widthRatio ?? 1) - 1) * 20;
  out({
    ...report,
    nodes: {
      root: nodes.root,
      measured: nodes.measured,
      off: nodes.off,
      styles: [...nodes.styles].sort((a: any, b: any) => styleRank(b) - styleRank(a)).slice(0, 12),
      list: nodes.list.slice(0, 10),
      more: `${Math.max(0, nodes.styles.length - 12)} more styles and ${Math.max(0, nodes.off - 10)} more nodes in ${reportPath} (or pass --full).`,
    },
  });
}

/** The local HTML file `--apply-css` may write to. */
function localHtml(page: string): string {
  const file = page.startsWith("file://") ? decodeURIComponent(new URL(page).pathname) : page;
  if (/^https?:/.test(page) || !/\.html?$/i.test(file) || !existsSync(file)) {
    fail(EXIT_USAGE, `--apply-css writes into the page, so the page must be a local .html file; ${page} is not one.`);
  }
  return resolve(file);
}

const CSS_ID = "figma-access-css";
const CSS_LINE = /^\.([\w-]+) \{ translate: (-?[\d.]+)px (-?[\d.]+)px; \}$/;

/**
 * Writes the per-style text offsets into the page, in one style block that later runs update.
 * Each run measures the page with the earlier offsets in place, so a new offset adds to the old one.
 * Styles whose text is much wider or narrower are left out: their font is not the design's yet.
 */
export function applyCss(file: string, styles: any[]) {
  const html = readFileSync(file, "utf8");
  const block = new RegExp(`<style id="${CSS_ID}">([\\s\\S]*?)</style>\\n?`);
  const have = new Map<string, [number, number]>();
  for (const line of (block.exec(html)?.[1] ?? "").split("\n")) {
    const m = CSS_LINE.exec(line.trim());
    if (m) have.set(m[1]!, [Number(m[2]), Number(m[3])]);
  }
  const changed: string[] = [], skipped: string[] = [];
  for (const st of styles) {
    if (!st.css) continue;
    const m = CSS_LINE.exec(st.css);
    if (!m) continue;
    if (Math.abs((st.widthRatio ?? 1) - 1) > 0.05) {
      skipped.push(`${st.style} (widthRatio ${st.widthRatio})`);
      continue;
    }
    const [x, y] = have.get(m[1]!) ?? [0, 0];
    have.set(m[1]!, [r2(x + Number(m[2])), r2(y + Number(m[3]))]);
    changed.push(st.style);
  }
  const lines = [...have.entries()].map(([cls, [x, y]]) => `.${cls} { translate: ${x}px ${y}px; }`);
  const css = `<style id="${CSS_ID}">\n/* Text offsets measured by \`figma-access compare --apply-css\`; later runs update this block. */\n${lines.join("\n")}\n</style>\n`;
  const next = block.test(html) ? html.replace(block, css) : html.includes("</head>") ? html.replace("</head>", `${css}</head>`) : css + html;
  if (changed.length) writeFileSync(file, next);
  const result: Record<string, unknown> = { file, styles: changed.length, rules: lines.length };
  if (skipped.length) result.skipped = `${skipped.join(", ")}: the text is much wider or narrower than the design's, so its font, weight or letter spacing does not match yet. Fix that, then compare again.`;
  result.next = changed.length ? "Compare again to measure the page with these offsets." : "No style had a fix to apply.";
  return result;
}
