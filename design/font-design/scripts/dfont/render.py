"""Rendering: shaped text from built font files, and outlines straight from a build."""
import math

import uharfbuzz as hb
from fontTools.pens.freetypePen import FreeTypePen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

INK = (20, 20, 20)
PAPER = (255, 255, 255)
GRID = (205, 210, 220)
LABEL = (110, 110, 120)
ACCENT = (210, 40, 40)
BLUE = (40, 90, 210)


def label_font(size=16):
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


class FontFile:
    """A built font file, shaped with HarfBuzz and drawn with FreeType."""

    def __init__(self, path, location=None):
        self.path = path
        self.tt = TTFont(path)
        self.upm = self.tt["head"].unitsPerEm
        self.location = location or {}
        self.glyphset = self.tt.getGlyphSet(location=self.location) if self.location else self.tt.getGlyphSet()
        blob = hb.Blob.from_file_path(path)
        face = hb.Face(blob)
        self.hb = hb.Font(face)
        if self.location:
            self.hb.set_variations(self.location)
        # Lines are as tall as the tallest glyph, so accents above capitals are never cut off.
        hhea, head = self.tt["hhea"], self.tt["head"]
        self.ascender = max(hhea.ascent, head.yMax)
        self.descender = min(hhea.descent, head.yMin)

    def shape(self, text, features=None):
        if not text:
            return []
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, features or {})
        order = self.tt.getGlyphOrder()
        out = []
        for info, pos in zip(buf.glyph_infos or [], buf.glyph_positions or []):
            out.append((order[info.codepoint], pos.x_advance, pos.x_offset, pos.y_offset))
        return out

    def line(self, text, px, features=None, color=INK):
        """An RGBA image of one line of text, `px` pixels per em; baseline at ascender."""
        glyphs = self.shape(text, features)
        width_units = sum(g[1] for g in glyphs)
        scale = px / self.upm
        pad = int(math.ceil(px * 0.1))
        w = max(1, int(math.ceil(width_units * scale)) + 2 * pad)
        top = self.ascender
        bottom = self.descender
        h = max(1, int(math.ceil((top - bottom) * scale)) + 2)
        pen = FreeTypePen(None)
        x = 0
        drew = False
        for name, adv, xo, yo in glyphs:
            glyph = self.glyphset[name]
            glyph.draw(TransformPen(pen, (1, 0, 0, 1, x + xo, yo)))
            x += adv
            drew = True
        img = Image.new("RGBA", (w, h), color + (0,))
        if drew:
            try:
                mask = pen.image(width=w, height=h,
                                 transform=(scale, 0, 0, scale, pad, -bottom * scale + 1), contain=False)
                alpha = mask.getchannel("A") if "A" in mask.mode else mask.convert("L")
                img.putalpha(alpha)
            except Exception:
                pass
        return img, {"baseline": int(round(top * scale)) + 1, "pad": pad, "scale": scale}


def outline_image(contours, px_per_unit, box, fill=INK):
    """Fill contours (font units, y up) into an RGBA image covering box (x0, y0, x1, y1) in font units."""
    x0, y0, x1, y1 = box
    w = max(1, int(math.ceil((x1 - x0) * px_per_unit)))
    h = max(1, int(math.ceil((y1 - y0) * px_per_unit)))
    img = Image.new("RGBA", (w, h), fill + (0,))
    if not contours:
        return img
    from .compile import draw_contours
    pen = FreeTypePen(None)
    draw_contours(pen, contours)
    try:
        mask = pen.image(width=w, height=h, transform=(px_per_unit, 0, 0, px_per_unit, -x0 * px_per_unit,
                                                       -y0 * px_per_unit), contain=False)
        alpha = mask.getchannel("A") if "A" in mask.mode else mask.convert("L")
        img.putalpha(alpha)
    except Exception:
        pass
    return img


class Sheet:
    """A white page that grows downwards as lines are added."""

    def __init__(self, width=1800, margin=40):
        self.width = width
        self.margin = margin
        self.items = []
        self.height = margin

    def text(self, s, size=16, color=LABEL, gap=6):
        font = label_font(size)
        self.items.append(("label", self.height, s, font, color))
        self.height += size + gap
        return self

    def image(self, img, gap=10, x=None):
        self.items.append(("image", self.height, img, x))
        self.height += img.size[1] + gap
        return self

    def space(self, h):
        self.height += h
        return self

    def render(self):
        page = Image.new("RGB", (self.width, self.height + self.margin), PAPER)
        draw = ImageDraw.Draw(page)
        for item in self.items:
            if item[0] == "label":
                _, y, s, font, color = item
                draw.text((self.margin, y), s, fill=color, font=font)
            else:
                _, y, img, x = item
                page.paste(img, (self.margin if x is None else x, y), img if img.mode == "RGBA" else None)
        return page
