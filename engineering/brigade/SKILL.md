---
name: brigade
description: Run a task as a brigade, with yourself as the lead. You map the task into a dependency graph of work orders, finish the foundation first, hand each order to a `brigade-worker` subagent that works in its own git worktree and writes its report to a file, run every independent order at the same time, check each returned order yourself against its acceptance criteria before merging it, deliver each merge to the branch the run started from by fast-forward once the gates pass, and validate the result against the original request. Use when the user asks for brigade engineering, a brigade, a lead agent that delegates to parallel subagents, or agents working in git worktrees, or names this skill, for a task large enough to split into parts. Do not use for one small change, for work that cannot be split, or outside a git repository.
---

# Brigade

You are the lead of a brigade. You do not build the task yourself. You map it into orders, hand each order to a `brigade-worker` subagent, run as many at once as their dependencies allow, check everything that comes back, and answer to the user for the result.

Six words are used throughout:

- An **order** is one part of the task, handed to one subagent: what to build, the criteria it must meet, and the paths it may change.
- The **graph** is the orders and which of them must be finished before which. It has no circle. An order may start when every order it comes after is merged.
- The **foundation** is the orders that set up what all the others build on: scaffolding, tooling, shared structure. They run one at a time, before everything else.
- A **tree** is the git worktree of an order: its own folder on its own branch.
- The **integration branch** is where accepted orders are merged and the gates run on them together. It has its own tree. Each merge that passes the gates is delivered from it to the branch the run started from.
- The **plan** is `plan.json`: the criteria, the orders and the graph.

## Running the brigade script

`brigade` below stands for this shell function:

```
brigade() { python3 "<this skill's directory>/scripts/brigade.py" "$@"; }
```

Define it at the start of every shell command that uses it, because shell state does not carry over between commands. It needs Python 3 and git 2.38 or newer. `brigade --help` lists its commands. Every command exits 0 when nothing is wrong, 1 when it found problems, and 2 on wrong usage. `brigade status` exits 3 when nothing is wrong but orders are not merged yet.

Every command ends with a disk line on standard error: what the current working directory takes on disk, and what its disk has free. A folder too large to count within a few seconds is given as "at least" what was counted. Do not hide standard error. Read the line after every command, and compare it with the one before. When the folder grew by more than the step should have added, or the free space no longer holds what the next step needs, find what grew and remove the leftovers of this run (by Phase 5 and Phase 7) before you go on.

## Non-negotiable rules

1. You delegate, you do not build. Subagents write the product code and the tests. Your own changes are the plan, the merges, and a correction that is smaller than the message asking for it would be. Each such correction is named in the report.
2. No work is handed out before the graph is sound. `brigade check` reports no problem first.
3. The foundation comes first, and alone. Scaffolding and initial setup are never run in parallel and never done by two subagents. Every other order starts from the merged foundation and follows its patterns.
4. Only orders that are independent in the graph run at the same time: neither waits for the other, and they own no path in common. Every order that can run at the same time does.
5. One order has one subagent, one tree and one branch.
6. A subagent's report is a claim. You merge nothing that you have not inspected, read and run yourself.
7. Every subagent is a `brigade-worker`, and writes its report to a file in the run directory, whatever its job: building an order, reworking one, exploring the code, reviewing a diff. A report that exists only in a reply is lost when your conversation is compacted. No order is merged, and no new round starts, while a report is missing.
8. The report files are your memory of the run. Whenever you need a detail of a subagent's work that you no longer hold word for word, read its report file again. Do not answer from a summary.
9. The request is the measure. The criteria are kept word for word, nothing is built that no criterion asks for, and a change to what was asked is the user's decision.
10. A graph the user gave is used as given. You do not replace it with your own.
11. Every accepted order reaches the branch the run started from as soon as the gates pass on the integration branch, and only by `brigade deliver`: a fast-forward, never a merge commit or a rebase on the user's branch. Commits are made only on the run's own branches. Nothing is pushed until the user says so. Nothing is ever forced: no forced removal, no deleted unmerged branch, no hard reset of someone's work.
12. The run keeps the disk clean. A tree exists only while its order is out: merging an order removes its tree, with its build output, and a dropped order's tree stays only until the user agrees to discard it. Everything the run writes, yours and the subagents', is under the run directory, inside a tree, or in a place the project's own instructions name for its records, such as an evidence folder. Nothing goes in the system's temporary folder, in the project's scratch folders, or in a copy of the repository made beside the trees.

## After a compaction

When your conversation was compacted, or you resume a run you do not remember in full, recover the run from its files before you do anything else. The summary you were left with is not a record.

1. Read `request.md` and the plan in the run directory.
2. Run `brigade status <plan>`. It shows which orders are merged, started, ready and waiting, the round each one is in, and whether every merge is delivered. Deliver an undelivered merge by Phase 5, steps 3 and 4, before you start anything new.
3. For every order that is started, read its work order in `orders/` and, if it is there, its report in `reports/`, in full: `<order>.md`, and `<order>.round-<n>.md` for each later round. A started order with no report for its current round is still out, or its worker stopped: look at its tree before you launch anything for it, and continue it by "Runs that stop or hang" in Phase 3.
4. Read every other report whose content you need for what comes next: the explorations before you change the graph, the reports of merged orders before you write `report.md`.
5. Go on from the phase the status points to. Do not launch a second worker for an order that is started.

## Phase 0: Set up

Before each phase, read that phase's part of `references/tips.md`: the mistakes earlier runs made at that point, and how to avoid them.

1. Read the project's own instruction files, such as `AGENTS.md`, `CLAUDE.md` and `README.md`. Note where plans and tickets live, when work counts as done, and what needs the user's approval.
2. Look at the repository with `git rev-parse --show-toplevel` and `git status`.
   - Not a git repository: worktrees need one. Stop and ask the user.
   - No commit yet: a tree starts from a commit. Ask the user to let you make an empty first commit.
   - Uncommitted changes: no tree will hold them, and `brigade deliver` refuses while tracked files have them. Ask the user whether to commit them first, leave them out, or stop. Leaving out changes to tracked files means that nothing can be delivered until they are gone: say so when you ask.
3. Give the run a name and a directory. The name is short, lowercase and hyphenated: the sprint's or the ticket's id, or what is being built. Every working file goes in `_swe/brigade/<name>/` in the current working directory: the plan, `request.md`, what each subagent was asked in `orders/`, what each subagent answered in `reports/`, the trees in `trees/`, what your own checks must keep (a gate log, a findings file) in `checks/`, and your final `report.md`. If that directory exists already, resume the run by the steps of "After a compaction".
4. Save the request word for word in `request.md` in the run directory, with the path of every document the user attached or pointed to. This file is what the result is measured against at the end.
5. Take the criteria word for word from where the request states them: the tickets, the issue, the spec. Do not reword, merge, split or drop any. If the request states none, write them yourself, one checkable statement each, show them to the user, and go on only after the user agrees.
6. Create the plan:

   ```
   brigade init _swe/brigade/<name>/plan.json --task "<the task in one line>" \
     --criteria-from <a file that holds criteria> --section "<its heading>"
   ```

   Repeat `--criteria-from` for each ticket; the criteria of each file then keep its name in their ids. Use `--criterion "<text>"` once per criterion when no file holds them. Add `--source "<the document>"` when the orders will come from the user's own plan or tickets.
7. Find out how the project is built and checked, and write it in the plan: every gate (tests, formatter, linter, type check) in `gates`, and in `setup` every command a fresh checkout needs before its gates can pass (installing dependencies, generating code, copying an environment file). A project that does not exist yet has neither. Fill them in when the foundation is merged.
8. Find what the trees do not keep apart: ports, databases, caches, simulators, global installs, outside accounts. An order that needs one gets its own (a port number, a database name) in its `notes`, or the orders that share it are put one after the other.
9. Run `brigade start <plan>` with no order. It creates the integration tree and nothing else. Run the setup and every gate in that tree yourself.
   - If a gate fails there and passes in the checkout, `setup` is incomplete. Fix it now, before several subagents each find out.
   - If a gate fails in both, tell the user. It must not be taken for a result of this run later.
10. Measure what a tree costs on disk: `du -sh` of the integration tree after its setup and gates, and `df -h` of its disk. Every order that is out has a tree that grows to about that size. Decide how many trees the free space holds with room left over, and keep at most that many orders out. When the toolchain can share build output between checkouts safely (a compiler cache, a shared download cache), put that in `setup`. Do not point several trees at one build folder: they would build over each other.

## Phase 1: Map the graph

Read `references/plan.md` first: the fields of the plan and of an order, and an example.

### When the user gave a graph

Before splitting anything, look for a plan, tickets, a roadmap or a similar document that already names the parts of the work and what depends on what: attached to the request, pointed to by it, or kept where the project's instructions say work is planned.

1. Take the document as it is. Make one order for each of its items, with the item's id as the order's id, the item's criteria word for word, and `after` taken from the dependencies it states. Do not split, merge, reorder or drop its items, and do not drop a dependency.
2. Add only what the document does not hold: the paths each order owns, the `foundation` mark on the items that set up the project, the `checks` you will run on each. An item marked `foundation` runs alone and first, even where the document would let it run beside others. Tell the user which items you marked.
3. Run `brigade check`. A problem here is a finding about the document.
   - Two items that the document lets run together, and that must change the same file: add `after` to one of them, in the direction the document's own order suggests. This costs time and loses nothing. Tell the user which edge you added.
   - Anything else is the user's decision: a circle, a dependency that seems wrong, an item that seems to be missing or that covers no criterion. Give them the items, what `check` said, and the smallest change that would resolve it.
4. When the document names the items and not their dependencies, the items stay as they are, and the edges are yours to map by the steps below.

### When you map it yourself

1. Learn the code well enough to split the task: the modules, the files each part of the task will touch, and the files that several parts will touch. In a large codebase, invoke one `brigade-worker` for each area, at the same time, to explore it. They change nothing, so they need no tree. Give each one the area, the questions to answer, and a report file of its own as the only file it writes: `_swe/brigade/<name>/reports/explore-<area>.md`. Each replies with one line that names its file. Read the file when it is done.
2. Find the foundation first. List everything the later parts build on, and that would come out differently if two agents each did it their own way: scaffolding the project, the directory layout, the package manifest and its lock file, the build, lint and test setup, the application's skeleton, the base of a database schema, shared types and interfaces, conventions. Put it in orders with `"foundation": true`: one where that is enough, several where it is large. They run one at a time, in the order you list them, and every other order waits for the last one. An existing project that has all of this in place needs none. Then write the patterns its code already follows in the plan's `conventions`.
3. Split the rest into orders. A good order can be finished by one subagent in one go, owns paths that no order running beside it owns, can be checked on its own, and serves at least one criterion. Split along who owns which files (a module, a package, a screen, a service), not along kinds of work.
4. Draw the edges. Put order B `after` order A only when B needs A's code to exist (it calls, imports, extends or tests it), or when both must change the same file. A missing edge costs a conflict or a guess. An edge that is not needed costs time.
5. Where two parts must fit together and neither needs the other's code, such as the two sides of an interface, fix the interface and leave them independent. Fix it as code in a foundation order where you can, and otherwise as the same text in the `notes` of both orders.
6. Give every shared file one owner: a registry, a route table, a translation file, a lock file. Let a foundation order prepare it, or give it to one order that comes `after` the parts it joins.
7. A criterion about the whole, such as a flow from end to end, gets an order of its own that comes `after` the parts it needs.
8. Decide for each order, now, how you will check it when it comes back, and write that in its `checks`.

### In both cases

1. Run `brigade check <plan>` until it reports no problem. It refuses a criterion that no order covers, an order that serves no criterion, a circle, and two independent orders that own the same path.
2. Read its note on the order of work. The run takes as long as the longest chain. Where the chain is long because of an edge that is not needed, remove the edge; where it is long because an order is too large, split the order. In a graph the user gave, propose this to the user instead of doing it.
3. Tell the user the graph in a few lines: the foundation, what runs at the same time, the longest chain, and every edge you added to a document of theirs. Go on without waiting, unless something needs their answer.

## Phase 2: Lay the foundation

Skip this phase when the plan has no foundation order.

1. Start the first foundation order by Phase 3, alone. Start nothing else.
2. When it returns, check it by Phase 4 and merge it by Phase 5. Then start the next foundation order, if there is one.
3. When the last one is merged, and before any other order starts:
   - Read what the foundation set up, in the integration tree, and write it in the plan's `conventions`: the layout, where each kind of file goes, the naming, how a part is added (a route, a component, a test), and the commands. Every later work order carries them. Where the subagent's report and the code disagree, the code counts.
   - Bring `setup` and `gates` in the plan up to date, and run them in the integration tree.
   - Compare the `owns` of the remaining orders with the layout that now exists, correct them, and run `brigade check` again.

## Phase 3: Hand out orders

1. Run `brigade status <plan>`. It names the orders that are ready to start: those whose dependencies are all merged.
2. Create their trees: `brigade start <plan> <order> <order> ...`. It refuses an order that is not ready, and starts nothing while the plan has a problem.
3. Write each order's work order: `brigade brief <plan> <order>`. It writes the file `orders/<order>.md` in the run directory and prints the prompt for the subagent, which only points to that file. The work order holds the tree, the task, the criteria word for word, the paths, the conventions, the gates, the rules, and the file the subagent must write its report to: `reports/<order>.md` in the run directory. Use the printed prompt as it is. Do not retell the order or add to it in the prompt. If something is missing from it, add it to the plan and run `brigade brief` again, so that the plan stays the record of what was asked.
4. Invoke one `brigade-worker` for each ready order, with the printed prompt as its whole input. Launch them all in one message, in the background, so that they run at the same time. Each one writes its report to the file its work order names, and replies with one line: its result and the path of that file. That reply reaches you as a notification when the worker finishes. Do not also ask your harness to isolate them in worktrees of its own: the trees exist, and the brief names them.
5. Start every order that is ready. Hold one back only for a reason you can name: the machine cannot run that many builds at once, the disk cannot hold that many trees (Phase 0, step 10), or the user set a limit.
6. While subagents work, do not build, and do not wait. Never poll for a worker: no `sleep`, no loop that checks for its report file, no watcher on its tree, no scheduled wake-up. Go on with what does not depend on it: prepare the checks of the orders that are out, check orders that came back. When a worker's notification arrives, check its order by Phase 4, and after each merge start whatever became ready. The same holds for your own long commands, such as a gate run: start them in the background, and react when the harness reports that they ended. When nothing is left to do but wait, end your turn: the next notification starts your next one.
7. When a subagent asks a question, answer it from the request and the plan. What they do not answer is a question for the user.
8. Every command has a time limit, yours and the workers': plan it to end within the limit, and split a longer run into parts that each do, without shortening what it measures. When the user sets a limit on how long a run may take, write it in the plan's `conventions`, so that every work order carries it.

### Runs that stop or hang

Look at a run only when you have the turn anyway: a notification arrived, your harness asks about the work still running, or the user asks. Never schedule a check, and never poll. The time limits of step 8 are what end a run that hangs.

1. **Read the notification for what it is.**
   - A worker that is waiting on its own background work has sent an interim note, not a report. Do not check its order: it continues by itself and notifies again.
   - A worker that finished with no report file for its round, or whose last words say its run is still going, has stopped early. Look at its tree, then send it a message to continue.
   - Workers or commands that did not finish before the session ended (the app was quit, the machine restarted) are stopped, and their processes are gone.
2. **Judge progress by what is written, not by what was last said.** A run is making progress when its output or its work folder was written recently. A run that is far past the time it should take, with nothing written for a long time, is hung, whatever stage its last line names. A hung process at full CPU is looping; at no CPU, it waits on something that will not come. A process whose parent is gone, or that follows the files of an order already merged, is a leftover. Gates that fail on timing while the machine is heavily loaded are rerun alone before they count as a defect, and the load itself may come from a hung run.
3. **Recover.**
   - Find out whose a process is from its command line, its working directory and its parent. Stop only what this run started. Name anything else to the user and leave it alone.
   - Read its partial output and find the cause before you start it again.
   - Stop it by its task id or by its exact process ids, never by a name pattern, and stop the processes it started with it: helpers, load generators, watchers.
   - Stop a run whose tree or inputs changed under it: its result would not count.
   - After stopping a run, put back any evidence it had begun to overwrite, and delete its half-finished work folder.
   - Continue an interrupted worker with a message to the same worker. Tell it what its tree holds (its commits, and whether anything is uncommitted), that the processes it started are gone and must not be started twice, and what its order still asks. Invoke a new worker only when the old one cannot be continued, and stop the old one first: two workers in one tree undo each other's work.
   - A hang caused by a worker's own script is a finding for its order.
4. When the other workers of a batch are long done and one of the same size is still out, with no notification from it, look at its tree once (`git -C <tree> status` and `git -C <tree> log`), then send it a message or stop it. Do not turn this into a watch.

## Phase 4: Check a returned order

1. Read the report file, `reports/<order>.md`, in full, as a list of claims. The reply of the `brigade-worker` only names it. If the file is not there, have the subagent write it; if it cannot, save its reply there yourself, word for word, and say in the first line that you did. Read "Not done", "Deviations" and "For the lead" first. An assumption there that another order has to share, such as how an error is reported, is a gap in the conventions. Settle it, from the request or with the user, write it in the plan's `conventions`, and hold the other orders to it when they come back.
2. Run `brigade inspect <plan> <order>`. A problem blocks the merge: no report on file, no commit, uncommitted work, a change outside the paths the order owns, a conflict with the integration branch. A note is something to read: a line that may hide a skipped test or a stub, a deleted file, a change in the checkout you started in.
3. Read the whole diff: `git -C <tree> diff brigade/<run>/integration...HEAD`. For each change, ask which sentence of the order asked for it. Look for:
   - work that was not asked for: an extra feature, a refactoring, a new dependency, a second way of doing something the foundation already does;
   - work that was asked for and is missing;
   - a placeholder, a stub, a value written to match a test;
   - a test that asserts nothing, that fakes the very thing it should test, or that was skipped, weakened or deleted.
4. Run the setup and every gate in the tree yourself. Compare the result with the report. Your checks run in the tree, and write only into it, as its ignored build output, or into `checks/<order>/` in the run directory. Only the `.txt` and `.md` files of `checks/<order>/` outlive the merge, so write what you saw as text there. Do not make a copy of the repository to check an order: the tree is the copy. A difference is a finding. So is a file your run leaves behind that `git status` shows: build output that nothing ignores.
5. Run the order's `checks`. For each criterion the order covers, see the behavior yourself in that tree: run the program, call the endpoint, open the page.
6. Decide.
   - **Accept.** Go to Phase 5.
   - **Rework.** Write your findings to a file. A finding says what you ran, what you saw, and which words of the order or of a criterion it fails. Then run `brigade rework <plan> <order> --findings <file>`. It opens the next round: it writes the rework order to `orders/<order>.round-<n>.md`, with a report file of its own, `reports/<order>.round-<n>.md`, and prints two prompts. Use the first to continue the same `brigade-worker` where your harness allows, so that it keeps what it knows, and the second to invoke a new `brigade-worker` otherwise. The subagent commits on the same branch. Then check again from step 1, in full, on the new report.
   - **Replace.** After two failed rounds the order is the problem: too large, unclear, or at odds with another. Write the reason in its `dropped`, add better orders to the plan, and run `brigade check`. Its tree and branch stay until the user agrees to discard them: `brigade clean` prints the commands. Ask once the replacement is merged.
   - **It needs a path it does not own.** Give the change to the order that owns the path, or widen `owns` and run `brigade check`. If the path is now shared with an order that is out, one of them waits.
   - **It rests on a question about the request.** Ask the user.

For a diff too large to read with care, a `brigade-worker` may review it for you. Give it the work order's file and the diff, and not the builder's report, and `reports/review-<order>.md` in the run directory as its report file. It replies with one line that names the file. Read its findings there. Confirm each of its findings yourself. The gates and the criteria remain yours to run.

## Phase 5: Merge

1. Merge the accepted order: `brigade merge <plan> <order> --checked "<what you ran and read yourself>"`. It inspects the order once more, merges its branch into the integration branch, removes the order's tree and branch, deletes from `checks/<order>/` every file that is not a `.txt` or `.md` record, and names the orders that are now ready. When it says the tree was not removed, find out what holds it (a process still running in it, a file left in it), free it, and run `brigade clean <plan>`. Stop every process you started for the check.
2. A conflict is resolved in the order's tree, never in the integration tree. Send the order back with `brigade rework`, and in the findings ask its subagent to merge the integration branch into its tree, resolve the conflict, run the gates and commit. Then check the order again by Phase 4. A conflict between orders that the graph called independent means an edge or an owner was missing: correct the plan as well.
3. Run every gate in the integration tree. Parts that pass alone can fail together. When several orders came back together, merge them one after the other and run the gates after the last; if they fail, run them at each merge commit to find the one. A failure is fixed by a new order that comes `after` the orders involved, not by your own patch, and nothing is delivered until it is merged.
4. When every gate passes, deliver at once: `brigade deliver <plan> --gates "<each gate and its result>"`. It fast-forwards the branch the run started from to the integration branch, in the checkout where that branch is checked out, and pushes nothing. It refuses when the checkout has uncommitted changes to tracked files, or when the branch holds commits the integration branch does not: someone committed to it during the run. Either is the user's decision. Give them what `deliver` said, and the choices: merge their branch into the integration branch in the integration tree, run the gates and deliver again, or stop delivering for this run.
5. Prune the evidence of the order once it is delivered, or once the user has stopped delivering for this run. This is the evidence its criteria are proven by, wherever the project keeps it; `brigade merge` has already pruned your own `checks/<order>/`. Keep the transcripts (`.txt`), the pictures a criterion is proven by, the scripts that made them, and the records that name them. Delete everything else: work folders, copies of the repository, build output, recordings and pictures that no record names, by their exact paths. When an order's evidence is kept in an EDD ledger, the ledger names what is kept: delete what `ledger check` reports that no row names, then run that skill's `ledger prune`, which deletes the work folders and confirms that the ledger still holds.
6. Run `brigade status` and hand out what became ready, by Phase 3. Trees that are out do not receive the merge and do not need it: they share no path with it.

## Phase 6: Validate the whole

Start this phase when `brigade status` exits 0: every order is merged.

1. Read `request.md` again, and every criterion at its source, word for word.
2. In the integration tree, run the setup and every gate.
3. Check each criterion yourself on the merged result, as it is written, on the running product. Write down what you ran and what you saw. A criterion you cannot check here is reported as not checked. It is not counted as met.
4. Look for drift in both directions.
   - From the result to the request: read `git diff --stat <start>...brigade/<run>/integration`, where `<start>` is the commit `brigade status` names after "Started from". The plan's `base` is a branch that the deliveries have moved, so it no longer marks where the run began. Every changed file belongs to an order and, through it, to a criterion. What does not is removed by an order, or named in the report.
   - From the request to the result: read the request for anything it asks that no criterion captured.
5. Whatever is missing or wrong becomes new orders in the plan. Run `brigade check` and go back to Phase 3.

## Phase 7: Hand over

1. Run `brigade clean <plan>`. It removes the trees and branches of merged orders that are still there, and leaves in place everything that holds unmerged work. The orders and the reports stay in the run directory.
2. Check that the run left nothing behind:
   - `git worktree list` names no tree of this run but the integration tree and the trees `clean` left in place;
   - `git status` of the checkout you started in shows nothing that was not there at Phase 0;
   - nothing of the run is outside the run directory: no copy of the repository, no build output, no file in the system's temporary folder or in the project's scratch folders;
   - no process you or a subagent started is still running.
   Remove what is left by its exact path, and name in the report what you could not remove.
3. Write `report.md` in the run directory, following `references/report-format.md`, and give the user its content.
4. Every accepted order is in the branch the run started from already, by Phase 5. If the last merge is not delivered yet, deliver it now. Ask the user whether to push the branch or open a pull request, and do it only after they answer, unless the request already said.
5. Run `brigade clean <plan> --integration` to remove the integration tree and branch. It refuses while the branch the run started from does not hold every commit of the integration branch.
