#!/usr/bin/env python3
"""Collect public posts from X/Twitter or Bluesky into one JSON file, for market research.

Data comes from the FxEmbed API (https://docs.fxembed.com/api/introduction/):
FxTwitter at api.fxtwitter.com and FxBluesky at api.fxbsky.app. Standard library only.

    collect.py --out posts.json --queries-file queries.txt --since 2026-04-01 --max 300
    collect.py --out posts.json --query 'wish | "I wish there was" budgeting app lang:en' --feed top
    collect.py --out posts.json --account x:SomeBrandHelp --days 14 --max 100 --exclude-from SomeBrand
    collect.py --out posts.json --post https://x.com/user/status/123 --replies

Running it again with the same --out adds to the file; posts already there are skipped.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime, timedelta, timezone

FORMAT = "research-market/posts@1"
HOSTS = {"x": "https://api.fxtwitter.com", "bluesky": "https://api.fxbsky.app"}
USER_AGENT = "research-market-skill/1.0"
PAGE_SIZE = 100
MIN_INTERVAL = 0.25  # seconds between requests; the API allows 1000 per minute per IP
RETRY_WAITS = (2, 6)  # seconds to wait before the second and third attempt
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_AFTER = 60
MAX_SEARCH_PAGES = 30
MAX_TIMELINE_PAGES = 10
MAX_REPLY_PAGES = 10  # per parent post
MAX_QUERY_LENGTH = 512  # limit of the search endpoint
DEFAULT_DAYS = 7
DEFAULT_MAX = 100
DEFAULT_PER_QUERY = 25

X_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
BSKY_HANDLE = re.compile(r"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
X_HOSTS = r"(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com"
X_POST_URL = re.compile(
    r"^https?://(?:www\.|mobile\.)?" + X_HOSTS + r"/(?:[^/]+|i/web)/status(?:es)?/(\d{2,20})(?:[/?#].*)?$", re.I
)
X_PROFILE_URL = re.compile(r"^https?://(?:www\.|mobile\.)?" + X_HOSTS + r"/([A-Za-z0-9_]{1,15})/?(?:[?#].*)?$", re.I)
BSKY_POST_URL = re.compile(
    r"^https?://(?:www\.)?(?:bsky\.app|fxbsky\.app)/profile/([^/]+)/post/([A-Za-z0-9]+)(?:[/?#].*)?$", re.I
)
BSKY_PROFILE_URL = re.compile(r"^https?://(?:www\.)?(?:bsky\.app|fxbsky\.app)/profile/([^/?#]+)/?(?:[?#].*)?$", re.I)
AT_URI = re.compile(r"^at://([^/]+)/app\.bsky\.feed\.post/([A-Za-z0-9]+)$")
PLATFORM_NAMES = {"x": "x", "twitter": "x", "bsky": "bluesky", "bluesky": "bluesky"}

URL_IN_TEXT = re.compile(r"https?://\S+")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
NUMBER_RUN = re.compile(r"\+?\d(?:[ .\-]?\d){8,}")  # nine or more digits, single separators allowed
AMOUNT = re.compile(r"^\d{1,3}(?:[.,]\d{3})+$")  # 1.250.000 or 1,250,000 is an amount, not an identifier


class UsageError(Exception):
    """A problem with the arguments, reported to the caller with exit code 2."""


# ---------------------------------------------------------------- arguments


def parse_account(text):
    """Return (platform, handle) for `x:Name`, `bsky:name.tld`, `@Name`, a bare handle or a profile URL."""
    value = text.strip()
    match = X_PROFILE_URL.match(value)
    if match:
        return "x", match.group(1)
    match = BSKY_PROFILE_URL.match(value)
    if match:
        value = "bsky:" + match.group(1)
    platform = None
    prefix, sep, rest = value.partition(":")
    if sep and prefix.lower() in PLATFORM_NAMES:
        platform, value = PLATFORM_NAMES[prefix.lower()], rest
    handle = value.strip().lstrip("@")
    if platform is None:
        platform = "bluesky" if "." in handle else "x"
    if platform == "x" and not X_HANDLE.match(handle):
        raise UsageError(
            "--account %r: not an X/Twitter handle (letters, digits and _, at most 15). "
            "Use x:<handle> or bsky:<handle>." % text
        )
    if platform == "bluesky" and not BSKY_HANDLE.match(handle):
        raise UsageError(
            "--account %r: not a Bluesky handle. Use the full handle, for example bsky:name.bsky.social." % text
        )
    return platform, handle


def parse_post_ref(text):
    """Return {platform, handle, id} for a post URL, an at:// URI or a bare X post ID."""
    value = text.strip()
    match = X_POST_URL.match(value)
    if match:
        return {"platform": "x", "handle": None, "id": match.group(1)}
    if re.match(r"^\d{2,20}$", value):
        return {"platform": "x", "handle": None, "id": value}
    match = BSKY_POST_URL.match(value) or AT_URI.match(value)
    if match:
        return {"platform": "bluesky", "handle": match.group(1), "id": match.group(2)}
    raise UsageError(
        "post %r: not recognized. Give an X/Twitter post URL or numeric ID, "
        "a bsky.app post URL, or an at:// post URI." % text
    )


def parse_query(text):
    """Return {goal, query} for a line `goal | search text`, or a search text alone."""
    goal, sep, query = text.partition("|")
    if not sep:
        goal, query = "", text
    goal, query = goal.strip(), " ".join(query.split())
    if not query:
        raise UsageError("query %r: the search text is empty." % text)
    return {"goal": goal or None, "query": query}


def parse_time(text, end_of_day=False):
    """Parse YYYY-MM-DD or an ISO 8601 date-time into a UTC datetime.

    A plain date means the start of that day in UTC, or the start of the next day when
    `end_of_day` is set, so that `--until 2026-10-07` includes the whole of 7 October.
    """
    value = text.strip()
    try:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
            day = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            return day + timedelta(days=1) if end_of_day else day
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise UsageError("time %r: use YYYY-MM-DD or an ISO 8601 date-time such as 2026-10-07T12:00:00Z." % text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def resolve_range(args, now):
    """Return (since, until) as UTC datetimes, or None when no time range was given."""
    if args.days is not None and args.since:
        raise UsageError("give --days or --since, not both.")
    if args.days is None and not args.since and not args.until:
        return None
    until = parse_time(args.until, end_of_day=True) if args.until else now
    if args.since:
        since = parse_time(args.since)
    else:
        since = until - timedelta(days=args.days if args.days is not None else DEFAULT_DAYS)
    if since >= until:
        raise UsageError("the time range is empty: it starts %s and ends %s." % (iso(since), iso(until)))
    return since, until


def iso(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- HTTP


class Client:
    """GET JSON from the FxEmbed API, pacing requests, retrying, and recording what failed."""

    def __init__(self, opener=None, sleep=time.sleep, clock=time.monotonic):
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep
        self._clock = clock
        self._last = None
        self.errors = []
        self.requests = 0

    def get(self, platform, path, params, what, missing_ok=False):
        """Return the response body as a dict, or None after recording an error.

        With `missing_ok`, a 404 is returned as an empty dict: for list endpoints it only
        means that nothing matched.
        """
        url = HOSTS[platform] + path
        query = {k: v for k, v in params.items() if v is not None}
        if query:
            url += "?" + urllib.parse.urlencode(query)
        status, message = None, "no response"
        for attempt in range(len(RETRY_WAITS) + 1):
            status, body, message, retry_after = self._request(url)
            if status == 200 and isinstance(body, dict):
                return body
            if status == 204 or (status == 404 and missing_ok):
                return {}
            if status is not None and status not in RETRY_STATUSES:
                break
            if attempt < len(RETRY_WAITS):
                wait = RETRY_WAITS[attempt]
                if retry_after is not None:
                    wait = max(wait, min(retry_after, MAX_RETRY_AFTER))
                self._sleep(wait)
        self.errors.append({"what": what, "status": status, "message": message, "url": url})
        return None

    def _request(self, url):
        """Return (status, body, message, retry_after) for one attempt; status is None on a network failure."""
        if self._last is not None:
            pause = MIN_INTERVAL - (self._clock() - self._last)
            if pause > 0:
                self._sleep(pause)
        self.requests += 1
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        retry_after = None
        try:
            with self._open(request, timeout=30) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
            header = error.headers.get("Retry-After") if error.headers else None
            if header and header.strip().isdigit():
                retry_after = int(header.strip())
        except (urllib.error.URLError, OSError) as error:
            return None, None, "network error: %s" % getattr(error, "reason", error), None
        finally:
            self._last = self._clock()
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except (ValueError, UnicodeDecodeError):
            return status, None, "HTTP %s with a body that is not JSON" % status, retry_after
        return status, body, describe(status, body), retry_after


def describe(status, body):
    """A short reason for a failed response, for the error list the agent reports to the user."""
    if isinstance(body, dict) and body.get("message"):
        return str(body["message"])
    return {
        400: "the API rejected the request",
        401: "private or unavailable",
        404: "not found (deleted, private, or a wrong URL or handle)",
        429: "rate limited",
    }.get(status, "server or upstream failure" if status and status >= 500 else "HTTP %s" % status)


# ---------------------------------------------------------------- posts


def post_key(raw, platform):
    if platform == "x":
        return "x:%s" % raw.get("id")
    return "bsky:%s" % (raw.get("at_uri") or str(raw.get("url", "")).lower())


def post_time(raw):
    """The post's creation time as a UTC datetime, or None when the API gave none."""
    stamp = raw.get("created_timestamp")
    if isinstance(stamp, (int, float)) and stamp > 0:
        if stamp >= 1e12:
            stamp /= 1000.0
        return datetime.fromtimestamp(stamp, tz=timezone.utc)
    return None


def count(raw, field):
    value = raw.get(field)
    return int(value) if isinstance(value, (int, float)) else 0


def author_of(raw):
    return str((raw.get("author") or {}).get("screen_name") or "")


def mask_private(text, tally):
    """Replace phone, account and ticket numbers and email addresses with a placeholder.

    Links, amounts written with thousands separators and dates are left as they are.
    `tally` counts what was replaced.
    """

    def number(match):
        found = match.group(0)
        if AMOUNT.match(found):
            return found
        tally["numbers"] += 1
        return "[number]"

    def email(match):
        tally["emails"] += 1
        return "[email]"

    parts, last = [], 0
    for link in URL_IN_TEXT.finditer(text):
        parts.append(NUMBER_RUN.sub(number, EMAIL.sub(email, text[last:link.start()])))
        parts.append(link.group(0))
        last = link.end()
    parts.append(NUMBER_RUN.sub(number, EMAIL.sub(email, text[last:])))
    return "".join(parts)


def in_range(moment, time_range):
    if time_range is None:
        return True
    return moment is not None and time_range[0] <= moment < time_range[1]


def with_dates(query, time_range):
    """Add date operators. They only narrow the search; the exact range is applied to the results."""
    if not time_range:
        return query
    since_day = time_range[0].strftime("%Y-%m-%d")
    until_day = (time_range[1] + timedelta(days=1)).strftime("%Y-%m-%d")
    return "%s since:%s until:%s" % (query, since_day, until_day)


def mentions_query(platform, handle, terms):
    """The search for posts written to an account."""
    if platform == "x":
        query = "@%s -from:%s" % (handle, handle)
        # X reads `a OR b` across the whole query unless the terms are grouped.
        return query + (" (%s)" % terms.strip() if terms else "")
    return "mentions:%s" % handle + (" " + terms.strip() if terms else "")


def without_authors(query, platform, excluded):
    """Add `-from:` for each excluded author while the query stays within the length limit. X only."""
    if platform != "x":
        return query
    for handle in sorted(excluded):
        operator = " -from:%s" % handle
        if operator.strip().lower() not in query.lower() and len(query) + len(operator) <= MAX_QUERY_LENGTH - 40:
            query += operator
    return query


def conversation_path(ref):
    if ref["platform"] == "x":
        return "/2/conversation/%s" % ref["id"]
    return "/2/conversation/%s/%s" % (urllib.parse.quote(ref["handle"], safe=":"), ref["id"])


def thread_path(ref):
    return conversation_path(ref).replace("/2/conversation/", "/2/thread/", 1)


def ref_of(raw, platform):
    """A post reference for a status the API returned, or None when its URL cannot be parsed."""
    try:
        ref = parse_post_ref(str(raw.get("url", "")))
    except UsageError:
        return None
    ref["url"] = raw["url"]
    return ref if ref["platform"] == platform else None


# ---------------------------------------------------------------- collection


class Collector:
    """One run: the posts of the file, how many more may be added, and the rules for what is kept."""

    def __init__(self, client, posts, limit, own_handles=(), excluded=(), mask=True):
        self.client = client
        self.posts = {post["id"]: post for post in posts}
        self.left = limit
        self.own = {handle.lower() for handle in own_handles}
        self.excluded = {handle.lower() for handle in excluded}
        self.mask = mask
        self.added = {}
        self.skipped = {"duplicate": 0, "outside_time_range": 0, "by_account_or_repost": 0, "excluded_author": 0}
        self.masked = {"numbers": 0, "emails": 0}
        self.notes = []

    def normalize(self, raw, platform, source, account=None, goal=None, query=None):
        """Reduce an API status to the fields this skill keeps. Returns None for anything that is not a post.

        Of the author only the public handle is kept: no name, bio, location or avatar.
        """
        if not isinstance(raw, dict) or raw.get("type") != "status" or not raw.get("url"):
            return None
        author = author_of(raw)
        moment = post_time(raw)
        return {
            "id": post_key(raw, platform),
            "platform": platform,
            "url": raw["url"],
            "author": author,
            "date": iso(moment) if moment else None,
            "text": raw.get("text") or "",
            "likes": count(raw, "likes"),
            "reposts": count(raw, "reposts"),
            "replies": count(raw, "replies"),
            "quotes": count(raw, "quotes"),
            "lang": raw.get("lang"),
            "reply_to": (raw.get("replying_to") or {}).get("url"),
            "source": source,
            "account": account,
            "goal": goal,
            "query": query,
            "from_account": author.lower() in self.own,
        }

    def _store(self, post):
        if post["id"] in self.posts:
            self.skipped["duplicate"] += 1
            return False
        if self.mask:
            post["text"] = mask_private(post["text"], self.masked)
        self.posts[post["id"]] = post
        self.added[post["source"]] = self.added.get(post["source"], 0) + 1
        return True

    def add_incoming(self, raw, platform, source, time_range, **tags):
        """Add one post written by the audience, if it is in range, allowed and new. Counts against --max."""
        if self.left <= 0:
            return False
        post = self.normalize(raw, platform, source, **tags)
        if post is None:
            return False
        if post["from_account"] or raw.get("reposted_by"):
            self.skipped["by_account_or_repost"] += 1
            return False
        if post["author"].lower() in self.excluded:
            self.skipped["excluded_author"] += 1
            return False
        if not in_range(post_time(raw), time_range):
            self.skipped["outside_time_range"] += 1
            return False
        if not self._store(post):
            return False
        self.left -= 1
        return True

    def add_context(self, raw, platform, source, **tags):
        """Add a post kept for context (an account's own post, a listed post, its thread). Not counted against --max."""
        post = self.normalize(raw, platform, source, **tags)
        return post is not None and self._store(post)

    def search(self, platform, text, feed, time_range, cap, what, source, **tags):
        """Page through one search. Returns {ok, added, seen, pages}; `ok` is False when it could not be run."""
        result = {"ok": True, "added": 0, "seen": 0, "pages": 0}
        cursor = None
        for _ in range(MAX_SEARCH_PAGES):
            if self.left <= 0 or result["added"] >= cap:
                break
            params = {"q": text, "feed": feed, "count": PAGE_SIZE, "cursor": cursor}
            data = self.client.get(platform, "/2/search", params, what, missing_ok=True)
            if data is None:
                result["ok"] = False
                break
            results = [r for r in data.get("results") or [] if isinstance(r, dict)]
            if not results:
                break
            result["pages"] += 1
            result["seen"] += len(results)
            for raw in results:
                if result["added"] >= cap:
                    break
                if self.add_incoming(raw, platform, source, time_range, **tags):
                    result["added"] += 1
            times = [post_time(r) for r in results]
            if feed == "latest" and time_range and all(t is not None and t < time_range[0] for t in times):
                break  # newest first: everything further back is older than the range
            following = (data.get("cursor") or {}).get("bottom")
            if not following or following == cursor:
                break
            cursor = following
        return result

    def account_posts(self, platform, handle, time_range):
        """The account's own posts published in the time range, most replied-to first."""
        what = "timeline of @%s on %s" % (handle, platform)
        path = "/2/profile/%s/statuses" % urllib.parse.quote(handle, safe="")
        found, cursor = {}, None
        for _ in range(MAX_TIMELINE_PAGES):
            data = self.client.get(platform, path, {"count": PAGE_SIZE, "cursor": cursor}, what)
            if data is None:
                break
            results = [r for r in data.get("results") or [] if isinstance(r, dict) and r.get("type") == "status"]
            if not results:
                break
            own = [r for r in results if author_of(r).lower() == handle.lower() and not r.get("reposted_by")]
            for raw in own:
                if in_range(post_time(raw), time_range):
                    found[post_key(raw, platform)] = raw
            times = [post_time(r) for r in own]
            if own and all(t is not None and t < time_range[0] for t in times):
                break
            following = (data.get("cursor") or {}).get("bottom")
            if not following or following == cursor:
                break
            cursor = following
        return sorted(found.values(), key=lambda r: count(r, "replies"), reverse=True)

    def replies(self, queue, time_range):
        """Fetch replies one page per parent post in turn, so that one busy post does not use the whole budget.

        `queue` holds (ref, account, cursor, pages) entries; the first page of a parent has cursor None.
        """
        while queue and self.left > 0:
            ref, account, cursor, pages = queue.popleft()
            what = "replies to %s" % ref["url"]
            params = {"ranking_mode": "likes", "cursor": cursor}
            data = self.client.get(ref["platform"], conversation_path(ref), params, what)
            if data is None:
                continue
            replies = [r for r in data.get("replies") or [] if isinstance(r, dict)]
            for raw in replies:
                self.add_incoming(raw, ref["platform"], "reply", time_range, account=account)
            following = (data.get("cursor") or {}).get("bottom")
            if replies and following and following != cursor and pages + 1 < MAX_REPLY_PAGES:
                queue.append((ref, account, following, pages + 1))

    def account(self, platform, handle, time_range, source, terms, feed):
        """Posts written to an account: a search for its mentions, then replies under its own posts."""
        searched = True
        if source in ("auto", "search"):
            query = with_dates(without_authors(mentions_query(platform, handle, terms), platform, self.excluded), time_range)
            what = "search for posts mentioning @%s on %s" % (handle, platform)
            searched = self.search(platform, query, feed, time_range, self.left, what, "search", account=handle)["ok"]
            if not searched and source == "auto":
                self.notes.append(
                    "Search failed for @%s on %s; collected replies to its own posts instead. "
                    "Posts that only mention the account are missing." % (handle, platform)
                )
        if source == "search" or self.left <= 0:
            return
        if source == "auto" and terms and searched:
            self.notes.append(
                "--terms narrows the search only, so replies under @%s's own posts were not collected. "
                "Run again with --source replies to add them." % handle
            )
            return
        queue = deque()
        for raw in self.account_posts(platform, handle, time_range):
            ref = ref_of(raw, platform)
            if ref is None or count(raw, "replies") == 0:
                continue
            self.add_context(raw, platform, "account", account=handle)
            queue.append((ref, handle, None, 0))
        self.replies(queue, time_range)

    def queries(self, platform, queries, feed, time_range, per_query):
        """Run each topic search and report what it brought in, so that useful queries can be kept."""
        report = []
        for item in queries:
            if self.left <= 0:
                break
            query = with_dates(without_authors(item["query"], platform, self.excluded), time_range)
            what = "search %r on %s" % (item["query"], platform)
            found = self.search(
                platform, query, feed, time_range, per_query, what, "query", goal=item["goal"], query=item["query"]
            )
            report.append({
                "goal": item["goal"], "query": item["query"], "feed": feed, "added": found["added"],
                "seen": found["seen"], "pages": found["pages"], "failed": not found["ok"],
            })
        return report

    def listed(self, refs, time_range, with_replies):
        """Fetch each listed post with the thread it belongs to and, on request, its replies."""
        queue = deque()
        for ref in refs:
            what = "post %s" % ref["text"]
            path = conversation_path(ref) if with_replies else thread_path(ref)
            data = self.client.get(ref["platform"], path, {"ranking_mode": "likes"} if with_replies else {}, what)
            if data is None:
                continue
            status = data.get("status")
            if not isinstance(status, dict) or status.get("type") != "status":
                self.client.errors.append(
                    {"what": what, "status": data.get("code"), "message": describe(404, {}), "url": None}
                )
                continue
            self.add_context(status, ref["platform"], "listed")
            for raw in data.get("thread") or []:
                if isinstance(raw, dict) and post_key(raw, ref["platform"]) != post_key(status, ref["platform"]):
                    self.add_context(raw, ref["platform"], "thread")
            if not with_replies:
                continue
            for raw in data.get("replies") or []:
                if isinstance(raw, dict):
                    self.add_incoming(raw, ref["platform"], "reply", time_range)
            following = (data.get("cursor") or {}).get("bottom")
            parent = ref_of(status, ref["platform"])
            if data.get("replies") and following and parent:
                queue.append((parent, None, following, 1))
        self.replies(queue, time_range)


# ---------------------------------------------------------------- data file


def load(path):
    if not os.path.exists(path):
        return {"format": FORMAT, "runs": [], "posts": []}
    try:
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
    except (OSError, ValueError) as error:
        raise UsageError("--out %s exists but cannot be read as JSON (%s). Choose another file." % (path, error))
    if not isinstance(doc, dict) or doc.get("format") != FORMAT or not isinstance(doc.get("posts"), list):
        raise UsageError("--out %s exists and is not a file this script wrote. Choose another file." % path)
    doc.setdefault("runs", [])
    return doc


def save(path, doc):
    """Write the file with one run and one post per line, so it stays readable line by line."""

    def block(name, items, last):
        lines = [' "%s": [' % name]
        lines += [
            "  %s%s" % (json.dumps(item, ensure_ascii=False), "," if i < len(items) - 1 else "")
            for i, item in enumerate(items)
        ]
        lines.append(" ]" if last else " ],")
        return lines

    lines = ["{", ' "format": %s,' % json.dumps(doc["format"])]
    lines += block("runs", doc["runs"], last=False)
    lines += block("posts", doc["posts"], last=True)
    lines.append("}")
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    os.replace(temporary, path)


# ---------------------------------------------------------------- command line

TEXT_OPTIONS = ("--terms", "--query")  # their values may begin with "-", as in `-from:brand`


def build_parser():
    parser = argparse.ArgumentParser(
        prog="collect.py",
        description="Collect public posts from X/Twitter or Bluesky, through the FxEmbed API, into one JSON file: "
        "by topic search, by the posts sent to an account, or from a list of posts. "
        "Running it again with the same --out adds to the file.",
        epilog="Prints a JSON summary. Exit code 0: the file was written (read `could_not_fetch` for what is "
        "missing). 1: nothing could be collected. 2: a problem with the arguments.",
    )
    parser.add_argument("--out", required=True, metavar="FILE", help="data file to create or add to")
    topic = parser.add_argument_group("topic search")
    topic.add_argument(
        "--query", action="append", default=[], metavar="TEXT",
        help="a search to run, written `goal | search text` or as the search text alone (repeatable)",
    )
    topic.add_argument("--queries-file", metavar="FILE", help="text file with one `goal | search text` per line; # starts a comment")
    topic.add_argument("--per-query", type=int, default=DEFAULT_PER_QUERY, metavar="N", help="most posts to add per query (default: %d)" % DEFAULT_PER_QUERY)
    topic.add_argument("--platform", choices=("x", "bluesky"), default="x", help="where the queries are run (default: x)")
    account = parser.add_argument_group("posts sent to an account")
    account.add_argument(
        "--account", action="append", default=[], metavar="ACCOUNT",
        help="account whose incoming posts to collect: x:<handle>, bsky:<handle> or a profile URL (repeatable)",
    )
    account.add_argument(
        "--source", choices=("auto", "search", "replies"), default="auto",
        help="`search` for posts mentioning the account, `replies` for replies under its own posts, "
        "`auto` for search first and replies for what is left of --max (default: auto)",
    )
    account.add_argument("--terms", metavar="TEXT", help="extra search terms that narrow the account search, such as a product name")
    listed = parser.add_argument_group("a list of posts")
    listed.add_argument(
        "--post", action="append", default=[], metavar="URL",
        help="a post to fetch with its thread: a post URL, an at:// URI or an X post ID (repeatable)",
    )
    listed.add_argument("--posts-file", metavar="FILE", help="text file with one post URL or ID per line")
    listed.add_argument("--replies", action="store_true", help="also collect the replies to every --post")
    common = parser.add_argument_group("limits and filters")
    common.add_argument("--since", metavar="TIME", help="start of the time range: YYYY-MM-DD or ISO 8601, UTC")
    common.add_argument("--until", metavar="TIME", help="end of the time range, a plain date is included in full (default: now)")
    common.add_argument("--days", type=int, metavar="N", help="time range of the last N days (default for --account: %d)" % DEFAULT_DAYS)
    common.add_argument("--max", type=int, default=DEFAULT_MAX, metavar="N", help="most posts to add in this run (default: %d)" % DEFAULT_MAX)
    common.add_argument("--feed", choices=("latest", "top"), default="latest", help="search tab: `latest` for recent posts, `top` for the most resonant (default: latest)")
    common.add_argument(
        "--exclude-from", action="append", default=[], metavar="HANDLE",
        help="drop posts written by this account, such as a brand's own accounts or a bot (repeatable)",
    )
    common.add_argument("--keep-numbers", action="store_true", help="do not mask phone, account and ticket numbers and email addresses in the saved text")
    common.add_argument("--dry", action="store_true", help="check the arguments and print the searches without any request")
    return parser


def join_text_options(argv):
    """Turn `--terms -from:brand` into `--terms=-from:brand`, which argparse would otherwise read as an option."""
    joined, i = [], 0
    while i < len(argv):
        if argv[i] in TEXT_OPTIONS and i + 1 < len(argv):
            joined.append("%s=%s" % (argv[i], argv[i + 1]))
            i += 2
        else:
            joined.append(argv[i])
            i += 1
    return joined


def read_lines(path, option):
    try:
        with open(path, encoding="utf-8") as handle:
            return [line.strip() for line in handle if line.strip() and not line.lstrip().startswith("#")]
    except OSError as error:
        raise UsageError("%s %s: %s" % (option, path, error))


def read_refs(args):
    texts = list(args.post) + (read_lines(args.posts_file, "--posts-file") if args.posts_file else [])
    refs, seen = [], set()
    for text in texts:
        ref = parse_post_ref(text)
        ref["text"] = text
        key = (ref["platform"], ref["id"])
        if key not in seen:
            seen.add(key)
            refs.append(ref)
    return refs


def read_queries(args):
    texts = list(args.query) + (read_lines(args.queries_file, "--queries-file") if args.queries_file else [])
    queries, seen = [], set()
    for text in texts:
        item = parse_query(text)
        if item["query"].lower() not in seen:
            seen.add(item["query"].lower())
            queries.append(item)
    return queries


def run(argv, client=None, now=None):
    args = build_parser().parse_args(join_text_options(list(argv)))
    now = now or datetime.now(timezone.utc)
    accounts = []
    for text in args.account:
        account = parse_account(text)
        if account not in accounts:
            accounts.append(account)
    refs, queries = read_refs(args), read_queries(args)
    if not accounts and not refs and not queries:
        raise UsageError("nothing to collect: give at least one --query, --queries-file, --account, --post or --posts-file.")
    if args.max < 1:
        raise UsageError("--max must be at least 1.")
    if args.per_query < 1:
        raise UsageError("--per-query must be at least 1.")
    if args.days is not None and args.days < 1:
        raise UsageError("--days must be at least 1.")
    if args.replies and not refs:
        raise UsageError("--replies applies to --post; for an account use --source replies.")
    excluded = [handle.strip().lstrip("@") for handle in args.exclude_from if handle.strip().lstrip("@")]
    given_range = resolve_range(args, now)
    account_range = given_range or (now - timedelta(days=DEFAULT_DAYS), now)
    for item in queries:
        length = len(with_dates(item["query"], given_range))
        if length > MAX_QUERY_LENGTH:
            raise UsageError(
                "query %r is %d characters with its date range; the search accepts %d. Split it into two queries."
                % (item["query"], length, MAX_QUERY_LENGTH)
            )
    doc = load(args.out)

    scope = {
        "queries": len(queries),
        "accounts": ["%s:%s" % account for account in accounts],
        "listed_posts": len(refs),
        "since": iso(account_range[0]) if accounts or given_range else None,
        "until": iso(account_range[1]) if accounts or given_range else None,
        "max": args.max,
        "per_query": args.per_query if queries else None,
        "feed": args.feed if queries or accounts else None,
        "platform": args.platform if queries else None,
        "source": args.source if accounts else None,
        "terms": args.terms,
        "excluded_authors": excluded,
        "replies_of_listed_posts": args.replies,
    }
    if args.dry:
        plan = dict(scope, out=args.out, dry=True, posts_already_in_file=len(doc["posts"]))
        plan["searches"] = [
            with_dates(without_authors(item["query"], args.platform, {h.lower() for h in excluded}), given_range)
            for item in queries
        ] + [
            with_dates(
                without_authors(mentions_query(platform, handle, args.terms), platform, {h.lower() for h in excluded}),
                account_range,
            )
            for platform, handle in accounts
            if args.source in ("auto", "search")
        ]
        print(json.dumps(plan, indent=2, ensure_ascii=False))
        return 0

    client = client or Client()
    own_handles = {handle for _, handle in accounts}
    for earlier in doc["runs"]:  # accounts of earlier runs stay marked in posts added now
        own_handles.update(str(name).partition(":")[2] for name in earlier.get("accounts") or [])
    collector = Collector(client, doc["posts"], args.max, own_handles, excluded, mask=not args.keep_numbers)
    if refs:
        collector.listed(refs, given_range, args.replies)
    by_query = collector.queries(args.platform, queries, args.feed, given_range, args.per_query) if queries else []
    for platform, handle in accounts:
        collector.account(platform, handle, account_range, args.source, args.terms, args.feed)
    notes = collector.notes
    if collector.left <= 0:
        notes.append("Stopped at --max %d; more posts may exist in this scope." % args.max)

    added = sum(collector.added.values())
    summary = {
        "out": args.out,
        "added": added,
        "added_by_source": collector.added,
        "total_in_file": len(collector.posts),
        "skipped": collector.skipped,
        "masked": collector.masked,
        "by_query": by_query,
        "scope": scope,
        "requests": client.requests,
        "could_not_fetch": client.errors,
        "notes": notes,
    }
    if added == 0 and not doc["posts"]:
        summary["out"] = None
        notes.append("Nothing was collected, so no file was written.")
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 1
    doc["posts"] = list(collector.posts.values())
    doc["runs"].append(dict(scope, at=iso(now), added=added, by_query=by_query, could_not_fetch=client.errors, notes=notes))
    save(args.out, doc)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def main(argv=None):
    try:
        return run(sys.argv[1:] if argv is None else argv)
    except UsageError as error:
        print("collect.py: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
