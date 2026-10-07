"""The diff is checked against image pairs whose differences are known."""
import os
import tempfile
import unittest

import numpy as np
from PIL import Image

import diff

WHITE = (255, 255, 255)
BLUE = (30, 90, 200)


def page(width=640, height=480):
    """A white page with a header bar and three cards."""
    arr = np.full((height, width, 3), WHITE, dtype=np.uint8)
    arr[0:64] = (20, 30, 60)
    for x in (32, 240, 448):
        arr[128:288, x : x + 160] = BLUE
        arr[304:320, x : x + 120] = (60, 60, 60)
    return arr


class DiffTest(unittest.TestCase):
    def test_identical_images_pass_at_100(self):
        result = diff.run_diff(page(), page())
        self.assertTrue(result["pass"])
        self.assertEqual(result["score"], {"content": 100.0, "worst_tile": 100.0, "naive": 100.0})
        self.assertEqual(result["clusters"], [])
        self.assertEqual(result["shifts"], {"vertical": [], "horizontal": []})

    def test_tolerance_boundary(self):
        design = page()
        within = design.copy()
        within[128:288, 32:192] = (38, 98, 208)
        beyond = design.copy()
        beyond[128:288, 32:192] = (39, 90, 200)
        self.assertTrue(diff.run_diff(design, within)["pass"])
        self.assertFalse(diff.run_diff(design, beyond)["pass"])

    def test_wrong_color_is_located_and_named(self):
        design, render = page(), page()
        render[128:288, 240:400] = (200, 30, 30)
        result = diff.run_diff(design, render)
        self.assertFalse(result["pass"])
        cluster = result["clusters"][0]
        self.assertEqual((cluster["x"], cluster["y"], cluster["w"], cluster["h"]), (240, 128, 160, 160))
        self.assertEqual((cluster["kind"], cluster["design_hex"], cluster["render_hex"]), ("color", "#1e5ac8", "#c81e1e"))
        self.assertEqual(cluster["pixels"], 160 * 160)

    def test_empty_background_earns_nothing(self):
        design = np.full((1000, 1000, 3), WHITE, dtype=np.uint8)
        design[100:200, 100:200] = BLUE
        render = np.full((1000, 1000, 3), WHITE, dtype=np.uint8)
        result = diff.run_diff(design, render)
        self.assertEqual(result["score"]["naive"], 99.0)
        self.assertEqual(result["score"]["content"], 0.0)
        self.assertFalse(result["pass"])

    def test_concentrated_error_fails_the_tile_gate(self):
        design = np.full((1024, 1024, 3), BLUE, dtype=np.uint8)
        design[:, ::2] = (40, 100, 210)  # every pixel is content against either color
        render = design.copy()
        render[0:48, 0:48] = WHITE
        result = diff.run_diff(design, render, bg=(0, 0, 0))
        self.assertGreaterEqual(result["score"]["content"], 99.0)
        self.assertEqual(result["gates"], {"size_match": True, "content": True, "tiles": False})
        self.assertFalse(result["pass"])
        self.assertEqual((result["tiles"]["worst"][0]["x"], result["tiles"]["worst"][0]["y"]), (0, 0))

    def test_vertical_shift_is_diagnosed_but_not_forgiven(self):
        design = page()
        render = design.copy()
        render[68:] = design[64:-4]
        render[64:68] = WHITE
        result = diff.run_diff(design, render)
        self.assertFalse(result["pass"])
        shifts = result["shifts"]["vertical"]
        self.assertTrue(shifts)
        self.assertEqual({s["dy"] for s in shifts}, {4})
        # Rows 64-128 are blank, so the first band with anything to align is the
        # cards; the flat card interior in between is bridged into one range.
        self.assertEqual(len(shifts), 1)
        self.assertEqual(shifts[0]["from_row"], 128)
        self.assertGreaterEqual(shifts[0]["to_row"], 320)

    def test_horizontal_shift_is_diagnosed(self):
        design = page()
        render = np.full_like(design, 255)
        render[64:, 6:] = design[64:, :-6]
        render[:64] = design[:64]
        result = diff.run_diff(design, render)
        self.assertEqual({s["dx"] for s in result["shifts"]["horizontal"]}, {6})

    def test_size_mismatch_fails_even_when_the_overlap_matches(self):
        design = page(640, 480)
        render = np.full((490, 640, 3), WHITE, dtype=np.uint8)
        render[:480] = design
        result = diff.run_diff(design, render, threshold=0, tile_floor=0)
        self.assertFalse(result["pass"])
        self.assertFalse(result["gates"]["size_match"])
        self.assertEqual((result["size"]["dw"], result["size"]["dh"]), (0, 10))
        self.assertEqual(result["pixels"]["mismatched"], 10 * 640)

    def test_overrides_are_recorded(self):
        result = diff.run_diff(page(), page(), threshold=98.0)
        self.assertEqual(result["thresholds"]["overridden"], ["threshold"])
        self.assertEqual(diff.run_diff(page(), page())["thresholds"]["overridden"], [])

    def test_scores_round_down(self):
        self.assertEqual(diff.floor_pct(0.989999), 98.999)
        self.assertEqual(diff.floor_pct(1.0), 100.0)

    def test_images_are_written(self):
        design, render = page(), page()
        render[128:288, 240:400] = (200, 30, 30)
        with tempfile.TemporaryDirectory() as directory:
            result = diff.run_diff(design, render, out_dir=directory)
            for path in [result["files"]["composite"], result["files"]["heatmap"]] + result["files"]["clusters"]:
                self.assertTrue(os.path.exists(path), path)
            with Image.open(result["files"]["composite"]) as composite:
                self.assertEqual(composite.width, 640 * 3 + 16)
            with Image.open(result["files"]["heatmap"]) as image:
                heat = np.asarray(image)
            self.assertGreater(int(heat[200, 300, 0]), int(heat[200, 300, 2]))


class DiagnosticsTest(unittest.TestCase):
    def test_cluster_names_the_offset_that_explains_it(self):
        design, render = page(), page()
        render[128:288, 240:400] = WHITE
        render[131:291, 245:405] = BLUE
        cluster = diff.run_diff(design, render)["clusters"][0]
        self.assertEqual((cluster["shift_dx"], cluster["shift_dy"]), (5, 3))
        self.assertEqual(cluster["left_pct"], 0)

    def test_a_wrong_color_is_not_explained_by_any_offset(self):
        design, render = page(), page()
        render[128:288, 240:400] = (200, 30, 30)
        cluster = diff.run_diff(design, render)["clusters"][0]
        self.assertEqual((cluster["shift_dx"], cluster["shift_dy"], cluster["left_pct"]), (0, 0, 100))

    def test_budget_and_ink(self):
        design = page()
        for x in (32, 240, 448):
            design[340:344, x : x + 120] = (60, 60, 60)
        render = design.copy()
        render[340:344, 32:152] = WHITE
        result = diff.run_diff(design, render)
        self.assertEqual(result["pixels"]["allowed"], int(result["pixels"]["content"] * 0.01))
        # The three thin rules are the only ink: the cards and bars are too
        # thick to be strokes. One rule is gone.
        self.assertEqual(result["ink"]["pixels"], 3 * 4 * 120)
        self.assertEqual(result["ink"]["mismatched"], 4 * 120)
        self.assertEqual(result["ink"]["share_of_mismatch_pct"], 100)

    def test_hint_names_the_first_thing_to_fix(self):
        design = page()
        self.assertEqual(diff.hint(diff.run_diff(design, design.copy())), "")
        self.assertIn("size differs", diff.hint(diff.run_diff(design, design[:470])))
        shifted = design.copy()
        shifted[68:] = design[64:-4]
        shifted[64:68] = 255
        self.assertEqual(diff.hint(diff.run_diff(design, shifted)), "rows from 128 sit 4 px too low")
        tinted = design.copy()
        tinted[128:288, 240:400] = (200, 30, 30)
        self.assertIn("color difference", diff.hint(diff.run_diff(design, tinted)))

    def test_brief_keeps_the_decision_and_drops_the_rest(self):
        design, render = page(), page()
        render[128:288, 240:400] = (200, 30, 30)
        result = diff.run_diff(design, render)
        short = diff.brief(result)
        self.assertEqual(short["score"], result["score"])
        self.assertEqual(short["size"], {"dw": 0, "dh": 0})
        self.assertNotIn("tiles", short)
        self.assertNotIn("thresholds", short)
        self.assertIn("thresholds", diff.brief(diff.run_diff(design, render, tolerance=12)))

    def test_image_modes(self):
        design, render = page(), page()
        render[128:288, 240:400] = (200, 30, 30)
        with tempfile.TemporaryDirectory() as tmp:
            for mode, expected in (("none", []), ("clusters", ["cluster-1.png", "overview.png"]),
                                   ("all", ["cluster-1.png", "composite.png", "heatmap.png", "overview.png"])):
                out = os.path.join(tmp, mode)
                diff.run_diff(design, render, out_dir=out, images=mode)
                self.assertEqual(sorted(os.listdir(out)), expected)

    def test_overview_keeps_thin_mismatches_when_shrunk(self):
        design = np.full((400, 6000, 3), WHITE, dtype=np.uint8)
        design[100:300, 500:5500] = BLUE
        render = design.copy()
        render[200, 500:5500] = (40, 100, 210)      # one row, slightly off
        render[100:300, 3000] = WHITE               # one column, far off
        state = diff.compare(design, render)
        picture = np.asarray(diff.overview(state, 8))
        self.assertLessEqual(max(picture.shape[:2]), diff.READABLE_SIDE)
        colors = {tuple(c) for c in picture.reshape(-1, 3)}
        self.assertEqual(colors, {(238, 238, 238), (255, 170, 0), (215, 0, 0)})

    def test_cluster_sheet_is_enlarged_but_stays_readable(self):
        design, render = page(), page()
        render[304:320, 32:152] = WHITE
        with tempfile.TemporaryDirectory() as tmp:
            result = diff.run_diff(design, render, out_dir=tmp, images="clusters")
            with Image.open(result["files"]["clusters"][0]) as sheet:
                self.assertGreater(sheet.width, 3 * 168)
                self.assertLessEqual(max(sheet.size), diff.READABLE_SIDE)

    def test_saved_result_feeds_scores(self):
        import json

        with tempfile.TemporaryDirectory() as tmp:
            result = diff.run_diff(page(), page())
            diff.save_result(result, tmp)
            with open(os.path.join(tmp, "diff.json")) as handle:
                self.assertEqual(json.load(handle)["score"], result["score"])
            with open(os.path.join(tmp, "diff.toon")) as handle:
                self.assertTrue(handle.read().startswith("pass: true"))


if __name__ == "__main__":
    unittest.main()
