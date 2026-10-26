"""Spacing and kerning measured as white space between glyph profiles.

The white between two glyphs is measured on horizontal rows across a zone. On
each row it is the left glyph's right sidebearing plus how deep its white
reaches into the glyph there, plus the same for the right glyph's left side.
Depth is capped, so an open counter or the pocket under a T's bar does not
count as endless white. The white of a pair blends the mean of those rows with
the pair's closest approach (the narrowest gap between the two inks): the mean
alone adds up side by side and can never see that A and V leave a wide channel
together, while the eye judges a pair largely by where it comes closest.

A glyph's sidebearing change is what makes its white next to its control (n n
for lowercase, H H for capitals, zero zero for figures) equal to the control
pair's own white. A kern is the same comparison for a pair, minus the two
glyphs' own sidebearing errors, so it shows only how the shapes meet.
"""
import unicodedata

from .charset import name_to_unicode
from .outline import runs, union_contours

# Depth cap as a fraction of the x-height. Deeper caps make round and slanted sides read as far
# more white than the eye sees; together with CLOSEST this spaces o, A and V and kerns AV, To and
# LT about the way type designers usually do.
DEFAULT_DEPTH = 0.12
# Weight of the closest approach in a pair's white; the rest is the mean over the rows.
CLOSEST = 0.2
STEP_FRACTION = 0.01


def _cp(build, name):
    g = build.glyphs.get(name)
    if g and g.unicodes:
        return g.unicodes[0]
    return name_to_unicode(name.split(".")[0])


def kind(build, name):
    cp = _cp(build, name)
    if cp is None:
        return "other"
    cat = unicodedata.category(chr(cp))
    if cat == "Lu":
        return "upper"
    if cat == "Ll":
        return "lower"
    if cat == "Nd":
        return "figure"
    return "other"


class Profiles:
    """Row profiles of the glyphs of one master or instance."""

    def __init__(self, project, glyphs, depth=DEFAULT_DEPTH):
        self.project = project
        self.glyphs = glyphs
        self.xh = project.metrics["xheight"]
        self.cap = project.metrics["cap"]
        self.depth = depth * self.xh
        self.step = max(2.0, STEP_FRACTION * project.metrics["upm"])
        self.cache = {}

    def data(self, name):
        if name in self.cache:
            return self.cache[name]
        mg = self.glyphs[name]
        contours = union_contours(mg.contours)
        rows = {}
        x_min = x_max = None
        y_lo, y_hi = None, None
        if contours:
            from .geometry import contour_bounds
            bounds = [contour_bounds(*c) for c in contours]
            x_min = min(b[0] for b in bounds)
            x_max = max(b[2] for b in bounds)
            y_lo = min(b[1] for b in bounds)
            y_hi = max(b[3] for b in bounds)
        d = {"contours": contours, "rows": rows, "x_min": x_min, "x_max": x_max, "y": (y_lo, y_hi),
             "advance": mg.advance}
        self.cache[name] = d
        return d

    def row(self, name, y):
        d = self.data(name)
        key = round(y, 3)
        if key not in d["rows"]:
            r = runs(d["contours"], 1, y) if d["contours"] else []
            d["rows"][key] = (r[0][0], r[-1][1]) if r else None
        return d["rows"][key]

    def zone(self, build, a, b):
        za = self._zone(build, a)
        zb = self._zone(build, b)
        if za is None or zb is None:
            return None
        # Punctuation next to a letter is judged over the letter's zone: a period beside an o
        # is seen against the whole o, not only the rows of the o's bottom curve.
        ka, kb = kind(build, a), kind(build, b)
        if ka == "other" and kb != "other":
            return zb
        if kb == "other" and ka != "other":
            return za
        lo, hi = max(za[0], zb[0]), min(za[1], zb[1])
        if hi - lo < self.step:
            # Glyphs that never share a row (a quote next to a period): use the union.
            lo, hi = min(za[0], zb[0]), max(za[1], zb[1])
        return lo, hi

    def _zone(self, build, name):
        k = kind(build, name)
        if k == "lower":
            return (0.0, self.xh)
        if k in ("upper", "figure"):
            return (0.0, self.cap)
        y = self.data(name)["y"]
        if y[0] is None:
            return None
        return y

    def white(self, a, b, zone):
        """White between a and b set side by side with no kerning, over the zone's rows.

        Adding k units between the two glyphs adds exactly k to this value.
        """
        da, db = self.data(a), self.data(b)
        if da["x_max"] is None or db["x_min"] is None:
            return None
        sb_a = da["advance"] - da["x_max"]
        sb_b = db["x_min"]
        total = 0.0
        count = 0
        closest = None
        y = zone[0] + self.step / 2
        while y < zone[1]:
            ra = self.row(a, y)
            rb = self.row(b, y)
            if ra is not None or rb is not None:
                depth_a = self.depth if ra is None else min(da["x_max"] - ra[1], self.depth)
                depth_b = self.depth if rb is None else min(rb[0] - db["x_min"], self.depth)
                total += sb_a + depth_a + sb_b + depth_b
                count += 1
                if ra is not None and rb is not None:
                    gap = da["advance"] - ra[1] + rb[0]
                    closest = gap if closest is None else min(closest, gap)
            y += self.step
        if not count:
            return None
        mean = total / count
        if closest is None:
            return mean
        return (1 - CLOSEST) * mean + CLOSEST * closest

    def tightest(self, a, b, kern):
        """Smallest horizontal gap between the ink of a and b over every row both have ink in."""
        da, db = self.data(a), self.data(b)
        if da["y"][0] is None or db["y"][0] is None:
            return None
        lo, hi = max(da["y"][0], db["y"][0]), min(da["y"][1], db["y"][1])
        best = None
        y = lo + self.step / 4
        while y < hi:
            ra, rb = self.row(a, y), self.row(b, y)
            if ra and rb:
                gap = (da["advance"] - ra[1]) + rb[0] + kern
                best = gap if best is None else min(best, gap)
            y += self.step / 2
        return best


def control_for(build, name):
    k = kind(build, name)
    if k == "upper":
        return "H"
    if k == "figure":
        return "zero"
    return "n"


def _side_errors(prof, build, name):
    """(left, right): units to add to each sidebearing of name so its white matches its control's."""
    if kind(build, name) == "other":
        return 0.0, 0.0
    ctrl = control_for(build, name)
    if ctrl not in prof.glyphs or name == ctrl or prof.data(name)["x_min"] is None:
        return 0.0, 0.0
    zone = prof.zone(build, ctrl, name)
    ref = prof.white(ctrl, ctrl, zone)
    left = prof.white(ctrl, name, zone)
    right = prof.white(name, ctrl, zone)
    if ref is None or left is None or right is None:
        return 0.0, 0.0
    return ref - left, ref - right


def spacing_report(project, build, glyphs, names, threshold, depth=DEFAULT_DEPTH):
    """Per glyph, how much each sidebearing would change to match its control's white."""
    prof = Profiles(project, glyphs, depth)
    rows = []
    for name in names:
        if name not in glyphs or prof.data(name)["x_min"] is None:
            continue
        ctrl = control_for(build, name)
        if ctrl not in glyphs or name == ctrl or build.glyphs[name].fixed:
            continue
        left, right = _side_errors(prof, build, name)
        d = prof.data(name)
        rows.append({
            "glyph": name,
            "control": ctrl,
            "lsb": round(d["x_min"]),
            "rsb": round(d["advance"] - d["x_max"]),
            "left_change": round(left),
            "right_change": round(right),
            "flag": abs(left) >= threshold or abs(right) >= threshold,
        })
    return rows


def default_pairs(build):
    letters_upper = [n for n in build.order if kind(build, n) == "upper" and build.glyphs[n].base is None]
    letters_lower = [n for n in build.order if kind(build, n) == "lower" and build.glyphs[n].base is None]
    punct = [n for n in ("period", "comma", "colon", "semicolon", "hyphen", "quoteright", "quotedblright",
                         "quoteleft", "quotedblleft", "quotesingle", "quotedbl", "parenright", "parenleft",
                         "exclam", "question", "slash", "endash", "emdash", "guilsinglleft", "guilsinglright",
                         "guillemotleft", "guillemotright", "quotesinglbase", "quotedblbase", "ellipsis")
             if n in build.glyphs]
    pairs = []
    for a in letters_upper:
        for b in letters_upper + letters_lower + punct:
            pairs.append((a, b))
    for a in letters_lower:
        for b in letters_lower + punct:
            pairs.append((a, b))
    for a in punct:
        for b in letters_upper + letters_lower:
            pairs.append((a, b))
    return pairs


def kern_suggestions(project, build, glyphs, pairs, threshold, existing, depth=DEFAULT_DEPTH):
    """Suggested kern value per pair: the white the pair lacks or has too much of, net of spacing errors."""
    prof = Profiles(project, glyphs, depth)
    errors = {}
    out = {}
    for a, b in pairs:
        if a not in glyphs or b not in glyphs:
            continue
        zone = prof.zone(build, a, b)
        if zone is None:
            continue
        ca = control_for(build, a) if kind(build, a) != "other" else a
        cb = control_for(build, b) if kind(build, b) != "other" else b
        if ca not in glyphs or cb not in glyphs:
            continue
        ref = prof.white(ca, cb, zone)
        got = prof.white(a, b, zone)
        if ref is None or got is None:
            continue
        for n in (a, b):
            if n not in errors:
                errors[n] = _side_errors(prof, build, n)
        # A sidebearing that is off is fixed with `dfont space`, not with kerning.
        k = ref - got - errors[a][1] - errors[b][0]
        k = 5 * round(k / 5)
        if abs(k) >= threshold or (a, b) in existing:
            out[(a, b)] = k
    return out


def collisions(project, build, glyphs, kerning, min_gap):
    """Class members that come closer than min_gap once their base pair is kerned."""
    from .compile import kern_classes
    prof = Profiles(project, glyphs)
    classes = kern_classes(build)
    found = []
    for (a, b), k in kerning.items():
        if a not in glyphs or b not in glyphs:
            continue
        lefts = [a] + classes.get(a, [])
        rights = [b] + classes.get(b, [])
        for la in lefts:
            for rb in rights:
                if (la, rb) != (a, b) and (la, rb) in kerning:
                    continue
                gap = prof.tightest(la, rb, k)
                if gap is not None and gap < min_gap:
                    found.append({"pair": "{} {}".format(la, rb), "kern": round(k), "gap": round(gap),
                                  "suggested": round(k + (min_gap - gap))})
    return found
