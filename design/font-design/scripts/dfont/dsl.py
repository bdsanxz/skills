"""The drawing language of glyph files.

A glyph file defines glyphs with the @glyph decorator. Each glyph function is
called once per master with a GlyphBuilder `g` and that master's parameters
`p`, and draws with skeleton strokes and filled shapes:

    from dfont import glyph, path

    @glyph("o")
    def o(g, p):
        x0, x1, ym = 0, p.o_width, p.xheight / 2
        ring = (path((x0, ym), "down", edge="left")
                .curve((x1 / 2, -p.overshoot), "right", edge="bottom")
                .curve((x1, ym), "up", edge="right")
                .curve((x1 / 2, p.xheight + p.overshoot), "left", edge="top")
                .close(curve=True))
        g.stroke(ring, p.stem * p.round_gain, thin=p.bar)
        g.space(p.sb_round, p.sb_round)

A glyph function must draw the same structure for every master: the same
strokes and shapes, with the same nodes, in the same order. Only the numbers
may differ. Never branch on a parameter's value.
"""
import math
import os
import sys

from .geometry import unit, direction_vector

_REGISTRY = {}

NAMED_DIRECTIONS = {"right": 0.0, "up": 90.0, "left": 180.0, "down": 270.0}
CAPS = ("butt", "round", "square")
JOINS = ("miter", "flat")
EDGES = ("bottom", "top", "left", "right")


class DefinitionError(Exception):
    """A glyph file uses the drawing language wrongly; the message says how to fix it."""


class GlyphDef:
    def __init__(self, name, fn, unicodes, source):
        self.name = name
        self.fn = fn
        self.unicodes = unicodes
        self.source = source


def glyph(name, unicode=None):
    """Register a glyph function.

    unicode: a code point, a list of code points, or None to take the code
    point from the charset or the glyph name; pass False for an unencoded glyph.
    """
    if not isinstance(name, str) or not name:
        raise DefinitionError("@glyph needs the glyph name as a string, as in @glyph(\"a\")")

    def register(fn):
        code = getattr(fn, "__code__", None)
        source = "{}:{}".format(code.co_filename, code.co_firstlineno) if code else "?"
        if name in _REGISTRY:
            raise DefinitionError("glyph {!r} is defined twice: {} and {}".format(
                name, _REGISTRY[name].source, source))
        if unicode is False:
            unicodes = []
        elif unicode is None:
            unicodes = None
        elif isinstance(unicode, int):
            unicodes = [unicode]
        else:
            unicodes = [int(u) for u in unicode]
        _REGISTRY[name] = GlyphDef(name, fn, unicodes, source)
        return fn

    return register


def registry():
    return _REGISTRY


def reset_registry():
    _REGISTRY.clear()


def _caller():
    """file:line of the glyph-file line that called into this module."""
    here = os.path.abspath(__file__)
    frame = sys._getframe(1)
    while frame is not None and os.path.abspath(frame.f_code.co_filename) == here:
        frame = frame.f_back
    if frame is None:
        return "?"
    return "{}:{}".format(frame.f_code.co_filename, frame.f_lineno)


def _direction(d, what):
    if d is None:
        return None
    if isinstance(d, str):
        if d not in NAMED_DIRECTIONS:
            raise DefinitionError("{}: direction {!r} is not one of up, down, left, right or an angle in degrees".format(
                what, d))
        return direction_vector(NAMED_DIRECTIONS[d])
    if isinstance(d, (int, float)):
        return direction_vector(float(d))
    try:
        v = unit((float(d[0]), float(d[1])))
    except (TypeError, IndexError, ValueError):
        raise DefinitionError("{}: direction {!r} must be up/down/left/right, degrees, or an (x, y) vector".format(
            what, d))
    if v == (0.0, 0.0):
        raise DefinitionError("{}: direction vector {!r} has zero length".format(what, d))
    return v


def _point(p, what):
    try:
        x, y = p
        return (float(x), float(y))
    except (TypeError, ValueError):
        raise DefinitionError("{}: expected a point (x, y), got {!r}".format(what, p))


def _edge(e, what):
    if e is not None and e not in EDGES:
        raise DefinitionError("{}: edge={!r} must be one of bottom, top, left, right".format(what, e))
    return e


class Node:
    __slots__ = ("pt", "dir", "w", "edge")

    def __init__(self, pt, dir, w, edge):
        self.pt = pt
        self.dir = dir
        self.w = float(w)
        self.edge = edge


class Seg:
    __slots__ = ("kind", "tension", "out", "c1", "c2")

    def __init__(self, kind, tension=1.0, out=None, c1=None, c2=None):
        self.kind = kind
        self.tension = float(tension)
        self.out = out
        self.c1 = c1
        self.c2 = c2


class Path:
    """A skeleton or outline path, built node by node.

    Nodes take: dir (up, down, left, right, degrees or a vector: the tangent at
    the node), w (a width factor for strokes at this node), edge (bottom, top,
    left or right: the given point is the stroke's edge on that side, and the
    skeleton runs half a stroke inside it).
    """

    def __init__(self, pt, dir=None, w=1.0, edge=None):
        self.nodes = [Node(_point(pt, "path()"), _direction(dir, "path()"), w, _edge(edge, "path()"))]
        self.segs = []
        self.closed = False

    def _check_open(self, what):
        if self.closed:
            raise DefinitionError("{}: the path is already closed".format(what))

    def line(self, pt, w=1.0, edge=None):
        """A straight segment to pt."""
        self._check_open(".line()")
        self.segs.append(Seg("line"))
        self.nodes.append(Node(_point(pt, ".line()"), None, w, _edge(edge, ".line()")))
        return self

    def curve(self, pt, dir=None, w=1.0, edge=None, tension=1.0, out=None):
        """A smooth Hobby curve to pt, arriving with direction `dir`.

        It leaves the previous node in that node's direction, or in `out` when
        given. A larger tension (1.1-1.3) gives a rounder, tighter curve; a
        smaller one (0.8-0.95) a squarer, fuller one.
        """
        self._check_open(".curve()")
        if not 0.5 <= float(tension) <= 4:
            raise DefinitionError(".curve(): tension {} is outside 0.5 to 4".format(tension))
        self.segs.append(Seg("curve", tension=tension, out=_direction(out, ".curve(out=)")))
        self.nodes.append(Node(_point(pt, ".curve()"), _direction(dir, ".curve()"), w, _edge(edge, ".curve()")))
        return self

    def cubic(self, c1, c2, pt, w=1.0, edge=None):
        """A cubic Bézier to pt with explicit handles c1 and c2."""
        self._check_open(".cubic()")
        self.segs.append(Seg("cubic", c1=_point(c1, ".cubic()"), c2=_point(c2, ".cubic()")))
        self.nodes.append(Node(_point(pt, ".cubic()"), None, w, _edge(edge, ".cubic()")))
        return self

    def close(self, curve=False, tension=1.0, out=None):
        """Close the path back to its first node, with a line or (curve=True) a Hobby curve."""
        self._check_open(".close()")
        if len(self.nodes) < 2:
            raise DefinitionError(".close(): a closed path needs at least two nodes")
        first, last = self.nodes[0], self.nodes[-1]
        if abs(first.pt[0] - last.pt[0]) < 1e-6 and abs(first.pt[1] - last.pt[1]) < 1e-6:
            # The path already returned to its start: that segment closes it.
            self.nodes.pop()
            if first.dir is None and last.dir is not None:
                first.dir = last.dir
        elif curve:
            self.segs.append(Seg("curve", tension=tension, out=_direction(out, ".close(out=)")))
        else:
            self.segs.append(Seg("line"))
        if len(self.nodes) < 2:
            raise DefinitionError(".close(): a closed path needs at least two distinct nodes")
        self.closed = True
        return self

    def signature(self):
        return (self.closed, tuple(s.kind for s in self.segs), tuple(n.edge for n in self.nodes))

    def transformed(self, sx, sy, dx, dy):
        """A copy scaled by (sx, sy) about the origin, then moved by (dx, dy)."""
        new = Path.__new__(Path)
        swap_x = sx < 0
        swap_y = sy < 0

        def tp(p):
            return (p[0] * sx + dx, p[1] * sy + dy)

        def td(d):
            if d is None:
                return None
            return unit((d[0] * sx, d[1] * sy))

        def te(e):
            if e == "left" and swap_x:
                return "right"
            if e == "right" and swap_x:
                return "left"
            if e == "top" and swap_y:
                return "bottom"
            if e == "bottom" and swap_y:
                return "top"
            return e

        new.nodes = [Node(tp(n.pt), td(n.dir), n.w, te(n.edge)) for n in self.nodes]
        new.segs = [Seg(s.kind, s.tension, td(s.out), tp(s.c1) if s.c1 else None, tp(s.c2) if s.c2 else None)
                    for s in self.segs]
        new.closed = self.closed
        return new


def path(pt, dir=None, w=1.0, edge=None):
    """Start a path at pt. See Path for the node options."""
    return Path(pt, dir, w, edge)


class Params:
    """One master's parameters, read as attributes: p.stem, p.xheight."""

    def __init__(self, values, master, location):
        object.__setattr__(self, "_values", dict(values))
        object.__setattr__(self, "master", master)
        object.__setattr__(self, "location", dict(location))

    def __getattr__(self, name):
        values = object.__getattribute__(self, "_values")
        if name in values:
            return values[name]
        raise DefinitionError("parameter {!r} is not defined for master {!r}. Defined: {}".format(
            name, object.__getattribute__(self, "master"), ", ".join(sorted(values))))

    def __setattr__(self, name, value):
        raise DefinitionError("parameters are read-only; set {!r} in font.json".format(name))

    def get(self, name, default=None):
        return self._values.get(name, default)

    def keys(self):
        return sorted(self._values)


class StrokeElement:
    def __init__(self, path, thick, thin, angle, start, end, join, where="?"):
        self.where = where
        self.path = path
        self.thick = float(thick)
        self.thin = None if thin is None else float(thin)
        self.angle = float(angle)
        self.start = start
        self.end = end
        self.join = join

    def signature(self):
        return ("stroke", self.path.signature(), self.start if isinstance(self.start, str) else "cut",
                self.end if isinstance(self.end, str) else "cut", self.join)


class ShapeElement:
    def __init__(self, path, hole, where="?"):
        self.where = where
        self.path = path
        self.hole = bool(hole)

    def signature(self):
        return ("shape", self.path.signature(), self.hole)


def _cap(value, what):
    if isinstance(value, str):
        if value not in CAPS:
            raise DefinitionError("{}: cap {!r} must be butt, round, square, or a cut angle in degrees".format(
                what, value))
        return value
    if isinstance(value, (int, float)):
        return float(value)
    raise DefinitionError("{}: cap {!r} must be butt, round, square, or a cut angle in degrees".format(what, value))


class GlyphBuilder:
    """What a glyph function draws with. See references/drawing.md for every method."""

    def __init__(self, name, params, context):
        self.name = name
        self.p = params
        self._context = context
        self.elements = []
        self.anchors = {}
        self.components = []
        self.spacing = None

    # --- drawing ---

    def stroke(self, path, width, thin=None, angle=0, cap="butt", start=None, end=None, join="miter"):
        """Stroke a skeleton path with a pen `width` wide.

        thin: the width where the path runs in the thin direction (default: width,
        a monoline). angle: the thin direction in degrees (0: horizontal strokes are
        thinnest). cap: both ends, start/end: one end; butt, round, square or a
        cut angle in degrees. join: miter or flat, for corners of the path.
        """
        if not isinstance(path, Path):
            raise DefinitionError("{}: g.stroke() needs a path made with path(...)".format(self.name))
        if width is None or float(width) <= 0:
            raise DefinitionError("{}: g.stroke() width must be positive, got {!r}".format(self.name, width))
        if join not in JOINS:
            raise DefinitionError("{}: join {!r} must be miter or flat".format(self.name, join))
        if len(path.nodes) < 2:
            raise DefinitionError("{}: a stroked path needs at least two nodes".format(self.name))
        s = _cap(cap if start is None else start, self.name)
        e = _cap(cap if end is None else end, self.name)
        self.elements.append(StrokeElement(path, width, thin, angle, s, e, join, _caller()))
        return self

    def shape(self, path, hole=False):
        """Fill a closed path as it is; hole=True cuts it out of the strokes and shapes under it."""
        if not isinstance(path, Path):
            raise DefinitionError("{}: g.shape() needs a path made with path(...)".format(self.name))
        if not path.closed:
            raise DefinitionError("{}: g.shape() needs a closed path; end it with .close()".format(self.name))
        if any(n.edge for n in path.nodes):
            raise DefinitionError("{}: `edge` only applies to stroked paths, not to g.shape()".format(self.name))
        self.elements.append(ShapeElement(path, hole, _caller()))
        return self

    def rect(self, x0, y0, x1, y1, hole=False):
        """Fill the rectangle with corners (x0, y0) and (x1, y1)."""
        xa, xb = sorted((float(x0), float(x1)))
        ya, yb = sorted((float(y0), float(y1)))
        return self.shape(path((xa, ya)).line((xb, ya)).line((xb, yb)).line((xa, yb)).close(), hole)

    def ellipse(self, cx, cy, rx, ry=None, hole=False, square=0.5523):
        """Fill an ellipse; square raises the handle length (0.5523 is a true ellipse, 0.6-0.7 squarish)."""
        ry = rx if ry is None else ry
        k = float(square)
        p = path((cx + rx, cy))
        p.cubic((cx + rx, cy + ry * k), (cx + rx * k, cy + ry), (cx, cy + ry))
        p.cubic((cx - rx * k, cy + ry), (cx - rx, cy + ry * k), (cx - rx, cy))
        p.cubic((cx - rx, cy - ry * k), (cx - rx * k, cy - ry), (cx, cy - ry))
        p.cubic((cx + rx * k, cy - ry), (cx + rx, cy - ry * k), (cx + rx, cy))
        return self.shape(p.close(), hole)

    def dot(self, cx, cy, diameter, square=0.5523):
        """Fill a round dot of the given diameter centred on (cx, cy)."""
        r = float(diameter) / 2
        return self.ellipse(cx, cy, r, r, square=square)

    def ref(self, name, dx=0, dy=0, scale=1.0, sx=None, sy=None, weight=1.0):
        """Draw another glyph's strokes and shapes into this one.

        The drawing is scaled by scale (or sx, sy; a negative value mirrors) and
        moved by (dx, dy), before spacing. Stroke widths are multiplied by weight,
        not by the scale, so a smaller copy keeps its stroke weight unless asked.
        """
        sx = float(scale if sx is None else sx)
        sy = float(scale if sy is None else sy)
        if sx == 0 or sy == 0:
            raise DefinitionError("{}: g.ref({!r}) cannot scale to zero".format(self.name, name))
        sub = self._context.draw(name, self.p, parent=self.name)
        w = float(weight)
        for el in sub.elements:
            moved = el.path.transformed(sx, sy, dx, dy)
            if isinstance(el, StrokeElement):
                a = math.degrees(math.atan2(math.sin(math.radians(el.angle)) * sy,
                                            math.cos(math.radians(el.angle)) * sx))
                self.elements.append(StrokeElement(
                    moved, el.thick * w, None if el.thin is None else el.thin * w, a, el.start, el.end, el.join,
                    el.where))
            else:
                self.elements.append(ShapeElement(moved, el.hole, el.where))
        for cname, cdx, cdy in sub.components:
            if sx != 1 or sy != 1:
                raise DefinitionError("{}: g.ref({!r}) scales a glyph that uses components; scaling components is "
                                      "not supported".format(self.name, name))
            self.components.append((cname, cdx + dx, cdy + dy))
        return self

    def component(self, name, dx=0, dy=0):
        """Place another glyph's finished, spaced outline at (dx, dy) of this glyph's drawing."""
        self.components.append((name, float(dx), float(dy)))
        return self

    def anchor(self, name, x, y):
        """Mark an attachment point: `top`/`bottom` on base letters, `_top`/`_bottom` on marks."""
        if not isinstance(name, str) or not name:
            raise DefinitionError("{}: anchor name must be a string".format(self.name))
        self.anchors[name] = (float(x), float(y))
        return self

    # --- spacing ---

    def space(self, left, right):
        """Set the sidebearings: white space left of the leftmost ink and right of the rightmost ink."""
        self.spacing = ("space", float(left), float(right))
        return self

    def fixed(self, width, align="center"):
        """Give the glyph a fixed advance width; align its ink center, left (at 0), or keep it as drawn."""
        if align not in ("center", "left", "keep"):
            raise DefinitionError("{}: g.fixed() align must be center, left or keep".format(self.name))
        self.spacing = ("fixed", float(width), align)
        return self

    def signature(self):
        spacing = self.spacing[0] + (":" + self.spacing[2] if self.spacing and self.spacing[0] == "fixed" else "") \
            if self.spacing else None
        return (tuple(el.signature() for el in self.elements),
                tuple(c[0] for c in self.components),
                tuple(sorted(self.anchors)),
                spacing)
