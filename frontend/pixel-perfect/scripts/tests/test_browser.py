"""Capture, check and fit are run against real pages in Chromium.

Skipped when Chromium is not installed; `run.py setup --browser` installs it.
"""
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

import capture
import scores

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGE = """<!doctype html><html><head><style>
body { margin: 0; background: #fff; }
.half { width: 100.5px; height: 40.5px; background: #1e5ac8; }
.card { margin: 20px; width: 120px; height: 60px; background: #c81e1e; }
img { display: block; width: 50.5px; height: 30px; }
</style></head><body>
<div class="half"></div><div class="card"></div><img src="noise.png">
</body></html>"""

FIT_PAGE = """<!doctype html><html><head><style>
body { margin: 0; background: #fff; }
.wrap { width: 120px; height: 120px; display: grid; place-items: center; }
.dot { width: var(--size, 40px); height: var(--size, 40px); border-radius: 50%; background: #fff;
       box-shadow: 0 var(--sy, 4px) var(--blur, 10px) rgba(0, 0, 0, 0.2); }
</style></head><body><div class="wrap"><div class="dot"></div></div></body></html>"""


def browser_available():
    try:
        with capture.Browser(100, 100, 1):
            return True
    except Exception:
        return False


def tool(name, *args):
    """Run one of the scripts as the entry point would, and return (exit status, output)."""
    done = subprocess.run([sys.executable, os.path.join(SCRIPTS, name + ".py")] + list(args),
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return done.returncode, done.stdout


@unittest.skipUnless(browser_available(), "Chromium is not installed")
class BrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = cls.tmp.name
        noise = np.random.default_rng(7).integers(0, 256, (60, 101, 3), dtype=np.uint8)
        Image.fromarray(noise).save(os.path.join(cls.root, "noise.png"))
        cls.noise = noise
        for name, text in (("index.html", PAGE), ("fit.html", FIT_PAGE),
                           ("broken.html", PAGE.replace("noise.png", "missing.png"))):
            with open(os.path.join(cls.root, name), "w") as handle:
                handle.write(text)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def url(self, name):
        return "file://" + os.path.join(self.root, name)

    def shoot(self, selector, name="index.html", scale=2):
        out = os.path.join(self.root, "shot-{}.png".format(abs(hash((selector, name, scale)))))
        status, output = tool("capture", "--url", self.url(name), "--out", out, "--viewport", "400,300",
                              "--scale", str(scale), "--selector", selector)
        with Image.open(out) as image:
            return status, output, np.asarray(image.convert("RGB"))

    def test_a_half_pixel_box_keeps_its_exact_device_size(self):
        status, output, pixels = self.shoot(".half")
        self.assertEqual(status, 0)
        self.assertEqual(pixels.shape[:2], (81, 201))
        self.assertTrue((pixels == (30, 90, 200)).all())
        self.assertIn("fractional_box: false", output)
        self.assertIn("valid: true", output)

    def test_an_image_at_half_pixel_size_is_not_resampled(self):
        # 101 x 60 image pixels shown at 50.5 x 30 CSS pixels and scale 2: one
        # image pixel per device pixel, so the capture must equal the file.
        _, _, pixels = self.shoot("img")
        self.assertTrue(np.array_equal(pixels, self.noise))

    def test_viewport_and_scale_are_honored(self):
        out = os.path.join(self.root, "view.png")
        status, output = tool("capture", "--url", self.url("index.html"), "--out", out, "--viewport", "320,240", "--scale", "3")
        self.assertEqual(status, 0)
        with Image.open(out) as image:
            self.assertEqual(image.size, (960, 720))

    def test_a_failed_request_makes_the_capture_invalid(self):
        status, output, _ = self.shoot(".card", "broken.html")
        self.assertEqual(status, capture.INVALID_EXIT)
        self.assertIn("valid: false", output)
        self.assertIn("missing.png", output)

    def test_an_ignored_request_does_not(self):
        out = os.path.join(self.root, "ignored.png")
        status, _ = tool("capture", "--url", self.url("broken.html"), "--out", out, "--viewport", "400,300",
                         "--ignore-request", "missing.png")
        self.assertEqual(status, 0)

    def test_check_scores_every_item_from_one_load_and_never_overwrites(self):
        work = os.path.join(self.root, "work")
        _, _, half = self.shoot(".half")
        for name, pixels in (("half", half), ("card", np.full((120, 240, 3), (200, 30, 30), dtype=np.uint8))):
            os.makedirs(os.path.join(work, "components", name, "ref"))
            Image.fromarray(pixels).save(os.path.join(work, "components", name, "ref", "default.png"))
        common = ["--url", self.url("index.html"), "--viewport", "400,300", "--scale", "2", "--work-dir", work]
        status, output = tool("check", *common, "--item", "half=.half", "--item", "card=.card")
        self.assertEqual(status, 0, output)
        self.assertIn("passed: 2", output)
        made = os.path.join(work, "components", "card", "iter-01", "default")
        self.assertEqual(sorted(os.listdir(made)), ["capture.toon", "diff.json", "diff.toon", "render.png"])

        # A round of only one item still takes the number after the other's
        # latest, so the items of any round share one number.
        status, output = tool("check", *common, "--item", "half=.half")
        self.assertIn("iteration: 2", output)

        # A wrong reference fails and says where; the arguments can come from a file.
        Image.fromarray(np.full((120, 240, 3), (30, 200, 30), dtype=np.uint8)).save(
            os.path.join(work, "components", "card", "ref", "default.png"))
        listed = os.path.join(self.root, "round.args")
        with open(listed, "w") as handle:
            handle.write("# the round\n--item card=.card\n--item half=.nothing-here --timeout 500\n")
        status, output = tool("check", *common, "@" + listed, "--sheet")
        self.assertEqual(status, 1, output)
        self.assertIn("iteration: 3", output)
        self.assertIn("component,card,default,false,0,", output)
        self.assertIn("no visible element matches .nothing-here", output)
        self.assertTrue(os.path.isdir(os.path.join(work, "components", "card", "iter-03", "default")))
        with Image.open(os.path.join(work, "sheets", "iter-03.png")) as sheet:
            pixels = np.asarray(sheet.convert("RGB"))
        # The sheet shows the card's (green) reference and its (red) render, equally large.
        green = int((pixels == (30, 200, 30)).all(axis=2).sum())
        red = int((pixels == (200, 30, 30)).all(axis=2).sum())
        self.assertEqual(green, red)
        self.assertGreaterEqual(green, 240 * 120)

        # The card's reference was replaced, so its earlier pass no longer counts.
        rows = {row["item"]: row for row in scores.standing(work)}
        card = rows["card"]
        self.assertEqual((card["iterations"], card["best_iter"], card["reference_changed"], card["pass"]), (2, 3, 3, False))
        self.assertEqual((rows["half"]["pass"], rows["half"]["reference_changed"]), (True, None))

        status, output = tool("check", *common, "--item", "card=.card", "--iter", "3")
        self.assertEqual(status, 2)
        self.assertIn("never overwritten", output)

        # A section is kept apart from the components, under the same round number.
        os.makedirs(os.path.join(work, "sections", "top", "ref"))
        Image.fromarray(half).save(os.path.join(work, "sections", "top", "ref", "default.png"))
        status, output = tool("check", *common, "--section", "top=.half", "--item", "half=.half")
        self.assertEqual(status, 0, output)
        # half's last round was 2 (its selector was missing in round 3), so this is round 3 for both.
        self.assertIn("iteration: 3", output)
        self.assertIn("section,top,default,true,100,", output)
        self.assertTrue(os.path.isfile(os.path.join(work, "sections", "top", "iter-03", "default", "diff.json")))

        # A design with a substituted copy beside it is not accepted as a page reference.
        design = os.path.join(self.root, "design.png")
        Image.fromarray(half).save(design)
        Image.fromarray(half).save(os.path.join(self.root, "design.subs.png"))
        status, output = tool("check", *common, "--page", "home=" + design)
        self.assertEqual(status, 2)
        self.assertIn("design.subs.png", output)

        # compare finds an item's reference and latest render by name.
        status, output = tool("compare", "--item", "half", "--item", "card", "--work-dir", work, "--scale", "2")
        self.assertEqual(status, 0, output)
        self.assertIn("item: half/default iter-03", output)
        self.assertIn("item: card/default iter-03", output)
        # The green reference is all backdrop; the red render shows up as something extra.
        self.assertIn("only_in_render", output)

    def test_check_writes_nothing_when_the_capture_is_invalid(self):
        work = os.path.join(self.root, "work-invalid")
        os.makedirs(os.path.join(work, "components", "card", "ref"))
        Image.fromarray(np.full((120, 240, 3), (200, 30, 30), dtype=np.uint8)).save(
            os.path.join(work, "components", "card", "ref", "default.png"))
        status, output = tool("check", "--url", self.url("broken.html"), "--viewport", "400,300", "--scale", "2",
                              "--work-dir", work, "--item", "card=.card")
        self.assertEqual(status, capture.INVALID_EXIT)
        self.assertIn("scored: 0", output)
        self.assertEqual(os.listdir(os.path.join(work, "components", "card")), ["ref"])

    def test_images_that_are_resampled_are_named(self):
        # index.html draws its 101 x 60 image at 50.5 x 30 CSS px: exact at scale 2, resampled at scale 1.
        out = os.path.join(self.root, "audit.png")
        _, exact = tool("capture", "--url", self.url("index.html"), "--out", out, "--viewport", "400,300", "--scale", "2")
        self.assertIn("images: 1", exact)
        self.assertIn("images_not_1to1[0]:", exact)
        _, coarse = tool("capture", "--url", self.url("index.html"), "--out", out, "--viewport", "400,300", "--scale", "1")
        self.assertIn("images_not_1to1[1]", coarse)
        self.assertIn("drawn 50.5x30 px from a 101x60 px file", coarse)

    def test_inspect_lists_boxes_and_tells_two_mounts_apart(self):
        page = """<!doctype html><html><head><style>
body { margin: 0; font: 16px/20px Helvetica, Arial, sans-serif; }
ul { margin: 0; padding: 0; list-style: none; display: flex; gap: 10px; }
.item { width: 100px; }
.item__title { margin: 0; font-size: 12px; line-height: 14px; font-weight: 700; }
.alone { margin-top: 20px; }
.alone .item__title { position: relative; top: 6px; }
</style></head><body>
<ul><li class="item"><h3 class="item__title">One</h3></li></ul>
<div class="alone"><div class="item"><h3 class="item__title">One</h3></div></div>
<div class="twin"><div class="item"><h3 class="item__title">One</h3></div></div>
</body></html>"""
        with open(os.path.join(self.root, "mounts.html"), "w") as handle:
            handle.write(page)
        common = ["--url", self.url("mounts.html"), "--viewport", "400,300"]
        status, output = tool("inspect_page", *common, "--selector", "ul .item")
        self.assertEqual(status, 0, output)
        self.assertIn("li.item,0,0,100,14,null,null,null,null", output)
        self.assertIn('"  h3.item__title",0,0,100,14,12,14,"700",Helvetica', output)
        status, output = tool("inspect_page", *common, "--selector", "ul .item", "--against-selector", ".twin .item")
        self.assertEqual(status, 0, output)
        self.assertIn("identical: true", output)
        status, output = tool("inspect_page", *common, "--selector", "ul .item", "--against-selector", ".alone .item")
        self.assertEqual(status, 1, output)
        self.assertIn("identical: false", output)
        self.assertIn("largest_difference: 6", output)
        self.assertIn("h3.item__title,0,6,0,0,", output)

    def test_fit_recovers_known_values_from_nearby_starts(self):
        reference = os.path.join(self.root, "fit-ref.png")
        tool("capture", "--url", self.url("fit.html"), "--out", reference, "--viewport", "200,200", "--scale", "2", "--selector", ".wrap")
        status, output = tool("fit", "--url", self.url("fit.html"), "--viewport", "200,200", "--scale", "2",
                              "--selector", ".wrap", "--reference", reference,
                              "--var", "size=37:1:px", "--var", "sy=2:0.5:px", "--var", "blur=7:1:px")
        self.assertEqual(status, 0, output)
        self.assertIn("best: 0", output)
        for line in ('"--size",37,40,px,false', '"--sy",2,4,px,false', '"--blur",7,10,px,false'):
            self.assertIn(line, output)


if __name__ == "__main__":
    unittest.main()
