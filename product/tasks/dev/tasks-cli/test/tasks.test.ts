import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SECTIONS } from "../src/parse";

const MAIN = path.join(import.meta.dir, "..", "src", "main.ts");
let cwd = "";

function tasks(...args: string[]) {
  const r = Bun.spawnSync(["bun", MAIN, ...args], { cwd });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

function write(rel: string, text: string) {
  const f = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

const SPEC =
  "# Specification: Demo\n\n" +
  SECTIONS.map((s) => {
    if (s.startsWith("## 5.")) return `${s}\n\n### \`CAP-001\` — Create a draft\n\n- **Status:** Required.\n\n### \`CAP-002\` — Share a draft\n\n- **Status:** Optional.\n`;
    if (s.startsWith("## 4.")) return `${s}\n\n| ID | Trigger |\n|---|---|\n| \`J-01\` | The owner creates a draft. |\n`;
    if (s.startsWith("## 6.")) return `${s}\n\n| ID | State |\n|---|---|\n| \`STATE-01\` | Draft |\n`;
    return `${s}\n\nText.\n`;
  }).join("\n");

function task(n: number, title: string, blocked: string, unblocks: string, cap: string, req = "Required", extra = "") {
  const id = `T${String(n).padStart(3, "0")}`;
  return `# ${id} — ${title}

> Source specification: Demo

**Required or optional:** ${req}

**Blocked by:** ${blocked}

**Unblocks:** ${unblocks}

## Specification traceability

- Capabilities: \`${cap}\`
- Journey steps: \`J-01\`
- States: \`STATE-01\`
- Interactions: None
- Recovery scenarios: None

## What to build

The owner does a thing and sees the result.${extra}

## Why this slice exists

It is the first visible outcome.

## Scope boundary

Only this outcome.

## Acceptance criteria

- [ ] When the owner submits the form, the draft appears in the list.
- [ ] When the owner submits an empty form, a correction message appears.

## Verification notes

Walk through the flow.

## Out of scope

- Sharing.

## References

None
`;
}

function indexFile(rows: string[], trace: string[]) {
  return `# Tasks — Demo

> Source specification: _swe/specifications/demo/specification.md
> Name: demo

## Source and scope

Demo.

## Dependency order

| Order | Task | Title | Blocked by | Required or optional | Outcome |
|---|---|---|---|---|---|
${rows.join("\n")}

## Tasks

${rows.map((r) => { const c = r.split("|").map((x) => x.trim()); return `- [${c[2]!.match(/T\d+/)![0]} — ${c[3]}](x) — o`; }).join("\n")}

## Traceability

| Specification identifier | Covered by | Coverage note |
|---|---|---|
${trace.join("\n")}

## References

None
`;
}

function good() {
  write("_swe/specifications/demo/specification.md", SPEC);
  write("_swe/tasks/demo/tasks/T001-create-a-draft.md", task(1, "Create a draft", "None — can start immediately", "T002", "CAP-001"));
  write("_swe/tasks/demo/tasks/T002-edit-a-draft.md", task(2, "Edit a draft", "T001 Create a draft", "T003", "CAP-001"));
  write("_swe/tasks/demo/tasks/T003-share-a-draft.md", task(3, "Share a draft", "T002 Edit a draft", "None", "CAP-002", "Optional"));
  write(
    "_swe/tasks/demo/tasks.md",
    indexFile(
      [
        "| 1 | [T001](x) | Create a draft | None — can start immediately | Required | o |",
        "| 2 | [T002](x) | Edit a draft | T001 | Required | o |",
        "| 3 | [T003](x) | Share a draft | T002 | Optional | o |",
      ],
      ["| `CAP-001` | `T001`, `T002` | n |", "| `CAP-002` | `T003` | n |"],
    ),
  );
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-test-"));
  good();
});

describe("validate-spec", () => {
  test("accepts a valid specification", () => {
    expect(tasks("validate-spec", "demo").code).toBe(0);
  });
  test("rejects a missing section and a duplicate identifier", () => {
    write("_swe/specifications/demo/specification.md", SPEC.replace("## 8. Information, truth, and uncertainty", "## 8. Other").replace("### `CAP-002`", "### `CAP-001`"));
    const r = tasks("validate-spec", "demo");
    expect(r.code).toBe(1);
    expect(r.out).toContain("Missing required sections");
    expect(r.out).toContain("CAP-001 is defined more than once");
  });
});

describe("validate", () => {
  test("accepts a consistent set", () => {
    const r = tasks("validate");
    expect(r.out).toContain("is valid");
    expect(r.code).toBe(0);
  });
  test("reports a cycle", () => {
    write("_swe/tasks/demo/tasks/T001-create-a-draft.md", task(1, "Create a draft", "T003 Share a draft", "T002", "CAP-001"));
    expect(tasks("validate").out).toContain("Dependency cycle");
  });
  test("reports a required task blocked by an optional one", () => {
    write("_swe/tasks/demo/tasks/T001-create-a-draft.md", task(1, "Create a draft", "T003 Share a draft", "T002", "CAP-001"));
    expect(tasks("validate").out).toContain("required task is blocked by optional task T003");
  });
  test("reports an uncovered required capability", () => {
    write("_swe/tasks/demo/tasks/T002-edit-a-draft.md", task(2, "Edit a draft", "T001 Create a draft", "T003", "CAP-002"));
    write("_swe/tasks/demo/tasks/T001-create-a-draft.md", task(1, "Create a draft", "None — can start immediately", "T002", "CAP-002"));
    expect(tasks("validate").out).toContain("Required capability CAP-001 is covered by no task");
  });
  test("reports unknown specification identifiers and Unblocks mismatches", () => {
    write("_swe/tasks/demo/tasks/T001-create-a-draft.md", task(1, "Create a draft", "None — can start immediately", "None", "CAP-009"));
    const out = tasks("validate").out;
    expect(out).toContain("CAP-009, which the specification does not define");
    expect(out).toContain("`Unblocks` is [None] but dependents say [T002]");
  });
  test("reports a missing blocker, a redundant edge and a later dependency", () => {
    write("_swe/tasks/demo/tasks/T003-share-a-draft.md", task(3, "Share a draft", "T001 Create a draft, T002 Edit a draft, T009 Ghost", "None", "CAP-002", "Optional"));
    const out = tasks("validate").out;
    expect(out).toContain("T009 is not a task in this set");
    expect(out).toContain("already implied");
  });
  test("reports implementation detail and index drift", () => {
    write("_swe/tasks/demo/tasks/T001-create-a-draft.md", task(1, "Create a draft", "None — can start immediately", "T002", "CAP-001", "Edit src/app/draft.ts."));
    const idx = fs.readFileSync(path.join(cwd, "_swe/tasks/demo/tasks.md"), "utf8").replace("| 3 | [T003](x) | Share a draft | T002 | Optional | o |\n", "");
    write("_swe/tasks/demo/tasks.md", idx);
    const out = tasks("validate").out;
    expect(out).toContain("a source file path");
    expect(out).toContain("Dependency order table lists");
  });
});

describe("tracker", () => {
  test("status and next follow the graph", () => {
    expect(tasks("status").out).toContain("T001  ready");
    expect(tasks("status").out).toContain("T002  blocked");
    const n = tasks("next").out;
    expect(n).toContain("T001 Create a draft");
    expect(n).toContain("Longest remaining chain: T001 -> T002 -> T003");
  });
  test("start and done respect blockers and checklists", () => {
    expect(tasks("start", "T002").code).toBe(1);
    expect(tasks("start", "T001").out).toContain("started");
    expect(tasks("status").out).toContain("T001  in-progress");
    const early = tasks("done", "T001");
    expect(early.code).toBe(1);
    expect(early.out).toContain("2 acceptance criteria unchecked");
    const f = path.join(cwd, "_swe/tasks/demo/tasks/T001-create-a-draft.md");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replaceAll("- [ ]", "- [x]"));
    const ok = tasks("done", "T001");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("Now ready: T002");
    expect(tasks("status").out).toContain("T001  done");
    expect(tasks("reopen", "T001").code).toBe(0);
    expect(tasks("status").out).toContain("T001  ready");
  });
  test("graph prints Mermaid", () => {
    const g = tasks("graph").out;
    expect(g).toContain("flowchart TD");
    expect(g).toContain("T001 --> T002");
  });
  test("wrong calls exit 2 with an actionable message", () => {
    expect(tasks("done", "T099").code).toBe(2);
    expect(tasks("status", "--set", "Nope").out).toContain("kebab-case");
    expect(tasks("frobnicate").code).toBe(2);
    expect(tasks("status", "--bogus").code).toBe(2);
  });
});
