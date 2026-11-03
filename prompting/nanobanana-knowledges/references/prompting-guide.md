# Nano Banana prompting guide

This guide covers how to prompt Nano Banana. It draws on three sources, all named in `NOTICE.md`:

- Google's own prompting tips for Nano Banana Pro, published on 2025-11-20. Rules from this source are marked **(Google)**.
- The prompts collected in two community galleries. Each rule from them comes from patterns that recur across those prompts.

Pattern names in brackets, such as [Split View 3D Render], point to entries in `pattern-catalog.md`.

The galleries cover two generations of the model:

- **Nano Banana** is strong at editing, combining reference images, style transfer and one-line transformations of an upload.
- **Nano Banana Pro** adds what the Pro sections show most: long readable text, page layouts (infographics, slides, newsletters, posters), drawing from world knowledge (coordinates, books, papers, landmarks), many consistent subjects in one frame, and multi-image sets.

Every technique below works on both models. When a prompt depends on dense text, real-world facts or many panels, prefer Pro.

## What Nano Banana Pro can do (Google)

Google describes Nano Banana Pro (Gemini 3 Pro Image) as able to:

- **Render text**: sharp, legible text in several languages for posters, diagrams and product mockups.
- **Use real-world knowledge**: it draws on Gemini 3's real-world knowledge and reasoning, for example to make "an infographic that shows how to make elaichi chai".
- **Translate and localize**: it writes localized text, or translates the text inside an image while keeping everything else the same.
- **Control the shot**: you can direct lighting, camera angle, focus and color grading.
- **Resize**: it changes the aspect ratio of an image and outputs at 1K, 2K or 4K resolution.
- **Blend images**: it combines up to 6 to 14 unrelated reference images, depending on the product you use it in, and keeps several characters consistent, even in a group.
- **Apply a brand look**: it applies brand styling consistently, and drapes patterns, logos and artwork onto 3D objects such as apparel and packaging while keeping natural lighting and texture.

Google also lists these current limitations. Plan for them and warn the user:

- Small text, fine details and exact spelling may not come out right.
- Diagrams and infographics may contain factual errors, so the user must verify them.
- Translated or multilingual text may contain grammar mistakes or miss cultural nuance.
- Blending images or changing the lighting can leave unnatural artifacts.
- Character consistency across edits is usually reliable, but it can vary.

## Anatomy of a strong prompt

**(Google)** Google's tips name five core elements of a prompt: **subject** (be specific), **composition** (how the shot is framed), **action**, **location** and **style**. For an edit, add a direct, specific **editing instruction**, such as "change the man's tie to green, remove the car in the background". For professional results, Google then adds the aspect ratio, camera and lighting details, exact text with its styling, factual constraints, and the role of each reference image. Simple prompts still work, but detail gives more control.

Strong prompts in the galleries fill most of the following slots, roughly in this order. Fill only the ones that matter for the task.

1. **Task and deliverable**: what kind of image this is. Examples: "A professional promotional poster for…", "A hyper-realistic 3D render of…", "Convert this residential floor plan into…".
2. **Subject**: who or what, with visible traits such as age, hair, clothing, material, color and expression. Use a specific noun, such as "a transparent plastic cup with large clear ice cubes", not just "a drink".
3. **Action and pose**: what the subject is doing, and where it faces or looks.
4. **Setting**: the location, background elements, and foreground, middle-ground and background layers.
5. **Composition and camera**: framing (close-up, 3/4 body, wide), angle (eye level, high angle, top-down, isometric) and position in the frame (left third, centered).
6. **Lighting**: the light source, its direction, quality and color temperature.
7. **Style and medium**: photo, film stock, illustration style, 3D render style, or a physical medium such as chalk, marker, oil paint, clay or crystal.
8. **Text and layout**: the exact words, their font, placement and language. See "Render text and layout".
9. **Constraints**: what must stay the same, what must not appear, and counts and proportions.
10. **Output spec**: the aspect ratio and the resolution or size.

Put the most important instruction first, and repeat a critical constraint at the end. [Backstage Glamour Photoshoot] opens with "Keep the face of the person 100% accurate" and closes with "Important: do not change the face."

## Choose a prompt format

The galleries use five formats. Pick the format by how much the prompt must control.

| Format | When to use it | Gallery examples |
| --- | --- | --- |
| One-line instruction | A well-known transformation of an uploaded image, or an open creative or reasoning ask | "restore and colorize this photo", "Convert the image to isometric view", "draw what the red arrow sees", "I want to see how this was made" |
| Natural-language brief | Most single images: a few sentences covering subject, setting, light, style and constraints | [Emotional Film Photography], [Miniature Self-Portrait], [Crystal Texture Emoji] |
| Labeled sections | Briefs with many requirements. Use headings such as `Subject:`, `Background:`, `Lighting:`, `Text:`, `Quality:`, often with numbered sub-items | [One-Click Business Photo], [Commercial Promotional Poster], [Children's Literacy Newsletter], [Kids' Crayon Travel Journal] |
| JSON or YAML spec | Dense scenes with many attributes, edits that must preserve a long list, and prompts you want to reuse by swapping values | [2000s Mirror Selfie], [Chalkboard Anime Art Documentation], [Torn Paper Art Effect], [Extreme Wide Angle Phone Edit] |
| Tagged multi-step role prompt | Sequences, storyboards and multi-page sets. Give the model a role, rules, numbered steps and an output order | [Cinematic Keyframe Generator], [Create PPT from Article] |

Notes on the formats:

- A JSON or YAML spec is only structured text; nothing parses it. Its value is that every attribute gets its own slot, so none is forgotten. Use keys that say what they hold: `subject`, `face.preserve_original`, `photography.lighting`, `background.elements`, `negative`. Values can be phrases, not single words.
- A one-line instruction works only when the transformation is unambiguous. When a one-liner gives a generic result, expand it into a brief.
- Placeholders in brackets or braces, such as `[PRODUCT]`, `{City Name}` or `[BRAND]`, turn a prompt into a reusable template. Tell the user to replace every placeholder before use.

## Describe like a photographer

Photorealistic prompts in the galleries name real photographic choices instead of saying "high quality".

- **Camera and lens**: "Sony A7III with an 85mm f/1.4 lens", "35mm prime, f/5.6, 1/60s, ISO 400", "Hasselblad H6D-100c, Macro 120mm", "ultra-wide fisheye 12mm". Use 85mm for flattering portraits, 35mm for environmental shots, 12–18mm fisheye for exaggerated perspective, and macro for extreme detail.
- **Depth of field**: "shallow depth of field, exquisite focus on the eyes, soft bokeh". Use shallow focus for close-ups and deeper focus for wide shots.
- **Lighting setups**:
  - "classic three-point lighting", with the key light creating soft shadows and a rim light separating the hair from the background;
  - "harsh direct on-camera flash with hard shadows";
  - "golden hour, warm light hitting the side of the face";
  - "narrow beam spotlight, sharp edges, high falloff into darkness";
  - "soft diffused studio light";
  - "ring flash";
  - neutral 5000K light for accurate color.
- **Film and era looks**:
  - "shot on Kodak Portra 400 film", with subtle grain;
  - "early-2000s digital camera aesthetic";
  - "1990s camera with direct front flash";
  - "low-quality disposable camera snapshot";
  - Canon IXUS point-and-shoot.
- **Realism cues**: "natural skin texture with visible pores, not an airbrushed look", "natural catchlights in the eyes", "individual strands of hair", "subtle wool texture". Name the tiny details: fabric threads, condensation, chalk dust, vellus hair.
- **Anti-polish cues for candid shots**: "casual iPhone mirror selfie, NOT professional", "realistic social media quality", "slight motion blur, chromatic aberration, amateur snapshot".
- **Color grading**: "clean and bright cinematic color grading with subtle warmth", "muted with cool undertones", "high saturation and contrast".

For illustration and 3D work, name the medium and finish instead:

- "flat vector, suitable for a high school textbook";
- "C4D rendering, blind-box toy aesthetic, smooth plastic with a slight gloss";
- "hand-made polymer-clay look";
- "DreamWorks-like soft rendering";
- "thick-pencil hand-drawn doodle";
- "black-and-white manga line drawing";
- "traditional ink and color handscroll with scattered perspective".

## Edit and preserve

Edits succeed when the prompt states both what to keep and what to change.

1. **Name the base image's role**: "Use the uploaded city photo as the base map", or "Based strictly on the uploaded reference image".
2. **List what must stay unchanged**, item by item. For example: "Keep the person's pose, facial expression, background, and overall realism unchanged". A YAML list such as `preserve_everything: [character identity, facial features and expression, hairstyle and anatomy, outfit design and colors, background, lighting, composition, overall art style]` also works.
3. **Lock identity explicitly** when there is a face:
   - "Keep the facial features of the person in the uploaded image exactly consistent";
   - "100% identical facial features, bone structure, skin tone";
   - "facial_identity: Match reference image exactly 100%, face_edits: None allowed".
4. **Limit the edit's scope**: "Only modify the torn-paper interior areas", "only change the clothes", "Only the smartphone screen portion".
5. **Describe how the change must blend in**: "match the ambient lighting, color temperature, and shadow direction", "the filled area must have the same grain, focus depth, and lighting", "the new text should look printed on the same surface, with slight fading or wear to match".
6. **Say what may change**, when some freedom helps: "poses and expressions may be changed to match the poster design", or "the background of the original image is completely ignored".

Common edit operations, each phrased as in the galleries:

| Operation | Phrasing |
| --- | --- |
| Remove objects | "Remove all the tourists/people in the background … replace them with realistic background elements that logically fit (extend the cobblestone pavement…)" |
| Keep only one thing | "Remove everything in the image except the buildings." |
| Extract a subject | "extract the [samurai] and put transparent background", "Cut out each component and create a model sheet" |
| Outpaint | "Zoom out and expand this image to a 16:9 aspect ratio … complete cut-off objects naturally … do not distort the original center image" |
| Fill transparent areas | "Repair the checkerboard (transparent) parts of the image and restore a complete, coherent photo." |
| Restore | "restore and colorize this photo", "Enhance the resolution of this old image and add the appropriate texture details" |
| Retouch | "This photo is very boring and plain. Enhance it! Increase the contrast, boost the colors, and improve the lighting … You can crop" |
| Change the view | "Convert the photo to a top-down view and mark the location of the photographer", "Have the person in the picture look straight ahead" |
| Relight or change the time | "Turn this scene into nighttime" (Google) |
| Refocus | "Focus on the flowers" (Google) |
| Change camera settings | "RAW-ISO [100] - [F2.8-1/200 24mm] settings" |
| Translate text in the image | "translate all the English text on the three yellow and blue cans into Korean, while keeping everything else the same" (Google); "Translate the … text … Erase the original text and perfectly fill the background … match the font style … keep the price numbers exactly as they are" |
| Undo a change to an object | "Restore this half-eaten [XX] back to its original uneaten state." |

## Reference several images

- **Refer to each upload by number** in the prompt: "Image 1 (the garment) and Image 2 (the model)", "the pose from Figure 3", "the color palette from Figure 2 … the character in Figure 1". Tell the user to upload the images in that order.
- **Assign one role per image (Google)**: "Use Image A for the character's pose, Image B for the art style, and Image C for the background environment." Possible roles include identity, garment, pose, expression, palette, material, lighting, face shape, packaging or sticker style.
- **Use a short transfer formula** when the roles are clear:
  - "Character reference from Image 1 / Change to the expression from Image 2";
  - "Apply the makeup from Image 2 to the character in Image 1, while maintaining the pose from Image 1";
  - "Change the character from Image 1 to the lighting from Image 2";
  - "Overlay the [glass] effect from Image 2 onto the photo in Image 1";
  - "Apply the material from Image 2 to the logo in Image 1".
- **Describe each object in the scene** when composing many uploads into one scene. [Multi-Reference Image Generation] places a model, a car, a handbag with a keychain, a parrot and a pug, and says where each one goes.
- **Use a hand-drawn sketch or stick figure to control pose and layout**, and say so: "using the pose from Figure 3".

## Render text and layout

Nano Banana, especially Pro, can render readable text and full page layouts when the prompt pins them down.

- **Say what the text is and how it looks (Google)**: "The headline 'URBAN EXPLORER' rendered in bold, white, sans-serif font at the top."
- **Quote the exact text**: `the large bold words "Nano Banana Pro"`, `'Autumn Special' … 'Buy One Get One Free' … 'Limited Time Only'`.
- **Give each text element a font, weight, color and position**:
  - "elegant gold serif at the top";
  - "badge or sticker style on the side";
  - "small clean text at the bottom";
  - "height in meters, semibold sans-serif, medium size; year built, lighter weight, smaller, directly beneath".
- **Forbid stray text**: "No other text", "No text, no logos inside the photo preview", "Do not include any words or text on the images", "NEGATIVE: coordinate texts".
- **Ask for correct spelling** and integration: "Ensure all text is perfectly spelled, centered, and integrated into the image's depth of field."
- **Ask for accuracy, and supply facts (Google)**: write "A scientifically accurate cross-section diagram" or "Ensure historical accuracy for the Victorian era", and make sure the facts you give are themselves correct.
- **Name the language** of the labels: "Label each element clearly in English", "Language: Chinese and English labels". For a two-line label system, give the format: "first line Pinyin with tones, second line Simplified Chinese characters".
- **Give the proportions** of the layout: "text occupies 2/3 of the picture, character occupies 1/3", "one large main image at the top, and several smaller images below it", "Place the title prominently in the center or lower third".
- **For diagrams**, name the visual grammar:
  - "align all boxes and diamonds to a strict grid";
  - "straight, orthogonal arrows (90-degree angles only, no curvy lines)";
  - "Use arrows to show the flow of energy and matter";
  - "flows as silky Bezier ribbons";
  - "flat minimalist bar charts, removing excess borders".
- **For designed pages**, name the design system:
  - the background color with its hex code ("warm beige #F3F0E9");
  - a title serif and a body sans-serif;
  - two or three named accent colors;
  - colors to avoid ("Avoid neon colors or pure black");
  - card layouts and grid alignment.
- **To typeset a long text**, say so explicitly: "Put this whole text, verbatim, into a photo of a glossy magazine article … with pull quotes and brave formatting."
- **To make the text itself the shape**, say so: "using only the letters in the phrase … without adding any extra shapes or lines … while still remaining legible."

## Control count, scale and proportion

- **State exact counts, and repeat them**: "exactly the three tallest buildings", "Total 7 characters", "about thirty characters identical to the reference", "a 5-piece jewelry collection", "a constellation of approximately 5 to 10 stars".
- **Enforce a single object** by naming every way a duplicate could sneak in. [Split View 3D Render] says "Render only ONE object", then forbids a second object as a reflection, shadow, silhouette, ghost, or front-and-back pair.
- **Spell out an ordering rule**: "arranged from LEFT to RIGHT in STRICT descending height order … the second must be clearly shorter than the first".
- **Demand true proportions**: "if a building is taller in real life, it MUST be taller in the image by the same approximate ratio", "No forced perspective. Use straight-on orthographic-style rendering."
- **Use deliberate scale contrast** for surreal effects: "Scale disparity: iPhone super-scaled; book and pen miniature", "a realistic, miniature [PRODUCT] held between thumb and index finger", "a giant statue … with people looking up at it".
- **For crowds of the same character**, list positions by depth layer (foreground, middle ground, background), each with a different action. Ask for natural occlusion and perspective falloff, "avoiding symmetry or grid alignment" [Character Cloning].
- **Hard splits**: "split in half, left and right", "a perfectly vertical, perfectly sharp cut line … No soft transition, no fading, no blending", "a bedroom split down the middle: the left side is 2018 and the right side is 1964".
- **Anatomy guards**: "Hands always show five fingers", "no extra limbs, no distorted hands", "Balanced anatomy (1/7–1/8 head-to-body ratio)".

## Use negatives

- **Put negatives in a final `Negative:` line or a `negative` key**, split into content ("multiple characters, male characters, digital art overlay") and style ("no hyper-saturation, no soft focus filters, no heavy vignetting").
- **Make each negative name a concrete failure** you expect for this prompt: "toy-like gloss", "teal-orange tones", "perspective collapse", "mismatched reflections", "watermark", "extra digits".
- **State also what you want**, alongside each negative: "Not soft lighting" next to "narrow beam spotlight with sharp edges".
- **Keep negatives consistent** with the rest of the prompt. Do not list in the negatives something the prompt asks for.

## Generate from knowledge and reasoning

Nano Banana, particularly Pro, can decide the content itself from knowledge or reasoning.

- **Coordinates and time**:
  - "35.6586° N, 139.7454° E at 19:00";
  - "Create an image at 40.7128° N, 74.0060° W, on [date], at [time]";
  - "Place the attached person at the precise coordinates of [lat/long]". Add "NEGATIVE: coordinate texts" so the numbers are not printed.
- **A book, film, paper or article**:
  - "a movie storyboard for the first page of '1984'";
  - "The diagram illustrates the process … based on the paper [citation]";
  - "first retrieving information about the movie/novel and famous scenes … then construct this scene";
  - "Create an infographic about this person's life based on this article".
- **World facts**:
  - "infographic of the 5 tallest buildings in the world";
  - "each state made out of its most famous food";
  - "each state's most iconic landmark".
- **Reasoning over an upload**:
  - "draw what the red arrow sees" on a map screenshot;
  - "Write the answer to the problem in the corresponding position";
  - "make me a delicious lunch with these ingredients";
  - "annotate this meal with names of food and calorie density";
  - "Analyze this image. Use red pen to denote where you can improve."
- **Conditional rules**: "If input reference is a 3D object → show a desktop 3D scanner … If input reference is a 2D image → show a PC monitor displaying it." Use them when the prompt is a template for unknown inputs.
- **Defaults** for missing inputs: "If no number of days is provided, default to a 1-day highlight itinerary."
- **A self-check instruction**: "Check carefully to make sure each state is right."

Treat everything the model draws from knowledge as unverified. One gallery warns that annotated diagrams contained "a considerable number of errors". Tell the user to check names, numbers, labels and facts before using the image.

## Keep a series consistent

- **Fix the constants and name the one variable**: "Each shot maintains the same style, composition, lighting, characters, blur effect, layout and newspaper design, only changing the headline and photo."
- **List three to six visual anchors** that must hold across every frame: palette, signature prop, key light, weather, grain, background markers [Cinematic Keyframe Generator].
- **For grids and sheets**, name the grid and the cell content:
  - "different hairstyles in a 3x3 grid";
  - "four versions: beginner, intermediate, advanced, elite, arranged in order";
  - "Front, Rear, Left, Right, Top, Bottom views on white. Evenly spaced. Consistent subject.";
  - a character sheet with proportions, three views, an expression sheet, a pose sheet and costume design;
  - "four-panel drawing process: line art, flat colors, shadows, refine. No text."
- **For storyboards**, ask for one master contact sheet. Label each panel with "KF number + shot type + duration in safe margins, never covering the subject". Ask also for a text breakdown per frame so any panel can be regenerated alone.
- **For a set of variations of one design (Google)**, establish the design first, and then ask for the variations one at a time with a fixed format: "Now create identity system one by one, use 10 high quality mockups with variety of relevant products, ads, billboards, bus stop, etc. generate one at a time, 16:9 each".
- **For multi-image stories and slide sets**, plan first and then generate one image per page with the same style: "First write a PPT outline … then generate each page, ensuring consistent style … do not turn the PPT into a single image, one image per page." For stories, give the arc and the number of images: "a 12 part story with 12 images … emotional highs and lows … ending on a great twist".
- **Keep continuity rules strict**: same subjects, wardrobe, environment, time of day and color grade. Only action, expression, framing and camera may change. Introduce no new characters.

## Output spec

- **Define the canvas (Google)**, for example "A 9:16 vertical poster" or "A cinematic 21:9 wide shot". Ask for 1K, 2K or 4K output when the app or API offers the choice.
- **State the aspect ratio in words**: "16:9", "9:16 vertical", "vertical 3:4", "4:5", "1:1 aspect ratio", "vertical A4", "widescreen panel". Some gallery prompts use `--ar 2:3` syntax borrowed from other tools; the plain-words form is the one most prompts use.
- **Pixel sizes and resolution words** appear often: "1080×1080", "2048×2560", "4K", "8K". They express the intent for size and detail. The output size you actually get is set by the app or API.
- **Some prompts write sampling settings into the text**, such as "seed=12345, temperature=0". Nothing in the galleries shows that this has any effect. Set seeds and other sampling options in the API or app settings when they are available, not in the prompt.

## Fix a bad result

| Symptom | Change |
| --- | --- |
| Face or identity drifted | Add an explicit identity lock at the start, repeat it at the end, and list the facial features to keep. Remove style words that pull the face toward a type. |
| Edit changed too much | Add a "preserve" list and an "Only modify …" scope line. Describe the blend: light, shadow, grain, focus. |
| Duplicate or extra objects | State the exact count and forbid each duplicate form (reflection, back view, comparison copy, background copy). |
| Wrong text or misspelling | Quote the exact words. Cut the amount of text, and keep only titles and short labels. Add "No other text" and "ensure all text is perfectly spelled". Prefer Pro for dense text. |
| Generic or bland look | Replace adjectives such as "beautiful" or "high quality" with a camera, lens, light setup, film stock or named medium. Add concrete micro-details. |
| Over-polished, fake-looking photo | Ask for natural skin texture and visible pores, "not airbrushed", amateur or social-media quality, grain, and imperfect flash. |
| Wrong layout or proportions | Give fractions or positions ("left third", "2/3 text"), grid alignment, and the order of the elements. |
| Wrong facts in labels or diagram | Supply the facts in the prompt instead of letting the model recall them. Then check every label. |
| Inconsistent series | List the visual anchors and state that only one named variable changes. |
| Style ignored for part of the image | Say which part gets which style ("the outside remains photorealistic, while the inner effect is highly graphic"), and say "this is maintained even if the original image is anime-style". |

## Review checklist

- The first sentence says what the deliverable is.
- Every uploaded image has a number and a role.
- For an edit, the prompt lists what stays unchanged and limits what changes.
- Every word that must appear in the image is quoted. Its font and position are given, and stray text is forbidden.
- Counts, order and proportions are explicit wherever they matter.
- Lighting and style are concrete: a named setup, lens, medium or film stock, not just "high quality".
- Negatives name likely failures and do not contradict the request.
- The aspect ratio is stated.
- Every placeholder is either filled in or flagged for the user.
- Nothing in the prompt conflicts with another part of it, such as asking for "soft lighting" together with "hard flash".

## Safety and rights

Some gallery prompts depict celebrities, real public figures, franchise characters and brand logos, or sexualize their subject. Do not copy those choices.

- **Real people**: edit or reproduce a real person's likeness only with that person's consent, such as the user's own photo. Do not place a real person into a compromising, sexual or deceptive scene.
- **Sexual content**: do not write sexualized prompts. Never write one for anyone who is, or looks, under 18.
- **Protected IP**: for franchise characters, brand logos and trademarked designs, offer an original character or a generic product unless the user owns the rights. One gallery prompt shows the pattern: "No copyrighted characters, no branded designs, no IP logos."
- **Deception**: do not write prompts meant to produce fake documents, fake evidence or a misleading news image of real events.
