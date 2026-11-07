---
name: nanobanana-knowledges
description: Write, review and fix prompts that generate or edit images with Google's Nano Banana image models (Nano Banana and Nano Banana Pro, the Gemini image models), using Google's prompting tips, proven prompt patterns curated from two community galleries of tested prompts, and a library of complete, campaign-grade example prompts to draw inspiration from. Use when an agent must write a Nano Banana or Gemini image prompt, turn a user's idea into one, edit or combine reference images with one, render text, layouts, infographics or slides in an image, keep a character or product consistent across images, or explain why a Nano Banana prompt gave a poor result.
---

# Nano Banana knowledges

This skill turns a request for an image into a Nano Banana prompt. The prompt follows Google's prompting tips and the patterns that worked in two community galleries of tested prompts. Write every prompt you produce in English unless the user asks for another language, even when you talk to the user in theirs. Keep any text that must appear inside the image in the language the user wants it rendered in; when they do not say, use the language in which they gave that text.

Paths below are relative to this skill's directory.

## Workflow

1. Classify the request. Note each of these:
   - **Task**: generate from text only, build a new scene around one upload (its product, face or logo is kept, everything around it is new), edit one image (the same photo with one change), combine several reference images, convert one form into another (sketch to UI, floor plan to render, map to street view), or produce a set of images.
   - **Inputs**: how many images the user will upload and what each one is.
   - **Deliverable**: photo, illustration, 3D render, diagram, infographic, poster, slide, sheet or grid.
   - **Text**: whether any words must appear in the image, word for word.
   - **Must stay the same**: identity, product, layout, lighting or anything else the user wants unchanged.

   When the user describes uploads you cannot see, write the prompt from their description, name what to keep by category ("keep the mug's shape, color, glaze pattern and any mark exactly as in Image 1") rather than inventing values you cannot see, and tell them so. A phrase such as "no photos" can mean that nothing is uploaded or that the image must not look photographic; pick the reading that fits the request, state it, and choose the medium to match.

   Ask the user only when a guess could put wrong content into the image or mix up their uploads: the exact words to print, the number of panels, which upload is which. Choose a default and say which one you chose for anything else, such as a style, a medium, a currency symbol or a paper size. If the user has told you not to ask, choose defaults for everything and list them.
2. Gather inspiration. Open `inspirations/index.md`; its "Where to start" table points common requests to a few entries and catalog sections. If no row fits, pick the index section that matches the task you classified in step 1, choose two or three entries by title and input from its table, and read only those. Stop reading once one entry fits the request closely; adapting it may be all you need. Otherwise scan the section headings of `references/pattern-catalog.md` and read the sections that fit, judging patterns by technique rather than by subject: a "toy split in half" pattern also fits a phone, a car or a burger. Note the credit of each catalog pattern you use, if any; it goes in your delivery notes (step 7), never inside the prompt.

   These examples are a source of ideas, not templates to obey. Borrow a whole prompt, lift one device from it, combine several, or set them aside when the request calls for something they do not show. Your own judgment about what makes this particular image striking comes first.
3. Choose the prompt format that fits the task; an inspiration you mean to adapt may already settle this. Otherwise follow `references/prompting-guide.md`, section "Choose a prompt format":
   - a one-line instruction for a well-known transformation of an uploaded image;
   - a natural-language brief for most single images;
   - labeled sections for briefs with many requirements;
   - a JSON or YAML spec for dense, many-attribute scenes and for edits that must preserve a long list of things;
   - a tagged, multi-step role prompt for sequences, storyboards and slide sets.
4. Draft the prompt with the anatomy in `references/prompting-guide.md`, section "Anatomy of a strong prompt". You can start from an inspiration you gathered, from a skeleton in `references/templates.md`, or from a blank page. When an inspiration has `[SLOTS]`, fill each one with the user's content. The example values listed with it only show the level of detail expected. When you adapt a finished example, replace its invented brand, product and copy with the user's. When an inspiration's image roles differ from the user's uploads, reassign the roles and renumber them to the order the user actually uploads. When you combine entries, reconcile their constraints: a "No text" line from one entry must go when the image now carries a headline, and when two entries name different sources for the style, keep only the one that matches this request. Leave out anything that does not serve this image rather than padding the prompt.

   When the draft reads as a plain description, skim `references/craft-moves.md` for one or two ideas that would lift it: a named core idea, a measured layout, a gaffer's lighting plan, materials described as physics, a subject breaking the frame, a defined failure mode. Deliberately breaking an expected choice is just as valid.
5. Apply the technique sections of `references/prompting-guide.md` that the task needs:
   - "Describe like a photographer" for any photorealistic image, and its media list for illustration and 3D.
   - "Edit and preserve" for any uploaded image that must keep identity, pose, layout or lighting.
   - "Reference several images" when there is more than one upload.
   - "Render text and layout" when words, labels, charts or a page layout appear.
   - "Control count, scale and proportion" when the number, size or order of objects matters.
   - "Generate from knowledge and reasoning" when the model must look up, infer or compute what to draw.
   - "Keep a series consistent" for grids, sheets, storyboards, slide sets and multi-image stories.
6. Check the draft against the checklist in `references/prompting-guide.md`, section "Review checklist". Fix every item that fails. Check the facts the user supplied, such as a weekday that does not match its date or an event date that has already passed, and point out any mismatch without silently changing their text. Also apply that guide's section "Safety and rights". Do not write a prompt for sexualized depictions of real or young-looking people. Do not reproduce a real person's likeness without their consent, and do not reproduce protected characters, logos or brands for commercial-looking output unless the user owns the rights. Offer an original alternative instead.
7. Deliver the result to the user, with your notes in the language the user writes in:
   - the final prompt in a fenced code block, ready to paste;
   - which image to upload in which order, labeled the way the prompt refers to them (Image 1, Image 2…);
   - each placeholder still left in brackets, and what to put there, or that none is left;
   - which model to use when it matters, such as Nano Banana Pro for dense text, real-world facts or many consistent subjects;
   - what to check in the result, such as whether an uploaded product or face came through faithfully, since the model redraws it;
   - the inspiration entries it draws on, by ID (they are original to this skill and need no credit), and each catalog pattern with its creator credit (or say that none was used);
   - one or two variations worth trying next.
8. When the user reports a bad result, diagnose it with `references/prompting-guide.md`, section "Fix a bad result". Change one thing at a time, and return the revised prompt with a one-line reason for each change. Warn the user to check any facts, numbers, labels, spelling and translated text the model drew, since these are often wrong. The guide's section "What Nano Banana Pro can do (Google)" lists the model's known limits.
