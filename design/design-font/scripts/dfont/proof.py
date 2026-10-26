"""Proof sheets: PNG pages that show the font the way a type designer reviews it."""
import os

from fontTools.pens.freetypePen import FreeTypePen
from PIL import Image, ImageDraw

from .charset import category, glyph_name
from .geometry import cubic_point, flatten
from .render import ACCENT, BLUE, GRID, INK, LABEL, PAPER, FontFile, label_font, outline_image

SHEETS = {
    "control": "control strings (nnonno, HHOHHO, hamburgefontsiv) at display size, one block per style",
    "spacing": "every glyph between control letters (nn?nn, HH?HH, 00?00)",
    "glyphs": "every glyph in a grid with its metrics lines and advance",
    "text": "running text at reading sizes, for color and rhythm",
    "kerning": "kerning strings set with kerning (black) and without (gray), then every pair in kerning.json",
    "weights": "one line in every style, then the variable font in even steps",
    "waterfall": "one line from 10 to 96 pixels per em",
    "detail": "chosen glyphs very large, per master, with skeletons, outline points and metrics",
}

PAGE_WIDTH = 1800
PAGE_HEIGHT = 2000
MARGIN = 40

LOWER_LINES = ["nnnnonnnoooo", "nonhohdpbqnon", "hamburgefontsiv", "adhesion minimum", "jumpy quokka fizz"]
UPPER_LINES = ["HHHHOHHHOOOO", "HOHNODHOHEH", "HAMBURGEFONTSIV", "ADHESION MINIMUM", "JUMPY QUOKKA FIZZ"]
MIXED_LINES = ["Hamburgefontsiv Adhesion", "Ohio Nimbus Dryad Quaver", "0123456789 1010 2020 3030"]

TEXT = [
    "The quick brown fox jumps over the lazy dog, while five wizards box nimbly and a sphinx of black quartz "
    "judges each vow. Typography is mostly white space: the shapes between the letters set the rhythm that "
    "a reader feels before any single letter is seen.",
    "Ein gemütlicher Jäger überquert die Brücke; Größe und Maß stehen im Text. Le cœur déçu mais l'âme ouverte, "
    "Zoé reçoit à Noël un œuf doré. El pingüino Wenceslao comió kiwi y jamón con ñandú. São João vê o "
    "irmão à noite. Blåbærsyltetøy og Æsir på færøysk øy.",
    "QUARTZ GLYPH JOB VEX’D CWM FINKS — 0123456789 (€12.50 / $34.99 / £7) “quotes”, ‘single’ & «guillemets» "
    "— 25% of 1,000 = 250; e-mail: name@example.org #3 *note* [a] {b} <c> ¶ § © ® ™ ° ± × ÷ ½ ¼ ¾",
]

KERN_LINES = [
    "AVATAR TAVERN WAVY LAYOUT ATLAS",
    "LT LV LY PA FA TA VA WA YA AT AV AW AY",
    "To Ta Te Ty Tr Va Vo Ve Wa Wo Ya Yo Yu",
    "P. F, T. V, W. Y. r. y, v. f’ ‘A’ “A” L’",
    "kerning ry, ra, rv. fly ffi quay",
]


class Pager:
    """Pages of fixed width that break when they grow past PAGE_HEIGHT."""

    def __init__(self, title):
        self.title = title
        self.pages = []
        self._new()

    def _new(self):
        self.items = []
        self.pages.append(self.items)
        self.y = MARGIN
        self.add_label(self.title + ("" if len(self.pages) == 1 else " (continued)"), 20, INK)

    def _fit(self, h):
        if self.y + h > PAGE_HEIGHT - MARGIN and self.y > MARGIN + 40:
            self._new()

    def add_label(self, text, size=16, color=LABEL, x=MARGIN):
        self._fit(size + 8)
        self.items.append(("label", x, self.y, text, size, color))
        self.y += size + 8

    def add_image(self, img, gap=8, x=MARGIN):
        img = _clip_width(img)
        self._fit(img.size[1] + gap)
        self.items.append(("image", x, self.y, img))
        self.y += img.size[1] + gap

    def add_row(self, images, gap=14):
        """Images side by side; wraps to more rows when they do not fit."""
        row, width = [], 0
        for img in images:
            img = _clip_width(img)
            if row and width + img.size[0] > PAGE_WIDTH - 2 * MARGIN:
                self._place_row(row, gap)
                row, width = [], 0
            row.append(img)
            width += img.size[0] + gap
        if row:
            self._place_row(row, gap)

    def _place_row(self, row, gap):
        h = max(i.size[1] for i in row)
        self._fit(h + gap)
        x = MARGIN
        for img in row:
            self.items.append(("image", x, self.y, img))
            x += img.size[0] + gap
        self.y += h + gap

    def space(self, h):
        self.y += h

    def save(self, base):
        paths = []
        for i, items in enumerate(self.pages):
            if len(items) <= 1:
                continue
            height = max([MARGIN * 2] + [_bottom(it) + MARGIN for it in items])
            page = Image.new("RGB", (PAGE_WIDTH, height), PAPER)
            draw = ImageDraw.Draw(page)
            for it in items:
                if it[0] == "label":
                    _, x, y, text, size, color = it
                    draw.text((x, y), text, fill=color, font=label_font(size))
                else:
                    _, x, y, img = it
                    page.paste(img, (x, y), img if img.mode == "RGBA" else None)
            path = base + ("" if i == 0 else "-{}".format(i + 1)) + ".png"
            page.save(path)
            paths.append(path)
        return paths


def _bottom(item):
    if item[0] == "label":
        return item[2] + item[4] + 8
    return item[2] + item[3].size[1]


def _clip_width(img):
    limit = PAGE_WIDTH - 2 * MARGIN
    if img.size[0] > limit:
        return img.crop((0, 0, limit, img.size[1]))
    return img


def _available(font, text):
    cmap = font.tt.getBestCmap() or {}
    return "".join(ch for ch in text if ord(ch) in cmap or ch == " ")


def _keep_words(font, text):
    cmap = font.tt.getBestCmap() or {}
    words = text.split(" ")
    kept = [w for w in words if w and all(ord(c) in cmap for c in w)]
    return " ".join(kept), len(words) - len(kept)


def _sample(font, text):
    """The words of `text` the font can set whole; failing that, the characters it has."""
    kept, _ = _keep_words(font, text)
    return kept or " ".join(_available(font, text).split())


def _wrap(font, text, px, width):
    space = font.shape(" ")
    space_w = sum(g[1] for g in space) * px / font.upm
    lines, cur, cur_w = [], [], 0.0
    for word in text.split(" "):
        w = sum(g[1] for g in font.shape(word)) * px / font.upm
        if cur and cur_w + space_w + w > width:
            lines.append(" ".join(cur))
            cur, cur_w = [word], w
        else:
            cur_w += (space_w if cur else 0) + w
            cur.append(word)
    if cur:
        lines.append(" ".join(cur))
    return lines


def _styles(dist, project, names):
    found = []
    from .compile import ps_safe
    for inst in project.instances:
        if names and inst["name"] not in names:
            continue
        path = os.path.join(dist, "ttf", "{}-{}.ttf".format(ps_safe(project.family), ps_safe(inst["name"])))
        if os.path.exists(path):
            found.append((inst["name"], path))
    return found


def sheet_control(project, build, dist, styles, out, **_):
    pager = Pager("{} - control strings".format(project.family))
    for style, path in styles:
        f = FontFile(path)
        pager.add_label(style, 18, INK)
        for line in LOWER_LINES + UPPER_LINES + MIXED_LINES:
            text = _available(f, line).strip()
            if len(text.replace(" ", "")) < 3:
                continue
            pager.add_image(f.line(text, 110)[0], gap=2)
        pager.space(20)
    return pager.save(os.path.join(out, "control"))


def _spacing_string(build, name, cp):
    ch = chr(cp)
    cat = category(cp)
    if cat == "uppercase":
        return "HH{0}HH OO{0}OO".format(ch)
    if cat == "figures":
        return "00{0}00 11{0}11".format(ch)
    if cat == "lowercase":
        return "nn{0}nn oo{0}oo".format(ch)
    return "nn{0}nn HH{0}HH".format(ch)


def sheet_spacing(project, build, dist, styles, out, **_):
    paths = []
    for style, path in styles:
        f = FontFile(path)
        pager = Pager("{} {} - spacing".format(project.family, style))
        cmap = f.tt.getBestCmap() or {}
        groups = {}
        for cp, name in sorted(cmap.items()):
            if cp <= 0x20 or category(cp) in ("accents", "spaces"):
                continue
            groups.setdefault(category(cp), []).append((name, cp))
        for cat in ("lowercase", "uppercase", "figures", "punctuation", "symbols"):
            if cat not in groups:
                continue
            pager.add_label(cat, 18, INK)
            imgs = [f.line(_available(f, _spacing_string(build, n, cp)), 54)[0] for n, cp in groups[cat]]
            pager.add_row(imgs, gap=36)
        paths += pager.save(os.path.join(out, "spacing-" + _slug(style)))
    return paths


def sheet_glyphs(project, build, dist, styles, out, **_):
    paths = []
    upm = project.metrics["upm"]
    em_px = 84
    s = em_px / upm
    for style, path in styles:
        f = FontFile(path)
        # Tall enough for accented capitals and deep descenders, not just the metrics.
        asc = max(project.metrics["ascender"], f.tt["head"].yMax)
        desc = min(project.metrics["descender"], f.tt["head"].yMin)
        cell_h = int((asc - desc) * s) + 26
        pager = Pager("{} {} - {} glyphs".format(project.family, style, len(f.tt.getGlyphOrder())))
        cells = []
        for name in f.tt.getGlyphOrder():
            adv = f.tt["hmtx"][name][0]
            w = max(int(adv * s) + 16, 64)
            cell = Image.new("RGBA", (w, cell_h), PAPER + (255,))
            d = ImageDraw.Draw(cell)
            base = int(asc * s) + 2
            ox = (w - int(adv * s)) // 2
            for y in (0, project.metrics["xheight"], project.metrics["cap"]):
                yy = base - int(y * s)
                d.line([(0, yy), (w, yy)], fill=GRID)
            d.line([(ox, 0), (ox, cell_h - 22)], fill=GRID)
            d.line([(ox + int(adv * s), 0), (ox + int(adv * s), cell_h - 22)], fill=GRID)
            pen = FreeTypePen(None)
            f.glyphset[name].draw(pen)
            try:
                mask = pen.image(width=w, height=cell_h - 22, transform=(s, 0, 0, s, ox, (cell_h - 22) - base),
                                 contain=False)
                ink = Image.new("RGBA", mask.size, INK + (255,))
                cell.paste(ink, (0, 0), mask.getchannel("A"))
            except Exception:
                pass
            d.text((2, cell_h - 18), name[:14], fill=LABEL, font=label_font(11))
            cells.append(cell)
        pager.add_row(cells, gap=4)
        paths += pager.save(os.path.join(out, "glyphs-" + _slug(style)))
    return paths


def sheet_text(project, build, dist, styles, out, text=None, **_):
    paths = []
    width = PAGE_WIDTH - 2 * MARGIN
    for style, path in styles:
        f = FontFile(path)
        pager = Pager("{} {} - text".format(project.family, style))
        samples = [text] if text else TEXT
        for px in (15, 20, 28, 40):
            pager.add_label("{} px per em".format(px), 14)
            for para in samples:
                kept, skipped = _keep_words(f, para)
                if not kept:
                    continue
                for line in _wrap(f, kept, px, width):
                    pager.add_image(f.line(line, px)[0], gap=0)
                if skipped:
                    pager.add_label("({} words skipped: glyphs not drawn yet)".format(skipped), 12)
                pager.space(int(px * 0.6))
        paths += pager.save(os.path.join(out, "text-" + _slug(style)))
    return paths


def sheet_kerning(project, build, dist, styles, out, **_):
    paths = []
    pairs = sorted(project.kerning)
    for style, path in styles:
        f = FontFile(path)
        pager = Pager("{} {} - kerning (black: kerned, gray below: unkerned)".format(project.family, style))
        for line in KERN_LINES:
            text = _available(f, line).strip()
            if len(text) < 2:
                continue
            pager.add_image(f.line(text, 64)[0], gap=0)
            pager.add_image(f.line(text, 64, features={"kern": False}, color=LABEL)[0], gap=0)
            pager.space(24)
        if pairs:
            pager.add_label("kerned pairs in kerning.json", 16, INK)
            order = set(f.tt.getGlyphOrder())
            cmap = {v: k for k, v in (f.tt.getBestCmap() or {}).items()}
            imgs = []
            for a, b in pairs:
                if a not in order or b not in order or a not in cmap or b not in cmap:
                    continue
                ctx = "H" if category(cmap[a]) == "uppercase" else "n"
                ctx2 = "H" if category(cmap[b]) == "uppercase" else "n"
                s = ctx + chr(cmap[a]) + chr(cmap[b]) + ctx2
                imgs.append(f.line(_available(f, s), 48)[0])
            pager.add_row(imgs, gap=30)
        paths += pager.save(os.path.join(out, "kerning-" + _slug(style)))
    return paths


def sheet_weights(project, build, dist, styles, out, text=None, **_):
    pager = Pager("{} - weights".format(project.family))
    line = text or "Hamburgefontsiv HOHnon 0123"
    for style, path in styles:
        f = FontFile(path)
        pager.add_label(style, 14)
        pager.add_image(f.line(_available(f, line), 72)[0], gap=4)
    from .compile import ps_safe
    tags = ",".join(a["tag"] for a in project.axes)
    vf_path = os.path.join(dist, "variable", "{}[{}].ttf".format(ps_safe(project.family), tags))
    if os.path.exists(vf_path) and project.axes:
        a = project.axes[0]
        pager.add_label("variable font, {} from {} to {}".format(a["tag"], int(a["min"]), int(a["max"])), 16, INK)
        for k in range(9):
            v = a["min"] + (a["max"] - a["min"]) * k / 8
            f = FontFile(vf_path, {a["tag"]: v})
            pager.add_label("{} {}".format(a["tag"], round(v)), 12)
            pager.add_image(f.line(_available(f, line), 56)[0], gap=2)
    return pager.save(os.path.join(out, "weights"))


def sheet_waterfall(project, build, dist, styles, out, text=None, **_):
    paths = []
    line = text or "Sphinx of black quartz, judge my vow. 0123456789"
    for style, path in styles:
        f = FontFile(path)
        pager = Pager("{} {} - waterfall".format(project.family, style))
        for px in (10, 12, 14, 16, 20, 24, 32, 48, 64, 96):
            kept = _sample(f, line)
            pager.add_label("{} px".format(px), 11)
            pager.add_image(f.line(kept, px)[0], gap=4)
        paths += pager.save(os.path.join(out, "waterfall-" + _slug(style)))
    return paths


def sheet_detail(project, build, dist, styles, out, glyphs=None, **_):
    names = glyphs or [n for n in ("n", "o", "H", "O") if n in build.glyphs]
    names = [n for n in names if n in build.glyphs]
    if not names:
        return []
    m = project.metrics
    ys = [p[1] for n in names for mg in build.glyphs[n].masters for c in mg.contours for p in flatten(*c)]
    top = max([m["ascender"], m["cap"]] + ys) + 60
    bottom = min([m["descender"]] + ys) - 60
    px = 560 / (top - bottom)
    paths = []
    pager = Pager("{} - glyph detail (red: skeleton, gray: outline points)".format(project.family))
    for name in names:
        g = build.glyphs[name]
        panels = []
        for mi, master in enumerate(project.masters):
            mg = g.masters[mi]
            xs = [p[0] for c in mg.contours for p in flatten(*c)] or [0, mg.advance]
            left = min(0.0, min(xs)) - 60
            right = max(mg.advance, max(xs)) + 60
            panel = Image.new("RGBA", (int((right - left) * px) + 1, int((top - bottom) * px) + 30), PAPER + (255,))
            d = ImageDraw.Draw(panel)

            def tx(p):
                return ((p[0] - left) * px, (top - p[1]) * px)

            for y, col in ((0, BLUE), (m["xheight"], BLUE), (m["cap"], BLUE), (m["ascender"], GRID),
                           (m["descender"], GRID)):
                d.line([tx((left, y)), tx((right, y))], fill=col)
            os_ = master.params.get("overshoot")
            if os_:
                for y in (-os_, m["xheight"] + os_, m["cap"] + os_):
                    d.line([tx((left, y)), tx((right, y))], fill=GRID)
            d.line([tx((0, top)), tx((0, bottom))], fill=GRID)
            d.line([tx((mg.advance, top)), tx((mg.advance, bottom))], fill=GRID)
            fill = outline_image(mg.contours, px, (left, bottom, right, top), fill=(150, 150, 160))
            panel.paste(fill, (0, 0), fill)
            for start, segs in mg.contours:
                pts = flatten(start, segs, 24)
                d.line([tx(p) for p in pts], fill=INK, width=1)
                cur = start
                for seg in segs:
                    if seg[0] == "curve":
                        d.line([tx(cur), tx(seg[1])], fill=(150, 150, 150))
                        d.line([tx(seg[3]), tx(seg[2])], fill=(150, 150, 150))
                        for c in (seg[1], seg[2]):
                            x, y = tx(c)
                            d.ellipse([x - 2, y - 2, x + 2, y + 2], outline=(120, 120, 120))
                    x, y = tx(seg[-1])
                    d.rectangle([x - 2, y - 2, x + 2, y + 2], fill=INK)
                    cur = seg[-1]
            for closed, segments, _w in (g.skeletons[mi] if mi < len(g.skeletons) else []):
                for p0, p1, p2, p3, kind in segments:
                    pts = [cubic_point(p0, p1, p2, p3, t / 20) for t in range(21)]
                    d.line([tx(p) for p in pts], fill=ACCENT, width=2)
                    x, y = tx(p0)
                    d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=ACCENT, width=2)
                x, y = tx(segments[-1][3])
                d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=ACCENT, width=2)
            for a, (x, y) in mg.anchors.items():
                px_, py_ = tx((x, y))
                d.line([(px_ - 6, py_), (px_ + 6, py_)], fill=BLUE, width=2)
                d.line([(px_, py_ - 6), (px_, py_ + 6)], fill=BLUE, width=2)
                d.text((px_ + 6, py_ - 14), a, fill=BLUE, font=label_font(12))
            xs_ink = [p[0] for c in mg.contours for p in flatten(*c)]
            info = "{} / {}  adv {}".format(name, master.name, round(mg.advance))
            if xs_ink:
                info += "  lsb {}  rsb {}".format(round(min(xs_ink)), round(mg.advance - max(xs_ink)))
            d.text((6, panel.size[1] - 24), info, fill=LABEL, font=label_font(14))
            panels.append(panel)
        pager.add_row(panels, gap=20)
    paths += pager.save(os.path.join(out, "detail"))
    return paths


def _slug(text):
    return "".join(c.lower() if c.isalnum() else "-" for c in text).strip("-")


SHEET_FUNCS = {
    "control": sheet_control,
    "spacing": sheet_spacing,
    "glyphs": sheet_glyphs,
    "text": sheet_text,
    "kerning": sheet_kerning,
    "weights": sheet_weights,
    "waterfall": sheet_waterfall,
    "detail": sheet_detail,
}


def make_proofs(project, build, dist, sheets, out, style_names=None, glyphs=None, text=None):
    styles = _styles(dist, project, style_names)
    written = []
    for sheet in sheets:
        written += SHEET_FUNCS[sheet](project, build, dist, styles, out, glyphs=glyphs, text=text)
    return written
