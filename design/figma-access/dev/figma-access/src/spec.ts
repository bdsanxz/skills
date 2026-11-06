// `spec`: a compact, CSS-oriented outline of the visible tree under a node, one line per node.
// Built for design-to-code work: the full node JSON is megabytes, this is what code needs.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { EXIT_USAGE } from "./config";
import { showHelp } from "./help";
import { getJson, parseTarget } from "./rest";
import { fail, out, parseArgs, readData, str } from "./util";

const r2 = (n: number) => Math.round(n * 100) / 100;
const hex2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");

export function color(c: { r: number; g: number; b: number; a?: number }, opacity = 1): string {
  const a = (c.a ?? 1) * opacity;
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase();
  return a >= 0.999 ? base : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${r2(a)})`;
}

type Pt = { x: number; y: number };
export interface Size {
  w: number;
  h: number;
}

// Handles are fractions of the node's box; with the box size they become pixels, which is what
// an angle or a radius needs on a box that is not square.
function gradientAngle(handles: Pt[] | undefined, size: Size): number | null {
  if (!handles || handles.length < 2) return null;
  const [a, b] = handles as [Pt, Pt];
  // CSS angle: 0deg points up, clockwise.
  return Math.round(((Math.atan2((b.y - a.y) * size.h, (b.x - a.x) * size.w) * 180) / Math.PI + 90 + 360) % 360);
}

// Figma maps the box onto gradient space with an affine transform: handle 0 is where the gradient
// starts, handle 1 where it ends, and handle 2 sets the direction of the lines of equal colour
// (they run parallel to handle 0 → handle 2). Those lines are not always perpendicular to
// handle 0 → handle 1: a gradient drawn on a non-square box, or skewed in the editor, slants them.
// CSS draws a linear gradient perpendicular to its angle along a line through the box centre whose
// length makes the corners hit 0% and 100%, so the angle comes from the equal-colour lines and every
// stop is projected onto that line.
function linearGradient(p: any, size: Size, op: number): string | null {
  const h = p.gradientHandlePositions as Pt[] | undefined;
  if (!h || h.length < 2) return null;
  const px = (q: Pt) => ({ x: q.x * size.w, y: q.y * size.h });
  const p0 = px(h[0]!);
  const p1 = px(h[1]!);
  const v1 = { x: p1.x - p0.x, y: p1.y - p0.y };
  if (Math.hypot(v1.x, v1.y) < 1e-9) return null;
  let n = v1;
  if (h[2]) {
    const p2 = px(h[2]);
    const v2 = { x: p2.x - p0.x, y: p2.y - p0.y };
    const perp = { x: -v2.y, y: v2.x };
    const along = perp.x * v1.x + perp.y * v1.y;
    if (Math.hypot(v2.x, v2.y) > 1e-9 && Math.abs(along) > 1e-9) n = along > 0 ? perp : { x: -perp.x, y: -perp.y };
  }
  // CSS angle: 0deg points up, clockwise.
  const angle = Math.round(((Math.atan2(n.y, n.x) * 180) / Math.PI + 90 + 360) % 360) % 360;
  const rad = (angle * Math.PI) / 180;
  const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
  const L = Math.abs(size.w * dir.x) + Math.abs(size.h * dir.y);
  const start = ((p0.x - size.w / 2) * dir.x + (p0.y - size.h / 2) * dir.y + L / 2) / L;
  const span = (v1.x * dir.x + v1.y * dir.y) / L;
  const stops = (p.gradientStops ?? [])
    .map((s: any) => `${color(s.color, op)} ${r2((start + s.position * span) * 100)}%`)
    .join(", ");
  return `linear-gradient(${angle}deg, ${stops})`;
}

// Figma radial and diamond gradients: handle 0 is the centre, handles 1 and 2 end the two radii.
// CSS has no rotated ellipse, so the radii are written unrotated.
function gradientShape(handles: Pt[] | undefined, size: Size): string {
  if (!handles || handles.length < 3) return "";
  const [c, a, b] = handles as [Pt, Pt, Pt];
  const len = (p: Pt) => r2(Math.hypot((p.x - c.x) * size.w, (p.y - c.y) * size.h));
  return `${len(a)}px ${len(b)}px at ${r2(c.x * size.w)}px ${r2(c.y * size.h)}px, `;
}

export function paint(p: any, size: Size = { w: 1, h: 1 }): string | null {
  if (p.visible === false) return null;
  const op = p.opacity ?? 1;
  switch (p.type) {
    case "SOLID":
      return color(p.color, op);
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND": {
      const stops = (p.gradientStops ?? []).map((s: any) => `${color(s.color, op)} ${Math.round(s.position * 100)}%`).join(", ");
      if (p.type === "GRADIENT_LINEAR") return linearGradient(p, size, op) ?? `linear-gradient(180deg, ${stops})`;
      if (p.type === "GRADIENT_RADIAL") return `radial-gradient(${gradientShape(p.gradientHandlePositions, size)}${stops})`;
      if (p.type === "GRADIENT_ANGULAR") {
        const h = p.gradientHandlePositions as Pt[] | undefined;
        const at = h?.[0] ? `from ${gradientAngle(h, size) ?? 0}deg at ${r2(h[0].x * size.w)}px ${r2(h[0].y * size.h)}px, ` : "";
        return `conic-gradient(${at}${stops})`;
      }
      return `diamond-gradient(${gradientShape(p.gradientHandlePositions, size)}${stops})`;
    }
    case "IMAGE":
      return `image(${p.imageRef}, ${p.scaleMode ?? "FILL"}${op < 1 ? `, opacity ${r2(op)}` : ""})`;
    default:
      return p.type.toLowerCase();
  }
}

function effects(n: any): string[] {
  const outList: string[] = [];
  for (const e of n.effects ?? []) {
    if (e.visible === false) continue;
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      outList.push(`${e.type === "INNER_SHADOW" ? "inset-" : ""}shadow(${r2(e.offset?.x ?? 0)} ${r2(e.offset?.y ?? 0)} ${r2(e.radius ?? 0)} ${r2(e.spread ?? 0)} ${color(e.color)})`);
    } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
      outList.push(`${e.type === "LAYER_BLUR" ? "blur" : "backdrop-blur"}(${r2(e.radius ?? 0)})`);
    }
  }
  return outList;
}

function layout(n: any): string[] {
  const parts: string[] = [];
  if (n.layoutMode && n.layoutMode !== "NONE") {
    parts.push(`flex-${n.layoutMode === "HORIZONTAL" ? "row" : "col"}${n.layoutWrap === "WRAP" ? " wrap" : ""}`);
    if (n.itemSpacing) parts.push(`gap ${r2(n.itemSpacing)}`);
    const pad = [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0].map(r2);
    if (pad.some((v) => v)) parts.push(`pad ${pad.join(" ")}`);
    if (n.primaryAxisAlignItems && n.primaryAxisAlignItems !== "MIN") parts.push(`justify ${n.primaryAxisAlignItems.toLowerCase()}`);
    if (n.counterAxisAlignItems && n.counterAxisAlignItems !== "MIN") parts.push(`align ${n.counterAxisAlignItems.toLowerCase()}`);
  }
  const sizing = [n.layoutSizingHorizontal, n.layoutSizingVertical];
  if (sizing.some((s) => s && s !== "FIXED")) parts.push(`size ${sizing.map((s) => (s ?? "FIXED").toLowerCase()).join("/")}`);
  if (n.layoutPositioning === "ABSOLUTE") parts.push("absolute");
  return parts;
}

// The REST API returns the boxes Figma last stored. After a child was hidden or an instance was
// overridden, an auto layout frame's stored boxes can disagree with its own rules, and the render
// then differs from the boxes. Returns what disagrees, or null.
export function layoutDrift(n: any): string | null {
  if (!n.layoutMode || n.layoutMode === "NONE" || !n.absoluteBoundingBox) return null;
  const row = n.layoutMode === "HORIZONTAL";
  const kids = (n.children ?? []).filter(
    (c: any) => c.visible !== false && c.layoutPositioning !== "ABSOLUTE" && c.absoluteBoundingBox && !c.rotation,
  );
  if (!kids.length || n.layoutWrap === "WRAP") return null;
  const pos = (b: any) => (row ? b.x : b.y);
  const len = (b: any) => (row ? b.width : b.height);
  const gap = n.itemSpacing ?? 0;
  const between = n.primaryAxisAlignItems === "SPACE_BETWEEN";
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1].absoluteBoundingBox;
    const b = kids[i].absoluteBoundingBox;
    const got = pos(b) - (pos(a) + len(a));
    if (!between && Math.abs(got - gap) > 1) return `${JSON.stringify(kids[i].name)} is ${r2(got)} after the previous item, gap is ${r2(gap)}`;
  }
  const hug = (row ? n.layoutSizingHorizontal : n.layoutSizingVertical) === "HUG";
  if (hug && !between) {
    const pads = row ? (n.paddingLeft ?? 0) + (n.paddingRight ?? 0) : (n.paddingTop ?? 0) + (n.paddingBottom ?? 0);
    const need = pads + kids.reduce((t: number, c: any) => t + len(c.absoluteBoundingBox), 0) + gap * (kids.length - 1);
    const has = len(n.absoluteBoundingBox);
    if (Math.abs(need - has) > 1) return `hugs ${r2(has)} but its stored items add up to ${r2(need)}`;
  }
  // A child set to fill takes the frame's inner size; a stored box that differs is stale.
  const cross = (b: any) => (row ? b.height : b.width);
  const inner = cross(n.absoluteBoundingBox) - (row ? (n.paddingTop ?? 0) + (n.paddingBottom ?? 0) : (n.paddingLeft ?? 0) + (n.paddingRight ?? 0));
  for (const c of kids) {
    const fills = (row ? c.layoutSizingVertical : c.layoutSizingHorizontal) === "FILL" || c.layoutAlign === "STRETCH";
    const got = cross(c.absoluteBoundingBox);
    if (fills && Math.abs(got - inner) > 1) return `${JSON.stringify(c.name)} fills ${r2(inner)} but is stored ${r2(got)} ${row ? "high" : "wide"}`;
  }
  return null;
}

export function textInfo(n: any): string[] {
  const s = n.style ?? {};
  const parts = [`"${String(n.characters ?? "").replace(/[\n\u2028\u2029]/g, "\\n").slice(0, 300)}"`];
  const lh = s.lineHeightPx ? `/${r2(s.lineHeightPx)}` : "";
  parts.push(`font ${s.fontFamily} ${s.fontWeight} ${r2(s.fontSize)}${lh}`);
  if (s.italic) parts.push("italic");
  if (s.letterSpacing) parts.push(`ls ${r2(s.letterSpacing)}`);
  if (s.textAlignHorizontal && s.textAlignHorizontal !== "LEFT") parts.push(`text-${s.textAlignHorizontal.toLowerCase()}`);
  if (s.textCase && s.textCase !== "ORIGINAL") parts.push(`case ${s.textCase.toLowerCase()}`);
  if (s.textDecoration && s.textDecoration !== "NONE") parts.push(s.textDecoration.toLowerCase());
  if (s.textAutoResize) parts.push(`resize ${s.textAutoResize.toLowerCase()}`);
  // A fixed-height text box may be taller than its lines; then the vertical alignment places them.
  const fixedHeight = s.textAutoResize !== "HEIGHT" && s.textAutoResize !== "WIDTH_AND_HEIGHT";
  if (fixedHeight && s.textAlignVertical && s.textAlignVertical !== "TOP") parts.push(`valign ${s.textAlignVertical.toLowerCase()}`);
  const runs = textRuns(n);
  if (runs) parts.push(runs);
  return parts;
}

// Text with mixed styles: list each run with what differs from the node's base style.
function textRuns(n: any): string | null {
  const table = n.styleOverrideTable ?? {};
  const ids: number[] = n.characterStyleOverrides ?? [];
  if (!Object.keys(table).length || !ids.length) return null;
  const chars: string[] = Array.from(String(n.characters ?? ""));
  const runs: { id: number; text: string }[] = [];
  chars.forEach((ch, i) => {
    const id = ids[i] ?? 0;
    const last = runs[runs.length - 1];
    if (last && last.id === id) last.text += ch;
    else runs.push({ id, text: ch });
  });
  const describe = (id: number) => {
    const o = table[id];
    if (!id || !o) return "base";
    const d: string[] = [];
    if (o.fontFamily || o.fontWeight || o.fontSize) d.push(`font ${o.fontFamily ?? "base"} ${o.fontWeight ?? ""} ${o.fontSize ?? ""}${o.lineHeightPx ? `/${r2(o.lineHeightPx)}` : ""}`.replace(/\s+/g, " ").trim());
    if (o.fills?.length) d.push(`color ${o.fills.map(paint).filter(Boolean).join(" + ")}`);
    if (o.textDecoration && o.textDecoration !== "NONE") d.push(o.textDecoration.toLowerCase());
    if (o.italic) d.push("italic");
    if (o.letterSpacing) d.push(`ls ${r2(o.letterSpacing)}`);
    return d.join(" ") || "base";
  };
  return `runs[ ${runs.map((r) => `${JSON.stringify(r.text)}: ${describe(r.id)}`).join(" | ")} ]`;
}

interface Ctx {
  ox: number;
  oy: number;
  lines: string[];
  maxDepth: number;
  icons: number;
}

// Nodes that are only vectors underneath are icons or illustrations: one line, export them whole.
export function vectorOnly(n: any): boolean {
  if (["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "ELLIPSE", "POLYGON", "REGULAR_POLYGON"].includes(n.type)) return true;
  if (n.type === "TEXT") return false;
  if ((n.fills ?? []).some((f: any) => f.type === "IMAGE" && f.visible !== false)) return false;
  const kids = (n.children ?? []).filter((c: any) => c.visible !== false);
  return kids.length > 0 && kids.every(vectorOnly);
}

function walk(n: any, depth: number, ctx: Ctx) {
  if (n.visible === false) return;
  const b = n.absoluteBoundingBox;
  const parts: string[] = [n.type, JSON.stringify(n.name), n.id];
  if (b) parts.push(`[${r2(b.x - ctx.ox)},${r2(b.y - ctx.oy)} ${r2(b.width)}x${r2(b.height)}]`);
  // Exports (render) use the render bounds: shadows grow them, masks and clips shrink them.
  const rb = n.absoluteRenderBounds;
  if (b && rb && [rb.x - b.x, rb.y - b.y, rb.width - b.width, rb.height - b.height].some((d) => Math.abs(d) > 0.5)) {
    parts.push(`render[${r2(rb.x - ctx.ox)},${r2(rb.y - ctx.oy)} ${r2(rb.width)}x${r2(rb.height)}]`);
  }
  if (n.rotation && Math.abs(n.rotation) > 0.01) parts.push(`rot ${r2((-n.rotation * 180) / Math.PI)}deg`);
  if (n.opacity !== undefined && n.opacity < 1) parts.push(`opacity ${r2(n.opacity)}`);
  if (n.blendMode && !["PASS_THROUGH", "NORMAL"].includes(n.blendMode)) parts.push(`blend ${n.blendMode.toLowerCase()}`);
  if (n.isMask) parts.push("MASK");
  if (n.clipsContent) parts.push("clip");
  if (n.componentId) parts.push(`component ${n.componentId}`);
  const icon = n.type !== "TEXT" && depth > 0 && vectorOnly(n);
  // A mask only renders right as a whole: export the masked node, never rebuild its parts.
  const masked = !icon && depth > 0 && (n.children ?? []).some((c: any) => c.visible !== false && c.isMask);
  if (n.type === "TEXT") parts.push(...textInfo(n));
  const size = { w: n.size?.x ?? n.absoluteBoundingBox?.width ?? 1, h: n.size?.y ?? n.absoluteBoundingBox?.height ?? 1 };
  // Figma lists fills bottom first; CSS backgrounds list the top layer first.
  const fills = (n.fills ?? []).map((p: any) => paint(p, size)).filter(Boolean).reverse();
  if (fills.length) parts.push(`${n.type === "TEXT" ? "color" : "bg"} ${fills.join(", ")}`);
  const strokes = (n.strokes ?? []).map((p: any) => paint(p, size)).filter(Boolean);
  if (strokes.length && n.strokeWeight) {
    const sides = n.individualStrokeWeights;
    const w = sides ? `${sides.top} ${sides.right} ${sides.bottom} ${sides.left}` : r2(n.strokeWeight);
    parts.push(`border ${w} ${(n.strokeAlign ?? "INSIDE").toLowerCase()} ${strokes.join(" + ")}${n.strokeDashes?.length ? " dashed" : ""}`);
  }
  if (n.rectangleCornerRadii) parts.push(`radius ${n.rectangleCornerRadii.map(r2).join(" ")}`);
  else if (n.cornerRadius) parts.push(`radius ${r2(n.cornerRadius)}`);
  parts.push(...effects(n), ...layout(n));
  const drift = layoutDrift(n);
  if (drift) parts.push(`LAYOUT DRIFT (${drift}) → trust the render`);
  if (icon || masked) {
    const e = exportBounds(n);
    if (e && b && [e.x - b.x, e.y - b.y, e.w - b.width, e.h - b.height].some((d) => Math.abs(d) > 0.5)) {
      parts.push(`export[${r2(e.x - ctx.ox)},${r2(e.y - ctx.oy)} ${r2(e.w)}x${r2(e.h)}]`);
    }
  }
  if (icon) {
    parts.push("ICON → render as svg");
    ctx.icons++;
  }
  if (masked) {
    parts.push("MASKED → render as svg or png");
    ctx.icons++;
  }
  ctx.lines.push("  ".repeat(depth) + parts.join(" "));
  if (icon || masked) return;
  const kids = (n.children ?? []).filter((c: any) => c.visible !== false);
  if (depth >= ctx.maxDepth) {
    if (kids.length) ctx.lines.push("  ".repeat(depth + 1) + `… ${kids.length} children (raise --depth or run spec on ${n.id})`);
    return;
  }
  for (const c of kids) walk(c, depth + 1, ctx);
}

function findNode(nodes: Record<string, any> | undefined, id: string): any {
  const search = (n: any): any => (n.id === id ? n : (n.children ?? []).reduce((hit: any, c: any) => hit ?? search(c), null));
  for (const v of Object.values(nodes ?? {})) {
    const hit = v?.document && search(v.document);
    if (hit) return hit;
  }
  return null;
}

export async function spec(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, { value: ["depth", "out", "origin", "from"], bool: ["help", "refresh"], alias: { h: "help", o: "out" } });
  if (flags.help || !positionals[0]) showHelp("spec");
  const target = parseTarget(positionals[0]!);
  const ids = positionals.slice(1).map((i) => i.replace(/-/g, ":"));
  if (!ids.length && target.nodeId) ids.push(target.nodeId);
  if (!ids.length) fail(EXIT_USAGE, "Name the node: a URL with node-id, or node ids after the file.");
  let body: any;
  const fromFile = str(flags.from);
  if (fromFile) {
    if (!existsSync(fromFile)) fail(EXIT_USAGE, `File not found: ${fromFile}`);
    body = readData(fromFile);
  } else {
    body = await getJson(`/v1/files/${target.fileKey}/nodes?${new URLSearchParams({ ids: ids.join(",") })}`, { cache: true, refresh: !!flags.refresh });
  }
  const maxDepth = Number(str(flags.depth) ?? 99);
  const lines: string[] = [];
  let icons = 0;
  let originRoot: { x: number; y: number } | null = null;
  if (flags.origin) {
    const o = /^(-?[\d.]+),(-?[\d.]+)$/.exec(String(flags.origin));
    if (!o) fail(EXIT_USAGE, "--origin takes x,y, e.g. --origin 0,80");
    originRoot = { x: Number(o[1]), y: Number(o[2]) };
  }
  for (const id of ids) {
    // A saved `node` file may hold the node itself or an ancestor of it.
    const doc = body.nodes?.[id]?.document ?? findNode(body.nodes, id);
    if (!doc) {
      lines.push(`# ${id}: not found`);
      continue;
    }
    const b = doc.absoluteBoundingBox ?? { x: 0, y: 0 };
    const ctx: Ctx = { ox: originRoot?.x ?? b.x, oy: originRoot?.y ?? b.y, lines, maxDepth, icons: 0 };
    lines.push(`# ${doc.name} (${id}); boxes are [x,y wxh] relative to ${originRoot ? `canvas point ${originRoot.x},${originRoot.y}` : "this node"}`);
    walk(doc, 0, ctx);
    icons += ctx.icons;
  }
  const text = lines.join("\n") + "\n";
  const outPath = str(flags.out);
  if (outPath) {
    const p = resolve(outPath);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    out({ ok: true, path: p, lines: lines.length, icons });
  } else {
    process.stdout.write(text);
  }
}

// ---------------------------------------------------------------------------
// Export bounds: the area an exported image of a node covers. Figma grows it by the node's own
// and its descendants' effects (blur, shadow) and outside strokes, shrinks it to masks and to
// clipping frames inside the node, and ignores clipping by ancestors.
// ---------------------------------------------------------------------------
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const union = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

const intersect = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

function grow(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

function withEffects(n: any, r: Rect): Rect {
  let out = r;
  const strokes = (n.strokes ?? []).some((s: any) => s.visible !== false) && n.strokeWeight;
  if (strokes && n.strokeAlign === "OUTSIDE") out = grow(out, n.strokeWeight);
  else if (strokes && n.strokeAlign === "CENTER") out = grow(out, n.strokeWeight / 2);
  let total = out;
  for (const e of n.effects ?? []) {
    if (e.visible === false) continue;
    if (e.type === "DROP_SHADOW") {
      const s = grow({ x: out.x + (e.offset?.x ?? 0), y: out.y + (e.offset?.y ?? 0), w: out.w, h: out.h }, (e.radius ?? 0) + (e.spread ?? 0));
      total = union(total, s)!;
    } else if (e.type === "LAYER_BLUR") {
      total = union(total, grow(out, e.radius ?? 0))!;
    }
  }
  return total;
}

export function exportBounds(n: any): Rect | null {
  if (n.visible === false) return null;
  const b = n.absoluteBoundingBox;
  let r: Rect | null = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  const kids: any[] = (n.children ?? []).filter((c: any) => c.visible !== false);
  if (kids.length && !n.clipsContent) {
    // A frame always covers its own box; a group or boolean only covers its children.
    const own = n.type === "GROUP" || n.type === "BOOLEAN_OPERATION" ? null : r;
    const maskAt = kids.findIndex((c) => c.isMask);
    if (maskAt >= 0) {
      let content: Rect | null = null;
      for (const c of kids.slice(maskAt + 1)) content = union(content, exportBounds(c));
      const before = kids.slice(0, maskAt).reduce((acc: Rect | null, c) => union(acc, exportBounds(c)), own);
      r = union(before, intersect(exportBounds({ ...kids[maskAt], effects: [] }), content));
    } else {
      r = kids.reduce((acc: Rect | null, c) => union(acc, exportBounds(c)), own);
    }
  }
  return r ? withEffects(n, r) : null;
}
