"""Plane geometry for skeletons and outlines: vectors, cubic Béziers, Hobby curves.

Points are (x, y) tuples in font units, y up. A contour is a closed list of
segments: ("line", p) or ("curve", c1, c2, p), each ending at p and starting
where the previous one ended; the first segment starts at the contour's start
point.
"""
import math

EPS = 1e-9


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def mul(a, s):
    return (a[0] * s, a[1] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def length(a):
    return math.hypot(a[0], a[1])


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def unit(a):
    n = length(a)
    if n < EPS:
        return (0.0, 0.0)
    return (a[0] / n, a[1] / n)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def rotate(v, angle):
    c, s = math.cos(angle), math.sin(angle)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)


def left_normal(t):
    return (-t[1], t[0])


def angle_of(v):
    return math.atan2(v[1], v[0])


def wrap(angle):
    """Normalize an angle to (-pi, pi]."""
    while angle <= -math.pi:
        angle += 2 * math.pi
    while angle > math.pi:
        angle -= 2 * math.pi
    return angle


def direction_vector(angle_deg):
    a = math.radians(angle_deg)
    return (math.cos(a), math.sin(a))


def line_intersection(p, d, q, e):
    """Intersection of the lines p + s*d and q + u*e, or None when parallel."""
    den = cross(d, e)
    if abs(den) < 1e-9:
        return None
    s = cross(sub(q, p), e) / den
    return add(p, mul(d, s))


# --- cubic Béziers ---------------------------------------------------------


def cubic_point(p0, p1, p2, p3, t):
    mt = 1 - t
    a = mt * mt * mt
    b = 3 * mt * mt * t
    c = 3 * mt * t * t
    d = t * t * t
    return (
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    )


def cubic_derivative(p0, p1, p2, p3, t):
    mt = 1 - t
    a = 3 * mt * mt
    b = 6 * mt * t
    c = 3 * t * t
    return (
        a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
        a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]),
    )


def cubic_tangent(p0, p1, p2, p3, t):
    """Unit tangent, robust where a handle collapses onto its end point."""
    d = cubic_derivative(p0, p1, p2, p3, t)
    if length(d) > 1e-7:
        return unit(d)
    # Retracted handle: step a little inward.
    t2 = min(max(t + (1e-3 if t < 0.5 else -1e-3), 0.0), 1.0)
    d = sub(cubic_point(p0, p1, p2, p3, t2), cubic_point(p0, p1, p2, p3, t))
    if t2 < t:
        d = mul(d, -1)
    if length(d) > 1e-9:
        return unit(d)
    return unit(sub(p3, p0))


def split_cubic(p0, p1, p2, p3, t):
    a = lerp(p0, p1, t)
    b = lerp(p1, p2, t)
    c = lerp(p2, p3, t)
    d = lerp(a, b, t)
    e = lerp(b, c, t)
    f = lerp(d, e, t)
    return (p0, a, d, f), (f, e, c, p3)


def _quadratic_roots(a, b, c):
    if abs(a) < 1e-12:
        if abs(b) < 1e-12:
            return []
        return [-c / b]
    disc = b * b - 4 * a * c
    if disc < 0:
        return []
    r = math.sqrt(disc)
    return [(-b + r) / (2 * a), (-b - r) / (2 * a)]


def cubic_extrema_params(p0, p1, p2, p3, axis):
    """Parameters in (0, 1) where the curve's coordinate `axis` has an extremum."""
    a0, a1, a2, a3 = p0[axis], p1[axis], p2[axis], p3[axis]
    # derivative / 3 = A t^2 + B t + C
    A = -a0 + 3 * a1 - 3 * a2 + a3
    B = 2 * (a0 - 2 * a1 + a2)
    C = a1 - a0
    return sorted(t for t in _quadratic_roots(A, B, C) if 0 < t < 1)


def cubic_bounds(p0, p1, p2, p3):
    xs = [p0[0], p3[0]]
    ys = [p0[1], p3[1]]
    for t in cubic_extrema_params(p0, p1, p2, p3, 0):
        xs.append(cubic_point(p0, p1, p2, p3, t)[0])
    for t in cubic_extrema_params(p0, p1, p2, p3, 1):
        ys.append(cubic_point(p0, p1, p2, p3, t)[1])
    return min(xs), min(ys), max(xs), max(ys)


def _cubic_roots(a, b, c, d):
    """Real roots of a t^3 + b t^2 + c t + d."""
    if abs(a) < 1e-12:
        return _quadratic_roots(b, c, d)
    b, c, d = b / a, c / a, d / a
    q = (3 * c - b * b) / 9
    r = (9 * b * c - 27 * d - 2 * b * b * b) / 54
    disc = q * q * q + r * r
    shift = -b / 3
    if disc > 0:
        s = math.copysign(abs(r + math.sqrt(disc)) ** (1 / 3), r + math.sqrt(disc))
        t = math.copysign(abs(r - math.sqrt(disc)) ** (1 / 3), r - math.sqrt(disc))
        return [shift + s + t]
    if abs(q) < 1e-15:
        return [shift]
    theta = math.acos(max(-1.0, min(1.0, r / math.sqrt(-q * q * q))))
    m = 2 * math.sqrt(-q)
    return [
        shift + m * math.cos(theta / 3),
        shift + m * math.cos((theta + 2 * math.pi) / 3),
        shift + m * math.cos((theta + 4 * math.pi) / 3),
    ]


def cubic_axis_crossings(p0, p1, p2, p3, axis, value):
    """Parameters in [0, 1) where coordinate `axis` of the curve equals value."""
    a0, a1, a2, a3 = (p[axis] - value for p in (p0, p1, p2, p3))
    a = -a0 + 3 * a1 - 3 * a2 + a3
    b = 3 * a0 - 6 * a1 + 3 * a2
    c = -3 * a0 + 3 * a1
    d = a0
    out = []
    for t in _cubic_roots(a, b, c, d):
        if -1e-9 <= t < 1 - 1e-9:
            out.append(min(max(t, 0.0), 1.0))
    return sorted(out)


# --- Hobby curves ------------------------------------------------------------


def _hobby_velocity(theta, phi):
    st, ct = math.sin(theta), math.cos(theta)
    sp, cp = math.sin(phi), math.cos(phi)
    num = 2 + math.sqrt(2) * (st - sp / 16) * (sp - st / 16) * (ct - cp)
    den = 1 + 0.5 * (math.sqrt(5) - 1) * ct + 0.5 * (3 - math.sqrt(5)) * cp
    if den < 1e-6:
        return 4.0
    return min(num / den, 4.0)


def hobby_controls(z0, d0, z1, d1, tension0=1.0, tension1=1.0):
    """Control points of the Hobby curve leaving z0 heading d0 and arriving at z1 heading d1."""
    chord = sub(z1, z0)
    if length(chord) < EPS:
        return z0, z1
    ca = angle_of(chord)
    theta = wrap(angle_of(d0) - ca)
    phi = wrap(ca - angle_of(d1))
    c1 = add(z0, mul(rotate(chord, theta), _hobby_velocity(theta, phi) / (3 * tension0)))
    c2 = sub(z1, mul(rotate(chord, -phi), _hobby_velocity(phi, theta) / (3 * tension1)))
    return c1, c2


# --- contours ----------------------------------------------------------------


def contour_points(start, segments):
    """Every point of a contour, on- and off-curve, in drawing order."""
    pts = [start]
    for seg in segments:
        pts.extend(seg[1:])
    return pts


def iter_cubics(start, segments):
    """Yield (p0, p1, p2, p3, kind) for each segment; lines get collinear handles."""
    cur = start
    for seg in segments:
        if seg[0] == "line":
            p = seg[1]
            yield cur, lerp(cur, p, 1 / 3), lerp(cur, p, 2 / 3), p, "line"
        else:
            yield cur, seg[1], seg[2], seg[3], "curve"
        cur = seg[-1]


def contour_area(start, segments):
    """Signed area (positive when counterclockwise, y up)."""
    area = 0.0
    for p0, p1, p2, p3, kind in iter_cubics(start, segments):
        if kind == "line":
            area += cross(p0, p3)
        else:
            # Exact area term of a cubic (Green's theorem).
            area += (
                (p0[0] * (6 * p1[1] + 3 * p2[1] + p3[1])
                 + 3 * p1[0] * (-2 * p0[1] + p2[1] + p3[1])
                 + 3 * p2[0] * (-p0[1] - p1[1] + 2 * p3[1])
                 + p3[0] * (-p0[1] - 3 * p1[1] - 6 * p2[1])) / 10
            )
    return area / 2


def contour_bounds(start, segments):
    xs, ys = [start[0]], [start[1]]
    for p0, p1, p2, p3, kind in iter_cubics(start, segments):
        if kind == "line":
            xs.append(p3[0])
            ys.append(p3[1])
        else:
            b = cubic_bounds(p0, p1, p2, p3)
            xs += [b[0], b[2]]
            ys += [b[1], b[3]]
    return min(xs), min(ys), max(xs), max(ys)


def reverse_contour(start, segments):
    """The same contour traced the other way, starting at the same point."""
    if not segments:
        return start, []
    pts = [start] + [seg[-1] for seg in segments]
    out = []
    # Walk segments backwards; segment i runs pts[i] -> pts[i+1].
    for i in range(len(segments) - 1, -1, -1):
        seg = segments[i]
        dest = pts[i]
        if seg[0] == "line":
            out.append(("line", dest))
        else:
            out.append(("curve", seg[2], seg[1], dest))
    # The reversed walk starts at the old end point, which is the start point of a
    # closed contour; keep `start` as the start.
    return start, out


def transform_point(p, m):
    """Apply (a, b, c, d, e, f): x' = a x + c y + e, y' = b x + d y + f."""
    a, b, c, d, e, f = m
    return (a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f)


def transform_contour(start, segments, m):
    return transform_point(start, m), [
        (seg[0],) + tuple(transform_point(p, m) for p in seg[1:]) for seg in segments
    ]


def flatten(start, segments, steps=16):
    """Polyline approximation of a contour."""
    pts = [start]
    for p0, p1, p2, p3, kind in iter_cubics(start, segments):
        if kind == "line":
            pts.append(p3)
        else:
            for i in range(1, steps + 1):
                pts.append(cubic_point(p0, p1, p2, p3, i / steps))
    return pts
