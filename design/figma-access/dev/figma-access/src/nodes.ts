// Per-node measurement for `compare --nodes`: where each text, icon and image of the design lands
// in the page, measured on the pixels of both images, not on boxes.
//
// Text and icons: find the "ink" (pixels that differ from the area's background) in the reference
// and in the capture, and compare its weighted centre and width. Images fill their area, so they
// have no background to separate: for them, find the shift that makes the area match best.

import { exportBounds, vectorOnly, type Rect } from "./spec";

export interface Measured {
  id: string;
  name: string;
  kind: "text" | "icon" | "image";
  style?: string;
  box: [number, number, number, number];
  dx?: number;
  dy?: number;
  widthRatio?: number;
  missing?: boolean;
}

// rect: the node's visible area; clip: the area its clipping ancestors leave visible.
interface Target { node: any; kind: Measured["kind"]; rect: Rect; clip: Rect | null }

const r2 = (n: number) => Math.round(n * 100) / 100;

function clipTo(a: Rect, b: Rect | null): Rect | null {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

export function textStyle(n: any): string {
  const s = n.style ?? {};
  const lh = s.lineHeightPx ? `/${r2(s.lineHeightPx)}` : "";
  return `${s.fontFamily} ${s.fontWeight} ${r2(s.fontSize)}${lh}`;
}

/** The nodes to measure under root, with their visible area in canvas coordinates. */
export function targets(root: any): Target[] {
  const list: Target[] = [];
  const walk = (n: any, depth: number, clip: Rect | null) => {
    if (n.visible === false) return;
    const b = n.absoluteRenderBounds ?? n.absoluteBoundingBox;
    const own = b ? clipTo({ x: b.x, y: b.y, w: b.width, h: b.height }, clip) : null;
    const image = (n.fills ?? []).some((f: any) => f.type === "IMAGE" && f.visible !== false);
    if (depth > 0 && own) {
      if (n.type === "TEXT" && String(n.characters ?? "").trim()) list.push({ node: n, kind: "text", rect: own, clip });
      else if (image) list.push({ node: n, kind: "image", rect: own, clip });
      else if (vectorOnly(n)) {
        list.push({ node: n, kind: "icon", rect: own, clip });
        return;
      }
    }
    if (n.clipsContent && n.absoluteBoundingBox) {
      const c = n.absoluteBoundingBox;
      clip = clipTo({ x: c.x, y: c.y, w: c.width, h: c.height }, clip) ?? { x: 0, y: 0, w: 0, h: 0 };
    }
    for (const c of n.children ?? []) walk(c, depth + 1, clip);
  };
  walk(root, 0, null);
  return list;
}

/** The canvas point that the reference render's top-left pixel shows. */
export function renderOrigin(root: any): { x: number; y: number } {
  const e = exportBounds(root);
  const b = root.absoluteBoundingBox ?? { x: 0, y: 0 };
  return e ? { x: e.x, y: e.y } : { x: b.x, y: b.y };
}

// x0..x1: the columns holding the middle 96% of the ink's weight, so stray pixels do not stretch it.
// flat: share of the edge in the background colour; a low share means a busy background.
interface Ink { cx: number; cy: number; x0: number; x1: number; weight: number; flat: number }

/** Weighted centre and extent of the pixels in r that differ from r's background. */
function ink(rgb: Uint8Array, W: number, H: number, r: Rect, threshold: number): Ink | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  // Background: the most common colour on the area's edge.
  const counts = new Map<number, number>();
  const edge = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    const k = ((rgb[i]! >> 2) << 12) | ((rgb[i + 1]! >> 2) << 6) | (rgb[i + 2]! >> 2);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (let x = x0; x < x1; x++) { edge(x, y0); edge(x, y1 - 1); }
  for (let y = y0; y < y1; y++) { edge(x0, y); edge(x1 - 1, y); }
  let key = 0, best = -1, total = 0;
  for (const [k, c] of counts) {
    total += c;
    if (c > best) { best = c; key = k; }
  }
  const bg = [((key >> 12) & 63) * 4 + 2, ((key >> 6) & 63) * 4 + 2, (key & 63) * 4 + 2];
  let sw = 0, sx = 0, sy = 0;
  const cols = new Float64Array(x1 - x0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 3;
      const d = Math.max(Math.abs(rgb[i]! - bg[0]!), Math.abs(rgb[i + 1]! - bg[1]!), Math.abs(rgb[i + 2]! - bg[2]!));
      if (d <= threshold) continue;
      sw += d; sx += d * (x + 0.5); sy += d * (y + 0.5);
      cols[x - x0] = cols[x - x0]! + d;
    }
  }
  if (!sw) return null;
  const at = (share: number) => {
    let acc = 0;
    for (let i = 0; i < cols.length; i++) {
      acc += cols[i]!;
      if (acc >= share * sw) return x0 + i + (share * sw - (acc - cols[i]!)) / cols[i]!;
    }
    return x1;
  };
  return { cx: sx / sw, cy: sy / sw, x0: at(0.02), x1: at(0.98), weight: sw, flat: best / total };
}

/** Shift of the capture (in image pixels) that best matches the area, by mean channel difference. */
function bestShift(ref: Uint8Array, cap: Uint8Array, W: number, H: number, r: Rect, max: number): { dx: number; dy: number } {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(W, Math.round(r.x + r.w)), y1 = Math.min(H, Math.round(r.y + r.h));
  let best = { dx: 0, dy: 0, err: Infinity };
  for (let dy = -max; dy <= max; dy++) {
    for (let dx = -max; dx <= max; dx++) {
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const cy = y + dy;
        if (cy < 0 || cy >= H) continue;
        for (let x = x0; x < x1; x++) {
          const cx = x + dx;
          if (cx < 0 || cx >= W) continue;
          const i = (y * W + x) * 3, j = (cy * W + cx) * 3;
          sum += Math.abs(ref[i]! - cap[j]!) + Math.abs(ref[i + 1]! - cap[j + 1]!) + Math.abs(ref[i + 2]! - cap[j + 2]!);
          n++;
        }
      }
      const err = n ? sum / n : Infinity;
      // Prefer no shift on ties, so noise does not invent an offset.
      if (err < best.err - 0.05 || (Math.abs(err - best.err) <= 0.05 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, err };
    }
  }
  return best;
}

/**
 * Measures every target. origin is the canvas point at the reference's top-left pixel, scale the
 * image pixels per CSS pixel. Results are in CSS pixels; dx and dy are where the page draws the
 * node relative to the design (positive: right, lower).
 */
export function measureNodes(
  root: any, origin: { x: number; y: number }, ref: Uint8Array, cap: Uint8Array, W: number, H: number, scale: number, threshold: number,
): Measured[] {
  const out: Measured[] = [];
  for (const t of targets(root)) {
    const css = { x: t.rect.x - origin.x, y: t.rect.y - origin.y, w: t.rect.w, h: t.rect.h };
    const px = { x: css.x * scale, y: css.y * scale, w: css.w * scale, h: css.h * scale };
    if (px.x + px.w <= 0 || px.y + px.h <= 0 || px.x >= W || px.y >= H) continue;
    const m: Measured = { id: t.node.id, name: t.node.name, kind: t.kind, box: [r2(css.x), r2(css.y), r2(css.w), r2(css.h)] };
    if (t.kind === "text") m.style = textStyle(t.node);
    if (t.kind === "image") {
      const s = bestShift(ref, cap, W, H, px, Math.round(4 * scale));
      m.dx = r2(s.dx / scale);
      m.dy = r2(s.dy / scale);
      out.push(m);
      continue;
    }
    // Room for ink that moved or grew: 4 px each way, plus a fifth of the width for wider text.
    const padX = (4 + (t.kind === "text" ? css.w * 0.2 : 0)) * scale, padY = 4 * scale;
    // Never past a clipping ancestor: beyond it lie other parts of the page.
    const clip = t.clip && { x: (t.clip.x - origin.x) * scale, y: (t.clip.y - origin.y) * scale, w: t.clip.w * scale, h: t.clip.h * scale };
    const area = clipTo({ x: px.x - padX, y: px.y - padY, w: px.w + 2 * padX, h: px.h + 2 * padY }, clip);
    if (!area) continue;
    const a = ink(ref, W, H, area, threshold);
    if (!a) continue; // nothing visible in the design here
    if (a.flat < 0.5) {
      // A busy background (a photo, a gradient) hides the ink: match the whole area instead.
      const s = bestShift(ref, cap, W, H, area, Math.round(4 * scale));
      m.dx = r2(s.dx / scale);
      m.dy = r2(s.dy / scale);
      out.push(m);
      continue;
    }
    const b = ink(cap, W, H, area, threshold);
    if (!b || b.weight < a.weight * 0.1) {
      m.missing = true;
      out.push(m);
      continue;
    }
    m.dx = r2((b.cx - a.cx) / scale);
    m.dy = r2((b.cy - a.cy) / scale);
    if (t.kind === "text") m.widthRatio = r2((b.x1 - b.x0) / (a.x1 - a.x0));
    out.push(m);
  }
  return out;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** One line per text style: how far its copies sit off and how wide they are, with a hint. */
export function styleSummary(nodes: Measured[]) {
  const groups = new Map<string, Measured[]>();
  for (const n of nodes) if (n.kind === "text" && !n.missing) groups.set(n.style!, [...(groups.get(n.style!) ?? []), n]);
  return [...groups.entries()].map(([style, list]) => {
    const dy = median(list.map((n) => n.dy!)), dx = median(list.map((n) => n.dx!));
    const widths = list.filter((n) => n.widthRatio !== undefined).map((n) => n.widthRatio!);
    const wr = widths.length ? median(widths) : 1;
    const same = list.filter((n) => Math.abs(n.dy! - dy) <= 0.3).length / list.length;
    const s: Record<string, unknown> = { style, count: list.length, dy: r2(dy), dx: r2(dx) };
    if (widths.length) s.widthRatio = r2(wr);
    const hints: string[] = [];
    if (Math.abs(dy) >= 0.5 && Math.abs(dy) <= 2 && same >= 0.75) {
      hints.push(`Every copy sits ${r2(Math.abs(dy))} px ${dy > 0 ? "lower" : "higher"}: correct it once for this style, if the boxes around it match.`);
    } else if (Math.abs(dy) > 2) {
      hints.push(`Off by ${r2(Math.abs(dy))} px: more than font metrics explain, so a box or gap above or around it is wrong; check the section's shift first.`);
    }
    if (Math.abs(wr - 1) > 0.02) hints.push(`Text is ${r2(Math.abs(wr - 1) * 100)}% ${wr > 1 ? "wider" : "narrower"}: check the font file, weight and letter spacing.`);
    if (hints.length) s.hint = hints.join(" ");
    return s;
  }).sort((a, b) => Math.abs(b.dy as number) - Math.abs(a.dy as number));
}

/** The nodes worth looking at: missing, or off by half a pixel or more, or 2% wider or narrower. */
export function offNodes(nodes: Measured[]): Measured[] {
  const size = (n: Measured) => (n.missing ? 1000 : Math.hypot(n.dx ?? 0, n.dy ?? 0) + Math.abs((n.widthRatio ?? 1) - 1) * 20);
  return nodes
    .filter((n) => n.missing || Math.abs(n.dx ?? 0) >= 0.5 || Math.abs(n.dy ?? 0) >= 0.5 || Math.abs((n.widthRatio ?? 1) - 1) > 0.02)
    .sort((a, b) => size(b) - size(a));
}
