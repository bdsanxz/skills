"""Tests for scripts/check_agent.py. Run: python3 -m unittest discover -s dev/check-agent"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[2]
SCRIPT = SKILL / "scripts" / "check_agent.py"
EXAMPLES = {
    "claude-code": SKILL / "examples" / "claude-code" / "code-reviewer.md",
    "opencode": SKILL / "examples" / "opencode" / "code-reviewer.md",
    "codex": SKILL / "examples" / "codex" / "code-reviewer.toml",
}
PROTOCOL_TEXT = (SKILL / "references" / "report-protocol.md").read_text()
PROTOCOL = PROTOCOL_TEXT[PROTOCOL_TEXT.index("<!-- BEGIN"):PROTOCOL_TEXT.index("<!-- END REPORT PROTOCOL -->") + 28]

STEPS = """# Explorer

You explore an area of the code and answer the questions in your prompt. You change no file.

## Steps

1. Start the report file.
2. Answer each question from the code, one at a time, and log each answer with paths and lines.
3. Finish the report.

## Report sections

1. Answers, one per question, with paths and lines.
2. Questions you could not answer, and why.

"""


def run(path, *extra):
    result = subprocess.run([sys.executable, str(SCRIPT), str(path), *extra],
                            capture_output=True, text=True)
    return result.returncode, result.stdout + result.stderr


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def write(self, relative, text):
        path = self.tmp / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def claude(self, front="name: explorer\ndescription: Explores code. Give it the report file.\n",
               body=None, name="explorer"):
        body = STEPS + PROTOCOL.replace("{{AGENT_NAME}}", name) if body is None else body
        return self.write(f".claude/agents/{name}.md", f"---\n{front}---\n\n{body}\n")


class ClaudeCode(Case):
    def test_examples_pass(self):
        for platform, path in EXAMPLES.items():
            with self.subTest(platform=platform):
                code, out = run(path, "--platform", platform)
                self.assertEqual(code, 0, out)

    def test_location_gives_platform(self):
        code, out = run(self.claude())
        self.assertEqual(code, 0, out)
        self.assertIn("claude-code", out)

    def test_unknown_location_is_usage_error(self):
        code, out = run(self.write("elsewhere/explorer.md", "x"))
        self.assertEqual(code, 2, out)
        self.assertIn("--platform", out)

    def test_missing_protocol(self):
        code, out = run(self.claude(body=STEPS + "x" * 300))
        self.assertEqual(code, 1, out)
        self.assertIn("do not hold the report protocol", out)

    def test_changed_protocol(self):
        body = STEPS + PROTOCOL.replace("{{AGENT_NAME}}", "explorer").replace("at least every five", "every ten")
        code, out = run(self.claude(body=body))
        self.assertEqual(code, 1, out)
        self.assertIn("differs", out)

    def test_placeholder_left(self):
        code, out = run(self.claude(body=STEPS + PROTOCOL))
        self.assertEqual(code, 1, out)
        self.assertIn("{{AGENT_NAME}}", out)

    def test_tools_without_edit(self):
        front = "name: explorer\ndescription: Explores. Give it the report file.\ntools: Read, Write\n"
        code, out = run(self.claude(front=front))
        self.assertEqual(code, 1, out)
        self.assertIn("does not include Edit", out)

    def test_disallowed_write(self):
        front = "name: explorer\ndescription: Explores. Give it the report file.\ndisallowedTools: Write\n"
        code, out = run(self.claude(front=front))
        self.assertEqual(code, 1, out)
        self.assertIn("removes Write", out)

    def test_name_differs_from_file(self):
        front = "name: other\ndescription: Explores. Give it the report file.\n"
        code, out = run(self.claude(front=front))
        self.assertEqual(code, 1, out)
        self.assertIn("name the file 'other.md'", out)

    def test_unindented_description(self):
        front = "name: explorer\ndescription: Explores. Give it the report file. Examples:\n\n<example>\nContext: x\n"
        code, out = run(self.claude(front=front))
        self.assertEqual(code, 1, out)
        self.assertIn("does not parse", out)

    def test_unknown_field(self):
        front = "name: explorer\ndescription: Explores. Give it the report file.\nmax_turns: 3\n"
        code, out = run(self.claude(front=front))
        self.assertEqual(code, 1, out)
        self.assertIn("max_turns", out)

    def test_description_without_report_file(self):
        front = "name: explorer\ndescription: Explores code.\n"
        code, out = run(self.claude(front=front))
        self.assertEqual(code, 1, out)
        self.assertIn("name a report file", out)

    def test_missing_report_sections(self):
        body = STEPS.replace("## Report sections", "## Output") + PROTOCOL.replace("{{AGENT_NAME}}", "explorer")
        code, out = run(self.claude(body=body))
        self.assertEqual(code, 1, out)
        self.assertIn("Report sections", out)


class ProtocolOption(unittest.TestCase):
    def test_prints_block_with_name(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--protocol", "explorer"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), PROTOCOL.replace("{{AGENT_NAME}}", "explorer").strip())

    def test_no_arguments_is_usage_error(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)


class OpenCode(Case):
    def opencode(self, front):
        body = STEPS + PROTOCOL.replace("{{AGENT_NAME}}", "explorer")
        return self.write(".opencode/agents/explorer.md", f"---\n{front}---\n\n{body}\n")

    def test_valid(self):
        front = ("description: |\n  Explores code. Give it the report file.\nmode: subagent\npermissions:\n"
                 "  - action: edit\n    resource: \"*\"\n    effect: deny\n"
                 "  - action: edit\n    resource: \"**/_agent-reports/**\"\n    effect: allow\n")
        code, out = run(self.opencode(front))
        self.assertEqual(code, 0, out)

    def test_edit_denied_everywhere(self):
        front = ("description: Explores. Give it the report file.\nmode: subagent\npermissions:\n"
                 "  - action: edit\n    resource: \"*\"\n    effect: deny\n")
        code, out = run(self.opencode(front))
        self.assertEqual(code, 1, out)
        self.assertIn("cannot write its report file", out)

    def test_missing_mode_and_name_field(self):
        front = "name: explorer\ndescription: Explores. Give it the report file.\n"
        code, out = run(self.opencode(front))
        self.assertEqual(code, 1, out)
        self.assertIn("mode: subagent", out)
        self.assertIn("remove the 'name' field", out)

    def test_legacy_field(self):
        front = "description: Explores. Give it the report file.\nmode: subagent\ntools:\n  write: true\n"
        code, out = run(self.opencode(front))
        self.assertEqual(code, 1, out)
        self.assertIn("legacy", out)


class Codex(Case):
    def codex(self, filename="explorer.toml", name="explorer", quote="'''"):
        instructions = STEPS + PROTOCOL.replace("{{AGENT_NAME}}", name)
        text = (f'name = "{name}"\ndescription = \'\'\'\nExplores code. Give it the report file.\n\'\'\'\n'
                f'developer_instructions = {quote}\n{instructions}\n{quote}\n\n[features]\nshell_tool = false\n')
        return self.write(f".codex/agents/{filename}", text)

    def test_valid(self):
        code, out = run(self.codex())
        self.assertEqual(code, 0, out)

    def test_snake_case_name_and_kebab_file(self):
        code, out = run(self.codex(filename="code-explorer.toml", name="code_explorer"))
        self.assertEqual(code, 0, out)

    def test_wrong_file_name(self):
        code, out = run(self.codex(filename="other.toml"))
        self.assertEqual(code, 1, out)
        self.assertIn("asks for 'explorer.toml'", out)

    def test_basic_string_flagged(self):
        code, out = run(self.codex(quote='"""'))
        self.assertEqual(code, 1, out)
        self.assertIn("literal string", out)

    def test_missing_instructions(self):
        path = self.write(".codex/agents/explorer.toml",
                          'name = "explorer"\ndescription = "Explores. Give it the report file."\n')
        code, out = run(path)
        self.assertEqual(code, 1, out)
        self.assertIn("'developer_instructions' is missing", out)


if __name__ == "__main__":
    unittest.main()
