# Reading a result and choosing the fix

One round is one `pp check`:

```
pp check --run <name> --url <url> --viewport <w>,<h> --scale <design scale> @<file listing the round's items>
```

It prints the round's `iteration` number and one row per item: `pass`, `content`, `worst_tile`, `naive`, `dw`, `dh`, and a `note` naming the first thing to look at. Each item's files are in the run directory under `<kind>s/<item>/iter-NN/<variant>/`: `render.png`, `capture.toon`, the full `diff.toon`, `overview.png` (the whole item shrunk to one map: grey matches, orange differs a little, red a lot), and a zoomed `cluster-N.png` for each of the largest problem areas. `pp scores --run <name> --item <item>/<variant>` prints the item's latest result cut down to what picks the next fix. It exits 0 when everything passed and 1 when something failed.

`pp diff <reference.png> <render.png> --out-dir <dir> --scale <design scale>` scores one pair of existing images the same way. Add `--brief` to print only what picks the next fix.

## How the score is built

- A pixel matches when its largest red, green or blue difference is at most the tolerance (8).
- The images are compared anchored at the top left. Nothing is resized or realigned. Any area that only one image covers counts as mismatched.
- `score.content` is the headline: matching pixels among content pixels only. A content pixel differs from the background color in the design or in the render, or is mismatched. Empty background earns nothing.
- `score.worst_tile` is the lowest score among the grid tiles (64 CSS pixels square). Tiles with almost no content are scored on all their pixels.
- `score.naive` counts every pixel equally. It is for reference only and never decides a pass.
- `pass` is true only when all three gates hold: `size_match`, `content` (at least 99) and `tiles` (every tile at least 95).
- `thresholds.overridden` lists any threshold that is not the default. It must be empty unless the user set that value.
- `pixels.allowed` is how many mismatched pixels a pass leaves room for. `ink` counts the design's thin strokes on plain backdrops (text, glyphs, rules) and how many of them are mismatched. Both are diagnostics; neither changes the score.

## Fix in this order

1. **`check` says `valid: false`.** Nothing was scored. A failed request means the server dropped it or the file is missing; a failed font means text would render in a fallback. Fix that and run the round again.
2. **`dw` or `dh` is not 0.** The render and the reference differ in size. Fix the element's or page's overall size first: a wrong height usually comes from line height, padding, a gap, or a missing or extra element. Nothing else is worth reading until the sizes match.
3. **Positions and sizes: `pp compare`.** Name the items; it finds each one's reference and latest render itself:

   ```
   pp compare --run <name> --item <item>/<variant> [--item ...] [--region <x,y,w,h> ...] [--axis y] --min-gap <n> --scale <design scale>
   ```

   - With no `--region` the whole item is one band. Give a `--region` for each row or column of a larger item; several regions and several items can go in one call when they share `--axis`, `--min-gap` and `--bg`.
   - `pairs` lists each thing found in the reference with `dx`, `dy`, `dw`, `dh`: how far the render's is from it, render minus reference, in CSS pixels. Each number is the correction to a single value. `dx` on every item after one point means one gap or padding before that point; `dw` on a text item means font size, weight or family; `dh` on a text line means font size or line height.
   - `only_in_reference` is something the render lacks (a divider, an icon); `only_in_render` is something extra.
   - `color_differences` lists pairs whose colors differ; `colors_match: true` means none do.
   - `patch_offset_px` appears when the region as a whole matches better at an offset. A raster image one pixel off shows here even when its box edges agree.
   - Raise `--min-gap` until each word group or icon is one item; pass `--bg` when the band's background is not its border color, as inside a card. On a gradient backdrop also raise `--tolerance` until the band splits into its items.
   - Each side of a box is placed where that edge passes half of its contrast, so a soft reference and a sharp render measure alike. What `compare` measures is boxes, though, not letters: two fonts can fill the same box. When it reports `aligned: true` and the score is still low on text, look at `--pair` before deciding anything.
   - Add `--pair <out.png>` to save every compared region of both images on one sheet when you need to see them.
   - `pp compare <ref.png> <render.png>` compares any two image files the same way.

   Fix every delta that pins one value, in one pass, then run the next round. Change one thing at a time only when the cause is a guess.
4. **`shifts` in `diff.toon`.** `vertical` rows say the render's content between `from_row` and `to_row` sits `dy` pixels lower than the design (negative means higher); `horizontal` is the same for columns with `dx`. Everything from one row down being off by the same amount means one spacing value just above that row is wrong by exactly that much.
5. **Where it differs: `overview.png`.** Read it once per failed round. Mismatch that outlines every letter is text; a solid block is a wrong color, a missing element or a misplaced image; a faint outline of a whole photo is an image being resampled (see `images_not_1to1` in the `check` output).
6. **Clusters, largest first.** Each cluster has a box, a pixel count, a `kind`, and the offset that best explains it: `shift_dx`, `shift_dy` and `left_pct`, the share of the cluster's mismatch that remains once that offset is undone.
   - `left_pct` near 0 with a non-zero shift: the thing is right but misplaced. Move it by minus the shift.
   - `kind: color`: both images are flat there. Replace `render_hex` with `design_hex`: a background, a border or a text color.
   - `kind: shape` with `left_pct` high: position is not the problem. Open that cluster's `cluster-N.png`, run the matching probe on the reference and on the render with the cluster's box as region, and change the property whose numbers differ: `radius`, `border`, `shadow`, `gradient`, `text`.
   - `kind: outside`: the area exists in only one image; this is the size mismatch from step 2.
7. **Only the tile gate fails.** `tiles.worst` lists the failing tiles. A small, dense element is wrong there even though the overall score is high: usually an icon, a short label or a thin border.

## Values no probe can read: `pp fit`

A shadow's blur, spread and alpha, an icon's stroke width or the geometry of a small glyph cannot be read off the design directly. Do not step them by hand, round after round.

1. Make a temporary fit page that shows only that element, with each unknown taken from a CSS custom property: `box-shadow: 0 var(--sy) var(--blur) rgba(0, 0, 0, var(--alpha))`. A font's weight and size can be fitted the same way (`font-weight: var(--weight)` with `--var weight=400:100`), once the family is settled by eye.
2. Run:

   ```
   pp fit --url <fit page url> --viewport <w>,<h> --scale <design scale> --selector <wrapper> \
     --reference <ref.png> [--region <x,y,w,h>] --var sy=2:0.5:px --var blur=8:1:px --var alpha=0.15:0.01
   ```

   Each `--var` is `name=start:step[:unit]`. Start from the probe's reading (`shadow`, `edges`, `radius`): the search refines a measured value, it does not find one from nothing. The wrapper's box must equal the reference region.
3. Read `vars`: copy each fitted `value` into the component, and record it in the spec as measured by `fit`. `at_limit: true` means the search ran out of room; start closer and run again. `mismatched_pixels.best` is how many pixels of the element still differ.
4. Remove the fit page and run the component's round with `pp check`. Only that produces a score.

## Typical causes

| What the heatmap shows | Likely cause |
| --- | --- |
| A thin outline around a box, uniform on all sides | Size off by 1 px, or the border width or color |
| A thin outline on only two adjacent sides | Position off by 1 px |
| Crescents at the corners | Corner radius |
| A soft halo around a box | Shadow blur, spread, offset or alpha |
| Every glyph outlined, text the same width | Font weight, or the design's own rasterization; see the ceiling below |
| Text increasingly off toward the end of a line | Font family, size or letter spacing |
| Text lines increasingly off down a paragraph | Line height |
| A whole flat area tinted | Color, or an opacity applied to it |
| A smooth band across a fill | Gradient stops or angle |
| Everything below one point shifted | One spacing value above that point |
| A photo faintly outlined all over | The image is one pixel off, or resampled: check `patch_offset_px` in `compare` and that its CSS size is its pixel size divided by the scale |

## When it is the ceiling, not the code

Some differences cannot be fixed in code: the design's text was rasterized differently, or the image was rescaled. Recognise that early instead of spending the iteration budget on it. It is the ceiling when all of these hold:

- `pp compare` reports `aligned: true` along the component's rows and columns, or deltas of at most one pixel, and its `--pair` image shows the same letters in the same font;
- the clusters that remain are `kind: shape` with `shift_dx` and `shift_dy` of 0 or 1 and `left_pct` near 100;
- `ink.mismatched` alone exceeds `pixels.allowed`, and `ink.mismatched_pct` stays high from round to round;
- colors match (`colors_match: true` in `compare`).

`pp scores` shows the same per item: `over_budget` is the mismatch as a multiple of what a pass allows, and `ink_missed_pct` the share of the design's thin strokes that are mismatched.

A `source.quality` of `soft`, or a substituted font, makes this the expected outcome for every component with text. On a soft source it reaches small shapes without text as well: the blended ring around a dot, an arrow or a round button is a large share of so few pixels. Such a component is at its ceiling once `pp fit` leaves its geometry unchanged and its colors match. To be sure, fit one line: put a single line of the component's text on a harness page, with font size and position as CSS variables, and run `pp fit` against its reference region. If the best fit still leaves most of the line's pixels mismatched, no value will make that text match this reference.

Then end that component's loop without waiting for the stop rule. When the user has already decided how a ceiling stop is handled (`soft_sources` in the inventory), record it as they decided and go on. Otherwise report the score and this evidence, and ask them. What would change the result is a 1:1 lossless design export, the real font files, or their decision to accept the deviation.

## Rules while fixing

- Change the value the measurement points at. Never add an offset, a transform or a negative margin just to move pixels.
- If a fix needs a number, measure it with a probe, `compare` or `fit`; do not step values by trial.
- If the score drops after a change, revert it before trying something else.
- Fix a thing at its own level. A component's size, type and colors are settled in its isolated round; a section round settles only what lies between components, and a page round only what lies between sections. If a section round asks for a change inside a component, go back to that component's isolated round, and check its reference rectangle before its code.
- Do not bend typography toward a score: no letter spacing, squeezed font size or forced line break whose only purpose is to make a substituted font as wide as the design's. Set the size, weight and line height that the `text` probe measures, and report the rest as the font deviation it is.
- When it is the ceiling, the loop ends as described above. Do not mask it, crop it, or lower a threshold.
