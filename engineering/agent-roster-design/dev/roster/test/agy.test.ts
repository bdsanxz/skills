// agy members: the launch records their conversation id by polling
// conversation_summaries.db for a row newer than the launch start, the same
// treatment qoder session files get. Its own squad, so the shared smoke suite
// is untouched.
// Run: bun test (in dev/roster)

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { findAgySessionSince, findSession, sessionLive, waitForAgySession } from "../src/sessions";
import { type Squad, member, read, roster, setRoster, setUp, tearDown } from "./harness";

setDefaultTimeout(120000);

let s: Squad;

beforeAll(() => {
  s = setUp();
  member(s, "lead", "Report to user. Talk to review.");
  member(s, "review", "Report to lead.");
});
afterAll(() => tearDown(s));

function team(review: Record<string, unknown>) {
  setRoster(s, {
    squad: "demo",
    goal: "Ship it.",
    members: [
      { name: "lead", cwd: "lead", summary: "Leads", reports_to: "user", talks_to: ["review"] },
      { name: "review", cwd: "review", summary: "Reviews", reports_to: "lead", agent: "agy", ...review },
    ],
  });
}

type AgyRow = { id: string; dir: string; lastInput: number };

function dbPath(home: string) {
  return path.join(home, "conversation_summaries.db");
}

/** Create the agy database at home with these rows (empty table when none). */
function writeAgyDb(home: string, rows: AgyRow[]) {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const db = new Database(dbPath(home));
  db.run(
    "CREATE TABLE IF NOT EXISTS conversation_summaries " +
      "(conversation_id TEXT, workspace_uris TEXT, last_user_input_time INTEGER)",
  );
  db.run("DELETE FROM conversation_summaries");
  const insert = db.query(
    "INSERT INTO conversation_summaries (conversation_id, workspace_uris, last_user_input_time) VALUES (?, ?, ?)",
  );
  for (const r of rows) insert.run(r.id, JSON.stringify([`file://${r.dir}`]), r.lastInput);
  db.close();
}

/** Run fn with AGY_HOME pointing at home. */
function withAgyHome<T>(home: string, fn: () => T): T {
  const before = process.env.AGY_HOME;
  process.env.AGY_HOME = home;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.AGY_HOME;
    else process.env.AGY_HOME = before;
  }
}

/** A bun script that inserts one conversation row with the insert-time clock. */
function inserter(home: string): string {
  const file = path.join(home, "insert-agy-row.ts");
  fs.writeFileSync(
    file,
    "import { Database } from \"bun:sqlite\";\n" +
      "const [dbFile, convId, uris] = Bun.argv.slice(2);\n" +
      "const db = new Database(dbFile as string);\n" +
      "db.run(\n" +
      "  \"INSERT INTO conversation_summaries (conversation_id, workspace_uris, last_user_input_time) VALUES (?, ?, ?)\",\n" +
      "  [convId as string, uris as string, Date.now()],\n" +
      ");\n" +
      "db.close();\n",
  );
  return file;
}

describe("agy members", () => {
  test("agy since-lookup only takes rows at or after the launch start", () => {
    const home = path.join(s.tmp, "agysince");
    const cwd = path.join(s.w, "review");
    const oldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const newId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const now = Date.now();
    withAgyHome(home, () => {
      writeAgyDb(home, [
        { id: oldId, dir: fs.realpathSync(cwd), lastInput: now - 60000 },
        { id: newId, dir: fs.realpathSync(cwd), lastInput: now },
      ]);
      const since = now - 5000;
      if (findAgySessionSince(cwd, since) !== newId) throw new Error("wanted only the new row");
      if (findAgySessionSince(cwd, now + 60000) !== null) throw new Error("future start must match nothing");
      if (findAgySessionSince(path.join(s.tmp, "elsewhere"), since) !== null) {
        throw new Error("wrong cwd must not match");
      }
      if (waitForAgySession(cwd, since, { timeoutMs: 0, intervalMs: 0 }) !== newId) {
        throw new Error("zero-wait lookup must find the new row");
      }
      if (waitForAgySession(cwd, now + 60000, { timeoutMs: 0, intervalMs: 0 }) !== null) {
        throw new Error("zero-wait lookup must ignore older rows");
      }
      if (findSession("agy", cwd) !== newId) throw new Error("findSession must still see the newest row");
      if (sessionLive("agy", newId) !== null) throw new Error("agy liveness is unknown");
    });
  });

  test("launch records an agy conversation row that appears after the first prompt", async () => {
    team({ model: "gem-flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "agy-wait-home");
    const cwd = path.join(s.w, "review");
    writeAgyDb(home, []);
    const id = "33333333-3333-4333-8333-333333333333";
    const uris = JSON.stringify([`file://${fs.realpathSync(cwd)}`]);
    const ins = inserter(home);
    const proc = Bun.spawn(["bash", "-c", `sleep 0.3; bun "${ins}" "${dbPath(home)}" "${id}" '${uris}'`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const done = await roster(["launch", s.w, "--member", "review"], {
      AGY_HOME: home,
      ROSTER_QODER_WAIT_MS: "5000",
      ROSTER_QODER_INTERVAL_MS: "50",
    });
    await proc.exited;
    expect(done.code).toBe(0);
    expect(done.out).toContain(`RECORDED review: session agy:${id} in roster.json`);
    const saved = JSON.parse(read(path.join(s.w, "roster.json"))) as {
      members: { name: string; session?: unknown }[];
    };
    expect(saved.members.find((m) => m.name === "review")?.session).toEqual({ runtime: "agy", id });
  });

  test("launch notes when no agy conversation appears and records nothing", async () => {
    team({ model: "gem-flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "agy-timeout-home");
    writeAgyDb(home, []);
    const done = await roster(["launch", s.w, "--member", "review"], {
      AGY_HOME: home,
      ROSTER_QODER_WAIT_MS: "300",
      ROSTER_QODER_INTERVAL_MS: "20",
    });
    expect(done.code).toBe(0);
    expect(done.out).toContain("NOTE member 'review': agy session id could not be recorded");
    expect(done.out).not.toContain("RECORDED review");
    const saved = JSON.parse(read(path.join(s.w, "roster.json"))) as {
      members: { name: string; session?: unknown }[];
    };
    expect(saved.members.find((m) => m.name === "review")?.session).toBeUndefined();
  });

  test("launch ignores an agy conversation older than the launch", async () => {
    team({ model: "gem-flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "agy-old-home");
    const cwd = path.join(s.w, "review");
    const oldId = "44444444-4444-4444-8444-444444444444";
    withAgyHome(home, () => {
      writeAgyDb(home, [{ id: oldId, dir: fs.realpathSync(cwd), lastInput: Date.now() - 60000 }]);
    });
    const done = await roster(["launch", s.w, "--member", "review"], {
      AGY_HOME: home,
      ROSTER_QODER_WAIT_MS: "300",
      ROSTER_QODER_INTERVAL_MS: "20",
    });
    expect(done.code).toBe(0);
    expect(done.out).toContain("NOTE member 'review': agy session id could not be recorded");
    expect(done.out).not.toContain(`session agy:${oldId}`);
    const saved = JSON.parse(read(path.join(s.w, "roster.json"))) as {
      members: { name: string; session?: unknown }[];
    };
    expect(saved.members.find((m) => m.name === "review")?.session).toBeUndefined();
  });

  test("dry run does not wait for the agy conversation", async () => {
    team({ model: "gem-flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "agy-dry-home");
    writeAgyDb(home, []);
    const start = Date.now();
    const done = await roster(["launch", s.w, "--dry-run", "--member", "review"], {
      AGY_HOME: home,
      ROSTER_QODER_WAIT_MS: "10000",
      ROSTER_QODER_INTERVAL_MS: "500",
    });
    const elapsed = Date.now() - start;
    expect(done.code).toBe(0);
    expect(done.out).toContain("WOULD LAUNCH review (agy, model gem-flash, effort high)");
    expect(done.out).not.toContain("RECORDED review");
    expect(done.out).not.toContain("could not be recorded");
    expect(elapsed).toBeLessThan(5000);
  });
});
