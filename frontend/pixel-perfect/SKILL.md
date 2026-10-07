---
name: pixel-perfect
description: Implement UI design images as real code and prove the match with measured numbers and a per-pixel diff. Use when the user supplies one or more UI design images (screens, breakpoints, states) and asks for an exact, faithful, 1:1 or pixel-perfect implementation, or names pixel-perfect. Do not use for a loose "build something like this" request. Web targets only.
---

# Pixel Perfect

Turn UI design images into real, reusable code and prove every match with a measured score. Work bottom up: the smallest components first, each taken as far as it can go on its own, then the sections built from them, then the pages. Every number comes from a script; nothing is judged by eye.

## Running the scripts

Every script runs through one entry point. `pp` below stands for this shell function:

```
pp() { python3 "<this skill's directory>/scripts/run.py" "$@"; }
```

Define it at the start of every shell command that uses it, because shell state does not carry over between commands. Do not store the command in a variable instead: zsh does not split a variable into words, and the call fails.

The first call builds its own Python environment, and the first capture installs Chromium; both happen once per machine and need no setup from you. `pp --help` lists the tools; check it before writing any script of your own. Every tool accepts `--help`, and `--dry` to check its arguments and report what it would do without writing anything. Output is TOON; add `--json` only when debugging.

## Non-negotiable rules

1. Measure before writing code. A value you did not get from a probe is a guess.
2. Only `pp check` and `pp diff` produce a score. Never compute, estimate or restate a match percentage any other way. `pp compare` and `pp fit` measure; they do not score.
3. Pass thresholds are 99% content score, 95% for every tile, and a per-pixel tolerance of 8. Change them only when the user gave different numbers, and never to get a pass.
4. A component, section or page has passed only when its latest diff says `pass: true` for every one of its references. Anything else is reported as stopped, or as a deviation the user accepted.
5. A capture that reports `valid: false` is not evidence. Fix what it names and capture again; never diff it.
6. Anything that can be built in code is built in code. Only real raster content is cropped from the design. `references/rules.md` has the full rules; the phases below say which part to read when.
7. Bottom up, always. No section is composed before every component in it is finished, and a page grows one finished section at a time. Never draft a whole page first and tune it afterwards: errors of the small parts then hide inside the large one, and nothing shows which is which.
8. Never report success you did not reach. A stopped loop is reported as stopped, with its score.

## Phase 0: Set up

Before each phase, read that phase's part of `references/tips.md`: the mistakes earlier runs of this skill made at that point, and how to avoid them. Start with "Tools and shell".

1. Confirm the target is a web project. If it is not, stop and tell the user this skill supports web only.
2. Identify the project's framework, component conventions and styling approach, and follow them. If the directory has no project, or the stack is unclear, ask the user.
3. Make the project reachable by URL. Start its own dev server, or reuse one that is running. When it has none (plain static files), run `pp serve <directory>` in the background and use the URL it prints.
4. Give this run a name and a directory.
   - The name is short, lowercase and hyphenated, taken from what is being built (`home`, `checkout-mobile`). One run covers all the design images given together.
   - Every working file goes in the run directory, `_swe/pixel-perfect/<name>/` in the current working directory. Paths in the phases below are inside it. Do not edit `.gitignore`.
   - `pp check`, `pp compare` and `pp scores` find the run directory by `--run <name>`; pass it on every call.
   - If `_swe/pixel-perfect/` already holds a run for these designs, keep its name: read its `inventory.toon`, run `pp scores --run <name>` to see where every item stands, and resume from there instead of starting over. A run that lies directly in `_swe/pixel-perfect/`, as earlier versions of this skill left it, is found when `--run` is left out.
5. Note the thresholds for this run: the defaults, or the user's numbers if they gave any. They go into the inventory in Phase 1.

## Phase 1: Inventory

1. Run `pp measure info` on every design image.
   - Take the scale from the result; when it reports `ambiguous: true`, ask the user for the viewport width or scale.
   - Note `source.quality`. `soft` means the image was rescaled or saved lossy: its text and thin shapes cannot match a browser render pixel for pixel, whatever the code does.
2. Work out how the images relate: separate pages, breakpoints of one page, or states of one screen. Ask the user when filenames and content do not make it clear.
3. Read every image. An image larger than 2000 px on a side is shown to you shrunk, so read a large design in parts saved with `pp measure crop`, and small details with `pp measure zoom`. What you see tells you what is there; where it is always comes from a probe.
4. Complete every cut-off image before anything else is taken from the design. A raster image that the design shows only in part (the last item of a carousel clipped by its container, a photo running off the edge) is not a usable asset: when the carousel slides, that item would show half a picture.
   - For each one, pick a complete image of the same kind from the same design, usually another item of the same list. Its box must hold that image and nothing else: no decoration showing behind a corner, no badge or button on top, and the same backdrop as the cut-off one.
   - Locate both boxes with probes: the visible slot of the cut-off image and the full box of the substitute.
   - Run `pp measure substitute <design> --swap <name>=<source box>:<slot box> --preview <file>`, with one `--swap` per cut-off image, all in one call on the original design. It writes `<design name>.subs.<ext>` beside the design: the same image with each slot filled from its substitute, still clipped exactly as the layout clips it.
   - Text of a cut-off item that the same edge slices mid-way is completed the same way: add a `--swap` for its text area, taken from the same area of the item that supplied the image, and the item then carries that text. Text that can still be read in full stays as the design shows it.
   - Read the preview, which shows each slot before and after. When a slot shows anything but its substitute, choose another source and run the call again.
   - From here on the `.subs` file is the design. Every probe, crop, reference and `--page` check uses it, never the original. Record each swap in the inventory.
   - A cut-off image with no complete image of its kind in the design goes into the question of step 7.
   - When no image is cut off, skip this step and use the original.
5. Break the designs down the way a senior frontend engineer would, into three levels:
   - **Components**: the smallest reusable entities, such as a button, badge, input, tab, pagination dots, carousel arrow, section heading, link, card. One list across all images, each with every appearance recorded as a variant or state. If a thing appears more than once, or could, it is a component.
   - **Sections**: the full-width bands of a page that arrange components, such as a header, hero, product shelf, footer. A section is a composition, not a component, however tempting it is to treat it as one.
   - **Pages**: the sections in order.

   Order components so that the ones others depend on come first, and among those with no dependencies, the ones without text before the ones with text.
6. List the fonts, and every image, icon, logo and illustration, with how each will be sourced. Read "What is code and what is an asset" and "Fonts" in `references/rules.md` first.
7. Ask the user, in one message, for what cannot be measured:
   - confirmation of each font, or its files;
   - any asset files they can supply, originals for images that have UI drawn over them, and the complete file of any cut-off image that nothing in the design can stand in for;
   - for every image whose `source.quality` is `soft`: a 1:1 lossless export of it. Say plainly that without one, text-heavy parts are expected to stop below the threshold, and ask whether to go ahead on that understanding, recording each such stop as a deviation without asking again.

   This is the only planned question; do not ask for approval of the breakdown.
8. Write the inventory to `inventory.toon` in the run directory, following `references/spec-format.md`, including the thresholds and the user's answer on soft sources. Update its `status` fields as work proceeds, and the rest of it the moment a decision changes.

## Phase 2: Measure

Phases 2 and 3 run one component at a time: measure a component, build it, then measure the next. For each component, in inventory order, before writing any of its code:

1. Locate its box in the design with probes, not by eye: use `references/probes.md` to pick the probe for each value.
2. Save a reference crop for every variant and state with `pp measure crop`, at `components/<component>/ref/<variant>.png`. Include enough margin to contain any shadow, and record that margin. The rectangle comes from the design alone. Never take it from where a render puts the element, and never crop a reference again to follow the code: `pp scores` treats a replaced reference as a fresh start.
3. Measure everything the implementation needs: size, padding and gaps, colors, borders, radii, gradients, shadows, text metrics, and repeated structure. Start each row or column of the component with `pp measure items`, which returns the box and color of everything in it in one call. Measure every variant, not only the first: a second card's image may be a different height, a second set of dots a different size.
4. Crop the component's raster assets in one `pp measure crops` call and copy the rows it prints into the inventory's asset list. For an item whose image was substituted in Phase 1, crop the substitute's full box, exactly as its row in the inventory's `substitutions` gives it, so the asset is the complete image. For an image with UI drawn on top of it and no original from the user, add a `--blank` for that UI, as `references/rules.md` allows and `references/probes.md` describes, and read the saved file.
5. Trace any filled shape that is not a rectangle, circle or rounded box with `pp measure outline` and build it as an SVG path. A shape is never cropped.
6. Transcribe all text exactly as it appears in the design.
7. Write the component's `spec.toon` following `references/spec-format.md`, recording which probe produced each value. Mark any value you could not measure as `estimated`.

When no bundled probe fits, write a one-off Pillow/NumPy script under the run directory's `adhoc/` and run it with `pp exec`. This is allowed for measuring only.

## Phase 3: Build each component

Read "Code quality" and "Scoring honesty" in `references/rules.md` first. Components are built and scored alone, never inside a section or page.

Take the first component that has text as a calibration, as soon as the text-free ones before it are done. It shows what this design image and this font can reach before everything else is built on the same assumptions. If its loop ends without a pass and with the ceiling signs described in `references/fix-loop.md`, the same will happen to every component with text. Unless the user already said in Phase 1 how to treat that, stop and ask now, as step 7 below describes, before building anything else.

For each component in inventory order:

1. Implement it in the project's idiom from its `spec.toon`. Reuse a project token when the measured value matches it exactly. Its look must come from its own classes and props, never from the section it will later sit in, or it cannot be rendered alone.
2. Mount every variant where it can be captured alone, following `references/capture.md`: in Storybook or the project's own preview tool when one exists, otherwise on one temporary harness page that holds a wrapper per variant.
3. Run one round with `pp check`, naming every variant on that URL as an `--item`; keep the list in a file and pass it as `@file`. It loads the page once, refuses a capture that is not valid, and scores each item against its reference under one iteration number. Trigger states with capture actions, never with test-only props. Add `--sheet` on a component's first round and read the sheet: a reference and a render that plainly show different things mean the harness is wrong, not the component.
4. If any variant fails, follow `references/fix-loop.md` to turn the result into specific changes, then repeat from step 3.
5. For a value no probe can read off the design (a shadow's blur and alpha, an icon's stroke width, the geometry of a small glyph), use `pp fit` as `references/fix-loop.md` describes, not trial edits.
6. Take the component as far as it can go. A known gap in a shape, an icon or a shadow is not a reason to move on. Its loop ends in one of three ways:
   - every variant passes;
   - what remains is shown to be the ceiling and not the code, by the signs listed in `references/fix-loop.md`;
   - `pp scores`, run after every failed round, lists it under `stop_now`: the content score has not improved for 3 iterations in a row, or 10 iterations have run.
7. When the loop ends without a pass, do not move on silently. If it shows the ceiling signs and the user has already decided how a ceiling stop is handled, record it as they decided and continue. Otherwise tell the user the best score, the evidence path and the suspected cause, and ask whether to accept it as a recorded deviation, change a threshold, supply a better source, or keep going.
8. Set the component's status in the inventory (`passed`, `stopped` or `accepted deviation`) and go to the next one.

## Phase 4: Compose sections, then pages

Only finished components go into a section, and only finished sections into a page.

Sections, in page order from the top:

1. Save each section's reference crop from the design at `sections/<section>/ref/default.png`, located with probes as in Phase 2. Measure what lies between its components (paddings, gaps, backgrounds), crop any raster background as in Phase 2, and write the numbers to `sections/<section>/spec.toon` before composing.
2. Compose the section on its page from the finished components. A section fills the page width, so it is captured in place by its own selector. Check with `pp inspect`, as `references/capture.md` describes, that each component lays out inside the section exactly as it did alone.
3. Run `pp check` with a `--section` for every section composed so far, and loop as in Phase 3, with the same thresholds and the same three ways for a loop to end. Use `pp compare --item <section>` to find which gap or padding is off; the components themselves are already settled.
4. If a section-level fix changes a component, that component's earlier scores are void: run its isolated round again before going on. A section may not pass on top of a component that no longer does.
5. When a section is finished, capture it once with `pp capture --selector` at scale 1 and a clearly wider viewport, and read the shot. It is not scored. It shows what the design-density rounds cannot: an image at the wrong size on a normal screen, a decoration that left its content behind. Fix what it shows and run the section's round again.

Pages:

6. When all of a page's sections are finished, run `pp check` with a `--page` for the page's design image, at that image's viewport and scale, together with the `--section` of every section, so one round shows the page and its parts. Add `--viewport-only` when the design shows only the first screen of a longer page.
7. Loop as before. What is left to fix at this level is only what lies between sections.
8. Repeat for every page, breakpoint and state image in the inventory, each at its own viewport and scale. A section that appears in a further image gets a further reference named after that image, `sections/<section>/ref/<image id>.png`, scored with `--section <section>/<image id>=<selector>`.

## Phase 5: Self-check and report

1. Capture each page once at a clearly wider viewport and once at a narrower one with `pp capture`, at scale 1, and read both shots. They are not scored. Fix what is plainly broken (content overflowing, elements overlapping, decorations that drifted away from the content they belong to) and re-run the affected checks.
2. Go through the self-check list in `references/rules.md` against the final code and assets, all but its question on harness removal. Fix every violation and re-run the affected checks; a pass reached by breaking a rule does not count.
3. Run a final `pp check` round with `--images all` for every component, section and page, so every reported score comes from the final code and has its full evidence images. Components need their harness for this, so run their round before removing it.
4. Remove every temporary harness you created, and answer the self-check's question on it.
5. Write `report.md` in the run directory, following `references/report-format.md` and taking the score table from `pp scores --markdown`.
6. Give the user the score table, everything that failed or was accepted as a deviation, what was not verified, and the path to the report. Mention that `_swe/` is not git-ignored. Name any mistake you made and corrected during the run that `references/tips.md` does not already cover, so it can be added there.
