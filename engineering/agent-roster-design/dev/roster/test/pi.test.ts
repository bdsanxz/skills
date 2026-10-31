// pi members: model and effort validation, the build that checks for the peers extension, and
// the launch command, against the stubs. Its own squad, so the shared smoke suite is untouched.
// Run: bun test (in dev/roster)

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { PI_ROSTER } from "../src/core";
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

  test("three-segment pi model ids pass the shape check and the list", async () => {
    team({ model: "vikey/deepseek/deepseek-v4-flash", effort: "low" });
    const done = await roster(["check", s.w]);
    expect(done.code).toBe(0);
    expect(done.out).toContain("OK 2 members");
    expect(done.out).toContain("model vikey/deepseek/deepseek-v4-flash");
    team({ model: "vikey/deepseek/nope" }); // the shape passes, but the list does not name it
    const missing = await roster(["check", s.w]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("is not available to pi; `pi --list-models` lists:");
    expect(missing.out).toContain("vikey/deepseek/deepseek-v4-flash");
    team({ model: "a//b" }); // empty segments are still rejected by the shape check
    expect((await roster(["check", s.w])).out).toContain("is not a pi model; expected provider/model or model");
  });

  test("launch notes an unconfirmable pi model like check; a listed-but-absent one stays a problem", async () => {
    team({ model: "anthropic/claude-opus-4-8", effort: "high" });
    await roster(["build", s.w]);
    const unconfirmed = await roster(["check", s.w], { PI_FAIL: "1" });
    expect(unconfirmed.code).toBe(0);
    expect(unconfirmed.out).toContain("NOTE member 'review': cannot confirm model 'anthropic/claude-opus-4-8'");
    const dry = await roster(["launch", s.w, "--dry-run"], { PI_FAIL: "1" });
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("NOTE member 'review': cannot confirm model 'anthropic/claude-opus-4-8'");
    expect(dry.out).toContain("WOULD LAUNCH review (pi, model anthropic/claude-opus-4-8, effort high)");
    const launched = await roster(["launch", s.w, "--member", "review"], { PI_FAIL: "1" });
    expect(launched.code).toBe(0);
    expect(launched.out).toContain("LAUNCHED review (pi, model anthropic/claude-opus-4-8, effort high)");
    team({ model: "pi/nope" });
    const absentCheck = await roster(["check", s.w]);
    expect(absentCheck.code).toBe(1);
    expect(absentCheck.out).toContain("is not available to pi; `pi --list-models` lists:");
    const absentLaunch = await roster(["launch", s.w, "--dry-run"]);
    expect(absentLaunch.code).toBe(1);
    expect(absentLaunch.out).toContain("is not available to pi; `pi --list-models` lists:");
    expect(absentLaunch.out).toContain("Nothing was launched.");
  });

  test("an empty pi list with exit 0 is unconfirmable, not absent, in check and launch", async () => {
    team({ model: "anthropic/claude-opus-4-8", effort: "high" });
    await roster(["build", s.w]);
    const checked = await roster(["check", s.w], { PI_EMPTY: "1" });
    expect(checked.code).toBe(0);
    expect(checked.out).toContain("NOTE member 'review': cannot confirm model 'anthropic/claude-opus-4-8'");
    expect(checked.out).toContain("listed no models");
    expect(checked.out).toContain("No models available");
    expect(checked.out).not.toContain("is not available to pi");
    const dry = await roster(["launch", s.w, "--dry-run"], { PI_EMPTY: "1" });
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("NOTE member 'review': cannot confirm model 'anthropic/claude-opus-4-8'");
    expect(dry.out).toContain("WOULD LAUNCH review (pi, model anthropic/claude-opus-4-8, effort high)");
    const launched = await roster(["launch", s.w, "--member", "review"], { PI_EMPTY: "1" });
    expect(launched.code).toBe(0);
    expect(launched.out).toContain("LAUNCHED review (pi, model anthropic/claude-opus-4-8, effort high)");
  });

  test("build installs skills for pi with no peers extension needed", async () => {
    team({ model: "anthropic/claude-opus-4-8", effort: "high" });
    let done = await roster(["build", s.w], { PEERS_OLD: "1" });
    expect(done.code).toBe(0);
    expect(done.out).toContain("BUILT review");
    expect(done.out).toContain("pi loads the loop extension (scripts/pi-roster.js) at launch");
    expect(read(s.npxLog)).toContain("--skill peers");
    expect(read(s.npxLog)).toContain("-a pi -y --copy --skill peers");
    const dir = path.join(s.w, "review");
    expect(exists(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(read(path.join(dir, "AGENTS.md"))).toContain("## Loop");
    expect(read(path.join(dir, "AGENTS.md"))).toContain("/loop stop");
    expect(read(path.join(dir, "AGENTS.md"))).toContain("/goal <condition>");
    expect(read(path.join(dir, "AGENTS.md"))).toContain("A goal never needs Schedule");
    expect(read(path.join(dir, "AGENTS.md"))).not.toContain("daemon goal");
    expect(JSON.parse(read(path.join(dir, ".peers.json"))).agent).toBe("pi");
  });

  test("launch starts pi visible in herdr with --approve, the extension, model and thinking", async () => {
    const done = await roster(["launch", s.w, "--dry-run"]);
    expect(done.code).toBe(0);
    const start = done.out.split("\n").find((line) => line.includes("agent start demo-review"));
    expect(start).toBeDefined();
    expect(start!).toContain("--kind pi");
    expect(start!).toContain(`-- --approve -e ${PI_ROSTER} --name`);
    expect(exists(PI_ROSTER)).toBe(true);
    expect(start!).toContain("--model anthropic/claude-opus-4-8 --thinking high");
    expect(done.out).toContain("WOULD LAUNCH review (pi, model anthropic/claude-opus-4-8, effort high)");
  });

  test("launch starts pi even with an old peers CLI", async () => {
    const done = await roster(["launch", s.w, "--dry-run"], { PEERS_OLD: "1" });
    expect(done.code).toBe(0);
    expect(done.out).toContain("WOULD LAUNCH review (pi, model anthropic/claude-opus-4-8, effort high)");
  });
});
