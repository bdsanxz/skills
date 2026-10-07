"""Scores are read back from saved diffs laid out as a run leaves them."""
import os
import tempfile
import unittest

import numpy as np

import argparse

import diff
import scores
from pp_common import PPError, list_runs, run_dir

WHITE = (255, 255, 255)


def save(work, kind, item, iteration, variant, wrong_rows):
    """Save a diff with `wrong_rows` of its 20 content rows mismatched: 5% each."""
    design = np.full((64, 64, 3), WHITE, dtype=np.uint8)
    design[:20] = (30, 90, 200)
    render = design.copy()
    render[:wrong_rows] = (200, 30, 30)
    out = os.path.join(work, kind, item, "iter-{:02d}".format(iteration), variant)
    diff.save_result(diff.run_diff(design, render), out)


class ScoresTest(unittest.TestCase):
    def rows(self, work):
        return {(row["item"], row["variant"]): row for row in scores.standing(work)}

    def test_latest_best_and_stop_rule(self):
        with tempfile.TemporaryDirectory() as work:
            for iteration, wrong in enumerate((20, 10, 0), start=1):
                save(work, "components", "button", iteration, "primary", wrong)
            for iteration, wrong in enumerate((20, 10, 12, 10, 11), start=1):
                save(work, "components", "card", iteration, "default", wrong)
            for iteration, wrong in enumerate((20, 15), start=1):
                save(work, "pages", "home", iteration, "desktop", wrong)
            save(work, "sections", "header", 1, "default", 0)
            self.assertEqual([row["kind"] for row in scores.standing(work)], ["component", "component", "section", "page"])
            rows = self.rows(work)
            button, card, home = rows[("button", "primary")], rows[("card", "default")], rows[("home", "desktop")]
            self.assertEqual((button["pass"], button["status"], button["iterations"]), (True, "passed", 3))
            # Scores are rounded down, so 45% may read a thousandth lower.
            self.assertAlmostEqual(card["content"], 45, delta=0.001)
            self.assertEqual((card["best_content"], card["best_iter"]), (50, 2))
            self.assertEqual(card["status"], "stop: no gain in 3 iterations")
            self.assertEqual((home["kind"], home["status"], home["evidence"]), ("page", "in progress", os.path.join("pages", "home", "iter-02", "desktop")))

    def test_ceiling_signs_are_copied_from_the_diff(self):
        with tempfile.TemporaryDirectory() as work:
            save(work, "components", "card", 1, "default", 10)
            row = self.rows(work)[("card", "default")]
            # 640 of 1280 content pixels are wrong and a pass allows 12 of them.
            self.assertEqual(row["over_budget"], 53.3)
            self.assertEqual(row["ink_missed_pct"], 0)
            self.assertIsNone(row["reference_changed"])

    def test_detail_of_one_item(self):
        with tempfile.TemporaryDirectory() as work:
            save(work, "components", "card", 1, "default", 20)
            save(work, "components", "card", 2, "default", 10)
            shown = scores.detail(work, "card")
            self.assertEqual((shown["item"], shown["iteration"], shown["pass"]), ("card/default", 2, False))
            self.assertEqual(shown["pixels"]["mismatched"], 640)
            self.assertEqual(len(shown["clusters"]), 1)
            with self.assertRaises(scores.PPError):
                scores.detail(work, "nothing")

    def test_iteration_cap(self):
        with tempfile.TemporaryDirectory() as work:
            for iteration in range(1, 11):
                save(work, "components", "nav", iteration, "default", 21 - iteration)
            self.assertEqual(self.rows(work)[("nav", "default")]["status"], "stop: 10 iterations run")

    def test_markdown_table(self):
        with tempfile.TemporaryDirectory() as work:
            save(work, "components", "button", 1, "primary", 0)
            save(work, "pages", "home", 1, "desktop", 20)
            lines = scores.markdown(scores.standing(work)).splitlines()
            self.assertEqual(lines[2], "| button | primary | 100 | 100 | 100 | 1 | passed | {} |".format(os.path.join("components", "button", "iter-01", "primary")))
            self.assertTrue(lines[3].startswith("| page: home | desktop | 0 |"), lines[3])

    def test_diffs_saved_as_text_only_are_still_read(self):
        with tempfile.TemporaryDirectory() as work:
            save(work, "components", "old", 1, "default", 10)
            os.remove(os.path.join(work, "components", "old", "iter-01", "default", "diff.json"))
            row = self.rows(work)[("old", "default")]
            self.assertEqual((row["pass"], row["content"]), (False, 50))


class RunDirTest(unittest.TestCase):
    def named(self, run=None, work_dir=None):
        return argparse.Namespace(run=run, work_dir=work_dir)

    def test_a_run_is_a_named_directory_under_the_root(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(run_dir(self.named(run="home"), root), os.path.join(root, "home"))
            self.assertEqual(run_dir(self.named(run="home", work_dir="elsewhere"), root), "elsewhere")
            for bad in ("Home Page", "../up", "components"):
                with self.assertRaises(PPError):
                    run_dir(self.named(run=bad), root)

    def test_without_a_name_the_runs_are_listed_not_guessed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(PPError):
                run_dir(self.named(), root)
            for name in ("home", "checkout"):
                os.makedirs(os.path.join(root, name, "components"))
            os.makedirs(os.path.join(root, "scratch"))
            self.assertEqual(list_runs(root), ["checkout", "home"])
            with self.assertRaises(PPError) as raised:
                run_dir(self.named(), root)
            self.assertIn("checkout, home", str(raised.exception))

    def test_a_run_kept_directly_in_the_root_is_still_found(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "components", "button"))
            self.assertEqual(run_dir(self.named(), root), root)
            self.assertEqual(list_runs(root), [])


if __name__ == "__main__":
    unittest.main()
