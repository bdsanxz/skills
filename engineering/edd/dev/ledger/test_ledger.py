"""Tests for scripts/ledger.py.

    python3 skills/engineering/edd/dev/ledger/test_ledger.py
"""

import contextlib
import io
import json
import shutil
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import ledger  # noqa: E402

TICKET = """# T038 Cancel a render

## Acceptance criteria

- [ ] When the render is interrupted, it prints "Render cancelled" and exits 130.
- [x] When the run has ended, no file | no staging file is left.
- [U] When the video is opened in a player, it plays.

## Out of scope

- Resuming a cancelled render.
"""

CARGO = """running 3 tests
test cancel::t038_c1_an_interrupt_exits_130 ... ok
test cancel::t038_c2_nothing_is_left ... ok
test cancel::t038_c3_parked ... ignored
test cancel::t038_c4_broken ... FAILED
---- cancel::t038_c1_an_interrupt_exits_130 stdout ----
test result: FAILED. 2 passed; 1 failed; 1 ignored
"""


def run(*argv):
    """Runs the script; returns its exit code, standard output and standard error."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = ledger.main(list(argv))
        except SystemExit as stop:
            code = stop.code
    return code, out.getvalue(), err.getvalue()


class Project:
    """A small project in a temporary folder with a ledger whose three criteria are proven."""

    def __init__(self, case):
        self.dir = os.path.realpath(tempfile.mkdtemp())
        case.addCleanup(self.remove)
        self.path = self.at("_swe/edd/cancel/ledger.json")
        self.write("ticket.md", TICKET, age=300)
        self.write("src/render.rs", "fn render() {}\n", age=300)
        self.write("tests/cancel.rs", "fn t038_c1() {}\n", age=300)
        code, _, err = run("init", self.path, "--task", "Cancel a render", "--root", self.dir,
                           "--criteria-from", self.at("ticket.md"), "--section", "acceptance criteria",
                           "--code", "src", "--code", "tests")
        case.assertEqual(code, 0, err)
        self.ev = "_swe/edd/cancel/evidence/"
        self.write(self.ev + "run.sh", "echo 'the label: `[exit 131]`'\n", age=200)
        self.write(self.ev + "c1-interrupt.txt", "$ render demo\nRender cancelled (in capture)\n[exit 130]\n", age=100)
        self.write(self.ev + "c2-left-behind.txt", "after the run, the project folder holds:   ./index.html\n", age=100)
        self.write(self.ev + "c3-played.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR", age=100)
        self.write(self.ev + "c3-played.txt", "events: play (0.001), ended (2.000)\n", age=100)
        self.write(self.ev + "tests.txt", CARGO, age=100)
        doc = self.read()
        doc["test_logs"] = [self.ev + "tests.txt"]
        rows = doc["criteria"]
        rows[0].update(status="proven", on_screen=False, tests=["t038_c1_an_interrupt_exits_130"],
                       evidence=[self.ev + "c1-interrupt.txt"], made_by=[self.ev + "run.sh"],
                       shows="The run prints `Render cancelled (in capture)` and ends `[exit 130]`.")
        rows[1].update(status="proven", on_screen=False, tests=["cancel::t038_c2_nothing_is_left"],
                       evidence=[self.ev + "c2-left-behind.txt"], made_by=[self.ev + "run.sh"],
                       shows="Afterwards `the project folder holds: ./index.html`.")
        rows[2].update(status="proven", on_screen=True, no_test="Playback in a player is not reachable from the suite.",
                       evidence=[self.ev + "c3-played.png", self.ev + "c3-played.txt"],
                       shows="The player reports `ended (2.000)`; the picture shows the last frame.")
        self.save(doc)

    def remove(self):
        for folder, folders, names in os.walk(self.dir, topdown=False):
            for name in names:
                os.unlink(os.path.join(folder, name))
            for name in folders:
                os.rmdir(os.path.join(folder, name))
        os.rmdir(self.dir)

    def at(self, relative):
        return os.path.join(self.dir, relative)

    def write(self, relative, content, age=0):
        path = self.at(relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(content if isinstance(content, bytes) else content.encode("utf-8"))
        stamp = os.path.getmtime(path) - age
        os.utime(path, (stamp, stamp))

    def read(self):
        with open(self.path, encoding="utf-8") as handle:
            return json.load(handle)

    def save(self, doc):
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(doc, handle)

    def change(self, number, **fields):
        doc = self.read()
        doc["criteria"][number - 1].update(fields)
        self.save(doc)


class InitTest(unittest.TestCase):
    def test_rows_come_from_the_list_items_under_the_heading(self):
        project = Project(self)
        doc = project.read()
        self.assertEqual([row["id"] for row in doc["criteria"]], ["c1", "c2", "c3"])
        self.assertEqual(doc["criteria"][1]["criterion"], "When the run has ended, no file | no staging file is left.")
        self.assertEqual(doc["criteria"][2]["criterion"], "When the video is opened in a player, it plays.")
        self.assertEqual((doc["root"], doc["evidence_dir"], doc["code"]),
                         (os.path.join("..", "..", ".."), "_swe/edd/cancel/evidence", ["src", "tests"]))
        self.assertTrue(os.path.isdir(project.at("_swe/edd/cancel/evidence")))

    def test_new_rows_are_open_and_undecided(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "run", "ledger.json")
            code, out, _ = run("init", path, "--task", "t", "--root", folder, "--criterion", "It works.", "--criterion", "It stops.")
            self.assertEqual(code, 0)
            self.assertIn("2 criteria, all open", out)
            with open(path, encoding="utf-8") as handle:
                rows = json.load(handle)["criteria"]
            self.assertEqual([(row["status"], row["on_screen"], row["evidence"]) for row in rows], [("open", None, [])] * 2)

    def test_plain_lines_are_criteria_when_the_file_has_no_list(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "criteria.txt")
            with open(source, "w", encoding="utf-8") as handle:
                handle.write("# Criteria\n\nIt works.\n\nIt stops.\n")
            self.assertEqual(ledger.criteria_from(source, None), ["It works.", "It stops."])

    def test_an_existing_ledger_is_not_overwritten(self):
        project = Project(self)
        code, _, err = run("init", project.path, "--task", "again", "--criterion", "x")
        self.assertEqual(code, 2)
        self.assertIn("already exists", err)

    def test_wrong_input_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "ledger.json")
            source = os.path.join(folder, "ticket.md")
            with open(source, "w", encoding="utf-8") as handle:
                handle.write(TICKET)
            for argv, said in (
                (("--task", "t"), "give the criteria"),
                (("--task", "t", "--criterion", " "), "a criterion is empty"),
                (("--task", "t", "--criterion", "x", "--criteria-from", source), "not both"),
                (("--task", "t", "--criteria-from", source, "--section", "Nowhere"), "no heading"),
                (("--task", "t", "--criteria-from", os.path.join(folder, "none.md")), "criteria file"),
                (("--task", "t", "--criterion", "x", "--root", folder, "--code", "missing"), "does not exist"),
                (("--criterion", "x"), "--task"),
            ):
                code, _, err = run("init", path, *argv)
                self.assertEqual(code, 2, argv)
                self.assertIn(said, err)
                self.assertFalse(os.path.exists(path))


class CheckTest(unittest.TestCase):
    def problems(self, project, code=1):
        got, out, _ = run("check", project.path)
        self.assertEqual(got, code, out)
        return out

    def test_a_backed_ledger_passes(self):
        out = self.problems(Project(self), code=0)
        self.assertIn("3 criteria: 3 proven, 0 open, 0 for the user to check, 0 waived", out)
        self.assertIn("every criterion is closed and backed", out)
        self.assertNotIn("problems:", out)

    def test_open_and_user_check_rows_keep_the_task_incomplete(self):
        project = Project(self)
        project.change(2, status="open", note="The staging file is still there after a cancel in encode.")
        project.change(3, status="user-check", note="Open out/demo.mp4 in a player and watch it to the end.")
        out = self.problems(project, code=3)
        self.assertIn("c2 [open]: The staging file is still there", out)
        self.assertIn("c3 [user-check]: Open out/demo.mp4", out)
        self.assertIn("not complete", out)
        self.assertIn("is named by no row", self.problems_after(project, 2, evidence=[], made_by=[]))

    def problems_after(self, project, number, **fields):
        project.change(number, **fields)
        return run("check", project.path)[1]

    def test_missing_and_empty_evidence_is_a_problem(self):
        project = Project(self)
        project.write(project.ev + "c2-left-behind.txt", "")
        project.change(1, evidence=[project.ev + "c1-gone.txt"])
        out = self.problems(project)
        self.assertIn("c1: evidence file _swe/edd/cancel/evidence/c1-gone.txt is missing or empty", out)
        self.assertIn("c2: evidence file _swe/edd/cancel/evidence/c2-left-behind.txt is missing or empty", out)
        self.assertIn("Nothing in this ledger may be reported as proven", out)

    def test_a_proven_row_needs_evidence_and_words(self):
        project = Project(self)
        project.change(1, evidence=[], shows=" ")
        out = self.problems(project)
        self.assertIn("c1: no evidence file is named", out)
        self.assertIn("c1: `shows` is empty", out)

    def test_a_quote_must_be_in_the_rows_own_evidence(self):
        project = Project(self)
        project.change(1, shows="It ends `[exit 131]` after `Render cancelled (in capture)`.")
        out = self.problems(project)
        self.assertIn("c1: `shows` quotes `[exit 131]`", out)
        self.assertNotIn("quotes `Render cancelled", out)

    def test_a_quote_may_span_squashed_whitespace(self):
        project = Project(self)
        project.change(2, shows="It says `the project   folder holds: ./index.html`.")
        self.problems(project, code=0)

    def test_text_evidence_must_be_quoted(self):
        project = Project(self)
        project.change(1, shows="The run is cancelled and exits 130.")
        self.assertIn("c1: `shows` quotes nothing", self.problems(project))

    def test_a_picture_alone_cannot_back_a_quote(self):
        project = Project(self)
        project.change(3, evidence=[project.ev + "c3-played.png"], shows="The player says `ended (2.000)`.")
        out = self.problems(project)
        self.assertIn("c3: `shows` quotes text, and the evidence holds no text file", out)

    def test_something_seen_needs_a_picture(self):
        project = Project(self)
        project.change(3, evidence=[project.ev + "c3-played.txt"], shows="The player reports `ended (2.000)`.")
        out = self.problems(project)
        self.assertIn("c3: the criterion is about something seen, and its evidence is text only", out)

    def test_on_screen_must_be_decided(self):
        project = Project(self)
        project.change(1, on_screen=None)
        self.assertIn("c1: `on_screen` is not decided", self.problems(project))

    def test_a_stand_in_needs_the_users_acceptance(self):
        project = Project(self)
        project.change(1, stand_in="A sandbox denied the network; the machine stayed connected.")
        self.assertIn("c1: it was checked by a stand-in that nobody accepted", self.problems(project))
        project.change(1, accepted='2026-10-11, user: "Accept the sandbox check"')
        out = self.problems(project, code=0)
        self.assertIn("3 proven (1 by a stand-in the user accepted)", out)

    def test_a_named_test_must_have_passed(self):
        project = Project(self)
        project.change(1, tests=["t038_c3_parked", "t038_c4_broken", "t038_c9_not_there", "t038_c1"])
        out = self.problems(project)
        self.assertIn("c1: test t038_c3_parked was skipped or ignored", out)
        self.assertIn("c1: test t038_c4_broken failed", out)
        self.assertIn("c1: test t038_c9_not_there is in no test log", out)
        self.assertIn("c1: test t038_c1 is in no test log", out)

    def test_a_row_needs_a_test_or_a_reason(self):
        project = Project(self)
        project.change(3, no_test="")
        self.assertIn("c3: no test is named", self.problems(project))

    def test_named_tests_need_a_test_log(self):
        project = Project(self)
        doc = project.read()
        doc["test_logs"] = []
        project.save(doc)
        out = self.problems(project)
        self.assertIn("c1: tests are named and `test_logs` is empty", out)
        self.assertIn("evidence/tests.txt is named by no row", out)

    def test_evidence_older_than_the_code_is_stale(self):
        project = Project(self)
        project.write("src/render.rs", "fn render() { /* changed */ }\n")
        out = self.problems(project)
        self.assertIn("c1: _swe/edd/cancel/evidence/c1-interrupt.txt was made at", out)
        self.assertIn("before src/render.rs last changed", out)
        self.assertIn("test log _swe/edd/cancel/evidence/tests.txt was made at", out)

    def test_evidence_older_than_its_script_is_stale(self):
        project = Project(self)
        project.write(project.ev + "run.sh", "echo changed\n")
        out = self.problems(project)
        self.assertIn("c1-interrupt.txt was made at", out)
        self.assertIn("before its script _swe/edd/cancel/evidence/run.sh last changed", out)
        self.assertNotIn("c3:", out)

    def test_the_run_folder_is_not_code(self):
        project = Project(self)
        doc = project.read()
        doc["code"] = ["."]
        project.save(doc)
        self.problems(project, code=0)

    def test_code_must_be_listed_and_exist(self):
        project = Project(self)
        doc = project.read()
        doc["code"] = []
        project.save(doc)
        self.assertIn("`code` is empty", self.problems(project))
        doc["code"] = ["lib"]
        project.save(doc)
        self.assertIn("`code` names lib, which does not exist", self.problems(project))

    def test_a_file_no_row_names_is_a_problem(self):
        project = Project(self)
        project.write(project.ev + "c1-before-fix.txt", "Render cancelled\n[exit 1]\n")
        out = self.problems(project)
        self.assertIn("_swe/edd/cancel/evidence/c1-before-fix.txt is named by no row", out)

    def test_nothing_may_point_into_the_work_folder(self):
        project = Project(self)
        project.write("_swe/edd/cancel/work/run-1/tests.txt", CARGO, age=100)
        doc = project.read()
        doc["test_logs"] = ["_swe/edd/cancel/work/run-1/tests.txt"]
        project.save(doc)
        out = self.problems(project)
        self.assertIn("_swe/edd/cancel/work/run-1/tests.txt is in the work folder", out)
        out = self.problems_after(project, 1, evidence=["_swe/edd/cancel/work/run-1/tests.txt"])
        self.assertIn("c1: _swe/edd/cancel/work/run-1/tests.txt is in the work folder", out)

    def test_work_folders_are_noted_while_open_and_refused_at_the_close(self):
        project = Project(self)
        project.write("_swe/edd/cancel/work/run-1/out.txt", "x\n")
        project.write("_swe/edd/cancel/work/ledger.before.json", "{}\n")
        project.change(2, status="open", note="Not run yet.")
        out = self.problems(project, code=3)
        self.assertIn("_swe/edd/cancel/work still holds 2 entries: ledger.before.json, run-1.", out)
        project.change(2, status="proven")
        out = self.problems(project)
        self.assertIn("the run is not closed while it holds any", out)
        os.unlink(project.at("_swe/edd/cancel/work/run-1/out.txt"))
        os.rmdir(project.at("_swe/edd/cancel/work/run-1"))
        os.unlink(project.at("_swe/edd/cancel/work/ledger.before.json"))
        self.problems(project, code=0)

    def test_identical_evidence_files_are_noted(self):
        project = Project(self)
        project.write(project.ev + "c2-copy.txt", "$ render demo\nRender cancelled (in capture)\n[exit 130]\n", age=100)
        project.change(2, evidence=[project.ev + "c2-copy.txt", project.ev + "c2-left-behind.txt"])
        out = self.problems(project, code=0)
        self.assertIn("hold the same bytes: _swe/edd/cancel/evidence/c1-interrupt.txt, _swe/edd/cancel/evidence/c2-copy.txt", out)

    def test_user_check_and_waived_rows_need_their_fields(self):
        project = Project(self)
        project.change(1, status="user-check", evidence=[], made_by=[project.ev + "run.sh"], shows="")
        project.change(3, status="waived", evidence=[], shows="")
        project.write(project.ev + "c1-interrupt.txt", "kept for c2\n", age=100)
        project.change(2, evidence=[project.ev + "c1-interrupt.txt", project.ev + "c2-left-behind.txt"])
        os.unlink(project.at(project.ev + "c3-played.png"))
        os.unlink(project.at(project.ev + "c3-played.txt"))
        out = self.problems(project)
        self.assertIn("c1: `note` must say exactly what the user has to run", out)
        self.assertIn("c3: a waived criterion needs `accepted`", out)
        self.assertIn("c3: `note` must say why the criterion is not met", out)
        project.change(1, note="Turn Wi-Fi off and run evidence/run.sh.")
        project.change(3, accepted='2026-10-11, user: "Keep ours, approve the gap"', note="Ours gives 144 frames; closest is 120.")
        out = self.problems(project, code=3)
        self.assertIn("1 for the user to check, 1 waived", out)

    def test_a_malformed_row_is_reported_before_anything_else(self):
        project = Project(self)
        project.change(1, status="done", tests="t038_c1")
        project.change(2, id="c1")
        out = self.problems(project)
        self.assertIn("c1: `status` is 'done'", out)
        self.assertIn("c1: `tests` must be a list", out)
        self.assertIn("two rows have the id c1", out)

    def test_unreadable_ledgers_are_usage_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "ledger.json")
            for content, said in (
                (None, "ledger"),
                ("{", "not valid JSON"),
                ("{}", "was not written by"),
                (json.dumps({"format": ledger.FORMAT, "criteria": []}), "`criteria` must be a list"),
                (json.dumps({"format": ledger.FORMAT, "criteria": [{}], "code": "src"}), "`code` must be a list"),
                (json.dumps({"format": ledger.FORMAT, "criteria": [{}], "root": "nowhere", "evidence_dir": "e"}), "is not a directory"),
            ):
                if content is not None:
                    with open(path, "w", encoding="utf-8") as handle:
                        handle.write(content)
                code, _, err = run("check", path)
                self.assertEqual(code, 2, content)
                self.assertIn(said, err)

    def test_several_ledgers_give_the_worst_result(self):
        good, bad = Project(self), Project(self)
        bad.change(1, shows="")
        self.assertEqual(run("check", good.path, bad.path)[0], 1)
        self.assertEqual(run("check", bad.path, good.path)[0], 1)
        bad.change(1, status="open", note="The claim is not written yet.")
        self.assertEqual(run("check", good.path, bad.path)[0], 3)
        self.assertEqual(run("check", good.path, good.path)[0], 0)


class TestLogTest(unittest.TestCase):
    def states(self, log, **expected):
        for name, state in expected.items():
            self.assertEqual(ledger.test_state(name.replace("__", "::"), log), state, name)

    def test_cargo(self):
        self.states(CARGO, t038_c1_an_interrupt_exits_130="passed", cancel__t038_c2_nothing_is_left="passed",
                    t038_c3_parked="skipped", t038_c4_broken="failed", t038_c2="absent")

    def test_pytest(self):
        log = ("tests/test_cart.py::test_empty_cart PASSED                 [ 25%]\n"
               "tests/test_cart.py::test_total[two-items] PASSED           [ 50%]\n"
               "tests/test_cart.py::test_total[none] FAILED                [ 75%]\n"
               "tests/test_cart.py::test_later SKIPPED (not yet)           [100%]\n"
               "FAILED tests/test_cart.py::test_total[none] - assert 0 == 1\n")
        self.states(log, test_empty_cart="passed", test_total="failed", test_later="skipped", test_cart="absent")
        self.assertEqual(ledger.test_state("test_total[two-items]", log), "passed")

    def test_go(self):
        log = ("=== RUN   TestCancel\n--- PASS: TestCancel (0.01s)\n=== RUN   TestCancel/encode\n"
               "    --- FAIL: TestCancel/encode (0.00s)\n=== RUN   TestLater\n--- SKIP: TestLater (0.00s)\n"
               "=== RUN   TestHung\n")
        self.states(log, TestCancel="passed", TestLater="skipped", TestHung="unknown")
        self.assertEqual(ledger.test_state("TestCancel/encode", log), "failed")

    def test_jest_and_vitest(self):
        log = (" ✓ sums two items (2 ms)\n ✕ shows an error when the payment failed (5 ms)\n"
               " ○ skipped rounds half up\n ✓ src/cart.test.ts > cart > keeps a failed order 1ms\n")
        self.assertEqual(ledger.test_state("sums two items", log), "passed")
        self.assertEqual(ledger.test_state("shows an error when the payment failed", log), "failed")
        self.assertEqual(ledger.test_state("rounds half up", log), "skipped")
        self.assertEqual(ledger.test_state("keeps a failed order", log), "passed")

    def test_tap(self):
        log = "ok 1 - sums two items\nnot ok 2 - rounds half up\nok 3 - later # SKIP not yet\n"
        self.assertEqual(ledger.test_state("sums two items", log), "passed")
        self.assertEqual(ledger.test_state("rounds half up", log), "failed")
        self.assertEqual(ledger.test_state("later", log), "skipped")

    def test_junit_xml(self):
        log = ('<?xml version="1.0"?>\n<testsuites><testsuite name="cart">'
               '<testcase classname="cart.total" name="sums two items"/>'
               '<testcase classname="cart.total" name="rounds half up"><failure message="x"/></testcase>'
               '<testcase classname="cart.total" name="later"><skipped/></testcase>'
               "</testsuite></testsuites>")
        self.assertEqual(ledger.test_state("sums two items", log), "passed")
        self.assertEqual(ledger.test_state("cart.total.rounds half up", log), "failed")
        self.assertEqual(ledger.test_state("later", log), "skipped")
        self.assertEqual(ledger.test_state("not there", log), "absent")

    def test_a_pass_in_any_log_counts_and_the_worst_line_in_one_log_counts(self):
        self.assertEqual(ledger.best(["failed", "passed"]), "passed")
        self.assertEqual(ledger.test_state("t1", "test t1 ... ok\ntest t1 ... FAILED\n"), "failed")


class TableTest(unittest.TestCase):
    def test_the_table_repeats_the_ledger(self):
        project = Project(self)
        project.change(1, stand_in="A second browser stood in for the user's own.", accepted='2026-10-11, user: "Accept as verified"')
        code, out, _ = run("table", project.path)
        self.assertEqual(code, 0)
        lines = out.splitlines()
        self.assertEqual(lines[0], "3 criteria: 3 proven (1 by a stand-in the user accepted), 0 open, 0 for the user to check, 0 waived.")
        self.assertEqual(lines[2], "| # | Criterion | Status | Tests | Evidence | What it shows |")
        self.assertEqual(len(lines), 7)
        self.assertIn("| c1 | When the render is interrupted, it prints \"Render cancelled\" and exits 130. | proven by a stand-in | "
                      "`t038_c1_an_interrupt_exits_130` | `_swe/edd/cancel/evidence/c1-interrupt.txt`, `_swe/edd/cancel/evidence/run.sh` |", lines[4])
        self.assertIn("**Stand-in:** A second browser stood in for the user's own. **Accepted:** 2026-10-11", lines[4])
        self.assertIn("no file \\| no staging file", lines[5])
        self.assertIn("| proven | Playback in a player is not reachable from the suite. |", lines[6])

    def test_rows_that_are_not_closed_say_so(self):
        project = Project(self)
        project.change(1, status="open", note="Exit code is 1,\nnot 130.", evidence=[], made_by=[], shows="")
        os.unlink(project.at(project.ev + "c1-interrupt.txt"))
        project.change(3, status="user-check", note="Play out/demo.mp4 to the end.", evidence=[], shows="")
        os.unlink(project.at(project.ev + "c3-played.png"))
        os.unlink(project.at(project.ev + "c3-played.txt"))
        code, out, _ = run("table", project.path)
        self.assertEqual(code, 3)
        self.assertIn("| open | `t038_c1_an_interrupt_exits_130` |  | **Open:** Exit code is 1, not 130. |", out)
        self.assertIn("| for the user to check | Playback in a player is not reachable from the suite. |  | **To check:** Play out/demo.mp4 to the end. |", out)

    def test_no_table_while_a_problem_stands(self):
        project = Project(self)
        project.change(1, shows="It ends `[exit 0]`.")
        code, out, err = run("table", project.path)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("c1: `shows` quotes `[exit 0]`", err)
        self.assertIn("no table: fix the problems first", err)


class PruneTest(unittest.TestCase):
    def test_deletes_the_work_folder_of_a_closed_run(self):
        project = Project(self)
        project.write("_swe/edd/cancel/work/run-1/repo/.git/objects/ab", "x\n")
        os.chmod(project.at("_swe/edd/cancel/work/run-1/repo/.git/objects/ab"), 0o444)
        project.write("_swe/edd/cancel/work/run-2/out.txt", "x\n")
        code, out, _ = run("prune", project.path)
        self.assertEqual(code, 0, out)
        self.assertIn("Deleted _swe/edd/cancel/work: 2 entries (run-1, run-2).", out)
        self.assertIn("every criterion is closed and backed", out)
        self.assertFalse(os.path.exists(project.at("_swe/edd/cancel/work")))
        self.assertTrue(os.path.isfile(project.at(project.ev + "c1-interrupt.txt")))
        self.assertIn("No work folder to delete.", run("prune", project.path)[1])

    def test_deletes_nothing_while_the_run_is_open_or_has_another_problem(self):
        project = Project(self)
        project.write("_swe/edd/cancel/work/run-1/out.txt", "x\n")
        project.change(2, status="open", note="Not run yet.")
        code, out, _ = run("prune", project.path)
        self.assertEqual(code, 1)
        self.assertIn("Nothing was deleted", out)
        project.change(2, status="proven")
        project.write(project.ev + "c1-before-fix.txt", "old\n")
        code, out, _ = run("prune", project.path)
        self.assertEqual(code, 1)
        self.assertIn("is named by no row", out)
        self.assertTrue(os.path.isfile(project.at("_swe/edd/cancel/work/run-1/out.txt")))


class EvidenceSizeTest(unittest.TestCase):
    def test_a_large_evidence_folder_and_large_pictures_are_noted(self):
        project = Project(self)
        limits = ledger.EVIDENCE_LIMIT, ledger.MEDIA_LIMIT
        self.addCleanup(lambda: (setattr(ledger, "EVIDENCE_LIMIT", limits[0]),
                                 setattr(ledger, "MEDIA_LIMIT", limits[1])))
        code, out, _ = run("check", project.path)
        self.assertNotIn("more than", out)
        ledger.EVIDENCE_LIMIT, ledger.MEDIA_LIMIT = 100, 10
        code, out, _ = run("check", project.path)
        self.assertEqual(code, 0, out)
        self.assertIn("the evidence folder _swe/edd/cancel/evidence holds", out)
        self.assertIn("The largest files: _swe/edd/cancel/evidence/", out)
        self.assertIn("_swe/edd/cancel/evidence/c3-played.png takes", out)
        self.assertNotIn("c1-interrupt.txt takes", out)


class DiskFooterTest(unittest.TestCase):
    def setUp(self):
        self.folder = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, True)
        os.makedirs(os.path.join(self.folder, "work", "run-1"))
        with open(os.path.join(self.folder, "work", "run-1", "big.bin"), "wb") as handle:
            handle.write(os.urandom(3 * 1024 * 1024))
        os.link(os.path.join(self.folder, "work", "run-1", "big.bin"),
                os.path.join(self.folder, "work", "same.bin"))
        here = os.getcwd()
        os.chdir(self.folder)
        self.addCleanup(os.chdir, here)

    def test_every_command_ends_with_what_the_current_folder_takes(self):
        code, _, err = run(*["check", "missing/ledger.json"])
        self.assertEqual(code, 2)
        last = err.strip().splitlines()[-1]
        self.assertTrue(last.startswith("ledger.py: disk: the current folder %s takes " % self.folder),
                        last)
        self.assertIn(" 3.0 MB; its disk has ", last)
        self.assertRegex(last, r"free of [0-9.]+ GB\.$")
        size, whole = ledger.folder_size(self.folder, 5)
        self.assertTrue(whole)
        self.assertLess(size, 4 * 1024 * 1024)

    def test_a_folder_too_large_to_count_in_time_is_given_as_a_lower_bound(self):
        limit = ledger.DISK_SECONDS
        ledger.DISK_SECONDS = 0
        self.addCleanup(setattr, ledger, "DISK_SECONDS", limit)
        _, _, err = run(*["check", "missing/ledger.json"])
        self.assertIn("takes at least ", err)
        self.assertIn("(counting stopped after 0 s)", err)


if __name__ == "__main__":
    unittest.main()
