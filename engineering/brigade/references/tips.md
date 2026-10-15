# Tips from earlier runs

Every tip here comes from a real run: a mistake the lead or a worker made, with what it cost and what to do instead. Read the part for a phase before starting that phase. When you make a new mistake, or catch one, tell the user so it can be added here.

## Phase 0: set up

- **No idea what a tree costs.** A run over two Rust repositories kept 47 trees on disk at once. Each built its own output, 0.1 to 4.7 GB, and the trees alone reached 60 GB before anyone looked. Measure one tree after its setup and gates, compare it with the free space, and keep only as many orders out as the disk holds with room to spare.

## Phase 3: hand out orders

- **Lead scripts in the project's scratch folder.** The lead wrote its helper scripts and the outputs of its reruns (`lead-*.sh`, `rerun-T0xx-*.txt`, dozens of files) into the project's own `scratch/` folder, among the user's files, where nothing tied them to the run or removed them. Your checks go in the order's tree or in `checks/<order>/` of the run directory.

## Phase 5: merge

- **Merged trees kept until the end.** The run merged 42 orders and removed none of their trees, because cleaning was left to the hand-over and the run was stopped before it. `brigade merge` now removes the tree and branch of the order it merges. When it reports that it could not, free the tree and run `brigade clean` right away.
- **Rework orders and replaced orders left behind.** Trees of orders that were replaced (`t010r`, `t016r`, `t025r` beside `t010`, `t016`, `t025`) stayed next to their replacements. Ask the user to discard a dropped order's tree as soon as its replacement is merged.

## Work done by others

- **Copies of a tree to check it.** Workers and the lead copied a tree they were checking (`rsync` of the whole tree, `cp -R` of a dependency's sources) into new folders, built each copy again, and left the copies. The tree is the copy: check there, and keep files that only a check needs inside it, removed before the last commit.
