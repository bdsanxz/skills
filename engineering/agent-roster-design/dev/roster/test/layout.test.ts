// The squad layout: planLayout, layoutProblems and tabSteps.
// Builds squads of 1 to 12 members (a supervisor, leads under it, workers under the leads),
// plans each layout and checks that every member has exactly one tab, the supervisor's first,
// in hierarchy order; then the tab steps of a relaunch with --member; then that
// layoutProblems names each fault in a layout broken on purpose.

import { describe, expect, test } from "bun:test";
import { type Placed, type Tab, hierarchy, layoutLines, layoutProblems, planLayout, tabSteps } from "../src/layout";

/** A supervisor, then up to two leads under it, then workers split between the leads, workers first. */
function squad(n: number): Placed[] {
  const members: Placed[] = [{ name: "boss", reports_to: "user" }];
  const leads = Array.from({ length: Math.min(n - 1, 2) }, (_, i) => `lead-${i + 1}`);
  members.push(...leads.map((name) => ({ name, reports_to: "boss" })));
  const workers = n - members.length;
  for (let i = 0; i < workers; i++) members.push({ name: `worker-${i + 1}`, reports_to: leads[i % leads.length]! });
  // Roster order is not hierarchy order: put the workers first.
  return [...members.slice(leads.length + 1), ...members.slice(0, leads.length + 1)];
}

describe("plans for squads of 1 to 12 members", () => {
  for (let n = 1; n <= 12; n++) {
    test(`${n} member${n > 1 ? "s" : ""}`, () => {
      const members = squad(n);
      const tabs = planLayout(members);
      expect(layoutProblems(tabs, members)).toEqual([]);
      const placed = tabs.map((tab) => tab.member);
      expect([...placed].sort()).toEqual(members.map((m) => m.name).sort());
      expect(tabs.map((tab) => tab.number)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(placed[0]).toBe("boss");
      expect(placed).toEqual(hierarchy(members).map((m) => m.name));
      const lines = layoutLines(tabs, new Map(members.map((m) => [m.name, m])));
      expect(lines[0]).toBe("TAB 1 'boss': boss");
    });
  }
});

describe("tab steps", () => {
  const tabs = planLayout(squad(5));
  const order = tabs.map((tab) => tab.member);
  const at = (i: number) => tabs[i]!;

  test("a full launch opens every tab in order", () => {
    expect(tabSteps(tabs, new Set(), new Set(order))).toEqual(tabs.map((tab): ["open", Tab] => ["open", tab]));
  });

  test("relaunching the last member moves nobody", () => {
    expect(tabSteps(tabs, new Set(order.slice(0, -1)), new Set([order.at(-1)!]))).toEqual([["open", tabs.at(-1)!]]);
  });

  test("relaunching the supervisor moves the rest behind it", () => {
    expect(tabSteps(tabs, new Set(order.slice(1)), new Set(["boss"]))).toEqual([
      ["open", at(0)],
      ...tabs.slice(1).map((tab): ["move", Tab] => ["move", tab]),
    ]);
  });

  test("a gap is skipped, the members after the new tab move", () => {
    expect(tabSteps(tabs, new Set([order[0]!, order[3]!, order[4]!]), new Set([order[2]!]))).toEqual([
      ["open", at(2)],
      ["move", at(3)],
      ["move", at(4)],
    ]);
  });

  test("two relaunched members keep the order", () => {
    expect(tabSteps(tabs, new Set([order[0]!, order[2]!, order[4]!]), new Set([order[1]!, order[3]!]))).toEqual([
      ["open", at(1)],
      ["move", at(2)],
      ["open", at(3)],
      ["move", at(4)],
    ]);
  });
});

describe("faults layoutProblems names", () => {
  const members = squad(7);
  const good = () => planLayout(members).map((tab) => ({ ...tab }));
  const faults = (tabs: Tab[]) => layoutProblems(tabs, members).join(" | ");

  test("a member in two tabs", () => {
    expect(faults([...good(), { number: 8, member: "lead-1" }])).toContain("'lead-1' is in 2 tabs");
  });

  test("a member in no tab", () => {
    expect(faults(good().filter((tab) => tab.member !== "worker-4"))).toContain("'worker-4' is in 0 tabs");
  });

  test("a tab for a non-member", () => {
    expect(faults([...good(), { number: 8, member: "ghost" }])).toContain("places 'ghost', who is not a member");
  });

  test("a supervisor out of tab 1", () => {
    const broken = good();
    [broken[0]!.member, broken[1]!.member] = [broken[1]!.member, broken[0]!.member];
    expect(faults(broken)).toContain("the supervisor 'boss' is not in tab 1");
  });

  test("a broken report chain sorts last", () => {
    const looped: Placed[] = [
      { name: "a", reports_to: "b" },
      { name: "b", reports_to: "a" },
      { name: "boss", reports_to: "user" },
    ];
    expect(hierarchy(looped).map((m) => m.name)).toEqual(["boss", "a", "b"]);
  });
});
