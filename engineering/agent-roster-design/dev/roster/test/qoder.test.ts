// qoder members: model and effort validation against `qodercli --list-models`, the build
// (AGENTS.md, .qoder/skills installs, no Loop section), and the launch command, against
// the stubs. Its own squad, so the shared smoke suite is untouched.
// Run: bun test (in dev/roster)

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { findQoderSessionSince, findSession, sessionLive, waitForQoderSession } from "../src/sessions";
import { type Squad, exists, member, partialBin, read, roster, setRoster, setUp, tearDown } from "./harness";

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
      { name: "review", cwd: "review", summary: "Reviews", reports_to: "lead", agent: "qoder", ...review },
    ],
  });
}

function clear(file: string) {
  fs.writeFileSync(file, "");
}

describe("qoder members", () => {
  test("model and effort are checked against qodercli --list-models; every level is allowed", async () => {
    team({ model: "Qwen3.8-Flash", effort: "xhigh" });
    let done = await roster(["check", s.w]);
    expect(done.out).toContain("OK 2 members");
    expect(done.out).toContain("MEMBER review: agent qoder");
    expect(done.out).toContain("model Qwen3.8-Flash");
    expect(done.out).toContain("effort xhigh");
    team({ model: "DeepSeek-Flash", effort: "max" }); // mixed case is kept, not lowered
    expect((await roster(["check", s.w])).out).toContain("OK 2 members");
    team({ model: "Qwen3.8-flash" }); // the list is matched exactly, not case-folded
    done = await roster(["check", s.w]);
    expect(done.out).toContain("is not available to qoder; `qodercli --list-models` lists:");
    expect(done.out).toContain("DeepSeek-Flash, Qwen3.8-Flash");
    team({ model: "Qwen/Flash" });
    expect((await roster(["check", s.w])).out).toContain("is not a qoder model; expected a model id from `qodercli --list-models`");
    team({ model: "Qwen3.8-Flash", effort: "low" });
    const noQoder = `${partialBin(s, "noqoder", ["npx", "claude", "opencode", "herdr"])}:/usr/bin:/bin`;
    const missing = await roster(["check", s.w], { PATH: noQoder });
    expect(missing.out).toContain("NOTE member 'review': cannot confirm model 'Qwen3.8-Flash': `qodercli` is not on PATH");
    expect(missing.code).toBe(0);
  });

  test("build installs skills for qoder with -a qoder into .qoder/skills", async () => {
    team({ model: "Qwen3.8-Flash", effort: "high" });
    clear(s.npxLog);
    const done = await roster(["build", s.w, "--member", "review"]);
    expect(done.code).toBe(0);
    expect(done.out).toContain("BUILT review");
    expect(read(s.npxLog)).toContain("-a qoder -y --copy --skill peers");
    const dir = path.join(s.w, "review");
    expect(exists(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(exists(path.join(dir, "CLAUDE.md"))).toBe(false);
    expect(read(path.join(dir, "AGENTS.md"))).toContain("Read all four");
    expect(read(path.join(dir, "AGENTS.md"))).not.toContain("## Loop");
    expect(exists(path.join(dir, ".qoder", "skills", "peers", "SKILL.md"))).toBe(true);
    expect(JSON.parse(read(path.join(dir, ".peers.json"))).agent).toBe("qoder");
  });

  test("launch starts qoder visible in herdr with its flags and answers the trust dialog", async () => {
    const done = await roster(["launch", s.w, "--dry-run", "--member", "review"]);
    expect(done.code).toBe(0);
    const start = done.out.split("\n").find((line) => line.includes("agent start demo-review"));
    expect(start).toBeDefined();
    expect(start!).toContain("--kind qoder");
    expect(start!).toContain("-- --dangerously-skip-permissions -n demo-review -m Qwen3.8-Flash --reasoning-effort high");
    expect(done.out).toContain(
      "agent send-keys demo-review enter   # only when the screen shows 'do you trust the files in this folder'",
    );
    expect(done.out).toContain("WOULD LAUNCH review (qoder, model Qwen3.8-Flash, effort high)");
  });

  test("launch on herdr-core opens a tab with the qoder argv and notifies over hcx", async () => {
    clear(s.hcappLog);
    clear(s.hcxLog);
    const env = {
      HERDR_SESSIONS: '{"sessions":[{"name":"default","default":true,"running":false}]}',
      HC_LS_CODE: "0",
      HC_JSON: JSON.stringify({ terminals: [] }),
      HCAPP_JSON: JSON.stringify({ spaces: [{ id: "sp-test", name: "squad-demo" }] }),
    };
    const dry = (await roster(["launch", s.w, "--dry-run", "--member", "review"], env)).out;
    expect(dry).toContain("RUN herdr-app do tab.new --space sp-test");
    expect(dry).toContain(
      "'[\"qodercli\", \"--dangerously-skip-permissions\", \"-n\", \"demo-review\", " +
        "\"-m\", \"Qwen3.8-Flash\", \"--reasoning-effort\", \"high\"]'",
    );
    expect(dry).toContain("only when the screen shows 'do you trust the files in this folder'");
    expect(dry).toContain("RUN hcx send");
    expect(dry).toContain("WOULD LAUNCH review (qoder, model Qwen3.8-Flash, effort high)");
  });

  test("qoder sessions resolve by encoded cwd from their jsonl files; liveness is unknown", () => {
    const home = path.join(s.tmp, "qoderhome");
    const cwd = path.join(s.w, "review");
    const encoded = fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-");
    const projects = path.join(home, "projects", encoded);
    const before: Record<string, string | undefined> = { QODER_CONFIG_DIR: process.env.QODER_CONFIG_DIR };
    process.env.QODER_CONFIG_DIR = home;
    try {
      if (findSession("qoder", cwd) !== null) throw new Error("no qoder session yet");
      fs.mkdirSync(projects, { recursive: true });
      const old = path.join(projects, "11111111-1111-4111-8111-111111111111.jsonl");
      const fresh = path.join(projects, "22222222-2222-4222-8222-222222222222.jsonl");
      fs.writeFileSync(old, '{"type":"session"}\n');
      fs.writeFileSync(fresh, '{"type":"session"}\n');
      fs.mkdirSync(path.join(projects, "22222222-2222-4222-8222-222222222222"), { recursive: true });
      fs.writeFileSync(path.join(projects, "notes.txt"), "not a session\n");
      const now = Date.now();
      fs.utimesSync(old, new Date(now - 60000), new Date(now - 60000));
      fs.utimesSync(fresh, new Date(now), new Date(now));
      if (findSession("qoder", cwd) !== "22222222-2222-4222-8222-222222222222") throw new Error("wanted the newest jsonl");
      if (findSession("qoder", path.join(s.tmp, "elsewhere")) !== null) throw new Error("wrong cwd must not match");
      if (sessionLive("qoder", "22222222-2222-4222-8222-222222222222") !== null) throw new Error("qoder liveness is unknown");
    } finally {
      if (before.QODER_CONFIG_DIR === undefined) delete process.env.QODER_CONFIG_DIR;
      else process.env.QODER_CONFIG_DIR = before.QODER_CONFIG_DIR;
    }
  });

  test("qoder since-lookup only takes files at or after the launch start", () => {
    const home = path.join(s.tmp, "qodersince");
    const cwd = path.join(s.w, "review");
    const encoded = fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-");
    const projects = path.join(home, "projects", encoded);
    const before: Record<string, string | undefined> = { QODER_CONFIG_DIR: process.env.QODER_CONFIG_DIR };
    process.env.QODER_CONFIG_DIR = home;
    try {
      fs.rmSync(home, { recursive: true, force: true });
      fs.mkdirSync(projects, { recursive: true });
      const oldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const newId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      fs.writeFileSync(path.join(projects, `${oldId}.jsonl`), '{"type":"session"}\n');
      fs.writeFileSync(path.join(projects, `${newId}.jsonl`), '{"type":"session"}\n');
      const now = Date.now();
      fs.utimesSync(path.join(projects, `${oldId}.jsonl`), new Date(now - 60000), new Date(now - 60000));
      fs.utimesSync(path.join(projects, `${newId}.jsonl`), new Date(now), new Date(now));
      const since = now - 5000;
      if (findQoderSessionSince(cwd, since) !== newId) throw new Error("wanted only the new file");
      if (findQoderSessionSince(cwd, now + 60000) !== null) throw new Error("future start must match nothing");
      if (waitForQoderSession(cwd, since, { timeoutMs: 0, intervalMs: 0 }) !== newId) {
        throw new Error("zero-wait lookup must find the new file");
      }
      if (waitForQoderSession(cwd, now + 60000, { timeoutMs: 0, intervalMs: 0 }) !== null) {
        throw new Error("zero-wait lookup must ignore older files");
      }
    } finally {
      if (before.QODER_CONFIG_DIR === undefined) delete process.env.QODER_CONFIG_DIR;
      else process.env.QODER_CONFIG_DIR = before.QODER_CONFIG_DIR;
    }
  });

  test("launch records a qoder session file that appears after the first prompt", async () => {
    team({ model: "Qwen3.8-Flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "qoder-wait-home");
    fs.rmSync(home, { recursive: true, force: true });
    const cwd = path.join(s.w, "review");
    const encoded = fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-");
    const projects = path.join(home, "projects", encoded);
    fs.mkdirSync(projects, { recursive: true });
    const id = "33333333-3333-4333-8333-333333333333";
    const target = path.join(projects, `${id}.jsonl`);
    const proc = Bun.spawn(["bash", "-c", `sleep 0.3; printf '{"type":"session"}\\n' > "${target}"`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const done = await roster(["launch", s.w, "--member", "review"], {
      QODER_CONFIG_DIR: home,
      ROSTER_QODER_WAIT_MS: "5000",
      ROSTER_QODER_INTERVAL_MS: "50",
    });
    await proc.exited;
    expect(done.code).toBe(0);
    expect(done.out).toContain(`RECORDED review: session qoder:${id} in roster.json`);
    const saved = JSON.parse(read(path.join(s.w, "roster.json"))) as {
      members: { name: string; session?: unknown }[];
    };
    expect(saved.members.find((m) => m.name === "review")?.session).toEqual({ runtime: "qoder", id });
  });

  test("launch notes when no qoder session file appears and records nothing", async () => {
    team({ model: "Qwen3.8-Flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "qoder-timeout-home");
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(path.join(home, "projects"), { recursive: true });
    const done = await roster(["launch", s.w, "--member", "review"], {
      QODER_CONFIG_DIR: home,
      ROSTER_QODER_WAIT_MS: "300",
      ROSTER_QODER_INTERVAL_MS: "20",
    });
    expect(done.code).toBe(0);
    expect(done.out).toContain("NOTE member 'review': qoder session id could not be recorded");
    expect(done.out).not.toContain("RECORDED review");
    const saved = JSON.parse(read(path.join(s.w, "roster.json"))) as {
      members: { name: string; session?: unknown }[];
    };
    expect(saved.members.find((m) => m.name === "review")?.session).toBeUndefined();
  });

  test("launch ignores a qoder session file older than the launch", async () => {
    team({ model: "Qwen3.8-Flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "qoder-old-home");
    fs.rmSync(home, { recursive: true, force: true });
    const cwd = path.join(s.w, "review");
    const encoded = fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-");
    const projects = path.join(home, "projects", encoded);
    fs.mkdirSync(projects, { recursive: true });
    const oldId = "44444444-4444-4444-8444-444444444444";
    fs.writeFileSync(path.join(projects, `${oldId}.jsonl`), '{"type":"session"}\n');
    const now = Date.now();
    fs.utimesSync(path.join(projects, `${oldId}.jsonl`), new Date(now - 60000), new Date(now - 60000));
    const done = await roster(["launch", s.w, "--member", "review"], {
      QODER_CONFIG_DIR: home,
      ROSTER_QODER_WAIT_MS: "300",
      ROSTER_QODER_INTERVAL_MS: "20",
    });
    expect(done.code).toBe(0);
    expect(done.out).toContain("NOTE member 'review': qoder session id could not be recorded");
    expect(done.out).not.toContain(`session qoder:${oldId}`);
    const saved = JSON.parse(read(path.join(s.w, "roster.json"))) as {
      members: { name: string; session?: unknown }[];
    };
    expect(saved.members.find((m) => m.name === "review")?.session).toBeUndefined();
  });

  test("dry run does not wait for the qoder session file", async () => {
    team({ model: "Qwen3.8-Flash", effort: "high" });
    await roster(["build", s.w, "--member", "review"]);
    const home = path.join(s.tmp, "qoder-dry-home");
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(path.join(home, "projects"), { recursive: true });
    const start = Date.now();
    const done = await roster(["launch", s.w, "--dry-run", "--member", "review"], {
      QODER_CONFIG_DIR: home,
      ROSTER_QODER_WAIT_MS: "10000",
      ROSTER_QODER_INTERVAL_MS: "500",
    });
    const elapsed = Date.now() - start;
    expect(done.code).toBe(0);
    expect(done.out).toContain("WOULD LAUNCH review (qoder, model Qwen3.8-Flash, effort high)");
    expect(done.out).not.toContain("RECORDED review");
    expect(done.out).not.toContain("could not be recorded");
    expect(elapsed).toBeLessThan(5000);
  });
});
