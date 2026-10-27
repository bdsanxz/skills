---
name: font-design
description: |
  Design a new typeface from a text brief (reference images optional): draw every glyph, proof and critique each round, space and kern, and deliver a Latin family as OTF, TTF, WOFF2 and a variable font, with a specimen and a QA report. Use when the user asks to design, create or make a font, typeface or type family, or names this skill. Do not use to pick or pair existing fonts, convert or subset font files, or edit a font made with other tools.
---

# Font design

Design a complete type family from a brief, with no step-by-step guidance from the user. You make every design decision yourself, write it down with its reason, and judge your work on rendered proofs, the way a type designer does. The user gets a finished family and a report of every decision, so they can change any of them afterwards.

All drawing is code: each glyph is a Python function that draws strokes over parameters, run once per master. The command-line tool `dfont` builds, proofs, checks, spaces and kerns the project. Every command has a complete `--help`; read it before you use a command for the first time.

## Rules

- **Look at the proofs.** Every judgment of shape, spacing and kerning is made on the PNG proof sheets, which you open and look at. Numbers from `check`, `space`, `kern` and `measure` point at problems; they never prove a glyph is right.
- **Fix every build error and check error before you move on.** Read every warning; fix it or write in `progress.md` why it is acceptable.
- **Draw from the brief, never from another font.** Reference images show genre and mood only: never trace, measure or copy them, or any known typeface.
- **Keep the work recoverable.** Write `progress.md` after every step (step 2.5), so that the work can resume after a compaction or in a new session.
- **Ask the user at most once,** at the start (step 1.2). After that, decide, record the decision as an assumption, and go on.

## Workflow

### 0. Set up

1. `<skill>` is the directory of this `SKILL.md`. Run every command as `python3 <skill>/scripts/run.py COMMAND ...`; this file writes it as `dfont COMMAND ...`. Use a Python 3.9 or newer.
2. Run `dfont setup`. The first run creates the tool's Python environment and installs its dependencies, which needs the network and takes a minute or two. If it exits with status 2, give the user its message and stop.
3. Run `dfont --help` and read the usual order of work and the exit codes: 0 done, 1 done but the font has errors, 2 could not run.
4. **Resuming.** If the user points at an existing project, or a project directory from step 2 already holds `progress.md`, you are resuming: read `progress.md`, `brief.md` and the latest report in `reviews/`, run `dfont status <project>`, and continue from the step `progress.md` names as next. Do not redo finished steps.

### 1. Write the brief

1. Read the request. Extract the use, the voice, the genre if named, the styles and weights, the character set and the name. Describe each reference image in words: its genre, contrast, width, terminals and mood.
2. If the request does not say what the font is for or what it should feel like, and no reference image shows it, ask the user one question that settles it, with the question tool when one is available, offering three or four concrete directions (for example "a calm humanist sans for long reading", "a geometric display face"). Ask nothing else, now or later.
3. Read `references/type-design.md` section 1, and decide the genre, use, x-height, contrast, stress, width, aperture, terminals, joins, the distinctive details and the masters. Defaults when the request is silent: masters Light 300, Regular 400 and Bold 700, styles Light, Regular, Medium and Bold, charset `latin-core`.
4. Choose a family name when the user gave none. Search the web for it when you can, and choose another if a typeface of that name exists.
5. Choose the project directory: the one the user names, else `fonts/<family-slug>/` in the current working directory.
6. Write `brief.md` in the project directory in the format of `references/brief.md` once the project exists (step 2.1). Record every point the request left open under Assumptions.

### 2. Start the project

1. Run `dfont new <project> --family "<name>" --weights <masters> --charset <sets>`, with the masters as `Name:weight` pairs (`Light:300,Regular:400,Bold:700`) and the vertical metrics from the brief (`--xheight`, `--cap`, `--ascender`, `--descender`). Write `brief.md` (step 1.6).
2. `dfont new` makes one style per master. Add every other style of the brief (by default Medium at 500) to `instances` in `font.json`, in weight order; `references/drawing.md` shows the format.
3. Read `references/drawing.md` in full. It is how the project is laid out and how glyphs are drawn.
4. Create `reviews/` in the project directory.
5. Create `progress.md` in the project directory, and keep it current after every step from here on:

   ```markdown
   # Progress: <family name>

   Phase: <step number and name>
   Next: <the exact next action>

   ## Done
   - <step>: <what was done, with the proof and review files it produced>

   ## Accepted warnings
   - <glyph>: <warning>: <why it is acceptable>

   ## Open findings
   - <review file>: <finding id>: <what is left>
   ```

### 3. Set the parameters

1. Set the parameters in `font.json` for every master from the brief, using the stems, widths and corrections in `references/type-design.md` sections 1 to 3. `dfont new` starts them from the weights and metrics; change what the brief decides otherwise (contrast as `bar` against `stem`, width as `n_width` and `o_width`, spacing as the `sb_*` values).
2. Add the parameters your design needs (a terminal angle, a join thinning, a serif length), for every master, so that each grows with weight.

### 4. Draw the control glyphs

The control glyphs n, o, H and O set the design of everything else. Do not draw other glyphs until they pass.

1. Read `references/tips.md`, sections Drawing and Control glyphs.
2. Redraw the starter n, o, H and O in `glyphs/control.py` to the brief. Put each shape that other glyphs will reuse (stem, arch, bowl, terminal, serif) in `lib.py` as a function.
3. Run `dfont build <project>` and fix every error. Run `dfont proof <project>` (the control and detail sheets) and open every PNG it prints. Run `dfont check <project>` and fix every error.
4. Judge the proofs yourself against `references/review-checklist.md` sections 1 and 2, and against `references/type-design.md` section 3. Use `dfont measure` to compare n with o and H with O. Fix what is wrong, and repeat from step 4.3 until you find nothing more.
5. Space the controls by eye on the control sheet (`references/type-design.md` section 5, points 1 and 2).
6. Run a critic round (step 9) on the control and detail sheets. Fix every blocking and should-fix finding, and repeat the round until the critic reports no blocking finding, at most four rounds.

### 5. Draw the rest of the character set

Draw the groups in the order of `references/type-design.md` section 4, one group at a time: lowercase (arches, bowls, diagonals, crossbar letters), capitals, figures, marks, punctuation, symbols. For each group:

1. Run `dfont status <project>` to see the group's missing glyphs.
2. Draw them in `glyphs/<group>.py`, built from `lib.py` and from `g.ref()` of glyphs already drawn, with proportions from `references/type-design.md` section 2. Draw only the bases and marks of accented glyphs; the build makes the rest.
3. Build, then fix every error. Check, then fix every error and read every warning.
4. Proof the glyphs sheet and the detail sheet for the new glyphs (`dfont proof <project> --sheet glyphs --sheet detail --glyphs <names>`), and the spacing sheet. Open every PNG.
5. Judge them against `references/review-checklist.md` sections 1, 3 and 5, in every master. Fix and repeat from step 5.3 until you find nothing more.
6. After the marks, proof the detail sheet with accented glyphs from every base (for example `oacute,Odieresis,iacute,Ccedilla`) in every master, and judge them against section 4 of the checklist.
7. Run a critic round (step 9) after the lowercase, after the capitals, and after the figures, marks and punctuation together, on the glyphs, detail, spacing and text sheets. Fix every blocking and should-fix finding, at most three rounds each.

### 6. Space

1. Read `references/tips.md`, section Spacing, and `references/type-design.md` section 5.
2. Run `dfont space <project>` for each master (`--master`), apply the changes you agree with in each glyph's `g.space()`, and proof the spacing and text sheets.
3. Judge them against `references/review-checklist.md` section 5, and repeat until the spacing looks even.

### 7. Kern

1. Read `references/tips.md`, section Kerning, and `references/type-design.md` section 6.
2. Run `dfont kern <project>`. Read `kerning.suggested.json` and the collision list. Add the pairs you agree with to `kerning.json` (or run with `--write` and remove the ones you do not), halving or dropping suggestions for punctuation next to open shapes, and add the exceptions that keep accented glyphs apart.
3. Proof the kerning and text sheets, judge them against `references/review-checklist.md` section 6, and adjust values until every pair looks right.

### 8. Weights and the variable font

1. Read `references/type-design.md` section 7.
2. Proof the weights and waterfall sheets and judge them against `references/review-checklist.md` section 7. Fix a weight step that does not look even by moving the instance's location in `font.json`; fix a shape that jumps between steps in its glyph function.
3. Run a critic round (step 9) on the text, kerning, weights and waterfall sheets. Fix every blocking and should-fix finding, at most three rounds.

### 9. A critic round

A critic round is an independent review of the proofs. Use it where steps 4 to 8 say.

1. Proof every sheet the round names, for every style, with `--out <project>/reviews/round-<N>/`, where `<N>` is the next unused number in `reviews/`.
2. Invoke `font-design-critic` with: the scope (the phase and the glyphs it covers), the absolute paths of `brief.md`, `references/review-checklist.md` (in this skill's directory) and the round's proof directory, the previous round's report if this round follows one, and the report file `<project>/reviews/round-<N>.md`. Give it no opinion about what is wrong.
3. Read the report file. Do not rely on the agent's reply or on your memory of it. If its `Status` is not `done`, invoke a new `font-design-critic` to continue it from the report file.
4. Fix the findings, as the step that called the round says. A finding you disagree with stays open: write in `progress.md` why you did not fix it. A finding that would change a brief decision changes `brief.md` first.
5. After the round limit, if a blocking finding is still open, write it in `progress.md` and in the final report, and go on.
6. After a compaction, or when resuming, list `reviews/`: the highest-numbered `round-<N>.md` is the last round, and `progress.md` says which findings were fixed.

### 10. Finish

1. Run `dfont status <project>`: nothing must be missing. Run `dfont check <project> --all`: no error must remain, and every warning must be fixed or accepted in `progress.md`.
2. Run `dfont build <project>` and open `dist/specimen.html` or proof every sheet once more (`--sheet all`).
3. Run a last critic round (step 9) on every sheet, with checklist section 8 in scope, and fix what it finds.
4. Write `<project>/report.md` in the format of `references/report-format.md`.
5. Tell the user, in a few lines: the family name and styles, where the fonts and the specimen are, the number of glyphs and kerning pairs, the check result, the open findings and the assumptions they may want to change. Name the report's path.

## When to stop

Stop and tell the user, after writing `progress.md` and `report.md` with `Status: stopped`, only when:

- a command exits with status 2 and its message points at the environment, not the project;
- the same build or check error survives five different fixes;
- the user asks you to stop.

Everything else, including a design question, you decide yourself and record.
