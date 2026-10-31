// Bounded readiness waits: a status-less `hc wait` finishes in about the settle
// window instead of 90 s, a stub that reports status still returns via the short
// wait, a late dialog is still answered, the cap bounds a changing screen, a
// vanished terminal raises the existing LaunchError, and dry runs stay instant.
// Run: bun test (in dev/roster)

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { AGENTS } from "../src/agents";
import { pollScreen, waitConfig } from "../src/wait";
import { type Squad, clear, member, read, roster, setRoster, setUp, tearDown } from "./harness";

setDefaultTimeout(120000);

let s: Squad;

beforeAll(async () => {
  s = setUp();
  member(s, "lead", "Report to user. Talk to review and docs.");
  member(s, "review", "Report to lead.");
  member(s, "docs", "Report to lead.");
  setRoster(s, {
    squad: "demo",
    goal: "Ship it.",
    members: [
      { name: "lead", cwd: "lead", summary: "Leads", reports_to: "user", talks_to: ["review", "docs"] },
      { name: "review", cwd: "review", summary: "Reviews", reports_to: "lead", agent: "qoder", model: "Qwen3.8-Flash", effort: "high" },
      { name: "docs", cwd: "docs", summary: "Writes", reports_to: "lead", agent: "agy", model: "gem-fast" },
    ],
  });
  const done = await roster(["build", s.w]);
  if (done.code !== 0) throw new Error(`setup build failed:\n${done.out}`);
});

afterAll(() => tearDown(s));

/** herdr-core launch env: the old server is stopped, a live core has no terminals. */
const hcEnv = (extra: Record<string, string | undefined> = {}) => ({
  HERDR_SESSIONS: '{"sessions":[{"name":"default","default":true,"running":false}]}',
  HC_LS_CODE: "0",
  HC_JSON: JSON.stringify({ terminals: [] }),
  HCAPP_JSON: JSON.stringify({ spaces: [{ id: "sp-test", name: "squad-demo" }] }),
  ...extra,
});

/** Fast waits for the poll tests; the stub answers instantly, so only the poll itself takes time. */
const fastPoll = () => ({
  ROSTER_SETTLE_MS: "200",
  ROSTER_POLL_MS: "25",
  ROSTER_QODER_INTERVAL_MS: "20",
  QODER_CONFIG_DIR: path.join(s.tmp, "qoder-wait-empty"),
});

describe("bounded readiness waits", () => {
  test("status-less terminals settle in about the settle window, not 90 s", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const start = Date.now();
    const done = await roster(
      ["launch", s.w, "--member", "review"],
      hcEnv({ HC_WAIT: "timeout", HC_READ_TEXT: "qoder 1.1.81 ready", ROSTER_QODER_WAIT_MS: "300", ...fastPoll() }),
    );
    const elapsed = Date.now() - start;
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED review (qoder");
    expect(read(s.hcLog)).toContain("wait t-test2 --timeout 10");
    expect(read(s.hcLog)).not.toContain("--timeout 90");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(15000);
  });

  test("a stub that reports status still returns via the short wait", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(["launch", s.w, "--member", "docs"], hcEnv());
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED docs (agy");
    expect(read(s.hcLog)).toContain("wait t-test2 --timeout 10");
    expect(read(s.hcLog)).not.toContain("--timeout 90");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
  });

  test("a dialog appearing late is still answered", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "review"],
      hcEnv({ HC_DIALOG_LATE: "1", HC_DIALOG_AFTER: "4", HC_WAIT: "timeout", ROSTER_QODER_WAIT_MS: "300", ...fastPoll() }),
    );
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED review (qoder");
    expect(read(s.hcLog)).toContain("keys t-test2 enter");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
  });

  test("the cap is honoured when the screen keeps changing", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const start = Date.now();
    const done = await roster(
      ["launch", s.w, "--member", "docs"],
      hcEnv({ HC_WAIT: "timeout", HC_CHANGING: "1", ROSTER_WAIT_MS: "600", ...fastPoll() }),
    );
    const elapsed = Date.now() - start;
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED docs (agy");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
    expect(elapsed).toBeLessThan(15000);
  });

  test("a vanished terminal raises the existing LaunchError", async () => {
    clear(s.hcLog);
    const gone = await roster(["launch", s.w, "--member", "docs"], hcEnv({ HC_WAIT: "gone" }));
    expect(gone.code).toBe(1);
    expect(gone.out).toContain("FAILED docs (agy)");
    expect(gone.out).toContain("terminal t-test2 is gone while waiting for it");
    const readGone = await roster(
      ["launch", s.w, "--member", "docs"],
      hcEnv({ HC_WAIT: "timeout", HC_READ_GONE: "1", ...fastPoll() }),
    );
    expect(readGone.code).toBe(1);
    expect(readGone.out).toContain("terminal t-test2 is gone while waiting for it");
  });

  test("dry run is instant and prints the short wait", async () => {
    const start = Date.now();
    const dry = await roster(["launch", s.w, "--dry-run", "--member", "review"], hcEnv());
    const elapsed = Date.now() - start;
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("RUN hc wait");
    expect(dry.out).toContain("--timeout 10");
    expect(dry.out).not.toContain("--timeout 90");
    expect(dry.out).toContain("WOULD LAUNCH review (qoder");
    expect(elapsed).toBeLessThan(5000);
  });

  test("the old-herdr agent wait uses the short timeout", async () => {
    clear(s.herdrLog);
    const dry = await roster(["launch", s.w, "--dry-run", "--member", "docs"]);
    expect(dry.out).toContain("agent wait demo-docs --until idle --until blocked --timeout 10000");
    const done = await roster(["launch", s.w, "--member", "docs"]);
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED docs (agy");
    expect(read(s.herdrLog)).toContain("agent wait demo-docs --until idle --until blocked --timeout 10000");
    expect(read(s.herdrLog)).not.toContain("--timeout 90000");
  });
});

describe("wait timings", () => {
  test("defaults and environment overrides", () => {
    const cfg = waitConfig();
    expect(cfg.waitMs).toBe(90000);
    expect(cfg.shortMs).toBe(10000);
    expect(cfg.settleMs).toBe(3000);
    expect(cfg.pollMs).toBe(1000);
  });

  test("invalid timings fall back to the defaults", async () => {
    const done = await roster(["launch", s.w, "--dry-run", "--member", "docs"], {
      ROSTER_SHORT_WAIT_MS: "soon",
      ROSTER_WAIT_MS: "-5",
    });
    expect(done.code).toBe(0);
    expect(done.out).toContain("--timeout 10000");
  });

  test("qoder is the only agent with a verified ready marker", () => {
    expect(AGENTS.qoder!.ready).toBe("type your message");
    for (const name of ["claude", "opencode", "agy", "pi", "muse"]) {
      expect(AGENTS[name]!.ready).toBeUndefined();
    }
  });

  test("the poll stops on dialog, ready, stable, cap and gone", () => {
    const stop = (
      screens: ({ gone: boolean; text: string } | string)[],
      ready?: string,
      cfg = { waitMs: 1000, shortMs: 0, settleMs: 0, pollMs: 0 },
    ) => {
      let at = 0;
      return pollScreen(
        () => {
          const next = screens[Math.min(at++, screens.length - 1)]!;
          return typeof next === "string" ? { gone: false, text: next } : next;
        },
        [["do you trust the files in this folder", ["enter"]]],
        ready,
        cfg,
        Date.now() + cfg.waitMs,
      );
    };
    const slow = { waitMs: 1000, shortMs: 0, settleMs: 60000, pollMs: 0 };
    expect(stop(["booting", "Do you trust the files in this folder?"], undefined, slow)).toBe("dialog");
    expect(stop(["booting", "ready > type your message"], "type your message", slow)).toBe("ready");
    expect(stop(["output"])).toBe("stable");
    expect(stop(["a", "b", "c", "d"], undefined, { waitMs: 50, shortMs: 0, settleMs: 60000, pollMs: 0 })).toBe("capped");
    expect(stop([{ gone: true, text: "" }])).toBe("gone");
    expect(stop(["", "", ""], undefined, { waitMs: 50, shortMs: 0, settleMs: 0, pollMs: 0 })).toBe("capped");
  });
});

describe("folder-trust dialogs on herdr-core", () => {
  test("claude's trust dialog is answered with down+enter before the first prompt", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "lead"],
      hcEnv({ HC_READ_TEXT: "Quick safety check ... Yes, I trust this folder" }),
    );
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED lead (claude");
    expect(read(s.hcLog)).toContain("keys t-test2 down enter");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
  });

  test("agy's trust dialog is answered with enter before the first prompt", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "docs"],
      hcEnv({ HC_READ_TEXT: "Do you trust the contents of this project? Yes, I trust this folder" }),
    );
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED docs (agy");
    expect(read(s.hcLog)).toContain("keys t-test2 enter");
    expect(read(s.hcLog)).not.toContain("down enter");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
  });

  test("qoder's trust dialog is answered with enter before the first prompt", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "review"],
      hcEnv({ HC_READ_TEXT: "Do you trust the files in this folder? > Trust folder", ROSTER_QODER_WAIT_MS: "300" }),
    );
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED review (qoder");
    expect(read(s.hcLog)).toContain("keys t-test2 enter");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
  });

  test("no dialog means no keys, just the first prompt", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "lead"],
      hcEnv({ HC_READ_TEXT: "Welcome back" }),
    );
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED lead (claude");
    expect(read(s.hcLog)).not.toContain("keys t-test2");
    expect(read(s.hcxLog)).toContain("send t-test2 Read your instructions");
  });

  test("a send refused by a late dialog retries after answering it", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "docs"],
      hcEnv({ HC_SEND_BLOCKED: "1", HCX_FAIL: "1", HC_WAIT: "timeout", ...fastPoll() }),
    );
    expect(done.code).toBe(0);
    expect(done.out).toContain("LAUNCHED docs (agy");
    expect(read(s.hcLog)).toContain("keys t-test2 enter");
    expect(read(s.hcLog)).toContain("send t-test2 Read your instructions");
  });

  test("a send blocked by an unknown dialog still fails with hc's message", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    const done = await roster(
      ["launch", s.w, "--member", "docs"],
      hcEnv({ HC_SEND_BLOCKED_UNKNOWN: "1", HCX_FAIL: "1", HC_WAIT: "timeout", ...fastPoll() }),
    );
    expect(done.code).toBe(1);
    expect(done.out).toContain("FAILED docs (agy)");
    expect(done.out).toMatch(/exit 9|blocked/i);
    expect(read(s.hcLog)).not.toContain("keys t-test2");
  });
});
