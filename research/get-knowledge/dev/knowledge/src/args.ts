// A small command-line parser: commands, options, positionals and --help at every level.

import { UsageError } from "./core";

export type Option = {
  name: string; // --name
  dest: string;
  help: string;
  flag?: boolean;
  type?: "int" | "float" | "string";
  choices?: readonly string[];
  metavar?: string;
  default?: unknown;
};

export type Positional = {
  dest: string;
  metavar: string;
  help: string;
  nargs?: "one" | "+" | "*";
};

export type Command = {
  name: string;
  summary: string;
  description: string;
  options: Option[];
  positionals: Positional[];
  examples: string[];
  run: (args: Record<string, any>) => Promise<number> | number;
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

const HELP_OPTION = "  -h, --help";

function optionLabel(option: Option) {
  if (option.flag) return option.name;
  const value = option.metavar ?? (option.choices ? `{${option.choices.join(",")}}` : "VALUE");
  return `${option.name} ${value}`;
}

function wrap(text: string, indent: number, width = 88) {
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
  const width = Math.min(30, Math.max(...rows.map(([label]) => label.length)) + 2);
  return rows
    .map(([label, help]) => {
      const text = wrap(help, width);
      return label.length + 2 > width
        ? `${label}\n${" ".repeat(width)}${text}`
        : label.padEnd(width) + text;
    })
    .join("\n");
}

export function commandUsage(prog: string, command: Command) {
  const parts = [`${prog} ${command.name}`, "[-h]"];
  for (const option of command.options) parts.push(`[${optionLabel(option)}]`);
  for (const positional of command.positionals) {
    if (positional.nargs === "+") parts.push(`${positional.metavar} [${positional.metavar} ...]`);
    else if (positional.nargs === "*") parts.push(`[${positional.metavar} ...]`);
    else parts.push(positional.metavar);
  }
  return "usage: " + wrap(parts.join(" "), 7);
}

export function commandHelp(prog: string, command: Command) {
  const sections = [commandUsage(prog, command), wrap(command.description, 0)];
  if (command.positionals.length) {
    sections.push(
      "arguments:\n" +
        table(command.positionals.map((positional) => [`  ${positional.metavar}`, positional.help])),
    );
  }
  const rows: [string, string][] = [[HELP_OPTION, "show this help and exit"]];
  for (const option of command.options) {
    let help = option.help;
    if (option.choices && option.metavar) help += ` [choices: ${option.choices.join(", ")}]`;
    rows.push([`  ${optionLabel(option)}`, help]);
  }
  sections.push("options:\n" + table(rows));
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
    wrap(description, 0),
    "commands:\n" + table(commands.map((command) => [`  ${command.name}`, command.summary])),
    "options:\n" + table([[HELP_OPTION, "show this help and exit"]]),
    footer,
  ].join("\n\n");
}

const NUMBER = /^-\d+(\.\d+)?$/;

function convert(option: Option, value: string, usage: string) {
  const fail = (kind: string) =>
    new ArgumentError(`argument ${option.name}: invalid ${kind} value: '${value}'`, usage);
  let converted: unknown = value;
  if (option.type === "int") {
    if (!/^\s*[-+]?\d+\s*$/.test(value)) throw fail("int");
    converted = parseInt(value, 10);
  } else if (option.type === "float") {
    const number = value.trim() ? Number(value) : NaN;
    if (Number.isNaN(number)) throw fail("float");
    converted = number;
  }
  if (option.choices && !option.choices.includes(value)) {
    const listed = option.choices.map((choice) => `'${choice}'`).join(", ");
    throw new ArgumentError(
      `argument ${option.name}: invalid choice: '${value}' (choose from ${listed})`,
      usage,
    );
  }
  return converted;
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
  throw new ArgumentError(`unrecognized arguments: ${name}`, usage);
}

/** The arguments of one command. Throws HelpRequested or ArgumentError. */
export function parseCommand(prog: string, command: Command, argv: string[]) {
  const usage = commandUsage(prog, command);
  const values: Record<string, any> = {};
  for (const option of command.options) values[option.dest] = option.default ?? (option.flag ? false : null);
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
      if (equals >= 0) throw new ArgumentError(`argument ${option.name}: ignored explicit argument`, usage);
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
    values[option.dest] = convert(option, value, usage);
  }
  const missing: string[] = [];
  for (const positional of command.positionals) {
    if (positional.nargs === "+" || positional.nargs === "*") {
      if (positional.nargs === "+" && !loose.length) missing.push(positional.metavar);
      values[positional.dest] = loose.splice(0);
    } else if (loose.length) {
      values[positional.dest] = loose.shift();
    } else {
      missing.push(positional.metavar);
    }
  }
  if (missing.length) {
    throw new ArgumentError(`the following arguments are required: ${missing.join(", ")}`, usage);
  }
  if (loose.length) throw new ArgumentError(`unrecognized arguments: ${loose.join(" ")}`, usage);
  return values;
}
