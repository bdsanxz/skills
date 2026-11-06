import { expect, test } from "bun:test";
import { color, exportBounds, layoutDrift, paint, textInfo } from "../src/spec";

const box = (x: number, y: number, width: number, height: number) => ({ absoluteBoundingBox: { x, y, width, height } });

test("color writes hex, or rgba when transparent", () => {
  expect(color({ r: 0, g: 0.10196, b: 0.2549 })).toBe("#001A41");
  expect(color({ r: 1, g: 1, b: 1, a: 0.5 })).toBe("rgba(255,255,255,0.5)");
});

test("linear gradient maps Figma handles onto the CSS gradient line of a non-square box", () => {
  const p = {
    type: "GRADIENT_LINEAR",
    gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }],
    gradientStops: [{ color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 }, { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }],
  };
  expect(paint(p, { w: 400, h: 100 })).toBe("linear-gradient(90deg, #FF0000 0%, #0000FF 100%)");
});

test("linear gradient follows a slanted handle 2: the equal-colour lines run along handle 0 → 2", () => {
  // From a real banner overlay: handles 0 → 1 point straight down, but handle 2 slants the
  // equal-colour lines, so the top-left corner is far darker than a plain 180deg gradient gives.
  const p = {
    type: "GRADIENT_LINEAR",
    gradientHandlePositions: [{ x: 0.518156, y: 0.194444 }, { x: 0.518157, y: 0.852349 }, { x: 0.200031, y: 0.005542 }],
    gradientStops: [{ color: { r: 0, g: 0, b: 0, a: 0.1 }, position: 0 }, { color: { r: 0.2, g: 0.2, b: 0.2, a: 1 }, position: 1 }],
  };
  expect(paint(p, { w: 358, h: 180 })).toBe("linear-gradient(197deg, rgba(0,0,0,0.1) 30.31%, #333333 71.22%)");
});

test("radial gradient carries its centre and radii in pixels", () => {
  const p = {
    type: "GRADIENT_RADIAL",
    gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }],
    gradientStops: [{ color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 }, { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 }],
  };
  expect(paint(p, { w: 200, h: 100 })).toBe("radial-gradient(100px 50px at 100px 50px, #FFFFFF 0%, #000000 100%)");
});

test("radial gradient whose first handle points down writes the radii in CSS order", () => {
  // First handle 443 px straight down, second 2769 px to the left: a wide, flat ellipse.
  const p = {
    type: "GRADIENT_RADIAL",
    gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 + 443 / 325 }, { x: 0.5 - 2769 / 1139, y: 0.5 }],
    gradientStops: [{ color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 }, { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 }],
  };
  expect(paint(p, { w: 1139, h: 325 })).toBe("radial-gradient(2769px 443px at 569.5px 162.5px, #FFFFFF 0%, #000000 100%)");
});

test("a rotated radial gradient is marked with its angle", () => {
  const p = {
    type: "GRADIENT_RADIAL",
    gradientHandlePositions: [{ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { x: -0.1, y: 0.1 }],
    gradientStops: [{ color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 }, { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 }],
  };
  expect(paint(p, { w: 100, h: 100 })).toBe("radial-gradient(42.43px 14.14px at 0px 0px, #FFFFFF 0%, #000000 100%) ROTATED 45deg");
});

test("layoutDrift flags a hug frame that still counts a hidden child", () => {
  const n = { layoutMode: "VERTICAL", itemSpacing: 16, layoutSizingVertical: "HUG", ...box(0, 0, 100, 88), children: [{ ...box(0, 0, 100, 48) }, { visible: false, ...box(0, 64, 100, 24) }] };
  expect(layoutDrift(n)).toBe("hugs 88 but its stored items add up to 48");
  expect(layoutDrift({ ...n, ...box(0, 0, 100, 48) })).toBeNull();
});

test("layoutDrift flags a fill child stored at another size than the frame gives it", () => {
  const child = { name: "Inner", layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL", ...box(0, 0, 326, 48) };
  const n = { layoutMode: "VERTICAL", paddingLeft: 0, paddingRight: 0, ...box(0, 0, 100, 48), children: [child] };
  expect(layoutDrift(n)).toBe('"Inner" fills 100 but is stored 326 wide');
  expect(layoutDrift({ ...n, children: [{ ...child, ...box(0, 0, 100, 48) }] })).toBeNull();
});

test("exportBounds grows by shadows and shrinks to masks", () => {
  const shadowed = { type: "FRAME", ...box(0, 0, 40, 40), effects: [{ type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 4, spread: 0 }] };
  expect(exportBounds(shadowed)).toEqual({ x: -4, y: 0, w: 48, h: 48 });
  const masked = { type: "GROUP", ...box(0, 0, 100, 100), children: [{ isMask: true, ...box(10, 10, 20, 20) }, { ...box(0, 0, 100, 100) }] };
  expect(exportBounds(masked)).toEqual({ x: 10, y: 10, w: 20, h: 20 });
});

test("saved .kdl files read back to the same data as JSON", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readData, writeData } = await import("../src/util");
  const dir = mkdtempSync(join(tmpdir(), "figma-access-kdl-"));
  const data = { nodes: { "1:2": { document: { id: "1:2", name: "Card, \"main\"", children: [{ id: "1:3", fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] }] } } } };
  writeData(join(dir, "n.kdl"), data);
  expect(readData(join(dir, "n.kdl"))).toEqual(data);
});

test("KDL output round-trips JSON values, including awkward keys and strings", async () => {
  const { decode, encode } = await import("../src/kdl");
  const data = { ok: true, key: "71z", empty: [], emptyObj: {}, one: ["x"], mixed: [1, { a: 1 }], none: null, text: "a b \"q\" \\ \t", true: "true", nodes: { "1:2": { document: { id: "1:2", "-": 3 } } }, nested: [[1, 2], []] };
  expect(decode(encode(data))).toEqual(data);
  expect(encode({ frames: [{ id: "1:2", name: "Card", type: "FRAME" }] })).toBe('(array)frames {\n  - id="1:2" name=Card type=FRAME\n}');
});

test("textInfo names the vertical alignment of a fixed-height text box", () => {
  const base = { fontFamily: "Inter", fontWeight: 700, fontSize: 18, lineHeightPx: 24, textAlignVertical: "CENTER" };
  expect(textInfo({ characters: "Title", style: base })).toContain("valign center");
  expect(textInfo({ characters: "Title", style: { ...base, textAutoResize: "HEIGHT" } })).not.toContain("valign center");
  expect(textInfo({ characters: "Title", style: { ...base, textAlignVertical: "TOP" } }).some((p) => p.startsWith("valign"))).toBe(false);
});
