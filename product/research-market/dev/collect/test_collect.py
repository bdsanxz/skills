"""Tests for scripts/collect.py. No network: the API is replaced by canned responses.

    python3 skills/product/research-market/dev/collect/test_collect.py
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import collect  # noqa: E402

NOW = datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc)


def stamp(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp()


def x_post(post_id, author, when, text="hello", replies=0, likes=0, reply_to=None, reposted_by=None):
    return {
        "type": "status", "id": str(post_id), "url": "https://x.com/%s/status/%s" % (author, post_id),
        "text": text, "created_timestamp": stamp(when), "likes": likes, "reposts": 0, "replies": replies,
        "quotes": 0, "lang": "en", "reposted_by": reposted_by,
        "author": {"screen_name": author, "name": "Real Name", "description": "bio", "location": "Jakarta"},
        "replying_to": {"screen_name": "Acme", "status": "1", "url": reply_to} if reply_to else None,
    }


def bsky_post(rkey, author, when, text="hello", replies=0):
    return {
        "type": "status", "id": rkey, "at_uri": "at://did:plc:%s/app.bsky.feed.post/%s" % (author.split(".")[0], rkey),
        "url": "https://bsky.app/profile/%s/post/%s" % (author, rkey), "text": text,
        "created_timestamp": stamp(when), "likes": 1, "reposts": 0, "replies": replies, "lang": "en",
        "author": {"screen_name": author}, "replying_to": None, "reposted_by": None,
    }


class FakeClient:
    """Answers `get` from a function (platform, path, params) -> body or None, and records the calls."""

    def __init__(self, answer):
        self.answer = answer
        self.calls = []
        self.errors = []
        self.requests = 0

    def get(self, platform, path, params, what, missing_ok=False):
        self.requests += 1
        params = {k: v for k, v in params.items() if v is not None}
        self.calls.append((platform, path, params))
        body = self.answer(platform, path, params)
        if body is None:
            self.errors.append({"what": what, "status": 500, "message": "server or upstream failure", "url": path})
        return body


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def run(argv, client):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = collect.run(argv, client=client, now=NOW)
    return code, json.loads(out.getvalue())


class ParseTest(unittest.TestCase):
    def test_account_forms(self):
        self.assertEqual(collect.parse_account("x:NotionHQ"), ("x", "NotionHQ"))
        self.assertEqual(collect.parse_account("twitter:@NotionHQ"), ("x", "NotionHQ"))
        self.assertEqual(collect.parse_account("@NotionHQ"), ("x", "NotionHQ"))
        self.assertEqual(collect.parse_account("https://x.com/NotionHQ"), ("x", "NotionHQ"))
        self.assertEqual(collect.parse_account("bsky.app"), ("bluesky", "bsky.app"))
        self.assertEqual(collect.parse_account("bsky:@name.bsky.social"), ("bluesky", "name.bsky.social"))
        self.assertEqual(collect.parse_account("https://bsky.app/profile/bsky.app"), ("bluesky", "bsky.app"))

    def test_account_rejected(self):
        for bad in ("x:has.dot", "bsky:nodot", "x:way_too_long_for_a_handle", ""):
            with self.assertRaises(collect.UsageError):
                collect.parse_account(bad)

    def test_post_refs(self):
        for url in (
            "https://x.com/user/status/2108011878639378578",
            "https://twitter.com/user/status/2108011878639378578?s=20",
            "https://mobile.twitter.com/user/status/2108011878639378578/photo/1",
            "https://fxtwitter.com/user/status/2108011878639378578",
            "2108011878639378578",
        ):
            self.assertEqual(collect.parse_post_ref(url)["id"], "2108011878639378578", url)
            self.assertEqual(collect.parse_post_ref(url)["platform"], "x")
        ref = collect.parse_post_ref("https://bsky.app/profile/bsky.app/post/3mwolmfws5k2r")
        self.assertEqual((ref["platform"], ref["handle"], ref["id"]), ("bluesky", "bsky.app", "3mwolmfws5k2r"))
        ref = collect.parse_post_ref("at://did:plc:abc/app.bsky.feed.post/3mwolmfws5k2r")
        self.assertEqual((ref["handle"], ref["id"]), ("did:plc:abc", "3mwolmfws5k2r"))

    def test_post_ref_rejected(self):
        for bad in ("https://x.com/NotionHQ", "https://example.com/a/status/1", "not a url"):
            with self.assertRaises(collect.UsageError):
                collect.parse_post_ref(bad)

    def test_times(self):
        self.assertEqual(collect.iso(collect.parse_time("2026-10-07")), "2026-10-07T00:00:00Z")
        self.assertEqual(collect.iso(collect.parse_time("2026-10-07", end_of_day=True)), "2026-10-08T00:00:00Z")
        self.assertEqual(collect.iso(collect.parse_time("2026-10-07T12:00:00+07:00")), "2026-10-07T05:00:00Z")
        with self.assertRaises(collect.UsageError):
            collect.parse_time("last week")

    def test_search_strings(self):
        rng = (collect.parse_time("2026-10-01"), collect.parse_time("2026-10-07", end_of_day=True))
        self.assertEqual(
            collect.with_dates(collect.mentions_query("x", "Acme", "bug OR broken"), rng),
            "@Acme -from:Acme (bug OR broken) since:2026-10-01 until:2026-10-09",
        )
        self.assertEqual(collect.mentions_query("bluesky", "acme.test", "billing"), "mentions:acme.test billing")
        self.assertEqual(collect.with_dates("budget app", None), "budget app")
        self.assertEqual(
            collect.without_authors("@Acme -from:Acme", "x", {"acme", "acmebot"}), "@Acme -from:Acme -from:acmebot"
        )
        self.assertEqual(collect.without_authors("mentions:a.test", "bluesky", {"bot"}), "mentions:a.test")

    def test_queries(self):
        self.assertEqual(collect.parse_query(' wish |  "i wish"   budget app '), {"goal": "wish", "query": '"i wish" budget app'})
        self.assertEqual(collect.parse_query("budget app hassle"), {"goal": None, "query": "budget app hassle"})
        with self.assertRaises(collect.UsageError):
            collect.parse_query("wish | ")

    def test_text_options_may_start_with_a_dash(self):
        self.assertEqual(
            collect.join_text_options(["--terms", "-from:Acme", "--query", "-x y", "--max", "5", "--terms"]),
            ["--terms=-from:Acme", "--query=-x y", "--max", "5", "--terms"],
        )

    def test_masks_numbers_and_emails_only(self):
        tally = {"numbers": 0, "emails": 0}
        text = ("call 0817 0123442 or +62-812-3456-7890, acct 1234567890123, mail me@example.co.id, paid Rp 1.250.000 "
                "and 217.856 on 2026-10-08, see https://x.com/a/status/2108011878639378578 ref 12345678")
        masked = collect.mask_private(text, tally)
        self.assertEqual(
            masked,
            "call [number] or [number], acct [number], mail [email], paid Rp 1.250.000 "
            "and 217.856 on 2026-10-08, see https://x.com/a/status/2108011878639378578 ref 12345678",
        )
        self.assertEqual(tally, {"numbers": 3, "emails": 1})


class NormalizeTest(unittest.TestCase):
    def test_keeps_only_the_handle_of_the_author(self):
        raw = x_post(5, "someone", "2026-10-07 10:00", text="it broke", likes=3, reply_to="https://x.com/Acme/status/1")
        post = collect.Collector(None, [], 10, own_handles={"Acme"}).normalize(raw, "x", "search", account="Acme")
        self.assertEqual(post["author"], "someone")
        self.assertEqual(post["date"], "2026-10-07T10:00:00Z")
        self.assertEqual((post["likes"], post["reposts"], post["replies"], post["quotes"]), (3, 0, 0, 0))
        self.assertEqual(post["reply_to"], "https://x.com/Acme/status/1")
        self.assertFalse(post["from_account"])
        dumped = json.dumps(post)
        for private in ("Real Name", "bio", "Jakarta"):
            self.assertNotIn(private, dumped)

    def test_skips_what_is_not_a_post(self):
        collector = collect.Collector(None, [], 10)
        self.assertIsNone(collector.normalize({"type": "tombstone", "reason": "deleted"}, "x", "thread"))
        self.assertIsNone(collector.normalize(None, "x", "thread"))


class AccountTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.out = os.path.join(self.dir.name, "posts.json")

    def test_search_pages_filter_and_stop_at_max(self):
        pages = {
            None: {
                "results": [
                    x_post(10, "u1", "2026-10-08 09:00"),
                    x_post(11, "Acme", "2026-10-08 08:00"),  # the account itself
                    x_post(12, "u2", "2026-10-08 07:00", reposted_by={"screen_name": "u9"}),
                    x_post(13, "u3", "2026-09-01 07:00"),  # before the range
                ],
                "cursor": {"top": "t", "bottom": "c1"},
            },
            "c1": {"results": [x_post(20 + i, "u%d" % i, "2026-10-07 0%d:00" % i) for i in range(5)],
                   "cursor": {"top": "t", "bottom": "c2"}},
        }
        client = FakeClient(lambda platform, path, params: pages[params.get("cursor")])
        code, summary = run(["--out", self.out, "--account", "x:Acme", "--days", "3", "--max", "4", "--source", "search"], client)
        self.assertEqual(code, 0)
        self.assertEqual(summary["added"], 4)
        self.assertEqual(summary["skipped"]["by_account_or_repost"], 2)
        self.assertEqual(summary["skipped"]["outside_time_range"], 1)
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(client.calls[0][2]["q"], "@Acme -from:Acme since:2026-10-05 until:2026-10-09")
        self.assertTrue(any("--max 4" in note for note in summary["notes"]))
        doc = read_json(self.out)
        self.assertEqual([p["id"] for p in doc["posts"]], ["x:10", "x:20", "x:21", "x:22"])
        self.assertEqual(doc["runs"][0]["accounts"], ["x:Acme"])

    def test_search_stops_when_a_page_is_older_than_the_range(self):
        def answer(platform, path, params):
            return {"results": [x_post(1, "u1", "2026-09-01 07:00")], "cursor": {"bottom": "more"}}

        client = FakeClient(answer)
        code, summary = run(["--out", self.out, "--account", "x:Acme", "--source", "search"], client)
        self.assertEqual(code, 1)
        self.assertEqual(len(client.calls), 1)
        self.assertFalse(os.path.exists(self.out))

    def test_failed_search_falls_back_to_replies_in_turn(self):
        first = bsky_post("aaa", "acme.test", "2026-10-06 10:00", replies=50)
        second = bsky_post("bbb", "acme.test", "2026-10-07 10:00", replies=3)
        silent = bsky_post("ccc", "acme.test", "2026-10-07 11:00", replies=0)
        reposted = dict(bsky_post("ddd", "other.test", "2026-10-07 12:00", replies=9), reposted_by={"screen_name": "acme.test"})

        def answer(platform, path, params):
            if path == "/2/search":
                return None
            if path.endswith("/statuses"):
                return {"results": [second, silent, reposted, first], "cursor": {"top": None, "bottom": None}}
            rkey = path.rsplit("/", 1)[1]
            page = params.get("cursor", "p0")
            replies = [bsky_post("%s%s%d" % (rkey, page, i), "fan%d.test" % i, "2026-10-07 13:00") for i in range(2)]
            following = {"p0": "p1", "p1": None}[page] if rkey == "aaa" else None
            return {"status": {}, "thread": [], "replies": replies, "cursor": {"bottom": following}}

        client = FakeClient(answer)
        code, summary = run(["--out", self.out, "--account", "bsky:acme.test", "--max", "50"], client)
        self.assertEqual(code, 0)
        self.assertEqual(summary["added_by_source"], {"account": 2, "reply": 6})
        self.assertEqual(len(summary["could_not_fetch"]), 1)
        self.assertIn("Search failed", summary["notes"][0])
        conversations = [path for _, path, _ in client.calls if "/conversation/" in path]
        self.assertEqual(  # most replied-to first, then one page each in turn
            conversations,
            ["/2/conversation/acme.test/aaa", "/2/conversation/acme.test/bbb", "/2/conversation/acme.test/aaa"],
        )
        doc = read_json(self.out)
        own = [p for p in doc["posts"] if p["from_account"]]
        self.assertEqual(sorted(p["source"] for p in own), ["account", "account"])

    def test_terms_keep_auto_to_the_search(self):
        def answer(platform, path, params):
            return {"results": [x_post(1, "u1", "2026-10-08 07:00")], "cursor": {"bottom": None}}

        client = FakeClient(answer)
        code, summary = run(["--out", self.out, "--account", "x:Acme", "--terms", "billing"], client)
        self.assertEqual(code, 0)
        self.assertEqual([path for _, path, _ in client.calls], ["/2/search"])
        self.assertIn("@Acme -from:Acme (billing) since:", client.calls[0][2]["q"])
        self.assertTrue(any("--source replies" in note for note in summary["notes"]))

    def test_second_run_adds_to_the_file_without_duplicates(self):
        def answer(platform, path, params):
            return {"results": [x_post(1, "u1", "2026-10-08 07:00"), x_post(2, "u2", "2026-10-08 06:00")], "cursor": {}}

        run(["--out", self.out, "--account", "x:Acme", "--source", "search"], FakeClient(answer))
        code, summary = run(["--out", self.out, "--account", "x:Acme", "--source", "search"], FakeClient(answer))
        self.assertEqual(code, 0)
        self.assertEqual((summary["added"], summary["total_in_file"], summary["skipped"]["duplicate"]), (0, 2, 2))
        doc = read_json(self.out)
        self.assertEqual((len(doc["posts"]), len(doc["runs"])), (2, 2))
        with open(self.out, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        self.assertEqual(sum(1 for line in lines if line.startswith('  {"id"')), 2)  # one post per line


class QueryTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.out = os.path.join(self.dir.name, "posts.json")

    def test_queries_tag_posts_and_report_per_query(self):
        def answer(platform, path, params):
            if '"i wish"' in params["q"]:
                results = [x_post(50 + i, "u%d" % i, "2026-10-0%d 07:00" % (i + 1)) for i in range(5)]
                results[1] = x_post(51, "BrandBot", "2026-10-02 07:00")
                return {"results": results, "cursor": {"bottom": None}}
            if "hassle" in params["q"]:
                return {"results": [x_post(50, "u0", "2026-10-01 07:00"), x_post(60, "u9", "2026-10-03 07:00", text="call 081234567890")],
                        "cursor": {"bottom": None}}
            return None

        queries = os.path.join(self.dir.name, "queries.txt")
        with open(queries, "w", encoding="utf-8") as handle:
            handle.write('# library\nwish | "i wish" budget app\n\npain | budget app hassle\nobjection | budget app scam\n')
        client = FakeClient(answer)
        code, summary = run(
            ["--out", self.out, "--queries-file", queries, "--per-query", "3", "--feed", "top",
             "--exclude-from", "@BrandBot", "--since", "2026-10-01", "--until", "2026-10-07"], client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls[0][2]["q"], '"i wish" budget app -from:brandbot since:2026-10-01 until:2026-10-09')
        self.assertEqual(client.calls[0][2]["feed"], "top")
        self.assertEqual([(q["goal"], q["added"], q["failed"]) for q in summary["by_query"]],
                         [("wish", 3, False), ("pain", 1, False), ("objection", 0, True)])
        self.assertEqual(summary["skipped"]["excluded_author"], 1)
        self.assertEqual(summary["skipped"]["duplicate"], 1)
        self.assertEqual(summary["masked"], {"numbers": 1, "emails": 0})
        self.assertEqual(len(summary["could_not_fetch"]), 1)
        doc = read_json(self.out)
        self.assertEqual([(p["id"], p["goal"]) for p in doc["posts"]], [("x:50", "wish"), ("x:52", "wish"), ("x:53", "wish"), ("x:60", "pain")])
        self.assertEqual(doc["posts"][0]["query"], '"i wish" budget app')
        self.assertEqual(doc["posts"][3]["text"], "call [number]")
        self.assertEqual(doc["runs"][0]["by_query"][0]["query"], '"i wish" budget app')

    def test_keep_numbers_and_dash_terms(self):
        def answer(platform, path, params):
            return {"results": [x_post(70, "u1", "2026-10-08 07:00", text="call 081234567890")], "cursor": {}}

        client = FakeClient(answer)
        code, summary = run(["--out", self.out, "--account", "x:Acme", "--terms", "-from:AcmeNews", "--keep-numbers", "--source", "search"], client)
        self.assertEqual(code, 0)
        self.assertIn("(-from:AcmeNews)", client.calls[0][2]["q"])
        self.assertEqual(read_json(self.out)["posts"][0]["text"], "call 081234567890")

    def test_query_too_long(self):
        with self.assertRaises(collect.UsageError):
            collect.run(["--out", self.out, "--query", "word " * 120], client=FakeClient(lambda *a: {}), now=NOW)


class ListedTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.out = os.path.join(self.dir.name, "posts.json")

    def test_listed_post_with_thread_and_replies(self):
        parent = x_post(41, "Acme", "2026-10-01 10:00", replies=2)
        listed = x_post(42, "u1", "2026-10-01 11:00", reply_to=parent["url"])

        def answer(platform, path, params):
            if path == "/2/conversation/42" and "cursor" not in params:
                return {"code": 200, "status": listed, "thread": [parent, listed, {"type": "tombstone"}],
                        "replies": [x_post(43, "u2", "2026-10-01 12:00")], "cursor": {"bottom": "n"}}
            if path == "/2/conversation/42":
                return {"code": 200, "status": listed, "thread": [], "replies": [], "cursor": {"bottom": "n2"}}
            return None

        client = FakeClient(answer)
        code, summary = run(["--out", self.out, "--post", listed["url"], "--post", "42", "--post", "999", "--replies"], client)
        self.assertEqual(code, 0)
        self.assertEqual(summary["added_by_source"], {"listed": 1, "thread": 1, "reply": 1})
        self.assertEqual(summary["scope"]["listed_posts"], 2)  # the same post given twice is fetched once
        self.assertEqual([e["what"] for e in summary["could_not_fetch"]], ["post 999"])
        self.assertEqual([path for _, path, _ in client.calls].count("/2/conversation/42"), 2)

    def test_listed_post_without_replies_uses_the_thread(self):
        post = bsky_post("3abc", "u1.test", "2026-10-01 11:00")
        client = FakeClient(lambda platform, path, params: {"code": 200, "status": post, "thread": [post]})
        code, summary = run(["--out", self.out, "--post", post["url"]], client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls, [("bluesky", "/2/thread/u1.test/3abc", {})])
        self.assertEqual(summary["added_by_source"], {"listed": 1})

    def test_missing_post_is_reported(self):
        client = FakeClient(lambda platform, path, params: {"code": 404, "status": None, "thread": None})
        code, summary = run(["--out", self.out, "--post", "123456"], client)
        self.assertEqual(code, 1)
        self.assertIsNone(summary["out"])
        self.assertEqual(summary["could_not_fetch"][0]["what"], "post 123456")


class UsageTest(unittest.TestCase):
    def check(self, argv):
        with self.assertRaises(collect.UsageError):
            collect.run(argv, client=FakeClient(lambda *a: {}), now=NOW)

    def test_usage_errors(self):
        self.check(["--out", "x.json"])
        self.check(["--out", "x.json", "--account", "x:Acme", "--max", "0"])
        self.check(["--out", "x.json", "--account", "x:Acme", "--days", "2", "--since", "2026-10-01"])
        self.check(["--out", "x.json", "--account", "x:Acme", "--since", "2026-10-07", "--until", "2026-10-01"])
        self.check(["--out", "x.json", "--account", "x:Acme", "--replies"])
        self.check(["--out", "x.json", "--query", "a", "--per-query", "0"])

    def test_refuses_a_foreign_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "other.json")
            with open(path, "w") as handle:
                handle.write('{"something": "else"}')
            self.check(["--out", path, "--account", "x:Acme"])

    def test_main_reports_usage_errors_with_exit_code_2(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(collect.main(["--out", "x.json"]), 2)
        self.assertIn("nothing to collect", err.getvalue())

    def test_dry_makes_no_request(self):
        client = FakeClient(lambda *a: self.fail("request made"))
        code, plan = run(["--out", "x.json", "--account", "x:Acme", "--dry"], client)
        self.assertEqual(code, 0)
        self.assertTrue(plan["dry"])
        self.assertFalse(os.path.exists("x.json"))


class Response:
    def __init__(self, status, body):
        self.status, self._body = status, body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(status, body=b"", headers=None):
    return urllib.error.HTTPError("https://api", status, "error", headers or {}, io.BytesIO(body))


class ClientTest(unittest.TestCase):
    def client(self, outcomes):
        self.waits = []
        outcomes = iter(outcomes)

        def opener(request, timeout):
            self.assertEqual(request.get_header("User-agent"), collect.USER_AGENT)
            outcome = next(outcomes)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        return collect.Client(opener=opener, sleep=self.waits.append, clock=lambda: 0.0)

    def test_retries_then_succeeds(self):
        client = self.client([http_error(429, headers={"Retry-After": "30"}), http_error(503), Response(200, b'{"code":200}')])
        self.assertEqual(client.get("x", "/2/search", {"q": "a b", "cursor": None}, "search"), {"code": 200})
        self.assertEqual(client.errors, [])
        self.assertIn(30, self.waits)
        self.assertEqual(client.requests, 3)

    def test_gives_up_and_records_the_failure(self):
        client = self.client([http_error(500, b'{"code":500}')] * 3)
        self.assertIsNone(client.get("bluesky", "/2/search", {"q": "mentions:a.test"}, "search for a.test"))
        self.assertEqual(client.requests, 3)
        error = client.errors[0]
        self.assertEqual((error["what"], error["status"], error["message"]), ("search for a.test", 500, "server or upstream failure"))
        self.assertEqual(urllib.parse.urlparse(error["url"]).netloc, "api.fxbsky.app")

    def test_does_not_retry_a_missing_post(self):
        client = self.client([http_error(404, b'{"code":404,"status":null}')])
        self.assertIsNone(client.get("x", "/2/status/1", {}, "post 1"))
        self.assertEqual(client.requests, 1)
        self.assertIn("not found", client.errors[0]["message"])

    def test_missing_ok_and_api_message(self):
        client = self.client([http_error(404, b'{"code":404,"results":[]}'), http_error(400, b'{"code":400,"message":"q: required"}')])
        self.assertEqual(client.get("x", "/2/search", {"q": "a"}, "search", missing_ok=True), {})
        self.assertIsNone(client.get("x", "/2/search", {"q": ""}, "search"))
        self.assertEqual(client.errors[0]["message"], "q: required")

    def test_network_failure_and_bad_body(self):
        client = self.client([urllib.error.URLError("timed out")] * 3 + [Response(200, b"<html>")] )
        self.assertIsNone(client.get("x", "/2/status/1", {}, "post 1"))
        self.assertIn("network error", client.errors[0]["message"])
        self.assertIsNone(client.get("x", "/2/status/1", {}, "post 1"))
        self.assertIn("not JSON", client.errors[1]["message"])


if __name__ == "__main__":
    unittest.main()
