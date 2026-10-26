// A small command-line parser: commands, options, positionals and --help at every level.

import { UsageError, closest } from "./core";

export type Value = string | number | boolean | string[] | null;
export type Values = Record<string, Value>;

export type Option = {
  name: string; // --name
  dest: string;
  help: string;
  flag?: boolean;
  type?: "int" | "string";
  choices?: readonly string[];
  metavar?: string;
  default?: string | number;
  /** Shown as the default when it is not a fixed value, such as "now". */
  defaultText?: string;
  required?: boolean;
  /** May be given more than once; the values are collected in order. */
  repeat?: boolean;
  /** The value may be left out, and then this one is used. */
  optional?: string;
  /** The value may begin with "-", as in `--terms -from:brand`. */
  anyValue?: boolean;
  group?: string;
};

export type Positional = {
  dest: string;
  metavar: string;
  help: string;
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
  exitCodes: [code: string, meaning: string][];
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
/** Joins the words of a note such as [default: 280], so that a line never breaks inside it. */
const GLUE = "\u0007";
const HELP_OPTION = "  -h, --help";

function valueLabel(option: Option) {
  return option.metavar ?? (option.choices ? `{${option.choices.join(",")}}` : "VALUE");
}

function optionLabel(option: Option) {
  if (option.flag) return option.name;
  if (option.optional !== undefined) return `${option.name} [${valueLabel(option)}]`;
  return `${option.name} ${valueLabel(option)}`;
}

/** Words joined into lines of at most `width` columns, the lines after the first indented. */
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
  return lines.join("\n" + " ".repeat(indent)).replaceAll(GLUE, " ");
}

/** Paragraphs separated by a blank line, each wrapped. */
function paragraphs(text: string, indent = 0) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => " ".repeat(indent) + wrap(paragraph, indent))
    .join("\n\n");
}

export function table(rows: [string, string][], labels: string[] = rows.map(([label]) => label)) {
  const width = Math.min(26, Math.max(...labels.map((label) => label.length)) + 2);
  return rows
    .map(([label, help]) => {
      const text = wrap(help, width);
      return label.length + 2 > width ? `${label}\n${" ".repeat(width)}${text}` : label.padEnd(width) + text;
    })
    .join("\n");
}

export function commandUsage(prog: string, command: Command) {
  const parts = [`${prog} ${command.name}`, "[-h]"];
  for (const positional of command.positionals) parts.push(positional.metavar);
  for (const option of command.options) {
    const label = optionLabel(option);
    parts.push(option.required ? label : `[${label}]`);
  }
  return "usage: " + wrap(parts.map((part) => part.replaceAll(" ", GLUE)).join(" "), 7);
}

function optionHelp(option: Option) {
  const notes: string[] = [];
  if (option.required) notes.push("required");
  if (option.type === "int") notes.push("integer");
  if (option.choices) notes.push(`choices: ${option.choices.join(", ")}`);
  if (option.optional !== undefined) notes.push(`without a value: ${option.optional}`);
  const shown = option.defaultText ?? option.default;
  if (shown !== undefined) notes.push(`default: ${shown}`);
  if (option.repeat) notes.push("repeatable");
  return option.help + notes.map((item) => ` [${item.replaceAll(" ", GLUE)}]`).join("");
}

export function commandHelp(prog: string, command: Command) {
  const sections = [commandUsage(prog, command), paragraphs(command.description)];
  if (command.positionals.length) {
    sections.push(
      "arguments:\n" + table(command.positionals.map((positional) => [`  ${positional.metavar}`, positional.help])),
    );
  }
  const groups: string[] = [];
  for (const option of command.options) {
    const group = option.group ?? "options";
    if (!groups.includes(group)) groups.push(group);
  }
  if (!groups.includes("options")) groups.unshift("options");
  const labels = [HELP_OPTION, ...command.options.map((option) => `  ${optionLabel(option)}`)];
  for (const group of groups) {
    const rows: [string, string][] = group === "options" ? [[HELP_OPTION, "show this help and exit"]] : [];
    for (const option of command.options) {
      if ((option.group ?? "options") === group) rows.push([`  ${optionLabel(option)}`, optionHelp(option)]);
    }
    sections.push(`${group}:\n${table(rows, labels)}`);
  }
  sections.push("output:\n" + paragraphs(command.output, 2));
  sections.push("exit codes:\n" + table(command.exitCodes.map(([code, meaning]) => [`  ${code}`, meaning])));
  if (command.examples.length) {
    sections.push("examples:\n" + command.examples.map((example) => `  ${example}`).join("\n"));
  }
  return sections.join("\n\n");
}

export function topUsage(prog: string) {
  return `usage: ${prog} [-h] COMMAND ...`;
}

const NUMBER = /^-\d+(\.\d+)?$/;
const looksLikeOption = (token: string) => token.startsWith("-") && token !== "-" && !NUMBER.test(token);

function convert(option: Option, value: string, usage: string): Value {
  if (option.type === "int") {
    if (!/^\s*[-+]?\d+\s*$/.test(value)) {
      throw new ArgumentError(`argument ${option.name}: invalid int value: '${value}' (give a whole number)`, usage);
    }
    return parseInt(value, 10);
  }
  if (option.choices && !option.choices.includes(value)) {
    const listed = option.choices.map((choice) => `'${choice}'`).join(", ");
    const near = closest(value, option.choices);
    throw new ArgumentError(
      `argument ${option.name}: invalid choice: '${value}' (choose from ${listed})` +
        (near ? `; did you mean '${near}'?` : ""),
      usage,
    );
  }
  return value;
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
  const near = closest(name, command.options.map((option) => option.name));
  throw new ArgumentError(`unrecognized arguments: ${name}` + (near ? ` (did you mean ${near}?)` : ""), usage);
}

/** The arguments of one command. Throws HelpRequested or ArgumentError. */
export function parseCommand(prog: string, command: Command, argv: string[]): Values {
  const usage = commandUsage(prog, command);
  const values: Values = {};
  for (const option of command.options) {
    values[option.dest] = option.repeat ? [] : (option.default ?? (option.flag ? false : null));
  }
  const given = new Set<string>();
  const loose: string[] = [];
  let onlyPositionals = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (onlyPositionals || !looksLikeOption(token)) {
      loose.push(token);
      continue;
    }
    if (token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (token === "-h" || token === "--help") throw new HelpRequested(commandHelp(prog, command));
    if (!token.startsWith("--")) {
      const near = closest(token.replace(/^-+/, "--"), command.options.map((option) => option.name));
      throw new ArgumentError(`unrecognized arguments: ${token}` + (near ? ` (did you mean ${near}?)` : ""), usage);
    }
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    const option = findOption(command, name, usage);
    given.add(option.dest);
    if (option.flag) {
      if (equals >= 0) throw new ArgumentError(`argument ${option.name}: ignored explicit argument`, usage);
      values[option.dest] = true;
      continue;
    }
    let value: string;
    const next = argv[index + 1];
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else if (option.optional !== undefined) {
      if (next === undefined || looksLikeOption(next)) {
        value = option.optional;
      } else {
        value = next;
        index++;
      }
    } else {
      if (next === undefined || (!option.anyValue && looksLikeOption(next))) {
        throw new ArgumentError(`argument ${option.name}: expected one argument`, usage);
      }
      value = next;
      index++;
    }
    const converted = convert(option, value, usage);
    const earlier = values[option.dest];
    values[option.dest] = option.repeat && Array.isArray(earlier) ? [...earlier, String(converted)] : converted;
  }
  const missing: string[] = [];
  for (const positional of command.positionals) {
    if (loose.length) values[positional.dest] = loose.shift()!;
    else missing.push(positional.metavar);
  }
  for (const option of command.options) {
    if (option.required && !given.has(option.dest)) missing.push(optionLabel(option));
  }
  if (missing.length) {
    throw new ArgumentError(`the following arguments are required: ${missing.join(", ")}`, usage);
  }
  if (loose.length) throw new ArgumentError(`unrecognized arguments: ${loose.join(" ")}`, usage);
  return values;
}
