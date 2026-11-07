# Editing and transformation

One uploaded image is changed while the rest of it stays itself. These prompts name the change directly, say what must not move, limit where the edit happens, and describe how the new part should blend into the old: light, shadow, grain, focus. Small edits can be one line; edits with many things to protect earn a structured prompt.

Entries with `[SLOTS]` list an example value for each slot.

---

## E01 · Day to night

`1 upload: daytime scene` · `relight` · `same as upload`

```text
Turn this daytime scene into the same place at blue hour, about 30 minutes after sunset. Keep the composition, camera position, every building, object and person exactly where they are.

Change the light: a deep cobalt sky with a faint warm glow left on the horizon; windows, street lamps, signs and car headlights switched on in warm 2700–3200K; their light pools on the ground and reflects in glass and wet surfaces. Shadows now come from the artificial lights, not the sun. Slightly higher contrast, natural night noise, no halos or glow around the lights. No new objects, no text.
```

---

## E02 · Change the season

`1 upload: outdoor scene` · `seasonal transformation` · `same as upload`

*Slots:* `[SEASON]` deep winter after a fresh snowfall · `[SEASON_DETAILS]` 10 cm of snow on roofs, branches and railings, frost on windows, breath vapor from people, a pale low sun

```text
Transform this scene into [SEASON]. Keep the composition, architecture, landscape shapes, people's identities and positions, and the camera angle exactly as they are.

Add [SEASON_DETAILS]. Adapt vegetation, clothing layers, sky and light color naturally to the season. Snow, leaves or water settle where physics would put them — on upward-facing surfaces, in corners, along edges — never floating. Match the original photo's grain, sharpness and lens character. No text.
```

---

## E03 · Restore and colorize an old photo

`1 upload: damaged old photo` · `restoration` · `same as upload`

```text
Restore and colorize this old photograph.

Restore: remove scratches, dust, creases, tears, stains and fading; rebuild missing areas so they match their surroundings; recover detail in faces, hands and fabric without inventing new features.
Colorize: natural, historically plausible colors for the era — realistic skin tones, period-appropriate fabric dyes, muted environmental colors, never oversaturated.
Keep: every person's face, expression and identity; the pose, clothing, composition and framing; a gentle film grain so it still feels like a real photograph from its time.

No text, no borders, no modern objects.
```

---

## E04 · Outpaint to a wider frame

`1 upload: tightly cropped photo` · `outpainting` · `[ASPECT_RATIO]`

*Slots:* `[ASPECT_RATIO]` 16:9

```text
Zoom out and extend this image to a [ASPECT_RATIO] frame. The original image stays untouched in the center — do not distort, redraw or recolor it.

Extend both sides with content that logically continues the scene: complete any objects or people cut off at the original edges, continue the architecture, landscape, floor and sky with correct perspective and vanishing points. The new areas match the original's light direction, time of day, weather, color grade, grain, sharpness and depth of field, so no seam is visible. No new focal subjects, no text.
```

---

## E05 · Remove the crowds

`1 upload: busy landmark photo` · `object removal` · `same as upload`

```text
Remove all tourists and passers-by from this photo, including people partly hidden behind objects and their shadows and reflections. Replace them with what would logically be behind them: extend the cobblestone paving in the same pattern and perspective, complete the steps, benches, doors and walls they covered.

Keep the architecture, sky, light, time of day and composition exactly as they are. The filled areas match the original grain, sharpness, focus depth and lighting — no smudges, blur patches, repeated textures or ghost outlines. No text.
```

---

## E06 · Product photo cleanup

`1 upload: product photo` · `retouch` · `same as upload`

```text
Retouch this product photograph for a premium e-commerce listing.
- Remove dust, fingerprints, lint, small scratches and stray hairs from the product and the background.
- Even out the background to a clean, smooth tone of its current color; keep the natural contact shadow.
- Tame distracting reflections, but keep the product's real material highlights.
- Straighten the product so its vertical edges are perfectly vertical.
- Neutral, accurate color; slightly crisper micro-contrast on the product.
Keep unchanged: the product's shape, proportions, colors, label design and every printed word. Do not add anything. No text.
```

---

## E07 · New background with matched light

`1 upload: person or product` · `background replacement` · `same as upload`

*Slots:* `[NEW_BACKGROUND]` a sunlit Mediterranean terrace with whitewashed walls, bougainvillea and a distant sea · `[LIGHT_DIRECTION]` warm late-afternoon sun from camera-left

```text
Keep the main subject of this photo exactly as it is — identity, face, pose, clothing, product details, edges and hair — and replace only the background with [NEW_BACKGROUND].

Make it one photograph: relight the subject to match [LIGHT_DIRECTION] — highlights, shadow side and color temperature consistent with the new scene; add a correct contact shadow and a little environmental color bounce on the subject's edges. The background's perspective and horizon match the original camera height and lens; its depth of field matches the subject's focus. Clean, natural hair and edge transitions with no halo. No text.
```

---

## E08 · Restyle into a different medium

`1 upload: photo` · `restyle` · `same as upload`

*Slots:* `[MEDIUM]` a stop-motion claymation set · `[MEDIUM_DETAILS]` everything sculpted from plasticine with visible fingerprints and tool marks, felt and fabric textures, slightly imperfect handmade proportions, miniature practical lighting

```text
Recreate this exact image as [MEDIUM]. Keep the composition, camera angle, every subject and object in its place, the people's recognizable features and expressions, and the overall color relationships.

Translate every surface into the medium: [MEDIUM_DETAILS]. Apply the medium consistently to the whole image — people, background and small details alike — so nothing stays photographic. No text.
```

---

## E09 · Translate the text in an image

`1 upload: menu, sign or packaging` · `localization` · `same as upload`

*Slots:* `[TARGET_LANGUAGE]` English · `[KEEP_AS_IS]` prices, the ¥ symbol and the shop's logo

```text
Translate all the text in this image into [TARGET_LANGUAGE]. Keep [KEEP_AS_IS] exactly as they are.

Erase each original text cleanly and fill the background behind it so no trace remains. Set the translated text in a font that matches the original's style, weight and color, at a size that fits the same space. It must look printed on the same surface: follow the surface's curve and perspective, and match its texture, wear, stains, lighting and grain.

Change nothing else in the image. Keep translations short and natural.
```

---

## E10 · Virtual staging of an empty room

`1 upload: empty room` · `interior staging` · `same as upload`

*Slots:* `[ROOM_TYPE]` living room · `[STYLE]` warm Scandinavian — light oak, oatmeal boucle, linen, ceramic, one large plant · `[KEY_PIECES]` a three-seat sofa, a round coffee table, a wool rug, a floor lamp, two framed prints

```text
Furnish this empty room as a [ROOM_TYPE] in a [STYLE] style. Add [KEY_PIECES], arranged for realistic circulation with true-to-scale furniture.

Keep the room exactly as it is: walls, windows, doors, floor, ceiling, outlets, radiators and the camera angle. Furniture sits firmly on the floor with correct contact shadows, follows the room's perspective and is lit by the existing window light, with matching shadow direction and color temperature. Real-estate photography finish, vertical lines straight. No text, no people.
```

---

## E11 · Wardrobe change

`1 upload: person` · `clothing edit` · `same as upload`

*Slots:* `[NEW_OUTFIT]` a tailored camel wool overcoat over a black roll-neck, charcoal trousers

```text
Replace the person's clothing with [NEW_OUTFIT]. Only change the clothes.

Keep unchanged: the face and identity, hairstyle, pose, hands, expression, background, lighting and framing. The new clothes fit this body and pose naturally, with realistic folds, drape and fabric texture, and take the same light and shadows as the original scene. No text, no logos on the clothes.
```

---

## E12 · Add rain to a street

`1 upload: street scene` · `weather edit` · `same as upload`

```text
Make it a rainy evening in this exact scene. Keep the composition, buildings, people and vehicles as they are.

Add steady rain: fine diagonal streaks visible against the darker areas and the lights; wet, reflective pavement that mirrors signs, lights and people; small puddles with ripples in low spots; raindrops beading on car roofs and glass; people's hair and clothes slightly damp; open umbrellas for some of the pedestrians where it fits their pose. A cooler, darker sky with soft overcast light. Match the original grain and lens character. No text.
```

---

## E13 · Change the camera view

`1 upload: room or object` · `viewpoint change` · `same as upload`

```text
Show this exact scene from directly above, as a perfectly top-down view. Keep every object, its color, material, size and its position relative to the others; work out the parts hidden in the original view from what is visible. Mark where the original photographer stood with a small red dot and a short arrow showing their viewing direction. Soft, even light. No other text or marks.
```

---

## E14 · Real-estate sky and grade

`1 upload: house exterior` · `enhancement` · `same as upload`

```text
Enhance this house exterior photograph for a premium real-estate listing.
- Replace the dull sky with a clear late-afternoon sky with a few soft clouds, matching the existing sun direction.
- Warm the light slightly, as at golden hour; let the façade catch a warm side light consistent with that sun.
- Make the lawn healthier and evenly green, without changing its shape or edges.
- Turn on the interior lights so windows glow warmly.
- Straighten vertical lines; balance exposure in shadows and highlights.
Keep the architecture, materials, colors of the house, landscaping layout and composition exactly as they are. No added objects, no people, no text.
```

*Riff on it:* keep any visible damage, such as cracks or water stains, exactly as it is; a listing photo that hides it misrepresents the property.

---

## E15 · Torn-paper reveal on an illustration

`1 upload: character illustration` · `scoped graphic effect` · `same as upload`

*Ideas in play:* a YAML spec that separates what to preserve, what to add and where.

*Slots:* `[INTERIOR_STYLE]` sumi-e ink wash on rice paper · `[PLACEMENT]` a horizontal band across chest height

```yaml
edit_type: torn_paper_reveal
preserve_everything:
  - character identity, face, expression and hairstyle
  - outfit design and colors
  - pose, anatomy and composition
  - background, lighting and overall art style
effect:
  description: "Parts of the image look as if the paper were torn open, revealing a different artwork underneath."
  placement: "[PLACEMENT]"
  tear_edges: "realistic fibrous paper edges, slight curls and a thin white paper core along every tear, soft shadows cast inward"
  interior_style: "[INTERIOR_STYLE] — the same character continues inside the tear, drawn in this style and perfectly aligned with the outside drawing"
rules:
  - "Only modify the torn areas; everything outside them stays pixel-identical in content and style."
  - "The tear shapes look natural and irregular, never geometric."
negative: "text, extra characters, duplicate faces, a second torn band, blurred edges"
```

---

## E16 · Recolor a product

`1 upload: product photo` · `color variant` · `same as upload`

*Slots:* `[PART]` the car's body paint · `[NEW_COLOR]` deep British racing green metallic with a fine gold flake

```text
Change only [PART] to [NEW_COLOR]. Keep its finish behavior realistic: the same reflections, highlights and environment mirrored in it, with the new color showing correctly in light and shadow areas.

Everything else stays exactly the same: shape, all other parts and materials, trims, badges, background, lighting, camera angle and image quality. No text.
```

---

## E17 · Upscale and enrich detail

`1 upload: low-resolution image` · `enhancement` · `same as upload`

```text
Upscale this image to high resolution and restore fine detail. Sharpen edges cleanly; reconstruct realistic textures — skin pores, hair strands, fabric weave, foliage, brick and stone grain — that are consistent with what is already there. Remove compression blocks, banding and noise while keeping a light natural grain. Do not change faces, expressions, composition, colors or any content; do not add objects or text.
```

---

## E18 · A giant illustrated creature behind real buildings

`1 upload: city photo` · `mixed-media composite` · `same as upload`

*Slots:* `[CREATURE]` a gentle, enormous paper-white whale drawn in flat Japanese ink style, peeking out with one curious eye

```text
Add [CREATURE] rising from behind the buildings in this city photo, so that it looks enormous — taller than the tallest building. Do not change the real buildings, street, people or sky color.

The creature is a flat illustration, not photoreal, but it is placed with correct overlap: the nearest buildings cover its lower part, and it sits in the haze of the far distance with slightly softer contrast. Add subtle color reflections of the creature on nearby glass façades. The photo stays photographic; only the creature is illustrated. No text.
```

---

## E19 · Listing cleanup: remove objects and change the light

`1 upload: room or house exterior` · `object removal and relight` · `same as upload`

*Ideas in play:* three edits in one prompt — remove, relight, keep — each in its own paragraph, with one keep list that the removal and the relight both obey. Only temporary clutter goes: cracks, stains and other damage stay visible, and the real view out of every window stays as it is, since changing either misrepresents what is for sale; tell the user so when they ask for it, and offer honest caption wording instead.

*Slots:* `[REMOVE]` a parked delivery van, a stack of paint tins and a ladder against the garage · `[TIME_LIGHT]` golden hour, a low warm sun from the left of the frame, long soft shadows across the lawn · `[LIGHTS]` leave the interior lights off; let the low sun glint in the upper windows

```text
Edit this house exterior photo for a sales listing. Keep the same photo, camera position, framing and lens.

REMOVE: [REMOVE], including their shadows and reflections. Fill each spot with what would logically be behind it — continue the paving, lawn, curb, fence and façade in the same pattern and perspective, and complete anything they covered.

CHANGE THE LIGHT: [TIME_LIGHT]. [LIGHTS]. The sky is clear and matches the new time of day; every shadow and reflection follows the new light.

KEEP UNCHANGED: the house itself — architecture, roof, walls, doors, windows, materials, colors and proportions — plus the landscaping layout, neighboring buildings and anything not named above. Any crack, stain or wear stays exactly as it is. Do not repair, restyle or beautify the house; only the removal and the light change.

The filled areas match the original grain, sharpness and focus depth: no smudges, blur patches, repeated textures or ghost outlines. Straight vertical lines, natural color. No new objects, no people, no text, no watermark.
```

*Riff on it:* for an interior, swap the fill nouns for upholstery, floorboards, skirting and wall corners, and let the light come through the room's real windows; for blue hour, ask for a deep-blue sky about 30 minutes after sunset and warm 2700K window glow (see E01); for a brighter listing, keep the daylight and only swap the sky (see E14).

