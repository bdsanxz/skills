// Tests for the ledger script. Run: bun test (in dev/ledger)
//
// Every test works in its own temporary folder. The last tests run the built scripts/ledger.js.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMMANDS, main, top } from "../src/commands";
import { commandHelp, parseCommand, WIDTH } from "../src/args";
import { decodeStrict, io, repr, squash } from "../src/core";
import { disk, folderSize } from "../src/disk";
import { FORMAT, criteriaFrom, limits } from "../src/ledger";
import { parseJson } from "../src/pyjson";
import { best, testState } from "../src/testlog";

const SCRIPT = path.resolve(import.meta.dir, "..", "..", "..", "scripts", "ledger.js");

const TICKET = `# T038 Cancel a render

## Acceptance criteria

- [ ] When the render is interrupted, it prints "Render cancelled" and exits 130.
- [x] When the run has ended, no file | no staging file is left.
- [U] When the video is opened in a player, it plays.

## Out of scope

- Resuming a cancelled render.
`;

const CARGO = `running 3 tests
test cancel::t038_c1_an_interrupt_exits_130 ... ok
test cancel::t038_c2_nothing_is_left ... ok
test cancel::t038_c3_parked ... ignored
test cancel::t038_c4_broken ... FAILED
---- cancel::t038_c1_an_interrupt_exits_130 stdout ----
test result: FAILED. 2 passed; 1 failed; 1 ignored
`;

// ------------------------------------------------------------------------- harness

// Every command counts the current folder for its disk line: work in a small one.
const startedIn = process.cwd();
let quiet = "";
beforeAll(() => {
  quiet = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edd-ledger-cwd-")));
  process.chdir(quiet);
});
afterAll(() => {
  process.chdir(startedIn);
  fs.rmSync(quiet, { recursive: true, force: true });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** Runs the script; returns its exit code, standard output and standard error. */
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

function tempDir() {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edd-ledger-")));
  cleanups.push(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

type Doc = { criteria: Record<string, unknown>[]; [key: string]: unknown };

/** A small project in a temporary folder with a ledger whose three criteria are proven. */
class Project {
  readonly dir = tempDir();
  readonly path = this.at("_swe/edd/cancel/ledger.json");
  readonly ev = "_swe/edd/cancel/evidence/";

  constructor() {
    this.write("ticket.md", TICKET, 300);
    this.write("src/render.rs", "fn render() {}\n", 300);
    this.write("tests/cancel.rs", "fn t038_c1() {}\n", 300);
    const [code, , err] = run("init", this.path, "--task", "Cancel a render", "--root", this.dir,
      "--criteria-from", this.at("ticket.md"), "--section", "acceptance criteria", "--code", "src", "--code", "tests");
    expect([code, err.includes("error")]).toEqual([0, false]);
    const ev = this.ev;
    this.write(ev + "run.sh", "echo 'the label: `[exit 131]`'\n", 200);
    this.write(ev + "c1-interrupt.txt", "$ render demo\nRender cancelled (in capture)\n[exit 130]\n", 100);
    this.write(ev + "c2-left-behind.txt", "after the run, the project folder holds:   ./index.html\n", 100);
    this.write(ev + "c3-played.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 0x1a, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), 100);
    this.write(ev + "c3-played.txt", "events: play (0.001), ended (2.000)\n", 100);
    this.write(ev + "tests.txt", CARGO, 100);
    const doc = this.read();
    doc.test_logs = [ev + "tests.txt"];
    Object.assign(doc.criteria[0]!, {
      status: "proven", on_screen: false, tests: ["t038_c1_an_interrupt_exits_130"],
      evidence: [ev + "c1-interrupt.txt"], made_by: [ev + "run.sh"],
      shows: "The run prints `Render cancelled (in capture)` and ends `[exit 130]`.",
    });
    Object.assign(doc.criteria[1]!, {
      status: "proven", on_screen: false, tests: ["cancel::t038_c2_nothing_is_left"],
      evidence: [ev + "c2-left-behind.txt"], made_by: [ev + "run.sh"],
      shows: "Afterwards `the project folder holds: ./index.html`.",
    });
    Object.assign(doc.criteria[2]!, {
      status: "proven", on_screen: true, no_test: "Playback in a player is not reachable from the suite.",
      evidence: [ev + "c3-played.png", ev + "c3-played.txt"],
      shows: "The player reports `ended (2.000)`; the picture shows the last frame.",
    });
    this.save(doc);
  }

  at(relative: string) {
    return path.join(this.dir, relative);
  }

  write(relative: string, content: string | Uint8Array, age = 0) {
    const file = this.at(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    const stamp = fs.statSync(file).mtimeMs / 1000 - age;
    fs.utimesSync(file, stamp, stamp);
  }

  read(): Doc {
    return JSON.parse(fs.readFileSync(this.path, "utf8"));
  }

  save(doc: Doc) {
    fs.writeFileSync(this.path, JSON.stringify(doc));
  }

  change(number: number, fields: Record<string, unknown>) {
    const doc = this.read();
    Object.assign(doc.criteria[number - 1]!, fields);
    this.save(doc);
  }
}

// ------------------------------------------------------------------------- init

describe("init", () => {
  test("rows come from the list items under the heading", () => {
    const project = new Project();
    const doc = project.read();
    expect(doc.criteria.map((row) => row.id)).toEqual(["c1", "c2", "c3"]);
    expect(doc.criteria[1]!.criterion).toBe("When the run has ended, no file | no staging file is left.");
    expect(doc.criteria[2]!.criterion).toBe("When the video is opened in a player, it plays.");
    expect([doc.root, doc.evidence_dir, doc.code]).toEqual([path.join("..", "..", ".."), "_swe/edd/cancel/evidence", ["src", "tests"]]);
    expect(fs.statSync(project.at("_swe/edd/cancel/evidence")).isDirectory()).toBe(true);
  });

  test("the ledger is written as Python's json.dump wrote it", () => {
    const folder = tempDir();
    const file = path.join(folder, "ledger.json");
    expect(run("init", file, "--task", " Ünïcode task ", "--root", folder, "--criterion", "It works.")[0]).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(
      '{\n  "format": "edd/ledger@1",\n  "task": "Ünïcode task",\n  "root": ".",\n  "evidence_dir": "evidence",\n' +
        '  "code": [],\n  "test_logs": [],\n  "criteria": [\n    {\n      "id": "c1",\n      "criterion": "It works.",\n' +
        '      "on_screen": null,\n      "status": "open",\n      "tests": [],\n      "no_test": "",\n      "evidence": [],\n' +
        '      "made_by": [],\n      "shows": "",\n      "stand_in": "",\n      "accepted": "",\n      "note": ""\n    }\n  ]\n}\n',
    );
  });

  test("new rows are open and undecided", () => {
    const folder = tempDir();
    const file = path.join(folder, "run", "ledger.json");
    const [code, out] = run("init", file, "--task", "t", "--root", folder, "--criterion", "It works.", "--criterion", "It stops.");
    expect(code).toBe(0);
    expect(out).toContain("2 criteria, all open");
    const rows = JSON.parse(fs.readFileSync(file, "utf8")).criteria;
    expect(rows.map((row: Record<string, unknown>) => [row.status, row.on_screen, row.evidence])).toEqual([["open", null, []], ["open", null, []]]);
  });

  test("plain lines are criteria when the file has no list", () => {
    const folder = tempDir();
    const source = path.join(folder, "criteria.txt");
    fs.writeFileSync(source, "# Criteria\n\nIt works.\n\nIt stops.\n");
    expect(criteriaFrom(source, null)).toEqual(["It works.", "It stops."]);
  });

  test("numbered items, CRLF lines and nested headings", () => {
    const folder = tempDir();
    const source = path.join(folder, "criteria.md");
    fs.writeFileSync(source, "# T\r\n## Done when\r\n1. One.  \r\n2) Two.\r\n### Detail\r\n* Three.\r\n## Later\r\n- Four.\r\n");
    expect(criteriaFrom(source, "done when")).toEqual(["One.", "Two.", "Three."]);
  });

  test("an existing ledger is not overwritten", () => {
    const project = new Project();
    const [code, , err] = run("init", project.path, "--task", "again", "--criterion", "x");
    expect(code).toBe(2);
    expect(err).toContain("already exists");
  });

  test("wrong input is a usage error", () => {
    const folder = tempDir();
    const file = path.join(folder, "ledger.json");
    const source = path.join(folder, "ticket.md");
    fs.writeFileSync(source, TICKET);
    const cases: [string[], string][] = [
      [["--task", "t"], "give the criteria"],
      [["--task", "t", "--criterion", " "], "a criterion is empty"],
      [["--task", "t", "--criterion", "x", "--criteria-from", source], "not both"],
      [["--task", "t", "--criteria-from", source, "--section", "Nowhere"], "no heading"],
      [["--task", "t", "--criteria-from", path.join(folder, "none.md")], "criteria file"],
      [["--task", "t", "--criterion", "x", "--root", folder, "--code", "missing"], "does not exist"],
      [["--criterion", "x"], "--task"],
    ];
    for (const [argv, said] of cases) {
      const [code, , err] = run("init", file, ...argv);
      expect([argv, code, err.includes(said)]).toEqual([argv, 2, true]);
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  test("an unreadable criteria file is named with Python's reason", () => {
    const folder = tempDir();
    const file = path.join(folder, "ledger.json");
    const missing = path.join(folder, "none.md");
    let [, , err] = run("init", file, "--task", "t", "--criteria-from", missing);
    expect(err).toContain(`ledger: criteria file ${missing}: [Errno 2] No such file or directory: '${missing}'\n`);
    const latin = path.join(folder, "latin.md");
    fs.writeFileSync(latin, new Uint8Array([0x2d, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a]));
    [, , err] = run("init", file, "--task", "t", "--criteria-from", latin);
    expect(err).toContain("'utf-8' codec can't decode byte 0xe9 in position 5: invalid continuation byte");
    [, , err] = run("init", file, "--task", "t", "--criteria-from", source(folder, "# Only a heading\n"), "--section", "x'y");
    expect(err).toContain(`has no heading "x'y".`);
  });

  test("argument mistakes print the usage of init", () => {
    const [code, , err] = run("init", "x.json", "--task", "t");
    expect(code).toBe(2);
    expect(err).toContain("usage: ledger init [-h] --task TEXT");
    expect(err).toContain("ledger init: error: give the criteria with --criteria-from FILE or with --criterion TEXT.");
    expect(err).toContain("Run 'ledger init --help' for help.");
  });
});

function source(folder: string, content: string) {
  const file = path.join(folder, "source.md");
  fs.writeFileSync(file, content);
  return file;
}

// ------------------------------------------------------------------------- check

describe("check", () => {
  const problems = (project: Project, code = 1) => {
    const [got, out] = run("check", project.path);
    if (got !== code) throw new Error(`exit ${got}, not ${code}\n${out}`);
    return out;
  };
  const problemsAfter = (project: Project, number: number, fields: Record<string, unknown>) => {
    project.change(number, fields);
    return run("check", project.path)[1];
  };

  test("a backed ledger passes", () => {
    const out = problems(new Project(), 0);
    expect(out).toContain("3 criteria: 3 proven, 0 open, 0 for the user to check, 0 waived");
    expect(out).toContain("every criterion is closed and backed");
    expect(out).not.toContain("problems:");
  });

  test("open and user-check rows keep the task incomplete", () => {
    const project = new Project();
    project.change(2, { status: "open", note: "The staging file is still there after a cancel in encode." });
    project.change(3, { status: "user-check", note: "Open out/demo.mp4 in a player and watch it to the end." });
    const out = problems(project, 3);
    expect(out).toContain("c2 [open]: The staging file is still there");
    expect(out).toContain("c3 [user-check]: Open out/demo.mp4");
    expect(out).toContain("not complete");
    expect(problemsAfter(project, 2, { evidence: [], made_by: [] })).toContain("is named by no row");
  });

  test("missing and empty evidence is a problem", () => {
    const project = new Project();
    project.write(project.ev + "c2-left-behind.txt", "");
    project.change(1, { evidence: [project.ev + "c1-gone.txt"] });
    const out = problems(project);
    expect(out).toContain("c1: evidence file _swe/edd/cancel/evidence/c1-gone.txt is missing or empty");
    expect(out).toContain("c2: evidence file _swe/edd/cancel/evidence/c2-left-behind.txt is missing or empty");
    expect(out).toContain("Nothing in this ledger may be reported as proven");
  });

  test("a proven row needs evidence and words", () => {
    const project = new Project();
    project.change(1, { evidence: [], shows: " " });
    const out = problems(project);
    expect(out).toContain("c1: no evidence file is named");
    expect(out).toContain("c1: `shows` is empty");
  });

  test("a quote must be in the row's own evidence", () => {
    const project = new Project();
    project.change(1, { shows: "It ends `[exit 131]` after `Render cancelled (in capture)`." });
    const out = problems(project);
    expect(out).toContain("c1: `shows` quotes `[exit 131]`");
    expect(out).not.toContain("quotes `Render cancelled");
  });

  test("a quote may span squashed whitespace", () => {
    const project = new Project();
    project.change(2, { shows: "It says `the project   folder holds: ./index.html`." });
    problems(project, 0);
  });

  test("text evidence must be quoted", () => {
    const project = new Project();
    project.change(1, { shows: "The run is cancelled and exits 130." });
    expect(problems(project)).toContain("c1: `shows` quotes nothing");
  });

  test("a picture alone cannot back a quote", () => {
    const project = new Project();
    project.change(3, { evidence: [project.ev + "c3-played.png"], shows: "The player says `ended (2.000)`." });
    expect(problems(project)).toContain("c3: `shows` quotes text, and the evidence holds no text file");
  });

  test("something seen needs a picture", () => {
    const project = new Project();
    project.change(3, { evidence: [project.ev + "c3-played.txt"], shows: "The player reports `ended (2.000)`." });
    expect(problems(project)).toContain("c3: the criterion is about something seen, and its evidence is text only");
  });

  test("on_screen must be decided", () => {
    const project = new Project();
    project.change(1, { on_screen: null });
    expect(problems(project)).toContain("c1: `on_screen` is not decided");
  });

  test("a stand-in needs the user's acceptance", () => {
    const project = new Project();
    project.change(1, { stand_in: "A sandbox denied the network; the machine stayed connected." });
    expect(problems(project)).toContain("c1: it was checked by a stand-in that nobody accepted");
    project.change(1, { accepted: '2026-10-11, user: "Accept the sandbox check"' });
    expect(problems(project, 0)).toContain("3 proven (1 by a stand-in the user accepted)");
  });

  test("a named test must have passed", () => {
    const project = new Project();
    project.change(1, { tests: ["t038_c3_parked", "t038_c4_broken", "t038_c9_not_there", "t038_c1"] });
    const out = problems(project);
    expect(out).toContain("c1: test t038_c3_parked was skipped or ignored");
    expect(out).toContain("c1: test t038_c4_broken failed");
    expect(out).toContain("c1: test t038_c9_not_there is in no test log");
    expect(out).toContain("c1: test t038_c1 is in no test log");
  });

  test("a row needs a test or a reason", () => {
    const project = new Project();
    project.change(3, { no_test: "" });
    expect(problems(project)).toContain("c3: no test is named");
  });

  test("named tests need a test log", () => {
    const project = new Project();
    const doc = project.read();
    doc.test_logs = [];
    project.save(doc);
    const out = problems(project);
    expect(out).toContain("c1: tests are named and `test_logs` is empty");
    expect(out).toContain("evidence/tests.txt is named by no row");
  });

  test("evidence older than the code is stale", () => {
    const project = new Project();
    project.write("src/render.rs", "fn render() { /* changed */ }\n");
    const out = problems(project);
    expect(out).toContain("c1: _swe/edd/cancel/evidence/c1-interrupt.txt was made at");
    expect(out).toContain("before src/render.rs last changed");
    expect(out).toContain("test log _swe/edd/cancel/evidence/tests.txt was made at");
  });

  test("evidence older than its script is stale", () => {
    const project = new Project();
    project.write(project.ev + "run.sh", "echo changed\n");
    const out = problems(project);
    expect(out).toContain("c1-interrupt.txt was made at");
    expect(out).toContain("before its script _swe/edd/cancel/evidence/run.sh last changed");
    expect(out).not.toContain("c3:");
  });

  test("the run folder is not code", () => {
    const project = new Project();
    const doc = project.read();
    doc.code = ["."];
    project.save(doc);
    problems(project, 0);
  });

  test("code in a git repository is the files git knows", () => {
    const project = new Project();
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd: project.dir });
    git("init", "-q");
    project.write(".gitignore", "build/\n", 300);
    project.write("src/build/out.o", "new and ignored\n");
    problems(project, 0);
    project.write("src/new.rs", "fn new() {}\n");
    expect(problems(project)).toContain("before src/new.rs last changed");
  });

  test("code must be listed and exist", () => {
    const project = new Project();
    const doc = project.read();
    doc.code = [];
    project.save(doc);
    expect(problems(project)).toContain("`code` is empty");
    doc.code = ["lib"];
    project.save(doc);
    expect(problems(project)).toContain("`code` names lib, which does not exist");
  });

  test("a file no row names is a problem", () => {
    const project = new Project();
    project.write(project.ev + "c1-before-fix.txt", "Render cancelled\n[exit 1]\n");
    expect(problems(project)).toContain("_swe/edd/cancel/evidence/c1-before-fix.txt is named by no row");
  });

  test("nothing may point into the work folder", () => {
    const project = new Project();
    project.write("_swe/edd/cancel/work/run-1/tests.txt", CARGO, 100);
    const doc = project.read();
    doc.test_logs = ["_swe/edd/cancel/work/run-1/tests.txt"];
    project.save(doc);
    expect(problems(project)).toContain("_swe/edd/cancel/work/run-1/tests.txt is in the work folder");
    const out = problemsAfter(project, 1, { evidence: ["_swe/edd/cancel/work/run-1/tests.txt"] });
    expect(out).toContain("c1: _swe/edd/cancel/work/run-1/tests.txt is in the work folder");
  });

  test("work folders are noted while open and refused at the close", () => {
    const project = new Project();
    project.write("_swe/edd/cancel/work/run-1/out.txt", "x\n");
    project.write("_swe/edd/cancel/work/ledger.before.json", "{}\n");
    project.change(2, { status: "open", note: "Not run yet." });
    expect(problems(project, 3)).toContain("_swe/edd/cancel/work still holds 2 entries: ledger.before.json, run-1.");
    project.change(2, { status: "proven" });
    expect(problems(project)).toContain("the run is not closed while it holds any");
    fs.rmSync(project.at("_swe/edd/cancel/work/run-1"), { recursive: true });
    fs.unlinkSync(project.at("_swe/edd/cancel/work/ledger.before.json"));
    problems(project, 0);
  });

  test("identical evidence files are noted", () => {
    const project = new Project();
    project.write(project.ev + "c2-copy.txt", "$ render demo\nRender cancelled (in capture)\n[exit 130]\n", 100);
    project.change(2, { evidence: [project.ev + "c2-copy.txt", project.ev + "c2-left-behind.txt"] });
    expect(problems(project, 0)).toContain(
      "hold the same bytes: _swe/edd/cancel/evidence/c1-interrupt.txt, _swe/edd/cancel/evidence/c2-copy.txt",
    );
  });

  test("user-check and waived rows need their fields", () => {
    const project = new Project();
    project.change(1, { status: "user-check", evidence: [], made_by: [project.ev + "run.sh"], shows: "" });
    project.change(3, { status: "waived", evidence: [], shows: "" });
    project.write(project.ev + "c1-interrupt.txt", "kept for c2\n", 100);
    project.change(2, { evidence: [project.ev + "c1-interrupt.txt", project.ev + "c2-left-behind.txt"] });
    fs.unlinkSync(project.at(project.ev + "c3-played.png"));
    fs.unlinkSync(project.at(project.ev + "c3-played.txt"));
    let out = problems(project);
    expect(out).toContain("c1: `note` must say exactly what the user has to run");
    expect(out).toContain("c3: a waived criterion needs `accepted`");
    expect(out).toContain("c3: `note` must say why the criterion is not met");
    project.change(1, { note: "Turn Wi-Fi off and run evidence/run.sh." });
    project.change(3, { accepted: '2026-10-11, user: "Keep ours, approve the gap"', note: "Ours gives 144 frames; closest is 120." });
    out = problems(project, 3);
    expect(out).toContain("1 for the user to check, 1 waived");
  });

  test("a malformed row is reported before anything else", () => {
    const project = new Project();
    project.change(1, { status: "done", tests: "t038_c1" });
    project.change(2, { id: "c1" });
    const out = problems(project);
    expect(out).toContain("c1: `status` is 'done'");
    expect(out).toContain("c1: `tests` must be a list");
    expect(out).toContain("two rows have the id c1");
  });

  test("odd values in a row are named as Python named them", () => {
    const project = new Project();
    project.change(1, { status: null, on_screen: "yes" });
    project.change(2, { status: true, on_screen: 1, id: 7 });
    project.change(3, { status: ["proven"], criterion: 3 });
    const out = problems(project);
    expect(out).toContain("c1: `status` is None; it must be one of: open, proven, user-check, waived.");
    expect(out).toContain("c1: `on_screen` must be true or false.");
    expect(out).toContain("row 2: `status` is True;");
    expect(out).not.toContain("row 2: `on_screen`");
    expect(out).toContain("c3: `criterion` must be text.");
    expect(out).toContain("c3: `status` is ['proven'];");
  });

  test("unreadable ledgers are usage errors", () => {
    const folder = tempDir();
    const file = path.join(folder, "ledger.json");
    const cases: [string | null, string][] = [
      [null, "ledger"],
      ["{", "not valid JSON"],
      ["{}", "was not written by"],
      [JSON.stringify({ format: FORMAT, criteria: [] }), "`criteria` must be a list"],
      [JSON.stringify({ format: FORMAT, criteria: [{}, 1] }), "`criteria` must be a list"],
      [JSON.stringify({ format: FORMAT, criteria: [{}], code: "src" }), "`code` must be a list"],
      [JSON.stringify({ format: FORMAT, criteria: [{}], root: "nowhere", evidence_dir: "e" }), "is not a directory"],
    ];
    for (const [content, said] of cases) {
      if (content !== null) fs.writeFileSync(file, content);
      const [code, , err] = run("check", file);
      expect([content, code, err.includes(said)]).toEqual([content, 2, true]);
    }
  });

  test("a JSON mistake is placed by line and column", () => {
    const folder = tempDir();
    const file = path.join(folder, "ledger.json");
    fs.writeFileSync(file, '{\n  "format": "edd/ledger@1",\n  "criteria": [,]\n}\n');
    const [code, , err] = run("check", file);
    expect(code).toBe(2);
    expect(err).toContain(`ledger: ledger ${file} is not valid JSON: Expecting value: line 3 column 16 (char 45). Correct the ledger there.`);
  });

  test("several ledgers give the worst result", () => {
    const good = new Project();
    const bad = new Project();
    bad.change(1, { shows: "" });
    expect(run("check", good.path, bad.path)[0]).toBe(1);
    expect(run("check", bad.path, good.path)[0]).toBe(1);
    bad.change(1, { status: "open", note: "The claim is not written yet." });
    expect(run("check", good.path, bad.path)[0]).toBe(3);
    expect(run("check", good.path, good.path)[0]).toBe(0);
  });
});

// ------------------------------------------------------------------------- test logs

describe("test logs", () => {
  const states = (log: string, expected: Record<string, string>) => {
    for (const [name, state] of Object.entries(expected)) {
      expect([name, testState(name.replaceAll("__", "::"), log)]).toEqual([name, state]);
    }
  };

  test("cargo", () => {
    states(CARGO, {
      t038_c1_an_interrupt_exits_130: "passed", cancel__t038_c2_nothing_is_left: "passed",
      t038_c3_parked: "skipped", t038_c4_broken: "failed", t038_c2: "absent",
    });
  });

  test("pytest", () => {
    const log =
      "tests/test_cart.py::test_empty_cart PASSED                 [ 25%]\n" +
      "tests/test_cart.py::test_total[two-items] PASSED           [ 50%]\n" +
      "tests/test_cart.py::test_total[none] FAILED                [ 75%]\n" +
      "tests/test_cart.py::test_later SKIPPED (not yet)           [100%]\n" +
      "FAILED tests/test_cart.py::test_total[none] - assert 0 == 1\n";
    states(log, { test_empty_cart: "passed", test_total: "failed", test_later: "skipped", test_cart: "absent" });
    expect(testState("test_total[two-items]", log)).toBe("passed");
  });

  test("go", () => {
    const log =
      "=== RUN   TestCancel\n--- PASS: TestCancel (0.01s)\n=== RUN   TestCancel/encode\n" +
      "    --- FAIL: TestCancel/encode (0.00s)\n=== RUN   TestLater\n--- SKIP: TestLater (0.00s)\n" +
      "=== RUN   TestHung\n";
    states(log, { TestCancel: "passed", TestLater: "skipped", TestHung: "unknown" });
    expect(testState("TestCancel/encode", log)).toBe("failed");
  });

  test("jest and vitest", () => {
    const log =
      " ✓ sums two items (2 ms)\n ✕ shows an error when the payment failed (5 ms)\n" +
      " ○ skipped rounds half up\n ✓ src/cart.test.ts > cart > keeps a failed order 1ms\n";
    expect(testState("sums two items", log)).toBe("passed");
    expect(testState("shows an error when the payment failed", log)).toBe("failed");
    expect(testState("rounds half up", log)).toBe("skipped");
    expect(testState("keeps a failed order", log)).toBe("passed");
  });

  test("tap", () => {
    const log = "ok 1 - sums two items\nnot ok 2 - rounds half up\nok 3 - later # SKIP not yet\n";
    expect(testState("sums two items", log)).toBe("passed");
    expect(testState("rounds half up", log)).toBe("failed");
    expect(testState("later", log)).toBe("skipped");
  });

  test("words are told apart as Python's \\b tells them", () => {
    expect(testState("t1", "test t1 ... okay\n")).toBe("unknown");
    expect(testState("t1", "test t1 ... éok\n")).toBe("unknown");
    expect(testState("t1", "test t1 ... DISABLED\n")).toBe("skipped");
    expect(testState("t1", "test t1 ... PEND\u0130NG\n")).toBe("skipped");
    expect(testState("t1", "test t1 ... \u017fkipped\n")).toBe("skipped");
    expect(testState("t1", "t1_more ... ok\n")).toBe("absent");
  });

  test("junit xml", () => {
    const log =
      '<?xml version="1.0"?>\n<testsuites><testsuite name="cart">' +
      '<testcase classname="cart.total" name="sums two items"/>' +
      '<testcase classname="cart.total" name="rounds half up"><failure message="x"/></testcase>' +
      '<testcase classname="cart.total" name="later"><skipped/></testcase>' +
      "</testsuite></testsuites>";
    expect(testState("sums two items", log)).toBe("passed");
    expect(testState("cart.total.rounds half up", log)).toBe("failed");
    expect(testState("later", log)).toBe("skipped");
    expect(testState("not there", log)).toBe("absent");
  });

  test("junit xml as Python's parser reads it", () => {
    // A namespace makes the elements other than `testcase`, so no test is found.
    expect(testState("a", '<testsuite xmlns="urn:x"><testcase name="a"/></testsuite>')).toBe("absent");
    // Entities of the document's own DTD are expanded; any XML version number is taken.
    const dtd = '<?xml version="1.1"?><!DOCTYPE s [<!ENTITY n "sums">]><s><testcase name="&n;"><error/></testcase></s>';
    expect(testState("sums", dtd)).toBe("failed");
    // Text that is not well-formed XML is read line by line.
    expect(testState("a", "<b>\ntest a ... ok\n")).toBe("passed");
    expect(testState("a", '\n<?xml version="1.0"?><s><testcase name="a"><failure/></testcase></s>\n')).toBe("unknown");
  });

  test("a pass in any log counts, and the worst line in one log counts", () => {
    expect(best(["failed", "passed"])).toBe("passed");
    expect(testState("t1", "test t1 ... ok\ntest t1 ... FAILED\n")).toBe("failed");
  });
});

// ------------------------------------------------------------------------- table

describe("table", () => {
  test("the table repeats the ledger", () => {
    const project = new Project();
    project.change(1, { stand_in: "A second browser stood in for the user's own.", accepted: '2026-10-11, user: "Accept as verified"' });
    const [code, out] = run("table", project.path);
    expect(code).toBe(0);
    const lines = out.split("\n").slice(0, -1);
    expect(lines[0]).toBe("3 criteria: 3 proven (1 by a stand-in the user accepted), 0 open, 0 for the user to check, 0 waived.");
    expect(lines[2]).toBe("| # | Criterion | Status | Tests | Evidence | What it shows |");
    expect(lines.length).toBe(7);
    expect(lines[4]).toContain(
      '| c1 | When the render is interrupted, it prints "Render cancelled" and exits 130. | proven by a stand-in | ' +
        "`t038_c1_an_interrupt_exits_130` | `_swe/edd/cancel/evidence/c1-interrupt.txt`, `_swe/edd/cancel/evidence/run.sh` |",
    );
    expect(lines[4]).toContain("**Stand-in:** A second browser stood in for the user's own. **Accepted:** 2026-10-11");
    expect(lines[5]).toContain("no file \\| no staging file");
    expect(lines[6]).toContain("| proven | Playback in a player is not reachable from the suite. |");
  });

  test("rows that are not closed say so", () => {
    const project = new Project();
    project.change(1, { status: "open", note: "Exit code is 1,\nnot 130.", evidence: [], made_by: [], shows: "" });
    fs.unlinkSync(project.at(project.ev + "c1-interrupt.txt"));
    project.change(3, { status: "user-check", note: "Play out/demo.mp4 to the end.", evidence: [], shows: "" });
    fs.unlinkSync(project.at(project.ev + "c3-played.png"));
    fs.unlinkSync(project.at(project.ev + "c3-played.txt"));
    const [code, out] = run("table", project.path);
    expect(code).toBe(3);
    expect(out).toContain("| open | `t038_c1_an_interrupt_exits_130` |  | **Open:** Exit code is 1, not 130. |");
    expect(out).toContain(
      "| for the user to check | Playback in a player is not reachable from the suite. |  | **To check:** Play out/demo.mp4 to the end. |",
    );
  });

  test("no table while a problem stands", () => {
    const project = new Project();
    project.change(1, { shows: "It ends `[exit 0]`." });
    const [code, out, err] = run("table", project.path);
    expect([code, out]).toEqual([1, ""]);
    expect(err).toContain("c1: `shows` quotes `[exit 0]`");
    expect(err).toContain("no table: fix the problems first");
  });
});

// ------------------------------------------------------------------------- prune

describe("prune", () => {
  test("deletes the work folder of a closed run", () => {
    const project = new Project();
    project.write("_swe/edd/cancel/work/run-1/repo/.git/objects/ab", "x\n");
    fs.chmodSync(project.at("_swe/edd/cancel/work/run-1/repo/.git/objects/ab"), 0o444);
    fs.chmodSync(project.at("_swe/edd/cancel/work/run-1/repo/.git/objects"), 0o555);
    project.write("_swe/edd/cancel/work/run-2/out.txt", "x\n");
    const [code, out] = run("prune", project.path);
    expect([code, out.includes("Deleted _swe/edd/cancel/work: 2 entries (run-1, run-2).")]).toEqual([0, true]);
    expect(out).toContain("every criterion is closed and backed");
    expect(fs.existsSync(project.at("_swe/edd/cancel/work"))).toBe(false);
    expect(fs.statSync(project.at(project.ev + "c1-interrupt.txt")).isFile()).toBe(true);
    expect(run("prune", project.path)[1]).toContain("No work folder to delete.");
  });

  test("deletes nothing while the run is open or has another problem", () => {
    const project = new Project();
    project.write("_swe/edd/cancel/work/run-1/out.txt", "x\n");
    project.change(2, { status: "open", note: "Not run yet." });
    let [code, out] = run("prune", project.path);
    expect(code).toBe(1);
    expect(out).toContain("Nothing was deleted");
    project.change(2, { status: "proven" });
    project.write(project.ev + "c1-before-fix.txt", "old\n");
    [code, out] = run("prune", project.path);
    expect(code).toBe(1);
    expect(out).toContain("is named by no row");
    expect(fs.statSync(project.at("_swe/edd/cancel/work/run-1/out.txt")).isFile()).toBe(true);
  });
});

// ------------------------------------------------------------------------- sizes and disk

describe("evidence size", () => {
  test("a large evidence folder and large pictures are noted", () => {
    const project = new Project();
    const kept = { ...limits };
    cleanups.push(() => Object.assign(limits, kept));
    let [, out] = run("check", project.path);
    expect(out).not.toContain("more than");
    Object.assign(limits, { evidence: 100, media: 10 });
    let code: number;
    [code, out] = run("check", project.path);
    expect(code).toBe(0);
    expect(out).toContain("the evidence folder _swe/edd/cancel/evidence holds");
    expect(out).toContain("The largest files: _swe/edd/cancel/evidence/");
    expect(out).toContain("_swe/edd/cancel/evidence/c3-played.png takes");
    expect(out).not.toContain("c1-interrupt.txt takes");
  });
});

describe("disk footer", () => {
  const setUp = () => {
    const folder = tempDir();
    fs.mkdirSync(path.join(folder, "work", "run-1"), { recursive: true });
    const big = path.join(folder, "work", "run-1", "big.bin");
    const bytes = new Uint8Array(3 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 65536) bytes.set(crypto.getRandomValues(new Uint8Array(65536)), index);
    fs.writeFileSync(big, bytes);
    fs.linkSync(big, path.join(folder, "work", "same.bin"));
    const here = process.cwd();
    process.chdir(folder);
    cleanups.push(() => process.chdir(here));
    return folder;
  };

  test("every command ends with what the current folder takes", () => {
    const folder = setUp();
    const [code, , err] = run("check", "missing/ledger.json");
    expect(code).toBe(2);
    const last = err.trim().split("\n").at(-1)!;
    expect(last.startsWith(`ledger: disk: the current folder ${folder} takes `)).toBe(true);
    expect(last).toContain(" 3.0 MB; its disk has ");
    expect(last).toMatch(/free of [0-9.]+ GB\.$/);
    const [size, whole] = folderSize(folder, 5);
    expect(whole).toBe(true);
    expect(size).toBeLessThan(4 * 1024 * 1024);
  });

  test("a folder too large to count in time is given as a lower bound", () => {
    setUp();
    const limit = disk.seconds;
    disk.seconds = 0;
    cleanups.push(() => (disk.seconds = limit));
    const [, , err] = run("check", "missing/ledger.json");
    expect(err).toContain("takes at least ");
    expect(err).toContain("(counting stopped after 0 s)");
  });

  test("help and wrong usage end with the disk line too", () => {
    for (const args of [["--help"], ["init", "--help"], ["nope"]]) {
      expect(run(...args)[2]).toMatch(/ledger: disk: the current folder .* free of .*\.\n$/);
    }
  });
});

// ------------------------------------------------------------------------- the Python behaviour kept

describe("what the Python script did", () => {
  test("JSON errors read as Python's json module wrote them", () => {
    const cases: [string, string][] = [
      ["", "Expecting value: line 1 column 1 (char 0)"],
      ["{", "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"],
      ['{"a" 1}', "Expecting ':' delimiter: line 1 column 6 (char 5)"],
      ['{"a": 1 "b"}', "Expecting ',' delimiter: line 1 column 9 (char 8)"],
      ['{"a": 1,}', "Expecting property name enclosed in double quotes: line 1 column 9 (char 8)"],
      ["[1,]", "Expecting value: line 1 column 4 (char 3)"],
      ["[", "Expecting value: line 1 column 2 (char 1)"],
      ['"abc', "Unterminated string starting at: line 1 column 1 (char 0)"],
      ['"a\tb"', "Invalid control character at: line 1 column 3 (char 2)"],
      ['"\\q"', "Invalid \\escape: line 1 column 2 (char 1)"],
      ['"\\u12"', "Invalid \\uXXXX escape: line 1 column 3 (char 2)"],
      ["{} x", "Extra data: line 1 column 4 (char 3)"],
      ["﻿{}", "Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)"],
      ['"é😀" x', "Extra data: line 1 column 6 (char 5)"],
    ];
    for (const [text, message] of cases) {
      let got = "";
      try {
        parseJson(text);
      } catch (error) {
        got = (error as Error).message;
      }
      expect([text, got]).toEqual([text, message]);
    }
    const parsed = parseJson('{"a": NaN, "b": -Infinity, "a": "\\ud83d\\ude00", "c": 1e2, "d": 12345678901234567}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["a", "b", "c", "d"]);
    expect(parsed.a).toBe("😀");
    expect([repr(parsed.b), repr(parsed.c), repr(parsed.d)]).toEqual(["-inf", "100.0", "12345678901234567"]);
  });

  test("repr, whitespace and UTF-8 errors match Python's", () => {
    expect(repr("it's")).toBe(`"it's"`);
    expect(repr("a'\"b\n\x01é​")).toBe("'a\\'\"b\\n\\x01é\\u200b'");
    expect(repr([1, 2.5, null, true, { k: 1e-7 }])).toBe("[1, 2.5, None, True, {'k': 1e-07}]");
    const number = (text: string) => repr(parseJson(text));
    expect(["1.0", "1e100", "-0.0001", "1e16", "123456789.5", "-0", "1E-5"].map(number)).toEqual(
      ["1.0", "1e+100", "-0.0001", "1e+16", "123456789.5", "0", "1e-05"]);
    expect(squash(" a 　b\x1c c ")).toBe("a b c");
    const failure = (bytes: number[]) => {
      try {
        decodeStrict(new Uint8Array(bytes));
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(failure([0x61, 0xff])).toBe("'utf-8' codec can't decode byte 0xff in position 1: invalid start byte");
    expect(failure([0xe2, 0x82])).toBe("'utf-8' codec can't decode bytes in position 0-1: unexpected end of data");
    expect(failure([0xe2, 0x82, 0x41])).toBe("'utf-8' codec can't decode bytes in position 0-1: invalid continuation byte");
    expect(failure([0xed, 0xa0, 0x80])).toBe("'utf-8' codec can't decode byte 0xed in position 0: invalid continuation byte");
  });
});

// ------------------------------------------------------------------------- help and usage

describe("help", () => {
  test("no command prints the help and is wrong usage", () => {
    const [code, out] = run();
    expect(code).toBe(2);
    expect(out).toContain("usage: ledger [-h] COMMAND ...");
  });

  test("--help, -h and help describe the tool, its workflow, files and exit codes", () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const [code, out] = run(...args);
      expect([args, code]).toEqual([args, 0]);
      for (const command of COMMANDS) expect(out).toContain(`  ${command.name}  `);
      for (const heading of ["typical workflow:", "files:", "exit codes:", "ledger init _swe/edd/", "ledger prune "]) {
        expect(out).toContain(heading);
      }
      for (const code of ["0", "1", "2", "3"]) expect(out).toContain(`\n  ${code}  `);
      expect(out).toBe(top() + "\n");
    }
  });

  test("every command has its own help with every option, the output, the exit codes and examples", () => {
    for (const command of COMMANDS) {
      const help = commandHelp("ledger", command);
      for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name], [command.name, "x", "--help"]]) {
        const [code, out] = run(...args);
        expect([args, code, out]).toEqual([args, 0, help + "\n"]);
      }
      expect(help).toContain(`usage: ledger ${command.name} [-h]`);
      for (const section of ["options:", "output:", "exit codes:", "examples:"]) expect(help).toContain(section);
      for (const option of command.options) {
        expect(help).toContain(`  ${option.name} ${option.metavar}`);
        if (option.defaultText) expect(help.replace(/\s+/g, " ")).toContain(`[default: ${option.defaultText}]`);
      }
      for (const positional of command.positionals) expect(help).toContain(`  ${positional.metavar}  `);
      expect(command.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("help lines fit in 88 columns, apart from commands kept whole", () => {
    const texts = [top(), ...COMMANDS.map((command) => commandHelp("ledger", command))];
    for (const text of texts) {
      for (const line of text.split("\n")) expect([line, line.length <= WIDTH]).toEqual([line, true]);
    }
  });

  test("every example parses without a usage error", () => {
    const words = (line: string) =>
      (line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((word) => word.replace(/^"(.*)"$|^'(.*)'$/, "$1$2"));
    for (const command of COMMANDS) {
      for (const example of command.examples) {
        const [prog, name, ...rest] = words(example);
        expect([prog, name]).toEqual(["ledger", command.name]);
        expect(() => parseCommand("ledger", command, rest)).not.toThrow();
      }
    }
  });

  test("wrong usage names the problem, the usage and the help, and suggests what was meant", () => {
    let [code, , err] = run("chek", "x");
    expect(code).toBe(2);
    expect(err).toContain("usage: ledger [-h] COMMAND ...\nledger: error: argument COMMAND: invalid choice: 'chek'");
    expect(err).toContain("(did you mean check?)");
    expect(err).toContain("Run 'ledger --help' for help.");
    [code, , err] = run("init", "x.json", "--task", "t", "--critera", "a");
    expect(code).toBe(2);
    expect(err).toContain("ledger init: error: unrecognized arguments: --critera (did you mean --criterion?)");
    expect(err).toContain("Run 'ledger init --help' for help.");
    [code, , err] = run("check");
    expect([code, err.includes("ledger check: error: the following arguments are required: LEDGER")]).toEqual([2, true]);
    [code, , err] = run("init", "x.json");
    expect(err).toContain("the following arguments are required: --task");
    [code, , err] = run("init", "x.json", "--c", "y");
    expect(err).toContain("ambiguous option: --c could match --criteria-from, --criterion, --code");
    [code, , err] = run("init", "x.json", "--task");
    expect(err).toContain("argument --task: expected one argument");
    [code, , err] = run("table", "a.json", "b.json");
    expect(err).toContain("ledger table: error: unrecognized arguments: b.json");
    [code, , err] = run("help", "prnue");
    expect([code, err.includes("there is no command named 'prnue' (did you mean prune?)")]).toEqual([2, true]);
  });

  test("options take --name=value and unique prefixes", () => {
    const folder = tempDir();
    const file = path.join(folder, "ledger.json");
    const [code] = run("init", file, "--task=t", `--root=${folder}`, "--criterio", "It works.");
    expect(code).toBe(0);
  });
});

// ------------------------------------------------------------------------- the built script

describe("the built script", () => {
  const runBuilt = (cwd: string, ...args: string[]) => {
    const done = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd, env: { ...process.env } });
    return [done.exitCode, done.stdout.toString(), done.stderr.toString()] as const;
  };

  test("it is up to date with the source", () => {
    const built = fs.statSync(SCRIPT).mtimeMs;
    const sourceDir = path.join(import.meta.dir, "..", "src");
    for (const name of fs.readdirSync(sourceDir)) {
      expect([name, fs.statSync(path.join(sourceDir, name)).mtimeMs <= built]).toEqual([name, true]);
    }
  });

  test("it runs the workflow as a program", () => {
    const project = new Project();
    let [code, out, err] = runBuilt(project.dir, "check", project.path);
    expect([code, out.includes("every criterion is closed and backed")]).toEqual([0, true]);
    expect(err).toMatch(/^ledger: disk: the current folder /);
    [code, out] = runBuilt(project.dir, "table", project.path);
    expect([code, out.split("\n")[2]]).toEqual([0, "| # | Criterion | Status | Tests | Evidence | What it shows |"]);
    [code, out] = runBuilt(project.dir, "--help");
    expect([code, out.includes("typical workflow:")]).toEqual([0, true]);
    [code, , err] = runBuilt(project.dir, "init", "new.json");
    expect([code, err.includes("the following arguments are required: --task")]).toEqual([2, true]);
    [code, out] = runBuilt(project.dir, "init", "run/ledger.json", "--task", "t", "--criterion", "It works.");
    expect([code, out]).toEqual([0, "wrote run/ledger.json: 1 criteria, all open\nevidence goes in run/evidence\n"]);
  });
});
