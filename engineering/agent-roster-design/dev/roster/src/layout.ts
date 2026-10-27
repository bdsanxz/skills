// Layout. planLayout() decides where every member goes; launch only carries the plan out.
// Change the layout here, and only here.
//
// The whole squad lives in one herdr workspace. Each member has a tab of its own, holding one
// pane that fills it; tab and pane are labelled with the member's display name. The tabs
// follow the hierarchy: the supervisor, the member that reports to "user", first, then the
// others by how many steps of reports_to separate them from "user", then by their order in
// roster.json.

import { LaunchError, type Named, display, join, repr } from "./core";
import { Herdr, field, list, text } from "./herdr";

export type Placed = Named & { reports_to: string };
export type Tab = { number: number; member: string };
export type Step = ["open" | "move", Tab];

export function workspaceLabel(roster: Record<string, unknown>) {
  return `squad-${roster.squad}`;
}

/** The members in hierarchy order: by their distance from "user" along reports_to, then roster order. */
export function hierarchy<T extends Placed>(members: T[]): T[] {
  const boss = new Map(members.map((member) => [member.name, member.reports_to]));
  const depth = (name: string, seen: string[] = []): number => {
    const above = boss.get(name)!;
    if (above === "user") return 0;
    if (!boss.has(above) || seen.includes(above)) return boss.size; // a broken chain, which check reports; it sorts last
    return 1 + depth(above, [...seen, name]);
  };
  return members
    .map((member, index) => ({ member, index, depth: depth(member.name) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ member }) => member);
}

/** The squad's tabs, in order. */
export function planLayout(members: Placed[]): Tab[] {
  return hierarchy(members).map((member, index) => ({ number: index + 1, member: member.name }));
}

/** What is wrong with a layout: each member in exactly one tab, the supervisor in the first. */
export function layoutProblems(tabs: Tab[], members: Placed[]) {
  const problems: string[] = [];
  if (!members.length) return problems;
  const placed = new Map<string, number[]>();
  for (const tab of tabs) {
    if (!placed.has(tab.member)) placed.set(tab.member, []);
    placed.get(tab.member)!.push(tab.number);
  }
  for (const member of members) {
    const where = placed.get(member.name) ?? [];
    placed.delete(member.name);
    if (where.length !== 1) {
      problems.push(
        `member ${repr(member.name)} is in ${where.length} tabs (${where.join(", ") || "none"}); it must be in exactly one`,
      );
    }
  }
  for (const name of placed.keys()) problems.push(`the layout places ${repr(name)}, who is not a member`);
  const supervisor = hierarchy(members)[0]!.name;
  if (!tabs.length || tabs[0]!.member !== supervisor) problems.push(`the supervisor ${repr(supervisor)} is not in tab 1`);
  return problems;
}

/** What launch does to the tabs, in order: "open" for each wanted member that does not run, and
 * "move" for each running member after the first tab opened, since herdr adds a tab last. */
export function tabSteps(tabs: Tab[], running: Set<string>, wanted: Set<string>): Step[] {
  const steps: Step[] = [];
  let opened = false;
  for (const tab of tabs) {
    if (running.has(tab.member)) {
      if (opened) steps.push(["move", tab]);
    } else if (wanted.has(tab.member)) {
      steps.push(["open", tab]);
      opened = true;
    }
  }
  return steps;
}

/** One TAB line per member's tab, in order. */
export function layoutLines(tabs: Tab[], byName: Map<string, Named>) {
  return tabs.map((tab) => `TAB ${tab.number} ${repr(display(byName.get(tab.member)!))}: ${tab.member}`);
}

export type Pane = { pane_id: string; label: string; tab_id: string };

/** The squad's workspace in herdr, if it exists: [workspace id or null, its panes]. */
export function squadState(h: Herdr, roster: Record<string, unknown>): [string | null, Pane[]] {
  const found = list(h.query(["workspace", "list"]), "workspaces").filter(
    (workspace) => workspace.label === workspaceLabel(roster),
  );
  if (!found.length) return [null, []];
  const ws = text(found[0], "workspace_id");
  const panes = list(h.query(["pane", "list", "--workspace", ws]), "panes").map((pane) => ({
    pane_id: text(pane, "pane_id"),
    label: text(pane, "label"),
    tab_id: text(pane, "tab_id"),
  }));
  return [ws, panes];
}

/** Open the member's own tab, last in the squad's workspace, which it creates when ws is null.
 *
 * Returns [workspace id, pane id]: the tab's one pane, in the member's cwd. */
export function openTab(
  h: Herdr,
  roster: Record<string, unknown>,
  workspace: string,
  member: Named & { cwd: string },
  ws: string | null,
): [string, string] {
  const cwd = join(workspace, member.cwd);
  const label = display(member);
  let pane: string;
  if (ws === null) {
    const made = h.created(["workspace", "create", "--cwd", cwd, "--label", workspaceLabel(roster), "--no-focus"]);
    pane = paneOf(made, "workspace create");
    ws = text(field(made, "workspace"), "workspace_id") || pane.split(":")[0]!;
    h.run(["tab", "rename", text(field(made, "tab"), "tab_id") || `${ws}:t1`, label]);
  } else {
    pane = paneOf(
      h.created(["tab", "create", "--workspace", ws, "--cwd", cwd, "--label", label, "--no-focus"]),
      "tab create",
    );
  }
  h.run(["pane", "rename", pane, label]); // --member finds a running member by its pane's label
  return [ws, pane];
}

function paneOf(made: Record<string, unknown>, what: string) {
  const pane = text(field(made, "root_pane"), "pane_id");
  if (!pane) throw new LaunchError(`\`herdr ${what}\` reported no root pane`);
  return pane;
}

/** Move a running member's pane into a new last tab, without restarting it; herdr closes the emptied tab. */
export function moveToEnd(h: Herdr, member: Named, pane: string) {
  const made = h.created(["pane", "move", pane, "--new-tab", "--no-focus"]);
  const tab = text(field(field(made, "move_result"), "created_tab"), "tab_id");
  if (!tab) throw new LaunchError(`\`herdr pane move ${pane} --new-tab\` reported no new tab for ${member.name}`);
  h.run(["tab", "rename", tab, display(member)]);
}
