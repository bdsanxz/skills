"""`dfont new`: a project with font.json, starter control glyphs, kerning.json and lib.py."""
import json
import os

# Lowercase stem as a fraction of the x-height, by weight class.
STEM_RATIO = [(100, 0.04), (200, 0.075), (300, 0.115), (400, 0.17), (500, 0.205), (600, 0.245), (700, 0.29),
              (800, 0.33), (900, 0.37)]


def _ratio(weight):
    pts = STEM_RATIO
    if weight <= pts[0][0]:
        return pts[0][1]
    for (w0, r0), (w1, r1) in zip(pts, pts[1:]):
        if weight <= w1:
            return r0 + (r1 - r0) * (weight - w0) / (w1 - w0)
    return pts[-1][1]


def master_params(weight, xh, cap):
    stem = round(xh * _ratio(weight))
    return {
        "stem": stem,
        "stem_cap": round(stem * 1.07),
        "bar": round(stem * 0.86),
        "bar_cap": round(stem * 0.9),
        "round_gain": 1.05,
        "n_width": round(xh * 0.86 + stem * 0.55),
        "o_width": round(xh * 0.94 + stem * 0.5),
        "H_width": round(cap * 0.84 + stem * 0.6),
        "O_width": round(cap * 1.0 + stem * 0.5),
        "arch_join": round(xh * 0.2 + stem * 0.3),
        "arch_drop": round(xh * 0.36),
        "sb_straight": round(xh * 0.13 - stem * 0.1),
        "sb_round": round(xh * 0.09 - stem * 0.07),
        "sb_cap_straight": round(cap * 0.115 - stem * 0.08),
        "sb_cap_round": round(cap * 0.075 - stem * 0.05),
        "space": round(xh * 0.48 + stem * 0.4),
    }


STARTER = '''"""Control glyphs: the letters every other glyph is measured against.

Rewrite these to the brief before drawing anything else. Each function runs once
per master with that master's parameters in `p`; draw the same strokes and nodes
for every master and let only the numbers change.
"""
from dfont import glyph, path


@glyph("space")
def space(g, p):
    g.fixed(p.space)


@glyph("n")
def n(g, p):
    x0, x1, top = 0, p.n_width, p.xheight
    # Left stem: its left edge on x0, flat at the x-height.
    g.stroke(path((x0, 0), edge="left").line((x0, top), edge="left"), p.stem)
    # Arch: starts inside the stem (half width, so it stays hidden there), peaks
    # on the overshoot line, and falls into the right stem.
    arch = (path((x0 + p.stem / 2, top - p.arch_join), "up", w=0.5)
            .curve(((x0 + x1) / 2 + p.stem * 0.1, top + p.overshoot), "right", edge="top")
            .curve((x1, top - p.arch_drop), "down", edge="right")
            .line((x1, 0), edge="right"))
    g.stroke(arch, p.stem, thin=p.bar)
    g.anchor("top", (x0 + x1) / 2, top)
    g.space(p.sb_straight, p.sb_straight * 0.9)


@glyph("o")
def o(g, p):
    x0, x1, ym = 0, p.o_width, p.xheight / 2
    ring = (path((x0, ym), "down", edge="left")
            .curve(((x0 + x1) / 2, -p.overshoot), "right", edge="bottom")
            .curve((x1, ym), "up", edge="right")
            .curve(((x0 + x1) / 2, p.xheight + p.overshoot), "left", edge="top")
            .close(curve=True))
    g.stroke(ring, p.stem * p.round_gain, thin=p.bar)
    g.anchor("top", (x0 + x1) / 2, p.xheight)
    g.space(p.sb_round, p.sb_round)


@glyph("H")
def H(g, p):
    x0, x1, top = 0, p.H_width, p.cap
    g.stroke(path((x0, 0), edge="left").line((x0, top), edge="left"), p.stem_cap)
    g.stroke(path((x1, 0), edge="right").line((x1, top), edge="right"), p.stem_cap)
    # Crossbar ends hidden inside the stems; its center sits a little above the middle.
    y = top * 0.51
    g.stroke(path((x0 + p.stem_cap / 2, y)).line((x1 - p.stem_cap / 2, y)), p.bar_cap)
    g.anchor("top", (x0 + x1) / 2, top)
    g.space(p.sb_cap_straight, p.sb_cap_straight)


@glyph("O")
def O(g, p):
    x0, x1, ym = 0, p.O_width, p.cap / 2
    ring = (path((x0, ym), "down", edge="left")
            .curve(((x0 + x1) / 2, -p.overshoot), "right", edge="bottom")
            .curve((x1, ym), "up", edge="right")
            .curve(((x0 + x1) / 2, p.cap + p.overshoot), "left", edge="top")
            .close(curve=True))
    g.stroke(ring, p.stem_cap * p.round_gain, thin=p.bar_cap)
    g.anchor("top", (x0 + x1) / 2, p.cap)
    g.space(p.sb_cap_round, p.sb_cap_round)
'''

LIB = '''"""Shared drawing helpers for this font's glyph files.

Glyph files import from here with `from lib import ...`. Put every shape that
several glyphs share in a function here (a bowl, an arch, a terminal, a
diagonal), so a change to it reaches every glyph that uses it.
"""
from dfont import path  # noqa: F401
'''

GROUPS = ("lowercase", "uppercase", "figures", "punctuation", "symbols", "marks")


def parse_weights(spec):
    out = []
    for item in spec.split(","):
        item = item.strip()
        if not item:
            continue
        if ":" not in item:
            raise ValueError("weight {!r} must be Name:value, as in Regular:400".format(item))
        name, value = item.split(":", 1)
        out.append((name.strip(), float(value)))
    if not out:
        raise ValueError("--weights needs at least one Name:value")
    return out


def create(root, family, weights, default, charset, upm, xheight, cap, ascender, descender):
    if os.path.exists(os.path.join(root, "font.json")):
        raise FileExistsError("{} already holds a font project (font.json); choose an empty directory".format(root))
    names = [n for n, _ in weights]
    if default not in names:
        raise ValueError("--default {!r} is not one of the weights: {}".format(default, ", ".join(names)))
    os.makedirs(os.path.join(root, "glyphs"), exist_ok=True)
    values = [v for _, v in weights]
    dv = dict(weights)[default]
    masters = [{"name": n, "location": {"wght": v}, "params": master_params(v, xheight, cap)} for n, v in weights]
    cfg = {
        "family": family,
        "version": "0.100",
        "designer": "",
        "copyright": "",
        "license": None,
        "license_url": None,
        "vendor": "NONE",
        "charset": charset,
        "metrics": {"upm": upm, "ascender": ascender, "descender": descender, "xheight": xheight, "cap": cap,
                    "line_gap": None},
        "shared": {"overshoot": round(xheight * 0.024)},
        "masters": masters,
        "instances": [{"name": n, "location": {"wght": v}} for n, v in weights],
    }
    if len(weights) > 1:
        cfg["axes"] = [{"tag": "wght", "name": "Weight", "min": min(values), "default": dv, "max": max(values)}]
    else:
        for m in cfg["masters"]:
            m.pop("location")
        for i in cfg["instances"]:
            i.pop("location")
    with open(os.path.join(root, "font.json"), "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")
    with open(os.path.join(root, "glyphs", "control.py"), "w", encoding="utf-8") as fh:
        fh.write(STARTER)
    for group in GROUPS:
        path = os.path.join(root, "glyphs", group + ".py")
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as fh:
                fh.write('"""{} glyphs."""\nfrom dfont import glyph, path  # noqa: F401\n'.format(group.capitalize()))
    with open(os.path.join(root, "lib.py"), "w", encoding="utf-8") as fh:
        fh.write(LIB)
    with open(os.path.join(root, "kerning.json"), "w", encoding="utf-8") as fh:
        fh.write('{\n  "pairs": {}\n}\n')
    return [os.path.join(root, p) for p in ("font.json", "glyphs/control.py", "lib.py", "kerning.json")]
