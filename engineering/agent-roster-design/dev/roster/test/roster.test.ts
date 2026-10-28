// The offline smoke suite, ported from smoke.sh: roster validation, agent, model and effort
// selection with defaults and overrides, assembly, skill installs, the Claude channel, the
// peers CLI install and launch for every agent, against stubs of every CLI the script runs.
// Run: bun test (in dev/roster)
//
// The tests run in order and share one squad workspace, as the smoke test does: each step
// builds on the files and logs the steps before it left.

import { afterAll, beforeAll, describe, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { AGENTS } from "../src/agents";
import {
  AGENT_JOB_INSTALLER,
  INSTALLER,
  type MemberData,
  type RosterData,
  type Squad,
  clear,
  edit,
  exists,
  member,
  partialBin,
  read,
  roster,
  setRoster,
  setUp,
  tearDown,
  write,
} from "./harness";

setDefaultTimeout(120000);

let s: Squad;
let W = "";

beforeAll(() => {
  s = setUp();
  W = s.w;
});
afterAll(() => tearDown(s));

function has(name: string, text: string, want: string) {
  if (!text.includes(want)) throw new Error(`${name}: wanted ${JSON.stringify(want)} in:\n${text}`);
}

function lacks(name: string, text: string, bad: string) {
  if (text.includes(bad)) throw new Error(`${name}: did not want ${JSON.stringify(bad)} in:\n${text}`);
}

function exits(name: string, code: number, want: number) {
  if (code !== want) throw new Error(`${name}: exit ${code}, want ${want}`);
}

async function check(name: string, want: string, args: string[], env: Record<string, string | undefined> = {}) {
  const done = await roster(args, env);
  has(name, done.out, want);
  return done;
}

const m = (r: RosterData, index: number): MemberData => r.members[index]!;
const models = (r: RosterData) => r.defaults!.models!;
const file = (...parts: string[]) => read(path.join(W, ...parts));

describe("roster structure", () => {
  test("problems in roster.json", async () => {
    await check("missing roster", "write the roster first", ["check", W]);
    setRoster(s, '{"squad":"s","goal":"g","members":[{"name":"Lead","agent":"x","cwd":"../a","summary":"","reports_to":"user"}]}');
    const bad = await roster(["check", W]);
    has("bad name", bad.out, "must be kebab-case");
    has("unknown agent rejected", bad.out, "\"agent\" 'x' is not an agent; use one of claude, opencode, agy");
    has("bad cwd", bad.out, "one directory name inside the workspace");
    has("empty summary", bad.out, '"summary" must be');
    setRoster(s, {
      squad: "s",
      goal: "g",
      members: [
        { name: "a", agent: "claude", cwd: "a", summary: "A", reports_to: "b" },
        { name: "b", agent: "opencode", cwd: "b", summary: "B", reports_to: "a", talks_to: ["zed"] },
      ],
    });
    const links = await roster(["check", W]);
    has("unknown talks_to", links.out, "talks_to 'zed' is not a member");
    has("nobody reports to user", links.out, 'no member reports to "user"');
    has("report loop", links.out, 'never reaches "user"');
    has("missing files", links.out, "PROJECT.md is missing");
    setRoster(s, { squad: "s", goal: "g", members: [{ name: "a", agent: "claude", cwd: "a", summary: "A", reports_to: "user", model: "two words" }] });
    await check("model with a space", "model 'two words' (member) is not a claude model", ["check", W]);
    setRoster(s, { squad: "s", goal: "g", members: [{ name: "a", agent: "claude", runtime: "claude", cwd: "a", summary: "A", reports_to: "user" }] });
    await check("agent and runtime together", 'has both "agent" and the older "runtime"', ["check", W]);
    setRoster(s, { squad: "s", goal: "g", defaults: { agent: "gpt", models: { cursor: "x" } }, members: [{ name: "a", cwd: "a", summary: "A", reports_to: "user" }] });
    const defaults = await roster(["check", W]);
    has("bad defaults.agent", defaults.out, "defaults.agent 'gpt' is not an agent");
    has("bad defaults.models agent", defaults.out, "defaults.models names 'cursor'");
  });
});

describe("a mixed team", () => {
  test("one member per agent, models from member, defaults and none", async () => {
    setRoster(s, {
      squad: "demo",
      goal: "Ship it.",
      members: [
        { name: "lead", agent: "claude", model: "haiku", cwd: "lead", summary: "Leads", reports_to: "user", talks_to: ["api", "docs"] },
        {
          name: "api",
          agent: "opencode",
          cwd: "api",
          summary: "Builds the API",
          reports_to: "lead",
          model: "opencode/big-pickle",
          skills: [
            { source: "acme/skills", skill: "go-testing" },
            { source: "acme/skills", skill: "sql" },
          ],
        },
        { name: "docs", runtime: "antigravity", cwd: "docs", summary: "Writes docs", reports_to: "lead" },
      ],
    });
    member(s, "lead", "Assign work to api.");
    member(s, "api", "Report to lead.");
    member(s, "docs", "Report to lead.");
    await check("comms must name linked members", "COMMUNICATIONS.md never names 'docs'", ["check", W]);
    member(s, "lead", "Assign work to api and docs. Report to the user.");
    write(path.join(W, "api", "AGENTS.md"), "hand-written\n");
    await check("hand-written AGENTS.md refused", "was not generated by this script", ["check", W]);
    fs.rmSync(path.join(W, "api", "AGENTS.md"));
    const valid = await roster(["check", W]);
    has("valid mixed team", valid.out, "OK 3 members");
    has("claude model from the member", valid.out, "MEMBER lead: agent claude (member), model haiku (member)");
    has("opencode model from the member", valid.out, "MEMBER api: agent opencode (member), model opencode/big-pickle (member)");
    has("legacy runtime antigravity is agy", valid.out, "MEMBER docs: agent agy (member), the agent's own default model");
  });

  test("defaults and fallbacks", async () => {
    edit(s, (r) => delete m(r, 2).runtime);
    await check("built-in default agent is claude", "MEMBER docs: agent claude (built-in default), the agent's own default model", ["check", W]);
    edit(s, (r) => (r.defaults = { agent: "agy" }));
    await check("defaults.agent applies", "MEMBER docs: agent agy (defaults.agent)", ["check", W]);
    edit(s, (r) => (r.defaults!.models = { agy: "gem-fast", claude: "sonnet" }));
    const out = (await roster(["check", W])).out;
    has("defaults.models applies to its agent", out, "MEMBER docs: agent agy (defaults.agent), model gem-fast (defaults.models.agy)");
    has("member model beats defaults.models", out, "MEMBER lead: agent claude (member), model haiku (member)");
  });

  test("model validation, per agent", async () => {
    edit(s, (r) => (m(r, 0).model = "gpt-5"));
    await check("claude model form", "model 'gpt-5' (member) is not a claude model; expected an alias", ["check", W]);
    edit(s, (r) => (m(r, 0).model = "claude-sonnet-5-5"));
    await check("claude full model name", "MEMBER lead: agent claude (member), model claude-sonnet-5-5", ["check", W]);
    edit(s, (r) => (m(r, 1).model = "big-pickle"));
    await check("opencode model form", "is not a opencode model; expected provider/model", ["check", W]);
    edit(s, (r) => (m(r, 1).model = "opencode/nope"));
    await check(
      "opencode model not listed",
      "model 'opencode/nope' (member) is not available to opencode; `opencode models` lists: opencode/beam-free, opencode/big-pickle",
      ["check", W],
    );
    edit(s, (r) => (models(r).agy = "gem-ultra"));
    await check(
      "agy model not listed",
      "model 'gem-ultra' (defaults.models.agy) is not available to agy; `agy models` lists: gem-fast, gem-flash, gem-flash-high, gem-flash-low, gem-pro",
      ["check", W],
    );
    await check("muse model form", "model 'muse/spark' (--model) is not a muse model", ["check", W, "--agent", "lead=muse", "--model", "lead=muse/spark"]);
    edit(s, (r) => {
      m(r, 1).model = "opencode/big-pickle";
      models(r).agy = "gem-fast";
    });
    await check(
      "muse model accepted",
      "MEMBER lead: agent muse (--agent), model muse-spark-1.3 (--model)",
      ["check", W, "--agent", "lead=muse", "--model", "lead=muse-spark-1.3"],
    );
    const noAgy = `${partialBin(s, "noagy", ["npx", "claude", "opencode", "herdr"])}:/usr/bin:/bin`;
    const missing = await check(
      "agy missing is a note for check",
      "NOTE member 'docs': cannot confirm model 'gem-fast': `agy` is not on PATH",
      ["check", W],
      { PATH: noAgy },
    );
    exits("agy missing still passes check", missing.code, 0);
  });

  test("effort: default, mapping per agent, validation and fallback", async () => {
    await check("no effort is the agent's default", "model claude-sonnet-5-5 (member), the agent's own default effort (no effort set)", ["check", W]);
    edit(s, (r) => (m(r, 0).effort = "extreme"));
    await check(
      "unknown member effort",
      "\"effort\" 'extreme' is not an effort level; use one of low, medium, high, xhigh, max",
      ["check", W],
    );
    edit(s, (r) => (m(r, 0).effort = "high"));
    await check("claude effort from the member", "MEMBER lead: agent claude (member), model claude-sonnet-5-5 (member), effort high (member)", ["check", W]);
    await check("claude takes every level", "effort max (--effort)", ["check", W, "--effort", "lead=max"]);
    await check("--effort unknown level", "--effort lead=extreme: 'extreme' is not an effort level", ["check", W, "--effort", "lead=extreme"]);
    await check("--effort unknown member", "--effort nope=low: no member named 'nope'", ["check", W, "--effort", "nope=low"]);
    await check(
      "opencode model without variants",
      "effort 'low' (--effort) is not supported by opencode with opencode/big-pickle; it has no effort levels",
      ["check", W, "--effort", "api=low"],
    );
    await check(
      "opencode variant accepted",
      "MEMBER api: agent opencode (member), model opencode/beam-free (--model), effort xhigh (--effort)",
      ["check", W, "--model", "api=opencode/beam-free", "--effort", "api=xhigh"],
    );
    await check(
      "agy model without levels",
      "effort 'high' (--effort) is not supported by agy with gem-fast; it has no effort levels",
      ["check", W, "--effort", "docs=high"],
    );
    await check(
      "agy base model takes its levels",
      "MEMBER docs: agent agy (defaults.agent), model gem-flash (--model), effort high (--effort)",
      ["check", W, "--model", "docs=gem-flash", "--effort", "docs=high"],
    );
    await check(
      "muse takes every level",
      "MEMBER lead: agent muse (--agent), model muse-spark-1.3 (--model), effort max (--effort)",
      ["check", W, "--agent", "lead=muse", "--model", "lead=muse-spark-1.3", "--effort", "lead=max"],
    );
    const unsupported = await check(
      "explicit unsupported level is an error",
      "it has low, high; the nearest it has is 'low'",
      ["check", W, "--model", "docs=gem-flash", "--effort", "docs=medium"],
    );
    exits("explicit unsupported level exits 1", unsupported.code, 1);
    await check(
      "agy id fixed to a level",
      "it has low; the nearest it has is 'low'; or set the model to 'gem-flash'",
      ["check", W, "--model", "docs=gem-flash-low", "--effort", "docs=high"],
    );
    edit(s, (r) => delete models(r).agy);
    await check(
      "agy effort needs a model",
      "effort 'low' (--effort): agy needs a model to check an effort level against",
      ["check", W, "--effort", "docs=low"],
    );
    edit(s, (r) => {
      models(r).agy = "gem-fast";
      r.defaults!.effort = "max";
    });
    await check(
      "defaults.effort applies",
      "MEMBER api: agent claude (--agent), model sonnet (defaults.models.claude), effort max (defaults.effort)",
      ["check", W, "--agent", "api=claude"],
    );
    const fallback = (await roster(["check", W])).out;
    has("member effort beats defaults.effort", fallback, "effort high (member)");
    has(
      "defaults.effort on an opencode model without variants",
      fallback,
      "NOTE member 'api': opencode/big-pickle has no 'max' effort (it has no effort levels), so it uses the agent's own default effort",
    );
    has(
      "defaults.effort without levels falls back",
      fallback,
      "NOTE member 'docs': gem-fast has no 'max' effort (it has no effort levels), so it uses the agent's own default effort",
    );
    await check("defaults.effort on an opencode variant", "model opencode/beam-free (--model), effort max (defaults.effort)", ["check", W, "--model", "api=opencode/beam-free"]);
    await check(
      "defaults.effort moves to the nearest",
      "MEMBER docs: agent agy (defaults.agent), model gem-flash (--model), effort high (nearest to defaults.effort)",
      ["check", W, "--model", "docs=gem-flash"],
    );
    edit(s, (r) => (r.defaults!.effort = "medium"));
    const tie = await check("nearest takes the lower on a tie", "so it uses the nearest, 'low'", ["check", W, "--model", "docs=gem-flash"]);
    exits("defaults.effort fallback still passes", tie.code, 0);
    edit(s, (r) => (r.defaults!.effort = "huge"));
    await check("bad defaults.effort", "defaults.effort 'huge' is not an effort level", ["check", W]);
    edit(s, (r) => delete r.defaults!.effort);
    edit(s, (r) => {
      models(r).opencode = "opencode/beam-free";
      delete m(r, 1).model;
    });
    await check("defaults.models.opencode applies", "MEMBER api: agent opencode (member), model opencode/beam-free (defaults.models.opencode)", ["check", W]);
    edit(s, (r) => {
      delete models(r).opencode;
      m(r, 1).model = "opencode/big-pickle";
    });
  });

  test("an agent without launch settings warns, and the capability stays reusable", async () => {
    const opencode = AGENTS.opencode!;
    const saved = { ...opencode };
    Object.assign(opencode, { launchSettings: false, settingsNote: "Set them in the agent" });
    try {
      await check(
        "an agent without launch settings warns",
        "WARNING member 'api': ignored model 'opencode/big-pickle' (member) and effort 'high' (--effort); opencode is launched without them. Set them in the agent.",
        ["check", W, "--effort", "api=high"],
      );
    } finally {
      Object.assign(opencode, saved);
      delete opencode.settingsNote;
    }
  });

  test("launch-time overrides, checked by check", async () => {
    await check("--agent override", "MEMBER api: agent agy (--agent), model gem-fast (defaults.models.agy)", ["check", W, "--agent", "api=agy"]);
    await check(
      "override drops the roster model",
      "NOTE member 'api': its model 'opencode/big-pickle' is for its roster agent, so with agent agy it uses gem-fast",
      ["check", W, "--agent", "api=agy"],
    );
    await check("--model override", "MEMBER api: agent agy (--agent), model gem-pro (--model)", ["check", W, "--agent", "api=agy", "--model", "api=gem-pro"]);
    await check("--model must suit the agent", "model 'gem-fast' (--model) is not a claude model", ["check", W, "--model", "lead=gem-fast"]);
    await check("--agent unknown agent", "--agent api=gpt: 'gpt' is not an agent", ["check", W, "--agent", "api=gpt"]);
    await check("--agent unknown member", "--agent nope=claude: no member named 'nope'", ["check", W, "--agent", "nope=claude"]);
    const usage = await check("--model needs MEMBER=VALUE", "must be MEMBER=VALUE", ["check", W, "--model", "haiku"]);
    exits("--model usage error exits 2", usage.code, 2);
    await check("launch overrides are not build options", "unrecognized arguments: --agent", ["build", W, "--agent", "api=agy"]);
  });
});

describe("build", () => {
  test("launch before build is refused", async () => {
    clear(s.herdrLog);
    const refused = await check("launch before build is refused", "member 'lead' is not built", ["launch", W]);
    has("refused launch says nothing started", refused.out, "Nothing was launched.");
    for (const call of ["workspace create", "tab create", "agent start"]) lacks("refused launch touches no pane", read(s.herdrLog), call);
  });

  test("build writes each member's files", async () => {
    await check("build", "BUILT docs (agy)", ["build", W]);
    has("claude gets CLAUDE.md", file("lead", "CLAUDE.md"), "# lead: member of the demo squad");
    has("opencode gets AGENTS.md", file("api", "AGENTS.md"), "# api: member of the demo squad");
    lacks("agents file references, never copies", file("api", "AGENTS.md"), "You are api.");
    has("agents file lists the role path", file("api", "AGENTS.md"), `- Role: \`${W}/api/ROLE.md\``);
    has("agents file says to read them first", file("api", "AGENTS.md"), "Read all four");
    has("claude file imports by path", file("lead", "CLAUDE.md"), `- Memory: @${W}/lead/MEMORY.md`);
    lacks("claude file copies nothing", file("lead", "CLAUDE.md"), "You are lead.");
    has("squad directory shows agent and model", file("docs", "AGENTS.md"), "`docs` (you) | agy | gem-fast |");
    has("squad directory shows a member model", file("docs", "AGENTS.md"), "`lead` | claude | claude-sonnet-5-5 | high |");
    has("peers command in the instructions", file("docs", "AGENTS.md"), "through the peers skill (`peers`)");
    has("lessons go to MEMORY.md", file("api", "AGENTS.md"), "as one short entry. Never record lessons in this file.");
    has("regenerate hint names assemble", file("api", "AGENTS.md"), `roster.js assemble ${W} --member api`);
    write(path.join(W, "api", "MEMORY.md"), "# Memory\n");
    await check("heading-only memory is fine", "OK 3 members", ["check", W]);
    write(path.join(W, "api", "ROLE.md"), "# Role\n");
    await check("heading-only role is empty", "ROLE.md is empty", ["check", W]);
    write(path.join(W, "api", "ROLE.md"), "# Role\n\nYou are api.\n");
    has("peers installed for claude", String(exists(path.join(W, "lead/.claude/skills/peers/SKILL.md"))), "true");
    has("peers installed for agy", String(exists(path.join(W, "docs/.agents/skills/peers/SKILL.md"))), "true");
    has("extra skills in one call", read(s.npxLog), "add acme/skills -a opencode -y --copy --skill go-testing --skill sql");
    has("agy skills agent name", read(s.npxLog), "-a antigravity");
    const server = JSON.parse(file("lead", ".mcp.json")).mcpServers.peers;
    has("channel in .mcp.json", `${path.basename(server.command)} ${JSON.stringify(server.args)}`, 'peers ["channel"]');
    const settings = JSON.parse(file("lead", ".claude", "settings.local.json"));
    has("channels approved", JSON.stringify(settings.enabledMcpjsonServers), '["peers","agent-job"]');
    const agentJob = path.join(s.bin, "agent-job");
    const job = JSON.parse(file("lead", ".mcp.json")).mcpServers["agent-job"];
    has("agent-job channel in .mcp.json", JSON.stringify(job.args), JSON.stringify([agentJob, "channel"]));
    has("claude goal Stop hook", JSON.stringify(settings.hooks.Stop), `${agentJob} goal hook claude`);
    has("claude goal SessionStart hook", JSON.stringify(settings.hooks.SessionStart), '"matcher":"compact|resume"');
    const agyHooks = JSON.parse(file("docs", ".agents", "hooks.json"))["agent-job-goal"];
    has("agy goal hooks", JSON.stringify(agyHooks), `${agentJob} goal hook antigravity Stop`);
    lacks("no agy hooks for opencode", String(exists(path.join(W, "api", ".agents", "hooks.json"))), "true");
    has("agent-job skill installed for claude", String(exists(path.join(W, "lead/.claude/skills/agent-job/SKILL.md"))), "true");
    has("agent-job skill installed for opencode", String(exists(path.join(W, "api/.agents/skills/agent-job/SKILL.md"))), "true");
    lacks("build writes no opencode.json", String(exists(path.join(W, "api", "opencode.json"))), "true");
    has("opencode records its model", file("api", ".peers.json"), '"model": "opencode/big-pickle"');
    has("squad directory shows the opencode model", file("lead", "CLAUDE.md"), "`api` | opencode | opencode/big-pickle | agent default |");
    has("role file for each member", file("api", ".peers.json"), '"role": "api"');
    has("role file names the squad", file("lead", ".peers.json"), '"squad": "demo"');
    has("role file records agent and model", file("docs", ".peers.json"), '"agent": "agy",\n  "model": "gem-fast"');
    lacks("no channel for opencode", String(exists(path.join(W, "api", ".mcp.json"))), "true");
  });

  test("rebuilds keep what is there", async () => {
    write(path.join(W, "lead", ".mcp.json"), '{"mcpServers":{"other":{"command":"x"}},"x":1}');
    const local = path.join(W, "lead", ".claude", "settings.local.json");
    const before = JSON.parse(read(local));
    before.hooks.Stop.push({ hooks: [{ type: "command", command: "my-own-stop-hook" }] });
    before.hooks.Stop[0].hooks[0].command = "/old/path/agent-job goal hook claude";
    write(local, JSON.stringify(before));
    await roster(["build", W, "--member", "lead"]);
    has("rebuild keeps the user's own hook", read(local), "my-own-stop-hook");
    lacks("rebuild replaces an old agent-job hook", read(local), "/old/path/agent-job");
    has("existing .mcp.json kept", file("lead", ".mcp.json"), '"other"');
    const enabled = JSON.parse(file("lead", ".claude", "settings.local.json")).enabledMcpjsonServers as string[];
    has("rebuild keeps one approval", String(enabled.filter((x) => x === "peers").length), "1");
    has("rebuild keeps one agent-job approval", String(enabled.filter((x) => x === "agent-job").length), "1");
    const hooks = JSON.parse(file("lead", ".claude", "settings.local.json")).hooks;
    has("rebuild keeps one agent-job Stop hook", String(JSON.stringify(hooks.Stop).split("goal hook claude").length - 1), "1");
    has("rebuild keeps one SessionStart hook", String(hooks.SessionStart.length), "1");
    write(path.join(W, "api", "opencode.json"), '{"model":"opencode/beam-free#high"}\n');
    await roster(["build", W, "--member", "api"]);
    has("build keeps the member's own opencode.json", file("api", "opencode.json"), '{"model":"opencode/beam-free#high"}');
    clear(s.npxLog);
    await check("assemble writes only instructions", "ASSEMBLED api", ["assemble", W, "--member", "api"]);
    has("assemble installs nothing", String(read(s.npxLog).length), "0");
    await check("unknown member", "no member named 'nope'", ["assemble", W, "--member", "nope"]);
  });
});

describe("launch", () => {
  test("validation before anything starts", async () => {
    clear(s.herdrLog);
    await check("launch needs a running herdr session", "herdr session 'default' is not running", ["launch", W], {
      HERDR_SESSIONS: '{"sessions":[{"name":"default","default":true,"running":false}]}',
    });
    await check("launch needs the named session", "no herdr session named 'work'", ["launch", W, "--session", "work"]);
    const noAgy = `${partialBin(s, "noagy", ["npx", "claude", "opencode", "herdr"])}:/usr/bin:/bin`;
    await check("launch needs each agent's CLI", "member 'docs': agent agy needs the `agy` command, which is not on PATH", ["launch", W], { PATH: noAgy });
    await check("launch rejects an invalid model", "model 'opus-9' (--model) is not available to agy", ["launch", W, "--model", "docs=opus-9"]);
    for (const call of ["workspace create", "tab create", "agent start", "pane run"]) lacks("failed validation starts nothing", read(s.herdrLog), call);
  });

  test("a dry run prints each agent's own command and model setting", async () => {
    const dry = (await roster(["launch", W, "--dry-run"])).out;
    has(
      "dry run claude with --model and --effort",
      dry,
      "claude --dangerously-skip-permissions -n demo-lead --model claude-sonnet-5-5 --effort high --",
    );
    has("dry run opencode starts as a herdr agent", dry, "agent start demo-api --kind opencode --pane '<pane-2>'");
    has("dry run agy with --model", dry, "agent start demo-docs --kind agy --pane '<pane-3>' -- --dangerously-skip-permissions --model gem-fast");
    has("dry run shows agy's dialog answers", dry, "agent send-keys demo-docs esc   # only when the screen shows 'esc to dismiss'");
    has("dry run opencode creates its session", dry, "RUN opencode api session.create -d");
    has("dry run opencode opens that session", dry, "agent start demo-api --kind opencode --pane '<pane-2>' -- --session '<session>'");
    has(
      "dry run opencode sets the model by API",
      dry,
      `RUN opencode api session.switchModel --param 'sessionID=<session>' -d '{"model": {"providerID": "opencode", "id": "big-pickle"}}'`,
    );
    has("dry run reports the model per member", dry, "WOULD LAUNCH api (opencode, model opencode/big-pickle, effort the agent's own default)");
    await check("dry run with an agent override would rebuild", "WOULD REBUILD api for agent claude", ["launch", W, "--dry-run", "--agent", "api=claude", "--model", "api=opus"]);
    has("dry run changes nothing", file("api", ".peers.json"), '"agent": "opencode"');
  });

  test("a real run against the herdr stub", async () => {
    clear(s.herdrLog);
    await check(
      "launch starts every member",
      "LAUNCHED docs (agy, model gem-fast, effort the agent's own default) in herdr session default, tab 3 'docs', pane w9:p3",
      ["launch", W],
    );
    const log = read(s.herdrLog);
    has("claude started with its model", log, "pane run w9:p1 claude --dangerously-skip-permissions -n demo-lead --model claude-sonnet-5-5");
    has("claude trust prompt answered", log, "pane send-keys w9:p1 down enter");
    has("claude channel confirmed", log, "pane wait-output w9:p1 --match inject directly");
    has("opencode retried a busy pane", log, "busy-once");
    has("opencode got its first prompt", log, "agent prompt demo-api Read your instructions");
    has("agy trust prompt answered", log, "agent send-keys demo-docs enter");
    has("agy notice dismissed", log, "agent send-keys demo-docs esc");
    has("launch waits for the agent to settle", log, "agent wait demo-docs --until idle --until blocked");
    has("agy started with its model", log, "--kind agy --pane w9:p3 -- --dangerously-skip-permissions --model gem-fast");
    has("opencode session created in the member cwd", read(s.opencodeLog), `"location": {"directory": "${W}/api"}`);
    has("opencode TUI opens that session", log, "agent start demo-api --kind opencode --pane w9:p2 -- --session ses_test1");
    lacks("opencode gets no model flag", log, "--kind opencode --pane w9:p2 -- --model");
    has("opencode model set by API", read(s.opencodeLog), 'api session.switchModel --param sessionID=ses_test1 -d {"model": {"providerID": "opencode", "id": "big-pickle"}}');
    const lines = log.split("\n");
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
    const order = [/agent start demo-api/, /agent wait demo-api/, /session\.switchModel/, /session\.get/, /agent prompt demo-api/].map(at);
    has("model set after start, before the first prompt", String(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1]!))), "true");
  });

  test("overrides rebuild and retune the member", async () => {
    await check("launch override rebuilds the member", "REBUILT api (claude)", ["launch", W, "--member", "api", "--agent", "api=claude", "--model", "api=opus"]);
    has("override rebuild writes CLAUDE.md", `${exists(path.join(W, "api/CLAUDE.md"))} ${exists(path.join(W, "api/AGENTS.md"))}`, "true false");
    has("override shows in the squad directory", file("lead", "CLAUDE.md"), "`api` | claude | opus |");
    has("override records agent and model", file("api", ".peers.json"), '"model": "opus"');
    await roster(["build", W, "--member", "api"]);
    clear(s.herdrLog);
    await check(
      "opencode override launches with its effort",
      "LAUNCHED api (opencode, model opencode/beam-free, effort xhigh)",
      ["launch", W, "--member", "api", "--model", "api=opencode/beam-free", "--effort", "api=xhigh"],
    );
    has("opencode effort is the session variant", read(s.opencodeLog), '{"model": {"providerID": "opencode", "id": "beam-free", "variant": "xhigh"}}');
    lacks("opencode.json untouched by launch", file("api", "opencode.json"), "xhigh");
    await check(
      "a session that reports another model fails",
      "reports model {'providerID': 'opencode', 'id': 'other'}, not opencode/beam-free with variant xhigh",
      ["launch", W, "--member", "api", "--model", "api=opencode/beam-free", "--effort", "api=xhigh"],
      { OC_WRONG_MODEL: "1" },
    );
    edit(s, (r) => delete m(r, 1).model);
    await roster(["assemble", W, "--member", "api"]);
    clear(s.herdrLog);
    await check("opencode without a model starts plain", "LAUNCHED api (opencode, model the agent's own default", ["launch", W, "--member", "api"]);
    lacks("plain opencode makes no API call", read(s.herdrLog), "session.create");
    lacks("plain opencode gets no flags", read(s.herdrLog), "--kind opencode --pane w9:p1 --");
    edit(s, (r) => (m(r, 1).model = "opencode/big-pickle"));
    await roster(["assemble", W, "--member", "api"]);
    await check("effort-only override retunes", "SET lead's model to claude-sonnet-5-5, effort low", ["launch", W, "--member", "lead", "--effort", "lead=low"]);
    has("effort recorded in .peers.json", file("lead", ".peers.json"), '"effort": "low"');
    has("squad directory shows the effort", file("api", "AGENTS.md"), "`lead` | claude | claude-sonnet-5-5 | low |");
    has("claude gets the overridden effort", read(s.herdrLog), "--model claude-sonnet-5-5 --effort low");
    clear(s.herdrLog);
    await check("agy launches with its effort", "LAUNCHED docs (agy, model gem-flash, effort high)", ["launch", W, "--member", "docs", "--model", "docs=gem-flash", "--effort", "docs=high"]);
    has("agy gets --model and --effort", read(s.herdrLog), "--kind agy --pane w9:p1 -- --dangerously-skip-permissions --model gem-flash --effort high");
    await check("launch refuses an unsupported effort", "is not supported by agy with gem-fast", ["launch", W, "--effort", "docs=high"]);
    await roster(["build", W, "--member", "lead"]);
    has("build returns to roster.json", file("lead", ".peers.json"), '"effort": "high"');
    const failed = await check("launch failure names the member", "FAILED opening or moving api's tab: `herdr tab create", ["launch", W], { HERDR_FAIL_TAB: "1" });
    has("launch failure lists who runs", failed.out, "Already running: lead (pane w9:p1). Not started: api, docs.");
    exits("launch failure exits 1", failed.code, 1);
  });

  test("a muse member is checked, built and launched", async () => {
    edit(s, (r) => {
      const d = m(r, 2);
      d.agent = "muse";
      d.model = "muse-spark-1.3";
      d.effort = "high";
    });
    await check(
      "muse member checked",
      "MEMBER docs: agent muse (member), model muse-spark-1.3 (member), effort high (member)",
      ["check", W],
    );
    clear(s.npxLog);
    await check("muse member built", "BUILT docs (muse)", ["build", W, "--member", "docs"]);
    has("muse member gets AGENTS.md", file("docs", "AGENTS.md"), "# docs: member of the demo squad");
    has("muse member reads its files first", file("docs", "AGENTS.md"), "Read all four");
    has("muse member records agent and model", file("docs", ".peers.json"), '"agent": "muse"');
    has("muse skills install into the shared dir", read(s.npxLog), "-a opencode");
    clear(s.herdrLog);
    const dry = (await roster(["launch", W, "--dry-run", "--member", "docs"])).out;
    has("muse starts as a herdr agent", dry, "agent start demo-docs --kind muse");
    has("muse starts with its flags", dry, "--yolo --model muse-spark-1.3 --effort high");
    has("muse launch reported", dry, "WOULD LAUNCH docs (muse, model muse-spark-1.3, effort high)");
    edit(s, (r) => {
      const d = m(r, 2);
      delete d.agent;
      delete d.model;
      delete d.effort;
    });
    await roster(["build", W, "--member", "docs"]);
  });

  test("one workspace, one tab per member in hierarchy order", async () => {
    clear(s.herdrLog);
    await roster(["launch", W]);
    const log = read(s.herdrLog);
    has("one workspace for the squad", String(log.split("\n").filter((line) => line.includes("workspace create")).length), "1");
    has("the supervisor's tab comes first", log, "tab rename w9:t1 lead");
    has("each member gets its own tab", log, `tab create --workspace w9 --cwd ${W}/api --label api --no-focus`);
    const lines = log.split("\n");
    const order = [/tab rename w9:t1 lead/, /--label api/, /--label docs/].map((p) => lines.findIndex((line) => p.test(line)));
    has("tabs follow the hierarchy", String(order[0]! < order[1]! && order[1]! < order[2]!), "true");
    has("each pane is labelled", log, "pane rename w9:p3 docs");
    lacks("no pane is split", log, "pane split");
    lacks("no pane is zoomed", log, "pane zoom");
    await check("launch prints the tabs", "TAB 1 'lead': lead", ["launch", W, "--dry-run"]);
    await check("check prints the tabs", "TAB 3 'docs': docs", ["check", W]);
    const SQUAD_WS = '{"result":{"workspaces":[{"label":"squad-demo","workspace_id":"w9"}]}}';
    await check("a second full launch is refused", "already holds the squad's workspace squad-demo (w9)", ["launch", W], { HERDR_WORKSPACES: SQUAD_WS });
    await check("a member that still has a pane is refused", "member 'lead' already has pane w9:p1", ["launch", W, "--member", "lead"], {
      HERDR_WORKSPACES: SQUAD_WS,
      HERDR_PANES: '{"label":"lead","pane_id":"w9:p1","tab_id":"w9:t1"}',
    });
    clear(s.herdrLog);
    await check("a relaunched last member gets a new tab", "tab 3 'docs', pane w9:p11", ["launch", W, "--member", "docs"], {
      HERDR_TAB_BASE: "10",
      HERDR_WORKSPACES: SQUAD_WS,
      HERDR_PANES: '{"label":"lead","pane_id":"w9:p1","tab_id":"w9:t1"},{"label":"api","pane_id":"w9:p2","tab_id":"w9:t2"}',
    });
    lacks("it makes no second workspace", read(s.herdrLog), "workspace create");
    lacks("a last member moves nobody", read(s.herdrLog), "pane move");
    clear(s.herdrLog);
    const relaunch = await roster(["launch", W, "--member", "lead"], {
      HERDR_TAB_BASE: "10",
      HERDR_WORKSPACES: SQUAD_WS,
      HERDR_PANES: '{"label":"api","pane_id":"w9:p2","tab_id":"w9:t2"},{"label":"docs","pane_id":"w9:p3","tab_id":"w9:t3"}',
    });
    const moved = read(s.herdrLog);
    has("a relaunched supervisor gets a new tab", moved, `tab create --workspace w9 --cwd ${W}/lead --label lead`);
    has("the members after it move behind it", relaunch.out, "MOVED api to a new last tab, keeping it running in pane w9:p2");
    has("a moved member's new tab is labelled", moved, "tab rename w9:t51 api");
    const movedLines = moved.split("\n");
    const moves = [/--label lead/, /pane move w9:p2 --new-tab/, /pane move w9:p3 --new-tab/].map((p) => movedLines.findIndex((line) => p.test(line)));
    has("moves keep the hierarchy order", String(moves[0]! < moves[1]! && moves[1]! < moves[2]!), "true");
    lacks("moved members are not restarted", moved, "agent start demo-api");
    clear(s.herdrLog);
    await check("unknown dialog fails with the screen", "Pick a color theme", ["launch", W, "--member", "docs"], { HERDR_ODD_DIALOG: "1" });
    lacks("unknown dialog gets no keys", read(s.herdrLog), "agent send-keys demo-docs");
  });
});

describe("display names", () => {
  test("validation, files, and launch labels", async () => {
    edit(s, (r) => (m(r, 0).display_name = "Lena | lead"));
    await check("display name rejects |", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => (m(r, 0).display_name = "x".repeat(49)));
    await check("display name too long", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => {
      m(r, 0).display_name = "Rina";
      m(r, 1).display_name = "rina";
    });
    await check("display name must be unique", "display_name 'rina' is used by another member", ["check", W]);
    edit(s, (r) => {
      m(r, 0).display_name = "Lena";
      m(r, 1).display_name = "Rina";
    });
    const named = (await roster(["check", W])).out;
    has("MEMBER line shows the display name", named, "MEMBER lead (Lena): agent claude");
    has("unnamed MEMBER line unchanged", named, "MEMBER docs: agent agy");
    await roster(["assemble", W]);
    has("heading shows the display name", file("lead", "CLAUDE.md"), "# Lena (`lead`): member of the demo squad");
    has("intro shows the display name", file("api", "AGENTS.md"), "You are Rina, the member `api`.");
    has("squad directory gets a Name column", file("lead", "CLAUDE.md"), "| `api` | Rina | opencode |");
    has("unnamed member shows its member name", file("docs", "AGENTS.md"), "| `docs` (you) | docs | agy |");
    has("files explain the two names", file("docs", "AGENTS.md"), "Call members by their human-readable name");
    has(".peers.json records the display name", file("api", ".peers.json"), '"display_name": "Rina"');
    lacks("unnamed .peers.json has no display name", file("docs", ".peers.json"), "display_name");
    clear(s.herdrLog);
    clear(s.opencodeLog);
    await check("LAUNCHED shows the display name", "LAUNCHED api (Rina) (opencode", ["launch", W, "--member", "api"]);
    has("pane labelled with the display name", read(s.herdrLog), "pane rename w9:p1 Rina");
    has("opencode session title", read(s.opencodeLog), "Rina [demo-api] (peers squad member)");
    clear(s.herdrLog);
    await roster(["launch", W, "--member", "lead"]);
    has("claude session name", read(s.herdrLog), "-n 'Lena [demo-lead]'");
    clear(s.herdrLog);
    await roster(["launch", W, "--member", "docs"]);
    has("unnamed member's pane is labelled with its member name", read(s.herdrLog), "pane rename w9:p1 docs");
    edit(s, (r) => {
      delete m(r, 0).display_name;
      delete m(r, 1).display_name;
    });
    await roster(["assemble", W]);
    lacks("removing names clears .peers.json", file("api", ".peers.json"), "display_name");
  });
});

describe("build failures", () => {
  test("installs that fail are caught", async () => {
    edit(s, (r) => {
      m(r, 1).agent = "claude";
      delete m(r, 1).model;
    });
    await roster(["build", W, "--member", "api"]);
    has("agent change swaps the generated file", `${exists(path.join(W, "api/CLAUDE.md"))} ${exists(path.join(W, "api/AGENTS.md"))}`, "true false");
    edit(s, (r) => (m(r, 2).skills = [{ source: "acme/skills", skill: "broken" }]));
    await check("failed install shows the command", "npx -y skills@latest add acme/skills -a antigravity", ["build", W, "--member", "docs"]);
    edit(s, (r) => (m(r, 2).skills = [{ source: "acme/skills", skill: "silent" }]));
    await check("install that leaves nothing is caught", "did not install 'silent'", ["build", W, "--member", "docs"]);
    edit(s, (r) => (m(r, 2).skills = [{ source: "acme/skills", skill: "peers" }]));
    await check("peers is not listed by hand", "which every member gets", ["check", W]);
    edit(s, (r) => (m(r, 2).skills = [{ source: "acme/skills", skill: "agent-job" }]));
    await check("agent-job is not listed by hand", 'lists agent-job, which every member gets; set "agent_job_source" instead', ["check", W]);
  });
});

describe("the peers CLI", () => {
  test("build installs it when it is missing", async () => {
    edit(s, (r) => delete m(r, 2).skills);
    const noPeers = `${partialBin(s, "nopeers", ["npx", "claude", "opencode", "agy", "herdr", "agent-job"])}:/usr/bin:/bin`;
    const home = path.join(s.tmp, "home");
    const installer = path.join(s.tmp, "installer.sh");
    write(installer, INSTALLER);
    const env = (more: Record<string, string> = {}) => ({
      PATH: noPeers,
      HOME: home,
      GITHUB_TOKEN: "",
      PEERS_INSTALL_DIR: "",
      PEERS_INSTALLER_URL: `file://${installer}`,
      ...more,
    });
    await check("check notes a missing peers CLI", `NOTE the peers CLI is not installed; build installs it with file://${installer}`, ["check", W], env());
    await check("launch needs the peers CLI", "the peers CLI is not installed; run", ["launch", W, "--dry-run"], env());
    await check("a failed peers install shows its output", "peers-install: error: no release", ["build", W, "--member", "lead"], env({ INSTALLER_FAIL: "1" }));
    await check(
      "an unreachable installer is named",
      `could not be fetched from file://${s.tmp}/missing.sh`,
      ["build", W, "--member", "lead"],
      env({ PEERS_INSTALLER_URL: `file://${s.tmp}/missing.sh` }),
    );
    const installed = (await roster(["build", W, "--member", "lead"], env())).out;
    has("build installs a missing peers CLI", installed, `INSTALLED peers 0.0.1 at ${home}/.local/bin/peers`);
    has("the install warns when its directory is not on PATH", installed, "is not on PATH, so members cannot run `peers`");
    has("the channel runs the installed peers", file("lead", ".mcp.json"), `"command": "${home}/.local/bin/peers"`);
    lacks("an installed peers CLI is not installed again", (await roster(["build", W, "--member", "lead"], env())).out, "INSTALLED");
    await check(
      "PEERS_INSTALL_DIR picks the directory",
      `INSTALLED peers 0.0.1 at ${s.tmp}/pdir/peers`,
      ["build", W, "--member", "lead"],
      env({ HOME: path.join(s.tmp, "home2"), PEERS_INSTALL_DIR: path.join(s.tmp, "pdir") }),
    );
    await roster(["build", W, "--member", "lead"]);
  });
});

describe("the agent-job CLI", () => {
  test("build installs it when it is missing, and launch needs it", async () => {
    const noJob = `${partialBin(s, "nojob", ["npx", "claude", "opencode", "agy", "herdr", "peers"])}:${path.dirname(process.execPath)}:/usr/bin:/bin`;
    const home = path.join(s.tmp, "jobhome");
    const installer = path.join(s.tmp, "agent-job-installer.sh");
    write(installer, AGENT_JOB_INSTALLER);
    const env = (more: Record<string, string> = {}) => ({
      PATH: noJob,
      HOME: home,
      GITHUB_TOKEN: "",
      AGENT_JOB_INSTALL_DIR: "",
      AGENT_JOB_INSTALLER_URL: `file://${installer}`,
      ...more,
    });
    await check("check notes a missing agent-job CLI", `NOTE the agent-job CLI is not installed; build installs it with file://${installer}`, ["check", W], env());
    await check("launch needs the agent-job CLI", "the agent-job CLI is not installed; run", ["launch", W, "--dry-run"], env());
    await check("a failed agent-job install shows its output", "agent-job-install: error: no release", ["build", W, "--member", "lead"], env({ INSTALLER_FAIL: "1" }));
    await check(
      "agent-job needs bun",
      "it needs bun on PATH to run",
      ["build", W, "--member", "lead"],
      env({ PATH: `${partialBin(s, "nojobnobun", ["npx", "claude", "opencode", "agy", "herdr", "peers"])}:/usr/bin:/bin` }),
    );
    const installed = (await roster(["build", W, "--member", "lead"], env())).out;
    has("build installs a missing agent-job CLI", installed, `INSTALLED agent-job 0.0.1 at ${home}/.local/bin/agent-job`);
    has("the install warns when its directory is not on PATH", installed, "is not on PATH, so members cannot run `agent-job`");
    has("the hooks run the installed agent-job", file("lead", ".claude", "settings.local.json"), `${home}/.local/bin/agent-job goal hook claude`);
    lacks("an installed agent-job CLI is not installed again", (await roster(["build", W, "--member", "lead"], env())).out, "INSTALLED agent-job");
    await roster(["build", W, "--member", "lead"]);
  });
});
