// The command line: print the report protocol, or check an agent file.

import fs from "node:fs";
import path from "node:path";
import { help, HelpRequested, parse, type Program, usage, wrap } from "./args";
import { inferPlatform, PLATFORMS, type Platform, problemsOf, protocolFor, readText } from "./check";
import { io, NotUtf8, UsageError } from "./core";
import { osError, pathParts, pathString, strip } from "./py";

export const PROG = "check_agent";

const paragraph = (text: string) => "  " + wrap(text, 2);
const rows = (items: [string, string][]) =>
  items.map(([label, text]) => `  ${label.padEnd(4)}${wrap(text, 6)}`).join("\n");

export function program(): Program {
  return {
    prog: PROG,
    description:
      "Check an agent definition file written with the agents-creator skill, or print the report protocol " +
      "block that every such agent carries word for word. Print the protocol while you write the agent's " +
      "instructions; check the finished file, fix each problem it prints, and check it again until it exits 0.",
    positionals: [
      {
        dest: "file",
        metavar: "AGENT_FILE",
        help:
          "the agent file to check (a path): a .md file for Claude Code or OpenCode, a .toml file for Codex. " +
          "Needed unless --protocol is given.",
      },
    ],
    options: [
      {
        name: "--protocol",
        dest: "protocol",
        metavar: "AGENT_NAME",
        help:
          "print the report protocol block with AGENT_NAME (the agent's name, as in its file) filled in, " +
          "markers included, and exit; AGENT_FILE is then not needed",
      },
      {
        name: "--platform",
        dest: "platform",
        metavar: "PLATFORM",
        help: "the agent's platform, when the file's location does not show it",
        choices: PLATFORMS,
        defaultText: "taken from the file's location",
      },
    ],
    sections: [
      [
        "platform",
        paragraph(
          "Without --platform, a .toml file is Codex, a path with /.claude/agents/ is Claude Code, and a path " +
            "with /.opencode/agents/ or /opencode/agents/ is OpenCode. Anywhere else, such as a directory the " +
            "user named, pass --platform.",
        ),
      ],
      [
        "typical workflow",
        [
          `  1. ${PROG} --protocol code-reviewer`,
          "     Paste the output as it is, markers included, at the end of the instructions.",
          `  2. ${PROG} .claude/agents/code-reviewer.md`,
          "     Fix each problem it prints, and run it again until it exits 0.",
        ].join("\n"),
      ],
      [
        "output",
        paragraph(
          "A check prints one 'problem: ...' line for each problem, then 'N problem(s) in AGENT_FILE " +
            "(PLATFORM)', or 'ok: AGENT_FILE (PLATFORM)' when nothing is wrong. --protocol prints the block. " +
            "Both go to stdout; wrong usage goes to stderr.",
        ),
      ],
      [
        "files",
        paragraph(
          "Reads AGENT_FILE, and the protocol block in references/report-protocol.md of this skill's " +
            "directory. Writes nothing.",
        ),
      ],
      [
        "exit codes",
        rows([
          ["0", "nothing is wrong, or the protocol was printed"],
          ["1", "the file has problems, listed on stdout"],
          ["2", "wrong usage, or the agent file or the protocol file cannot be read"],
        ]),
      ],
    ],
    examples: [
      `${PROG} --protocol code-reviewer`,
      `${PROG} .claude/agents/code-reviewer.md`,
      `${PROG} .codex/agents/code-reviewer.toml`,
      `${PROG} review-agents/code-reviewer.md --platform opencode`,
    ],
  };
}

function wrongUsage(message: string) {
  io.err(`${usage(program())}\n${PROG}: error: ${message}\nRun '${PROG} --help' for help.`);
  return 2;
}

function check(file: string, platformOption: string | null) {
  const shown = pathString(file);
  let text: string;
  try {
    text = readText(shown);
  } catch (error) {
    if (error instanceof NotUtf8) throw new UsageError(`cannot read ${shown}: ${error.message}`);
    throw new UsageError(`cannot read ${shown}: ${osError(error, shown)}`);
  }
  const { name, stem, suffix } = pathParts(shown);
  const platform = (platformOption as Platform | null) ?? inferPlatform(suffix, fs.realpathSync(path.resolve(shown)));
  if (platform === null) {
    throw new UsageError(
      `cannot tell the platform of ${shown} from its location; pass --platform (${PLATFORMS.join(", ")})`,
    );
  }
  if (platform === "codex" && suffix !== ".toml") throw new UsageError("a Codex agent file is a .toml file");
  if (platform !== "codex" && suffix !== ".md") throw new UsageError(`a ${platform} agent file is a .md file`);
  const problems = problemsOf(platform, { name, stem }, text);
  for (const problem of problems) io.out(`problem: ${problem}`);
  if (problems.length) {
    io.out(`${problems.length} problem(s) in ${shown} (${platform})`);
    return 1;
  }
  io.out(`ok: ${shown} (${platform})`);
  return 0;
}

export function main(argv: string[]): number {
  if (!argv.length) {
    io.out(help(program()));
    return wrongUsage("give the agent file to check, or --protocol <agent-name>");
  }
  if (argv.length === 1 && argv[0] === "help") {
    io.out(help(program()));
    return 0;
  }
  try {
    const args = parse(program(), argv);
    const protocol = args.protocol ?? null;
    if (protocol !== null) {
      const name = strip(protocol);
      if (!name) throw new UsageError("--protocol needs the agent's name");
      io.out(protocolFor(name));
      return 0;
    }
    const file = args.file ?? null;
    if (file === null) throw new UsageError("give the agent file to check, or --protocol <agent-name>");
    return check(file, args.platform ?? null);
  } catch (error) {
    if (error instanceof HelpRequested) {
      io.out(error.message);
      return 0;
    }
    if (error instanceof UsageError) return wrongUsage(error.message);
    throw error;
  }
}
