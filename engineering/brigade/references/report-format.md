# Final report format

Write `report.md` in the run directory with these sections, in this order. Take the state of the orders from `brigade status`, run after the last merge, and the results from what you ran yourself on the integration branch. Do not restate a subagent's result as yours.

```markdown
# Brigade report: <task>

Result: <complete | not complete>. <n> of <n> criteria are met on the merged result.
Where: branch `brigade/<run>/integration` at <commit>, started from <base> at <commit>.
Delivered into <branch> at <commit> by fast-forward <, or: what is not delivered yet, and why>. <Pushed | not pushed>.
Gates on the merged result: <each gate with its result: tests <n> passed, <n> failed, <n> skipped; linter; and so on>.
Left on disk: <the size of the run directory, from `du -sh`>, <the trees still in it and why>.

## Criteria

| # | Criterion | Orders | What I ran and saw on the merged result | Result |
| --- | --- | --- | --- | --- |
| c1 | <word for word> | <the orders that cover it> | <the command or the action, and what it showed> | <met, not met, or not checked> |

## The graph

<The order of work as `brigade check` printed it. Where the graph came from: the user's document,
named, or your own mapping. Every edge you added to a document of the user's, and why.>

## Orders

| Order | Rounds | Its reports | What I checked before merging | Merged at |
| --- | --- | --- | --- | --- |
| <id> | <1, or more when it was sent back> | <`reports/<id>.md`, and one more file for each later round> | <the `checked` text of `brigade status`> | <commit> |

<One line for each dropped order: why, and which orders replaced it. One line for each other
subagent you used, such as an explorer or a reviewer, with the file of its report.>

## Decisions and deviations

<Each decision the user made during the run. Each change you made yourself to product code, with
the reason. Each thing that was built and not asked for, and whether it was removed or kept.
Omit the section if empty.>

## Open

<Each criterion that is not met or was not checked, with what is missing. Each tree or branch
that was left in place, with what it holds. Omit the section if empty.>

## Not verified by me

<Anything stated in this report that rests on someone else's word: a subagent's result you did not
rerun, a CI run still in progress. Omit the section if empty; an empty section means every
statement above was run and read by you.>
```

Rules for the text:

- "Complete" is used only when `brigade status` exits 0 and every criterion in the table is met.
- A criterion is "met" only when you checked it yourself on the integration branch, after the last merge. An order's own check in its tree, before the merge, does not count for this table.
- A result given as a number is copied from the output of a run on the merged result, not from a subagent's report and not from memory.
- Name report files by their paths in the run directory, so that the reader can open them. Say when a report was saved by you from a subagent's reply, and not written by the subagent.
- Say whether anything was merged into the user's branch or pushed.
