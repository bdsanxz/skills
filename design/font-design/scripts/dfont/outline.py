"""Measuring finished outlines: overlap removal and scanlines."""
from .compile import union
from .geometry import cubic_axis_crossings, cubic_point, cubic_derivative


def union_contours(contours):
    """Contours with overlaps removed, in this package's contour format."""
    rec = union(contours)
    out = []
    start = None
    segs = []
    cur = None
    for op, args in rec.value:
        if op == "moveTo":
            start = cur = args[0]
            segs = []
        elif op == "lineTo":
            segs.append(("line", args[0]))
            cur = args[0]
        elif op == "curveTo":
            segs.append(("curve", args[0], args[1], args[2]))
            cur = args[2]
        elif op == "qCurveTo":
            # Rare in pathops output; approximate each quadratic piece as a cubic.
            pts = list(args)
            p0 = cur
            for i in range(len(pts) - 1):
                q = pts[i]
                end = pts[i + 1] if i == len(pts) - 2 else ((q[0] + pts[i + 1][0]) / 2, (q[1] + pts[i + 1][1]) / 2)
                c1 = (p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1]))
                c2 = (end[0] + 2 / 3 * (q[0] - end[0]), end[1] + 2 / 3 * (q[1] - end[1]))
                segs.append(("curve", c1, c2, end))
                p0 = end
            cur = p0
        elif op in ("closePath", "endPath"):
            if start is not None and segs:
                last = segs[-1][-1]
                if abs(last[0] - start[0]) > 1e-6 or abs(last[1] - start[1]) > 1e-6:
                    segs.append(("line", start))
                out.append((start, segs))
            start = None
    return out


def _crossings(contours, axis, value):
    """(position along the other axis, winding direction) where contours cross the line."""
    other = 1 - axis
    hits = []
    for start, segs in contours:
        cur = start
        for seg in segs:
            if seg[0] == "line":
                p0, p1 = cur, seg[1]
                a0, a1 = p0[axis], p1[axis]
                if (a0 <= value < a1) or (a1 <= value < a0):
                    t = (value - a0) / (a1 - a0)
                    pos = p0[other] + t * (p1[other] - p0[other])
                    hits.append((pos, 1 if a1 > a0 else -1))
            else:
                p0, c1, c2, p3 = cur, seg[1], seg[2], seg[3]
                for t in cubic_axis_crossings(p0, c1, c2, p3, axis, value):
                    d = cubic_derivative(p0, c1, c2, p3, t)[axis]
                    if abs(d) < 1e-9:
                        continue
                    pos = cubic_point(p0, c1, c2, p3, t)[other]
                    hits.append((pos, 1 if d > 0 else -1))
            cur = seg[-1]
    hits.sort()
    return hits


def runs(contours, axis, value):
    """Ink runs (start, end) along a line: axis 1 is a horizontal line y=value, axis 0 a vertical x=value."""
    value = value + 0.013
    hits = _crossings(contours, axis, value)
    out = []
    winding = 0
    begin = None
    for pos, d in hits:
        before = winding
        winding += d
        if before == 0 and winding != 0:
            begin = pos
        elif before != 0 and winding == 0 and begin is not None:
            if pos - begin > 0.01:
                out.append((begin, pos))
            begin = None
    return out
