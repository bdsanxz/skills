#!/usr/bin/env python3
"""Checks roster.py's squad layout: plan_layout, layout_problems and tab_steps.

Usage: python3 layout.py [--show]

Builds squads of 1 to 12 members (a supervisor, leads under it, workers under
the leads), plans each layout and checks that every member has exactly one
tab, the supervisor's first, in hierarchy order. Then it checks the tab steps
of a relaunch with --member: the new tab opens, and every running member after
it moves behind it. Last, it breaks the layout on purpose and checks that
layout_problems names each fault. --show prints each squad's TAB lines.
Changes nothing.
"""
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
import roster  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    print(f"{'ok  ' if ok else 'FAIL'} {name}" + (f": {detail}" if not ok and detail else ""))
    fails += 0 if ok else 1


def squad(n):
    """A supervisor, then up to two leads under it, then workers split between the leads."""
    members = [{"name": "boss", "reports_to": "user"}]
    leads = [f"lead-{i}" for i in range(1, min(n - 1, 2) + 1)]
    members += [{"name": x, "reports_to": "boss"} for x in leads]
    for i in range(n - len(members)):
        members.append({"name": f"worker-{i + 1}", "reports_to": leads[i % len(leads)]})
    # Roster order is not hierarchy order: put the workers first.
    return members[len(leads) + 1:] + members[:len(leads) + 1]


show = "--show" in sys.argv[1:]
for n in range(1, 13):
    members = squad(n)
    tabs = roster.plan_layout(members)
    problems = roster.layout_problems(tabs, members)
    label = f"{n} member{'s' if n > 1 else ''}"
    check(f"{label}: layout is valid", not problems, "; ".join(problems))
    placed = [t["member"] for t in tabs]
    check(f"{label}: one tab per member", sorted(placed) == sorted(m["name"] for m in members), placed)
    check(f"{label}: tabs numbered 1 to {n}", [t["number"] for t in tabs] == list(range(1, n + 1)))
    check(f"{label}: the supervisor's tab first", placed[0] == "boss", placed)
    order = [m["name"] for m in roster.hierarchy(members)]
    check(f"{label}: tabs follow the hierarchy", placed == order, f"{placed} vs {order}")
    if show:
        for line in roster.layout_lines({"squad": "demo"}, tabs, {m["name"]: m for m in members}):
            print(f"     {line}")

# Tab steps: a full launch opens every tab in order and moves nothing.
members = squad(5)
tabs = roster.plan_layout(members)
order = [t["member"] for t in tabs]
steps = roster.tab_steps(tabs, set(), set(order))
check("full launch opens every tab in order", steps == [("open", t) for t in tabs], steps)

# Relaunching the last member opens its tab and moves nobody.
steps = roster.tab_steps(tabs, set(order[:-1]), {order[-1]})
check("relaunching the last member moves nobody", steps == [("open", tabs[-1])], steps)

# Relaunching the supervisor moves every running member behind its new tab, in order.
steps = roster.tab_steps(tabs, set(order[1:]), {"boss"})
check("relaunching the supervisor moves the rest behind it",
      steps == [("open", tabs[0])] + [("move", t) for t in tabs[1:]], steps)

# A member that neither runs nor is wanted is skipped; the members after a new tab still move.
steps = roster.tab_steps(tabs, {order[0], order[3], order[4]}, {order[2]})
check("a gap is skipped, the members after the new tab move",
      steps == [("open", tabs[2]), ("move", tabs[3]), ("move", tabs[4])], steps)

# Relaunching two members opens both and moves only the running members after the first.
steps = roster.tab_steps(tabs, {order[0], order[2], order[4]}, {order[1], order[3]})
check("two relaunched members keep the order",
      steps == [("open", tabs[1]), ("move", tabs[2]), ("open", tabs[3]), ("move", tabs[4])], steps)

# Faults layout_problems must name.
members = squad(7)
good = roster.plan_layout(members)


def faults(tabs):
    return " | ".join(roster.layout_problems(tabs, members))


broken = copy.deepcopy(good) + [{"number": 8, "member": "lead-1"}]
check("a member in two tabs is caught", "'lead-1' is in 2 tabs" in faults(broken), faults(broken))
broken = [t for t in copy.deepcopy(good) if t["member"] != "worker-4"]
check("a member in no tab is caught", "'worker-4' is in 0 tabs" in faults(broken), faults(broken))
broken = copy.deepcopy(good) + [{"number": 8, "member": "ghost"}]
check("a tab for a non-member is caught", "places 'ghost', who is not a member" in faults(broken), faults(broken))
broken = copy.deepcopy(good)
broken[0]["member"], broken[1]["member"] = broken[1]["member"], broken[0]["member"]
check("a supervisor out of tab 1 is caught", "the supervisor 'boss' is not in tab 1" in faults(broken), faults(broken))

print("all passed" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
