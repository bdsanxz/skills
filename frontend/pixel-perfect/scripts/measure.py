"""Measurement probes for a UI design image (or a render of it).

Every coordinate and length is in image pixels. Pass --scale to also get the
lengths in points. Regions are 'x,y,w,h' with the origin at the top left.
"""
import argparse
import math
import os

import numpy as np
from PIL import Image

from pp_common import (
    PPError,
    border_pixels,
    color_counts,
    dominant_color,
    emit,
    full_region,
    is_subs,
    in_points,
    load_rgb,
    maxdiff,
    num,
    parse_hex,
    parse_ints,
    parse_region,
    run_cli,
    runs_of,
    subs_path,
    superseded_by,
    to_hex,
    with_points,
)

COMMON_WIDTHS = frozenset(
    [320, 360, 375, 390, 393, 402, 412, 414, 428, 430, 440, 744, 768, 810, 820, 834,
     1024, 1280, 1366, 1440, 1512, 1536, 1600, 1680, 1728, 1920]
)
# Device scale factors that are not whole numbers but do occur on real screens.
FRACTIONAL_SCALES = (1.25, 1.5, 1.75, 2.5, 2.625, 2.75)
MAX_ROWS = 300


def region_of(arr, text):
    return parse_region(text, arr.shape) if text else full_region(arr.shape)


def background(sub, explicit):
    """Background of a region: the given color, or the dominant perimeter color."""
    if explicit:
        return parse_hex(explicit)
    return dominant_color(border_pixels(sub))[0]


def region_dict(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


# --- info -------------------------------------------------------------------


def flat_flanked_edges(line, flank=4, contrast=96):
    """Widths of the strong edges on a line that sit between two flat runs.

    These are box, rule and glyph edges on a plain backdrop, the edges a
    1:1 render draws within one pixel. Edges inside photos or gradients have no
    flat run on either side and are left out.
    """
    groups = line_edges(line, 8)
    widths = []
    for index, (first, last) in enumerate(groups):
        before_start = groups[index - 1][1] if index else 0
        after_end = groups[index + 1][0] if index + 1 < len(groups) else len(line)
        if first - before_start < flank or after_end - last < flank:
            continue
        before, after = line[first - flank : first], line[last : last + flank]
        if np.abs(before - before[0]).max() > 2 or np.abs(after - after[0]).max() > 2:
            continue
        if np.abs(line[last] - line[first - 1]).max() >= contrast:
            widths.append(last - first)
    return widths


def source_quality(arr, lines=160, minimum=30):
    """Whether the image's edges are as sharp as a 1:1 render draws them.

    A 1:1 lossless export blends an edge over at most one pixel. An image
    that was rescaled or saved lossy blends it over two or more, and then
    text and thin shapes cannot match a render pixel for pixel.
    """
    h, w = arr.shape[:2]
    widths = []
    for row in np.unique(np.linspace(0, h - 1, min(h, lines)).astype(int)):
        widths += flat_flanked_edges(arr[row].astype(np.float64))
    for col in np.unique(np.linspace(0, w - 1, min(w, lines)).astype(int)):
        widths += flat_flanked_edges(arr[:, col].astype(np.float64))
    result = {"edges_sampled": len(widths)}
    if len(widths) < minimum:
        result.update({"quality": "unknown", "note": "too few clean edges to judge; inspect a zoomed crop of some text"})
        return result
    widths = np.asarray(widths)
    sharp = float((widths <= 1).mean())
    result["sharp_edge_share"] = num(sharp, 3)
    result["crisp_edge_share"] = num(float((widths == 0).mean()), 3)
    result["mean_edge_px"] = num(float(widths.mean()), 2)
    if sharp >= 0.6:
        result["quality"] = "sharp"
        result["note"] = "edges are within one pixel, as in a 1:1 lossless export"
    elif sharp < 0.5:
        result["quality"] = "soft"
        result["note"] = (
            "edges are blended over two or more pixels: the image looks rescaled or lossy, "
            "so text and thin shapes will not match a render pixel for pixel"
        )
    else:
        result["quality"] = "uncertain"
        result["note"] = "edge sharpness is borderline; inspect a zoomed crop of some text before relying on it"
    return result


def probe_info(arr, has_alpha, screen_width=None):
    h, w = arr.shape[:2]
    result = {"width": w, "height": h, "has_alpha": has_alpha}
    if screen_width:
        result["scale_guess"] = num(w / screen_width)
        result["ambiguous"] = False
        result["reason"] = "image width divided by the stated screen width"
        result["source"] = source_quality(arr)
        return result
    candidates = []
    for scale in (1, 2, 3):
        if w % scale == 0:
            candidates.append(
                {
                    "scale": scale,
                    "points_width": w // scale,
                    "points_height": num(h / scale),
                    "common_screen": (w // scale) in COMMON_WIDTHS,
                }
            )
    matching = [c["scale"] for c in candidates if c["common_screen"]]
    if not matching:
        # Whole-number scales explain nothing; try the fractional ones screens use.
        for scale in FRACTIONAL_SCALES:
            points_width = w / scale
            if abs(points_width - round(points_width)) < 0.01 and int(round(points_width)) in COMMON_WIDTHS:
                candidates.append(
                    {"scale": scale, "points_width": int(round(points_width)), "points_height": num(h / scale), "common_screen": True}
                )
        fractional = [c["scale"] for c in candidates if c["common_screen"]]
    else:
        fractional = []
    if len(matching) == 1:
        guess, ambiguous = matching[0], False
        reason = "only this scale gives a common screen width"
    elif matching:
        guess, ambiguous = matching[0], True
        reason = "several scales give a common screen width"
    elif fractional:
        guess, ambiguous = fractional[0], True
        reason = "only a fractional scale gives a common screen width; confirm it with the user"
    else:
        guess, ambiguous = 1, True
        reason = (
            "no scale gives a common screen width; the image may be a rescaled screenshot "
            "or not a full screen"
        )
    result.update({"scale_guess": guess, "ambiguous": ambiguous, "reason": reason, "candidates": candidates})
    result["source"] = source_quality(arr)
    return result


# --- color ------------------------------------------------------------------


def probe_color_at(arr, x, y):
    h, w = arr.shape[:2]
    if not (0 <= x < w and 0 <= y < h):
        raise PPError("point {},{} is outside the {}x{} image".format(x, y, w, h))
    r, g, b = (int(c) for c in arr[y, x])
    return {"x": x, "y": y, "hex": to_hex((r, g, b)), "rgb": [r, g, b]}


def probe_color_region(arr, region, flat_tolerance=2, top=5):
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w]
    colors, counts = color_counts(sub)
    total = float(counts.sum())
    near = float((maxdiff(sub, colors[0]) <= flat_tolerance).sum()) / total
    return {
        "region": region_dict(x, y, w, h),
        "dominant": to_hex(colors[0]),
        "dominant_share": num(counts[0] / total, 4),
        "flat": near >= 0.98,
        "share_within_tolerance": num(near, 4),
        "mean": to_hex(sub.reshape(-1, 3).mean(axis=0)),
        "distinct_colors": len(colors),
        "top": [{"hex": to_hex(c), "share": num(n / total, 4)} for c, n in zip(colors[:top], counts[:top])],
    }


# --- edges ------------------------------------------------------------------


def line_edges(line, threshold):
    """Group adjacent color changes along a line into edges.

    Returns [start, end] index pairs. `start` is the first pixel that differs
    from the run before it, `end` the first pixel of the settled new color.
    """
    step = np.abs(np.diff(line, axis=0)).max(axis=1)
    groups = []
    for index in (np.nonzero(step > threshold)[0] + 1).tolist():
        if groups and index - groups[-1][1] <= 1:
            groups[-1][1] = index
        else:
            groups.append([index, index])
    return groups


def edge_position(line, start, end):
    """Sub-pixel edge position from the coverage of the blended pixels."""
    before, after = line[start - 1], line[end]
    span = float(np.abs(after - before).sum())
    if span == 0:
        return float(start)
    position = float(start)
    for index in range(start, end):
        coverage = float(np.abs(line[index] - before).sum()) / span
        position += 1.0 - min(1.0, max(0.0, coverage))
    return position


def probe_edges(arr, row=None, col=None, start=None, end=None, band=1, threshold=8):
    h, w = arr.shape[:2]
    if (row is None) == (col is None):
        raise PPError("give exactly one of --row or --col")
    horizontal = row is not None
    fixed, limit, length = (row, h, w) if horizontal else (col, w, h)
    if not 0 <= fixed < limit:
        raise PPError("line {} is outside the image".format(fixed))
    a = 0 if start is None else max(0, start)
    b = length if end is None else min(length, end)
    if b - a < 2:
        raise PPError("the scan range must cover at least 2 pixels")
    lo = max(0, fixed - (band - 1) // 2)
    hi = min(limit, lo + band)
    strip = arr[lo:hi, a:b] if horizontal else arr[a:b, lo:hi].transpose(1, 0, 2)
    line = strip.astype(np.float64).mean(axis=0)

    groups = line_edges(line, threshold)
    edges = []
    for first, last in groups[:MAX_ROWS]:
        edges.append(
            {
                "pos": a + first,
                "at": num(a + edge_position(line, first, last), 2),
                "soft_px": last - first,
                "from": to_hex(line[first - 1]),
                "to": to_hex(line[last]),
            }
        )
    ends = [g[0] for g in groups] + [len(line)]
    starts = [0] + [g[1] for g in groups]
    runs = []
    for run_start, run_end in list(zip(starts, ends))[:MAX_ROWS]:
        if run_end <= run_start:
            continue
        middle = line[(run_start + run_end) // 2]
        drift = float(np.abs(line[run_start:run_end] - middle).max())
        runs.append(
            {
                "start": a + run_start,
                "end": a + run_end,
                "size": run_end - run_start,
                "hex": to_hex(middle),
                "drift": num(drift, 1),
            }
        )
    return {
        "axis": "x" if horizontal else "y",
        "line": fixed,
        "range": {"start": a, "end": b},
        "edge_count": len(groups),
        "truncated": len(groups) > MAX_ROWS,
        "edges": edges,
        "runs": runs,
    }


# --- bbox / spans / grid ----------------------------------------------------


def content_mask(arr, region, bg, tolerance):
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w]
    color = background(sub, bg)
    return maxdiff(sub, color) > tolerance, color


def probe_bbox(arr, region, bg=None, tolerance=8):
    x, y, w, h = region
    mask, color = content_mask(arr, region, bg, tolerance)
    result = {"region": region_dict(x, y, w, h), "background": to_hex(color), "found": bool(mask.any())}
    if not result["found"]:
        return result
    rows = np.nonzero(mask.any(axis=1))[0]
    cols = np.nonzero(mask.any(axis=0))[0]
    left, right = int(cols[0]), int(cols[-1]) + 1
    top, bottom = int(rows[0]), int(rows[-1]) + 1
    result["bbox"] = region_dict(x + left, y + top, right - left, bottom - top)
    result["insets"] = {"left": left, "top": top, "right": w - right, "bottom": h - bottom}
    result["content_pixels"] = int(mask.sum())
    return result


def merged_spans(mask_1d, min_gap):
    spans = []
    for start, end in runs_of(mask_1d):
        if spans and start - spans[-1][1] < min_gap:
            spans[-1][1] = end
        else:
            spans.append([start, end])
    return spans


def uniform(values, slack=1):
    """The median when every value is within `slack` of it, else None."""
    if not values:
        return None
    median = float(np.median(values))
    if all(abs(v - median) <= slack for v in values):
        return num(median, 1)
    return None


def span_summary(spans, offset):
    sizes = [end - start for start, end in spans]
    gaps = [spans[i + 1][0] - spans[i][1] for i in range(len(spans) - 1)]
    pitches = [spans[i + 1][0] - spans[i][0] for i in range(len(spans) - 1)]
    return {
        "count": len(spans),
        "spans": [{"start": offset + s, "end": offset + e, "size": e - s} for s, e in spans[:MAX_ROWS]],
        "gaps": gaps[:MAX_ROWS],
        "uniform_size": uniform(sizes),
        "uniform_gap": uniform(gaps),
        "pitch": uniform(pitches),
    }


def probe_spans(arr, region, axis, bg=None, tolerance=8, min_gap=1):
    x, y, w, h = region
    mask, color = content_mask(arr, region, bg, tolerance)
    profile = mask.any(axis=0) if axis == "x" else mask.any(axis=1)
    result = {"region": region_dict(x, y, w, h), "axis": axis, "background": to_hex(color)}
    result.update(span_summary(merged_spans(profile, min_gap), x if axis == "x" else y))
    return result


def probe_grid(arr, region, bg=None, tolerance=8, min_gap=1):
    x, y, w, h = region
    mask, color = content_mask(arr, region, bg, tolerance)
    columns = span_summary(merged_spans(mask.any(axis=0), min_gap), x)
    rows = span_summary(merged_spans(mask.any(axis=1), min_gap), y)
    return {
        "region": region_dict(x, y, w, h),
        "background": to_hex(color),
        "columns": columns["count"],
        "rows": rows["count"],
        "column_width": columns["uniform_size"],
        "gutter": columns["uniform_gap"],
        "row_height": rows["uniform_size"],
        "row_gap": rows["uniform_gap"],
        "column_spans": columns["spans"],
        "row_spans": rows["spans"],
    }


def half_contrast_inset(profile, reach=6):
    """How far inside a box's first pixel its edge really is.

    `profile` runs inward from the first pixel that differs from the
    background. A crisp edge is at full contrast at once: inset 0. A blended
    edge climbs over a few pixels, and the edge is where it passes half of
    the level it climbs to. Read this way, the same box measures the same
    whether its image is sharp or soft.
    """
    limit = min(reach, len(profile) - 1)
    top = 0
    while top < limit and profile[top + 1] > profile[top]:
        top += 1
    half = 0.5 * float(profile[top])
    inset = 0
    while inset < top and profile[inset] < half:
        inset += 1
    return inset


def probe_items(arr, region, axis="x", bg=None, tolerance=8, min_gap=1):
    """The separate items along one axis of a band, each with its tight box.

    Items are found with `tolerance`; each side of an item's box is then put
    where that edge passes half of its own contrast.
    """
    x, y, w, h = region
    mask, color = content_mask(arr, region, bg, tolerance)
    sub = arr[y : y + h, x : x + w]
    distance = maxdiff(sub, color)
    along_x = axis == "x"
    spans = merged_spans(mask.any(axis=0) if along_x else mask.any(axis=1), min_gap)
    items = []
    for start, end in spans:
        window = (slice(None), slice(start, end)) if along_x else (slice(start, end), slice(None))
        part, depth = mask[window], distance[window]
        rows = np.nonzero(part.any(axis=1))[0]
        cols = np.nonzero(part.any(axis=0))[0]
        left, top, right, bottom = int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1
        strength = np.where(part, depth, 0)[top:bottom, left:right]
        across, down = strength.max(axis=0), strength.max(axis=1)
        left += half_contrast_inset(across)
        right -= half_contrast_inset(across[::-1])
        top += half_contrast_inset(down)
        bottom -= half_contrast_inset(down[::-1])
        ink = np.median(sub[window][depth >= 0.9 * depth.max()], axis=0)
        items.append(
            {
                "x": x + (start if along_x else 0) + left,
                "y": y + (0 if along_x else start) + top,
                "w": max(1, right - left),
                "h": max(1, bottom - top),
                "hex": to_hex(ink),
            }
        )
    return {
        "region": region_dict(x, y, w, h),
        "axis": axis,
        "background": to_hex(color),
        "count": len(items),
        "truncated": len(items) > MAX_ROWS,
        "items": items[:MAX_ROWS],
        "gaps": [
            (items[i + 1]["x"] - items[i]["x"] - items[i]["w"]) if along_x else (items[i + 1]["y"] - items[i]["y"] - items[i]["h"])
            for i in range(len(items) - 1)
        ][:MAX_ROWS],
    }


# --- crop / zoom ------------------------------------------------------------

READABLE_SIDE = 1600


def probe_crop(path, arr, region, out):
    x, y, w, h = region
    directory = os.path.dirname(os.path.abspath(out))
    os.makedirs(directory, exist_ok=True)
    with Image.open(path) as image:
        image.crop((x, y, x + w, y + h)).save(out)
    return {"region": region_dict(x, y, w, h), "out": out, "width": w, "height": h}


BLANK_FILL = (128, 128, 128)


def ui_mask(arr, box, color, tolerance):
    """Pixels of a box that belong to UI of the given fill color, grown by one pixel to take its soft edge."""
    x, y, w, h = box
    mask = maxdiff(arr[y : y + h, x : x + w], color) <= tolerance
    grown = mask.copy()
    grown[1:] |= mask[:-1]
    grown[:-1] |= mask[1:]
    grown[:, 1:] |= mask[:, :-1]
    grown[:, :-1] |= mask[:, 1:]
    return grown


def probe_crops(path, arr, items, out_dir, blanks=(), blank_tolerance=60):
    """Save several named regions at once and list them as inventory asset rows.

    A blank is (name, box, color, origin): UI of that fill color which the design draws on top of
    crop `name`, inside `box` (in the design's own pixels), and which the code will draw itself.
    Its pixels are painted a neutral gray, so the UI is not also baked into the file, and a blank
    the code-built UI fails to cover shows in the diff. `origin` is the top left of the same UI
    somewhere else in the design where it stands out better from what is behind it; its shape is
    then read there.
    """
    boxes = dict(items)
    for name, (bx, by, bw, bh), _, origin in blanks:
        if name not in boxes:
            raise PPError("--blank names '{}', which is not one of the --item crops".format(name))
        x, y, w, h = boxes[name]
        if bx < x or by < y or bx + bw > x + w or by + bh > y + h:
            raise PPError("blank {},{},{},{} is not inside crop '{}' ({},{},{},{})".format(bx, by, bw, bh, name, x, y, w, h))
        if origin and (origin[0] < 0 or origin[1] < 0 or origin[0] + bw > arr.shape[1] or origin[1] + bh > arr.shape[0]):
            raise PPError("blank for '{}': the box at {},{} to read the shape from is outside the image".format(name, *origin))
    os.makedirs(out_dir, exist_ok=True)
    rows, patched = [], []
    with Image.open(path) as image:
        for name, (x, y, w, h) in items:
            target = os.path.join(out_dir, name + ".png")
            crop = image.crop((x, y, x + w, y + h))
            own = [blank for blank in blanks if blank[0] == name]
            if own:
                pixels = np.array(crop.convert("RGBA" if "A" in crop.getbands() else "RGB"))
                for _, (bx, by, bw, bh), color, origin in own:
                    mask = ui_mask(arr, (origin[0], origin[1], bw, bh) if origin else (bx, by, bw, bh), color, blank_tolerance)
                    if not mask.any():
                        raise PPError("blank for '{}': no pixel of {} in that box; check the box and the color".format(name, to_hex(color)))
                    part = pixels[by - y : by - y + bh, bx - x : bx - x + bw]
                    part[mask, :3] = BLANK_FILL
                    if part.shape[2] == 4:
                        part[mask, 3] = 255
                    patched.append({"asset": name, "x": bx, "y": by, "w": bw, "h": bh, "ui_hex": to_hex(color),
                                    "pixels": int(mask.sum()), "share_pct": num(100.0 * mask.mean()),
                                    "shape_from": "{},{}".format(*origin) if origin else None})
                crop = Image.fromarray(pixels)
            crop.save(target)
            rows.append({"id": name, "source": "blanked crop" if own else "crop", "x": x, "y": y, "w": w, "h": h, "file": target})
    result = {"image": path, "count": len(rows), "assets": rows}
    if patched:
        result["blanks"] = patched
        result["note"] = ("blanked pixels are gray: each must end up under UI the code draws, or it shows in the diff. "
                          "Read each file once, and record these rows in the inventory and the report")
    return result


ANCHORS = ("tl", "tr", "bl", "br")


def overlaps(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def save_unchanged(image, out):
    """Save so that no pixel changes where the format allows it. Returns whether it did."""
    ext = os.path.splitext(out)[1].lower()
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    if ext in (".jpg", ".jpeg"):
        image.convert("RGB").save(out, quality=100, subsampling=0)
        return False
    if ext == ".webp":
        image.save(out, lossless=True)
    else:
        image.save(out)
    return True


def substitute_preview(original, edited, swaps, out):
    """Each slot before and after, with its surroundings, on one sheet for reading."""
    gap, parts = 10, []
    for _, _, (dx, dy, dw, dh), _ in swaps:
        margin = max(24, min(dw, dh) // 2)
        frame = (max(0, dx - margin), max(0, dy - margin), min(original.width, dx + dw + margin), min(original.height, dy + dh + margin))
        parts.append((original.crop(frame).convert("RGB"), edited.crop(frame).convert("RGB")))
    width = max(before.width for before, _ in parts) * 2 + gap
    height = sum(before.height for before, _ in parts) + gap * (len(parts) - 1)
    sheet = Image.new("RGB", (width, height), (255, 0, 255))
    top, rows = 0, []
    for (name, _, _, _), (before, after) in zip(swaps, parts):
        sheet.paste(before, (0, top))
        sheet.paste(after, (before.width + gap, top))
        rows.append({"id": name, "sheet_y": top, "h": before.height})
        top += before.height + gap
    shrink = max(1, math.ceil(max(sheet.size) / READABLE_SIDE))
    if shrink > 1:
        sheet = sheet.resize((sheet.width // shrink, sheet.height // shrink), Image.LANCZOS)
        rows = [{"id": row["id"], "sheet_y": row["sheet_y"] // shrink, "h": row["h"] // shrink} for row in rows]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    return {"file": out, "shrunk_by": shrink, "rows": rows,
            "note": "left: the design; right: the copy. Read every row: the slot must show only the substitute, "
                    "on the same backdrop, with nothing carried in from behind or on top of it"}


def probe_substitute(path, arr, swaps, out=None, preview=None):
    """Write a copy of the design in which each cut-off image is replaced by a complete one.

    A swap is (name, source box, slot box, anchor). The slot is the visible part of an image the
    design cuts off, such as the last item of a carousel. The source is a complete image of the same
    kind elsewhere in the same design. The source is pasted into the slot, clipped to the slot, with
    the named corner of both aligned: "tl" when the slot shows the image's left or top part, "tr"
    when it shows the right part. Nothing outside the slots changes. Every call starts from the
    original design, so it lists all of the design's swaps.
    """
    if is_subs(path):
        raise PPError("'{}' is already a substituted copy: give the original design and list every swap in one call".format(path))
    out = out or subs_path(path)
    rows = []
    for index, (name, source, slot, _) in enumerate(swaps):
        if source[2] < slot[2] or source[3] < slot[3]:
            raise PPError("swap '{}': the source {}x{} is smaller than the slot {}x{}".format(name, source[2], source[3], slot[2], slot[3]))
        if overlaps(source, slot):
            raise PPError("swap '{}': the source box overlaps the slot; the source is a complete image elsewhere in the design".format(name))
        for other, _, taken, _ in swaps[:index]:
            if overlaps(slot, taken):
                raise PPError("swaps '{}' and '{}' fill overlapping slots".format(other, name))
    with Image.open(path) as image:
        edited = image.copy()
        for name, (sx, sy, sw, sh), (dx, dy, dw, dh), anchor in swaps:
            left = sx + (sw - dw if anchor in ("tr", "br") else 0)
            top = sy + (sh - dh if anchor in ("bl", "br") else 0)
            edited.paste(image.crop((left, top, left + dw, top + dh)), (dx, dy))
            rows.append({"id": name, "from_x": sx, "from_y": sy, "from_w": sw, "from_h": sh,
                         "slot_x": dx, "slot_y": dy, "slot_w": dw, "slot_h": dh, "anchor": anchor})
        exact = save_unchanged(edited, out)
        result = {"image": path, "out": out, "count": len(rows), "substitutions": rows}
        if preview:
            result["preview"] = substitute_preview(image, edited, swaps, preview)
    if not exact:
        result["warning"] = "this format cannot be saved without loss, so pixels outside the slots changed slightly; pass --out <name>.subs.png to keep them exact"
    result["note"] = "use the out file as the design from here on: for every probe, crop, reference and page check"
    return result


def probe_zoom(path, arr, regions, out, factor=None):
    """Enlarged copies of one or more regions on one sheet, for reading small details by eye."""
    gap = 10
    widest = max(w for _, _, w, _ in regions)
    tall = sum(h for _, _, _, h in regions)
    if factor is None:
        factor = max(1, min(8, READABLE_SIDE // widest, (READABLE_SIDE - gap * (len(regions) - 1)) // tall))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet = Image.new("RGB", (widest * factor, tall * factor + gap * (len(regions) - 1)), (255, 0, 255))
    top, placed = 0, []
    with Image.open(path) as image:
        source = image.convert("RGB")
        for x, y, w, h in regions:
            part = source.crop((x, y, x + w, y + h)).resize((w * factor, h * factor), Image.NEAREST)
            sheet.paste(part, (0, top))
            placed.append({"x": x, "y": y, "w": w, "h": h, "sheet_y": top})
            top += part.height + gap
    sheet.save(out)
    result = {
        "out": out,
        "factor": factor,
        "width": sheet.width,
        "height": sheet.height,
        "regions": placed,
        "note": "for reading only: not an asset, not a reference, and coordinates come from probes, not from this picture",
    }
    if max(sheet.size) > 2000:
        result["warning"] = "larger than 2000 px on a side, so a viewer will shrink it; use smaller or fewer regions"
    return result


# --- outline ----------------------------------------------------------------


def simplify_line(points, epsilon):
    """Drop the points of a polyline that lie within `epsilon` of the line through their neighbours."""
    if len(points) < 3:
        return list(points)
    pts = np.asarray(points, dtype=np.float64)
    keep = {0, len(pts) - 1}
    stack = [(0, len(pts) - 1)]
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        direction = pts[last] - pts[first]
        norm = float(np.hypot(*direction)) or 1.0
        inner = pts[first + 1 : last]
        distance = np.abs(direction[0] * (inner[:, 1] - pts[first, 1]) - direction[1] * (inner[:, 0] - pts[first, 0])) / norm
        worst = int(distance.argmax())
        if distance[worst] > epsilon:
            split = first + 1 + worst
            keep.add(split)
            stack.extend([(first, split), (split, last)])
    return [points[index] for index in sorted(keep)]


def bridge_dents(values, rows, outward):
    """Fill dents of up to `rows` rows in an edge, leaving the edge itself as it is.

    Text or an icon lying across a shape's edge cuts that row's run short, so
    the edge reads too far inside the shape there. `outward` is +1 when a
    larger value is further out (a right edge) and -1 for a left edge.
    """
    half = rows // 2
    series = np.asarray(values, dtype=np.float64) * outward
    window = 2 * half + 1
    # Raise over a window, then lower over the same window. The raised series
    # is kept half a window longer at each end, so the ends come back unchanged.
    raised = np.lib.stride_tricks.sliding_window_view(np.pad(series, 2 * half, constant_values=-np.inf), window).max(axis=1)
    closed = np.lib.stride_tricks.sliding_window_view(raised, window).min(axis=1)
    # Rows the closing pushed outward are the dented ones. Redraw them on the
    # straight line between the sound rows on either side.
    dented = closed - series > 0.5
    if dented.all():
        return list(values)
    index = np.arange(len(series))
    series[dented] = np.interp(index[dented], index[~dented], series[~dented])
    return (series * outward).tolist()


def probe_outline(arr, region, color=None, bg=None, tolerance=8, min_run=8, epsilon=0.6, scale=1.0, bridge=0):
    """Trace a filled shape into an SVG path, so it is drawn as a vector and not cropped.

    Each row contributes the left end of its first solid run and the right end
    of its last one, so the shape must not be hollow or have notches cut into
    its left or right side.
    """
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w]
    if color:
        mask = maxdiff(sub, parse_hex(color)) <= tolerance
    else:
        mask = maxdiff(sub, background(sub, bg)) > tolerance
    left, right, split_rows = [], [], 0
    for row in range(h):
        runs = [(a, b) for a, b in runs_of(mask[row]) if b - a >= min_run]
        if not runs:
            continue
        split_rows += len(runs) > 1
        left.append((float(runs[0][0]), row + 0.5))
        right.append((float(runs[-1][1]), row + 0.5))
    result = {"region": region_dict(x, y, w, h), "found": bool(left)}
    if not left:
        return result
    if bridge > 1:
        repaired = 0
        for edge, outward in ((left, -1), (right, 1)):
            fixed = bridge_dents([px for px, _ in edge], bridge, outward)
            repaired += sum(1 for (px, _), value in zip(edge, fixed) if abs(px - value) > 0.5)
            edge[:] = [(value, py) for (_, py), value in zip(edge, fixed)]
        result["bridged_rows"] = repaired
    points = simplify_line(left, epsilon) + simplify_line(right, epsilon)[::-1]

    def path(divisor):
        return "M" + " L".join("{:g} {:g}".format(round(px / divisor, 2), round(py / divisor, 2)) for px, py in points) + "Z"

    result.update(
        {
            "rows": len(left),
            "vertices": len(points),
            "split_rows": int(split_rows),
            "viewbox": "0 0 {} {}".format(w, h),
            "path": path(1.0),
        }
    )
    if scale and scale != 1:
        result["scale"] = num(scale)
        result["points"] = {"viewbox": "0 0 {:g} {:g}".format(w / scale, h / scale), "path": path(float(scale))}
    if split_rows:
        result["note"] = "{} rows hold more than one solid run: the shape is hollow or notched there and the path bridges it".format(split_rows)
    return result


# --- radius -----------------------------------------------------------------

CORNERS = ("tl", "tr", "bl", "br")


def first_true(mask, axis):
    """Index of the first True along an axis, or the axis length when none."""
    found = mask.any(axis=axis)
    return np.where(found, mask.argmax(axis=axis), mask.shape[axis])


def corner_radius(corner, bg=None):
    """Radius of a top-left oriented corner block, from its missing area.

    The color outside the shape is read from the block's own outer corner
    pixel, so a shadow that tints each corner differently does not matter.
    Returns (radius, fit error, contrast between the edge and the outside).
    """
    size = corner.shape[0]
    outside = corner[0, 0] if bg is None else bg
    distance = maxdiff(corner, outside)
    contrast = max(int(distance[0, -1]), int(distance[-1, 0]))
    if contrast <= 3:
        return 0.0, 0.0, contrast, outside
    mask = distance >= max(2.0, 0.5 * contrast)
    row_insets = first_true(mask, axis=1).astype(np.float64)
    col_insets = first_true(mask, axis=0).astype(np.float64)
    area = (row_insets.sum() + col_insets.sum()) / 2.0
    radius = min(float(size), math.sqrt(area / (1.0 - math.pi / 4.0))) if area > 0 else 0.0
    offsets = radius - (np.arange(size) + 0.5)
    model = np.where(offsets > 0, radius - np.sqrt(np.maximum(radius**2 - offsets**2, 0.0)), 0.0)
    error = math.sqrt(float((((row_insets - model) ** 2).mean() + ((col_insets - model) ** 2).mean()) / 2.0))
    return radius, error, contrast, outside


def probe_radius(arr, region, bg=None):
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w]
    color = parse_hex(bg) if bg else None
    size = max(1, min(w, h) // 2)
    oriented = {"tl": sub, "tr": sub[:, ::-1], "bl": sub[::-1], "br": sub[::-1, ::-1]}
    corners, radii = [], []
    for name in CORNERS:
        radius, error, contrast, outside = corner_radius(oriented[name][:size, :size], color)
        radii.append(radius)
        corners.append(
            {
                "corner": name,
                "radius": num(radius, 1),
                "fit_error": num(error, 2),
                "contrast": contrast,
                "outside": to_hex(outside),
            }
        )
    return {
        "region": region_dict(x, y, w, h),
        "corners": corners,
        "radius": num(float(np.median(radii)), 1),
        "uniform": max(radii) - min(radii) <= 1.0,
        "pill": min(radii) >= min(w, h) / 2.0 - 1.0,
    }


# --- border -----------------------------------------------------------------


def inward_line(sub, side, fraction, depth):
    """Colors from one side of a box inward, averaged over a 3 px band."""
    h, w = sub.shape[:2]
    if side in ("top", "bottom"):
        center = min(w - 1, max(0, int(round(fraction * (w - 1)))))
        strip = sub[:, max(0, center - 1) : center + 2].astype(np.float64).mean(axis=1)
    else:
        center = min(h - 1, max(0, int(round(fraction * (h - 1)))))
        strip = sub[max(0, center - 1) : center + 2].astype(np.float64).mean(axis=0)
    if side in ("bottom", "right"):
        strip = strip[::-1]
    return strip[:depth]


def probe_border(arr, region, tolerance=8, max_width=12):
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w]
    depth = max(2, min(w, h) // 2)
    sides, widths = [], []
    for side in ("top", "right", "bottom", "left"):
        samples = []
        for fraction in (0.2, 0.5, 0.8):
            line = inward_line(sub, side, fraction, depth)
            groups = line_edges(line, tolerance)
            if groups and groups[0][0] <= max_width:
                first, last = groups[0]
                samples.append((first, to_hex(line[first // 2]), to_hex(line[last])))
            else:
                samples.append((0, None, to_hex(line[0])))
        samples.sort(key=lambda sample: sample[0])
        width, color, inner = samples[1]
        widths.append(width)
        sides.append({"side": side, "width": width, "color": color, "inner": inner})
    return {
        "region": region_dict(x, y, w, h),
        "has_border": any(width > 0 for width in widths),
        "uniform": len(set(widths)) == 1 and len(set(s["color"] for s in sides)) == 1,
        "sides": sides,
    }


# --- gradient ---------------------------------------------------------------


def simplify_profile(offsets, colors, epsilon=1.5):
    """Keep the profile points needed to stay within `epsilon` color levels."""
    keep = [0, len(offsets) - 1]
    stack = [(0, len(offsets) - 1)]
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        inner = np.arange(first + 1, last)
        weight = ((offsets[inner] - offsets[first]) / (offsets[last] - offsets[first]))[:, None]
        expected = colors[first] + weight * (colors[last] - colors[first])
        deviation = np.abs(colors[inner] - expected).max(axis=1)
        worst = int(deviation.argmax())
        if deviation[worst] > epsilon:
            split = first + 1 + worst
            keep.append(split)
            stack.extend([(first, split), (split, last)])
    return sorted(set(keep))


def fill_mask(sub, ignore, tolerance, margin=3):
    """Pixels of a fill, leaving out the given colors and a margin around them.

    Text drawn on a gradient, or the page showing around a shape that is not a
    rectangle, would otherwise be read as part of the gradient.
    """
    keep = np.ones(sub.shape[:2], dtype=bool)
    for color in ignore:
        keep &= maxdiff(sub, parse_hex(color)) > tolerance
    padded = np.pad(keep, margin, mode="edge")
    core = np.ones_like(keep)
    for dy in range(2 * margin + 1):
        for dx in range(2 * margin + 1):
            core &= padded[dy : dy + keep.shape[0], dx : dx + keep.shape[1]]
    return core


def probe_gradient(arr, region, ignore=(), ignore_tolerance=60):
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w].astype(np.float64)
    result = {"region": region_dict(x, y, w, h)}
    keep = fill_mask(arr[y : y + h, x : x + w], ignore, ignore_tolerance) if ignore else np.ones((h, w), dtype=bool)
    if ignore:
        result["measured_share"] = num(float(keep.mean()), 3)
        if keep.sum() < 100:
            result.update({"type": "complex", "note": "almost nothing is left after ignoring those colors"})
            return result
    spread = sub[keep].max(axis=0) - sub[keep].min(axis=0)
    if spread.max() <= 2:
        result.update({"type": "flat", "hex": to_hex(sub[keep].mean(axis=0))})
        return result

    stride = max(1, int(math.sqrt(w * h / 250000.0)))
    ys, xs = np.mgrid[0:h:stride, 0:w:stride]
    chosen = keep[::stride, ::stride].ravel()
    px, py = xs.ravel()[chosen] + 0.5, ys.ravel()[chosen] + 0.5
    values = sub[::stride, ::stride].reshape(-1, 3)[chosen]
    design = np.column_stack([px, py, np.ones_like(px)])
    coefficients = np.linalg.lstsq(design, values, rcond=None)[0]
    slopes = coefficients[:2].T
    lead = slopes[int(np.abs(slopes).sum(axis=1).argmax())]
    direction = np.zeros(2)
    for slope in slopes:
        direction += slope if float(slope @ lead) >= 0 else -slope
    norm = float(np.hypot(*direction))
    if norm == 0:
        result.update({"type": "complex", "note": "no linear direction found"})
        return result
    dx, dy = direction / norm
    dx = 0.0 if abs(dx) < 0.02 else dx
    dy = 0.0 if abs(dy) < 0.02 else dy
    if dy < 0 or (dy == 0 and dx < 0):
        dx, dy = -dx, -dy
    norm = math.hypot(dx, dy)
    dx, dy = dx / norm, dy / norm

    corners = [cx * dx + cy * dy for cx in (0, w) for cy in (0, h)]
    low, high = min(corners), max(corners)
    position = np.clip((px * dx + py * dy - low) / (high - low), 0.0, 1.0)
    # One bin per pixel along the gradient line where possible: bins that
    # straddle an uneven number of pixel rows add jitter that reads as stops.
    length = max(2.0, high - low)
    bins = int(max(2, round(length / math.ceil(length / 512.0))))
    index = np.minimum((position * bins).astype(int), bins - 1)
    counts = np.bincount(index, minlength=bins)
    filled = counts > 0
    profile = np.column_stack(
        [np.bincount(index, weights=values[:, c], minlength=bins)[filled] / counts[filled] for c in range(3)]
    )
    offsets = ((np.arange(bins) + 0.5) / bins)[filled]
    if len(offsets) < 2:
        result.update({"type": "complex", "note": "region too small to profile"})
        return result
    if offsets[0] <= 1.5 / bins:
        offsets[0] = 0.0
    if offsets[-1] >= 1.0 - 1.5 / bins:
        offsets[-1] = 1.0

    kept = simplify_profile(offsets, profile)
    # A knee that falls between two samples comes out as two near-identical
    # stops; keep the first of each such pair.
    merged = [kept[0]]
    for index in kept[1:-1]:
        near = offsets[index] - offsets[merged[-1]] <= max(0.02, 2.5 / bins)
        if not (near and np.abs(profile[index] - profile[merged[-1]]).max() <= 6):
            merged.append(index)
    kept = merged + [kept[-1]]
    stop_offsets, stop_colors = offsets[kept], profile[kept]
    rebuilt = np.column_stack([np.interp(position, stop_offsets, stop_colors[:, c]) for c in range(3)])
    residual = float(np.percentile(np.abs(values - rebuilt).max(axis=1), 99))
    angle = num(math.degrees(math.atan2(dx, -dy)) % 360, 1)
    stops = [{"offset_pct": num(o * 100, 1), "hex": to_hex(c)} for o, c in zip(stop_offsets, stop_colors)]
    result.update(
        {
            "type": "linear" if residual <= 4 else "complex",
            "angle_deg": angle,
            "stops": stops,
            "residual_p99": num(residual, 1),
            "css_value": "linear-gradient({}deg, {})".format(
                angle, ", ".join("{} {}%".format(s["hex"], s["offset_pct"]) for s in stops)
            ),
        }
    )
    if result["type"] == "complex":
        result["note"] = "not a straight linear gradient (radial, conic, image or noise); the stops are a rough guide only"
    return result


# --- shadow -----------------------------------------------------------------


def outward_line(arr, region, side, max_distance):
    """Colors from one side of a box outward, averaged over a 3 px band."""
    x, y, w, h = region
    if side in ("top", "bottom"):
        center = x + w // 2
        band = arr[:, max(0, center - 1) : center + 2].astype(np.float64).mean(axis=1)
        line = band[max(0, y - max_distance) : y][::-1] if side == "top" else band[y + h : y + h + max_distance]
    else:
        center = y + h // 2
        band = arr[max(0, center - 1) : center + 2].astype(np.float64).mean(axis=0)
        line = band[max(0, x - max_distance) : x][::-1] if side == "left" else band[x + w : x + w + max_distance]
    return line


def probe_shadow(arr, region, max_distance=128):
    x, y, w, h = region
    sides, extents, lines = [], {}, {}
    for side in ("top", "right", "bottom", "left"):
        line = outward_line(arr, region, side, max_distance)
        if len(line) >= 2:
            jumps = np.nonzero(np.abs(np.diff(line, axis=0)).max(axis=1) > 24)[0]
            if len(jumps):
                line = line[: int(jumps[0]) + 1]
        if len(line) < 2:
            sides.append({"side": side, "extent": None, "nearest": None, "settled": False})
            continue
        far = line[-1]
        distance = np.abs(line - far).max(axis=1)
        visible = np.nonzero(distance > 1.0)[0]
        extent = int(visible[-1]) + 1 if len(visible) else 0
        settled = bool(len(line) - extent >= 3)
        extents[side], lines[side] = extent, line
        sides.append({"side": side, "extent": extent, "nearest": to_hex(line[0]), "settled": settled})
    result = {"region": region_dict(x, y, w, h), "sides": sides}
    if len(extents) < 4:
        result["present"] = any(extent > 0 for extent in extents.values())
        result["note"] = "a side could not be scanned (image edge or adjacent element); estimates omitted"
        return result
    result["present"] = any(extent > 0 for extent in extents.values())
    if not result["present"]:
        return result
    strongest = max(extents, key=lambda side: extents[side])
    line = lines[strongest]
    far, near = line[-1], line[0]
    ratios = [near[c] / far[c] for c in range(3) if far[c] > 0]
    steps = sorted(set(int(v) for v in np.linspace(0, max(extents[strongest], 1), 9)))
    result.update(
        {
            "offset_x": num((extents["right"] - extents["left"]) / 2.0, 1),
            "offset_y": num((extents["bottom"] - extents["top"]) / 2.0, 1),
            "blur_estimate": num(sum(extents.values()) / 4.0, 1),
            "background": to_hex(far),
            "darkest": to_hex(near),
            "alpha_if_black": num(1.0 - min(ratios), 3) if ratios else None,
            "profile_side": strongest,
            "profile": [{"extent": step, "hex": to_hex(line[min(step, len(line) - 1)])} for step in steps],
        }
    )
    return result


# --- text -------------------------------------------------------------------


def probe_text(arr, region, bg=None, tolerance=8, min_line_gap=2):
    x, y, w, h = region
    sub = arr[y : y + h, x : x + w]
    color = parse_hex(bg) if bg else dominant_color(sub)[0]
    distance = maxdiff(sub, color)
    peak = int(distance.max())
    result = {"region": region_dict(x, y, w, h), "background": to_hex(color), "found": peak > tolerance}
    if not result["found"]:
        return result
    ink = distance >= max(tolerance + 1, 0.5 * peak)
    result["color"] = to_hex(np.median(sub[distance >= 0.9 * peak], axis=0))
    lines = []
    for top, bottom in merged_spans(ink.any(axis=1), min_line_gap):
        band = ink[top:bottom]
        cols = np.nonzero(band.any(axis=0))[0]
        left, right = int(cols[0]), int(cols[-1]) + 1
        density = band[:, left:right].sum(axis=1)
        dense = np.nonzero(density >= 0.4 * density.max())[0]
        x_top, baseline = int(dense[0]), int(dense[-1]) + 1
        lines.append(
            {
                "top": y + top,
                "bottom": y + bottom,
                "height": bottom - top,
                "left": x + left,
                "right": x + right,
                "width": right - left,
                "baseline": y + top + baseline,
                "ascent": baseline,
                "x_height": baseline - x_top,
                "descent": bottom - top - baseline,
            }
        )
    baselines = [line["baseline"] for line in lines]
    pitches = [baselines[i + 1] - baselines[i] for i in range(len(baselines) - 1)]
    result["line_count"] = len(lines)
    result["lines"] = lines[:MAX_ROWS]
    result["line_pitch"] = uniform(pitches) if pitches else None
    ascent = float(np.median([line["ascent"] for line in lines]))
    result["font_size_estimate"] = num(ascent / 0.72, 1)
    return result


# --- command line -----------------------------------------------------------


def build_parser():
    parser = argparse.ArgumentParser(prog="measure", description=__doc__)
    sub = parser.add_subparsers(dest="probe", required=True)

    def add(name, help_text, region=True, bg=False):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("image")
        if region:
            p.add_argument("--region", help="x,y,w,h in image pixels (default: whole image)")
        if bg:
            p.add_argument("--bg", help="background color as hex (default: detected)")
            p.add_argument("--tolerance", type=int, default=8, help="channel difference that counts as not background")
        p.add_argument("--scale", type=float, default=1.0, help="design pixel density; adds lengths in points")
        p.add_argument("--points", action="store_true", help="with --scale: print lengths in points only, not both units")
        p.add_argument("--json", action="store_true", help="print JSON instead of TOON")
        p.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                       help="check the arguments and report what would run, without measuring or writing")
        return p

    p = add("info", "image size, pixel-density guess, and whether the image is sharp enough to match", region=False)
    p.add_argument("--screen-width", type=int, help="known width of the designed screen or window, in points")

    p = add("color", "color at a point, or the colors of a region")
    p.add_argument("--at", help="x,y of a single pixel")

    p = add("edges", "color changes along one row or column", region=False)
    p.add_argument("--row", type=int)
    p.add_argument("--col", type=int)
    p.add_argument("--from", dest="start", type=int, help="first coordinate of the scan")
    p.add_argument("--to", dest="end", type=int, help="coordinate after the last one scanned")
    p.add_argument("--band", type=int, default=1, help="average this many adjacent lines")
    p.add_argument("--threshold", type=int, default=8)

    add("bbox", "bounding box of non-background content in a region", bg=True)

    p = add("spans", "content spans and the gaps between them along one axis", bg=True)
    p.add_argument("--axis", choices=["x", "y"], required=True)
    p.add_argument("--min-gap", type=int, default=1, help="gaps narrower than this are merged")

    p = add("grid", "columns, rows and gutters of a repeated layout", bg=True)
    p.add_argument("--min-gap", type=int, default=1, help="gaps narrower than this are merged")

    p = add("items", "the separate items in a band: tight box and color of each", bg=True)
    p.add_argument("--axis", choices=["x", "y"], default="x", help="direction the items are laid out in")
    p.add_argument("--min-gap", type=int, default=1, help="gaps narrower than this stay inside one item")

    p = add("crop", "save a region of the image to a file")
    p.add_argument("--out", required=True)

    p = add("crops", "save several named regions at once, listed as inventory asset rows", region=False)
    p.add_argument("--item", action="append", required=True, metavar="NAME=x,y,w,h", help="one crop, saved as NAME.png (repeatable)")
    p.add_argument("--blank", action="append", default=[], metavar="NAME=x,y,w,h:HEX[:mx,my]",
                   help="remove UI the code will draw from crop NAME: inside the box x,y,w,h (design pixels), pixels of the "
                        "UI's fill color HEX are painted gray. mx,my is the top left of the same UI elsewhere in the design, "
                        "to read its shape there when it stands out better (repeatable)")
    p.add_argument("--blank-tolerance", type=int, default=60, help="channel difference from HEX that still counts as the UI")
    p.add_argument("--out-dir", required=True)

    p = add("substitute", "write <design>.subs.<ext>, with each cut-off image replaced by a complete one from the same design", region=False)
    p.add_argument("--swap", action="append", required=True, metavar="NAME=sx,sy,sw,sh:dx,dy,dw,dh[:ANCHOR]",
                   help="paste the source box into the slot box, clipped to the slot; ANCHOR is the corner kept aligned: "
                        "tl (default), tr, bl or br (repeatable)")
    p.add_argument("--out", help="file to write (default: the design's name with .subs before its extension)")
    p.add_argument("--preview", metavar="FILE", help="also save each slot before and after, with its surroundings, on one sheet to read")

    p = add("zoom", "save enlarged copies of one or more regions on one sheet, for reading small details", region=False)
    p.add_argument("--region", action="append", help="x,y,w,h in image pixels (repeatable; stacked top to bottom; default: whole image)")
    p.add_argument("--out", required=True)
    p.add_argument("--factor", type=int, help="whole-number enlargement (default: as large as stays readable)")

    p = add("outline", "trace a filled shape into an SVG path")
    p.add_argument("--color", help="the shape's fill as hex (default: everything that is not background)")
    p.add_argument("--bg", help="background color as hex, when --color is not given (default: detected)")
    p.add_argument("--tolerance", type=int, default=8, help="channel difference from --color, or from the background")
    p.add_argument("--min-run", type=int, default=8, help="shortest solid run of a row that counts as the shape")
    p.add_argument("--epsilon", type=float, default=0.6, help="how far, in pixels, the path may stray from the traced edge")
    p.add_argument("--bridge", type=int, default=0, metavar="ROWS",
                   help="fill dents of up to this many rows, where text or an icon lies across the shape's edge (default: off)")

    p = add("radius", "corner radius of a box; region is its tight bounding box")
    p.add_argument("--bg", help="color outside the box as hex (default: read at each corner)")

    p = add("border", "border width and color of a box; region is its tight bounding box")
    p.add_argument("--tolerance", type=int, default=8)
    p.add_argument("--max-width", type=int, default=12, help="widest band still treated as a border")

    p = add("gradient", "direction and stops of a linear gradient in a region")
    p.add_argument("--ignore", action="append", default=[], metavar="HEX",
                   help="leave out pixels near this color, such as text on the gradient or the page around a shape (repeatable)")
    p.add_argument("--ignore-tolerance", type=int, default=60, help="channel difference from an --ignore color that still counts as it")

    p = add("shadow", "shadow extents around a box; region is its tight bounding box")
    p.add_argument("--max-distance", type=int, default=128, help="how far outside the box to scan")

    p = add("text", "line boxes, baselines and glyph heights of text in a region")
    p.add_argument("--bg", help="background color as hex (default: detected)")
    p.add_argument("--tolerance", type=int, default=8)
    p.add_argument("--min-line-gap", type=int, default=2, help="row gaps narrower than this stay in one line")
    return parser


def put(result, args):
    """Print a result, saying so when the image read is a design that a substituted copy replaces."""
    copy = superseded_by(args.image) if args.probe != "substitute" else None
    if copy:
        result = dict(result, design_warning="{} replaces this design: use it for every probe, crop and reference. "
                                             "Read the original only to locate boxes for `substitute`".format(copy))
    emit(result, args.json)


def show(result, args):
    """Print a result with its lengths also in points, or only in them."""
    put(in_points(result, args.scale) if args.points else with_points(result, args.scale), args)


def crop_items(args, arr):
    items = []
    for text in args.item:
        name, sep, region = text.partition("=")
        if not sep or not name or os.sep in name:
            raise PPError("--item must look like NAME=x,y,w,h; got '{}'".format(text))
        items.append((name, parse_region(region, arr.shape)))
    return items


def blank_items(args, arr):
    blanks = []
    for text in args.blank:
        name, sep, rest = text.partition("=")
        parts = rest.split(":")
        if not sep or not name or len(parts) not in (2, 3):
            raise PPError("--blank must look like NAME=x,y,w,h:HEX[:mx,my]; got '{}'".format(text))
        origin = tuple(parse_ints(parts[2], 2, "--blank mx,my")) if len(parts) == 3 else None
        blanks.append((name, parse_region(parts[0], arr.shape), parse_hex(parts[1]), origin))
    return blanks


def swap_items(args, arr):
    swaps = []
    for text in args.swap:
        name, sep, rest = text.partition("=")
        parts = rest.split(":")
        if not sep or not name or len(parts) not in (2, 3):
            raise PPError("--swap must look like NAME=sx,sy,sw,sh:dx,dy,dw,dh[:ANCHOR]; got '{}'".format(text))
        anchor = parts[2] if len(parts) == 3 else "tl"
        if anchor not in ANCHORS:
            raise PPError("anchor must be one of {}; got '{}'".format(", ".join(ANCHORS), anchor))
        swaps.append((name, parse_region(parts[0], arr.shape), parse_region(parts[1], arr.shape), anchor))
    return swaps


def zoom_regions(args, arr):
    if not args.region:
        return [full_region(arr.shape)]
    return [parse_region(text, arr.shape) for text in args.region]


def dry_plan(args, arr):
    """Validate the arguments and describe the run without doing it."""
    plan = {"dry_run": True, "probe": args.probe, "image": args.image,
            "width": arr.shape[1], "height": arr.shape[0], "writes": []}
    if args.probe == "crops":
        plan["writes"] = [os.path.join(args.out_dir, name + ".png") for name, _ in crop_items(args, arr)]
        plan["blanks"] = len(blank_items(args, arr))
    elif args.probe == "substitute":
        plan["swaps"] = [name for name, _, _, _ in swap_items(args, arr)]
        plan["writes"] = [path for path in (args.out or subs_path(args.image), args.preview) if path]
    elif args.probe == "zoom":
        plan["regions"] = [region_dict(*region) for region in zoom_regions(args, arr)]
        plan["writes"] = [args.out]
    elif args.probe == "edges":
        probe_edges(arr[:, :, :], args.row, args.col, args.start, args.end, args.band, args.threshold)
        plan["line"] = {"axis": "x" if args.row is not None else "y", "at": args.row if args.row is not None else args.col}
    elif args.probe != "info":
        if args.probe == "color" and args.at:
            px, py = parse_ints(args.at, 2, "--at")
            probe_color_at(arr, px, py)
            plan["point"] = {"x": px, "y": py}
        else:
            plan["region"] = region_dict(*region_of(arr, args.region))
        if getattr(args, "bg", None):
            parse_hex(args.bg)
        if args.probe == "crop":
            plan["writes"] = [args.out]
    return plan


def main():
    args = build_parser().parse_args()
    arr, has_alpha = load_rgb(args.image)
    probe = args.probe
    if args.dry:
        put(dry_plan(args, arr), args)
        return 0
    if probe == "info":
        result = probe_info(arr, has_alpha, args.screen_width)
        put(result, args)
        return 0
    if probe == "edges":
        result = probe_edges(arr, args.row, args.col, args.start, args.end, args.band, args.threshold)
        show(result, args)
        return 0
    if probe == "crops":
        show(probe_crops(args.image, arr, crop_items(args, arr), args.out_dir, blank_items(args, arr), args.blank_tolerance), args)
        return 0
    if probe == "substitute":
        show(probe_substitute(args.image, arr, swap_items(args, arr), args.out, args.preview), args)
        return 0
    if probe == "zoom":
        if args.factor is not None and args.factor < 1:
            raise PPError("--factor must be 1 or more")
        put(probe_zoom(args.image, arr, zoom_regions(args, arr), args.out, args.factor), args)
        return 0
    region = region_of(arr, args.region)
    if probe == "outline":
        put(probe_outline(arr, region, args.color, args.bg, args.tolerance, args.min_run, args.epsilon, args.scale, args.bridge), args)
        return 0
    if probe == "color":
        if args.at:
            px, py = parse_ints(args.at, 2, "--at")
            result = probe_color_at(arr, px, py)
        else:
            result = probe_color_region(arr, region)
    elif probe == "bbox":
        result = probe_bbox(arr, region, args.bg, args.tolerance)
    elif probe == "spans":
        result = probe_spans(arr, region, args.axis, args.bg, args.tolerance, args.min_gap)
    elif probe == "grid":
        result = probe_grid(arr, region, args.bg, args.tolerance, args.min_gap)
    elif probe == "items":
        result = probe_items(arr, region, args.axis, args.bg, args.tolerance, args.min_gap)
    elif probe == "crop":
        result = probe_crop(args.image, arr, region, args.out)
    elif probe == "radius":
        result = probe_radius(arr, region, args.bg)
    elif probe == "border":
        result = probe_border(arr, region, args.tolerance, args.max_width)
    elif probe == "gradient":
        result = probe_gradient(arr, region, args.ignore, args.ignore_tolerance)
    elif probe == "shadow":
        result = probe_shadow(arr, region, args.max_distance)
    else:
        result = probe_text(arr, region, args.bg, args.tolerance, args.min_line_gap)
    show(result, args)
    return 0


if __name__ == "__main__":
    run_cli(main)
