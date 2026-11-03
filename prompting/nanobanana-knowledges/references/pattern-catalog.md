# Nano Banana pattern catalog

This catalog collects the prompt patterns from the sources named in `NOTICE.md`, grouped by what they produce.

Each entry gives:

- the **Pattern** name and its credit;
- **In**: what the user uploads, or "text" when nothing is uploaded;
- **Technique**: the idea worth reusing;
- **Core prompt**: quoted when it is short, and summarized when it is long.

The credit after each name is the creator named by the gallery. **P** is the PicoTrex gallery, **Z** is the ZeroLu gallery, and **G** is Google's own tips. Placeholders in brackets are for the user to fill in.

To reuse a pattern, keep its technique and swap the subject. Before reusing a pattern that names a real person, a franchise character or a brand, apply "Safety and rights" in `prompting-guide.md`.

## 1. Portraits and identity-locked photos

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| One-Click Business Photo — WeChat article (Z) | selfie | Identity lock, then labeled sections for wardrobe, backdrop, camera and lighting, and a realism clause | "Keep the facial features … exactly consistent. Dress them in a navy blue business suit … Background: solid dark gray studio backdrop, subtle vignette … Shot on a Sony A7III with an 85mm f/1.4 … classic three-point lighting … natural skin texture with visible pores, not an airbrushed look … catchlights in the eyes" |
| Professional Headshot Creator — @PavolRusnak (Z) | selfie | Chest-up framing, hex background color, lens and focus point | "maintaining the exact facial structure, identity … framed from the chest up … solid '#562226' studio color … 85mm f/1.8, exquisite focus on the eyes" |
| Emotional Film Photography — WeChat article (Z) | selfie | Film stock, time of day and a candid action | "shot on Kodak Portra 400 … coffee shop window at Golden Hour … subtle film grain … looking slightly away, holding a coffee cup" |
| 1990s Camera Style Portrait — @kingofdairyque (Z) | photo | Era look from a direct flash and room props | "captured with a 1990s-style camera using a direct front flash … wall covered with magazine posters … 35mm lens flash creates a nostalgic glow" |
| 2000s Mirror Selfie — @ZaraIrahh (Z) | photo | JSON spec: `subject`, `face.preserve_original: true`, `photography` and `background.elements[]` | Era props listed one by one: CD player, beaded curtain, posters |
| Compact Camera Screen Display — @kingofdairyque (Z) | photo | A photo shown inside a camera's screen, with a full camera-settings block | "displayed on the screen of a compact Canon digital camera … buttons, dials … ISO 400, 1/60 with flash … No text, no logos inside the photo preview" |
| Hyperrealistic Anime Portrait in Spotlight — @SimplyAnnisa (Z) | text | Tight lighting control, with the negative stated too | "narrow beam spotlight … sharp and dramatic edges … high falloff shadow … Not soft lighting" |
| Fisheye Movie Character Selfie — @Arminn_Ai (Z) | photo | Lens distortion, flash and amateur artifacts; hide the phone | "vintage 35mm fisheye … heavy barrel distortion, without any camera or phone visible … harsh direct flash … film grain, chromatic aberration … amateur snapshot" |
| Museum Art Exhibition Selfie — @brad_zhang2024 (Z) | photo | The same person twice, once in photo style and once in painted style | "posing inside a high-end museum … behind them a framed classical oil painting depicting the same person … thick impasto brushstrokes" |
| Backstage Glamour Photoshoot ("Victoria's Secret Style Photoshoot") — @NanoBanana_labs (Z) | photo | Identity lock stated first and repeated last; only the makeup artist's hands in frame; a flash that makes the costume shine | "Keep the face of the person 100% accurate from the reference image … only her hands are visible in the frame … lit by a flash from the camera, which emphasizes the shine of the beads … Important: do not change the face." |
| Aging Through the Years — @dr_cintas (Z) | photo | Temporal series in one prompt | "Generate the holiday photo of this person through the ages up to 80 years old" |
| Photos of Yourself in Different Eras — @AmirMushich (P) | photo | Swap era slots, then lock the face | "Change the character's style to [1970]'s classical [male] style. Add [long curly] hair, [long mustache], change the background to [californian summer landscape]. Don't change the character's face" |
| Create an ID Photo — @songguoxiansen (P) | portrait | Numbered spec | "Crop the head and create a 2-inch ID photo with: 1. Blue background 2. Professional business attire 3. Frontal face 4. Slight smile" |
| Japanese High School Snap — @SSSS_CRYPTOMAN (Z) | text | A deliberately low-quality look | "A daily snapshot taken with a low-quality disposable camera. A clumsy photo … (Aspect ratio 3:2)" |
| Therapy for Childhood Self — @samann_ai (P) | portrait | The same person at two ages, side by side, with a minimal set and explicit negatives | "adult on the left … child on the right … matching [OUTFIT] … 50mm look, vertical 3:4. No extra people, no text, no watermark." |
| Hyper-Realistic Crowd Composition — @SebJefferies (Z) | text | Many people in one wide frame, with sections for style, mood and environment | "large-format image … group … in a single wide cinematic frame … 35mm, soft fill + strong golden rim light". Use fictional people. |

## 2. Product and commercial photography

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Professional Product Photography — WeChat article (Z) | phone photo | Isolate the product, remove hands, white backdrop with a contact shadow, retouch | "Identify the main product … removing any hands … pure white studio background (RGB 255,255,255) with a subtle contact shadow … fix lens distortion, color-correct" |
| Luxury Product Photography — @AmirMushich (Z) | text | Template with slots for product, scene, lighting and mood | "[BRAND] [PRODUCT] – [bottle shape], [label], [liquid color] … floating on dark water with [flower type] … [lighting style] creates reflections and ripples" |
| Delicate Cute Product Photo — @azed_ai (P) | text | Miniature scale between two fingers | "a realistic, miniature [PRODUCT] held delicately between thumb and index finger … extremely small but hyper-detailed … shallow depth of field" |
| Explosive Food — @icreatelife (P) | product photo | Ingredients bursting around the product | "dramatic modern scene … explosive outward arrangement of the key ingredients … flying around the product … without text … brand colors as background" |
| Crystal Texture Emoji — @ZHO_ZHO_ZHO (P) | text | Material study: glass or crystal with refraction | "[a 3D Polaroid camera] rendered in clear, highly polished glass … rounded chamfers … refraction … high-key, shallow depth of field" |
| Slice Object with Cartoon Explosion — @Arminn_Ai (P) | text | Photoreal outside with a graphic inside | "cut cleanly THE [OBJECT] in half … between the halves a stylized cartoon nuclear explosion … outside remains photorealistic" |
| Product Packaging Generation — @ZHO_ZHO_ZHO (P) | design + can | Apply a design to a package | "Apply the design from Image 1 to the can in Image 2, and place it in a minimalist design setting, professional photography" |
| Brand look onto 3D objects (G) | design | Drape logos and patterns onto apparel or packaging while keeping natural light and texture | "Now create identity system one by one, use 10 high quality mockups with variety of relevant products, ads, billboards, bus stop, etc. generate one at a time, 16:9 each" |

## 3. Fashion and try-on

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Virtual Model Try-On — WeChat article (Z) | garment + model | Numbered images, drape physics, fabric preservation, lighting match | "Using Image 1 (the garment) and Image 2 (the model) … must drape naturally … realistic folds … Preserve the original fabric texture, color, and any logos … matching ambient lighting, color temperature, and shadow direction" |
| Character Clothing Change — @skirano (P) | person + clothing | Limit the scope to the clothes | "Replace the person's clothing … Keep the pose, facial expression, background … unchanged … only change the clothes" |
| OOTD Outfit — @302.AI (P) | person + outfit | Whole outfit, as a series of shots | "dress them in all the clothing and accessories from Image 2. Shoot a series of realistic OOTD-style photos outdoors … Keep identity and pose from Image 1" |
| Fashion Moodboard Collage — @tetumemo (P) | portrait | Portrait surrounded by cutouts of each item | "Surround a portrait with cutouts of the individual items … handwritten notes … brand name and source of each item" |
| Character Deconstruction — @cheerselflin (P) | character | Breakdown sheet with layers, expressions, close-ups, accessories and annotations | "Hand-drawn fashion concept breakdown … Center: full-body … Surrounding: clothing layers, expression sheet, close-ups, handbag contents, material annotations" |
| Multi-asset fashion composite (G) | several images | Combine uploads, set the format, swap one item | "Combine these images into one appropriately arranged cinematic image in 16:9 format and change the dress on the mannequin to the dress in the image." |

## 4. Figures, toys, merchandise and 3D objects

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Illustration to Figure — @ZHO_ZHO_ZHO (P) | character | Figure with its box, a Blender screen and a base, so it reads as real | "turn this photo into a character figure. Behind it, a box with the character's image … a computer showing the Blender modeling process … a round plastic base" |
| LEGO Minifigure / Gundam Model Figure — @ZHO_ZHO_ZHO (P) | person | Packaging-box style in isometric view, plus the unboxed figure | "Transform the person into a LEGO minifigure packaging box style, isometric … title "[NAME]" … essential items as accessories … beside the box, the minifigure itself" |
| Action Figure — @icreatelife (P) | photo | Slots for the label and the accessories | "make an action figure of me that says ["[TITLE]"] and features [items]" |
| Fluffy Plush Toy / Inflatable Toy — @toolfolio, @gizakdag (P) | logo | Material conversion of a flat logo | "Convert a flat vector logo into a soft, fluffy 3D object … completely covered in fur … floating … light gray background" |
| 3D Blind Box Avatar — WeChat article (Z) | portrait | Toy style, keeping key features | "cute 3D Pop Mart style blind box character … keep [hair color, glasses] … C4D rendering … smooth plastic with slight gloss" |
| Pixar-Style Portrait — @NanoBanana_labs (P) | portrait | 3D cartoon avatar | "3D avatar of the young man … smiling … clean white background … soft lighting … realistic proportions with a cartoon touch" |
| Miniature Self-Portrait — @TechieBySA (P) | photo | The person painting a mini figure of themself, with few props so the focus stays on both | "the person as an artist painting a miniature figure … a mini version of themselves on a clean workbench … only two or three small bottles of paint … soft neutral white background" |
| Custom Marble Sculpture — @umesh_ai (P) | subject | Material swap | "ultra-detailed sculpture of the subject … made of shining marble … lighting enhances contours" |
| Toy Disassembly Display — @ZeroZ_JQ (P) | text | Half solid, half transparent shell, with callout lines | "only one [toy] … left half normal, right half transparent shell showing internal structure, with white lines pointing out each part" |
| Split View 3D Render — @michalmalewicz (Z) | text | Realistic half and wireframe half, a hard cut line, a strict single-object rule | "exactly one instance … Left Half — Full Realism … Right Half — Hard Cut Wireframe … perfectly vertical, sharp cut … white lines ≈80%, sampled color <20% … Render only ONE object" |
| Hardware Exploded View / Model Cross-Section — @AIimagined, @old_pgmrs_will (P) | text or photo | Exploded or cutaway technical view | "Exploded view of a DSLR showing all its … internal components … Maintain red accents" and "cutaway … exterior intact on one side, interior exposed on the other" |
| Merchandise Design / Jewelry Collection / Chess Set — @0xFramer, @Gdgtify (P) | image | Turn a motif into a product line | "Create merchandise using this character image.", "Transform this image into a 5-piece jewelry collection.", "a set of 3D-printable chess pieces inspired by this image" |
| Merchandise Display Shelf / Comic Convention Booth / Movie Lounge / Character-Themed Train — @tokyo_Valentine (P) | illustration | Labeled sections (processing, location, merchandise lineup, display, camera, tone, resolution) for a merchandise-filled venue | "Remove the background … turn it into merchandise like figurines … Merchandise Lineup: two 50cm figures, acrylic stands, chibi figures, plush … Resolution: 4K, 4:3" |
| Glass Bottle Souvenir — @NanoBanana_labs (P) | photo | Scaled collectible inside a container | "A 1/7 scale collectible figure … beach diorama … enclosed inside a clear souvenir glass bottle" |
| Model Holographic Projection — @UNIBRACITY (P) | reference | Conditional rules by input type, render rules, camera and negatives | "If input reference is a 3D object → show a desktop 3D scanner … If 2D → show a monitor … semi-transparent volumetric image … No copyrighted characters" |
| Custom Claw Machine — @googlejapan (P) | animal photo | Plush conversion inside a scene, with a strong no-text rule | "deformed as an anime-like plush toy … multiple units inside a UFO catcher … absolutely no text or logos" |

## 5. Miniatures, dioramas and isometric views

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Miniature Store / 3D Chibi Brand Store — @NanoBanana_labs (P), @dotey (Z) | text | Brand-themed tiny shop | "Tiny diorama shop for [BRAND]. Roof made of oversized [PRODUCT] … polymer-clay look, studio macro photo … vertical 3:4" |
| USA 3D Diorama with Landmarks — @DataExec (Z) | text | One platform per region, each with its landmark, in an accurate layout, with labels | "each state is its own miniature platform … most iconic landmark … accurate geographical layout … state and landmark labels" |
| Floating Country Island — @TechieBySA (Z) | text | Country-shaped island with its name carved in 3D | "floating miniature island shaped like [COUNTRY] … Carve "[COUNTRY]" into the terrain using large white 3D letters" |
| City's Tallest Buildings — @michalmalewicz (Z) | text | Strict order, true ratios, orthographic view, typographic captions | "exactly the three tallest … LEFT to RIGHT in STRICT descending height … same approximate ratio … No forced perspective" |
| Miniature Swimming Pool — @Salmaaboukarr (Z) | text | Surreal reuse of a container, grounded with shadows | "oversized open tin repurposed as a swimming pool … tiny sunbathers … soft shadows beneath props" |
| Christmas Ornament Character — @CharaspowerAI (Z) | portrait | A chibi version of the person inside a glass bauble | "Inside, a tiny diorama of the person reimagined as a cute 3d chibi … cinematic reflections on glass" |
| Scene A6 Folding Card — @Gdgtify (P) | image | Pop-up paper craft | "an A6 folding card: when opened, it reveals a complete 3D spherical tiny house with a miniature paper garden" |
| Hand-drawn Isometric View / Convert to Isometric — @AmirMushich, @techhalla (P) | photo | One-line view conversion | "Draw a hand-drawn isometric diagram of this street", "Convert the image to isometric view" |
| Perfectly Isometric Photography — @NanoBanana (Z) | text | Isometric, but explicitly not a miniature | "a photo that is perfectly isometric. It is not a miniature, it is a captured photo that just happened to be perfectly isometric" |
| 3D Isometric Home Office — @dotey (Z) | text | Personalized from what the model knows of the user, with extra detail slots | "Based on what you know about me, generate a 3D isometric illustration of me working from home … [a bichon frise and 3 monitors]" |
| Floor Plan 3D Render / Hard Furnishing Preview — @op7418 (P), WeChat article (Z) | floor plan | Plan to render, or a presentation board with numbered panels and a shared style | "one large main image at the top … smaller images below: 1. living area 2. master bedroom 3. study 4. 3D top-down plan … consistent Modern Minimalist style across ALL images" |

## 6. Surreal effects and materials

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Recursive Visuals / Recursive Image — @venturetwins (Z), @goodside (P) | text | Droste effect, with the repetition stated explicitly | "a cat … holding up an iPad. On the iPad is the same cat in the same scene holding up the same iPad. Repeated on each iPad." |
| Ironing Out Wrinkles — @egeberkina (Z) | text | Visual metaphor as a JSON spec with camera and film stock | "macro … a miniature iron … pressing out wrinkles, leaving a streak of smooth skin … hard ring flash … Hasselblad, Macro 120mm, Kodak Ektar 100" |
| Trans-Dimensional Liquid Pour — @YaseenK7212 (Z) | photo | JSON with a physical realm, a digital realm, a bridge event and physics rules | "Liquid does not splash off the screen … screen acts as a permeable membrane … physical liquid becomes digital upon contact" |
| Urban 3D LED Display — @dotey (Z) | text | Glasses-free 3D billboard with a swappable scene block | "enormous L-shaped glasses-free 3D LED screen … characters break through the screen's boundaries … cast lifelike shadows … scene description: […]" |
| Shop Window Cartoon Reflection — @xmiiru_ (Z) | photo | Real person next to a cartoon doll of themself | "stands outside a luxury toy-shop window … inside, a full-height cartoon-style doll designed to resemble her" |
| Torn Paper Art Effect — @munou_ac (Z) | illustration | YAML edit: preserve list, scoped effects with placement, and a switchable interior style | "Only modify the torn-paper interior areas … placement: across chest height … interior_style: mode: line-art, sumi-e or watercolor …" |
| Add Giant Creature to City — @AI_GIRL_DESIGN (P) | city photo | Keep the photo real and add a flat illustration behind the buildings | "Do not change the real buildings … creature behind the building edge … correct overlapping … subtle color reflections" |
| Giant Figure Scaffolding / Anime Statue in Real Life — @songguoxiansen, @riddi0908 (P) | photo | Giant scale in a real city | "A gigantic statue of this person … in a square in the center of Tokyo, with people looking up at it" |
| Make Object Transparent / Overlay Filter — @icreatelife, @ZHO_ZHO_ZHO (P) | image | One-line material change | "Make this object transparent.", "Overlay the [glass] effect from Image 2 onto the photo in Image 1" |
| Split-Contrast Photo — @fofrAI (P) | text | One room, two eras | "A photo of a bedroom split down the middle: the left side is 2018 and the right side is 1964, in the same room." |
| Constellation Image — @AI_Kei75 (P) | image | Extract one motif and build a star pattern on its pose | "photorealistic starry sky … one motif placed transparently … 5 to 10 stars positioned on distinctive parts, connected with glowing lines" |
| Emoji Combination — @NanoBanana (Z) | text | Combine emoji in a house style | "combine these emojis: 🍌 + 😎, on a white background as a google emoji design" |

## 7. Text, typography, posters and covers

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Magazine Cover — @NanoBanana (Z) | text | Exact quoted title, font, "No other text", and printed details | "the large bold words "Nano Banana Pro" … serif font, black on white … No other text … issue number, today's date, barcode and price in the corner" |
| Commercial Promotional Poster — WeChat article (Z) | text | Numbered text elements, each with a style and position, plus a spelling check | "1. Main Title: 'Autumn Special' in elegant gold serif at the top 2. Offer: 'Buy One Get One Free' badge 3. Footer: 'Limited Time Only' … Ensure all text is perfectly spelled" |
| Viral Cover Image — WeChat article (Z) | portrait | Thumbnail grammar: expression, pointing, arrow, huge outlined text | "excited and surprised … pointing towards the right … bold yellow arrow … massive pop-style text … thick white outline and drop shadow" |
| Golden Quote Card — @stark_nico99 (P) | text | Layout fractions | "serif light gold "[quote]", small text "——[author]" … portrait on the left, text on the right, text 2/3, character 1/3" |
| Historical Newspaper — @TechieBySA (P) | text | Reusable template that changes only the headline and photo | "hands holding a newspaper … headline "[Headline]" … Each shot maintains the same style … only changing the headline and photo" |
| Make a Movie Poster / Train Station Movie Poster — @aiehon_aya, @AI_Kei75 (P) | photo | Infer the genre, then generate the title, tagline, credits and release note in fixed positions | "Automatically classify the photo into a movie genre … title in the center or lower third … credit block … "COMING SOON"" |
| Pirate Wanted Poster — @AI_Kei75 (P) | character | Aged medium, fictional currency and fictional script | "drawn on parchment, brown monochrome … bounty with a fictitious currency … crime written in a fictitious language" |
| Typographic Illustration / Typography Logo — @umesh_ai, @aziz4ai (P) | text | Letters form the shape | "using only the letters in the phrase ['riding a bicycle'] … without extra shapes or lines … still legible" |
| Woodchuck phrase (G) | text | Render a phrase out of a physical material | "the phrase "How much wood would a woodchuck chuck…" made out of wood chucked by a woodchuck" |
| Calligram logo from a sketch (G) | sketch | Loose adherence to a sketch, a named technique, a two-tone palette | "loosely based on the sketch … Don't exactly follow the sketch, get inspired from it … The word "WAVE" is arranged into the silhouette of a wave … light blue background and deep blue logo" |
| Ukiyoe Flash Card — @MANISH1027512 (P) | text | Card template with brace slots, border pattern and calligraphy banner | "Core Instruction … Subject: {Character Name} … performing {Move} … holographic foil background … border of Seigaiha patterns … banner with "{Kanji Name}"" |
| Dark Gothic Tarot Card — @ImperfectEngel (P) | photo | Personal symbols in slots | "a dark gothic tarot card featuring me … Include ["[TITLE]"] and [symbols] … intricate gothic borders" |
| Photo Book Magazine Cover — @minchoi (Z) | photo | Coordinates plus a stakes framing, and a negative for the coordinate text | "fully utilizes the 9:16 ratio … at the precise coordinates of [lat/long] … a critical page that will influence visitor numbers. NEGATIVE: coordinate texts" |
| Novel Scene 3D Poster — @op7418 (Z) | text | Retrieve knowledge first, then a diorama with a museum-label layout | "first retrieving information about the movie/novel … construct this scene as an axonometric 3D miniature … bottom: title and a classic quote in serif" |

## 8. Infographics, diagrams, slides and education

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Concept Visualization — WeChat article (Z) | text | List the components, name the style and audience, use arrows and a label language | "educational infographic explaining [Photosynthesis] … Sun, Plant, H2O into roots, CO2 into leaves, O2 released … flat vector for a high school textbook … arrows … label in English" |
| Elaichi chai infographic (G) | text | Content from world knowledge | "Create an infographic that shows how to make elaichi chai" |
| Article Infographic — @Huang Jian (P) | article | Translate, extract, keep it concise, add characters | "1. Translate into English and extract key information 2. Keep the content concise, only the main title 3. English text 4. Add cute cartoon characters" |
| Generate Biography from Wikipedia — @chrisfirst (P) | link | Infographic from a source text | "Create an infographic about this person's life based on this article [Wikipedia Page]." |
| Generate Flowchart from Document — @anderssandberg (P) | text | Diagram from a cited paper | "The diagram illustrates the process of constructing a Dyson swarm based on the paper [citation]." |
| Hand-drawn Flowchart to Corporate Charts — WeChat article (Z) | sketch | Named style, grid, orthogonal arrows, transcription | "minimalist 'McKinsey-style' … blue-and-gray palette … strict grid … orthogonal arrows (90-degree only) … transcribe labels into bold sans-serif" |
| Financial Sankey Diagram — @bggg_ai (Z) | text | Palette derived from a brand, flow direction, ribbon texture, segment icons | "Extract the brand's primary color … saturated nodes, semi-transparent flows … Left (Revenue) to Right (Net Profit) … silky Bezier ribbons" |
| Create PPT from Article — @op7418 (P) | article | Outline first, then one image per slide with a fixed design system | "First write a PPT outline … then generate each page … consistent style … beige #F3F0E9 … serif titles, sans body … Terracotta #D67052, Mustard #F0B857 … one image per page" |
| Educational Comic — @op7418 (P) | text | Multiple doodle slides for an audience | "multiple 16:9 doodle-style images to explain "futures" to middle school students … consistent thick-pencil style … uniform titles, like a PowerPoint" |
| Children's Literacy Newsletter — @lxfater (P) | text | Page zones, a must-draw object list, a two-line label system | "vertical A4 … title area … scene zones A/B/C … must-draw list of 18 nouns … labels: Pinyin with tones above Simplified Chinese" |
| Kids' Crayon Travel Journal — @dotey (Z) | text | Template with auto-filled stops, decorative element lists and a default | "{City Name} Travel Journal … winding route with stops … If no number of days is provided, default to 1-day" |
| Model Annotation Diagram — @berryxia_ai (P) | text | Annotated scientific model. **The gallery warns that its annotations contained many errors.** | "Draw [3D heart model] for academic presentation, with annotations and explanations" |
| Character Relationship Chart — @KanaWorks_AI (P) | text | Chart from a genre and a count | "[Dating Sim] Character Relationship Chart. names, relationship arrows, affection levels, conflict points. Total 7 characters." |
| Black and White Evolution Chart — @ZHO_ZHO_ZHO (P) | text | Progression chart with a twist ending | "evolution from the earliest apes to humans and finally into a banana" |
| Convert Text Diagram to Pictograms — @nobisiro_2023 (P) | diagram | One-line format conversion | "Convert this explanatory diagram into pictograms." |
| Magazine Layout Generator — @fofrAI (Z) | text | Verbatim long text set in a designed layout | "Put this whole text, verbatim, into a photo of a glossy magazine article … pull quotes and brave formatting" |

## 9. Knowledge and reasoning

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Coordinate Visualization — Replicate (Z), @TechieBySA (P) | text | Place and time from coordinates | "35.6586° N, 139.7454° E at 19:00" |
| Conceptual or Literal prompts — Replicate (Z) | text | Very short open prompts that let the model interpret | "How engineers see the San Francisco Bridge", "rare.jpg" |
| US Map Made of Famous Foods — @emollick (Z) | text | Knowledge per region, with a self-check | "every state is made out of its most famous food (should look made of the food) … Check carefully to make sure each state is right." |
| Knowledge Reasoning Infographic — @icreatelife (P) | text | Ranked facts | "Make me an infographic of 5 tallest buildings in the world" |
| Math Problem Reasoning — @Gorden Sun (P) | problem photo | Solve and write the answer in place | "Write the answer to the problem in the corresponding position based on the question" |
| Cook Based on Ingredients — @Gdgtify (P) | ingredients photo | Infer a dish | "make me a delicious lunch with these ingredients … on a plate … remove the other plates and ingredients" |
| Food Calorie Annotation — @icreatelife (P) | meal photo | Annotate with estimates; check the numbers | "annotate this meal with names of food and calorie density and approximate calories" |
| Red Pen Annotations — @AiMachete (P) | image | Critique drawn onto the image | "Analyze this image. Use red pen to denote where you can improve." |
| Behind the Scenes / How it was made — @ZHO_ZHO_ZHO, @icreatelife (P) | image | Infer the process | "I want to see how this was made" |
| Estimate Age from Face — @Samann_ai (P) | portrait | Analysis infographic overlay. The scores are invented, so present the result as entertainment | "facial analysis grid … 5 aging factors, each with a label line and 0–100% score … "Estimated Age: …" at the bottom" |
| Real World AR Information — @bilawalsidhu (P) | photo | Role framing for annotation | "you are a location-based AR experience generator. highlight [point of interest] in this image and annotate relevant information about it." |

## 10. Maps, locations and viewpoints

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Ground View from Map Arrow — @tokumin (P) | map with a red arrow | A viewpoint from a marker | "draw what the red arrow sees" / "draw the real world view from the red circle in the direction of the arrow" |
| Cross-View Image — @op7418 (P) | ground photo | Ground to top-down view, marking the camera position | "Convert the photo to a top-down view and mark the location of the photographer." |
| Map to Isometric Buildings / Minecraft-Style Scene — @demishassabis, @tetumemo (P) | map | Landmark extraction in a style | "Take this location and make the landmark an isometric image (building only), in the style of [game]" |
| Extract 3D Buildings — @Zieeett (P) | photo | Relight and convert, with the subject scoped | "Make Image Daytime and Isometric [Building Only]" |
| Street View of a fictional place — @techhalla (P) | text | A pipe-separated slot prompt | "Dashcam Google Street View shot \| [place] \| [activity] \| [weather]" |
| Stylized Map — @Mr_AllenT (P) | map | Restyle an aerial view | "Please show me a Las Vegas casino style aerial view." |
| Ancient Map to Historical Photo — @levelsio (P) | old image | A historical scene in modern photo color | "full colour photograph. New Amsterdam in 1660 … as if it's a photograph taken today." |
| Building Extraction from Remote Sensing — @lehua555 (P) | satellite image | Keep only one class of object | "Remove everything in the image except the buildings." |
| Qingming Shanghe Tu Style — @dotey (P) | text | A modern place painted in a classical scroll's technique | "traditional Chinese ink and color handscroll … scattered perspective … Center: the Chicago Riverwalk … hundreds of small figures" |

## 11. Photo editing and restoration

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Composition Rescue — WeChat article (Z) | photo | Outpaint to a target ratio with logical completion | "Zoom out and expand to 16:9 … extend both sides … match lighting, weather, texture … complete cut-off objects … do not distort the center" |
| Smart Crowd Removal — WeChat article (Z) | photo | Remove, then fill with named plausible textures and matched grain | "Remove all the tourists … replace with realistic elements (cobblestone, empty benches) … no smudges … same grain, focus depth, lighting" |
| Image Outpainting Repair — @bwabbage (P) | image with transparency | Fill transparent areas | "Repair the checkerboard (transparent) parts of the image and restore a complete, coherent photo." |
| Old Photo Colorization — @GeminiApp (P) | old photo | One line | "restore and colorize this photo." |
| High-Resolution Restoration — @op7418 (P) | old image | Upscale with a reinterpreted style | "Enhance the resolution … add texture details, reinterpreting it with modern anime techniques." |
| Automatic Photo Editing — @op7418 (P) | photo | A goal-level retouch, with permission to crop | "This photo is very boring and plain. Enhance it! Increase the contrast, boost the colors, improve the lighting … You can crop" |
| Reset Camera Parameters — @hckinz (P) | photo | Camera settings as the whole prompt | "RAW-ISO [100] - [F2.8-1/200 24mm] settings" |
| Day to night / Refocus (G) | photo | Direct one-line edits | "Turn this scene into nighttime", "Focus on the flowers" |
| Extreme Wide Angle Phone Edit — @qisi_ai (Z) | photo + screen image | JSON edit: preserve list, option lists, a screen-replacement rule, global restrictions | "preserve_elements: Person, Face, Hairstyle, Clothing … camera_angle: 12–18mm … screen_replacement: only the smartphone screen … no stretching … No new characters" |
| Extract Subject to Transparent — @nglprz (P) | image | Cutout | "extract the [samurai] and put transparent background" |
| Remove Burger Ingredients / Restore Eaten Food — @bind_lux, @googlejapan (P) | photo | Physical-logic edits | "Remove all the ingredients … keep only the buns. Leave a gap … as if the fillings were still inside." |
| Character Pose Modification — @arrakis_ai (P) | photo | One-line pose edit | "Have the person in the picture look straight ahead" |
| Add Watermark — @AiMachete (P) | image | Repeated overlay text | "Watermark the word '[WORD]' over and over again across the whole image." |
| Face Detection CCTV Simulation — @egeberkina (Z) | photo | Security-camera look, bounding boxes, a zoom inset, a no-text rule | "white rectangular bounding box around each face … a zoom inset … main image noisy, inset clearer … No text, no timestamps" |

## 12. Multi-reference composition and transfer

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Multi-Reference Image Generation — @MrDavids1 (P) | several objects | Place every reference in one described scene | "A model … leaning against a pink bmw. She is wearing the following items … The green alien is a keychain attached to the pink handbag … a pug … wearing a pink collar" |
| Multi-Subject Compositing — Replicate (Z) | several portraits | Group photo with a shared action | "an office team photo, everyone making a silly face" |
| Hand Drawing Controls Poses — @op7418 (P) | characters + sketch | A sketch as the pose control | "Have these two characters fight using the pose from Figure 3 … Generated image ratio is 16:9" |
| Generate image from line drawing — @ZHO_ZHO_ZHO (P) | person + pose drawing | Pose transfer | "Change the pose of the person in Figure 1 to that of Figure 2, and shoot in a professional studio" |
| Color Line Art with Palette — @ZHO_ZHO_ZHO (P) | line art + palette | Palette transfer | "Accurately use the color palette from Figure 2 to color the character in Figure 1" |
| Expression, Makeup, Lighting and Face Shape Control — @ZHO_ZHO_ZHO (P) | character + attribute reference | One attribute per reference | "Character reference from Image 1 / Change to the expression from Image 2"; "Apply the makeup from Image 2 … maintaining the pose from Image 1"; "Change the character from Image 1 to the lighting from Image 2, with dark areas as shadows" |
| Apply Material Sphere to Logo — @ZHO_ZHO_ZHO (P) | logo + material | Material transfer to 3D | "Apply the material from Image 2 to the logo in Image 1, present it as a 3D object, C4D-like, solid-color background" |
| Custom Character Stickers / Emoji Pack — @op7418, @vista8 (P) | character + style | Style reference for a set | "turn the character into a white outline sticker similar to Figure 2 … add a playful short phrase"; "Using the character from Image 2, generate [x] emoji stickers based on the poses from Image 1" |
| Selfie with Movie Character — @rohanpaul_ai (Z) | photo | A scene slot plus an identity lock and an output spec | "I'm taking a selfie with [character] on the set of [movie]. Keep the person exactly as shown … 100% identical facial features … 1:1, 4K" |
| Anime to Real Coser — @ZHO_ZHO_ZHO (P) | illustration | Style crossover with a setting | "Generate a photo of a girl cosplaying this illustration, with the background set at Comiket" |
| Reference roles (G) | 3 images | One role per image | "Use Image A for the character's pose, Image B for the art style, and Image C for the background environment." |

## 13. Character design, sheets, grids and series

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Generate Character Design — @ZHO_ZHO_ZHO (P) | character | A list of sheet sections | "Proportion design … Three views (front, side, back) … Expression sheet … Pose sheet … Costume design" |
| Multi-View Result — @Error_HTTP_404 (P) | object | Orthographic set | "Generate the Front, Rear, Left, Right, Top, Bottom views on white. Evenly spaced. Consistent subject." |
| Change Multiple Hairstyles — @balconychy (P) | portrait | Grid of variants | "avatars of this person with different hairstyles in a 3x3 grid format" |
| Character Level Evolution — @KanaWorks_AI (P) | character | Ordered tiers | "four versions: beginner, intermediate, advanced, and elite … arranged in order" |
| Drawing Process Four-Panel — @ZHO_ZHO_ZHO (P) | character | Process steps as panels | "Step 1: Line art, Step 2: Flat colors, Step 3: Add shadows, Step 4: Refine. No text." |
| Pose Sheet / LINE Stamp — @tapehead_Lab, @emakiscroll (P) | character | Short sheet requests | "Please create a pose sheet for this illustration, making various poses!"; "Character sheet, facial expressions, joy, anger, sadness, happiness" |
| Character Cloning — @tapehead_Lab (P) | character | Many copies, with actions listed per depth layer and natural occlusion | "about thirty characters identical to the reference … Foreground: … Middle ground: … Background: … avoiding symmetry or grid alignment" |
| Component Extraction — @tetumemo (P) | model image | Parts as a sheet | "Cut out each component and create a model sheet that retains the hologram." |
| Y2K Scrapbook Poster — @ShreyaYadav___ (Z) | portrait | The same identity in many poses on one collage, with a pose list and a negative prompt | "multiple subjects wearing the same outfit … different poses and cutouts … Includes: heart-shape fingers, squatting with a polaroid …" |

## 14. Storyboards, comics and stories

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Cinematic Keyframe Generator — @underwoodxie96 (Z) | 1 image | Role, continuity rules, steps (breakdown, theme, approach, keyframes) and one labeled contact-sheet grid | "Do NOT introduce new characters … same wardrobe, environment, lighting, color grade … 9–12 keyframes … ONE master 3x3 grid … label KF number + shot type + duration in safe margins" |
| Storyboard from an image (G) | image | Short request | "Create a storyboard for this scene" |
| Movie Storyboard Creation — @jamesyeung18 (P) | text | Knowledge-based storyboard | "Use a widescreen panel to create a movie storyboard for the first page of "1984"." |
| Movie Storyboard Story — @GeminiApp (P) | 2 characters | Multi-image story with an arc, told without text | "a 12 part story with 12 images … film noir … clues throughout … twist ending … Do not include any words or text" |
| Create Comic Book — @icreatelife (P) | image | Comic strip with a generated story | "make a comic book strip, add text, write a compelling story. I want a superhero comic book." |
| Educational Comic — @op7418 (P) | text | Slides in a consistent style; see section 8 | |

## 15. Screens, games and UI mockups

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| UI Sketch to High-Fidelity Prototype — WeChat article (Z) | wireframe | Named design system, component mapping, a device frame | "modern clean aesthetic like iOS 18 or Material Design 3 … scribbles → placeholder images, rectangles → buttons, lines → text … inside a realistic iPhone frame" |
| Turn Image into Phone Wallpaper — @ZHO_ZHO_ZHO (P) | image | Lock-screen overlay with exact UI details | "time (01:16), date …, status bar … flashlight and camera icons … adapted to the elongated screen" |
| RPG Character Status UI — @AI_Kei75 (P) | character | Character and stat screen side by side | "Keep the character design … fantasy RPG costume … status screen lists parameters, skills, icons … like a 2025 game" |
| Fighting Game Interface — @NanoBanana_labs (P) | 2 characters | HUD elements (health bars, names, portraits) | "both subjects in martial arts stances … modern fighting-game health bars … thumbnail of each character" |
| Become a Vtuber — @AI_Kei75 (P) | character | Streaming layout with fixed positions, ignoring the source pose and background | "Vtuber's upper body bottom right … game screen center … chat on the left … fictional platform UI … aspect ratio independent of the original" |
| Drawing on a Pen Display — @AI_Kei75 (P) | illustration | Work-in-progress state with a percentage | "the original image reproduced on the pen tablet unfinished … about 70% of the coloring done … pen tip touching the screen" |
| Turn X Account into Floppy Disk — @icreatelife (P) | profile screenshot | Retro object from a profile | "Make my X account into a floppy disk in the 90s" |

## 16. Translation and localization

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Physical Store or Travel Translation — WeChat article (Z) | menu photo | Keep the surface texture and the prices | "Translate the dish names into English … Maintain the original aged, greasy look … text looks printed on the same surface … Keep the '¥' symbol and price numbers exactly" |
| Digital Content Localization — WeChat article (Z) | comic or meme | Erase, fill, re-letter in a matching font and fit | "Erase the original text and perfectly fill the background … handwritten-style or bold impact font … fits naturally within the bubbles" |
| Translate packaging (G) | product photo | Scoped translation | "translate all the English text on the three yellow and blue cans into Korean, while keeping everything else the same" |

## 17. Interior design and architecture

| Pattern | In | Technique | Core prompt |
| --- | --- | --- | --- |
| Room Furnishing Visualization — @NanoBanana (Z) | empty room | One-line staging | "Show me how this room would look with furniture in it" |
| Superhero Interior Design — @IqraSaifiii (P) | text | Themed room with a palette, a feature wall, subtle motifs, lighting and a restraint note | "inspired by a [Superhero] … neutral greys with accents of [Theme Color] … 3D wall sculpture … a subtle homage rather than an overt fan-tribute" |
| Contemporary Art Exhibition Space — @UNIBRACITY (P) | image | Exact dimensions, materials, visitor rules, a forbidden list and a definition of done | "hall 20.0 m x 20.0 m x 8.0 m … polished granite reflectance 0.35–0.40 … Forbidden: … teal-orange tones … DoD: …" |
| Custom Theme Park — @AI_Kei75 (P) | image | Extract the palette and motifs into a realistic venue, with scale sanity | "color scheme extracted from the original … mascot costumes moderately distorted … sizes must not be unrealistic … photorealistic even if the original is anime" |
| Chalkboard Anime Art Documentation — @IamEmily2050 (Z) | text | JSON with intent, frame, subject, environment, lighting (5000K), camera and negatives | "intent … documentary_realism … chalk texture, hatching, smudges … 35mm f/5.6 1/60s ISO 400 … negative: …". Use an original character. |
| Blackboard Chalk Drawing / Whiteboard Marker Art — @TlanoAI (P), @nicdunz (Z) | image or text | Restage the art in a physical medium | "Draw this illustration with colored chalk on a blackboard, shot from an angle … in a Japanese classroom … "[text]" written in chalk next to it" |
