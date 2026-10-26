"""Skeleton resolution and stroke expansion.

A skeleton path (dsl.Path) is resolved into cubic segments: Hobby curves get
their handles, nodes with an `edge` are shifted so the stroke's edge lands on
the given point. A resolved skeleton is then expanded into outline contours:
both offset sides of every segment are fitted with one cubic (or a line), joined
at corners, and closed with caps.

Every decision that changes the number of points (splitting a segment whose
offset does not fit one cubic) is taken for all masters of a glyph at once, so
the masters stay point-compatible.
"""
import math

from .geometry import (
    add, sub, mul, dot, cross, length, unit, lerp, left_normal, angle_of,
    cubic_point, cubic_derivative, cubic_tangent, split_cubic, hobby_controls,
    line_intersection, direction_vector,
)

KAPPA = 0.5522847498
FIT_TOLERANCE = 1.5
CORNER_DEGREES = 1.5
MAX_SPLIT_ROUNDS = 3
SAMPLES = 16

EDGE_SIDES = {"bottom": (0.0, -1.0), "top": (0.0, 1.0), "left": (-1.0, 0.0), "right": (1.0, 0.0)}


class StrokeError(Exception):
    """A skeleton that cannot be resolved or expanded; the message says where and why."""


class Pen:
    """Stroke options: thick and thin widths, the thin direction, caps and join."""

    def __init__(self, thick, thin=None, angle=0.0, start="butt", end="butt", join="miter"):
        self.thick = float(thick)
        self.thin = float(thick if thin is None else thin)
        self.angle = math.radians(float(angle))
        self.start = start
        self.end = end
        self.join = join

    def half_width(self, tangent, w):
        s = math.sin(angle_of(tangent) - self.angle)
        return 0.5 * w * (self.thin + (self.thick - self.thin) * s * s)


# --- resolution ----------------------------------------------------------------


def _segment_count(path):
    return len(path.nodes) if path.closed else len(path.nodes) - 1


def _seg_end(path, i):
    return (i + 1) % len(path.nodes)


def _tangents(path, pts):
    """Start and end tangent of every segment, filling unknown curve directions."""
    n = _segment_count(path)
    start = [None] * n
    end = [None] * n
    for i in range(n):
        seg = path.segs[i]
        a, b = pts[i], pts[_seg_end(path, i)]
        if seg.kind == "line":
            t = unit(sub(b, a))
            start[i] = end[i] = t
        elif seg.kind == "cubic":
            c1, c2 = seg.c1, seg.c2
            start[i] = unit(sub(c1, a)) if length(sub(c1, a)) > 1e-6 else unit(sub(c2, a))
            end[i] = unit(sub(b, c2)) if length(sub(b, c2)) > 1e-6 else unit(sub(b, c1))
        else:
            start[i] = seg.out if seg.out is not None else path.nodes[i].dir
            end[i] = path.nodes[_seg_end(path, i)].dir
    for _ in range(3):
        for i in range(n):
            if path.segs[i].kind != "curve":
                continue
            if start[i] is None:
                prev = i - 1 if i > 0 else (n - 1 if path.closed else None)
                if prev is not None and end[prev] is not None:
                    start[i] = end[prev]
            if end[i] is None:
                nxt = i + 1 if i < n - 1 else (0 if path.closed else None)
                if nxt is not None and start[nxt] is not None and path.segs[nxt].kind != "curve":
                    end[i] = start[nxt]
    count = len(pts)
    for i in range(n):
        if path.segs[i].kind != "curve":
            continue
        for side in ("start", "end"):
            arr = start if side == "start" else end
            if arr[i] is not None:
                continue
            k = i if side == "start" else _seg_end(path, i)
            has_prev = path.closed or k > 0
            has_next = path.closed or k < count - 1
            if has_prev and has_next:
                arr[i] = unit(sub(pts[(k + 1) % count], pts[(k - 1) % count]))
            else:
                arr[i] = unit(sub(pts[_seg_end(path, i)], pts[i]))
    for i in range(n):
        if path.segs[i].kind == "curve" and path.segs[i].out is None and path.nodes[i].dir is None:
            # A curve leaving a node reached by a curve continues smoothly.
            prev = i - 1 if i > 0 else (n - 1 if path.closed else None)
            if prev is not None and path.segs[prev].kind == "curve" and end[prev] is not None:
                start[i] = end[prev]
    return start, end


def resolve(path, pen=None, where=""):
    """Resolve a dsl.Path into (closed, segments, widths).

    segments: list of (p0, p1, p2, p3, kind) with kind "line" or "curve".
    widths: the w multiplier at every node of the resolved skeleton.
    """
    if len(path.nodes) < 2:
        raise StrokeError("{}: a path needs at least two nodes".format(where))
    if not path.closed and len(path.segs) != len(path.nodes) - 1:
        raise StrokeError("{}: path is malformed".format(where))
    pts = [node.pt for node in path.nodes]
    if any(node.edge for node in path.nodes):
        if pen is None:
            raise StrokeError("{}: `edge` only applies to a stroked path, not to a filled shape".format(where))
        start, end = _tangents(path, pts)
        n = _segment_count(path)
        shifted = list(pts)
        for k, node in enumerate(path.nodes):
            if not node.edge:
                continue
            if node.edge not in EDGE_SIDES:
                raise StrokeError("{}: node {} has edge={!r}; use one of bottom, top, left, right".format(
                    where, k, node.edge))
            t = None
            if k < n:
                t = start[k]
            if t is None and k > 0:
                t = end[k - 1]
            if t is None and path.closed:
                t = end[n - 1]
            nrm = left_normal(t)
            side = EDGE_SIDES[node.edge]
            d = dot(nrm, side)
            if abs(d) < 0.3:
                raise StrokeError(
                    "{}: node {} has edge={!r} but the stroke there runs towards that side; "
                    "the edge of a stroke is perpendicular to its direction".format(where, k, node.edge))
            h = pen.half_width(t, node.w)
            sign = 1.0 if d > 0 else -1.0
            shifted[k] = sub(node.pt, mul(nrm, sign * h))
        pts = shifted
    start, end = _tangents(path, pts)
    segments = []
    n = _segment_count(path)
    for i in range(n):
        seg = path.segs[i]
        j = _seg_end(path, i)
        a, b = pts[i], pts[j]
        if length(sub(b, a)) < 1e-6:
            raise StrokeError("{}: segment {} has zero length (node {} and node {} coincide)".format(
                where, i, i, j))
        if seg.kind == "line":
            segments.append((a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b, "line"))
        elif seg.kind == "cubic":
            da = sub(a, path.nodes[i].pt)
            db = sub(b, path.nodes[j].pt)
            segments.append((a, add(seg.c1, da), add(seg.c2, db), b, "curve"))
        else:
            c1, c2 = hobby_controls(a, start[i], b, end[i], seg.tension, seg.tension)
            segments.append((a, c1, c2, b, "curve"))
    widths = [node.w for node in path.nodes]
    return path.closed, segments, widths


# --- expansion -----------------------------------------------------------------


def _offset_samples(seg, w0, w1, pen, sign):
    p0, p1, p2, p3, kind = seg
    pts = []
    tans = []
    for k in range(SAMPLES + 1):
        t = k / SAMPLES
        b = cubic_point(p0, p1, p2, p3, t)
        tg = cubic_tangent(p0, p1, p2, p3, t)
        h = pen.half_width(tg, w0 + (w1 - w0) * t)
        pts.append(add(b, mul(left_normal(tg), sign * h)))
        tans.append(tg)
    return pts, tans


def _offset_point(seg, t, w0, w1, pen, sign):
    p0, p1, p2, p3, _ = seg
    b = cubic_point(p0, p1, p2, p3, t)
    tg = cubic_tangent(p0, p1, p2, p3, t)
    h = pen.half_width(tg, w0 + (w1 - w0) * t)
    return add(b, mul(left_normal(tg), sign * h))


def _bernstein(u):
    mu = 1 - u
    return mu * mu * mu, 3 * mu * mu * u, 3 * mu * u * u, u * u * u


def _fit_cubic(points, t0, t3):
    """Fit one cubic to points with fixed ends and end tangent directions."""
    P0, P3 = points[0], points[-1]
    chord = length(sub(P3, P0))
    acc = [0.0]
    for i in range(1, len(points)):
        acc.append(acc[-1] + length(sub(points[i], points[i - 1])))
    total = acc[-1] or 1.0
    us = [a / total for a in acc]
    a = b = chord / 3

    def solve(us):
        c00 = c01 = c11 = x0 = x1 = 0.0
        for q, u in zip(points, us):
            b0, b1, b2, b3 = _bernstein(u)
            A1 = mul(t0, b1)
            A2 = mul(t3, -b2)
            base = add(mul(P0, b0 + b1), mul(P3, b2 + b3))
            r = sub(q, base)
            c00 += dot(A1, A1)
            c01 += dot(A1, A2)
            c11 += dot(A2, A2)
            x0 += dot(r, A1)
            x1 += dot(r, A2)
        det = c00 * c11 - c01 * c01
        if abs(det) < 1e-12:
            return None
        return (x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det

    for _ in range(4):
        sol = solve(us)
        if sol is None:
            break
        a, b = sol
        c1, c2 = add(P0, mul(t0, a)), sub(P3, mul(t3, b))
        # Newton step on every parameter.
        new = [0.0]
        for q, u in zip(points[1:-1], us[1:-1]):
            pt = cubic_point(P0, c1, c2, P3, u)
            d1 = cubic_derivative(P0, c1, c2, P3, u)
            mu = 1 - u
            d2 = add(mul(sub(add(c2, P0), mul(c1, 2)), 6 * mu), mul(sub(add(P3, c1), mul(c2, 2)), 6 * u))
            diff = sub(pt, q)
            den = dot(d1, d1) + dot(diff, d2)
            if abs(den) > 1e-12:
                u = u - dot(diff, d1) / den
            new.append(min(max(u, 0.0), 1.0))
        new.append(1.0)
        us = new
    bad = not (0 < a < 3 * chord + 1 and 0 < b < 3 * chord + 1)
    if bad:
        a = b = chord / 3
    c1, c2 = add(P0, mul(t0, a)), sub(P3, mul(t3, b))
    err = 0.0
    for q, u in zip(points, us):
        err = max(err, length(sub(cubic_point(P0, c1, c2, P3, u), q)))
    if bad:
        err = max(err, 1e6)
    return c1, c2, err


def _offset_segment(seg, w0, w1, pen, sign):
    """Offset of one skeleton segment on one side: (piece, fit_error, folded)."""
    p0, p1, p2, p3, kind = seg
    if kind == "line":
        a = _offset_point(seg, 0.0, w0, w1, pen, sign)
        b = _offset_point(seg, 1.0, w0, w1, pen, sign)
        return [a, b], 0.0, dot(sub(b, a), sub(p3, p0)) <= 0
    pts, tans = _offset_samples(seg, w0, w1, pen, sign)
    folded = False
    for k in range(len(pts) - 1):
        if dot(sub(pts[k + 1], pts[k]), tans[k]) <= 0:
            folded = True
            break
    eps = 1e-3
    t0 = unit(sub(_offset_point(seg, eps, w0, w1, pen, sign), pts[0]))
    t3 = unit(sub(pts[-1], _offset_point(seg, 1 - eps, w0, w1, pen, sign)))
    if length(t0) < 0.5:
        t0 = tans[0]
    if length(t3) < 0.5:
        t3 = tans[-1]
    c1, c2, err = _fit_cubic(pts, t0, t3)
    return [pts[0], c1, c2, pts[-1]], err, folded


def _move_end(piece, p):
    d = sub(p, piece[-1])
    if len(piece) == 4:
        piece[2] = add(piece[2], d)
    piece[-1] = p


def _move_start(piece, p):
    d = sub(p, piece[0])
    if len(piece) == 4:
        piece[1] = add(piece[1], d)
    piece[0] = p


def _tangent_out(piece):
    if len(piece) == 2:
        return unit(sub(piece[1], piece[0]))
    return cubic_tangent(piece[0], piece[1], piece[2], piece[3], 0.0)


def _tangent_in(piece):
    if len(piece) == 2:
        return unit(sub(piece[1], piece[0]))
    return cubic_tangent(piece[0], piece[1], piece[2], piece[3], 1.0)


def _join(side_a, side_b, node, ta, tb, h, join, outer, notes):
    """Join the end of side_a's last piece to the start of side_b's first piece.

    side_a and side_b are lists of pieces (modified in place); returns pieces to
    insert between them.
    """
    a, b = side_a[-1], side_b[0]
    da, db = _tangent_in(a), _tangent_out(b)
    if not outer:
        x = line_intersection(a[-1], da, b[0], db)
        if x is None:
            x = lerp(a[-1], b[0], 0.5)
        _move_end(a, x)
        _move_start(b, x)
        return []
    if join == "flat":
        bis = unit(sub(ta, tb))
        if length(bis) < 0.5:
            bis = left_normal(ta)
        cpt = add(node, mul(bis, h))
        cdir = left_normal(bis)
        p1 = line_intersection(a[-1], da, cpt, cdir) or a[-1]
        p2 = line_intersection(b[0], db, cpt, cdir) or b[0]
        extra = []
        if len(a) == 2:
            _move_end(a, p1)
        else:
            extra.append([a[-1], p1])
        extra.append([p1, p2])
        if len(b) == 2:
            _move_start(b, p2)
        else:
            extra.append([p2, b[0]])
        return extra
    x = line_intersection(a[-1], da, b[0], db)
    if x is None:
        x = lerp(a[-1], b[0], 0.5)
    if length(sub(x, node)) > 4 * max(h, 1.0):
        notes.append(("miter", length(sub(x, node))))
    extra = []
    if len(a) == 2:
        _move_end(a, x)
    else:
        extra.append([a[-1], x])
    if len(b) == 2:
        _move_start(b, x)
    else:
        extra.append([x, b[0]])
    return extra


def _cap(kind, end_pt, tangent, left_pt, right_pt, h, last_left, first_right):
    """Pieces from left_pt to right_pt around an open end.

    tangent points out of the stroke. last_left / first_right are the pieces that
    end at left_pt / start at right_pt, moved in place for cut caps.
    """
    if kind == "butt":
        return [[left_pt, right_pt]]
    if kind == "square":
        a = add(left_pt, mul(tangent, h))
        b = add(right_pt, mul(tangent, h))
        return [[left_pt, a], [a, b], [b, right_pt]]
    if kind == "round":
        tip = add(end_pt, mul(tangent, h))
        nl = unit(sub(left_pt, end_pt))
        nr = unit(sub(right_pt, end_pt))
        return [
            [left_pt, add(left_pt, mul(tangent, KAPPA * h)), add(tip, mul(nl, KAPPA * h)), tip],
            [tip, add(tip, mul(nr, KAPPA * h)), add(right_pt, mul(tangent, KAPPA * h)), right_pt],
        ]
    # A cut cap: the end lies on a line through the skeleton end at `kind` degrees.
    u = direction_vector(float(kind))
    xl = line_intersection(left_pt, tangent, end_pt, u)
    xr = line_intersection(right_pt, tangent, end_pt, u)
    if xl is None or xr is None:
        raise StrokeError("a cut cap at {} degrees runs along the stroke; choose another angle".format(kind))
    _move_end(last_left, xl)
    _move_start(first_right, xr)
    return [[xl, xr]]


def _is_corner(ta, tb):
    return math.degrees(abs(math.atan2(cross(ta, tb), dot(ta, tb)))) > CORNER_DEGREES


def _expand_once(closed, segments, widths, pen):
    """Expand one resolved skeleton. Returns (contours, errors, folds, notes)."""
    n = len(segments)
    count = len(widths)
    lefts, rights, errors, folds = [], [], [], []
    for i, seg in enumerate(segments):
        w0, w1 = widths[i], widths[(i + 1) % count]
        lp, le, lf = _offset_segment(seg, w0, w1, pen, 1.0)
        rp, re, rf = _offset_segment(seg, w0, w1, pen, -1.0)
        lefts.append(lp)
        rights.append(rp)
        errors.append(max(le, re))
        folds.append(lf or rf)
    notes = []

    def tangents(i):
        p0, p1, p2, p3, _ = segments[i]
        return cubic_tangent(p0, p1, p2, p3, 0.0), cubic_tangent(p0, p1, p2, p3, 1.0)

    def assemble(side, is_left):
        """Join consecutive pieces of one side into one list of pieces."""
        pieces = [list(p) for p in side]
        result = [pieces[0]]
        for j in range(1, n + 1 if closed else n):
            closing = j == n
            nxt = result[0] if closing else pieces[j]
            ta = tangents(j - 1)[1]
            tb = tangents(j % n)[0]
            node = segments[j % n][0]
            if _is_corner(ta, tb):
                left_turn = cross(ta, tb) > 0
                outer = (not left_turn) if is_left else left_turn
                wj = widths[j % count]
                h = 0.5 * (pen.half_width(ta, wj) + pen.half_width(tb, wj))
                result.extend(_join(result, [nxt], node, ta, tb, h, pen.join, outer, notes))
            else:
                mid = lerp(result[-1][-1], nxt[0], 0.5)
                _move_end(result[-1], mid)
                _move_start(nxt, mid)
            if not closing:
                result.append(nxt)
        return result

    left = assemble(lefts, True)
    right = assemble(rights, False)

    def to_contour(pieces):
        start = pieces[0][0]
        segs = []
        for p in pieces:
            if len(p) == 2:
                segs.append(("line", p[1]))
            else:
                segs.append(("curve", p[1], p[2], p[3]))
        return start, segs

    def reverse_pieces(pieces):
        return [list(reversed(p)) for p in reversed(pieces)]

    if closed:
        return [to_contour(left), to_contour(reverse_pieces(right))], errors, folds, notes
    s0, s_end = segments[0], segments[-1]
    t_start = cubic_tangent(s0[0], s0[1], s0[2], s0[3], 0.0)
    t_end = cubic_tangent(s_end[0], s_end[1], s_end[2], s_end[3], 1.0)
    h_end = pen.half_width(t_end, widths[-1])
    h_start = pen.half_width(t_start, widths[0])
    rev_right = reverse_pieces(right)
    end_cap = _cap(pen.end, s_end[3], t_end, left[-1][-1], rev_right[0][0], h_end, left[-1], rev_right[0])
    start_cap = _cap(pen.start, s0[0], mul(t_start, -1), rev_right[-1][-1], left[0][0], h_start,
                     rev_right[-1], left[0])
    pieces = left + end_cap + rev_right + start_cap
    # The start cap may have moved left[0][0]; the contour starts there.
    pieces[-1][-1] = pieces[0][0]
    return [to_contour(pieces)], errors, folds, notes


def _split_segment(closed, segments, widths, i):
    p0, p1, p2, p3, kind = segments[i]
    count = len(widths)
    wm = 0.5 * (widths[i] + widths[(i + 1) % count])
    if kind == "line":
        m = lerp(p0, p3, 0.5)
        a = (p0, lerp(p0, m, 1 / 3), lerp(p0, m, 2 / 3), m, "line")
        b = (m, lerp(m, p3, 1 / 3), lerp(m, p3, 2 / 3), p3, "line")
    else:
        h1, h2 = split_cubic(p0, p1, p2, p3, 0.5)
        a, b = h1 + ("curve",), h2 + ("curve",)
    segments = segments[:i] + [a, b] + segments[i + 1:]
    widths = widths[:i + 1] + [wm] + widths[i + 1:]
    return segments, widths


def expand(resolved, pens):
    """Expand one stroke for every master at once.

    resolved: per master, (closed, segments, widths) from resolve(); pens: per
    master, a Pen. Returns (per master contour lists, diagnostics) where
    diagnostics lists ("fit", segment, error), ("fold", segment, master index)
    and ("miter", length, master index).
    """
    work = [list(r) for r in resolved]
    for _ in range(MAX_SPLIT_ROUNDS + 1):
        results = [_expand_once(c, s, w, pen) for (c, s, w), pen in zip(work, pens)]
        n = len(work[0][1])
        to_split = [i for i in range(n) if any(res[1][i] > FIT_TOLERANCE for res in results)]
        if not to_split or _ == MAX_SPLIT_ROUNDS:
            break
        for m in range(len(work)):
            closed, segs, widths = work[m]
            for i in reversed(to_split):
                segs, widths = _split_segment(closed, segs, widths, i)
            work[m] = [closed, segs, widths]
    diags = []
    for m, res in enumerate(results):
        _, errors, folds, notes = res
        for i, (e, f) in enumerate(zip(errors, folds)):
            if f:
                diags.append(("fold", i, m))
            elif e > FIT_TOLERANCE:
                diags.append(("fit", i, m, e))
        for note in notes:
            diags.append((note[0], note[1], m))
    return [res[0] for res in results], diags
