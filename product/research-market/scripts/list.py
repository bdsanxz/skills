#!/usr/bin/env python3
"""Print the posts of a data file one per line, for reading and coding.

    list.py posts.json
    list.py posts.json --from 201 --to 400
    list.py posts.json --goal wish
    list.py posts.json --uncoded coding.txt

Each line is `number | date | @author | engagement | goal | text`. The number is the post's
position in the file; it never changes, because new posts are added at the end, and the
coding file refers to posts by it. A `>` before the text marks a reply. Standard library only.
"""

import argparse
import json
import re
import sys

FORMAT = "research-market/posts@1"
COUNTS = ("likes", "reposts", "replies", "quotes")


class UsageError(Exception):
    """A problem with the input, reported to the caller with exit code 2."""


def load_posts(path):
    try:
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
    except OSError as error:
        raise UsageError("data file %s: %s" % (path, error))
    except ValueError as error:
        raise UsageError("data file %s is not valid JSON: %s" % (path, error))
    if not isinstance(doc, dict) or doc.get("format") != FORMAT or not isinstance(doc.get("posts"), list):
        raise UsageError("data file %s was not written by collect.py." % path)
    return doc["posts"]


def coded_numbers(path):
    """The post numbers that already have a line in the coding file."""
    numbers = set()
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                first = line.split("|", 1)[0].strip()
                if first.isdigit():
                    numbers.add(int(first))
    except OSError as error:
        raise UsageError("coding file %s: %s" % (path, error))
    return numbers


def line_of(number, post, width):
    text = re.sub(r"https?://\S+", "<url>", post.get("text") or "")
    text = " ".join(text.split())
    if len(text) > width:
        text = text[: width - 1] + "…"
    engagement = sum(int(post.get(field) or 0) for field in COUNTS)
    return "%d | %s | @%s | %d | %s | %s%s" % (
        number,
        (post.get("date") or "")[:10] or "-",
        post.get("author") or "-",
        engagement,
        post.get("goal") or post.get("account") or post.get("source") or "-",
        ">" if post.get("reply_to") else "",
        text,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="list.py",
        description="Print the posts of a data file one per line: number | date | @author | engagement | goal | text. "
        "Engagement is likes + reposts + replies + quotes; the goal column falls back to the account or the source.",
        epilog="Exit code 0: listed. 2: a problem with the input.",
    )
    parser.add_argument("posts", metavar="POSTS_FILE", help="data file written by collect.py")
    parser.add_argument("--from", dest="first", type=int, default=1, metavar="N", help="first post number to print (default: 1)")
    parser.add_argument("--to", dest="last", type=int, metavar="N", help="last post number to print (default: the last post)")
    parser.add_argument("--goal", metavar="GOAL", help="only posts collected for this goal, or sent to this account")
    parser.add_argument("--uncoded", metavar="CODING_FILE", help="only posts that have no line yet in this coding file")
    parser.add_argument("--all", action="store_true", help="include posts written by the analyzed accounts themselves")
    parser.add_argument("--width", type=int, default=280, metavar="N", help="longest text to print per post (default: 280)")
    args = parser.parse_args(argv)
    try:
        if args.first < 1 or args.width < 20:
            raise UsageError("--from must be at least 1 and --width at least 20.")
        posts = load_posts(args.posts)
        done = coded_numbers(args.uncoded) if args.uncoded else set()
    except UsageError as error:
        print("list.py: %s" % error, file=sys.stderr)
        return 2
    last = min(args.last or len(posts), len(posts))
    wanted = (args.goal or "").lower()
    shown = 0
    for number in range(args.first, last + 1):
        post = posts[number - 1]
        if post.get("from_account") and not args.all:
            continue
        if number in done:
            continue
        if wanted and wanted not in (str(post.get("goal") or "").lower(), str(post.get("account") or "").lower()):
            continue
        print(line_of(number, post, args.width))
        shown += 1
    print("# %d of %d posts shown (numbers %d to %d)" % (shown, len(posts), args.first, last))
    return 0


if __name__ == "__main__":
    sys.exit(main())
