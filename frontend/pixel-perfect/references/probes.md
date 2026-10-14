# Measurement probes

All probes are `pp measure <probe> <image> [options]`. Coordinates and lengths are image pixels with the origin at the top left. A region is `--region x,y,w,h`; without it the whole image is used.

Pass `--scale <design scale>` on every call. The result then carries a `points` block with the same lengths divided by the scale; those are the values to write in code, in the platform's layout unit. Add `--points` to get the lengths in points only, once, with the probe's region kept in image pixels as `region_px`. Regions are always typed in image pixels.

Every probe works on a render as well as on a design. When a value looks wrong in the diff, run the same probe with the same region on both images and compare the two results; for positions and sizes, `pp compare` does both runs and the subtraction in one call.

What you see in an image tells you what is there, never where. An image larger than 2000 px on a side is shown to you shrunk, so a coordinate read off the picture is wrong by the shrink factor. Take every coordinate from a probe's output.

## Choosing a probe

| You need | Probe | Key options |
| --- | --- | --- |
| Image size, pixel density, and whether the image is sharp enough to match | `info` | `--screen-width`, the screen or window width in points, when the user states it |
| A closer look at small details | `zoom --out path` | `--region`, repeatable to put several on one sheet; the whole image without it |
| The color of one pixel | `color --at x,y` | |
| Whether an area is one flat color, and which | `color --region` | read `flat` and `dominant` |
| Where things start and end along a line | `edges --row y` or `--col x` | `--from`, `--to`, `--band`, `--threshold` |
| The tight box of content inside a loose area | `bbox` | `--bg`, `--tolerance` |
| Everything in a row or column at once: each item's box and color | `items` | `--axis`, `--min-gap`, `--bg` |
| Sizes of items in a row or column and the gaps between them | `spans --axis x` or `y` | `--min-gap` |
| Columns, rows and gutters of a card grid or list | `grid` | `--min-gap` |
| A reference crop or a raster asset | `crop --out path` | |
| A design in which cut-off images are complete | `substitute --swap name=sx,sy,sw,sh:dx,dy,dw,dh[:anchor] ... --preview file` | writes `<design>.subs.<ext>`; prints the inventory's substitution rows |
| All of a component's raster assets in one call | `crops --item name=x,y,w,h ... --out-dir dir` | prints the inventory's asset rows; `--blank name=x,y,w,h:hex[:mx,my]` removes UI the code will draw |
| A filled shape that is not a box or a circle, as a vector path | `outline` | `--color`, `--min-run`, `--epsilon`, `--bridge` |
| Corner radius | `radius` | region is the box's tight bounding box |
| Border width and color per side | `border` | region is the box's tight bounding box |
| Gradient direction and color stops | `gradient` | region is inside the gradient only; `--ignore <hex>` for text on it or the page around it |
| Shadow offset, reach and color | `shadow` | region is the casting box's tight bounding box |
| Text line boxes, baselines, glyph heights, text color | `text` | region contains only the text and its background |

## How to locate a box

1. Estimate a loose region around the element by looking at the image.
2. Run `edges` along a row through its middle and a column through its middle. Crisp edges (`soft_px: 0`) with a color change on both sides are the box's sides. A soft fade before the first crisp edge is a shadow, not the box.
3. Use `bbox` only when the element has no shadow and sits on a flat background; with a shadow, `bbox` returns the shadow's extent.
4. Confirm with `color --region` on the interior and one `edges` pass, then record the box.

## Measuring a component, top down

1. Run `items --axis y` on the component's full box to get its rows: each band of content with its top, height and the gaps between.
2. Run `items` (axis x) on each row to get the things in it: every icon, label, button and divider with its box and color.
3. Do this for every variant. Variants that look alike often differ by a pixel or two (a taller image, a wider gap), and one variant's numbers applied to all leaves the others off.
4. Raise `--min-gap` until each thing is one item: about the width of a space for words that belong together, more for groups. A text line with a small `--min-gap` comes back as one item per word or letter.
5. Pass `--bg` when the row's backdrop is not the color at its border, as inside a card.
6. Use the specific probes below only on the items that need more than a box and a color: `radius`, `border`, `shadow`, `gradient`, `text`.

## Reading the results

- `info`: `source.quality` is `sharp` when edges are blended over at most one pixel, as a 1:1 render or lossless export draws them, and `soft` when the image was rescaled or saved lossy. On a `soft` source, positions, sizes and colors can still be measured and matched, but text and thin shapes will not match pixel for pixel; edges read as `soft_px` 2 or more, and lengths come out as fractions that are artifacts of the rescale, not of the design. `unknown` or `uncertain` means there were too few clean edges to judge: look at a `zoom` of some small text.
- `items`: each row is one item's box (`x`, `y`, `w`, `h`) and its `hex`, the color of its strongest pixels: the ink color for text, the fill for a box. `gaps` are the distances between consecutive items along the axis. Each side of a box is placed where that edge passes half of its own contrast, so the box of a blurred item is the box of the sharp one, and it does not change with `--tolerance`; the tolerance only decides what counts as an item.
- `outline`: it needs a shape whose fill differs clearly from everything around it. Over a photo, pixels of the photo that match the fill join the shape and the path is wrong; measure such a shape with `edges` along a few rows and columns instead. `path` is in the region's own pixels and `points.path` in points, each as SVG path data for the `viewbox` given beside it; draw it with whatever vector path the platform has. `split_rows` above 0 means the shape is hollow or notched and the path bridges over that; trace such a shape in parts. When text or an icon lies across the shape's edge, the trace follows it inward; pass `--bridge <rows>`, a little more than the height of what crosses, and `bridged_rows` says how many rows were redrawn straight. Lower `--epsilon` for a closer fit and more vertices.
- `crops --blank`: for an image with code-built UI on top of it, when the rules allow a blanked crop. The box is where that UI lies, in the design's pixels, kept tight around it; `hex` is the UI's fill. Inside the box, every pixel within `--blank-tolerance` of that color, and one pixel around it, is painted gray.
  - When the image behind the UI is close to the UI's color, the two cannot be told apart there. Add `:mx,my`, the top left of the same UI somewhere else in the design where it stands out, and its shape is read from that place.
  - `blanks` lists each one with `pixels` and `share_pct`, the part of the box that was painted. Copy the rows into the inventory, and read each saved file once: gray anywhere but on the UI means the box is too loose or the tolerance too high.
- `substitute`: each swap pastes the source box into the slot box, clipped to the slot. `anchor` says which corner of the two stays aligned: `tl` (the default) when the slot shows the image's left or top part, as with the last item of a row; `tr` when it shows the right part, as with a first item cut off on the left. The source must be at least as large as the slot and may not overlap it. Only the slots change, and the original file is not touched. For text, swap the whole text area of the item (the same offsets inside both items), not the tight box of the letters, so the lines stay where they are.
  - Every call starts from the original design and rewrites the copy, so list all of the design's swaps each time. It refuses a `.subs` file as its input.
  - `--preview` saves each slot with its surroundings, the design on the left and the copy on the right. Read it: the tool cannot tell whether a source box also holds a corner of something behind the image, or a badge on top of it.
  - A JPEG cannot be saved without loss, so its copy differs slightly everywhere and the result carries a `warning`; pass `--out <name>.subs.png` to keep every other pixel exact.
  - Once the copy exists, every probe run on the original prints a `design_warning`, and `check --page` refuses the original. Read the original only to locate boxes for another `substitute` call.
- `zoom`: for reading only. Its file is enlarged with hard pixels and is neither an asset nor a reference.
- `edges`: `pos` is the first pixel of the new color; `at` is the sub-pixel position when the edge is anti-aliased (`soft_px` > 0). A fractional `at` at scale 1 usually means the element sits on a half pixel in the design; round to the nearest value the layout can produce. `runs` gives each stretch between edges with its size; a high `drift` means the run is a gradient or shadow, not a flat fill.
- `spans` and `grid`: `uniform_size`, `uniform_gap`, `pitch`, `column_width`, `gutter` are filled only when every item agrees within 1 px; `null` means the items differ, so read the individual spans. Items with no background of their own (plain text columns) fragment into many spans; raise `--min-gap` until each item is one span.
- `radius`: trust a corner when `fit_error` is below about 0.5 and `contrast` is above about 16. A large `fit_error` means the region is not the tight box, or the corner is not circular. `pill: true` means fully rounded ends.
- `border`: `width: 0` means no border on that side. Borders wider than `--max-width` are treated as fill.
- `gradient`: when the fill has text on it, or is a shape that does not fill the region, pass each color that is not part of the fill as `--ignore`; `measured_share` is how much of the region was left to measure. `type: linear` gives a usable `angle_deg` and `stops` (and, for the web, a ready `css_value`). `type: complex` means radial, conic, an image or noise; the stops are then only a starting point, and if it is a picture it is a raster asset.
- `shadow`: `offset_x` and `offset_y` are reliable when every side is `settled: true`. `blur_estimate` assumes no spread and typically reads 10 to 25% low; start from it and let `pp fit` refine blur, spread and alpha. `alpha_if_black` is the opacity if the shadow color is pure black.
- `text`: `ascent` is baseline to the top of the tallest glyph, `x_height` baseline to the top of lowercase letters, `line_pitch` the baseline-to-baseline distance, which is the line height. `font_size_estimate` is rough. To pin font size and line height, render the candidate font and run `text` on the render with the same region: `ascent`, `x_height`, `width` and `line_pitch` must equal the design's. Each difference names its value (`line_pitch` is the line height, `ascent` and `x_height` scale with the font size); when that does not settle it, `pp fit` does.

## Limits

- Probes assume the background inside a region is one color. Over a photo or gradient, pass `--bg` or measure with `edges` instead.
- A probe measures what is in the pixels. It cannot tell a 1 px border from a 1 px inset shadow, or name a font. State such readings as interpretations in the spec.
- A value that shows only in how pixels blend (a shadow's blur and alpha, a stroke's width) is refined with `pp fit` once the component renders, starting from the probe's reading.
- When no probe fits, write a one-off script under the run directory's `adhoc/` and run it with `pp exec <file>`. The scripts directory is importable, so `from pp_common import load_rgb` and `import measure` work. Take file paths and regions as arguments, so the script still works on the next component. Use this for measuring only, never for scoring.
