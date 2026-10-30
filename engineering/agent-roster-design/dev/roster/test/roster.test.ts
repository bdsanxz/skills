// The offline smoke suite, ported from smoke.sh: roster validation, agent, model and effort
// selection with defaults and overrides, assembly, skill installs, the Claude channel, the
// peers CLI install and launch for every agent, against stubs of every CLI the script runs.
// Run: bun test (in dev/roster)
//
// The tests run in order and share one squad workspace, as the smoke test does: each step
// builds on the files and logs the steps before it left.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { AGENTS } from "../src/agents";
import { OPENCODE_ROSTER_MCP, OPENCODE_ROSTER_PLUGIN } from "../src/core";
import { findSession, sessionLive } from "../src/sessions";
import {
  AGENT_SHELL_INSTALLER,
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
    edit(s, (r) => (r.defaults!.models = { agy: "gem-fast", claude: "haiku" }));
    const out = (await roster(["check", W])).out;
    has("defaults.models applies to its agent", out, "MEMBER docs: agent agy (defaults.agent), model gem-fast (defaults.models.agy)");
    has("member model beats defaults.models", out, "MEMBER lead: agent claude (member), model haiku (member)");
  });

  test("model validation, per agent", async () => {
    edit(s, (r) => (m(r, 0).model = "gpt-5"));
    await check("claude model form", "model 'gpt-5' (member) is not a claude model; expected an alias", ["check", W]);
    edit(s, (r) => (m(r, 0).model = "claude-haiku-4-5"));
    await check("claude full model name", "MEMBER lead: agent claude (member), model claude-haiku-4-5", ["check", W]);
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
    await check("no effort is the agent's default", "model claude-haiku-4-5 (member), the agent's own default effort (no effort set)", ["check", W]);
    edit(s, (r) => (m(r, 0).effort = "extreme"));
    await check(
      "unknown member effort",
      "\"effort\" 'extreme' is not an effort level; use one of low, medium, high, xhigh, max",
      ["check", W],
    );
    edit(s, (r) => (m(r, 0).effort = "high"));
    await check("claude effort from the member", "MEMBER lead: agent claude (member), model claude-haiku-4-5 (member), effort high (member)", ["check", W]);
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
      "MEMBER api: agent claude (--agent), model haiku (defaults.models.claude), effort max (defaults.effort)",
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
    has("squad directory shows a member model", file("docs", "AGENTS.md"), "`lead` | claude | claude-haiku-4-5 | high |");
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
    lacks("claude needs no .mcp.json", String(exists(path.join(W, "lead", ".mcp.json"))), "true");
    lacks("claude needs no settings.local.json", String(exists(path.join(W, "lead", ".claude", "settings.local.json"))), "true");
    lacks("agy gets no hooks.json", String(exists(path.join(W, "docs", ".agents", "hooks.json"))), "true");
    lacks("no hooks for opencode", String(exists(path.join(W, "api", ".agents", "hooks.json"))), "true");
    const claudeSkills = fs.readdirSync(path.join(W, "lead", ".claude", "skills")).sort();
    has("only peers and agent-shell installed for claude", JSON.stringify(claudeSkills), '["agent-shell","peers"]');
    const opencodeSkills = fs.readdirSync(path.join(W, "api", ".agents", "skills")).sort();
    has("only expected skills installed for opencode", JSON.stringify(opencodeSkills), '["agent-shell","go-testing","peers","sql"]');
    has("agent-shell skill installed for claude", String(exists(path.join(W, "lead/.claude/skills/agent-shell/SKILL.md"))), "true");
    has("agent-shell skill installed for opencode", String(exists(path.join(W, "api/.agents/skills/agent-shell/SKILL.md"))), "true");
    has("build merges the loop entry into opencode.json", file("api", "opencode.json"), '"roster"');
    has("loop entry runs the built sidecar", file("api", "opencode.json"), OPENCODE_ROSTER_MCP);
    has("loop log in the member directory", file("api", "opencode.json"), `${W}/api/logs/roster.jsonl`);
    has("loop entry is local without codemode", file("api", "opencode.json"), '"codemode": false');
    has(
      "build places the loop plugin",
      String(exists(path.join(W, "api", ".opencode", "plugins", "opencode-roster-plugin.js"))),
      "true",
    );
    has("loop plugin is the built file", read(path.join(W, "api", ".opencode", "plugins", "opencode-roster-plugin.js")), "opencode-roster");
    has("loop note in opencode instructions", file("api", "AGENTS.md"), "## Loop");
    has("loop note names the stop command", file("api", "AGENTS.md"), "/loop stop");
    has("loop note names the goal command", file("api", "AGENTS.md"), "/goal <condition>");
    has("loop note says a goal never needs Schedule", file("api", "AGENTS.md"), "A goal never needs Schedule");
    lacks("loop note names no daemon goal", file("api", "AGENTS.md"), "daemon goal");
    lacks("claude members get no loop note", file("lead", "CLAUDE.md"), "## Loop");
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
    const before = { hooks: { Stop: [{ hooks: [{ type: "command", command: "my-own-stop-hook" }] }] } };
    write(local, JSON.stringify(before));
    await roster(["build", W, "--member", "lead"]);
    has("rebuild keeps the user's own hook", read(local), "my-own-stop-hook");
    has("rebuild adds no hooks of its own", read(local), JSON.stringify(before));
    has("existing .mcp.json kept", file("lead", ".mcp.json"), '"other"');
    write(path.join(W, "api", "opencode.json"), '{"model":"opencode/beam-free#high"}\n');
    await roster(["build", W, "--member", "api"]);
    has("build keeps the member's own opencode.json keys", file("api", "opencode.json"), '"model": "opencode/beam-free#high"');
    has("rebuild keeps the merged loop entry", file("api", "opencode.json"), '"roster"');
    clear(s.npxLog);
    await check("assemble writes only instructions", "ASSEMBLED api", ["assemble", W, "--member", "api"]);
    has("assemble installs nothing", String(read(s.npxLog).length), "0");
    await check("unknown member", "no member named 'nope'", ["assemble", W, "--member", "nope"]);
  });

  test("an opencode.json that is not JSON names the file", async () => {
    write(path.join(W, "api", "opencode.json"), "{nope");
    const bad = await roster(["build", W, "--member", "api"]);
    exits("invalid opencode.json exits 1", bad.code, 1);
    has("invalid opencode.json names the file", bad.out, "api/opencode.json is not valid JSON");
  });

  test("opencode setup merges every existing key and a second build changes nothing", async () => {
    write(
      path.join(W, "api", "opencode.json"),
      JSON.stringify({ model: "opencode/beam-free#high", mcp: { servers: { other: { type: "local", command: ["other"] } } } }),
    );
    await roster(["build", W, "--member", "api"]);
    const config = file("api", "opencode.json");
    has("existing model key kept", config, '"model": "opencode/beam-free#high"');
    has("existing mcp server kept", config, '"other"');
    has("loop command runs the built sidecar", config, OPENCODE_ROSTER_MCP);
    const plugin = path.join(W, "api", ".opencode", "plugins", "opencode-roster-plugin.js");
    expect(read(plugin)).toBe(read(OPENCODE_ROSTER_PLUGIN));
    const before = `${config}\n${read(plugin)}`;
    await roster(["build", W, "--member", "api"]);
    expect(`${file("api", "opencode.json")}\n${read(plugin)}`).toBe(before);
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
      "claude --dangerously-skip-permissions -n demo-lead --model claude-haiku-4-5 --effort high --",
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
    await check("dry run with an agent override would rebuild", "WOULD REBUILD api for agent claude", ["launch", W, "--dry-run", "--agent", "api=claude", "--model", "api=haiku"]);
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
    has("claude started with its model", log, "pane run w9:p1 claude --dangerously-skip-permissions -n demo-lead --model claude-haiku-4-5");
    has("claude trust prompt answered", log, "pane send-keys w9:p1 down enter");
    has("claude settles before first prompt", log, "agent wait demo-lead --until idle --until blocked");
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

  test("a session.get failure falls back to session.list", async () => {
    clear(s.herdrLog);
    const done = await roster(["launch", W, "--member", "api"], { OC_GET_FAIL: "1" });
    exits("fallback launch passes", done.code, 0);
    has("fallback launches", done.out, "LAUNCHED api (opencode");
    lacks("fallback warns nothing", done.out, "could not verify the model switch");
    has("fallback reads session.list", read(s.opencodeLog), "api session.list");
    has("fallback sends the first prompt", read(s.herdrLog), "agent prompt demo-api Read your instructions");
  });

  test("a read-back that fails everywhere warns and still launches", async () => {
    clear(s.herdrLog);
    const done = await roster(["launch", W, "--member", "api"], { OC_GET_FAIL: "1", OC_LIST_FAIL: "1" });
    exits("unverified launch still passes", done.code, 0);
    has("unverified launch warns", done.out, "WARN opencode member 'api': could not verify the model switch");
    has("warn names session.get", done.out, "opencode api session.get");
    has("warn names session.list", done.out, "opencode api session.list");
    has("unverified launch still launches", done.out, "LAUNCHED api (opencode");
    has("unverified launch sends the first prompt", read(s.herdrLog), "agent prompt demo-api Read your instructions");
  });

  test("overrides rebuild and retune the member", async () => {
    await check("launch override rebuilds the member", "REBUILT api (claude)", ["launch", W, "--member", "api", "--agent", "api=claude", "--model", "api=haiku"]);
    has("override rebuild writes CLAUDE.md", `${exists(path.join(W, "api/CLAUDE.md"))} ${exists(path.join(W, "api/AGENTS.md"))}`, "true false");
    has("override shows in the squad directory", file("lead", "CLAUDE.md"), "`api` | claude | haiku |");
    has("override records agent and model", file("api", ".peers.json"), '"model": "haiku"');
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
    await check("effort-only override retunes", "SET lead's model to claude-haiku-4-5, effort low", ["launch", W, "--member", "lead", "--effort", "lead=low"]);
    has("effort recorded in .peers.json", file("lead", ".peers.json"), '"effort": "low"');
    has("squad directory shows the effort", file("api", "AGENTS.md"), "`lead` | claude | claude-haiku-4-5 | low |");
    has("claude gets the overridden effort", read(s.herdrLog), "--model claude-haiku-4-5 --effort low");
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

describe("herdr-core launch", () => {
  const stoppedHerdr = '{"sessions":[{"name":"default","default":true,"running":false}]}';
  const hcLive = (terminals: unknown[]) => ({
    HERDR_SESSIONS: stoppedHerdr,
    HC_LS_CODE: "0",
    HC_JSON: JSON.stringify({ terminals }),
  });
  const hcSpace = (spaces: unknown[]) => ({ HCAPP_JSON: JSON.stringify({ spaces }) });

  test("a dry run falls back to herdr-core tabs when the old server is stopped", async () => {
    clear(s.hcappLog);
    clear(s.herdrLog);
    const env = { ...hcLive([]), ...hcSpace([{ id: "sp-test", name: "squad-demo" }]) };
    const dry = (await roster(["launch", W, "--dry-run", "--member", "lead"], env)).out;
    has("hc fallback is announced", dry, "launching with herdr-core instead");
    has("hcx named in fallback note", dry, "notified with `hcx send`");
    has("tab opens via herdr-app", dry, "RUN herdr-app do tab.new --space sp-test");
    has("tab carries the agent argv", dry, "claude");
    has("first prompt sent untagged in dry run", dry, "RUN hcx send");
    has("hc launch reported", dry, "WOULD LAUNCH lead (claude");
    has("terminal named in output", dry, "terminal <lead>");
    has("space named in output", dry, "in Herdr app space squad-demo");
    lacks("dry run touches no old pane", read(s.herdrLog), "workspace create");
  });

  test("a full dry run opens the space first, then one tab per member", async () => {
    clear(s.hcappLog);
    const dry = (await roster(["launch", W, "--dry-run"], hcLive([]))).out;
    has("space opens first", dry, "RUN herdr-app do space.new --name squad-demo");
    has("further members open tabs", dry, "RUN herdr-app do tab.new --space");
    has("hc launch reported", dry, "WOULD LAUNCH lead (claude");
    has("hc backend named", dry, "OK 3 of 3 members, herdr-core (hc)");
  });

  test("a real run against the stubs notifies untagged over hcx", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    clear(s.hcappLog);
    clear(s.herdrLog);
    const env = { ...hcLive([]), ...hcSpace([{ id: "sp-test", name: "squad-demo" }]) };
    await check(
      "hc launch starts the member",
      "LAUNCHED docs (agy, model gem-fast, effort the agent's own default) in Herdr app space squad-demo",
      ["launch", W, "--member", "docs"],
      env,
    );
    has("tab opens via herdr-app", read(s.hcappLog), "do tab.new --space sp-test");
    has("first prompt sent untagged over hcx", read(s.hcxLog), "send t-test2 Read your instructions");
    lacks("hcx run sends no tagged prompt", read(s.hcLog), "send t-test2");
    lacks("real run touches no old pane", read(s.herdrLog), "agent start demo-docs");
  });

  test("without hcx the first prompt falls back to hc send", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    clear(s.hcappLog);
    clear(s.herdrLog);
    const noHcx = `${partialBin(s, "nohcx", ["npx", "claude", "opencode", "agy", "pi", "muse", "herdr", "hc", "herdr-app", "peers", "agent-shell"])}:/usr/bin:/bin`;
    const env = { ...hcLive([]), ...hcSpace([{ id: "sp-test", name: "squad-demo" }]), PATH: noHcx };
    await check(
      "hc fallback launch starts the member",
      "LAUNCHED docs (agy, model gem-fast, effort the agent's own default) in Herdr app space squad-demo",
      ["launch", W, "--member", "docs"],
      env,
    );
    has("first prompt sent over hc without hcx", read(s.hcLog), "send t-test2 Read your instructions");
    lacks("no hcx call without hcx", read(s.hcxLog), "send t-test2");
  });

  test("a failing hcx send falls back to hc send with a WARN", async () => {
    clear(s.hcLog);
    clear(s.hcxLog);
    clear(s.hcappLog);
    clear(s.herdrLog);
    const env = { ...hcLive([]), ...hcSpace([{ id: "sp-test", name: "squad-demo" }]), HCX_FAIL: "1" };
    const done = await roster(["launch", W, "--member", "docs"], env);
    has("launch carries on after hcx fails", done.out, "LAUNCHED docs (agy, model gem-fast");
    has("hcx failure warns", done.out, "WARN `hcx send t-test2` failed (exit 1)");
    has("hcx names the fallback", done.out, "falling back to `hc send`");
    has("hcx was tried first", read(s.hcxLog), "send t-test2 Read your instructions");
    has("first prompt still sent over hc", read(s.hcLog), "send t-test2 Read your instructions");
  });

  test("a member launch needs its squad space", async () => {
    await check(
      "hc member without a space",
      "no Herdr app space named squad-demo; launch the whole squad first",
      ["launch", W, "--member", "lead"],
      hcLive([]),
    );
  });

  test("an existing space or running terminal is refused", async () => {
    await check(
      "hc full launch names the existing space",
      "already has a space named squad-demo",
      ["launch", W],
      { ...hcLive([]), ...hcSpace([{ id: "sp-test", name: "squad-demo" }]) },
    );
    const running = {
      ...hcLive([{ address: "t5", name: "demo-lead", cwd: `${W}/lead`, state: "live" }]),
      ...hcSpace([{ id: "sp-test", name: "squad-demo" }]),
    };
    await check(
      "hc member still running",
      "already runs as hc terminal t5",
      ["launch", W, "--member", "lead"],
      running,
    );
  });
});

describe("display names", () => {
  test("validation, files, and launch labels", async () => {
    edit(s, (r) => (m(r, 0).display_name = "Lena | lead"));
    await check("display name rejects |", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => (m(r, 0).display_name = "x".repeat(49)));
    await check("display name too long", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => (m(r, 0).display_name = "Rina Putri"));
    await check("display name rejects a space", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => (m(r, 0).display_name = "Rina\tP"));
    await check("display name rejects a tab", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => (m(r, 0).display_name = "Rina (lead)"));
    await check("display name rejects a role", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => (m(r, 0).display_name = "Rina\u00a0Putri"));
    await check("display name rejects unicode whitespace", '"display_name" must be a human-readable name', ["check", W]);
    edit(s, (r) => {
      m(r, 0).display_name = " Rina ";
      m(r, 1).display_name = "Mary-Ann";
    });
    await check("surrounding spaces are stripped, hyphenated name accepted", "OK 3 members", ["check", W]);
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
    edit(s, (r) => (m(r, 2).skills = [{ source: "acme/skills", skill: "agent-shell" }]));
    await check("agent-shell is not listed by hand", 'lists agent-shell, which every member gets; set "agent_shell_source" instead', ["check", W]);
  });
});

describe("removed agent-job", () => {
  const removed = 'agent-job was removed; delete "agent_job_source"';
  test("a roster that still names agent-job is rejected with one PROBLEM line", async () => {
    edit(s, (r) => {
      delete m(r, 2).skills;
      (r as Record<string, unknown>).agent_job_source = "acme/skills";
    });
    const keyed = await roster(["check", W]);
    exits("agent_job_source exits 1", keyed.code, 1);
    has("agent_job_source is rejected", keyed.out, removed);
    edit(s, (r) => {
      delete (r as Record<string, unknown>).agent_job_source;
      m(r, 2).skills = [{ source: "acme/skills", skill: "agent-job" }];
    });
    const listed = await roster(["check", W]);
    exits("listed agent-job exits 1", listed.code, 1);
    has("listed agent-job is rejected", listed.out, removed);
    edit(s, (r) => {
      (r as Record<string, unknown>).agent_job_source = "acme/skills";
    });
    const both = await roster(["check", W]);
    exits("key and skill together exit 1", both.code, 1);
    has("key and skill together print one PROBLEM line", String(both.out.split(removed).length - 1), "1");
    edit(s, (r) => {
      delete (r as Record<string, unknown>).agent_job_source;
      delete m(r, 2).skills;
    });
    await check("clean roster passes again", "OK 3 members", ["check", W]);
  });
});

describe("the peers CLI", () => {
  test("build installs it when it is missing", async () => {
    edit(s, (r) => delete m(r, 2).skills);
    const noPeers = `${partialBin(s, "nopeers", ["npx", "claude", "opencode", "agy", "herdr", "agent-shell"])}:/usr/bin:/bin`;
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
    fs.rmSync(path.join(W, "lead", ".mcp.json"), { force: true });
    const installed = (await roster(["build", W, "--member", "lead"], env())).out;
    has("build installs a missing peers CLI", installed, `INSTALLED peers 0.0.1 at ${home}/.local/bin/peers`);
    has("the install warns when its directory is not on PATH", installed, "is not on PATH, so members cannot run `peers`");
    lacks("claude needs no .mcp.json", String(exists(path.join(W, "lead", ".mcp.json"))), "true");
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

describe("the agent-shell CLI", () => {
  test("build installs it when it is missing, and launch needs it", async () => {
    edit(s, (r) => delete m(r, 2).skills);
    const noShell = `${partialBin(s, "noshell", ["npx", "claude", "opencode", "agy", "herdr", "peers"])}:${path.dirname(process.execPath)}:/usr/bin:/bin`;
    const home = path.join(s.tmp, "shellhome");
    const installer = path.join(s.tmp, "agent-shell-installer.sh");
    write(installer, AGENT_SHELL_INSTALLER);
    const env = (more: Record<string, string> = {}) => ({
      PATH: noShell,
      HOME: home,
      GITHUB_TOKEN: "",
      AGENT_SHELL_INSTALL_DIR: "",
      AGENT_SHELL_INSTALLER_URL: `file://${installer}`,
      ...more,
    });
    await check("check notes a missing agent-shell CLI", `NOTE the agent-shell CLI is not installed; build installs it with file://${installer}`, ["check", W], env());
    await check("launch needs the agent-shell CLI", "the agent-shell CLI is not installed; run", ["launch", W, "--dry-run"], env());
    await check("a failed agent-shell install shows its output", "agent-shell-install: error: no release", ["build", W, "--member", "lead"], env({ INSTALLER_FAIL: "1" }));
    await check(
      "agent-shell needs bun",
      "it needs bun on PATH to run",
      ["build", W, "--member", "lead"],
      env({ PATH: `${partialBin(s, "noshellnobun", ["npx", "claude", "opencode", "agy", "herdr", "peers"])}:/usr/bin:/bin` }),
    );
    const installed = (await roster(["build", W, "--member", "lead"], env())).out;
    has("build installs a missing agent-shell CLI", installed, `INSTALLED agent-shell 0.0.1 at ${home}/.local/bin/agent-shell`);
    has("the install warns when its directory is not on PATH", installed, "is not on PATH, so members cannot run `agent-shell`");
    has("agent-shell skill installed for the rebuilt member", String(exists(path.join(W, "lead/.claude/skills/agent-shell/SKILL.md"))), "true");
    lacks("an installed agent-shell CLI is not installed again", (await roster(["build", W, "--member", "lead"], env())).out, "INSTALLED agent-shell");
    await roster(["build", W, "--member", "lead"]);
  });
});

describe("member sessions", () => {
  const sessHome = () => path.join(s.tmp, "sesshome");
  const sessEnv = (more: Record<string, string | undefined> = {}) => ({ HOME: sessHome(), ...more });

  function fixtureSessions(opencode: unknown, claude: unknown) {
    fs.mkdirSync(sessHome(), { recursive: true });
    write(path.join(sessHome(), "opencode-sessions.json"), JSON.stringify(opencode));
    write(path.join(sessHome(), "claude-agents.json"), JSON.stringify(claude));
  }

  function fixtureAgy(dir: string, id: string, cwd: string) {
    const db = path.join(dir, "conversation_summaries.db");
    const conn = new Database(db, { create: true });
    conn.exec("CREATE TABLE conversation_summaries (conversation_id TEXT, workspace_uris TEXT)");
    conn.query("INSERT INTO conversation_summaries (conversation_id, workspace_uris) VALUES (?, ?)").run(id, JSON.stringify([`file://${cwd}`]));
    conn.close();
  }

  function team() {
    setRoster(s, {
      squad: "demo",
      goal: "Ship it.",
      members: [
        { name: "lead", agent: "claude", model: "haiku", cwd: "lead", summary: "Leads", reports_to: "user", talks_to: ["api", "docs"] },
        { name: "api", agent: "opencode", model: "opencode/big-pickle", cwd: "api", summary: "Builds the API", reports_to: "lead" },
        { name: "docs", agent: "agy", cwd: "docs", summary: "Writes docs", reports_to: "lead" },
      ],
    });
    member(s, "lead", "Assign work to api and docs. Report to the user.");
    member(s, "api", "Report to lead.");
    member(s, "docs", "Report to lead.");
  }

  test("check validates the session shape", async () => {
    team();
    edit(s, (r) => { m(r, 1).session = "ses_old"; });
    await check("session must be an object", '"session" must be {"runtime": <agent>, "id": <session id>}', ["check", W]);
    edit(s, (r) => { m(r, 1).session = { runtime: "opencode" }; });
    await check("session needs an id", '"session" must be {"runtime": <agent>, "id": <session id>}', ["check", W]);
    edit(s, (r) => { m(r, 1).session = { runtime: "nope", id: "ses_old" }; });
    await check("session runtime must be an agent", '"session".runtime \'nope\' is not an agent', ["check", W]);
    edit(s, (r) => { delete m(r, 1).session; });
    await check("valid team again", "OK 3 members", ["check", W]);
  });

  test("check warns on a runtime mismatch and a dead session", async () => {
    edit(s, (r) => { m(r, 1).session = { runtime: "claude", id: "zzz" }; });
    const mismatched = (await roster(["check", W], sessEnv())).out;
    has("runtime mismatch warns", mismatched, "member 'api': session records runtime 'claude' but the member runs on 'opencode'");
    fixtureSessions([], []);
    edit(s, (r) => { m(r, 1).session = { runtime: "opencode", id: "ses_old" }; });
    const dead = (await roster(["check", W], sessEnv())).out;
    has("dead session warns", dead, "member 'api': session opencode:ses_old is not live");
    edit(s, (r) => { delete m(r, 1).session; });
  });

  test("launch records each member's session in roster.json", async () => {
    await roster(["build", W]);
    fixtureSessions([], [{ sessionId: "claude-1", cwd: path.join(W, "lead") }]);
    const agyHome = path.join(s.tmp, "agyhome");
    fs.mkdirSync(agyHome, { recursive: true });
    fixtureAgy(agyHome, "agy-1", path.join(W, "docs"));
    const done = await roster(["launch", W], { ...sessEnv(), AGY_HOME: agyHome });
    exits("launch records sessions", done.code, 0);
    has("opencode session recorded", done.out, "RECORDED api: session opencode:ses_test1 in roster.json");
    has("claude session recorded", done.out, "RECORDED lead: session claude:claude-1 in roster.json");
    has("agy session recorded", done.out, "RECORDED docs: session agy:agy-1 in roster.json");
    const saved = JSON.parse(read(path.join(W, "roster.json"))) as { members: { name: string; session?: unknown }[] };
    const at = (name: string) => saved.members.find((mm) => mm.name === name)?.session;
    has("api session saved", JSON.stringify(at("api")), '{"runtime":"opencode","id":"ses_test1"}');
    has("lead session saved", JSON.stringify(at("lead")), '{"runtime":"claude","id":"claude-1"}');
    has("docs session saved", JSON.stringify(at("docs")), '{"runtime":"agy","id":"agy-1"}');
  });

  test("launch notes sessions that are already live", async () => {
    fixtureSessions(
      [{ id: "ses_test1", directory: path.join(W, "api") }],
      [{ sessionId: "claude-1", cwd: path.join(W, "lead") }],
    );
    const agyEmpty = path.join(s.tmp, "agyempty");
    fs.mkdirSync(agyEmpty, { recursive: true });
    const done = await roster(["launch", W, "--dry-run"], { ...sessEnv(), AGY_HOME: agyEmpty });
    exits("dry run passes", done.code, 0);
    has("opencode already live", done.out, "member 'api': session opencode:ses_test1 is already live");
    has("claude already live", done.out, "member 'lead': session claude:claude-1 is already live");
  });
});

describe("runtime session lookup", () => {
  function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const before: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
      before[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      fn();
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  test("pi sessions come from their session files; liveness is unknown", () => {
    const root = path.join(s.tmp, "pisess");
    const cwd = path.join(s.tmp, "squad", "w");
    withEnv({ PI_CODING_AGENT_SESSION_DIR: root }, () => {
      if (findSession("pi", cwd) !== null) throw new Error("no pi session yet");
      fs.mkdirSync(root, { recursive: true });
      const head = JSON.stringify({ type: "session", id: "pi-9", cwd }) + "\n";
      fs.writeFileSync(path.join(root, "20240101-000000_pi-9.jsonl"), `${head}{"type":"message"}\n`);
      if (findSession("pi", cwd) !== "pi-9") throw new Error("wanted pi-9");
      if (findSession("pi", path.join(s.tmp, "elsewhere")) !== null) throw new Error("wrong cwd must not match");
      if (sessionLive("pi", "pi-9") !== null) throw new Error("pi liveness is unknown");
    });
  });

  test("agy conversations resolve by workspace; liveness is unknown", () => {
    const agyHome = path.join(s.tmp, "agyunit");
    fs.mkdirSync(agyHome, { recursive: true });
    const cwd = path.join(s.tmp, "squad", "w");
    const conn = new Database(path.join(agyHome, "conversation_summaries.db"), { create: true });
    conn.exec("CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, preview TEXT, last_modified_time TEXT, workspace_uris TEXT, status TEXT)");
    conn.query("INSERT INTO conversation_summaries (conversation_id, workspace_uris, status) VALUES (?, ?, ?)").run("agy-7", JSON.stringify([`file://${cwd}`]), "SUCCESS");
    conn.close();
    withEnv({ AGY_HOME: agyHome }, () => {
      if (findSession("agy", cwd) !== "agy-7") throw new Error("wanted agy-7");
      if (sessionLive("agy", "agy-7") !== null) throw new Error("agy liveness is unknown");
    });
  });

  test("muse sessions resolve by workspace and lease", () => {
    const xdg = path.join(s.tmp, "xdg");
    const cwd = path.join(s.tmp, "squad", "w");
    const db = path.join(xdg, "muse", "session-index.db");
    fs.mkdirSync(path.dirname(db), { recursive: true });
    const conn = new Database(db, { create: true });
    conn.exec("CREATE TABLE sessions (session_id TEXT, title TEXT, workspace_root TEXT, session_log_path TEXT, updated_at_us INTEGER)");
    conn.query("INSERT INTO sessions (session_id, workspace_root) VALUES (?, ?)").run("mus-1", cwd);
    conn.close();
    const rt = path.join(xdg, "muse", "runtime", "muse");
    fs.mkdirSync(path.join(rt, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(rt, "sessions", "mus-1.json"), JSON.stringify({ endpoint_hint: "h1" }));
    withEnv({ XDG_DATA_HOME: xdg }, () => {
      if (findSession("muse", cwd) !== "mus-1") throw new Error("wanted mus-1");
      fs.writeFileSync(path.join(rt, "h1.lease"), JSON.stringify({ pid: process.pid }));
      if (sessionLive("muse", "mus-1") !== true) throw new Error("own process lease is live");
      fs.writeFileSync(path.join(rt, "h1.lease"), JSON.stringify({ pid: 2147483647 }));
      if (sessionLive("muse", "mus-1") !== false) throw new Error("dead lease is not live");
      if (sessionLive("muse", "mus-x") !== false) throw new Error("unknown session is not live");
    });
    withEnv({ XDG_DATA_HOME: path.join(s.tmp, "xdg-missing") }, () => {
      if (sessionLive("muse", "mus-1") !== null) throw new Error("missing index is unknown");
    });
  });

  test("unknown runtimes resolve to nothing", () => {
    if (findSession("nope", s.tmp) !== null) throw new Error("unknown runtime has no sessions");
    if (sessionLive("nope", "x") !== null) throw new Error("unknown runtime liveness is unknown");
  });
});

describe("opencode service environment", () => {
  const secret = "roster-test-secret-123";
  // A fake ps: runtime-set variables are invisible to the real ps, so the stub
  // reports the service environment from the test's own variables, by name only.
  const PS = `#!/bin/bash
echo "  PID   TT  STAT      TIME COMMAND"
echo "  999999999   ??  Ss    0:00.01 opencode service"
[ -n "\${ROSTER_TEST_API_KEY:-}" ] && echo "ROSTER_TEST_API_KEY=present"
exit 0
`;
  const tools = ["npx", "claude", "opencode", "agy", "pi", "muse", "herdr", "peers", "agent-shell"];

  function fakeHome(name: string, withPid: boolean) {
    const home = path.join(s.tmp, name);
    write(
      path.join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ providers: { opencode: { env: ["ROSTER_TEST_API_KEY"] } } }),
    );
    if (withPid) {
      write(path.join(home, ".local", "state", "opencode", "service.json"), JSON.stringify({ pid: 999999999 }));
    }
    return home;
  }

  function fakeEnv(home: string) {
    const dir = partialBin(s, "envps", tools);
    write(path.join(dir, "ps"), PS);
    fs.chmodSync(path.join(dir, "ps"), 0o755);
    return { PATH: `${dir}:/usr/bin:/bin`, HOME: home };
  }

  function fakeTeam() {
    setRoster(s, {
      squad: "demo",
      goal: "Ship it.",
      members: [
        { name: "lead", agent: "claude", model: "haiku", cwd: "lead", summary: "Leads", reports_to: "user", talks_to: ["api"] },
        { name: "api", agent: "opencode", model: "opencode/big-pickle", cwd: "api", summary: "Builds the API", reports_to: "lead" },
      ],
    });
    member(s, "lead", "Assign work to api. Report to the user.");
    member(s, "api", "Report to lead.");
  }

  test("a key the service has warns nothing and leaks no value", async () => {
    fakeTeam();
    await roster(["build", W]);
    const done = await roster(["launch", W, "--dry-run", "--member", "api"], {
      ...fakeEnv(fakeHome("env-present", true)),
      ROSTER_TEST_API_KEY: secret,
    });
    exits("present key passes", done.code, 0);
    lacks("present key warns nothing", done.out, "WARN");
    lacks("present key leaks no value", done.out, secret);
  });

  test("a key the service misses warns without the value and carries on", async () => {
    const done = await roster(["launch", W, "--dry-run", "--member", "api"], {
      ...fakeEnv(fakeHome("env-missing", true)),
      ROSTER_TEST_API_KEY: undefined,
    });
    exits("missing key still passes", done.code, 0);
    has("missing key warns", done.out, "WARN the OpenCode background service (pid 999999999)");
    has("warn names the variable", done.out, "ROSTER_TEST_API_KEY");
    has("warn names the fix", done.out, "opencode service stop && opencode service start");
    lacks("warn leaks no value", done.out, secret);
  });

  test("no service pid notes and carries on", async () => {
    const done = await roster(["launch", W, "--dry-run", "--member", "api"], {
      ...fakeEnv(fakeHome("env-nopid", false)),
      ROSTER_TEST_API_KEY: undefined,
    });
    exits("missing pid still passes", done.code, 0);
    has("missing pid notes", done.out, "NOTE could not check the OpenCode service environment");
    lacks("missing pid warns nothing", done.out, "WARN");
  });
});
