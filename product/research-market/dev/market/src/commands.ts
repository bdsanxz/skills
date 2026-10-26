// The command line: market collect | list | tally, with help at every level.

import { ArgumentError, type Command, HelpRequested, commandHelp, commandUsage, parseCommand, table, topUsage, wrap } from "./args";
import { COLLECT } from "./collect";
import { UsageError, closest, note, print } from "./core";
import { LIST } from "./list";
import { TALLY } from "./tally";

export const PROG = "market";
export const COMMANDS: Command[] = [COLLECT, LIST, TALLY];

const DESCRIPTION =
  "Market research from what an audience posts in public on X/Twitter and Bluesky. Collect posts " +
  "by topic search, by account and by URL into one JSON data file, read them one per line to code " +
  "them in a text file, and count the coded themes. Posts come from the FxEmbed API, which needs no " +
  "key or login. Use it to find an audience's pains, wishes, workarounds, alternatives and words, " +
  "grounded in posts that can be linked.";

const WORKFLOW = [
  "typical workflow:",
  "  1. market collect --out posts.json --queries-file queries.txt --dry",
  "  2. market collect --out posts.json --queries-file queries.txt --since 2026-04-01",
  "     market collect --out posts.json --account x:AcmeHelp --exclude-from Acme",
  "  3. market list posts.json --from 1 --to 200     (write coding.txt while reading)",
  "  4. market tally posts.json coding.txt --markdown",
].join("\n");

const FILES =
  "files:\n  " +
  wrap(
    "market collect creates or adds to the data file named by --out (one line per run and per post) " +
      "and reads --queries-file and --posts-file. market list and market tally only read: the data " +
      "file and the coding file you write. Nothing else is read or written, and only the FxEmbed API " +
      "(api.fxtwitter.com, api.fxbsky.app) is contacted.",
    2,
  );

const EXIT_CODES =
  "exit codes:\n" +
  "  0  done\n" +
  "  1  the request failed: nothing collected, or posts or coding lines cannot be used\n" +
  "  2  wrong usage, or an input file that cannot be used";

function top() {
  return [
    topUsage(PROG),
    wrap(DESCRIPTION, 0),
    "commands:\n" + table(COMMANDS.map((command) => [`  ${command.name}`, command.summary])),
    "options:\n" + table([["  -h, --help", "show this help and exit"]]),
    WORKFLOW,
    FILES,
    EXIT_CODES,
    wrap(`Run '${PROG} COMMAND --help' or '${PROG} help COMMAND' for a command's options and examples.`, 0),
  ].join("\n\n");
}

function wrongUsage(message: string, usage: string, command?: string) {
  const name = command ? `${PROG} ${command}` : PROG;
  note(`${usage}\n${name}: error: ${message}\nRun '${name} --help' for help.`);
  return 2;
}

function unknownCommand(name: string) {
  const choices = COMMANDS.map((item) => `'${item.name}'`).join(", ");
  const near = closest(name, COMMANDS.map((item) => item.name));
  return wrongUsage(
    `argument COMMAND: invalid choice: '${name}' (choose from ${choices})` + (near ? `; did you mean '${near}'?` : ""),
    topUsage(PROG),
  );
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined) {
    print(top());
    return 2;
  }
  if (name === "-h" || name === "--help") {
    print(top());
    return 0;
  }
  if (name === "help") {
    if (!rest.length) {
      print(top());
      return 0;
    }
    const asked = COMMANDS.find((command) => command.name === rest[0]);
    if (!asked) return unknownCommand(rest[0]!);
    print(commandHelp(PROG, asked));
    return 0;
  }
  const command = COMMANDS.find((item) => item.name === name);
  if (!command) return unknownCommand(name);
  try {
    return await command.run(parseCommand(PROG, command, rest));
  } catch (error) {
    if (error instanceof HelpRequested) {
      print(error.message);
      return 0;
    }
    if (error instanceof ArgumentError) return wrongUsage(error.message, error.usage, command.name);
    if (error instanceof UsageError) return wrongUsage(error.message, commandUsage(PROG, command), command.name);
    const why = error instanceof Error ? error.message : String(error);
    note(`${PROG} ${command.name}: failed: ${why}`);
    return 1;
  }
}
