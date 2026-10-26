# Type design

What a type designer knows that the drawing language does not enforce. Numbers are for a font of 1000 units per em; scale them for another UPM. They are starting points that the proofs confirm or correct, not laws.

## 1. From brief to parameters

Settle these decisions first, in this order, and write each one in `brief.md` with its reason. Each later decision follows from the earlier ones.

| Decision | Range | What it does |
| --- | --- | --- |
| Genre | grotesque, neo-grotesque, geometric, humanist sans; old-style, transitional, didone, slab serif; monospace; display | sets the expectations for everything below |
| Use | text (9 to 14 px), UI, display (32 px and up), both | text needs larger x-height, more open apertures, looser spacing and lower contrast |
| x-height | 0.66 to 0.76 of the cap height | large reads bigger and friendlier at small sizes; small is more classical |
| Contrast | thick to thin from 1:1 (monoline) to 1:6 (didone) | sans 1:1 to 1:1.3; old-style 1:2 to 1:3; didone 1:4 and more |
| Stress | vertical (angle 0) or diagonal (pen angle 20 to 40) | humanist and old-style lean; neo-grotesque, geometric and didone stand upright |
| Width | condensed (n about 0.75 of normal), normal, wide (about 1.2) | |
| Aperture | closed to open | how far c, e, s, a open; open reads better small |
| Terminals | cut level, cut upright, angled, round, ball | one decision, applied to every terminal |
| Weight range | the masters and styles asked for | light and bold ends of the axis |

Typical vertical metrics, as fractions of the em: cap height 0.66 to 0.72, x-height 0.46 to 0.55, ascender (h, l) 0.72 to 0.78 (usually a little above the cap height), descender (p, g) -0.20 to -0.25. Figures as tall as the capitals, or a little shorter. Overshoot of round shapes 1.0 to 1.5% of the em (10 to 15 units), a little more for pointed apexes and vertexes (A, V, v, w).

Stems per weight, as a fraction of the x-height, for a sans: Thin 0.04, Light 0.11, Regular 0.16 to 0.18, Medium 0.20, Bold 0.28 to 0.30, Black 0.36. Capital stems 5 to 10% heavier than lowercase stems. These are what `dfont new` starts from.

## 2. Proportions

### Lowercase, relative to the ink width of n

| Group | Width | Notes |
| --- | --- | --- |
| n h u | 1.00 | u is n turned, with its own stem on the right |
| m | 1.55 to 1.65 | two counters, each a little narrower than n's |
| o | 1.03 to 1.10 | wider than n so it looks as wide |
| c e | 0.90 to 0.98 of o | open shapes look wider than they are |
| b d p q | about o, plus the stem | the bowl joins the stem thinned |
| a s | 0.85 to 0.92 | s is narrow; its spine is its heaviest stroke |
| v x y | 0.95 to 1.05 | |
| w | 1.40 to 1.50 | |
| r f t | 0.55 to 0.70 | r's arm, f's and t's bars set their width |
| i l j | stem only | |
| k | 0.90 to 1.00 | |
| z | 0.85 to 0.95 | |

Geometric designs widen the round letters (o near a circle) and narrow the rest less; humanist designs vary widths more; neo-grotesques even them out.

### Capitals, relative to H

| Group | Width |
| --- | --- |
| O Q C G D | 1.05 to 1.20 (O widest) |
| H N U A V X Y T Z K | 0.90 to 1.00 |
| B E F L P R S | 0.75 to 0.88 (E F L narrowest) |
| M W | 1.15 to 1.35 |
| I J | stem; J often 0.6 |

### Figures

Tabular figures share one advance width (0.55 to 0.62 em in a sans), set with `g.fixed()`, so columns line up. Their shapes follow the capitals: zero is a narrow O, and the round figures (0 3 6 8 9) overshoot like O.

## 3. Optical corrections

Shapes that are geometrically equal do not look equal. Each correction below is in nearly every good typeface.

- **Horizontals are thinner than verticals.** Bars, crossbars and the tops of bowls are 80 to 90% of the stem in a sans, much less in a serif. A geometrically equal horizontal looks heavier.
- **Round strokes are heavier than straight ones.** The thickest part of a bowl is 3 to 8% heavier than a stem (`round_gain`), because it is thick only for a moment.
- **Round and pointed shapes overshoot** the baseline, x-height and cap height, or they look too small.
- **Joins are thinned.** Where an arch leaves a stem (n, m, h), where a bowl meets a stem (b, d, p, q), where diagonals meet (v, w, x, A, V), the strokes thin (`w=0.5` to `w=0.8` at the join), more in bold, or the join fills in as a dark spot. In heavy weights, a notch or ink trap may be needed.
- **The optical center is above the geometric one.** The crossbar of H, A and e, the waist of B, 8, 3 and S, the junction of K and k, the middle arm of E sit a little above the middle (51 to 55% of the height), and the upper part of two-storey shapes is a little smaller and narrower than the lower part.
- **Diagonals are a little thinner than stems** (90 to 97%), because their horizontal section is wider. In a contrasted design, the stroke from top left to bottom right is the thick one.
- **The x of a crossing** is thinned where the strokes cross, and the strokes are offset so they seem to continue straight.
- **Dots are larger than the stem**: the dot of i and j, the period, colon and the dieresis are 1.1 to 1.3 times the stem, round or matching the terminal style. The i dot sits about one stem above the x-height, never closer than the gap between the stem and its own width.
- **Arches and bowls** are not circles: a superellipse (Hobby `tension` 0.9 to 0.95, or `square` above 0.5523) looks rounder and stronger in a sans; a true circle looks pinched at its diagonals.
- **Bold is not a thicker regular.** As stems grow, counters must not close: letters widen (bold n is 5 to 12% wider than regular), sidebearings shrink a little, joins thin more, bars thin relative to stems, and the x-height may rise slightly. Small counters (a, e, s) need the most care.
- **Light is not a thinner regular** either: letters narrow a little and need slightly more space.

## 4. Building the character set

Draw in this order. Each group reuses the shapes of the one before, through helpers in `lib.py`, so the family stays consistent.

1. **Control glyphs**: n, o, then H, O. Everything is measured against them. Do not move on until they are right in every master.
2. **Arches**: h (n with an ascender), m (two arches, each a little narrower), u (n turned), r (n's arch cut short, a stub or a tear), then i, l, j (stems; j with a tail).
3. **Bowls**: c, e (o opened; e's bar a little above the middle), b, d, p, q (o's bowl joined to a stem, with thinned joins), then a, g, s (the hardest; their counters and spines set the color of text).
4. **Diagonals**: v, w, y, x, k, z. Cut the apexes and vertexes, or let them overshoot when pointed.
5. **Crossbar letters**: f, t (bar on the x-height, cut where it meets the stem).
6. **Capitals**: H I L E F T, then O C G Q D, B P R, U J, A V W X Y K M N Z, S.
7. **Figures**: zero, one through nine, tabular.
8. **Marks**: the combining accents and their `.case` versions; then check every automatic accented glyph.
9. **Punctuation**: period, comma, colon, semicolon, hyphen, quotes, then the rest. Sizes: the period is the i dot on the baseline; comma and quotes share one shape; the hyphen is a little above half the x-height, about 0.3 em wide; the en dash 0.5 em, the em dash 1 em; parentheses and brackets reach from the descender to the ascender or a little less; quotes hang from the cap height.
10. **Symbols**: math signs centered on one height (a little above half the x-height), all the same width; currency on the figures; the rest by their nearest relatives.

Glyphs that the automatic builder makes from a base and a mark need only the base and the mark. Glyphs with no canonical decomposition (ae, oe, oslash, eth, thorn, germandbls, ordfeminine, the fractions, the superscripts) are drawn, usually from refs of existing glyphs.

## 5. Spacing

Spacing sets the rhythm of text; it matters more than any single glyph.

1. Space the control glyphs first, by eye on the control and spacing sheets: in `nnnn`, the white between two n's stems is about half to two thirds of the counter inside n in a text face, less in a display face. `oooo` and `nnoonn` must look evenly spaced: round sides get 70 to 85% of a straight side's sidebearing.
2. Space the capitals on `HHOHHO` the same way. Capitals take more space than lowercase; O takes 60 to 80% of H's sidebearing.
3. Spread the spacing to every other glyph with `dfont space`, then check each on the spacing sheet between its controls (`nn?nn`, `oo?oo`, `HH?HH`, `OO?OO`).
4. Typical sidebearings, as fractions of the straight one: a straight side 1.0; a round side 0.7 to 0.85; the shoulder of n, h, m 0.85 to 0.95; an open side (c, e, r right) 0.4 to 0.7; a diagonal (v, w, y, A, V) 0.05 to 0.3; a bar end (T, F, L right) 0.1 to 0.3.
5. Never fix spacing with kerning. Kerning is for pairs whose shapes leave a hole or a clash that no sidebearing could fix for every neighbor.

## 6. Kerning

Kern the pairs that occur in text and clearly need it, and stop. A few hundred class pairs make a well-kerned Latin font; thousands of tiny kerns do not make it better.

- Capitals with diagonals and overhangs: A with V W Y T and quotes; L with T V W Y and quotes; T V W Y P F with A, with lowercase (a c e o s r u y), with period and comma.
- Lowercase: r v w y with period and comma; f with quotes; k with o.
- Punctuation: quotes with A; period and comma after T V W Y F P r v y.
- Do not kern tabular figures (they must line up), and kern round-to-round or straight-to-straight pairs almost never.
- Typical values at 1000 units: AV and VA -60 to -90; T with lowercase -50 to -90; L with T or V -60 to -100; period after T or V -60 to -100; r period -30 to -50.
- Check every accented member of a kerned class on the kerning sheet: `dfont kern` lists those that collide, such as T with odieresis whose dots touch T's bar.

## 7. Weights and interpolation

- The masters are the axis ends and, when the axis is long, a middle master. Instances in between are interpolated; check them on the weights sheet, which shows the variable font in even steps.
- Weight steps should look even, not be even: stems usually grow faster towards the bold end. A middle instance whose stems are the arithmetic mean of Light and Bold looks too bold; move the instance location, not the masters.
- Every master needs the same corrections: what is a slight thinning in Light is a deep ink trap in Black. Write corrections as parameters that grow with weight, never as fixed numbers.
- Marks, dots and punctuation grow with weight too. A mark offset written in fixed units collides with its base in bold: write the gap from the parameters.

## 8. Accents

- Marks are a little lighter than stems (80 to 90%), and sit as far above the x-height as about a third of the stem gap between i's dot and stem, so they read as part of the letter but never touch it in any weight.
- The acute and grave lean at 40 to 60 degrees from horizontal, about 0.35 to 0.45 of the x-height long; the circumflex and caron are as wide as the counter of o; the two dots of the dieresis are the i dot, their gap about the counter of n.
- `.case` marks for capitals are flatter and closer to the letter, so accented capitals fit under the ascender as far as possible.
- Put the `top` anchor of a base at its optical center: over the stem of i and l, a little right of center over a and r, centered over symmetric letters.

## 9. Originality

- A reference image shows the genre and mood the user wants. Never trace it, measure it, or reproduce a known typeface's distinctive glyphs. Draw from the brief's decisions.
- A family name must not be one already in use by a known typeface. Search for it when you can, and record in the report whether you checked.
