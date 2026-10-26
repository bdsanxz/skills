"""Uppercase glyphs of the fixture."""
from dfont import glyph, path


@glyph("V")
def V(g, p):
    w = p.H_width * 1.08
    sw = p.stem_cap
    g.stroke(path((0, p.cap)).line((w / 2, sw / 2)).line((w, p.cap)), sw, join="flat", cap=0)
    g.anchor("top", w / 2, p.cap)
    g.space(p.sb_cap_round * 0.3, p.sb_cap_round * 0.3)


@glyph("A")
def A(g, p):
    w = p.H_width * 1.08
    g.ref("V", sy=-1, dy=p.cap)
    g.stroke(path((w * 0.22, p.cap * 0.27)).line((w * 0.78, p.cap * 0.27)), p.bar_cap)
    g.anchor("top", w / 2, p.cap)
    g.space(p.sb_cap_round * 0.3, p.sb_cap_round * 0.3)


@glyph("T")
def T(g, p):
    w = p.H_width
    g.stroke(path((0, p.cap), edge="top").line((w, p.cap), edge="top"), p.bar_cap)
    g.stroke(path((w / 2, 0)).line((w / 2, p.cap - p.bar_cap / 2)), p.stem_cap)
    g.space(p.sb_cap_round * 0.4, p.sb_cap_round * 0.4)


@glyph("L")
def L(g, p):
    w = p.H_width * 0.8
    g.stroke(path((0, 0), edge="left").line((0, p.cap), edge="left"), p.stem_cap)
    g.stroke(path((p.stem_cap / 2, 0), edge="bottom").line((w, 0), edge="bottom"), p.bar_cap)
    g.space(p.sb_cap_straight, p.sb_cap_round * 0.4)
