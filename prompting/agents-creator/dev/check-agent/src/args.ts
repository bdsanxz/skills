// A small command-line parser for a program without commands: options, positionals and --help.

import { UsageError } from "./core";

export type Option = {
  name: string; // --name
  dest: string;
  metavar: string;
  help: string;
  choices?: readonly string[];
  /** What the help shows as the default, when there is one. */
  defaultText?: string;
};

/** A positional argument. Every one is optional: the program checks what it needs. */
export type Positional = {
  dest: string;
  metavar: string;
  help: string;
};

export type Program = {
  prog: string;
  description: string;
  options: Option[];
  positionals: Positional[];
  /** Sections after the options, as [title, text]; text lines are kept as they are. */
  sections: [string, string][];
  examples: string[];
};

/** Asked for help: the text to print, with exit code 0. */
export class HelpRequested extends Error {}

/** Wrong usage of an argument. */
export class ArgumentError extends UsageError {}

export const WIDTH = 88;

export function wrap(text: string, indent: number, width = WIDTH) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
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

function table(rows: [string, string][]) {
  const width = Math.min(26, Math.max(...rows.map(([label]) => label.length)) + 2);
  return rows
    .map(([label, help]) => {
      const text = wrap(help, width);
      return label.length + 2 > width ? `${label}\n${" ".repeat(width)}${text}` : label.padEnd(width) + text;
    })
    .join("\n");
}

const optionLabel = (option: Option) => `${option.name} ${option.metavar}`;

export function usage(program: Program) {
  const parts = [program.prog, "[-h]"];
  for (const option of program.options) parts.push(`[${optionLabel(option)}]`);
  for (const positional of program.positionals) {
    parts.push(`[${positional.metavar}]`);
  }
  return "usage: " + wrap(parts.join(" "), 7);
}

export function help(program: Program) {
  const sections = [usage(program), wrap(program.description, 0)];
  if (program.positionals.length) {
    sections.push("arguments:\n" + table(program.positionals.map((p) => [`  ${p.metavar}`, p.help])));
  }
  const rows: [string, string][] = [["  -h, --help", "show this help and exit"]];
  for (const option of program.options) {
    let text = option.help;
    if (option.choices) text += ` [choices: ${option.choices.join(", ")}]`;
    if (option.defaultText) text += ` [default: ${option.defaultText}]`;
    rows.push([`  ${optionLabel(option)}`, text]);
  }
  sections.push("options:\n" + table(rows));
  for (const [title, text] of program.sections) sections.push(`${title}:\n${text}`);
  if (program.examples.length) {
    sections.push("examples:\n" + program.examples.map((example) => `  ${example}`).join("\n"));
  }
  return sections.join("\n\n");
}

/** The edit distance between two strings. */
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = row;
  }
  return previous[b.length]!;
}

/** The candidate closest to a mistyped word, when one is close enough to be meant. */
export function closest(word: string, candidates: readonly string[]) {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = candidate.startsWith(word) || word.startsWith(candidate) ? 1 : distance(word, candidate);
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  const close = bestDistance <= Math.max(1, Math.floor((best?.length ?? 0) / 3)) && 2 * bestDistance < word.length;
  return close ? best : null;
}

const suggestion = (word: string, candidates: readonly string[]) => {
  const match = closest(word, candidates);
  return match ? `; did you mean '${match}'?` : "";
};

function findOption(program: Program, name: string) {
  const exact = program.options.find((option) => option.name === name);
  if (exact) return exact;
  const prefixed = program.options.filter((option) => option.name.startsWith(name));
  if (prefixed.length === 1) return prefixed[0]!;
  if (prefixed.length > 1) {
    throw new ArgumentError(`ambiguous option: ${name} could match ${prefixed.map((o) => o.name).join(", ")}`);
  }
  const names = ["--help", ...program.options.map((option) => option.name)];
  throw new ArgumentError(`unrecognized arguments: ${name}${suggestion(name, names)}`);
}

/** The values of the arguments. Throws HelpRequested or ArgumentError. */
export function parse(program: Program, argv: string[]) {
  const values: Record<string, string | null> = {};
  for (const option of program.options) values[option.dest] = null;
  const loose: string[] = [];
  let onlyPositionals = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (onlyPositionals || token === "-" || !token.startsWith("-")) {
      loose.push(token);
      continue;
    }
    if (token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (token === "-h" || token === "--help") throw new HelpRequested(help(program));
    if (!token.startsWith("--")) {
      const names = ["-h", ...program.options.map((option) => option.name)];
      throw new ArgumentError(`unrecognized arguments: ${token}${suggestion(token, names)}`);
    }
    const equals = token.indexOf("=");
    const option = findOption(program, equals >= 0 ? token.slice(0, equals) : token);
    let value: string;
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-")) {
        throw new ArgumentError(`argument ${option.name}: expected one argument (${option.metavar})`);
      }
      value = next;
      index++;
    }
    if (option.choices && !option.choices.includes(value)) {
      const listed = option.choices.map((choice) => `'${choice}'`).join(", ");
      throw new ArgumentError(
        `argument ${option.name}: invalid choice: '${value}' (choose from ${listed})${suggestion(value, option.choices)}`,
      );
    }
    values[option.dest] = value;
  }
  for (const positional of program.positionals) values[positional.dest] = loose.shift() ?? null;
  if (loose.length) throw new ArgumentError(`unrecognized arguments: ${loose.join(" ")}`);
  return values;
}
