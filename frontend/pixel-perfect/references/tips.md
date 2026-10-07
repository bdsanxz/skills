# Tips from earlier runs

Every tip here is a mistake an agent actually made while using this skill, with what it cost and what to do instead. Read the part for a phase before starting that phase. When you make a new mistake, or catch one, tell the user so it can be added here.

## Tools and shell

- **The command in a shell variable.** `R="python3 .../run.py"; $R measure ...` fails in zsh, which does not split a variable into words. Define the `pp` function at the start of each command.
- **Output filtered by column position.** Results were piped through `sed` and `cut -d, -f...`; when a tool's columns changed, the filter kept printing numbers under the wrong names and nobody noticed. Ask the tool for less instead: `--brief` on `diff`, `--css` on probes, the compact default of `compare`, `pp scores --item <item>` for one item's latest result. When resuming an old run, read `--help` again before reusing an old command.
- **One-off scripts for things the skill already does.** Hours went into hand-written item scanners, design-versus-render tables, batch runners, contact sheets, zoom sheets, mismatch maps, DOM box dumps and an image-size audit. All of these are bundled now: `measure items`, `compare`, `check`, `check --sheet`, `measure zoom`, `overview.png`, `inspect`, `images_not_1to1` in every `check`, `measure substitute --preview`, and `measure crops --blank`. Run `pp --help` and `pp measure --help` before writing a script.
- **One-off scripts with everything hard-coded.** Scripts written with fixed paths, a fixed scale and a fixed iteration number had to be rewritten for each component. Take the image, the region and the scale as arguments.
- **A basic static server.** `python -m http.server` dropped image requests under load; eight rounds were scored on captures with missing images before anyone looked. Use `pp serve`, and never score a capture that says `valid: false`.
- **The same thirteen arguments retyped every round.** Put a round's `--run`, `--url` and `--item` list in a file and pass `@file`.
- **Errors thrown away.** A probe was called with a flag it does not have, as `pp measure edges ... --brief 2>/dev/null | head || true`. The command failed, printed nothing, and the run went on without the reading. Never send a tool's errors to `/dev/null` and never add `|| true`: an empty answer is a failed command. Each probe has its own flags; `pp measure <probe> --help` lists them.

## Phase 1: inventory

- **Page sections taken for components.** The first inventory listed twelve full-width bands (header, hero, each shelf, footer) as "components". The buttons, cards, dots, arrows and headings inside them never got a reference or a loop of their own, and their errors stayed hidden inside the bands. If a thing appears more than once, or could, it is a component; a band that arranges components is a section.
- **Source quality not checked.** Thirteen iterations were spent on a design that was a rescaled screenshot before anyone established that its text could not match. Read `source.quality` from `pp measure info` first, and put the consequence to the user in the Phase 1 question.
- **A substitute font accepted too early.** The run went ahead with a look-alike font; the real files turned out to be available as soon as the user was asked where the live site serves them from. Ask for the font files, or their URLs, before proposing a substitute.
- **Family and weight guessed at a glance.** Body links were set in Regular where the design had Light, a paragraph in Medium where it had Regular, a heading in the body font where it had the display font. Each took several rounds to find. Zoom the design's text beside renders of the candidates (`compare --pair`, `measure zoom`) and choose by letter shapes and stroke thickness, for every text style, before tuning any size.
- **Cut-off images shipped as slivers.** The last item of two carousels was clipped by its container in the design, and each was cropped and shipped as it appeared: image files 137 px and 79 px wide. Sliding the carousel would show half a picture. The user caught it, after the page was built, and every reference and asset containing those items had to be cut again. Complete cut-off images with `pp measure substitute` in Phase 1, before anything is cropped.
- **A substitute that brought its surroundings along.** The first image chosen to stand in for a cut-off phone had a corner of a blue decoration showing behind it, and that speck was pasted into the slot. Choose a source whose box holds only the image, on the same backdrop as the slot, and read the `--preview` sheet before going on.
- **Coordinates read off a picture.** A design over 2000 px on a side is shown shrunk, so a position read by eye is off by the shrink factor. What you see says what is there; a probe says where.

## Phase 2: measuring

- **One variant measured, its numbers used for all.** Card images were assumed square and equal; each row's images had their own height, and the bottom rows of some had been cropped away. Two sets of pagination dots built at different sizes were one component. Measure every variant.
- **Reference rectangles taken from the render.** A script read each element's box from the rendered page and cropped the design there, again after every code change. The reference then moved with the code and its size always "matched". A reference rectangle is measured on the design, once.
- **Raster crops with a loose margin.** Logos, badges and icons were cropped with a few pixels of halo and then centred by the layout, so they landed a pixel off or on a half device pixel, and the browser resampled every one of them. Crop exactly the box the layout will give the image, on whole design pixels, and give it a CSS size of its pixel size divided by the scale. `check` lists offenders under `images_not_1to1`.
- **Nothing written down.** Measurements lived in the conversation, `spec.toon` was skipped, and the inventory was generated at the end from scores. After a context summary the early numbers were gone, and the inventory still described a decision the user had since reversed. Write the spec before the code, and update the inventory the moment a decision changes.
- **A shape traced through the text lying on it.** Where link text crossed a shape's slanted edge, the trace followed the letters and left notches. Use `measure outline --bridge <rows>`.
- **`outline` on a light shape over a photo.** Parts of the photo that matched the fill joined the shape. Over a photo, find the shape's sides with `edges` on a few rows and columns.
- **A gradient measured with text on it.** The text bent the fit. Pass each color that is not part of the fill as `--ignore`.
- **A band on a gradient backdrop read as one item.** With a low `--tolerance` the backdrop's own variation counted as content and the whole region came back as a single box. Pass the local backdrop as `--bg` and raise `--tolerance` until the band splits into its items; once it does, the boxes no longer depend on the tolerance.

## Phase 3: building components

- **The whole page drafted first.** One 400-line page was written, then tuned for dozens of rounds. Mismatch from the code and mismatch from the source could not be told apart until the work was redone bottom up. Build and finish components first.
- **Calibration skipped.** The ceiling was discovered at page level, late. The first component with text shows it in a round or two.
- **A harness wrapper that was only a box.** Components that stretch to their row's height, or fill their parent's width, collapsed inside a plain block wrapper, and the first isolated round measured the harness. Give the wrapper the parent's layout role.
- **A component that leaned on its parent's styles.** A card that is an `li` lost its list's `list-style: none` when mounted alone, grew a marker line, and sat 6 px lower inside. The card was then "corrected" by 8 px the wrong way, and the error only surfaced when the section was composed. Set on the component everything it needs. When a section is first composed, compare the component's two mounts with `pp inspect` (the command is in `references/capture.md`); when a section round contradicts an isolated round, compare them again before touching the component.
- **A cut-off item built as a lesser item.** The sixth card of a carousel was clipped before its play button, so its markup was written without one. An item the design cuts off is the same component as its complete siblings, with every part they have; only its container clips it.
- **Components styled through their section.** Rules like `.hero .dots` and `.shelf--phones .card` meant no component could be mounted alone. Variants are the component's own modifiers.
- **Values stepped by hand.** An arrow's shadow and a row of dots were nudged round after round. `pp fit` settled each in one call.
- **`fit` started far from the answer.** From a wild start the search made the element vanish, because nothing is closer to the reference than something wrong. Start every variable at the probe's reading; `at_limit: true` means start closer.
- **The same small delta chased on every item.** On a soft design every text box read a pixel or two wider than its render, and font sizes were changed one by one to close a gap that was only the reference's blur. A delta that repeats on every item has one cause; find that cause. (`items` and `compare` now place each edge at half its contrast, which removes this particular bias.)
- **"Aligned" taken for "correct".** `compare` reported a heading as matching while it was set in the wrong font at the wrong size: the two happened to fill the same box. `compare` measures boxes, not letters. When it says aligned and the score is still low, look at `--pair` before calling it the ceiling.
- **Typography bent toward the score.** Letter spacing was tightened and line breaks forced to make a wider substitute font fit; the user saw cramped titles. See the font rules.
- **"Close enough for now."** A badge's curve, a play icon, arrow shadows and a traced shape were left with known gaps while work moved on, and stayed that way for many rounds. Finish a component before leaving it.
- **Tuning past the stop rule.** Two text bars stopped improving at their third round and were re-run nine more times. Run `pp scores` after every failed round, and end the loop of any item it lists under `stop_now`.

## Phase 4: sections and pages

- **Decorations anchored to the window.** Carousel arrows, and later a footer's background shape, were positioned against a full-width ancestor. Both matched at the design width and drifted away from their content on the user's wider screen. Anchor them to the centred content they belong to. This mistake was made twice in one run.
- **Images sized by a density hint alone.** Images were given `srcset="... 2x"` and no CSS size. At the design's 2x density they were exact; on a normal screen they rendered at double size, and the user found the footer broken. Every raster gets an explicit CSS width and height.
- **Fractional `width` attributes.** `width="35.5"` in HTML is truncated to 35. Sizes with a half pixel go in CSS.
- **Only ever looked at the design density.** Every check ran at scale 2 and at the design width, and the unscored look at other widths was skipped, twice. Both breakages above were found by the user. Take the scale-1, wider-viewport shot of each section as soon as it is finished, and read it.
- **A fix made at the wrong level.** Offsets found in a page round were applied inside components, which then had to be undone. A page round settles only what lies between sections.
- **A fixed-width page.** The container was pinned to the design's width in the first draft and was still pinned five rounds later. Use a maximum width and fluid children from the start; retrofitting it means re-running everything.

## Phase 5: reporting

- **Scores from invalid captures reported as progress.** They had to be withdrawn. Evidence is only what `check` scored from a valid capture.
- **A report that grew by appending.** Each round added a "Round N" narrative while the tables above went stale. Regenerate the Scores table from `pp scores --markdown` and rewrite the sections that changed.
