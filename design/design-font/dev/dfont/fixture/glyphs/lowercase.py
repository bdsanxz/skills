"""Lowercase glyphs of the fixture."""
from dfont import glyph, path
from lib import arch, ring


@glyph("dotlessi")
def dotlessi(g, p):
    g.stroke(path((0, 0), edge="left").line((0, p.xheight), edge="left"), p.stem)
    g.anchor("top", p.stem / 2, p.xheight)
    g.space(p.sb_straight, p.sb_straight)


@glyph("i")
def i(g, p):
    g.ref("dotlessi")
    d = p.stem * 1.2
    g.dot(p.stem / 2, p.xheight + p.stem * 0.9 + d / 2, d)
    g.space(p.sb_straight, p.sb_straight)


@glyph("l")
def l(g, p):
    g.stroke(path((0, 0), edge="left").line((0, p.ascender), edge="left"), p.stem)
    g.space(p.sb_straight, p.sb_straight)


@glyph("h")
def h(g, p):
    g.stroke(path((0, 0), edge="left").line((0, p.ascender), edge="left"), p.stem)
    arch(g, p, 0, p.n_width, p.xheight)
    g.space(p.sb_straight, p.sb_straight * 0.9)


@glyph("m")
def m(g, p):
    w = p.n_width * 0.82
    g.stroke(path((0, 0), edge="left").line((0, p.xheight), edge="left"), p.stem)
    arch(g, p, 0, w, p.xheight)
    arch(g, p, w - p.stem, 2 * w - p.stem, p.xheight)
    g.space(p.sb_straight, p.sb_straight * 0.9)


@glyph("u")
def u(g, p):
    # n turned half a circle.
    g.ref("n", sx=-1, sy=-1, dx=p.n_width, dy=p.xheight)
    g.anchor("top", p.n_width / 2, p.xheight)
    g.space(p.sb_straight * 0.9, p.sb_straight)


@glyph("c")
def c(g, p):
    x0, x1 = 0, p.o_width * 0.92
    xm = (x0 + x1) / 2
    bowl = (path((x1, p.xheight * 0.76), 115, w=0.8)
            .curve((xm, p.xheight + p.overshoot), "left", edge="top")
            .curve((x0, p.xheight / 2), "down", edge="left")
            .curve((xm, -p.overshoot), "right", edge="bottom")
            .curve((x1, p.xheight * 0.24), 65, w=0.8))
    g.stroke(bowl, p.stem * p.round_gain, thin=p.bar, cap=0)
    g.space(p.sb_round, p.sb_round * 0.6)


@glyph("e")
def e(g, p):
    x0, x1 = 0, p.o_width
    xm = (x0 + x1) / 2
    bar_y = p.xheight * 0.5
    bowl = (path((x1, bar_y), "up", edge="right")
            .curve((xm, p.xheight + p.overshoot), "left", edge="top")
            .curve((x0, p.xheight / 2), "down", edge="left")
            .curve((xm, -p.overshoot), "right", edge="bottom")
            .curve((x1 * 0.96, p.xheight * 0.22), 60, w=0.8))
    g.stroke(bowl, p.stem * p.round_gain, thin=p.bar, cap="butt", end=0)
    g.stroke(path((x0 + p.stem / 2, bar_y), edge="bottom").line((x1 - p.stem / 2, bar_y), edge="bottom"), p.bar)
    g.anchor("top", xm, p.xheight)
    g.space(p.sb_round, p.sb_round * 0.8)


@glyph("d")
def d(g, p):
    x1 = p.o_width * 0.96
    g.stroke(ring(0, x1, -p.overshoot, p.xheight + p.overshoot, right_w=0.8), p.stem * p.round_gain, thin=p.bar)
    g.stroke(path((x1, 0), edge="right").line((x1, p.ascender), edge="right"), p.stem)
    g.space(p.sb_round, p.sb_straight)


@glyph("b")
def b(g, p):
    g.ref("d", sx=-1, dx=p.o_width * 0.96)
    g.space(p.sb_straight, p.sb_round)


@glyph("v")
def v(g, p):
    w = p.n_width * 1.02
    sw = p.stem * 0.95
    g.stroke(path((0, p.xheight)).line((w / 2, sw / 2)).line((w, p.xheight)), sw, join="flat", cap=0)
    g.space(p.sb_round * 0.4, p.sb_round * 0.4)
