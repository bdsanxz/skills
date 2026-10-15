#!/usr/bin/env python3
"""Check an agent file written with the agents-creator skill.

Usage: check_agent.py <agent-file> [--platform claude-code|opencode|codex]
       check_agent.py --protocol <agent-name>

The second form prints the report protocol block with the agent's name filled
in, ready to paste into the agent's instructions.

The platform is taken from the file's location (.claude/agents/,
.opencode/agents/ or opencode/agents/) or its extension (.toml is Codex).
Pass --platform when the file is somewhere else.

Exit codes: 0 when nothing is wrong, 1 when problems were found, 2 on wrong
usage or an unreadable file.
"""

import argparse
import re
import sys
from pathlib import Path

PLATFORMS = ("claude-code", "opencode", "codex")
PROTOCOL_FILE = Path(__file__).resolve().parent.parent / "references" / "report-protocol.md"
BEGIN = "<!-- BEGIN REPORT PROTOCOL -->"
END = "<!-- END REPORT PROTOCOL -->"
PLACEHOLDER = "{{AGENT_NAME}}"
SECTIONS_HEADING = re.compile(r"^#{1,6}\s+Report sections\s*$", re.MULTILINE)

KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SNAKE = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*$")

CLAUDE_FIELDS = {
    "name", "description", "tools", "disallowedTools", "model", "permissionMode",
    "maxTurns", "autoCompactWindow", "skills", "mcpServers", "hooks", "memory",
    "background", "omitClaudeMd", "effort", "isolation", "color", "initialPrompt",
    "experimental",
}
OPENCODE_FIELDS = {
    "description", "mode", "model", "permissions", "steps", "hidden", "color",
    "disabled", "request",
}
OPENCODE_LEGACY = {"temperature", "top_p", "prompt", "permission", "tools", "disable", "maxSteps"}
REPORT_TOOLS = ("Write", "Edit")


def fail_usage(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(2)


def squash(text):
    return re.sub(r"\s+", " ", text).strip()


def load_protocol():
    try:
        text = PROTOCOL_FILE.read_text(encoding="utf-8")
    except OSError as exc:
        fail_usage(f"cannot read the protocol file {PROTOCOL_FILE}: {exc}")
    start, end = text.find(BEGIN), text.find(END)
    if start < 0 or end < start:
        fail_usage(f"{PROTOCOL_FILE} has no block between {BEGIN} and {END}")
    return text[start:end + len(END)]


def infer_platform(path):
    posix = path.resolve().as_posix()
    if path.suffix == ".toml":
        return "codex"
    if "/.claude/agents/" in posix:
        return "claude-code"
    if "/.opencode/agents/" in posix or "/opencode/agents/" in posix:
        return "opencode"
    return None


# --- Markdown with YAML frontmatter -----------------------------------------

def split_frontmatter(text, problems):
    lines = text.split("\n")
    if not lines or lines[0].rstrip() != "---":
        problems.append("the file does not start with a '---' line, so its frontmatter is not read; "
                        "put '---' on the first line")
        return None, text
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            return lines[1:i], "\n".join(lines[i + 1:])
    problems.append("the frontmatter has no closing '---' line")
    return None, text


def parse_frontmatter(lines, problems):
    """Return {key: (inline value, [indented lines])} for the top-level keys."""
    fields, current = {}, None
    for number, line in enumerate(lines, start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            if current:
                fields[current][1].append(line)
            continue
        if line[0] in " \t":
            if current is None:
                problems.append(f"frontmatter line {number} is indented but belongs to no field")
            else:
                fields[current][1].append(line)
            continue
        match = re.match(r"^([A-Za-z_][\w-]*):(?:\s+(.*))?$", line.rstrip())
        if not match:
            problems.append(f"frontmatter line {number} is not 'field: value' and is not indented, "
                            "so the YAML does not parse; indent it under its field "
                            "(write a multi-line description as 'description: |' with every line indented)")
            current = None
            continue
        current = match.group(1)
        if current in fields:
            problems.append(f"the field '{current}' appears twice in the frontmatter")
        fields[current] = ((match.group(2) or "").strip(), [])
    return fields


def scalar(field):
    inline, block = field
    if inline in ("|", ">", "|-", ">-", "|+", ">+"):
        return "\n".join(l.strip() for l in block).strip()
    value = inline.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    return value


def tool_list(field):
    inline, block = field
    if inline.startswith("["):
        items = inline.strip("[]").split(",")
    elif inline:
        items = inline.split(",")
    else:
        items = [l.strip()[1:] for l in block if l.strip().startswith("-")]
    return [i.strip().strip("'\"") for i in items if i.strip()]


def check_claude(path, text, problems):
    lines, body = split_frontmatter(text, problems)
    if lines is None:
        return None, "", body
    fields = parse_frontmatter(lines, problems)
    for key in sorted(set(fields) - CLAUDE_FIELDS):
        problems.append(f"Claude Code does not know the field '{key}' and ignores it silently; "
                        f"check its spelling (fields are camelCase)")
    name = scalar(fields["name"]) if "name" in fields else ""
    if not name:
        problems.append("there is no 'name' field; Claude Code skips the file")
    else:
        if not KEBAB.match(name) or len(name) > 256:
            problems.append(f"the name '{name}' is not kebab-case of at most 256 characters")
        if path.stem != name:
            problems.append(f"the file is named '{path.name}', but the name is '{name}'; "
                            f"name the file '{name}.md'")
    description = scalar(fields["description"]) if "description" in fields else ""
    if "tools" in fields:
        tools = tool_list(fields["tools"])
        for tool in REPORT_TOOLS:
            if tool not in tools:
                problems.append(f"'tools' does not include {tool}, which the agent needs to "
                                "write its report file; add it")
    if "disallowedTools" in fields:
        denied = tool_list(fields["disallowedTools"])
        for tool in REPORT_TOOLS:
            if any(entry.split("(")[0] == tool for entry in denied):
                problems.append(f"'disallowedTools' removes {tool}, which the agent needs to "
                                "write its report file; remove it from the list")
    return name, description, body


def parse_permissions(field):
    rules, rule = [], None
    for line in field[1]:
        stripped = line.strip()
        if stripped.startswith("- "):
            rule = {}
            rules.append(rule)
            stripped = stripped[2:]
        match = re.match(r"^(\w+):\s*(.*)$", stripped)
        if rule is not None and match:
            rule[match.group(1)] = match.group(2).strip().strip("'\"")
    return rules


def check_opencode(path, text, problems):
    lines, body = split_frontmatter(text, problems)
    if lines is None:
        return path.stem, "", body
    fields = parse_frontmatter(lines, problems)
    for key in sorted(set(fields) & OPENCODE_LEGACY):
        problems.append(f"'{key}' is a legacy field that OpenCode V2 agents must not use; remove it")
    if "name" in fields:
        problems.append("OpenCode takes the agent's ID from the file name; remove the 'name' field")
    if "system" in fields:
        problems.append("in a Markdown agent the instructions go in the body, not in a 'system' field")
    for key in sorted(set(fields) - OPENCODE_FIELDS - OPENCODE_LEGACY - {"name", "system"}):
        problems.append(f"OpenCode does not know the field '{key}'; check its spelling")
    name = path.stem
    if not KEBAB.match(name):
        problems.append(f"the file name '{path.name}' is not kebab-case")
    mode = scalar(fields["mode"]) if "mode" in fields else ""
    if mode not in ("subagent", "all"):
        problems.append("set 'mode: subagent' (or 'all'): without it the agent is a primary agent "
                        "and other agents cannot invoke it")
    if "permissions" in fields:
        blocked = False
        for rule in parse_permissions(fields["permissions"]):
            if rule.get("action") not in ("edit", "*"):
                continue
            if rule.get("effect") == "deny" and rule.get("resource") in ("*", "**"):
                blocked = True
            elif rule.get("effect") in ("allow", "ask"):
                blocked = False
        if blocked:
            problems.append("the permissions deny 'edit' on every path and allow it nowhere after that, "
                            "so the agent cannot write its report file; add an 'allow' rule for "
                            "'**/_agent-reports/**' and the directory its callers use for reports")
    description = scalar(fields["description"]) if "description" in fields else ""
    return name, description, body


# --- TOML (Codex) ------------------------------------------------------------

def parse_toml_top_level(text):
    try:
        import tomllib  # Python 3.11+
        data = tomllib.loads(text)
        return {k: v for k, v in data.items() if isinstance(v, str)}, None
    except ImportError:
        pass
    except Exception as exc:  # tomllib.TOMLDecodeError
        return {}, f"the TOML does not parse: {exc}"
    values, lines, i = {}, text.split("\n"), 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if line.startswith("["):
            break
        match = re.match(r"^([A-Za-z0-9_-]+)\s*=\s*(.*)$", line)
        if not match:
            continue
        key, rest = match.groups()
        for quote in ("'''", '"""'):
            if rest.startswith(quote):
                rest = rest[3:]
                collected = []
                while quote not in rest:
                    collected.append(rest)
                    if i >= len(lines):
                        return values, f"the value of '{key}' opens {quote} and never closes it"
                    rest = lines[i]
                    i += 1
                collected.append(rest[:rest.index(quote)])
                value = "\n".join(collected)
                values[key] = value[1:] if value.startswith("\n") else value
                break
        else:
            if len(rest) >= 2 and rest[0] in "'\"" and rest.rstrip()[-1] == rest[0]:
                values[key] = rest.rstrip()[1:-1]
    return values, None


def check_codex(path, text, problems):
    values, error = parse_toml_top_level(text)
    if error:
        problems.append(error)
    for key in ("name", "description", "developer_instructions"):
        if not values.get(key, "").strip():
            problems.append(f"the required field '{key}' is missing or empty")
    name = values.get("name", "").strip()
    if name:
        if not SNAKE.match(name):
            problems.append(f"the name '{name}' is not snake_case")
        expected = name.replace("_", "-") + ".toml"
        if path.name != expected:
            problems.append(f"the file is named '{path.name}', but the name '{name}' asks for '{expected}'")
    if '"""' in text.split("developer_instructions", 1)[-1][:10]:
        problems.append("write 'developer_instructions' as a literal string between ''' so that "
                        "backslashes in the instructions are kept as they are")
    return name, values.get("description", ""), values.get("developer_instructions", "")


# --- Shared checks -------------------------------------------------------------

def check_instructions(name, description, instructions, problems):
    if description and "report file" not in description.lower():
        problems.append("the description does not tell the caller to name a report file; "
                        "say how to name it in the part on how to instruct the agent")
    if not description:
        problems.append("there is no description")
    if not name:
        return
    protocol = load_protocol().replace(PLACEHOLDER, name)
    if PLACEHOLDER in instructions:
        problems.append(f"the instructions still hold {PLACEHOLDER}; replace it with '{name}'")
    elif squash(protocol) not in squash(instructions):
        if BEGIN in instructions:
            problems.append("the report protocol block differs from references/report-protocol.md; "
                            "copy it again word for word, with only the agent name filled in")
        else:
            problems.append("the instructions do not hold the report protocol; copy the block from "
                            "references/report-protocol.md, markers included")
    if not SECTIONS_HEADING.search(instructions):
        problems.append("the instructions have no 'Report sections' heading that lists the sections "
                        "of the report's Result")
    rest = squash(instructions).replace(squash(protocol), "")
    if len(rest) < 200:
        problems.append("the instructions hold little beyond the report protocol; write the agent's "
                        "own steps before it")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("file", nargs="?", help="the agent file to check")
    parser.add_argument("--protocol", metavar="AGENT_NAME",
                        help="print the report protocol block for this agent name and exit")
    parser.add_argument("--platform", choices=PLATFORMS,
                        help="the agent's platform, when its location does not show it")
    args = parser.parse_args()
    if args.protocol is not None:
        if not args.protocol.strip():
            fail_usage("--protocol needs the agent's name")
        print(load_protocol().replace(PLACEHOLDER, args.protocol.strip()))
        return 0
    if args.file is None:
        fail_usage("give the agent file to check, or --protocol <agent-name>")

    path = Path(args.file).expanduser()
    try:
        text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    except OSError as exc:
        fail_usage(f"cannot read {path}: {exc}")
    platform = args.platform or infer_platform(path)
    if platform is None:
        fail_usage(f"cannot tell the platform of {path} from its location; pass --platform "
                   f"({', '.join(PLATFORMS)})")
    if platform == "codex" and path.suffix != ".toml":
        fail_usage("a Codex agent file is a .toml file")
    if platform != "codex" and path.suffix != ".md":
        fail_usage(f"a {platform} agent file is a .md file")

    problems = []
    check = {"claude-code": check_claude, "opencode": check_opencode, "codex": check_codex}[platform]
    name, description, instructions = check(path, text, problems)
    check_instructions(name, description, instructions, problems)

    for problem in problems:
        print(f"problem: {problem}")
    if problems:
        print(f"{len(problems)} problem(s) in {path} ({platform})")
        return 1
    print(f"ok: {path} ({platform})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
