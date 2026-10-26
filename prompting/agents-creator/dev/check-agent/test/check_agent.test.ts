// Tests of the check_agent script: the Python suite it was ported from, the TOML parser,
// the help and wrong usage, and the built file run as a real process.
// Run: bun test (in dev/check-agent)

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "../src/args";
import { places } from "../src/check";
import { main, program, PROG } from "../src/cli";
import { io } from "../src/core";
import { pathParts, pathString, repr } from "../src/py";
import { loads } from "../src/toml";

const SKILL = path.resolve(import.meta.dir, "..", "..", "..");
const SCRIPT = path.join(SKILL, "scripts", "check_agent.js");
const EXAMPLES = {
  "claude-code": path.join(SKILL, "examples", "claude-code", "code-reviewer.md"),
  opencode: path.join(SKILL, "examples", "opencode", "code-reviewer.md"),
  codex: path.join(SKILL, "examples", "codex", "code-reviewer.toml"),
};
const PROTOCOL_FILE = path.join(SKILL, "references", "report-protocol.md");
const PROTOCOL_TEXT = fs.readFileSync(PROTOCOL_FILE, "utf8");
const PROTOCOL = PROTOCOL_TEXT.slice(
  PROTOCOL_TEXT.indexOf("<!-- BEGIN"),
  PROTOCOL_TEXT.indexOf("<!-- END REPORT PROTOCOL -->") + 28,
);
const filled = (name: string) => PROTOCOL.replaceAll("{{AGENT_NAME}}", name);

const STEPS = `# Explorer

You explore an area of the code and answer the questions in your prompt. You change no file.

## Steps

1. Start the report file.
2. Answer each question from the code, one at a time, and log each answer with paths and lines.
3. Finish the report.

## Report sections

1. Answers, one per question, with paths and lines.
2. Questions you could not answer, and why.

`;

const temporary: string[] = [];
afterAll(() => {
  for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
});

/** Run the script in this process: [exit code, stdout, stderr]. */
function runMain(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const saved = { ...io };
  io.out = (text) => void out.push(text + "\n");
  io.err = (text) => void err.push(text + "\n");
  try {
    return [main(args), out.join(""), err.join("")] as const;
  } finally {
    Object.assign(io, saved);
  }
}

/** Run the script on a file, as the Python suite did: [exit code, stdout + stderr]. */
function run(file: string, ...extra: string[]) {
  const [code, out, err] = runMain(file, ...extra);
  return [code, out + err] as const;
}

let tmp = "";
beforeEach(() => {
  places.protocolFile = PROTOCOL_FILE;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-agent-"));
  temporary.push(tmp);
});

function write(relative: string, text: string | Uint8Array) {
  const file = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function claude(
  front = "name: explorer\ndescription: Explores code. Give it the report file.\n",
  body: string | null = null,
  name = "explorer",
) {
  const text = body ?? STEPS + filled(name);
  return write(`.claude/agents/${name}.md`, `---\n${front}---\n\n${text}\n`);
}

// --------------------------------------------------------------------------- Claude Code

describe("Claude Code", () => {
  test("the examples pass", () => {
    for (const [platform, file] of Object.entries(EXAMPLES)) {
      const [code, out] = run(file, "--platform", platform);
      expect([platform, code, out]).toEqual([platform, 0, `ok: ${file} (${platform})\n`]);
    }
  });

  test("the location gives the platform", () => {
    const [code, out] = run(claude());
    expect([code, out]).toEqual([0, `ok: ${path.join(tmp, ".claude/agents/explorer.md")} (claude-code)\n`]);
  });

  test("an unknown location is wrong usage", () => {
    const [code, out] = run(write("elsewhere/explorer.md", "x"));
    expect(code).toBe(2);
    expect(out).toContain("--platform");
  });

  test("a missing protocol", () => {
    const [code, out] = run(claude(undefined, STEPS + "x".repeat(300)));
    expect(code).toBe(1);
    expect(out).toContain("do not hold the report protocol");
  });

  test("a changed protocol", () => {
    const [code, out] = run(claude(undefined, STEPS + filled("explorer").replace("at least every five", "every ten")));
    expect(code).toBe(1);
    expect(out).toContain("differs");
  });

  test("a placeholder left", () => {
    const [code, out] = run(claude(undefined, STEPS + PROTOCOL));
    expect(code).toBe(1);
    expect(out).toContain("{{AGENT_NAME}}");
  });

  test("tools without Edit", () => {
    const [code, out] = run(claude("name: explorer\ndescription: Explores. Give it the report file.\ntools: Read, Write\n"));
    expect(code).toBe(1);
    expect(out).toContain("does not include Edit");
  });

  test("tools as a list or a block", () => {
    let [code, out] = run(claude("name: explorer\ndescription: Give it the report file.\ntools: [Read, 'Write']\n"));
    expect(code).toBe(1);
    expect(out).toContain("does not include Edit");
    expect(out).not.toContain("does not include Write");
    [code, out] = run(claude("name: explorer\ndescription: Give it the report file.\ntools:\n  - Read\n  - \"Write\"\n  - Edit\n"));
    expect([code, out]).toEqual([0, expect.stringContaining("ok: ")]);
  });

  test("disallowed Write", () => {
    const [code, out] = run(claude("name: explorer\ndescription: Explores. Give it the report file.\ndisallowedTools: Write\n"));
    expect(code).toBe(1);
    expect(out).toContain("removes Write");
  });

  test("disallowed Edit with a pattern", () => {
    const [code, out] = run(claude("name: explorer\ndescription: Give it the report file.\ndisallowedTools: Bash, Edit(src/**)\n"));
    expect(code).toBe(1);
    expect(out).toContain("'disallowedTools' removes Edit");
  });

  test("a name that differs from the file", () => {
    const [code, out] = run(claude("name: other\ndescription: Explores. Give it the report file.\n"));
    expect(code).toBe(1);
    expect(out).toContain("name the file 'other.md'");
  });

  test("an unindented description", () => {
    const front = "name: explorer\ndescription: Explores. Give it the report file. Examples:\n\n<example>\nContext: x\n";
    const [code, out] = run(claude(front));
    expect(code).toBe(1);
    expect(out).toContain("does not parse");
    expect(out).toContain("frontmatter line 5 is not 'field: value'");
  });

  test("an unknown field", () => {
    const [code, out] = run(claude("name: explorer\ndescription: Explores. Give it the report file.\nmax_turns: 3\n"));
    expect(code).toBe(1);
    expect(out).toContain("max_turns");
  });

  test("unknown fields are listed in code point order", () => {
    const [, out] = run(claude("name: explorer\ndescription: Give it the report file.\nzeta: 1\nAlpha: 2\n_x: 3\n"));
    const order = [...out.matchAll(/the field '([^']+)'/g)].map((match) => match[1]);
    expect(order).toEqual(["Alpha", "_x", "zeta"]);
  });

  test("a description without a report file", () => {
    const [code, out] = run(claude("name: explorer\ndescription: Explores code.\n"));
    expect(code).toBe(1);
    expect(out).toContain("name a report file");
  });

  test("a block description is read across its lines", () => {
    const [code, out] = run(claude("name: \"explorer\"\ndescription: |\n  Explores code.\n  Give it the Report File.\n"));
    expect([code, out]).toEqual([0, expect.stringContaining("ok: ")]);
  });

  test("missing report sections", () => {
    const [code, out] = run(claude(undefined, STEPS.replace("## Report sections", "## Output") + filled("explorer")));
    expect(code).toBe(1);
    expect(out).toContain("Report sections");
  });

  test("a heading of seven hashes is not a heading", () => {
    const [code, out] = run(claude(undefined, STEPS.replace("## Report sections", "####### Report sections") + filled("explorer")));
    expect(code).toBe(1);
    expect(out).toContain("no 'Report sections' heading");
  });

  test("a file without frontmatter, or without its closing line", () => {
    let [code, out] = run(write(".claude/agents/x/explorer.md", "name: explorer\n"));
    expect(code).toBe(1);
    expect(out).toContain("does not start with a '---' line");
    [code, out] = run(write(".claude/agents/y/explorer.md", "---\nname: explorer\n"));
    expect(code).toBe(1);
    expect(out).toContain("no closing '---' line");
  });

  test("an orphan indented line and a field given twice", () => {
    const [, out] = run(claude("  stray: 1\nname: explorer\nname: explorer\ndescription: Give it the report file.\n"));
    expect(out).toContain("frontmatter line 2 is indented but belongs to no field");
    expect(out).toContain("the field 'name' appears twice");
  });

  test("a name that is not kebab-case", () => {
    const [, out] = run(claude("name: Big_Name\ndescription: Give it the report file.\n", null, "Big_Name"));
    expect(out).toContain("the name 'Big_Name' is not kebab-case of at most 256 characters");
  });

  test("no name means no protocol check", () => {
    const [code, out] = run(claude("description: Give it the report file.\n"));
    expect(code).toBe(1);
    expect(out).toBe(
      `problem: there is no 'name' field; Claude Code skips the file\n1 problem(s) in ${path.join(tmp, ".claude/agents/explorer.md")} (claude-code)\n`,
    );
  });

  test("CRLF and CR line ends are read as LF; a byte order mark is kept", () => {
    const text = `---\nname: explorer\ndescription: Give it the report file.\n---\n\n${STEPS}${filled("explorer")}\n`;
    expect(run(write(".claude/agents/a/explorer.md", text.replaceAll("\n", "\r\n")))[0]).toBe(0);
    expect(run(write(".claude/agents/b/explorer.md", text.replaceAll("\n", "\r")))[0]).toBe(0);
    const [code, out] = run(write(".claude/agents/c/explorer.md", "\ufeff" + text));
    expect(code).toBe(1);
    expect(out).toContain("does not start with a '---' line");
  });

  test("the protocol may be wrapped differently", () => {
    const [code] = run(claude(undefined, STEPS + filled("explorer").replaceAll(" ", "  \n ")));
    expect(code).toBe(0);
  });

  test("instructions of little more than the protocol", () => {
    const [code, out] = run(claude(undefined, "## Report sections\n" + filled("explorer")));
    expect(code).toBe(1);
    expect(out).toContain("hold little beyond the report protocol");
  });
});

// --------------------------------------------------------------------------- OpenCode

describe("OpenCode", () => {
  const opencode = (front: string, name = "explorer") =>
    write(`.opencode/agents/${name}.md`, `---\n${front}---\n\n${STEPS + filled(name)}\n`);

  test("valid", () => {
    const front =
      "description: |\n  Explores code. Give it the report file.\nmode: subagent\npermissions:\n" +
      '  - action: edit\n    resource: "*"\n    effect: deny\n' +
      '  - action: edit\n    resource: "**/_agent-reports/**"\n    effect: allow\n';
    const [code, out] = run(opencode(front));
    expect([code, out]).toEqual([0, expect.stringContaining("(opencode)")]);
  });

  test("edit denied everywhere", () => {
    const front =
      "description: Explores. Give it the report file.\nmode: subagent\npermissions:\n" +
      '  - action: edit\n    resource: "*"\n    effect: deny\n';
    const [code, out] = run(opencode(front));
    expect(code).toBe(1);
    expect(out).toContain("cannot write its report file");
  });

  test("a later ask on every action undoes the deny", () => {
    const front =
      "description: Give it the report file.\nmode: all\npermissions:\n" +
      "  - action: \"*\"\n    resource: '**'\n    effect: deny\n  - action: edit\n    effect: ask\n";
    expect(run(opencode(front))[0]).toBe(0);
  });

  test("missing mode and a name field", () => {
    const [code, out] = run(opencode("name: explorer\ndescription: Explores. Give it the report file.\n"));
    expect(code).toBe(1);
    expect(out).toContain("mode: subagent");
    expect(out).toContain("remove the 'name' field");
  });

  test("a legacy field", () => {
    const [code, out] = run(opencode("description: Explores. Give it the report file.\nmode: subagent\ntools:\n  write: true\n"));
    expect(code).toBe(1);
    expect(out).toContain("legacy");
  });

  test("a system field and an unknown field", () => {
    const [, out] = run(opencode("description: Give it the report file.\nmode: subagent\nsystem: x\nfoo: 1\n"));
    expect(out).toContain("not in a 'system' field");
    expect(out).toContain("OpenCode does not know the field 'foo'");
  });

  test("a file name that is not kebab-case", () => {
    const [, out] = run(opencode("description: Give it the report file.\nmode: subagent\n", "Code_Reviewer"));
    expect(out).toContain("the file name 'Code_Reviewer.md' is not kebab-case");
  });

  test("the legacy opencode/agents directory", () => {
    const file = write("opencode/agents/explorer.md", `---\ndescription: Give it the report file.\nmode: subagent\n---\n\n${STEPS + filled("explorer")}\n`);
    expect(run(file)).toEqual([0, `ok: ${file} (opencode)\n`]);
  });
});

// --------------------------------------------------------------------------- Codex

describe("Codex", () => {
  const codex = (filename = "explorer.toml", name = "explorer", quote = "'''") => {
    const instructions = STEPS + filled(name);
    const text =
      `name = "${name}"\ndescription = '''\nExplores code. Give it the report file.\n'''\n` +
      `developer_instructions = ${quote}\n${instructions}\n${quote}\n\n[features]\nshell_tool = false\n`;
    return write(`.codex/agents/${filename}`, text);
  };

  test("valid", () => {
    const [code, out] = run(codex());
    expect([code, out]).toEqual([0, expect.stringContaining("(codex)")]);
  });

  test("a snake_case name and a kebab-case file", () => {
    expect(run(codex("code-explorer.toml", "code_explorer"))[0]).toBe(0);
  });

  test("a wrong file name", () => {
    const [code, out] = run(codex("other.toml"));
    expect(code).toBe(1);
    expect(out).toContain("asks for 'explorer.toml'");
  });

  test("a basic string is flagged", () => {
    const [code, out] = run(codex("explorer.toml", "explorer", '"""'));
    expect(code).toBe(1);
    expect(out).toContain("literal string");
  });

  test("missing instructions", () => {
    const file = write(".codex/agents/explorer.toml", 'name = "explorer"\ndescription = "Explores. Give it the report file."\n');
    const [code, out] = run(file);
    expect(code).toBe(1);
    expect(out).toContain("'developer_instructions' is missing");
  });

  test("TOML that does not parse", () => {
    const file = write(".codex/agents/explorer.toml", 'name = "explorer"\ndescription = nope\n');
    const [code, out] = run(file);
    expect(code).toBe(1);
    expect(out).toContain("problem: the TOML does not parse: Invalid value (at line 2, column 15)\n");
    expect(out).toContain("the required field 'name' is missing or empty");
  });

  test("a name that is not snake_case", () => {
    const [, out] = run(codex("bad-name.toml", "Bad-Name"));
    expect(out).toContain("the name 'Bad-Name' is not snake_case");
  });
});

// --------------------------------------------------------------------------- TOML

describe("TOML", () => {
  const error = (text: string) => {
    try {
      loads(text);
      return "parsed";
    } catch (caught) {
      return (caught as Error).message;
    }
  };

  test("it gives tomllib's messages", () => {
    // Each message as Python 3.12's tomllib gives it.
    const cases: [string, string][] = [
      ['name = "a"\nname = "b"\n', "Cannot overwrite a value (at line 2, column 11)"],
      ['name = "explorer\n', "Illegal character '\\n' (at line 1, column 17)"],
      ['name = "a\\qb"\n', "Unescaped '\\' in a string (at line 1, column 12)"],
      ['name = "a"\nwhen = 2021-02-30\n', "Invalid date or datetime (at line 2, column 8)"],
      ["d = 0000-01-01\n", "Invalid date or datetime (at line 1, column 5)"],
      ['name = "😀😀" x\n', "Expected newline or end of document after a statement (at line 1, column 13)"],
      ["[a]\n[a]\n", "Cannot declare ('a',) twice (at line 2, column 3)"],
      ["t = {a = 1, a = 2}\n", "Duplicate inline table key 'a' (at line 1, column 18)"],
      ["a = [1, 2\n", "Unclosed array (at end of document)"],
      ['name = "a" # \x01\n', "Found invalid character '\\x01' (at line 1, column 14)"],
      ["a" + ".a".repeat(1000) + " = 1\n", "TOML key has more than the allowed 1000 parts"],
      ["= 1\n", "Invalid statement (at line 1, column 1)"],
      ['a = "\\uD800"\n', "Escaped character is not a Unicode scalar value (at line 1, column 12)"],
      ["[a.b]\nc = 1\n[a]\nb.d = 2\n", "Cannot redefine namespace ('a', 'b') (at line 4, column 8)"],
      ["a = {b = 1}\na.c = 2\n", "Cannot mutate immutable namespace ('a',) (at line 2, column 8)"],
      ["a = 'abc", 'Expected "\'" (at end of document)'],
      ["a = '''abc", "Expected \"'''\" (at end of document)"],
      ["a = 0x_1\n", "Expected newline or end of document after a statement (at line 1, column 6)"],
    ];
    for (const [text, message] of cases) expect([text, error(text)]).toEqual([text, message]);
  });

  test("it reads strings, escapes and every kind of value", () => {
    const table = loads(
      'name = "expl\\u006frer"\nbody = """\\\n   one \\\n   two"""\nraw = \'\'\'\nx\\y\'\'\'\'\'\n' +
        "a = [0xFF, 0o7, 0b1, +1_000, -3.5e2, inf, -nan, 1979-05-27T07:32:00.999, 07:32:00, 1979-05-27]\n" +
        "[t]\nname = 1\n",
    );
    expect(table.get("name")).toBe("explorer");
    expect(table.get("body")).toBe("one two");
    expect(table.get("raw")).toBe("x\\y''");
    expect((table.get("a") as unknown[]).length).toBe(10);
  });
});

// --------------------------------------------------------------------------- Python helpers

describe("Python behavior", () => {
  test("repr chooses its quotes and escapes", () => {
    expect(repr("a")).toBe("'a'");
    expect(repr("it's")).toBe('"it\'s"');
    expect(repr("a'b\"c")).toBe("'a\\'b\"c'");
    expect(repr("\t\x7f\u200b😀")).toBe("'\\t\\x7f\\u200b😀'");
  });

  test("paths are shown as pathlib shows them", () => {
    expect(pathString("./a//b/./c/")).toBe("a/b/c");
    expect(pathString("")).toBe(".");
    expect(pathString("//x")).toBe("//x");
    expect(pathString("///x")).toBe("/x");
    expect(pathString("~/x")).toBe(path.join(os.homedir(), "x"));
    expect(pathParts("a/.hidden")).toEqual({ name: ".hidden", stem: ".hidden", suffix: "" });
    expect(pathParts("a/b.tar.md")).toEqual({ name: "b.tar.md", stem: "b.tar", suffix: ".md" });
  });
});

// --------------------------------------------------------------------------- protocol and usage

describe("the --protocol option", () => {
  test("it prints the block with the name", () => {
    const [code, out, err] = runMain("--protocol", "explorer");
    expect([code, err]).toEqual([0, ""]);
    expect(out.trim()).toBe(filled("explorer").trim());
  });

  test("the name is stripped, and the = form and a prefix work", () => {
    expect(runMain("--protocol", "  explorer ")[1]).toBe(filled("explorer") + "\n");
    expect(runMain("--protocol=explorer")[1]).toBe(filled("explorer") + "\n");
    expect(runMain("--proto", "explorer")[1]).toBe(filled("explorer") + "\n");
  });

  test("it wins over a file", () => {
    expect(runMain("--protocol", "x", "nope.md")).toEqual([0, filled("x") + "\n", ""]);
  });

  test("an empty name is wrong usage", () => {
    const [code, , err] = runMain("--protocol", " ");
    expect(code).toBe(2);
    expect(err).toContain("check_agent: error: --protocol needs the agent's name");
  });

  test("an unreadable or broken protocol file is wrong usage", () => {
    places.protocolFile = path.join(tmp, "missing.md");
    let [code, , err] = runMain("--protocol", "x");
    expect(code).toBe(2);
    expect(err).toContain(`cannot read the protocol file ${places.protocolFile}: [Errno 2] No such file or directory: '${places.protocolFile}'`);
    places.protocolFile = write("plain.md", "no markers\n");
    [code, , err] = runMain("--protocol", "x");
    expect(code).toBe(2);
    expect(err).toContain("has no block between <!-- BEGIN REPORT PROTOCOL --> and <!-- END REPORT PROTOCOL -->");
  });
});

describe("wrong usage", () => {
  const usageLine = "usage: check_agent [-h] [--protocol AGENT_NAME] [--platform PLATFORM] [AGENT_FILE]\n";
  const expectUsage = (args: string[], message: string) => {
    const [code, out, err] = runMain(...args);
    expect([args, code, out]).toEqual([args, 2, ""]);
    expect(err).toBe(`${usageLine}check_agent: error: ${message}\nRun 'check_agent --help' for help.\n`);
  };

  test("no arguments print the help and are wrong usage", () => {
    const [code, out, err] = runMain();
    expect(code).toBe(2);
    expect(out).toContain("typical workflow:");
    expect(err).toContain("check_agent: error: give the agent file to check, or --protocol <agent-name>");
  });

  test("each mistake names the problem, the usage and the help", () => {
    expectUsage(["x.md", "--platform", "claude"],
      "argument --platform: invalid choice: 'claude' (choose from 'claude-code', 'opencode', 'codex'); did you mean 'claude-code'?");
    expectUsage(["x.md", "--platform", "zzzzzzz"],
      "argument --platform: invalid choice: 'zzzzzzz' (choose from 'claude-code', 'opencode', 'codex')");
    expectUsage(["--plaform", "codex", "x.md"], "unrecognized arguments: --plaform; did you mean '--platform'?");
    expectUsage(["-x"], "unrecognized arguments: -x");
    expectUsage(["--p", "x"], "ambiguous option: --p could match --protocol, --platform");
    expectUsage(["--platform"], "argument --platform: expected one argument (PLATFORM)");
    expectUsage(["a.md", "b.md"], "unrecognized arguments: b.md");
    expectUsage(["--platform", "codex"], "give the agent file to check, or --protocol <agent-name>");
  });

  test("a file that cannot be read, or in no known place, is wrong usage", () => {
    const missing = path.join(tmp, "missing.md");
    expectUsage([missing], `cannot read ${missing}: [Errno 2] No such file or directory: '${missing}'`);
    expectUsage([tmp], `cannot read ${tmp}: [Errno 21] Is a directory: '${tmp}'`);
    const plain = write("elsewhere/explorer.md", "x");
    expectUsage([plain], `cannot tell the platform of ${plain} from its location; pass --platform (claude-code, opencode, codex)`);
    expectUsage([plain, "--platform", "codex"], "a Codex agent file is a .toml file");
    const text = write("elsewhere/explorer.txt", "x");
    expectUsage([text, "--platform", "opencode"], "a opencode agent file is a .md file");
    const binary = write(".claude/agents/explorer.md", new Uint8Array([0x2d, 0xff]));
    expectUsage([binary], `cannot read ${binary}: the file is not UTF-8 text; save it as UTF-8 and check it again`);
  });
});

// --------------------------------------------------------------------------- help

describe("help", () => {
  test("--help, -h and help print the same help", () => {
    const outputs = [["--help"], ["-h"], ["help"], ["x.md", "--platform", "codex", "--help"]].map((args) => runMain(...args));
    for (const [code, , err] of outputs) expect([code, err]).toEqual([0, ""]);
    expect(new Set(outputs.map(([, out]) => out)).size).toBe(1);
  });

  test("it explains every argument, option, choice and default", () => {
    const [, out] = runMain("--help");
    expect(out.startsWith(`usage: ${PROG} [-h]`)).toBe(true);
    const spec = program();
    for (const positional of spec.positionals) expect(out).toContain(`  ${positional.metavar}  `);
    for (const option of spec.options) {
      expect(out).toContain(`  ${option.name} ${option.metavar}`);
      if (option.choices) expect(out).toContain(`[choices: ${option.choices.join(", ")}]`);
      if (option.defaultText) expect(out).toContain(`[default: ${option.defaultText.split(" ")[0]}`);
    }
    for (const section of ["arguments:", "options:", "platform:", "typical workflow:", "output:", "files:", "exit codes:", "examples:"]) {
      expect(out).toContain(`\n${section}\n`);
    }
    for (const code of ["0", "1", "2"]) expect(out).toMatch(new RegExp(`\\n  ${code} +\\S`));
  });

  test("no line is longer than 88 columns", () => {
    const [, out] = runMain("--help");
    for (const line of out.split("\n")) expect([line, line.length <= 88]).toEqual([line, true]);
  });

  test("every example and workflow step parses without a usage error", () => {
    const [, out] = runMain("--help");
    const commands = [...out.matchAll(new RegExp(`^ {2}(?:\\d\\. )?${PROG} (.*)$`, "gm"))].map((match) => match[1]!);
    expect(commands.length).toBe(program().examples.length + 2);
    for (const command of commands) expect(() => parse(program(), command.split(" "))).not.toThrow();
  });

  test("the help's workflow works on a real agent", () => {
    const [, block] = runMain("--protocol", "explorer");
    const file = write(".claude/agents/explorer.md", `---\nname: explorer\ndescription: Give it the report file.\n---\n\n${STEPS}${block}`);
    expect(run(file)[0]).toBe(0);
  });
});

// --------------------------------------------------------------------------- the built file

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
  });

  test("it runs as a program and finds the protocol next to it", () => {
    let [code, out, err] = runBuilt("--protocol", "explorer");
    expect([code, out, err]).toEqual([0, filled("explorer") + "\n", ""]);
    [code, out, err] = runBuilt(EXAMPLES.codex);
    expect([code, out, err]).toEqual([0, `ok: ${EXAMPLES.codex} (codex)\n`, ""]);
    [code, out] = runBuilt(claude(undefined, STEPS));
    expect(code).toBe(1);
    expect(out).toContain("1 problem(s) in");
    [code, out] = runBuilt("--help");
    expect(code).toBe(0);
    expect(out).toContain("--platform PLATFORM");
    [code, , err] = runBuilt("--platform", "nope", "x.md");
    expect(code).toBe(2);
    expect(err).toContain("Run 'check_agent --help' for help.");
  });
});
