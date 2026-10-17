# The ledger

`ledger.json` is written by `ledger init` and edited by you, one row per criterion. Every path in it is relative to the project root, the directory `init` was run in.

## The file

| Field | Holds |
| --- | --- |
| `task` | The task in one line. |
| `root` | The project root, relative to the ledger's own directory. Written by `init`; leave it. |
| `evidence_dir` | The evidence folder. Every file in it must be named by a row, or by `test_logs`. |
| `code` | The files and folders this task changes: product code and tests. Evidence older than the newest file in them is stale. Add to it when the task touches something new. |
| `test_logs` | The saved output of the final test run, with each test listed by name. More than one file when the suite runs in parts. |
| `criteria` | The rows. |

## A row

| Field | Holds |
| --- | --- |
| `id` | `c1`, `c2`, and so on, in the order of the criteria. |
| `criterion` | The criterion word for word. Change it only when the user changed the criterion. |
| `on_screen` | `true` when the criterion is about something a person sees, `false` otherwise. A `true` row needs a picture or a recording among its evidence. |
| `status` | `open`, `proven`, `user-check` or `waived`. See below. |
| `tests` | The names of the tests that cover the criterion, as the test log prints them. |
| `no_test` | Used when `tests` is empty: why no test can cover the criterion, and what checks it in a test's place. |
| `evidence` | The files that show the criterion: transcripts, pictures, recordings. |
| `made_by` | The scripts that made those files. Evidence older than its script is stale. |
| `shows` | What the evidence shows. Backticks are for words copied exactly from a text evidence file of this row, and for nothing else. |
| `stand_in` | When the check was not the criterion as written: what was done in its place, and what that would not catch. Empty otherwise. |
| `accepted` | The user's own words accepting a stand-in or a waiver, with the date. |
| `note` | For `open`: what is missing. For `user-check`: exactly what the user has to run or look at. For `waived`: why the criterion is not met, and the closest behavior. For `proven`: a limit the reader should know, or nothing. |

## Statuses

| Status | Meaning | Counts as done |
| --- | --- | --- |
| `open` | Not proven yet, or tried and not met. | No |
| `proven` | Every clause is shown by the evidence, as written, or by a stand-in the user accepted. | Yes |
| `user-check` | The user will check it themselves. | No |
| `waived` | The user decided it does not have to be met. | Yes, and the report names it |

## A proven row

```json
{
  "id": "c4",
  "criterion": "When a video from an earlier render was at the output path, it is byte-for-byte unchanged after the cancelled run.",
  "on_screen": false,
  "status": "proven",
  "tests": ["t038_c4_an_earlier_video_is_unchanged_after_a_cancel_in_any_stage"],
  "no_test": "",
  "evidence": ["_swe/edd/t038/evidence/c4-earlier-video-unchanged.txt"],
  "made_by": ["_swe/edd/t038/evidence/run.sh"],
  "shows": "A first render writes `demo/out/demo.mp4`. After a cancel in each of the five stages the file says `after the run, demo/out holds: demo.mp4` and `same bytes as before: yes`.",
  "stand_in": "",
  "accepted": "",
  "note": ""
}
```

## What `ledger check` refuses

For a `proven` row:

- an evidence file or a script that is missing or empty;
- `shows` that is empty, that quotes nothing from its text evidence, or that quotes words its text evidence does not hold;
- `on_screen` left undecided, or `true` with text evidence only;
- no test and no `no_test`; a named test that failed, was skipped or ignored, or is not in a test log;
- a `stand_in` with no `accepted`;
- evidence, or a test log, older than the newest file in `code`; evidence older than its own script.

For the whole ledger:

- a file in the evidence folder that no row names: a superseded capture or a leftover;
- a `user-check` row with no `note`, or whose helper script in `made_by` is missing or empty; a `waived` row with no `accepted` or no `note`;
- an evidence file, a script or a test log that lies in the `work/` folder beside the ledger, which is deleted after use;
- once every criterion is closed, a `work/` folder that still holds anything. While criteria are open, this is a note.

It also notes:

- evidence files that hold the same bytes under two names. Keep both only when that is intended, such as the same output proving two criteria in two runs;
- an evidence folder larger than 100 MB, with its largest files, and every picture or recording larger than 5 MB.

`ledger prune` deletes the `work/` folder of a run that `check` finds closed and backed apart from that folder, and checks the ledger again. It deletes nothing while a row is `open` or `user-check`.

`ledger table` prints the rows as a Markdown table, and prints nothing while a problem stands.
