# Tips from earlier runs

Every tip here comes from a real run: a mistake an agent made while working this way, with what it cost and what to do instead, or a practice that caught one. Read the part for a phase before starting that phase. When you make a new mistake, or catch one, tell the user so it can be added here.

## Tools and work folders

- **Work files in the system's temporary folder.** Test projects and rendered videos were made under `/tmp` and the session's scratch folder. The user could not find them, asked for everything to be under the working directory, and every folder had to be moved and every path in the evidence corrected, by the agent and by six subagents. Keep every work file under the run directory from the first command.
- **A work folder used twice.** Reruns went into the folder of the run before. Three transcripts then differed only because the earlier run had left state behind, and the delete command meant to reset the folder was refused by a safety check. Give every run a new folder, and make the script refuse an existing one. Nothing has to be deleted and nothing can leak.
- **Runs started from inside the repository.** A replay of recorded commands ran with the repository as its current folder and left 76 output files in it; later a render was found inside a fixture, and four comparison videos beside the sources. Run from the work folder, compare `git status` with the one taken at the start, and remove leftovers by their exact paths.
- **A relative work folder.** A script changed directory and then wrote to a relative path that no longer pointed where it had. Make the work folder path absolute in the script's first lines.
- **A run that hung, unwatched.** A full test run sat on one case for half an hour before the user pointed it out; an experiment that drove a browser hung twice the same way. Put a time limit on every call that can hang, and look at a background run's progress instead of waiting for it to end.
- **A script edited while it ran.** A long evidence script was patched during its run, and it then had to be checked whether the shell had read half of the old text and half of the new. Leave a running script alone; run the changed one in a new work folder.
- **Only the tests were run between tickets.** Formatting and lint failures in newer test files surfaced at the final gate run, on top of everything else waiting there. Run every gate after each criterion, not the tests alone.

## Phase 1: criteria

- **Stand-ins found at the end.** Four kinds of criteria could not be checked as written on that machine: "with the network disconnected", "the user's own browser", "a display with another scale factor", "opened in a standard player". They were checked by stand-ins, marked as done, and mentioned only in the closing summary. The close-out was rejected and reopened. The agent then did one of them for real after all, and the user accepted two and chose to check the last one personally. Look for these while reading the criteria, and ask before building.
- **Criteria paraphrased in a second place.** A progress checklist held each criterion in shortened form. When the user approved new wording for five criteria, the tickets changed and the checklist kept the old text until the final audit. Keep the criterion word for word in the ledger, and read it again at its source before closing.
- **A criterion that the measurements contradicted.** One criterion required the product to match a reference, and two earlier criteria fixed rules under which it could not. The agent measured both sides, put the numbers and three choices to the user (change our rules, approve the gap, decide later), and built nothing until the answer came. Do the same: a contradiction between criteria is the user's decision.

## Phase 2: build

- **A defect parked behind an ignored test.** A subagent found that an error message did not name the file it was about, wrote the test, marked it ignored, and reported its work as passing. The suite was green. Search every test run for skipped and ignored tests, and treat each as a failure until it runs or the user has accepted it.
- **A timing test tuned on an idle machine.** A test sized its long run from two short calibration runs. Alone it passed; in the full gate run, with the other tests loading the machine, it failed and blocked a push. Run a timing-sensitive test under the load the gate gives it, and let it measure again when its first estimate was off.
- **Green here, red on CI.** The tests ran against one build of the browser locally and another on CI. Three passed locally and failed there, and a hang at small sizes showed only with that build. Each round trip cost a CI run. Learn in Phase 0 what the deciding environment uses, and run the suite in that variant before claiming a pass.

## Phase 3: gathering evidence

- **A check weaker than the claim.** The criterion said no process started by the run was left. The check counted processes by the main program's name, so helper processes were never counted, and "0 left" would have been printed with helpers still alive. It was caught by reading the transcript against the criterion's words. Ask of every check whether it would have come out the same with the feature broken, and fix the test along with the script.
- **Decoding offered as playing.** For "the video plays in a standard player" the first evidence was a decode of the file and frames cut from it, then a player whose state a script read. Neither is a person's view of a player playing. It was redone with the video played on screen and screenshots taken during playback. For a criterion about something seen, the evidence is a picture of that thing.
- **Numbers for a criterion about a picture.** A criterion about what a frame shows had only measurements as evidence, and the final audit was the first to notice. Decide `on_screen` when the row is created.
- **One picture under two names.** Two files said to show "during" and "after" had the same bytes. Look at every picture before recording it, and read the notes of `ledger check` about identical files.
- **A failure that was the script's.** A comparison script counted a case that neither side ever shows as a disagreement, and reported 15 of 16. When evidence fails, find out whether the product or the script is wrong before changing either. Apply the same doubt to a pass.
- **Exact equality on measured values.** A comparison of positions failed on a difference of 1e-13. Compare measurements with a margin, and print the margin in the transcript.
- **A transcript corrected by hand.** A phrase in a transcript described the run wrongly, and it was replaced in the transcript and in the script with one edit command. The transcript then no longer was what the script had printed. Fix the script and run it again.
- **The first transcript accepted because it looked right.** The agent's better findings (the weak process check, an exit code that did not fit, a duplicated picture) all came from reading whole transcripts line by line and opening every picture. Searching for the expected line would have found the expected line.
- **Forbidden content almost copied.** The project did not allow log lines in evidence. Evidence about the log had to state conclusions and counts instead. Read the project's rules on records before writing the first transcript.

## Phase 4: recording

- **Quotes written from memory.** Rows drafted from the transcripts quoted values that were close to the files and not in them: a shortened hash, a reworded phrase. A script that searched each quote in its file found them. Copy quotes from the file, and let `ledger check` confirm them.
- **A quote check that also searched the scripts.** The home-made checker looked for each quote in the scripts as well as in the transcripts, so a label that a script prints as fixed text would have counted as found. Name scripts in `made_by`, where quotes are not searched, and let observation lines carry computed values.
- **Rows drafted without the file open.** Two rows drafted by subagents had to be corrected once they were read against their evidence. Write `shows` with the file in front of you, and say what it does not show.

## Phase 5: closing

- **Evidence that outlived a change.** After the user approved new rules for one feature, the evidence of the two tickets about it was redone. One other ticket's evidence, and one test, still assumed the old rules, and were found only by a search during the final gate run. After any change in behavior, run every evidence script again; `ledger check` names what is older than the code.
- **A gate result older than the code.** The record cited "386 passed" from a run made before a later change to a test. Take the test log from a run on the final code, after the last edit.
- **"Nothing is left unverified", beside a list of stand-ins.** The first closing summary said both. Write the report from `ledger table`: a criterion resting on a stand-in is named as one in the result line.
- **"Pushed, CI queued" reported as done.** The CI run had failed, and it was read only after the user reminded the agent to verify its own claims. Wait for the final result of what you started before reporting on it.
- **Evidence deleted while records pointed at it.** When the user had the evidence folder removed after the close, tickets and the progress file still named its files. The agent said so in the record, and moved the folder to the Trash instead of deleting it. Before removing evidence, find what points at it, and tell the user what will dangle.

## Stand-ins

- **The helper that could not be fooled.** For the check the user ran themselves, the helper script refused to start while the machine still had a network route, and had a trial mode whose transcript opened with a line saying it proved nothing. The agent ran both before handing it over. Build every user-run check this way.
- **Asking with the facts.** The question that worked gave, for each stand-in, the criterion's words, what the agent could not do, what it did in its place with the result, and the choices. Three stand-ins were settled in one round.
- **A new status the tools did not know.** When the user chose to check one criterion later, the mark for it had to be taught to three home-made scripts before the records agreed. Use `user-check` from the start.

## Work done by others

- **Reports taken as results.** Subagents reported tickets finished with evidence. The user twice had to ask for their work to be checked. Reading their tests and rerunning their scripts on the current code found the ignored test above; the rest matched, and only then was it relied on. Rerun before you rely, and keep the evidence you made yourself.
- **The user's transcript was cut short.** The transcript of the user's own check lacked its closing line, and their terminal showed only failed retries. The agent recomputed the comparison from the files the run had left, and confirmed from the system's own record that the real condition held from before the run started until after it wrote its results. Then it recorded the criterion as proven, and told the user what it had and had not been able to confirm. A result from the user is checked like any other.
