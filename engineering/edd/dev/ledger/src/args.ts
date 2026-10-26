// A small command-line parser: commands, options, positionals and --help at every level.

import { UsageError } from "./core";

export type Option = {
  name: string; // --name
  dest: string;
  help: string;
  metavar: string;
  /** Given once per value; the values are collected in a list. */
  repeat?: boolean;
  required?: boolean;
  /** What the help says the default is. */
  defaultText?: string;
};

export type Positional = {
  dest: string;
  metavar: string;
  help: string;
  nargs?: "one" | "+";
};

export type Command = {
  name: string;
  summary: string;
  description: string;
  options: Option[];
  positionals: Positional[];
  /** What the command prints and writes. */
  output: string;
  /** The exit codes and what each means. */
  exitCodes: [string, string][];
  examples: string[];
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
const HELP_OPTION = "  -h, --help";

function optionLabel(option: Option) {
  return `${option.name} ${option.metavar}`;
}

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

/** Paragraphs, each wrapped and indented by `indent`. */
function paragraphs(text: string, indent = 0) {
  return text
    .split("\n\n")
    .map((paragraph) => " ".repeat(indent) + wrap(paragraph, indent))
    .join("\n\n");
}

export function table(rows: [string, string][]) {
  const width = Math.min(30, Math.max(...rows.map(([label]) => label.length)) + 2);
  return rows
    .map(([label, help]) => {
      const text = wrap(help, width);
      return label.length + 2 > width ? `${label}\n${" ".repeat(width)}${text}` : label.padEnd(width) + text;
    })
    .join("\n");
}

/**
 * A shell command broken at spaces outside quotes into lines that fit, each line but the last
 * ending in a backslash, so that it still runs when copied.
 */
export function shellWrap(command: string, indent: number, width = WIDTH) {
  const words = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const lead = lines.length ? indent + 4 : indent;
    if (line && lead + line.length + 1 + word.length + 2 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((text, index) => " ".repeat(index ? indent + 4 : indent) + text).join(" \\\n");
}

export function commandUsage(prog: string, command: Command) {
  const parts = [`${prog} ${command.name}`, "[-h]"];
  for (const option of command.options) {
    const label = optionLabel(option);
    parts.push(option.required ? label : option.repeat ? `[${label} ...]` : `[${label}]`);
  }
  for (const positional of command.positionals) {
    parts.push(positional.nargs === "+" ? `${positional.metavar} [${positional.metavar} ...]` : positional.metavar);
  }
  return "usage: " + wrap(parts.join(" "), 7);
}

function optionHelp(option: Option) {
  let help = option.help;
  if (option.required) help += " [required]";
  if (option.repeat) help += " [repeatable]";
  if (option.defaultText) help += ` [default: ${option.defaultText}]`;
  return help;
}

export function commandHelp(prog: string, command: Command) {
  const sections = [commandUsage(prog, command), paragraphs(command.description)];
  if (command.positionals.length) {
    sections.push("arguments:\n" + table(command.positionals.map((positional) => [`  ${positional.metavar}`, positional.help])));
  }
  const rows: [string, string][] = [[HELP_OPTION, "show this help and exit"]];
  for (const option of command.options) rows.push([`  ${optionLabel(option)}`, optionHelp(option)]);
  sections.push("options:\n" + table(rows));
  sections.push("output:\n" + paragraphs(command.output, 2));
  sections.push("exit codes:\n" + table(command.exitCodes.map(([code, meaning]) => [`  ${code}`, meaning])));
  sections.push("examples:\n" + command.examples.map((example) => shellWrap(example, 2)).join("\n"));
  return sections.join("\n\n");
}

export function topUsage(prog: string) {
  return `usage: ${prog} [-h] COMMAND ...`;
}

/** A line of the top-level help: text, a shell command, or a term with its meaning. */
export type HelpLine = string | { command: string } | [string, string];

function helpLines(lines: HelpLine[]) {
  return lines
    .map((line) => {
      if (typeof line === "string") return "  " + wrap(line, /^\d+\. /.test(line) ? 5 : 4);
      if (Array.isArray(line)) return table([[`  ${line[0]}`, line[1]]]);
      return shellWrap(line.command, 5);
    })
    .join("\n");
}

export function topHelp(prog: string, description: string, commands: Command[], sections: [string, HelpLine[]][]) {
  return [
    topUsage(prog),
    paragraphs(description),
    "commands:\n" + table(commands.map((command) => [`  ${command.name}`, command.summary])),
    "options:\n" + table([[HELP_OPTION, "show this help and exit"]]),
    ...sections.map(([title, lines]) => `${title}:\n` + helpLines(lines)),
    `Run '${prog} COMMAND --help' or '${prog} help COMMAND' for its options and examples.`,
  ].join("\n\n");
}

/** The edit distance between two words. */
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** The choice closest to what was typed, when one is close enough to be what was meant. */
export function closest(typed: string, choices: string[]) {
  let found: string | null = null;
  let least = Infinity;
  for (const choice of choices) {
    const far = distance(typed, choice);
    if (far < least && far <= Math.max(2, Math.floor(choice.length / 3))) {
      found = choice;
      least = far;
    }
  }
  return found;
}

export function didYouMean(typed: string, choices: string[]) {
  const found = closest(typed, choices);
  return found ? ` (did you mean ${found}?)` : "";
}

function findOption(command: Command, name: string, usage: string) {
  const exact = command.options.find((option) => option.name === name);
  if (exact) return exact;
  const prefixed = command.options.filter((option) => option.name.startsWith(name));
  if (prefixed.length === 1) return prefixed[0]!;
  if (prefixed.length > 1) {
    const names = prefixed.map((option) => option.name).join(", ");
    throw new ArgumentError(`ambiguous option: ${name} could match ${names}`, usage);
  }
  const names = ["--help", ...command.options.map((option) => option.name)];
  throw new ArgumentError(`unrecognized arguments: ${name}${didYouMean(name, names)}`, usage);
}

/** The arguments of one command. Throws HelpRequested or ArgumentError. */
export function parseCommand(prog: string, command: Command, argv: string[]) {
  const usage = commandUsage(prog, command);
  const values: Record<string, string | string[] | null> = {};
  for (const option of command.options) values[option.dest] = option.repeat ? [] : null;
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
    if (token === "-h" || token === "--help") throw new HelpRequested(commandHelp(prog, command));
    if (!token.startsWith("--")) throw new ArgumentError(`unrecognized arguments: ${token}`, usage);
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    const option = findOption(command, name, usage);
    let value: string;
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-")) {
        throw new ArgumentError(`argument ${option.name}: expected one argument`, usage);
      }
      value = next;
      index++;
    }
    if (option.repeat) (values[option.dest] as string[]).push(value);
    else values[option.dest] = value;
  }
  const missing: string[] = [];
  for (const positional of command.positionals) {
    if (positional.nargs === "+") {
      if (!loose.length) missing.push(positional.metavar);
      values[positional.dest] = loose.splice(0);
    } else if (loose.length) {
      values[positional.dest] = loose.shift()!;
    } else {
      missing.push(positional.metavar);
    }
  }
  for (const option of command.options) if (option.required && values[option.dest] === null) missing.push(option.name);
  if (missing.length) throw new ArgumentError(`the following arguments are required: ${missing.join(", ")}`, usage);
  if (loose.length) throw new ArgumentError(`unrecognized arguments: ${loose.join(" ")}`, usage);
  return values;
}
