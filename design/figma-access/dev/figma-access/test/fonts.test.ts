// Tests for the font stand-ins of `spec --html` (no network or browser needed).

import { test, expect } from "bun:test";
import { closest, samples, useStandIn } from "../src/fonts";

test("samples are one-line texts of the family whose box is the text's own width", () => {
  const t = (id: string, chars: string, family: string, extra: any = {}) => ({
    id, type: "TEXT", characters: chars, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
    style: { fontFamily: family, fontWeight: 700, fontSize: 24, textAutoResize: "WIDTH_AND_HEIGHT", textCase: "UPPER", ...extra },
  });
  const root = { id: "1:1", type: "FRAME", children: [
    t("2:1", "Promo", "Brand Sans"), t("2:2", "Two\nlines", "Brand Sans"), t("2:3", "Other", "Inter"),
    t("2:4", "Fixed", "Brand Sans", { textAutoResize: "NONE" }), { ...t("2:5", "Hidden", "Brand Sans"), visible: false },
  ] };
  expect(samples(root, "Brand Sans")).toEqual([{ text: "PROMO", width: 100, size: 24, weight: 700, spacing: 0 }]);
});

test("the closest candidate wins, and the page loads it behind the missing family", () => {
  expect(closest({ Inter: 1.06, Outfit: 0.99, Urbanist: 1.02 })).toEqual({ family: "Outfit", ratio: 0.99 });
  expect(closest({})).toBeUndefined();
  const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Brand+Sans:wght@400;700&amp;display=block">
<style>.a{font-family:"Brand Sans",sans-serif}</style><span style="font-family:'Brand Sans',sans-serif">x</span>`;
  const out = useStandIn(html, "Brand Sans", "Outfit", 0.99);
  expect(out).not.toContain("family=Brand+Sans");
  expect(out).toContain("family=Outfit:wght@400&amp;display=block");
  expect(out).toContain("family=Outfit:wght@700&amp;display=block");
  expect(out).toContain('font-family:"Brand Sans","Outfit",sans-serif');
  expect(out).toContain("font-family:'Brand Sans','Outfit',sans-serif");
  expect(out).toContain("1% narrower");
});
