# Capturing a render

A capture is a screenshot of the running UI, saved as a PNG by whatever the platform offers. It must be reproducible and must line up pixel for pixel with its reference. `pp check` scores a screenshot; it does not take one.

## The capture contract

A screenshot is evidence only when all of these hold. Nothing checks them for you, so check them yourself, and read the first screenshot of every harness and every page before scoring it.

- **Design density.** One point of the UI covers exactly the design scale's number of pixels, so the screenshot's size is its size in points times the design scale. Render at that density; never resize a screenshot. When the default screen has another density, choose a device, simulator, window or renderer setting that has the design's. If none does, ask the user.
- **Design size.** A page is captured in a window or on a device of the design's size in points.
- **Only what the app draws.** No status bar, title bar, window shadow, device frame, scrollbar, dev overlay, debug banner, system dialog or cookie banner. Capture the content area alone, or crop it with `pp measure crop`, the same way every time.
- **Complete.** Every image and the real fonts have loaded, and the text and data are the design's. A font that is not bundled or registered is replaced by a fallback without any error: the text then renders in another typeface, and no spacing change will make it match.
- **Still.** Animations and transitions have ended or are switched off, the text caret is hidden, and the pointer rests on nothing unless a hover state is being captured.
- **Exact colors.** A lossless PNG in sRGB, with no display color profile applied and no transparency. A screenshot that the app or its framework renders itself is safer than a grab of the screen, which can pass through the display's color profile.
- **Plain text rendering.** Grayscale antialiasing, with subpixel (LCD) text rendering switched off where the platform allows.
- **Repeatable.** Two captures of the same unchanged UI are identical: `pp diff <shot 1> <shot 2>` reports a content score of 100. Anything less means something is still moving or loading.

## How to capture

Use the project's own means first: a preview tool, snapshot tests, or a UI-test driver that can save a screenshot. Otherwise:

| Platform | A capture that meets the contract |
| --- | --- |
| Web | A headless browser screenshot, with the viewport at the design's size in points and the device scale factor at the design scale |
| Desktop app | The toolkit's own screenshot or offscreen render at the design scale (in egui, with `pixels_per_point` set to the design scale); failing that, the operating system's capture of that one window, without its shadow |
| Mobile app | The simulator's or emulator's screenshot command, on a device whose pixel density is the design scale |

Reach a state (hover, focus, pressed, an open menu) through real input, using whatever drives the platform: browser automation, taps in a simulator, the framework's UI-test driver. Each state is its own screenshot.

Save screenshots in the run directory's `shots/`. Record the capture steps that work in the inventory, and capture the same way every round.

## Scoring a screenshot

```
pp check --run <name> --shot <screenshot.png> --scale <design scale> \
  --item <component>/<variant>=<x,y,w,h> ... --section <section>=<x,y,w,h> ... \
  --page <page>/<image>=<design image> ... [options]
```

- `--scale` is the design scale. It turns the lengths in the results into points; it never resizes anything.
- `--item name/variant=x,y,w,h` cuts that box, in screenshot pixels, out of the screenshot and scores it against `components/<name>/ref/<variant>.png`. The variant is `default` when left out. `--section name=x,y,w,h` does the same for a section, against `sections/<name>/ref/default.png`. List everything that one screenshot shows in one call.
- `--page name/image=design.png` scores the whole screenshot against a design image. When Phase 1 made a `.subs` copy of the design, give that file; `check` refuses the original.
- Keep a round's list in a file and pass it as `@file`: the file holds the arguments as you would type them, on as many lines as you like, `#` starting a comment. Write it once per harness or page and reuse it every round. `--run` and `--scale` can go in it too.
- A round gets one iteration number for all its items: the first that none of them has used. `check` never overwrites an iteration. A round that needs more than one screenshot (a state, a harness too large for one window) is one call per screenshot, each with the same `--iter <n>`.
- `check --sheet` also writes `sheets/iter-NN.png`: every small item's reference beside its render on one image. Read it after the first round on a harness.
- `check --images all` also writes the full composite and heatmap. The default writes only the overview and the cluster close-ups, which is what the loop needs; use `all` for the final round.

## Where to render

**A component is always rendered alone**, so that its score is its own:

1. In the project's preview tool, when it exists: one preview per variant.
2. Otherwise on one temporary harness screen in the project (a page, a debug screen, an example window), with one wrapper per variant, so a single screenshot covers them all.
   - Each wrapper stands in for the component's parent. Give it the variant's `backdrop` as background, its `margin` as padding (in points), and the size of the reference crop.
   - Give the wrapper the parent's layout role too. A component that stretches to its row's height, or fills its parent's width, only does so inside a parent that lays out that way; in a bare box it collapses or overflows, and the round then measures the harness, not the component.
   - Fill the harness around the wrappers with one key color that no reference contains, and set the wrappers in a single row or column with a gap between them.
   - Mount the real component, with the exact text and content of that variant in the design. Never restyle or patch a component inside the harness, and give components no test-only parameters: what is scored must be what the sections will use.
   - A harness that fills itself in after it starts must be captured only once it has finished.

**Finding the boxes.** Run `pp measure items <screenshot> --axis <x or y> --bg <key color>` on the harness screenshot. Each item it lists is one wrapper, and its `x,y,w,h` is that variant's box for `check`. A box that is larger than the reference crop means the component spills out of its wrapper. The wrappers have fixed sizes, so the boxes stay the same from round to round; find them again only after changing the harness.

**A section is rendered in place** on its page. Build the page top down, so that what is above a section is already finished. Find the section's box in the page's screenshot with probes, the same way its rectangle was found in the design: `edges` down a column through it and along a row. When the section has no edge of its own to find, use its design rectangle, moved by however far the page is scrolled.

**A page** is the whole screenshot.

## A page longer than the window

Capture the whole page in one image when the platform can: a full-page screenshot in a headless browser, an offscreen render or a window as tall as the design. When it cannot, scroll and capture one screenshot per screenful. Save the part of the design each one shows with `pp measure crop`, and score each as its own image: `--page <page>/<image>-1=<that crop>`. Scroll by a whole number of pixels, and make sure nothing that stays fixed on screen hides content the design shows.

## Check the result before trusting it

- `dw` and `dh` in a `check` row must be 0. If not, fix the density, the window size, the wrapper size or the layout first; a size mismatch fails the diff by itself. A screenshot exactly two or three times too large or too small was captured at the wrong density.
- An element whose box does not land on whole pixels at this scale has blurred edges. Fix the layout that causes it. At scale 2 a half point is a whole pixel and is fine.
- The app's log, console or test output must be free of errors, or each one explained.
- A raster image must be drawn one image pixel per screen pixel. For an image with nothing drawn over it, crop its box out of the render with `pp measure crop` and run `pp diff <asset file> <that crop>`: an image drawn 1:1 scores 100. An image cropped from the design must always pass this; a photo the user supplied at another resolution need not.

## When two mounts of a component disagree

A component must lay out the same alone on its harness and inside its section. Compare the two renders:

```
pp measure crop <section's render.png> --region <the component's box in it> --out <crop.png>
pp compare <component's render.png> <crop.png> --region <the component inside its wrapper> --scale <design scale> --pair <out.png>
```

`aligned: true` means everything inside the component is in the same place in both. Otherwise `pairs` lists what moved and by how much, and the `--pair` sheet shows both. The usual cause is something the component takes from its real parent and not from the wrapper (a font, a line height, a color, a list or row style), or a rule that reaches into it from the section. Use the platform's own layout inspector to see why a render differs; design values still come from probes on the design. Fix the component so it carries what it needs, not the harness.

## Raster assets at the design's density

An image cropped from a design at scale 2 has two image pixels per point. Give it a size of exactly its pixel size divided by the scale, even when that is a half point (a 729 px wide crop is 364.5 points wide). Any other size makes the renderer resample it, and every pixel of the image then differs slightly from the design.

- Set the size explicitly, in the layout. A density hint alone (a `2x` variant with no stated size) is right at the design's density and the wrong size at any other, and a size attribute that only takes whole numbers drops the half point.
- Crop the box the layout gives the image, starting on a whole design pixel. A crop with a margin that the layout then centres lands between pixels.
