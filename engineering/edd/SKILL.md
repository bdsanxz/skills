---
name: edd
description: Implement a task with Evidence-Driven Development, in which every acceptance criterion gets a passing test and evidence gathered from the real, running product, the evidence is recorded criterion by criterion in a ledger that a script checks, and nothing is reported as done beyond what that evidence shows. Use when the user asks for EDD, evidence-driven development, evidence or proof for each acceptance criterion, a ticket or sprint to be finished "with evidence", or names this skill, for any feature, bug fix or behavior change whose result can be observed. Do not use for work that leaves nothing to observe, such as a discussion, a plan or a review, or when the user wants a change made with no verification record.
---

# EDD

Build the task, then prove it one acceptance criterion at a time. A criterion is done when a test for it passes and evidence gathered from the real, running product shows it, on the final code. The evidence is a file someone else can open and check. The report says what the evidence shows and nothing more.

Four words are used throughout:

- A **criterion** is one checkable statement of what must be true when the task is done.
- **Evidence** is a file that shows a criterion is met: a transcript of commands and what they printed, a picture, a recording, a measurement. A statement that something works is not evidence.
- A **stand-in** is a check that proves something close to a criterion, and not the criterion as it is written: a sandbox in place of a disconnected network, a second browser in place of the user's own.
- The **ledger** is the record of the run: for each criterion, its tests, its evidence, what the evidence shows, and its status.

## Running the ledger script

`ledger` below stands for this shell function:

```
ledger() { python3 "<this skill's directory>/scripts/ledger.py" "$@"; }
```

Define it at the start of every shell command that uses it, because shell state does not carry over between commands. It needs Python 3 and nothing else. `ledger --help` lists its commands. `ledger check` exits 0 when every criterion is closed and backed, 1 when it found problems, 2 on wrong usage, and 3 when nothing is wrong but criteria are still open.

## Non-negotiable rules

1. No evidence, no "done". A criterion is proven only by evidence recorded in the ledger. A passing test alone, an exit code alone, a memory of an earlier run and somebody's report are not evidence.
2. Evidence comes from the real product, driven the way its user drives it: the built program, the public interface, the screen. Tests come in addition, never in its place.
3. Evidence comes from the final code. Evidence made before the last change is stale, whatever the change was: make it again.
4. A criterion is checked as it is written. A stand-in counts only after the user has accepted it, and the ledger says so.
5. Report only what you ran and read yourself. This covers a subagent's results, a CI run, a background run, and a check the user ran for you.
6. Record what the evidence shows, not what you expected it to show. Anything odd in it is investigated until it is explained.
7. Never weaken a criterion, a test or a check to reach a pass, and never change the wording of a criterion without the user.
8. `ledger check` decides what may be claimed. A row it reports a problem for is not proven, and a task it does not exit 0 for is not complete.

## Phase 0: Set up

Before each phase, read that phase's part of `references/tips.md`: the mistakes earlier runs made at that point, and how to avoid them. Start with "Tools and work folders".

1. Read the project's own instruction files, such as `AGENTS.md`, `CLAUDE.md` and `README.md`. Note what they say about: when work counts as done, where evidence and progress records go, what may not be copied into a record (logs, secrets, customer data), and what needs the user's approval (commits, pushes, installs, edits to a ticket). The project's rules decide where things go and what is forbidden. They never lower the rules above.
2. Find out how the project is built and checked: the build, the command for one test and for the full suite, and every other gate it has (formatter, linter, type check, licence check). Find out which environment has the last word, such as CI, and how it differs from this machine.
3. Find out how the real product is started and driven the way its user drives it: a binary, a command line, an HTTP interface, a UI in a browser or a simulator. If nothing here can drive it, tell the user before building: no criterion can then be proven, only tested.
4. Run every gate once before changing anything, and keep the output. If something already fails, tell the user: it must not be mistaken for a result of this task later.
5. Run `git status` and keep the result. At the close it tells your leftovers apart from what was already there.
6. Give the run a name and a directory.
   - The name is short, lowercase and hyphenated: the ticket's id when it has one (`t038`), or else what is being built (`cancel-render`). One ticket is one run.
   - Every working file goes in the run directory, `_swe/edd/<name>/` in the current working directory: `ledger.json`, the evidence in `evidence/`, and a new folder under `work/` for each run of an evidence script. Nothing goes in the system's temporary folder. Do not edit `.gitignore`.
   - When the project names its own place for evidence, pass it to `ledger init` as `--evidence-dir`.
   - If the run directory already exists, run `ledger check` on its ledger to see where each criterion stands, and resume from there.

## Phase 1: Criteria

1. Take the criteria word for word from where the task states them: the ticket, the issue, the spec. Do not reword, merge, split or drop any. If the task states none, write them yourself, one checkable statement each (a condition, and the result someone can observe), show them to the user, and build only after the user agrees.
2. If a criterion is unclear, contradicts another, or seems to be missing, ask the user. Do not guess and do not skip it.
3. Create the ledger:

   ```
   ledger init _swe/edd/<name>/ledger.json --task "<the task in one line>" \
     --criteria-from <the file that holds the criteria> --section "<its heading>" \
     --code <a file or folder this task changes> --code <another>
   ```

   Use `--criterion "<text>"` once per criterion when no file holds them. `--code` lists the product code and the tests the task changes; add to `code` in the ledger when the task grows.
4. For each criterion decide, before building anything:
   - which test will cover it;
   - what its evidence will be: which command or action on the real product, and which observation proves each clause of the criterion;
   - whether it is about something a person sees (a screen, a rendered picture, a video). Set `on_screen` in its row; such a criterion needs a picture or a recording.
5. For each criterion ask: can I check exactly this, here, with what I am allowed to do? A criterion that needs another machine, a disconnected network, a person watching, real hardware or the user's own account cannot be. Settle each of these now, by [Stand-ins](#stand-ins), not after the work is done.
6. Order the criteria so that each one builds on what is already proven.

## Phase 2: Build

Take one criterion, or the few that one piece of code satisfies together.

1. Write the code. Follow the project's conventions, and its order of work when it prescribes one (a spec first, a test first).
2. Write at least one test for each criterion. The test asserts the result the criterion names. Where the project's naming allows it, put the run name and the criterion in the test's name (`t038_c2_no_file_is_left_after_a_cancel`), so that the test is found from the criterion.
3. When no test can cover a criterion (it needs a person, another machine, or is a fact about the repository and not a behavior), write the reason in the row's `no_test`, with what checks it in a test's place: a script, a gate, an inspection.
4. Run the new tests, then the full suite. Never skip, ignore or disable a failing test to move on: a test that did not run proves nothing, and hides the defect it found.

## Phase 3: Gather evidence

Read `references/evidence.md` first: what counts as evidence for each kind of criterion, the rules an evidence script follows, and the form of a transcript.

1. Write an evidence script for the criterion, or one for the run when its criteria share a setup. The script drives the real product and writes one transcript per criterion, and the pictures that go with it, into the evidence folder.
2. Run it in a new work folder, with a time limit on everything that can hang. Run a long script in the background and look at its progress; a run that has stopped making progress is stopped and investigated, not waited for.
3. Read the whole transcript, and open every picture and look at it. Do not search it for the line you hope for.
4. Go through the criterion clause by clause. For each clause, find the line or the part of the picture that shows it. A clause that nothing shows is not proven: extend the script.
5. Ask of each check: would it have come out the same with the feature broken? If it would, it is too weak. Strengthen the script, and the test with it. A check for "no process is left" that counts only the main process is an example.
6. Investigate anything wrong or odd: a warning nobody expected, an exit code, a number that does not fit. Fix a defect in the product, cover it with a test, and go back to step 2 in a new work folder. Fix a defect in the script the same way. Never correct a transcript by hand.
7. When the evidence shows that the criterion cannot hold as written, because the product is right by a decision made earlier, put it to the user: change the behavior, change the criterion, or leave it open. Do not choose for them.
8. Delete evidence that a newer run has replaced.

## Phase 4: Record

1. Fill in the criterion's row, following `references/ledger.md`: its tests, its evidence files, the script that made them, and `shows`.
2. Write `shows` from the files alone: what they literally show, with the exact lines and values that prove the criterion quoted in backticks. Claim nothing the files do not hold. Where a clause was checked in a limited way, say how.
3. Set the status to `proven` only when every clause is shown, as written. Otherwise leave it `open` and write in `note` what is missing.
4. Run `ledger check _swe/edd/<name>/ledger.json`. Fix each problem by changing the work or the claim. Never make a problem go away by removing what the check looks at.

Then go back to Phase 2 with the next criterion.

## Phase 5: Close

Start this phase after the last change to the code. If the code changes again during it, start it again.

1. Read every criterion again at its source and compare it with the ledger, word for word.
2. Run every gate on the final code. Save the test run's full output, with each test listed by name, in the evidence folder, and name it in the ledger's `test_logs`. Search it for skipped and ignored tests: each one is either made to run, or explained to the user in the report.
3. Run every evidence script once more, each in a new work folder. Compare the new files with the ones they replace. A difference you cannot explain is a finding, and goes back to Phase 3. Read every file that changed.
4. Clean up.
   - Delete superseded and duplicate captures from the evidence folder.
   - Compare `git status` with the result from Phase 0, and remove what you left outside the run directory. Remove files by their exact paths, never by a pattern.
   - Stop the processes you started, and only those.
5. Run `ledger check`. It must report no problem. Exit code 3 means the run is consistent and not complete: say so in the report.
6. Update the project's own records (a ticket's checkboxes, a progress file, a roadmap) from the ledger. Mark as done only a criterion that is `proven`, or `waived` by the user. Where the project wants the evidence in the ticket, put the output of `ledger table` there.
7. If the user asked for a commit, a push or a deploy, what follows it is a claim too. Read the final result of the hooks and of the CI run before saying that it passed. "Queued" and "running" are not "passed".

## Phase 6: Report

Write `report.md` in the run directory, following `references/report-format.md`, and give the user its content. Take the table from `ledger table`; do not retype or summarize it. Say "done" or "complete" only when `ledger check` exits 0.

## Stand-ins

A stand-in is found by comparing what the check did with the words of the criterion. "With the network disconnected" checked in a sandbox that denies network calls is a stand-in. So is "opens in a standard player" checked by decoding the file, and "on another machine" checked in an emptied environment on this one.

1. Do the real check when you can. A check that is merely longer or harder is not a reason for a stand-in.
2. When you cannot, ask the user before the criterion is marked as proven. Give them: the criterion word for word, what you cannot do and why, what the stand-in does and what it would not catch, and these choices: accept the stand-in, check it themselves, or leave the criterion open.
3. Record the answer in the criterion's row.
   - **Accepted:** describe the stand-in in `stand_in`, put the user's own words and the date in `accepted`, and gather the stand-in's evidence like any other.
   - **The user checks it themselves:** set the status to `user-check`, and write in `note` exactly what they have to run or look at. Give them a helper script wherever a script can do it. The helper refuses to run unless the real condition holds, writes its transcript into the evidence folder, and has a trial mode whose transcript says that it proves nothing. Test the refusal yourself. A `user-check` criterion is not done, and the task is not complete while one remains.
   - **Left open:** the status stays `open`, with the reason in `note`.
4. When the user has run their check, verify the result like anyone else's work (next section), then record it as evidence and set the status to `proven`.
5. When the user decides that a criterion does not have to be met, set the status to `waived`, with their words and the date in `accepted`, and the reason and the closest behavior in `note`.

## Work done by others

A result you did not produce is a claim until you have checked it.

- **Subagents.** Give a subagent these rules and the criteria word for word. When it reports back: read the tests it wrote, look for tests it skipped or ignored and for defects it worked around, run its evidence scripts yourself on the current code, and compare your results with what it recorded. Keep the evidence you made yourself. Fix or flag every mismatch.
- **CI and other remote runs.** Read the run's final result and its failing step yourself. A test that passes here and fails there points to a difference between the two environments: reproduce it here in the same variant before changing anything.
- **A check the user ran.** Read the whole transcript. Confirm that it is complete, that it was made by the script you gave them, and that the real condition held for the whole run. Recompute what can be recomputed from the files it left. Tell the user what you could confirm and what you could not.
