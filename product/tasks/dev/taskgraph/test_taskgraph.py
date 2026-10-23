"""Tests for scripts/taskgraph.py.

    python3 skills/product/tasks/dev/taskgraph/test_taskgraph.py
"""

import contextlib
import io
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "scripts"))
import taskgraph  # noqa: E402

EXAMPLE = os.path.join(HERE, "..", "..", "examples", "expense-reports.md")


def task(tid, title="Does a thing", needs="none", ticks="- [ ] It works.", extra="", path="Happy",
         status="Required", because=True):
    lines = ["### %s. %s" % (tid, title), "", "- **Actor**: Member", "- **Path**: %s" % path]
    if status is not None:
        lines.append("- **Status**: %s" % status)
    lines.append("- **Source**: R1")
    if needs is not None:
        lines.append("- **Needs**: %s" % needs)
        if because and needs.strip().lower() not in ("none", "-", ""):
            lines.append("- **Needs because**: its behavior cannot be seen without them.")
    lines += ["", "**Scenario**: Given a, when b, then c.%s" % extra, "", "**Acceptance criteria**", "",
              ticks, ""]
    return "\n".join(lines)


def doc(*tasks, questions="", coverage=None):
    ids = [line.split(". ")[0][4:] for text in tasks for line in text.splitlines() if line.startswith("### T")]
    if coverage is None:
        coverage = "## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n| R1 Everything | %s |\n" % (
            ", ".join(ids) or "T1")
    return ("# Demo: Tasks\n\n## Feature: Demo\n\nOne sentence.\n\n" + "\n".join(tasks) + "\n"
            + coverage + "\n" + questions)


QUESTION = """## Open questions

### Q1. What now?

- **Unclear**: x
- **Why it matters**: y
- **Options raised**: none raised
- **Blocks**: %s
"""


class Case(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def write(self, text):
        path = os.path.join(self.dir, "tasks.md")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = taskgraph.main(list(args))
            except SystemExit as exit_:
                code = exit_.code
        return code, out.getvalue(), err.getvalue()

    def problems(self, text):
        parsed = taskgraph.parse(text)
        return [message for _, message in taskgraph.validate(parsed)]


class CheckTests(Case):
    def test_example_document_is_clean(self):
        code, out, _ = self.run_cli("check", EXAMPLE)
        self.assertEqual(code, 0, out)
        self.assertIn("7 tasks in 2 features, 2 open questions", out)

    def test_missing_reference(self):
        found = self.problems(doc(task("T1"), task("T2", needs="T1, T9")))
        self.assertEqual(len(found), 1)
        self.assertIn("T2 needs T9, which is not a task", found[0])

    def test_self_reference(self):
        self.assertIn("T1 needs itself.", self.problems(doc(task("T1", needs="T1"))))

    def test_cycles(self):
        found = self.problems(doc(task("T1", needs="T2"), task("T2", needs="T1")))
        self.assertEqual(len(found), 1)
        self.assertIn("dependency cycle: T1 -> T2 -> T1", found[0])
        found = self.problems(doc(task("T1", needs="T3"), task("T2", needs="T1"), task("T3", needs="T2"),
                                  task("T4")))
        self.assertEqual(len(found), 1)
        self.assertIn("T1 -> T3 -> T2 -> T1", found[0])

    def test_diamond_is_not_a_cycle(self):
        text = doc(task("T1"), task("T2", needs="T1"), task("T3", needs="T1"), task("T4", needs="T2, T3"))
        self.assertEqual(self.problems(text), [])

    def test_forward_reference_is_allowed(self):
        self.assertEqual(self.problems(doc(task("T1", needs="T2"), task("T2"))), [])

    def test_duplicate_id(self):
        found = self.problems(doc(task("T1"), task("T1")))
        self.assertTrue(any("T1 is defined twice" in message for message in found))

    def test_needs_that_is_not_an_id(self):
        found = self.problems(doc(task("T1"), task("T2", needs="T1 (the happy path)")))
        self.assertTrue(any("`(the" in message and "not a task ID" in message for message in found))

    def test_needs_none_words(self):
        for word in ("none", "None", "-", ""):
            self.assertEqual(self.problems(doc(task("T1", needs=word))), [])

    def test_missing_fields_and_criteria(self):
        bare = "### T1. Bare\n\n**Scenario**: x\n"
        found = self.problems(doc(bare))
        self.assertTrue(any("no `Needs` line" in message for message in found))
        self.assertTrue(any("no `Actor` line" in message for message in found))
        self.assertTrue(any("no `Source` line" in message for message in found))
        self.assertTrue(any("Path is `missing`" in message for message in found))
        self.assertTrue(any("no `**Acceptance criteria**` checklist" in message for message in found))

    def test_bad_path_kind(self):
        found = self.problems(doc(task("T1", path="Sad")))
        self.assertTrue(any("Path is `Sad`" in message for message in found))

    def test_criterion_that_is_not_a_checkbox(self):
        found = self.problems(doc(task("T1", ticks="1. It works.")))
        self.assertTrue(any("not a checklist item" in message for message in found))
        found = self.problems(doc(task("T1", ticks="")))
        self.assertTrue(any("hold no `- [ ]` item" in message for message in found))

    def test_marker_without_question(self):
        found = self.problems(doc(task("T1", extra=" [Q4]")))
        self.assertTrue(any("no open question Q4 exists" in message for message in found))

    def test_marker_of_resolved_question(self):
        text = doc(task("T1", extra=" [Q1]"), questions="## Resolved questions\n\n- Q1: What? → This (me)\n")
        found = self.problems(text)
        self.assertTrue(any("[Q1], which is resolved" in message for message in found))

    def test_question_and_marker_must_agree(self):
        text = doc(task("T1", extra=" [Q1]"), task("T2"), questions=QUESTION % "T2")
        found = self.problems(text)
        self.assertTrue(any("T1 carries [Q1], but `Blocks` of Q1 does not list T1" in m for m in found))
        self.assertTrue(any("Q1 blocks T2, but T2 carries no [Q1] marker" in m for m in found))
        text = doc(task("T1", extra=" [Q1]"), questions=QUESTION % "T7")
        self.assertTrue(any("Q1 blocks T7, which is not a task" in m for m in self.problems(text)))

    def test_status_is_required(self):
        found = self.problems(doc(task("T1", status=None)))
        self.assertTrue(any("Status is `missing`" in message for message in found))
        found = self.problems(doc(task("T1", status="Maybe")))
        self.assertTrue(any("Status is `Maybe`" in message for message in found))

    def test_optional_must_not_block_required(self):
        text = doc(task("T1", status="Optional"), task("T2", needs="T1"))
        found = self.problems(text)
        self.assertEqual(len(found), 1)
        self.assertIn("T2 is required but needs T1, which is optional", found[0])
        text = doc(task("T1", status="Optional"), task("T2", needs="T1", status="Optional"))
        self.assertEqual(self.problems(text), [])

    def test_needs_must_give_a_reason(self):
        found = self.problems(doc(task("T1"), task("T2", needs="T1", because=False)))
        self.assertEqual(len(found), 1)
        self.assertIn("gives no `Needs because` line", found[0])

    def test_redundant_dependency(self):
        text = doc(task("T1"), task("T2", needs="T1"), task("T3", needs="T1, T2"))
        found = self.problems(text)
        self.assertEqual(len(found), 1)
        self.assertIn("T3 needs T1, but T2 already needs it through T2", found[0])

    def test_coverage_section_is_required(self):
        found = self.problems(doc(task("T1"), coverage="## Other\n\nx\n"))
        self.assertTrue(any("no `## Coverage` section" in message for message in found))

    def test_coverage_row_must_cover_something_that_exists(self):
        table = ("## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n"
                 "| R1 First | T1 |\n| R2 Second | |\n| R3 Third | T9, Q8 |\n")
        found = self.problems(doc(task("T1"), coverage=table))
        self.assertTrue(any('"R2 Second" is covered by no task' in message for message in found))
        self.assertTrue(any("names T9, which is not a task" in message for message in found))
        self.assertTrue(any("names Q8, which is not a question" in message for message in found))

    def test_task_in_no_coverage_row(self):
        table = "## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n| R1 First | T1 |\n"
        found = self.problems(doc(task("T1"), task("T2"), coverage=table))
        self.assertEqual(len(found), 1)
        self.assertIn("T2 is in no row of the `## Coverage` table", found[0])

    def test_coverage_may_cite_a_question(self):
        table = ("## Coverage\n\n| Source statement | Covered by |\n| --- | --- |\n"
                 "| R1 First | T1 |\n| R2 Wording not stated | Q1 |\n")
        text = doc(task("T1", extra=" [Q1]"), coverage=table, questions=QUESTION % "T1")
        self.assertEqual(self.problems(text), [])

    def test_fenced_examples_are_ignored(self):
        text = doc(task("T1")) + "\n```markdown\n### T9. Example in a fence\n```\n"
        self.assertEqual(self.problems(text), [])

    def test_check_exit_codes(self):
        bad = self.write(doc(task("T1", needs="T2")))
        code, out, _ = self.run_cli("check", bad)
        self.assertEqual(code, 1)
        self.assertIn("tasks.md:", out)
        self.assertIn("1 problem.", out)


class StatusTests(Case):
    def chain(self, first_ticked=False):
        ticks = "- [x] Done." if first_ticked else "- [ ] Not yet."
        return doc(task("T1", ticks=ticks), task("T2", needs="T1"), task("T3", needs="T1"),
                   task("T4", needs="T2, T3"), task("T5"))

    def test_ready_and_blocked(self):
        code, out, _ = self.run_cli("status", self.write(self.chain()))
        self.assertEqual(code, 0)
        self.assertIn("0 done, 2 ready, 3 blocked", out)
        self.assertIn("T1  Does a thing (Happy)", out)
        self.assertIn("Required tasks not done: 5.", out)
        self.assertIn("T4  Does a thing: waits for T2, T3", out)

    def test_ticking_unblocks(self):
        code, out, _ = self.run_cli("status", self.write(self.chain(first_ticked=True)))
        self.assertIn("1 done, 3 ready, 1 blocked", out)
        self.assertIn("Done (1): T1", out)

    def test_partly_ticked_is_not_done(self):
        text = doc(task("T1", ticks="- [x] One.\n- [ ] Two."), task("T2", needs="T1"))
        _, out, _ = self.run_cli("status", self.write(text))
        self.assertIn("0 done, 1 ready, 1 blocked", out)

    def test_open_question_blocks_a_task_whose_needs_are_done(self):
        text = doc(task("T1", ticks="- [x] Done."), task("T2", needs="T1", extra=" [Q1]"),
                   questions=QUESTION % "T2")
        code, out, _ = self.run_cli("status", self.write(text))
        self.assertIn("T2  Does a thing: open question Q1", out)
        self.assertEqual(code, 3)
        self.assertIn("Nothing is ready", out)

    def test_optional_tasks_are_labelled_and_not_counted_as_required(self):
        text = doc(task("T1"), task("T2", status="Optional", path="Alternative"))
        _, out, _ = self.run_cli("status", self.write(text))
        self.assertIn("T2  Does a thing (Alternative, optional)", out)
        self.assertIn("Required tasks not done: 1.", out)

    def test_all_done_exits_zero(self):
        text = doc(task("T1", ticks="- [x] Done."))
        code, out, _ = self.run_cli("status", self.write(text))
        self.assertEqual(code, 0)
        self.assertIn("1 done, 0 ready, 0 blocked", out)

    def test_status_stops_on_problems(self):
        code, out, _ = self.run_cli("status", self.write(doc(task("T1", needs="T2"), task("T2", needs="T1"))))
        self.assertEqual(code, 1)
        self.assertIn("dependency cycle", out)
        self.assertNotIn("Ready to start", out)

    def test_paths_by_feature(self):
        text = doc(task("T1"), task("T2", needs="T1", path="Negative"), task("T3", needs="T1", path="Negative"))
        _, out, _ = self.run_cli("status", self.write(text))
        self.assertIn("Demo: 1 happy, 0 alternative, 2 negative", out)


class WavesAndTraceTests(Case):
    TEXT = doc(task("T1"), task("T2", needs="T1"), task("T3", needs="T1"), task("T4", needs="T2, T3"),
               task("T5"), task("T6", needs="T5"))

    def test_waves(self):
        code, out, _ = self.run_cli("waves", self.write(self.TEXT))
        self.assertEqual(code, 0)
        wave1, wave2, wave3 = out.split("Wave 2")[0], out.split("Wave 2")[1].split("Wave 3")[0], out.split("Wave 3")[1]
        for name in ("T1 ", "T5 "):
            self.assertIn(name, wave1)
        for name in ("T2 ", "T3 ", "T6 "):
            self.assertIn(name, wave2)
        self.assertIn("T4 ", wave3)
        self.assertIn("Longest chain (3 tasks, one after the other): T1 -> T2 -> T4", out)

    def test_trace(self):
        code, out, _ = self.run_cli("trace", self.write(self.TEXT), "t2")
        self.assertEqual(code, 0)
        self.assertIn("Needs directly: T1", out)
        self.assertIn("Waits for it (all, through the chain): T4", out)
        self.assertIn("Can run in parallel with (no dependency either way): T3, T5, T6", out)

    def test_trace_unknown_task(self):
        code, _, err = self.run_cli("trace", self.write(self.TEXT), "T99")
        self.assertEqual(code, 2)
        self.assertIn("T99 is not a task", err)


class UsageTests(Case):
    def test_missing_file(self):
        code, _, err = self.run_cli("check", os.path.join(self.dir, "none.md"))
        self.assertEqual(code, 2)
        self.assertIn("is not a file", err)

    def test_no_tasks(self):
        code, _, err = self.run_cli("check", self.write("# Empty\n\n## Feature: X\n"))
        self.assertEqual(code, 2)
        self.assertIn("no task found", err)

    def test_no_command(self):
        code, _, _ = self.run_cli()
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
