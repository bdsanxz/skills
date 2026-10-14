# Final report format

Write `report.md` in the run directory with these sections, in this order. Every number and every status comes from `ledger check` and `ledger table`, run after the last change. Do not restate a result in stronger words than the ledger uses.

```markdown
# Evidence report: <task>

Result: <complete | not complete>. <The summary line of `ledger table`.>
Code state: <the commit, or "uncommitted changes on <branch>">, checked on <date>.
Gates: <each gate with its result on the final code: tests <n> passed, <n> failed, <n> skipped; formatter; linter; and so on>.

## Evidence

<The table printed by `ledger table`, unchanged.>

## Not checked as written

<One line for each criterion proven by a stand-in: what the criterion asks, what was checked in its
place, what that would not catch, and the user's words accepting it. Add each limit of a
measurement that a reader would otherwise assume away. Omit the section if empty.>

## Open

<One entry for each `open` and `user-check` criterion. For `open`: what is missing and what was
tried. For `user-check`: the exact command to run or thing to look at, and what happens once it is
done. Omit the section if empty.>

## Waived

<Each `waived` criterion: why it is not met, the closest behavior, and the user's words. Omit the
section if empty.>

## Found along the way

<Each defect the evidence uncovered, in the product or in a test, with its fix and the test that
now covers it. Each skipped or ignored test that remains, with the reason. Each decision the user
made during the run. Omit the section if empty.>

## Not verified by me

<Anything stated in this report that rests on someone else's word: a CI run still in progress, a
result of a subagent that was not rerun, a part of the user's own check that could not be
confirmed. Omit the section if empty; an empty section means every statement above was run and
read by you.>
```

Rules for the text:

- "Complete" is used only when `ledger check` exits 0. With exit 3 the first line reads "not complete", however little remains.
- A result the report gives as a number (tests passed, frames compared, a measured time) is copied from the output of a run on the final code, not from memory and not from an earlier run.
- "Not checked as written" and the sentence "everything was verified" cannot both appear. When a stand-in exists, the result line says how many criteria rest on one.
- Say whether anything was committed or pushed, and whether the evidence is part of it.
