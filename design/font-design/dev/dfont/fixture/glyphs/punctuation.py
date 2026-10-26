"""Punctuation of the fixture."""
from dfont import glyph, path


@glyph("period")
def period(g, p):
    d = p.stem * 1.2
    g.dot(d / 2, d / 2, d)
    g.space(p.sb_round, p.sb_round)


@glyph("comma")
def comma(g, p):
    d = p.stem * 1.2
    g.dot(d / 2, d / 2, d)
    g.stroke(path((d * 0.75, d / 2)).curve((d * 0.15, -d * 1.3), "down", w=0.5), d * 0.5, cap="round")
    g.space(p.sb_round, p.sb_round)


@glyph("hyphen")
def hyphen(g, p):
    g.stroke(path((0, p.xheight * 0.48)).line((p.n_width * 0.6, p.xheight * 0.48)), p.bar)
    g.space(p.sb_round, p.sb_round)
