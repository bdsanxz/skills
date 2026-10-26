// The checks of an agent file, for each platform, and the report protocol they compare with.

import fs from "node:fs";
import path from "node:path";
import { UsageError, decodeUtf8 } from "./core";
import { head, length, osError, rstrip, sorted, squash, strip, WS } from "./py";
import { KeyTooLong, loads, TOMLDecodeError } from "./toml";

export const PLATFORMS = ["claude-code", "opencode", "codex"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Where the protocol is read from. The tests point it elsewhere. */
export const places = {
  protocolFile: path.resolve(import.meta.dir, "..", "references", "report-protocol.md"),
};

export const BEGIN = "<!-- BEGIN REPORT PROTOCOL -->";
export const END = "<!-- END REPORT PROTOCOL -->";
export const PLACEHOLDER = "{{AGENT_NAME}}";
const SECTIONS_HEADING = new RegExp(`(?:^|(?<=\\n))#{1,6}[${WS}]+Report sections[${WS}]*(?=\\n|$)`);

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*\n?$/;
const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)*\n?$/;
const FIELD_LINE = new RegExp(`^([A-Za-z_][\\p{L}\\p{N}_-]*):(?:[${WS}]+([^\\n]*))?$`, "u");
const RULE_LINE = new RegExp(`^([\\p{L}\\p{N}_]+):[${WS}]*([^\\n]*)$`, "u");

const CLAUDE_FIELDS = new Set([
  "name", "description", "tools", "disallowedTools", "model", "permissionMode",
  "maxTurns", "autoCompactWindow", "skills", "mcpServers", "hooks", "memory",
  "background", "omitClaudeMd", "effort", "isolation", "color", "initialPrompt",
  "experimental",
]);
const OPENCODE_FIELDS = new Set([
  "description", "mode", "model", "permissions", "steps", "hidden", "color", "disabled", "request",
]);
const OPENCODE_LEGACY = new Set(["temperature", "top_p", "prompt", "permission", "tools", "disable", "maxSteps"]);
const REPORT_TOOLS = ["Write", "Edit"] as const;

/** Read a text file as Python's read_text() does: UTF-8, with \r\n and \r made \n. */
export function readText(file: string) {
  return decodeUtf8(fs.readFileSync(file)).replace(/\r\n?/g, "\n");
}

export function loadProtocol() {
  const file = places.protocolFile;
  let text: string;
  try {
    text = readText(file);
  } catch (error) {
    throw new UsageError(`cannot read the protocol file ${file}: ${osError(error, file)}`);
  }
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new UsageError(`${file} has no block between ${BEGIN} and ${END}`);
  return text.slice(start, end + END.length);
}

/** The protocol block with the agent's name filled in. */
export const protocolFor = (name: string) => loadProtocol().replaceAll(PLACEHOLDER, name);

/** The platform a file's location or extension shows, or null. */
export function inferPlatform(suffix: string, resolved: string): Platform | null {
  if (suffix === ".toml") return "codex";
  if (resolved.includes("/.claude/agents/")) return "claude-code";
  if (resolved.includes("/.opencode/agents/") || resolved.includes("/opencode/agents/")) return "opencode";
  return null;
}

/** The name, the file name and the stem of the agent file, as the checks name them. */
export type FileName = { name: string; stem: string };
type Parsed = { name: string; description: string; instructions: string };

// --------------------------------------------------------------------------- Markdown

type Field = { inline: string; block: string[] };

function splitFrontmatter(text: string, problems: string[]): [string[] | null, string] {
  const lines = text.split("\n");
  if (rstrip(lines[0]!) !== "---") {
    problems.push("the file does not start with a '---' line, so its frontmatter is not read; put '---' on the first line");
    return [null, text];
  }
  for (let i = 1; i < lines.length; i++) {
    if (rstrip(lines[i]!) === "---") return [lines.slice(1, i), lines.slice(i + 1).join("\n")];
  }
  problems.push("the frontmatter has no closing '---' line");
  return [null, text];
}

function parseFrontmatter(lines: string[], problems: string[]) {
  const fields = new Map<string, Field>();
  let current: string | null = null;
  lines.forEach((line, index) => {
    const number = index + 2;
    if (!strip(line) || strip(line).startsWith("#")) {
      if (current) fields.get(current)!.block.push(line);
      return;
    }
    if (line[0] === " " || line[0] === "\t") {
      if (current === null) problems.push(`frontmatter line ${number} is indented but belongs to no field`);
      else fields.get(current)!.block.push(line);
      return;
    }
    const match = FIELD_LINE.exec(rstrip(line));
    if (!match) {
      problems.push(
        `frontmatter line ${number} is not 'field: value' and is not indented, so the YAML does not parse; ` +
          "indent it under its field (write a multi-line description as 'description: |' with every line indented)",
      );
      current = null;
      return;
    }
    current = match[1]!;
    if (fields.has(current)) problems.push(`the field '${current}' appears twice in the frontmatter`);
    fields.set(current, { inline: strip(match[2] ?? ""), block: [] });
  });
  return fields;
}

function scalar(field: Field | undefined) {
  if (!field) return "";
  if (["|", ">", "|-", ">-", "|+", ">+"].includes(field.inline)) {
    return strip(field.block.map((line) => strip(line)).join("\n"));
  }
  let value = strip(field.inline);
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "'" || value[0] === '"')) {
    value = value.slice(1, -1);
  }
  return value;
}

function toolList(field: Field) {
  let items: string[];
  if (field.inline.startsWith("[")) items = strip(field.inline, "[]").split(",");
  else if (field.inline) items = field.inline.split(",");
  else items = field.block.filter((line) => strip(line).startsWith("-")).map((line) => strip(line).slice(1));
  return items.filter((item) => strip(item)).map((item) => strip(strip(item), "'\""));
}

function checkClaude(file: FileName, text: string, problems: string[]): Parsed {
  const [lines, body] = splitFrontmatter(text, problems);
  if (lines === null) return { name: "", description: "", instructions: body };
  const fields = parseFrontmatter(lines, problems);
  for (const key of sorted([...fields.keys()].filter((key) => !CLAUDE_FIELDS.has(key)))) {
    problems.push(`Claude Code does not know the field '${key}' and ignores it silently; check its spelling (fields are camelCase)`);
  }
  const name = scalar(fields.get("name"));
  if (!name) {
    problems.push("there is no 'name' field; Claude Code skips the file");
  } else {
    if (!KEBAB.test(name) || length(name) > 256) problems.push(`the name '${name}' is not kebab-case of at most 256 characters`);
    if (file.stem !== name) {
      problems.push(`the file is named '${file.name}', but the name is '${name}'; name the file '${name}.md'`);
    }
  }
  const description = scalar(fields.get("description"));
  const tools = fields.get("tools");
  if (tools) {
    const listed = toolList(tools);
    for (const tool of REPORT_TOOLS) {
      if (!listed.includes(tool)) {
        problems.push(`'tools' does not include ${tool}, which the agent needs to write its report file; add it`);
      }
    }
  }
  const disallowed = fields.get("disallowedTools");
  if (disallowed) {
    const denied = toolList(disallowed);
    for (const tool of REPORT_TOOLS) {
      if (denied.some((entry) => entry.split("(")[0] === tool)) {
        problems.push(`'disallowedTools' removes ${tool}, which the agent needs to write its report file; remove it from the list`);
      }
    }
  }
  return { name, description, instructions: body };
}

function parsePermissions(field: Field) {
  const rules: Map<string, string>[] = [];
  let rule: Map<string, string> | null = null;
  for (const line of field.block) {
    let stripped = strip(line);
    if (stripped.startsWith("- ")) {
      rule = new Map();
      rules.push(rule);
      stripped = stripped.slice(2);
    }
    const match = RULE_LINE.exec(stripped);
    if (rule !== null && match) rule.set(match[1]!, strip(strip(match[2]!), "'\""));
  }
  return rules;
}

function checkOpencode(file: FileName, text: string, problems: string[]): Parsed {
  const [lines, body] = splitFrontmatter(text, problems);
  if (lines === null) return { name: file.stem, description: "", instructions: body };
  const fields = parseFrontmatter(lines, problems);
  const keys = [...fields.keys()];
  for (const key of sorted(keys.filter((key) => OPENCODE_LEGACY.has(key)))) {
    problems.push(`'${key}' is a legacy field that OpenCode V2 agents must not use; remove it`);
  }
  if (fields.has("name")) problems.push("OpenCode takes the agent's ID from the file name; remove the 'name' field");
  if (fields.has("system")) problems.push("in a Markdown agent the instructions go in the body, not in a 'system' field");
  const unknown = keys.filter(
    (key) => !OPENCODE_FIELDS.has(key) && !OPENCODE_LEGACY.has(key) && key !== "name" && key !== "system",
  );
  for (const key of sorted(unknown)) problems.push(`OpenCode does not know the field '${key}'; check its spelling`);
  const name = file.stem;
  if (!KEBAB.test(name)) problems.push(`the file name '${file.name}' is not kebab-case`);
  const mode = scalar(fields.get("mode"));
  if (mode !== "subagent" && mode !== "all") {
    problems.push(
      "set 'mode: subagent' (or 'all'): without it the agent is a primary agent and other agents cannot invoke it",
    );
  }
  const permissions = fields.get("permissions");
  if (permissions) {
    let blocked = false;
    for (const rule of parsePermissions(permissions)) {
      const action = rule.get("action");
      if (action !== "edit" && action !== "*") continue;
      const effect = rule.get("effect");
      const resource = rule.get("resource");
      if (effect === "deny" && (resource === "*" || resource === "**")) blocked = true;
      else if (effect === "allow" || effect === "ask") blocked = false;
    }
    if (blocked) {
      problems.push(
        "the permissions deny 'edit' on every path and allow it nowhere after that, so the agent cannot write its " +
          "report file; add an 'allow' rule for '**/_agent-reports/**' and the directory its callers use for reports",
      );
    }
  }
  return { name, description: scalar(fields.get("description")), instructions: body };
}

// --------------------------------------------------------------------------- TOML (Codex)

function topLevelStrings(text: string): [Map<string, string>, string | null] {
  try {
    const values = new Map<string, string>();
    for (const [key, value] of loads(text)) if (typeof value === "string") values.set(key, value);
    return [values, null];
  } catch (error) {
    if (error instanceof TOMLDecodeError || error instanceof KeyTooLong) {
      return [new Map(), `the TOML does not parse: ${error.message}`];
    }
    throw error;
  }
}

function checkCodex(file: FileName, text: string, problems: string[]): Parsed {
  const [values, error] = topLevelStrings(text);
  if (error) problems.push(error);
  for (const key of ["name", "description", "developer_instructions"]) {
    if (!strip(values.get(key) ?? "")) problems.push(`the required field '${key}' is missing or empty`);
  }
  const name = strip(values.get("name") ?? "");
  if (name) {
    if (!SNAKE.test(name)) problems.push(`the name '${name}' is not snake_case`);
    const expected = name.replaceAll("_", "-") + ".toml";
    if (file.name !== expected) problems.push(`the file is named '${file.name}', but the name '${name}' asks for '${expected}'`);
  }
  const marker = text.indexOf("developer_instructions");
  const after = marker < 0 ? text : text.slice(marker + "developer_instructions".length);
  if (head(after, 10).includes('"""')) {
    problems.push(
      "write 'developer_instructions' as a literal string between ''' so that backslashes in the instructions are kept as they are",
    );
  }
  return { name, description: values.get("description") ?? "", instructions: values.get("developer_instructions") ?? "" };
}

// --------------------------------------------------------------------------- shared

function checkInstructions({ name, description, instructions }: Parsed, problems: string[]) {
  if (description && !description.toLowerCase().includes("report file")) {
    problems.push(
      "the description does not tell the caller to name a report file; say how to name it in the part on how to instruct the agent",
    );
  }
  if (!description) problems.push("there is no description");
  if (!name) return;
  const protocol = protocolFor(name);
  if (instructions.includes(PLACEHOLDER)) {
    problems.push(`the instructions still hold ${PLACEHOLDER}; replace it with '${name}'`);
  } else if (!squash(instructions).includes(squash(protocol))) {
    if (instructions.includes(BEGIN)) {
      problems.push(
        "the report protocol block differs from references/report-protocol.md; copy it again word for word, with only the agent name filled in",
      );
    } else {
      problems.push(
        "the instructions do not hold the report protocol; copy the block from references/report-protocol.md, markers included",
      );
    }
  }
  if (!SECTIONS_HEADING.test(instructions)) {
    problems.push("the instructions have no 'Report sections' heading that lists the sections of the report's Result");
  }
  const rest = squash(instructions).replaceAll(squash(protocol), "");
  if (length(rest) < 200) {
    problems.push("the instructions hold little beyond the report protocol; write the agent's own steps before it");
  }
}

const CHECKS = { "claude-code": checkClaude, opencode: checkOpencode, codex: checkCodex };

/** Every problem of an agent file's text, in the order they are printed. */
export function problemsOf(platform: Platform, file: FileName, text: string) {
  const problems: string[] = [];
  const parsed = CHECKS[platform](file, text, problems);
  checkInstructions(parsed, problems);
  return problems;
}
