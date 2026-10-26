// Opens squads' tabs in a real herdr session, with shells instead of agents, and checks them.
// See HELP below, or run `bun live_layout.ts --help`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { display, repr } from "./src/core";
import { Herdr, herdrSession, list, text } from "./src/herdr";
import {
  type Placed,
  type Tab,
  layoutProblems,
  moveToEnd,
  openTab,
  planLayout,
  squadState,
  tabSteps,
  workspaceLabel,
} from "./src/layout";

type Member = Placed & { cwd: string };
type Squad = { squad: string };

const HELP = `Opens squads' tabs in a real herdr session, with shells instead of agents, and checks them.

Usage: bun live_layout.ts [--session NAME] [--keep] [SIZE ...]

For each squad size (default: 3 5 7) it opens the squad's tabs with the script's own
tabSteps, openTab and moveToEnd in one new workspace, reads the tabs and panes back from
herdr, and checks: one workspace, one tab per member in hierarchy order, each tab labelled
with its member and holding one pane with the same label. Then it closes the supervisor's
pane and a worker's, opens them again the way \`launch --member\` does, and checks again that
the tabs are in hierarchy order and that the running members kept their panes. Starts no
agent. Closes each workspace afterwards unless --keep is given. Needs a running herdr
session (default: herdr's default).`;

let fails = 0;

function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}` + (!ok && detail ? `: ${JSON.stringify(detail)}` : ""));
  if (!ok) fails++;
}

function squad(n: number): Member[] {
  const members: Member[] = [{ name: "boss", reports_to: "user", cwd: "boss" }];
  const leads = Array.from({ length: Math.min(n - 1, 2) }, (_, i) => `lead-${i + 1}`);
  members.push(...leads.map((name) => ({ name, reports_to: "boss", cwd: name })));
  const workers = n - members.length;
  for (let i = 0; i < workers; i++) {
    members.push({ name: `worker-${i + 1}`, reports_to: leads[i % leads.length]!, cwd: `worker-${i + 1}` });
  }
  return members;
}

/** Carry out launch's tab steps for the wanted members; return the workspace id. */
function place(h: Herdr, roster: Squad, root: string, tabs: Tab[], byName: Map<string, Member>, wanted: Set<string>) {
  let [ws, panes] = squadState(h, roster);
  const running = new Map<string, string>();
  for (const [name, member] of byName) {
    for (const pane of panes) if (pane.label === display(member)) running.set(name, pane.pane_id);
  }
  for (const [step, tab] of tabSteps(tabs, new Set(running.keys()), wanted)) {
    const member = byName.get(tab.member)!;
    if (step === "move") moveToEnd(h, member, running.get(member.name)!);
    else [ws] = openTab(h, roster, root, member, ws);
  }
  return ws!;
}

/** Compare the workspace's tabs and panes with the plan; return {member label: pane id}. */
function measure(h: Herdr, tabs: Tab[], byName: Map<string, Member>, ws: string, label: string) {
  const got = list(h.query(["tab", "list", "--workspace", ws]), "tabs").sort(
    (a, b) => Number(a.number) - Number(b.number),
  );
  const want = tabs.map((tab) => display(byName.get(tab.member)!));
  const labels = got.map((tab) => text(tab, "label"));
  check(`${label}: one tab per member, in hierarchy order`, JSON.stringify(labels) === JSON.stringify(want), { labels, want });
  const panes = list(h.query(["pane", "list", "--workspace", ws]), "panes");
  for (const tab of got) {
    const here = panes.filter((pane) => pane.tab_id === tab.tab_id);
    check(
      `${label}: tab ${repr(text(tab, "label"))} holds one pane with its label`,
      here.length === 1 && here[0]!.label === tab.label,
      here,
    );
  }
  return new Map(panes.map((pane) => [text(pane, "label"), text(pane, "pane_id")]));
}

function run(h: Herdr, n: number, keep: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `layout-${n}-`));
  const members = squad(n);
  for (const member of members) fs.mkdirSync(path.join(root, member.cwd));
  const roster = { squad: `layout${n}` };
  const byName = new Map(members.map((member) => [member.name, member]));
  const tabs = planLayout(members);
  const label = `${n} members`;
  check(`${label}: plan is valid`, !layoutProblems(tabs, members).length);
  if (squadState(h, roster)[0]) {
    check(`${label}: no leftover workspace ${workspaceLabel(roster)}`, false);
    return;
  }
  let ws = place(h, roster, root, tabs, byName, new Set(byName.keys()));
  const found = list(h.query(["workspace", "list"]), "workspaces").filter((w) => w.label === workspaceLabel(roster));
  check(`${label}: exactly one workspace`, found.length === 1, found);
  const before = measure(h, tabs, byName, ws, label);

  // Relaunch: the supervisor's pane and a worker's close, then both are opened again.
  const gone = ["boss", ...members.filter((member) => member.name.startsWith("worker")).map((member) => member.name).slice(0, 1)];
  for (const name of gone) h.run(["pane", "close", before.get(name)!]);
  ws = place(h, roster, root, tabs, byName, new Set(gone));
  const after = measure(h, tabs, byName, ws, `${label} after relaunching ${gone.join(", ")}`);
  const kept = [...byName.keys()].filter((name) => !gone.includes(name));
  check(
    `${label}: running members kept their panes`,
    kept.every((name) => after.get(name) === before.get(name)),
    Object.fromEntries(kept.map((name) => [name, [before.get(name), after.get(name)]])),
  );
  if (keep) console.log(`     kept workspace ${ws} (${workspaceLabel(roster)})`);
  else h.run(["workspace", "close", ws]);
}

function main(argv: string[]) {
  const sizes: number[] = [];
  let session: string | null = null;
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      return 0;
    }
    if (arg === "--keep") keep = true;
    else if (arg === "--session" && argv[i + 1]) session = argv[++i]!;
    else if (/^\d+$/.test(arg)) sizes.push(Number(arg));
    else {
      console.error(`live_layout: error: unexpected argument '${arg}'\nRun 'bun live_layout.ts --help' for usage.`);
      return 2;
    }
  }
  const [found, why] = herdrSession(session);
  if (why || !found) {
    console.error(`live_layout: ${why}`);
    return 1;
  }
  const h = new Herdr(found, false);
  for (const n of sizes.length ? sizes : [3, 5, 7]) run(h, n, keep);
  console.log(fails ? `${fails} failed` : "all passed");
  return fails ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
