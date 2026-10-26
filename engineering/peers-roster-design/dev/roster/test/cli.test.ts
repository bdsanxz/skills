// Help at every level, wrong usage, the Python text forms the output depends on, and the built
// scripts/roster.js run as a real process.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { WIDTH, parseCommand } from "../src/args";
import { COMMANDS, top } from "../src/commands";
import { PROG, SCRIPT, dumps, repr, shlexJoin, strip } from "../src/core";
import { roster } from "./harness";

const HELP_FORMS = (name: string) => [[name, "--help"], [name, "-h"], ["help", name]];

function examplesOf(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim().startsWith(`bun scripts/${PROG} `))
    .map((line) => line.trim().split(/\s+/).slice(2));
}

describe("help", () => {
  test("the top level: --help, -h, help, and no arguments", async () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const done = await roster(args);
      expect([args, done.code, done.stderr]).toEqual([args, 0, ""]);
      expect(done.stdout).toBe(top() + "\n");
    }
    const bare = await roster([]);
    expect(bare.code).toBe(2);
    expect(bare.stdout).toBe(top() + "\n");
    const text = top();
    for (const command of COMMANDS) expect(text).toContain(`  ${command.name}`);
    for (const section of ["typical workflow", "files:", "exit codes:", "examples:", "effort levels:", "layout:"]) {
      expect(text).toContain(section);
    }
  });

  test("every command: --help, -h and help COMMAND give the same text", async () => {
    for (const command of COMMANDS) {
      const texts = new Set<string>();
      for (const args of HELP_FORMS(command.name)) {
        const done = await roster(args);
        expect([args, done.code, done.stderr]).toEqual([args, 0, ""]);
        texts.add(done.stdout);
      }
      expect(texts.size).toBe(1);
      const text = [...texts][0]!;
      expect(text).toStartWith(`usage: ${PROG} ${command.name} [-h]`);
      for (const section of ["arguments:", "options:", "output:", "exit codes:", "examples:"]) expect(text).toContain(section);
      for (const option of command.options) expect([command.name, text.includes(option.name)]).toEqual([command.name, true]);
      for (const positional of command.positionals) expect(text).toContain(positional.metavar);
      const examples = examplesOf(text);
      expect(examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("help runs nothing else, even with other arguments", async () => {
    const done = await roster(["build", "/nowhere", "--member", "x", "--help"]);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("usage: roster.js build");
  });

  test("every line of every help fits in 88 columns", () => {
    const texts = [top()];
    for (const command of COMMANDS) {
      try {
        parseCommand(PROG, command, ["--help"]);
      } catch (help) {
        texts.push((help as Error).message);
      }
    }
    for (const text of texts) {
      for (const line of text.split("\n")) expect([line, line.length <= WIDTH]).toEqual([line, true]);
    }
  });

  test("every example in every help parses without a usage error", () => {
    const texts = [top()];
    for (const command of COMMANDS) {
      try {
        parseCommand(PROG, command, ["--help"]);
      } catch (help) {
        texts.push((help as Error).message);
      }
    }
    let count = 0;
    for (const text of texts) {
      for (const [name, ...args] of examplesOf(text)) {
        const command = COMMANDS.find((item) => item.name === name);
        expect([name, Boolean(command)]).toEqual([name, true]);
        expect(() => parseCommand(PROG, command!, args)).not.toThrow();
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(12);
  });

  test("defaults and repeatable options are shown", async () => {
    const text = (await roster(["launch", "--help"])).stdout.replace(/\s+/g, " ");
    expect(text).toContain("[default: every member]");
    expect(text).toContain("[default: herdr's default session]");
    expect(text).toContain("[repeatable]");
    expect(text).toContain("low, medium, high, xhigh, max");
  });
});

describe("wrong usage", () => {
  const wrong = async (args: string[], message: string, helpFor: string) => {
    const done = await roster(args);
    expect([args, done.code, done.stdout]).toEqual([args, 2, ""]);
    expect(done.stderr).toContain(message);
    expect(done.stderr).toContain(`Run '${helpFor} --help' for help.`);
    return done.stderr;
  };

  test("a missing workspace names it, with the usage line", async () => {
    const err = await wrong(["check"], "roster.js check: error: the following arguments are required: WORKSPACE", "roster.js check");
    expect(err).toStartWith("usage: roster.js check [-h]");
  });

  test("an unknown command suggests the closest", async () => {
    await wrong(["chek", "x"], "invalid choice: 'chek' (choose from 'check', 'assemble', 'build', 'launch'); did you mean 'check'?", "roster.js");
    const far = await wrong(["deploy"], "invalid choice: 'deploy'", "roster.js");
    expect(far).not.toContain("did you mean");
    await wrong(["help", "lanch"], "did you mean 'launch'?", "roster.js");
  });

  test("an unknown option suggests the closest", async () => {
    await wrong(["launch", "/w", "--dryrun"], "unrecognized arguments: --dryrun; did you mean --dry-run?", "roster.js launch");
    await wrong(["build", "/w", "--agent", "api=agy"], "unrecognized arguments: --agent", "roster.js build");
    await wrong(["check", "/w", "extra"], "unrecognized arguments: extra", "roster.js check");
  });

  test("option values", async () => {
    await wrong(["check", "/w", "--model", "haiku"], "argument --model: 'haiku' must be MEMBER=VALUE, such as web=opencode or web=high", "roster.js check");
    await wrong(["check", "/w", "--effort", "web= "], "must be MEMBER=VALUE", "roster.js check");
    await wrong(["check", "/w", "--agent", "web=two words"], "must be MEMBER=VALUE", "roster.js check");
    await wrong(["launch", "/w", "--session"], "argument --session: expected one argument", "roster.js launch");
    await wrong(["launch", "/w", "--dry-run=1"], "argument --dry-run: ignored explicit argument '1'", "roster.js launch");
  });

  test("unique prefixes, --opt=value and repeated options are accepted", () => {
    const launch = COMMANDS.find((command) => command.name === "launch")!;
    const args = parseCommand(PROG, launch, ["/w", "--dry", "--agent=web=agy", "--effort", "web=low", "--effort", "lead=max", "--sess", "s"]);
    expect(args).toMatchObject({ workspace: "/w", dryRun: true, session: "s", agent: [["web", "agy"]], effort: [["web", "low"], ["lead", "max"]] });
  });
});

describe("failed requests", () => {
  test("a missing roster says what to do", async () => {
    const done = await roster(["check", "/nowhere/at/all"]);
    expect([done.code, done.stdout]).toEqual([1, ""]);
    expect(done.stderr).toBe("roster: error: /nowhere/at/all/roster.json does not exist; write the roster first\n");
  });

  test("roster.json that is not JSON names the file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-cli-"));
    try {
      fs.writeFileSync(path.join(dir, "roster.json"), "{nope");
      const done = await roster(["check", dir]);
      expect(done.code).toBe(1);
      expect(done.stderr).toContain(`roster: error: ${dir}/roster.json is not valid JSON (`);
      expect(done.stderr).toContain("fix it, then run the command again");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Python's text forms", () => {
  test("repr of strings and JSON values", () => {
    expect(repr("lead")).toBe("'lead'");
    expect(repr("O'Neil")).toBe(`"O'Neil"`);
    expect(repr(`it's "x"`)).toBe(`'it\\'s "x"'`);
    expect(repr("a\nb\t\\")).toBe("'a\\nb\\t\\\\'");
    expect(repr("J\u00fcrgen\u00a0x\u2028")).toBe("'J\u00fcrgen\\xa0x\\u2028'");
    expect(repr({ providerID: "opencode", id: "other", n: 1, ok: true, no: null, list: ["a"] })).toBe(
      "{'providerID': 'opencode', 'id': 'other', 'n': 1, 'ok': True, 'no': None, 'list': ['a']}",
    );
  });

  test("json.dumps, with and without indent", () => {
    expect(dumps({ model: { providerID: "opencode", id: "beam-free" } })).toBe('{"model": {"providerID": "opencode", "id": "beam-free"}}');
    expect(dumps({ a: [], b: {}, c: "J\u00fcrgen \"x\"\n" }, 2)).toBe('{\n  "a": [],\n  "b": {},\n  "c": "J\\u00fcrgen \\"x\\"\\n"\n}');
    expect(dumps({ a: [1, { b: true }] }, 2)).toBe('{\n  "a": [\n    1,\n    {\n      "b": true\n    }\n  ]\n}');
  });

  test("shlex.join and str.strip", () => {
    expect(shlexJoin(["agent", "start", "<pane-2>", "it's", "", "a=b,c/d:e@f%g+h"])).toBe(
      `agent start '<pane-2>' 'it'"'"'s' '' a=b,c/d:e@f%g+h`,
    );
    expect(strip("\x1c x \u3000")).toBe("x");
  });
});

describe("the built script", () => {
  const runBuilt = (...args: string[]) => {
    const done = Bun.spawnSync(["bun", SCRIPT, ...args], { env: { ...process.env } });
    return [done.exitCode, done.stdout.toString(), done.stderr.toString()] as const;
  };

  test("it is up to date with the source", () => {
    const built = fs.statSync(SCRIPT).mtimeMs;
    const sourceDir = path.join(import.meta.dir, "..", "src");
    for (const name of fs.readdirSync(sourceDir)) {
      expect([name, fs.statSync(path.join(sourceDir, name)).mtimeMs <= built]).toEqual([name, true]);
    }
    expect(fs.readFileSync(SCRIPT, "utf8")).toStartWith("#!/usr/bin/env bun\n// Built from dev/roster/src");
    expect(fs.statSync(SCRIPT).mode & 0o777).toBe(0o755);
  });

  test("it imports only Bun and Node built-ins", () => {
    const code = fs.readFileSync(SCRIPT, "utf8");
    const imports = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]!);
    const builtIn = (name: string) => /^(node:|bun(:|$))/.test(name) || builtinModules.includes(name);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect([name, builtIn(name)]).toEqual([name, true]);
  });

  test("it runs as a program", () => {
    let [code, out, err] = runBuilt("--help");
    expect([code, err]).toEqual([0, ""]);
    expect(out).toContain("typical workflow");
    [code, out] = runBuilt("launch", "--help");
    expect(code).toBe(0);
    expect(out).toContain("--dry-run");
    [code, , err] = runBuilt("check");
    expect(code).toBe(2);
    expect(err).toContain("the following arguments are required: WORKSPACE");
    [code, out, err] = runBuilt("check", "/nowhere/at/all");
    expect([code, out]).toEqual([1, ""]);
    expect(err).toContain("does not exist; write the roster first");
  });

  test("it knows its own path, for the hint in every generated file", () => {
    expect(SCRIPT).toBe(path.resolve(import.meta.dir, "..", "..", "..", "scripts", "roster.js"));
  });
});
