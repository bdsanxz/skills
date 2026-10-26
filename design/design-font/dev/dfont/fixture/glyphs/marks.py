"""Combining marks of the fixture."""
from dfont import glyph, path


def acute_at(g, p, base):
    # The gap above the base grows with the stroke, so the mark clears it in every master.
    y0 = base + p.stem * 0.5 + p.bar * 0.55
    g.stroke(path((0, y0)).line((90, y0 + 120)), p.bar * 1.1, cap="round")
    g.anchor("_top", 40, base)
    g.anchor("top", 45, y0 + 130)


@glyph("acutecomb")
def acutecomb(g, p):
    acute_at(g, p, p.xheight)


@glyph("acutecomb.case")
def acutecomb_case(g, p):
    acute_at(g, p, p.cap)


def dieresis_at(g, p, base):
    d = p.stem * 1.1
    y = base + p.stem * 0.6 + d / 2
    g.dot(0, y, d)
    g.dot(200, y, d)
    g.anchor("_top", 100, base)
    g.anchor("top", 100, y + d / 2)


@glyph("dieresiscomb")
def dieresiscomb(g, p):
    dieresis_at(g, p, p.xheight)


@glyph("dieresiscomb.case")
def dieresiscomb_case(g, p):
    dieresis_at(g, p, p.cap)
