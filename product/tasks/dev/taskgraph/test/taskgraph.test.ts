// Tests for the taskgraph script. Run: bun test (in dev/taskgraph)
//
// Every test writes its documents into its own temporary directory. The last tests run the
// built scripts/taskgraph.js as a real process.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMMANDS, main } from "../src/commands";
import { io, splitLines, utf8Error } from "../src/core";
import { parse, validate } from "../src/graph";

const SKILL = path.resolve(import.meta.dir, "..", "..", "..");
const SCRIPT = path.join(SKILL, "scripts", "taskgraph.js");
const EXAMPLE = path.join(SKILL, "examples", "expense-reports.md");

// ------------------------------------------------------------------------- document builders

type TaskOptions = {
  title?: string;
  needs?: string | null;
  ticks?: string;
  extra?: string;
  path?: string;
  status?: string | null;
  because?: boolean;
};

function task(id: string, options: TaskOptions = {}) {
  const { title = "Does a thing", ticks = "- [ ] It works.", extra = "", path: kind = "Happy", because = true } = options;
  const needs = options.needs === undefined ? "none" : options.needs;
  const status = options.status === undefined ? "Required" : options.status;
  const lines = [`### ${id}. ${title}`, "", "- **Actor**: Member", `- **Path**: ${kind}`];
  if (status !== null) lines.push(`- **Status**: ${status}`);
  lines.push("- **Source**: R1");
  if (needs !== null) {
    lines.push(`- **Needs**: ${needs}`);
    if (because && !["none", "-", ""].includes(needs.trim().toLowerCase())) {
      lines.push("- **Needs because**: its behavior cannot be seen without them.");
    }
  }
  lines.push("", `**Scenario**: Given a, when b, then c.${extra}`, "", "**Acceptance criteria**", "", ticks, "");
  return lines.join("\n");
}

function doc(tasks: string[], { questions = "", coverage }: { questions?: string; coverage?: string } = {}) {
  const ids = tasks.flatMap((text) =>
    text.split("\n").filter((line) => line.startsWith("### T")).map((line) => line.split(". ")[0]!.slice(4)),
  );
  coverage ??=
    "## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n" + `| R1 Everything | ${ids.join(", ") || "T1"} |\n`;
  return "# Demo: Tasks\n\n## Feature: Demo\n\nOne sentence.\n\n" + tasks.join("\n") + "\n" + coverage + "\n" + questions;
}

const QUESTION = (blocks: string) => `## Open questions

### Q1. What now?

- **Unclear**: x
- **Why it matters**: y
- **Options raised**: none raised
- **Blocks**: ${blocks}
`;

// ------------------------------------------------------------------------- harness

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskgraph-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(text: string | Uint8Array, name = "tasks.md") {
  const target = path.join(dir, name);
  fs.writeFileSync(target, text);
  return target;
}

function run(...args: string[]): [number, string, string] {
  const out: string[] = [];
  const err: string[] = [];
  const kept = { ...io };
  io.out = (text) => void out.push(text + "\n");
  io.err = (text) => void err.push(text + "\n");
  try {
    return [main(args), out.join(""), err.join("")];
  } finally {
    Object.assign(io, kept);
  }
}

const problems = (text: string) => validate(parse(text)).map(([, message]) => message);
const some = (found: string[], part: string) => found.some((message) => message.includes(part));

// ------------------------------------------------------------------------- check

describe("check", () => {
  test("the example document is clean", () => {
    const [code, out] = run("check", EXAMPLE);
    expect([code, out]).toEqual([0, "OK: 7 tasks in 2 features, 2 open questions, no problem.\n"]);
  });

  test("a missing reference", () => {
    const found = problems(doc([task("T1"), task("T2", { needs: "T1, T9" })]));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("T2 needs T9, which is not a task");
  });

  test("a self reference", () => {
    expect(problems(doc([task("T1", { needs: "T1" })]))).toContain("T1 needs itself.");
  });

  test("cycles", () => {
    let found = problems(doc([task("T1", { needs: "T2" }), task("T2", { needs: "T1" })]));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("dependency cycle: T1 -> T2 -> T1");
    found = problems(
      doc([task("T1", { needs: "T3" }), task("T2", { needs: "T1" }), task("T3", { needs: "T2" }), task("T4")]),
    );
    expect(found.length).toBe(1);
    expect(found[0]).toContain("T1 -> T3 -> T2 -> T1");
  });

  test("a diamond is not a cycle", () => {
    const text = doc([task("T1"), task("T2", { needs: "T1" }), task("T3", { needs: "T1" }), task("T4", { needs: "T2, T3" })]);
    expect(problems(text)).toEqual([]);
  });

  test("a forward reference is allowed", () => {
    expect(problems(doc([task("T1", { needs: "T2" }), task("T2")]))).toEqual([]);
  });

  test("a duplicate ID", () => {
    expect(some(problems(doc([task("T1"), task("T1")])), "T1 is defined twice")).toBe(true);
  });

  test("a Needs entry that is not an ID", () => {
    const found = problems(doc([task("T1"), task("T2", { needs: "T1 (the happy path)" })]));
    expect(found.some((message) => message.includes("`(the") && message.includes("not a task ID"))).toBe(true);
  });

  test("the words for no dependency", () => {
    for (const word of ["none", "None", "-", ""]) expect(problems(doc([task("T1", { needs: word })]))).toEqual([]);
  });

  test("missing fields and criteria", () => {
    const found = problems(doc(["### T1. Bare\n\n**Scenario**: x\n"]));
    for (const part of [
      "no `Needs` line",
      "no `Actor` line",
      "no `Source` line",
      "Path is `missing`",
      "no `**Acceptance criteria**` checklist",
    ]) {
      expect([part, some(found, part)]).toEqual([part, true]);
    }
  });

  test("a bad path kind", () => {
    expect(some(problems(doc([task("T1", { path: "Sad" })])), "Path is `Sad`")).toBe(true);
  });

  test("a criterion that is not a checkbox", () => {
    expect(some(problems(doc([task("T1", { ticks: "1. It works." })])), "not a checklist item")).toBe(true);
    expect(some(problems(doc([task("T1", { ticks: "" })])), "hold no `- [ ]` item")).toBe(true);
  });

  test("a marker without a question", () => {
    expect(some(problems(doc([task("T1", { extra: " [Q4]" })])), "no open question Q4 exists")).toBe(true);
  });

  test("a marker of a resolved question", () => {
    const text = doc([task("T1", { extra: " [Q1]" })], { questions: "## Resolved questions\n\n- Q1: What? → This (me)\n" });
    expect(some(problems(text), "[Q1], which is resolved")).toBe(true);
  });

  test("a question and its markers must agree", () => {
    let found = problems(doc([task("T1", { extra: " [Q1]" }), task("T2")], { questions: QUESTION("T2") }));
    expect(some(found, "T1 carries [Q1], but `Blocks` of Q1 does not list T1")).toBe(true);
    expect(some(found, "Q1 blocks T2, but T2 carries no [Q1] marker")).toBe(true);
    found = problems(doc([task("T1", { extra: " [Q1]" })], { questions: QUESTION("T7") }));
    expect(some(found, "Q1 blocks T7, which is not a task")).toBe(true);
  });

  test("a status is required", () => {
    expect(some(problems(doc([task("T1", { status: null })])), "Status is `missing`")).toBe(true);
    expect(some(problems(doc([task("T1", { status: "Maybe" })])), "Status is `Maybe`")).toBe(true);
  });

  test("an optional task must not block a required one", () => {
    let found = problems(doc([task("T1", { status: "Optional" }), task("T2", { needs: "T1" })]));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("T2 is required but needs T1, which is optional");
    found = problems(doc([task("T1", { status: "Optional" }), task("T2", { needs: "T1", status: "Optional" })]));
    expect(found).toEqual([]);
  });

  test("a dependency must give a reason", () => {
    const found = problems(doc([task("T1"), task("T2", { needs: "T1", because: false })]));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("gives no `Needs because` line");
  });

  test("a redundant dependency", () => {
    const found = problems(doc([task("T1"), task("T2", { needs: "T1" }), task("T3", { needs: "T1, T2" })]));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("T3 needs T1, but T2 already needs it through T2");
  });

  test("a coverage section is required", () => {
    expect(some(problems(doc([task("T1")], { coverage: "## Other\n\nx\n" })), "no `## Coverage` section")).toBe(true);
  });

  test("a coverage row must cover something that exists", () => {
    const table =
      "## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n| R1 First | T1 |\n| R2 Second | |\n| R3 Third | T9, Q8 |\n";
    const found = problems(doc([task("T1")], { coverage: table }));
    expect(some(found, '"R2 Second" is covered by no task')).toBe(true);
    expect(some(found, "names T9, which is not a task")).toBe(true);
    expect(some(found, "names Q8, which is not a question")).toBe(true);
  });

  test("a task in no coverage row", () => {
    const table = "## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n| R1 First | T1 |\n";
    const found = problems(doc([task("T1"), task("T2")], { coverage: table }));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("T2 is in no row of the `## Coverage` table");
  });

  test("coverage may cite a question", () => {
    const table =
      "## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n| R1 First | T1 |\n| R2 Wording not stated | Q1 |\n";
    expect(problems(doc([task("T1", { extra: " [Q1]" })], { coverage: table, questions: QUESTION("T1") }))).toEqual([]);
  });

  test("fenced examples are ignored", () => {
    expect(problems(doc([task("T1")]) + "\n```markdown\n### T9. Example in a fence\n```\n")).toEqual([]);
  });

  test("exit codes and the problem lines", () => {
    const bad = write(doc([task("T1", { needs: "T2" })]));
    const [code, out] = run("check", bad);
    expect(code).toBe(1);
    expect(out).toContain(`${bad}:`);
    expect(out.endsWith("\n1 problem.\n")).toBe(true);
  });

  test("problems come in line order, each with its line", () => {
    const bad = write(doc([task("T1", { needs: "T2", path: "Sad" }), task("T2", { needs: "T1" })]));
    const [code, out] = run("check", bad);
    expect(code).toBe(1);
    const lines = out.trimEnd().split("\n");
    expect(lines.at(-1)).toBe("2 problems.");
    const numbers = lines.slice(0, -1).map((line) => Number(line.slice(bad.length + 1).split(":")[0]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  test("text is read with Python's rules for spaces, line breaks and digits", () => {
    expect(splitLines("a\r\nb\x85c d\n")).toEqual(["a", "b", "c", "d"]);
    // A no-break space is a space, and an Arabic-Indic digit is a digit, as in Python.
    expect(problems(doc([task("T1"), task("T٢", { needs: "T1 " })]))).toEqual([]);
    // `T1x` is not a task heading: the ID must end at a word boundary.
    expect(parse(doc([task("T1x")])).tasks.length).toBe(0);
  });

  test("invalid UTF-8 is described as Python describes it", () => {
    expect(utf8Error(new Uint8Array([0x61, 0xff]))).toEqual([1, 2, "invalid start byte"]);
    expect(utf8Error(new Uint8Array([0xe2, 0x82]))).toEqual([0, 2, "unexpected end of data"]);
    expect(utf8Error(new Uint8Array([0xe2, 0x41]))).toEqual([0, 1, "invalid continuation byte"]);
    expect(utf8Error(new Uint8Array([0xe2, 0x82, 0x41]))).toEqual([0, 2, "invalid continuation byte"]);
    expect(utf8Error(new Uint8Array([0xed, 0xa0, 0x80]))).toEqual([0, 1, "invalid continuation byte"]);
    expect(utf8Error(new TextEncoder().encode("﻿ok €"))).toBeNull();
    const [code, out, err] = run("check", write(new Uint8Array([0x23, 0x20, 0xc3, 0x28])));
    expect([code, out]).toEqual([2, ""]);
    expect(err).toBe(
      `error: cannot read ${path.join(dir, "tasks.md")}: 'utf-8' codec can't decode byte 0xc3 in position 2: invalid continuation byte\n`,
    );
  });
});

// ------------------------------------------------------------------------- status

describe("status", () => {
  const chain = (firstTicked = false) =>
    doc([
      task("T1", { ticks: firstTicked ? "- [x] Done." : "- [ ] Not yet." }),
      task("T2", { needs: "T1" }),
      task("T3", { needs: "T1" }),
      task("T4", { needs: "T2, T3" }),
      task("T5"),
    ]);

  test("ready and blocked", () => {
    const [code, out] = run("status", write(chain()));
    expect(code).toBe(0);
    expect(out).toContain("0 done, 2 ready, 3 blocked");
    expect(out).toContain("T1  Does a thing (Happy)");
    expect(out).toContain("Required tasks not done: 5.");
    expect(out).toContain("T4  Does a thing: waits for T2, T3");
  });

  test("ticking unblocks", () => {
    const [, out] = run("status", write(chain(true)));
    expect(out).toContain("1 done, 3 ready, 1 blocked");
    expect(out).toContain("Done (1): T1");
  });

  test("a partly ticked task is not done", () => {
    const [, out] = run("status", write(doc([task("T1", { ticks: "- [x] One.\n- [ ] Two." }), task("T2", { needs: "T1" })])));
    expect(out).toContain("0 done, 1 ready, 1 blocked");
  });

  test("an open question blocks a task whose needs are done", () => {
    const text = doc([task("T1", { ticks: "- [x] Done." }), task("T2", { needs: "T1", extra: " [Q1]" })], {
      questions: QUESTION("T2"),
    });
    const [code, out] = run("status", write(text));
    expect(out).toContain("T2  Does a thing: open question Q1");
    expect(code).toBe(3);
    expect(out).toContain("Nothing is ready");
  });

  test("optional tasks are labelled and not counted as required", () => {
    const [, out] = run("status", write(doc([task("T1"), task("T2", { status: "Optional", path: "Alternative" })])));
    expect(out).toContain("T2  Does a thing (Alternative, optional)");
    expect(out).toContain("Required tasks not done: 1.");
  });

  test("all done exits zero", () => {
    const [code, out] = run("status", write(doc([task("T1", { ticks: "- [x] Done." })])));
    expect(code).toBe(0);
    expect(out).toContain("1 done, 0 ready, 0 blocked");
  });

  test("status stops on problems", () => {
    const [code, out] = run("status", write(doc([task("T1", { needs: "T2" }), task("T2", { needs: "T1" })])));
    expect(code).toBe(1);
    expect(out).toContain("dependency cycle");
    expect(out).not.toContain("Ready to start");
  });

  test("paths by feature", () => {
    const text = doc([task("T1"), task("T2", { needs: "T1", path: "Negative" }), task("T3", { needs: "T1", path: "Negative" })]);
    const [, out] = run("status", write(text));
    expect(out).toContain("Demo: 1 happy, 0 alternative, 2 negative");
  });

  test("the example document in full", () => {
    const [code, out] = run("status", EXAMPLE);
    expect(code).toBe(0);
    expect(out).toStartWith("Tasks: 7 in all; 0 done, 1 ready, 6 blocked.\nRequired tasks not done: 7.\n");
    expect(out).toContain("  T4  Member is told the range is too long: waits for T1; open question Q2\n");
    expect(out).toEndWith("  Expense export: 2 happy, 1 alternative, 3 negative\n  Tax-year selection: 0 happy, 1 alternative, 0 negative\n");
  });
});

// ------------------------------------------------------------------------- waves and trace

describe("waves and trace", () => {
  const TEXT = doc([
    task("T1"),
    task("T2", { needs: "T1" }),
    task("T3", { needs: "T1" }),
    task("T4", { needs: "T2, T3" }),
    task("T5"),
    task("T6", { needs: "T5" }),
  ]);

  test("waves", () => {
    const [code, out] = run("waves", write(TEXT));
    expect(code).toBe(0);
    const [wave1, rest] = out.split("Wave 2") as [string, string];
    const [wave2, wave3] = rest.split("Wave 3") as [string, string];
    for (const name of ["T1 ", "T5 "]) expect(wave1).toContain(name);
    for (const name of ["T2 ", "T3 ", "T6 "]) expect(wave2).toContain(name);
    expect(wave3).toContain("T4 ");
    expect(out).toContain("Longest chain (3 tasks, one after the other): T1 -> T2 -> T4");
  });

  test("waves mark optional, done and open-question tasks", () => {
    const text = doc(
      [task("T1", { ticks: "- [x] Done." }), task("T2", { needs: "T1", status: "Optional", extra: " [Q1]" })],
      { questions: QUESTION("T2") },
    );
    const [code, out] = run("waves", write(text));
    expect(code).toBe(0);
    expect(out).toContain("  T1  Does a thing (done)\n");
    expect(out).toContain("  T2  Does a thing (needs T1; open question Q1; optional)\n");
  });

  test("a long chain does not overflow", () => {
    const tasks = Array.from({ length: 3000 }, (_, index) =>
      task(`T${index + 1}`, { needs: index ? `T${index}` : "none" }),
    );
    const [code, out] = run("waves", write(doc(tasks)));
    expect(code).toBe(0);
    expect(out).toContain("Longest chain (3000 tasks, one after the other): T1 -> T2 -> T3");
  });

  test("trace", () => {
    const [code, out] = run("trace", write(TEXT), "t2");
    expect(code).toBe(0);
    expect(out).toContain("Needs directly: T1");
    expect(out).toContain("Waits for it (all, through the chain): T4");
    expect(out).toContain("Can run in parallel with (no dependency either way): T3, T5, T6");
  });

  test("trace of an unknown task", () => {
    const [code, , err] = run("trace", write(TEXT), "T99");
    expect(code).toBe(2);
    expect(err).toContain("T99 is not a task");
    expect(err).toContain("Tasks: T1, T2, T3, T4, T5, T6.");
  });
});

// ------------------------------------------------------------------------- usage

describe("usage", () => {
  test("a missing file", () => {
    const [code, , err] = run("check", path.join(dir, "none.md"));
    expect(code).toBe(2);
    expect(err).toBe(`error: ${path.join(dir, "none.md")} is not a file.\n`);
  });

  test("a directory is not a file", () => {
    const [code, , err] = run("status", dir);
    expect([code, err]).toEqual([2, `error: ${dir} is not a file.\n`]);
  });

  test("no tasks", () => {
    const [code, , err] = run("check", write("# Empty\n\n## Feature: X\n"));
    expect(code).toBe(2);
    expect(err).toContain("no task found");
  });

  test("no command prints the help and is wrong usage", () => {
    const [code, out] = run();
    expect(code).toBe(2);
    expect(out).toContain("typical workflow:");
  });

  test("wrong usage names the problem, the usage line and the help", () => {
    let [code, out, err] = run("trace", EXAMPLE);
    expect([code, out]).toEqual([2, ""]);
    expect(err).toBe(
      "usage: taskgraph trace [-h] DOC TASK\ntaskgraph trace: error: the following arguments are required: TASK\n" +
        "Run 'taskgraph trace --help' for help.\n",
    );
    [code, , err] = run("check", EXAMPLE, "extra.md");
    expect(code).toBe(2);
    expect(err).toContain("taskgraph check: error: unrecognized arguments: extra.md");
    [code, , err] = run("check", "--strict", EXAMPLE);
    expect(code).toBe(2);
    expect(err).toContain("unrecognized arguments: --strict (check takes no option but -h, --help)");
    [code, , err] = run("check", "--hlep");
    expect(code).toBe(2);
    expect(err).toContain("(did you mean '--help'?)");
  });

  test("an unknown command suggests the closest one", () => {
    let [code, , err] = run("stats", EXAMPLE);
    expect(code).toBe(2);
    expect(err).toContain("taskgraph: error: argument COMMAND: invalid choice: 'stats'");
    expect(err).toContain("(did you mean 'status'?)");
    expect(err).toContain("Run 'taskgraph --help' for help.");
    [code, , err] = run("wave", EXAMPLE);
    expect(err).toContain("(did you mean 'waves'?)");
    [code, , err] = run("frobnicate");
    expect(code).toBe(2);
    expect(err).not.toContain("did you mean");
    [code, , err] = run("help", "chek");
    expect(code).toBe(2);
    expect(err).toContain("(did you mean 'check'?)");
    [code, , err] = run("--verbose");
    expect(code).toBe(2);
    expect(err).toContain("unrecognized arguments: --verbose");
  });
});

// ------------------------------------------------------------------------- help

describe("help", () => {
  const lines = (text: string) => text.split("\n");

  test("--help, -h and help show the top help", () => {
    for (const args of [["--help"], ["-h"], ["help"], ["help", "help"]]) {
      const [code, out, err] = run(...args);
      expect([args, code, err]).toEqual([args, 0, ""]);
      expect(out).toStartWith("usage: taskgraph [-h] COMMAND ...\n");
      for (const command of COMMANDS) expect(out).toContain(`  ${command.name}  `);
      for (const part of ["typical workflow:", "files:", "exit codes:", "taskgraph COMMAND --help", "help COMMAND"]) {
        expect(out).toContain(part);
      }
      for (const code of ["0", "1", "2", "3"]) expect(out).toContain(`\n  ${code}  `);
    }
  });

  test("the workflow names every command in the order the skill runs them", () => {
    const [, out] = run("--help");
    const workflow = out.split("typical workflow:\n")[1]!.split("\n\n")[0]!;
    const order = COMMANDS.map((command) => workflow.indexOf(`taskgraph ${command.name} DOC`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("every command has its own help with its arguments, output, exit codes and examples", () => {
    for (const command of COMMANDS) {
      for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name], [command.name, "x.md", "-h"]]) {
        const [code, out, err] = run(...args);
        expect([args, code, err]).toEqual([args, 0, ""]);
        expect(out).toStartWith(`usage: taskgraph ${command.name} [-h] DOC`);
        for (const part of ["-h, --help", "arguments:\n", "prints:\n", "exit codes:\n", `examples:\n  taskgraph ${command.name} `]) {
          expect([command.name, part, out.includes(part)]).toEqual([command.name, part, true]);
        }
        for (const positional of command.positionals) expect(out).toContain(`\n  ${positional.metavar}  `);
        for (const [exitCode] of command.exitCodes) expect(out).toContain(`\n  ${exitCode}  `);
      }
    }
  });

  test("every example parses without a usage error", () => {
    for (const command of COMMANDS) {
      expect(command.examples.length).toBeGreaterThanOrEqual(1);
      for (const example of command.examples) {
        const words = example.split(" ");
        expect(words[0]).toBe("taskgraph");
        // Point the example at the example document, so that it runs for real.
        const args = words.slice(1).map((word) => (word.endsWith(".md") ? EXAMPLE : word));
        const [code, , err] = run(...args);
        expect([example, err.includes("error: the following") || err.includes("unrecognized"), code]).toEqual([
          example,
          false,
          0,
        ]);
      }
    }
  });

  test("help lines are at most 88 columns", () => {
    const texts = [run("--help")[1], ...COMMANDS.map((command) => run(command.name, "--help")[1])];
    for (const text of texts) {
      for (const line of lines(text)) expect([line, line.length <= 88]).toEqual([line, true]);
    }
  });
});

// ------------------------------------------------------------------------- the built script

describe("the built script", () => {
  const runBuilt = (...args: string[]) => {
    const done = Bun.spawnSync(["bun", SCRIPT, ...args], { env: { ...process.env } });
    return [done.exitCode, done.stdout.toString(), done.stderr.toString()] as const;
  };

  test("it is up to date with the source", () => {
    const built = fs.statSync(SCRIPT).mtimeMs;
    const sourceDir = path.join(import.meta.dir, "..", "src");
    for (const name of fs.readdirSync(sourceDir)) {
      expect([name, fs.statSync(path.join(sourceDir, name)).mtimeMs <= built]).toEqual([name, true]);
    }
  });

  test("it runs as a program", () => {
    let [code, out, err] = runBuilt("check", EXAMPLE);
    expect([code, out, err]).toEqual([0, "OK: 7 tasks in 2 features, 2 open questions, no problem.\n", ""]);
    [code, out] = runBuilt("status", EXAMPLE);
    expect(code).toBe(0);
    expect(out).toContain("Ready to start now (1).");
    [code, out] = runBuilt("--help");
    expect(code).toBe(0);
    expect(out).toContain("typical workflow:");
    [code, out] = runBuilt("trace", "--help");
    expect(code).toBe(0);
    expect(out).toContain("TASK  a task ID");
    [code, , err] = runBuilt("trace", EXAMPLE);
    expect(code).toBe(2);
    expect(err).toContain("the following arguments are required: TASK");
    [code, out] = runBuilt("status", write(doc([task("T1", { extra: " [Q1]" })], { questions: QUESTION("T1") })));
    expect(code).toBe(3);
    expect(out).toContain("Nothing is ready");
  });
});

describe("wrapping", () => {
  test("a code span is never broken across lines", () => {
    for (const command of COMMANDS) {
      const [, out] = run(command.name, "--help");
      for (const line of out.split("\n")) {
        expect([line, (line.match(/`/g) ?? []).length % 2]).toEqual([line, 0]);
      }
    }
  });
});
