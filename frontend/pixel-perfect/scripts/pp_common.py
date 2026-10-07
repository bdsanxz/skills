"""Shared helpers for the pixel-perfect scripts."""
import argparse
import hashlib
import json
import os
import re
import shlex
import sys

import numpy as np
from PIL import Image

import toon

# Keys whose values are lengths or coordinates in image pixels. They are the
# ones converted when a result is mirrored into CSS pixels.
LENGTH_KEYS = frozenset(
    """x y w h width height pos at start end size left top right bottom radius
    gaps sizes pitch baseline x_height ascent descent extent offset_x offset_y
    blur_estimate line_pitch font_size_estimate soft_px gutter column_width
    row_height row_gap dx dy dw dh from_row to_row from_col to_col shift_dx
    shift_dy""".split()
)


class PPError(Exception):
    """A user-facing error: unreadable image, bad region, bad argument."""


class Parser(argparse.ArgumentParser):
    """An argument parser that also takes arguments from a file, given as @path.

    A round's long list of items is written once and reused: the file holds
    the arguments as they would be typed, on as many lines as is convenient,
    with # starting a comment.
    """

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("fromfile_prefix_chars", "@")
        super().__init__(*args, **kwargs)

    def convert_arg_line_to_args(self, line):
        return shlex.split(line, comments=True)


def file_sha1(path):
    with open(path, "rb") as handle:
        return hashlib.sha1(handle.read()).hexdigest()


def load_rgb(path, matte=(255, 255, 255)):
    """Load an image as an RGB uint8 array, flattening alpha onto `matte`."""
    try:
        image = Image.open(path)
        image.load()
    except (OSError, ValueError) as error:
        raise PPError("cannot read image {}: {}".format(path, error))
    has_alpha = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
    if has_alpha:
        rgba = image.convert("RGBA")
        base = Image.new("RGBA", rgba.size, tuple(matte) + (255,))
        image = Image.alpha_composite(base, rgba)
    return np.asarray(image.convert("RGB"), dtype=np.uint8), has_alpha


def parse_hex(text):
    value = text.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(char * 2 for char in value)
    if len(value) != 6:
        raise PPError("expected a color like #1a2b3c, got '{}'".format(text))
    try:
        return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise PPError("expected a color like #1a2b3c, got '{}'".format(text))


def to_hex(rgb):
    r, g, b = (int(min(255, max(0, round(float(c))))) for c in rgb)
    return "#{:02x}{:02x}{:02x}".format(r, g, b)


def parse_ints(text, count, what):
    try:
        values = [int(part) for part in text.split(",")]
    except ValueError:
        values = []
    if len(values) != count:
        raise PPError("{} must be {} comma-separated integers, got '{}'".format(what, count, text))
    return values


def parse_region(text, shape):
    """Parse 'x,y,w,h' and check that it lies inside an image of `shape`."""
    x, y, w, h = parse_ints(text, 4, "region")
    height, width = shape[:2]
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > width or y + h > height:
        raise PPError("region {},{},{},{} is outside the {}x{} image".format(x, y, w, h, width, height))
    return x, y, w, h


def subs_path(path):
    """design.png -> design.subs.png, the copy `measure substitute` writes."""
    root, ext = os.path.splitext(path)
    return root + ".subs" + ext


def is_subs(path):
    return os.path.splitext(os.path.splitext(path)[0])[1] == ".subs"


def superseded_by(path):
    """The substituted copy that replaces this design image, when one exists."""
    copy = subs_path(path)
    return copy if not is_subs(path) and os.path.isfile(copy) else None


# --- the run's working directory ---------------------------------------------

RUNS_ROOT = os.path.join("_swe", "pixel-perfect")
RUN_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
RUN_PARTS = ("components", "sections", "pages", "sheets", "adhoc")


def is_run(path):
    return any(os.path.exists(os.path.join(path, mark)) for mark in ("inventory.toon", "components", "sections", "pages"))


def list_runs(root=RUNS_ROOT):
    if not os.path.isdir(root):
        return []
    return sorted(entry for entry in os.listdir(root) if entry not in RUN_PARTS and is_run(os.path.join(root, entry)))


def add_run_arguments(parser):
    parser.add_argument("--run", metavar="NAME", help="name of the run; its working directory is {}".format(os.path.join(RUNS_ROOT, "NAME")))
    parser.add_argument("--work-dir", help="the run's working directory given whole, instead of --run")


def run_dir(args, root=RUNS_ROOT):
    """The working directory the arguments name: <root>/<run>, or --work-dir."""
    if args.work_dir:
        return args.work_dir
    if args.run:
        if not RUN_NAME.match(args.run) or args.run in RUN_PARTS:
            raise PPError("--run must be a short lowercase name such as home or checkout-mobile; got '{}'".format(args.run))
        return os.path.join(root, args.run)
    if is_run(root):
        # A run kept directly in the root, as earlier versions of the skill laid it out.
        return root
    runs = list_runs(root)
    raise PPError("name the run with --run <name>{}".format(
        "; under {} there {}: {}".format(root, "is" if len(runs) == 1 else "are", ", ".join(runs)) if runs else ""))


def full_region(shape):
    return 0, 0, shape[1], shape[0]


def clamp_region(region, shape):
    """The part of a region that lies inside an image of `shape`, or None."""
    x, y, w, h = region
    height, width = shape[:2]
    left, top = max(0, x), max(0, y)
    right, bottom = min(width, x + w), min(height, y + h)
    if right <= left or bottom <= top:
        return None
    return left, top, right - left, bottom - top


def maxdiff(pixels, color):
    """Largest absolute channel difference between pixels and a color or array."""
    return np.abs(pixels.astype(np.int16) - np.asarray(color, dtype=np.int16)).max(axis=-1)


def color_counts(pixels):
    """Distinct colors and their counts, most frequent first."""
    flat = pixels.reshape(-1, 3).astype(np.uint32)
    packed = (flat[:, 0] << 16) | (flat[:, 1] << 8) | flat[:, 2]
    values, counts = np.unique(packed, return_counts=True)
    order = np.argsort(-counts, kind="stable")
    colors = [((int(v) >> 16) & 255, (int(v) >> 8) & 255, int(v) & 255) for v in values[order]]
    return colors, counts[order]


def dominant_color(pixels):
    colors, counts = color_counts(pixels)
    return colors[0], float(counts[0]) / float(counts.sum())


def border_pixels(sub):
    """The one-pixel perimeter of a region, as an N x 3 array."""
    if sub.shape[0] < 3 or sub.shape[1] < 3:
        return sub.reshape(-1, 3)
    return np.concatenate([sub[0], sub[-1], sub[1:-1, 0], sub[1:-1, -1]])


def runs_of(mask):
    """(start, end) pairs, end exclusive, for each run of True in a 1-D mask."""
    padded = np.concatenate(([0], np.asarray(mask, dtype=np.int8), [0]))
    change = np.diff(padded)
    return list(zip(np.nonzero(change == 1)[0].tolist(), np.nonzero(change == -1)[0].tolist()))


def num(value, digits=3):
    """Round for output; integral values become ints."""
    value = round(float(value), digits)
    return int(value) if value == int(value) else value


def _mirror(value, scale, is_length):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            mirrored = _mirror(item, scale, key in LENGTH_KEYS)
            if mirrored is not None:
                out[key] = mirrored
        return out or None
    if isinstance(value, list):
        if value and all(isinstance(item, dict) for item in value):
            rows = [_mirror(item, scale, False) for item in value]
            return rows if all(row is not None for row in rows) else None
        if is_length and value and all(isinstance(item, (int, float)) for item in value):
            return [num(item / scale) for item in value]
        return None
    if is_length and isinstance(value, (int, float)) and not isinstance(value, bool):
        return num(value / scale)
    return None


def with_css(data, scale):
    """Add a `css` block holding every length divided by the design scale."""
    if scale and scale != 1:
        mirrored = _mirror(data, float(scale), False)
        data["scale"] = num(scale)
        if mirrored:
            data["css"] = mirrored
    return data


def in_css(data, scale):
    """The same result with every length in CSS pixels, and nothing twice.

    The region a probe was given stays in image pixels, as `region_px`,
    because that is the unit every --region is typed in.
    """
    if not scale or scale == 1:
        return data

    def convert(value, is_length):
        if isinstance(value, dict):
            return {
                ("region_px" if key == "region" else key): item if key == "region" else convert(item, key in LENGTH_KEYS)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [convert(item, is_length) for item in value]
        if is_length and isinstance(value, (int, float)) and not isinstance(value, bool):
            return num(value / float(scale))
        return value

    converted = {"units": "css px", "scale": num(scale)}
    converted.update(convert(data, False))
    return converted


def emit(data, as_json=False):
    if as_json:
        print(json.dumps(toon._plain(data), indent=2))
    else:
        print(toon.encode(data))


def run_cli(main):
    try:
        sys.exit(main())
    except PPError as error:
        print("error: {}".format(error), file=sys.stderr)
        sys.exit(2)
