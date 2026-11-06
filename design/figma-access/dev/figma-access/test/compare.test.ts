// Tests for the PNG codec and `compare` on PNG inputs (no browser needed).
// Run in dev/figma-access: bun run build && bun test

import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { decodePng, encodePng, type Image } from "../src/png";
import { decode } from "../src/kdl";

const CLI = resolve(import.meta.dir, "../../../scripts/figma-access.js");
const DIR = mkdtempSync(join(tmpdir(), "figma-access-compare-"));

/** A white image with a dark block at (bx,by) of size bw x bh. */
function page(w: number, h: number, bx: number, by: number, bw: number, bh: number): Image {
  const data = new Uint8Array(w * h * 4).fill(255);
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) data.set([20, 40, 60, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

async function run(args: string[]) {
  const p = Bun.spawn(["bun", CLI, "compare", ...args, "-o", DIR], { cwd: DIR, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  await p.exited;
  return { code: p.exitCode, json: decode(text) as any };
}

test("PNG round trip keeps every pixel", () => {
  const img = page(37, 23, 5, 6, 10, 4);
  img.data[3] = 128; // some alpha
  const back = decodePng(encodePng(img));
  expect([back.width, back.height]).toEqual([37, 23]);
  expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
});

test("decodes RGB rows with every filter type", () => {
  // 3x5 RGB image, one row per filter type 0..4.
  const w = 3, h = 5;
  const px = Array.from({ length: w * h * 3 }, (_, i) => (i * 37 + 11) % 256);
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(y);
    for (let x = 0; x < w * 3; x++) {
      const v = px[y * w * 3 + x]!;
      const a = x >= 3 ? px[y * w * 3 + x - 3]! : 0;
      const b = y > 0 ? px[(y - 1) * w * 3 + x]! : 0;
      const c = x >= 3 && y > 0 ? px[(y - 1) * w * 3 + x - 3]! : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][y]!;
      raw.push((v - pred + 256) & 255);
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]); // CRC is not checked
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0)),
  ]);
  const img = decodePng(png);
  const rgb = [...img.data].filter((_, i) => i % 4 !== 3);
  expect(rgb).toEqual(px);
});

test("compare: identical images do not differ", async () => {
  const ref = join(DIR, "ref.png");
  writeFileSync(ref, encodePng(page(200, 120, 20, 30, 50, 20)));
  const { code, json } = await run([ref, ref, "--band", "60"]);
  expect(code).toBe(0);
  expect(json.whole.differing).toBe(0);
  expect(json.sections.map((s: any) => s.name)).toEqual(["0-60", "60-120"]);
});

test("compare: a section drawn 2 px lower is reported as a shift", async () => {
  const ref = join(DIR, "ref2.png"), cap = join(DIR, "cap2.png");
  writeFileSync(ref, encodePng(page(200, 120, 20, 30, 50, 20)));
  writeFileSync(cap, encodePng(page(200, 120, 20, 32, 50, 20)));
  const { json } = await run([ref, cap, "--sections", "block=10,20,80,40;empty=0-15"]);
  const block = json.sections.find((s: any) => s.name === "block");
  expect(block.differing).toBeGreaterThan(5);
  expect(block.shift).toEqual({ dx: 0, dy: 2, differing: 0 });
  expect(block.hint).toContain("2 px lower");
  expect(json.sections.find((s: any) => s.name === "empty").differing).toBe(0);
  expect(json.worst).toBe("block");
});

test("compare: a reference at scale 2 reports page pixels", async () => {
  const ref = join(DIR, "ref3.png"), cap = join(DIR, "cap3.png");
  writeFileSync(ref, encodePng(page(400, 240, 40, 60, 100, 40)));
  writeFileSync(cap, encodePng(page(400, 240, 44, 60, 100, 40)));
  const { json } = await run([ref, cap, "--width", "200", "--sections", "block=10,20,80,40"]);
  expect(json.page).toEqual([200, 120]);
  expect(json.sections[0].shift).toMatchObject({ dx: 2, dy: 0 });
});

test("compare: bad section and missing file are usage errors", async () => {
  const ref = join(DIR, "ref.png");
  writeFileSync(ref, encodePng(page(200, 120, 20, 30, 50, 20)));
  expect((await run([ref, ref, "--sections", "x=0,0,500,10"])).code).toBe(2);
  expect((await run([join(DIR, "nope.png"), ref])).code).toBe(2);
});

test("compare --wide: a page pinned to the left and a short background are both reported", async () => {
  // Design 200 px wide with a grey bar across its full width at the top.
  const ref = page(200, 100, 0, 0, 200, 10);
  const refPath = join(DIR, "wide-ref.png");
  writeFileSync(refPath, encodePng(ref));
  const pinned = join(DIR, "pinned.html");
  writeFileSync(pinned, `<body style="margin:0"><div style="width:200px;height:10px;background:rgb(20,40,60)"></div></body>`);
  const fluid = join(DIR, "fluid.html");
  writeFileSync(fluid, `<body style="margin:0"><div style="height:10px;background:rgb(20,40,60)"></div></body>`);
  const a = await run([refPath, pinned, "--wide", "400", "--wait", "500"]);
  if (a.code === 3) return; // no browser on this machine
  expect(a.json.wide.edgeDiffering).toBeGreaterThan(2);
  expect(a.json.wide.hint).toContain("stop short");
  const b = await run([refPath, fluid, "--wide", "400", "--wait", "500"]);
  expect(b.json.whole.differing).toBe(0);
  expect(b.json.wide.edgeDiffering).toBe(0);
}, 60000); // four browser launches

test("compare --nodes: text sitting 1 px higher is reported per style, a missing node too", async () => {
  // Frame at canvas (1000,2000), 200x120. Two text nodes of one style and an icon.
  const text = (id: string, x: number, y: number) => ({
    id, name: id, type: "TEXT", characters: "Label", style: { fontFamily: "Inter", fontWeight: 400, fontSize: 14, lineHeightPx: 20 },
    absoluteBoundingBox: { x: 1000 + x, y: 2000 + y, width: 40, height: 10 },
    absoluteRenderBounds: { x: 1000 + x, y: 2000 + y, width: 40, height: 10 },
  });
  const icon = {
    id: "9:1", name: "icon", type: "VECTOR",
    absoluteBoundingBox: { x: 1150, y: 2080, width: 12, height: 12 }, absoluteRenderBounds: { x: 1150, y: 2080, width: 12, height: 12 },
  };
  const frame = {
    id: "1:1", name: "Frame", type: "FRAME", clipsContent: true,
    absoluteBoundingBox: { x: 1000, y: 2000, width: 200, height: 120 }, absoluteRenderBounds: { x: 1000, y: 2000, width: 200, height: 120 },
    children: [text("2:1", 20, 30), text("2:2", 120, 30), icon],
  };
  const nodeFile = join(DIR, "nodes.json");
  writeFileSync(nodeFile, JSON.stringify({ nodes: { "1:1": { document: frame } } }));
  const draw = (blocks: [number, number, number, number][]) => {
    const img = page(200, 120, 0, 0, 0, 0);
    for (const [bx, by, bw, bh] of blocks) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) img.data.set([20, 40, 60, 255], (y * 200 + x) * 4);
    return img;
  };
  const ref = join(DIR, "n-ref.png"), cap = join(DIR, "n-cap.png");
  writeFileSync(ref, encodePng(draw([[20, 30, 40, 10], [120, 30, 40, 10], [150, 80, 12, 12]])));
  writeFileSync(cap, encodePng(draw([[20, 29, 40, 10], [120, 29, 40, 10]]))); // texts 1 px up, icon gone
  const { code, json } = await run([ref, cap, "--nodes", nodeFile]);
  expect(code).toBe(0);
  const style = json.nodes.styles.find((s: any) => s.style === "Inter 400 14/20");
  expect(style).toMatchObject({ count: 2, dy: -1, dx: 0, widthRatio: 1 });
  expect(style.hint).toContain("1 px higher");
  expect(json.nodes.list.find((n: any) => n.id === "9:1").missing).toBe(true);
  expect((await run([ref, cap, "--nodes", nodeFile, "--node", "7:7"])).code).toBe(2);
});

test("compare --nodes crops a reference that the node's own shadow widened", async () => {
  const frame = {
    id: "1:1", name: "Frame", type: "FRAME", children: [],
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
    effects: [{ type: "DROP_SHADOW", radius: 4, offset: { x: 0, y: 0 } }],
  };
  const nodeFile = join(DIR, "shadow.json");
  writeFileSync(nodeFile, JSON.stringify({ nodes: { "1:1": { document: frame } } }));
  const ref = join(DIR, "shadow-ref.png"), cap = join(DIR, "shadow-cap.png");
  writeFileSync(ref, encodePng(page(108, 58, 14, 14, 20, 10))); // block at 10,10 of the frame
  writeFileSync(cap, encodePng(page(100, 50, 10, 10, 20, 10)));
  const { json } = await run([ref, cap, "--nodes", nodeFile]);
  expect(json.page).toEqual([100, 50]);
  expect(json.crop).toContain("4,4,100,50");
  expect(json.whole.differing).toBe(0);
});

test("compare --nodes takes its sections from the node's children, opening up a wrapper", async () => {
  const box = (y: number, height: number) => ({ absoluteBoundingBox: { x: 0, y, width: 100, height } });
  const frame = {
    id: "1:1", name: "Page", type: "FRAME", ...box(0, 90),
    children: [{
      id: "1:2", name: "Wrapper", type: "FRAME", ...box(0, 90),
      children: [
        { id: "2:2", name: "Cards", type: "FRAME", ...box(30, 60) },
        { id: "2:1", name: "Nav", type: "FRAME", ...box(0, 30) },
        { id: "2:3", name: "Hidden", type: "FRAME", visible: false, ...box(0, 90) },
      ],
    }],
  };
  const nodeFile = join(DIR, "kids.json");
  writeFileSync(nodeFile, JSON.stringify({ nodes: { "1:1": { document: frame } } }));
  const ref = join(DIR, "kids-ref.png"), cap = join(DIR, "kids-cap.png");
  writeFileSync(ref, encodePng(page(100, 90, 10, 50, 20, 10)));
  writeFileSync(cap, encodePng(page(100, 90, 10, 50, 20, 10)));
  const { json } = await run([ref, cap, "--nodes", nodeFile]);
  expect(json.sections.map((s: any) => [s.name, ...s.box])).toEqual([["Nav", 0, 0, 100, 30], ["Cards", 0, 30, 100, 60]]);
  const banded = await run([ref, cap, "--nodes", nodeFile, "--band", "45"]);
  expect(banded.json.sections.map((s: any) => s.name)).toEqual(["0-45", "45-90"]);
});
