"""Probes are checked against images whose geometry is known by construction."""
import os
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import measure
from pp_common import PPError, parse_region, superseded_by, with_points

WHITE = (255, 255, 255)
BLUE = (30, 90, 200)
GRAY = (200, 200, 200)


def canvas(width=400, height=300, color=WHITE):
    return np.full((height, width, 3), color, dtype=np.uint8)


def box(arr, x, y, w, h, color):
    arr[y : y + h, x : x + w] = color
    return arr


def rounded_box(width, height, x, y, w, h, radius, color, bg=WHITE, supersample=8):
    """An anti-aliased rounded rectangle drawn at high resolution, then reduced."""
    s = supersample
    image = Image.new("RGB", (width * s, height * s), bg)
    ImageDraw.Draw(image).rounded_rectangle(
        [x * s, y * s, (x + w) * s - 1, (y + h) * s - 1], radius=radius * s, fill=color
    )
    return np.asarray(image.resize((width, height), Image.BOX))


class InfoTest(unittest.TestCase):
    def test_retina_mobile_width(self):
        result = measure.probe_info(canvas(750, 1624), False)
        self.assertEqual(result["scale_guess"], 2)
        self.assertFalse(result["ambiguous"])

    def test_desktop_width(self):
        result = measure.probe_info(canvas(1440, 900), False)
        self.assertEqual(result["scale_guess"], 1)
        self.assertFalse(result["ambiguous"])

    def test_ambiguous_width(self):
        self.assertTrue(measure.probe_info(canvas(1536, 900), False)["ambiguous"])

    def test_stated_screen_width_wins(self):
        result = measure.probe_info(canvas(1536, 900), False, screen_width=768)
        self.assertEqual(result["scale_guess"], 2)
        self.assertFalse(result["ambiguous"])


class ColorTest(unittest.TestCase):
    def test_point(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        self.assertEqual(measure.probe_color_at(arr, 40, 30)["hex"], "#1e5ac8")
        self.assertEqual(measure.probe_color_at(arr, 39, 30)["hex"], "#ffffff")

    def test_flat_region(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        result = measure.probe_color_region(arr, (40, 30, 200, 100))
        self.assertEqual(result["dominant"], "#1e5ac8")
        self.assertTrue(result["flat"])

    def test_mixed_region_is_not_flat(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        self.assertFalse(measure.probe_color_region(arr, (0, 0, 400, 300))["flat"])

    def test_point_outside_image(self):
        with self.assertRaises(PPError):
            measure.probe_color_at(canvas(), 400, 0)


class EdgesTest(unittest.TestCase):
    def test_crisp_edges_on_a_row(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        result = measure.probe_edges(arr, row=80)
        self.assertEqual([e["pos"] for e in result["edges"]], [40, 240])
        self.assertEqual([e["soft_px"] for e in result["edges"]], [0, 0])
        self.assertEqual([(r["start"], r["end"], r["hex"]) for r in result["runs"]],
                         [(0, 40, "#ffffff"), (40, 240, "#1e5ac8"), (240, 400, "#ffffff")])

    def test_crisp_edges_on_a_column(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        self.assertEqual([e["pos"] for e in measure.probe_edges(arr, col=100)["edges"]], [30, 130])

    def test_scan_range_offsets_positions(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        result = measure.probe_edges(arr, row=80, start=100, end=300)
        self.assertEqual([e["pos"] for e in result["edges"]], [240])

    def test_soft_edge_reports_subpixel_position(self):
        arr = canvas()
        arr[:, 100:] = (0, 0, 0)
        arr[:, 99] = (191, 191, 191)  # a quarter covered: the true edge is at 99.75
        edge = measure.probe_edges(arr, row=10)["edges"][0]
        self.assertEqual(edge["pos"], 99)
        self.assertEqual(edge["soft_px"], 1)
        self.assertAlmostEqual(edge["at"], 99.75, places=1)

    def test_needs_exactly_one_line(self):
        with self.assertRaises(PPError):
            measure.probe_edges(canvas())


class BboxSpansGridTest(unittest.TestCase):
    def test_bbox_and_insets(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        result = measure.probe_bbox(arr, (20, 10, 300, 200))
        self.assertEqual(result["bbox"], {"x": 40, "y": 30, "w": 200, "h": 100})
        self.assertEqual(result["insets"], {"left": 20, "top": 20, "right": 80, "bottom": 80})

    def test_bbox_of_empty_region(self):
        self.assertFalse(measure.probe_bbox(canvas(), (0, 0, 100, 100))["found"])

    def test_spans_and_gaps(self):
        arr = canvas()
        for x in (20, 140, 260):
            box(arr, x, 50, 100, 60, BLUE)
        result = measure.probe_spans(arr, (0, 0, 400, 300), "x")
        self.assertEqual([(s["start"], s["end"]) for s in result["spans"]], [(20, 120), (140, 240), (260, 360)])
        self.assertEqual(result["gaps"], [20, 20])
        self.assertEqual((result["uniform_size"], result["uniform_gap"], result["pitch"]), (100, 20, 120))

    def test_uneven_gaps_are_not_uniform(self):
        arr = canvas()
        for x in (20, 140, 300):
            box(arr, x, 50, 60, 60, BLUE)
        self.assertIsNone(measure.probe_spans(arr, (0, 0, 400, 300), "x")["uniform_gap"])

    def test_grid(self):
        arr = canvas()
        for y in (20, 160):
            for x in (20, 140, 260):
                box(arr, x, y, 100, 120, GRAY)
        result = measure.probe_grid(arr, (0, 0, 400, 300))
        self.assertEqual((result["columns"], result["rows"]), (3, 2))
        self.assertEqual((result["column_width"], result["gutter"]), (100, 20))
        self.assertEqual((result["row_height"], result["row_gap"]), (120, 20))


class CropTest(unittest.TestCase):
    def test_crop_writes_the_exact_pixels(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        with tempfile.TemporaryDirectory() as directory:
            source = os.path.join(directory, "design.png")
            out = os.path.join(directory, "nested", "crop.png")
            Image.fromarray(arr).save(source)
            result = measure.probe_crop(source, arr, (30, 20, 50, 40), out)
            self.assertEqual((result["width"], result["height"]), (50, 40))
            with Image.open(out) as cropped:
                self.assertTrue(np.array_equal(np.asarray(cropped), arr[20:60, 30:80]))

    def test_region_outside_image_is_rejected(self):
        with self.assertRaises(PPError):
            parse_region("350,0,100,50", canvas().shape)


class RadiusTest(unittest.TestCase):
    def test_known_radii(self):
        for radius in (4, 8, 16, 24):
            arr = rounded_box(400, 300, 40, 30, 200, 100, radius, BLUE)
            result = measure.probe_radius(arr, (40, 30, 200, 100))
            self.assertAlmostEqual(result["radius"], radius, delta=1.0, msg="radius {}".format(radius))
            self.assertTrue(result["uniform"])
            self.assertFalse(result["pill"])

    def test_square_corners(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        self.assertEqual(measure.probe_radius(arr, (40, 30, 200, 100))["radius"], 0)

    def test_pill(self):
        arr = rounded_box(400, 300, 40, 30, 200, 48, 24, BLUE)
        result = measure.probe_radius(arr, (40, 30, 200, 48))
        self.assertTrue(result["pill"])
        self.assertAlmostEqual(result["radius"], 24, delta=1.0)


class BorderTest(unittest.TestCase):
    def test_uniform_border(self):
        arr = box(canvas(), 40, 30, 200, 100, GRAY)
        box(arr, 42, 32, 196, 96, WHITE)
        result = measure.probe_border(arr, (40, 30, 200, 100))
        self.assertTrue(result["has_border"] and result["uniform"])
        self.assertEqual({s["width"] for s in result["sides"]}, {2})
        self.assertEqual({s["color"] for s in result["sides"]}, {"#c8c8c8"})
        self.assertEqual({s["inner"] for s in result["sides"]}, {"#ffffff"})

    def test_bottom_border_only(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        box(arr, 40, 127, 200, 3, (0, 0, 0))
        widths = {s["side"]: s["width"] for s in measure.probe_border(arr, (40, 30, 200, 100))["sides"]}
        self.assertEqual(widths, {"top": 0, "right": 0, "bottom": 3, "left": 0})

    def test_no_border(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        self.assertFalse(measure.probe_border(arr, (40, 30, 200, 100))["has_border"])


class GradientTest(unittest.TestCase):
    @staticmethod
    def ramp(length, start, end):
        t = (np.arange(length) + 0.5) / length
        return np.outer(1 - t, start) + np.outer(t, end)

    def test_flat(self):
        self.assertEqual(measure.probe_gradient(canvas(), (0, 0, 400, 300))["type"], "flat")

    def test_vertical_two_stops(self):
        arr = canvas()
        arr[:] = np.round(self.ramp(300, (255, 0, 0), (0, 0, 255)))[:, None, :]
        result = measure.probe_gradient(arr, (0, 0, 400, 300))
        self.assertEqual((result["type"], result["angle_deg"]), ("linear", 180))
        self.assertEqual(len(result["stops"]), 2)
        self.assertEqual([s["offset_pct"] for s in result["stops"]], [0, 100])
        self.assertLessEqual(measure.maxdiff(np.array(measure.parse_hex(result["stops"][0]["hex"])), (255, 0, 0)), 2)
        self.assertLessEqual(measure.maxdiff(np.array(measure.parse_hex(result["stops"][1]["hex"])), (0, 0, 255)), 2)

    def test_horizontal(self):
        arr = canvas()
        arr[:] = np.round(self.ramp(400, (10, 20, 30), (200, 220, 240)))[None, :, :]
        result = measure.probe_gradient(arr, (0, 0, 400, 300))
        self.assertEqual((result["type"], result["angle_deg"]), ("linear", 90))

    def test_three_stops(self):
        arr = canvas(100, 300)
        top = self.ramp(100, (255, 255, 255), (0, 0, 0))
        bottom = self.ramp(200, (0, 0, 0), (255, 0, 0))
        arr[:] = np.round(np.concatenate([top, bottom]))[:, None, :]
        result = measure.probe_gradient(arr, (0, 0, 100, 300))
        self.assertEqual(len(result["stops"]), 3)
        self.assertAlmostEqual(result["stops"][1]["offset_pct"], 33.3, delta=1.0)

    def test_ignored_colors_do_not_bend_the_gradient(self):
        arr = canvas(200, 300)
        arr[:] = np.round(self.ramp(300, (0, 40, 120), (0, 90, 220)))[:, None, :]
        clean = measure.probe_gradient(arr, (0, 0, 200, 300))
        arr[100:140, 20:180] = WHITE
        arr[200:230, 60:150] = WHITE
        self.assertNotEqual(measure.probe_gradient(arr, (0, 0, 200, 300))["type"], "linear")
        masked = measure.probe_gradient(arr, (0, 0, 200, 300), ignore=["#ffffff"])
        self.assertEqual((masked["type"], masked["angle_deg"]), ("linear", 180))
        self.assertEqual([s["hex"] for s in masked["stops"]], [s["hex"] for s in clean["stops"]])
        self.assertLess(masked["measured_share"], 0.9)

    def test_diagonal(self):
        ys, xs = np.mgrid[0:200, 0:200]
        t = ((xs + ys + 1.0) / 400.0)[..., None]
        arr = np.round((1 - t) * np.array([255, 255, 255]) + t * np.array([0, 0, 0])).astype(np.uint8)
        result = measure.probe_gradient(arr, (0, 0, 200, 200))
        self.assertEqual(result["type"], "linear")
        self.assertAlmostEqual(result["angle_deg"], 135, delta=1.0)


class ShadowTest(unittest.TestCase):
    @staticmethod
    def with_shadow(offset_x, offset_y, blur):
        layer = Image.new("L", (400, 300), 0)
        ImageDraw.Draw(layer).rectangle([100 + offset_x, 80 + offset_y, 299 + offset_x, 199 + offset_y], fill=90)
        layer = layer.filter(ImageFilter.GaussianBlur(blur / 2.0))
        arr = 255 - np.asarray(layer, dtype=np.int16)
        arr = np.repeat(arr[..., None], 3, axis=2).astype(np.uint8)
        return box(arr, 100, 80, 200, 120, WHITE)

    def test_offset_shadow(self):
        result = measure.probe_shadow(self.with_shadow(0, 8, 16), (100, 80, 200, 120))
        self.assertTrue(result["present"])
        self.assertAlmostEqual(result["offset_y"], 8, delta=1.5)
        self.assertAlmostEqual(result["offset_x"], 0, delta=0.5)
        self.assertEqual(result["profile_side"], "bottom")

    def test_no_shadow(self):
        arr = box(canvas(), 100, 80, 200, 120, BLUE)
        self.assertFalse(measure.probe_shadow(arr, (100, 80, 200, 120))["present"])


class TextTest(unittest.TestCase):
    @staticmethod
    def text_image(lines, pitch, size=40, color=(20, 20, 20)):
        image = Image.new("RGB", (500, 60 + pitch * len(lines)), WHITE)
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=size)
        for index, line in enumerate(lines):
            draw.text((20, 20 + index * pitch), line, fill=color, font=font)
        return np.asarray(image)

    def test_lines_and_pitch(self):
        arr = self.text_image(["Hxpd Hxpd", "Hxpd Hxpd", "Hxpd Hxpd"], pitch=64)
        result = measure.probe_text(arr, (0, 0, arr.shape[1], arr.shape[0]))
        self.assertEqual(result["line_count"], 3)
        self.assertEqual(result["line_pitch"], 64)
        self.assertEqual(result["color"], "#141414")
        line = result["lines"][0]
        self.assertGreater(line["descent"], 0)
        self.assertLess(line["x_height"], line["ascent"])

    def test_same_text_measures_the_same_anywhere(self):
        first = self.text_image(["Hxpd"], pitch=64)
        second = np.roll(first, (7, 13), axis=(0, 1))
        a = measure.probe_text(first, (0, 0, 500, first.shape[0]))["lines"][0]
        b = measure.probe_text(second, (0, 0, 500, second.shape[0]))["lines"][0]
        self.assertEqual((b["top"] - a["top"], b["left"] - a["left"]), (7, 13))
        self.assertEqual((a["ascent"], a["x_height"], a["width"]), (b["ascent"], b["x_height"], b["width"]))

    def test_no_text(self):
        self.assertFalse(measure.probe_text(canvas(), (0, 0, 400, 300))["found"])


class SourceQualityTest(unittest.TestCase):
    @staticmethod
    def page():
        """Boxes and rules on a plain page, as a renderer draws them."""
        arr = canvas(800, 600)
        for index in range(8):
            box(arr, 40 + index * 90, 40, 60, 200, BLUE)
            box(arr, 40, 300 + index * 30, 700, 12, (40, 40, 40))
        return arr

    def test_crisp_export_is_sharp(self):
        source = measure.probe_info(self.page(), False)["source"]
        self.assertEqual(source["quality"], "sharp")
        self.assertEqual(source["crisp_edge_share"], 1)

    def test_rescaled_image_is_soft(self):
        image = Image.fromarray(self.page())
        rescaled = image.resize((739, 554), Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.8))
        source = measure.probe_info(np.asarray(rescaled), False)["source"]
        self.assertEqual(source["quality"], "soft")

    def test_blank_image_is_unknown(self):
        self.assertEqual(measure.probe_info(canvas(), False)["source"]["quality"], "unknown")

    def test_fractional_scale_is_offered_only_without_a_whole_one(self):
        result = measure.probe_info(canvas(1600, 900), False)
        self.assertEqual((result["scale_guess"], result["ambiguous"]), (1, False))
        result = measure.probe_info(canvas(2049, 900), False)
        self.assertEqual(result["scale_guess"], 1.5)
        self.assertTrue(result["ambiguous"])


class ItemsTest(unittest.TestCase):
    def band(self):
        arr = canvas(400, 100)
        box(arr, 20, 30, 50, 40, BLUE)
        box(arr, 100, 40, 30, 10, (10, 10, 10))
        box(arr, 134, 40, 30, 10, (10, 10, 10))
        box(arr, 300, 20, 60, 60, GRAY)
        return arr

    def test_items_along_x(self):
        result = measure.probe_items(self.band(), (0, 0, 400, 100), "x", min_gap=8)
        self.assertEqual(result["count"], 3)
        self.assertEqual(
            [(i["x"], i["y"], i["w"], i["h"], i["hex"]) for i in result["items"]],
            [(20, 30, 50, 40, "#1e5ac8"), (100, 40, 64, 10, "#0a0a0a"), (300, 20, 60, 60, "#c8c8c8")],
        )
        self.assertEqual(result["gaps"], [30, 136])

    def test_small_gap_splits_items(self):
        self.assertEqual(measure.probe_items(self.band(), (0, 0, 400, 100), "x", min_gap=1)["count"], 4)

    def test_items_along_y(self):
        arr = canvas(100, 300)
        box(arr, 10, 20, 80, 30, BLUE)
        box(arr, 30, 100, 40, 12, GRAY)
        result = measure.probe_items(arr, (0, 0, 100, 300), "y")
        self.assertEqual([(i["x"], i["y"], i["w"], i["h"]) for i in result["items"]], [(10, 20, 80, 30), (30, 100, 40, 12)])
        self.assertEqual(result["gaps"], [50])


class SoftEdgeTest(unittest.TestCase):
    def test_a_blurred_item_measures_like_the_sharp_one(self):
        arr = canvas(400, 200)
        box(arr, 60, 50, 120, 40, (20, 20, 20))
        box(arr, 240, 60, 90, 20, BLUE)
        soft = np.asarray(Image.fromarray(arr).filter(ImageFilter.GaussianBlur(1.6)))
        sharp_items = measure.probe_items(arr, (0, 0, 400, 200), min_gap=4)["items"]
        soft_items = measure.probe_items(soft, (0, 0, 400, 200), min_gap=4)["items"]
        self.assertEqual([(i["x"], i["y"], i["w"], i["h"]) for i in sharp_items], [(60, 50, 120, 40), (240, 60, 90, 20)])
        for a, b in zip(sharp_items, soft_items):
            for key in ("x", "y", "w", "h"):
                self.assertAlmostEqual(a[key], b[key], delta=1)
        # ... at any tolerance: the box does not grow or shrink with the threshold.
        loose = measure.probe_items(soft, (0, 0, 400, 200), min_gap=4, tolerance=100)["items"]
        for a, b in zip(sharp_items, loose):
            for key in ("x", "y", "w", "h"):
                self.assertAlmostEqual(a[key], b[key], delta=1)

    def test_a_faint_box_keeps_its_own_edge_when_it_holds_dark_text(self):
        arr = canvas(300, 200)
        box(arr, 40, 30, 200, 120, (245, 244, 242))
        box(arr, 100, 80, 60, 12, (10, 10, 10))
        item = measure.probe_items(arr, (0, 0, 300, 200))["items"][0]
        self.assertEqual((item["x"], item["y"], item["w"], item["h"]), (40, 30, 200, 120))

    def test_inset_of_crisp_and_blended_edges(self):
        self.assertEqual(measure.half_contrast_inset(np.array([200, 200, 200])), 0)
        self.assertEqual(measure.half_contrast_inset(np.array([20, 90, 180, 200, 200, 200])), 2)
        self.assertEqual(measure.half_contrast_inset(np.array([10, 10, 240, 240])), 0)
        self.assertEqual(measure.half_contrast_inset(np.array([200])), 0)


class CropsZoomOutlineTest(unittest.TestCase):
    def test_crops_write_every_item_and_list_it(self):
        arr = canvas(200, 100)
        box(arr, 30, 20, 50, 40, BLUE)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src.png")
            Image.fromarray(arr).save(src)
            result = measure.probe_crops(src, arr, [("a", (30, 20, 50, 40)), ("b", (0, 0, 10, 10))], os.path.join(tmp, "out"))
            self.assertEqual([(r["id"], r["x"], r["y"], r["w"], r["h"]) for r in result["assets"]], [("a", 30, 20, 50, 40), ("b", 0, 0, 10, 10)])
            with Image.open(result["assets"][0]["file"]) as cropped:
                self.assertTrue(np.array_equal(np.asarray(cropped), arr[20:60, 30:80]))

    def test_crops_can_blank_ui_the_code_will_draw(self):
        arr = canvas(300, 100, (20, 20, 20))
        box(arr, 30, 20, 50, 40, BLUE)                 # a photo
        box(arr, 44, 30, 6, 6, WHITE)                  # a white badge drawn on it
        box(arr, 130, 20, 50, 40, (250, 250, 250))     # a second, near-white photo with the same badge
        box(arr, 144, 30, 6, 6, WHITE)
        box(arr, 244, 30, 6, 6, WHITE)                 # the badge again, on the dark page
        gray = list(measure.BLANK_FILL)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src.png")
            Image.fromarray(arr).save(src)
            items = [("a", (30, 20, 50, 40)), ("b", (130, 20, 50, 40))]
            out = os.path.join(tmp, "out")
            result = measure.probe_crops(src, arr, items, out, [("a", (40, 26, 14, 14), WHITE, None), ("b", (140, 26, 14, 14), WHITE, (240, 26))])
            self.assertEqual([row["source"] for row in result["assets"]], ["blanked crop", "blanked crop"])
            self.assertEqual([(row["asset"], row["pixels"], row["shape_from"]) for row in result["blanks"]], [("a", 60, None), ("b", 60, "240,26")])
            for row in result["assets"]:
                with Image.open(row["file"]) as cropped:
                    got = np.asarray(cropped)
                self.assertEqual(got[12, 16].tolist(), gray)                            # the badge is gone
                self.assertEqual(got[12, 13].tolist(), gray)                            # with one pixel around it
                self.assertNotEqual(got[12, 11].tolist(), gray)                         # and nothing more
                self.assertNotEqual(got[2, 2].tolist(), gray)
            with self.assertRaises(PPError):                                            # outside its crop
                measure.probe_crops(src, arr, items, out, [("a", (70, 30, 20, 8), WHITE, None)])
            with self.assertRaises(PPError):                                            # not one of the crops
                measure.probe_crops(src, arr, items, out, [("c", (40, 30, 10, 8), WHITE, None)])
            with self.assertRaises(PPError):                                            # nothing of that color there
                measure.probe_crops(src, arr, items, out, [("a", (32, 22, 6, 4), WHITE, None)])

    def test_substitute_fills_a_cut_off_slot_from_a_complete_image(self):
        arr = canvas(300, 100)
        arr[10:60, 20:120] = np.arange(100, dtype=np.uint8)[None, :, None] + 50      # complete image, varies left to right
        box(arr, 260, 10, 40, 50, BLUE)                                               # cut-off image at the right edge
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "design.png")
            Image.fromarray(arr).save(src)
            result = measure.probe_substitute(src, arr, [("last", (20, 10, 100, 50), (260, 10, 40, 50), "tl")])
            self.assertEqual(result["out"], os.path.join(tmp, "design.subs.png"))
            with Image.open(result["out"]) as edited:
                out = np.asarray(edited)
            self.assertTrue(np.array_equal(out[10:60, 260:300], arr[10:60, 20:60]))    # the source's left part
            untouched = np.ones(arr.shape[:2], bool); untouched[10:60, 260:300] = False
            self.assertTrue(np.array_equal(out[untouched], arr[untouched]))
            with Image.open(src) as original:
                self.assertTrue(np.array_equal(np.asarray(original), arr))            # the design itself is not modified
            right = measure.probe_substitute(src, arr, [("first", (20, 10, 100, 50), (260, 10, 40, 50), "tr")], os.path.join(tmp, "r.png"))
            with Image.open(right["out"]) as edited:
                self.assertTrue(np.array_equal(np.asarray(edited)[10:60, 260:300], arr[10:60, 80:120]))

    def test_substitute_rejects_a_source_smaller_than_the_slot(self):
        arr = canvas(300, 100)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "design.png")
            Image.fromarray(arr).save(src)
            with self.assertRaises(measure.PPError):
                measure.probe_substitute(src, arr, [("x", (0, 0, 20, 20), (100, 0, 40, 20), "tl")])

    def test_substitute_refuses_a_copy_as_its_input_and_a_source_on_the_slot(self):
        arr = canvas(300, 100)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "design.png")
            copy = os.path.join(tmp, "design.subs.png")
            Image.fromarray(arr).save(src)
            Image.fromarray(arr).save(copy)
            good = ("a", (20, 10, 100, 50), (260, 10, 40, 50), "tl")
            with self.assertRaises(PPError):
                measure.probe_substitute(copy, arr, [good])
            with self.assertRaises(PPError):
                measure.probe_substitute(src, arr, [("a", (200, 10, 100, 50), (260, 10, 40, 50), "tl")])
            with self.assertRaises(PPError):
                measure.probe_substitute(src, arr, [good, ("b", (20, 10, 100, 50), (270, 20, 30, 40), "tl")])

    def test_substitute_preview_shows_each_slot_before_and_after(self):
        arr = canvas(300, 100)
        box(arr, 20, 10, 100, 50, BLUE)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "design.png")
            Image.fromarray(arr).save(src)
            sheet = os.path.join(tmp, "look", "subs.png")
            result = measure.probe_substitute(src, arr, [("last", (20, 10, 100, 50), (260, 10, 40, 50), "tl")], preview=sheet)
            self.assertNotIn("warning", result)
            self.assertEqual([row["id"] for row in result["preview"]["rows"]], ["last"])
            with Image.open(sheet) as image:
                look = np.asarray(image)
            half = (look.shape[1] - 10) // 2
            self.assertEqual(tuple(look[30, half - 10]), WHITE)                        # before: the empty slot
            self.assertEqual(tuple(look[30, half + 10 + half - 10]), BLUE)             # after: filled

    def test_the_original_is_flagged_once_a_substituted_copy_exists(self):
        arr = canvas(300, 100)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "design.png")
            Image.fromarray(arr).save(src)
            self.assertIsNone(superseded_by(src))
            copy = measure.probe_substitute(src, arr, [("last", (20, 10, 100, 50), (260, 10, 40, 50), "tl")])["out"]
            self.assertEqual(superseded_by(src), copy)
            self.assertIsNone(superseded_by(copy))

    def test_substitute_of_a_lossy_format_says_so(self):
        arr = canvas(300, 100)
        box(arr, 20, 10, 100, 50, BLUE)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "design.jpg")
            Image.fromarray(arr).save(src, quality=95)
            result = measure.probe_substitute(src, arr, [("last", (20, 10, 100, 50), (260, 10, 40, 50), "tl")])
            self.assertEqual(result["out"], os.path.join(tmp, "design.subs.jpg"))
            self.assertIn("warning", result)
            exact = measure.probe_substitute(src, arr, [("last", (20, 10, 100, 50), (260, 10, 40, 50), "tl")], os.path.join(tmp, "design.subs.png"))
            self.assertNotIn("warning", exact)

    def test_zoom_stacks_enlarged_regions(self):
        arr = canvas(200, 100)
        box(arr, 30, 20, 50, 40, BLUE)
        with tempfile.TemporaryDirectory() as tmp:
            src, out = os.path.join(tmp, "src.png"), os.path.join(tmp, "zoom.png")
            Image.fromarray(arr).save(src)
            result = measure.probe_zoom(src, arr, [(30, 20, 50, 40), (0, 0, 20, 10)], out, factor=4)
            self.assertEqual((result["width"], result["height"]), (200, 160 + 10 + 40))
            with Image.open(out) as sheet:
                pixels = np.asarray(sheet)
            self.assertEqual(tuple(pixels[0, 0]), BLUE)
            self.assertEqual(tuple(pixels[165, 0]), (255, 0, 255))
            self.assertEqual(tuple(pixels[175, 0]), WHITE)

    def test_zoom_factor_keeps_the_sheet_readable(self):
        arr = canvas(900, 300)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src.png")
            Image.fromarray(arr).save(src)
            result = measure.probe_zoom(src, arr, [(0, 0, 900, 300)], os.path.join(tmp, "z.png"))
            self.assertEqual(result["factor"], 1)
            self.assertNotIn("warning", result)

    def test_zoom_of_the_whole_image_by_default(self):
        import argparse

        self.assertEqual(measure.zoom_regions(argparse.Namespace(region=None), canvas(120, 80)), [(0, 0, 120, 80)])

    def test_outline_of_a_trapezoid(self):
        image = Image.new("RGB", (300, 200), WHITE)
        ImageDraw.Draw(image).polygon([(50, 20), (250, 20), (200, 180), (100, 180)], fill=BLUE)
        result = measure.probe_outline(np.asarray(image), (0, 0, 300, 200), color="#1e5ac8", scale=2)
        self.assertTrue(result["found"])
        self.assertEqual(result["split_rows"], 0)
        self.assertLessEqual(result["vertices"], 8)
        numbers = [float(n) for n in result["path"][1:-1].replace("L", "").split()]
        xs, ys = numbers[0::2], numbers[1::2]
        self.assertAlmostEqual(min(xs), 50, delta=1.5)
        self.assertAlmostEqual(max(xs), 251, delta=1.5)
        self.assertAlmostEqual(min(ys), 20.5, delta=1)
        self.assertAlmostEqual(max(ys), 180.5, delta=1)
        self.assertEqual(result["points"]["viewbox"], "0 0 150 100")

    def test_outline_reports_a_hollow_shape(self):
        arr = canvas(200, 100)
        box(arr, 20, 20, 160, 60, BLUE)
        box(arr, 80, 40, 40, 20, WHITE)
        result = measure.probe_outline(arr, (0, 0, 200, 100), color="#1e5ac8")
        self.assertEqual(result["split_rows"], 20)
        self.assertIn("note", result)

    def test_outline_bridges_text_lying_across_the_edge(self):
        image = Image.new("RGB", (300, 300), WHITE)
        ImageDraw.Draw(image).polygon([(20, 10), (200, 10), (260, 290), (20, 290)], fill=BLUE)
        clean = np.asarray(image).copy()
        marked = clean.copy()
        marked[100:118, 190:240] = WHITE      # a word crossing the slanted right edge
        marked[180:196, 210:260] = WHITE
        want = measure.probe_outline(clean, (0, 0, 300, 300), color="#1e5ac8")
        dented = measure.probe_outline(marked, (0, 0, 300, 300), color="#1e5ac8")
        bridged = measure.probe_outline(marked, (0, 0, 300, 300), color="#1e5ac8", bridge=41)
        self.assertGreater(dented["vertices"], want["vertices"])
        self.assertEqual(bridged["bridged_rows"], 34)
        self.assertLessEqual(bridged["vertices"], want["vertices"] + 2)
        # Bridging a clean shape changes nothing.
        self.assertEqual(measure.probe_outline(clean, (0, 0, 300, 300), color="#1e5ac8", bridge=41)["path"], want["path"])

    def test_outline_of_nothing(self):
        self.assertFalse(measure.probe_outline(canvas(), (0, 0, 400, 300), color="#1e5ac8")["found"])


class PointsMirrorTest(unittest.TestCase):
    def test_lengths_are_divided_by_scale(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        result = with_points(measure.probe_bbox(arr, (20, 10, 300, 200)), 2)
        self.assertEqual(result["points"]["bbox"], {"x": 20, "y": 15, "w": 100, "h": 50})
        self.assertNotIn("background", result["points"])

    def test_points_only_output_converts_lengths_once(self):
        from pp_common import in_points

        arr = canvas()
        box(arr, 40, 20, 100, 60, BLUE)
        result = in_points(measure.probe_items(arr, (0, 0, 400, 300)), 2)
        self.assertEqual((result["units"], result["region_px"]), ("points", {"x": 0, "y": 0, "w": 400, "h": 300}))
        self.assertEqual(result["items"], [{"x": 20, "y": 10, "w": 50, "h": 30, "hex": "#1e5ac8"}])
        self.assertNotIn("points", result)
        self.assertNotIn("units", in_points(measure.probe_items(arr, (0, 0, 400, 300)), 1))

    def test_scale_one_adds_nothing(self):
        arr = box(canvas(), 40, 30, 200, 100, BLUE)
        self.assertNotIn("points", with_points(measure.probe_bbox(arr, (20, 10, 300, 200)), 1))


if __name__ == "__main__":
    unittest.main()
