# Craft moves

A grab bag of moves that often lift a prompt from a generic description to something campaign-grade. They are ideas to reach for, not rules: none is required, many can be bent or inverted, and the best prompt for a task may use a move that is not here at all. When a draft feels flat, skim this list for one or two sparks — or ignore it and follow your own instinct for the image.

## 1. Cast the model as a specialist

Open with a role and a reference standard, not "make an image of".

- Weak: `A picture of a perfume bottle, high quality.`
- Strong: `Act as a senior fragrance art director and still-life photographer shooting the hero key visual for a flagship launch. The standard is a full-page print ad: every surface, reflection and letter must survive a 4K crop.`

The role sets the taste level. The reference standard ("must survive a 4K crop", "clean enough to be used as a press image") gives the model a test to pass.

## 2. Name one core idea

Give the image a title or a one-sentence concept before any detail: `CORE IDEA: "THE SCREEN BECOMES THE WORLD"`, `CONCEPT: Controlled unsealing — nothing breaks, everything separates perfectly.` A named idea makes every later choice serve one story and stops the model from adding unrelated spectacle.

## 3. Resolve the variables before the phases

When the prompt is a template (`[BRAND]`, `[COLOR]`, `[PRODUCT]`), add a short block that tells the model what to decide first, and how:

```text
RESOLVE FIRST: (1) PRIMARY COLOR — the most saturated color of the brand's identity; (2) TEXT COLOR — white, cream or black, whichever contrasts most with PRIMARY COLOR; (3) HERO SUBJECT — the brand's single most recognizable product; (4) LINE — a 3–6 word campaign line in the brand's voice.
```

Then refer to the resolved names in capitals (`PRIMARY COLOR`, `HERO SUBJECT`) in every later phase. This keeps a long prompt internally consistent.

## 4. Use conditional rules for unknown inputs

When the same prompt must handle different subjects, map each case to a treatment:

- `If the color is silver or grey → brushed circular-grain steel; gold → warm brushed brass; black → anodized aluminium; white → matte ceramic.`
- `If the product is a vehicle → keep it heroically grounded, worm's-eye view, never floating. If it is apparel → a mid-air leap against open sky.`
- `If the upload is a 3D object → …; if it is a flat illustration → …`

## 5. Divide the canvas with numbers

Replace "nice layout" with zones and shares:

- `The upper PHOTO ZONE fills the top 60% of the canvas; the lower GRAPHIC ZONE fills the remaining 40%, divided by a hard horizontal cut — no fade.`
- `The logo spans 40–50% of canvas width, centered in the top 30%.`
- `The product occupies 55–65% of frame height; keep 85–90% of the design free of decoration.`
- `Rule of thirds: subject on the right 60%, intentional negative space on the left.`

Numbers are the cheapest way to get a professional layout.

## 6. Build depth in three layers

Name the foreground, midground and background, and what each does: `FOREGROUND: two wet stones and a thin mist frame the bottom edge. MIDGROUND: the hero product, razor sharp. BACKGROUND: giant typography and dark architecture, progressively softer.` Layering is what makes a poster feel photographed rather than assembled.

## 7. Let the subject break the frame

The strongest ad devices are boundary crossings:

- a **breakout**: the subject crosses from the photo zone into a flat color zone and casts a soft shadow on it;
- an **overlap**: the product sits in front of giant headline letters and hides part of them;
- a **portal**: the image on a screen spills out into the physical room;
- a **mask**: the photo is visible only through the letterforms.

Say which device you use, which element crosses which boundary, and by how much (`at least 20–30% of the subject's height`).

## 8. Light like a gaffer

Name the key, fill and rim, their direction, size, color temperature and ratio:

`Key: one large softbox camera-left, raised 40°, 5600K. Fill: white bounce camera-right at 15% of the key. Rim: thin strip light behind, cool white, tracing the bottle's right edge. Lighting ratio 3:1. No spotlight pools, no lens flare.`

Then say what the light is *for*: `the light exists only to reveal the emboss topography`, `light only reveals, never performs`. Purpose stops the model from adding showy effects.

## 9. Specify materials as physics

Describe how a material behaves under light, not only its name:

- `high-gloss latex stretched to near-bursting; subsurface scattering makes thin edges glow`;
- `brushed metal with concentric polishing marks that catch the light differently at each angle`;
- `vinyl wrinkles show plastic stress and catch tight speculars on the ridges, unlike soft paper creases`;
- `leather: visible grain, pores, stitching thread, painted edges; specular hotspots only on the metal hardware`.

## 10. Add anti-CG realism cues

Generated images fail by being too clean. Ask for controlled imperfection: `fine uniform grain at ISO 800 equivalent`, `microscopic surface imperfections`, `dust motes in the key light`, `chromatic aberration only at the extreme frame edges`, `natural skin texture with visible pores`, `no AI-plastic normals on leather or fabric`.

## 11. Control the palette with roles

List colors with names, hex codes and jobs, and a rule for each:

```text
PALETTE: Obsidian #0A0B0D (environment), Graphite #1A1E24 (surfaces), Soft White #F2F4F6 (all type), Signal Orange #FF5A1F (one accent only — the product's strap and nothing else). The surrounding scene stays 90% neutral; the accent appears once.
```

Accent discipline — one saturated color, used once — reads as premium.

## 12. Typeset like a designer

For every text element give the exact words, typeface character, weight, case, tracking, color, position and size relative to something else:

`"FIELD NOTES" — ultra-condensed grotesk, black weight, all caps, tracking −10, soft white, set behind the product so the product hides the lower third of the letters; spans 90% of canvas width.`

Add hierarchy (`the headline is the only large type; feature labels are ~1/12 of its height`) and a stop rule: `No other text. All text perfectly spelled.`

## 13. State the visual hierarchy

Rank what the eye should see: `Hierarchy: 1. product 2. headline 3. environment 4. feature labels 5. logo.` This settles every conflict between elements.

## 14. Define failure

Tell the model what a wrong result looks like:

`If the logo looks like a separate 3D object floating above the plate, it is wrong. If it looks carved into the plate, it is wrong. It must look pressed outward from behind, part of the same sheet of metal.`

Use this for the one effect the whole image depends on.

## 15. Write negatives for this concept

A generic negative list ("ugly, blurry") does nothing. Name the specific ways *this* image could go wrong: `warped ear cups, extra ports, curved screen, neon glow around every object, cyberpunk overload, misspelled headline, floating product without contact shadow`. Keep them consistent with the brief. `prompting-guide.md`, section "Use negatives", has the full technique.

## 16. Lock what an upload must keep

For any uploaded product, face or logo, write the lock first and repeat it last: `Preserve the product's exact geometry, proportions, colors, label design and every printed word — no changes.` … `Final check: the product is identical to the upload.` For the full technique, see "Edit and preserve" in `prompting-guide.md`.

## 17. Plan series as frames with constants

For grids, storyboards and sets, list the constants once, then give each frame its own line: `FRAME 4: product in use on a neutral sweep; hands minimal and restrained.` End with the output rule: `One image, a clean 3×3 grid, no borders, no captions, no watermark.` For the full technique, see "Keep a series consistent" in `prompting-guide.md`.

## 18. Prefer direction over keyword soup

`8K, masterpiece, ultra-detailed, award-winning` adds little on its own. One concrete line — `85mm f/2, focus on the label, condensation beads with tiny refracted highlights` — does more than ten quality words. Use resolution words only as a final intent note.

## 19. Break the pattern

Any move above can be flipped for effect: a deliberately cluttered maximalist poster, a blown-out overexposed flash shot, a single tiny product lost in a vast empty frame, typography that is almost unreadable. Inverting the expected choice on purpose — and saying so in the prompt — is often where the most memorable images come from.

## A note on brands and people

The prompts in `../inspirations/` use invented brands (AUREL, NORDLYS, KAJI…). When a user names a real brand, logo or person, the skill's "Safety and rights" guidance in `prompting-guide.md` still applies.
