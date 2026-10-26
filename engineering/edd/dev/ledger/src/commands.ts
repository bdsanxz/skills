// The commands, their help, and the entry point that runs one of them.

import {
  ArgumentError,
  type Command,
  type HelpLine,
  HelpRequested,
  commandHelp,
  commandUsage,
  didYouMean,
  parseCommand,
  topHelp,
  topUsage,
} from "./args";
import { PROG, UsageError, isSystemError, note, print, systemMessage } from "./core";
import { diskFooter } from "./disk";
import { InitArgumentError, Ledger, init, prune, report, table } from "./ledger";

const RUN = "_swe/edd/t038/ledger.json";

const DESCRIPTION =
  "Keep the evidence ledger of an Evidence-Driven Development task, and refuse every claim the evidence " +
  "does not back. The ledger, a JSON file, holds one row per acceptance criterion: its tests, its " +
  "evidence files, the script that made them, what they show, and its status (open, proven, user-check " +
  "or waived). Start a run's ledger with `init`, run `check` after every change to it, clear the run's " +
  "work folder with `prune` at the close, and take the report's table from `table`.";

const SECTIONS: [string, HelpLine[]][] = [
  [
    "typical workflow",
    [
      "1. Start the run's ledger, with the criteria word for word from the ticket:",
      { command: `${PROG} init ${RUN} --task "Cancel a render" --criteria-from tickets/T038.md --section "Acceptance criteria" --code src --code tests` },
      "2. Fill in each row of the ledger as its evidence comes in, and check it after every change:",
      { command: `${PROG} check ${RUN}` },
      "3. At the close, once check reports no problem but the work folder, delete that folder:",
      { command: `${PROG} prune ${RUN}` },
      "4. Take the table for the report:",
      { command: `${PROG} table ${RUN}` },
    ],
  ],
  [
    "files",
    [
      "Every path in a ledger is relative to the project root, its `root`, which is relative to the ledger's own folder.",
      "init writes the ledger and creates the evidence folder (default: evidence/ beside the ledger).",
      "check and table read the ledger and the files it names, and write nothing.",
      "prune deletes the work/ folder beside the ledger; no other command deletes anything.",
      "Every command ends with a line on standard error: what the current folder takes on disk, and what its disk has free.",
    ],
  ],
  [
    "exit codes",
    [
      ["0", "every criterion is closed and backed by its evidence (init: the ledger was written)"],
      ["1", "problems were found, or the command failed"],
      ["2", "wrong usage, or a ledger or criteria file that cannot be read"],
      ["3", "no problems, but criteria are still open or waiting for the user"],
    ],
  ],
];

const CHECK_CODES: [string, string][] = [
  ["0", "every criterion is closed and backed by its evidence"],
  ["1", "problems were found: nothing in the ledger may be reported as proven until they are fixed"],
  ["2", "wrong usage, or a ledger that cannot be read"],
  ["3", "no problems, but criteria are still open or waiting for the user"],
];

export const COMMANDS: Command[] = [
  {
    name: "init",
    summary: "write a new ledger with one open row per criterion",
    description:
      "Write a new ledger with one open row per criterion, with the ids c1, c2 and so on. Take the " +
      "criteria word for word from a file with --criteria-from: its list items (`- `, `* `, `+ `, `1. `, " +
      "checkboxes included), or, when it has none, every line that is not a heading. --section reads only " +
      "the part under one Markdown heading. Or give each criterion with --criterion. Run it once per run, " +
      "at the start; it never overwrites a ledger.",
    positionals: [
      { dest: "ledger", metavar: "LEDGER", help: `the ledger file to write, such as ${RUN}; it must not exist yet` },
    ],
    options: [
      { name: "--task", dest: "task", metavar: "TEXT", required: true, help: "the task in one line" },
      {
        name: "--criteria-from",
        dest: "criteriaFrom",
        metavar: "FILE",
        help: "a UTF-8 file holding the criteria: its list items, or else one criterion per line",
      },
      {
        name: "--section",
        dest: "section",
        metavar: "HEADING",
        help: "read only the part of the criteria file under this Markdown heading, of any level; case is ignored",
      },
      {
        name: "--criterion",
        dest: "criterion",
        metavar: "TEXT",
        repeat: true,
        help: "one criterion, word for word; give it once per criterion, in place of --criteria-from",
      },
      {
        name: "--root",
        dest: "root",
        metavar: "DIR",
        defaultText: ". (the current folder)",
        help: "the project root that every path in the ledger is relative to",
      },
      {
        name: "--evidence-dir",
        dest: "evidenceDir",
        metavar: "DIR",
        defaultText: "evidence/ beside the ledger",
        help: "where the evidence files go; use the project's own place for evidence when it names one",
      },
      {
        name: "--code",
        dest: "code",
        metavar: "PATH",
        repeat: true,
        help: "a file or folder this task changes (product code and tests), relative to the root",
      },
    ],
    output:
      "Writes LEDGER as JSON and creates the evidence folder. Prints `wrote LEDGER: N criteria, all open` " +
      "and `evidence goes in DIR`.",
    exitCodes: [
      ["0", "the ledger was written"],
      ["2", "wrong usage, a criteria file that cannot be read or holds no criteria, or a LEDGER that already exists"],
    ],
    examples: [
      `${PROG} init ${RUN} --task "Cancel a render" --criteria-from tickets/T038.md --section "Acceptance criteria" --code src --code tests`,
      `${PROG} init _swe/edd/cancel-render/ledger.json --task "Cancel a render" --criterion "It prints Render cancelled." --criterion "It exits 130." --code src`,
      `${PROG} init ${RUN} --task "Cancel a render" --criteria-from tickets/T038.md --evidence-dir docs/evidence/t038 --code src`,
    ],
  },
  {
    name: "check",
    summary: "list every row that claims more than its files show",
    description:
      "Read each ledger and the files it names, and list every row that claims more than those files " +
      "show: evidence that is missing or empty, a quote in `shows` that no text evidence file of the row " +
      "holds, evidence or a test log older than the code or than its script, a test that is absent, failed " +
      "or skipped in the test logs, a stand-in nobody accepted, a file in the evidence folder that no row " +
      "names, and anything that points into the work/ folder, which may not outlive a closed run. Run it " +
      "after every change to a ledger, and before you report anything as done.",
    positionals: [{ dest: "ledger", metavar: "LEDGER", nargs: "+", help: "a ledger file written by init; give several to check them together" }],
    options: [],
    output:
      "For each ledger, on standard output: `LEDGER: <summary>`, then the sections `problems:`, `notes:` " +
      "and `not closed:` when they have entries, then a `result:` line. Notes do not fail the check: " +
      "evidence files with the same bytes, the work folder of a run still open, an evidence folder over " +
      "100 MB, a picture or recording over 5 MB. Writes nothing.\n\n" +
      "With several ledgers the worst result is the exit code: 1, then 3, then 0.",
    exitCodes: CHECK_CODES,
    examples: [`${PROG} check ${RUN}`, `${PROG} check ${RUN} _swe/edd/t039/ledger.json`],
  },
  {
    name: "table",
    summary: "print the ledger as a Markdown table for the report",
    description:
      "Print the ledger as a Markdown table for the report: one line per criterion with its status, its " +
      "tests, its evidence files and what they show. A row proven by a stand-in, waiting for the user, " +
      "waived or open says so in its status and its last column. Copy the output into report.md, or into " +
      "a ticket that wants the evidence, unchanged.",
    positionals: [{ dest: "ledger", metavar: "LEDGER", help: "a ledger file written by init" }],
    options: [],
    output:
      "On standard output: the summary line, an empty line, and the table. While check finds a problem it " +
      "prints no table: the report of the check and `no table: fix the problems first.` go to standard error.",
    exitCodes: CHECK_CODES,
    examples: [`${PROG} table ${RUN}`, `${PROG} table _swe/edd/cancel-render/ledger.json`],
  },
  {
    name: "prune",
    summary: "delete the work folder of a run that is closed and backed",
    description:
      "Delete the work/ folder beside the ledger, then check the ledger again. It deletes only a run that " +
      "check finds closed and backed apart from that folder: nothing while a row is open or waiting for " +
      "the user, or while another problem stands. Run it at the close, once check reports no problem but " +
      "the work folder.",
    positionals: [{ dest: "ledger", metavar: "LEDGER", help: "a ledger file written by init" }],
    options: [],
    output:
      "On standard output: `Deleted <work folder>: N entries (names).` or `No work folder to delete.`, " +
      "then the report of the second check. When it deletes nothing: the report of the check and " +
      "`Nothing was deleted: ...`.",
    exitCodes: [
      ["0", "the work folder is gone and every criterion is closed and backed"],
      ["1", "nothing was deleted, because the run is not closed or has another problem; or the second check found one"],
      ["2", "wrong usage, or a ledger that cannot be read"],
    ],
    examples: [`${PROG} prune ${RUN}`, `${PROG} prune _swe/edd/cancel-render/ledger.json`],
  },
];

export const top = () => topHelp(PROG, DESCRIPTION, COMMANDS, SECTIONS);

function wrongUsage(message: string, usage: string, command?: string) {
  const help = command ? `${PROG} ${command} --help` : `${PROG} --help`;
  note(`${usage}\n${PROG}${command ? " " + command : ""}: error: ${message}\nRun '${help}' for help.`);
  return 2;
}

function runCommand(name: string, args: Record<string, string | string[] | null>) {
  const text = (key: string) => args[key] as string | null;
  const list = (key: string) => args[key] as string[];
  if (name === "init") {
    return init(
      {
        ledger: text("ledger")!,
        task: text("task")!,
        criteriaFrom: text("criteriaFrom"),
        section: text("section"),
        criterion: list("criterion"),
        root: text("root") ?? ".",
        evidenceDir: text("evidenceDir"),
        code: list("code"),
      },
      print,
    );
  }
  if (name === "check") {
    const codes = new Set<number>();
    for (const file of list("ledger")) {
      const ledger = new Ledger(file);
      ledger.check();
      report(ledger, print);
      codes.add(ledger.exitCode());
    }
    return codes.has(1) ? 1 : codes.has(3) ? 3 : 0;
  }
  if (name === "table") return table(text("ledger")!, print, note);
  return prune(text("ledger")!, print);
}

function dispatch(argv: string[]): number {
  const [name, ...rest] = argv;
  if (name === undefined) {
    print(top());
    return 2;
  }
  if (name === "-h" || name === "--help") {
    print(top());
    return 0;
  }
  const names = COMMANDS.map((command) => command.name);
  if (name === "help") {
    const asked = COMMANDS.find((command) => command.name === rest[0]);
    if (rest.length && !asked) {
      return wrongUsage(`there is no command named '${rest[0]}'${didYouMean(rest[0]!, names)}`, topUsage(PROG));
    }
    print(asked ? commandHelp(PROG, asked) : top());
    return 0;
  }
  const command = COMMANDS.find((item) => item.name === name);
  if (!command) {
    const choices = names.map((item) => `'${item}'`).join(", ");
    return wrongUsage(
      `argument COMMAND: invalid choice: '${name}' (choose from ${choices})${didYouMean(name, names)}`,
      topUsage(PROG),
    );
  }
  try {
    return runCommand(command.name, parseCommand(PROG, command, rest));
  } catch (error) {
    if (error instanceof HelpRequested) {
      print(error.message);
      return 0;
    }
    if (error instanceof ArgumentError) return wrongUsage(error.message, error.usage, command.name);
    if (error instanceof InitArgumentError) return wrongUsage(error.message, commandUsage(PROG, command), command.name);
    if (error instanceof UsageError) {
      note(`${PROG}: ${error.message}`);
      return 2;
    }
    if (isSystemError(error)) {
      const file = (error as { path?: unknown }).path;
      note(`${PROG} ${command.name}: failed: ${systemMessage(error, typeof file === "string" ? file : undefined)}`);
      return 1;
    }
    throw error;
  }
}

/** Runs one command and returns its exit code. Every command ends with the disk line. */
export function main(argv: string[]): number {
  try {
    return dispatch(argv);
  } finally {
    diskFooter();
  }
}
