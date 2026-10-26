"""Quality checks on a build and on the font files it wrote."""
import os
import statistics

from fontTools.ttLib import TTFont

from .charset import glyph_name, is_mark_name
from .geometry import (contour_area, contour_bounds, cross, cubic_extrema_params, cubic_point, cubic_tangent, dot,
                       iter_cubics, unit)
from .outline import runs, union_contours
from .project import interpolate


def _p(level, glyph, message, **extra):
    d = {"level": level, "glyph": glyph, "message": message}
    d.update(extra)
    return d


def stems(project, build, index):
    """Stroke thicknesses of the reference glyphs in one master, from scanlines."""
    xh, cap = project.metrics["xheight"], project.metrics["cap"]
    glyphs = build.master(index)
    probes = [
        ("lower straight", "n", 1, xh * 0.35), ("lower straight", "h", 1, xh * 0.35),
        ("lower straight", "l", 1, xh * 0.5), ("lower straight", "i", 1, xh * 0.5),
        ("lower straight", "m", 1, xh * 0.35), ("lower straight", "u", 1, xh * 0.65),
        ("lower straight", "d", 1, xh * 0.5, "last"), ("lower straight", "b", 1, xh * 0.5),
        ("lower round", "o", 1, xh * 0.5), ("lower round", "c", 1, xh * 0.5), ("lower round", "e", 1, xh * 0.3),
        ("lower horizontal", "o", 0, None), ("lower horizontal", "e", 0, None),
        ("upper straight", "H", 1, cap * 0.3), ("upper straight", "I", 1, cap * 0.5),
        ("upper straight", "E", 1, cap * 0.3), ("upper straight", "L", 1, cap * 0.5),
        ("upper round", "O", 1, cap * 0.5), ("upper round", "C", 1, cap * 0.5),
        ("upper horizontal", "H", 0, None), ("upper horizontal", "E", 0, None), ("upper horizontal", "O", 0, None),
        ("figures", "zero", 1, cap * 0.5), ("figures", "one", 1, cap * 0.4),
    ]
    out = []
    for probe in probes:
        group, name, axis, value = probe[:4]
        stem_run = probe[4] if len(probe) > 4 else "first"
        if name not in glyphs or not glyphs[name].contours:
            continue
        contours = union_contours(glyphs[name].contours)
        if value is None:
            bounds = [contour_bounds(*c) for c in contours]
            value = (min(b[0] for b in bounds) + max(b[2] for b in bounds)) / 2
        r = runs(contours, axis, value)
        widths = [round(b - a) for a, b in r]
        if stem_run == "last":
            widths.reverse()
        out.append({"group": group, "glyph": name, "at": "{}={}".format("y" if axis == 1 else "x", round(value)),
                    "widths": widths})
    return out


def _stem_outliers(table, master):
    found = []
    for group in ("lower straight", "upper straight"):
        firsts = [(row["glyph"], row["widths"][0]) for row in table if row["group"] == group and row["widths"]]
        if len(firsts) < 3:
            continue
        med = statistics.median(w for _, w in firsts)
        for g, w in firsts:
            if med and abs(w - med) / med > 0.05:
                found.append(_p("warning", g, "{} stem is {} in master {}, {:+.0f}% from the {} median {}".format(
                    group, w, master, 100 * (w - med) / med, group, round(med))))
    return found


def outline_checks(project, build):
    problems = []
    between = {}
    zones = [0.0, project.metrics["xheight"], project.metrics["cap"]]
    for mi, m in enumerate(project.masters):
        os_ = m.params.get("overshoot")
        targets = list(zones)
        if os_:
            targets += [-os_, project.metrics["xheight"] + os_, project.metrics["cap"] + os_]
        for name in build.order:
            g = build.glyphs[name]
            if g.origin != "drawn":
                continue
            mg = g.masters[mi]
            # Marks float above and below the letters, so the zone lines say nothing about them.
            zone_targets = [] if is_mark_name(name) else targets
            near = set()
            extrema = 0
            for start, segs in mg.contours:
                cubics = list(iter_cubics(start, segs))
                for i, (p0, p1, p2, p3, kind) in enumerate(cubics):
                    if _runs_flat_or_corner(cubics[i - 1], cubics[i]):
                        for z in zone_targets:
                            if 0.5 < abs(p0[1] - z) <= 3:
                                near.add((round(p0[1], 1), z))
                    if kind == "curve":
                        for axis in (0, 1):
                            for t in cubic_extrema_params(p0, p1, p2, p3, axis):
                                if 0.04 < t < 0.96:
                                    e = cubic_point(p0, p1, p2, p3, t)[axis]
                                    if min(abs(e - p0[axis]), abs(e - p3[axis])) > 2:
                                        extrema += 1
            if near:
                sample = ", ".join("y={} near {}".format(y, round(z)) for y, z in sorted(near)[:4])
                problems.append(_p("warning", name, "points sit just off a zone in master {}: {}".format(m.name, sample)))
            if extrema:
                between.setdefault(name, []).append("{} in {}".format(extrema, m.name))
            if os_ and mg.contours:
                problems.extend(_overshoot(project, name, mg, os_, m.name))
        table = stems(project, build, mi)
        problems.extend(_stem_outliers(table, m.name))
    for name, counts in between.items():
        problems.append(_p("info", name, "curves with an extreme point between nodes ({}); a node at each "
                           "horizontal and vertical extreme makes cleaner outlines and hinting. Round caps on "
                           "slanted strokes always do this".format(", ".join(counts))))
    return problems


def _runs_flat_or_corner(before, after):
    """Whether the node between two segments is a corner or a smooth node where the outline runs level.

    Only such nodes are meant to sit on a zone line; a smooth node on a slope lands near one by chance.
    """
    t_in = unit(cubic_tangent(*before[:4], 1.0))
    t_out = unit(cubic_tangent(*after[:4], 0.0))
    if abs(cross(t_in, t_out)) > 0.09 or dot(t_in, t_out) < 0:
        return True
    return abs(t_out[1]) < 0.17


def _overshoot(project, name, mg, os_, master):
    """Round tops and bottoms that sit on a zone line instead of overshooting it."""
    found = []
    lines = {"baseline": 0.0, "x-height": project.metrics["xheight"], "cap height": project.metrics["cap"]}
    for start, segs in mg.contours:
        if contour_area(start, segs) <= 0:
            continue
        for p0, p1, p2, p3, kind in iter_cubics(start, segs):
            if kind != "curve":
                continue
            for t in cubic_extrema_params(p0, p1, p2, p3, 1) + [0.0, 1.0]:
                y = cubic_point(p0, p1, p2, p3, t)[1]
                for label, z in lines.items():
                    if abs(y - z) < 0.3 * os_ and abs(p1[1] - p0[1]) < 1 and abs(p2[1] - p3[1]) < 1 \
                            and (abs(p0[1] - z) < 0.3 * os_ or abs(p3[1] - z) < 0.3 * os_):
                        found.append(_p("info", name, "a curve's extreme sits on the {} in master {}; round "
                                        "shapes usually overshoot it by {}".format(label, master, os_)))
                        return found
    return found


def interpolation_checks(project, build):
    """Contours that turn inside out somewhere between masters."""
    problems = []
    if len(project.masters) < 2:
        return problems
    locs = []
    for a in project.axes:
        lo, hi = a["min"], a["max"]
        for k in range(1, 8):
            locs.append({a["tag"]: lo + (hi - lo) * k / 8})
    for name in build.order:
        g = build.glyphs[name]
        signs = [contour_area(*c) > 0 for c in g.masters[0].contours]
        for loc in locs:
            mg = interpolate(g.masters, project.scalars(loc))
            for ci, c in enumerate(mg.contours):
                if (contour_area(*c) > 0) != signs[ci] and abs(contour_area(*c)) > 10:
                    problems.append(_p("error", name, "contour {} turns inside out at {}; the masters' points "
                                       "cross over in between".format(ci, loc)))
                    break
            else:
                continue
            break
    return problems


def spacing_checks(project, build):
    problems = []
    for mi, m in enumerate(project.masters):
        for name in build.order:
            g = build.glyphs[name]
            if is_mark_name(name) or name == ".notdef" or not g.masters[mi].contours:
                continue
            mg = g.masters[mi]
            bounds = [contour_bounds(*c) for c in mg.contours]
            x0 = min(b[0] for b in bounds)
            x1 = max(b[2] for b in bounds)
            if mg.advance <= 0:
                problems.append(_p("error", name, "advance width is {} in master {}".format(round(mg.advance), m.name)))
            if x0 < -0.02 * project.metrics["upm"] or mg.advance - x1 < -0.02 * project.metrics["upm"]:
                problems.append(_p("info", name, "negative sidebearing (lsb {}, rsb {}) in master {}".format(
                    round(x0), round(mg.advance - x1), m.name)))
    return problems


def file_checks(project, build, files):
    problems = []
    drawn = {u for name in build.order if not name.startswith("_") for u in build.glyphs[name].unicodes}
    lacking = {}
    for path in files:
        if path.endswith(".woff2"):
            continue
        try:
            font = TTFont(path)
        except Exception as exc:
            problems.append(_p("error", None, "{} cannot be read back: {}".format(os.path.basename(path), exc)))
            continue
        missing = tuple(sorted(drawn - set(font.getBestCmap() or {})))
        if missing:
            lacking.setdefault(missing, []).append(os.path.basename(path))
        problems.extend(_ots(path))
    for missing, paths in lacking.items():
        names = ", ".join(glyph_name(c) for c in missing[:12])
        more = " and {} more".format(len(missing) - 12) if len(missing) > 12 else ""
        problems.append(_p("error", None, "{} lack(s) {} character(s) the build made: {}{}; the compile step "
                           "dropped them".format(", ".join(paths), len(missing), names, more)))
    return problems


def _ots(path):
    try:
        import ots
    except ImportError:
        return [_p("info", None, "the OpenType sanitizer is not installed; skipped {}".format(os.path.basename(path)))]
    result = ots.sanitize(path, os.devnull, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()[-3:]
        return [_p("error", None, "{} fails the OpenType sanitizer browsers use: {}".format(
            os.path.basename(path), " | ".join(detail)))]
    return []


def run_checks(project, build, files):
    problems = [dict(p) for p in build.problems]
    problems += outline_checks(project, build)
    problems += interpolation_checks(project, build)
    problems += spacing_checks(project, build)
    problems += file_checks(project, build, files)
    return problems
