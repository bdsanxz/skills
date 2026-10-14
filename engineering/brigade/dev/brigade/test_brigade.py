"""Tests for scripts/brigade.py. They need git 2.38 or newer.

    python3 skills/engineering/brigade/dev/brigade/test_brigade.py
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import brigade  # noqa: E402

os.environ.update({
    "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.com",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
})

TICKET = """# Checkout

## Acceptance criteria

- [ ] POST /orders answers 201 with the order's id.
- [ ] The checkout page shows the total | with tax.
- [ ] An order placed on the page appears in the list.

## Out of scope

- Refunds.
"""


def run(*argv):
    """Runs the script; returns its exit code, standard output and standard error."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = brigade.main(list(argv))
        except SystemExit as stop:
            code = stop.code
    return code, out.getvalue(), err.getvalue()


def order(name, **fields):
    made = {"id": name, "title": "Build " + name, "goal": "Build the %s part." % name,
            "covers": [], "owns": ["src/" + name], "after": []}
    made.update(fields)
    return made


class Project:
    """A git repository in a temporary folder, with a plan of three criteria beside it."""

    def __init__(self, case, orders=None):
        self.case = case
        self.dir = os.path.realpath(tempfile.mkdtemp())
        case.addCleanup(shutil.rmtree, self.dir, True)
        self.git(self.dir, "init", "-q", "-b", "main")
        self.write("ticket.md", TICKET)
        self.write("src/api/server.txt", "server\n")
        self.write("src/web/page.txt", "page\n")
        self.git(self.dir, "add", "-A")
        self.git(self.dir, "commit", "-q", "-m", "first")
        self.plan = os.path.join(self.dir, "_swe", "brigade", "demo", "plan.json")
        code, out, err = run("init", self.plan, "--task", "Build the checkout",
                             "--criteria-from", self.at("ticket.md"),
                             "--section", "Acceptance criteria", "--repo", self.dir)
        case.assertEqual(code, 0, out + err)
        if orders is None:
            orders = [order("api", covers=["c1"]), order("web", covers=["c2"]),
                      order("e2e", covers=["c3"], owns=["tests/e2e"], after=["api", "web"])]
        self.edit(orders=orders)

    def at(self, relative):
        return os.path.join(self.dir, relative)

    def tree(self, name):
        return os.path.join(os.path.dirname(self.plan), "trees", name)

    def write(self, relative, text, root=None):
        path = os.path.join(root or self.dir, relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)

    def git(self, folder, *args):
        result = subprocess.run(["git", "-C", folder] + list(args), stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, universal_newlines=True)
        self.case.assertEqual(result.returncode, 0, result.stdout)
        return result.stdout

    def read(self):
        with open(self.plan, encoding="utf-8") as handle:
            return json.load(handle)

    def edit(self, **fields):
        plan = self.read()
        plan.update(fields)
        with open(self.plan, "w", encoding="utf-8") as handle:
            json.dump(plan, handle)

    def state(self):
        with open(os.path.join(os.path.dirname(self.plan), "state.json")) as handle:
            return json.load(handle)

    def do(self, *argv):
        return run(argv[0], self.plan, *argv[1:])

    def ok(self, *argv):
        code, out, err = self.do(*argv)
        self.case.assertEqual(code, 0, out + err)
        return out

    def work(self, name, relative, text="made\n", message="work", report=True):
        """Commits one file on an order's branch, in its tree, and files the order's report."""
        self.write(relative, text, root=self.tree(name))
        self.git(self.tree(name), "add", "-A")
        self.git(self.tree(name), "commit", "-q", "-m", message)
        if report:
            self.report(name)

    def paper(self, folder, name):
        number = self.state()["orders"][name].get("round", 1)
        file_name = name if number == 1 else "%s.round-%d" % (name, number)
        return os.path.join(os.path.dirname(self.plan), folder, file_name + ".md")

    def report(self, name, text="1. **Result:** done.\n"):
        self.write(self.paper("reports", name), text)

    def order_text(self, name):
        """Writes an order's work order with `brief`, and returns its text."""
        self.ok("brief", name)
        with open(os.path.join(os.path.dirname(self.plan), "orders", name + ".md")) as handle:
            return handle.read()

    def finish(self, name, relative=None):
        """Starts an order, commits a file in it, and merges it."""
        self.ok("start", name)
        self.work(name, relative or "src/%s/new.txt" % name)
        self.ok("merge", name, "--checked", "read the diff, ran the gates")


class InitTest(unittest.TestCase):
    def test_takes_the_criteria_word_for_word_from_a_section(self):
        plan = Project(self).read()
        self.assertEqual([c["id"] for c in plan["criteria"]], ["c1", "c2", "c3"])
        self.assertEqual(plan["criteria"][1]["text"],
                         "The checkout page shows the total | with tax.")
        self.assertEqual((plan["run"], plan["base"], plan["repo"]), ("demo", "main", "../../.."))
        self.assertTrue(plan["criteria"][0]["source"].endswith("ticket.md"))

    def test_keeps_the_criteria_of_each_ticket_together(self):
        project = Project(self)
        project.write("tickets/T038-cancel.md", "- It stops.\n- Nothing is left.\n")
        project.write("tickets/T039-resume.md", "1. It resumes.\n")
        plan = project.at("_swe/brigade/tickets/plan.json")
        code, out, err = run("init", plan, "--task", "Two tickets", "--repo", project.dir,
                             "--criteria-from", project.at("tickets/T038-cancel.md"),
                             "--criteria-from", project.at("tickets/T039-resume.md"),
                             "--source", "tickets/")
        self.assertEqual(code, 0, out + err)
        with open(plan) as handle:
            made = json.load(handle)
        self.assertEqual([c["id"] for c in made["criteria"]], ["t038-c1", "t038-c2", "t039-c1"])
        self.assertEqual(made["source"], "tickets/")

    def test_names_criteria_by_the_whole_file_name_when_first_words_collide(self):
        self.assertEqual(brigade.prefixes(["a/ticket-1.md", "a/ticket-2.md"]),
                         ["ticket-1", "ticket-2"])
        self.assertEqual(brigade.prefixes(["a/t.md", "b/t.md"]), ["f1", "f2"])

    def test_notes_uncommitted_work_that_no_tree_will_hold(self):
        project = Project(self)
        project.write("src/api/draft.txt", "draft\n")
        code, out, _ = run("init", project.at("_swe/brigade/two/plan.json"), "--task", "t",
                           "--criterion", "It works.", "--repo", project.dir)
        self.assertEqual(code, 0)
        self.assertIn("uncommitted or untracked in the checkout: src/api/draft.txt.", out)

    def test_the_run_directory_is_not_counted_as_uncommitted_work(self):
        project = Project(self)
        project.git(project.dir, "worktree", "prune")
        code, out, _ = run("init", project.at("_swe/brigade/two/plan.json"), "--task", "t",
                           "--criterion", "It works.", "--repo", project.dir)
        self.assertEqual(code, 0)
        self.assertNotIn("uncommitted", out)

    def test_refuses_wrong_usage(self):
        project = Project(self)
        outside = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, outside, True)
        new = project.at("_swe/brigade/new/plan.json")
        cases = [
            ("init", project.plan, "--task", "t", "--criterion", "c", "--repo", project.dir),
            ("init", new, "--task", "t", "--repo", project.dir),
            ("init", new, "--task", "t", "--criterion", "c", "--repo", outside),
            ("init", new, "--task", "t", "--criterion", "c", "--repo", project.dir,
             "--run", "Bad Name"),
            ("init", new, "--task", "t", "--criterion", "c", "--repo", project.dir,
             "--base", "no-such-branch"),
            ("init", new, "--task", "t", "--criterion", "c", "--repo", project.dir,
             "--criteria-from", project.at("ticket.md")),
            ("init", new, "--task", "t", "--repo", project.dir,
             "--criteria-from", project.at("ticket.md"), "--section", "No such heading"),
        ]
        for argv in cases:
            code, out, err = run(*argv)
            self.assertEqual(code, 2, "%s\n%s%s" % (argv, out, err))
            self.assertFalse(os.path.exists(new))


class CheckTest(unittest.TestCase):
    def problems(self, orders, **fields):
        project = Project(self, orders)
        if fields:
            project.edit(**fields)
        code, out, err = project.do("check")
        return code, out + err

    def test_a_sound_plan_passes_and_shows_the_order_of_work(self):
        code, out = self.problems(None)
        self.assertEqual(code, 0, out)
        self.assertIn("order of work: api, web at once -> e2e.", out)
        self.assertIn("3 orders, 3 criteria, each covered", out)

    def test_a_criterion_no_order_covers(self):
        code, out = self.problems([order("api", covers=["c1", "c2"])])
        self.assertEqual(code, 1)
        self.assertIn("criterion c3 is covered by no order", out)

    def test_an_order_that_serves_no_criterion(self):
        orders = [order("api", covers=["c1", "c2", "c3"]), order("extra")]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        self.assertIn("order extra covers no criterion", out)
        orders[1]["support"] = "The api needs its schema file."
        self.assertEqual(self.problems(orders)[0], 0)

    def test_two_orders_that_could_change_the_same_file_at_once(self):
        orders = [order("api", covers=["c1", "c2"], owns=["src"]),
                  order("web", covers=["c3"], owns=["src/web/page.txt"])]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        self.assertIn("orders api and web could run at the same time and both own "
                      "src/web/page.txt", out)
        orders[1]["after"] = ["api"]
        self.assertEqual(self.problems(orders)[0], 0)

    def test_an_order_far_back_in_the_chain_counts_as_before(self):
        orders = [order("a", covers=["c1"], owns=["src"]),
                  order("b", covers=["c2"], owns=["docs"], after=["a"]),
                  order("c", covers=["c3"], owns=["src/web"], after=["b"])]
        self.assertEqual(self.problems(orders)[0], 0)

    def test_the_whole_repository_overlaps_everything(self):
        orders = [order("a", covers=["c1", "c2"], owns=["."]), order("b", covers=["c3"])]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        self.assertIn("both own src/b", out)

    def test_names_that_only_begin_alike_do_not_overlap(self):
        orders = [order("a", covers=["c1", "c2"], owns=["src/api"]),
                  order("b", covers=["c3"], owns=["src/api-docs", "./src/web/"])]
        self.assertEqual(self.problems(orders)[0], 0)

    def test_orders_waiting_in_a_circle(self):
        orders = [order("a", covers=["c1"], after=["c"]), order("b", covers=["c2"], after=["a"]),
                  order("c", covers=["c3"], after=["b"])]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        self.assertIn("in a circle", out)
        self.assertIn("a -> c -> b -> a", out)

    def test_foundation_orders_run_alone_and_first_in_the_order_listed(self):
        orders = [order("api", covers=["c1"]), order("web", covers=["c2", "c3"]),
                  order("scaffold", foundation=True, owns=["."], support="Sets up the project."),
                  order("tooling", foundation=True, owns=["."], support="Lint and test setup.")]
        code, out = self.problems(orders)
        self.assertEqual(code, 0, out)
        self.assertIn("order of work: scaffold -> tooling -> api, web at once.", out)
        self.assertNotIn("no order is marked", out)

    def test_foundation_cannot_wait_for_an_order_that_is_not(self):
        orders = [order("api", covers=["c1", "c2", "c3"]),
                  order("scaffold", foundation=True, support="Setup.", after=["api"])]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        self.assertIn("order scaffold is foundation and comes `after` api", out)

    def test_notes_a_plan_without_foundation_and_without_gates(self):
        code, out = self.problems(None)
        self.assertIn("no order is marked `foundation`", out)
        self.assertIn("`gates` is empty", out)

    def test_notes_a_plan_in_which_nothing_runs_at_once(self):
        orders = [order("a", covers=["c1"]), order("b", covers=["c2", "c3"], after=["a"])]
        code, out = self.problems(orders)
        self.assertEqual(code, 0)
        self.assertIn("no two orders can run at the same time", out)

    def test_a_dropped_order_covers_nothing_and_nothing_can_wait_for_it(self):
        orders = [order("api", covers=["c1", "c2"]),
                  order("old", covers=["c3"], dropped="Replaced by e2e."),
                  order("e2e", covers=["c2"], owns=["tests"], after=["old"])]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        self.assertIn("criterion c3 is covered by no order", out)
        self.assertIn("order e2e comes `after` old, which is dropped", out)

    def test_names_that_do_not_exist_and_paths_that_leave_the_repository(self):
        orders = [order("api", covers=["c1", "c9"], after=["nobody"], owns=["../other", "/etc"]),
                  order("api", covers=["c2"]), {"id": "Bad Id"}, order("integration"),
                  order("web", covers="c3", foundation="yes", wrong=1)]
        code, out = self.problems(orders)
        self.assertEqual(code, 1)
        for text in ("`covers` names c9", "`after` names nobody", "`owns` holds '../other'",
                     "`owns` holds '/etc'", "its id is used 2 times", "order 3: `id` ('Bad Id')",
                     "order 4: `id` ('integration')", "order web: `covers` must be a list",
                     "order web: `foundation` must be true or false"):
            self.assertIn(text, out)

    def test_an_empty_plan_and_a_broken_file(self):
        code, out = self.problems([])
        self.assertEqual(code, 1)
        self.assertIn("the plan has no orders", out)
        project = Project(self)
        with open(project.plan, "w") as handle:
            handle.write("{ not json")
        self.assertEqual(project.do("check")[0], 2)
        with open(project.plan, "w") as handle:
            handle.write('{"format": "something/else"}')
        self.assertEqual(project.do("check")[0], 2)


class StartTest(unittest.TestCase):
    def test_without_orders_it_creates_the_integration_tree_only(self):
        project = Project(self, [])
        out = project.ok("start")
        self.assertIn("brigade/demo/integration", out)
        self.assertTrue(os.path.isfile(os.path.join(project.tree("integration"), "ticket.md")))
        self.assertEqual(project.state()["base_commit"],
                         project.git(project.dir, "rev-parse", "main").strip())
        status = project.git(project.dir, "status", "--porcelain")
        self.assertNotIn("trees", status)
        self.assertIn("added /_swe/brigade/demo/trees/", out)
        self.assertNotIn("added /_swe", project.ok("start"))

    def test_creates_a_tree_and_a_branch_for_each_order(self):
        project = Project(self)
        out = project.ok("start", "api", "web")
        for name in ("api", "web"):
            self.assertIn("brigade/demo/" + name, out)
            branch = project.git(project.tree(name), "rev-parse", "--abbrev-ref", "HEAD").strip()
            self.assertEqual(branch, "brigade/demo/" + name)
        self.assertEqual(set(project.state()["orders"]), {"api", "web"})
        self.assertEqual(project.git(project.dir, "rev-parse", "--abbrev-ref", "HEAD").strip(),
                         "main")

    def test_refuses_an_order_whose_dependencies_are_not_merged_and_starts_nothing(self):
        project = Project(self)
        code, out, _ = project.do("start", "api", "e2e")
        self.assertEqual(code, 1)
        self.assertIn("order e2e comes after api, web, which are not merged yet", out)
        self.assertIn("Nothing was started", out)
        self.assertFalse(os.path.exists(project.tree("api")))

    def test_refuses_an_order_before_the_foundation_is_merged(self):
        project = Project(self, [
            order("scaffold", foundation=True, owns=["."], support="Sets up the project."),
            order("api", covers=["c1", "c2", "c3"])])
        code, out, _ = project.do("start", "api")
        self.assertEqual(code, 1)
        self.assertIn("order api comes after scaffold, which is not merged yet", out)
        project.finish("scaffold", "package.txt")
        project.ok("start", "api")
        self.assertTrue(os.path.isfile(os.path.join(project.tree("api"), "package.txt")))

    def test_refuses_a_plan_with_problems_an_order_started_twice_and_an_unknown_order(self):
        project = Project(self)
        project.ok("start", "api")
        code, out, _ = project.do("start", "api")
        self.assertEqual(code, 1)
        self.assertIn("order api is started already", out)
        self.assertEqual(project.do("start", "nobody")[0], 2)
        project.edit(orders=[order("api", covers=["c1"]), order("web", covers=["c2"])])
        code, out, _ = project.do("start", "web")
        self.assertEqual(code, 1)
        self.assertIn("criterion c3 is covered by no order", out)

    def test_a_dependent_order_starts_from_the_merged_work(self):
        project = Project(self)
        project.finish("api")
        project.finish("web")
        project.ok("start", "e2e")
        for name in ("api", "web"):
            made = os.path.join(project.tree("e2e"), "src", name, "new.txt")
            self.assertTrue(os.path.isfile(made))


class BriefTest(unittest.TestCase):
    def test_holds_everything_the_subagent_needs(self):
        project = Project(self)
        project.edit(setup=["npm ci"], gates=["npm test", "npm run lint"],
                     conventions=["Routes live in src/api/routes, one file each."])
        orders = project.read()["orders"]
        orders[0].update(notes="POST /orders takes {items}.", checks=["curl the endpoint"])
        project.edit(orders=orders)
        project.ok("start", "api")
        said = project.ok("brief", "api")
        self.assertIn("Wrote ", said)
        self.assertIn("Your work order is the file %s. Read it in full first" % os.path.join(
            os.path.dirname(project.plan), "orders", "api.md"), said)
        out = project.order_text("api")
        report = os.path.join(os.path.dirname(project.plan), "reports", "api.md")
        self.assertIn("Write your report to this file: `%s`. It is the only file outside your "
                      "copy that you write." % report, out)
        self.assertIn("Then end with a reply of one line", out)
        for text in ("# Work order api: Build api", project.tree("api"), "`brigade/demo/api`",
                     "- c1: POST /orders answers 201 with the order's id.", "- `src/api`",
                     "`npm ci`", "`npm test`", "`npm run lint`", "POST /orders takes {items}.",
                     "curl the endpoint", "Routes live in src/api/routes, one file each.",
                     "Build the checkout", "Build the api part.", project.dir,
                     "Commit all of your work on `brigade/demo/api`"):
            self.assertIn(text, out)
        self.assertNotIn("- c2:", out)
        self.assertNotIn("Conventions you set", out)

    def test_tells_foundation_and_the_orders_built_on_it_apart(self):
        project = Project(self, [
            order("scaffold", foundation=True, owns=["."], support="Sets up the project."),
            order("api", covers=["c1", "c2", "c3"])])
        project.ok("start", "scaffold")
        out = project.order_text("scaffold")
        for text in ("Your part is foundation", "## Why this part exists", "Sets up the project.",
                     "The whole repository, inside your copy.", "Conventions you set"):
            self.assertIn(text, out)
        project.work("scaffold", "package.txt")
        project.ok("merge", "scaffold", "--checked", "ran it")
        project.ok("start", "api")
        out = project.order_text("api")
        self.assertIn("The foundation of the task is already in your copy: scaffold (Build "
                      "scaffold)", out)
        self.assertNotIn("Also merged into your copy", out)

    def test_names_the_orders_it_is_built_on(self):
        project = Project(self)
        project.finish("api")
        project.finish("web")
        project.ok("start", "e2e")
        self.assertIn("Also merged into your copy, and there to build on: api (Build api), "
                      "web (Build web).", project.order_text("e2e"))

    def test_refuses_an_order_without_a_tree(self):
        code, _, err = Project(self).do("brief", "api")
        self.assertEqual(code, 1)
        self.assertIn("has no tree yet", err)


class InspectTest(unittest.TestCase):
    def started(self):
        project = Project(self)
        project.ok("start", "api", "web")
        return project

    def test_work_inside_the_owned_paths_passes(self):
        project = self.started()
        project.work("api", "src/api/routes.txt")
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 0, out)
        self.assertIn("api: 1 commit, 1 file changed", out)
        self.assertNotIn("PROBLEM", out)

    def test_an_order_with_no_commit(self):
        code, out, _ = self.started().do("inspect", "api")
        self.assertEqual(code, 1)
        self.assertIn("no commit on brigade/demo/api", out)

    def test_an_order_whose_report_is_not_on_file(self):
        project = self.started()
        project.work("api", "src/api/routes.txt", report=False)
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 1)
        self.assertIn("no report on file at", out)
        self.assertIn(os.path.join("reports", "api.md"), out)
        project.report("api", "  \n")
        self.assertEqual(project.do("inspect", "api")[0], 1)
        code, _, err = project.do("merge", "api", "--checked", "ran it")
        self.assertEqual(code, 1)
        self.assertIn("order api was not merged", err)
        project.report("api")
        self.assertEqual(project.do("inspect", "api")[0], 0)

    def test_work_left_uncommitted(self):
        project = self.started()
        project.work("api", "src/api/routes.txt")
        project.write("src/api/later.txt", "x\n", root=project.tree("api"))
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 1)
        self.assertIn("uncommitted or untracked in its tree: src/api/later.txt", out)

    def test_a_change_outside_the_owned_paths(self):
        project = self.started()
        project.work("api", "src/web/page.txt", "changed\n")
        code, out, _ = project.do("inspect")
        self.assertEqual(code, 1)
        self.assertIn("changed outside the paths it owns: src/web/page.txt", out)
        self.assertIn("web: 0 commits", out)

    def test_lines_that_may_hide_unfinished_work_and_deleted_files(self):
        project = self.started()
        project.write("src/api/routes.py", "def a():\n    pass\n", root=project.tree("api"))
        project.work("api", "src/api/test_routes.py",
                     "import pytest\n\n@pytest.mark.skip\ndef test_a():\n    pass  # TODO later\n")
        project.git(project.tree("api"), "rm", "-q", "src/api/server.txt")
        project.git(project.tree("api"), "commit", "-q", "-m", "remove")
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 0, out)
        self.assertIn("read this line: src/api/test_routes.py:3: @pytest.mark.skip", out)
        self.assertIn("read this line: src/api/test_routes.py:5: pass # TODO later", out)
        self.assertIn("deleted: src/api/server.txt", out)

    def test_a_conflict_with_what_was_merged_meanwhile(self):
        project = self.started()
        project.work("api", "src/api/server.txt", "from api\n")
        integration = project.tree("integration")
        project.write("src/api/server.txt", "from elsewhere\n", root=integration)
        project.git(integration, "commit", "-q", "-am", "elsewhere")
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 1)
        self.assertIn("would conflict with brigade/demo/integration in: src/api/server.txt", out)
        code, _, err = project.do("merge", "api", "--checked", "ran it")
        self.assertEqual(code, 1)
        self.assertIn("was not merged", err)

    def test_merging_the_integration_branch_into_a_tree_is_not_work_outside_its_paths(self):
        project = self.started()
        project.work("api", "src/api/routes.txt")
        project.ok("merge", "api", "--checked", "ran it")
        project.work("web", "src/web/cart.txt")
        code, out, _ = project.do("inspect", "web")
        self.assertEqual(code, 0, out)
        self.assertIn("brigade/demo/integration has 2 commits this tree does not hold", out)
        project.git(project.tree("web"), "merge", "-q", "--no-edit", "brigade/demo/integration")
        code, out, _ = project.do("inspect", "web")
        self.assertEqual(code, 0, out)
        self.assertIn("1 file changed", out)
        self.assertNotIn("does not hold", out)

    def test_a_tree_moved_to_another_branch_or_rebased(self):
        project = self.started()
        project.work("api", "src/api/routes.txt")
        project.git(project.tree("api"), "checkout", "-q", "-b", "side")
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 1)
        self.assertIn("its tree is on side, not on brigade/demo/api", out)
        project.git(project.tree("web"), "checkout", "-q", "--orphan", "fresh")
        project.git(project.tree("web"), "commit", "-q", "-m", "all new")
        project.git(project.tree("web"), "branch", "-f", "-M", "brigade/demo/web")
        code, out, _ = project.do("inspect", "web")
        self.assertEqual(code, 1)
        self.assertIn("no longer holds the commit it started from", out)

    def test_notes_a_change_in_the_checkout_the_run_started_in(self):
        project = self.started()
        project.work("api", "src/api/routes.txt")
        project.write("src/api/stray.txt", "written in the wrong place\n")
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 0)
        self.assertIn("has changes it did not have when the run began: src/api/stray.txt", out)

    def test_an_order_that_is_not_started_and_one_that_is_merged(self):
        project = self.started()
        project.work("api", "src/api/routes.txt")
        project.ok("merge", "api", "--checked", "ran it")
        code, out, _ = project.do("inspect", "api", "e2e")
        self.assertEqual(code, 1)
        self.assertIn("api: merged at", out)
        self.assertIn("e2e: not started", out)


class MergeTest(unittest.TestCase):
    def test_merges_an_inspected_order_and_says_what_can_start(self):
        project = Project(self)
        project.ok("start", "api", "web")
        project.work("api", "src/api/routes.txt")
        project.work("web", "src/web/cart.txt")
        out = project.ok("merge", "api", "--checked", "read the diff; npm test passed, 12 tests")
        self.assertIn("Merged api into brigade/demo/integration", out)
        self.assertNotIn("Ready to start", out)
        out = project.ok("merge", "web", "--checked", "opened the page")
        self.assertIn("Ready to start now: e2e.", out)
        integration = project.tree("integration")
        self.assertTrue(os.path.isfile(os.path.join(integration, "src/api/routes.txt")))
        self.assertTrue(os.path.isfile(os.path.join(integration, "src/web/cart.txt")))
        log = project.git(integration, "log", "--format=%s", "-1")
        self.assertEqual(log.strip(), "brigade: merge web: Build web")
        self.assertEqual(project.state()["orders"]["api"]["checked"],
                         "read the diff; npm test passed, 12 tests")
        self.assertFalse(os.path.exists(project.at("src/api/routes.txt")))

    def test_refuses_an_order_with_problems(self):
        project = Project(self)
        project.ok("start", "api")
        project.work("api", "README.md")
        code, out, err = project.do("merge", "api", "--checked", "ran it")
        self.assertEqual(code, 1)
        self.assertIn("changed outside the paths it owns: README.md", out)
        self.assertIn("order api was not merged", err)
        self.assertEqual(project.state()["orders"]["api"]["merged"], "")

    def test_refuses_without_a_check_an_order_not_started_and_a_changed_integration_tree(self):
        project = Project(self)
        project.ok("start", "api")
        project.work("api", "src/api/routes.txt")
        self.assertEqual(project.do("merge", "api", "--checked", "  ")[0], 2)
        code, _, err = project.do("merge", "web", "--checked", "ran it")
        self.assertEqual(code, 1)
        self.assertIn("order web is ready", err)
        project.write("stray.txt", "x\n", root=project.tree("integration"))
        code, _, err = project.do("merge", "api", "--checked", "ran it")
        self.assertEqual(code, 1)
        self.assertIn("must be on brigade/demo/integration with nothing uncommitted", err)


class ReworkTest(unittest.TestCase):
    def sent_back(self):
        project = Project(self)
        project.ok("start", "api")
        project.work("api", "src/api/routes.txt")
        self.findings = project.at("findings.md")
        project.write("findings.md", "POST /orders answers 200, and c1 says 201.\n")
        return project

    def test_opens_a_round_with_its_own_order_and_its_own_report(self):
        project = self.sent_back()
        folder = os.path.dirname(project.plan)
        out = project.ok("rework", "api", "--findings", self.findings)
        order = os.path.join(folder, "orders", "api.round-2.md")
        report = os.path.join(folder, "reports", "api.round-2.md")
        self.assertIn("round 2 of order api", out)
        self.assertIn("Prompt for the same subagent, continued:", out)
        self.assertIn("The rework order is the file %s." % order, out)
        self.assertIn("The work order is the file %s, and the rework order is the file %s." % (
            os.path.join(folder, "orders", "api.md"), order), out)
        with open(order) as handle:
            text = handle.read()
        for wanted in ("# Rework of order api, round 2", "`brigade/demo/api`", project.tree("api"),
                       "POST /orders answers 200, and c1 says 201.",
                       "Write the report of this round to a new file: `%s`." % report,
                       "Leave the reports of earlier rounds as they are.", "**Findings:**"):
            self.assertIn(wanted, text)
        self.assertEqual(project.state()["orders"]["api"]["round"], 2)
        code, out, _ = project.do("inspect", "api")
        self.assertEqual(code, 1)
        self.assertIn(os.path.join("reports", "api.round-2.md"), out)
        project.work("api", "src/api/routes.txt", "answers 201\n")
        self.assertTrue(os.path.isfile(report))
        self.assertTrue(os.path.isfile(os.path.join(folder, "reports", "api.md")))
        code, out, _ = project.do("status")
        self.assertIn("round 2", out)
        project.ok("merge", "api", "--checked", "posted an order: 201")
        self.assertIn("round 2", project.do("status")[1])
        self.assertIn(report, project.order_text("api"))

    def test_reads_the_findings_from_standard_input(self):
        project = self.sent_back()
        stdin, sys.stdin = sys.stdin, io.StringIO("The test of c1 is skipped.\n")
        self.addCleanup(setattr, sys, "stdin", stdin)
        project.ok("rework", "api", "--findings", "-")
        with open(project.paper("orders", "api")) as handle:
            self.assertIn("The test of c1 is skipped.", handle.read())

    def test_refuses_a_round_that_would_leave_no_record(self):
        project = self.sent_back()
        project.write("empty.md", "\n")
        self.assertEqual(project.do("rework", "api", "--findings", project.at("empty.md"))[0], 2)
        self.assertEqual(project.do("rework", "api", "--findings", project.at("none.md"))[0], 2)
        code, _, err = project.do("rework", "web", "--findings", self.findings)
        self.assertEqual(code, 1)
        self.assertIn("order web is ready", err)
        os.remove(project.paper("reports", "api"))
        code, _, err = project.do("rework", "api", "--findings", self.findings)
        self.assertEqual(code, 1)
        self.assertIn("round 1 of order api has no report on file", err)
        self.assertEqual(project.state()["orders"]["api"]["round"], 1)


class StatusTest(unittest.TestCase):
    def test_follows_the_run_from_the_first_order_to_the_last(self):
        project = Project(self)
        code, out, _ = project.do("status")
        self.assertEqual(code, 3)
        self.assertIn("Run demo: 2 ready, 1 waiting.", out)
        self.assertIn("Ready to start now: api, web.", out)
        self.assertIn("c3   waits for e2e", out)
        project.finish("api")
        project.ok("start", "web")
        code, out, _ = project.do("status")
        self.assertEqual(code, 3)
        self.assertIn("Run demo: 1 merged, 1 started, 1 waiting.", out)
        self.assertIn("checked: read the diff, ran the gates", out)
        self.assertIn("c1   merged (api)", out)
        self.assertIn("c2   waits for web", out)
        project.work("web", "src/web/cart.txt")
        project.ok("merge", "web", "--checked", "ran it")
        project.finish("e2e", "tests/e2e/flow.txt")
        code, out, _ = project.do("status")
        self.assertEqual(code, 0, out)
        self.assertIn("Run demo: 3 merged.", out)

    def test_reports_plan_problems_and_orders_removed_from_the_plan(self):
        project = Project(self)
        project.ok("start", "api")
        project.edit(orders=[order("web", covers=["c1", "c2"])])
        code, out, _ = project.do("status")
        self.assertEqual(code, 1)
        self.assertIn("criterion c3 is covered by no order", out)
        self.assertIn("removed from the plan", out)


class CleanTest(unittest.TestCase):
    def test_removes_merged_orders_and_leaves_the_others(self):
        project = Project(self)
        project.finish("api")
        project.ok("start", "web")
        project.work("web", "src/web/cart.txt")
        out = project.ok("clean")
        self.assertIn("api: tree and branch removed", out)
        self.assertIn("web: left in place (not merged)", out)
        self.assertFalse(os.path.exists(project.tree("api")))
        self.assertTrue(os.path.isdir(project.tree("web")))
        branches = project.git(project.dir, "branch", "--format=%(refname:short)").split()
        self.assertNotIn("brigade/demo/api", branches)
        self.assertIn("brigade/demo/web", branches)

    def test_keeps_a_merged_tree_that_holds_uncommitted_files(self):
        project = Project(self)
        project.finish("api")
        project.write("src/api/late.txt", "x\n", root=project.tree("api"))
        code, out, _ = project.do("clean")
        self.assertEqual(code, 1)
        self.assertIn("api: its tree was not removed", out)
        self.assertTrue(os.path.isdir(project.tree("api")))

    def test_the_integration_branch_goes_only_when_its_commits_are_delivered(self):
        project = Project(self, [order("api", covers=["c1", "c2", "c3"])])
        project.finish("api")
        code, out, _ = project.do("clean", "--integration")
        self.assertEqual(code, 1)
        self.assertIn("does not hold the commits of brigade/demo/integration", out)
        branches = project.git(project.dir, "branch", "--format=%(refname:short)").split()
        self.assertIn("brigade/demo/integration", branches)
        self.assertTrue(os.path.isdir(project.tree("integration")))
        project.git(project.dir, "merge", "-q", "--ff-only", "brigade/demo/integration")
        out = project.ok("clean", "--integration")
        self.assertIn("integration: tree and branch removed", out)
        self.assertTrue(os.path.isfile(project.at("src/api/new.txt")))
        self.assertEqual(project.git(project.dir, "worktree", "list").count("\n"), 1)
        self.assertFalse(os.path.exists(os.path.dirname(project.tree("api"))))

    def test_the_integration_tree_stays_while_an_order_still_has_a_tree(self):
        project = Project(self)
        project.ok("start", "api")
        code, out, _ = project.do("clean", "--integration")
        self.assertEqual(code, 1)
        self.assertIn("the integration tree stays: api still has a tree", out)


if __name__ == "__main__":
    unittest.main()
