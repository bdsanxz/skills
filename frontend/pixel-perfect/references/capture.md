# Capturing a render

A capture must be reproducible and must line up pixel for pixel with its reference. The platform contract is: an image of the rendered UI, at the reference's exact pixel dimensions and density, with nothing moving and nothing missing. On the web, `pp check` and `pp capture` produce it.

## Before capturing

- The page is served by the project's own dev server, or by `pp serve <directory>` for a project of plain static files. Do not use `python -m http.server`: it answers one request at a time and drops requests on a page with many images, which silently produces captures with missing content.
- The URL must show exactly the state to compare: real fonts loading, real assets, no dev overlays, no cookie banners, no placeholder data that differs from the design's text.

## Commands

For a round of the loop, capture and score together:

```
pp check --run <name> --url <url> --viewport <w>,<h> --scale <design scale> \
  --item <component>/<variant>=<selector> ... --section <section>=<selector> ... \
  --page <page>/<image>=<design image> ... [options]
```

For a shot with no scoring (reading a section or a page at another width or scale):

```
pp capture --url <url> --out <file.png> --viewport <w>,<h> --scale <design scale> [--selector <css> | --full-page] [options]
```

- `--viewport` is in CSS pixels: the design's width divided by its scale, and a height of your choice for full pages.
- `--scale` is the design's pixel density, so the saved image is in the design's own pixels.
- `check --item name/variant=selector` cuts that element's box out of the page and scores it against `components/<name>/ref/<variant>.png`. The variant is `default` when left out. `--section name=selector` does the same for a section, against `sections/<name>/ref/default.png`. All items of one call come from a single page load, so list everything that shares the URL in one call.
- `check --page name/image=design.png` scores the whole scrollable page against a design image. Add `--viewport-only` when the design shows only the first screen. When Phase 1 made a `.subs` copy of the design, give that file; `check` refuses the original.
- Keep a round's list in a file and pass it as `@file`: the file holds the arguments as you would type them, on as many lines as you like, `#` starting a comment. Write it once per harness or page and reuse it every round. `--run`, `--url`, `--viewport` and `--scale` can go in it too.
- A round gets one iteration number for all its items: the first that none of them has used. `check` never overwrites an iteration; `--iter <n>` names the number yourself.
- `check --sheet` also writes `sheets/iter-NN.png`: every small item's reference beside its render on one image. Read it after the first round on a harness.
- `--action kind:value`, repeatable and run in order before the shot: `hover:<selector>`, `focus:<selector>`, `click:<selector>`, `scroll:<selector>`, `wait:<selector>`, `press:<key>`, `wait-ms:<n>`. A state needs its own call, because the actions apply to the whole load.
- `--color-scheme dark` for dark designs.
- `--wait-until networkidle` when content arrives after load.
- `--ignore-request <text>` for a request that is known to fail and does not affect what is drawn (an analytics call). State it in the report.
- `check --images all` also writes the full composite and heatmap. The default writes only the overview and the cluster close-ups, which is what the loop needs; use `all` for the final round.

Animations and transitions are forced to their end state and the text caret is hidden, so a hover or focus state appears fully applied.

## Where to render

**A component is always rendered alone**, so that its score is its own:

1. In the project's preview tool (Storybook or similar), when it exists: one story per variant.
2. Otherwise on one temporary harness page under the project's dev server, with one wrapper per variant, so a single `check` call covers them all.
   - Each wrapper stands in for the component's parent. Give it the variant's `backdrop` as background, its `margin` as padding (in CSS pixels), and the size of the reference crop.
   - Give the wrapper the parent's layout role too. A component that stretches to its row's height, or fills its parent's width, only does so inside a flex or grid parent of that kind; in a bare block it collapses or overflows, and the round then measures the harness, not the component.
   - Put a distinct selector on each wrapper (for example `[data-pp-wrapper="card-default"]`), not inside the component. Components get no test-only attributes or props.
   - Mount the real component, with the exact text and content of that variant in the design. In a framework project, import it. In plain HTML and CSS, load the project's real stylesheet and write the component's markup once per variant. Never restyle or patch a component inside the harness: what is scored must be what the sections will use.
   - When the harness fills itself in by script, set a marker when it is done and pass `--action wait:<marker selector>`.

**A section is rendered in place** on its page and captured by its own root selector. It fills the page width, so its box there is its reference crop. Build the page top down, so that what is above a section is already finished.

**A page** is the whole document.

## Check the result before trusting it

`check` refuses to score when the capture is not valid, and `capture` exits with status 4. Read what they report:

- `valid: false` with `problems`: a request or a font failed, or the browser did not honor the viewport. `failed_requests` and `fonts_failed` name what. A load is retried once before it is called failed; if requests keep failing, the server is the problem. Fix it and capture again. An invalid capture is never evidence.
- `width` and `height` (or `dw`, `dh` in a `check` row) must equal the reference's. If not, fix the viewport, the wrapper size or the layout first; a size mismatch fails the diff by itself.
- `fractional_box: true`, or the note `box is off the device pixel grid`, means the element's box does not land on whole device pixels at this scale, which blurs its edges. Fix the layout that causes it. At scale 2 a half CSS pixel is a whole device pixel and is fine.
- `fonts` lists the web fonts the page declared and whether each loaded. A font the design needs that is missing from the list is not being requested at all: the text is rendering in a fallback, and no spacing change will make it match.
- `console_errors` must be empty, or explained.
- `images_not_1to1` lists raster images the browser has to resample at this scale: drawn at a size that is not the file's pixel size, or starting off the pixel grid. An image cropped from the design must never be on this list; fix its crop box or its CSS size. A photo the user supplied at another resolution may be.

## When two mounts of a component disagree

A component must lay out the same alone on its harness and inside its section. Compare the two:

```
pp inspect --url <section page> --viewport <w>,<h> --selector <the component in the section> \
  --against-url <harness url> --against-selector <the component inside its wrapper>
```

`identical: true` means every box inside the component is in the same place in both. Otherwise `differences` lists each element that moved, by how much, and whether its font differs. The usual cause is something the component inherits from its real parent and not from the wrapper (`list-style`, font, line height, color), or a rule that reaches into it from the section. Fix the component so it carries what it needs, not the harness.

Without `--against-selector`, `pp inspect --selector <root>` lists where the browser put each element of a render and the font of each text element. Use it to see why a render differs; design values still come from probes on the design.

## Raster assets at the design's density

An image cropped from a design at scale 2 has two image pixels per CSS pixel. Give it a CSS size of exactly its pixel size divided by the scale, even when that is a half pixel (a 729 px wide crop is 364.5 px wide in CSS). Any other size makes the browser resample it, and every pixel of the image then differs slightly from the design.

- Set the size in CSS. An HTML `width` attribute drops the fraction, and a `srcset` density hint with no CSS size is right at the design's density and double the size on a normal screen.
- Crop the box the layout gives the image, starting on a whole design pixel. A crop with a margin that the layout then centres lands between pixels.
