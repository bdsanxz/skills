// Launch: start the built squad in herdr, one workspace with a tab per member.

import {
  Exit,
  LaunchError,
  SCRIPT,
  display,
  fail,
  isFile,
  isObject,
  join,
  parseJsonFile,
  print,
  repr,
  shown,
  which,
} from "./core";
import { type Member, agent } from "./agents";
import { Herdr, herdrSession } from "./herdr";
import { type Pane, type Tab, layoutLines, moveToEnd, openTab, planLayout, squadState, tabSteps, workspaceLabel } from "./layout";
import { peersInstalled } from "./peers";
import {
  type Overrides,
  type Roster,
  buildMember,
  describe,
  identityPath,
  loadRoster,
  rosterProblems,
  selected,
  writeIdentity,
  writeInstructions,
} from "./roster";

export type LaunchArgs = {
  workspace: string;
  member: string | null;
  session: string | null;
  dryRun: boolean;
  overrides: Overrides;
};

/** Print NOTE (or WARNING) lines for the notes, then PROBLEM lines. */
export function report(notes: string[], problems: string[]) {
  for (const note of notes) print(note.startsWith("WARNING ") ? note : `NOTE ${note}`);
  for (const problem of problems) print(`PROBLEM ${problem}`);
}

export function peersSourceOf(roster: Roster, fallback: string) {
  const source = "peers_source" in roster ? (roster.peers_source as string) : fallback;
  if (source.startsWith("/") && !isFile(join(source, "SKILL.md"))) {
    fail(`no peers skill at ${source}; set "peers_source" in roster.json to its directory, package or URL`);
  }
  if (!which("npx")) fail("npx is not on PATH; install Node.js, which the skills CLI needs");
  return source;
}

function settingsChange(m: Member) {
  const spec = agent(m.agent);
  if (!spec.launchSettings) return `CLEAR ${m.name}'s model and effort: ${spec.label} manages them`;
  return `SET ${m.name}'s model to ${m.model || "the agent default"}, effort ${m.effort || "the agent default"}`;
}

/** The agent, model and effort the member was last built for, from its .peers.json. */
function builtFor(workspace: string, m: Member) {
  const file = identityPath(workspace, m);
  const built = isFile(file) ? parseJsonFile(file, `fix or remove it, then run \`bun ${SCRIPT} build\` again`) : {};
  if (!isObject(built)) fail(`${file} must hold a JSON object; remove it, then run \`bun ${SCRIPT} build\` again`);
  if (!("agent" in built) && isFile(join(workspace, m.cwd, agent(m.agent).instructions))) {
    built.agent = m.agent; // built before .peers.json recorded the agent
  }
  return built;
}

export function cmdLaunch(args: LaunchArgs, defaultPeers: string) {
  const workspace = args.workspace;
  const roster = loadRoster(workspace);
  const [problems, notes, members] = rosterProblems(workspace, roster, args.overrides, true);
  let session: string | null = null;
  let tabs: Tab[] = [];
  let state: [string | null, Pane[]] = [null, []];
  if (!peersInstalled()) {
    problems.push(`the peers CLI is not installed; run \`bun ${SCRIPT} build ${workspace}\` first, which installs it`);
  }
  if (members !== null) {
    const [found, why] = herdrSession(args.session);
    session = found;
    if (why) problems.push(why);
    tabs = planLayout(members);
  }
  if (session) state = squadState(new Herdr(session, true), roster);
  let ws = state[0];
  const rebuild: Member[] = [];
  const retune: Member[] = [];
  for (const m of members ? selected(members, args.member) : []) {
    const built = builtFor(workspace, m);
    if (!Object.keys(built).length) {
      problems.push(`member ${repr(m.name)} is not built; run \`bun ${SCRIPT} build ${workspace}\` first`);
    } else if (built.agent !== m.agent) rebuild.push(m);
    else if ((built.model ?? null) !== m.model || (built.effort ?? null) !== m.effort) retune.push(m);
    const held = state[1].filter((pane) => pane.label === display(m)).map((pane) => pane.pane_id);
    if (args.member && held.length) {
      problems.push(
        `member ${repr(m.name)} already has pane ${held[0]} in the squad's workspace ${ws}; stop its ` +
          `session and close the pane (\`herdr --session ${session} pane close ${held[0]}\`) first`,
      );
    }
  }
  if (ws && !args.member) {
    problems.push(
      `herdr session ${session} already holds the squad's workspace ${workspaceLabel(roster)} (${ws}); ` +
        `close it (\`herdr --session ${session} workspace close ${ws}\`) to start the whole squad again, ` +
        "or start single members into it with --member",
    );
  }
  report(notes, problems);
  if (problems.length || !members || !session) {
    print("Nothing was launched.");
    throw new Exit(1);
  }
  const targets = selected(members, args.member);
  const byName = new Map(members.map((m) => [m.name, m]));
  print(`OK ${targets.length} of ${members.length} members, herdr session ${session}`);
  for (const e of targets) print(`MEMBER ${e.name}${shown(e)}: ${describe(e)}`);
  for (const line of layoutLines(tabs, byName)) print(line);

  // The agent, model or effort differs from the last build: bring the member's files in line first.
  if (rebuild.length || retune.length) {
    if (args.dryRun) {
      for (const m of rebuild) print(`WOULD REBUILD ${m.name} for agent ${m.agent} (instruction file, skills, configuration)`);
      for (const m of retune) print(`WOULD ${settingsChange(m)}`);
    } else {
      const peersSource = rebuild.length ? peersSourceOf(roster, defaultPeers) : "";
      for (const m of rebuild) {
        print(`REBUILT ${m.name} (${m.agent}): ` + buildMember(workspace, roster, members, m, peersSource).join("; "));
      }
      for (const m of retune) {
        writeIdentity(workspace, roster, m);
        agent(m.agent).configure(workspace, join(workspace, m.cwd), m);
        print(settingsChange(m));
      }
      // Every squad directory shows each member's agent, model and effort.
      for (const m of members) writeInstructions(workspace, roster, members, m);
    }
  }

  const h = new Herdr(session, args.dryRun);
  const wanted = new Set(targets.map((m) => m.name));
  const running = new Map<string, string>();
  for (const name of byName.keys()) {
    for (const pane of state[1]) if (pane.label === display(byName.get(name)!)) running.set(name, pane.pane_id);
  }
  // [member, pane] of each member started; {member: pane} opened but not started; the member being worked on.
  const launched: [Member, string][] = [];
  const waiting = new Map<string, string>();
  let failed: [Member, string | null] | null = null;
  try {
    for (const [step, tab] of tabSteps(tabs, new Set(running.keys()), wanted)) {
      const n = tab.member;
      const m = byName.get(n)!;
      failed = [m, null];
      if (step === "move") {
        moveToEnd(h, m, running.get(n)!);
        print(
          `${args.dryRun ? "WOULD MOVE" : "MOVED"} ${n}${shown(m)} to a new last tab, ` +
            `keeping it running in pane ${running.get(n)}`,
        );
        continue;
      }
      let pane: string;
      [ws, pane] = openTab(h, roster, workspace, m, ws);
      waiting.set(n, pane);
      failed = [m, pane];
      const spec = agent(m.agent);
      spec.launch(h, m, pane, `${roster.squad}-${n}`, join(workspace, m.cwd));
      waiting.delete(n);
      launched.push([m, pane]);
      const settings = spec.launchSettings
        ? `model ${m.model || "the agent's own default"}, effort ${m.effort || "the agent's own default"}`
        : `model and effort managed by ${spec.label}`;
      print(
        `${args.dryRun ? "WOULD LAUNCH" : "LAUNCHED"} ${n}${shown(m)} (${m.agent}, ${settings}) ` +
          `in herdr session ${session}, tab ${tab.number} ${repr(display(m))}, pane ${pane}`,
      );
    }
  } catch (error) {
    if (!(error instanceof LaunchError) || !failed) throw error;
    const [m, pane] = failed;
    print(
      pane
        ? `FAILED ${m.name} (${m.agent}) in pane ${pane}: ${error.message}`
        : `FAILED opening or moving ${m.name}'s tab: ${error.message}`,
    );
    const started = new Set(launched.map(([x]) => x.name));
    const runningNow = launched.map(([x, p]) => `${x.name} (pane ${p})`).join(", ") || "none";
    const idle = [...waiting].map(([n, p]) => `${n} (pane ${p})`).join(", ");
    const close = [...waiting.values()].map((p) => `\`herdr --session ${session} pane close ${p}\``).join(" ");
    print(
      `Already running: ${runningNow}. Not started: ` +
        [...byName.keys()].filter((n) => wanted.has(n) && !started.has(n)).join(", ") +
        ". Fix the cause, " +
        (waiting.size ? `close the tabs of the members that did not start, ${idle} (${close}), then ` : "then ") +
        "launch each member that is not running with --member; it takes its place in the tab order.",
    );
    throw new Exit(1);
  }
  if (!args.dryRun) {
    print(
      "Find each member's address with `peers list --all-dirs`, " +
        "by its directory. The squad starts working when the lead receives a request through peers.",
    );
  }
}
