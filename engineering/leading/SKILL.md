---
name: leading
description: |
  Lead another AI agent through a prepared list of instructions: send one instruction at a time, then verify the work yourself in the code and in UI snapshots before sending the next, and send corrections until it holds. Use when the user gives a set of instructions and asks you to lead, supervise or direct another agent through them, or names this skill. Do not use when you should build the work yourself, or when the instructions have not been written yet.
---

# Leading

You lead one worker agent through a list of instructions the user has provided. The worker does the building. You send, verify, and decide. A step is finished only when you have seen the result yourself, in the code and, when the step touches a screen, in a snapshot.

## Rules

1. The worker's report is a claim, not a result. "Done", `PASSED` and a green summary from the worker prove nothing until you have checked them.
2. Send one instruction at a time, and never the next one until the current step has passed.
3. Send each instruction word for word. Never reword, merge, split, reorder or skip one. If one looks wrong, stop and ask the user.
4. Do not fix the work yourself and do not change the project. Everything you run to verify must leave the project's files as you found them. Your own files go in the run directory.
5. Never weaken a check to reach a pass. A check you could not perform is `NOT VERIFIED`, and it holds the step back until the user accepts it.
6. Never put passwords, keys or tokens in a message, a report or a progress entry. Do not run anything that publishes, deletes data or spends money in order to verify a step. Ask the user if a check needs it.

## Set up

1. Read the instructions file or the conversation that holds the instructions. Split them into ordered steps, keeping each instruction's text exact. If the source is a log that also holds repeats, fixes or diagnoses from an earlier run, take only the original instruction of each step, and show the user the list if that is not clear. If the order or the boundaries are unclear, ask the user one short question at a time. Never edit the source.
2. Give the run a short hyphenated `<slug>` from what is being built. Your run directory is `_swe/leading/<slug>/` in the folder you are working in, with `reports/`, `sent/` and `snapshots/` inside it. If it already exists, go to "Resume".
3. Read the project's instruction files, such as `AGENTS.md`, `CLAUDE.md` and `README.md`. Find out how the project is built, tested and started, and what needs the user's approval.
4. Find a way to take UI snapshots: a browser tool you already have, a Playwright or Chrome DevTools setup the project already has, or a desktop-capture tool for a desktop app. If the instructions touch a screen and you have no way to take snapshots, tell the user before you send anything.
5. Get the worker:
   - If the user named a running agent, find it with `hcx ls` and use its tab name or address.
   - Otherwise ask the user which agent to start. Start it in the project folder, with the permission flag the user wants: `hcx spawn <agent> --folder <project folder> --name <unique name> [flags]`.
   - Read its screen with `hcx read <worker>`. Wait for its prompt before the first message, because a message sent earlier is lost. Answer a folder-trust dialog only after reading it.
   - Note your own address: `$HC_TERMINAL_ID`, or your row in `hcx ls`.
6. Write `progress.md` in the run directory: the source of the instructions, the worker, your address, the project's commands, how you take snapshots, and each step with its title and status (`to do`, `current`, `passed`, or `accepted by user`). Update it at every change in this workflow.

## Send one step

7. Mark the step `current`. Under it in `progress.md`, write the checks:
   - **Code checks:** what the instruction requires to exist or change, plus the project's own test, type and build commands that apply.
   - **UI checks:** what a person must see and be able to do. If the instruction has its own checks, such as a "how I know it works" list, copy them word for word. A step with no effect on any screen says `UI: none` and why.
   - **Must not change:** what the instruction says to leave alone, and everything already passed.
8. Record the starting point:
   - In a git repository, write down `git rev-parse HEAD` and save `git status --short`. Elsewhere, create the empty file `sent/<step>.start`, so you can later find files newer than it.
   - If the step has UI checks and the app already runs, take a snapshot of each affected screen as `snapshots/<step>-before-<screen>.png`.
9. Write the message to `sent/<step>-<attempt>.md`: the instruction word for word, then this closing, with the paths and address filled in:

   ```text
   When you finish or get stuck, write your report to <absolute report path>: what you changed, each check you tried with what you saw, and any error copied exactly. Then run: hcx send --no-footer <your address> "Step <step> report: <absolute report path>"
   ```

   The report path is `reports/<step>-<attempt>.md` in the run directory. `<attempt>` starts at 1.
10. Send it: `hcx send --no-footer <worker> "$(cat <message file>)"`. Read the printed result. If it says the message was not delivered or the delivery is unconfirmed, read the worker's screen before you send again, so nothing is sent twice.
11. Wait for the worker: end your turn when its report arrives as a new turn in your runtime, or run `hcx wait <worker>`. Do not check on it in a tight loop.
12. When you are running again, go to "Verify" once the report file exists. Otherwise, read the screen with `hcx read <worker>` and act on what it shows:
   - **It is still working.** Keep waiting.
   - **It asks a question.** Answer only from the instructions and the project. If they do not answer it, ask the user and pass on the answer.
   - **It stopped without a report.** Ask for the report once.
   - **It is gone or stuck.** Tell the user. With their go-ahead, start a new worker as in item 5, tell it what already exists, and send the step again.

## Verify

Do this only while the worker is idle (`hcx get <worker>`), so the code does not change under you. Read the report from its file, then check everything yourself. Write what you ran and saw under the step in `progress.md`.

**By code:**

13. See what actually changed: `git status --short` and `git diff <start commit>`, including new files and any commits the worker made. Without git, find the files newer than `sent/<step>.start`.
14. Read the changed code against each code check. Confirm that the required behavior is really built, not stubbed, hardcoded or left as a TODO, and that no test was removed or weakened to get a pass.
15. Run the applicable test, type and build commands yourself, and keep the output as printed. If a command writes tracked files, restore nothing: report it to the user as a problem with the check, and use a copy of the project from then on.
16. Compare the change with the instruction. Anything outside it, or anything on the "must not change" list that changed, is a failure.

**By UI snapshot:**

17. Start the app the way its user starts it, or use the one already running, confirming it serves the current code. If you started it, stop it when you finish.
18. For each UI check, do what the check says through the real interface, then take a snapshot as `snapshots/<step>-<attempt>-<check>.png`. Include the error and empty states the check names.
19. Open each snapshot and look at it. A file that exists proves nothing. Judge it against the check's words and the matching `before` snapshot: right content, nothing broken or overlapping, nothing that used to be there gone. A blank or half-loaded picture is not a pass, so take it again.
20. Read the browser's console and failed requests where your tool shows them.
21. Walk one path through a flow that passed in an earlier step that this change could have broken.

**Verdict:** each check is `PASSED`, `FAILED` or `NOT VERIFIED`, based only on what you saw. The worker's report only tells you where to look.

## Decide

- **Every check passed.** Mark the step `passed`, and go to "Send one step" for the next step. After the last step, go to "Finish".
- **A check failed, or the worker changed something it should not have.** Go to "Correct the worker".
- **A check is `NOT VERIFIED`.** Try another way to perform it. If none exists, tell the user what you could not check and why, and wait. If they accept it, mark the step `accepted by user` with their words.
- **The worker says the instruction cannot be done, or it conflicts with an earlier step.** Check whether that is true, then ask the user. Never skip or change the instruction on your own.

## Correct the worker

1. Send the correction to the same worker, so it keeps what it knows, with attempt number +1. Write it to `sent/<step>-<attempt>.md`, and send it as in items 9 and 10:

   ```text
   Step <step> is not finished. Fix only what is below, and keep everything else as it is.

   CHECK THAT FAILED: <the check, word for word>
   WHAT I DID: <your exact actions or command>
   WHAT I SAW: <what happened, the exact output, or the absolute path of the snapshot>
   THESE MUST STILL WORK: <the step's other checks>
   ```

   End it with the same closing as in item 9, with the new report path. Say what is wrong and what you observed, not how to code the fix.
2. Verify again from the start of "Verify", every check, not only the one that failed.
3. After three failed corrections on the same step, stop. Send the user the check, what each attempt tried, the paths of the latest snapshot and report, and your view of the cause, and wait for their decision.

## Finish

1. Run the project's full test, type and build commands once more, and take a final snapshot of each main screen.
2. Tell the user briefly: which steps passed, which were accepted without a check, how many corrections each needed, where `progress.md` and the snapshots are, and anything still wrong. Report only what you saw yourself.
3. Leave the worker's session running unless you started it and the user wants it closed: `hcx done <worker>`. Commit or push only if the instructions or the user ask for it.

## Resume

After a compaction or in a new session, trust the files, not your memory:

1. Read `progress.md`, the source of the instructions, and the latest files in `sent/` and `reports/` for the `current` step.
2. Read the worker's screen with `hcx read <worker>`. If its address no longer answers, find it with `hcx ls`, or handle it as "gone or stuck" in item 12.
3. If the latest message has a report, go to "Verify" and verify it from the start, since you cannot rely on an earlier check that is not written down. If it has no report, continue at item 12. If no message was sent for the `current` step, go to item 8.
