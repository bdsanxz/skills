# Drawing glyphs

How a font project is laid out and how glyphs are drawn in it. Every rule here is enforced by `dfont build`, which names the file and line of each mistake.

## The project

```text
<project>/
  font.json        family, metrics, axes, masters and their parameters, styles, charset
  glyphs/*.py      glyph functions, any number of files, grouped as you like
  lib.py           shared drawing helpers, imported by glyph files with `from lib import ...`
  kerning.json     kerning pairs
```

`dfont build` writes `dist/`, `dfont proof` writes `proof/`, `dfont check` writes `qa/`. Never edit those by hand.

### font.json

```json
{
  "family": "Example Sans",
  "version": "1.000",
  "designer": "", "copyright": "", "license": null, "license_url": null, "vendor": "NONE",
  "charset": ["latin-core"],
  "metrics": {"upm": 1000, "ascender": 760, "descender": -240, "xheight": 520, "cap": 700, "line_gap": null},
  "axes": [{"tag": "wght", "name": "Weight", "min": 300, "default": 400, "max": 700}],
  "shared": {"overshoot": 12},
  "masters": [
    {"name": "Light", "location": {"wght": 300}, "params": {"stem": 60}},
    {"name": "Regular", "location": {"wght": 400}, "params": {"stem": 88}},
    {"name": "Bold", "location": {"wght": 700}, "params": {"stem": 151}}
  ],
  "instances": [
    {"name": "Light", "location": {"wght": 300}},
    {"name": "Regular", "location": {"wght": 400}},
    {"name": "Medium", "location": {"wght": 500}},
    {"name": "Bold", "location": {"wght": 700}}
  ]
}
```

- **Masters** are the designs you draw: each glyph function runs once per master with that master's parameters. One master must sit at each axis default.
- **Instances** are the styles that ship as static fonts. An instance between two masters is interpolated; it needs no drawing of its own. The variable font covers the whole axis.
- **Parameters** are the numbers glyphs are drawn from. A glyph reads `p.<name>`. The value comes from the master's `params`, else from `shared`, else from `metrics` (`p.xheight`, `p.cap`, `p.ascender`, `p.descender`, `p.upm` are always there). A parameter used by a glyph must exist for every master. Add any parameter you need; keep names short and meaningful (`tail_len`, `ink_trap`).
- `line_gap: null` gives a line height of 1.2 em.

The parameters `dfont new` writes, per master:

| Parameter | Meaning |
| --- | --- |
| `stem`, `stem_cap` | vertical stem of lowercase and of capitals |
| `bar`, `bar_cap` | horizontal strokes (crossbars, the thin part of bowls) |
| `round_gain` | how much heavier a round stroke is than a straight stem (about 1.03 to 1.08) |
| `n_width`, `o_width`, `H_width`, `O_width` | outer width of the ink of n, o, H, O |
| `arch_join`, `arch_drop` | where the arch of n leaves the stem, measured down from the x-height, and where it reaches the right stem |
| `sb_straight`, `sb_round` | lowercase sidebearings next to a straight and a round side |
| `sb_cap_straight`, `sb_cap_round` | the same for capitals |
| `space` | width of the space |
| `overshoot` (shared) | how far round shapes pass the baseline, x-height and cap height |
| `sb_accent` (optional) | sidebearings of the spacing accents made from marks (default 6% of the UPM) |

### Glyph names and the charset

Glyph names follow the Adobe Glyph List: `a`, `A`, `zero`, `period`, `quotedblleft`, `Aacute`, `uni00B2`. `dfont status <project>` lists every glyph the charset needs, by group, and which are still missing. A glyph that is drawn but not in the charset is still exported. A name starting with `_` is a helper: other glyphs can use it with `g.ref()`, but it is never exported.

## Glyph functions

```python
from dfont import glyph, path
from lib import arch

@glyph("n")
def n(g, p):
    g.stroke(path((0, 0), edge="left").line((0, p.xheight), edge="left"), p.stem)
    arch(g, p, 0, p.n_width, p.xheight)
    g.anchor("top", p.n_width / 2, p.xheight)
    g.space(p.sb_straight, p.sb_straight * 0.9)
```

- `@glyph(name)` registers the function. The code point comes from the charset or the name. Pass `unicode=0x00B5` to set it, a list for several, or `unicode=False` for an unencoded glyph such as `acutecomb.case`.
- The function draws in font units, with y up and the baseline at 0. Draw the ink from x = 0. The spacing call at the end moves it so its sidebearings come out as asked.
- **One structure for every master.** Each master must draw the same strokes and shapes, with the same nodes, in the same order, the same anchors and the same kind of spacing. Only the numbers may change. Never write `if p.stem > 100:`. A difference between masters is a build error that names the first element that differs. To make a feature vanish in one master, make it tiny (a width factor, a length) instead of leaving it out.
- Every glyph ends with `g.space(...)` or `g.fixed(...)`. Marks may leave spacing out.
- Put any shape used by more than one glyph in `lib.py` as a function: a stem, an arch, a bowl, a terminal, a diagonal, a serif. A change to it then reaches every glyph that uses it, which keeps the family consistent.

## Paths

A path is a chain of nodes: the centerline of a stroke (its skeleton), or the outline of a filled shape.

```python
path(pt, dir=None, w=1.0, edge=None)                    start at pt
  .line(pt, w=1.0, edge=None)                             straight segment
  .curve(pt, dir=None, w=1.0, edge=None, tension=1.0, out=None)   smooth curve
  .cubic(c1, c2, pt, w=1.0, edge=None)                    Bézier with explicit handles
  .close(curve=False, tension=1.0, out=None)              back to the first node
```

- `dir` is the tangent at the node: `"up"`, `"down"`, `"left"`, `"right"`, an angle in degrees (0 points right, 90 up), or a vector `(dx, dy)`.
- `.curve()` draws a Hobby curve: it leaves the previous node in that node's `dir` (or in `out`, when given) and arrives at `pt` heading in its `dir`. The curve's roundness comes out right by itself. `tension` above 1 (1.1 to 1.3) pulls the curve tighter and rounder at its middle; below 1 (0.8 to 0.95) makes it fuller and squarer.
- A curve that leaves a node with no direction falls back to the straight line to the next node, which makes a kink. Give a direction to every node that a curve leaves, including the first.
- Put a node at every horizontal and vertical extreme of a curve (the top, bottom, left and right of a bowl), with a direction of `up`, `down`, `left` or `right` there. `dfont check` reports curves with an extreme between nodes.
- `.close(curve=True)` closes with a curve, for rings such as o and O. When the last node is the first node again, that segment closes the path.

### Node options for strokes

- `edge="left" | "right" | "top" | "bottom"`: the point given is the stroke's edge on that side, and the skeleton runs half a stroke inside it. Use it to put ink exactly on a metric line or a measured x: `edge="bottom"` at y = 0 puts the bottom of a bar on the baseline; `edge="top"` at the x-height plus overshoot puts the top of a bowl on the overshoot line. The edge must lie across the stroke: a vertical stroke has left and right edges, not top and bottom.
- `w=0.6`: the stroke is that fraction of its width at this node, and the width changes smoothly towards the next node. Use it to thin a stroke where it joins another (the start of an arch inside a stem, the joins of a bowl to a stem), to taper a tail, or to hide a stroke's end inside another stroke.

## Strokes

```python
g.stroke(path, width, thin=None, angle=0, cap="butt", start=None, end=None, join="miter")
```

- `width` is the pen width. `thin` is the width where the path runs in the thin direction; leave it out for a monoline stroke.
- `angle` is the thin direction in degrees. With 0, horizontal parts are `thin` and vertical parts are `width`, the contrast of most sans serifs and of the scaffold's bowls. For a broad-nib contrast, use the pen angle, as in `angle=30`. In between, the width follows the direction smoothly.
- `cap` sets both ends, `start` and `end` one end each: `"butt"` (cut square to the stroke), `"round"`, `"square"` (extends half a width past the end), or a number, the angle in degrees of a straight cut: `0` cuts the end level (the terminals of c and s in many sans serifs, the tops of V), `90` cuts it upright.
- `join` is how the stroke turns at a corner between two segments: `"miter"` (a sharp corner) or `"flat"` (cut off, the bottom of v). A miter on a very sharp corner sticks out far past the node; the build warns about it, and `join="flat"` or a wider angle fixes it.
- A stroke whose curve is tighter than half its width folds over itself. The build reports it as an error, by segment and master: open the curve, move its nodes apart, or thin the stroke there with `w=`.
- A curve whose outline cannot follow the true offset within 1.5 units is reported as a warning: add a node in the middle of that curve.
- Strokes overlap freely: overlaps are merged in the static fonts. A stroke's end hidden inside another stroke is the normal way to join them.

## Filled shapes

```python
g.shape(path.close(), hole=False)          a closed outline, filled as drawn
g.rect(x0, y0, x1, y1, hole=False)
g.ellipse(cx, cy, rx, ry=None, hole=False, square=0.5523)
g.dot(cx, cy, diameter, square=0.5523)
```

Use shapes for what is not a stroke: dots, a triangular serif, an ink trap cut out with `hole=True`. `square` above 0.5523 makes an ellipse squarer (0.6 to 0.7 for a squarish dot). `edge` does not apply to shapes.

## Building on other glyphs

- `g.ref(name, dx=0, dy=0, scale=1.0, sx=None, sy=None, weight=1.0)` draws another glyph's strokes and shapes into this one, scaled by `scale` (or `sx`, `sy`; negative mirrors) and moved by `(dx, dy)`, before spacing. Stroke widths are multiplied by `weight`, not by the scale: a small figure for a superscript keeps a heavy enough stroke unless you lower it. Examples: `u` as `n` turned half a circle (`sx=-1, sy=-1, dx=p.n_width, dy=p.xheight`), `b` as a mirrored `d`, `A` as a flipped `V` plus a bar, `uni00B2` as `two` at `scale=0.6, weight=0.75`. Anchors are not copied: give the new glyph its own.
- `g.component(name, dx=0, dy=0)` places another glyph's finished, spaced outline. Use it for glyphs made of whole glyphs, such as `ellipsis` from three periods.

## Marks and accented glyphs

Accented glyphs are built automatically from their Unicode decomposition: `oacute` is `o` plus `acutecomb`, `Ccedilla` is `C` plus `cedillacomb`. You draw the base letters and the combining marks, and set anchors:

- On a base letter, `g.anchor("top", x, y)` where a mark above attaches (usually the optical center of the letter at the x-height or cap height) and `g.anchor("bottom", x, y)` for marks below (cedilla, ogonek).
- On a mark, `g.anchor("_top", x, y)` is the point that lands on the base's `top`. Give a mark above also a `top` anchor of its own, at its top, so a second mark can stack on it.
- Draw a `.case` version of each mark above (`acutecomb.case`), lower and flatter, for capitals; capitals use it when it exists.
- Before a mark above, `i` and `j` are replaced by `dotlessi` and `dotlessj`, so draw those.
- The spacing accents (`acute`, `dieresis`, `grave`, ...) are made from their combining marks, with `sb_accent` sidebearings.
- `nbspace` copies `space`, `softhyphen` copies `hyphen`.

A glyph you draw yourself always wins over the automatic one: draw `Aogonek` or `Lslash` yourself where the automatic placement is not good enough.

## Spacing

- `g.space(left, right)` sets the sidebearings: the white left of the leftmost ink and right of the rightmost ink. Use the scaffold's parameters (`p.sb_straight` next to a straight stem, `p.sb_round` next to a round side), scaled where a side is neither: `p.sb_straight * 0.9` for the shoulder of n.
- `g.fixed(width, align="center")` sets the advance width instead, with the ink centered, at the left (`"left"`), or kept where it was drawn (`"keep"`). Use it for tabular figures, the space, and anything that must line up in columns.

## Kerning

`kerning.json` holds pairs of glyph names:

```json
{"pairs": {"T o": -60, "A V": {"Light": -70, "Regular": -75, "Bold": -80}}}
```

A value is one number for every master, or one per master name. A pair kerns by class: `T o` also kerns `T oacute` and `T odieresis`, every glyph built on the two bases. To give an accented glyph its own value, add a pair that names it, such as `"T odieresis": -30`; it wins over its class.

## Reading build errors

Every problem names its glyph and the file and line that caused it, as `[glyphs/lowercase.py:42]`.

| Message says | Do |
| --- | --- |
| the masters differ | make the structure the same in every master; never branch on a value |
| parameter 'x' is not defined for master 'Bold' | add it to that master's params or to `shared` |
| folds over itself | open the curve, move its nodes apart, or thin it with `w=` |
| node has edge=... but the stroke runs towards that side | use the edge across the stroke (left/right for an upright stroke) |
| no spacing | end the glyph with `g.space()` or `g.fixed()` |
| base has no anchor 'top' for mark | add `g.anchor("top", x, y)` to the base |
| mark has no attaching anchor | add `g.anchor("_top", x, y)` or `"_bottom"` to the mark |
| deviates from the true offset | add a node in the middle of that curve |
| a miter corner sticks out | use `join="flat"` or open the angle |
| failed to load | a Python error in that file; the message has its line |

A glyph that fails is left out, and the rest of the font still builds.
