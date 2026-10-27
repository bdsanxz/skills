// The commands, their help, and main().

import path from "node:path";
import {
  type Command,
  type Option,
  type Values,
  ArgumentError,
  HelpRequested,
  closest,
  commandHelp,
  parseCommand,
  topHelp,
  topUsage,
} from "./args";
import { AGENTS, LEVELS, forgetLists } from "./agents";
import { DEFAULT_PEERS, Exit, PROG, Problem, io, partition, print, reason, repr, shown, strip } from "./core";
import { cmdLaunch, peersSourceOf, report } from "./launch";
import { layoutLines, planLayout } from "./layout";
import { PEERS_INSTALLER, installPeers, peersInstalled, peersInstaller } from "./peers";
import {
  type Overrides,
  buildMember,
  describe,
  loadRoster,
  rosterProblems,
  selected,
  writeIdentity,
  writeInstructions,
} from "./roster";

const RUN = `bun scripts/${PROG}`;
const AGENT_NAMES = Object.keys(AGENTS).join(", ");
const LEVEL_NAMES = LEVELS.join(", ");

// --------------------------------------------------------------------------- arguments

/** MEMBER=VALUE, as --agent, --model and --effort take it. */
function memberValue(text: string): [string, string] {
  const [name, sep, value] = partition(text, "=");
  if (!sep || !strip(name) || !strip(value) || strip(value).includes(" ")) {
    throw `${repr(text)} must be MEMBER=VALUE, such as web=opencode or web=high`;
  }
  return [strip(name), strip(value)];
}

function overridesOf(args: Values): Overrides {
  const pairs = (key: string) => new Map((args[key] as [string, string][] | undefined) ?? []);
  return { agent: pairs("agent"), model: pairs("model"), effort: pairs("effort") };
}

const OVERRIDES: Option[] = [
  {
    name: "--agent",
    dest: "agent",
    metavar: "MEMBER=AGENT",
    repeat: true,
    parse: memberValue,
    help:
      `run MEMBER on AGENT (${AGENT_NAMES}) instead of its roster agent, for this run only. ` +
      "Its roster model then no longer applies",
    defaultHelp: "the member's agent, then defaults.agent, then claude",
  },
  {
    name: "--model",
    dest: "model",
    metavar: "MEMBER=MODEL",
    repeat: true,
    parse: memberValue,
    help: "run MEMBER on MODEL, which must be valid for its agent, for this run only",
    defaultHelp: "the member's model, then defaults.models.<agent>, then the agent's own default",
  },
  {
    name: "--effort",
    dest: "effort",
    metavar: "MEMBER=LEVEL",
    repeat: true,
    parse: memberValue,
    help: `run MEMBER at effort LEVEL (${LEVEL_NAMES}), which its agent and model must support, for this run only`,
    defaultHelp: "the member's effort, then defaults.effort, then the agent's own default",
  },
];

const MEMBER: Option = {
  name: "--member",
  dest: "member",
  metavar: "NAME",
  help: "only this member, by its name in roster.json",
  defaultHelp: "every member",
};

const WORKSPACE = { dest: "workspace", metavar: "WORKSPACE", help: "the squad's root directory, which holds roster.json" };

const DEFAULT_EXITS = "0 when it did what was asked; 1 when the roster has problems or a step failed (the output says why); 2 on wrong usage.";

// --------------------------------------------------------------------------- commands

/** Validate; print NOTE and PROBLEM lines, or OK and one MEMBER and TAB line each. Exit 1 on problems. */
function checked(args: Values) {
  const workspace = path.resolve(args.workspace as string);
  const roster = loadRoster(workspace);
  const [problems, notes, members] = rosterProblems(workspace, roster, overridesOf(args));
  report(notes, problems);
  if (problems.length || !members) throw new Exit(1);
  if (!peersInstalled()) print(`NOTE the peers CLI is not installed; build installs it with ${peersInstaller()}`);
  print(`OK ${members.length} members in ${workspace}`);
  for (const e of members) print(`MEMBER ${e.name}${shown(e)}: ${describe(e)}`);
  for (const line of layoutLines(planLayout(members), new Map(members.map((m) => [m.name, m])))) print(line);
  return { workspace, roster, members };
}

const CHECK: Command = {
  name: "check",
  summary: "Validate roster.json and every member's files; write nothing.",
  description: `
Use it after writing roster.json and the member files, and again after every fix, until it
prints OK. Validates each member's agent (${AGENT_NAMES}), model and effort: the model must
have the agent's form, and for opencode, agy and pi it must be one that \`opencode models\`,
\`agy models\` or \`pi --list-models\` lists (a NOTE says when the CLI is missing); the effort
(${LEVEL_NAMES}) must be
one the agent and model support (opencode: the model's variants in \`opencode api model.list\`).
A defaults.effort a member cannot use moves to its nearest level, with a NOTE.

--agent, --model and --effort check a launch override before you launch. Validates the
layout too (see \`${PROG} --help\`): every member in exactly one tab, the supervisor in tab 1.`,
  positionals: [WORKSPACE],
  options: OVERRIDES,
  output: `
On success: NOTE lines, if any, then \`OK <n> members in <workspace>\`, one \`MEMBER <name>
(<display name>): agent ..., model ..., effort ...\` line per member, saying where each value
came from (the display name shows only when the roster sets one), and one \`TAB <n> '<display
name>': <member>\` line per member, in tab order.

On problems: one \`PROBLEM <what>\` line per issue: a \`layout: ...\` fault, a bad name, display
name, agent, model, effort, cwd or skill entry, a link to an unknown member, a report chain
that never reaches "user", a missing or empty member file, a COMMUNICATIONS.md that never
names a linked member, or a hand-written CLAUDE.md or AGENTS.md. Writes nothing.`,
  exitCodes: "0 when the roster is valid; 1 when it printed PROBLEM lines or roster.json is missing or not valid JSON; 2 on wrong usage.",
  examples: [
    `${RUN} check ~/squads/shop`,
    `${RUN} check ~/squads/shop --agent web=agy --model web=gemini-3.8-flash`,
    `${RUN} check ~/squads/shop --effort lead=max`,
  ],
  run: (args) => {
    checked(args);
    return 0;
  },
};

const ASSEMBLE: Command = {
  name: "assemble",
  summary: "Check, then write each member's instruction file and .peers.json.",
  description: `
Use it after roster.json changes (a summary, reports_to, agent, model, effort or display
name), since every member's squad directory shows them. Writes CLAUDE.md (claude) or
AGENTS.md (opencode, agy, pi), which references the member's four files by path and lists the
squad with each member's display name, agent, model and effort, and .peers.json, which
records the member's role, display name, agent, model and effort. Installs nothing.`,
  positionals: [WORKSPACE],
  options: [MEMBER],
  output: "The check's lines, then one `ASSEMBLED <member> (<agent>): wrote <file> and <.peers.json>` line per member.",
  exitCodes: DEFAULT_EXITS,
  examples: [`${RUN} assemble ~/squads/shop`, `${RUN} assemble ~/squads/shop --member api`],
  run: (args) => {
    const { workspace, roster, members } = checked(args);
    for (const m of selected(members, args.member as string | null)) {
      print(
        `ASSEMBLED ${m.name} (${m.agent}): wrote ${writeInstructions(workspace, roster, members, m)} ` +
          `and ${writeIdentity(workspace, roster, m)}`,
      );
    }
    return 0;
  },
};

const BUILD: Command = {
  name: "build",
  summary: "Check and assemble, install the peers CLI when it is missing, then install skills and configure each member.",
  description: `
Use it once check prints OK, and again after a member's skills, agent, model or effort
change (with --member). Safe to run again: it rewrites the generated files and reinstalls
the skills.

First installs the peers CLI when no peers binary is on PATH or in ~/.local/bin (or
PEERS_INSTALL_DIR), with its install script, ${PEERS_INSTALLER}. PEERS_INSTALLER_URL names
another script. A private repository needs GITHUB_TOKEN or a signed-in gh; the token is sent
only to raw.githubusercontent.com.

For each member: writes its instruction file and .peers.json, installs peers and its roster
skills into its cwd with \`npx -y skills@latest add\` for its agent, and applies the agent's own
setup: the peers channel for claude (.mcp.json, approved in .claude/settings.local.json), and
for pi a check that the installed peers CLI writes the peers extension for pi
(peers pi-extension --path), which launch loads. It never writes a model or effort into an opencode
member's opencode.json. Needs npx (Node.js).`,
  positionals: [WORKSPACE],
  options: [MEMBER],
  output: `
The check's lines, an \`INSTALLED peers <version> at <path>\` line when it installed the CLI
(ending in a WARNING when that directory is not on PATH), then one \`BUILT <member> (<agent>):
...\` line per member. A failed install prints the exact command and its output.`,
  exitCodes: "0 when every member was built; 1 when the roster has problems or an install failed (the output gives the command and its output); 2 on wrong usage.",
  examples: [`${RUN} build ~/squads/shop`, `${RUN} build ~/squads/shop --member web`],
  run: async (args) => {
    const { workspace, roster, members } = checked(args);
    const peersSource = peersSourceOf(roster, DEFAULT_PEERS);
    const installed = await installPeers();
    if (installed) print(installed);
    for (const m of selected(members, args.member as string | null)) {
      print(`BUILT ${m.name} (${m.agent}): ` + buildMember(workspace, roster, members, m, peersSource).join("; "));
    }
    return 0;
  },
};

const LAUNCH: Command = {
  name: "launch",
  summary: "Start the built squad in herdr, one workspace with a tab per member, each member on its agent, model and effort.",
  description: `
Use it only when the user asks to start the squad: run it with --dry-run first, then
without. Validates everything first and launches nothing on a problem: the roster, every
member's agent, model and effort, each agent's command on PATH, a running herdr session,
that each member is built, and the layout (see \`${PROG} --help\`). A full launch also refuses
when the session already holds the squad's workspace; with --member, a member that still
has a pane there is refused.

Then it creates the squad's one herdr workspace, squad-<squad>, with one tab per member in
hierarchy order, the supervisor first. Each tab holds one pane that fills it, so the agent's
dialogs are read at full size. It starts each member with its agent's own command, model and
effort: claude --model --effort, agy --model --effort, pi --model --thinking (with --approve
and the peers extension, -e), and for opencode, whose TUI takes
neither flag, OpenCode's API: it creates the member's session, opens the TUI on it with
--session, sets the model with the effort as its variant (session.switchModel), and confirms
it with session.get before the first prompt (needs OpenCode's background service; an
opencode member without a model starts plain, on its opencode.json or /models). It answers
the folder-trust, channel and one-time notice prompts it knows, and gives each its first
prompt; a prompt it does not know stops the launch with the screen. Every member runs with
--dangerously-skip-permissions. Launch does not watch the members afterwards: their replies
reach the lead through peers.

--member NAME starts one member into the squad's existing workspace, in a new tab. herdr adds
a tab last, so every running member that comes after it in the plan is moved (not restarted)
into a new tab behind it, which keeps the tabs in hierarchy order. Without the workspace, it
creates it.

--agent, --model and --effort override the roster for this launch: a member whose agent,
model or effort differs from its last build is rebuilt or reconfigured first, and every
member's squad directory is rewritten to match. The next build or assemble goes back to
roster.json; edit roster.json to keep a change.`,
  positionals: [WORKSPACE],
  options: [
    MEMBER,
    ...OVERRIDES,
    {
      name: "--session",
      dest: "session",
      metavar: "NAME",
      help: "the herdr session to launch in",
      defaultHelp: "herdr's default session",
    },
    {
      name: "--dry-run",
      dest: "dryRun",
      flag: true,
      help: "validate and print the herdr commands (RUN lines), but start and change nothing",
    },
  ],
  output: `
The check's MEMBER and TAB lines (\`OK <n> of <m> members, herdr session <s>\` first), then one
\`LAUNCHED <member> (<agent>, model <model>, effort <level>) in herdr session <s>, tab <n>
'<label>', pane <id>\` line per member, with the display name after the member name when the
roster sets one, and a \`MOVED <member>\` line for each running member moved behind a new tab.
Tab and pane are labelled with the display name, or the member name. With --dry-run: RUN
lines with the commands it would run, and WOULD LAUNCH, WOULD MOVE, WOULD REBUILD and WOULD
SET lines.

On problems: PROBLEM lines, then \`Nothing was launched.\` On a failure it stops with a FAILED
line naming the member and pane, lists the members already running and the panes of those
that did not start, whose tabs to close before launching each with --member.`,
  exitCodes: "0 when every member started (or the dry run passed); 1 on PROBLEM lines or a FAILED line; 2 on wrong usage.",
  examples: [
    `${RUN} launch ~/squads/shop --dry-run`,
    `${RUN} launch ~/squads/shop`,
    `${RUN} launch ~/squads/shop --effort lead=max --effort web=low`,
    `${RUN} launch ~/squads/shop --member web --session work`,
  ],
  run: (args) => {
    cmdLaunch(
      {
        workspace: path.resolve(args.workspace as string),
        member: args.member as string | null,
        session: args.session as string | null,
        dryRun: Boolean(args.dryRun),
        overrides: overridesOf(args),
      },
      DEFAULT_PEERS,
    );
    return 0;
  },
};

export const COMMANDS = [CHECK, ASSEMBLE, BUILD, LAUNCH];

const DESCRIPTION = `
Check, build and launch a squad of peer agents from <workspace>/roster.json. The workspace
holds roster.json and one directory per member, each with the member's PROJECT.md, ROLE.md,
COMMUNICATIONS.md and MEMORY.md. Each member runs one agent (${AGENT_NAMES}) with one
model and one effort level. Use it to validate a squad design, to write each member's
instruction file and install its skills, and to start the squad in herdr. Run
\`${PROG} <command> --help\` (or \`${PROG} help <command>\`) for the details of one command.`;

const FOOTER = `
typical workflow (the order the skill runs the commands):
  1. check <workspace>             validate; fix every PROBLEM and run it again
  2. build <workspace>             write each member's files and install its skills
  3. launch <workspace> --dry-run  preview the herdr commands
  4. launch <workspace>            start the squad in herdr
  Run each as \`${RUN} <command> ...\`, from this skill's directory. After
  roster.json changes: assemble <workspace>, or build <workspace> --member NAME.

files:
  reads   <workspace>/roster.json, and PROJECT.md, ROLE.md, COMMUNICATIONS.md and
          MEMORY.md in each member's <workspace>/<cwd>/
  writes  assemble, build and launch: each member's CLAUDE.md or AGENTS.md, and its
          .peers.json. build: its skills (.claude/skills/, or .agents/skills/ for
          opencode, agy and pi), for
          claude its .mcp.json and .claude/settings.local.json, and the peers CLI in
          ~/.local/bin when it is missing. check writes nothing.

member names:
  Each member has a member name ("name": kebab-case, also its cwd, and what reports_to,
  talks_to, --member and its peers role use) and may have a human-readable
  "display_name" (1-48 characters on one line, unique in the squad, such as "Rina").
  Write it without the role: peers adds the member name as the role, so receivers see
  "Rina (api)", and "Rina (backend)" would show it twice. Without a display name, the
  member name is shown. The display name appears in each member's instruction file and
  squad directory, in .peers.json (peers sends it with every message), in check's
  MEMBER lines, and at launch as the herdr pane label and the session's title.

agent, model and effort, highest precedence first:
  agent:  --agent MEMBER=AGENT (check, launch), the member's "agent", the roster's
          "defaults": {"agent": ...}, then claude.
  model:  --model MEMBER=MODEL (check, launch), the member's "model" (only while the
          member runs the agent it was written for), the roster's
          "defaults": {"models": {"<agent>": ...}}, then no model at all: the agent
          starts with its own default model.
  effort: --effort MEMBER=LEVEL (check, launch), the member's "effort", the roster's
          "defaults": {"effort": ...}, then no level at all: the agent uses its own
          default effort for the model.

  How launch applies them: claude --model and --effort; agy --model and --effort;
  pi --model and --thinking;
  opencode, whose TUI takes neither flag, through OpenCode's API: launch creates the
  member's session (session.create), opens the TUI on it (--session), sets the model
  with the effort as its variant (session.switchModel), reads the session back to
  confirm, and only then sends the first prompt. An opencode member without a model
  starts plain and uses its own opencode.json or /models; ${PROG} never writes
  opencode.json.

effort levels:
  ${LEVEL_NAMES}. claude and pi take every level for every model (pi
  clamps it to what the model supports); opencode the
  model's variants that are levels (from \`opencode api model.list\`); agy the levels
  \`agy models\` lists for the model. opencode and agy need a model for an effort level,
  to check it. A level the member's own "effort" or --effort names that its agent and
  model do not support is an error. A level from defaults.effort moves to the nearest
  level the member supports (the lower one on a tie), or to none when it supports none;
  check prints a NOTE.

a mixed team in roster.json:
  A Claude lead on opus at high effort, an OpenCode member on beam-free at low effort,
  an OpenCode member on whatever its opencode.json or /models sets, an agy member on
  Gemini Flash at medium effort, and a pi member on Claude Opus at high thinking:
    "members": [
      {"name": "lead", "display_name": "Lena", "agent": "claude", "model": "opus",
       "effort": "high", ...},
      {"name": "api", "display_name": "Rina", "agent": "opencode",
       "model": "opencode/beam-free", "effort": "low", ...},
      {"name": "docs", "agent": "opencode", ...},
      {"name": "web", "agent": "agy", "model": "gemini-3.8-flash",
       "effort": "medium", ...},
      {"name": "review", "agent": "pi", "model": "anthropic/claude-opus-4-8",
       "effort": "high", ...}]

layout:
  The whole squad lives in one herdr workspace, squad-<squad>, with one tab per member.
  Each tab holds one pane that fills it, and both are labelled with the member's
  display name. The tabs follow the hierarchy: the supervisor, the member that reports
  to "user", first, then the others by steps of reports_to from "user", then in roster
  order. check and launch print one TAB line per member and validate the plan first:
  every member in exactly one tab, the supervisor in tab 1; a failed check is a
  \`PROBLEM layout: ...\` line.

examples:
  ${RUN} check ~/squads/shop
  ${RUN} build ~/squads/shop
  ${RUN} launch ~/squads/shop --dry-run
  ${RUN} launch ~/squads/shop --agent api=claude --model api=opus
  ${RUN} launch ~/squads/shop --effort lead=max --effort web=low

exit codes:
  0 on success, 1 when the roster has problems or a step fails (the output says why),
  2 on wrong usage.`;

export function top() {
  return topHelp(PROG, DESCRIPTION, COMMANDS, FOOTER);
}

// --------------------------------------------------------------------------- main

function wrongUsage(message: string, usage: string, command?: string) {
  const help = command ? `${PROG} ${command} --help` : `${PROG} --help`;
  io.err(`${usage}\n${PROG}${command ? " " + command : ""}: error: ${message}\nRun '${help}' for help.`);
  return 2;
}

function unknownCommand(name: string) {
  const choices = COMMANDS.map((item) => `'${item.name}'`).join(", ");
  const near = closest(name, COMMANDS.map((item) => item.name));
  return `invalid choice: '${name}' (choose from ${choices})${near ? `; did you mean '${near}'?` : ""}`;
}

export async function main(argv: string[]): Promise<number> {
  forgetLists();
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
    const asked = COMMANDS.find((command) => command.name === rest[0]);
    if (rest.length > 1 || (rest.length && !asked)) {
      return wrongUsage(rest.length > 1 ? `help takes one command, not ${rest.join(" ")}` : `argument COMMAND: ${unknownCommand(rest[0]!)}`, `usage: ${PROG} help [COMMAND]`);
    }
    print(asked ? commandHelp(PROG, asked) : top());
    return 0;
  }
  const command = COMMANDS.find((item) => item.name === name);
  if (!command) return wrongUsage(`argument COMMAND: ${unknownCommand(name)}`, topUsage(PROG));
  try {
    const args = parseCommand(PROG, command, rest);
    return await command.run(args);
  } catch (error) {
    if (error instanceof HelpRequested) {
      print(error.message);
      return 0;
    }
    if (error instanceof ArgumentError) return wrongUsage(error.message, error.usage, command.name);
    if (error instanceof Exit) return error.code;
    if (error instanceof Problem) {
      io.err(`roster: error: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && "code" in error && "syscall" in error) {
      // A file the roster names could not be read or written.
      io.err(`roster: error: ${reason(error)}; check the path and its permissions, then run the command again`);
      return 1;
    }
    throw error;
  }
}
