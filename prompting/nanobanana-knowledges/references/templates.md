# Nano Banana prompt templates

These skeletons are built from the proven patterns in `pattern-catalog.md` and the rules in `prompting-guide.md`.

- Replace every `[slot]`.
- Delete any line that does not apply to the task.
- Keep the order of the lines: deliverable first, constraints last.

## Photoreal portrait from a selfie (identity-locked)

```text
Keep the facial features of the person in the uploaded image exactly consistent: same face shape, bone structure, skin tone and eyes.
Create a [deliverable, e.g. professional chest-up headshot] of this person [action / pose, e.g. looking directly at the camera].
Wardrobe: [clothing, color, fabric texture].
Background: [backdrop or location, with 2–4 concrete elements].
Camera: [body] with a [focal length] f/[aperture] lens, [framing], shallow depth of field, focus on the eyes.
Lighting: [setup, e.g. classic three-point lighting with a soft key light and a subtle rim light].
Details: natural skin texture with visible pores, not airbrushed; natural catchlights in the eyes; [fabric or hair detail].
Color: [grading].
Aspect ratio [ratio]. Important: do not change the face.
```

## Edit an uploaded image (scoped change)

```text
Use the uploaded image as the base. [The one change, stated directly, e.g. Replace the person's jacket with a red leather jacket.]
Keep unchanged: [identity, pose, expression, background, lighting, composition, art style, any listed elements].
Only modify [the region or element].
Blend the change in: match the original lighting direction, color temperature, shadows, grain and focus depth.
Do not add new people, text, logos or watermarks.
```

## Combine several reference images

```text
Image 1 is [role, e.g. the model]. Image 2 is [role, e.g. the garment]. Image 3 is [role, e.g. the background environment].
Create [deliverable] in which [what happens, combining the roles].
From Image 1 keep [identity / pose]. From Image 2 preserve [texture, color, logos] exactly.
[Placement of each element in the frame.]
Match lighting, color temperature and shadow direction across all elements so it reads as one photo.
[Style / camera line.] Aspect ratio [ratio].
```

## Product shot

```text
A premium [e-commerce | luxury | lifestyle] product photograph of [product: shape, material, label, color].
[Placement, e.g. centered on a pure white background with a subtle natural contact shadow | floating on dark water surrounded by [props]].
Lighting: [soft commercial studio light highlighting the material | golden hour glow with reflections].
Camera: [angle], shallow depth of field with soft bokeh.
Mood: [two or three adjectives].
[If editing a phone photo: Remove any hands, fingers and clutter; fix lens distortion; color-correct.]
No text or logos other than those on the product. Aspect ratio [ratio].
```

## Poster, cover or card with exact text

```text
A [poster | magazine cover | quote card] for [topic], [style].
Visual: [main image, its position and its share of the canvas, e.g. portrait on the left third].
Text, exactly as written:
1. "[Title]": [font style, weight, color], [position].
2. "[Subtitle or offer]": [style], [position].
3. "[Footer]": [style], [position].
No other text. Ensure all text is perfectly spelled and integrated into the image's depth of field.
Aspect ratio [ratio].
```

## Infographic or diagram

```text
Create a [infographic | flowchart | cross-section | Sankey diagram] explaining [topic] for [audience].
Content (use these facts exactly): [list of components, steps or numbers].
Layout: [flow direction, grid, zones, title position].
Visual grammar: [arrows for flow | orthogonal 90-degree connectors | flat icons per item].
Style: [flat vector | hand-drawn doodle | minimalist corporate], palette [colors or hex codes].
Labels in [language], short and legible; title "[Title]".
Make it [scientifically | historically] accurate. Aspect ratio [ratio].
```

## Convert one form into another

```text
Convert this [hand-drawn sketch | wireframe | floor plan | map screenshot | photo] into [target form].
Interpret it as follows: [mapping, e.g. rectangles → buttons, scribbles → placeholder images, lines → text blocks].
Apply [design system or style]. Keep the original [layout | proportions | positions].
[Frame or context, e.g. inside a realistic phone frame | isometric, photo-realistic].
```

## Restore, outpaint or clean up

```text
[Restore and colorize this photo | Zoom out and expand this image to [ratio] | Remove [unwanted elements] from the background].
Fill new or cleaned areas with realistic elements that logically fit the scene ([examples]).
Complete any cut-off objects naturally. Do not distort the original center.
The new areas must match the original grain, focus depth, lighting and weather; no smudges or artifacts.
```

## Character sheet or variant grid

```text
Based on the character in the uploaded image, create a [character sheet | 3x3 grid | four-panel sequence].
Panels: [list, e.g. front, side and back views; expression sheet: joy, anger, sadness, surprise; pose sheet].
Keep the same face, hairstyle, outfit, colors and art style in every panel; only [the one variable] changes.
Evenly spaced on a [white | solid color] background. [Labels: none | short labels in [language] under each panel.]
```

## Storyboard or keyframe contact sheet

```text
Role: you are a trailer director, cinematographer and storyboard artist.
From the uploaded image, plan a [10–20 s] sequence with four beats: setup, build, turn, payoff.
Continuity: same subjects, wardrobe, environment, time of day, lighting and color grade in every frame. Do not introduce new characters or objects.
Visual anchors that never change: [3–6 items].
Output ONE master image: a [3x3] contact sheet, one keyframe per panel, each labeled with its number, shot type and duration in the margin, never covering the subject.
Depth of field: shallow in close-ups, deeper in wide shots.
```

## Slide deck or multi-page set

```text
First write an outline of [N] pages for [audience] from the content below. Then generate one image per page, never all pages in one image.
Design system for every page:
- Background: [color with hex code], [texture].
- Fonts: [serif] for titles, [sans-serif] for body text.
- Colors: [primary hex], [secondary hex], accent [color]. Avoid [colors].
- Layout: [grid, cards, title position]. Charts: [style].
- Illustration style: [style].
Language: [language]. Aspect ratio 16:9.
Content: [text]
```

## JSON spec (dense scene)

```json
{
  "intent": "[one sentence: what the image is for]",
  "frame": { "aspect_ratio": "[ratio]", "composition": "[framing and placement]", "style_mode": "[style]" },
  "subject": {
    "description": "[who or what]",
    "face": { "preserve_original": true },
    "pose": "[pose]",
    "clothing": "[clothing]",
    "details": ["[micro-detail]", "[micro-detail]"]
  },
  "environment": { "location": "[place]", "foreground": "[items]", "background": "[items]", "atmosphere": "[mood]" },
  "lighting": { "type": "[setup]", "direction": "[direction]", "color_temperature": "[e.g. 5000K neutral]" },
  "camera": { "lens": "[focal length]", "aperture": "[f-stop]", "angle": "[angle]", "depth_of_field": "[shallow | deep]" },
  "text": { "content": "[exact words or none]", "style": "[font and position]" },
  "negative": { "content": "[unwanted things]", "style": "[unwanted looks]" }
}
```
