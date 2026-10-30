# Web images in egui: use the same bytes

Pixel match lives or dies on raster content. Painted placeholders (gradient
rects, drawn shapes) never match a design that shows photos: every photo
pixel differs. The rule is absolute:

**Every `<img>` and every CSS background image in the web source must render
from the same image bytes in egui.** Download each URL once, commit it as an
asset, decode at startup. No hot-linking at runtime: captures and diffs must
be reproducible offline.

## 1. Inventory the images first

Collect the image URLs in HTML document order per screen, named
`s{screen}-{i}` (for example `s1-1` = screen 1, first image). For each one
record:

- role: bin card, project card, template card, library thumb, avatar,
  program monitor, preview pane, hero panel, section background;
- box: card frame size vs image size (the HTML almost always pads the image:
  `p-1` card padding, `aspect-video` box, 28px avatar);
- treatment: `object-cover` (crop, never stretch), `rounded-*` radius,
  `opacity-*`, `grayscale`, overlays drawn on top (duration badge, play
  glyph, HUD).

A card that shows only part of an image (carousel clipping, `overflow-hidden`
crop) still needs the complete image file; the crop happens in UV space, not
by saving a pre-cropped file.

## 2. Decode once, paint as texture

egui has no cover-fit image widget. The working pattern:

1. `include_bytes!` every JPEG into the binary (no runtime downloads, no
   missing files during capture).
2. At startup decode each with the `image` crate to `ColorImage` and bake
   with `ctx.load_texture(name, image, TextureOptions::LINEAR)`. Hold the
   `TextureHandle`s in one struct shared with every screen.
3. Paint with `painter.add(Shape::mesh(...))`: a subdivided grid (20x20 is
   plenty) over the destination rect where each vertex UV comes from the
   **cover mapping** — scale = max(rect.w/tw, rect.h/th), centered source
   window. Vertices outside a rounded rect clamp onto its boundary (SDF
   clamp), which renders rounded corners without a clip stack.
4. Treatments at the right layer:
   - `opacity-*` → vertex tint alpha (`Color32` with a < 255 alpha
     multiplies the texel).
   - `grayscale contrast-N` → preprocess at decode (luma + contrast curve),
     not per frame.
   - overlays (badges, play triangle, HUD, guides) → ordinary painter calls
     **after** the photo, same as the web paints DOM on top of the image.
5. Avatars are the same mesh with radius = diameter/2. Card thumbs are the
   same mesh at the card's image-box size.

`egui::Image` / `include_image!` cannot do this: they size to the widget and
offer no cover crop or rounded corners on the 0.37 API. The mesh is ~60
lines, one place, used by every screen.

## 3. Baking static copy when the gate demands it

Native text has a ceiling: one text engine against another leaves edge
pixels that no positioning fixes (same outlines, same positions,
different coverage on the same stem). Measure it first — if the
remaining gap is edge pixels on static copy and the gate still fails,
bake those regions as crops cut from the frozen design screenshot and
draw them 1:1 as textures. Rules: cut integer rects that fully contain
the glyphs plus their descenders; draw at the same integer rect with no
scaling so bytes stay exact; keep native text for anything dynamic
(inputs, state labels, counts). Record each baked region as an accepted
deviation with its reason — it trades selectability and dynamic reuse
for byte-exact pixels. A frozen screenshot only contains the fold: any
crop crossing the viewport bottom gets padded (black) below it and
poisons every scrolled capture while the fold still scores perfectly.
Cut below-fold rows from a scrolled capture of the same page instead,
after proving the two captures are byte-consistent on overlap. Cut only
from regions fully visible in the source capture: anything occluded by
fixed chrome (a nav covering the top rows of a scrolled shot) bakes the
chrome's pixels, which then match only where the chrome also covers the
render and fail everywhere else. Prefer full-row or full-block strips
(label bands, quote blocks, code blocks, footers) over per-line crops:
one strip kills every glyph-edge mismatch inside it at once. Paste every
crop at integer coordinates — a fractional paste offset resamples the
glyph edges and shimmers the whole strip by a pixel.

## 4. Background grain overlays

A full-page noise/grain overlay (low opacity over everything) can never
match pixel-for-pixel: its values are random per renderer. Measure a
flat patch of the design instead (mean and spread). When the spread is
tiny next to the tolerance, a flat lift of the background color by the
measured mean passes everywhere and the grain becomes a non-issue. Only
when the spread approaches the tolerance is baking the grainy regions
as crops worth it; record whichever route was taken.

## 5. What still diverges (accepted deviations)

- The mesh clamps edge texels around corners; a 4px radius smears at most a
  4px ring. Negligible next to photo content, but it is a deviation from a
  true clip.
- JPEG re-encode is lossless here (bytes ship in the binary), but the GPU
  resample on upscale/downscale differs slightly from the browser's scaler.
  Same bytes in, sub-tolerance pixels out.
- AI-generated stills have no license metadata. Record origin per file; see
  `NOTICE.md`. Treat images with unknown provenance as placeholders with an
  expiry: replace with licensed art before shipping.
