# Review checklist

Judge each proof against these questions. Each question names the sheet it is judged on. A "no" is a finding; write where it shows (sheet, style, glyph or string) and what to change.

Severities:

- **blocking**: the font is broken or contradicts the brief: a clash, a hole, a glyph that reads as another letter, a weight that does not match its name, a style that ignores the brief's decisions. The work does not move on until it is fixed.
- **should fix**: a trained eye sees it in text: an uneven color, a glyph too wide or too dark, a join that fills in, spacing that makes a hole.
- **note**: a refinement worth doing if time allows.

## 1. Brief (every sheet)

- Does the font look like the genre and voice in `brief.md`, and not like what its "Not" line excludes?
- Does every decision in the brief's table show in the glyphs: the x-height, the contrast and its stress, the width, the aperture, the terminals?
- Is every terminal of the same kind, and every join treated the same way, across the whole set?
- Does no glyph copy a known typeface's distinctive shape?

## 2. Control glyphs (control, detail)

- Do n and o look the same height, and the same width? (o must be measurably larger to look so.)
- Do H and O look the same height and width, the same way?
- Is the arch of n smooth where it leaves the stem, with the join thinned and no dark spot?
- Is the thickest part of o's bowl heavier than n's stem, and its top and bottom thinner, as the contrast asks?
- Does o look round and full, without flat sides, pinched diagonals or a point at its extremes?
- On the detail sheet: does each skeleton have nodes at its extremes, no kinks, and no handle or node outside the outline where none belongs?
- Is every master correct, not only the default? Light and Bold are judged on their own terms.

## 3. Shapes (glyphs, detail)

- Does each glyph read as itself at a glance, even out of context? Check the pairs most often confused: a/o, c/e, n/h, i/l, I/l/1, O/0, rn/m, S/5, B/8.
- Are the widths in proportion: m about 1.6 n, o a little wider than n, the narrow letters (r f t) and the wide ones (m w M W) in their ranges?
- Are bars and crossbars thinner than stems, and above the geometric middle (H, e, A, B)?
- Are the top halves of two-storey shapes (B, S, 8, 3, a, g, s) a little smaller than the bottom halves?
- Do round and pointed shapes overshoot all metric lines, and do flat ones sit exactly on them?
- Do diagonals look as heavy as stems, and do the joins of v, w, x, A, V, W, M, N, k, K stay open?
- Are the counters of a, e, s, g open enough in the boldest master?
- Are dots round or matched to the terminals, larger than the stem, and placed at one height across i, j and punctuation?
- Do figures share one width, match the capitals' height and weight, and read clearly as figures?

## 4. Accents (glyphs, detail with accented glyphs)

- Does every accent sit centered on its letter's optical center, at the same distance above every base, in every master?
- Does no accent touch or nearly touch its base in the boldest master?
- Are the capital accents flatter and lower, and do accented capitals stay under the line height?
- Are i and j dotless under accents?

## 5. Spacing (spacing, text)

- In `nnnn`, `oooo`, `nnoonn`, `HHOHHO`, does the white look even, with no letter crowding or drifting from its neighbors?
- On the spacing sheet, does each glyph sit evenly between its controls, with the same apparent white on both sides?
- In running text, is the color even: no glyph darker or lighter than the rest, no word that falls apart, no pair that clumps?
- Is the overall spacing right for the use: looser for text, tighter for display?

## 6. Kerning (kerning, text)

- In each kerned pair on the kerning sheet, does the black (kerned) line look evenly spaced, and better than the gray (unkerned) line below it?
- Is any pair over-kerned: shapes that touch, nest too deep, or look tighter than the text around them? Check hyphen, quotes and period next to open shapes (L, T, F, c, r) especially.
- Are the strings with obvious holes kerned: AV, To, LT, T., V., Ty, P,, "A?
- Do no accented glyphs collide with their kerned neighbors (Tö, Ŷ, "Á)?
- Are tabular figures unkerned?

## 7. Weights (weights, waterfall)

- Does each style match its name, and do the steps between styles look even?
- In the variable font steps, does every glyph change smoothly, with no shape that jumps, flips or wobbles between steps?
- Does the boldest style keep its counters open and its joins clean, and the lightest keep its shapes firm?
- Is the font readable at 10 to 16 pixels per em on the waterfall, and pleasant at display size?

## 8. Release (the final review only)

- Does `dfont check` report no errors, and is every warning fixed or explained in the report?
- Does `dfont status` show the whole charset as drawn or built, with nothing missing?
- Do the files in `dist/` include every style in OTF, TTF and WOFF2, and the variable font, and does the specimen open?
