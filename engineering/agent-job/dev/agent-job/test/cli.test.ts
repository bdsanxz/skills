import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.ts";

const MAIN = path.join(import.meta.dir, "..", "src", "main.ts");

function run(home: string, args: string[], stdin = "") {
  const p = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, AGENT_JOB_HOME: home }, stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

function homeWithGoal(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-job-cli-"));
  const store = new Store(home);
  store.insertGoal({ id: "g1", provider: "claude", session_id: "s1", cwd: "/", objective: "ship it", status: "active", turns: 0, max_turns: 2, compactions: -1, created_at: 1, updated_at: 1, note: "" });
  store.close();
  return home;
}

describe("claude goal hook", () => {
  test("Stop blocks with the continuation while the goal is active", () => {
    const r = run(homeWithGoal(), ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }));
    const reply = JSON.parse(r.out);
    expect(reply.decision).toBe("block");
    expect(reply.reason).toContain("ship it");
  });

  test("Stop queues the continuation for the channel instead of blocking when the session has a live lease", () => {
    const home = homeWithGoal();
    const store = new Store(home);
    store.takeLease("claude:s1", process.pid, "tok");
    store.close();
    const r = run(home, ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }));
    expect(r.out).toBe("");
    const check = new Store(home);
    const queued = check.pending("claude:s1");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.cron_id).toBe("g1");
    expect(queued[0]!.text).toContain("continuation 1 of 2");
    check.close();
  });

  test("the trace records the hook and the decision when it is on", () => {
    const home = homeWithGoal();
    fs.writeFileSync(path.join(home, "trace.on"), "");
    run(home, ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }));
    const lines = fs.readFileSync(path.join(home, "trace.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => `${l.source}:${l.event}`)).toEqual(["claude-hook:Stop", "goal:turn-end", "claude-hook:continuation"]);
    expect(lines[2].via).toBe("block");
  });

  test("Stop says nothing for another session, and when there is no database at all", () => {
    expect(run(homeWithGoal(), ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "Stop", session_id: "other" })).out).toBe("");
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "agent-job-cli-"));
    const r = run(empty, ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }));
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(empty, "agent-job.db"))).toBe(false);
  });

  test("SessionStart after compaction queues the goal for the channel when the session has a live lease", () => {
    const home = homeWithGoal();
    const store = new Store(home);
    store.takeLease("claude:s1", process.pid, "tok");
    store.close();
    const r = run(home, ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", source: "compact" }));
    expect(r.out).toBe("");
    const check = new Store(home);
    expect(check.pending("claude:s1")[0]!.text).toContain("context was compacted");
    check.close();
  });

  test("SessionStart after compaction adds the goal as context", () => {
    const r = run(homeWithGoal(), ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", source: "compact" }));
    const reply = JSON.parse(r.out);
    expect(reply.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(reply.hookSpecificOutput.additionalContext).toContain("context was compacted");
  });

  test("garbage on stdin never fails the runtime", () => {
    const r = run(homeWithGoal(), ["goal", "hook", "claude"], "not json");
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });
});

describe("goal commands", () => {
  test("done ends the goal, so the next Stop is allowed", () => {
    const home = homeWithGoal();
    expect(run(home, ["goal", "done", "g1", "--note", "verified"]).out).toBe("DONE g1");
    expect(run(home, ["goal", "hook", "claude"], JSON.stringify({ hook_event_name: "Stop", session_id: "s1" })).out).toBe("");
    expect(run(home, ["goal", "list", "--all"]).out).toContain("done");
  });
});

describe("antigravity goal hook", () => {
  const home = () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), "agent-job-agy-"));
    const store = new Store(h);
    store.insertGoal({ id: "g1", provider: "antigravity", session_id: "c1", cwd: "/", objective: "ship it", status: "active", turns: 0, max_turns: 5, compactions: -1, created_at: 1, updated_at: 1, note: "" });
    store.close();
    return h;
  };
  const hook = (h: string, event: string, payload: object) => run(h, ["goal", "hook", "antigravity", event], JSON.stringify({ conversationId: "c1", ...payload }));

  test("a normal end of turn continues; a cancel by the user does not", () => {
    const h = home();
    const reply = JSON.parse(hook(h, "Stop", { terminationReason: "NO_TOOL_CALL" }).out);
    expect(reply.decision).toBe("continue");
    expect(reply.reason).toContain("ship it");
    expect(hook(h, "Stop", { terminationReason: "USER_CANCELED" }).out).toBe("");
    expect(hook(h, "Stop", { terminationReason: "ERROR" }).out).toBe("");
  });

  test("a new compaction checkpoint in the transcript restates the goal, once", () => {
    const h = home();
    const transcript = path.join(h, "transcript.jsonl");
    fs.writeFileSync(transcript, '{"step_index":0,"type":"USER_INPUT"}\n');
    expect(hook(h, "PreInvocation", { transcriptPath: transcript }).out).toBe(""); // baseline
    fs.appendFileSync(transcript, '{"step_index":4,"source":"SYSTEM","type":"CHECKPOINT"}\n');
    const reply = JSON.parse(hook(h, "PreInvocation", { transcriptPath: transcript }).out);
    expect(reply.injectSteps[0].systemMessage.systemMessage).toContain("context was compacted");
    expect(hook(h, "PreInvocation", { transcriptPath: transcript }).out).toBe(""); // already acted on
  });

  test("the Stop that ends /compact restates the goal at once, and only once", () => {
    const h = home();
    const transcript = path.join(h, "transcript.jsonl");
    fs.writeFileSync(transcript, '{"step_index":0,"type":"USER_INPUT"}\n');
    expect(hook(h, "PreInvocation", { transcriptPath: transcript }).out).toBe(""); // baseline 0
    fs.appendFileSync(transcript, '{"step_index":4,"source":"SYSTEM","type":"CHECKPOINT"}\n');
    const reply = JSON.parse(hook(h, "Stop", { terminationReason: "TERMINAL_CUSTOM_HOOK", transcriptPath: transcript }).out);
    expect(reply.decision).toBe("continue");
    expect(reply.reason).toContain("context was compacted");
    expect(hook(h, "Stop", { terminationReason: "TERMINAL_CUSTOM_HOOK", transcriptPath: transcript }).out).toBe("");
    const next = JSON.parse(hook(h, "Stop", { terminationReason: "NO_TOOL_CALL", transcriptPath: transcript }).out);
    expect(next.reason).toContain("Condition not met yet");
  });

  test("another conversation is left alone", () => {
    expect(run(home(), ["goal", "hook", "antigravity", "Stop"], JSON.stringify({ conversationId: "other", terminationReason: "NO_TOOL_CALL" })).out).toBe("");
  });
});
