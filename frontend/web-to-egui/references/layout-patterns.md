# Layout patterns: web idioms that survive in egui

These patterns are inventory-complete and were exercised end to end on an
editor-style screen. Everyday widgets (tabs, cards, sliders, inputs,
timelines, drawers) are field-proven; exotic ones (tables with spans,
modals, canvas scenes) carry correct equivalents that are mapped but not
yet field-exercised. Apply them before inventing new widgets. Concrete
numbers below are illustrations of each pattern, never values to copy:
always transcribe from the design at hand.

## Page skeleton

- A web page that is a vertical stack of full-width sections becomes a
  vertical stack of `Frame`s inside one `ScrollArea::vertical` with hidden
  scroll bars. One `Frame` per section, composed in a parent `Ui`. Do not
  mirror the HTML nesting depth: flatten decorative wrapper `div`s, keep one
  `Frame` per visible band.
- A fixed-viewport design (for example 1440x900) maps to
  `with_inner_size([w, h])` and `set_pixels_per_point(1.0)` during capture
  so one egui point = one CSS pixel. Ship without the forced density;
  capture with it.
- Horizontal app regions (for example media browser | preview + timeline |
  inspector | agent drawer) are `ui.horizontal` rows of fixed-width columns
  (`set_min_size` + `set_max_width` on each column). The web's flex shrink
  has no equivalent: pin the widths the design measures. A plain `Frame`
  sizes to its content and will drift — columns need exact rects plus a
  clipped child `Ui` (`new_child` with `max_rect`).
- The root panel carries a default inset (8px); zero its margins or every
  column shifts by the inset.

## Recurring components

| Web | egui pattern |
| --- | --- |
| tab row with active underline | clickable rect per tab + 2px painted line under the active one |
| search field + sort control | `TextEdit::singleline` with hint text; sort as a second framed rect |
| media card (thumb + meta + duration) | fixed-size `allocate_exact_size` card; photo mesh thumb at the measured inset; duration as painter text bottom-right; selected = 2px accent inside stroke |
| program monitor | photo mesh fills the 16:9 frame; guides and HUD painted after; play state toggles triangle vs bars in a circle |
| timeline clip | filled rounded rect + title/mono labels; selected = accent stroke; playhead = 2px accent line across the lane row |
| icon button / toggle / checkbox | small allocated rects with glyph text; state in app state, never in widget params |
| modal dialog | centered `Frame` with `set_max_width`; form rows as label-left/control-right horizontals |
| dense telemetry page | square corners (`CornerRadius::same(0)`), 1px rules between sections, mono labels |

## Tracked display text

CSS `letter-spacing` has no egui equivalent; draw the line one glyph at a
time, advancing by each glyph's measured width plus the tracking. Measure
pair kerning too (width of the pair minus the two singles) and add it
between neighbours, otherwise internal glyphs drift and the line matches
only at its ends. Center or right-align from a measured total that uses
the same advances the draw uses, including the trailing tracking the
browser adds after the last glyph. Calibrate one vertical correction per
text style against the design (band-probe the cap tops of the design
against the render) and keep it in the text helper; large display sizes
need their own correction, mono labels another. Confirm the copy's full
extent before placing anything near it: trailing punctuation and
descenders (underscores, the tail of `y`) extend past the cap box and
must sit inside their background or crop. Borders live inside the CSS
box (`box-sizing: border-box`): a right or bottom border occupies the
last pixel of the measured box, so a painted 1px rule goes at `x + w -
1`, not `x + w`; verify every rule against the design's pixel rows.
Never trust float box edges for rules: a 1px CSS border inside a
fractional box rasterizes at the floor of the edge, so measure the
rendered line's column (or row) in the screenshot and paint that
integer — the layout probe's floats routinely mislead by exactly one
pixel. Sibling rules may carry different colors (measure each rule's
value, not just its position), and one divider may continue past a mid
rule while its siblings stop — measure every rule's span and value
individually instead of copying one geometry across the grid.
Precompute wrapped line breaks offline with the real font files plus the
tracking: greedy word wrap with measured advances replicates the
browser's breaks, so each painted line is one string placed at its
measured box. Probe methodology, when comparing design against render:
band-probe cap tops per style (one correction per style, never one
global), detect colored copy per channel (red text sums below any
brightness threshold, so a bright-pixel probe reports it missing), and
stay clear of fixed chrome — a fixed nav occludes the top rows of every
scrolled capture in both images, so calibrate positions from rows it
does not cover.

## Absolute painting inside a scroll area

Painter coordinates are layer-global: they do not follow a `ScrollArea`.
An allocated rect reserves scrollable height (the scrollbar moves) while
paint at fixed coordinates stays on screen — the symptom is a working
scrollbar with frozen content. Fix: capture the allocated content rect's
minimum as the page origin and add it to every painted coordinate (fills,
rules, text, image rects). Thread the origin through every paint helper;

## Centered viewing at other window sizes

The page is transcribed at one design viewport width, so a wider window
(such as fullscreen) must not zoom the page: the browser keeps text
the same size and reflows. For viewing only — never for scoring — keep
the content column at its transcribed width and center it with an
x-offset of `(window_width - design_width) / 2`, while edge-anchored
fills (full-width bands, right-edge panels) and full-width rules bleed
to the window edges. At the design width the offset is 0, so captures
stay bit-identical. Compute the window width from the viewport rect,
not from the width available inside the scroll area, or the scrollbar
show/hide cycle feeds back into the offset. A centered page is not a
reflowed page: column splits and wrap points stay those of the design
width. Record that as the accepted deviation for non-design window
sizes.
measurement-only helpers need no change. The origin equals the panel
origin at scroll zero, so captures are unaffected; verify by dragging
the scrollbar in the interactive viewer, not by screenshot. Fixed-position
web elements (`fixed` nav, sticky headers) are a second rule on top of
this: they stack above the scrolling page, so paint them last, at the
screen origin (never at the scrolled page origin). Painted first, page
fills drawn later cover them as soon as the page scrolls under — the
symptom is chrome that vanishes on scroll while the scrolled content
itself matches.

## Tokens first, always

One `theme` module holds every color, rounding, stroke and spacing constant;
components take values only from it. Share one theme across all screens with
no per-screen literals: neutrals (`PANEL / PANEL2 / RAISED / LINE / TEXT /
DIM / FAINT`) plus accents (`CYAN / INDIGO / INDIGO_DEEP / GREEN / AMBER /
RED`). A screen that needs a literal is a sign the theme is missing a
token, not a reason to inline.

## Text honesty

Icon-font glyphs (for example Material Symbols) have no bundled equivalent:
bundle the icon font itself instead of drawing text stand-ins. Prefer a
static cut (variable fonts do not instance under the text shaper); it
ships under a permissive license (for example Apache-2.0) and is recorded
in `NOTICE.md` like any third-party asset. The shaper performs no
ligature substitution, so address icons by codepoint: extract the
ligature table from the font file and map each icon name to its codepoint
programmatically (never hand-copied tables). Icon ink sits above the
em-box center, so center by ink, not by em: calibrate one vertical
correction per size against the design and keep it in the icon helper.
When the exact icon name does not exist in the static cut, fall back to a
text stand-in and record each as an accepted deviation. Bundle the UI fonts the design uses (for example Inter for UI,
InterTight for display headings, JetBrains Mono for timecodes and labels)
as custom `FontFamily`s in the theme module — including the semibold and
bold cuts the design's weights need — never the default font at design
sizes. Map each weight the design uses (400/500/600/700) to its bundled
cut; same-size text in the wrong cut drifts in width and fails a diff.
Measure first when the bundle lacks the exact cut: a missing medium
weight renders closer in regular than in semibold when the measured width
says so. If a `TextEdit` hint does not render in the pinned egui version,
paint the hint manually with painter text when the field is empty and keep
the widget for interaction — deterministic output beats native behavior.
What remains after all of this is rasterizer difference (one text engine
against another): same outlines, same positions, different edge pixels.
Record it as the acknowledged deviation with its pixel count; it is not
fixable inside the code.
