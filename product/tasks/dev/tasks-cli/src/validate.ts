import fs from "node:fs";
import path from "node:path";
import { ANY_SPEC_ID, parseIndex, parseSpec, parseTask, read, type Task } from "./parse";
import { topoOrder } from "./graph";

export interface Loaded {
  dir: string;
  indexFile: string;
  tasks: Task[];
  problems: string[];
}

export function taskFiles(dir: string): string[] {
  const d = path.join(dir, "tasks");
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /^T\d{3,}-.+\.md$/.test(f)).sort().map((f) => path.join(d, f));
}

export function load(dir: string): Loaded {
  const indexFile = path.join(dir, "tasks.md");
  const problems: string[] = [];
  const tasks: Task[] = [];
  for (const f of taskFiles(dir)) {
    const r = parseTask(f);
    tasks.push(r.task);
    problems.push(...r.problems);
  }
  return { dir, indexFile, tasks, problems };
}

const IMPL_PATTERNS: [RegExp, string][] = [
  [/```/, "a code fence"],
  [/\b[\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|kt|swift|rb|php|cs|cpp|c|h|sql|yaml|yml|toml|sh)\b/, "a source file path"],
  [/\b[a-z_][a-z0-9_]*\([^)]*\)\s*(?:\{|;|=>)/i, "a function signature"],
];

export function validateSpecFile(file: string): string[] {
  if (!fs.existsSync(file)) return [`Specification not found: ${file}`];
  return parseSpec(read(file)).problems;
}

export function validateSet(dir: string, specFile: string | null): string[] {
  const loaded = load(dir);
  const problems = [...loaded.problems];
  const { tasks } = loaded;
  if (!fs.existsSync(loaded.indexFile)) return [`Index not found: ${loaded.indexFile}`, ...problems];
  if (!tasks.length) problems.push("No task files found under tasks/.");
  const idx = parseIndex(read(loaded.indexFile));
  problems.push(...idx.problems);

  const ids = tasks.map((t) => t.id);
  ids.forEach((id, i) => {
    const want = `T${String(i + 1).padStart(3, "0")}`;
    if (id !== want) problems.push(`Task IDs are not continuous from T001: expected ${want}, found ${id}.`);
  });
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of new Set(dup)) problems.push(`Task ID ${d} is used by more than one file.`);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    for (const b of t.blockers) {
      if (!byId.has(b)) problems.push(`${t.id}: blocker ${b} is not a task in this set.`);
      if (b === t.id) problems.push(`${t.id}: blocks itself.`);
      if (byId.get(b)?.requirement === "Optional" && t.requirement === "Required")
        problems.push(`${t.id}: required task is blocked by optional task ${b}.`);
    }
    const blockedByLine = t.blockedByRaw;
    for (const b of t.blockers) {
      const title = byId.get(b)?.title;
      if (title && !blockedByLine.includes(title)) problems.push(`${t.id}: \`Blocked by\` names ${b} without its title "${title}".`);
    }
    if (!t.criteria.length) problems.push(`${t.id}: no acceptance criteria checklist items.`);
    if (!t.traceability.length) problems.push(`${t.id}: no specification identifiers in its traceability.`);
    for (const c of t.criteria) if (c.text.length < 15) problems.push(`${t.id}: acceptance criterion too short to be observable: "${c.text}".`);
    for (const [re, what] of IMPL_PATTERNS) if (re.test(t.text) && t.references.length === 0) problems.push(`${t.id}: contains ${what}; tasks describe behavior, not implementation.`);
    if (t.slug && t.title) {
      const want = t.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (want && want !== t.slug) problems.push(`${t.id}: filename slug "${t.slug}" does not match the title (expected "${want}").`);
    }
    // inline reference citations must appear in the task's References section (absolute paths only).
    const inline = [...t.text.matchAll(/`(\/[^`\s]+)`/g)].map((m) => m[1]!);
    for (const c of inline) if (!t.references.includes(c)) problems.push(`${t.id}: citation ${c} is missing from its \`## References\`.`);
  }
  // Unblocks must agree with Blocked by.
  for (const t of tasks) {
    const want = tasks.filter((o) => o.blockers.includes(t.id)).map((o) => o.id).sort();
    const have = [...t.unblocks].sort();
    if (JSON.stringify(want) !== JSON.stringify(have))
      problems.push(`${t.id}: \`Unblocks\` is [${have.join(", ") || "None"}] but dependents say [${want.join(", ") || "None"}].`);
  }
  const { order, cycle } = topoOrder(tasks);
  if (cycle) problems.push(`Dependency cycle: ${cycle.join(" -> ")}.`);
  else {
    const pos = new Map(ids.map((id, i) => [id, i]));
    for (const t of tasks) for (const b of t.blockers) if ((pos.get(b) ?? -1) > pos.get(t.id)!) problems.push(`${t.id}: depends on later task ${b}; order blockers first.`);
    void order;
  }
  // Transitive-redundant edges.
  if (!cycle) {
    const reach = (from: string, skip: string, seen = new Set<string>()): Set<string> => {
      for (const b of byId.get(from)?.blockers ?? []) if (b !== skip && !seen.has(b)) { seen.add(b); reach(b, skip, seen); }
      return seen;
    };
    for (const t of tasks)
      for (const b of t.blockers) {
        const others = t.blockers.filter((x) => x !== b);
        if (others.some((o) => reach(o, "").has(b))) problems.push(`${t.id}: blocker ${b} is already implied by another blocker; drop the redundant edge.`);
      }
  }

  // Index agrees with the files.
  const rowIds = idx.rows.map((r) => r.id);
  if (JSON.stringify(rowIds) !== JSON.stringify(ids)) problems.push(`Dependency order table lists [${rowIds.join(", ")}] but task files are [${ids.join(", ")}].`);
  if (JSON.stringify([...idx.listed].sort()) !== JSON.stringify([...ids].sort())) problems.push(`The \`## Tasks\` list has [${idx.listed.join(", ")}] but task files are [${ids.join(", ")}].`);
  idx.rows.forEach((r, i) => {
    if (r.order !== i + 1) problems.push(`Dependency order row ${i + 1} has order number ${r.order}.`);
    const t = byId.get(r.id);
    if (!t) return;
    if (t.title !== r.title) problems.push(`${r.id}: index title "${r.title}" differs from the task title "${t.title}".`);
    const rb = r.blockedBy.match(/\bT\d{3,}\b/g) ?? [];
    if (JSON.stringify([...rb].sort()) !== JSON.stringify([...t.blockers].sort())) problems.push(`${r.id}: index blockers [${rb.join(", ")}] differ from the task's [${t.blockers.join(", ")}].`);
    if (r.requirement && r.requirement !== t.requirement) problems.push(`${r.id}: index says ${r.requirement} but the task says ${t.requirement}.`);
  });
  const union = [...new Set(tasks.flatMap((t) => t.references))].sort();
  if (JSON.stringify(union) !== JSON.stringify([...idx.references].sort())) problems.push("The index `## References` is not the union of the task references.");

  // Traceability against the specification.
  if (specFile) {
    if (!fs.existsSync(specFile)) problems.push(`Specification not found: ${specFile}`);
    else {
      const { spec, problems: sp } = parseSpec(read(specFile));
      for (const p of sp) problems.push(`Specification: ${p}`);
      const defined = new Set(spec.defined);
      for (const t of tasks) for (const id of t.traceability) if (!defined.has(id)) problems.push(`${t.id}: traceability names ${id}, which the specification does not define.`);
      const covered = new Set(tasks.flatMap((t) => t.traceability));
      const traced = new Map(idx.traceRows.map((r) => [r.id, r.tasks]));
      for (const id of spec.defined.filter((d) => d.startsWith("CAP-"))) {
        const optional = spec.capsOptional.has(id);
        if (!covered.has(id) && !optional) problems.push(`Required capability ${id} is covered by no task.`);
        if (!traced.has(id) && !optional) problems.push(`Required capability ${id} is missing from the index traceability table.`);
      }
      for (const [id, ts] of traced) {
        if (!defined.has(id)) problems.push(`Index traceability names ${id}, which the specification does not define.`);
        for (const tid of ts) if (!byId.get(tid)?.traceability.includes(id)) problems.push(`Index maps ${id} to ${tid}, but ${tid} does not list it.`);
      }
      const src = read(loaded.indexFile).match(/^> Source specification:\s*(.+)$/m);
      if (!src) problems.push("The index has no `> Source specification:` line.");
    }
  }
  void ANY_SPEC_ID;
  return problems;
}
