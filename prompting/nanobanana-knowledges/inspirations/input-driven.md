# Input-driven images

The user supplies content — copy, numbers, steps, an article, an itinerary, a brand name — and the image must carry it accurately. These prompts quote the input exactly, give each text element a role and a place, and keep the amount of text within what the model can render cleanly. Nano Banana Pro is the better choice for dense text. Remind the user to proofread every word and number in the result.

Entries with `[SLOTS]` list an example value for each slot.

---

## I01 · Process infographic

`input: steps` · `infographic` · `[ASPECT_RATIO]`

*Ideas in play:* the content is supplied, not recalled; a clear reading path; one illustration per step.

*Slots:* `[TITLE]` How to Brew Pour-Over Coffee · `[AUDIENCE]` home baristas · `[STEPS]` 1. Heat water to 94 °C · 2. Rinse the paper filter · 3. Add 15 g medium-fine coffee · 4. Bloom with 30 g water for 30 s · 5. Pour to 250 g in slow spirals · 6. Let it drain, about 3:00 total · `[STYLE]` warm flat vector with subtle paper grain · `[PALETTE]` cream #F5EFE4, espresso #3B2A20, terracotta #C8643B, sage #8FA58A · `[ASPECT_RATIO]` 4:5

```text
Create a clean, professional infographic titled "[TITLE]" for [AUDIENCE].

CONTENT — use these steps exactly, in this order, with no added or changed words:
[STEPS]

LAYOUT: the title across the top in a bold rounded serif. The steps flow in a gentle S-shaped path from top left to bottom right, each step a numbered circle, a short label, and a simple illustration of that step's action. Thin dotted connectors guide the eye from one step to the next. Generous margins and even spacing.

STYLE: [STYLE]. Palette: [PALETTE]. Icons share one line weight and one level of detail.

TEXT: only the title and the step texts, all perfectly spelled, sharp and legible. No other text, no logos. [ASPECT_RATIO].
```

---

## I02 · Financial Sankey diagram

`input: income statement figures` · `data visualization` · `16:9`

*Slots:* `[COMPANY]` Lumen Outdoor Co. · `[PERIOD]` FY2026 · `[BRAND_COLOR]` deep green #1F5134 · `[FLOWS]` Revenue $820M → Cost of goods $410M and Gross profit $410M; Gross profit → Operating expenses $250M and Operating profit $160M; Operating expenses → R&D $60M, Sales & marketing $120M, G&A $70M; Operating profit → Tax $35M and Net profit $125M

```text
A premium financial Sankey diagram showing how [COMPANY]'s revenue becomes profit in [PERIOD], landscape 16:9.

DATA — use exactly these flows and values; ribbon widths are proportional to the values:
[FLOWS]

DESIGN: flows run left to right from Revenue to Net profit, drawn as smooth silky Bezier ribbons. Profit-side nodes and ribbons in [BRAND_COLOR]; cost-side nodes and ribbons in a warm muted red; ribbons semi-transparent, nodes saturated and solid. Each node has its name and value in a clean sans-serif next to it, with a small simple icon. The title "[COMPANY] — How [PERIOD] revenue became profit" across the top left.

Background off-white, generous whitespace, no gridlines, no 3D, no shadows. Only the given names and values appear; every number exactly as written.
```

---

## I03 · Retail promotion poster

`input: offer copy` · `promo poster` · `[ASPECT_RATIO]`

*Ideas in play:* each text element numbered with a role, style and position; the product as the visual anchor.

*Slots:* `[STORE]` Harvest Lane Market · `[PRODUCT_VISUAL]` a rustic crate overflowing with crisp red and green apples, a few with leaves, one cut in half · `[TITLE]` Autumn Harvest · `[OFFER]` Buy 2 kg, Get 1 kg Free · `[FOOTER]` This weekend only · 18–19 Oct · `[PALETTE]` warm cream, apple red, leaf green, kraft brown · `[ASPECT_RATIO]` 4:5

```text
A professional promotional poster for [STORE], [ASPECT_RATIO].

VISUAL: [PRODUCT_VISUAL], photographed in warm side light, filling the lower 55% of the poster, sharp and appetizing.

TEXT, exactly as written:
1. "[TITLE]" — large elegant serif in the palette's darkest color, centered in the top quarter.
2. "[OFFER]" — inside a round stamp-style badge, white text on the boldest color of the palette, overlapping the top right corner of the visual.
3. "[FOOTER]" — small clean sans-serif, dark brown, centered at the bottom.
4. "[STORE]" — small wordmark in the bottom right corner.

Palette: [PALETTE]. Subtle paper texture on the background. No other text. All text perfectly spelled and integrated into the design.
```

---

## I04 · Event poster

`input: event details` · `event poster` · `2:3`

*Slots:* `[EVENT]` LOW TIDE · `[EVENT_TYPE]` a summer electronic music night on a beach · `[DATE]` SAT 02 AUG 2027 · `[TIME]` 18:00 — LATE · `[VENUE]` NORTH PIER BEACH CLUB · `[LINEUP]` MARA VELL / KOJI SATO / THE DUNES COLLECTIVE · `[VISUAL_CONCEPT]` a giant chrome moon half-sunk into a pink evening sea, its reflection breaking into ripples

```text
A bold event poster for "[EVENT]", [EVENT_TYPE], vertical 2:3.

VISUAL: [VISUAL_CONCEPT]. Photoreal 3D render with a dreamy grade, fine grain, and a large empty area of sky for type.

TYPOGRAPHY, exactly as written:
- "[EVENT]" — huge, ultra-condensed capitals spanning the full width at the top, partly overlapped by the visual for depth.
- "[LINEUP]" — medium bold capitals in the middle, one name per line.
- "[DATE]" and "[TIME]" — small tracked capitals in the bottom left.
- "[VENUE]" — small tracked capitals in the bottom right.
All type in one color drawn from the visual, high contrast against the background. No other text, no logos. Every word perfectly spelled.
```

---

## I05 · Slide deck from an outline

`input: article or outline` · `slide set` · `16:9 per slide`

*Ideas in play:* plan first, then one image per slide; a design system defined once.

*Slots:* `[SOURCE_TEXT]` the article pasted by the user · `[AUDIENCE]` a company all-hands · `[SLIDE_COUNT]` six · `[LANGUAGE]` English

```text
First, read the content below and write an outline of [SLIDE_COUNT] slides for [AUDIENCE]: a title slide, the key points (one idea per slide, a headline of at most eight words and at most three short bullets), and a closing slide. Then generate each slide as its own 16:9 image, one image per slide — never several slides in one image.

DESIGN SYSTEM for every slide:
- Background: warm beige #F3F0E9 with a faint paper texture.
- Type: an elegant serif for headlines, a clean sans-serif for body text; generous margins; left-aligned.
- Colors: charcoal #2B2B2B for text; terracotta #D67052 and mustard #F0B857 as accents; no neon, no pure black.
- Visuals: one simple flat illustration or one clean minimal chart per slide, in the accent colors, on the right half.
- A small slide number in the bottom right.

Language: [LANGUAGE]. Every word perfectly spelled.

CONTENT:
[SOURCE_TEXT]
```

---

## I06 · Café menu board

`input: menu items and prices` · `menu design` · `3:4`

*Slots:* `[CAFE]` Little Fern · `[SECTIONS]` COFFEE — Espresso 3.20 · Flat White 4.10 · Oat Latte 4.60 · Cold Brew 4.80 / BAKERY — Butter Croissant 3.50 · Cardamom Bun 4.20 · Banana Bread 3.90 · `[CURRENCY]` €

```text
A hand-lettered chalkboard menu for a café called "[CAFE]", photographed straight-on, vertical 3:4.

CONTENT — use exactly these sections, items and prices, in this order:
[SECTIONS]
All prices are in [CURRENCY].

DESIGN: "[CAFE]" at the top in a large flowing chalk script with a small doodle that suits the name. Section headings in chalk block capitals with a hand-drawn underline. Items left-aligned, prices right-aligned on the same line, joined by dotted leaders. Small chalk doodles in the margins of a few items from the menu.

Real chalk texture with dust, slightly uneven strokes and faint ghosting of erased writing; a dark slate board in a thin oak frame; soft warm café light from the left. No other text. Every word and number exactly as given.
```

---

## I07 · Recipe card

`input: recipe` · `recipe card` · `4:5`

*Slots:* `[DISH]` Lemon Ricotta Pancakes · `[SERVES]` Serves 4 · 25 min · `[INGREDIENTS]` 250 g ricotta · 2 eggs · 120 g flour · 1 tsp baking powder · 1 lemon, zested · 180 ml milk · butter for the pan · `[METHOD]` 1. Whisk ricotta, eggs, milk and zest. 2. Fold in flour and baking powder. 3. Cook small ladles in butter, 2 min per side. 4. Serve with berries and honey.

```text
A beautifully designed recipe card for "[DISH]", vertical 4:5.

TOP HALF: an overhead food photograph of the finished dish on a speckled ceramic plate on a light linen cloth, soft window light from the left, a few garnish ingredients scattered naturally.

BOTTOM HALF, on warm off-white paper with a subtle texture:
- Title "[DISH]" in an elegant serif, and below it "[SERVES]" in small caps.
- Left column, "INGREDIENTS": [INGREDIENTS] — one per line.
- Right column, "METHOD": [METHOD] — one numbered step per line.

Use these texts exactly. Muted sage and butter-yellow accents, thin divider lines, generous spacing. No other text. Every word and quantity perfectly spelled.
```

---

## I08 · Illustrated timeline

`input: dated milestones` · `timeline` · `16:9`

*Slots:* `[TITLE]` Ten Years of Fieldhouse · `[MILESTONES]` 2017 — First wall opens in a garage · 2019 — Kids' climbing club starts · 2021 — New 1,200 m² gym · 2023 — Youth team wins nationals · 2026 — Second location opens · `[STYLE]` friendly flat illustration with chalky textures · `[PALETTE]` chalk white, forest green, hold orange

```text
An illustrated horizontal timeline titled "[TITLE]", landscape 16:9.

MILESTONES — use exactly these years and texts, in order from left to right:
[MILESTONES]

LAYOUT: one bold horizontal line across the middle. Each milestone is a dot on the line with its year in large bold numerals, a short text label, and a small vignette illustration above or below (alternating) that shows the moment. Even spacing between milestones.

Style: [STYLE]. Palette: [PALETTE]. The title at the top left in a bold sans. No other text. Every year and word exactly as given.
```

---

## I09 · Product comparison sheet

`input: product specs` · `spec sheet` · `4:5`

*Slots:* `[PRODUCT_LINE]` the Aria wireless headphone range · `[MODELS]` ARIA ONE, ARIA PRO, ARIA MAX · `[HIGHLIGHT_MODEL]` ARIA PRO · `[ROWS]` Battery: 30 h / 40 h / 60 h · Noise cancelling: — / Adaptive / Adaptive + · Weight: 230 g / 250 g / 310 g · Price: $149 / $249 / $399

```text
A clean, premium product comparison sheet for [PRODUCT_LINE], vertical 4:5.

TOP: one product render per model, side by side on a soft grey gradient, the same three-quarter angle and scale, each with its name below: [MODELS].

TABLE BELOW, with exactly these rows and values (columns in the same order as the models):
[ROWS]

Table style: thin light-grey rules, no heavy borders, row labels left-aligned in medium weight, values centered, the [HIGHLIGHT_MODEL] column subtly highlighted with a pale tint and a small "MOST POPULAR" tag above it. Modern sans-serif throughout, charcoal on white. No other text. Every value exactly as given.
```

---

## I10 · Magazine spread from a full text

`input: article text` · `editorial layout` · `3:2`

*Slots:* `[ARTICLE_TEXT]` the user's article; under about 250 words stays most legible.

```text
Put the article below, verbatim, into a photograph of a glossy magazine spread lying open on a light oak table. Left page: a full-bleed photograph that illustrates the article's subject. Right page: the headline in a large high-contrast serif, a short standfirst, the body text in two justified columns with a drop cap, and one bold pull quote taken word for word from the article. Brave, confident editorial formatting with generous margins.

Soft daylight from the upper left, a gentle curve in the paper at the gutter, a faint gloss highlight on the photo page. Landscape 3:2. Use the text exactly as written; no invented words.

ARTICLE:
[ARTICLE_TEXT]
```

---

## I11 · Kids' travel journal from an itinerary

`input: city and stops` · `illustrated journal page` · `3:4`

*Slots:* `[CITY]` Lisbon · `[DAYS]` 1 · `[STOPS]` Belém Tower → Pastéis de Belém → Tram 28 → Alfama viewpoint → LX Factory

```text
A child's crayon travel journal page titled "[CITY] Travel Journal", vertical 3:4, drawn as if by a happy 9-year-old with wax crayons and colored pencils on lined notebook paper.

A winding dotted route crosses the page, connecting these stops in order: [STOPS]. Each stop has a small naive drawing of the place or food and its name in wobbly hand lettering. Planned for [DAYS] day(s); if more than one day, split the route with "DAY 1", "DAY 2" labels.

Decorations around the edges: a sun with a face, a little airplane, stamps, stars, a ticket stub taped on with crayon tape, a smiling family of stick figures. Bright primary colors, visible crayon texture, slightly uneven lines. The only text is the title, the stop names and any day labels, all spelled correctly.
```

---

## I12 · Editorial data chart

`input: data series` · `chart` · `4:5`

*Slots:* `[TITLE]` Who rides the night tram? · `[SUBTITLE]` Share of trips after 22:00, by purpose · `[DATA]` Going home from work 38% · Social & dining 27% · Night-shift commute 19% · Students 11% · Other 5% · `[SOURCE]` Source: City Transit Survey 2026

```text
An editorial-quality horizontal bar chart in the style of a premium newspaper's data desk, vertical 4:5.

Title "[TITLE]" in a bold serif at the top left; subtitle "[SUBTITLE]" in a lighter sans below it.
DATA — exactly these categories and values, sorted from largest to smallest:
[DATA]

Bars in a single deep blue, the largest bar highlighted in coral; each value printed at the end of its bar; category labels left-aligned; no gridlines, no axis box, no 3D, no shadows. A small, simple line illustration of the chart's subject in the empty space at the bottom right. "[SOURCE]" in small grey text at the bottom left. Off-white background. No other text. Every value exactly as given.
```

---

## I13 · Book cover

`input: title and author` · `book cover` · `2:3`

*Slots:* `[TITLE]` The Salt Archive · `[AUTHOR]` Mira Okonkwo · `[GENRE]` literary mystery · `[COVER_CONCEPT]` a single old brass key half-buried in white salt crystals, casting a long blue shadow · `[TAGLINE]` Some secrets preserve themselves.

```text
A professional book cover for "[TITLE]" by [AUTHOR], a [GENRE], vertical 2:3, ready for a bookstore shelf.

IMAGE: [COVER_CONCEPT]. Photographic, minimal, lots of negative space, a restrained palette with one accent color.

TYPOGRAPHY, exactly as written:
- "[TITLE]" — large, refined serif, centered in the upper third, with generous letter spacing.
- "[AUTHOR]" — clean small caps at the bottom.
- "[TAGLINE]" — small italic just below the title.
No other text, no publisher logos, no barcode. Every word perfectly spelled. The title stays readable at thumbnail size.
```

---

## I14 · Video thumbnail

`input: video topic and hook` · `thumbnail` · `16:9`

*Slots:* `[TOPIC]` building a tiny cabin in 30 days · `[HOOK_TEXT]` 30 DAYS! · `[SCENE]` a finished tiny wooden cabin glowing at dusk in a snowy forest · `[PERSON]` a bearded builder in a red flannel shirt (fictional)

```text
A high-click video thumbnail about [TOPIC], 16:9, readable at small size.

LEFT 45%: [PERSON], from the chest up, with an excited, wide-eyed expression, pointing toward the right. Bright clean light on the face, a subtle rim light, a slight cutout outline to separate them from the background.
RIGHT 55%: [SCENE], saturated and sharp.
A bold yellow curved arrow from the pointing hand to the scene's main subject.

TEXT: "[HOOK_TEXT]" in massive heavy sans-serif capitals, white with a thick black outline and a drop shadow, in the top right. No other text. High contrast, punchy colors, uncluttered.
```

---

## I15 · Brand-name typographic window poster

`input: brand name and slogan` · `typographic poster` · `[ASPECT_RATIO]`

*Ideas in play:* the brand's words become the window the photo is seen through; a muted palette with one brand accent.

*Slots:* `[BRAND]` ORBITA · `[SLOGAN]` MOVE QUIET · `[SUBJECT]` a cyclist in grey crossing a fog-covered concrete bridge at dawn · `[ACCENT]` a red bicycle frame · `[YEAR]` 2027 · `[ASPECT_RATIO]` 4:5

```text
Act as a senior editorial designer and typographer. Create a [ASPECT_RATIO] typographic poster for [BRAND].

TYPOGRAPHIC MASK: "[SLOGAN]" set as massive ultra-bold heavy sans-serif capitals with tight kerning, filling the frame from edge to edge. The letters are windows: the background is solid white, and a photograph is visible only through the letterforms.

PHOTOGRAPH INSIDE THE LETTERS: [SUBJECT]. A refined, muted palette — soft slate blues, charcoal greys, creamy off-whites — with one saturated accent: [ACCENT], positioned so it falls inside one of the letters as the focal point. Soft studio-like diffused light, clean matte finish, no noise.

BRANDING: a tiny "[BRAND]" wordmark in the bottom left; a small vertical tagline "[SLOGAN] — [YEAR]" along the right edge in a microscopic sans. No other text. Every word perfectly spelled.
```

---

## I16 · Juice promo with price and offer

`input: offer details` · `retail social ad` · `4:5`

*Slots:* `[PRODUCT]` a glass bottle of cold-pressed orange-carrot juice with a kraft label reading "SUNNY PRESS" · `[JUICE_COLOR]` bright orange · `[INGREDIENTS]` orange halves, carrot ribbons, ginger slices · `[BG_COLOR]` deep tangerine · `[TAGLINE]` Sunshine, cold-pressed · `[DISCOUNT]` 30% OFF · `[PRICE]` $4.99 · `[CTA]` ORDER NOW

```text
Vertical 4:5 social ad. [PRODUCT], centered, covered in condensation, its label unchanged and legible. A [JUICE_COLOR] liquid splash wraps around the bottle; ice cubes and [INGREDIENTS] float around it in a controlled arc. Background: a [BG_COLOR] gradient with a soft vignette and fine grain.

TEXT, exactly as written:
- Top left: "FRESH JUICE" in heavy rounded capitals, and below it "[TAGLINE]" in a light script.
- Right side: "[DISCOUNT]" inside a bold circular ring.
- Lower right: "[PRICE]" inside a solid white circle.
- Bottom right: a pill-shaped button reading "[CTA]".
A few hand-drawn white doodle arrows pointing at the bottle. Studio key and rim light, 85mm look. No other text, no watermark. Every word and number exactly as given.
```

---

## I17 · Film one-sheet from a title and credits

`input: film title, tagline and credits` · `theatrical movie poster` · `2:3`

*Ideas in play:* one image that sells the film's dread or longing, a measured title zone over empty atmosphere, a four-line text lockup, and a medium slot that settles photo versus painted key art.

*Slots:* `[TITLE]` The Last Ferry North · `[GENRE]` slow-burn maritime thriller · `[MEDIUM]` painted key art in oil on board, visible brushwork, no photographic look · `[KEY_ART]` a lone ferry with one lit cabin window crossing a black fjord under a low wall of storm cloud, a lighthouse beam cutting the rain on the far shore · `[ACCENT]` the cabin window and the lighthouse beam in sodium orange #E8892B · `[TAGLINE]` Nobody boards twice. · `[CREDIT_LINE]` A film by Ilse Varga · `[RELEASE_LINE]` IN CINEMAS 14 MARCH

```text
The official theatrical one-sheet for "[TITLE]", an original [GENRE], vertical 2:3, printed cinema-poster quality. An original film; nothing copied from any existing poster or actor.

KEY ART, [MEDIUM]: [KEY_ART]. The figure or main subject stays small against its setting, so the atmosphere tells the story. The upper third is open atmosphere — sky, fog or darkness — left empty for the title.

PALETTE: cold and mostly desaturated; [ACCENT] is the only warm or saturated color, used once.

LAYOUT: title zone in the top 30%; key art in the middle; credit zone in the bottom 12% on a darkened band of the same scene.

TEXT, exactly as written, no other text:
1. "[TITLE]" — large refined serif capitals, centered in the title zone, spanning about 80% of the width, readable at thumbnail size.
2. "[TAGLINE]" — small light italic, centered just below the title at about one-fifth of its height.
3. "[CREDIT_LINE]" — small tracked sans-serif capitals, centered in the credit zone.
4. "[RELEASE_LINE]" — medium bold condensed sans-serif capitals, centered at the very bottom.
Every word perfectly spelled. No billing block, no studio logos, no rating box, no barcode, no watermark.

What would be wrong: a crowded collage of faces, a recognizable actor, text over the main subject, or a second accent color.
```

*Riff on it:* switch `[MEDIUM]` to "photorealistic 35mm film still with fine grain" for a live-action look, or to any medium in the illustration list of `../references/prompting-guide.md`, "Describe like a photographer" (watercolor, gouache, risograph, linocut…); set the title huge across the middle with the key art visible only inside the letterforms; add a billing block line only when the user supplies the names.
