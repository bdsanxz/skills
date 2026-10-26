"""A font project: font.json, glyph files and kerning.json, built into outlines per master."""
import importlib.util
import json
import os
import sys
import traceback

from fontTools.varLib.models import VariationModel, normalizeLocation

from . import dsl
from .charset import (
    ALIASES, CHARSETS, SPACING_ACCENTS, category, charset_codepoints, decomposition, glyph_name, is_mark_name,
    is_upper, name_to_unicode,
)
from .geometry import contour_area, contour_bounds, reverse_contour, transform_contour
from .stroke import Pen, StrokeError, expand, resolve

METRIC_KEYS = ("upm", "ascender", "descender", "xheight", "cap")


class ProjectError(Exception):
    """font.json or the project layout cannot be used; the message says what to fix."""


class Problem(dict):
    """One finding: level (error, warning, info), glyph, message, and where."""


def _problem(level, glyph, message, where=None, **extra):
    p = Problem(level=level, glyph=glyph, message=message)
    if where:
        p["where"] = where
    p.update(extra)
    return p


class Master:
    def __init__(self, name, location, params):
        self.name = name
        self.location = location
        self.params = params


class MasterGlyph:
    """One glyph in one master: closed contours (ink counterclockwise, holes clockwise), advance, anchors."""

    def __init__(self, contours, advance, anchors):
        self.contours = contours
        self.advance = advance
        self.anchors = anchors
        self.shift = 0.0


class FinalGlyph:
    def __init__(self, name, unicodes, origin, masters, base=None, skeletons=None, fixed=False):
        self.name = name
        self.fixed = fixed
        self.unicodes = unicodes
        self.origin = origin
        self.masters = masters
        self.base = base
        self.skeletons = skeletons or [[] for _ in masters]

    @property
    def category(self):
        return category(self.unicodes[0] if self.unicodes else name_to_unicode(self.name.split(".")[0]))


def _read_json(path, what):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise ProjectError("{} not found at {}".format(what, path))
    except json.JSONDecodeError as exc:
        raise ProjectError("{} at {} is not valid JSON: {}".format(what, path, exc))


def _number(value, where):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProjectError("{} must be a number, got {!r}".format(where, value))
    return float(value)


class Project:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.config_path = os.path.join(self.root, "font.json")
        cfg = _read_json(self.config_path, "font.json")
        self.config = cfg
        self.family = cfg.get("family")
        if not isinstance(self.family, str) or not self.family.strip():
            raise ProjectError("font.json: `family` must be the family name, as in \"family\": \"Example Sans\"")
        self.version = str(cfg.get("version", "1.000"))
        metrics = cfg.get("metrics")
        if not isinstance(metrics, dict):
            raise ProjectError("font.json: `metrics` must hold upm, ascender, descender, xheight and cap")
        self.metrics = {}
        for key in METRIC_KEYS:
            if key not in metrics:
                raise ProjectError("font.json: metrics.{} is missing".format(key))
            self.metrics[key] = _number(metrics[key], "metrics." + key)
        if self.metrics["descender"] > 0:
            raise ProjectError("font.json: metrics.descender is below the baseline, so it must be negative")
        self.line_gap = metrics.get("line_gap")
        self.axes = []
        for i, axis in enumerate(cfg.get("axes", [])):
            try:
                tag = axis["tag"]
                lo, df, hi = (_number(axis[k], "axes[{}].{}".format(i, k)) for k in ("min", "default", "max"))
            except KeyError as exc:
                raise ProjectError("font.json: axes[{}] needs tag, name, min, default and max (missing {})".format(
                    i, exc))
            if not lo <= df <= hi:
                raise ProjectError("font.json: axes[{}] needs min <= default <= max".format(i))
            self.axes.append({"tag": tag, "name": axis.get("name", tag), "min": lo, "default": df, "max": hi})
        shared = cfg.get("shared", {})
        if not isinstance(shared, dict):
            raise ProjectError("font.json: `shared` must be an object of parameters")
        self.masters = []
        raw_masters = cfg.get("masters")
        if not isinstance(raw_masters, list) or not raw_masters:
            raise ProjectError("font.json: `masters` must list at least one master")
        names = set()
        for i, m in enumerate(raw_masters):
            name = m.get("name")
            if not name or name in names:
                raise ProjectError("font.json: masters[{}] needs a unique name".format(i))
            names.add(name)
            loc = self._location(m.get("location", {}), "masters[{}].location".format(i))
            params = dict(self.metrics)
            for k, v in list(shared.items()) + list(m.get("params", {}).items()):
                params[k] = _number(v, "params.{} of master {}".format(k, name))
            self.masters.append(Master(name, loc, params))
        default_loc = {a["tag"]: a["default"] for a in self.axes}
        if self.axes:
            defaults = [m for m in self.masters if m.location == default_loc]
            if not defaults:
                raise ProjectError("font.json: no master sits at the axes' default location {}; add one there, "
                                   "or set each axis default to an existing master's location".format(default_loc))
            self.default_master = defaults[0]
        else:
            if len(self.masters) > 1:
                raise ProjectError("font.json: several masters need an axis to place them on; add `axes`")
            self.default_master = self.masters[0]
        self.instances = []
        for i, inst in enumerate(cfg.get("instances", [])):
            name = inst.get("name")
            if not name:
                raise ProjectError("font.json: instances[{}] needs a name".format(i))
            self.instances.append({"name": name, "location": self._location(inst.get("location", {}),
                                                                            "instances[{}].location".format(i))})
        if not self.instances:
            self.instances = [{"name": m.name, "location": m.location} for m in self.masters]
        try:
            self.charset = charset_codepoints(cfg.get("charset", ["latin-core"]))
        except ValueError as exc:
            raise ProjectError("font.json: charset: {}".format(exc))
        self.kerning_path = os.path.join(self.root, "kerning.json")
        self.kerning = self._load_kerning()
        self.glyph_files = sorted(
            os.path.join(self.root, "glyphs", f)
            for f in os.listdir(os.path.join(self.root, "glyphs")) if f.endswith(".py")
        ) if os.path.isdir(os.path.join(self.root, "glyphs")) else []
        if self.axes:
            axis_map = {a["tag"]: (a["min"], a["default"], a["max"]) for a in self.axes}
            self.model = VariationModel([normalizeLocation(m.location, axis_map) for m in self.masters],
                                        axisOrder=[a["tag"] for a in self.axes])
            self.axis_map = axis_map
        else:
            self.model = None
            self.axis_map = {}

    def _location(self, loc, where):
        if not isinstance(loc, dict):
            raise ProjectError("font.json: {} must be an object like {{\"wght\": 400}}".format(where))
        tags = {a["tag"]: a for a in self.axes}
        out = {}
        for tag, value in loc.items():
            if tag not in tags:
                raise ProjectError("font.json: {} names axis {!r}, which `axes` does not define".format(where, tag))
            v = _number(value, where + "." + tag)
            a = tags[tag]
            if not a["min"] <= v <= a["max"]:
                raise ProjectError("font.json: {}.{} = {} is outside the axis range {}-{}".format(
                    where, tag, v, a["min"], a["max"]))
            out[tag] = v
        for tag, a in tags.items():
            out.setdefault(tag, a["default"])
        return out

    def _load_kerning(self):
        if not os.path.exists(self.kerning_path):
            return {}
        data = _read_json(self.kerning_path, "kerning.json")
        pairs = data.get("pairs", {})
        if not isinstance(pairs, dict):
            raise ProjectError("kerning.json: `pairs` must map \"left right\" to a value")
        out = {}
        for key, value in pairs.items():
            parts = key.split()
            if len(parts) != 2:
                raise ProjectError("kerning.json: pair {!r} must be two glyph names separated by a space".format(key))
            if isinstance(value, dict):
                missing = [m.name for m in self.masters if m.name not in value]
                if missing:
                    raise ProjectError("kerning.json: pair {!r} has no value for master(s) {}".format(
                        key, ", ".join(missing)))
                vals = [_number(value[m.name], "kerning pair " + key) for m in self.masters]
            else:
                vals = [_number(value, "kerning pair " + key)] * len(self.masters)
            out[tuple(parts)] = vals
        return out

    # --- interpolation ---

    def normalize(self, location):
        return normalizeLocation(location, self.axis_map) if self.axis_map else {}

    def scalars(self, location):
        if self.model is None:
            return [1.0]
        return self.model.getMasterScalars(self.normalize(location))

    def master_index(self, name):
        for i, m in enumerate(self.masters):
            if m.name == name:
                return i
        raise ProjectError("no master named {!r}; masters: {}".format(name, ", ".join(m.name for m in self.masters)))

    # --- loading glyph files ---

    def load_glyphs(self):
        dsl.reset_registry()
        if self.root not in sys.path:
            sys.path.insert(0, self.root)
        problems = []
        for path in self.glyph_files:
            modname = "dfont_glyphs_" + os.path.splitext(os.path.basename(path))[0].replace("-", "_")
            spec = importlib.util.spec_from_file_location(modname, path)
            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except Exception as exc:  # report every broken file, keep the rest
                problems.append(_problem("error", None, "{} failed to load: {}".format(
                    os.path.basename(path), _short_trace(exc)), where=path))
        return dict(dsl.registry()), problems

    def build(self, only=None):
        return Builder(self).run(only)


def _short_trace(exc):
    tb = traceback.extract_tb(exc.__traceback__)
    frames = [f for f in tb if "/dfont/" not in f.filename.replace("\\", "/")]
    where = ""
    if frames:
        f = frames[-1]
        where = " (at {}:{}: {})".format(f.filename, f.lineno, (f.line or "").strip())
    return "{}: {}{}".format(type(exc).__name__, exc, where)


class _Context:
    """What GlyphBuilder.ref() calls to draw another glyph."""

    def __init__(self, defs):
        self.defs = defs
        self.stack = []

    def draw(self, name, params, parent=None):
        if name not in self.defs:
            raise dsl.DefinitionError("{}: g.ref({!r}): no glyph of that name is defined".format(parent, name))
        if name in self.stack:
            raise dsl.DefinitionError("glyphs refer to each other in a loop: {}".format(
                " -> ".join(self.stack + [name])))
        self.stack.append(name)
        try:
            g = dsl.GlyphBuilder(name, params, self)
            self.defs[name].fn(g, params)
        finally:
            self.stack.pop()
        return g


class BuildResult:
    def __init__(self, project, glyphs, order, problems):
        self.project = project
        self.glyphs = glyphs
        self.order = order
        self.problems = problems

    def errors(self):
        return [p for p in self.problems if p["level"] == "error"]

    def instance(self, location):
        """Every glyph interpolated at a location: name -> MasterGlyph."""
        scalars = self.project.scalars(location)
        out = {}
        for name in self.order:
            out[name] = interpolate(self.glyphs[name].masters, scalars)
        return out

    def master(self, index):
        return {name: self.glyphs[name].masters[index] for name in self.order}

    def kerning_at(self, location):
        scalars = self.project.scalars(location)
        return {pair: sum(s * v for s, v in zip(scalars, vals)) for pair, vals in self.project.kerning.items()}

    def kerning_master(self, index):
        return {pair: vals[index] for pair, vals in self.project.kerning.items()}


def interpolate(masters, scalars):
    if len(masters) == 1:
        return masters[0]

    def mix(values):
        return sum(s * v for s, v in zip(scalars, values))

    def mixp(points):
        return (mix([p[0] for p in points]), mix([p[1] for p in points]))

    contours = []
    for ci in range(len(masters[0].contours)):
        group = [m.contours[ci] for m in masters]
        start = mixp([c[0] for c in group])
        segs = []
        for si in range(len(group[0][1])):
            kinds = group[0][1][si][0]
            pts = [mixp([c[1][si][k] for c in group]) for k in range(1, len(group[0][1][si]))]
            segs.append((kinds,) + tuple(pts))
        contours.append((start, segs))
    anchors = {a: mixp([m.anchors[a] for m in masters]) for a in masters[0].anchors}
    return MasterGlyph(contours, mix([m.advance for m in masters]), anchors)


def _contour_signature(contour):
    return tuple(seg[0] for seg in contour[1])


class Builder:
    def __init__(self, project):
        self.project = project
        self.problems = []
        self.final = {}
        self.failed = set()
        self.building = []

    def run(self, only=None):
        p = self.project
        defs, problems = p.load_glyphs()
        self.problems.extend(problems)
        self.defs = defs
        self.context = _Context(defs)
        self.params = [dsl.Params(m.params, m.name, m.location) for m in p.masters]
        wanted = []
        for cp in p.charset:
            wanted.append(glyph_name(cp))
        for name, d in sorted(defs.items()):
            if not name.startswith("_") and name not in wanted:
                wanted.append(name)
        self.code_of = {}
        for cp in p.charset:
            self.code_of[glyph_name(cp)] = cp
        if only:
            wanted = [n for n in wanted if n in only]
        order = [".notdef"]
        self.final[".notdef"] = self._notdef()
        for name in wanted:
            g = self.get(name, required=True)
            if g is not None:
                order.append(name)
        return BuildResult(p, self.final, order, self.problems)

    # --- per glyph ---

    def unicodes_for(self, name):
        d = self.defs.get(name)
        if d is not None and d.unicodes is not None:
            return list(d.unicodes)
        if name in self.code_of:
            return [self.code_of[name]]
        cp = name_to_unicode(name)
        return [cp] if cp is not None else []

    def get(self, name, required=False, parent=None):
        """The finished glyph, built on first use; None when it cannot be built."""
        if name in self.final:
            return self.final[name]
        if name in self.failed:
            return None
        if name in self.building:
            self.problems.append(_problem("error", name, "glyphs use each other as components in a loop: {}".format(
                " -> ".join(self.building + [name]))))
            self.failed.add(name)
            return None
        self.building.append(name)
        try:
            if name in self.defs:
                result = self._drawn(name)
            else:
                result = self._automatic(name, required, parent)
        finally:
            self.building.pop()
        if result is None:
            self.failed.add(name)
        else:
            self.final[name] = result
        return result

    def _drawn(self, name):
        p = self.project
        builders = []
        for params in self.params:
            g = dsl.GlyphBuilder(name, params, self.context)
            try:
                self.defs[name].fn(g, params)
            except Exception as exc:
                self.problems.append(_problem("error", name, "drawing failed in master {}: {}".format(
                    params.master, _short_trace(exc)), where=self.defs[name].source))
                return None
            builders.append(g)
        sigs = [b.signature() for b in builders]
        for i, sig in enumerate(sigs[1:], 1):
            if sig != sigs[0]:
                self.problems.append(_problem("error", name, "masters {} and {} draw different structures: {}. "
                                              "A glyph function must draw the same strokes, shapes and nodes for "
                                              "every master; only numbers may differ".format(
                                                  p.masters[0].name, p.masters[i].name,
                                                  _difference(sigs[0], sig)), where=self.defs[name].source))
                return None
        per_master = [[] for _ in builders]
        skeletons = [[] for _ in builders]
        for ei, el0 in enumerate(builders[0].elements):
            els = [b.elements[ei] for b in builders]
            try:
                if isinstance(el0, dsl.StrokeElement):
                    pens = [Pen(e.thick, e.thin, e.angle, e.start, e.end, e.join) for e in els]
                    resolved = [resolve(e.path, pen, "{} ({})".format(name, e.where)) for e, pen in zip(els, pens)]
                    contours, diags = expand(resolved, pens)
                    for mi, r in enumerate(resolved):
                        skeletons[mi].append(r)
                    for d in diags:
                        self._stroke_problem(name, el0, d)
                    if resolved[0][0]:
                        # Closed stroke: the side with the larger area is the ink.
                        a0 = abs(contour_area(*contours[0][0]))
                        a1 = abs(contour_area(*contours[0][1]))
                        roles = [True, False] if a0 >= a1 else [False, True]
                    else:
                        roles = [True]
                    for ci, ink in enumerate(roles):
                        flip = (contour_area(*contours[0][ci]) > 0) != ink
                        for mi in range(len(builders)):
                            c = contours[mi][ci]
                            per_master[mi].append(reverse_contour(*c) if flip else c)
                else:
                    resolved = [resolve(e.path, None, "{} ({})".format(name, e.where)) for e in els]
                    cs = [(r[1][0][0], [("line", s[3]) if s[4] == "line" else ("curve", s[1], s[2], s[3])
                                       for s in r[1]]) for r in resolved]
                    ink = not el0.hole
                    flip = (contour_area(*cs[0]) > 0) != ink
                    for mi, c in enumerate(cs):
                        per_master[mi].append(reverse_contour(*c) if flip else c)
            except StrokeError as exc:
                self.problems.append(_problem("error", name, str(exc), where=el0.where))
                return None
        anchors = [dict(b.anchors) for b in builders]
        for ci, (cname, dx, dy) in enumerate(builders[0].components):
            comp = self.get(cname, parent=name)
            if comp is None:
                self.problems.append(_problem("error", name, "component {!r} cannot be built".format(cname),
                                              where=self.defs[name].source))
                return None
            for mi, b in enumerate(builders):
                _, cdx, cdy = b.components[ci]
                mg = comp.masters[mi]
                m = (1, 0, 0, 1, cdx, cdy)
                per_master[mi].extend(transform_contour(s, segs, m) for s, segs in mg.contours)
                if ci == 0 and not builders[0].anchors:
                    for a, (x, y) in mg.anchors.items():
                        anchors[mi][a] = (x + cdx, y + cdy)
        spacing = builders[0].spacing
        if spacing is None:
            if is_mark_name(name):
                spacing = ("fixed", 0.0, "keep")
            else:
                self.problems.append(_problem("error", name, "no spacing: end the glyph function with "
                                              "g.space(left, right) or g.fixed(width)", where=self.defs[name].source))
                return None
        masters = []
        for mi, b in enumerate(builders):
            sp = b.spacing or spacing
            mg = self._space(name, per_master[mi], anchors[mi], sp)
            if mg is None:
                return None
            masters.append(mg)
            # Move the skeletons with the ink, so proofs draw them in place.
            dx = mg.shift
            skeletons[mi] = [(closed, [((a[0] + dx, a[1]), (b1[0] + dx, b1[1]), (c[0] + dx, c[1]),
                                        (d[0] + dx, d[1]), kind) for a, b1, c, d, kind in segs], widths)
                             for closed, segs, widths in skeletons[mi]]
        return FinalGlyph(name, self.unicodes_for(name), "drawn", masters, skeletons=skeletons,
                          fixed=spacing[0] == "fixed")

    def _stroke_problem(self, name, el, d):
        master = self.project.masters[d[2]].name if d[0] in ("fold", "miter") else self.project.masters[d[2]].name
        if d[0] == "fold":
            self.problems.append(_problem(
                "error", name, "the stroke folds over itself on segment {} in master {}: the curve is tighter than "
                "half the stroke width. Open the curve up, move its nodes apart, or thin the stroke there with "
                "w=".format(d[1], master), where=el.where))
        elif d[0] == "fit":
            self.problems.append(_problem(
                "warning", name, "the outline of segment {} deviates {:.1f} units from the true offset in master {}; "
                "add a node in the middle of that curve".format(d[1], d[3], master), where=el.where))
        elif d[0] == "miter":
            self.problems.append(_problem(
                "warning", name, "a miter corner sticks out {:.0f} units in master {}; use join=\"flat\" or a "
                "wider angle".format(d[1], master), where=el.where))

    def _space(self, name, contours, anchors, spacing):
        if contours:
            bounds = [contour_bounds(*c) for c in contours]
            x0 = min(b[0] for b in bounds)
            x1 = max(b[2] for b in bounds)
        else:
            x0 = x1 = 0.0
        if spacing[0] == "space":
            if not contours:
                self.problems.append(_problem("error", name, "g.space() needs ink to measure from; use g.fixed(width) "
                                              "for an empty glyph"))
                return None
            shift = spacing[1] - x0
            advance = spacing[1] + (x1 - x0) + spacing[2]
        else:
            advance = spacing[1]
            align = spacing[2]
            if not contours or align == "keep":
                shift = 0.0
            elif align == "left":
                shift = -x0
            else:
                shift = (advance - (x1 - x0)) / 2 - x0
        m = (1, 0, 0, 1, shift, 0)
        moved = [transform_contour(s, segs, m) for s, segs in contours]
        mg = MasterGlyph(moved, advance, {a: (x + shift, y) for a, (x, y) in anchors.items()})
        mg.shift = shift
        return mg

    def _automatic(self, name, required, parent):
        p = self.project
        if name in ALIASES:
            src = self.get(ALIASES[name], parent=name)
            if src is None:
                return self._missing(name, required, "it is made as a copy of {!r}, which is missing".format(
                    ALIASES[name]))
            return FinalGlyph(name, self.unicodes_for(name), "alias", src.masters, base=src.name)
        if name in SPACING_ACCENTS:
            mark = self.get(SPACING_ACCENTS[name], parent=name)
            if mark is None:
                return self._missing(name, required, "it is made from {!r}, which is missing".format(
                    SPACING_ACCENTS[name]))
            masters = []
            for mi, mg in enumerate(mark.masters):
                sb = self.params[mi].get("sb_accent", 0.06 * p.metrics["upm"])
                anchors = {a: v for a, v in mg.anchors.items() if not a.startswith("_")}
                spaced = self._space(name, mg.contours, anchors, ("space", sb, sb))
                if spaced is None:
                    return None
                masters.append(spaced)
            return FinalGlyph(name, self.unicodes_for(name), "accent", masters, base=None)
        cp = self.code_of.get(name)
        dec = decomposition(cp) if cp is not None else None
        if dec is None:
            return self._missing(name, required, "draw it with @glyph({!r})".format(name))
        base_cp, mark_cps = dec
        base_name = glyph_name(base_cp)
        mark_names = [glyph_name(m) for m in mark_cps]
        upper = is_upper(base_cp)
        if base_name in ("i", "j"):
            above = {"gravecomb", "acutecomb", "circumflexcomb", "tildecomb", "macroncomb", "brevecomb",
                     "dieresiscomb", "ringcomb", "caroncomb", "hungarumlautcomb", "dotaccentcomb"}
            if mark_names[0] in above:
                base_name = "dotless" + base_name
        base = self.get(base_name, parent=name)
        if base is None:
            return self._missing(name, required, "it is built from {} + {}, and {!r} is missing".format(
                base_name, " + ".join(mark_names), base_name))
        masters = [MasterGlyph(list(m.contours), m.advance, dict(m.anchors)) for m in base.masters]
        for mark_name in mark_names:
            if upper and (mark_name + ".case") in self.defs:
                mark_name = mark_name + ".case"
            mark = self.get(mark_name, parent=name)
            if mark is None:
                return self._missing(name, required, "it is built from {} + {}, and {!r} is missing".format(
                    base_name, " + ".join(mark_names), mark_name))
            attach = [a for a in mark.masters[0].anchors if a.startswith("_")]
            if not attach:
                self.problems.append(_problem("error", name, "mark {!r} has no attaching anchor; give it "
                                              "g.anchor(\"_top\", x, y) or \"_bottom\"".format(mark_name)))
                return None
            a = attach[0]
            target = a[1:]
            if target not in masters[0].anchors:
                self.problems.append(_problem("error", name, "base {!r} has no anchor {!r} for mark {!r}; add "
                                              "g.anchor({!r}, x, y) to {}".format(base_name, target, mark_name,
                                                                                  target, base_name)))
                return None
            for mi, mg in enumerate(mark.masters):
                bx, by = masters[mi].anchors[target]
                mx, my = mg.anchors[a]
                m = (1, 0, 0, 1, bx - mx, by - my)
                masters[mi].contours.extend(transform_contour(s, segs, m) for s, segs in mg.contours)
                for an, (x, y) in mg.anchors.items():
                    if not an.startswith("_"):
                        masters[mi].anchors[an] = (x + bx - mx, y + by - my)
        return FinalGlyph(name, self.unicodes_for(name), "composite", masters, base=base.name)

    def _missing(self, name, required, how):
        if required:
            self.problems.append(_problem("missing", name, "not built yet: " + how))
        return None

    def _notdef(self):
        masters = []
        upm = self.project.metrics["upm"]
        cap = self.project.metrics["cap"]
        t = 0.05 * upm
        w = 0.5 * cap
        for _ in self.project.masters:
            outer = (0.0, 0.0), [("line", (w, 0.0)), ("line", (w, cap)), ("line", (0.0, cap)), ("line", (0.0, 0.0))]
            inner = (t, t), [("line", (t, cap - t)), ("line", (w - t, cap - t)), ("line", (w - t, t)),
                             ("line", (t, t))]
            mg = self._space(".notdef", [outer, inner], {}, ("space", 0.1 * upm, 0.1 * upm))
            masters.append(mg)
        return FinalGlyph(".notdef", [], "notdef", masters)


def _difference(a, b):
    labels = ("elements", "components", "anchors", "spacing")
    for label, x, y in zip(labels, a, b):
        if x != y:
            if label == "elements":
                if len(x) != len(y):
                    return "{} vs {} strokes and shapes".format(len(x), len(y))
                for i, (ex, ey) in enumerate(zip(x, y)):
                    if ex != ey:
                        return "element {} differs ({} vs {})".format(i, ex, ey)
            return "{} differ ({} vs {})".format(label, x, y)
    return "unknown difference"


def charset_names(project):
    return [glyph_name(cp) for cp in project.charset]


__all__ = ["Project", "ProjectError", "BuildResult", "interpolate", "CHARSETS", "charset_names"]
