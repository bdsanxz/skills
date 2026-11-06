// Tests for `spec --html`: the page emitted from a node tree (no API needed).

import { test, expect } from "bun:test";
import { emitHtml, linkAssets } from "../src/html";

const box = (x: number, y: number, width: number, height: number) => ({ absoluteBoundingBox: { x, y, width, height } });
const solid = (r: number, g: number, b: number) => [{ type: "SOLID", color: { r, g, b, a: 1 } }];
const text = (id: string, chars: string, x: number, y: number, extra: any = {}) => ({
  id, name: chars, type: "TEXT", characters: chars, ...box(x, y, 60, 20),
  style: { fontFamily: "Inter", fontWeight: 400, fontSize: 14, lineHeightPx: 20, textAutoResize: "WIDTH_AND_HEIGHT" },
  fills: solid(0, 0, 0), ...extra,
});
const rule = (html: string, cls: string) => new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";

test("auto layout becomes flex from its rules, with fill, fixed and negative gaps", () => {
  const root = {
    id: "1:1", name: "Page", type: "FRAME", ...box(0, 0, 400, 100),
    layoutMode: "HORIZONTAL", itemSpacing: 10, paddingLeft: 20, paddingRight: 20, counterAxisAlignItems: "CENTER",
    children: [
      { id: "2:1", name: "Side", type: "FRAME", ...box(20, 0, 100, 100), layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", fills: solid(1, 0, 0) },
      { id: "2:2", name: "Main", type: "FRAME", ...box(130, 0, 250, 50), layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
        layoutMode: "VERTICAL", itemSpacing: -8, children: [text("3:1", "One", 130, 0), text("3:2", "Two", 130, 12)] },
    ],
  };
  const { html } = emitHtml(root, "t");
  expect(rule(html, "page__page")).toContain("display:flex");
  expect(rule(html, "page__page")).toContain("gap:10px");
  expect(rule(html, "page__page")).toContain("align-items:center");
  expect(rule(html, "page__side")).toContain("width:100px");
  expect(rule(html, "page__main")).toContain("flex:1 1 0");
  expect(rule(html, "page__two")).toContain("margin-top:-8px");
  expect(rule(html, "page__one")).not.toContain("margin-top");
  expect(rule(html, "page__one")).toContain("white-space:nowrap");
});

test("the page frame stacks its sections, stretches page-wide ones and keeps the rest centred", () => {
  const root = {
    id: "1:1", name: "Page", type: "FRAME", ...box(1000, 0, 1440, 700), fills: solid(1, 1, 1),
    effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 4 }, radius: 4 }],
    children: [
      { id: "2:1", name: "Nav", type: "FRAME", ...box(1000, 0, 1440, 80), fills: solid(0, 0, 0) },
      { id: "2:2", name: "Card", type: "FRAME", ...box(1120, 100, 1200, 400), fills: solid(1, 0, 0) },
      { id: "2:3", name: "Badge", type: "FRAME", ...box(1100, 60, 40, 40), fills: solid(0, 1, 0) },
      { id: "2:4", name: "Footer", type: "FRAME", ...box(1000, 520, 1440, 160), fills: solid(0, 0, 1) },
    ],
  };
  const { html } = emitHtml(root, "t");
  expect(rule(html, "page__page")).toContain("width:100%");
  expect(rule(html, "page__page")).not.toContain("box-shadow"); // the frame's own shadow is not part of the page
  expect(rule(html, "page__page")).toContain("padding-bottom:20px");
  expect(rule(html, "page__nav")).toContain("width:100%");
  expect(rule(html, "page__card")).toContain("margin-top:20px");
  expect(rule(html, "page__card")).toContain("margin-left:calc(50% + -600px)");
  expect(rule(html, "page__footer")).toContain("margin-top:20px");
  expect(rule(html, "page__badge")).toContain("position:absolute");
  expect(rule(html, "page__badge")).toContain("left:calc(50% + -620px)");
  // Sections come in page order, the overlay first so it paints below nothing it should cover.
  expect(html.indexOf('class="page__nav"')).toBeLessThan(html.indexOf('class="page__card"'));
});

test("icons, masks and image layers are rendered; image backgrounds use the original file", () => {
  const vector = (id: string, x: number, y: number) => ({ id, name: "path", type: "VECTOR", ...box(x, y, 10, 10) });
  const root = {
    id: "1:1", name: "Card", type: "FRAME", ...box(0, 0, 300, 200),
    fills: [{ type: "IMAGE", imageRef: "abc123", scaleMode: "FILL" }],
    children: [
      { id: "2:1", name: "Icon", type: "FRAME", ...box(10, 10, 24, 24), children: [vector("3:1", 12, 12)] },
      { id: "2:2", name: "Photo", type: "RECTANGLE", ...box(50, 10, 100, 80), fills: [{ type: "IMAGE", imageRef: "def456", scaleMode: "STRETCH" }],
        effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 0 }, radius: 4 }] },
      { id: "2:3", name: "Masked", type: "GROUP", ...box(200, 10, 50, 50), children: [{ ...vector("3:2", 200, 10), isMask: true }, { id: "3:3", name: "Fill", type: "RECTANGLE", ...box(200, 10, 50, 50), fills: solid(1, 0, 0) }] },
    ],
  };
  const e = emitHtml(root, "t");
  expect(e.svg).toEqual(["2:1"]);
  expect(e.png).toEqual(["2:2", "2:3"]);
  expect(e.fills).toEqual(["abc123"]);
  // The photo's file covers its shadow: the image sits 4 px out from its box on every side.
  expect(e.html).toContain('left:-4px;top:-4px;width:108px;height:88px');
  const linked = linkAssets(e.html, { svg: (id) => `assets/svg/${id}.svg`, png: (id) => (id === "2:2" ? "assets/png/photo.png" : undefined), fill: (r) => `assets/fills/${r}.png` }, e.notes);
  expect(linked).toContain('src="assets/svg/2:1.svg"');
  expect(linked).toContain('src="assets/png/photo.png"');
  expect(linked).toContain('url("assets/fills/abc123.png")');
  expect(e.notes.some((n) => n.id === "2:3" && n.note.includes("did not render"))).toBe(true);
});

test("text keeps its styles, runs, line breaks and vertical alignment; fonts are listed", () => {
  const t = text("2:1", "Price\u2028Rp 90.000", 0, 0, {
    style: { fontFamily: "Poppins", fontWeight: 600, fontSize: 16, lineHeightPx: 24, letterSpacing: 0.5, textAlignHorizontal: "CENTER",
      textCase: "UPPER", textAutoResize: "NONE", textAlignVertical: "CENTER" },
    characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1],
    styleOverrideTable: { 1: { fontFamily: "Inter", fontWeight: 700, textDecoration: "STRIKETHROUGH" } },
  });
  const root = { id: "1:1", name: "Box", type: "FRAME", ...box(0, 0, 200, 60), children: [t] };
  const e = emitHtml(root, "t");
  const r = rule(e.html, "box__price-rp-90-000");
  for (const want of ['font-family:"Poppins",sans-serif', "font-weight:600", "line-height:24px", "letter-spacing:0.5px", "text-align:center", "text-transform:uppercase", "justify-content:center", "height:20px"]) {
    expect(r).toContain(want);
  }
  expect(e.html).toContain("Price<br>");
  expect(e.html).toContain("text-decoration:line-through");
  expect(e.fonts.sort()).toEqual(["Inter", "Poppins"]);
  expect(e.html).toContain("family=Poppins:wght@600");
  expect(e.html).toContain("family=Inter:wght@700");
});

test("strokes take no space, and a tilted radial gradient gets its own rotated layer", () => {
  const root = {
    id: "1:1", name: "Box", type: "FRAME", ...box(0, 0, 200, 100),
    strokes: solid(0, 0, 0), strokeWeight: 1, strokeAlign: "INSIDE", cornerRadius: 8,
    fills: [{
      type: "GRADIENT_RADIAL", gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.8 }, { x: 0.3, y: 0.7 }],
      gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }],
    }],
  };
  const e = emitHtml(root, "t");
  expect(rule(e.html, "box__box")).toContain("box-shadow:inset 0 0 0 1px #000000");
  expect(rule(e.html, "box__box")).toContain("border-radius:8px");
  expect(e.html).toMatch(/transform:rotate\(26\.57deg\)/);
  expect(e.notes.some((n) => n.note.includes("rotated radial"))).toBe(true);
});

test("a page-wide auto layout section keeps its padded content centred in a wider window", () => {
  const root = {
    id: "1:1", name: "Page", type: "FRAME", ...box(0, 0, 1440, 200), layoutMode: "VERTICAL", layoutSizingVertical: "HUG",
    children: [
      { id: "2:1", name: "Nav", type: "FRAME", ...box(0, 0, 1440, 80), layoutMode: "HORIZONTAL", paddingLeft: 100, paddingRight: 100,
        layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", children: [text("3:1", "Logo", 100, 30)] },
      { id: "2:2", name: "Card", type: "FRAME", ...box(0, 80, 600, 120), layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" },
    ],
  };
  const { html } = emitHtml(root, "t");
  expect(rule(html, "page__nav")).toContain("align-self:stretch");
  expect(rule(html, "page__nav")).toContain("max(100px, calc(50% - 620px))");
  expect(rule(html, "page__card")).toContain("width:600px");
  expect(rule(html, "page__card")).not.toContain("align-self:stretch");
});

test("texts share a class per style, and a layer named Text does not take the shared class", () => {
  const root = {
    id: "1:1", name: "Box", type: "FRAME", ...box(0, 0, 200, 60),
    children: [{ id: "2:1", name: "Text", type: "FRAME", ...box(0, 0, 100, 30), fills: solid(1, 0, 0), children: [text("3:1", "Hi", 0, 0)] }],
  };
  const { html } = emitHtml(root, "t");
  expect(html).toContain('class="box__text-2"');
  expect(html).toContain("box__text box__text--inter-400-14-20");
  expect(rule(html, "box__text")).toBe("");
});

test("a truncated text wraps and is cut at the last line its box holds", () => {
  const t = text("2:1", "Answer", 0, 0, {
    ...box(0, 0, 300, 80),
    style: { fontFamily: "Inter", fontWeight: 400, fontSize: 16, lineHeightPx: 24, textAutoResize: "TRUNCATE", textTruncation: "ENDING" },
  });
  const one = text("2:2", "One line only", 0, 90, {
    ...box(0, 90, 300, 24),
    style: { fontFamily: "Inter", fontWeight: 400, fontSize: 16, lineHeightPx: 24, textAutoResize: "TRUNCATE", textTruncation: "ENDING" },
  });
  const root = { id: "1:1", name: "Box", type: "FRAME", ...box(0, 0, 300, 120), children: [t, one] };
  const { html } = emitHtml(root, "t");
  const r = rule(html, "box__answer");
  expect(r).toContain("-webkit-line-clamp:3");
  expect(r).not.toContain("nowrap");
  expect(r).toContain("clip-path:inset(0 0 8px 0)");
  expect(rule(html, "box__one-line-only")).toContain("white-space:nowrap");
});

test("a gradient stroke is a masked ring over the box, outside strokes grow it", () => {
  const root = {
    id: "1:1", name: "Card", type: "FRAME", ...box(0, 0, 200, 100), cornerRadius: 16, strokeWeight: 2, strokeAlign: "OUTSIDE",
    strokes: [{
      type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 0.5 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } }],
    }],
    children: [text("2:1", "Hi", 10, 10)],
  };
  const e = emitHtml(root, "t");
  expect(rule(e.html, "card__card")).not.toContain("box-shadow");
  expect(e.html).toMatch(/<div style="position:absolute;inset:-2px;padding:2px;border-radius:18px;background:linear-gradient\([^"]*mask-composite:xor[^"]*"><\/div><\/div>/);
  expect(e.html.indexOf("Hi<")).toBeLessThan(e.html.indexOf("inset:-2px"));
  expect(e.notes.some((n) => n.note.includes("gradient stroke"))).toBe(false);
});
