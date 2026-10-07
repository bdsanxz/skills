"""Measure the same band in a reference and in a render, and line the results up.

The items found along one axis of the region (see `measure items`) are paired
between the two images, and each pair is listed with how far the render's box
is from the reference's: dx and dy for position, dw and dh for size, render
minus reference. An item only one image has is listed on its own.

Name the two images, or name items of the run with --item and the reference
and the latest render of each are found in the working directory. Several
items and several regions can be compared in one call.

With --scale the numbers are CSS pixels, the unit a fix is written in; regions
are always given in image pixels. --full prints both units and every detail.

This is a measurement, not a score: it says which value to change, and by how
much. Only `diff` decides whether a render passes.
"""
import argparse
import json
import math
import os
import re

import numpy as np
from PIL import Image, ImageDraw

import measure
from pp_common import Parser, PPError, add_run_arguments, clamp_region, emit, full_region, load_rgb, maxdiff, num, parse_hex, parse_ints, run_cli, run_dir, to_hex, with_css

READABLE_SIDE = 1800


def pair_items(first, second, axis, skip_cost):
    """Align two item lists in order, allowing either side to have extras.

    Returns (pairs, only_first, only_second) as index lists.
    """
    start, size = ("x", "w") if axis == "x" else ("y", "h")

    def cost(a, b):
        return abs(a[start] - b[start]) + abs(a[size] - b[size])

    rows, cols = len(first), len(second)
    table = np.zeros((rows + 1, cols + 1))
    table[:, 0] = np.arange(rows + 1) * skip_cost
    table[0, :] = np.arange(cols + 1) * skip_cost
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            table[i, j] = min(
                table[i - 1, j - 1] + cost(first[i - 1], second[j - 1]),
                table[i - 1, j] + skip_cost,
                table[i, j - 1] + skip_cost,
            )
    pairs, only_first, only_second = [], [], []
    i, j = rows, cols
    while i or j:
        if i and j and math.isclose(table[i, j], table[i - 1, j - 1] + cost(first[i - 1], second[j - 1])):
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and math.isclose(table[i, j], table[i - 1, j] + skip_cost):
            only_first.append(i - 1)
            i -= 1
        else:
            only_second.append(j - 1)
            j -= 1
    return pairs[::-1], only_first[::-1], only_second[::-1]


def patch_offset(reference, render, region, reach):
    """The whole-pixel offset at which the render's patch best matches the reference's."""
    x, y, w, h = region
    stride = max(1, int(math.sqrt(w * h / 250000.0)))
    patch = reference[y : y + h : stride, x : x + w : stride].astype(np.int16)

    def error(dx, dy):
        if y + dy < 0 or x + dx < 0 or y + h + dy > render.shape[0] or x + w + dx > render.shape[1]:
            return None
        return float(np.abs(patch - render[y + dy : y + h + dy : stride, x + dx : x + w + dx : stride]).mean())

    base = error(0, 0)
    if base is None:
        return None
    best, dx, dy = base, 0, 0
    for _ in range(2):
        for axis in (0, 1):
            for step in range(-reach, reach + 1):
                candidate = (step, dy) if axis == 0 else (dx, step)
                value = error(*candidate)
                if value is not None and value < best:
                    best, dx, dy = value, candidate[0], candidate[1]
    return {"dx": dx, "dy": dy, "error_at_zero": num(base, 2), "error_at_best": num(best, 2)}


def write_pair(reference, render, region, render_region, out, zoom=None):
    """Save the reference's region above the render's, enlarged for reading."""
    x, y, w, h = region
    rx, ry, rw, rh = render_region
    parts = [Image.fromarray(reference[y : y + h, x : x + w]), Image.fromarray(render[ry : ry + rh, rx : rx + rw])]
    if zoom is None:
        zoom = max(1, min(8, READABLE_SIDE // max(w, 2 * h + 6)))
    if zoom > 1:
        parts = [part.resize((part.width * zoom, part.height * zoom), Image.NEAREST) for part in parts]
    sheet = Image.new("RGB", (max(part.width for part in parts), parts[0].height + parts[1].height + 6), (255, 0, 255))
    sheet.paste(parts[0], (0, 0))
    sheet.paste(parts[1], (0, parts[0].height + 6))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    result = {"out": out, "zoom": zoom, "width": sheet.width, "height": sheet.height, "layout": "reference above render"}
    if max(sheet.size) > 2000:
        result["warning"] = "larger than 2000 px on a side, so a viewer will shrink it; use a smaller region"
    return result


def run_compare(reference, render, region, axis="x", bg=None, tolerance=8, min_gap=1, slack=1, reach=8, skip=48):
    render_region = clamp_region(region, render.shape)
    if render_region is None:
        raise PPError("region {},{},{},{} is outside the render".format(*region))
    x, y, w, h = region
    color = to_hex(measure.background(reference[y : y + h, x : x + w], bg))
    ours = measure.probe_items(reference, region, axis, color, tolerance, min_gap)
    theirs = measure.probe_items(render, render_region, axis, color, tolerance, min_gap)
    a, b = ours["items"], theirs["items"]
    pairs, only_reference, only_render = pair_items(a, b, axis, skip)
    rows = []
    for i, j in pairs:
        rows.append(
            {
                "x": a[i]["x"], "y": a[i]["y"], "w": a[i]["w"], "h": a[i]["h"],
                "dx": b[j]["x"] - a[i]["x"], "dy": b[j]["y"] - a[i]["y"],
                "dw": b[j]["w"] - a[i]["w"], "dh": b[j]["h"] - a[i]["h"],
                "reference_hex": a[i]["hex"], "render_hex": b[j]["hex"],
            }
        )
    worst = {key: max([abs(row[key]) for row in rows] or [0]) for key in ("dx", "dy", "dw", "dh")}
    result = {
        "region": measure.region_dict(*region),
        "axis": axis,
        "background": color,
        "reference_items": ours["count"],
        "render_items": theirs["count"],
        "aligned": not only_reference and not only_render and max(worst.values()) <= slack,
        "worst": worst,
        "pairs": rows,
        "only_in_reference": [a[i] for i in only_reference],
        "only_in_render": [b[j] for j in only_render],
        "patch_offset": patch_offset(reference, render, region, reach),
    }
    if render_region != tuple(region):
        result["render_region"] = measure.region_dict(*render_region)
        result["note"] = "the render does not cover the whole region; fix its size first"
    return result


def compact(result, scale):
    """The result cut down to what a fix needs, in CSS pixels when a scale is given."""
    divisor = float(scale) if scale and scale != 1 else 1.0

    def lengths(row, keys):
        return {key: num(row[key] / divisor) for key in keys}

    out = {
        "region_px": "{x},{y},{w},{h}".format(**result["region"]),
        "units": "css px" if divisor != 1 else "px",
        "aligned": result["aligned"],
        "worst": lengths(result["worst"], ("dx", "dy", "dw", "dh")),
        "pairs": [lengths(row, ("x", "y", "w", "h", "dx", "dy", "dw", "dh")) for row in result["pairs"]],
    }
    for key in ("only_in_reference", "only_in_render"):
        if result[key]:
            out[key] = [lengths(row, ("x", "y", "w", "h")) for row in result[key]]
    differing = [
        dict(lengths(row, ("x", "y")), reference_hex=row["reference_hex"], render_hex=row["render_hex"])
        for row in result["pairs"]
        if maxdiff(np.array(parse_hex(row["reference_hex"])), parse_hex(row["render_hex"])) > 8
    ]
    out["colors_match"] = not differing
    if differing:
        out["color_differences"] = differing
    offset = result["patch_offset"]
    if offset and (offset["dx"] or offset["dy"]):
        out["patch_offset_px"] = {"dx": offset["dx"], "dy": offset["dy"]}
    if "note" in result:
        out["note"] = result["note"]
    return out


def resolve_item(work_dir, text, iteration=None):
    """The reference and a render of one item of the run: (label, reference, render)."""
    name, _, variant = text.partition("/")
    variant = variant or "default"
    for folder in ("components", "sections", "pages"):
        base = os.path.join(work_dir, folder, name)
        if not os.path.isdir(base):
            continue
        rounds = sorted(
            int(match.group(1))
            for match in (re.match(r"^iter-(\d+)$", entry) for entry in os.listdir(base))
            if match and os.path.isfile(os.path.join(base, match.group(0), variant, "render.png"))
        )
        if not rounds or (iteration and iteration not in rounds):
            continue
        number = iteration or rounds[-1]
        directory = os.path.join(base, "iter-{:02d}".format(number), variant)
        reference = os.path.join(base, "ref", variant + ".png")
        saved = os.path.join(directory, "diff.json")
        if os.path.isfile(saved):
            with open(saved) as handle:
                reference = json.load(handle).get("reference", {}).get("path") or reference
        if not os.path.isfile(reference):
            raise PPError("the reference of {}/{} is not at {}".format(name, variant, reference))
        return "{}/{} iter-{:02d}".format(name, variant, number), reference, os.path.join(directory, "render.png")
    wanted = " at iteration {}".format(iteration) if iteration else ""
    raise PPError("no render of {}/{}{} under {}".format(name, variant, wanted, work_dir))


def labelled(label, image, width):
    """An image under a one-line label."""
    tile = Image.new("RGB", (max(image.width, width), image.height + 14), (32, 32, 32))
    ImageDraw.Draw(tile).text((2, 1), label, fill=(255, 255, 255))
    tile.paste(image, (0, 14))
    return tile


def write_sheet(entries, out):
    """Save several reference-and-render pairs on one sheet, for reading.

    `entries` are (label, reference image, render image). Wide pairs are set
    reference above render and tall ones side by side, enlarged as far as the
    whole sheet stays readable.
    """
    def build(zoom):
        tiles = []
        for label, first, second in entries:
            parts = [part.resize((part.width * zoom, part.height * zoom), Image.NEAREST) for part in (first, second)]
            if parts[0].width > parts[0].height:
                pair = Image.new("RGB", (max(p.width for p in parts), parts[0].height + 6 + parts[1].height), (255, 0, 255))
                pair.paste(parts[0], (0, 0))
                pair.paste(parts[1], (0, parts[0].height + 6))
            else:
                pair = Image.new("RGB", (parts[0].width + 6 + parts[1].width, max(p.height for p in parts)), (255, 0, 255))
                pair.paste(parts[0], (0, 0))
                pair.paste(parts[1], (parts[0].width + 6, 0))
            tiles.append(labelled(label, pair, 6 * len(label) + 4))
        rows, row, used = [], [], 0
        for tile in tiles:
            if row and used + tile.width > READABLE_SIDE:
                rows.append(row)
                row, used = [], 0
            row.append(tile)
            used += tile.width + 10
        rows.append(row)
        width = max(sum(tile.width + 10 for tile in row) - 10 for row in rows)
        height = sum(max(tile.height for tile in row) + 10 for row in rows) - 10
        sheet = Image.new("RGB", (width, height), (96, 96, 96))
        top = 0
        for row in rows:
            left = 0
            for tile in row:
                sheet.paste(tile, (left, top))
                left += tile.width + 10
            top += max(tile.height for tile in row) + 10
        return sheet

    for zoom in (4, 3, 2, 1):
        sheet = build(zoom)
        if max(sheet.size) <= READABLE_SIDE or zoom == 1:
            break
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    result = {"out": out, "zoom": zoom, "width": sheet.width, "height": sheet.height, "pairs": len(entries),
              "layout": "each pair is reference first, then render"}
    if max(sheet.size) > 2000:
        result["warning"] = "larger than 2000 px on a side, so a viewer will shrink it; compare fewer items or smaller regions"
    return result


def main():
    parser = Parser(prog="compare", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("images", nargs="*", metavar="IMAGE", help="a reference and a render of the same thing (or use --item)")
    parser.add_argument("--item", action="append", default=[], metavar="NAME[/VARIANT]",
                        help="an item of the run: its reference and its latest render are found in the working directory (repeatable)")
    parser.add_argument("--iter", type=int, help="with --item: the iteration to read (default: the latest)")
    add_run_arguments(parser)
    parser.add_argument("--region", action="append", default=[],
                        help="x,y,w,h in image pixels, the same in both images (repeatable; default: the whole reference)")
    parser.add_argument("--axis", choices=["x", "y"], default="x", help="direction the items are laid out in")
    parser.add_argument("--bg", help="background color as hex (default: detected in the reference)")
    parser.add_argument("--tolerance", type=int, default=8, help="channel difference that counts as not background")
    parser.add_argument("--min-gap", type=int, default=1, help="gaps narrower than this stay inside one item")
    parser.add_argument("--slack", type=int, default=1, help="largest difference, in image pixels, that still counts as aligned")
    parser.add_argument("--max-offset", type=int, default=8, help="largest whole-region offset to look for, in image pixels")
    parser.add_argument("--pair", metavar="OUT.png", help="also save every compared region of both images on one sheet, for reading")
    parser.add_argument("--zoom", type=int, help="enlargement of the --pair image when one region is compared (default: as large as stays readable)")
    parser.add_argument("--scale", type=float, default=1.0, help="design pixel density; the numbers are then CSS pixels")
    parser.add_argument("--full", action="store_true", help="print every detail, in image pixels and in CSS pixels")
    parser.add_argument("--json", action="store_true", help="print JSON instead of TOON")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the arguments and report what would run, without measuring or writing")
    args = parser.parse_args()

    if args.item and args.images:
        raise PPError("give two images or --item, not both")
    if args.item:
        work_dir = run_dir(args)
        sources = [resolve_item(work_dir, text, args.iter) for text in args.item]
    elif len(args.images) == 2:
        sources = [(None, args.images[0], args.images[1])]
    else:
        raise PPError("give a reference and a render, or at least one --item")
    if args.zoom is not None and args.zoom < 1:
        raise PPError("--zoom must be 1 or more")

    jobs = []
    for label, reference_path, render_path in sources:
        reference, _ = load_rgb(reference_path)
        render, _ = load_rgb(render_path)
        for text in args.region or [None]:
            wanted = tuple(parse_ints(text, 4, "region")) if text else full_region(reference.shape)
            region = clamp_region(wanted, reference.shape)
            if region is None or wanted[2] <= 0 or wanted[3] <= 0:
                raise PPError("region {} is outside the {}x{} reference".format(text, reference.shape[1], reference.shape[0]))
            jobs.append((label, reference_path, render_path, reference, render, region, region != wanted))
    if args.dry:
        emit({"dry_run": True,
              "compares": [{"reference": job[1], "render": job[2], "region": "{},{},{},{}".format(*job[5])} for job in jobs],
              "writes": [args.pair] if args.pair else []}, args.json)
        return 0

    skip = int(round(48 * max(1.0, args.scale)))
    results = []
    for label, reference_path, render_path, reference, render, region, clamped in jobs:
        result = run_compare(reference, render, region, args.axis, args.bg, args.tolerance, args.min_gap,
                             args.slack, args.max_offset, skip)
        if clamped:
            result["note"] = "the region was cut to fit the reference; " + result.get("note", "check its numbers")
        shown = with_css(result, args.scale) if args.full else compact(result, args.scale)
        if label:
            shown = dict({"item": label}, **shown)
        results.append(shown)
    output = results[0] if len(results) == 1 else {"compared": len(results), "aligned": all(r["aligned"] for r in results), "results": results}
    if args.pair:
        if len(jobs) == 1:
            _, _, _, reference, render, region, _ = jobs[0]
            output["pair"] = write_pair(reference, render, region, clamp_region(region, render.shape), args.pair, args.zoom)
        else:
            entries = []
            for label, _, _, reference, render, (x, y, w, h), _ in jobs:
                rx, ry, rw, rh = clamp_region((x, y, w, h), render.shape)
                name = "{} {},{},{},{}".format(label or "", x, y, w, h).strip()
                entries.append((name, Image.fromarray(reference[y : y + h, x : x + w]), Image.fromarray(render[ry : ry + rh, rx : rx + rw])))
            output["pair"] = write_sheet(entries, args.pair)
    emit(output, args.json)
    return 0


if __name__ == "__main__":
    run_cli(main)
