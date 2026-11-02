import fs from "node:fs";
import path from "node:path";

export const SECTIONS = [
  "## 1. Overview",
  "## 2. Actors and authority",
  "## 3. Scope and non-goals",
  "## 4. End-to-end journey",
  "## 5. Capability contracts",
  "## 6. State model and transitions",
  "## 7. Cross-experience interactions",
  "## 8. Information, truth, and uncertainty",
  "## 9. Validation, review, finalization, and revision",
  "## 10. Failure and recovery",
  "## 11. Edge cases and quality expectations",
  "## 12. Final expected experience and success criterion",
];

export const ID_FAMILIES = [
  { key: "CAP", re: /CAP-\d{3}/g, digits: 3, section: 5 },
  { key: "J", re: /\bJ-\d{2}\b/g, digits: 2, section: 4 },
  { key: "STATE", re: /STATE-\d{2}/g, digits: 2, section: 6 },
  { key: "INT", re: /INT-\d{3}/g, digits: 3, section: 7 },
  { key: "REC", re: /REC-\d{3}/g, digits: 3, section: 10 },
] as const;

export const ANY_SPEC_ID = /\b(?:CAP-\d{3}|J-\d{2}|STATE-\d{2}|INT-\d{3}|REC-\d{3})\b/g;

export function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** Text under a heading line, up to the next heading of the same or higher level. */
export function sectionBody(text: string, heading: string): string | null {
  const lines = text.split("\n");
  const level = heading.match(/^#+/)![0].length;
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#+)\s/);
    if (m && m[1]!.length <= level && !inFence(lines, i)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function inFence(lines: string[], idx: number): boolean {
  let open = false;
  for (let i = 0; i < idx; i++) if (/^\s*```/.test(lines[i]!)) open = !open;
  return open;
}

export interface Spec {
  title: string;
  /** Identifiers defined by a heading or a table row's first cell, in order, with duplicates kept. */
  defined: string[];
  /** Every identifier mentioned anywhere. */
  mentioned: Set<string>;
  capsOptional: Set<string>;
}

export function parseSpec(text: string): { spec: Spec; problems: string[] } {
  const problems: string[] = [];
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const tm = first.match(/^# Specification:\s*(.+)$/);
  if (!tm) problems.push("The first line is not `# Specification: <title>`.");
  const headings = text.split("\n").filter((l) => /^## /.test(l)).map((l) => l.trim());
  const sectionsHere = headings.filter((h) => /^## \d+\. /.test(h));
  if (JSON.stringify(sectionsHere) !== JSON.stringify(SECTIONS)) {
    const missing = SECTIONS.filter((s) => !sectionsHere.includes(s));
    problems.push(
      missing.length
        ? `Missing required sections: ${missing.join("; ")}.`
        : "The twelve required sections are not in the required order, or an extra numbered `##` section exists.",
    );
  }
  const extra = headings.filter((h) => !SECTIONS.includes(h));
  if (extra.length) problems.push(`Extra top-level sections are not allowed: ${extra.join("; ")}.`);

  const defined: string[] = [];
  for (const line of text.split("\n")) {
    const h = line.match(/^#{3,}\s+`?((?:CAP-\d{3}|J-\d{2}|STATE-\d{2}|INT-\d{3}|REC-\d{3}))`?/);
    const r = line.match(/^\|\s*`?((?:CAP-\d{3}|J-\d{2}|STATE-\d{2}|INT-\d{3}|REC-\d{3}))`?\s*\|/);
    const b = line.match(/^[-*]\s+\*\*`?((?:CAP-\d{3}|J-\d{2}|STATE-\d{2}|INT-\d{3}|REC-\d{3}))`?\*\*/);
    const rowIsRef = r && (line.slice(line.indexOf("|", 1)).match(ANY_SPEC_ID) ?? []).length > 0;
    const id = (h ?? (rowIsRef ? null : r) ?? b)?.[1];
    if (id) defined.push(id);
  }
  const seen = new Set<string>();
  for (const id of defined) {
    if (seen.has(id)) problems.push(`Identifier ${id} is defined more than once.`);
    seen.add(id);
  }
  for (const fam of ID_FAMILIES) {
    const ids = defined.filter((d) => d.match(new RegExp(`^${fam.key}-\\d+$`)));
    ids.forEach((id, i) => {
      const want = `${fam.key}-${String(i + 1).padStart(fam.digits, "0")}`;
      if (id !== want && !problems.some((p) => p.startsWith(`${fam.key} identifiers`)))
        problems.push(`${fam.key} identifiers are not sequential from ${fam.key}-${"1".padStart(fam.digits, "0")}: expected ${want}, found ${id}.`);
    });
  }
  if (!defined.some((d) => d.startsWith("CAP-"))) problems.push("No `CAP-*` capability is defined.");
  const mentioned = new Set(text.match(ANY_SPEC_ID) ?? []);
  const optional = new Set<string>();
  const capBody = sectionBody(text, "## 5. Capability contracts") ?? "";
  const blocks = capBody.split(/\n(?=###\s)/);
  for (const blk of blocks) {
    const id = blk.match(/^###\s+`?(CAP-\d{3})`?/)?.[1];
    if (id && /^- \*\*Status:\*\*\s*Optional/im.test(blk)) optional.add(id);
  }
  return { spec: { title: tm?.[1]?.trim() ?? "", defined, mentioned, capsOptional: optional }, problems };
}

export interface Task {
  file: string;
  id: string;
  slug: string;
  title: string;
  requirement: string;
  blockedByRaw: string;
  blockers: string[];
  external: string[];
  unblocks: string[];
  traceability: string[];
  criteria: { checked: boolean; text: string }[];
  references: string[];
  headings: string[];
  text: string;
}

const REQUIRED_TASK_HEADINGS = [
  "## Specification traceability",
  "## What to build",
  "## Why this slice exists",
  "## Scope boundary",
  "## Acceptance criteria",
  "## Verification notes",
  "## Out of scope",
  "## References",
];
export { REQUIRED_TASK_HEADINGS };

export function parseTask(file: string): { task: Task; problems: string[] } {
  const text = read(file);
  const base = path.basename(file, ".md");
  const problems: string[] = [];
  const fm = base.match(/^(T\d{3,})-(.+)$/);
  const tm = text.match(/^# (T\d{3,}) — (.+)$/m);
  if (!fm) problems.push(`${base}: the filename is not <TNNN>-<slug>.md.`);
  if (!tm) problems.push(`${base}: the title is not \`# TNNN — <title>\`.`);
  else if (fm && tm[1] !== fm[1]) problems.push(`${base}: the title says ${tm[1]} but the filename says ${fm[1]}.`);
  const id = tm?.[1] ?? fm?.[1] ?? base;
  const field = (name: string) => text.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  const blockedByRaw = field("Blocked by");
  if (!blockedByRaw) problems.push(`${id}: the \`**Blocked by:**\` line is missing.`);
  const unblocksRaw = field("Unblocks");
  if (!unblocksRaw) problems.push(`${id}: the \`**Unblocks:**\` line is missing.`);
  const requirement = field("Required or optional");
  if (!/^(Required|Optional)$/.test(requirement)) problems.push(`${id}: \`Required or optional\` must be Required or Optional.`);
  const blockers = blockedByRaw.startsWith("External") ? [] : [...new Set(blockedByRaw.match(/\bT\d{3,}\b/g) ?? [])];
  const external = blockedByRaw.startsWith("External") ? [blockedByRaw] : [];
  if (!blockedByRaw.startsWith("None") && !blockedByRaw.startsWith("External") && !blockers.length && blockedByRaw)
    problems.push(`${id}: \`Blocked by\` names no task ID and is not "None" or "External prerequisite".`);
  const unblocks = [...new Set(unblocksRaw.match(/\bT\d{3,}\b/g) ?? [])];
  const headings = text.split("\n").filter((l) => /^## /.test(l)).map((l) => l.trim());
  for (const h of REQUIRED_TASK_HEADINGS) if (!headings.includes(h)) problems.push(`${id}: missing section \`${h}\`.`);
  const trace = sectionBody(text, "## Specification traceability") ?? "";
  const traceability = [...new Set(trace.match(ANY_SPEC_ID) ?? [])];
  const ac = sectionBody(text, "## Acceptance criteria") ?? "";
  const criteria = ac
    .split("\n")
    .map((l) => l.match(/^- \[( |x|X)\]\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ checked: m[1] !== " ", text: m[2]!.trim() }));
  const refs = (sectionBody(text, "## References") ?? "").split("\n").map((l) => l.trim().replace(/^[-*]\s*/, "").replace(/^`|`$/g, "")).filter((l) => l && l !== "None");
  return {
    task: { file, id, slug: fm?.[2] ?? "", title: tm?.[2]?.trim() ?? "", requirement, blockedByRaw, blockers, external, unblocks, traceability, criteria, references: refs, headings, text },
    problems,
  };
}

export interface IndexRow {
  order: number;
  id: string;
  title: string;
  blockedBy: string;
  requirement: string;
}

function tableRows(body: string): string[][] {
  return body
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*-/.test(l.trim()))
    .slice(1)
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}

export function parseIndex(text: string): { rows: IndexRow[]; listed: string[]; traceRows: { id: string; tasks: string[] }[]; references: string[]; problems: string[] } {
  const problems: string[] = [];
  if (!/^# Tasks — .+/m.test(text)) problems.push("tasks.md: the first heading is not `# Tasks — <Specification title>`.");
  for (const h of ["## Source and scope", "## Dependency order", "## Tasks", "## Traceability", "## References"])
    if (!text.split("\n").some((l) => l.trim() === h)) problems.push(`tasks.md: missing section \`${h}\`.`);
  const rows = tableRows(sectionBody(text, "## Dependency order") ?? "").map((c): IndexRow => {
    const id = c[1]?.match(/\bT\d{3,}\b/)?.[0] ?? "";
    return { order: Number(c[0]), id, title: c[2] ?? "", blockedBy: c[3] ?? "", requirement: c[4] ?? "" };
  });
  const listed = [...(sectionBody(text, "## Tasks") ?? "").matchAll(/^- \[(T\d{3,}) — /gm)].map((m) => m[1]!);
  const traceRows = tableRows(sectionBody(text, "## Traceability") ?? "").map((c) => ({
    id: c[0]?.replace(/`/g, "") ?? "",
    tasks: c[1]?.match(/\bT\d{3,}\b/g) ?? [],
  }));
  const references = (sectionBody(text, "## References") ?? "").split("\n").map((l) => l.trim().replace(/^[-*]\s*/, "").replace(/^`|`$/g, "")).filter((l) => l && l !== "None");
  return { rows, listed, traceRows, references, problems };
}
