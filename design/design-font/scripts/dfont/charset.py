"""Character sets, glyph names, and the glyphs the builder can make by itself."""
import unicodedata

from fontTools import agl

COMBINING = {
    0x0300: "gravecomb",
    0x0301: "acutecomb",
    0x0302: "circumflexcomb",
    0x0303: "tildecomb",
    0x0304: "macroncomb",
    0x0306: "brevecomb",
    0x0307: "dotaccentcomb",
    0x0308: "dieresiscomb",
    0x030A: "ringcomb",
    0x030B: "hungarumlautcomb",
    0x030C: "caroncomb",
    0x0327: "cedillacomb",
    0x0328: "ogonekcomb",
}

NAME_OVERRIDES = {
    0x00A0: "nbspace",
    0x00AD: "softhyphen",
    0x00B5: "mu",
    0x2212: "minus",
}
NAME_OVERRIDES.update(COMBINING)

# Spacing accents made from a combining mark.
SPACING_ACCENTS = {
    "grave": "gravecomb",
    "acute": "acutecomb",
    "circumflex": "circumflexcomb",
    "tilde": "tildecomb",
    "macron": "macroncomb",
    "breve": "brevecomb",
    "dotaccent": "dotaccentcomb",
    "dieresis": "dieresiscomb",
    "ring": "ringcomb",
    "hungarumlaut": "hungarumlautcomb",
    "caron": "caroncomb",
    "cedilla": "cedillacomb",
    "ogonek": "ogonekcomb",
}

# Glyphs that are copies of another glyph under a second code point.
ALIASES = {
    "nbspace": "space",
    "softhyphen": "hyphen",
}

_CP1252_EXTRA = [
    0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152,
    0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
    0x0153, 0x017E, 0x0178,
]

CHARSETS = {
    "basic-latin": list(range(0x20, 0x7F)),
    "latin-core": (
        list(range(0x20, 0x7F))
        + list(range(0xA0, 0x100))
        + _CP1252_EXTRA
        + [0x0131, 0x02C7, 0x02D8, 0x02D9, 0x02DA, 0x02DB, 0x02DD, 0x2212]
        + [0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0306, 0x0307, 0x0308, 0x030A, 0x030B, 0x030C, 0x0327, 0x0328]
    ),
}

CHARSET_HELP = {
    "basic-latin": "U+0020-007E: ASCII letters, figures, punctuation and symbols (95 glyphs)",
    "latin-core": "Basic Latin, Latin-1 Supplement, the Windows-1252 extras, dotless i, the spacing and "
                  "combining accents they use (about 240 glyphs)",
}


def glyph_name(cp):
    if cp in NAME_OVERRIDES:
        return NAME_OVERRIDES[cp]
    name = agl.UV2AGL.get(cp)
    if name:
        return name
    return "uni{:04X}".format(cp) if cp <= 0xFFFF else "u{:05X}".format(cp)


def name_to_unicode(name):
    for cp, n in NAME_OVERRIDES.items():
        if n == name:
            return cp
    if "." in name or name.startswith("_"):
        return None
    text = agl.toUnicode(name)
    if len(text) == 1:
        return ord(text)
    return None


def charset_codepoints(spec):
    """Code points of a charset name, a list of names/code points, or a mix."""
    if isinstance(spec, str):
        spec = [spec]
    out = []
    for item in spec:
        if isinstance(item, int):
            out.append(item)
        elif item in CHARSETS:
            out.extend(CHARSETS[item])
        elif isinstance(item, str) and item.upper().startswith("U+"):
            if "-" in item:
                a, b = item[2:].split("-")
                out.extend(range(int(a, 16), int(b.replace("U+", "").replace("u+", ""), 16) + 1))
            else:
                out.append(int(item[2:], 16))
        else:
            raise ValueError("unknown charset entry {!r}; use {}, a code point like U+00E9 or a range "
                             "U+0100-017F".format(item, ", ".join(sorted(CHARSETS))))
    seen = set()
    result = []
    for cp in out:
        if cp not in seen:
            seen.add(cp)
            result.append(cp)
    return result


def decomposition(cp):
    """Canonical decomposition into (base code point, [mark code points]), or None."""
    dec = unicodedata.decomposition(chr(cp))
    if not dec or dec.startswith("<"):
        return None
    parts = [int(x, 16) for x in dec.split()]
    base, marks = parts[0], parts[1:]
    inner = decomposition(base)
    if inner:
        base, marks = inner[0], inner[1] + marks
    if not marks or any(unicodedata.category(chr(m)) != "Mn" for m in marks):
        return None
    return base, marks


def is_upper(cp):
    return cp is not None and unicodedata.category(chr(cp)) == "Lu"


def is_mark_name(name):
    base = name.split(".")[0]
    return base.endswith("comb")


def category(cp):
    """A coarse group for proofs and reports."""
    if cp is None:
        return "other"
    c = unicodedata.category(chr(cp))
    if c == "Lu":
        return "uppercase"
    if c in ("Ll", "Lo") or cp == 0x00B5:
        return "lowercase"
    if c == "Nd":
        return "figures"
    if c == "Mn" or cp in (0x0060, 0x00A8, 0x00AF, 0x00B4, 0x00B8, 0x02C6, 0x02C7, 0x02D8, 0x02D9, 0x02DA,
                           0x02DB, 0x02DC, 0x02DD):
        return "accents"
    if c.startswith("P"):
        return "punctuation"
    if c == "Zs":
        return "spaces"
    return "symbols"
