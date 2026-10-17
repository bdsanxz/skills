# Tips from earlier runs

Every tip here comes from a real run: a mistake the lead or a worker made, with what it cost and what to do instead. Read the part for a phase before starting that phase. When you make a new mistake, or catch one, tell the user so it can be added here.

## Phase 0: set up

- **No idea what a tree costs.** A run over two Rust repositories kept 47 trees on disk at once. Each built its own output, 0.1 to 4.7 GB, and the trees alone reached 60 GB before anyone looked. Measure one tree after its setup and gates, compare it with the free space, and keep only as many orders out as the disk holds with room to spare.

## Phase 3: hand out orders

- **Lead scripts in the project's scratch folder.** The lead wrote its helper scripts and the outputs of its reruns (`lead-*.sh`, `rerun-T0xx-*.txt`, dozens of files) into the project's own `scratch/` folder, among the user's files, where nothing tied them to the run or removed them. Your checks go in the order's tree or in `checks/<order>/` of the run directory.

- **Waiting by polling.** The lead ran 91 shell loops that slept and checked again (`for i in $(seq 1 28); do grep -q '^\[exit' "$F" && break; sleep 20; done`), and five watchers, to wait for its own gate and evidence runs. Each loop held the turn for up to nine minutes, during which nothing else moved. Workers and background commands notify you when they finish: go on with other work, or end the turn, and react to the notification.

- **A hung run reported as progressing.** A worker's stress script started eight busy loops to load the machine, then ran a bare `wait`, which waited for the loops too. Its counting ended at 06:49, and the script sat at full CPU for six more hours, slowing every other run (load average 30 to 38). The lead twice reported "nothing is stuck" from the stage names in the outputs. The user caught it. A run whose output has not been written for hours is hung, whatever its last line says: compare the newest write time with the time now.
- **Orphaned watchers.** Four `tail -f` processes left by a worker, their parent gone, followed the files of an order merged four hours before. Stop such processes by their exact ids once you know whose they are, and leave alone what another project started.
- **Two workers in one tree.** A new worker was sent to an order while the old one was still running in the same tree. The old one took the new one's runs for its own, and the user had to stop it. Stop the old worker before you invoke a new one.
- **Resumed after the app quit.** When the app was quit with six workers out, the lead read each tree (commits on the branch, uncommitted changes, the ledger and evidence) and sent each worker a message: where it stood, that its processes were gone and must not be started twice, and what was left. Do the same: continue the worker that knows the order, from what its tree shows.
- **A run longer than anyone would wait.** One evidence run took 78 minutes, and the user ended up stopping every background command that ran past an hour. The run was then split into parts that each ended within the hour, with nothing left out of what it measured.

## Phase 5: merge

- **Merged trees kept until the end.** The run merged 42 orders and removed none of their trees, because cleaning was left to the hand-over and the run was stopped before it. `brigade merge` now removes the tree and branch of the order it merges. When it reports that it could not, free the tree and run `brigade clean` right away.
- **Rework orders and replaced orders left behind.** Trees of orders that were replaced (`t010r`, `t016r`, `t025r` beside `t010`, `t016`, `t025`) stayed next to their replacements. Ask the user to discard a dropped order's tree as soon as its replacement is merged.

## Work done by others

- **Copies of a tree to check it.** Workers and the lead copied a tree they were checking (`rsync` of the whole tree, `cp -R` of a dependency's sources) into new folders, built each copy again, and left the copies. The tree is the copy: check there, and keep files that only a check needs inside it, removed before the last commit.
