#!/usr/bin/env python3
"""Checks roster.py's squad layout: plan_layout, layout_problems and split_steps.

Usage: python3 layout.py [--show]

Builds squads of 1 to 12 members (a supervisor, leads under it, workers under
the leads), plans each layout and checks that every member is in exactly one
window, no window holds more than MEMBERS_PER_WINDOW members, the supervisor is
alone across the top of window 1 with the largest pane, the order follows the
hierarchy, and the split steps rebuild each window. Then it breaks the layout
and the settings on purpose and checks that layout_problems names each fault.
--show prints each squad's WINDOW lines and split steps. Changes nothing.
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


def simulate(window, steps):
    """Carry the split steps out on a unit square; return each member's area."""
    rects = {steps[0][0]: (0.0, 0.0, 1.0, 1.0)}
    for n, target, direction, ratio in steps[1:]:
        x, y, w, h = rects[target]
        if direction == "down":
            rects[target], rects[n] = (x, y, w, h * ratio), (x, y + h * ratio, w, h * (1 - ratio))
        else:
            rects[target], rects[n] = (x, y, w * ratio, h), (x + w * ratio, y, w * (1 - ratio), h)
    return {n: r[2] * r[3] for n, r in rects.items()}, rects


show = "--show" in sys.argv[1:]
for n in range(1, 13):
    members = squad(n)
    windows = roster.plan_layout(members)
    problems = roster.layout_problems(windows, members)
    label = f"{n} member{'s' if n > 1 else ''}"
    check(f"{label}: layout is valid", not problems, "; ".join(problems))
    placed = [x for w in windows for x in roster.window_members(w)]
    check(f"{label}: every member placed once", sorted(placed) == sorted(m["name"] for m in members), placed)
    check(f"{label}: no window over {roster.MEMBERS_PER_WINDOW}",
          all(len(roster.window_members(w)) <= roster.MEMBERS_PER_WINDOW for w in windows))
    want = -(-n // roster.MEMBERS_PER_WINDOW)
    check(f"{label}: {want} window{'s' if want > 1 else ''}", len(windows) == want, len(windows))
    check(f"{label}: supervisor alone on top of window 1", windows[0]["rows"][0]["members"] == ["boss"])
    order = [m["name"] for m in roster.hierarchy(members)]
    check(f"{label}: windows follow the hierarchy", placed == order, f"{placed} vs {order}")
    areas = {}
    for w in windows:
        steps = roster.split_steps(w, set(roster.window_members(w)))
        got, rects = simulate(w, steps)
        planned = roster.pane_areas(w)
        check(f"{label}: window {w['number']} split steps give the planned sizes",
              all(abs(got[x] - planned[x]) < 1e-3 for x in planned), f"{got} vs {planned}")
        areas.update(got)
        if show:
            for s in steps:
                print(f"     step {s}")
    check(f"{label}: supervisor's pane is the largest",
          all(a < areas["boss"] for x, a in areas.items() if x != "boss"), areas)
    if show:
        for line in roster.layout_lines({"squad": "demo"}, windows, {m["name"]: m for m in members}):
            print(f"     {line}")

# A window rebuilt for only some of its members still spans the window.
members = squad(5)
w = roster.plan_layout(members)[0]
steps = roster.split_steps(w, {"boss", "lead-2", "worker-2"})
got, _ = simulate(w, steps)
check("partial window fills the window", abs(sum(got.values()) - 1) < 1e-6 and set(got) == {"boss", "lead-2", "worker-2"}, got)
check("partial window keeps the supervisor on top", steps[0][0] == "boss" and got["boss"] > max(got["lead-2"], got["worker-2"]), got)

# Faults layout_problems must name.
members = squad(7)
good = roster.plan_layout(members)


def faults(windows):
    return " | ".join(roster.layout_problems(windows, members))


broken = copy.deepcopy(good)
broken[1]["rows"][0]["members"].append("lead-1")
check("a member in two windows is caught", "'lead-1' is in 2 windows" in faults(broken), faults(broken))
broken = copy.deepcopy(good)
broken[1]["rows"][0]["members"].remove("worker-4")
check("a member in no window is caught", "'worker-4' is in 0 windows" in faults(broken), faults(broken))
broken = copy.deepcopy(good)
broken[0]["rows"][1]["members"] += ["worker-3", "worker-4"]
broken[1]["rows"] = [r for r in broken[1]["rows"] if not set(r["members"]) <= {"worker-3", "worker-4"}]
check("a window over the limit is caught", "window 1 holds 7 members; at most 5 fit" in faults(broken), faults(broken))
broken = copy.deepcopy(good)
broken[0]["rows"][0]["members"], broken[0]["rows"][1]["members"][0] = ["lead-1"], "boss"
check("a supervisor off the top is caught", "not alone across the top of window 1" in faults(broken), faults(broken))
broken = copy.deepcopy(good)
broken[1]["rows"] = [{"share": 1.0, "members": ["worker-4"]}]
broken[0]["rows"][1]["members"].append("worker-3")
check("a pane larger than the supervisor's is caught", "does not have the largest pane: worker-4" in faults(broken),
      faults(broken))

for setting, value, words in (("MEMBERS_PER_WINDOW", 0, "MEMBERS_PER_WINDOW is 0"),
                              ("SUPERVISOR_SHARE", 1.5, "SUPERVISOR_SHARE is 1.5"),
                              ("MEMBERS_PER_ROW", 0, "MEMBERS_PER_ROW is 0"),
                              ("SUPERVISOR_SHARE", 0.3, "does not have the largest pane"),
                              ("MEMBERS_PER_WINDOW", 1, "does not have the largest pane")):
    old = getattr(roster, setting)
    setattr(roster, setting, value)
    got = faults(roster.plan_layout(members)) if words.startswith("does") else faults(good)
    setattr(roster, setting, old)
    check(f"{setting} = {value} is caught", words in got, got)

# The settings are central: another window size changes the plan, still valid.
roster.MEMBERS_PER_WINDOW = 3
members = squad(7)
windows = roster.plan_layout(members)
check("3 per window: valid", not roster.layout_problems(windows, members), roster.layout_problems(windows, members))
check("3 per window: 3 windows of at most 3", [len(roster.window_members(w)) for w in windows] == [3, 2, 2],
      [len(roster.window_members(w)) for w in windows])

print("all passed" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
