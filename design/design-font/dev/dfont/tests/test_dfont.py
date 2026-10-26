"""Tests for the dfont scripts, run against the fixture project next to this directory.

Run them with the Python of the dfont environment, which has the dependencies:

    python3 ../../../scripts/run.py setup      # prints the environment path
    <environment>/bin/python -m unittest discover -s . -v
"""
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "scripts"))
FIXTURE = os.path.abspath(os.path.join(HERE, "..", "fixture"))
sys.path.insert(0, SCRIPTS)

from dfont import geometry  # noqa: E402
from dfont.outline import runs, union_contours  # noqa: E402
from dfont.project import Project  # noqa: E402


def _copy_fixture():
    tmp = tempfile.mkdtemp(prefix="dfont-test-")
    root = os.path.join(tmp, "fixture")
    shutil.copytree(FIXTURE, root, ignore=shutil.ignore_patterns("dist", "qa", "proof", "__pycache__",
                                                                  "kerning.suggested.json"))
    return tmp, root


class FixtureCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp, cls.root = _copy_fixture()
        cls.project = Project(cls.root)
        cls.build = cls.project.build()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def master(self, name):
        return self.build.master(self.project.master_index(name))


class GeometryTest(unittest.TestCase):
    def test_hobby_quarter_circle_matches_the_circle_constant(self):
        c1, c2 = geometry.hobby_controls((1, 0), (0, 1), (0, 1), (-1, 0))
        self.assertAlmostEqual(c1[1], 0.5523, delta=0.01)
        self.assertAlmostEqual(c2[0], 0.5523, delta=0.01)

    def test_contour_area_is_positive_counterclockwise(self):
        square = ((0, 0), [("line", (10, 0)), ("line", (10, 10)), ("line", (0, 10)), ("line", (0, 0))])
        self.assertGreater(geometry.contour_area(*square), 0)
        self.assertLess(geometry.contour_area(*geometry.reverse_contour(*square)), 0)


class BuildTest(FixtureCase):
    def test_fixture_builds_without_errors(self):
        errors = [p for p in self.build.problems if p["level"] in ("error", "warning")]
        self.assertEqual(errors, [])

    def test_masters_stay_point_compatible(self):
        for name in self.build.order:
            masters = self.build.glyphs[name].masters
            shapes = [[(len(segs), [s[0] for s in segs]) for _, segs in mg.contours] for mg in masters]
            for other in shapes[1:]:
                self.assertEqual(other, shapes[0], name)

    def test_edge_puts_the_stroke_edge_on_the_point(self):
        # l is a stem drawn with edge="left" at x=0, then spaced with sb_straight on the left.
        for m in self.project.masters:
            glyphs = self.master(m.name)
            r = runs(union_contours(glyphs["l"].contours), 1, 200)
            self.assertAlmostEqual(r[0][0], m.params["sb_straight"], delta=0.5)
            self.assertAlmostEqual(r[0][1] - r[0][0], m.params["stem"], delta=0.5)

    def test_round_shapes_overshoot(self):
        glyphs = self.master("Regular")
        bounds = [geometry.contour_bounds(*c) for c in glyphs["o"].contours]
        os_ = self.project.masters[0].params["overshoot"]
        self.assertAlmostEqual(min(b[1] for b in bounds), -os_, delta=0.5)
        self.assertAlmostEqual(max(b[3] for b in bounds), self.project.metrics["xheight"] + os_, delta=0.5)

    def test_default_location_selects_the_default_master(self):
        loc = self.project.default_master.location
        scalars = self.project.scalars(loc)
        index = self.project.masters.index(self.project.default_master)
        self.assertAlmostEqual(scalars[index], 1.0)
        self.assertAlmostEqual(sum(abs(s) for i, s in enumerate(scalars) if i != index), 0.0)

    def test_composites_place_the_mark_on_the_anchor(self):
        g = self.build.glyphs["oacute"]
        self.assertEqual(g.origin, "composite")
        self.assertEqual(g.base, "o")
        self.assertEqual(g.unicodes, [0xF3])
        # Capitals take the .case mark, which sits higher.
        lower = self.build.glyphs["oacute"].masters[1]
        upper = self.build.glyphs["Oacute"].masters[1]
        top = lambda mg: max(geometry.contour_bounds(*c)[3] for c in mg.contours)  # noqa: E731
        self.assertGreater(top(upper) - top(lower), self.project.metrics["cap"] - self.project.metrics["xheight"] - 20)

    def test_i_takes_dotless_i_under_marks(self):
        g = self.build.glyphs["iacute"]
        self.assertEqual(g.base, "dotlessi")


class FontFileTest(FixtureCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from dfont.compile import build_fonts
        cls.files, _ = build_fonts(cls.project, cls.build, os.path.join(cls.root, "dist"))

    def test_every_format_is_written(self):
        names = sorted(os.path.relpath(f, os.path.join(self.root, "dist")) for f in self.files)
        for expected in ("otf/FixtureSans-Regular.otf", "ttf/FixtureSans-Bold.ttf",
                         "webfonts/FixtureSans-Light.woff2", "variable/FixtureSans[wght].ttf",
                         "variable/FixtureSans[wght].woff2"):
            self.assertIn(expected, names)

    def test_files_pass_the_sanitizer_and_keep_every_character(self):
        from dfont.check import file_checks
        self.assertEqual(file_checks(self.project, self.build, self.files), [])

    def test_kerning_reaches_class_members_and_masters(self):
        import uharfbuzz as hb

        def advances(path, text, loc=None):
            font = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
            if loc:
                font.set_variations(loc)
            buf = hb.Buffer()
            buf.add_str(text)
            buf.guess_segment_properties()
            hb.shape(font, buf, {})
            return [p.x_advance for p in buf.glyph_positions]

        regular = os.path.join(self.root, "dist", "otf", "FixtureSans-Regular.otf")
        plain = os.path.join(self.root, "dist", "ttf", "FixtureSans-Regular.ttf")
        self.assertEqual(advances(regular, "To"), advances(regular, "Tó"))
        self.assertLess(advances(regular, "To")[0], advances(regular, "TH")[0])
        variable = os.path.join(self.root, "dist", "variable", "FixtureSans[wght].ttf")
        bold = os.path.join(self.root, "dist", "ttf", "FixtureSans-Bold.ttf")
        self.assertEqual(advances(variable, "T.", {"wght": 700})[0], advances(bold, "T.")[0])
        self.assertEqual(advances(variable, "T.", {"wght": 400})[0], advances(plain, "T.")[0])


class SpacingTest(FixtureCase):
    def test_diagonal_and_overhang_pairs_kern_tighter_and_rounds_do_not(self):
        from dfont.spacing import kern_suggestions
        pairs = [("A", "V"), ("T", "o"), ("L", "T"), ("o", "o"), ("n", "o"), ("H", "o")]
        k = kern_suggestions(self.project, self.build, self.master("Regular"), pairs, 0, set())
        for pair in pairs[:3]:
            self.assertLessEqual(k[pair], -40, pair)
        for pair in pairs[3:]:
            self.assertLessEqual(abs(k[pair]), 10, pair)

    def test_controls_need_no_spacing_change(self):
        from dfont.spacing import spacing_report
        rows = spacing_report(self.project, self.build, self.master("Regular"), ["l", "dotlessi"], 0)
        for r in rows:
            self.assertLessEqual(abs(r["left_change"]), 6, r)
            self.assertLessEqual(abs(r["right_change"]), 6, r)


class CliTest(unittest.TestCase):
    COMMANDS = ("setup", "new", "build", "proof", "check", "status", "space", "kern", "measure", "charsets")

    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-m", "dfont.cli"] + list(args), cwd=SCRIPTS,
                              capture_output=True, text=True, env=dict(os.environ, PYTHONPATH=SCRIPTS))

    def test_every_command_has_a_complete_help(self):
        top = self.run_cli("--help")
        self.assertEqual(top.returncode, 0)
        for name in self.COMMANDS:
            self.assertIn(name, top.stdout)
            r = self.run_cli(name, "--help")
            self.assertEqual(r.returncode, 0, name)
            for part in ("usage:", "examples:", "exit status:"):
                self.assertIn(part, r.stdout, name)

    def test_bad_project_exits_2_with_a_message(self):
        r = self.run_cli("status", "/nonexistent/project")
        self.assertEqual(r.returncode, 2)
        self.assertIn("font.json", r.stderr)

    def test_new_then_build_then_check(self):
        tmp = tempfile.mkdtemp(prefix="dfont-test-")
        try:
            root = os.path.join(tmp, "starter")
            self.assertEqual(self.run_cli("new", root, "--family", "Starter Sans").returncode, 0)
            self.assertEqual(self.run_cli("build", root, "--formats", "otf,variable").returncode, 0)
            r = self.run_cli("check", root)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue(os.path.exists(os.path.join(root, "qa", "report.md")))
            r = self.run_cli("proof", root)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue(os.path.exists(os.path.join(root, "proof", "control.png")))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
