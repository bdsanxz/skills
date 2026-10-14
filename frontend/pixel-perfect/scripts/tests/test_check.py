"""Check and fit are run on screenshots drawn here, as any platform would save them."""
import os
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw

import scores

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A stand-in for a harness: draws one box whose size comes from the values.
RENDER = """
import os, sys
from PIL import Image, ImageDraw
image = Image.new("RGB", (120, 80), (255, 255, 255))
width, height = float(sys.argv[2]), float(os.environ["PP_FIT_TALL"])
ImageDraw.Draw(image).rectangle((30, 20, 30 + round(width) - 1, 20 + round(height) - 1), fill=(30, 90, 200))
image.save(sys.argv[1])
"""


def tool(name, *args):
    done = subprocess.run([sys.executable, os.path.join(SCRIPTS, name + ".py")] + list(args),
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=dict(os.environ, PYTHONPATH=SCRIPTS))
    return done.returncode, done.stdout


def screen(card=(40, 30, 100, 60)):
    """A 400 x 300 screenshot: a magenta harness with one white wrapper holding a blue card."""
    image = Image.new("RGB", (400, 300), (255, 0, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 10, 179, 109), fill=(255, 255, 255))
    x, y, w, h = card
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(30, 90, 200))
    return image


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.work = os.path.join(self.root, "run")
        self.shot = os.path.join(self.root, "shot.png")
        screen().save(self.shot)
        reference = os.path.join(self.work, "components", "card", "ref", "default.png")
        os.makedirs(os.path.dirname(reference))
        screen().crop((20, 10, 180, 110)).save(reference)
        self.common = ("--work-dir", self.work, "--shot", self.shot, "--scale", "2")

    def tearDown(self):
        self.temp.cleanup()

    def test_an_item_is_cut_out_by_its_box_and_scored(self):
        status, output = tool("check", *self.common, "--item", "card=20,10,160,100", "--sheet")
        self.assertEqual(status, 0, output)
        made = os.path.join(self.work, "components", "card", "iter-01", "default")
        self.assertEqual(sorted(name for name in os.listdir(made) if not name.endswith(".png") or name == "render.png"),
                         ["capture.toon", "diff.json", "diff.toon", "render.png"])
        with Image.open(os.path.join(made, "render.png")) as render:
            self.assertEqual(render.size, (160, 100))
        with open(os.path.join(made, "capture.toon")) as handle:
            self.assertIn("shot_sha1", handle.read())
        self.assertTrue(os.path.isfile(os.path.join(self.work, "sheets", "iter-01.png")))
        self.assertTrue(scores.standing(self.work)[0]["pass"])

    def test_a_moved_component_fails_and_an_iteration_is_never_overwritten(self):
        screen(card=(46, 30, 100, 60)).save(self.shot)
        status, output = tool("check", *self.common, "--item", "card=20,10,160,100")
        self.assertEqual(status, 1, output)
        status, output = tool("check", *self.common, "--item", "card=20,10,160,100", "--iter", "1")
        self.assertEqual(status, 2)
        self.assertIn("never overwritten", output)

    def test_a_box_outside_the_screenshot_is_refused_before_anything_is_written(self):
        status, output = tool("check", *self.common, "--item", "card=300,250,160,100")
        self.assertEqual(status, 2)
        self.assertIn("screenshot pixels", output)
        self.assertFalse(os.path.exists(os.path.join(self.work, "components", "card", "iter-01")))

    def test_a_page_is_the_whole_screenshot_and_a_wrong_size_fails(self):
        design = os.path.join(self.root, "design.png")
        screen().save(design)
        status, output = tool("check", *self.common, "--page", "home=" + design, "--item", "card=20,10,160,100")
        self.assertEqual(status, 0, output)
        self.assertTrue(os.path.isdir(os.path.join(self.work, "pages", "home", "iter-01", "default")))
        screen().resize((800, 600)).save(self.shot)
        status, output = tool("check", *self.common, "--page", "home=" + design)
        self.assertEqual(status, 1, output)

    def test_dry_run_writes_nothing(self):
        status, output = tool("check", *self.common, "--item", "card=20,10,160,100", "--dry")
        self.assertEqual(status, 0, output)
        self.assertFalse(os.path.exists(os.path.join(self.work, "components", "card", "iter-01")))


class FitTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.script = os.path.join(self.root, "render.py")
        with open(self.script, "w") as handle:
            handle.write(RENDER)
        self.shot = os.path.join(self.root, "fit.png")
        self.reference = os.path.join(self.root, "ref.png")
        image = Image.new("RGB", (120, 80), (255, 255, 255))
        ImageDraw.Draw(image).rectangle((30, 20, 30 + 47, 20 + 25), fill=(30, 90, 200))
        image.save(self.reference)
        self.render = '"{}" "{}" "{}" {{wide}}'.format(sys.executable, self.script, self.shot)

    def tearDown(self):
        self.temp.cleanup()

    def test_fit_recovers_known_values_from_nearby_starts(self):
        status, output = tool("fit", "--render", self.render, "--shot", self.shot, "--reference", self.reference,
                              "--var", "wide=42:1", "--var", "tall=30:1", "--json")
        self.assertEqual(status, 0, output)
        import json

        result = json.loads(output)
        self.assertEqual({v["name"]: v["value"] for v in result["vars"]}, {"wide": 48, "tall": 26})
        self.assertEqual(result["mismatched_pixels"]["best"], 0)

    def test_a_failing_render_command_is_reported(self):
        status, output = tool("fit", "--render", '"{}" -c "import sys; sys.exit(3)"'.format(sys.executable), "--shot", self.shot,
                              "--reference", self.reference, "--var", "wide=42:1")
        self.assertEqual(status, 2)
        self.assertIn("exited with status 3", output)

    def test_a_box_of_another_size_is_refused(self):
        status, output = tool("fit", "--render", self.render, "--shot", self.shot, "--box", "0,0,100,80",
                              "--reference", self.reference, "--var", "wide=42:1", "--var", "tall=30:1")
        self.assertEqual(status, 2)
        self.assertIn("must be equal", output)


if __name__ == "__main__":
    unittest.main()
