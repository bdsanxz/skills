"""Compile a built project into font files: static OTF and TTF, a variable TTF, and WOFF2."""
import os
import re

import pathops
from fontTools.cu2qu.cu2qu import curves_to_quadratic
from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, InstanceDescriptor, SourceDescriptor
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.fixedTools import otRound
from fontTools.otlLib.builder import buildStatTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from fontTools import varLib

from .charset import is_mark_name
from .geometry import contour_bounds

QUAD_ERROR = 1.0
RIBBI = ("Regular", "Bold")


def ps_safe(text):
    return re.sub(r"[^A-Za-z0-9-]", "", text)


def draw_contours(pen, contours):
    for start, segs in contours:
        pen.moveTo(start)
        for i, seg in enumerate(segs):
            last = i == len(segs) - 1
            if seg[0] == "line":
                if last and _same(seg[1], start):
                    break
                pen.lineTo(seg[1])
            else:
                pen.curveTo(seg[1], seg[2], seg[3])
        pen.closePath()


def _same(a, b):
    return abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6


def union(contours):
    """Remove overlaps; returns a RecordingPen holding the result (ink counterclockwise)."""
    rec = RecordingPen()
    if not contours:
        return rec
    path = pathops.Path()
    draw_contours(path.getPen(), contours)
    try:
        result = pathops.simplify(path, fix_winding=True, keep_starting_points=True, clockwise=False)
    except pathops.PathOpsError:
        result = path
    result.draw(rec)
    return rec


def vertical_metrics(project, build):
    upm = project.metrics["upm"]
    asc = project.metrics["ascender"]
    desc = project.metrics["descender"]
    y_min, y_max = 0.0, 0.0
    for name in build.order:
        for mg in build.glyphs[name].masters:
            for c in mg.contours:
                b = contour_bounds(*c)
                y_min = min(y_min, b[1])
                y_max = max(y_max, b[3])
    gap = project.line_gap
    if gap is None:
        gap = max(0, round(1.2 * upm - (asc - desc)))
    return {
        "ascender": otRound(asc),
        "descender": otRound(desc),
        "line_gap": otRound(gap),
        "win_ascent": otRound(max(y_max, asc)),
        "win_descent": otRound(max(-y_min, -desc)),
        "y_min": y_min,
        "y_max": y_max,
    }


def kern_classes(build):
    """Kerning class of every base glyph: the base and every glyph built on it."""
    members = {}
    for name in build.order:
        base = build.glyphs[name].base
        if base and base in build.glyphs:
            members.setdefault(base, []).append(name)
    return members


def feature_text(build, glyphs, kerning, keep_zero=False):
    """OpenType feature code: GDEF classes, mark attachment and class kerning."""
    order = [n for n in build.order if n != ".notdef"]
    marks = [n for n in order if is_mark_name(n)]
    bases = [n for n in order if n not in marks]
    lines = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", ""]
    lines.append("table GDEF {")
    lines.append("  GlyphClassDef [{}], , [{}], ;".format(" ".join(bases), " ".join(marks)))
    lines.append("} GDEF;")
    lines.append("")
    # mark-to-base from anchors
    mark_classes = {}
    for m in marks:
        for a, (x, y) in sorted(glyphs[m].anchors.items()):
            if a.startswith("_"):
                mark_classes.setdefault(a[1:], []).append((m, x, y))
    if mark_classes:
        cls_names = {}
        for i, (anchor, items) in enumerate(sorted(mark_classes.items())):
            cls = "@MC_{}".format(re.sub(r"[^A-Za-z0-9]", "_", anchor))
            cls_names[anchor] = cls
            for m, x, y in items:
                lines.append("markClass {} <anchor {} {}> {};".format(m, otRound(x), otRound(y), cls))
        lines.append("")
        lines.append("feature mark {")
        for anchor, cls in sorted(cls_names.items()):
            entries = [(b, glyphs[b].anchors[anchor]) for b in bases if anchor in glyphs[b].anchors]
            if entries:
                lines.append("  lookup mark_{} {{".format(re.sub(r"[^A-Za-z0-9]", "_", anchor)))
                for b, (x, y) in entries:
                    lines.append("    pos base {} <anchor {} {}> mark {};".format(b, otRound(x), otRound(y), cls))
                lines.append("  }} mark_{};".format(re.sub(r"[^A-Za-z0-9]", "_", anchor)))
        lines.append("} mark;")
        lines.append("")
    pairs = {k: v for k, v in kerning.items() if keep_zero or otRound(v) != 0}
    present = set(order)
    pairs = {k: v for k, v in pairs.items() if k[0] in present and k[1] in present}
    if pairs:
        classes = kern_classes(build)
        member_of = {}
        for base, mem in classes.items():
            for m in mem:
                member_of[m] = base
        left = sorted({k[0] for k in pairs if k[0] not in member_of})
        right = sorted({k[1] for k in pairs if k[1] not in member_of})
        lcls = {}
        rcls = {}
        for i, g in enumerate(left):
            lcls[g] = "@kL{}".format(i)
            lines.append("{} = [{}];".format(lcls[g], " ".join([g] + classes.get(g, []))))
        for i, g in enumerate(right):
            rcls[g] = "@kR{}".format(i)
            lines.append("{} = [{}];".format(rcls[g], " ".join([g] + classes.get(g, []))))
        lines.append("")
        lines.append("feature kern {")
        exceptions = [(k, v) for k, v in sorted(pairs.items()) if k[0] in member_of or k[1] in member_of]
        regular = [(k, v) for k, v in sorted(pairs.items()) if k not in dict(exceptions)]
        for (a, b), v in exceptions:
            lines.append("  pos {} {} {};".format(a, b, otRound(v)))
        for (a, b), v in regular:
            lines.append("  pos {} {} {};".format(lcls[a], rcls[b], otRound(v)))
        lines.append("} kern;")
    return "\n".join(lines) + "\n"


def _names(project, style, variable=False):
    family = project.family
    cfg = project.config
    version = "Version {}".format(project.version)
    ps = "{}-{}".format(ps_safe(family), ps_safe(style))
    vendor = cfg.get("vendor", "NONE")
    names = {
        "copyright": cfg.get("copyright") or "",
        "version": version,
        "uniqueFontIdentifier": "{};{};{}".format(project.version, vendor, ps),
        "psName": ps,
        "manufacturer": cfg.get("manufacturer") or cfg.get("designer") or "",
        "designer": cfg.get("designer") or "",
        "designerURL": cfg.get("designer_url") or "",
        "vendorURL": cfg.get("vendor_url") or "",
        "licenseDescription": cfg.get("license") or "",
        "licenseInfoURL": cfg.get("license_url") or "",
    }
    if style in RIBBI or variable:
        names["familyName"] = family
        names["styleName"] = "Regular" if variable else style
        names["fullName"] = family if names["styleName"] == "Regular" else "{} {}".format(family, style)
        if variable and style != "Regular":
            names["typographicFamily"] = family
            names["typographicSubfamily"] = style
            names["fullName"] = "{} {}".format(family, style)
    else:
        names["familyName"] = "{} {}".format(family, style)
        names["styleName"] = "Regular"
        names["typographicFamily"] = family
        names["typographicSubfamily"] = style
        names["fullName"] = "{} {}".format(family, style)
    return {k: v for k, v in names.items() if v}


def _base_font(project, build, glyphs, style, location, is_ttf, metrics, kerning, keep_zero=False):
    order = list(build.order)
    fb = FontBuilder(int(project.metrics["upm"]), isTTF=is_ttf)
    fb.setupGlyphOrder(order)
    cmap = {}
    for name in order:
        for u in build.glyphs[name].unicodes:
            cmap[u] = name
    fb.setupCharacterMap(cmap)
    advances = {name: max(0, otRound(glyphs[name].advance)) for name in order}
    return fb, order, advances


def _lsb(fb, order):
    lsb = {}
    if fb.isTTF:
        glyf = fb.font["glyf"]
        for name in order:
            g = glyf[name]
            g.recalcBounds(glyf)
            lsb[name] = getattr(g, "xMin", 0) if g.numberOfContours else 0
    else:
        cff = fb.font["CFF "].cff
        charstrings = cff[cff.fontNames[0]].CharStrings
        for name in order:
            bounds = charstrings[name].calcBounds(charstrings)
            lsb[name] = otRound(bounds[0]) if bounds else 0
    return lsb


def _finish(fb, project, build, glyphs, style, location, metrics, kerning, order, advances, keep_zero, variable):
    lsb = _lsb(fb, order)
    fb.setupHorizontalMetrics({n: (advances[n], lsb[n]) for n in order})
    fb.setupHorizontalHeader(ascent=metrics["ascender"], descent=metrics["descender"], lineGap=metrics["line_gap"])
    fb.setupNameTable(_names(project, style, variable))
    weight = int(round(location.get("wght", 400)))
    sel = 0x80
    if style == "Bold" and not variable:
        sel |= 0x20
    elif style == "Regular" or variable:
        sel |= 0x40
    fb.setupOS2(
        version=4,
        usWeightClass=max(1, min(1000, weight)),
        fsSelection=sel,
        achVendID=(project.config.get("vendor", "NONE") + "    ")[:4],
        sTypoAscender=metrics["ascender"],
        sTypoDescender=metrics["descender"],
        sTypoLineGap=metrics["line_gap"],
        usWinAscent=metrics["win_ascent"],
        usWinDescent=metrics["win_descent"],
        sxHeight=otRound(project.metrics["xheight"]),
        sCapHeight=otRound(project.metrics["cap"]),
        fsType=0,
    )
    fb.setupPost(keepGlyphNames=fb.isTTF)
    head = fb.font["head"]
    head.fontRevision = float(re.sub(r"[^0-9.]", "", project.version) or 1.0)
    head.macStyle = 0x01 if (style == "Bold" and not variable) else 0
    if fb.isTTF:
        fb.font["gasp"] = newTable("gasp")
        fb.font["gasp"].gaspRange = {0xFFFF: 0x000F}
    os2 = fb.font["OS/2"]
    os2.recalcUnicodeRanges(fb.font)
    if hasattr(os2, "recalcCodePageRanges"):
        os2.recalcCodePageRanges(fb.font)
    os2.recalcAvgCharWidth(fb.font)
    addOpenTypeFeaturesFromString(fb.font, feature_text(build, glyphs, kerning, keep_zero))
    return fb.font


def static_font(project, build, glyphs, style, location, kerning, fmt, metrics):
    """A static OTF (fmt "otf") or TTF from interpolated outlines, overlaps removed."""
    is_ttf = fmt == "ttf"
    fb, order, advances = _base_font(project, build, glyphs, style, location, is_ttf, metrics, kerning)
    if is_ttf:
        tt = {}
        for name in order:
            rec = union(glyphs[name].contours)
            pen = TTGlyphPen(None)
            rec.replay(Cu2QuPen(pen, QUAD_ERROR, reverse_direction=True))
            tt[name] = pen.glyph()
        fb.setupGlyf(tt)
    else:
        charstrings = {}
        for name in order:
            rec = union(glyphs[name].contours)
            pen = T2CharStringPen(advances[name], None)
            rec.replay(pen)
            charstrings[name] = pen.getCharString()
        ps = "{}-{}".format(ps_safe(project.family), ps_safe(style))
        fb.setupCFF(ps, {"FullName": "{} {}".format(project.family, style), "FamilyName": project.family,
                         "Weight": style}, charstrings, {})
    return _finish(fb, project, build, glyphs, style, location, metrics, kerning, order, advances, False, False)


def _compatible_quadratic(per_master_contours):
    """Per master, the contours as pen operations with compatible quadratic curves."""
    n = len(per_master_contours)
    out = [[] for _ in range(n)]
    for ci in range(len(per_master_contours[0])):
        group = [m[ci] for m in per_master_contours]
        ops = [[("moveTo", (g[0],))] for g in group]
        for si in range(len(group[0][1])):
            kind = group[0][1][si][0]
            if kind == "line":
                for mi, g in enumerate(group):
                    ops[mi].append(("lineTo", (g[1][si][1],)))
            else:
                curves = []
                for g in group:
                    prev = g[1][si - 1][-1] if si > 0 else g[0]
                    seg = g[1][si]
                    curves.append([prev, seg[1], seg[2], seg[3]])
                splines = curves_to_quadratic(curves, [QUAD_ERROR] * n)
                for mi, sp in enumerate(splines):
                    ops[mi].append(("qCurveTo", tuple(sp[1:])))
        for mi in range(n):
            out[mi].append(ops[mi])
    return out


def _replay_ops(contours_ops, pen):
    for ops in contours_ops:
        start = ops[0][1][0]
        for i, (op, args) in enumerate(ops):
            if op == "lineTo" and i == len(ops) - 1 and _same(args[0], start):
                continue
            getattr(pen, op)(*args)
        pen.closePath()


def variable_font(project, build, metrics):
    """A variable TTF from the masters; overlaps are kept and flagged."""
    masters = project.masters
    order = list(build.order)
    quad = {name: _compatible_quadratic([mg.contours for mg in build.glyphs[name].masters]) for name in order}
    ds = DesignSpaceDocument()
    for a in project.axes:
        ad = AxisDescriptor()
        ad.tag, ad.name = a["tag"], a["name"]
        ad.minimum, ad.default, ad.maximum = a["min"], a["default"], a["max"]
        ds.addAxis(ad)
    default_style = None
    for inst in project.instances:
        if inst["location"] == project.default_master.location:
            default_style = inst["name"]
    default_style = default_style or project.default_master.name
    for mi, m in enumerate(masters):
        glyphs = build.master(mi)
        kerning = build.kerning_master(mi)
        fb, order, advances = _base_font(project, build, glyphs, default_style, m.location, True, metrics, kerning)
        tt = {}
        for name in order:
            pen = TTGlyphPen(None)
            _replay_ops(quad[name][mi], ReverseContourPen(pen))
            tt[name] = pen.glyph()
        fb.setupGlyf(tt)
        font = _finish(fb, project, build, glyphs, default_style, project.default_master.location, metrics,
                       kerning, order, advances, True, True)
        src = SourceDescriptor()
        src.font = font
        src.name = m.name
        src.location = {a["name"]: m.location[a["tag"]] for a in project.axes}
        ds.addSource(src)
    for inst in project.instances:
        idesc = InstanceDescriptor()
        idesc.familyName = project.family
        idesc.styleName = inst["name"]
        idesc.location = {a["name"]: inst["location"][a["tag"]] for a in project.axes}
        ds.addInstance(idesc)
    vf, _, _ = varLib.build(ds, exclude=["MVAR"])
    glyf = vf["glyf"]
    for name in glyf.keys():
        g = glyf[name]
        if g.numberOfContours > 0:
            g.flags[0] |= 0x40
    values = []
    for a in project.axes:
        vals = []
        for inst in project.instances:
            v = inst["location"][a["tag"]]
            if any(abs(x["value"] - v) < 1e-6 for x in vals):
                continue
            entry = {"value": v, "name": inst["name"]}
            if inst["name"] == "Regular":
                entry["flags"] = 0x2
            vals.append(entry)
        values.append({"tag": a["tag"], "name": a["name"], "values": sorted(vals, key=lambda e: e["value"])})
    buildStatTable(vf, values, elidedFallbackName=2)
    return vf


def build_fonts(project, build, out_dir, formats=("otf", "ttf", "woff2", "variable")):
    """Write the font files; returns a list of written paths."""
    metrics = vertical_metrics(project, build)
    written = []
    fam = ps_safe(project.family)
    for sub in ("otf", "ttf", "webfonts", "variable"):
        os.makedirs(os.path.join(out_dir, sub), exist_ok=True)
    for inst in project.instances:
        style = inst["name"]
        glyphs = build.instance(inst["location"])
        kerning = build.kerning_at(inst["location"])
        base = "{}-{}".format(fam, ps_safe(style))
        if "otf" in formats:
            f = static_font(project, build, glyphs, style, inst["location"], kerning, "otf", metrics)
            path = os.path.join(out_dir, "otf", base + ".otf")
            f.save(path)
            written.append(path)
        if "ttf" in formats or "woff2" in formats:
            f = static_font(project, build, glyphs, style, inst["location"], kerning, "ttf", metrics)
            if "ttf" in formats:
                path = os.path.join(out_dir, "ttf", base + ".ttf")
                f.save(path)
                written.append(path)
            if "woff2" in formats:
                f.flavor = "woff2"
                path = os.path.join(out_dir, "webfonts", base + ".woff2")
                f.save(path)
                written.append(path)
    if "variable" in formats and project.axes and len(project.masters) > 1:
        vf = variable_font(project, build, metrics)
        tags = ",".join(a["tag"] for a in project.axes)
        path = os.path.join(out_dir, "variable", "{}[{}].ttf".format(fam, tags))
        vf.save(path)
        written.append(path)
        if "woff2" in formats:
            vf.flavor = "woff2"
            path = os.path.join(out_dir, "variable", "{}[{}].woff2".format(fam, tags))
            vf.save(path)
            written.append(path)
    return written, metrics
