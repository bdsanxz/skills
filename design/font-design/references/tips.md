# Tips

Mistakes that were made while drawing fonts with these tools, and how to avoid them. Each tip names the phase it belongs to. Read the tips of a phase before you start it.

## Drawing (every phase that draws)

- **A curve that leaves a node with no direction makes a spur.** It falls back to the straight line to the next node, which leaves a kink or a little point where the stroke starts. Give `dir` to every node a curve leaves, the first node included, and to the start of a curve after a `.line()`.
- **`edge` must lie across the stroke.** On an upright stem, `edge="left"` or `"right"`; on a bar, `"top"` or `"bottom"`. An edge along the stroke is a build error, and an edge on the wrong side moves the ink by a whole stroke width.
- **Write every size from the parameters.** A number written in units (`base + 70`, a tail of 120) is right for one master and wrong for the others: an accent offset that clears the base in Light touches it in Bold, a terminal that is open in Regular folds in Bold. Write gaps and lengths as `p.stem * k`, `p.xheight * k`, or a parameter of their own.
- **Tight curves fold in the boldest master.** A terminal curl, the tail of a, the spine of s and the bottom of j are tight enough in Regular and fold in Bold, where the stroke is wider than the curve. When the build reports a fold, open the curve, move its last node further from the curve, or thin the stroke there with `w=`.
- **A bowl joining a stem pokes out when it is thicker than the stem.** In b, d, p, q, a and g, the thick side of the bowl meets the stem from inside; if it is heavier than the stem, its outer edge passes the stem's edge and makes a bump. Thin the bowl where it joins the stem (`w=0.7` to `0.85` at the join), so its outer edge stays inside the stem.
- **Round caps on slanted strokes make extremes between nodes.** `dfont check` reports them as information. They are harmless; leave them unless the proof shows a bump.
- **A sharp miter corner sticks out.** The bottom of v, the apex of A and the vertexes of w and M stick out far past the node with `join="miter"`. Use `join="flat"`, or cut the apex as a design decision.
- **Refs do not copy anchors.** A glyph made with `g.ref()` (u from n, b from d) needs its own `g.anchor("top", ...)`, or every accented form of it fails to build.
- **Never branch on a parameter.** A different structure in one master is a build error. Make a feature tiny in one master instead of leaving it out.

## Control glyphs

- **Look at every master, not only the default.** Most shape faults (folds, filled joins, closed counters) show first in the boldest master. Proof the detail sheet for all of them each round.
- **Measure before you judge widths.** `dfont measure --glyph n --y <half x-height>` and the same for o give the numbers; the eye decides only after both look the same.

## Spacing

- **Space the controls by eye first.** `dfont space` spreads the controls' spacing to the other glyphs. If the controls are wrong, every suggestion is wrong in the same way.
- **The suggestions are a starting point.** Apply them, then judge the spacing sheet. Open shapes (c, r, L, T) are often suggested too tight or too loose: raise `--depth` to count more of an open shape's white, lower it to count less, and let the proof decide.

## Kerning

- **Suggestions over-kern punctuation into open shapes.** Hyphen, en dash and quotes next to L, T, F, c, r and the like get suggestions of -80 or more, because the pocket looks empty to the measure. A hyphen after L needs little or no kern; quotes after L need some. Take these suggestions only after checking each on the kerning sheet, and halve or drop most.
- **Always judge kerning on the kerning sheet.** Read each pair: kerned (black) above, unkerned (gray) below. A pair that looks tighter than the text around it is over-kerned.
- **Check the accented members of every kerned class.** `T o` also kerns `T odieresis`, whose dots may touch T's bar. `dfont kern` lists such collisions with a value that keeps them apart; add the pair as an exception.

## Weights

- **Do not let instances be the arithmetic mean.** A Medium halfway between Regular and Bold in the axis value can look too bold. Move the instance's location on the axis, not the masters, until the steps look even on the weights sheet.
