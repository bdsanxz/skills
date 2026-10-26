"""dfont: build, proof and check a parametric font project. `dfont --help` explains every command."""
import argparse
import datetime
import json
import os
import sys
import time

from .charset import CHARSET_HELP, category, glyph_name
from .project import Project, ProjectError
from .spacing import DEFAULT_DEPTH


def out(line=""):
    print(line, flush=True)


def fail(message):
    print("dfont: error: " + message, file=sys.stderr, flush=True)
    sys.exit(2)


def _load(path):
    if not os.path.isdir(path):
        fail("{} is not a directory; pass the font project's directory (the one holding font.json)".format(path))
    try:
        return Project(path)
    except ProjectError as exc:
        fail(str(exc))


def _short(project, where):
    if not where:
        return ""
    if where.startswith(project.root + os.sep):
        return where[len(project.root) + 1:]
    return where


def print_problems(project, problems, limit=60):
    levels = ("error", "warning", "missing", "info")
    counts = {lv: sum(1 for p in problems if p["level"] == lv) for lv in levels}
    out("problems: {} error, {} warning, {} missing, {} info".format(
        counts["error"], counts["warning"], counts["missing"], counts["info"]))
    shown = 0
    for lv in ("error", "warning"):
        for p in problems:
            if p["level"] != lv:
                continue
            if shown >= limit:
                out("  ... {} more; see the full list with --all".format(
                    sum(1 for q in problems if q["level"] in ("error", "warning")) - shown))
                return counts
            where = _short(project, p.get("where"))
            out("  {}: {}{}{}".format(lv, (p["glyph"] + ": ") if p.get("glyph") else "", p["message"],
                                     "  [{}]".format(where) if where else ""))
            shown += 1
    missing = [p["glyph"] for p in problems if p["level"] == "missing"]
    if missing:
        out("  missing ({}): {}".format(len(missing), " ".join(missing[:80]) + (" ..." if len(missing) > 80 else "")))
    return counts


# --- build ----------------------------------------------------------------------


def _sources(project):
    paths = [project.config_path, project.kerning_path] + list(project.glyph_files)
    for f in os.listdir(project.root):
        if f.endswith(".py"):
            paths.append(os.path.join(project.root, f))
    return {p: os.path.getmtime(p) for p in paths if os.path.exists(p)}


def _stamp_path(project):
    return os.path.join(project.root, "dist", "build.json")


def is_stale(project):
    path = _stamp_path(project)
    if not os.path.exists(path):
        return True
    try:
        with open(path) as fh:
            stamp = json.load(fh)
    except (OSError, ValueError):
        return True
    return stamp.get("sources") != {k: v for k, v in _sources(project).items()}


def do_build(project, formats, quiet=False):
    from .compile import build_fonts
    from .specimen import write_specimen
    t0 = time.time()
    build = project.build()
    dist = os.path.join(project.root, "dist")
    os.makedirs(dist, exist_ok=True)
    files, metrics = build_fonts(project, build, dist, formats)
    spec = write_specimen(project, build, dist, files)
    stamp = {
        "built": datetime.datetime.now().isoformat(timespec="seconds"),
        "sources": _sources(project),
        "files": files,
        "glyphs": len(build.order),
        "problems": build.problems,
        "metrics": metrics,
    }
    with open(_stamp_path(project), "w") as fh:
        json.dump(stamp, fh, indent=1)
    if not quiet:
        out("built {} glyphs in {} master(s) in {:.1f}s".format(len(build.order), len(project.masters),
                                                               time.time() - t0))
        for f in files + [spec]:
            out("  " + _short(project, f))
        print_problems(project, build.problems)
    return build, files


def cmd_build(args):
    project = _load(args.project)
    formats = tuple(f.strip() for f in args.formats.split(","))
    bad = [f for f in formats if f not in ("otf", "ttf", "woff2", "variable")]
    if bad:
        fail("unknown format(s) {}; use otf, ttf, woff2, variable".format(", ".join(bad)))
    build, _ = do_build(project, formats)
    return 1 if build.errors() else 0


# --- proof ------------------------------------------------------------------------


def cmd_proof(args):
    from .proof import SHEETS, make_proofs
    project = _load(args.project)
    sheets = args.sheet or ["control", "detail"]
    if "all" in sheets:
        sheets = list(SHEETS)
    bad = [s for s in sheets if s not in SHEETS]
    if bad:
        fail("unknown sheet(s) {}; choose from: {}, all".format(", ".join(bad), ", ".join(SHEETS)))
    if is_stale(project) or args.rebuild:
        out("sources changed since the last build; building first")
        build, _ = do_build(project, ("ttf", "woff2", "variable", "otf"), quiet=True)
    else:
        build = project.build()
    if args.style:
        known = [i["name"] for i in project.instances]
        bad = [s for s in args.style if s not in known]
        if bad:
            fail("unknown style(s) {}; styles: {}".format(", ".join(bad), ", ".join(known)))
    glyphs = [g.strip() for g in args.glyphs.split(",")] if args.glyphs else None
    if glyphs:
        unknown = [g for g in glyphs if g not in build.glyphs]
        if unknown:
            fail("glyph(s) not in the build: {}".format(", ".join(unknown)))
    target = args.out or os.path.join(project.root, "proof")
    os.makedirs(target, exist_ok=True)
    written = make_proofs(project, build, os.path.join(project.root, "dist"), sheets, target, args.style, glyphs,
                          args.text)
    for path in written:
        out(path)
    if not written:
        out("nothing to proof yet: build at least one glyph")
    errors = [p for p in build.problems if p["level"] == "error"]
    if errors:
        out("note: the build has {} error(s); `dfont build` lists them".format(len(errors)))
    return 0


# --- check ------------------------------------------------------------------------


def cmd_check(args):
    from .check import run_checks, stems
    project = _load(args.project)
    build, files = do_build(project, ("otf", "ttf", "woff2", "variable"), quiet=True)
    problems = run_checks(project, build, files)
    qa = os.path.join(project.root, "qa")
    os.makedirs(qa, exist_ok=True)
    stem_tables = {m.name: stems(project, build, i) for i, m in enumerate(project.masters)}
    report = {"checked": datetime.datetime.now().isoformat(timespec="seconds"), "glyphs": len(build.order),
              "files": files, "problems": problems, "stems": stem_tables}
    with open(os.path.join(qa, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    lines = ["# QA report: {}".format(project.family), "", "Checked {}; {} glyphs.".format(report["checked"],
                                                                                          len(build.order)), ""]
    for lv in ("error", "warning", "missing", "info"):
        items = [p for p in problems if p["level"] == lv]
        lines.append("## {} ({})".format(lv, len(items)))
        lines.append("")
        for p in items:
            where = _short(project, p.get("where"))
            lines.append("- {}{}{}".format((p["glyph"] + ": ") if p.get("glyph") else "", p["message"],
                                          " `{}`".format(where) if where else ""))
        lines.append("")
    lines.append("## stems")
    lines.append("")
    for master, rows in stem_tables.items():
        lines.append("### {}".format(master))
        lines.append("")
        lines.append("| group | glyph | at | ink runs |")
        lines.append("| --- | --- | --- | --- |")
        for r in rows:
            lines.append("| {} | {} | {} | {} |".format(r["group"], r["glyph"], r["at"], ", ".join(map(str, r["widths"]))))
        lines.append("")
    with open(os.path.join(qa, "report.md"), "w") as fh:
        fh.write("\n".join(lines))
    if args.json:
        print(json.dumps(report, indent=1))
    else:
        counts = print_problems(project, problems, limit=10 ** 6 if args.all else 60)
        out("stems (ink widths along each probe line, stem first):")
        for master, rows in stem_tables.items():
            out("  {}: {}".format(master, "  ".join("{} {}".format(r["glyph"], "/".join(map(str, r["widths"])))
                                                    for r in rows)))
        out("report: " + os.path.join(qa, "report.md"))
    return 1 if any(p["level"] == "error" for p in problems) else 0


# --- spacing and kerning --------------------------------------------------------------


def _glyphs_for(project, build, master, style):
    if master and style:
        fail("pass --master or --style, not both")
    if style:
        for inst in project.instances:
            if inst["name"] == style:
                return build.instance(inst["location"]), "style " + style
        fail("no style {!r}; styles: {}".format(style, ", ".join(i["name"] for i in project.instances)))
    idx = project.master_index(master) if master else project.masters.index(project.default_master)
    return build.master(idx), "master " + project.masters[idx].name


def cmd_space(args):
    from .spacing import spacing_report
    project = _load(args.project)
    build = project.build()
    try:
        glyphs, label = _glyphs_for(project, build, args.master, args.style)
    except ProjectError as exc:
        fail(str(exc))
    names = [g.strip() for g in args.glyphs.split(",")] if args.glyphs else [
        n for n in build.order if build.glyphs[n].origin == "drawn" and category(
            (build.glyphs[n].unicodes or [None])[0]) in ("lowercase", "uppercase", "figures")]
    threshold = args.threshold if args.threshold is not None else 0.01 * project.metrics["upm"]
    rows = spacing_report(project, build, glyphs, names, threshold, args.depth)
    out("spacing in {} (change = units to add to that sidebearing so its white matches the control pair):".format(
        label))
    out("  glyph      control  lsb   rsb   left_change  right_change")
    for r in rows:
        if r["flag"] or args.all:
            out("  {:<10} {:<8} {:>4}  {:>4}  {:>+11}  {:>+12}".format(
                r["glyph"], r["control"], r["lsb"], r["rsb"], r["left_change"], r["right_change"]))
    flagged = sum(1 for r in rows if r["flag"])
    out("{} of {} glyphs differ by {} units or more{}".format(
        flagged, len(rows), round(threshold), "" if args.all else " (pass --all to list every glyph)"))
    return 0


def _parse_pairs(spec, build):
    from .spacing import default_pairs
    if spec in (None, "default"):
        return default_pairs(build)
    if os.path.exists(spec):
        with open(spec) as fh:
            text = fh.read()
    else:
        text = spec
    pairs = []
    for item in text.replace("\n", ",").split(","):
        parts = item.split()
        if len(parts) == 2:
            pairs.append(tuple(parts))
        elif parts:
            fail("pair {!r} must be two glyph names separated by a space".format(item.strip()))
    return pairs


def cmd_kern(args):
    from .spacing import collisions, kern_suggestions
    project = _load(args.project)
    build = project.build()
    pairs = _parse_pairs(args.pairs, build)
    unknown = sorted({g for p in pairs for g in p if g not in build.glyphs})
    if unknown:
        fail("glyph(s) not in the build: {}".format(", ".join(unknown)))
    threshold = args.min if args.min is not None else 0.02 * project.metrics["upm"]
    min_gap = args.min_gap if args.min_gap is not None else 0.02 * project.metrics["upm"]
    masters = [args.master] if args.master else [m.name for m in project.masters]
    per_master = {}
    for name in masters:
        try:
            idx = project.master_index(name)
        except ProjectError as exc:
            fail(str(exc))
        glyphs = build.master(idx)
        per_master[name] = kern_suggestions(project, build, glyphs, pairs, threshold, set(project.kerning),
                                            args.depth)
    keys = sorted(set().union(*[set(v) for v in per_master.values()]))
    suggested = {}
    for k in keys:
        vals = {m: per_master[m].get(k, 0) for m in masters}
        suggested["{} {}".format(*k)] = vals if len(set(vals.values())) > 1 else list(vals.values())[0]
    target = args.out or os.path.join(project.root, "kerning.suggested.json")
    with open(target, "w") as fh:
        json.dump({"pairs": suggested}, fh, indent=1)
    out("{} pair(s) with a suggested kern of {} units or more, from {} candidate pairs, in {}".format(
        len(suggested), round(threshold), len(pairs), ", ".join(masters)))
    for key, v in list(suggested.items())[:200]:
        out("  {:<24} {}".format(key, v))
    out("written to " + target)
    if args.write:
        merged = {}
        if os.path.exists(project.kerning_path):
            with open(project.kerning_path) as fh:
                merged = json.load(fh).get("pairs", {})
        if args.master and len(project.masters) > 1:
            fail("--write needs suggestions for every master; run without --master")
        merged.update(suggested)
        with open(project.kerning_path, "w") as fh:
            json.dump({"pairs": dict(sorted(merged.items()))}, fh, indent=1)
        out("merged into " + project.kerning_path)
        project = _load(args.project)
        build = project.build()
    found = []
    for i, m in enumerate(project.masters):
        k = build.kerning_master(i)
        for c in collisions(project, build, build.master(i), k, min_gap):
            c["master"] = m.name
            found.append(c)
    if found:
        out("accented or derived glyphs that come too close once their base pair is kerned (gap < {}):".format(
            round(min_gap)))
        for c in found[:100]:
            out("  {:<24} master {:<10} kern {:>5}  gap {:>4}  -> exception {}".format(
                c["pair"], c["master"], c["kern"], c["gap"], c["suggested"]))
    return 0


# --- measure, status ----------------------------------------------------------------------


def cmd_measure(args):
    from .outline import runs, union_contours
    project = _load(args.project)
    build = project.build(only=None)
    if args.glyph not in build.glyphs:
        fail("glyph {!r} is not in the build".format(args.glyph))
    if (args.y is None) == (args.x is None):
        fail("pass exactly one of --y (a horizontal scanline) or --x (a vertical one)")
    try:
        glyphs, label = _glyphs_for(project, build, args.master, args.style)
    except ProjectError as exc:
        fail(str(exc))
    contours = union_contours(glyphs[args.glyph].contours)
    axis, value = (1, args.y) if args.y is not None else (0, args.x)
    r = runs(contours, axis, value)
    out("{} in {}, {}={}: {} ink run(s)".format(args.glyph, label, "y" if axis else "x", value, len(r)))
    for a, b in r:
        out("  {:.1f} to {:.1f}  thickness {:.1f}".format(a, b, b - a))
    gaps = [r[i + 1][0] - r[i][1] for i in range(len(r) - 1)]
    if gaps:
        out("  gaps: " + ", ".join("{:.1f}".format(g) for g in gaps))
    return 0


def cmd_status(args):
    project = _load(args.project)
    build = project.build()
    groups = {}
    for cp in project.charset:
        name = glyph_name(cp)
        g = build.glyphs.get(name)
        state = g.origin if g else "missing"
        groups.setdefault(category(cp), {}).setdefault(state, []).append(name)
    out("{}: {} masters ({}), {} styles, charset {} glyphs".format(
        project.family, len(project.masters), ", ".join(m.name for m in project.masters), len(project.instances),
        len(project.charset)))
    total = {"drawn": 0, "composite": 0, "accent": 0, "alias": 0, "missing": 0}
    for cat in ("lowercase", "uppercase", "figures", "punctuation", "symbols", "accents", "spaces", "other"):
        if cat not in groups:
            continue
        st = groups[cat]
        parts = []
        for state in ("drawn", "composite", "accent", "alias", "missing"):
            if st.get(state):
                total[state] += len(st[state])
                parts.append("{} {}".format(len(st[state]), state))
        out("  {:<12} {}".format(cat, ", ".join(parts)))
        if st.get("missing"):
            out("    missing: " + " ".join(st["missing"]))
    out("total: " + ", ".join("{} {}".format(v, k) for k, v in total.items()))
    out("kerning pairs: {}".format(len(project.kerning)))
    errors = [p for p in build.problems if p["level"] == "error"]
    if errors:
        out("build errors: {} (run `dfont build` to list them)".format(len(errors)))
    out("last build: " + ("stale or none" if is_stale(project) else "up to date"))
    return 0


def cmd_new(args):
    from .scaffold import create, parse_weights
    try:
        weights = parse_weights(args.weights)
    except ValueError as exc:
        fail(str(exc))
    default = args.default or ("Regular" if "Regular" in dict(weights) else weights[0][0])
    charset = [c.strip() for c in args.charset.split(",")]
    from .charset import charset_codepoints
    try:
        charset_codepoints(charset)
    except ValueError as exc:
        fail(str(exc))
    upm = args.upm
    xh = args.xheight if args.xheight is not None else round(upm * 0.52)
    cap = args.cap if args.cap is not None else round(upm * 0.7)
    asc = args.ascender if args.ascender is not None else round(upm * 0.76)
    desc = args.descender if args.descender is not None else -round(upm * 0.24)
    try:
        written = create(os.path.abspath(args.project), args.family, weights, default, charset, upm, xh, cap, asc,
                         desc)
    except (FileExistsError, ValueError) as exc:
        fail(str(exc))
    for w in written:
        out(w)
    return 0


def cmd_charsets(args):
    for name, text in CHARSET_HELP.items():
        out("{}: {}".format(name, text))
    return 0


EXIT_CODES = """exit status:
  0  done
  1  done, but the font has errors (listed in the output)
  2  could not run: a bad argument or an unusable project (the message says which)"""

OVERVIEW = """A font project is a directory holding font.json (family, metrics, masters and
their parameters), glyphs/*.py (one Python function per glyph, drawn as strokes
over the parameters), lib.py (shared drawing helpers) and kerning.json.

usual order of work:
  1. dfont new DIR --family NAME      start a project with starter glyphs n o H O
  2. edit font.json and glyphs/*.py   draw; then proof and check after every change
  3. dfont proof DIR                  look at the PNG proof sheets in DIR/proof
  4. dfont check DIR                  fix every error; read the warnings
  5. dfont status DIR                 see which glyphs are still missing
  6. dfont space DIR, dfont kern DIR  even out spacing, then add kerning
  7. dfont build DIR                  final OTF, TTF, WOFF2, variable font, specimen

Run `dfont COMMAND --help` for what a command does, its options and examples.
DIR is always the project directory, the one that holds font.json.
The environment lives in $FONT_DESIGN_HOME, else ~/.cache/font-design.

""" + EXIT_CODES


EXIT_CODES_NO_CHECK = """exit status:
  0  done
  2  could not run: a bad argument or an unusable project (the message says which)"""


def _command(sub, name, summary, description, examples, writes=None, finds_errors=False):
    """A subcommand whose --help says what it does, what it writes, how to call it and what it returns."""
    epilog = ""
    if writes:
        epilog += "writes:\n" + "\n".join("  " + w for w in writes) + "\n\n"
    epilog += "examples:\n" + "\n".join("  " + e for e in examples) + "\n\n"
    epilog += EXIT_CODES if finds_errors else EXIT_CODES_NO_CHECK
    p = sub.add_parser(name, help=summary, description=summary[0].upper() + summary[1:] + ".\n\n" + description,
                       epilog=epilog, formatter_class=argparse.RawDescriptionHelpFormatter)
    return p


def _project_arg(p):
    p.add_argument("project", metavar="DIR", help="the font project directory (the one holding font.json)")


def cmd_setup(args):
    out("environment: " + sys.prefix)
    out("python: " + sys.version.split()[0])
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="dfont", description="Build, proof and check a parametric font project.", epilog=OVERVIEW,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    p = _command(sub, "setup", "create the Python environment the commands run in",
                 "Every command creates the environment on first use, so this is optional. Run it once\n"
                 "up front to install the dependencies and see where they live; later runs only print\n"
                 "the path. Delete that directory to force a clean install.",
                 ["dfont setup"])
    p.set_defaults(func=cmd_setup)

    p = _command(sub, "new", "start a font project",
                 "Creates DIR with font.json, starter control glyphs (space, n, o, H, O) in\n"
                 "glyphs/control.py, an empty glyph file per group, lib.py for shared helpers and an\n"
                 "empty kerning.json. Each weight becomes a master with parameters (stem, widths,\n"
                 "sidebearings, ...) estimated from its weight and the vertical metrics; tune them in\n"
                 "font.json. Vertical metrics default to fractions of the UPM: x-height 0.52,\n"
                 "cap height 0.70, ascender 0.76, descender -0.24. DIR must not hold a project yet.",
                 ["dfont new ~/fonts/example-sans --family \"Example Sans\"",
                  "dfont new serif --family \"Example Serif\" --weights Regular:400,Bold:700 --xheight 480",
                  "dfont new mono --family \"Example Mono\" --weights Regular:400 --charset basic-latin"],
                 writes=["DIR/font.json, DIR/glyphs/*.py, DIR/lib.py, DIR/kerning.json"])
    p.add_argument("project", metavar="DIR", help="directory to create the project in (created if missing)")
    p.add_argument("--family", required=True, metavar="NAME", help="family name, as in \"Example Sans\" (required)")
    p.add_argument("--weights", default="Light:300,Regular:400,Bold:700", metavar="NAME:WGHT,...",
                   help="masters and styles as Name:weight pairs; one pair makes a single-style font, two or "
                        "more add a weight axis and a variable font (default: %(default)s)")
    p.add_argument("--default", metavar="NAME", help="the master at the variable font's default location "
                                                    "(default: Regular if listed, else the first)")
    p.add_argument("--charset", default="latin-core", metavar="SETS",
                   help="glyphs the font must cover: named sets (see `dfont charsets`), glyph names, U+XXXX "
                        "or U+XXXX-YYYY ranges, comma separated (default: %(default)s)")
    p.add_argument("--upm", type=int, default=1000, help="units per em (default: %(default)s)")
    p.add_argument("--xheight", type=float, help="height of x in units (default: 0.52 x UPM)")
    p.add_argument("--cap", type=float, help="height of H in units (default: 0.70 x UPM)")
    p.add_argument("--ascender", type=float, help="height of ascenders such as h in units (default: 0.76 x UPM)")
    p.add_argument("--descender", type=float, help="depth of descenders such as p, negative (default: -0.24 x UPM)")
    p.set_defaults(func=cmd_new)

    p = _command(sub, "build", "build every font file and the HTML specimen into DIR/dist",
                 "Runs every glyph function for every master, expands the strokes into outlines,\n"
                 "builds accented glyphs from their base and mark, then writes the fonts. Prints the\n"
                 "files written and every error and warning with the glyph file and line it comes\n"
                 "from. A glyph whose code fails is left out and reported; the rest still build.",
                 ["dfont build myfont",
                  "dfont build myfont --formats otf,woff2"],
                 writes=["DIR/dist/otf/FAMILY-STYLE.otf        one per style",
                         "DIR/dist/ttf/FAMILY-STYLE.ttf",
                         "DIR/dist/webfonts/FAMILY-STYLE.woff2",
                         "DIR/dist/variable/FAMILY[wght].ttf and .woff2   when there are two or more masters",
                         "DIR/dist/specimen.html                 open it in a browser",
                         "DIR/dist/build.json                    what was built and from which sources"],
                 finds_errors=True)
    _project_arg(p)
    p.add_argument("--formats", default="otf,ttf,woff2,variable", metavar="LIST",
                   help="comma separated, any of otf, ttf, woff2, variable (default: %(default)s)")
    p.set_defaults(func=cmd_build)

    from .proof import SHEETS
    sheet_list = "\n".join("  {:<10} {}".format(k, v) for k, v in SHEETS.items())
    p = _command(sub, "proof", "render PNG proof sheets into DIR/proof",
                 "Proof sheets are how you look at the font: open each PNG it prints and judge it.\n"
                 "It builds first when a source changed since the last build. Long sheets are split\n"
                 "into pages named SHEET.png, SHEET-2.png, and so on.\n\n"
                 "sheets:\n" + sheet_list,
                 ["dfont proof myfont                                   control and detail sheets",
                  "dfont proof myfont --sheet spacing --sheet kerning    two sheets",
                  "dfont proof myfont --sheet all --style Regular        every sheet, one style",
                  "dfont proof myfont --sheet detail --glyphs a,g,s      chosen glyphs up close",
                  "dfont proof myfont --sheet text --text \"Your own sample\""],
                 writes=["DIR/proof/*.png   (or the --out directory); the paths are printed"])
    _project_arg(p)
    p.add_argument("--sheet", action="append", metavar="SHEET",
                   help="a sheet from the list above, or all; repeat the option for several "
                        "(default: control and detail)")
    p.add_argument("--style", action="append", metavar="NAME", help="only this style, as named in font.json "
                                                                   "instances; repeat for several (default: all)")
    p.add_argument("--glyphs", metavar="NAMES", help="glyph names for the detail sheet, comma separated "
                                                    "(default: n,o,H,O)")
    p.add_argument("--text", help="your own text for the text, weights and waterfall sheets")
    p.add_argument("--out", metavar="DIR", help="directory for the PNG files (default: DIR/proof)")
    p.add_argument("--rebuild", action="store_true", help="build first even when nothing changed")
    p.set_defaults(func=cmd_proof)

    p = _command(sub, "check", "run every quality check; write DIR/qa/report.md",
                 "Builds, then checks the outlines (points just off the baseline, x-height or cap\n"
                 "height; round shapes without overshoot; curves missing extreme points), stem\n"
                 "consistency, contours that flip between masters, sidebearings, that every built\n"
                 "character reached each font file, and the OpenType sanitizer browsers use.\n"
                 "Levels: error = must fix; warning = probably wrong, look at it; missing = glyphs of\n"
                 "the charset not drawn yet; info = worth knowing. The stem table lists ink widths\n"
                 "along fixed lines through reference glyphs, stem first, per master.",
                 ["dfont check myfont",
                  "dfont check myfont --all     every error and warning, not only the first 60",
                  "dfont check myfont --json    the whole report as JSON on stdout"],
                 writes=["DIR/qa/report.md     readable report", "DIR/qa/report.json   the same as data"],
                 finds_errors=True)
    _project_arg(p)
    p.add_argument("--json", action="store_true", help="print the full report as JSON instead of a summary")
    p.add_argument("--all", action="store_true", help="list every error and warning (default: the first 60)")
    p.set_defaults(func=cmd_check)

    p = _command(sub, "status", "list which glyphs are drawn, made automatically, or missing",
                 "Groups the charset (lowercase, uppercase, figures, punctuation, symbols, accents,\n"
                 "spaces) and counts per group the glyphs that are drawn, built automatically\n"
                 "(composite: base plus mark; accent: a spacing accent from its combining mark;\n"
                 "alias: a copy such as nbspace), or still missing, and names the missing ones.\n"
                 "Also says whether the last build is up to date. Writes nothing.",
                 ["dfont status myfont"])
    _project_arg(p)
    p.set_defaults(func=cmd_status)

    depth_help = ("how far into a glyph its white still counts, as a fraction of the x-height; raise it to "
                  "count more of open shapes, lower it to count less (default: %(default)s)")
    p = _command(sub, "space", "suggest sidebearing changes that even out the white space",
                 "Compares the white space each glyph makes next to its control glyph (n for lowercase,\n"
                 "H for capitals, zero for figures) with the white between two controls, and prints\n"
                 "how many units to add to each sidebearing (negative: tighten). Space the controls by\n"
                 "eye first; this only spreads their spacing to the other glyphs. Apply a change by\n"
                 "editing that glyph's g.space(left, right), then proof the spacing sheet: the\n"
                 "numbers are a starting point and the proof decides. Glyphs with g.fixed() widths\n"
                 "are skipped. Writes nothing.",
                 ["dfont space myfont                        flagged glyphs of the default master",
                  "dfont space myfont --all --master Bold    every glyph of one master",
                  "dfont space myfont --glyphs a,e,s --style Medium"])
    _project_arg(p)
    p.add_argument("--master", metavar="NAME", help="a master from font.json (default: the default master)")
    p.add_argument("--style", metavar="NAME", help="an instance from font.json, interpolated; use instead of --master")
    p.add_argument("--glyphs", metavar="NAMES", help="glyph names, comma separated (default: every drawn letter "
                                                    "and figure)")
    p.add_argument("--threshold", type=float, metavar="UNITS",
                   help="flag changes of at least this many units (default: 1%% of the UPM)")
    p.add_argument("--all", action="store_true", help="list every glyph, not only flagged ones")
    p.add_argument("--depth", type=float, default=DEFAULT_DEPTH, help=depth_help)
    p.set_defaults(func=cmd_space)

    p = _command(sub, "kern", "suggest kerning pairs; find accented glyphs that collide",
                 "For each pair, compares its white with the white of its control pair and suggests a\n"
                 "kern, rounded to 5 units, per master. A sidebearing that is off is left to `dfont\n"
                 "space`, so run that first. Kerning is by class: a pair kerns every glyph built on\n"
                 "its two bases (T o also kerns T oacute), so after the suggestions it lists accented\n"
                 "pairs whose ink would come closer than --min-gap, with an exception value that keeps\n"
                 "them apart; add those you agree with to kerning.json as their own pairs.\n\n"
                 "kerning.json holds {\"pairs\": {\"T o\": -60, \"A V\": {\"Light\": -70, \"Bold\": -80}}}:\n"
                 "one value for every master, or one per master name.",
                 ["dfont kern myfont                          the default pair list, every master",
                  "dfont kern myfont --pairs \"T o, A V, L T\"   only these pairs",
                  "dfont kern myfont --pairs pairs.txt         pairs from a file, one \"left right\" per line",
                  "dfont kern myfont --write                   also merge the suggestions into kerning.json"],
                 writes=["DIR/kerning.suggested.json (or --out)",
                         "DIR/kerning.json   only with --write; existing pairs not suggested are kept"])
    _project_arg(p)
    p.add_argument("--pairs", default="default", metavar="SPEC",
                   help="\"default\" (capitals, lowercase and common punctuation with each other), a file of "
                        "pairs, or pairs like \"T o, V a\" (default: the default list)")
    p.add_argument("--master", metavar="NAME", help="one master only (cannot be combined with --write)")
    p.add_argument("--min", type=float, metavar="UNITS",
                   help="smallest kern worth suggesting (default: 2%% of the UPM)")
    p.add_argument("--min-gap", type=float, metavar="UNITS",
                   help="smallest allowed gap between kerned ink, for the collision list (default: 2%% of the UPM)")
    p.add_argument("--out", metavar="FILE", help="where to write the suggestions (default: DIR/kerning.suggested.json)")
    p.add_argument("--write", action="store_true", help="merge the suggestions into kerning.json")
    p.add_argument("--depth", type=float, default=DEFAULT_DEPTH, help=depth_help)
    p.set_defaults(func=cmd_kern)

    p = _command(sub, "measure", "measure stem and counter widths along one line through a glyph",
                 "Lists where a horizontal line (--y) or a vertical line (--x) enters and leaves the\n"
                 "glyph's ink: each run's thickness is a stem or stroke width, each gap a counter or\n"
                 "the space between strokes. Coordinates are font units after spacing, as on the detail\n"
                 "sheet. Use it to compare stems between glyphs and masters. Writes nothing.",
                 ["dfont measure myfont --glyph n --y 200              stems of n, default master",
                  "dfont measure myfont --glyph e --x 280 --master Bold  bar and bowl of e",
                  "dfont measure myfont --glyph O --y 350 --style Medium"])
    _project_arg(p)
    p.add_argument("--glyph", required=True, metavar="NAME", help="glyph name, as in n, A, zero, oacute (required)")
    p.add_argument("--y", type=float, help="height of a horizontal line, in units (pass --y or --x)")
    p.add_argument("--x", type=float, help="position of a vertical line, in units (pass --y or --x)")
    p.add_argument("--master", metavar="NAME", help="a master from font.json (default: the default master)")
    p.add_argument("--style", metavar="NAME", help="an instance from font.json; use instead of --master")
    p.set_defaults(func=cmd_measure)

    p = _command(sub, "charsets", "list the named character sets",
                 "Names you can pass to `dfont new --charset` or put in font.json \"charset\". A charset\n"
                 "can also list glyph names and U+XXXX or U+XXXX-YYYY ranges.",
                 ["dfont charsets"])
    p.set_defaults(func=cmd_charsets)

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
