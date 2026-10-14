"""Tests for scripts/list.py.

    python3 skills/product/research-market/dev/list/test_list.py
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import list as lister  # noqa: E402

POSTS = [
    {"id": "x:1", "url": "https://x.com/u1/status/1", "author": "u1", "date": "2026-10-01T10:00:00Z",
     "text": "first\n\nline  two https://t.co/abc", "likes": 2, "reposts": 1, "replies": 0, "quotes": 0,
     "reply_to": None, "source": "query", "goal": "wish", "account": None, "from_account": False},
    {"id": "x:2", "url": "https://x.com/Acme/status/2", "author": "Acme", "date": "2026-10-02T10:00:00Z",
     "text": "official", "likes": 9, "reposts": 0, "replies": 0, "quotes": 0, "reply_to": None,
     "source": "account", "account": "Acme", "from_account": True},
    {"id": "x:3", "url": "https://x.com/u2/status/3", "author": "u2", "date": None, "text": "x" * 400,
     "likes": 0, "reposts": 0, "replies": 4, "quotes": 0, "reply_to": "https://x.com/Acme/status/2",
     "source": "search", "account": "Acme", "from_account": False},
]


class ListTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.posts = os.path.join(self.dir.name, "posts.json")
        with open(self.posts, "w", encoding="utf-8") as handle:
            json.dump({"format": lister.FORMAT, "runs": [], "posts": POSTS}, handle)

    def run_list(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = lister.main([self.posts] + list(args))
        return code, out.getvalue().splitlines(), err.getvalue()

    def test_lists_audience_posts(self):
        code, lines, _ = self.run_list("--width", "40")
        self.assertEqual(code, 0)
        self.assertEqual(lines[0], "1 | 2026-10-01 | @u1 | 3 | wish | first line two <url>")
        self.assertTrue(lines[1].startswith("3 | - | @u2 | 4 | Acme | >xxx"))
        self.assertTrue(lines[1].endswith("…"))
        self.assertEqual(lines[2], "# 2 of 3 posts shown (numbers 1 to 3)")

    def test_filters(self):
        self.assertEqual(len(self.run_list("--all")[1]), 4)
        self.assertEqual(self.run_list("--from", "2", "--to", "9")[1][-1], "# 1 of 3 posts shown (numbers 2 to 3)")
        self.assertTrue(self.run_list("--goal", "ACME")[1][0].startswith("3 |"))
        coding = os.path.join(self.dir.name, "coding.txt")
        with open(coding, "w", encoding="utf-8") as handle:
            handle.write("# header\n1 | wish | Offline | pos | 2\n")
        self.assertTrue(self.run_list("--uncoded", coding)[1][0].startswith("3 |"))

    def test_bad_input(self):
        code, _, err = self.run_list("--uncoded", os.path.join(self.dir.name, "missing.txt"))
        self.assertEqual(code, 2)
        self.assertIn("coding file", err)
        with open(self.posts, "w", encoding="utf-8") as handle:
            handle.write("{}")
        code, _, err = self.run_list()
        self.assertEqual(code, 2)
        self.assertIn("not written by collect.py", err)


if __name__ == "__main__":
    unittest.main()
