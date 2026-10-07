"""Score a rendered screenshot against the design image.

The two images are compared pixel for pixel, anchored at the top left. They are
never resized or realigned for scoring: a size difference fails the comparison
and the area only one image covers counts as mismatched. Shift detection is
reported separately as a diagnostic.

Exit status: 0 pass, 1 fail, 2 error.
"""
import argparse
import json
import math
import os
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import toon
from pp_common import PPError, dominant_color, emit, file_sha1, load_rgb, maxdiff, num, parse_hex, run_cli, to_hex, with_css

DEFAULT_TOLERANCE = 8
DEFAULT_THRESHOLD = 99.0
DEFAULT_TILE_FLOOR = 95.0
DEFAULT_TILE = 64
MAX_FAILING_TILES = 20
MAX_CLUSTERS = 12
CLUSTER_CROPS = 4
CLUSTER_SHIFT_REACH = 16
READABLE_SIDE = 1800
IMAGE_MODES = ("all", "clusters", "none")


def floor_pct(fraction):
    """Percentage rounded down, so a score never rounds up across a threshold."""
    return math.floor(fraction * 100000.0) / 1000.0


def block_sums(mask, size):
    """Sum a 2-D array over a grid of size x size blocks."""
    rows = np.arange(0, mask.shape[0], size)
    cols = np.arange(0, mask.shape[1], size)
    return np.add.reduceat(np.add.reduceat(mask.astype(np.int64), rows, axis=0), cols, axis=1)


def compare(design, render, tolerance=DEFAULT_TOLERANCE, bg=None):
    """Per-pixel delta, mismatch mask and content mask on the union canvas."""
    dh, dw = design.shape[:2]
    rh, rw = render.shape[:2]
    height, width = max(dh, rh), max(dw, rw)
    oh, ow = min(dh, rh), min(dw, rw)
    background = bg if bg is not None else dominant_color(design)[0]

    delta = np.full((height, width), 255, dtype=np.uint8)
    delta[:oh, :ow] = np.abs(design[:oh, :ow].astype(np.int16) - render[:oh, :ow].astype(np.int16)).max(axis=2)
    mismatch = delta > tolerance
    content = np.ones((height, width), dtype=bool)
    content[:oh, :ow] = (
        (maxdiff(design[:oh, :ow], background) > tolerance)
        | (maxdiff(render[:oh, :ow], background) > tolerance)
        | mismatch[:oh, :ow]
    )
    return {
        "delta": delta,
        "mismatch": mismatch,
        "content": content,
        "background": background,
        "overlap": (oh, ow),
        "canvas": (height, width),
    }


def tile_scores(mismatch, content, tile):
    """Score per tile. Sparse tiles are scored on all their pixels instead."""
    wrong = block_sums(mismatch, tile)
    inside = block_sums(content, tile)
    area = block_sums(np.ones(mismatch.shape, dtype=bool), tile)
    by_content = inside >= np.maximum(16, 0.02 * area)
    score = np.where(by_content, 1.0 - wrong / np.maximum(inside, 1), 1.0 - wrong / area)
    return score, by_content


def find_clusters(mismatch, cell=8):
    """Group mismatched pixels into clusters of touching coarse cells."""
    counts = block_sums(mismatch, cell)
    active = counts > 0
    labels = np.zeros(active.shape, dtype=np.int32)
    rows, cols = active.shape
    clusters = []
    for r0, c0 in zip(*np.nonzero(active)):
        if labels[r0, c0]:
            continue
        label = len(clusters) + 1
        labels[r0, c0] = label
        queue = deque([(int(r0), int(c0))])
        top, left, bottom, right, pixels = int(r0), int(c0), int(r0), int(c0), 0
        while queue:
            r, c = queue.popleft()
            pixels += int(counts[r, c])
            top, bottom, left, right = min(top, r), max(bottom, r), min(left, c), max(right, c)
            for nr in range(max(0, r - 1), min(rows, r + 2)):
                for nc in range(max(0, c - 1), min(cols, c + 2)):
                    if active[nr, nc] and not labels[nr, nc]:
                        labels[nr, nc] = label
                        queue.append((nr, nc))
        clusters.append((pixels, top * cell, left * cell, (bottom + 1) * cell, (right + 1) * cell))
    clusters.sort(reverse=True)
    return clusters


def shift_hint(box, design, render, tolerance, reach):
    """The whole-pixel offset of the render that best explains one cluster.

    Returns (dx, dy, left_pct): the render's content sits dx pixels further
    right and dy further down than the design's, and left_pct percent of the
    cluster's mismatch remains once that offset is undone. Diagnostic only.
    """
    x0, y0, x1, y1 = box
    stride = max(1, int(math.sqrt((x1 - x0) * (y1 - y0) / 60000.0)))
    reference = design[y0:y1:stride, x0:x1:stride].astype(np.int16)

    def wrong(dx, dy):
        if y0 + dy < 0 or x0 + dx < 0 or y1 + dy > render.shape[0] or x1 + dx > render.shape[1]:
            return None
        moved = render[y0 + dy : y1 + dy : stride, x0 + dx : x1 + dx : stride]
        return int((np.abs(reference - moved).max(axis=2) > tolerance).sum())

    base = wrong(0, 0)
    if not base:
        return 0, 0, 100.0
    best, dx, dy = base, 0, 0
    for _ in range(2):
        for axis in (0, 1):
            for step in range(-reach, reach + 1):
                candidate = (step, dy) if axis == 0 else (dx, step)
                count = wrong(*candidate)
                if count is not None and count < best:
                    best, dx, dy = count, candidate[0], candidate[1]
    return dx, dy, num(100.0 * best / base, 1)


def describe_cluster(cluster, design, render, state, tolerance=DEFAULT_TOLERANCE, reach=CLUSTER_SHIFT_REACH):
    pixels, top, left, bottom, right = cluster
    mismatch, delta = state["mismatch"], state["delta"]
    window = mismatch[top:bottom, left:right]
    rows = np.nonzero(window.any(axis=1))[0]
    cols = np.nonzero(window.any(axis=0))[0]
    y0, y1 = top + int(rows[0]), top + int(rows[-1]) + 1
    x0, x1 = left + int(cols[0]), left + int(cols[-1]) + 1
    window = mismatch[y0:y1, x0:x1]
    entry = {
        "x": x0,
        "y": y0,
        "w": x1 - x0,
        "h": y1 - y0,
        "pixels": pixels,
        "mean_delta": num(float(delta[y0:y1, x0:x1][window].mean()), 1),
        "kind": "outside",
        "design_hex": None,
        "render_hex": None,
        "shift_dx": None,
        "shift_dy": None,
        "left_pct": None,
    }
    oh, ow = state["overlap"]
    if y0 < oh and x0 < ow:
        inner = window[: oh - y0, : ow - x0]
        if inner.any():
            entry["shift_dx"], entry["shift_dy"], entry["left_pct"] = shift_hint(
                (x0, y0, min(x1, ow), min(y1, oh)), design, render, tolerance, reach
            )
            in_design = design[y0:oh, x0:ow][: inner.shape[0], : inner.shape[1]][inner].astype(np.float64)
            in_render = render[y0:oh, x0:ow][: inner.shape[0], : inner.shape[1]][inner].astype(np.float64)
            flat = in_design.std(axis=0).max() < 3 and in_render.std(axis=0).max() < 3
            entry["kind"] = "color" if flat else "shape"
            entry["design_hex"] = to_hex(in_design.mean(axis=0))
            entry["render_hex"] = to_hex(in_render.mean(axis=0))
    return entry


def window_sums(mask, radius, mode):
    """Count of set pixels in the (2 * radius + 1) square window around each pixel."""
    size = 2 * radius + 1
    table = np.pad(mask.astype(np.int32), radius, mode=mode).cumsum(axis=0).cumsum(axis=1)
    table = np.pad(table, ((1, 0), (1, 0)))
    return table[size:, size:] - table[:-size, size:] - table[size:, :-size] + table[:-size, :-size]


def ink_mask(design, tile, stroke, contrast=60, dominant_share=0.35):
    """Design pixels that are thin ink on a plain backdrop: text, glyphs, rules.

    A pixel counts when its tile has one dominant color, the pixel differs
    strongly from it, and it belongs to a stroke no wider than about
    2 * `stroke` pixels. Photos and gradients have no dominant color, and the
    insides of solid boxes are too thick; both are left out. This only sorts
    mismatched pixels into kinds; it scores nothing.
    """
    strong = np.zeros(design.shape[:2], dtype=bool)
    for top in range(0, design.shape[0], tile):
        for left in range(0, design.shape[1], tile):
            block = design[top : top + tile, left : left + tile]
            color, share = dominant_color(block)
            if share >= dominant_share:
                strong[top : top + tile, left : left + tile] = maxdiff(block, color) > contrast
    size = 2 * stroke + 1
    thick_core = window_sums(strong, stroke, "edge") == size * size
    return strong & (window_sums(thick_core, stroke, "constant") == 0)


def hint(result):
    """One line naming the first thing to look at, for a table of many results."""
    if result["pass"]:
        return ""
    size = result["size"]
    if not result["gates"]["size_match"]:
        return "size differs: dw {} dh {}".format(size["dw"], size["dh"])
    vertical, horizontal = result["shifts"]["vertical"], result["shifts"]["horizontal"]
    if vertical:
        return "rows from {} sit {} px too {}".format(vertical[0]["from_row"], abs(vertical[0]["dy"]), "low" if vertical[0]["dy"] > 0 else "high")
    if horizontal:
        return "columns from {} sit {} px too far {}".format(horizontal[0]["from_col"], abs(horizontal[0]["dx"]), "right" if horizontal[0]["dx"] > 0 else "left")
    if result["clusters"]:
        first = result["clusters"][0]
        where = "{}x{} at {},{}".format(first["w"], first["h"], first["x"], first["y"])
        if first["left_pct"] is not None and first["left_pct"] <= 50 and (first["shift_dx"] or first["shift_dy"]):
            return "largest cluster {} is offset by {},{}".format(where, first["shift_dx"], first["shift_dy"])
        return "largest cluster {} is a {} difference".format(where, first["kind"])
    return ""


def gray(image):
    image = image.astype(np.float64)
    return image[..., 0] * 0.299 + image[..., 1] * 0.587 + image[..., 2] * 0.114


def line_features(image_gray, groups=64):
    """Reduce each row to a short vector of column-group means."""
    width = image_gray.shape[1]
    edges = np.unique(np.linspace(0, width, min(groups, width) + 1).astype(int))[:-1]
    sums = np.add.reduceat(image_gray, edges, axis=1)
    sizes = np.diff(np.append(edges, width))
    return sums / sizes


def band_shifts(design_gray, render_gray, mismatch, band, max_shift):
    """Per band of rows, the offset at which the render best matches the design.

    A positive shift means the render's content sits that many pixels further
    down than in the design.
    """
    width = min(design_gray.shape[1], render_gray.shape[1])
    design_rows = line_features(design_gray[:, :width])
    render_rows = line_features(render_gray[:, :width])
    limit = min(design_gray.shape[0], render_gray.shape[0])
    found = []
    bridge = False  # only bands with no evidence either way since the last range
    for start in range(0, limit, band):
        end = min(start + band, limit)
        reference = design_rows[start:end]
        # One row of context on each side, so an edge on a band boundary counts.
        context = design_rows[max(0, start - 1) : end + 1]
        if len(context) < 2 or np.abs(np.diff(context, axis=0)).max() < 1.0:
            # Nothing changes from row to row here (blank space or a flat
            # fill), so this band cannot confirm or contradict a shift.
            continue
        if not mismatch[start:end, :width].any():
            bridge = False
            continue
        baseline = float(np.abs(reference - render_rows[start:end]).mean())
        best_error, best_shift = baseline, 0
        for shift in range(-max_shift, max_shift + 1):
            if shift == 0 or start + shift < 0 or end + shift > render_rows.shape[0]:
                continue
            error = float(np.abs(reference - render_rows[start + shift : end + shift]).mean())
            if error < best_error:
                best_error, best_shift = error, shift
        if best_shift and baseline > 0.5 and best_error < 0.5 * baseline:
            if found and found[-1][2] == best_shift and (found[-1][1] == start or bridge):
                found[-1][1] = end
            else:
                found.append([start, end, best_shift])
            bridge = True
        else:
            bridge = False
    return found


def heat_panel(design, state, tolerance, failing, tile, box=None):
    """The design, dimmed, with every mismatched pixel colored by its delta.

    `box` (x0, y0, x1, y1) limits the panel to one part of the canvas.
    """
    x0, y0, x1, y1 = box or (0, 0, state["canvas"][1], state["canvas"][0])
    base = np.full((y1 - y0, x1 - x0, 3), 96.0, dtype=np.float32)
    part = design[y0:y1, x0:x1]
    base[: part.shape[0], : part.shape[1]] = (255.0 - (255.0 - gray(part)) * 0.3)[..., None]
    delta = state["delta"][y0:y1, x0:x1].astype(np.float32)
    mismatch = state["mismatch"][y0:y1, x0:x1]
    close = (delta > 0) & ~mismatch
    base[close] = base[close] * 0.6 + np.array([120.0, 190.0, 255.0], dtype=np.float32) * 0.4
    strength = np.sqrt(np.clip((delta - tolerance) / max(1.0, 255.0 - tolerance), 0.0, 1.0))[..., None]
    heat = np.array([255.0, 215.0, 0.0]) * (1 - strength) + np.array([215.0, 0.0, 0.0]) * strength
    base[mismatch] = heat[mismatch]
    panel = Image.fromarray(base.astype(np.uint8))
    draw = ImageDraw.Draw(panel)
    for row, col in failing:
        left, top = col * tile, row * tile
        right, bottom = min(x1, left + tile) - 1, min(y1, top + tile) - 1
        if right >= x0 and bottom >= y0 and left < x1 and top < y1:
            draw.rectangle([left - x0, top - y0, right - x0, bottom - y0], outline=(255, 0, 255))
    return panel


def padded(image, canvas, box=None):
    """Place an image, or one part of it, on a dark panel of the canvas's size."""
    x0, y0, x1, y1 = box or (0, 0, canvas[1], canvas[0])
    panel = Image.new("RGB", (x1 - x0, y1 - y0), (96, 96, 96))
    panel.paste(Image.fromarray(image[y0:y1, x0:x1]), (0, 0))
    return panel


def side_by_side(panels, labels, label_height):
    gap = 8
    width = sum(panel.width for panel in panels) + gap * (len(panels) - 1)
    height = panels[0].height + label_height
    sheet = Image.new("RGB", (width, height), (32, 32, 32))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=max(10, label_height - 10))
    x = 0
    for panel, label in zip(panels, labels):
        draw.text((x + 6, 3), label, fill=(255, 255, 255), font=font)
        sheet.paste(panel, (x, label_height))
        x += panel.width + gap
    return sheet


def stacked(panels, labels, label_height):
    gap = 8
    width = max(panel.width for panel in panels)
    height = sum(panel.height + label_height for panel in panels) + gap * (len(panels) - 1)
    sheet = Image.new("RGB", (width, height), (32, 32, 32))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=max(10, label_height - 10))
    y = 0
    for panel, label in zip(panels, labels):
        draw.text((6, y + 3), label, fill=(255, 255, 255), font=font)
        sheet.paste(panel, (0, y + label_height))
        y += panel.height + label_height + gap
    return sheet


def readable_sheet(parts, labels, label_height=24):
    """Lay crops out, enlarged, so the sheet stays readable when viewed whole.

    Wide crops are stacked and tall ones set side by side, whichever allows
    the larger enlargement within READABLE_SIDE pixels.
    """
    width, height = parts[0].size
    count = len(parts)
    beside = min(READABLE_SIDE // (count * width + 8 * (count - 1)), READABLE_SIDE // (height + label_height))
    above = min(READABLE_SIDE // width, READABLE_SIDE // (count * (height + label_height) + 8 * (count - 1)))
    zoom = int(min(6, max(1, beside, above)))
    if zoom > 1:
        parts = [part.resize((part.width * zoom, part.height * zoom), Image.NEAREST) for part in parts]
    layout = side_by_side if beside >= above else stacked
    return layout(parts, labels, label_height)


def overview(state, tolerance):
    """The whole comparison shrunk to one readable map of where it differs.

    Grey matches, orange differs a little, red differs a lot. Shrinking keeps
    the worst pixel of each block, so a thin line of mismatch stays visible.
    """
    delta = state["delta"]
    level = (delta > tolerance).astype(np.uint8) + (delta > max(40, 2 * tolerance)).astype(np.uint8)
    block = max(1, int(math.ceil(max(delta.shape) / float(READABLE_SIDE))))
    if block > 1:
        rows, cols = -(-level.shape[0] // block), -(-level.shape[1] // block)
        padded = np.zeros((rows * block, cols * block), dtype=np.uint8)
        padded[: level.shape[0], : level.shape[1]] = level
        level = padded.reshape(rows, block, cols, block).max(axis=(1, 3))
    palette = np.array([(238, 238, 238), (255, 170, 0), (215, 0, 0)], dtype=np.uint8)
    return Image.fromarray(palette[level])


def write_images(design, render, state, tolerance, failing, tile, clusters, out_dir, scale, images="all"):
    """Write the evidence images: everything, only the close-ups and the overview, or nothing."""
    canvas = state["canvas"]
    labels = ["design", "render", "delta > {}".format(tolerance)]
    files = {}
    if images == "none":
        return files
    if state["mismatch"].any():
        files["overview"] = os.path.join(out_dir, "overview.png")
        overview(state, tolerance).save(files["overview"])
    if images == "all":
        heat = heat_panel(design, state, tolerance, failing, tile)
        label_height = int(round(24 * max(1.0, scale)))
        files["composite"] = os.path.join(out_dir, "composite.png")
        files["heatmap"] = os.path.join(out_dir, "heatmap.png")
        side_by_side([padded(design, canvas), padded(render, canvas), heat], labels, label_height).save(files["composite"])
        heat.save(files["heatmap"])
    crops = []
    pad = int(round(24 * max(1.0, scale)))
    for index, cluster in enumerate(clusters[:CLUSTER_CROPS], start=1):
        box = (
            max(0, cluster["x"] - pad),
            max(0, cluster["y"] - pad),
            min(canvas[1], cluster["x"] + cluster["w"] + pad),
            min(canvas[0], cluster["y"] + cluster["h"] + pad),
        )
        parts = [padded(design, canvas, box), padded(render, canvas, box), heat_panel(design, state, tolerance, failing, tile, box)]
        path = os.path.join(out_dir, "cluster-{}.png".format(index))
        readable_sheet(parts, labels).save(path)
        crops.append(path)
    files["clusters"] = crops
    return files


def run_diff(design, render, out_dir=None, tolerance=DEFAULT_TOLERANCE, threshold=DEFAULT_THRESHOLD,
             tile_floor=DEFAULT_TILE_FLOOR, tile=DEFAULT_TILE, scale=1.0, bg=None, max_shift=32, images="all"):
    tile_px = max(4, int(round(tile * scale)))
    shift_px = max(1, int(round(max_shift * scale)))
    state = compare(design, render, tolerance, bg)
    mismatch, content = state["mismatch"], state["content"]
    height, width = state["canvas"]
    total, wrong, inside = height * width, int(mismatch.sum()), int(content.sum())

    scores, by_content = tile_scores(mismatch, content, tile_px)
    worst = floor_pct(float(scores.min()))
    failing_index = np.argwhere(scores * 100.0 < tile_floor)
    order = np.argsort(scores[failing_index[:, 0], failing_index[:, 1]], kind="stable")
    failing_tiles = [
        {
            "x": int(col) * tile_px,
            "y": int(row) * tile_px,
            "w": min(tile_px, width - int(col) * tile_px),
            "h": min(tile_px, height - int(row) * tile_px),
            "score": floor_pct(float(scores[row, col])),
            "basis": "content" if by_content[row, col] else "all",
        }
        for row, col in failing_index[order][:MAX_FAILING_TILES]
    ]

    raw_clusters = find_clusters(mismatch, cell=max(4, tile_px // 8))
    reach = min(shift_px, CLUSTER_SHIFT_REACH)
    clusters = [describe_cluster(c, design, render, state, tolerance, reach) for c in raw_clusters[:MAX_CLUSTERS]]

    design_gray, render_gray = gray(design), gray(render)
    vertical = band_shifts(design_gray, render_gray, mismatch, tile_px, shift_px)
    horizontal = band_shifts(design_gray.T, render_gray.T, mismatch.T, tile_px, shift_px)

    oh, ow = state["overlap"]
    ink = ink_mask(design[:oh, :ow], tile_px, max(1, int(round(4 * scale))))
    ink_total, ink_wrong = int(ink.sum()), int((ink & mismatch[:oh, :ow]).sum())

    content_score = floor_pct(1.0 - wrong / inside) if inside else 100.0
    size_match = design.shape[:2] == render.shape[:2]
    overridden = [
        name
        for name, value, default in (
            ("tolerance", tolerance, DEFAULT_TOLERANCE),
            ("threshold", threshold, DEFAULT_THRESHOLD),
            ("tile_floor", tile_floor, DEFAULT_TILE_FLOOR),
        )
        if value != default
    ]
    result = {
        "pass": bool(size_match and content_score >= threshold and worst >= tile_floor),
        "score": {"content": content_score, "worst_tile": worst, "naive": floor_pct(1.0 - wrong / total)},
        "gates": {
            "size_match": size_match,
            "content": content_score >= threshold,
            "tiles": worst >= tile_floor,
        },
        "thresholds": {
            "content": num(threshold),
            "tile_floor": num(tile_floor),
            "tolerance": tolerance,
            "overridden": overridden,
        },
        "size": {
            "design": {"w": design.shape[1], "h": design.shape[0]},
            "render": {"w": render.shape[1], "h": render.shape[0]},
            "dw": render.shape[1] - design.shape[1],
            "dh": render.shape[0] - design.shape[0],
        },
        "pixels": {
            "total": total,
            "content": inside,
            "mismatched": wrong,
            "allowed": int(inside * (100.0 - threshold) / 100.0),
        },
        "ink": {
            "pixels": ink_total,
            "mismatched": ink_wrong,
            "mismatched_pct": num(100.0 * ink_wrong / ink_total, 1) if ink_total else 0,
            "share_of_mismatch_pct": num(100.0 * ink_wrong / wrong, 1) if wrong else 0,
        },
        "background": to_hex(state["background"]),
        "tiles": {
            "size": tile_px,
            "total": int(scores.size),
            "failing": int(len(failing_index)),
            "worst": failing_tiles,
        },
        "cluster_count": len(raw_clusters),
        "clusters": clusters,
        "shifts": {
            "vertical": [{"from_row": a, "to_row": b, "dy": s} for a, b, s in vertical],
            "horizontal": [{"from_col": a, "to_col": b, "dx": s} for a, b, s in horizontal],
        },
    }
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        failing = [(int(r), int(c)) for r, c in failing_index]
        result["files"] = write_images(design, render, state, tolerance, failing, tile_px, clusters, out_dir, scale, images)
    return result


def summary(result):
    """The few numbers that say how one comparison went."""
    return {
        "pass": result["pass"],
        "content": result["score"]["content"],
        "worst_tile": result["score"]["worst_tile"],
        "naive": result["score"]["naive"],
        "dw": result["size"]["dw"],
        "dh": result["size"]["dh"],
        "failing_tiles": result["tiles"]["failing"],
        "clusters": result["cluster_count"],
    }


def brief(result, top=5):
    """The result cut down to what picks the next fix; diff.toon keeps the rest."""
    short = {
        "pass": result["pass"],
        "score": result["score"],
        "gates": result["gates"],
        "size": {"dw": result["size"]["dw"], "dh": result["size"]["dh"]},
        "pixels": result["pixels"],
        "ink": result["ink"],
        "failing_tiles": result["tiles"]["failing"],
        "cluster_count": result["cluster_count"],
        "clusters": result["clusters"][:top],
        "shifts": {
            "vertical": result["shifts"]["vertical"][:top],
            "horizontal": result["shifts"]["horizontal"][:top],
        },
    }
    if result["thresholds"]["overridden"]:
        short["thresholds"] = result["thresholds"]
    return short


def reference_record(path):
    """Which reference a score was made against, so a changed one can be told apart."""
    return {"path": path, "sha1": file_sha1(path)}


def save_result(result, out_dir):
    """Write diff.toon for reading and diff.json for `scores`."""
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "diff.toon"), "w") as handle:
        handle.write(toon.encode(result) + "\n")
    with open(os.path.join(out_dir, "diff.json"), "w") as handle:
        json.dump(toon._plain(result), handle, indent=1)
        handle.write("\n")


def main():
    parser = argparse.ArgumentParser(prog="diff", description=__doc__)
    parser.add_argument("design")
    parser.add_argument("render")
    parser.add_argument("--out-dir", required=True, help="where the composite, heatmap and diff.toon are written")
    parser.add_argument("--tolerance", type=int, default=DEFAULT_TOLERANCE, help="largest channel difference that still matches")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="content score needed to pass, in percent")
    parser.add_argument("--tile-floor", type=float, default=DEFAULT_TILE_FLOOR, help="score every tile needs, in percent")
    parser.add_argument("--tile", type=int, default=DEFAULT_TILE, help="tile size in CSS pixels")
    parser.add_argument("--scale", type=float, default=1.0, help="design pixel density")
    parser.add_argument("--bg", help="background color as hex (default: the design's most common color)")
    parser.add_argument("--max-shift", type=int, default=32, help="largest shift to look for, in CSS pixels")
    parser.add_argument("--images", choices=IMAGE_MODES, default="all",
                        help="evidence images to write: the composite, heatmap, overview and cluster close-ups; "
                             "only the overview and close-ups (enough while fixing); or none")
    parser.add_argument("--brief", action="store_true", help="print only the scores, gates and largest clusters; diff.toon keeps everything")
    parser.add_argument("--json", action="store_true", help="print JSON instead of TOON")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the inputs and report what would run, without scoring or writing")
    args = parser.parse_args()
    if not 0 <= args.tolerance <= 255:
        raise PPError("--tolerance must be between 0 and 255")

    design, _ = load_rgb(args.design)
    render, _ = load_rgb(args.render)
    background = parse_hex(args.bg) if args.bg else None
    if args.dry:
        emit(
            {
                "dry_run": True,
                "design": {"path": args.design, "w": design.shape[1], "h": design.shape[0]},
                "render": {"path": args.render, "w": render.shape[1], "h": render.shape[0]},
                "size_match": design.shape[:2] == render.shape[:2],
                "thresholds": {"content": num(args.threshold), "tile_floor": num(args.tile_floor), "tolerance": args.tolerance},
                "tile_px": max(4, int(round(args.tile * args.scale))),
                "writes": [
                    os.path.join(args.out_dir, name)
                    for name in ("diff.toon", "diff.json")
                    + (("composite.png", "heatmap.png") if args.images == "all" else ())
                    + (("overview.png", "cluster-N.png") if args.images != "none" else ())
                ],
            },
            args.json,
        )
        return 0
    result = run_diff(
        design, render, args.out_dir, args.tolerance, args.threshold, args.tile_floor, args.tile,
        args.scale, background, args.max_shift, args.images,
    )
    result["reference"] = reference_record(args.design)
    result = with_css(result, args.scale)
    emit(with_css(brief(result), args.scale) if args.brief else result, args.json)
    save_result(result, args.out_dir)
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    run_cli(main)
