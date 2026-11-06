// Fonts for `spec --html`: find the families Google Fonts does not have, and give each one the
// Google family whose text comes out closest to the design's widths, measured in headless Chrome.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromePath } from "./compare";

/** Sans families tried as stand-ins, from narrow to wide. */
export const CANDIDATES = [
  "Inter", "Roboto", "Open Sans", "Lato", "Work Sans", "DM Sans", "Figtree", "Manrope", "Nunito Sans", "Mulish",
  "Rubik", "Outfit", "Urbanist", "Plus Jakarta Sans", "Lexend", "Sora", "Montserrat", "Raleway", "Poppins",
];

export interface Sample { text: string; width: number; size: number; weight: number; spacing: number }
export interface StandIn { family: string; standIn?: string; ratio?: number; samples: number; note?: string }

const googleUrl = (family: string, weight?: number) =>
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}${weight ? `:wght@${weight}` : ""}&display=block`;

/** Whether Google Fonts serves the family; undefined when Google cannot be reached. */
export async function googleHas(family: string): Promise<boolean | undefined> {
  try {
    const r = await fetch(googleUrl(family), { signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch {
    return undefined;
  }
}

/** One-line texts of the family whose box is the text's own width: the widths to match. */
export function samples(root: any, family: string, max = 40): Sample[] {
  const list: Sample[] = [];
  const walk = (n: any) => {
    if (n.visible === false || list.length >= max) return;
    const s = n.style;
    if (
      n.type === "TEXT" && s?.fontFamily === family && s.textAutoResize === "WIDTH_AND_HEIGHT" &&
      !(n.characterStyleOverrides ?? []).some((x: number) => x) && n.absoluteBoundingBox?.width > 8
    ) {
      let text = String(n.characters ?? "");
      if (!/[\n\u2028\u2029]/.test(text) && text.trim()) {
        if (s.textCase === "UPPER") text = text.toUpperCase();
        else if (s.textCase === "LOWER") text = text.toLowerCase();
        list.push({ text, width: n.absoluteBoundingBox.width, size: s.fontSize ?? 16, weight: Math.round((s.fontWeight ?? 400) / 100) * 100 || 400, spacing: s.letterSpacing ?? 0 });
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return list;
}

/** Median width ratio (page / design) of the samples in each candidate, measured in Chrome. */
export async function measureCandidates(list: Sample[], candidates = CANDIDATES, waitMs = 20000): Promise<Record<string, number> | undefined> {
  const chrome = chromePath();
  if (!chrome || !list.length) return undefined;
  const weights = [...new Set(list.map((s) => s.weight))];
  const links = candidates.flatMap((c) => weights.map((w) => `<link rel="stylesheet" href="${googleUrl(c, w).replace(/&/g, "&amp;")}">`));
  const script = `
const S = ${JSON.stringify(list)}, C = ${JSON.stringify(candidates)};
(async () => {
  const ctx = document.createElement("canvas").getContext("2d"), out = {};
  for (const c of C) {
    const r = [];
    for (const s of S) {
      const spec = s.weight + " " + s.size + "px \\"" + c + "\\"";
      try { await document.fonts.load(spec, s.text); } catch {}
      const has = [...document.fonts].some((f) => f.family.replace(/"/g, "") === c && f.status === "loaded" && String(f.weight) === String(s.weight));
      if (!has) continue;
      ctx.font = spec;
      r.push((ctx.measureText(s.text).width + s.spacing * [...s.text].length) / s.width);
    }
    if (r.length) out[c] = r.sort((a, b) => a - b)[Math.floor(r.length / 2)];
  }
  document.getElementById("out").textContent = JSON.stringify(out);
})();`;
  const dir = mkdtempSync(join(tmpdir(), "figma-access-fonts-"));
  try {
    const page = join(dir, "fonts.html");
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">${links.join("")}</head><body><pre id="out"></pre><script>${script}</script></body></html>`);
    const p = Bun.spawn(
      [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir, "profile")}`,
        `--virtual-time-budget=${waitMs}`, "--dump-dom", pathToFileURL(page).href],
      { stdout: "pipe", stderr: "ignore" },
    );
    const timer = setTimeout(() => p.kill(), waitMs + 60000);
    const dom = await new Response(p.stdout).text();
    await p.exited;
    clearTimeout(timer);
    const m = /<pre id="out">([^<]*)<\/pre>/.exec(dom);
    if (!m || !m[1]!.trim()) return undefined;
    return JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The candidate whose median width ratio is closest to 1. */
export function closest(ratios: Record<string, number>): { family: string; ratio: number } | undefined {
  const best = Object.entries(ratios).sort((a, b) => Math.abs(a[1] - 1) - Math.abs(b[1] - 1))[0];
  return best ? { family: best[0], ratio: Math.round(best[1] * 1000) / 1000 } : undefined;
}

/**
 * Puts the stand-in right after the missing family in every font-family list, and loads it from
 * Google instead of the missing family; the real font takes over once its files are added.
 */
export function useStandIn(html: string, family: string, standIn: string, ratio: number): string {
  const enc = encodeURIComponent(family).replace(/%20/g, "+").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = new RegExp(`<link rel="stylesheet" href="https://fonts\\.googleapis\\.com/css2\\?family=${enc}:wght@([\\d;]+)&amp;display=block">`);
  const weights = (link.exec(html)?.[1] ?? "400").split(";");
  const links = weights.map((w) => `<link rel="stylesheet" href="${googleUrl(standIn, Number(w)).replace(/&/g, "&amp;")}">`).join("\n");
  const comment = `<!-- "${family}" is not on Google Fonts: "${standIn}" stands in for it (its texts come out ${Math.round(Math.abs(ratio - 1) * 1000) / 10}% ${ratio >= 1 ? "wider" : "narrower"}). Add the real files with @font-face and they take over. -->`;
  return html
    .replace(link, `${comment}\n${links}`)
    .split(`font-family:"${family}",`).join(`font-family:"${family}","${standIn}",`)
    .split(`font-family:'${family}',`).join(`font-family:'${family}','${standIn}',`);
}
