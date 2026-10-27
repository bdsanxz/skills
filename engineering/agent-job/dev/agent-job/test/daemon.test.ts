import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { flush } from "../src/watch.ts";
import { formatMessage, newState, tick, type Deps } from "../src/daemon.ts";
import type { Adapter, Liveness } from "../src/providers.ts";
import { Store, type Cron } from "../src/store.ts";

let store: Store;
let clock: number;
let live: Liveness;
let sent: { id: string; text: string }[];

const adapter = (mode: "push" | "watch"): Adapter => ({
  provider: "fake",
  mode,
  liveness: () => live,
  deliver: (s, id, rid, text) => {
    sent.push({ id, text });
    if (mode === "watch") s.enqueue(`fake:${id}`, rid, text);
    return { ok: true, detail: "fake" };
  },
});

const deps = (mode: "push" | "watch" = "push"): Deps => ({ adapters: { fake: adapter(mode) }, now: () => clock, graceMs: 30_000 });

function cron(over: Partial<Cron> = {}): Cron {
  const r: Cron = {
    id: "r1", name: "", provider: "fake", session_id: "s1", cwd: "/", prompt: "check the build",
    kind: "every", expr: "60000", status: "active", created_at: clock, next_run: clock + 60_000,
    last_run: null, last_result: "", runs: 0, max_runs: null, expires_at: null, end_reason: "", ...over,
  };
  store.insert(r);
  return r;
}

beforeEach(() => {
  store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "agent-job-test-")));
  clock = 1_800_000_000_000;
  live = { state: "live", detail: "test" };
  sent = [];
});

describe("tick", () => {
  test("sends a due cron to a live session and schedules the next run", () => {
    cron();
    const st = newState();
    clock += 59_000;
    tick(store, deps(), st);
    expect(sent).toHaveLength(0);
    clock += 1_000;
    tick(store, deps(), st);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("check the build");
    const r = store.get("r1")!;
    expect(r.runs).toBe(1);
    expect(r.next_run).toBe(clock + 60_000);
  });

  test("never sends into a gone session, and ends the cron after the grace period", () => {
    cron({ next_run: clock + 1000 });
    live = { state: "dead", detail: "window closed" };
    const st = newState();
    clock += 2_000;
    tick(store, deps(), st);
    expect(sent).toHaveLength(0);
    expect(store.get("r1")!.status).toBe("active"); // inside the grace period
    clock += 31_000;
    tick(store, deps(), st);
    const r = store.get("r1")!;
    expect(sent).toHaveLength(0);
    expect(r.status).toBe("ended");
    expect(r.end_reason).toContain("window closed");
  });

  test("a session that comes back within the grace period keeps its cron", () => {
    cron({ next_run: clock + 1000 });
    const st = newState();
    live = { state: "dead", detail: "watch restarting" };
    clock += 2_000;
    tick(store, deps(), st);
    live = { state: "live", detail: "back" };
    clock += 5_000;
    tick(store, deps(), st);
    expect(sent).toHaveLength(1);
    expect(store.get("r1")!.status).toBe("active");
  });

  test("an idle sweep ends crons of a gone session before they are due", () => {
    cron({ next_run: clock + 3_600_000 });
    live = { state: "dead", detail: "gone" };
    const st = newState();
    clock += 61_000;
    tick(store, deps(), st);
    clock += 61_000;
    tick(store, deps(), st);
    expect(store.get("r1")!.status).toBe("ended");
  });

  test("unknown liveness sends nothing and does not end the cron", () => {
    cron({ next_run: clock + 1000 });
    live = { state: "unknown", detail: "tool missing" };
    clock += 2_000;
    tick(store, deps(), newState());
    expect(sent).toHaveLength(0);
    const r = store.get("r1")!;
    expect(r.status).toBe("active");
    expect(r.last_result).toContain("not sent");
  });

  test("a one-shot finishes, max-runs finishes, expiry finishes", () => {
    cron({ id: "once", kind: "at", expr: String(clock + 1000), next_run: clock + 1000 });
    cron({ id: "twice", max_runs: 2, next_run: clock + 1000 });
    cron({ id: "exp", expires_at: clock + 500, next_run: clock + 100_000 });
    const st = newState();
    clock += 1_000;
    tick(store, deps(), st);
    expect(store.get("once")!.status).toBe("done");
    expect(store.get("exp")!.status).toBe("done");
    clock += 60_000;
    tick(store, deps(), st);
    expect(store.get("twice")!.status).toBe("done");
    expect(store.get("twice")!.runs).toBe(2);
  });

  test("a recurring run missed while the daemon was down is skipped, not replayed", () => {
    cron({ next_run: clock + 1000 });
    clock += 600_000;
    tick(store, deps(), newState());
    expect(sent).toHaveLength(0);
    const r = store.get("r1")!;
    expect(r.last_result).toContain("skipped");
    expect(r.next_run!).toBeGreaterThan(clock);
  });

  test("a late one-shot is still sent", () => {
    cron({ kind: "at", expr: String(clock + 1000), next_run: clock + 1000 });
    clock += 600_000;
    tick(store, deps(), newState());
    expect(sent[0]!.text).toBe("check the build");
  });

  test("a finished one-shot keeps its queued line for the watch", () => {
    cron({ kind: "at", expr: String(clock + 1000), next_run: clock + 1000 });
    clock += 1_000;
    tick(store, deps("watch"), newState());
    expect(store.get("r1")!.status).toBe("done");
    expect(sent).toHaveLength(1);
    expect(store.pending("fake:s1")).toHaveLength(1);
  });

  test("a watch session gets one-line text through the outbox", () => {
    cron({ prompt: "line one\nline two", next_run: clock + 1000 });
    clock += 1_000;
    tick(store, deps("watch"), newState());
    const printed: string[] = [];
    store.enqueue("fake:s1", "r1", "a\nb");
    flush(store, "fake:s1", (l) => printed.push(l));
    expect(printed).toHaveLength(2);
    expect(printed[0]).toBe("line one ⏎ line two");
    expect(printed[1]).toBe("a ⏎ b");
    expect(store.pending("fake:s1")).toHaveLength(0);
  });
});

describe("message", () => {
  test("is the prompt as written, folded to one line for a watch only", () => {
    const r = cron({ name: "n", prompt: "a\n\nb" });
    expect(formatMessage(r, true)).toBe("a ⏎ b");
    expect(formatMessage(r, false)).toBe("a\n\nb");
  });
});

describe("goals and a gone session", () => {
  test("an active and a paused goal both end with the session after the grace period", () => {
    for (const [id, status] of [["g1", "active"], ["g2", "paused"]] as const) {
      store.insertGoal({ id, provider: "fake", session_id: "s1", cwd: "/", objective: "x", status, turns: 0, max_turns: 3, compactions: -1, created_at: clock, updated_at: clock, note: "" });
    }
    live = { state: "dead", detail: "gone" };
    const st = newState();
    st.lastSweep = clock - 61_000;
    tick(store, deps(), st);
    expect(store.goal("g1")!.status).toBe("active"); // inside the grace period
    clock += 31_000;
    st.lastSweep = clock - 61_000;
    tick(store, deps(), st);
    expect(store.goal("g1")!.status).toBe("ended");
    expect(store.goal("g2")!.status).toBe("ended");
    expect(store.goal("g2")!.note).toContain("session ended");
  });
});
