"""Figures of the fixture."""
from dfont import glyph, path
from lib import ring


@glyph("zero")
def zero(g, p):
    g.stroke(ring(0, p.o_width * 0.95, -p.overshoot, p.cap * 0.97 + p.overshoot), p.stem * 1.02, thin=p.bar)
    g.fixed(p.o_width * 0.95 + 2 * p.sb_round)


@glyph("one")
def one(g, p):
    x = p.o_width * 0.5
    g.stroke(path((x, 0)).line((x, p.cap * 0.97)), p.stem)
    g.stroke(path((x, p.cap * 0.97 - p.stem / 2)).line((x - p.o_width * 0.32, p.cap * 0.8)), p.bar, cap="round")
    g.fixed(p.o_width * 0.95 + 2 * p.sb_round)
