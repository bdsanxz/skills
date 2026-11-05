# Tips

Lessons from real runs of this skill. They are not rules: each says what tends to go wrong in a situation and what usually works. Use judgment when your case differs. Read the section for the situation you are in.

## Reading the output

- Commands print KDL, and `node` and `api -o` save `.kdl` files; the exceptions are `spec`, with its own text outline, `daemon log`, which prints the raw log, and `render`, `screenshot` and `image-fills`, which save images and print a KDL summary. Each top-level KDL node is one field of the result, encoded as JSON-in-KDL, so the file holds exactly what the API returned: an object's plain fields are `key=value` properties on its line, nested objects and arrays are indented blocks under it, array items are nodes named `-`, `(array)` marks a list, and `#true`, `#false`, `#null` are the literals. Check `ok #false` and `error` first.
- Search saved files line by line: a Figma node and its plain fields share one line, so `grep -n 'id="1:8614"' file.kdl` finds a node, `grep -c 'type=TEXT'` counts text layers, and `grep -n 'fontFamily="Inter"'` finds where a font is used (the `style` line under each text node). The line number and indentation show where the hit sits in the tree. Nested values (fills, effects, boxes) are on their own lines below the node, so for "nodes whose fill is X" read the block around the hit, or use `spec`.
- For processing that needs the whole tree, pass the file to `spec --from`, which reads `.kdl` and `.json`, or parse it with a KDL v2 library and decode each top-level node with its JSON-in-KDL support. Inputs the CLI takes from you (`call` params, `-p` files) stay JSON.

## Choosing a path

- **Two ways in.** The REST commands (`file`, `node`, `spec`, `render`, `image-fills`, `api`) read any file from its URL with a token, without Figma Desktop. The plugin commands (`exec`, `screenshot`, `selection`, `call`, ...) need Figma Desktop open with the Desktop Bridge plugin running, and are the only way to change a file or see unsaved, live state.
- **A Figma URL and a read-only job** (inspect, implement in code, export, audit) usually means REST: it needs nothing from the user and works when Figma Desktop is closed. Check with `figma-access status` whether a plugin is connected before asking the user to open one.
- **Changing the design** always needs the plugin. Use REST only to read around it.
- **Both available:** REST gives the saved file; the plugin sees what is on screen now. When they disagree, the user has unsaved or newer edits; trust the plugin.

## Token

- The token is read from `FIGMA_TOKEN_KEY`, `FIGMA_ACCESS_TOKEN` or `FIGMA_TOKEN`. Users often export it in a shell profile (`~/.zshrc`, `~/.bashrc`) that an agent's shell does not load, so the command says no token is set although the user set one. Load the profile in the same command: `source ~/.zshrc >/dev/null 2>&1; figma-access ...`. Look for the variable name in the profiles with `grep -l` rather than asking the user again.
- Never print, echo or log the token. To check it, test it: `figma-access api /v1/me` answers 200 for a working token; 403 means invalid, expired, or without access to the file.

## Finding the right node

- **`node-id` in a URL is often the page,** not the design: `node-id=0-1` is the first page. `figma-access node <url>` on a page says so and lists its frames; pick the frame the user means (usually the one top-level frame, or the one whose name matches the request) and work on its id.
- URL ids use `-` (`1-8543`); the API uses `:` (`1:8543`). The CLI converts both ways.
- Ids that start with `I` and contain `;` (`I1:8544;1038:92027`) are layers inside a component instance. They are valid for `render` and `node`, but in the plugin they change when the instance is swapped or reset.
- **Read the outline first** (`file`, or `node --outline 2`), then fetch details only for the part you work on. A whole landing page is megabytes of node data; reading it all wastes your context.
- **For code, read `spec`, not the node file.** `spec` prints one CSS-ready line per visible node (a 3 MB landing page became about 600 lines). Run it once on the whole frame with `--origin` set to the frame's corner, or to where the page content starts, write it to a file with `-o`, and `grep` that file per section.

## Rate limits and the cache

- The REST API answers 429 ("Rate limit exceeded") after a handful of large reads in a row. The CLI waits and retries on its own (up to two minutes) and caches every `file` and `node` read under `~/.figma-access/cache`, so repeating a command costs nothing. Pass `--refresh` only after the design changed.
- Fetch a big frame once with `node <key> <frameId> -o <file>` and give that `.kdl` file to every later `spec` run with `--from <file>`: `spec` then reads any node inside it without calling the API.
- Batch renders: `render <key> id1 id2 id3 ...` is one request for all ids. Rendering icons one call at a time is what usually runs into the limit.

## Hidden layers

- Design files keep a lot hidden: old versions, alternative states, "graveyard" copies, whole duplicated sections. In one real landing page 11,102 of 12,090 nodes were hidden, and some hidden frames sat exactly on top of visible ones (a second navbar, an old shop section).
- `node` removes hidden layers from the saved data by default and counts them in `prunedHiddenNodes`; the outline marks a hidden node with `hidden=#true`. Keep them (`--keep-hidden`) only when the user asks about alternative states.
- The rendered image (`render`) is the truth for what is visible. When the node data and the render disagree, trust the render and look for a hidden layer, a mask, or a clip (`clipsContent`).

## Reading a design image

- An image larger than about 2000 px on a side is shown to you shrunk, and small text and 1 px lines vanish. `render` prints each PNG's size and notes when this applies. Cut a tall page into strips of about 1500 px (any image tool: Python Pillow, `sips` on macOS) and read each strip.
- Render at scale 1 for a reference that matches CSS pixels one to one; scale 2 to read small text or icon detail.

## From design to code

- **Values come from the file; the render decides.** Read colors, fonts, sizes, radii, shadows, gradients and auto layout from `spec` rather than guessing them from the image; `spec` already converts them to CSS (hex colors, flex direction, gap, padding, justify, align, sizing). Where you read the node data yourself: positions are canvas coordinates (subtract the frame's corner, which `spec --origin` does for you), colors are 0..1 floats, and a shadow's `radius` is its blur. When a value and the render disagree (a hidden layer, a mask, a clip, a `LAYOUT DRIFT` mark), the render wins, as "Hidden layers" says.
- **Box, render bounds and export bounds differ.** `[x,y wxh]` in `spec` is the layout box. `render[...]` is what is visible on the canvas (clipped by parents). `export[...]` is the area a file from `render` covers: shadows and blurs grow it (a 40 px button with a 4 px shadow exports as 48 px, shifted 4 px left), masks shrink it to the mask, and clipping by parents is ignored (a decoration hanging 271 px off the frame exports whole). Place an exported image at its `export` (or box, when none is printed) position and size, inside a parent with `overflow: hidden` when the design clips it.
- **Stale boxes.** The API returns the boxes Figma last stored, and they can break the frame's own auto layout rules, usually because a hidden child is still counted or an instance override was not laid out again. `spec` marks such frames `LAYOUT DRIFT (...)`. In one real page a header box was 88 px tall for a 48 px title, so every section below it was placed 38 px too low, and a promo panel's text sat 32 px lower than in the render. Where drift is marked, measure positions on the render (find the first row of text pixels in that area) and follow the frame's gap and padding, not the boxes. A section that overlaps the next one (a negative gap at the page level) usually means the same: its stored height is too large.
- **Line breaks hide in text.** Designers break lines with Shift+Enter, which stores U+2028; `spec` prints it as `\n`. Keep those breaks (`<br>` or `white-space: pre-line`): a 518 px text box whose render is 280 px wide breaks there, not by width.
- **Mixed-style text** shows its runs in `spec` (`runs[ "13": base | " GB ": ... | "| 30 Hari": font Poppins 400 16/24 ]`). Build each run as its own `<span>`.
- **Gradients:** `spec` converts the handles to CSS with the node's size: the linear angle in pixels and stop positions remapped onto the CSS gradient line (they may fall below 0% or above 100%), radial gradients with their centre and radii in pixels. Copy them as printed; a hand-made `linear-gradient(37deg, ...)` from the raw handles came out visibly wrong on a wide banner. Fills are printed top layer first, as a CSS `background` lists them.
- **Device and browser chrome are not the page.** Mockups often include a browser toolbar, status bar or device frame (for example an 80 px "Browser & URL Controls" instance at the top). Leave it out of the implementation, and crop it off the reference image before comparing.
- **Fonts:** `node` lists every font family and text style. Families on Google Fonts (Poppins, Inter, Roboto) can be loaded from there. Brand or commercial families (for example a company's own sans) are not public: ask the user for the font files, and until they arrive use a public stand-in, chosen as the next tip describes, and say so, because text will not match exactly without the real font.
- **Pick a stand-in font by width, not by look.** Text that is wider wraps into extra lines and pushes everything below it. Compare candidates against the design: for a few text nodes take the `render[...]` width from `spec`, measure the same string at the same size and weight in the browser (`canvas.measureText` after `document.fonts.load`), and keep the family whose ratio is closest to 1. In one run the same-file Poppins 700 was 12 to 15% wider than the brand font and broke card titles into three lines; Outfit 700 was within 1%.
- **Images:** `image-fills` downloads the original image behind every `imageRef` in the file, at full resolution, hidden layers included (50 files where 14 were visible); the `image(<ref>, <scaleMode>)` entries in `spec` say which ones the visible design uses. The design may show an image cropped or scaled: FILL → `object-fit: cover`, FIT → `contain`. STRETCH and CROP carry an image transform, and a frame may stack two image fills; for those, and whenever an image sits inside a clipped, rounded frame, render that frame as PNG at scale 2 instead of rebuilding the crop.
- **Masks and illustrations:** a node marked `MASKED` or `ICON` renders right only as a whole. Render it (SVG for vectors, PNG at scale 2 for anything with photos or blurs) rather than rebuilding its parts; a blurred decoration exported 664×450 for a 426×384 panel, which is correct once placed at its `export` position inside the clipped panel.
- **Icons:** render each icon node as SVG (`render <key> <id1> <id2> ... --format svg`, all icons in one call) rather than drawing it or cropping a PNG. Strip fixed width and height if it must scale, and replace hard-coded fill colors with `currentColor` when the icon is recolored.
- **Repeated items** (cards, list rows, tabs) are usually instances of one component: compare their `componentId` to find which ones share code, and build one component with props.
- **Compare by measuring, then by eye.** Capture the page at the design's width with a headless browser, for example `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,<height> --virtual-time-budget=8000 --screenshot=impl.png file:///.../index.html` (the time budget lets web fonts load). Crop the chrome off the reference render, compute the share of differing pixels per section, and look at side-by-side strips and a difference mask. A section well above the others points to a wrong position, gradient or font; when only text edges remain, the layout matches.
- **Real brands:** a design of a real company's site is fine to implement in the user's own project; do not publish it as if it were the company's site.

## Working through the plugin

- `exec` code runs as an `async` function body: `return` what you need, as plain JSON. Write longer scripts to a file and run `exec -f`; shell quoting then never breaks them.
- Look for a `warning` under `resultAnalysis`: an empty or null result usually means a wrong id or name, not "nothing to do".
- After a timeout, the script may still be running inside Figma. Check `logs` and the file before running it again, or the work happens twice.
- The plugin runs only while its window is open in that file. When a command reports no connected file, the user closed it, switched files, or Figma restarted.
- `screenshot` exports through the plugin and caps the longest side at 1568 px, so a full page comes back scaled down. Screenshot sections, or use `render` for an exact full-size image.
- More than one open file: pass `--file <fileKey>` on every command, or commands follow whichever file the user clicked last.
