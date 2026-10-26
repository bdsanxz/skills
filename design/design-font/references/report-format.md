# report.md

The final report is written to `<project>/report.md` when the font is finished, or when the work stops before it is. It is written for the user, who has seen none of the work: every path is absolute, every number is from the last `dfont check` and `dfont status`.

```markdown
# <family name>

Status: <finished | stopped at <phase>, because <reason>>

## The font

<Two to four sentences: the genre, the voice, the main decisions from brief.md, and what makes it distinct.>

- Styles: <names and weights>; variable font with a wght axis from <min> to <max>
- Character set: <named sets>, <N> glyphs (<drawn> drawn, <built> built automatically)
- Kerning: <N> pairs (<classes> class pairs, <exceptions> exceptions)

## Files

| File | Path |
| --- | --- |
| Static fonts | <project>/dist/otf/, <project>/dist/ttf/ |
| Web fonts | <project>/dist/webfonts/ |
| Variable font | <project>/dist/variable/<Family>[wght].ttf and .woff2 |
| Specimen | <project>/dist/specimen.html |
| Proofs | <project>/proof/ |
| QA report | <project>/qa/report.md |
| Brief | <project>/brief.md |
| Sources | <project>/font.json, <project>/glyphs/, <project>/lib.py, <project>/kerning.json |

## Quality

- `dfont check`: <N> errors, <N> warnings, <N> missing
- Each warning left, and why it is acceptable: <list, or "none">
- Critic reviews: <rounds>, the last one's verdict and its path
- Findings left open: <each should-fix or note finding not fixed, with its reason, or "none">

## Decisions and assumptions

<Each assumption from brief.md, and each decision made during drawing that changed the brief, with the reason.
The user can change any of them.>

## Name

<The family name, and whether it was checked for an existing typeface, and how.>

## License

<The license set in font.json, or: "No license is set. Choose one (the SIL Open Font License 1.1 is the usual one for open fonts) and set it in font.json before you publish the font.">

## How to change it

Edit `<project>/font.json` and `<project>/glyphs/*.py`, then:

    python3 <skill>/scripts/run.py build <project>
    python3 <skill>/scripts/run.py check <project>
```

When the work stopped early, write what is done, what is left, and the exact phase to resume from, so that a new run can continue from `progress.md`.
