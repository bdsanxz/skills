---
name: nanobanana-knowledges
description: Write, review and fix prompts that generate or edit images with Google's Nano Banana image models (Nano Banana and Nano Banana Pro, the Gemini image models), using Google's prompting tips and proven prompt patterns curated from two community galleries of tested prompts. Use when an agent must write a Nano Banana or Gemini image prompt, turn a user's idea into one, edit or combine reference images with one, render text, layouts, infographics or slides in an image, keep a character or product consistent across images, or explain why a Nano Banana prompt gave a poor result.
---

# Nano Banana knowledges

This skill turns a request for an image into a Nano Banana prompt. The prompt follows Google's prompting tips and the patterns that worked in two community galleries of tested prompts. Write every prompt you produce in English unless the user asks for another language. Keep any text that must appear inside the image in the language the user wants it rendered in.

## Workflow

1. Classify the request. Note each of these:
   - **Task**: generate from text only, edit one image, combine several reference images, convert one form into another (sketch to UI, floor plan to render, map to street view), or produce a set of images.
   - **Inputs**: how many images the user will upload and what each one is.
   - **Deliverable**: photo, illustration, 3D render, diagram, infographic, poster, slide, sheet or grid.
   - **Text**: whether any words must appear in the image, word for word.
   - **Must stay the same**: identity, product, layout, lighting or anything else the user wants unchanged.

   If something the prompt depends on is missing, such as the exact headline text, the number of panels or which upload is which, ask the user for it. Otherwise choose a sensible default and say which default you chose.
2. Find the closest proven pattern in `references/pattern-catalog.md`. Search it by category and technique, not by subject: a "toy split in half" pattern also fits a phone, a car or a burger. Note the pattern's technique and its source credit.
3. Choose the prompt format that fits the task. Follow `references/prompting-guide.md`, section "Choose a prompt format":
   - a one-line instruction for a well-known transformation of an uploaded image;
   - a natural-language brief for most single images;
   - labeled sections for briefs with many requirements;
   - a JSON or YAML spec for dense, many-attribute scenes and for edits that must preserve a long list of things;
   - a tagged, multi-step role prompt for sequences, storyboards and slide sets.
4. Draft the prompt with the anatomy in `references/prompting-guide.md`, section "Anatomy of a strong prompt". Start from the matching skeleton in `references/templates.md` when there is one. Fill in every slot that matters for this task. Leave out slots that do not matter rather than padding them.
5. Apply the technique sections of `references/prompting-guide.md` that the task needs:
   - "Edit and preserve" for any uploaded image that must keep identity, pose, layout or lighting.
   - "Reference several images" when there is more than one upload.
   - "Render text and layout" when words, labels, charts or a page layout appear.
   - "Control count, scale and proportion" when the number, size or order of objects matters.
   - "Generate from knowledge and reasoning" when the model must look up, infer or compute what to draw.
   - "Keep a series consistent" for grids, sheets, storyboards, slide sets and multi-image stories.
6. Check the draft against the checklist in `references/prompting-guide.md`, section "Review checklist". Fix every item that fails. Also apply that guide's section "Safety and rights". Do not write a prompt for sexualized depictions of real or young-looking people. Do not reproduce a real person's likeness without their consent, and do not reproduce protected characters, logos or brands for commercial-looking output unless the user owns the rights. Offer an original alternative instead.
7. Deliver the result to the user:
   - the final prompt in a fenced code block, ready to paste;
   - which image to upload in which order, labeled the way the prompt refers to them (Image 1, Image 2…);
   - each placeholder still left in brackets, and what to put there;
   - the source pattern it is based on, with its credit;
   - one or two variations worth trying next.
8. When the user reports a bad result, diagnose it with `references/prompting-guide.md`, section "Fix a bad result". Change one thing at a time, and return the revised prompt with a one-line reason for each change. Warn the user to check any facts, numbers, labels, spelling and translated text the model drew, since these are often wrong. The guide's section "What Nano Banana Pro can do" lists the model's known limits.
