// A small command-line parser: commands with positionals, and --help at every level.

import { UsageError } from "./core";

export type Positional = {
  dest: string;
  metavar: string;
  help: string;
};

export type Command = {
  name: string;
  summary: string;
  description: string[]; // paragraphs
  positionals: Positional[];
  prints: string[]; // paragraphs: what the command prints and writes
  exitCodes: [code: string, meaning: string][];
  examples: string[];
  run: (args: Record<string, string>) => number;
};

/** Asked for help: the text to print, with exit code 0. */
export class HelpRequested extends Error {}

/** Wrong usage: the message and the usage line of the command. */
export class ArgumentError extends UsageError {
  constructor(
    message: string,
    readonly usage: string,
  ) {
    super(message);
  }
}

export const WIDTH = 88;
const HELP_OPTION = "-h, --help";

/** A word, or a run of text that holds a `code span`, which is never broken. */
const WORD = /(?:[^\s`]*`[^`]*`)+[^\s`]*|\S+/g;

export function wrap(text: string, indent: number, width = WIDTH) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.match(WORD) ?? []) {
    if (line && indent + line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n" + " ".repeat(indent));
}

/** Rows of a label and its text, the text in one column and wrapped. */
export function table(rows: [string, string][]) {
  const width = Math.min(30, Math.max(...rows.map(([label]) => label.length)) + 4);
  return rows
    .map(([label, help]) => {
      const text = wrap(help, width);
      return label.length + 4 > width
        ? `  ${label}\n${" ".repeat(width)}${text}`
        : `  ${label}`.padEnd(width) + text;
    })
    .join("\n");
}

export function commandUsage(prog: string, command: Command) {
  const parts = [`${prog} ${command.name}`, "[-h]", ...command.positionals.map((p) => p.metavar)];
  return "usage: " + wrap(parts.join(" "), 7);
}

export function commandHelp(prog: string, command: Command) {
  const sections = [commandUsage(prog, command), ...command.description.map((part) => wrap(part, 0))];
  if (command.positionals.length) {
    sections.push("arguments:\n" + table(command.positionals.map((p) => [p.metavar, p.help])));
  }
  sections.push("options:\n" + table([[HELP_OPTION, "show this help and exit"]]));
  sections.push("prints:\n" + command.prints.map((part) => "  " + wrap(part, 2)).join("\n\n"));
  sections.push("exit codes:\n" + table(command.exitCodes));
  sections.push("examples:\n" + command.examples.map((example) => `  ${example}`).join("\n"));
  return sections.join("\n\n");
}

/** The edit distance between two words. */
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** " (did you mean 'x'?)" for the closest of `choices`, or "" when none is close. */
export function suggestion(word: string, choices: string[]) {
  const lowered = word.toLowerCase();
  let best = "";
  let bestDistance = Infinity;
  for (const choice of choices) {
    const far = choice.startsWith(lowered) ? 0 : distance(lowered, choice);
    if (far < bestDistance) {
      best = choice;
      bestDistance = far;
    }
  }
  return best && bestDistance <= Math.max(1, Math.floor(best.length / 3)) ? ` (did you mean '${best}'?)` : "";
}

const NUMBER = /^-\d+(\.\d+)?$/;

/** The arguments of one command. Throws HelpRequested or ArgumentError. */
export function parseCommand(prog: string, command: Command, argv: string[]) {
  const usage = commandUsage(prog, command);
  const loose: string[] = [];
  let onlyPositionals = false;
  for (const token of argv) {
    if (onlyPositionals || token === "-" || !token.startsWith("-") || NUMBER.test(token)) {
      loose.push(token);
    } else if (token === "--") {
      onlyPositionals = true;
    } else if (token === "-h" || token === "--help") {
      throw new HelpRequested(commandHelp(prog, command));
    } else {
      const name = token.split("=")[0]!;
      const hint = suggestion(name, ["--help"]);
      const more = hint || ` (${command.name} takes no option but ${HELP_OPTION})`;
      throw new ArgumentError(`unrecognized arguments: ${token}${more}`, usage);
    }
  }
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const positional of command.positionals) {
    const value = loose.shift();
    if (value === undefined) missing.push(positional.metavar);
    else values[positional.dest] = value;
  }
  if (missing.length) {
    throw new ArgumentError(`the following arguments are required: ${missing.join(", ")}`, usage);
  }
  if (loose.length) throw new ArgumentError(`unrecognized arguments: ${loose.join(" ")}`, usage);
  return values;
}
