# Inspiration index

A library of complete prompts to borrow from. Nothing here is a required template: lift a whole prompt, steal one device from it, combine two entries, or use them only to calibrate how much detail a strong prompt carries. The best prompt for a task may look like none of these.

- Finished prompts use invented brands and people and are ready to paste.
- Slot templates use `[UPPER_SNAKE]` placeholders such as `[BRAND]`, `[PRODUCT]`, `[COLOR]`, `[SUBJECT]` and `[ASPECT_RATIO]`. Each lists an example value for every slot and is ready to paste once every slot is filled.
- Image numbers (Image 1, Image 2…) follow upload order. Renumber an entry's images to match the order the user actually has.
- Aspect ratios are easy to change: a 4:5 entry adapts to 9:16 or 16:9 by moving its zones. For print and social sizes such as A4, a 5x7 card or an Instagram feed post, see "Output spec" in `../references/prompting-guide.md`.
- An entry's medium is as open as its content: a chalkboard menu can become a painted wooden sign, a photo poster painted key art.
- Ideas that recur across entries are collected in `../references/craft-moves.md`.

## Where to start

Places to look first for common requests, not a rule. Catalog sections are in `../references/pattern-catalog.md`.

| Request | Entries | Catalog sections |
| --- | --- | --- |
| Product shot or ad, no upload | TC01, TC04, TC10, TC17, TC18, TC20 | 2, 6, 7 |
| The user's product photo becomes a campaign image | U01, U16, U03, U12, U13 | 2 |
| The user's photo plus a headline or exact copy | U16, I03, TC17 | 2, 7 |
| Retail promo, class or service flyer, or menu from the user's copy, no photo | I03, I04, I06, I16, TC17 | 7 |
| Event poster, book cover or film one-sheet from a title and credits | I17, I04, I13, TA17 | 7 |
| Infographic, chart, timeline or slides from the user's data | I01, I02, I05, I08, I12 | 8, 9 |
| Logo or brand turned into an object or material | TC02, TC13, TC16, TC22, U04, R05 | 4, 6 |
| Portrait or headshot from a selfie | U06, U07, TA16 | 1 |
| Style, palette, light or pose taken from a reference | R01, R02, R03, R04, R11 | 12 |
| A character placed in a new location | R08, R15, R11, M03 | 12, 13 |
| Character, location and style each from its own upload | R15, R11, R01 | 12 |
| Greeting card or print from uploads, with a greeting line | R15, M03, I13 (drop any "No text" line) | 12, 7 |
| Several uploads in one scene or layout | M02, M03, M04, M06, M09 | 12 |
| Change one thing in a photo and keep the rest | E01–E19 (pick by title from the section 5 table below) | 11 |
| Remove objects from a photo and change its light or time of day (interior or exterior) | E19, E05, E01, E14 | 11 |
| Series, grid, storyboard or comic | TC09, TC19, U12, M10, M12 | 13, 14 |
| Cinematic, editorial or art image from text | TA01–TA21 | 1, 5, 6 |

Files by ID prefix: TC `text-to-image-commercial.md` · TA `text-to-image-editorial-art.md` · U `uploaded-image.md` · R `reference-images.md` · I `input-driven.md` · E `editing-transformation.md` · M `multi-reference-composition.md`.

A new scene built around one upload belongs to "Uploaded image as source"; the same photo with one change belongs to "Editing and transformation"; two or more uploads belong to "Reference images" or "Multi-reference composition".

## 1. Pure generation — commercial and brand

File: `text-to-image-commercial.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| TC01 | Fragrance hero in a tonal set | text only | product hero | 4:5 |  |
| TC02 | Embossed logo plate | text only | brand materialization | 1:1 |  |
| TC03 | Inflated wildstyle type sculpture | text only | 3D typography | 1:1 |  |
| TC04 | Two-zone campaign poster with a breakout | text only | campaign poster | 4:5 |  |
| TC05 | Screen-portal electronics ad | text only | tech campaign | 1:1 |  |
| TC06 | Beverage splash with liquid typography | text only | beverage ad | 9:16 |  |
| TC07 | Luxury e-commerce editorial crop | text only | luxury packshot | 9:16 |  |
| TC08 | Exploded-view hardware hero | text only | technical product ad | 4:5 |  |
| TC09 | Food action series, five frames | text only | image series | 3:4 each |  |
| TC10 | Skincare ingredient story on still water | text only | beauty social ad | 4:5 |  |
| TC11 | Automotive reveal: controlled unsealing | text only | automotive poster | 4:5 |  |
| TC12 | Architectural visualization | text only | architecture | 4:5 |  |
| TC13 | Logo grown from moss and river stone | text only | brand materialization | 1:1 |  |
| TC14 | Crumpled vinyl sticker macro | text only | brand detail | 1:1 |  |
| TC15 | Merch-drop showroom still life | text only | merch launch | 4:5 |  |
| TC16 | Brand embossed plate | text only | brand materialization | [ASPECT_RATIO] | yes |
| TC17 | Two-zone breakout campaign poster | text only | campaign poster | [ASPECT_RATIO] | yes |
| TC18 | Floating product hero in a concept set | text only | product hero | [ASPECT_RATIO] | yes |
| TC19 | Brand identity board, 3×3 | text only | brand system board | 1:1 | yes |
| TC20 | Packaged product on a pedestal with ingredient story | text only | product ad | [ASPECT_RATIO] | yes |
| TC21 | Automotive ad poster | text only | automotive poster | 4:5 | yes |
| TC22 | Elemental logo | text only | brand materialization | [ASPECT_RATIO] | yes |

## 1. Pure generation — editorial, cinematic and art

File: `text-to-image-editorial-art.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| TA01 | Environmental portrait on film | text only | editorial portrait | 4:5 |  |
| TA02 | Cinematic wide: lone figure, vast scale | text only | cinematic still | 21:9 |  |
| TA03 | Isometric miniature diorama | text only | 3D diorama | 1:1 |  |
| TA04 | Picture-book spread | text only | children's illustration | 16:9 |  |
| TA05 | Collectible designer-toy character | text only | 3D character render | 4:5 |  |
| TA06 | Sci-fi concept-art keyframe | text only | concept art | 16:9 |  |
| TA07 | Macro nature with a story | text only | nature macro | 4:5 |  |
| TA08 | Surreal visual metaphor | text only | conceptual photograph | 4:5 |  |
| TA09 | Fashion editorial in a landscape | text only | fashion editorial | 3:4 |  |
| TA10 | Interior design visualization | text only | interior | 16:9 |  |
| TA11 | Typographic illustration | text only | typography art | 1:1 |  |
| TA12 | Character design sheet | text only | character sheet | 16:9 |  |
| TA13 | Vintage travel poster | text only | poster illustration | 2:3 |  |
| TA14 | Dutch still life with food | text only | fine-art food photo | 4:5 |  |
| TA15 | Sticker sheet | text only | sticker set | 1:1 |  |
| TA16 | Environmental portrait | text only | editorial portrait | [ASPECT_RATIO] | yes |
| TA17 | Cinematic film still | text only | cinematic still | [ASPECT_RATIO] | yes |
| TA18 | Isometric miniature diorama | text only | 3D diorama | [ASPECT_RATIO] | yes |
| TA19 | Collectible designer toy | text only | 3D character render | [ASPECT_RATIO] | yes |
| TA20 | Vintage travel poster | text only | poster illustration | 2:3 | yes |
| TA21 | Visual metaphor in miniature | text only | conceptual photograph | [ASPECT_RATIO] | yes |

## 2. Uploaded image as source

File: `uploaded-image.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| U01 | Product photo to luxury campaign visual | 1 upload: product | campaign ad | [ASPECT_RATIO] | yes |
| U02 | Phone snapshot to clean e-commerce packshot | 1 upload: casual product photo | packshot | 1:1 |  |
| U03 | Product to styled top-down flat lay | 1 upload: product | flat lay | [ASPECT_RATIO] | yes |
| U04 | Logo as a soap-foam sculpture | 1 upload: logo | brand materialization | 1:1 |  |
| U05 | Logo revealed through torn street posters | 1 upload: logo | brand street art | 4:5 |  |
| U06 | Selfie to professional headshot | 1 upload: selfie | headshot | [ASPECT_RATIO] | yes |
| U07 | Selfie to golden-hour film portrait | 1 upload: selfie | lifestyle portrait | 3:4 |  |
| U08 | Pet photo to plush toys in a claw machine | 1 upload: pet photo | playful product scene | 4:5 |  |
| U09 | Person to boxed action figure | 1 upload: person photo | collectible packaging | [ASPECT_RATIO] | yes |
| U10 | Sketch to product render | 1 upload: hand sketch | industrial design render | 4:3 |  |
| U11 | Floor plan to presentation board | 1 upload: floor plan | interior presentation | 16:9 | yes |
| U12 | One product, nine-frame mockup storyboard | 1 upload: product | portfolio grid | 4:5 |  |
| U13 | Product floating behind frosted glass hands | 1 upload: product | ethereal product visual | 4:5 |  |
| U14 | Character illustration to merchandise shelf | 1 upload: original character illustration | merch display | 4:3 |  |
| U15 | Photo of a place to an isometric miniature | 1 upload: photo of a building or street | 3D diorama | 1:1 |  |
| U16 | Product photo to campaign poster with a headline | 1 upload: product | campaign poster | [ASPECT_RATIO] | yes |

## 3. Reference images: selective transfer

File: `reference-images.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| R01 | Content from one image, art style from another | 2 uploads: content, style | style transfer | [ASPECT_RATIO] | yes |
| R02 | Color line art with a palette reference | 2 uploads: line art, palette | illustration coloring | same as Image 1 |  |
| R03 | Relight a subject with a lighting reference | 2 uploads: subject, lighting | relight | same as Image 1 |  |
| R04 | Pose from a stick-figure sketch | 3 uploads: character, character, pose sketch | pose control | [ASPECT_RATIO] | yes |
| R05 | Material sphere onto a logo | 2 uploads: logo, material sample | 3D logo | 1:1 |  |
| R06 | Expression from one face, identity from another | 2 uploads: character, expression | expression transfer | same as Image 1 |  |
| R07 | A brand's campaign style applied to a new product | 2+ uploads: existing campaign visuals, new product | campaign extension | [ASPECT_RATIO] | yes |
| R08 | Same character, new world | 2 uploads: character, location | character in scene | [ASPECT_RATIO] | yes |
| R09 | New poster in a reference poster's design language | 2 uploads: reference poster, subject photo | poster | 2:3 | yes |
| R10 | Packaging design applied to a blank container | 2 uploads: flat design, blank container | packaging mockup | 4:5 |  |
| R11 | Three images, three roles | 3 uploads: pose, style, environment | composite generation | [ASPECT_RATIO] | yes |
| R12 | Makeup look transfer | 2 uploads: person, makeup reference | beauty edit | same as Image 1 |  |
| R13 | Character sticker set in a reference sticker style | 2 uploads: character, sticker style | sticker pack | 1:1 | yes |
| R14 | Moodboard to a single campaign image | 2+ uploads: moodboard images, product | campaign visual | [ASPECT_RATIO] | yes |
| R15 | Character in a location, painted in a style image | 3 uploads: character, location, style | illustrated scene | [ASPECT_RATIO] | yes |

## 4. Input-driven images

File: `input-driven.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| I01 | Process infographic | input: steps | infographic | [ASPECT_RATIO] | yes |
| I02 | Financial Sankey diagram | input: income statement figures | data visualization | 16:9 | yes |
| I03 | Retail promotion poster | input: offer copy | promo poster | [ASPECT_RATIO] | yes |
| I04 | Event poster | input: event details | event poster | 2:3 | yes |
| I05 | Slide deck from an outline | input: article or outline | slide set | 16:9 per slide | yes |
| I06 | Café menu board | input: menu items and prices | menu design | 3:4 | yes |
| I07 | Recipe card | input: recipe | recipe card | 4:5 | yes |
| I08 | Illustrated timeline | input: dated milestones | timeline | 16:9 | yes |
| I09 | Product comparison sheet | input: product specs | spec sheet | 4:5 | yes |
| I10 | Magazine spread from a full text | input: article text | editorial layout | 3:2 | yes |
| I11 | Kids' travel journal from an itinerary | input: city and stops | illustrated journal page | 3:4 | yes |
| I12 | Editorial data chart | input: data series | chart | 4:5 | yes |
| I13 | Book cover | input: title and author | book cover | 2:3 | yes |
| I14 | Video thumbnail | input: video topic and hook | thumbnail | 16:9 | yes |
| I15 | Brand-name typographic window poster | input: brand name and slogan | typographic poster | [ASPECT_RATIO] | yes |
| I16 | Juice promo with price and offer | input: offer details | retail social ad | 4:5 | yes |
| I17 | Film one-sheet from a title and credits | input: film title, tagline and credits | theatrical movie poster | 2:3 | yes |

## 5. Editing and transformation

File: `editing-transformation.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| E01 | Day to night | 1 upload: daytime scene | relight | same as upload |  |
| E02 | Change the season | 1 upload: outdoor scene | seasonal transformation | same as upload | yes |
| E03 | Restore and colorize an old photo | 1 upload: damaged old photo | restoration | same as upload |  |
| E04 | Outpaint to a wider frame | 1 upload: tightly cropped photo | outpainting | [ASPECT_RATIO] | yes |
| E05 | Remove the crowds | 1 upload: busy landmark photo | object removal | same as upload |  |
| E06 | Product photo cleanup | 1 upload: product photo | retouch | same as upload |  |
| E07 | New background with matched light | 1 upload: person or product | background replacement | same as upload | yes |
| E08 | Restyle into a different medium | 1 upload: photo | restyle | same as upload | yes |
| E09 | Translate the text in an image | 1 upload: menu, sign or packaging | localization | same as upload | yes |
| E10 | Virtual staging of an empty room | 1 upload: empty room | interior staging | same as upload | yes |
| E11 | Wardrobe change | 1 upload: person | clothing edit | same as upload | yes |
| E12 | Add rain to a street | 1 upload: street scene | weather edit | same as upload |  |
| E13 | Change the camera view | 1 upload: room or object | viewpoint change | same as upload |  |
| E14 | Real-estate sky and grade | 1 upload: house exterior | enhancement | same as upload |  |
| E15 | Torn-paper reveal on an illustration | 1 upload: character illustration | scoped graphic effect | same as upload | yes |
| E16 | Recolor a product | 1 upload: product photo | color variant | same as upload | yes |
| E17 | Upscale and enrich detail | 1 upload: low-resolution image | enhancement | same as upload |  |
| E18 | A giant illustrated creature behind real buildings | 1 upload: city photo | mixed-media composite | same as upload | yes |
| E19 | Listing cleanup: remove objects and change the light | 1 upload: room or house exterior | object removal and relight | same as upload | yes |

## 6. Multi-reference composition

File: `multi-reference-composition.md`

| ID | Prompt | Input | Deliverable | Ratio | Slots |
| --- | --- | --- | --- | --- | --- |
| M01 | Virtual try-on | 2 uploads: garment, model | fashion try-on | [ASPECT_RATIO] | yes |
| M02 | Team photo from separate portraits | 3–8 uploads: individual portraits | group photo | [ASPECT_RATIO] | yes |
| M03 | Lifestyle campaign from model, product and location | 3 uploads: model, product, location | campaign photo | 4:5 |  |
| M04 | Many objects, one styled scene | 5 uploads: person, car, bag, keychain, dog | fashion lifestyle scene | 16:9 |  |
| M05 | Catalog flat lay from item photos | 4–8 uploads: individual clothing items | catalog flat lay | [ASPECT_RATIO] | yes |
| M06 | Fintech launch campaign board | 3 uploads: logo, app screenshot, card design | brand campaign board | 16:9 | yes |
| M07 | Blueprint above, real product below | 1 upload: product photo | split composition | 3:4 |  |
| M08 | Poster from logo, product and character | 3 uploads: logo, product, character | ad poster | 9:16 | yes |
| M09 | Product family hero lineup | 3–5 uploads: products from one range | range hero shot | 16:9 |  |
| M10 | Comic page with two characters | 2 uploads: characters | comic page | 2:3 | yes |
| M11 | Portrait surrounded by an outfit moodboard | 2+ uploads: portrait, item photos | fashion moodboard | 3:4 |  |
| M12 | Cinematic keyframe contact sheet | 1–2 uploads: character, location | storyboard sheet | 16:9 | yes |
| M13 | Three-panel manifesto stack | 2 uploads: product, athlete | vertical campaign stack | 9:16 | yes |
| M14 | Before-and-after split | 2 uploads: before, after | comparison visual | [ASPECT_RATIO] | yes |
| M15 | Stationery suite from a monogram and a photo | 2 uploads: monogram, couple photo | invitation flat lay | 4:5 | yes |
