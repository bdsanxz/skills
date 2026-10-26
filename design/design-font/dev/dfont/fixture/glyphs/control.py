"""Control glyphs: the letters every other glyph is measured against.

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
