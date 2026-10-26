// A small command-line parser: commands, options, positionals and --help at every level.

import { UsageError } from "./core";

export type Values = Record<string, unknown>;

export type Option = {
  name: string; // --name
  dest: string;
  help: string;
  flag?: boolean;
  /** Collect every use into a list, in order. */
  repeat?: boolean;
  choices?: readonly string[];
  metavar?: string;
  /** Converts the value; throws a string that says what is wrong with it. */
  parse?: (value: string) => unknown;
  /** Shown in help as [default: ...]. */
  defaultHelp?: string;
};

export type Positional = {
  dest: string;
  metavar: string;
  help: string;
};

export type Command = {
  name: string;
  summary: string;
  /** Paragraphs separated by blank lines; a paragraph whose lines start with two spaces is kept as it is. */
  description: string;
  options: Option[];
  positionals: Positional[];
  output: string;
  exitCodes: string;
  examples: string[];
  run: (args: Values) => Promise<number> | number;
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
  if (option.flag) return option.name;
  const value = option.metavar ?? (option.choices ? `{${option.choices.join(",")}}` : "VALUE");
  return `${option.name} ${value}`;
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

/** Wrap each paragraph; keep a paragraph whose every line is indented as it is. */
export function paragraphs(text: string, indent = 0) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => line.startsWith("  "))) {
        return lines.map((line) => " ".repeat(indent) + line).join("\n");
      }
      return " ".repeat(indent) + wrap(block, indent);
    })
    .join("\n\n");
}

function table(rows: [string, string][]) {
  const width = Math.min(30, Math.max(...rows.map(([label]) => label.length)) + 2);
  return rows
    .map(([label, help]) => {
      const text = wrap(help, width);
      return label.length + 2 > width ? `${label}\n${" ".repeat(width)}${text}` : label.padEnd(width) + text;
    })
    .join("\n");
}

export function commandUsage(prog: string, command: Command) {
  const parts = [`${prog} ${command.name}`, "[-h]"];
  for (const option of command.options) {
    parts.push(option.repeat ? `[${optionLabel(option)} ...]` : `[${optionLabel(option)}]`);
  }
  for (const positional of command.positionals) parts.push(positional.metavar);
  // Wrap between parts, never inside one, so each option stays on one line.
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    if (line && 7 + line.length + 1 + part.length > WIDTH) {
      lines.push(line);
      line = part;
    } else {
      line = line ? `${line} ${part}` : part;
    }
  }
  lines.push(line);
  return "usage: " + lines.join("\n       ");
}

export function commandHelp(prog: string, command: Command) {
  const sections = [commandUsage(prog, command), wrap(command.summary, 0), paragraphs(command.description)];
  if (command.positionals.length) {
    sections.push(
      "arguments:\n" + table(command.positionals.map((positional) => [`  ${positional.metavar}`, positional.help])),
    );
  }
  const rows: [string, string][] = [[HELP_OPTION, "show this help and exit"]];
  for (const option of command.options) {
    let help = option.help;
    if (option.choices) help += ` [choices: ${option.choices.join(", ")}]`;
    if (option.repeat) help += " [repeatable]";
    if (option.defaultHelp) help += ` [default: ${option.defaultHelp}]`;
    rows.push([`  ${optionLabel(option)}`, help]);
  }
  sections.push("options:\n" + table(rows));
  sections.push("output:\n" + paragraphs(command.output, 2));
  sections.push("exit codes:\n" + paragraphs(command.exitCodes, 2));
  if (command.examples.length) {
    sections.push("examples:\n" + command.examples.map((example) => `  ${example}`).join("\n"));
  }
  return sections.join("\n\n");
}

export function topUsage(prog: string) {
  return `usage: ${prog} [-h] COMMAND ...`;
}

export function topHelp(prog: string, description: string, commands: Command[], footer: string) {
  return [
    topUsage(prog),
    paragraphs(description),
    "commands:\n" + table(commands.map((command) => [`  ${command.name}`, command.summary])),
    "options:\n" + table([[HELP_OPTION, "show this help and exit"]]),
    footer.trim(),
  ].join("\n\n");
}

/** Edit distance, for "did you mean". */
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** The closest of the choices, when one is close enough to be a typo. */
export function closest(word: string, choices: readonly string[]) {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const choice of choices) {
    const far = distance(word.toLowerCase(), choice.toLowerCase());
    if (far < bestDistance) [best, bestDistance] = [choice, far];
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(best.length / 3)) ? best : undefined;
}

const NUMBER = /^-\d+(\.\d+)?$/;

function convert(option: Option, value: string, usage: string) {
  if (option.choices && !option.choices.includes(value)) {
    const listed = option.choices.map((choice) => `'${choice}'`).join(", ");
    throw new ArgumentError(`argument ${option.name}: invalid choice: '${value}' (choose from ${listed})`, usage);
  }
  if (!option.parse) return value;
  try {
    return option.parse(value);
  } catch (problem) {
    throw new ArgumentError(`argument ${option.name}: ${String(problem)}`, usage);
  }
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
  const near = closest(name, ["--help", ...command.options.map((option) => option.name)]);
  throw new ArgumentError(`unrecognized arguments: ${name}${near ? `; did you mean ${near}?` : ""}`, usage);
}

/** The arguments of one command. Throws HelpRequested or ArgumentError. */
export function parseCommand(prog: string, command: Command, argv: string[]) {
  const usage = commandUsage(prog, command);
  const values: Values = {};
  for (const option of command.options) values[option.dest] = option.flag ? false : option.repeat ? [] : null;
  const loose: string[] = [];
  let onlyPositionals = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (onlyPositionals || token === "-" || !token.startsWith("-") || NUMBER.test(token)) {
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
    if (option.flag) {
      if (equals >= 0) throw new ArgumentError(`argument ${option.name}: ignored explicit argument '${token.slice(equals + 1)}'`, usage);
      values[option.dest] = true;
      continue;
    }
    let value: string;
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-" && !NUMBER.test(next))) {
        throw new ArgumentError(`argument ${option.name}: expected one argument`, usage);
      }
      value = next;
      index++;
    }
    const converted = convert(option, value, usage);
    if (option.repeat) (values[option.dest] as unknown[]).push(converted);
    else values[option.dest] = converted;
  }
  const missing: string[] = [];
  for (const positional of command.positionals) {
    if (loose.length) values[positional.dest] = loose.shift();
    else missing.push(positional.metavar);
  }
  if (missing.length) {
    throw new ArgumentError(`the following arguments are required: ${missing.join(", ")}`, usage);
  }
  if (loose.length) throw new ArgumentError(`unrecognized arguments: ${loose.join(" ")}`, usage);
  return values;
}
