---
name: tasks
description: |
  Turn a conversation or a specification into tasks grouped by feature, each one end-to-end path (happy, alternative or negative) of one actor's behavior, covering every path the sources state and adding nothing they do not ask for. A script validates the task dependencies and reports which tasks are ready, parallel or blocked. Use when the user asks to break a conversation, request or spec into tasks, tickets, a backlog or work items, or names this skill. Do not use to write specifications, design the implementation, write code, or estimate and schedule work.
---

# Tasks

Turn what the sources say into tasks. A task is one piece of behavior that an actor can see working: one actor, one goal, one path through it. A task never describes the layers that implement it (UI, API, service, database), because that breakdown goes stale as soon as the implementation changes. The implementer decides the layers; the task decides what must be true when the work is done.

Two rules bound the result:

- **Complete**: for each feature, the tasks together cover every path the sources state or force: the happy paths, the alternative paths and the negative paths. Nothing a source describes is left without a task.
- **Not over-engineered**: no task adds a requirement that no source asks for. A task that no source statement justifies is removed, however sensible it looks.

Where a source leaves a path's outcome unsettled, the gap becomes an open question. Never fill it with a guess, and never drop the path silently.

The result is one Markdown `.md` file, with the tasks grouped by feature. Do not build the system.

## Running the task graph script

`taskgraph` below stands for this shell function:

```
taskgraph() { bun "<this skill's directory>/scripts/taskgraph.js" "$@"; }
```

Define it at the start of every shell command that uses it, because shell state does not carry over between commands. It needs [Bun](https://bun.sh) and nothing else; when `bun` is not found, tell the user to install it and stop. It reads the tasks document itself: the graph comes from each task's `Needs` line, and a task counts as done when all its acceptance criteria are ticked. `taskgraph --help` lists its commands, and `taskgraph <command> --help` gives what a command checks and prints, with examples:

- `taskgraph check DOC` validates the document and prints every problem with its line number.
- `taskgraph status DOC` lists the tasks that are done, the tasks that are ready to start now (they do not need each other, so they can run in parallel) and the tasks that are blocked, each with what it waits for.
- `taskgraph waves DOC` groups all tasks into waves; the tasks of one wave can run in parallel.
- `taskgraph trace DOC T3` shows what one task needs, what waits for it, and which tasks it can run in parallel with.

Exit codes: 0 no problem; 1 problems found; 2 wrong usage; 3 (`status` only) no problem, but tasks remain and none is ready.

## Workflow

### 1. Collect the sources

1. Take the sources the user names: a specification document or any other document, notes, a ticket, or the conversation. If the user names none, use every message in this session, plus anything the user pastes or names as part of it.
2. If the user names a part of the sources or one feature, limit the scope to it.
3. When a source is a specification document, read it in full. Its requirements, specifications, acceptance criteria, decisions, non-goals, deferred items and open questions are the sources of the tasks; keep its IDs so that each task can cite them. Read it as written: do not repair it, and do not add behavior it lacks. A gap or an ambiguity in it becomes an open question in step 3.
4. If the user names an existing tasks document to update, read it in full. Step 6 explains how to update it.
5. Read the current working directory only for what a task needs to state its behavior exactly: for a change or a fix, the current behavior that is being changed and the behavior that must stay unchanged, each with the path it was read from. Do not survey the codebase, and do not let what the code looks like add or reshape tasks.
6. If the sources contain no behavior to build, say so and ask what the tasks should cover. Stop there.

### 2. List the features, the actors and the decisions

Read the sources and list:

1. **Features**: each capability the sources ask for, named by what it lets actors do, such as "Expense export". When the sources are a specification document, use its features.
2. **Actors**: everyone and everything that interacts with the system from outside, such as user roles, external systems, operators and time. A component of the system is not an actor.
3. **Statements**: each need, rule, limit or constraint the sources state, with where it was said and, for each, whether it is required or optional. Identify a statement by its ID where the source has one, otherwise by a short quote; these become the rows of the coverage table (step 4). The later statement replaces an earlier one that it contradicts, and a decision in the conversation that a specification lacks is a later statement too: do not ignore it. When two statements contradict each other and no later one replaces the earlier, record an open question.
4. **Non-goals and deferred items**: what the sources exclude or postpone. These never become tasks.

### 3. Enumerate the paths

For each feature, and for each actor whose experience the feature changes, write down the paths before writing any task. Follow `references/paths.md` for what counts as a happy, an alternative and a negative path, and for the test that decides whether a path belongs.

1. Start with the **happy path**: the actor reaches the goal the sources state.
2. Add each **alternative path** that the sources state: another route, choice or starting state through which the actor still reaches the goal.
3. Add each **negative path**: the actor does not reach the goal, because of something the sources state or something the stated behavior forces.
4. For each path, find its outcome in the sources: what the actor observes, and for a negative path, also how the actor recovers or gives up. If the sources do not settle it, the path stays on the list with an open question in place of its outcome.
5. Cut every path that fails the test in `references/paths.md`.

### 4. Write the tasks

Write the document in the format `references/task-format.md` defines. `examples/expense-reports.md` shows a finished document.

1. Give each feature its own section, in the order the sources introduce them. Write the document in the language of the sources, with their domain words unchanged.
2. Write one task per path, or one task for several negative paths of the same trigger whose outcome is identical. Name it by what the actor achieves or is told, never by a component. Number the tasks across the whole document (`T1`, `T2`, …). Run the granularity test of `references/task-format.md` on every task, and again on the parts of every task you split: split a task that holds a second outcome that can be checked on its own, and never split into layers or fragments. There is no limit on the number of tasks, and no merging to shorten the document.
3. Order the tasks inside a feature: the happy path first, then the alternative paths, then the negative paths. Mark each task `Required` or `Optional` as the sources settle it. Give every task a `Needs` line: the tasks whose behavior must exist before this task's behavior can be observed, or `none`, and under `Needs because` one product reason for each dependency. Declare a dependency only for that reason, because every needless dependency takes a task out of the work that can run in parallel. An optional task never appears under a required task's `Needs`.
4. State each task as a scenario in the actor's terms: the state it starts from, what the actor does or what happens, and what the actor then observes. Use the concrete values the sources give (limits, messages, formats). Add a value that the sources do not give only as an open question.
5. Write the task's acceptance criteria as a checklist (`- [ ]` items), each item one check that an observer with the running system and no access to its code can run, so that completion is verified item by item. The task is done when every item is checked. These items are the task's tests; do not create a separate task for writing tests.
6. Cite the source of each task: the specification or requirement ID, or who said it and in which message. A task with no source is removed.
7. For a feature that changes existing behavior, fixes a defect or ports a reference, put a criterion that checks the behavior that must stay unchanged into each task that touches it. When the sources ask for a change too wide to make as one working piece, write it as the short sequence that `references/task-format.md` describes.
8. Mark a gap inline with the open question's ID, such as `[Q2]`. Write the coverage table, then the open questions, after the features: one coverage row for each statement from step 2, naming the tasks or open questions that cover it.
9. Create no tasks for work that no actor can observe or that no source asks for: project setup, scaffolding, refactoring, documentation, logging, monitoring, analytics, performance, accessibility, security hardening, and migrations. The first task that needs a piece of groundwork includes it. If a source does ask for one of these, it is a task like any other, described by what an actor can observe.

### 5. Check the document

Go through the checklist at the end of `references/task-format.md`. In summary:

1. Every statement in the sources that describes behavior has a coverage row, and every row names a task or an open question.
2. Every task cites a source statement and appears in a coverage row. A task that does neither is removed.
3. Every feature has a happy path task, and every alternative and negative path in the sources has a task or an open question.
4. No task describes a layer, component, file, table, class, framework or internal step.
5. No task covers a non-goal or a deferred item.
6. Every acceptance criterion is a single checklist item, is observable and uses concrete values, with no word that needs judgment to check ("fast", "properly", "user-friendly", "etc.").
7. Every `[Q…]` marker points to an open question, and every open question names the tasks it blocks.
8. Every task passes the granularity test, declares `Needs` with a reason for each dependency, and every dependency is one that the task's behavior truly cannot do without.
9. Every feature that changes, fixes or ports existing behavior has its unchanged behavior checked by its tasks.

Then run `taskgraph check` on the document. It finds the problems a reader misses: a task ID used twice, a `Needs` entry that names no task or the task itself, a dependency cycle, a dependency without a reason or that another dependency already implies, a required task that needs an optional one, a task without actor, status, path kind, source or checklist of acceptance criteria, an open-question marker that disagrees with the question's `Blocks` line, a coverage row that names nothing, and a task that no coverage row names.

Fix whatever fails and check again, until `taskgraph check` exits 0.

### 6. Save the document

1. If the user named a path, write the document there. If that path does not end in `.md`, ask before writing anything else. If a file exists at the path and the user did not ask to update it, ask whether to update it in place, write elsewhere, or replace it. Never overwrite it silently.
2. If you are updating an existing tasks document, edit it in place. Keep the IDs of existing tasks and questions unchanged, give new ones the next free number, and never reuse a removed ID. Move each answered question to the resolved list with its answer and its source.
3. Otherwise, if the project already keeps tasks in a directory, write the document there, following that directory's file naming. If not, write it to `_swe/tasks/<slug>.md` in the current working directory, where `<slug>` names the feature, or the product area when there are several features, in kebab-case.

### 7. Report

Give the user:

1. The path of the `.md` file (mention that `_swe/` is not git-ignored when it is under `_swe/`), and for each feature the number of tasks by path kind (happy, alternative, negative). Take the counts from `taskgraph status`.
2. The tasks that are ready to start now, which of them can run in parallel, and the longest chain of tasks that must run one after the other (from `taskgraph status` and `taskgraph waves`).
3. The paths left without a task because the sources do not settle their outcome, each with its open question ID in one line, so the user can answer them without opening the file.
4. The tasks you removed or declined to add because no source asks for them, when a user could expect them (for example, "no task for audit logging; no source asks for it"). Leave this part out when there are none.
5. The technical details in the sources that were left out because they describe the implementation, not the behavior. Leave this part out when there are none.

Then offer to go through the open questions. If the user agrees, ask them one at a time, using the question tool when one is available. After each answer, update the affected tasks, move the question to the resolved list, and check the document again with step 5 before asking the next question.

### 8. Choose the next tasks

When the user asks what to do next, or which tasks can run in parallel, run `taskgraph status` on the document. The ready tasks do not depend on each other, so they can start together; the blocked tasks wait for the tasks or open questions the output names. Use `taskgraph trace` for one task to see what it waits for and what waits for it. When work on a task is verified against its acceptance criteria, tick its items (`- [x]`) in the document, so that the next `taskgraph status` shows what that task unblocked. Never tick an item that was not checked.
