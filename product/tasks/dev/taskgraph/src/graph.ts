// Read a tasks document, validate it, and build its dependency graph.

import { D, DocumentError, S, W, WORD, compareText, lstrip, rstrip, splitLines, strip, stripChars } from "./core";

export const PATH_KINDS = ["Happy", "Alternative", "Negative"] as const;
const NONE_WORDS = ["", "none", "-", "—", "n/a"];

const HEADING = new RegExp(`^(#{1,6})${W}+(.*?)${W}*#*${W}*$`, "u");
const TASK_HEADING = new RegExp(`^(T${D}+)(?!${WORD})[.:]?${W}*(.*?)${W}*$`, "u");
const QUESTION_HEADING = new RegExp(`^(Q${D}+)(?!${WORD})[.:]?${W}*(.*?)${W}*$`, "u");
const FIELD = new RegExp(`^${W}*[-*]${W}+\\*\\*([^*]+)\\*\\*${W}*:${W}*(.*?)${W}*$`, "u");
const BOLD_LABEL = /^\*\*[^*]+\*\*/u;
// Python's case-insensitive match lets `i` also match U+0130 and U+0131; nothing else differs.
const CRITERIA_LABEL = new RegExp(
  `^\\*\\*[Aa][Cc][Cc][Ee][Pp][Tt][Aa][Nn][Cc][Ee] [Cc][Rr][Ii\\u0130\\u0131][Tt][Ee][Rr][Ii\\u0130\\u0131][Aa]\\*\\*${W}*:?${W}*$`,
  "u",
);
const CHECKBOX = new RegExp(`^${W}*[-*]${W}+\\[([ xX])\\]${W}+(${S}.*?)${W}*$`, "u");
const LIST_ITEM = new RegExp(`^${W}*(?:[-*+]|${D}+[.)])${W}+${S}`, "u");
const MARKER = new RegExp(`\\[(Q${D}+)\\]`, "gu");
const RESOLVED_LINE = new RegExp(`^${W}*[-*]${W}+(Q${D}+)(?!${WORD})`, "u");
const TASK_ID = new RegExp(`^T${D}+$`, "u");
const FENCE = new RegExp(`^${W}*(\`\`\`|~~~)`, "u");
const SEPARATOR_CELL = /^:?-{3,}:?$/u;
const ID_SEPARATOR = new RegExp(`[,;${W.slice(1, -1)}]+`, "u");
const REFERENCE = new RegExp(`(?<!${WORD})([TQ]${D}+)(?!${WORD})`, "gu");

export class Task {
  fields = new Map<string, string>();
  needs: string[] = []; // task IDs, as written
  needsLine: number;
  criteriaSeen = false;
  items: [ticked: boolean, text: string][] = [];
  badItems: [line: number, text: string][] = []; // list items in the checklist that are no checkbox
  markers = new Map<string, number>(); // question ID -> line of the first marker

  constructor(
    readonly id: string,
    readonly title: string,
    readonly feature: string | null,
    readonly line: number,
  ) {
    this.needsLine = line;
  }

  get done() {
    return this.items.length > 0 && this.items.every(([ticked]) => ticked);
  }

  get path() {
    return this.fields.get("path") ?? "";
  }

  get optional() {
    return strip(this.fields.get("status") ?? "").toLowerCase() === "optional";
  }

  get tag() {
    return this.path + (this.optional ? ", optional" : "");
  }

  label() {
    return rstrip(`${this.id}  ${this.title}`);
  }

  addMarkers(text: string, line: number) {
    for (const found of text.matchAll(MARKER)) {
      if (!this.markers.has(found[1]!)) this.markers.set(found[1]!, line);
    }
  }
}

export class Question {
  blocks: string[] = [];
  blocksLine: number;

  constructor(
    readonly id: string,
    readonly line: number,
  ) {
    this.blocksLine = line;
  }
}

export type Problem = [line: number, text: string];

export class Document {
  tasks: Task[] = []; // in document order, duplicates included
  byId = new Map<string, Task>(); // first task of each ID
  questions = new Map<string, Question>(); // open questions
  resolved = new Set<string>(); // resolved question IDs
  problems: Problem[] = [];
  features: string[] = []; // feature names in order
  coverageLine: number | null = null; // line of the `## Coverage` heading
  coverage: [line: number, statement: string, cell: string][] = [];
  coverageHeaderSeen = false;

  problem(line: number, text: string) {
    this.problems.push([line, text]);
  }
}

type Section = "feature" | "coverage" | "open" | "resolved" | null;

export function parse(text: string) {
  const doc = new Document();
  let section: Section = null;
  let feature: string | null = null;
  let task: Task | null = null;
  let question: Question | null = null;
  let inCriteria = false;
  let inFence = false;
  for (const [index, raw] of splitLines(text).entries()) {
    const number = index + 1;
    const line = rstrip(raw);
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!;
      task = null;
      question = null;
      inCriteria = false;
      if (level <= 2) {
        const lowered = title.toLowerCase();
        if (level === 2 && lowered.startsWith("feature:")) {
          feature = strip(title.slice(title.indexOf(":") + 1));
          doc.features.push(feature);
          section = "feature";
        } else if (level === 2 && lowered === "coverage") {
          section = "coverage";
          doc.coverageLine = number;
        } else if (level === 2 && lowered === "open questions") {
          section = "open";
        } else if (level === 2 && lowered === "resolved questions") {
          section = "resolved";
        } else {
          section = null;
        }
      } else if (level === 3 && section === "feature") {
        const match = TASK_HEADING.exec(title);
        if (match) {
          task = new Task(match[1]!, match[2]!, feature, number);
          task.addMarkers(title, number);
          doc.tasks.push(task);
        }
      } else if (level === 3 && section === "open") {
        const match = QUESTION_HEADING.exec(title);
        if (match) {
          question = new Question(match[1]!, number);
          if (doc.questions.has(question.id)) doc.problem(number, `question ${question.id} is defined twice.`);
          else doc.questions.set(question.id, question);
        }
      }
      continue;
    }
    if (section === "coverage") {
      if (lstrip(line).startsWith("|")) {
        const cells = stripChars(strip(line), "|").split("|").map(strip);
        if (cells.filter(Boolean).every((cell) => SEPARATOR_CELL.test(cell))) continue;
        if (!doc.coverageHeaderSeen) {
          doc.coverageHeaderSeen = true;
          continue;
        }
        doc.coverage.push([number, cells[0]!, cells.length > 1 ? cells[cells.length - 1]! : ""]);
      }
      continue;
    }
    if (section === "resolved") {
      const match = RESOLVED_LINE.exec(line);
      if (match) doc.resolved.add(match[1]!);
      continue;
    }
    if (task !== null) {
      inCriteria = parseTaskLine(doc, task, line, number, inCriteria);
    } else if (question !== null) {
      const field = FIELD.exec(line);
      if (field && strip(field[1]!).toLowerCase() === "blocks") {
        question.blocksLine = number;
        question.blocks = parseIds(doc, number, field[2]!, `Blocks of ${question.id}`);
      }
    }
  }
  return doc;
}

function parseTaskLine(
  doc: Document,
  task: Task,
  line: string,
  number: number,
  inCriteria: boolean,
): boolean {
  task.addMarkers(line, number);
  const field = FIELD.exec(line);
  if (field) {
    const name = strip(field[1]!).toLowerCase();
    const value = field[2]!;
    if (!task.fields.has(name)) task.fields.set(name, strip(value));
    if (name === "needs") {
      task.needsLine = number;
      task.needs = parseIds(doc, number, value, `Needs of ${task.id}`);
    }
    return false;
  }
  const stripped = strip(line);
  if (CRITERIA_LABEL.test(stripped)) {
    task.criteriaSeen = true;
    return true;
  }
  if (BOLD_LABEL.test(stripped)) return false;
  if (inCriteria) {
    const box = CHECKBOX.exec(line);
    if (box) task.items.push([box[1] !== " ", box[2]!]);
    else if (LIST_ITEM.test(line)) task.badItems.push([number, stripped]);
  }
  return inCriteria;
}

function parseIds(doc: Document, number: number, value: string, where: string) {
  value = strip(value);
  if (NONE_WORDS.includes(value.toLowerCase())) return [];
  const found: string[] = [];
  for (const token of value.split(ID_SEPARATOR)) {
    if (!token) continue;
    if (TASK_ID.test(token)) {
      if (!found.includes(token)) found.push(token);
    } else {
      doc.problem(
        number,
        `${where}: \`${token}\` is not a task ID (write IDs such as T3, separated by commas, or leave the line out).`,
      );
    }
  }
  return found;
}

/** Add every structural and graph problem to the document and return the problems, in order. */
export function validate(doc: Document) {
  for (const task of doc.tasks) {
    const first = doc.byId.get(task.id);
    if (first) doc.problem(task.line, `task ${task.id} is defined twice (first at line ${first.line}).`);
    else doc.byId.set(task.id, task);
  }
  if (!doc.tasks.length) {
    throw new DocumentError(
      "no task found. A task starts with a heading like `### T1. Member exports their expenses` inside a `## Feature:` section.",
    );
  }
  for (const task of doc.tasks) checkTask(doc, task);
  checkGraph(doc);
  checkQuestions(doc);
  checkCoverage(doc);
  return [...doc.problems].sort((a, b) => a[0] - b[0]);
}

function checkTask(doc: Document, task: Task) {
  for (const [name, label] of [
    ["actor", "Actor"],
    ["source", "Source"],
  ] as const) {
    if (!task.fields.get(name)) doc.problem(task.line, `${task.id} has no \`${label}\` line.`);
  }
  if (!task.fields.has("needs")) {
    doc.problem(
      task.line,
      `${task.id} has no \`Needs\` line (write \`- **Needs**: none\` when it needs no other task).`,
    );
  }
  const status = task.fields.get("status") ?? "";
  if (!["required", "optional"].includes(strip(status).toLowerCase())) {
    doc.problem(task.line, `${task.id}: Status is \`${status || "missing"}\`; it must be Required or Optional.`);
  }
  if (task.needs.length && !task.fields.get("needs because")) {
    doc.problem(
      task.needsLine,
      `${task.id} needs ${task.needs.join(", ")} but gives no \`Needs because\` line saying why its behavior cannot be observed without them.`,
    );
  }
  const kind = task.path;
  if (!(PATH_KINDS as readonly string[]).includes(kind)) {
    doc.problem(task.line, `${task.id}: Path is \`${kind || "missing"}\`; it must be one of ${PATH_KINDS.join(", ")}.`);
  }
  if (!task.criteriaSeen) doc.problem(task.line, `${task.id} has no \`**Acceptance criteria**\` checklist.`);
  else if (!task.items.length) doc.problem(task.line, `${task.id}: the acceptance criteria hold no \`- [ ]\` item.`);
  for (const [number, item] of task.badItems) {
    doc.problem(number, `${task.id}: acceptance criterion is not a checklist item (write \`- [ ] ...\`): ${item}`);
  }
  for (const need of task.needs) {
    const other = doc.byId.get(need);
    if (need === task.id) {
      doc.problem(task.needsLine, `${task.id} needs itself.`);
    } else if (!other) {
      doc.problem(task.needsLine, `${task.id} needs ${need}, which is not a task in this document.`);
    } else if (other.optional && !task.optional) {
      doc.problem(
        task.needsLine,
        `${task.id} is required but needs ${need}, which is optional. An optional task must not block a required one.`,
      );
    }
  }
}

export type Links = Map<string, string[]>;

/** Task ID -> the IDs it needs, with the references that are broken left out. */
export function edges(doc: Document): Links {
  const graph: Links = new Map();
  for (const task of doc.byId.values()) {
    graph.set(task.id, task.needs.filter((need) => doc.byId.has(need) && need !== task.id));
  }
  return graph;
}

/** Every ID reached from `start` along `links`, `start` itself left out unless a link leads back. */
export function reach(links: Links, start: string) {
  const found = new Set<string>();
  const todo = [...links.get(start)!];
  while (todo.length) {
    const next = todo.pop()!;
    if (!found.has(next)) {
      found.add(next);
      todo.push(...links.get(next)!);
    }
  }
  return found;
}

function checkGraph(doc: Document) {
  const graph = edges(doc);
  const state = new Map<string, number>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const byLine = [...graph.keys()].sort((a, b) => doc.byId.get(a)!.line - doc.byId.get(b)!.line);
  // A depth-first walk, written with an explicit stack so that a long chain cannot overflow.
  for (const root of byLine) {
    if ((state.get(root) ?? 0) !== 0) continue;
    const frames: [node: string, next: number][] = [];
    const enter = (node: string) => {
      state.set(node, 1);
      stack.push(node);
      frames.push([node, 0]);
    };
    enter(root);
    while (frames.length) {
      const frame = frames[frames.length - 1]!;
      const [node, index] = frame;
      const needs = graph.get(node)!;
      if (index >= needs.length) {
        frames.pop();
        stack.pop();
        state.set(node, 2);
        continue;
      }
      frame[1] = index + 1;
      const next = needs[index]!;
      const seen = state.get(next) ?? 0;
      if (seen === 0) {
        enter(next);
      } else if (seen === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(" ");
        if (!reported.has(key)) {
          reported.add(key);
          doc.problem(
            doc.byId.get(node)!.needsLine,
            `dependency cycle: ${[...cycle, next].join(" -> ")} (an arrow means "needs"). Remove one dependency so that the tasks can be done in some order.`,
          );
        }
      }
    }
  }
  if (reported.size) return;
  for (const node of byLine) {
    const needs = graph.get(node)!;
    for (const need of needs) {
      const through = needs.find((other) => other !== need && reach(graph, other).has(need));
      if (through !== undefined) {
        doc.problem(
          doc.byId.get(node)!.needsLine,
          `${node} needs ${need}, but ${through} already needs it through ${through}. Remove ${need} from \`Needs\`.`,
        );
      }
    }
  }
}

function checkQuestions(doc: Document) {
  for (const task of doc.byId.values()) {
    const markers = [...task.markers.entries()].sort((a, b) => compareText(a[0], b[0]));
    for (const [marker, number] of markers) {
      const question = doc.questions.get(marker);
      if (question) {
        if (!question.blocks.includes(task.id)) {
          doc.problem(number, `${task.id} carries [${marker}], but \`Blocks\` of ${marker} does not list ${task.id}.`);
        }
      } else if (doc.resolved.has(marker)) {
        doc.problem(number, `${task.id} carries [${marker}], which is resolved. Replace the marker with the answer.`);
      } else {
        doc.problem(number, `${task.id} carries [${marker}], but no open question ${marker} exists.`);
      }
    }
  }
  for (const question of doc.questions.values()) {
    for (const id of question.blocks) {
      const task = doc.byId.get(id);
      if (!task) {
        doc.problem(question.blocksLine, `${question.id} blocks ${id}, which is not a task in this document.`);
      } else if (!task.markers.has(question.id)) {
        doc.problem(question.blocksLine, `${question.id} blocks ${id}, but ${id} carries no [${question.id}] marker.`);
      }
    }
    if (doc.resolved.has(question.id)) {
      doc.problem(question.line, `${question.id} is listed under both open and resolved questions.`);
    }
  }
}

function checkCoverage(doc: Document) {
  if (doc.coverageLine === null) {
    doc.problem(
      1,
      "no `## Coverage` section: add a table of every source statement with the tasks or open questions that cover it.",
    );
    return;
  }
  if (!doc.coverage.length) doc.problem(doc.coverageLine, "the `## Coverage` table has no row.");
  const covered = new Set<string>();
  for (const [number, statement, cell] of doc.coverage) {
    const refs = [...cell.matchAll(REFERENCE)].map((found) => found[1]!);
    if (!refs.length) {
      doc.problem(number, `source statement "${statement}" is covered by no task and no open question.`);
    }
    for (const ref of refs) {
      if (ref.startsWith("T")) {
        if (doc.byId.has(ref)) covered.add(ref);
        else doc.problem(number, `coverage names ${ref}, which is not a task in this document.`);
      } else if (!doc.questions.has(ref) && !doc.resolved.has(ref)) {
        doc.problem(number, `coverage names ${ref}, which is not a question in this document.`);
      }
    }
  }
  if (doc.coverage.length) {
    for (const task of doc.byId.values()) {
      if (!covered.has(task.id)) {
        doc.problem(
          task.line,
          `${task.id} is in no row of the \`## Coverage\` table. A task that no source statement justifies must be removed.`,
        );
      }
    }
  }
}

// --------------------------------------------------------------------------- the graph, once the document passed the check

export type State = "done" | "ready" | "blocked";

export class Graph {
  readonly order: string[];
  readonly needs: Links;
  readonly waiting: Links = new Map();
  readonly depth = new Map<string, number>();

  constructor(readonly doc: Document) {
    this.order = doc.tasks.filter((task) => doc.byId.get(task.id) === task).map((task) => task.id);
    this.needs = edges(doc);
    for (const id of this.order) this.waiting.set(id, []);
    for (const id of this.order) {
      for (const need of this.needs.get(id)!) this.waiting.get(need)!.push(id);
    }
    for (const id of this.order) this.measure(id);
  }

  /** 1 + the depth of the deepest task it needs, computed without recursion. */
  private measure(start: string) {
    const todo = [start];
    while (todo.length) {
      const id = todo[todo.length - 1]!;
      if (this.depth.has(id)) {
        todo.pop();
        continue;
      }
      const needs = this.needs.get(id)!;
      const missing = needs.filter((need) => !this.depth.has(need));
      if (missing.length) {
        todo.push(...missing);
        continue;
      }
      this.depth.set(id, 1 + Math.max(0, ...needs.map((need) => this.depth.get(need)!)));
      todo.pop();
    }
  }

  task(id: string) {
    return this.doc.byId.get(id)!;
  }

  done(id: string) {
    return this.task(id).done;
  }

  openQuestions(id: string) {
    return [...this.task(id).markers.keys()].filter((q) => this.doc.questions.has(q)).sort(compareText);
  }

  unmet(id: string) {
    return this.needs.get(id)!.filter((need) => !this.done(need));
  }

  state(id: string): State {
    if (this.done(id)) return "done";
    if (this.unmet(id).length || this.openQuestions(id).length) return "blocked";
    return "ready";
  }

  reasons(id: string) {
    const parts: string[] = [];
    const unmet = this.unmet(id);
    if (unmet.length) parts.push("waits for " + unmet.join(", "));
    const questions = this.openQuestions(id);
    if (questions.length) parts.push("open question " + questions.join(", "));
    return parts.join("; ");
  }

  /** The given IDs in document order. */
  sorted(ids: Set<string>) {
    return this.order.filter((id) => ids.has(id));
  }
}
