#!/usr/bin/env python3
"""Count coded posts per theme, dimension, segment and phrase, from the data file `collect.py` wrote.

    tally.py posts.json coding.txt
    tally.py posts.json coding.txt --markdown
    tally.py posts.json coding.txt --markdown segments

The coding file has one line per observation, with fields separated by `|`:

    post | dimension | theme | sentiment | intensity | segment | exact words
    12 | pain | Paid but the top-up never arrives | neg | 3 | prepaid users | money gone; still pending

`post` is the number `list.py` prints, or the post URL. A post may have several lines, one
per dimension it shows. `segment` and `exact words` may be left empty or written `-`;
several phrases are separated by `;`.

Every number in the output is computed from the data file. A line that names a post that
was never collected, or quotes words that are not in the post, is an error, so the result
cannot rest on an invented post or quote. Standard library only.
"""

import argparse
import json
import sys

FORMAT = "research-market/posts@1"
COUNTS = ("likes", "reposts", "replies", "quotes")
DIMENSIONS = (
    "pain", "job", "wish", "delight", "behavior", "alternative", "trigger", "criteria",
    "objection", "switching-cost", "decision", "price", "identity", "success", "source",
)
SENTIMENTS = {
    "neg": "negative", "negative": "negative", "-": "negative",
    "neu": "neutral", "neutral": "neutral", "0": "neutral",
    "pos": "positive", "positive": "positive", "+": "positive",
}
TABLES = ("themes", "dimensions", "segments", "words")


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


def squash(text):
    """Lower-case with single spaces, so that a quoted phrase is compared the way it reads."""
    return " ".join(str(text).lower().split())


def read_coding(path, posts):
    """Return (rows, problems). A row is one valid coding line; a problem names the line and what is wrong."""
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except OSError as error:
        raise UsageError("coding file %s: %s" % (path, error))
    by_url = {squash(post.get("url", "")): number for number, post in enumerate(posts, 1)}
    rows, problems, seen = [], [], set()
    for line_number, line in enumerate(lines, 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = [field.strip() for field in line.split("|")]
        if fields[0].lower() in ("post", "n", "number"):
            continue  # header

        def problem(message):
            problems.append({"line": line_number, "problem": message, "text": line.strip()[:120]})

        if len(fields) < 5:
            problem("needs at least: post | dimension | theme | sentiment | intensity")
            continue
        fields += [""] * (7 - len(fields))
        ref, dimension, theme, sentiment, intensity, segment = fields[:6]
        words = "|".join(fields[6:])
        number = int(ref) if ref.isdigit() else by_url.get(squash(ref))
        if not number or number > len(posts):
            problem("post %r is not in the data file" % ref)
            continue
        post = posts[number - 1]
        dimension = dimension.lower()
        if dimension not in DIMENSIONS:
            problem("dimension %r is not one of: %s" % (dimension, ", ".join(DIMENSIONS)))
            continue
        if not theme:
            problem("the theme is empty")
            continue
        if sentiment.lower() not in SENTIMENTS:
            problem("sentiment %r must be neg, neu or pos" % sentiment)
            continue
        if intensity not in ("1", "2", "3"):
            problem("intensity %r must be 1, 2 or 3" % intensity)
            continue
        phrases = [phrase.strip().strip('"“”') for phrase in words.split(";") if phrase.strip(" -\"“”")]
        missing = [phrase for phrase in phrases if squash(phrase) not in squash(post.get("text", ""))]
        if missing:
            problem("these words are not in post %d: %s" % (number, "; ".join(missing)))
            continue
        key = (number, dimension, squash(theme))
        if key in seen:
            problem("post %d already has this dimension and theme" % number)
            continue
        seen.add(key)
        rows.append({
            "number": number, "post": post, "dimension": dimension, "theme": theme,
            "sentiment": SENTIMENTS[sentiment.lower()], "intensity": int(intensity),
            "segment": segment if segment and segment != "-" else None, "phrases": phrases,
        })
    return rows, problems


def engagement(post):
    return sum(int(post.get(field) or 0) for field in COUNTS)


def measure(rows, top=0):
    """Posts, authors, days and engagement of a group of rows, counting each post once."""
    posts = {row["number"]: row["post"] for row in rows}
    dates = sorted(post["date"] for post in posts.values() if post.get("date"))
    result = {"posts": len(posts), "authors": len({post.get("author") for post in posts.values()})}
    result["days"] = len({date[:10] for date in dates})  # distinct days with a post: does it recur?
    result["first"] = dates[0][:10] if dates else None
    result["last"] = dates[-1][:10] if dates else None
    for field in COUNTS:
        result[field] = sum(int(post.get(field) or 0) for post in posts.values())
    result["engagement"] = sum(result[field] for field in COUNTS)
    if top:
        ranked = sorted(posts.values(), key=engagement, reverse=True)[:top]
        result["top_posts"] = [{"url": post["url"], "engagement": engagement(post)} for post in ranked]
    return result


def group(rows, key):
    groups = {}
    for row in rows:
        groups.setdefault(key(row), []).append(row)
    return groups


def tally(posts, rows, top):
    themes = []
    for (dimension, _), members in group(rows, lambda r: (r["dimension"], squash(r["theme"]))).items():
        entry = {"dimension": dimension, "theme": members[0]["theme"]}
        entry.update(measure(members, top))
        entry["intensity"] = round(sum(row["intensity"] for row in members) / float(len(members)), 1)
        for sentiment in ("negative", "neutral", "positive"):
            entry[sentiment] = sum(1 for row in members if row["sentiment"] == sentiment)
        segments = group([row for row in members if row["segment"]], lambda r: r["segment"])
        entry["segments"] = {name: len({row["number"] for row in found}) for name, found in sorted(segments.items())}
        themes.append(entry)
    themes.sort(key=lambda t: (t["posts"], t["intensity"], t["engagement"]), reverse=True)

    dimensions = []
    for dimension, members in group(rows, lambda r: r["dimension"]).items():
        entry = {"dimension": dimension, "themes": len({squash(row["theme"]) for row in members})}
        entry.update({k: v for k, v in measure(members).items() if k in ("posts", "authors", "engagement")})
        dimensions.append(entry)
    dimensions.sort(key=lambda d: d["posts"], reverse=True)

    segments = []
    for segment, members in group([row for row in rows if row["segment"]], lambda r: r["segment"]).items():
        entry = {"segment": segment}
        entry.update({k: v for k, v in measure(members).items() if k in ("posts", "authors", "engagement")})
        entry["themes"] = []
        for (dimension, _), found in group(members, lambda r: (r["dimension"], squash(r["theme"]))).items():
            counted = measure(found)
            entry["themes"].append({
                "dimension": dimension, "theme": found[0]["theme"], "posts": counted["posts"],
                "authors": counted["authors"], "engagement": counted["engagement"],
            })
        entry["themes"].sort(key=lambda t: (t["posts"], t["engagement"]), reverse=True)
        segments.append(entry)
    segments.sort(key=lambda s: s["posts"], reverse=True)

    words = []
    phrase_rows = [dict(row, phrase=phrase) for row in rows for phrase in row["phrases"]]
    for _, members in group(phrase_rows, lambda r: squash(r["phrase"])).items():
        words.append({
            "words": members[0]["phrase"],
            "posts": len({row["number"] for row in members}),
            "dimensions": sorted({row["dimension"] for row in members}),
            "themes": sorted({row["theme"] for row in members}),
            "example": members[0]["post"]["url"],
        })
    words.sort(key=lambda w: (-w["posts"], w["words"].lower()))

    coded = {row["number"] for row in rows}
    audience = [number for number, post in enumerate(posts, 1) if not post.get("from_account")]
    own = sorted({row["post"]["url"] for row in rows if row["post"].get("from_account")})
    return {
        "themes": themes,
        "dimensions": dimensions,
        "segments": segments,
        "words": words,
        "posts_in_file": len(posts),
        "audience_posts": len(audience),
        "coded_posts": len(coded),
        "audience_posts_not_coded": sum(1 for number in audience if number not in coded),
        "written_by_the_account": own,
    }


def cell(value):
    return str(value).replace("|", "\\|")


def table(header, alignment, rows):
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(alignment) + " |"]
    lines += ["| " + " | ".join(cell(value) for value in row) + " |" for row in rows]
    return "\n".join(lines)


def markdown(result, which):
    if which == "dimensions":
        return table(
            ("Dimension", "Posts", "Authors", "Themes", "Engagement"), ("---", "---:", "---:", "---:", "---:"),
            [(d["dimension"], d["posts"], d["authors"], d["themes"], d["engagement"]) for d in result["dimensions"]],
        )
    if which == "segments":
        return table(
            ("Segment", "Dimension", "Theme", "Posts", "Authors", "Engagement"),
            ("---", "---", "---", "---:", "---:", "---:"),
            [
                (s["segment"], t["dimension"], t["theme"], t["posts"], t["authors"], t["engagement"])
                for s in result["segments"] for t in s["themes"]
            ],
        )
    if which == "words":
        return table(
            ("Words", "Posts", "Dimensions", "Example"), ("---", "---:", "---", "---"),
            [(w["words"], w["posts"], ", ".join(w["dimensions"]), w["example"]) for w in result["words"]],
        )
    return table(
        ("Dimension", "Theme", "Posts", "Authors", "Days", "Intensity", "Neg", "Neu", "Pos", "Engagement"),
        ("---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"),
        [
            (t["dimension"], t["theme"], t["posts"], t["authors"], t["days"], t["intensity"],
             t["negative"], t["neutral"], t["positive"], t["engagement"])
            for t in result["themes"]
        ],
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="tally.py",
        description="Count coded posts per theme, dimension, segment and phrase. Engagement is likes + reposts + "
        "replies + quotes; intensity is the mean of the 1-3 ratings; days are distinct days with a post.",
        epilog="Exit code 0: counted. 1: the coding file has lines that cannot be counted (an unknown post, words "
        "that are not in the post, a wrong value); they are listed and nothing is counted until they are corrected. "
        "2: a problem with the input files.",
    )
    parser.add_argument("posts", metavar="POSTS_FILE", help="data file written by collect.py")
    parser.add_argument("coding", metavar="CODING_FILE", help="one line per observation: post | dimension | theme | sentiment | intensity | segment | exact words")
    parser.add_argument("--top", type=int, default=3, metavar="N", help="most-engaged posts to list per theme (default: 3)")
    parser.add_argument(
        "--markdown", nargs="?", const="themes", choices=TABLES, metavar="TABLE",
        help="print one Markdown table instead of JSON: themes (default), dimensions, segments or words",
    )
    args = parser.parse_args(argv)
    try:
        if args.top < 0:
            raise UsageError("--top must be 0 or more.")
        posts = load_posts(args.posts)
        rows, problems = read_coding(args.coding, posts)
        if not rows and not problems:
            raise UsageError("coding file %s has no coding lines." % args.coding)
    except UsageError as error:
        print("tally.py: %s" % error, file=sys.stderr)
        return 2
    if problems:
        print(json.dumps({"error": "Correct these lines of the coding file, then run again.", "problems": problems}, indent=2, ensure_ascii=False))
        return 1
    result = tally(posts, rows, args.top)
    print(markdown(result, args.markdown) if args.markdown else json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
