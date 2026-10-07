"""The standing of every component, section and page, read from the saved diffs.

For each item and variant under the working directory this lists the latest
iteration's result, the best content score so far, and whether the stop rule
has been reached: no pass, and either the content score has not improved for
3 iterations or 10 iterations have been run. `over_budget` is the mismatch as
a multiple of what a pass allows, and `ink_missed_pct` the share of the
design's thin strokes that are mismatched. When an item's reference crop was
replaced, only the rounds since then are counted, and `reference_changed`
says at which iteration that was.

Nothing here is computed from images. Every number is copied from the diff
that `diff` or `check` saved, so this is the only table a report may quote.
"""
import argparse
import json
import os
import re

import diff
from pp_common import PPError, add_run_arguments, emit, num, run_cli, run_dir

PLATEAU = 3
CAP = 10


def read_diff(directory):
    """The summary numbers of one saved diff, or None when there is none."""
    path = os.path.join(directory, "diff.json")
    if os.path.isfile(path):
        with open(path) as handle:
            data = json.load(handle)
        pixels, ink = data.get("pixels", {}), data.get("ink", {})
        return {"pass": data["pass"], "content": num(data["score"]["content"]),
                "worst_tile": num(data["score"]["worst_tile"]), "naive": num(data["score"]["naive"]),
                "mismatched": pixels.get("mismatched"), "allowed": pixels.get("allowed"),
                "ink_missed_pct": ink.get("mismatched_pct"), "reference": data.get("reference", {}).get("sha1")}
    path = os.path.join(directory, "diff.toon")
    if not os.path.isfile(path):
        return None
    # Diffs saved before diff.json existed: read the same four lines from the text.
    with open(path) as handle:
        text = handle.read()
    found = {}
    for key, pattern in (("pass", r"^pass: (\w+)$"), ("content", r"^  content: ([\d.]+)$"),
                         ("worst_tile", r"^  worst_tile: ([\d.]+)$"), ("naive", r"^  naive: ([\d.]+)$")):
        match = re.search(pattern, text, re.M)
        if not match:
            return None
        found[key] = match.group(1) == "true" if key == "pass" else num(match.group(1))
    return found


def history(work_dir):
    """{(kind, item, variant): [(iteration, directory, numbers), ...]} in iteration order."""
    found = {}
    for kind, folder in (("component", "components"), ("section", "sections"), ("page", "pages")):
        root = os.path.join(work_dir, folder)
        if not os.path.isdir(root):
            continue
        for item in sorted(os.listdir(root)):
            for entry in sorted(os.listdir(os.path.join(root, item))) if os.path.isdir(os.path.join(root, item)) else []:
                match = re.match(r"^iter-(\d+)$", entry)
                if not match:
                    continue
                base = os.path.join(root, item, entry)
                places = [("default", base)] + [(name, os.path.join(base, name)) for name in sorted(os.listdir(base))]
                for variant, directory in places:
                    numbers = read_diff(directory) if os.path.isdir(directory) else None
                    if numbers:
                        found.setdefault((kind, item, variant), []).append((int(match.group(1)), directory, numbers))
    for runs in found.values():
        runs.sort(key=lambda run: run[0])
    return found


def standing(work_dir):
    rows = []
    level = {"component": 0, "section": 1, "page": 2}
    for (kind, item, variant), runs in sorted(history(work_dir).items(), key=lambda entry: (level[entry[0][0]],) + entry[0][1:]):
        iteration, directory, latest = runs[-1]
        # A score made against a different reference crop is not comparable:
        # progress and the stop rule count only the rounds since it last changed.
        changed_at, total = None, len(runs)
        for index in range(len(runs) - 1, 0, -1):
            now, before = runs[index][2].get("reference"), runs[index - 1][2].get("reference")
            # Diffs saved before references were recorded say nothing either way.
            if now and before and now != before:
                changed_at = runs[index][0]
                runs = runs[index:]
                break
        best_index = max(range(len(runs)), key=lambda index: (runs[index][2]["content"], -index))
        since_best = len(runs) - 1 - best_index
        allowed, mismatched = latest.get("allowed"), latest.get("mismatched")
        if latest["pass"]:
            status = "passed"
        elif since_best >= PLATEAU:
            status = "stop: no gain in {} iterations".format(since_best)
        elif total >= CAP:
            status = "stop: {} iterations run".format(total)
        else:
            status = "in progress"
        rows.append(
            {
                "kind": kind,
                "item": item,
                "variant": variant,
                "iterations": total,
                "latest": iteration,
                "pass": latest["pass"],
                "content": latest["content"],
                "worst_tile": latest["worst_tile"],
                "naive": latest["naive"],
                "best_content": runs[best_index][2]["content"],
                "best_iter": runs[best_index][0],
                # How many times over the pass allowance the mismatch is, and
                # how much of the design's thin ink is missed: the ceiling signs.
                "over_budget": num(mismatched / allowed, 1) if allowed else None,
                "ink_missed_pct": latest.get("ink_missed_pct"),
                "reference_changed": changed_at,
                "status": status,
                "evidence": os.path.relpath(directory, work_dir),
            }
        )
    return rows


def detail(work_dir, text):
    """What the latest saved diff of one item says, cut down to what picks the next fix."""
    name, _, variant = text.partition("/")
    variant = variant or "default"
    for (kind, item, found), runs in history(work_dir).items():
        if item == name and found == variant:
            iteration, directory, _ = runs[-1]
            path = os.path.join(directory, "diff.json")
            if not os.path.isfile(path):
                raise PPError("{} holds no diff.json; run `check` on the item again".format(directory))
            with open(path) as handle:
                saved = json.load(handle)
            shown = {"item": "{}/{}".format(name, variant), "kind": kind, "iteration": iteration,
                     "files": os.path.relpath(directory, work_dir)}
            shown.update(diff.brief(saved))
            return shown
    raise PPError("no saved diff of {}/{} under {}".format(name, variant, work_dir))


def markdown(rows):
    lines = [
        "| Item | Variant / image | Content | Worst tile | Naive | Iterations | Status | Evidence |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        name = row["item"] if row["kind"] == "component" else row["kind"] + ": " + row["item"]
        status = "passed" if row["pass"] else ("stopped" if row["status"].startswith("stop") else "in progress")
        lines.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            name, row["variant"], row["content"], row["worst_tile"], row["naive"], row["iterations"], status, row["evidence"]))
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(prog="scores", description=__doc__)
    add_run_arguments(parser)
    parser.add_argument("--item", metavar="NAME[/VARIANT]",
                        help="print what one item's latest diff says: budget, ink, largest clusters, shifts")
    parser.add_argument("--markdown", action="store_true", help="print the report's Scores table instead of TOON")
    parser.add_argument("--json", action="store_true", help="print JSON instead of TOON")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true", help="check the working directory and stop")
    args = parser.parse_args()
    args.work_dir = run_dir(args)
    if not os.path.isdir(args.work_dir):
        raise PPError("no working directory at {}".format(args.work_dir))
    if args.dry:
        emit({"dry_run": True, "work_dir": args.work_dir, "writes": []}, args.json)
        return 0
    if args.item:
        emit(detail(args.work_dir, args.item), args.json)
        return 0
    rows = standing(args.work_dir)
    if args.markdown:
        print(markdown(rows))
        return 0
    table = [{key: value for key, value in row.items() if key not in ("naive", "evidence")} for row in rows]
    emit(
        {
            "work_dir": args.work_dir,
            "total": len(rows),
            "passed": sum(1 for row in rows if row["pass"]),
            "stop_now": [row["item"] + "/" + row["variant"] for row in rows if row["status"].startswith("stop")],
            "rows": table,
        },
        args.json,
    )
    return 0


if __name__ == "__main__":
    run_cli(main)
