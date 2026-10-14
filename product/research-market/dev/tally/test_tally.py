"""Tests for scripts/tally.py.

    python3 skills/product/research-market/dev/tally/test_tally.py
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import tally  # noqa: E402


def post(n, author, text, likes=0, replies=0, date=None, from_account=False):
    return {
        "id": "x:%d" % n, "platform": "x", "url": "https://x.com/%s/status/%d" % (author, n), "author": author,
        "date": date or "2026-10-0%dT10:00:00Z" % n, "text": text, "likes": likes, "reposts": 0,
        "replies": replies, "quotes": 0, "from_account": from_account,
    }


POSTS = [
    post(1, "u1", "So tired of this app, top up  pending again. I usually track in a spreadsheet", likes=5, replies=1),
    post(2, "u2", "Top up pending for 3 days, money gone", likes=1),
    post(3, "u1", "I wish there was a budget app that works offline", likes=10),
    post(4, "u3", "Switched from AppA to AppB, no regrets", date="2026-10-01T23:00:00Z"),
    post(5, "Acme", "We are sorry to hear that", likes=99, from_account=True),
]

CODING = """
# post | dimension | theme | sentiment | intensity | segment | exact words
post | dimension | theme | sentiment | intensity | segment | exact words
1 | pain | Top-up stays pending | neg | 3 | students | so tired of; top up pending
1 | behavior | Tracks spending in a spreadsheet | neu | 1 | students | I usually track in a spreadsheet
2 | pain | top-up stays pending | negative | 2 | workers | "money gone"
https://x.com/u1/status/3 | wish | Works offline | pos | 2 | - | I wish there was
4 | alternative | Moved to AppB | + | 1
"""


class TallyTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.posts = self.write("posts.json", {"format": tally.FORMAT, "runs": [], "posts": POSTS})

    def write(self, name, value):
        path = os.path.join(self.dir.name, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(value if isinstance(value, str) else json.dumps(value))
        return path

    def run_tally(self, coding, *extra):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = tally.main([self.posts, self.write("coding.txt", coding)] + list(extra))
        return code, out.getvalue(), err.getvalue()

    def test_counts(self):
        code, out, _ = self.run_tally(CODING)
        self.assertEqual(code, 0, out)
        result = json.loads(out)
        top = result["themes"][0]
        self.assertEqual((top["dimension"], top["theme"]), ("pain", "Top-up stays pending"))  # spelling of first use
        self.assertEqual((top["posts"], top["authors"], top["days"]), (2, 2, 2))
        self.assertEqual((top["first"], top["last"]), ("2026-10-01", "2026-10-02"))
        self.assertEqual((top["likes"], top["replies"], top["engagement"]), (6, 1, 7))
        self.assertEqual(top["intensity"], 2.5)
        self.assertEqual((top["negative"], top["neutral"], top["positive"]), (2, 0, 0))
        self.assertEqual(top["segments"], {"students": 1, "workers": 1})
        self.assertEqual(top["top_posts"][0], {"url": "https://x.com/u1/status/1", "engagement": 6})
        self.assertEqual(len(result["themes"]), 4)
        dims = {d["dimension"]: d for d in result["dimensions"]}
        self.assertEqual((dims["pain"]["posts"], dims["pain"]["themes"], dims["wish"]["posts"]), (2, 1, 1))
        students = result["segments"][0]
        self.assertEqual((students["segment"], students["posts"], len(students["themes"])), ("students", 1, 2))
        words = {w["words"]: w for w in result["words"]}
        self.assertEqual(words["so tired of"]["dimensions"], ["pain"])
        self.assertEqual(words["money gone"]["example"], "https://x.com/u2/status/2")
        self.assertEqual((result["posts_in_file"], result["audience_posts"]), (5, 4))
        self.assertEqual((result["coded_posts"], result["audience_posts_not_coded"]), (4, 0))

    def test_problems_stop_the_count(self):
        coding = "\n".join([
            "9 | pain | A | neg | 2",
            "1 | pains | A | neg | 2",
            "1 | pain | A | sad | 2",
            "1 | pain | A | neg | 5",
            "1 | pain | A | neg | 2 | - | never said this",
            "1 | pain |  | neg | 2",
            "1 | pain | A",
            "2 | pain | B | neg | 2",
            "2 | pain | b | neg | 3",
            "https://x.com/made/status/up | pain | A | neg | 1",
        ])
        code, out, _ = self.run_tally(coding)
        self.assertEqual(code, 1)
        result = json.loads(out)
        self.assertNotIn("themes", result)
        self.assertEqual([p["line"] for p in result["problems"]], [1, 2, 3, 4, 5, 6, 7, 9, 10])
        self.assertIn("not in post 1: never said this", result["problems"][4]["problem"])

    def test_flags_posts_by_the_account(self):
        code, out, _ = self.run_tally("5 | delight | Friendly replies | pos | 1")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["written_by_the_account"], ["https://x.com/Acme/status/5"])

    def test_markdown_tables(self):
        code, out, _ = self.run_tally(CODING, "--markdown")
        self.assertEqual(code, 0)
        self.assertIn("| pain | Top-up stays pending | 2 | 2 | 2 | 2.5 | 2 | 0 | 0 | 7 |", out)
        code, out, _ = self.run_tally(CODING, "--markdown", "segments")
        self.assertIn("| students | pain | Top-up stays pending | 1 | 1 | 6 |", out)
        code, out, _ = self.run_tally(CODING, "--markdown", "words")
        self.assertIn("| I wish there was | 1 | wish | https://x.com/u1/status/3 |", out)
        code, out, _ = self.run_tally(CODING, "--markdown", "dimensions")
        self.assertIn("| pain | 2 | 2 | 1 | 7 |", out)

    def test_bad_input(self):
        code, _, err = self.run_tally("# nothing yet\n")
        self.assertEqual(code, 2)
        self.assertIn("no coding lines", err)
        self.posts = self.write("other.json", {"posts": []})
        code, _, err = self.run_tally(CODING)
        self.assertEqual(code, 2)
        self.assertIn("not written by collect.py", err)


if __name__ == "__main__":
    unittest.main()
