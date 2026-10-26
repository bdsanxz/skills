// The ledger: written by `init`, read and checked by `check`, `table` and `prune`.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PROG,
  PyNumber,
  UsageError,
  WS,
  blank,
  byCodePoint,
  clock,
  decodeLenient,
  DecodeError,
  decodeStrict,
  exists,
  inside,
  isDir,
  isFile,
  isRecord,
  mtime,
  oneDecimal,
  relpath,
  repr,
  splitLines,
  squash,
  strip,
  systemMessage,
  universalNewlines,
  walk,
} from "./core";
import { JsonError, parseJson } from "./pyjson";
import { best, testState } from "./testlog";

export const FORMAT = "edd/ledger@1";
export const STATUSES = ["open", "proven", "user-check", "waived"] as const;
type Status = (typeof STATUSES)[number];
export const MB = 1024 * 1024;

/** Sizes worth a note. The tests lower them. */
export const limits = {
  evidence: 100 * MB, // an evidence folder larger than this holds evidence worth deleting
  media: 5 * MB, // a picture or recording larger than this is worth making smaller
};
const MEDIA = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".tif", ".tiff", ".bmp",
  ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".y4m"];

const TEXT_FIELDS = ["criterion", "no_test", "shows", "stand_in", "accepted", "note"] as const;
const LIST_FIELDS = ["tests", "evidence", "made_by"] as const;

export type Row = {
  id: string;
  criterion: string;
  on_screen: unknown;
  status: unknown;
  tests: string[];
  no_test: string;
  evidence: string[];
  made_by: string[];
  shows: string;
  stand_in: string;
  accepted: string;
  note: string;
};

/** A new row, in the order its fields are written. */
function newRow(id: string, criterion: string): Row {
  return {
    id,
    criterion,
    on_screen: null,
    status: "open",
    tests: [],
    no_test: "",
    evidence: [],
    made_by: [],
    shows: "",
    stand_in: "",
    accepted: "",
    note: "",
  };
}

const SKIPPED_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "target", "dist", "build", "out", "coverage",
  "__pycache__", ".venv", "venv", ".tox", ".next", ".cache", ".gradle", "DerivedData",
]);
const LIST_ITEM = new RegExp(`^[${WS}]*(?:[-*+][${WS}]+(?:\\[[ xXuU~]\\][${WS}]+)?|\\p{Nd}+[.)][${WS}]+)([^\\n]+?)[${WS}]*$`, "u");
const HEADING = new RegExp(`^(#{1,6})[${WS}]+([^\\n]+?)[${WS}]*#*[${WS}]*$`, "u");
const QUOTE = /`([^`]+)`/g;

function readText(file: string) {
  return universalNewlines(decodeStrict(fs.readFileSync(file)));
}

// ---------------------------------------------------------------------------------- init

/** The criteria written in a file: its list items, or else every line that is not a heading. */
export function criteriaFrom(file: string, section: string | null) {
  let lines: string[];
  try {
    lines = splitLines(readText(file));
  } catch (error) {
    throw new UsageError(`criteria file ${file}: ${systemMessage(error, file)}`);
  }
  if (section) lines = sectionOf(lines, section, file);
  let items = lines.flatMap((line) => {
    const found = LIST_ITEM.exec(line);
    return found ? [found[1]!] : [];
  });
  if (!items.length) items = lines.filter((line) => !blank(line) && !HEADING.test(line)).map(strip);
  if (!items.length) {
    const where = section ? ` under the heading ${repr(section)}` : "";
    throw new UsageError(`criteria file ${file} holds no criteria${where}.`);
  }
  return items;
}

function sectionOf(lines: string[], section: string, file: string) {
  const wanted = strip(section).toLowerCase();
  let start: number | null = null;
  let level = 0;
  for (const [index, line] of lines.entries()) {
    const found = HEADING.exec(line);
    if (!found) continue;
    if (start === null && strip(found[2]!).toLowerCase() === wanted) {
      start = index + 1;
      level = found[1]!.length;
    } else if (start !== null && found[1]!.length <= level) {
      return lines.slice(start, index);
    }
  }
  if (start === null) throw new UsageError(`criteria file ${file} has no heading ${repr(section)}.`);
  return lines.slice(start);
}

export type InitArgs = {
  ledger: string;
  task: string;
  criteriaFrom: string | null;
  section: string | null;
  criterion: string[];
  root: string;
  evidenceDir: string | null;
  code: string[];
};

/** A mistake in the arguments, which `init` reports with its usage line. */
export class InitArgumentError extends UsageError {}

export function init(args: InitArgs, out: (text?: string) => void) {
  if (args.criteriaFrom && args.criterion.length) {
    throw new InitArgumentError("give --criteria-from or --criterion, not both.");
  }
  const ledger = path.resolve(args.ledger);
  if (exists(ledger)) throw new UsageError(`${args.ledger} already exists. Edit it, or give this run another name.`);
  let texts: string[];
  if (args.criteriaFrom) texts = criteriaFrom(args.criteriaFrom, args.section);
  else if (args.criterion.length) texts = args.criterion.map(strip);
  else throw new InitArgumentError("give the criteria with --criteria-from FILE or with --criterion TEXT.");
  if (texts.some((text) => !text)) throw new InitArgumentError("a criterion is empty.");
  const root = path.resolve(args.root);
  if (!isDir(root)) throw new InitArgumentError(`--root ${args.root} is not a directory.`);
  const home = path.dirname(ledger);
  const evidence = args.evidenceDir ? path.resolve(args.evidenceDir) : path.join(home, "evidence");
  for (const item of args.code) {
    if (!exists(path.resolve(root, item))) throw new InitArgumentError(`--code ${item} does not exist under ${args.root}.`);
  }
  const rows = texts.map((text, index) => newRow(`c${index + 1}`, text));
  const doc = {
    format: FORMAT,
    task: strip(args.task),
    root: relpath(root, home),
    evidence_dir: relpath(evidence, root),
    code: [...args.code],
    test_logs: [],
    criteria: rows,
  };
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(ledger, JSON.stringify(doc, null, 2) + "\n");
  out(`wrote ${args.ledger}: ${rows.length} criteria, all open`);
  out(`evidence goes in ${relpath(evidence)}`);
  return 0;
}

// --------------------------------------------------------------------------------- check

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

/** The files of a code path: the files git knows or would add, or else a walk past build folders. */
function filesUnder(target: string) {
  if (isFile(target)) return [target];
  try {
    const listed = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: target,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (listed.exitCode === 0) {
      return decodeLenient(listed.stdout)
        .split("\0")
        .filter(Boolean)
        .map((name) => path.join(target, name))
        .filter(isFile);
    }
  } catch {
    // git is not installed: walk the folder instead.
  }
  const found: string[] = [];
  for (const [folder, folders, names] of walk(target)) {
    const kept = folders.filter((name) => !SKIPPED_DIRS.has(name));
    folders.splice(0, folders.length, ...kept);
    found.push(...names.map((name) => path.join(folder, name)));
  }
  return found;
}

type Shown = { id: string } | null;

/** A ledger read from disk, with the problems and notes found while checking it. */
export class Ledger {
  readonly doc: Record<string, unknown>;
  readonly rows: Row[];
  readonly root: string;
  readonly evidenceDir: string;
  readonly work: string;
  readonly code: string[];
  readonly testLogs: string[];
  problems: string[] = [];
  notes: string[] = [];
  workProblem: string | null = null;
  private texts = new Map<string, string | null>();

  constructor(readonly file: string) {
    let doc: unknown;
    try {
      doc = parseJson(readText(file));
    } catch (error) {
      if (error instanceof JsonError || error instanceof DecodeError) {
        throw new UsageError(`ledger ${file} is not valid JSON: ${systemMessage(error)}. Correct the ledger there.`);
      }
      throw new UsageError(`ledger ${file}: ${systemMessage(error, file)}. Give the path of a ledger that \`${PROG} init\` wrote.`);
    }
    if (!isRecord(doc) || doc.format !== FORMAT) {
      throw new UsageError(`ledger ${file} was not written by \`${PROG} init\`.`);
    }
    const rows = doc.criteria;
    if (!Array.isArray(rows) || !rows.length || !rows.every(isRecord)) {
      throw new UsageError(`ledger ${file}: \`criteria\` must be a list of rows, and not an empty one.`);
    }
    for (const key of ["code", "test_logs"]) {
      if (!isStrings(doc[key] ?? [])) throw new UsageError(`ledger ${file}: \`${key}\` must be a list of paths.`);
    }
    for (const key of ["root", "evidence_dir"]) {
      if (typeof doc[key] !== "string" || !doc[key]) throw new UsageError(`ledger ${file}: \`${key}\` must be a path.`);
    }
    this.doc = doc;
    this.rows = rows as Row[];
    this.code = (doc.code ?? []) as string[];
    this.testLogs = (doc.test_logs ?? []) as string[];
    const home = path.dirname(path.resolve(file));
    this.root = path.resolve(home, doc.root as string);
    if (!isDir(this.root)) throw new UsageError(`ledger ${file}: its \`root\`, ${this.root}, is not a directory.`);
    this.evidenceDir = this.full(doc.evidence_dir as string);
    this.work = path.join(home, "work");
  }

  full(relative: string) {
    return path.resolve(this.root, relative);
  }

  /** The file's content when it is text, with runs of whitespace squashed; null when it is not. */
  textOf(relative: string) {
    if (!this.texts.has(relative)) {
      let text: string | null;
      try {
        const data = fs.readFileSync(this.full(relative));
        text = data.includes(0) ? null : squash(decodeStrict(data));
      } catch {
        text = null;
      }
      this.texts.set(relative, text);
    }
    return this.texts.get(relative)!;
  }

  usable(relative: string) {
    try {
      const info = fs.statSync(this.full(relative));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  check() {
    this.checkShape();
    if (this.problems.length) return;
    const newest = this.newestCode();
    const logs = this.readTestLogs(newest);
    for (const row of this.rows) {
      if (row.status === "proven") {
        this.checkProven(row, newest, logs);
      } else if (row.status === "user-check") {
        this.checkFiles(row, "made_by");
        if (blank(row.note)) this.problem(row, "`note` must say exactly what the user has to run or look at.");
      } else if (row.status === "waived") {
        if (blank(row.accepted)) {
          this.problem(row, "a waived criterion needs `accepted`: the user's own words and the date. " +
            "Ask the user, or set the status back to open.");
        }
        if (blank(row.note)) {
          this.problem(row, "`note` must say why the criterion is not met and what the closest behaviour is.");
        }
      }
    }
    this.checkEvidenceDir();
    this.checkWork();
  }

  /** Work folders are deleted once read: nothing may point into them, and none may outlive the run. */
  private checkWork() {
    const named: [Row | null, string][] = this.rows.flatMap((row) =>
      [...row.evidence, ...row.made_by].map((item): [Row, string] => [row, item]));
    named.push(...this.testLogs.map((item): [null, string] => [null, item]));
    for (const [row, item] of named) {
      if (inside(this.full(item), this.work)) {
        this.problem(row, `${item} is in the work folder, which is deleted after use. Copy it into the ` +
          "evidence folder, or have the script write it there, and name that copy.");
      }
    }
    let left: string[];
    try {
      left = fs.readdirSync(this.work).filter((name) => name !== ".DS_Store").sort(byCodePoint);
    } catch {
      return;
    }
    if (!left.length) return;
    const [count, shown] = entries(left);
    const text = `${relpath(this.work, this.root)} still holds ${count}: ${shown}. Delete each work folder, ` +
      "by its exact path, once its transcripts are read and recorded";
    const counts = this.counts();
    if (counts.open || counts["user-check"]) {
      this.notes.push(text + ".");
    } else {
      this.workProblem = text + "; the run is not closed while it holds any.";
      this.problem(null, this.workProblem);
    }
  }

  problem(row: Shown, text: string) {
    this.problems.push(row ? `${row.id}: ${text}` : text);
  }

  private checkShape() {
    const seen = new Set<string>();
    for (const [index, record] of (this.rows as unknown as Record<string, unknown>[]).entries()) {
      for (const [key, value] of Object.entries(newRow("", ""))) {
        if (!(key in record)) record[key] = Array.isArray(value) ? [] : value;
      }
      const name = typeof record.id === "string" && record.id ? record.id : `row ${index + 1}`;
      const shown = { id: name };
      if (seen.has(name)) this.problem(null, `two rows have the id ${name}.`);
      seen.add(name);
      record.id = name;
      for (const key of TEXT_FIELDS) {
        if (typeof record[key] !== "string") {
          this.problem(shown, `\`${key}\` must be text.`);
          record[key] = "";
        }
      }
      for (const key of LIST_FIELDS) {
        if (!isStrings(record[key])) {
          this.problem(shown, `\`${key}\` must be a list of text values.`);
          record[key] = [];
        }
      }
      if (blank(record.criterion as string)) {
        this.problem(shown, "`criterion` is empty. It holds the criterion word for word.");
      }
      if (!(STATUSES as readonly unknown[]).includes(record.status)) {
        this.problem(shown, `\`status\` is ${repr(record.status)}; it must be one of: ${STATUSES.join(", ")}.`);
      }
      // Python's `in (True, False, None)` also took the numbers 1 and 0.
      const value = record.on_screen;
      if (![true, false, null].includes(value as never) && !(value instanceof PyNumber && (value.value === 0 || value.value === 1))) {
        this.problem(shown, "`on_screen` must be true or false.");
      }
    }
  }

  private checkFiles(row: Row, key: "evidence" | "made_by") {
    for (const item of row[key]) {
      if (!this.usable(item)) {
        this.problem(row, `${key === "evidence" ? "evidence" : "script"} file ${item} is missing or empty.`);
      }
    }
  }

  private checkProven(row: Row, newest: Newest, logs: string[]) {
    if (row.on_screen === null) {
      this.problem(row, "`on_screen` is not decided. Set it to true when the criterion is about " +
        "something a person sees, and to false otherwise.");
    }
    this.checkFiles(row, "evidence");
    this.checkFiles(row, "made_by");
    const present = row.evidence.filter((item) => this.usable(item));
    if (!row.evidence.length) this.problem(row, "no evidence file is named. Without evidence the status is open.");
    const texts = present.map((item) => this.textOf(item));
    if (row.on_screen === true && present.length && texts.every((text) => text !== null)) {
      this.problem(row, "the criterion is about something seen, and its evidence is text only. " +
        "Add a picture or a recording that shows it.");
    }
    this.checkShows(row, present, texts.filter((text): text is string => text !== null));
    if (!blank(row.stand_in) && blank(row.accepted)) {
      this.problem(row, "it was checked by a stand-in that nobody accepted. Ask the user, and put " +
        "their own words and the date in `accepted`; until then the status is open.");
    }
    this.checkTests(row, logs);
    const scripts = row.made_by.filter((item) => this.usable(item)).map((item): [number, string] => [mtime(this.full(item)), item]);
    for (const item of present) {
      const made = mtime(this.full(item));
      if (newest && made < newest[0]) {
        this.problem(row, `${item} was made at ${clock(made)}, before ${newest[1]} last changed (${clock(newest[0])}). ` +
          "Make it again from the current code and read the new result.");
      }
      for (const [changed, source] of scripts) {
        if (made < changed && item !== source) {
          this.problem(row, `${item} was made at ${clock(made)}, before its script ${source} last changed ` +
            `(${clock(changed)}). Run the script again and read the new result.`);
        }
      }
    }
  }

  private checkShows(row: Row, present: string[], texts: string[]) {
    const shows = strip(row.shows);
    if (!shows) {
      this.problem(row, "`shows` is empty. Say what the evidence shows, quoting its lines in backticks.");
      return;
    }
    const quotes = [...shows.matchAll(QUOTE)].map((found) => squash(found[1]!));
    if (!present.length) return;
    if (!texts.length) {
      if (quotes.length) {
        this.problem(row, "`shows` quotes text, and the evidence holds no text file to find it in. " +
          "Backticks are only for words copied from a text evidence file.");
      }
      return;
    }
    if (!quotes.length) {
      this.problem(row, "`shows` quotes nothing. Copy the lines or values that prove the criterion " +
        "from the evidence file, in backticks.");
    }
    for (const quote of quotes) {
      if (!texts.some((text) => text.includes(quote))) {
        this.problem(row, `\`shows\` quotes \`${quote}\`, and no text evidence file of this row holds it. ` +
          "Quote the file exactly, or correct the claim.");
      }
    }
  }

  private checkTests(row: Row, logs: string[]) {
    if (!row.tests.length) {
      if (blank(row.no_test)) {
        this.problem(row, "no test is named. Name the tests that cover it, or say in `no_test` " +
          "why none can and what checks it in their place.");
      }
      return;
    }
    if (!this.testLogs.length) {
      this.problem(row, "tests are named and `test_logs` is empty. Save the output of the final " +
        "test run in the evidence folder and name it in `test_logs`.");
      return;
    }
    for (const name of row.tests) {
      const state = best(logs.map((log) => testState(name, log)));
      if (state === "absent") {
        this.problem(row, `test ${name} is in no test log. Check the name, and that the log shows each test by name.`);
      } else if (state === "failed") {
        this.problem(row, `test ${name} failed in the test log.`);
      } else if (state === "skipped") {
        this.problem(row, `test ${name} was skipped or ignored in the test log. A test that did not run proves nothing.`);
      } else if (state === "unknown") {
        this.problem(row, `test ${name} is named in the test log with no result on its line. ` +
          "Run the tests so that each one is listed with its result.");
      }
    }
  }

  private readTestLogs(newest: Newest) {
    const logs: string[] = [];
    for (const item of this.testLogs) {
      if (!this.usable(item)) {
        this.problem(null, `test log ${item} is missing or empty.`);
        continue;
      }
      const made = mtime(this.full(item));
      if (newest && made < newest[0]) {
        this.problem(null, `test log ${item} was made at ${clock(made)}, before ${newest[1]} last changed ` +
          `(${clock(newest[0])}). Run the tests again on the current code.`);
      }
      logs.push(decodeLenient(fs.readFileSync(this.full(item))));
    }
    return logs;
  }

  /** The time and path of the code file changed last, or null when no code is listed. */
  private newestCode(): Newest {
    if (!this.rows.some((row) => row.status === "proven")) return null;
    if (!this.code.length) {
      this.problem(null, "`code` is empty. List the files and folders this task changes (product code " +
        "and tests), so that evidence older than the code is found.");
      return null;
    }
    let newest: Newest = null;
    const own = [this.evidenceDir, path.dirname(path.resolve(this.file))];
    for (const item of this.code) {
      const full = this.full(item);
      if (!exists(full)) {
        this.problem(null, `\`code\` names ${item}, which does not exist.`);
        continue;
      }
      for (const file of filesUnder(full)) {
        if (own.some((folder) => inside(file, folder))) continue;
        let stamp: number;
        try {
          stamp = mtime(file);
        } catch {
          continue; // a broken link, or a file deleted while the folder was read
        }
        if (newest === null || stamp > newest[0]) newest = [stamp, relpath(file, this.root)];
      }
    }
    return newest;
  }

  private checkEvidenceDir() {
    const named = new Set<string>();
    for (const row of this.rows) for (const item of [...row.evidence, ...row.made_by]) named.add(this.full(item));
    for (const item of this.testLogs) named.add(this.full(item));
    named.add(path.resolve(this.file));
    if (isDir(this.evidenceDir)) {
      const folders = [...walk(this.evidenceDir)].sort(([a], [b]) => byCodePoint(a, b));
      for (const [folder, , names] of folders) {
        for (const name of [...names].sort(byCodePoint)) {
          const file = path.join(folder, name);
          if (!named.has(file) && name !== ".DS_Store") {
            this.problem(null, `${relpath(file, this.root)} is named by no row. Delete it when it is superseded or a ` +
              "leftover; otherwise name it in the row it proves.");
          }
        }
      }
    }
    this.checkSize();
    const byHash = new Map<string, Set<string>>();
    for (const row of this.rows) {
      for (const item of row.evidence) {
        if (!this.usable(item)) continue;
        const hash = crypto.createHash("sha256").update(fs.readFileSync(this.full(item))).digest("hex");
        if (!byHash.has(hash)) byHash.set(hash, new Set());
        byHash.get(hash)!.add(item);
      }
    }
    for (const items of byHash.values()) {
      if (items.size > 1) {
        this.notes.push(`these evidence files hold the same bytes: ${[...items].sort(byCodePoint).join(", ")}. ` +
          "Keep both only when that is intended.");
      }
    }
  }

  /** Notes an evidence folder that has grown large, and the pictures and recordings that make it so. */
  private checkSize() {
    if (!isDir(this.evidenceDir)) return;
    const sizes: [number, string][] = [];
    for (const [folder, , names] of walk(this.evidenceDir)) {
      for (const name of names) {
        const file = path.join(folder, name);
        try {
          if (fs.lstatSync(file).isSymbolicLink()) continue;
          sizes.push([fs.statSync(file).size, relpath(file, this.root)]);
        } catch {
          // deleted while the folder was read
        }
      }
    }
    sizes.sort(([sizeA, nameA], [sizeB, nameB]) => sizeB - sizeA || byCodePoint(nameB, nameA));
    const total = sizes.reduce((sum, [size]) => sum + size, 0);
    if (total > limits.evidence) {
      const largest = sizes.slice(0, 5).map(([size, name]) => `${name} (${megabytes(size)})`).join(", ");
      this.notes.push(`the evidence folder ${relpath(this.evidenceDir, this.root)} holds ${megabytes(total)}, more than ` +
        `${megabytes(limits.evidence)}. Delete the evidence that is no longer relevant, and make large pictures and ` +
        `recordings smaller. The largest files: ${largest}.`);
    }
    for (const [size, name] of sizes) {
      if (size > limits.media && MEDIA.some((suffix) => name.toLowerCase().endsWith(suffix))) {
        this.notes.push(`${name} takes ${megabytes(size)}. Remove it when no criterion needs it; otherwise replace it ` +
          "with a cropped or scaled-down picture, or a sheet of frames, and name that instead.");
      }
    }
  }

  counts(): Record<Status, number> {
    const counts = { open: 0, proven: 0, "user-check": 0, waived: 0 };
    for (const row of this.rows) if ((STATUSES as readonly unknown[]).includes(row.status)) counts[row.status as Status]++;
    return counts;
  }

  summary() {
    const counts = this.counts();
    const standIns = this.rows.filter((row) => row.status === "proven" && !blank(row.stand_in)).length;
    let proven = `${counts.proven} proven`;
    if (standIns) proven += ` (${standIns} by a stand-in the user accepted)`;
    return `${this.rows.length} criteria: ${proven}, ${counts.open} open, ${counts["user-check"]} for the user to check, ` +
      `${counts.waived} waived`;
  }

  exitCode() {
    if (this.problems.length) return 1;
    const counts = this.counts();
    return counts.open || counts["user-check"] ? 3 : 0;
  }
}

type Newest = [number, string] | null;

/** "2 entries" and "a, b": the count, and the names, at most eight of them. */
export function entries(names: string[]): [string, string] {
  const shown = names.slice(0, 8).join(", ") + (names.length > 8 ? ` and ${names.length - 8} more` : "");
  return [`${names.length} entr${names.length === 1 ? "y" : "ies"}`, shown];
}

export function megabytes(size: number) {
  return `${oneDecimal(size / MB)} MB`;
}

export function report(ledger: Ledger, write: (text: string) => void) {
  write(`${ledger.file}: ${ledger.summary()}`);
  if (ledger.problems.length) {
    write("problems:");
    for (const text of ledger.problems) write("  " + text);
  }
  if (ledger.notes.length) {
    write("notes:");
    for (const text of ledger.notes) write("  " + text);
  }
  const waiting = ledger.rows.filter((row) => row.status === "open" || row.status === "user-check");
  if (waiting.length) {
    write("not closed:");
    for (const row of waiting) write(`  ${row.id} [${row.status}]: ${squash(row.note) || "no reason recorded"}`);
  }
  const code = ledger.exitCode();
  if (code === 1) {
    write("result: problems found. Nothing in this ledger may be reported as proven until they are fixed.");
  } else if (code === 3) {
    write("result: no problems, and the task is not complete: the rows above are not closed.");
  } else {
    write("result: every criterion is closed and backed by its evidence.");
  }
}

// --------------------------------------------------------------------------------- prune

/** Deletes a folder and everything in it, making read-only folders writable on the way. */
function removeTree(target: string) {
  const retry = (operation: () => void, file: string) => {
    try {
      operation();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EACCES" && code !== "EPERM") throw error;
      fs.chmodSync(path.dirname(file), 0o700);
      if (!fs.lstatSync(file).isSymbolicLink()) fs.chmodSync(file, 0o700);
      operation();
    }
  };
  const remove = (file: string) => {
    if (fs.lstatSync(file).isDirectory()) {
      let names: string[] = [];
      retry(() => void (names = fs.readdirSync(file)), file);
      for (const name of names) remove(path.join(file, name));
      retry(() => fs.rmdirSync(file), file);
    } else {
      retry(() => fs.unlinkSync(file), file);
    }
  };
  remove(target);
}

export function prune(file: string, out: (text: string) => void) {
  const ledger = new Ledger(file);
  ledger.check();
  const other = ledger.problems.filter((text) => text !== ledger.workProblem);
  const counts = ledger.counts();
  if (other.length || counts.open || counts["user-check"]) {
    report(ledger, out);
    out("Nothing was deleted: prune only a run that `check` finds closed and backed, apart from its work folder.");
    return 1;
  }
  const shown = relpath(ledger.work, ledger.root);
  let link = false;
  try {
    link = fs.lstatSync(ledger.work).isSymbolicLink();
  } catch {
    // no work folder
  }
  if (link) {
    out(`${shown} is a symbolic link, and was left alone. Delete it by its exact path.`);
  } else if (isDir(ledger.work)) {
    const left = fs.readdirSync(ledger.work).sort(byCodePoint);
    removeTree(ledger.work);
    const [count, names] = entries(left);
    out(`Deleted ${shown}: ${count} (${names}).`);
  } else {
    out("No work folder to delete.");
  }
  const again = new Ledger(file);
  again.check();
  report(again, out);
  return again.exitCode();
}

// --------------------------------------------------------------------------------- table

function cell(text: string) {
  return squash(text).replaceAll("|", "\\|");
}

export function table(file: string, out: (text: string) => void, err: (text: string) => void) {
  const ledger = new Ledger(file);
  ledger.check();
  if (ledger.problems.length) {
    report(ledger, err);
    err("no table: fix the problems first.");
    return 1;
  }
  out(`${ledger.summary()}.`);
  out("");
  out("| # | Criterion | Status | Tests | Evidence | What it shows |");
  out("| --- | --- | --- | --- | --- | --- |");
  for (const row of ledger.rows) {
    let status = row.status as string;
    let shows = cell(row.shows);
    if (status === "proven" && !blank(row.stand_in)) {
      status = "proven by a stand-in";
      shows += ` **Stand-in:** ${cell(row.stand_in)} **Accepted:** ${cell(row.accepted)}`;
    } else if (status === "user-check") {
      status = "for the user to check";
      shows = `**To check:** ${cell(row.note)}`;
    } else if (status === "waived") {
      shows = `**Not met:** ${cell(row.note)} **Accepted:** ${cell(row.accepted)}`;
    } else if (status === "open") {
      shows = `**Open:** ${cell(row.note) || "no reason recorded"}`;
    }
    if (row.status === "proven" && !blank(row.note)) shows += ` **Note:** ${cell(row.note)}`;
    const tests = row.tests.map((name) => `\`${name}\``).join(", ") || cell(row.no_test);
    const files = [...row.evidence, ...row.made_by].map((item) => `\`${item}\``).join(", ");
    out(`| ${row.id} | ${cell(row.criterion)} | ${status} | ${tests} | ${files} | ${strip(shows)} |`);
  }
  return ledger.exitCode();
}
