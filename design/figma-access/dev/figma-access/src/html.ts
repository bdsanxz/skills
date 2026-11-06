// `spec --html`: a starting page built from the node tree. Auto layout becomes flex from its rules
// (not its stored boxes), groups and frames without auto layout place their children at their
// boxes, the page frame and the full-width sections in it stretch with the window while their
// content stays centred, text is live, and icons, masks and image layers are Figma's own renders.
// The page is a first pass to measure with `compare` and refine section by section.

import { textStyle } from "./nodes";
import { color, exportBounds, layoutDrift, paint, vectorOnly } from "./spec";

const r2 = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${r2(n)}px`;

export interface Note {
  id: string;
  name: string;
  note: string;
}

export interface Emitted {
  html: string;
  /** Node ids to render as SVG, and as PNG at scale 2. */
  svg: string[];
  png: string[];
  /** Blurred icons: Figma's PNG at scale 1, since Chrome draws an exported SVG blur in another tone. */
  soft: string[];
  /** Image fills (by imageRef) drawn as CSS backgrounds from the original files. */
  fills: string[];
  fonts: string[];
  notes: Note[];
}

export interface Assets {
  svg: (id: string) => string | undefined;
  png: (id: string) => string | undefined;
  fill: (ref: string) => string | undefined;
}

type Box = { x: number; y: number; width: number; height: number };

/** How a node is placed by its parent. */
type Place =
  | { kind: "root" }
  | { kind: "abs"; origin: Box; fluidW?: number } // fluidW: the parent stretches, so x counts from its centre
  | { kind: "flex"; row: boolean; parent: any; lead?: number; fluid: boolean }
  | { kind: "stack"; parentW: number; x0: number; top: number; fluid: boolean };

export const slug = (s: string) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shown = (n: any) => (n.children ?? []).filter((c: any) => c.visible !== false && c.absoluteBoundingBox);
const hasImage = (n: any) => (n.fills ?? []).some((f: any) => f.type === "IMAGE" && f.visible !== false);
const flexOf = (n: any) => n.layoutMode && n.layoutMode !== "NONE";
const rotated = (n: any) => Math.abs(n.rotation ?? 0) > 0.01;

const JUSTIFY: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
const ALIGN: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" };
const CASE: Record<string, string> = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" };
const DECO: Record<string, string> = { UNDERLINE: "underline", STRIKETHROUGH: "line-through" };
const BLEND = new Set(["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);

export function emitHtml(root: any, title: string): Emitted {
  const block = slug(root.name) || "page";
  const css: string[] = [];
  // \`__text\` is the shared class of every text (with a modifier per style): no layer may take it.
  const used = new Map<string, number>([[`${block}__text`, 1]]);
  const svg = new Set<string>(), png = new Set<string>(), soft = new Set<string>(), fills = new Set<string>(), fonts = new Set<string>();
  const weights = new Map<string, Set<number>>();
  const useFont = (family: string, weight: number) => {
    fonts.add(family);
    weights.set(family, (weights.get(family) ?? new Set()).add(Math.round(weight / 100) * 100 || 400));
  };
  const notes: Note[] = [];
  const note = (n: any, text: string) => notes.push({ id: n.id, name: n.name, note: text });

  const cls = (n: any) => {
    const base = `${block}__${slug(n.name) || n.type.toLowerCase()}`;
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    return k > 1 ? `${base}-${k}` : base;
  };
  const rule = (sel: string, props: string[]) => {
    if (props.length) css.push(`.${sel}{${props.join(";")}}`);
  };

  /** Where the parent puts the node: position and size. */
  function placement(n: any, place: Place, own: { text?: boolean; frozen?: boolean }): string[] {
    const b: Box = n.absoluteBoundingBox;
    const p: string[] = [];
    if (place.kind === "root") return ["position:relative", "width:100%"];
    if (place.kind === "abs") {
      const left = b.x - place.origin.x;
      p.push("position:absolute", `top:${px(b.y - place.origin.y)}`);
      // In a stretching parent a page-wide layer stretches too; the rest stays centred.
      if (place.fluidW && !own.frozen && left <= 1 && Math.abs(b.width - pageW) <= 1) p.push("left:0", "width:100%");
      else p.push(place.fluidW ? `left:calc(50% + ${px(left - place.fluidW / 2)})` : `left:${px(left)}`, `width:${px(b.width)}`);
      p.push(`height:${px(b.height)}`);
      return p;
    }
    p.push("position:relative");
    if (place.kind === "stack") {
      p.push(`margin-top:${px(place.top)}`);
      if (place.fluid) p.push("width:100%");
      else {
        const left = b.x - place.x0;
        p.push(`width:${px(b.width)}`, "max-width:100%", `margin-left:calc(50% + ${px(left - place.parentW / 2)})`);
      }
      const hugV = n.layoutSizingVertical === "HUG" && !own.frozen;
      if (!hugV && !own.text) p.push(`height:${px(b.height)}`);
      return p;
    }
    // In an auto layout parent.
    if (place.lead) p.push(`margin-${place.row ? "left" : "top"}:${px(place.lead)}`);
    const sizing = (horizontal: boolean): string => {
      const s = horizontal ? n.layoutSizingHorizontal : n.layoutSizingVertical;
      if (s) return own.frozen && s === "HUG" ? "FIXED" : s;
      const main = horizontal === place.row;
      if (main) return n.layoutGrow ? "FILL" : "FIXED";
      return n.layoutAlign === "STRETCH" ? "FILL" : "FIXED";
    };
    const w = sizing(true), h = sizing(false);
    const mainS = place.row ? w : h, crossS = place.row ? h : w;
    const mainLen = place.row ? b.width : b.height, crossLen = place.row ? b.height : b.width;
    const mainProp = place.row ? "width" : "height", crossProp = place.row ? "height" : "width";
    if (mainS === "FILL") p.push("flex:1 1 0", `min-${mainProp}:0`);
    else {
      p.push("flex:none");
      if (mainS === "FIXED" && !(own.text && !place.row)) p.push(`${mainProp}:${px(mainLen)}`);
    }
    if (crossS === "FILL" || place.fluid) p.push("align-self:stretch");
    else if (crossS === "FIXED" && !(own.text && place.row)) p.push(`${crossProp}:${px(crossLen)}`);
    if (n.minWidth) p.push(`min-width:${px(n.minWidth)}`);
    if (n.maxWidth) p.push(`max-width:${px(n.maxWidth)}`);
    return p;
  }

  /** Fills, strokes, radii, effects, opacity and blend of a box. */
  function paintProps(n: any, layers: string[], over: string[] = []): string[] {
    const p: string[] = [];
    const size = { w: n.size?.x ?? n.absoluteBoundingBox.width, h: n.size?.y ?? n.absoluteBoundingBox.height };
    const bg: { image: string; size?: string; pos?: string; repeat?: string }[] = [];
    let bgColor: string | undefined;
    const list = [...(n.fills ?? [])].filter((f: any) => f.visible !== false).reverse(); // top layer first
    list.forEach((f: any, i: number) => {
      if (f.type === "IMAGE") {
        fills.add(f.imageRef);
        const url = `url("${FILL_MARK}${f.imageRef}")`;
        const op = f.opacity ?? 1;
        if (op < 1) note(n, `image fill at opacity ${r2(op)}: drawn opaque`);
        if (f.scaleMode === "FIT") bg.push({ image: url, size: "contain", pos: "center", repeat: "no-repeat" });
        else if (f.scaleMode === "TILE") bg.push({ image: url, size: f.scalingFactor ? `${r2(f.scalingFactor * 100)}%` : "auto", pos: "0 0", repeat: "repeat" });
        else {
          if (f.scaleMode === "STRETCH" || f.scaleMode === "CROP") note(n, `image fill ${f.scaleMode}: drawn as cover; Figma's crop is not in the data, so check it against the render`);
          bg.push({ image: url, size: "cover", pos: "center", repeat: "no-repeat" });
        }
        return;
      }
      let v = paint(f, size);
      if (!v) return;
      if (v.includes(" ROTATED ")) {
        layers.push(rotatedLayer(f, size));
        note(n, "rotated radial gradient: drawn on its own layer above the other fills");
        return;
      }
      if (v.startsWith("diamond-gradient")) {
        v = v.replace("diamond-gradient", "radial-gradient");
        note(n, "diamond gradient: drawn as a radial gradient");
      }
      if (f.type === "SOLID" && i === list.length - 1) bgColor = v;
      else bg.push({ image: f.type === "SOLID" ? `linear-gradient(${v},${v})` : v });
    });
    if (bg.length) {
      p.push(`background-image:${bg.map((l) => l.image).join(",")}`);
      if (bg.some((l) => l.size)) {
        p.push(`background-size:${bg.map((l) => l.size ?? "auto").join(",")}`);
        p.push(`background-position:${bg.map((l) => l.pos ?? "0 0").join(",")}`);
        p.push(`background-repeat:${bg.map((l) => l.repeat ?? "repeat").join(",")}`);
      }
    }
    if (bgColor) p.push(`background-color:${bgColor}`);
    const shadows: string[] = [];
    const strokes = (n.strokes ?? []).filter((s: any) => s.visible !== false);
    if (strokes.length && n.strokeWeight) {
      const top = strokes[strokes.length - 1];
      let c = top.type === "SOLID" ? color(top.color, top.opacity ?? 1) : null;
      const ring = !c && !n.strokeDashes?.length ? strokeLayer(n, top, size) : undefined;
      if (ring) over.push(ring);
      else if (!c && top.gradientStops?.length) {
        c = color(top.gradientStops[0].color, top.opacity ?? 1);
        note(n, "gradient stroke: drawn in its first colour");
      }
      if (c) {
        const align = n.strokeAlign ?? "INSIDE";
        if (n.strokeDashes?.length) {
          p.push(`outline:${px(n.strokeWeight)} dashed ${c}`, `outline-offset:${px(align === "INSIDE" ? -n.strokeWeight : align === "CENTER" ? -n.strokeWeight / 2 : 0)}`);
        } else if (n.individualStrokeWeights) {
          const s = n.individualStrokeWeights;
          if (s.top) shadows.push(`inset 0 ${px(s.top)} 0 0 ${c}`);
          if (s.bottom) shadows.push(`inset 0 ${px(-s.bottom)} 0 0 ${c}`);
          if (s.left) shadows.push(`inset ${px(s.left)} 0 0 0 ${c}`);
          if (s.right) shadows.push(`inset ${px(-s.right)} 0 0 0 ${c}`);
        } else if (align === "INSIDE") shadows.push(`inset 0 0 0 ${px(n.strokeWeight)} ${c}`);
        else if (align === "OUTSIDE") shadows.push(`0 0 0 ${px(n.strokeWeight)} ${c}`);
        else shadows.push(`inset 0 0 0 ${px(n.strokeWeight / 2)} ${c}`, `0 0 0 ${px(n.strokeWeight / 2)} ${c}`);
      }
    }
    if (n.rectangleCornerRadii) p.push(`border-radius:${n.rectangleCornerRadii.map(px).join(" ")}`);
    else if (n.cornerRadius) p.push(`border-radius:${px(n.cornerRadius)}`);
    const filters: string[] = [];
    for (const e of n.effects ?? []) {
      if (e.visible === false) continue;
      const sh = e.color ? `${px(e.offset?.x ?? 0)} ${px(e.offset?.y ?? 0)} ${px(e.radius ?? 0)} ${px(e.spread ?? 0)} ${color(e.color)}` : "";
      if (e.type === "DROP_SHADOW" && sh) shadows.push(sh);
      else if (e.type === "INNER_SHADOW" && sh) shadows.push(`inset ${sh}`);
      else if (e.type === "LAYER_BLUR") filters.push(`blur(${px((e.radius ?? 0) / 2)})`);
      else if (e.type === "BACKGROUND_BLUR") p.push(`backdrop-filter:blur(${px((e.radius ?? 0) / 2)})`, `-webkit-backdrop-filter:blur(${px((e.radius ?? 0) / 2)})`);
    }
    if (shadows.length) p.push(`box-shadow:${shadows.join(",")}`);
    if (filters.length) p.push(`filter:${filters.join(" ")}`);
    return p.concat(common(n));
  }

  /** A gradient stroke: a ring of the gradient over the box, cut out with a mask; it takes no space. */
  function strokeLayer(n: any, f: any, size: { w: number; h: number }): string | undefined {
    let g = paint(f, size);
    if (!g || g.includes(" ROTATED ")) return undefined;
    g = g.replace("diamond-gradient", "radial-gradient");
    const w = n.strokeWeight;
    const align = n.strokeAlign ?? "INSIDE";
    const out = align === "INSIDE" ? 0 : align === "CENTER" ? w / 2 : w;
    const s = n.individualStrokeWeights;
    const pad = s ? [s.top, s.right, s.bottom, s.left].map((v: number) => px(v ?? 0)).join(" ") : px(w);
    const radius = n.type === "ELLIPSE" ? "50%"
      : n.rectangleCornerRadii ? n.rectangleCornerRadii.map((r: number) => px(r ? r + out : 0)).join(" ")
      : n.cornerRadius ? px(n.cornerRadius + out) : "0";
    const style = [
      "position:absolute", `inset:${px(-out)}`, `padding:${pad}`, `border-radius:${radius}`, `background:${g}`,
      "-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)", "-webkit-mask-composite:xor",
      "mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)", "pointer-events:none",
    ].join(";");
    return `<div style="${style}"></div>`;
  }

  function common(n: any): string[] {
    const p: string[] = [];
    if (n.opacity !== undefined && n.opacity < 1) p.push(`opacity:${r2(n.opacity)}`);
    const blend = String(n.blendMode ?? "").toLowerCase().replace(/_/g, "-");
    if (BLEND.has(blend)) p.push(`mix-blend-mode:${blend}`);
    return p;
  }

  /** A radial gradient whose ellipse is tilted: a large rotated layer centred on the gradient. */
  function rotatedLayer(f: any, size: { w: number; h: number }): string {
    const [c, a, b] = f.gradientHandlePositions as { x: number; y: number }[];
    const cx = c!.x * size.w, cy = c!.y * size.h;
    const vx = (a!.x - c!.x) * size.w, vy = (a!.y - c!.y) * size.h;
    const ra = Math.hypot(vx, vy), rb = Math.hypot((b!.x - c!.x) * size.w, (b!.y - c!.y) * size.h);
    const angle = (Math.atan2(vy, vx) * 180) / Math.PI;
    const side = 2 * (Math.hypot(size.w, size.h) + Math.max(ra, rb));
    const stops = (f.gradientStops ?? []).map((s: any) => `${color(s.color, f.opacity ?? 1)} ${r2(s.position * 100)}%`).join(", ");
    const style = [
      "position:absolute",
      `left:${px(cx - side / 2)}`,
      `top:${px(cy - side / 2)}`,
      `width:${px(side)}`,
      `height:${px(side)}`,
      `background:radial-gradient(${px(ra)} ${px(rb)} at 50% 50%, ${stops})`,
      `transform:rotate(${r2(angle)}deg)`,
    ].join(";");
    return `<div style="position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none"><div style="${style}"></div></div>`;
  }

  function textProps(n: any): string[] {
    const s = n.style ?? {};
    useFont(s.fontFamily, s.fontWeight ?? 400);
    const p = [
      `font-family:"${s.fontFamily}",sans-serif`,
      `font-weight:${s.fontWeight ?? 400}`,
      `font-size:${px(s.fontSize ?? 16)}`,
      `line-height:${s.lineHeightPx ? px(s.lineHeightPx) : "normal"}`,
    ];
    if (s.italic) p.push("font-style:italic");
    if (s.letterSpacing) p.push(`letter-spacing:${px(s.letterSpacing)}`);
    if (s.textAlignHorizontal && s.textAlignHorizontal !== "LEFT") p.push(`text-align:${s.textAlignHorizontal === "JUSTIFIED" ? "justify" : s.textAlignHorizontal.toLowerCase()}`);
    if (CASE[s.textCase]) p.push(`text-transform:${CASE[s.textCase]}`);
    if (DECO[s.textDecoration]) p.push(`text-decoration:${DECO[s.textDecoration]}`);
    const top = [...(n.fills ?? [])].filter((f: any) => f.visible !== false).pop();
    if (top?.type === "SOLID") p.push(`color:${color(top.color, top.opacity ?? 1)}`);
    else if (top) {
      const g = paint(top, { w: n.absoluteBoundingBox.width, h: n.absoluteBoundingBox.height });
      if (g) p.push(`background:${g.replace(/ ROTATED .*$/, "")}`, "-webkit-background-clip:text", "background-clip:text", "color:transparent");
    }
    if (s.textAutoResize === "WIDTH_AND_HEIGHT") p.push("white-space:nowrap");
    if (n.style?.textTruncation === "ENDING") {
      p.push("overflow:hidden", "text-overflow:ellipsis");
      // Figma wraps a truncated text and cuts it at the last line that fits: maxLines, or as many as the box holds.
      const fit = s.lineHeightPx ? Math.floor((n.absoluteBoundingBox.height + 0.5) / s.lineHeightPx) : 1;
      const lines = s.maxLines > 0 ? s.maxLines : s.textAutoResize === "WIDTH_AND_HEIGHT" ? 1 : Math.max(1, fit);
      if (lines > 1) {
        p.push("display:-webkit-box", `-webkit-line-clamp:${lines}`, "-webkit-box-orient:vertical");
        // The clamp ends the text, not the box: hide the next line where the box is taller than its lines.
        const spare = s.lineHeightPx ? n.absoluteBoundingBox.height - lines * s.lineHeightPx : 0;
        if (spare > 0.5) p.push(`clip-path:inset(0 0 ${px(spare)} 0)`);
      }
      else p.push("white-space:nowrap");
    }
    const shadows = (n.effects ?? [])
      .filter((e: any) => e.visible !== false && e.type === "DROP_SHADOW" && e.color)
      .map((e: any) => `${px(e.offset?.x ?? 0)} ${px(e.offset?.y ?? 0)} ${px(e.radius ?? 0)} ${color(e.color)}`);
    if (shadows.length) p.push(`text-shadow:${shadows.join(",")}`);
    return p.concat(common(n));
  }

  function textContent(n: any): string {
    const chars: string[] = Array.from(String(n.characters ?? ""));
    const ids: number[] = n.characterStyleOverrides ?? [];
    const table = n.styleOverrideTable ?? {};
    const brk = (t: string) => esc(t).replace(/\r?\n|\u2028|\u2029/g, "<br>");
    if (!ids.length || !Object.keys(table).length) return brk(chars.join(""));
    const runs: { id: number; text: string }[] = [];
    chars.forEach((ch, i) => {
      const id = ids[i] ?? 0;
      const last = runs[runs.length - 1];
      if (last && last.id === id) last.text += ch;
      else runs.push({ id, text: ch });
    });
    return runs
      .map((r) => {
        const o = table[r.id];
        if (!r.id || !o) return brk(r.text);
        const st: string[] = [];
        if (o.fontFamily || o.fontWeight) useFont(o.fontFamily ?? n.style?.fontFamily, o.fontWeight ?? n.style?.fontWeight ?? 400);
        if (o.fontFamily) {
          st.push(`font-family:'${o.fontFamily}',sans-serif`);
        }
        if (o.fontWeight) st.push(`font-weight:${o.fontWeight}`);
        if (o.fontSize) st.push(`font-size:${px(o.fontSize)}`);
        if (o.lineHeightPx) st.push(`line-height:${px(o.lineHeightPx)}`);
        if (o.italic) st.push("font-style:italic");
        if (o.letterSpacing) st.push(`letter-spacing:${px(o.letterSpacing)}`);
        if (DECO[o.textDecoration]) st.push(`text-decoration:${DECO[o.textDecoration]}`);
        if (CASE[o.textCase]) st.push(`text-transform:${CASE[o.textCase]}`);
        const f = (o.fills ?? []).filter((x: any) => x.visible !== false).pop();
        if (f?.type === "SOLID") st.push(`color:${color(f.color, f.opacity ?? 1)}`);
        return st.length ? `<span style="${st.join(";")}">${brk(r.text)}</span>` : brk(r.text);
      })
      .join("");
  }

  function emit(n: any, place: Place, depth: number): string {
    const b: Box = n.absoluteBoundingBox;
    const c = cls(n);
    const drift = layoutDrift(n);
    if (drift) note(n, `LAYOUT DRIFT (${drift}): built from its rules; check it against the render`);

    // Exported whole: icons, masks, image layers and rotated layers keep Figma's own drawing.
    const leafImage = hasImage(n) && !shown(n).length;
    const masked = shown(n).some((k: any) => k.isMask);
    const icon = depth > 0 && n.type !== "TEXT" && vectorOnly(n);
    const turned = depth > 0 && n.type !== "TEXT" && rotated(n);
    if (icon || masked || leafImage || turned) {
      const blurred = icon && blurs(n);
      const kind = icon && !blurred ? "svg" : "png";
      (blurred ? soft : kind === "svg" ? svg : png).add(n.id);
      const e = exportBounds(n) ?? { x: b.x, y: b.y, w: b.width, h: b.height };
      rule(c, placement(n, place, { frozen: true }));
      const img = `<img src="${ASSET_MARK}${kind}:${n.id}" alt="" style="position:absolute;left:${px(e.x - b.x)};top:${px(e.y - b.y)};width:${px(e.w)};height:${px(e.h)};max-width:none">`;
      return `<div class="${c}">${img}</div>`;
    }

    if (n.type === "TEXT") {
      const props = placement(n, place, { text: true }).concat(textProps(n));
      const s = n.style ?? {};
      const fixedH = s.textAutoResize !== "HEIGHT" && s.textAutoResize !== "WIDTH_AND_HEIGHT";
      let inner = textContent(n);
      if (fixedH && s.textAlignVertical && s.textAlignVertical !== "TOP") {
        props.push("display:flex", "flex-direction:column", `justify-content:${s.textAlignVertical === "CENTER" ? "center" : "flex-end"}`);
        inner = `<span>${inner}</span>`;
      }
      if (fixedH && !props.some((x) => x.startsWith("height:")) && n.layoutSizingVertical !== "HUG" && n.layoutSizingVertical !== "FILL") props.push(`height:${px(b.height)}`);
      if (rotated(n)) {
        props.push(`transform:rotate(${r2((-n.rotation * 180) / Math.PI)}deg)`);
        note(n, "rotated text: check its position against the render");
      }
      rule(c, props);
      // Every text of one style shares a modifier, so a fix for the style is one rule.
      return `<div class="${c} ${block}__text ${block}__text--${slug(textStyle(n))}">${inner}</div>`;
    }

    // A box: frame, group, component, instance, section or plain shape.
    const layers: string[] = [], over: string[] = [];
    const fluid = place.kind === "root" || ((place.kind === "stack" || place.kind === "flex") && place.fluid);
    const props = placement(n, place, {});
    const isRoot = place.kind === "root";
    const own = paintProps(isRoot ? { ...n, effects: [] } : n, layers, over);
    props.push(...own, "box-sizing:border-box");
    if (n.clipsContent) props.push("overflow:hidden");
    const kids = shown(n);
    let body = "";
    if (flexOf(n)) {
      const row = n.layoutMode === "HORIZONTAL";
      const between = n.primaryAxisAlignItems === "SPACE_BETWEEN";
      const gap = n.itemSpacing ?? 0;
      // Figma centres a lone child under space-between; CSS puts it at the start.
      const flowing = kids.filter((k: any) => k.layoutPositioning !== "ABSOLUTE").length;
      const justify = between && flowing === 1 ? "center" : JUSTIFY[n.primaryAxisAlignItems ?? "MIN"] ?? "flex-start";
      props.push("display:flex", `flex-direction:${row ? "row" : "column"}`, `justify-content:${justify}`, `align-items:${ALIGN[n.counterAxisAlignItems ?? "MIN"] ?? "flex-start"}`);
      if (n.layoutWrap === "WRAP") {
        props.push("flex-wrap:wrap");
        if (n.counterAxisSpacing) props.push(`row-gap:${px(n.counterAxisSpacing)}`);
      }
      if (!between && gap > 0) props.push(`${n.layoutWrap === "WRAP" ? "column-gap" : "gap"}:${px(gap)}`);
      const pad = [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0];
      if (fluid && (pad[1]! > 0 || pad[3]! > 0)) {
        // A stretching frame keeps its content where the design has it, centred in the window.
        const W = b.width;
        props.push(`padding:${px(pad[0]!)} max(${px(pad[1]!)}, calc(50% - ${px(W / 2 - pad[1]!)})) ${px(pad[2]!)} max(${px(pad[3]!)}, calc(50% - ${px(W / 2 - pad[3]!)}))`);
      } else if (pad.some((v) => v)) props.push(`padding:${pad.map(px).join(" ")}`);
      let first = true;
      for (const k of kids) {
        if (k.layoutPositioning === "ABSOLUTE") {
          body += emit(k, { kind: "abs", origin: b, ...(fluid ? { fluidW: b.width } : {}) }, depth + 1);
          continue;
        }
        const lead = !first && !between && gap < 0 ? gap : undefined;
        first = false;
        // Only a part as wide as the page stretches with the window; narrower ones keep their size.
        const kidFluid = fluid && !row && Math.abs(k.absoluteBoundingBox.width - pageW) <= 1;
        body += emit(k, { kind: "flex", row, parent: n, lead, fluid: kidFluid }, depth + 1);
      }
    } else if (fluid && kids.length) {
      // A stretching frame without auto layout: stack the children that follow each other
      // top to bottom; the ones that overlap them are placed at their boxes.
      const W = b.width;
      const sorted = [...kids].sort((p: any, q: any) => p.absoluteBoundingBox.y - q.absoluteBoundingBox.y);
      const flow = new Set<any>();
      let bottom = b.y;
      for (const k of sorted) {
        const kb = k.absoluteBoundingBox;
        if (kb.y >= bottom - 1 && kb.height < b.height + 1) {
          flow.add(k);
          bottom = kb.y + kb.height;
        }
      }
      if (flow.size >= 2 || (flow.size === 1 && kids.length === 1)) {
        let last = b.y;
        for (const k of kids) {
          if (flow.has(k)) continue;
          body += emit(k, { kind: "abs", origin: b, fluidW: W }, depth + 1);
        }
        for (const k of sorted.filter((k: any) => flow.has(k))) {
          const kb = k.absoluteBoundingBox;
          const kidFluid = kb.x - b.x <= 1 && Math.abs(kb.width - pageW) <= 1;
          body += emit(k, { kind: "stack", parentW: W, x0: b.x, top: kb.y - last, fluid: kidFluid }, depth + 1);
          last = kb.y + kb.height;
        }
        const rest = b.y + b.height - last;
        if (rest > 0.5) props.push(`padding-bottom:${px(rest)}`);
        // The stacked children set the height.
        for (let i = props.length - 1; i >= 0; i--) if (props[i]!.startsWith("height:")) props.splice(i, 1);
      } else {
        if (!props.some((x) => x.startsWith("height:"))) props.push(`height:${px(b.height)}`);
        for (const k of kids) body += emit(k, { kind: "abs", origin: b, fluidW: W }, depth + 1);
      }
    } else {
      if (!props.some((x) => x.startsWith("height:")) && kids.length) props.push(`height:${px(b.height)}`);
      if (!props.some((x) => x.startsWith("width:")) && place.kind === "flex" && !props.includes("flex:1 1 0") && !props.includes("align-self:stretch")) props.push(`width:${px(b.width)}`);
      for (const k of kids) body += emit(k, { kind: "abs", origin: b }, depth + 1);
    }
    if (n.type === "ELLIPSE") props.push("border-radius:50%");
    rule(c, props);
    return `<div class="${c}">${layers.join("")}${body}${over.join("")}</div>`;
  }

  const pageW: number = root.absoluteBoundingBox.width;
  const bodyHtml = emit(root, { kind: "root" }, 0);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!-- Generated by figma-access spec --html from ${esc(root.name)} (${esc(root.id)}): a first pass to refine. -->
<!-- Fonts used: ${[...fonts].map(esc).join(", ")}. Each is asked from Google Fonts below; a family Google does not have stays missing until you add its files with @font-face. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${[...weights.entries()].map(([f, w]) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@${[...w].sort((a, b) => a - b).join(";")}&amp;display=block">`).join("\n")}
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
img{display:block}
${css.join("\n")}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
  return { html, svg: [...svg], png: [...png], soft: [...soft], fills: [...fills], fonts: [...fonts], notes };
}

/** Whether the node or anything in it has a visible layer blur. */
export function blurs(n: any): boolean {
  if (n.visible === false) return false;
  if ((n.effects ?? []).some((e: any) => e.visible !== false && e.type === "LAYER_BLUR" && (e.radius ?? 0) > 0)) return true;
  return (n.children ?? []).some(blurs);
}

const ASSET_MARK = "figma-asset:";
const FILL_MARK = "figma-fill:";

/** Put the asset paths into the page; a missing asset leaves an empty box and a note. */
export function linkAssets(html: string, assets: Assets, notes: Note[]): string {
  return html
    .replace(new RegExp(`${ASSET_MARK}(svg|png):([^"]+)`, "g"), (_m, kind: string, id: string) => {
      const path = kind === "svg" ? assets.svg(id) : assets.png(id);
      if (!path) notes.push({ id, name: "", note: `Figma did not render this ${kind}` });
      return path ?? "";
    })
    .replace(new RegExp(`${FILL_MARK}([0-9a-f]+)`, "g"), (_m, ref: string) => {
      const path = assets.fill(ref);
      if (!path) notes.push({ id: ref, name: "", note: "image fill not downloaded" });
      return path ?? "";
    });
}
