# Reference images: selective transfer

Two or more uploads, each lending specific qualities to the result: identity from one, style from another, pose, palette, light or material from a third. The craft is deciding, for each image, what is taken and what is ignored. Upload the images in the numbered order the prompt uses. To place several subjects together into one scene or layout, see `multi-reference-composition.md`.

Entries with `[SLOTS]` list an example value for each slot.

---

## R01 · Content from one image, art style from another

`2 uploads: content, style` · `style transfer` · `[ASPECT_RATIO]`

*Ideas in play:* the style is broken down into transferable parts so the model does not copy the style image's subject.

*Slots:* `[ASPECT_RATIO]` 4:5

```text
Image 1 is the content: keep its subject, composition, pose, proportions and the arrangement of every element.
Image 2 is the style reference only: take its medium, brushwork or line quality, texture, color palette, value contrast and edge treatment. Do not take any of its subjects, objects or layout.

Repaint Image 1 entirely in the style of Image 2, as if the artist of Image 2 had created this exact scene. Apply the style consistently to every part of the image — faces, background, small details. Faces from Image 1 stay recognizable.

[ASPECT_RATIO]. No text, no signature.
```

---

## R02 · Color line art with a palette reference

`2 uploads: line art, palette` · `illustration coloring` · `same as Image 1`

```text
Image 1 is black-and-white line art. Image 2 is a color palette reference.

Color the line art in Image 1 using only the colors in Image 2 — sample them accurately and use each where it suits the drawing (skin, hair, clothing, background, accents). Keep every line of Image 1 exactly as drawn; do not redraw or add lines.

Rendering: clean flat colors with one level of soft cel shading and a subtle highlight, consistent light from the upper left. The background gets a simple wash from the palette's lightest color. Same aspect ratio and framing as Image 1. No text.
```

---

## R03 · Relight a subject with a lighting reference

`2 uploads: subject, lighting` · `relight` · `same as Image 1`

```text
Image 1 is the subject. Image 2 is a lighting reference only.

Relight Image 1 so it matches the lighting of Image 2: the same key-light direction and height, light quality (hard or soft), color temperature, contrast ratio, shadow density and any colored accent or rim light. Dark areas in Image 2 become shadow areas on the subject; bright areas become highlights.

Keep everything else in Image 1 unchanged: the person's identity and expression, pose, clothing, background objects and composition. Shadows must fall consistently with the new light on the face, body and surroundings. Natural skin texture. No text.
```

---

## R04 · Pose from a stick-figure sketch

`3 uploads: character, character, pose sketch` · `pose control` · `[ASPECT_RATIO]`

*Slots:* `[SCENE]` a rain-soaked rooftop at night with neon reflections · `[ACTION]` a dramatic sword duel · `[ASPECT_RATIO]` 16:9

```text
Image 1 and Image 2 are two characters. Image 3 is a rough stick-figure sketch that shows the poses only.

Show the character from Image 1 and the character from Image 2 in [ACTION], using exactly the poses from Image 3 — the same body angles, limb positions, distance between the figures and camera framing. Each character keeps their face, hairstyle, costume, colors and art style from their own reference. The sketch's lines, stick bodies and paper must not appear.

Setting: [SCENE]. Dynamic, cinematic lighting that reveals the motion; motion streaks on the fastest parts. [ASPECT_RATIO]. No text.
```

---

## R05 · Material sphere onto a logo

`2 uploads: logo, material sample` · `3D logo` · `1:1`

```text
Image 1 is a flat logo. Image 2 is a material sample (a sphere or swatch).

Rebuild the logo from Image 1 as a solid 3D object made entirely of the material from Image 2 — its color, surface finish, roughness, translucency, pattern and reflections. Keep the logo's exact silhouette and proportions; give it a believable depth of about one fifth of its width with softly rounded edges.

Present it floating at a slight three-quarter angle in front of a seamless solid background in a color sampled from the material's darkest tone. Physically based studio lighting that shows off the material: a large soft key, a rim light, a soft contact shadow below. Square 1:1. No text.
```

---

## R06 · Expression from one face, identity from another

`2 uploads: character, expression` · `expression transfer` · `same as Image 1`

```text
Character reference: Image 1. Expression reference: Image 2.

Change only the facial expression of the character in Image 1 to match Image 2 — the eyebrow shape, eye opening, mouth shape, cheek tension and head tilt. Keep everything else from Image 1: identity, face shape, hairstyle, outfit, art style, lighting, background and framing. The expression must look natural on this specific face. No text.
```

---

## R07 · A brand's campaign style applied to a new product

`2+ uploads: existing campaign visuals, new product` · `campaign extension` · `[ASPECT_RATIO]`

*Ideas in play:* extract the campaign's visual system first, then build a new visual in it.

*Slots:* `[CAMPAIGN_IMAGES]` Images 1 and 2 · `[PRODUCT_IMAGE]` Image 3 · `[HEADLINE]` NEW. SAME SUN. · `[ASPECT_RATIO]` 4:5

```text
[CAMPAIGN_IMAGES] are existing visuals from one brand campaign. [PRODUCT_IMAGE] is a new product from the same brand.

First, read the campaign's visual system from [CAMPAIGN_IMAGES]: palette, background treatment, set materials, lighting direction and quality, camera height and lens feel, composition habits, typography style and placement, retouching finish.

Then create a new campaign visual for the product in [PRODUCT_IMAGE] that clearly belongs to that same campaign. Use the same visual system, but a new set arrangement — not a copy of either campaign image.

Preserve the new product exactly: shape, color, label and every printed word.

Headline: "[HEADLINE]", set in the campaign's typography style and placed where the campaign places its headlines. No other text. [ASPECT_RATIO].
```

---

## R08 · Same character, new world

`2 uploads: character, location` · `character in scene` · `[ASPECT_RATIO]`

*Slots:* `[ACTION]` buying a paper lantern from a street vendor · `[TIME]` dusk, lanterns just lit · `[ASPECT_RATIO]` 3:2

```text
Image 1 is the character: keep their face, hairstyle, body type, outfit, colors and art style exactly.
Image 2 is the location: keep its architecture, layout, landmarks and atmosphere.

Place the character from Image 1 into the location from Image 2, [ACTION], at [TIME]. Integrate them fully: their scale matches the surroundings, their feet touch the ground with a correct contact shadow, the location's light falls on them with the right direction and color, and the environment reflects in any shiny surfaces they wear.

Render the whole image in the style of Image 1 if it is illustrated, or photographic if Image 1 is a photo. [ASPECT_RATIO]. No text.
```

---

## R09 · New poster in a reference poster's design language

`2 uploads: reference poster, subject photo` · `poster` · `2:3`

*Slots:* `[TITLE]` NIGHT SWIM · `[SUBTITLE]` A film by Ana Ribeiro · `[DATE_LINE]` IN CINEMAS 14.03

```text
Image 1 is a reference poster. Use only its design language: grid, type hierarchy, typeface character, color treatment, graphic devices, texture and print finish. Do not copy its image, title or any of its words.
Image 2 is the subject photo for the new poster. Keep the person or subject in it recognizable.

Design a new vertical 2:3 poster featuring the subject of Image 2, treated the way Image 1 treats its image (crop, duotone, halftone, cut-out or collage — whatever Image 1 does).

Text, exactly:
- Title: "[TITLE]"
- Subtitle: "[SUBTITLE]"
- Bottom line: "[DATE_LINE]"
Set each where Image 1 sets the equivalent element, in the same type style. No other text. Every word perfectly spelled.
```

---

## R10 · Packaging design applied to a blank container

`2 uploads: flat design, blank container` · `packaging mockup` · `4:5`

```text
Image 1 is a flat packaging artwork. Image 2 is a blank container.

Wrap the artwork from Image 1 onto the container in Image 2 as if it were printed on it: it follows the curvature, bends naturally around edges, and shows the container's material through it (metallic sheen on a can, paper texture on a carton, gloss on a bottle). Keep all the artwork's colors, graphics and text exactly; no stretching or distortion beyond true curvature.

Place the finished package in a minimalist set: a single block of stone on a pale backdrop drawn from the artwork's palette, soft window light from the left, a natural shadow. Professional packaging photography, 85mm, f/5.6. Vertical 4:5. No other text.
```

---

## R11 · Three images, three roles

`3 uploads: pose, style, environment` · `composite generation` · `[ASPECT_RATIO]`

*Slots:* `[SUBJECT]` a young falconer · `[ASPECT_RATIO]` 16:9

```text
Use Image 1 for the pose and body language only. Use Image 2 for the art style only — medium, palette, line and texture. Use Image 3 for the background environment only.

Create [SUBJECT] in the pose from Image 1, placed in the environment from Image 3, the whole image rendered in the style of Image 2. Ignore the identities, clothing and subjects of Images 2 and 3 — they lend only their style and their place.

Unify the light so it comes from the environment's dominant source. [ASPECT_RATIO]. No text.
```

---

## R12 · Makeup look transfer

`2 uploads: person, makeup reference` · `beauty edit` · `same as Image 1`

```text
Apply the makeup from Image 2 to the person in Image 1: the same eyeshadow colors and placement, liner shape, brow styling, blush position, lip color and finish (matte, satin or gloss), and any graphic or glitter details. Adapt the shapes to this person's own eye and lip shapes so it looks professionally applied.

Keep the person in Image 1 unchanged otherwise: face, skin tone, skin texture, hair, pose, outfit, lighting and background. Beauty photography finish with visible skin texture. No text.
```

---

## R13 · Character sticker set in a reference sticker style

`2 uploads: character, sticker style` · `sticker pack` · `1:1`

*Slots:* `[COUNT]` nine · `[POSES]` waving, laughing, thumbs-up, sleepy, heart hands, confused, celebrating, crying with joy, "on my way" running · `[PHRASES]` HI!, LOL, NICE, ZZZ, LOVE IT, HUH?, YAY, SO HAPPY, OMW

```text
Image 1 is the character. Image 2 is a sticker style reference.

Create a sheet of [COUNT] die-cut stickers of the character from Image 1, arranged in an even grid, square 1:1. Use the sticker style of Image 2: its outline thickness, white border, shading, finish and level of simplification. The character's face, hair, outfit and colors stay the same in every sticker.

Poses, one per sticker, in this order: [POSES]. Each sticker has a short phrase in a bold rounded font, in this order: [PHRASES]. No other text. Every word perfectly spelled.
```

---

## R14 · Moodboard to a single campaign image

`2+ uploads: moodboard images, product` · `campaign visual` · `[ASPECT_RATIO]`

*Slots:* `[MOODBOARD_IMAGES]` Images 1–4 · `[PRODUCT_IMAGE]` Image 5 · `[ASPECT_RATIO]` 4:5

```text
[MOODBOARD_IMAGES] form a moodboard. [PRODUCT_IMAGE] is the product.

Distill the moodboard into one direction: the shared palette, light, textures, era and emotional tone. Do not reproduce any single moodboard image or its subjects.

Create one campaign photograph of the product from [PRODUCT_IMAGE] that feels as if it belongs on this moodboard: a set, props and light that express that direction, with the product as the clear hero, label readable. Preserve the product exactly. [ASPECT_RATIO]. No text, no watermark.
```

---

## R15 · Character in a location, painted in a style image

`3 uploads: character, location, style` · `illustrated scene` · `[ASPECT_RATIO]`

*Ideas in play:* each upload has one job, in the order people usually have them; the style image lends only its hand, never its subjects; the character is grounded by light and a contact shadow.

*Slots:* `[ACTION]` bargaining for a glowing paper lantern at a night-market stall, one hand pointing at the lantern while the vendor laughs · `[TIME_LIGHT]` a humid night, strings of warm bulbs overhead, cool neon from a side alley, steam drifting from nearby woks · `[FRAMING]` a low three-quarter angle, the character in the right third, the stall's lights filling the left two-thirds · `[ASPECT_RATIO]` 3:2

```text
Image 1 is the character. Image 2 is the location. Image 3 is the art style only.

From Image 1 keep exactly: the character's face, hairstyle, body type, proportions, outfit design and colors. The character stays instantly recognizable.
From Image 2 keep: the place's architecture, layout, landmarks and atmosphere. Do not copy its people, vehicles or exact framing.
From Image 3 take only: its medium, brushwork or line quality, texture, palette, value contrast and edge treatment. Do not take any of its subjects, objects or composition.

Scene: the character from Image 1 in the location from Image 2, [ACTION]. [TIME_LIGHT]. [FRAMING].

Integration: the character's scale matches the surroundings; their feet touch the ground with a correct contact shadow; the location's light falls on them with the same direction and color; any other people are generic and secondary.

Paint the whole image — character, location and small details alike — in the style of Image 3, so nothing stays photographic and the character does not keep their original rendering style. Depth in three layers: a framing foreground element, the character sharp in the midground, the location receding softly behind.

[ASPECT_RATIO]. Exactly one of the character. No readable text, no signs with words, no signature, no watermark.
```

*Riff on it:* swap Image 3 for a linocut, a gouache picture-book page or a risograph print; or let the location come from a map screenshot instead of a photo.
