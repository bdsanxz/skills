// The commands, their help, and main.

import {
  ArgumentError,
  type Command,
  HelpRequested,
  type Positional,
  commandHelp,
  parseCommand,
  suggestion,
  table,
  wrap,
} from "./args";
import { DocumentError, note, print, readText } from "./core";
import { type Document, Graph, PATH_KINDS, type Problem, parse, reach, validate } from "./graph";

export const PROG = "taskgraph";
const EXAMPLE_DOC = "_swe/tasks/expense-export.md";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// --------------------------------------------------------------------------- loading

function checked(target: string): [Document, Problem[]] {
  const doc = parse(readText(target));
  return [doc, validate(doc)];
}

function printProblems(target: string, problems: Problem[]) {
  for (const [number, text] of problems) print(`${target}:${number}: ${text}`);
  print(`${plural(problems.length, "problem")}.`);
}

/** The graph of a document that passed the check, or null once its problems are printed. */
function graphOf(target: string) {
  const [doc, problems] = checked(target);
  if (problems.length) {
    printProblems(target, problems);
    return null;
  }
  return new Graph(doc);
}

// --------------------------------------------------------------------------- commands

function runCheck({ doc: target }: Record<string, string>) {
  const [doc, problems] = checked(target!);
  if (problems.length) {
    printProblems(target!, problems);
    return 1;
  }
  print(
    `OK: ${plural(doc.byId.size, "task")} in ${plural(doc.features.length, "feature")}, ` +
      `${plural(doc.questions.size, "open question")}, no problem.`,
  );
  return 0;
}

function runStatus({ doc: target }: Record<string, string>) {
  const graph = graphOf(target!);
  if (!graph) return 1;
  const states = new Map(graph.order.map((id) => [id, graph.state(id)]));
  const done = graph.order.filter((id) => states.get(id) === "done");
  const ready = graph.order.filter((id) => states.get(id) === "ready");
  const blocked = graph.order.filter((id) => states.get(id) === "blocked");
  print(`Tasks: ${graph.order.length} in all; ${done.length} done, ${ready.length} ready, ${blocked.length} blocked.`);
  const remaining = graph.order.filter((id) => states.get(id) !== "done" && !graph.task(id).optional);
  print(`Required tasks not done: ${remaining.length}.`);
  if (ready.length) {
    print(`\nReady to start now (${ready.length}). None needs another, so they can run in parallel:`);
    for (const id of ready) print(`  ${graph.task(id).label()} (${graph.task(id).tag})`);
  }
  if (blocked.length) {
    print(`\nBlocked (${blocked.length}):`);
    for (const id of blocked) print(`  ${graph.task(id).label()}: ${graph.reasons(id)}`);
  }
  if (done.length) print(`\nDone (${done.length}): ${done.join(", ")}`);
  print("\nPaths by feature:");
  for (const feature of graph.doc.features) {
    const counts = PATH_KINDS.map((kind) => {
      const count = graph.order.filter(
        (id) => graph.task(id).feature === feature && graph.task(id).path === kind,
      ).length;
      return `${count} ${kind.toLowerCase()}`;
    });
    print(`  ${feature}: ${counts.join(", ")}`);
  }
  if (!ready.length && done.length < graph.order.length) {
    print("\nNothing is ready: every remaining task waits for a task or an open question.");
    return 3;
  }
  return 0;
}

function runWaves({ doc: target }: Record<string, string>) {
  const graph = graphOf(target!);
  if (!graph) return 1;
  const depth = (id: string) => graph.depth.get(id)!;
  const last = Math.max(...graph.order.map(depth));
  for (let wave = 1; wave <= last; wave++) {
    if (wave === 1) print("Wave 1 (no task needed first; can run in parallel):");
    else print(`\nWave ${wave} (after the tasks they need; can run in parallel with each other):`);
    for (const id of graph.order.filter((member) => depth(member) === wave)) {
      const notes: string[] = [];
      const needs = graph.needs.get(id)!;
      if (needs.length) notes.push("needs " + needs.join(", "));
      const questions = graph.openQuestions(id);
      if (questions.length) notes.push("open question " + questions.join(", "));
      if (graph.task(id).optional) notes.push("optional");
      if (graph.done(id)) notes.push("done");
      print(`  ${graph.task(id).label()}${notes.length ? ` (${notes.join("; ")})` : ""}`);
    }
  }
  // The deepest task that comes first in the document, then back through the first task one wave earlier.
  let end = graph.order[0]!;
  for (const id of graph.order) if (depth(id) > depth(end)) end = id;
  const chain = [end];
  for (let current = end; graph.needs.get(current)!.length; ) {
    const earlier = graph.needs.get(current)!.filter((need) => depth(need) === depth(current) - 1);
    current = graph.order.find((id) => earlier.includes(id))!;
    chain.push(current);
  }
  print(
    `\nLongest chain (${plural(chain.length, "task")}, one after the other): ${chain.reverse().join(" -> ")}`,
  );
  return 0;
}

function runTrace({ doc: target, task: asked }: Record<string, string>) {
  const graph = graphOf(target!);
  if (!graph) return 1;
  const id = asked!.toUpperCase();
  if (!graph.doc.byId.has(id)) {
    throw new DocumentError(`${asked} is not a task in ${target}. Tasks: ${graph.order.join(", ")}.`);
  }
  const task = graph.task(id);
  const before = reach(graph.needs, id);
  const after = reach(graph.waiting, id);
  const apart = new Set(graph.order.filter((other) => other !== id && !before.has(other) && !after.has(other)));
  const state = graph.state(id);
  const shown = state === "blocked" ? "blocked: " + graph.reasons(id) : state;
  const list = (ids: string[]) => ids.join(", ") || "nothing";
  print(`${task.label()} [${shown}${task.optional ? "; optional" : ""}]`);
  print(`Needs directly: ${list(graph.needs.get(id)!)}`);
  print(`Must finish before it starts (all, through the chain): ${list(graph.sorted(before))}`);
  print(`Waits for it (all, through the chain): ${list(graph.sorted(after))}`);
  print(`Can run in parallel with (no dependency either way): ${list(graph.sorted(apart))}`);
  return 0;
}

// --------------------------------------------------------------------------- help

const DOC: Positional = {
  dest: "doc",
  metavar: "DOC",
  help: "the tasks Markdown file to read: a path, absolute or relative to the current directory, of a UTF-8 file. It is only read, never changed.",
};

const CHECKED_FIRST =
  "It runs the same check as `check` first; when the document has problems, it prints them as `check` does, exits 1 and prints nothing else.";

const EXIT_PROBLEMS: [string, string] = ["1", "the document has problems; each is printed as DOC:LINE: message"];
const EXIT_UNUSABLE: [string, string] = ["2", "wrong usage, or DOC is not a readable UTF-8 file, or it holds no task"];

export const COMMANDS: Command[] = [
  {
    name: "check",
    summary: "validate the document and list every problem with its line number",
    description: [
      "Validate a tasks document and print every problem with its line number. Run it after writing or editing the document, and fix whatever it reports until it exits 0.",
      "It finds: a task ID used twice; a task without a `Needs` line, or with a dependency that gives no `Needs because` reason; a `Needs` entry that is not a task ID, names no task or names the task itself; a dependency cycle; a dependency that another dependency already implies; a required task that needs an optional one; a task without an actor, a status (Required or Optional), a path kind (Happy, Alternative or Negative), a source or a `- [ ]` acceptance criteria checklist; a `[Qn]` marker that names no open question, names a resolved one, or disagrees with the question's `Blocks` line; a `## Coverage` row that names nothing or an ID that does not exist; and a task that no coverage row names.",
    ],
    positionals: [DOC],
    prints: [
      "When there is no problem, one line: `OK: 7 tasks in 2 features, 2 open questions, no problem.`",
      "Otherwise each problem as `DOC:LINE: message`, in line order, then the count, such as `3 problems.` Nothing is written to any file.",
    ],
    exitCodes: [["0", "no problem"], EXIT_PROBLEMS, EXIT_UNUSABLE],
    examples: [`${PROG} check ${EXAMPLE_DOC}`, `${PROG} check /path/to/project/_swe/tasks/expense-export.md`],
    run: runCheck,
  },
  {
    name: "status",
    summary: "list tasks that are done, ready to start and blocked",
    description: [
      "List the tasks that are done, the tasks that are ready to start now and the tasks that are blocked, each blocked task with the tasks and open questions it waits for. The ready tasks do not need each other, so they can run in parallel. Use it to report the task counts by path kind, and to choose the next tasks.",
      "A task is done when every item of its acceptance criteria is ticked (`- [x]`). A task whose needs are done but that carries an open-question marker such as `[Q2]` stays blocked until the question is resolved.",
      CHECKED_FIRST,
    ],
    positionals: [DOC],
    prints: [
      "The totals (`Tasks: 7 in all; 0 done, 1 ready, 6 blocked.` and `Required tasks not done: 7.`), then the ready tasks with their path kind (and `optional` for an optional task), the blocked tasks with what each waits for (`waits for T1; open question Q2`), the done tasks, and for each feature the number of happy, alternative and negative tasks (`Expense export: 2 happy, 1 alternative, 3 negative`).",
    ],
    exitCodes: [
      ["0", "no problem, and a task is ready to start or every task is done"],
      EXIT_PROBLEMS,
      EXIT_UNUSABLE,
      ["3", "no problem, but tasks remain and none is ready: each waits for a task or an open question"],
    ],
    examples: [`${PROG} status ${EXAMPLE_DOC}`],
    run: runStatus,
  },
  {
    name: "waves",
    summary: "group tasks into waves that can run in parallel",
    description: [
      "Group every task into waves: wave 1 holds the tasks that need no other task, and each later wave the tasks whose needs all lie in earlier waves, one of them in the wave just before. The tasks of one wave can run in parallel. Done tasks keep their wave and are marked done. Use it to report how the work can run in parallel and the longest chain of tasks that must run one after the other.",
      CHECKED_FIRST,
    ],
    positionals: [DOC],
    prints: [
      "Each wave with its tasks in document order; after a task, in parentheses, the tasks it needs, its open questions, and whether it is optional or done. Then the longest chain, such as `Longest chain (2 tasks, one after the other): T1 -> T2`.",
    ],
    exitCodes: [["0", "no problem"], EXIT_PROBLEMS, EXIT_UNUSABLE],
    examples: [`${PROG} waves ${EXAMPLE_DOC}`],
    run: runWaves,
  },
  {
    name: "trace",
    summary: "show what one task needs and what waits for it",
    description: [
      "Show one task: its state (done, ready, or blocked with what it waits for), the tasks it needs directly, every task that must finish before it can start, every task that waits for it, and the tasks it can run in parallel with because there is no dependency either way. Use it to see what holds a task back and what finishing it unblocks.",
      CHECKED_FIRST,
    ],
    positionals: [DOC, { dest: "task", metavar: "TASK", help: "a task ID of DOC, such as T3; the case does not matter (t3 works)" }],
    prints: [
      "Five lines: the task ID and title with its state in brackets (`[ready]`, `[done]` or `[blocked: waits for T1]`), then `Needs directly:`, `Must finish before it starts (all, through the chain):`, `Waits for it (all, through the chain):` and `Can run in parallel with (no dependency either way):`, each followed by task IDs in document order, or `nothing`.",
    ],
    exitCodes: [
      ["0", "no problem"],
      EXIT_PROBLEMS,
      ["2", "wrong usage, DOC is not a readable UTF-8 file or holds no task, or TASK is not a task of DOC (the message lists the task IDs)"],
    ],
    examples: [`${PROG} trace ${EXAMPLE_DOC} T3`, `${PROG} trace ${EXAMPLE_DOC} t1`],
    run: runTrace,
  },
];

const DESCRIPTION =
  "Read a tasks document, the Markdown file of tasks grouped by feature, as a dependency graph: validate it, and tell which tasks are done, which can start now, which can run in parallel and which are blocked. Use it after writing or editing a tasks document, and whenever the next tasks must be chosen. The graph comes from the `Needs` line of each task, and a task is done when every item of its acceptance criteria is ticked (`- [x]`).";

const WORKFLOW: [string, string][] = [
  [`check DOC`, "after writing or editing the document; fix what it reports and run it again until it exits 0"],
  [`status DOC`, "the task counts by path kind, the tasks ready to start now and what the others wait for"],
  [`waves DOC`, "the waves of tasks that can run in parallel, and the longest chain"],
  [`trace DOC T3`, "what one task waits for, what waits for it and what it can run beside"],
];

export function topUsage() {
  return `usage: ${PROG} [-h] COMMAND ...`;
}

export function topHelp() {
  const commands: [string, string][] = COMMANDS.map((command) => [command.name, command.summary]);
  commands.push(["help", "show this help, or the help of one command: help COMMAND"]);
  return [
    topUsage(),
    wrap(DESCRIPTION, 0),
    "commands:\n" + table(commands),
    "typical workflow:\n" +
      table(WORKFLOW.map(([command, text]) => [`${PROG} ${command}`, text])) +
      "\n  " +
      wrap("When the checks of a task pass, tick its items (`- [x]`) in the document and run status again to see what it unblocked.", 2),
    "files:\n  " +
      wrap("Reads DOC, a UTF-8 Markdown file, and nothing else. Writes nothing: progress is recorded by ticking the boxes in the document.", 2),
    "options:\n" + table([["-h, --help", "show this help and exit"]]),
    "exit codes:\n" +
      table([
        ["0", "no problem"],
        EXIT_PROBLEMS,
        EXIT_UNUSABLE,
        ["3", "(status only) no problem, but tasks remain and none is ready"],
      ]),
    `Run '${PROG} COMMAND --help' for what a command checks and prints, with examples.`,
  ].join("\n\n");
}

// --------------------------------------------------------------------------- main

function wrongUsage(message: string, usage: string, command?: string) {
  const help = command ? `${PROG} ${command} --help` : `${PROG} --help`;
  note(`${usage}\n${PROG}${command ? " " + command : ""}: error: ${message}\nRun '${help}' for help.`);
  return 2;
}

const NAMES = [...COMMANDS.map((command) => command.name), "help"];

function unknownCommand(name: string) {
  const choices = NAMES.map((item) => `'${item}'`).join(", ");
  return wrongUsage(
    `argument COMMAND: invalid choice: '${name}' (choose from ${choices})${suggestion(name, NAMES)}`,
    topUsage(),
  );
}

export function main(argv: string[]): number {
  const [name, ...rest] = argv;
  if (name === undefined) {
    print(topHelp());
    return 2;
  }
  if (name === "-h" || name === "--help") {
    print(topHelp());
    return 0;
  }
  if (name === "help") {
    if (rest.length > 1) return wrongUsage(`unrecognized arguments: ${rest.slice(1).join(" ")}`, `usage: ${PROG} help [COMMAND]`);
    const asked = COMMANDS.find((command) => command.name === rest[0]);
    if (rest.length && !asked && rest[0] !== "help") return unknownCommand(rest[0]!);
    print(asked ? commandHelp(PROG, asked) : topHelp());
    return 0;
  }
  const command = COMMANDS.find((item) => item.name === name);
  if (!command) {
    if (name.startsWith("-")) {
      return wrongUsage(`unrecognized arguments: ${name}${suggestion(name, ["--help"])}`, topUsage());
    }
    return unknownCommand(name);
  }
  try {
    return command.run(parseCommand(PROG, command, rest));
  } catch (error) {
    if (error instanceof HelpRequested) {
      print(error.message);
      return 0;
    }
    if (error instanceof ArgumentError) return wrongUsage(error.message, error.usage, command.name);
    if (error instanceof DocumentError) {
      note(`error: ${error.message}`);
      return 2;
    }
    throw error;
  }
}
