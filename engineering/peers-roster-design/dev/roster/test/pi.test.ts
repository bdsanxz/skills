// pi members: model and effort validation, the build that checks for the peers extension, and
// the launch command, against the stubs. Its own squad, so the shared smoke suite is untouched.
// Run: bun test (in dev/roster)

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { type Squad, exists, member, read, roster, setRoster, setUp, tearDown } from "./harness";

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
      { name: "review", cwd: "review", summary: "Reviews", reports_to: "lead", agent: "pi", ...review },
    ],
  });
}

describe("pi members", () => {
  test("model and effort are checked against pi --list-models; every level is allowed", async () => {
    team({ model: "anthropic/claude-opus-4-8", effort: "xhigh" });
    let done = await roster(["check", s.w]);
    expect(done.out).toContain("OK 2 members");
    expect(done.out).toContain("MEMBER review: agent pi");
    expect(done.out).toContain("model anthropic/claude-opus-4-8");
    team({ model: "gpt-5", effort: "low" }); // a bare model id is listed too
    expect((await roster(["check", s.w])).out).toContain("OK 2 members");
    team({ model: "anthropic/claude-unknown" });
    done = await roster(["check", s.w]);
    expect(done.out).toContain("is not available to pi; `pi --list-models` lists:");
    expect(done.out).toContain("anthropic/claude-opus-4-8");
    team({ model: "opus:high" });
    expect((await roster(["check", s.w])).out).toContain("is not a pi model; expected provider/model or model");
  });

  test("build installs skills for pi and requires the peers extension in the peers skill", async () => {
    team({ model: "anthropic/claude-opus-4-8", effort: "high" });
    let done = await roster(["build", s.w], { NO_PI_EXTENSION: "1" });
    expect(done.code).toBe(1);
    expect(done.out).toContain("has no .agents/skills/peers/scripts/peers-pi.js");
    done = await roster(["build", s.w]);
    expect(done.code).toBe(0);
    expect(done.out).toContain("BUILT review");
    expect(done.out).toContain("pi loads the peers extension from");
    expect(read(s.npxLog)).toContain("-a pi -y --copy --skill peers");
    const dir = path.join(s.w, "review");
    expect(exists(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(exists(path.join(dir, ".agents", "skills", "peers", "scripts", "peers-pi.js"))).toBe(true);
    expect(JSON.parse(read(path.join(dir, ".peers.json"))).agent).toBe("pi");
  });

  test("launch starts pi visible in herdr with --approve, the extension, model and thinking", async () => {
    const done = await roster(["launch", s.w, "--dry-run"]);
    expect(done.code).toBe(0);
    const ext = path.join(s.w, "review", ".agents", "skills", "peers", "scripts", "peers-pi.js");
    const start = done.out.split("\n").find((line) => line.includes("agent start demo-review"));
    expect(start).toBeDefined();
    expect(start!).toContain("--kind pi");
    expect(start!).toContain(`-- --approve -e ${ext} --name`);
    expect(start!).toContain("--model anthropic/claude-opus-4-8 --thinking high");
    expect(done.out).toContain("WOULD LAUNCH review (pi, model anthropic/claude-opus-4-8, effort high)");
  });

  test("launch refuses a peers CLI without pi support", async () => {
    const done = await roster(["launch", s.w, "--dry-run"], { PEERS_OLD: "1" });
    expect(done.code).toBe(1);
    expect(done.out).toContain("has no pi support, so pi members cannot listen");
    expect(done.out).toContain("Nothing was launched.");
  });
});
