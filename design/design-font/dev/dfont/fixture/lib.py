"""Shared drawing helpers for the fixture font."""
from dfont import path


def arch(g, p, x0, x1, top):
    """An arch that leaves a stem whose left edge is x0 and falls into a stem whose right edge is x1."""
    a = (path((x0 + p.stem / 2, top - p.arch_join), "up", w=0.5)
         .curve(((x0 + x1) / 2 + p.stem * 0.1, top + p.overshoot), "right", edge="top")
         .curve((x1, top - p.arch_drop), "down", edge="right")
         .line((x1, 0), edge="right"))
    g.stroke(a, p.stem, thin=p.bar)


def ring(x0, x1, y0, y1, right_w=1.0):
    """A closed skeleton whose stroke's outer edges touch x0, x1, y0 and y1.

    right_w thins the right side, so it can hide inside a stem drawn over it.
    """
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    return (path((x0, ym), "down", edge="left")
            .curve((xm, y0), "right", edge="bottom")
            .curve((x1, ym), "up", edge="right", w=right_w)
            .curve((xm, y1), "left", edge="top")
            .close(curve=True))
