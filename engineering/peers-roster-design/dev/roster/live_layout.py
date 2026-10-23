#!/usr/bin/env python3
"""Lays squads out in a real herdr session, with shells instead of agents, and measures them.

Usage: python3 live_layout.py [--session NAME] [--keep] [SIZE ...]

For each squad size (default: 3 5 7) it builds the squad's windows with
roster.py's own lay_out_window in one new workspace, reads every tab's pane
layout back from herdr, and checks: one workspace, one tab per planned window,
each pane where the plan puts it with about its planned share of the window,
and the supervisor's pane the largest. Then it closes the supervisor's pane and
a worker's, places them again the way `launch --member` does, and checks the
first window again. Starts no agent. Closes each workspace afterwards unless
--keep is given. Needs a running herdr session (default: herdr's default).
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


def measure(h, rdict, windows, by_name, ws, label):
    """Compare every tab of the workspace with the plan."""
    tabs = {t["label"]: t["tab_id"] for t in h.query("tab", "list", "--workspace", ws).get("tabs", [])}
    check(f"{label}: {len(windows)} tab(s), one per window",
          sorted(tabs) == sorted(roster.window_label(rdict, w["number"]) for w in windows), sorted(tabs))
    panes = h.query("pane", "list", "--workspace", ws).get("panes", [])
    areas = {}
    for w in windows:
        tab = tabs.get(roster.window_label(rdict, w["number"]))
        here = [p for p in panes if p.get("tab_id") == tab]
        if not here:
            check(f"{label}: window {w['number']} has panes", False)
            continue
        layout = h.query("pane", "layout", "--pane", here[0]["pane_id"]).get("layout", {})
        area = layout["area"]["width"] * layout["area"]["height"]
        rect = {p["pane_id"]: p["rect"] for p in layout["panes"]}
        named = {p.get("label"): p["pane_id"] for p in here}
        planned = roster.pane_areas(w)
        got = {n: rect[named[roster.display(by_name[n])]]["width"] * rect[named[roster.display(by_name[n])]]["height"]
               / area for n in planned if roster.display(by_name[n]) in named}
        check(f"{label}: window {w['number']} holds exactly its members",
              sorted(got) == sorted(planned) and len(here) == len(planned), f"{sorted(named)} vs {sorted(planned)}")
        # Cells are whole numbers and splits draw borders, so allow a few points.
        check(f"{label}: window {w['number']} sizes match the plan",
              all(abs(got[n] - planned[n]) < 0.05 for n in got),
              ", ".join(f"{n} {got[n]:.0%}/{planned[n]:.0%}" for n in got))
        for row_index, row in enumerate(w["rows"]):
            ys = {rect[named[roster.display(by_name[n])]]["y"] for n in row["members"] if roster.display(by_name[n]) in named}
            check(f"{label}: window {w['number']} row {row_index + 1} is one row", len(ys) == 1, ys)
        if w["number"] == 1:
            top = rect[named["boss"]]
            check(f"{label}: supervisor across the top", top["y"] == 0 and top["width"] == layout["area"]["width"], top)
        areas.update({n: a * 1 for n, a in got.items()})
    check(f"{label}: supervisor's pane is the largest",
          all(a < areas.get("boss", 0) for n, a in areas.items() if n != "boss"), areas)
    return panes


def run(h, n, keep):
    root = tempfile.mkdtemp(prefix=f"layout-{n}-")
    members = squad(n)
    for m in members:
        os.makedirs(os.path.join(root, m["cwd"]))
    rdict = {"squad": f"layout{n}"}
    by_name = {m["name"]: m for m in members}
    windows = roster.plan_layout(members)
    label = f"{n} members"
    check(f"{label}: plan is valid", not roster.layout_problems(windows, members))
    if any(w["workspace_id"] for w in h.query("workspace", "list").get("workspaces", [])
           if w.get("label") == roster.workspace_label(rdict)):
        check(f"{label}: no leftover workspace {roster.workspace_label(rdict)}", False)
        return
    ws, made = None, {}
    for w in windows:
        ws = roster.lay_out_window(h, rdict, root, w, by_name, ws, None, [], roster.window_members(w), made)
    found = [w for w in h.query("workspace", "list").get("workspaces", []) if w.get("label") == roster.workspace_label(rdict)]
    check(f"{label}: exactly one workspace", len(found) == 1, found)
    panes = measure(h, rdict, windows, by_name, ws, label)

    # Relaunch: the supervisor's pane and a worker's close, then each is placed again.
    gone = ["boss"] + [x for x in roster.window_members(windows[0]) if x.startswith("worker")][:1]
    for x in gone:
        h.run("pane", "close", made[x])
    for x in gone:
        ws_id, tabs, panes = roster.squad_state(h, rdict)
        w = next(w for w in windows if x in roster.window_members(w))
        # With its last pane closed, a workspace closes too; the member then gets a new one.
        ws = roster.lay_out_window(h, rdict, root, w, by_name, ws_id, tabs.get(roster.window_label(rdict, w["number"])),
                                   panes, [x], {})
    measure(h, rdict, windows, by_name, ws, f"{label} after relaunching {', '.join(gone)}")
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
