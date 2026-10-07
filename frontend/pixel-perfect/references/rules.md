# Hard rules

A score counts only when the code that produced it follows every rule here. A pass reached by breaking one is not a pass.

## What is code and what is an asset

- **Always code:** text, shapes, borders, dividers, gradients, shadows, backgrounds made of flat color or gradient, and simple geometric glyphs (chevron, plus, close, check, dots, hamburger). These are never cropped from the design, in whole or in part.
- **Irregular filled shapes** (a slanted panel, a curved backdrop) are code too: trace the outline with `pp measure outline` and draw it as an SVG path with the measured fill or gradient.
- **Raster content** (photos, background images, textures): crop it from the design with `pp measure crops` and use the file as an asset.
- **Icons, logos, illustrations**, in this order of preference:
  1. a file the user supplied;
  2. the project's existing icon library, when the icon is recognizably from it;
  3. a crop from the design, as a last resort.
- **A crop must be complete.** An image the design cuts off is substituted before anything is cropped: `pp measure substitute` writes `<design>.subs.<ext>`, in which the cut-off slot shows a complete image of the same kind from the same design, and the asset is cropped from that substitute's full box. A partial image is never shipped as an asset. Text of that item which the same edge slices mid-way is substituted the same way, and the item then carries the substitute's text; text that can be read in full is left as the design shows it. The cut-off item itself is built whole, with every part its complete siblings have; only its container clips it. When nothing in the design can stand in, ask the user for the file; if there is none, use a neutral placeholder of the size the layout gives the image and record it as an acknowledged deviation.
- **A crop must be clean.** The file may not contain any code-built UI: no text, button, badge or overlay drawn on top of the image. When the image is partly covered, in this order:
  1. ask the user for the original;
  2. if there is none, and the cover is an opaque shape of one color (a badge, a tab, a play icon), crop the image with that UI blanked: `pp measure crops --blank` paints the UI's own pixels a neutral gray. Every blanked pixel must end up under the same UI built in code. The area is scored like any other, so a blank that is not covered shows in the diff;
  3. otherwise (text over a photo, a translucent overlay, a cover that hides most of the image) use a neutral placeholder of the measured size.

  A blanked crop and a placeholder are each an acknowledged deviation, and the overlaid UI is built in code either way.
- **Every crop, blank and placeholder is declared** in the inventory with its source image and rectangle, and appears in the final report.
- Never crop a region to make a difficult area match.

## Fonts

- Propose each font from its glyph shapes and the project's existing fonts, and confirm it with the user before implementing. Settle family and weight for every text style by zooming the design's text beside a render of each candidate, not at a glance.
- Ask the user for the real font files, or where they are served from, before proposing a substitute. Only when the real font is unavailable, use the closest available one and record it as an acknowledged deviation.
- With a substitute font, set the size, weight and line height that the design's text measures, and stop there. Do not add letter spacing, shrink the font or force line breaks to make the substitute as wide as the original: that trades a visible flaw at every size for a few points of score at one.
- Text is never excluded from the score, whatever the font.

## Code quality

- Lay out with normal flow, flexbox or grid. Use absolute positioning only where the design truly overlaps elements (badges, overlays, decorations).
- Anchor every absolutely positioned element to the content it belongs to, not to a full-width ancestor. A carousel arrow placed against the page edge sits correctly at the design width and drifts away from its carousel at any other.
- No fixed pixel widths or heights on containers whose size comes from their content. Sizes come from padding, gaps and content.
- No magic offsets: no transform, negative margin or relative nudge whose only purpose is to move pixels into place.
- Text wraps where its container makes it wrap. No line break inserted to copy the design's wrapping.
- Components take their content as props or children. A component that only works with the exact strings in the design is not finished.
- Every raster image has an explicit CSS width and height: its pixel size divided by the design scale. Not an HTML attribute, and not a `srcset` density hint alone.
- A component carries what it needs. It does not rely on a style it inherits from one particular parent (`list-style`, font, line height, color).
- A component looks the same wherever it is put. Its appearance comes from its own classes and props, and its variants are its own modifiers; no rule reaches into it from the section around it. A component styled through its section cannot be rendered, scored or reused alone.
- Name classes by the project's convention. When the project has none (plain HTML and CSS written from scratch), use BEM: `block`, `block__element`, `block--modifier`. Style by class only, with no tag, attribute or sibling selectors and no descendant selector that crosses from one block into another. A block placed inside another also takes the parent's element class for its position there (`arrow hero__arrow`).
- Variants and states are real: hover is `:hover`, focus is `:focus-visible`, a disabled button is disabled. No test-only props, classes or attributes on components.
- Use semantic elements: a button is a `button`, navigation is a `nav`, headings are headings.
- When a measured value equals an existing project token (color, spacing, radius, font size), use the token. When it does not, do not bend the value to the nearest token; use the measured value in the project's idiom.
- The layout must be fluid between and beyond the design widths, even though only the design widths are verified. With several breakpoint images, derive the breakpoints from them.

## Scoring honesty

- Only `pp check` and `pp diff` output is a score. `pp compare`, `pp fit` and one-off scripts measure; a number from them is never reported as a match.
- A capture that reported `valid: false` is not evidence, and neither is any score made from one.
- Thresholds change only on the user's instruction. `thresholds.overridden` in every `diff.toon` must match what the user asked for.
- Never mask, blank out, crop away or shrink a region to exclude it from a diff. A blanked crop is not an exception: it changes an asset, never a reference, and its area is scored in full.
- The reference is always a crop of the design: the original image, or its `.subs` copy when Phase 1 made one. The `.subs` copy differs from the original only inside the slots of cut-off images, each filled from another image of the same design and listed in the inventory. No other edit of a design is ever a reference, and neither is a previous render. Its rectangle is measured on the design. It is never read from where a render puts the element, and never re-cropped to follow the code: a reference that moves with the render can no longer show that the render is in the wrong place or the wrong size.
- Every level is scored on its own: a component alone, a section in place, a page whole. A section's score says nothing about the components in it.
- Every reported score comes from the latest code. After any change to a component, its earlier scores are void until re-run.

## Self-check before reporting

Answer each from the actual files, not from memory:

1. Does every image file added to the project appear in the inventory's asset list, is every listed crop free of code-built UI, with each blank listed and wholly covered by the UI built in code, and is every one a complete image, with each substitution listed?
2. Does any image asset contain text, a border, a shadow, a gradient or a button that should have been code? Is `images_not_1to1` empty in the final rounds, or only naming images the user supplied?
3. Is there any absolute positioning, fixed size, transform, negative margin, letter spacing or forced line break that exists only to match pixels?
4. Does every component still render correctly with different text or content? Does every section hold together in its wider scale-1 shot, and every page in its wider and its narrower one?
5. Are all states reached through real interaction, with no test-only API left in components?
6. Was every component scored alone, and does every component's look come from its own classes? Once the final round has run: is every temporary harness removed, with no harness-only code left behind?
7. Does the latest row of every component variant, every section and every page in `pp scores` come from the current code and a valid capture, with `pass: true` or a status of `stopped` or `accepted deviation` that the user has seen?
8. Is `thresholds.overridden` empty in every `diff.toon`, or exactly what the user asked for? Is `reference_changed` empty in `pp scores`, or explained by a reference that was measured wrongly the first time, or by a substitution made after work had begun?
9. Are all image and text substitutions, blanked crops, font substitutions, placeholders and unverified behaviors written down for the report?
