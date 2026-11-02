import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAIN = path.join(import.meta.dir, "..", "src", "main.ts");
const REAL = path.join(import.meta.dir, "..", "..", "..", "templates");
let ws = "";

function t(args: string[], env: Record<string, string> = {}) {
  const r = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, TEMPLATES_DIR: REAL, ...env } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-"));
  fs.writeFileSync(path.join(ws, "roster.json"), JSON.stringify({ squad: "s", goal: "g", members: [{ name: "lead", cwd: "lead", summary: "x", reports_to: "user", talks_to: [] }] }));
});

describe("shipped templates", () => {
  test("are well formed", () => expect(t(["validate"]).code).toBe(0));
  test("list names the three templates", () => {
    const o = t(["list"]).out;
    for (const n of ["explore", "font-design-critic", "drifting-check-auditor", "tasks-scout"]) expect(o).toContain(n);
  });
  test("role and requests print their files", () => {
    expect(t(["role", "font-design-critic"]).out).toContain("# Font-design critic");
    expect(t(["requests", "tasks-scout"]).out).toContain("# Requests");
  });
});

describe("apply", () => {
  test("writes the files and the roster entry", () => {
    const r = t(["apply", "tasks-scout", "--workspace", ws, "--member", "scout", "--talks-to", "lead"]);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(ws, "scout", "ROLE.md"), "utf8")).toContain("evidence-only");
    const comms = fs.readFileSync(path.join(ws, "scout", "COMMUNICATIONS.md"), "utf8");
    expect(comms).toContain("You report to `lead`");
    expect(comms).toContain("You may message `lead` directly");
    expect(comms).not.toContain("{{");
    const roster = JSON.parse(fs.readFileSync(path.join(ws, "roster.json"), "utf8"));
    const m = roster.members.find((x: { name: string }) => x.name === "scout");
    expect(m).toMatchObject({ cwd: "scout", reports_to: "lead", talks_to: ["lead"], effort: "high" });
  });
  test("refuses an unknown link, a duplicate member and an overwrite", () => {
    expect(t(["apply", "tasks-scout", "--workspace", ws, "--member", "scout", "--reports-to", "ghost"]).out).toContain("neither");
    expect(t(["apply", "tasks-scout", "--workspace", ws, "--member", "lead"]).out).toContain("already has a member");
    fs.mkdirSync(path.join(ws, "scout"));
    fs.writeFileSync(path.join(ws, "scout", "ROLE.md"), "mine");
    const r = t(["apply", "tasks-scout", "--workspace", ws, "--member", "scout"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("--force");
    expect(fs.readFileSync(path.join(ws, "scout", "ROLE.md"), "utf8")).toBe("mine");
  });
  test("needs a roster and valid names", () => {
    expect(t(["apply", "nope", "--workspace", ws, "--member", "a"]).out).toContain("Available");
    expect(t(["apply", "tasks-scout", "--workspace", path.join(ws, "none"), "--member", "a"]).out).toContain("No roster");
    expect(t(["apply", "tasks-scout", "--workspace", ws, "--member", "Bad Name"]).code).toBe(2);
  });
});

describe("validate", () => {
  test("flags a broken template", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tplbad-"));
    fs.mkdirSync(path.join(d, "x"));
    fs.writeFileSync(path.join(d, "x", "template.json"), JSON.stringify({ name: "y", summary: "", reports_to: "lead", talks_to: [], skills: [] }));
    const r = t(["validate"], { TEMPLATES_DIR: d });
    expect(r.code).toBe(1);
    expect(r.out).toContain("does not match the directory");
    expect(r.out).toContain("missing ROLE.md");
  });
});
