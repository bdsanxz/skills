# Final report format

Write `report.md` in the run directory with these sections, in this order. Take the Scores table from `pp scores --markdown`, run after the final round: it copies every number from the latest saved diff of each item. Do not round, average or restate a score, and change only the Status of an item the user accepted, to `accepted deviation`.

```markdown
# Pixel-perfect report

Platform and stack: <platform, framework and styling>
Capture: <how the screenshots were taken, and at which density>
Thresholds: content <n>%, tile floor <n>%, tolerance <n> (<default | set by user>)
Design sources: <each image with its size in points, scale and source quality; say which are soft and what the user decided about them, and which were replaced by a `.subs` copy>

## Result

<One sentence per level: how many components, sections and pages passed, and which did not.>

## Scores

| Item | Variant / image | Content | Worst tile | Naive | Iterations | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| button | primary | 99.61 | 97.2 | 99.9 | 3 | passed | components/button/iter-03/primary |
| nav-link | active | 97.41 | 81.2 | 99.1 | 10 | stopped | components/nav-link/iter-10/active |
| section: header | default | 99.2 | 96.1 | 99.8 | 2 | passed | sections/header/iter-12/default |
| page: home | home-desktop | 99.12 | 95.8 | 99.75 | 4 | passed | pages/home/iter-14/home-desktop |

## Not passed

<For each item that is `stopped` or `accepted deviation`: the best score, what the remaining
difference is, the suspected cause with the numbers behind it (`pixels.allowed`, `ink.mismatched`,
the clusters' `left_pct`, `over_budget` and `ink_missed_pct` from `pp scores`, whether `compare`
reports the item aligned), and what the user decided. Say for each whether what remains is the
ceiling or a gap in the code that is still open.
Omit the section if empty.>

## Assets not built in code

| Asset | Kind | Source | Design image | Rectangle (x,y,w,h) | File |
| --- | --- | --- | --- | --- | --- |

<Every crop, blanked crop, placeholder, supplied file and library icon. Crops and placeholders must show their rectangle, and a blanked crop also the rectangle of each blank.>

## Acknowledged deviations

<Image and text substitutions (which cut-off item now shows which other item's image or text), blanked
crops (which UI was removed from which image), font substitutions, placeholders for obstructed or
cut-off images, accepted scores below threshold.
State each one and its visible effect. Write "None" if there are none.>

## Not verified

<Sizes other than the designs' (name the larger and the smaller size that were looked at, unscored,
and what was fixed after looking), states with no design image, content other than the design's
text, and every device, operating system, browser or renderer other than the one captured.>

## Self-check

<The nine self-check questions, each answered yes or no with one line of evidence.>

## Working files

<Path of the run directory, and a note that `_swe/` is not git-ignored.>
```

The message to the user repeats the Result line and the Scores table, then lists everything under Not passed, Acknowledged deviations and Not verified, and gives the report path.
