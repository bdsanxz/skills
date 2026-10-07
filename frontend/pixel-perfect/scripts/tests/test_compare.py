"""Compare is checked on image pairs whose items are moved by known amounts."""
import os
import tempfile
import unittest

import numpy as np
from PIL import Image

import compare
from pp_common import PPError, clamp_region

WHITE = (255, 255, 255)
BLUE = (30, 90, 200)
DARK = (20, 20, 20)


def band(items, width=600, height=100):
    arr = np.full((height, width, 3), WHITE, dtype=np.uint8)
    for x, y, w, h, color in items:
        arr[y : y + h, x : x + w] = color
    return arr


ITEMS = [(20, 30, 60, 40, BLUE), (150, 40, 4, 20, DARK), (220, 30, 60, 40, BLUE), (400, 35, 80, 30, BLUE)]


class CompareTest(unittest.TestCase):
    def test_identical_bands_are_aligned(self):
        result = compare.run_compare(band(ITEMS), band(ITEMS), (0, 0, 600, 100))
        self.assertTrue(result["aligned"])
        self.assertEqual(result["worst"], {"dx": 0, "dy": 0, "dw": 0, "dh": 0})
        self.assertEqual(len(result["pairs"]), 4)
        self.assertEqual(result["patch_offset"]["dx"], 0)

    def test_deltas_are_render_minus_reference(self):
        moved = [(20, 30, 60, 40, BLUE), (150, 40, 4, 20, DARK), (226, 28, 60, 44, BLUE), (400, 35, 70, 30, BLUE)]
        result = compare.run_compare(band(ITEMS), band(moved), (0, 0, 600, 100))
        self.assertFalse(result["aligned"])
        third, fourth = result["pairs"][2], result["pairs"][3]
        self.assertEqual((third["dx"], third["dy"], third["dw"], third["dh"]), (6, -2, 0, 4))
        self.assertEqual((fourth["dx"], fourth["dw"]), (0, -10))
        self.assertEqual(result["worst"], {"dx": 6, "dy": 2, "dw": 10, "dh": 4})

    def test_a_missing_item_does_not_misalign_the_rest(self):
        without_rule = [item for item in ITEMS if item[4] != DARK]
        result = compare.run_compare(band(ITEMS), band(without_rule), (0, 0, 600, 100))
        self.assertEqual(len(result["pairs"]), 3)
        self.assertEqual([(i["x"], i["w"]) for i in result["only_in_reference"]], [(150, 4)])
        self.assertEqual(result["only_in_render"], [])
        self.assertEqual(result["worst"], {"dx": 0, "dy": 0, "dw": 0, "dh": 0})
        self.assertFalse(result["aligned"])

    def test_an_extra_item_is_listed(self):
        extra = ITEMS + [(540, 40, 20, 20, DARK)]
        result = compare.run_compare(band(ITEMS), band(extra), (0, 0, 600, 100))
        self.assertEqual([(i["x"], i["w"]) for i in result["only_in_render"]], [(540, 20)])

    def test_items_down_a_column(self):
        reference = band([(20, 10, 60, 20, BLUE), (20, 50, 60, 20, BLUE)])
        render = band([(20, 10, 60, 20, BLUE), (20, 57, 60, 20, BLUE)])
        result = compare.run_compare(reference, render, (0, 0, 600, 100), axis="y")
        self.assertEqual([(p["dy"], p["dx"]) for p in result["pairs"]], [(0, 0), (7, 0)])

    def test_patch_offset_finds_a_whole_region_shift(self):
        reference = band(ITEMS)
        render = np.full_like(reference, 255)
        render[2:, 3:] = reference[:-2, :-3]
        offset = compare.run_compare(reference, render, (10, 10, 500, 80))["patch_offset"]
        self.assertEqual((offset["dx"], offset["dy"], offset["error_at_best"]), (3, 2, 0))

    def test_a_short_render_is_clamped_and_said_so(self):
        result = compare.run_compare(band(ITEMS), band(ITEMS, height=80), (0, 0, 600, 100))
        self.assertEqual(result["render_region"], {"x": 0, "y": 0, "w": 600, "h": 80})
        self.assertIn("note", result)
        with self.assertRaises(PPError):
            compare.run_compare(band(ITEMS), band(ITEMS, width=300), (400, 0, 100, 100))

    def test_compact_result_is_in_css_pixels(self):
        moved = [(20, 30, 60, 40, BLUE), (150, 40, 4, 20, DARK), (226, 28, 60, 44, (200, 30, 30)), (400, 35, 70, 30, BLUE)]
        short = compare.compact(compare.run_compare(band(ITEMS), band(moved), (0, 0, 600, 100)), 2)
        self.assertEqual((short["region_px"], short["units"], short["aligned"]), ("0,0,600,100", "css px", False))
        self.assertEqual(short["pairs"][2], {"x": 110, "y": 15, "w": 30, "h": 20, "dx": 3, "dy": -1, "dw": 0, "dh": 2})
        self.assertEqual(short["worst"], {"dx": 3, "dy": 1, "dw": 5, "dh": 2})
        self.assertFalse(short["colors_match"])
        self.assertEqual(short["color_differences"], [{"x": 110, "y": 15, "reference_hex": "#1e5ac8", "render_hex": "#c81e1e"}])
        self.assertNotIn("only_in_render", short)
        self.assertNotIn("patch_offset_px", short)
        same = compare.compact(compare.run_compare(band(ITEMS), band(ITEMS), (0, 0, 600, 100)), 1)
        self.assertEqual((same["units"], same["colors_match"], same["pairs"][0]["x"]), ("px", True, 20))

    def test_sheet_packs_pairs_and_stays_readable(self):
        wide = Image.fromarray(band(ITEMS))
        tall = Image.fromarray(band(ITEMS[:1], width=100, height=160))
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "sheet.png")
            info = compare.write_sheet([("wide", wide, wide), ("tall", tall, tall)], out)
            zoom = info["zoom"]
            self.assertEqual((info["pairs"], zoom), (2, 3))
            self.assertLessEqual(max(info["width"], info["height"]), compare.READABLE_SIDE)
            with Image.open(out) as sheet:
                pixels = np.asarray(sheet)
            # The wide pair is set reference above render.
            self.assertEqual(tuple(pixels[14 + 40 * zoom, 30 * zoom]), BLUE)
            self.assertEqual(tuple(pixels[14 + 100 * zoom + 6 + 40 * zoom, 30 * zoom]), BLUE)
            # Both pairs are there in full: four images' worth of blue, enlarged.
            blue = int((pixels == BLUE).all(axis=2).sum())
            self.assertEqual(blue, 2 * (7200 + 2400) * zoom * zoom)

    def test_item_is_resolved_to_its_latest_render(self):
        with tempfile.TemporaryDirectory() as work:
            base = os.path.join(work, "components", "card")
            for folder in ("ref", os.path.join("iter-01", "big"), os.path.join("iter-04", "big"), os.path.join("iter-05", "small")):
                os.makedirs(os.path.join(base, folder))
            Image.fromarray(band(ITEMS)).save(os.path.join(base, "ref", "big.png"))
            for number in ("01", "04"):
                Image.fromarray(band(ITEMS)).save(os.path.join(base, "iter-" + number, "big", "render.png"))
            label, reference, render = compare.resolve_item(work, "card/big")
            self.assertEqual(label, "card/big iter-04")
            self.assertEqual(reference, os.path.join(base, "ref", "big.png"))
            self.assertEqual(render, os.path.join(base, "iter-04", "big", "render.png"))
            self.assertEqual(compare.resolve_item(work, "card/big", 1)[0], "card/big iter-01")
            with self.assertRaises(PPError):
                compare.resolve_item(work, "card/missing")

    def test_clamp_region(self):
        self.assertEqual(clamp_region((10, 10, 100, 100), (50, 60, 3)), (10, 10, 50, 40))
        self.assertIsNone(clamp_region((70, 0, 10, 10), (50, 60, 3)))

    def test_pair_image_is_reference_above_render(self):
        reference, render = band(ITEMS), band(ITEMS[:1])
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "pair.png")
            info = compare.write_pair(reference, render, (0, 0, 600, 100), (0, 0, 600, 100), out)
            self.assertEqual((info["zoom"], info["width"], info["height"]), (3, 1800, 606))
            with Image.open(out) as sheet:
                pixels = np.asarray(sheet)
            self.assertEqual(tuple(pixels[40 * 3, 221 * 3]), BLUE)
            self.assertEqual(tuple(pixels[301, 0]), (255, 0, 255))
            self.assertEqual(tuple(pixels[306 + 40 * 3, 221 * 3]), WHITE)


if __name__ == "__main__":
    unittest.main()
