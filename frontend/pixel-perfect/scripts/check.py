"""One capture-and-diff round for any number of components, sections and pages.

The page is loaded once. Each --item (a component) and each --section is cut
out of that one shot by its selector and scored against its saved reference
crop; each --page scores the whole page against a design image. The round gets
one iteration number, the first that none of its items has used, and nothing
is overwritten:

    components/<name>/iter-NN/<variant>/   reference: components/<name>/ref/<variant>.png
    sections/<name>/iter-NN/<variant>/     reference: sections/<name>/ref/<variant>.png
    pages/<name>/iter-NN/<image>/

A long list of items can be kept in a file and passed as @file.

When the capture is not valid evidence (a request or font failed, or the
browser did not honor the viewport) nothing is scored and nothing is written.

Exit status: 0 every item passed, 1 some item failed, 2 error, 3 browser not
installed, 4 capture not valid.
"""
import argparse
import os
import re
import sys

import compare
import diff
import toon
from capture import BROWSER_MISSING_EXIT, INVALID_EXIT, Browser, BrowserMissing, add_page_arguments, crop_box, fractional, page_arguments
from pp_common import Parser, PPError, add_run_arguments, emit, load_rgb, num, parse_hex, run_cli, run_dir, superseded_by, with_css

import numpy as np
from PIL import Image

SHEET_SIDE = 900
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def parse_target(text, flag):
    """Split NAME[/VARIANT]=VALUE."""
    key, sep, value = text.partition("=")
    name, _, variant = key.partition("/")
    variant = variant or "default"
    if not sep or not value or not NAME.match(name) or not NAME.match(variant):
        raise PPError("{} must look like NAME=VALUE or NAME/VARIANT=VALUE; got '{}'".format(flag, text))
    return name, variant, value


def next_iteration(base):
    """One more than the highest iter-NN directory under `base`."""
    highest = 0
    if os.path.isdir(base):
        for entry in os.listdir(base):
            match = re.match(r"^iter-(\d+)$", entry)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def plan(args):
    """Resolve every target to its reference and its fresh output directory."""
    targets = []
    for kind, flag, texts in (("component", "--item", args.item), ("section", "--section", args.section), ("page", "--page", args.page)):
        for text in texts:
            name, variant, value = parse_target(text, flag)
            base = os.path.join(args.work_dir, kind + "s", name)
            reference = value if kind == "page" else os.path.join(base, "ref", variant + ".png")
            if not os.path.isfile(reference):
                hint = "" if kind == "page" else " (save it with `measure crop` first)"
                raise PPError("no reference image at {}{}".format(reference, hint))
            copy = superseded_by(reference) if kind == "page" else None
            if copy:
                raise PPError("{} has a substituted copy; score the page against {}".format(reference, copy))
            targets.append(
                {
                    "kind": kind,
                    "item": name,
                    "variant": variant,
                    "selector": None if kind == "page" else value,
                    "reference": reference,
                    "base": base,
                }
            )
    if not targets:
        raise PPError("give at least one --item, --section or --page")
    # One number for the whole round, so its items can be found together later.
    iteration = args.iter or max(next_iteration(target["base"]) for target in targets)
    for target in targets:
        target["iter"] = iteration
        target["dir"] = os.path.join(target["base"], "iter-{:02d}".format(iteration), target["variant"])
        if os.path.exists(target["dir"]):
            raise PPError("{} already exists; an iteration is never overwritten".format(target["dir"]))
    seen = set()
    for target in targets:
        if target["dir"] in seen:
            raise PPError("{} is listed twice".format(target["dir"]))
        seen.add(target["dir"])
    return targets


def score(target, image, report, box, args, background):
    """Save one target's render, capture report and diff; return its table row."""
    os.makedirs(target["dir"])
    image.save(os.path.join(target["dir"], "render.png"))
    captured = {"url": args.url, "viewport": args.viewport, "scale": num(args.scale), "width": image.width, "height": image.height}
    if box:
        captured["selector"] = target["selector"]
        captured["css_box"] = {key: num(box[key], 3) for key in ("x", "y", "width", "height")}
        captured["fractional_box"] = fractional(box, args.scale)
    captured.update(report)
    with open(os.path.join(target["dir"], "capture.toon"), "w") as handle:
        handle.write(toon.encode(captured) + "\n")
    design, _ = load_rgb(target["reference"])
    result = diff.run_diff(
        design, np.asarray(image), target["dir"], args.tolerance, args.threshold, args.tile_floor, args.tile,
        args.scale, background, args.max_shift, args.images,
    )
    result["reference"] = diff.reference_record(target["reference"])
    diff.save_result(with_css(result, args.scale), target["dir"])
    return row_of(target, result, "box is off the device pixel grid" if box and captured["fractional_box"] else diff.hint(result))


def row_of(target, result=None, note=""):
    """One line of the round's table; the item's files are under its iteration directory."""
    numbers = diff.summary(result) if result else {}
    row = {"kind": target["kind"], "item": target["item"], "variant": target["variant"]}
    for key in ("pass", "content", "worst_tile", "naive", "dw", "dh"):
        row[key] = numbers.get(key, False if key == "pass" else None)
    row["note"] = note
    return row


def write_sheet(targets, renders, path):
    """Every small item of the round, reference beside render, on one image."""
    entries, skipped = [], []
    for target in targets:
        image = renders.get(target["dir"])
        if image is None:
            continue
        with Image.open(target["reference"]) as reference:
            reference = reference.convert("RGB")
        if max(reference.size) > SHEET_SIDE or max(image.size) > SHEET_SIDE:
            skipped.append(target["item"] + "/" + target["variant"])
            continue
        entries.append((target["item"] + "/" + target["variant"], reference, image))
    if not entries:
        return {"skipped": skipped, "note": "every item is larger than {} px; read their cluster close-ups instead".format(SHEET_SIDE)}
    result = compare.write_sheet(entries, path)
    if skipped:
        result["skipped"] = skipped
    return result


def main():
    parser = Parser(prog="check", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_page_arguments(parser)
    parser.add_argument("--item", action="append", default=[], metavar="NAME[/VARIANT]=SELECTOR",
                        help="a component on the page; scored against components/NAME/ref/VARIANT.png (repeatable)")
    parser.add_argument("--section", action="append", default=[], metavar="NAME[/VARIANT]=SELECTOR",
                        help="a section on the page; scored against sections/NAME/ref/VARIANT.png (repeatable)")
    parser.add_argument("--page", action="append", default=[], metavar="NAME[/IMAGE]=DESIGN.png",
                        help="the whole page, scored against a design image (repeatable)")
    parser.add_argument("--viewport-only", action="store_true",
                        help="score each --page on the viewport alone, for a design that shows only the first screen (default: the whole scrollable page)")
    add_run_arguments(parser)
    parser.add_argument("--iter", type=int, help="iteration number to write (default: the first that none of the items has used)")
    parser.add_argument("--sheet", action="store_true",
                        help="also save one image with every small item's reference beside its render, to read the round at a glance")
    parser.add_argument("--tolerance", type=int, default=diff.DEFAULT_TOLERANCE)
    parser.add_argument("--threshold", type=float, default=diff.DEFAULT_THRESHOLD)
    parser.add_argument("--tile-floor", type=float, default=diff.DEFAULT_TILE_FLOOR)
    parser.add_argument("--tile", type=int, default=diff.DEFAULT_TILE, help="tile size in CSS pixels")
    parser.add_argument("--bg", help="background color as hex (default: each reference's most common color)")
    parser.add_argument("--max-shift", type=int, default=32, help="largest shift to look for, in CSS pixels")
    parser.add_argument("--images", choices=diff.IMAGE_MODES, default="clusters",
                        help="evidence images per item (default: only the cluster close-ups; use 'all' for the final round)")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the arguments and references and report what would run, without starting the browser or writing")
    args = parser.parse_args()
    args.work_dir = run_dir(args)

    width, height, actions = page_arguments(args)
    if not 0 <= args.tolerance <= 255:
        raise PPError("--tolerance must be between 0 and 255")
    if args.iter is not None and args.iter < 1:
        raise PPError("--iter must be 1 or more")
    background = parse_hex(args.bg) if args.bg else None
    targets = plan(args)
    if args.dry:
        emit(
            {
                "dry_run": True,
                "url": args.url,
                "viewport": {"width": width, "height": height},
                "scale": num(args.scale),
                "iteration": targets[0]["iter"],
                "targets": [
                    {"item": t["item"], "variant": t["variant"], "kind": t["kind"], "reference": t["reference"], "writes": t["dir"]}
                    for t in targets
                ],
            },
            args.json,
        )
        return 0

    rows = []
    try:
        with Browser(width, height, args.scale, args.color_scheme) as browser:
            report = browser.load(
                args.url, actions, args.wait_until, args.settle_ms, args.timeout, args.ignore_request, args.retries
            )
            if not report["valid"]:
                emit({"url": args.url, "valid": False, "problems": report["problems"],
                      "failed_requests": report["failed_requests"], "fonts_failed": report["fonts_failed"],
                      "scored": 0, "note": "nothing was scored or written; fix the page or the server and run again"}, args.json)
                return INVALID_EXIT
            full = browser.shot(full_page=True)
            view = browser.shot(full_page=False) if args.viewport_only else full
            boxes = {t["dir"]: browser.box(t["selector"], args.timeout) for t in targets if t["selector"]}
    except BrowserMissing:
        print("error: Chromium is not installed", file=sys.stderr)
        return BROWSER_MISSING_EXIT

    renders = {}
    for target in targets:
        box = boxes.get(target["dir"])
        if target["selector"] and box is None:
            rows.append(row_of(target, note="no visible element matches " + target["selector"]))
            continue
        image = crop_box(full, box, args.scale) if box else view
        renders[target["dir"]] = image
        rows.append(score(target, image, report, box, args, background))

    passed = sum(1 for row in rows if row["pass"])
    iteration = "iter-{:02d}".format(targets[0]["iter"])
    output = {
        "url": args.url,
        "valid": True,
        "iteration": targets[0]["iter"],
        "files": os.path.join(args.work_dir, "<kind>s", "<item>", iteration, "<variant>"),
        "passed": passed,
        "failed": len(rows) - passed,
        "items": rows,
    }
    if report["images_not_1to1"]:
        output["images_not_1to1"] = len(report["images_not_1to1"])
        output["resampled"] = report["images_not_1to1"][:12]
    if args.sheet:
        output["sheet"] = write_sheet(targets, renders, os.path.join(args.work_dir, "sheets", iteration + ".png"))
    emit(output, args.json)
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    run_cli(main)
