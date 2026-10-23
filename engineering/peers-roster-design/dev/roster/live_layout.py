#!/usr/bin/env python3
"""Opens squads' tabs in a real herdr session, with shells instead of agents, and checks them.

Usage: python3 live_layout.py [--session NAME] [--keep] [SIZE ...]

For each squad size (default: 3 5 7) it opens the squad's tabs with roster.py's
own tab_steps, open_tab and move_to_end in one new workspace, reads the tabs
and panes back from herdr, and checks: one workspace, one tab per member in
hierarchy order, each tab labelled with its member and holding one pane with
the same label. Then it closes the supervisor's pane and a worker's, opens
them again the way `launch --member` does, and checks again that the tabs are
in hierarchy order and that the running members kept their panes. Starts no
agent. Closes each workspace afterwards unless --keep is given. Needs a
running herdr session (default: herdr's default).
"""
import argparse
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
import roster  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    print(f"{'ok  ' if ok else 'FAIL'} {name}" + (f": {detail}" if not ok and detail else ""))
    fails += 0 if ok else 1


def squad(n):
    members = [{"name": "boss", "reports_to": "user", "cwd": "boss"}]
    leads = [f"lead-{i}" for i in range(1, min(n - 1, 2) + 1)]
    members += [{"name": x, "reports_to": "boss", "cwd": x} for x in leads]
    for i in range(n - len(members)):
        members.append({"name": f"worker-{i + 1}", "reports_to": leads[i % len(leads)], "cwd": f"worker-{i + 1}"})
    return members


def place(h, rdict, root, tabs, by_name, wanted):
    """Carry out launch's tab steps for the wanted members; return the workspace id."""
    ws, panes = roster.squad_state(h, rdict)
    running = {n: p["pane_id"] for n in by_name for p in panes if p.get("label") == roster.display(by_name[n])}
    for step, t in roster.tab_steps(tabs, running, wanted):
        m = by_name[t["member"]]
        if step == "move":
            roster.move_to_end(h, m, running[m["name"]])
        else:
            ws, _ = roster.open_tab(h, rdict, root, m, ws)
    return ws


def measure(h, rdict, tabs, by_name, ws, label):
    """Compare the workspace's tabs and panes with the plan; return {member: pane id}."""
    got = sorted(h.query("tab", "list", "--workspace", ws).get("tabs", []), key=lambda t: t["number"])
    want = [roster.display(by_name[t["member"]]) for t in tabs]
    check(f"{label}: one tab per member, in hierarchy order", [t.get("label") for t in got] == want,
          f"{[t.get('label') for t in got]} vs {want}")
    panes = h.query("pane", "list", "--workspace", ws).get("panes", [])
    for t in got:
        here = [p for p in panes if p.get("tab_id") == t["tab_id"]]
        check(f"{label}: tab {t.get('label')!r} holds one pane with its label",
              len(here) == 1 and here[0].get("label") == t.get("label"), here)
    return {p.get("label"): p["pane_id"] for p in panes}


def run(h, n, keep):
    root = tempfile.mkdtemp(prefix=f"layout-{n}-")
    members = squad(n)
    for m in members:
        os.makedirs(os.path.join(root, m["cwd"]))
    rdict = {"squad": f"layout{n}"}
    by_name = {m["name"]: m for m in members}
    tabs = roster.plan_layout(members)
    label = f"{n} members"
    check(f"{label}: plan is valid", not roster.layout_problems(tabs, members))
    if roster.squad_state(h, rdict)[0]:
        check(f"{label}: no leftover workspace {roster.workspace_label(rdict)}", False)
        return
    ws = place(h, rdict, root, tabs, by_name, set(by_name))
    found = [w for w in h.query("workspace", "list").get("workspaces", []) if w.get("label") == roster.workspace_label(rdict)]
    check(f"{label}: exactly one workspace", len(found) == 1, found)
    before = measure(h, rdict, tabs, by_name, ws, label)

    # Relaunch: the supervisor's pane and a worker's close, then both are opened again.
    gone = ["boss"] + [m["name"] for m in members if m["name"].startswith("worker")][:1]
    for x in gone:
        h.run("pane", "close", before[x])
    ws = place(h, rdict, root, tabs, by_name, set(gone))
    after = measure(h, rdict, tabs, by_name, ws, f"{label} after relaunching {', '.join(gone)}")
    kept = [x for x in by_name if x not in gone]
    check(f"{label}: running members kept their panes", all(after.get(x) == before[x] for x in kept),
          {x: (before[x], after.get(x)) for x in kept})
    if keep:
        print(f"     kept workspace {ws} ({roster.workspace_label(rdict)})")
    else:
        h.run("workspace", "close", ws)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("sizes", nargs="*", type=int, default=[3, 5, 7])
    p.add_argument("--session", default=None)
    p.add_argument("--keep", action="store_true", help="leave each workspace open to look at")
    args = p.parse_args()
    session, why = roster.herdr_session(args.session)
    if why:
        sys.exit(f"live_layout: {why}")
    h = roster.Herdr(session, False)
    for n in args.sizes:
        run(h, n, args.keep)
    print("all passed" if not fails else f"{fails} failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
