import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactedText, continueText, onGoalEvent } from "../src/goals.ts";
import { Store, type Goal } from "../src/store.ts";

let store: Store;
const goal = (over: Partial<Goal> = {}): Goal => {
  const g: Goal = { id: "g1", provider: "claude", session_id: "s1", cwd: "/", objective: "make the tests pass", status: "active", turns: 0, max_turns: 3, compactions: -1, created_at: 1, updated_at: 1, note: "", ...over };
  store.insertGoal(g);
  return g;
};

beforeEach(() => {
  store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "agent-job-goal-")));
});

describe("goal events", () => {
  test("a turn end continues an active goal and counts the continuation", () => {
    goal();
    const text = onGoalEvent(store, "claude:s1", "turn-end")!;
    expect(text).toContain("make the tests pass");
    expect(text).toContain("continuation 1 of 3");
    expect(text).toContain("goal done g1");
    expect(store.goal("g1")!.turns).toBe(1);
  });

  test("a session without an active goal gets nothing", () => {
    expect(onGoalEvent(store, "claude:s1", "turn-end")).toBeNull();
    goal({ status: "done" });
    expect(onGoalEvent(store, "claude:s1", "turn-end")).toBeNull();
    expect(onGoalEvent(store, "claude:other", "turn-end")).toBeNull();
  });

  test("a goal without a limit keeps continuing", () => {
    goal({ max_turns: 0 });
    for (let i = 1; i <= 40; i++) expect(onGoalEvent(store, "claude:s1", "turn-end")).toContain(`continuation ${i})`);
    expect(store.activeGoal("claude", "s1")?.status).toBe("active");
  });

  test("the goal ends after max-turns continuations tells the agent once and then lets the session stop", () => {
    goal({ max_turns: 2 });
    expect(onGoalEvent(store, "claude:s1", "turn-end")).not.toBeNull();
    expect(onGoalEvent(store, "claude:s1", "turn-end")).not.toBeNull();
    expect(onGoalEvent(store, "claude:s1", "turn-end")).toContain("stopped after 2 continuations");
    expect(onGoalEvent(store, "claude:s1", "turn-end")).toBeNull();
    const g = store.goal("g1")!;
    expect(g.status).toBe("ended");
    expect(g.note).toContain("2 continuations");
  });

  test("compaction restates the goal without counting a continuation", () => {
    goal({ turns: 2 });
    const text = onGoalEvent(store, "claude:s1", "compacted")!;
    expect(text).toContain("context was compacted");
    expect(text).toContain("make the tests pass");
    expect(store.goal("g1")!.turns).toBe(2);
  });

  test("only one goal per session is active", () => {
    goal();
    expect(store.activeGoal("claude", "s1")!.id).toBe("g1");
    expect(store.activeGoal("claude", "s2")).toBeNull();
  });

  test("texts name the objective and both ways to close", () => {
    const g = goal();
    for (const t of [continueText({ ...g, turns: 1 }), compactedText(g)]) {
      expect(t).toContain("goal done g1");
      expect(t).toContain("goal blocked g1");
    }
  });
});

describe("goals of a runtime without a hook", () => {
  const { goalTick, newState } = require("../src/daemon.ts") as typeof import("../src/daemon.ts");
  const make = (polls: { cursor: string | null; turnEnds: number; compacted: boolean }[], sent: string[]) => {
    let i = 0;
    return {
      adapters: {
        claude: {
          provider: "claude", mode: "push" as const,
          liveness: () => ({ state: "live" as const, detail: "" }),
          deliver: (_s: Store, _id: string, _r: string, text: string) => (sent.push(text), { ok: true, detail: "" }),
          poll: () => polls[Math.min(i++, polls.length - 1)] ?? null,
        },
      },
      now: () => 10_000 * (i + 1),
      graceMs: 0,
    };
  };

  test("a successful turn end sends the continuation; no turn end sends nothing", () => {
    goal();
    const sent: string[] = [];
    const deps = make([{ cursor: "m1", turnEnds: 0, compacted: false }, { cursor: "m2", turnEnds: 1, compacted: false }], sent);
    const st = newState();
    goalTick(store, deps, st);
    expect(sent).toHaveLength(0);
    st.lastGoalPoll = 0;
    goalTick(store, deps, st);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("continuation 1 of 3");
    expect(st.cursors.get("g1")).toBe("m2");
  });

  test("a turn end that followed a compaction restates the goal", () => {
    goal();
    const sent: string[] = [];
    goalTick(store, make([{ cursor: "m9", turnEnds: 1, compacted: true }], sent), newState());
    expect(sent[0]).toContain("context was compacted");
  });

  test("a paused goal keeps its cursor current, so a turn that ended meanwhile is not owed on resume", () => {
    goal();
    store.updateGoal("g1", { status: "paused" });
    const sent: string[] = [];
    const deps = make([{ cursor: "m5", turnEnds: 1, compacted: false }, { cursor: "m5", turnEnds: 0, compacted: false }], sent);
    const st = newState();
    goalTick(store, deps, st);
    expect(sent).toHaveLength(0);
    expect(st.cursors.get("g1")).toBe("m5");
    store.updateGoal("g1", { status: "active" });
    st.lastGoalPoll = 0;
    goalTick(store, deps, st);
    expect(sent).toHaveLength(0);
  });

  test("a compaction read in one poll is restated at the turn end read in the next", () => {
    goal();
    const sent: string[] = [];
    const deps = make([{ cursor: "m1", turnEnds: 0, compacted: true }, { cursor: "m2", turnEnds: 1, compacted: false }, { cursor: "m3", turnEnds: 1, compacted: false }], sent);
    const st = newState();
    for (let n = 0; n < 3; n++) {
      st.lastGoalPoll = 0;
      goalTick(store, deps, st);
    }
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("context was compacted");
    expect(sent[1]).toContain("Condition not met yet");
  });
});
