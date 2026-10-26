# Task format

A tasks document is one Markdown `.md` file with the sections below, in this order. The tasks are grouped by feature: one `## Feature:` section per feature, even when there is only one. Leave out a section only where this file says it is optional.

## Document structure

```markdown
# <Feature, or product area when there are several features>: Tasks

## Scope

- Sources: <the documents, messages or notes the tasks were extracted from>
- Outcome: <the product outcome in one or two sentences, in the sources' words>
- Actors: <each actor the tasks involve, with its authority where the sources state it>
- In scope: <each feature the document covers, by the name of its section>
- Not covered: <each non-goal and deferred item the sources name, with its source>

## Feature: <Feature name, by what it lets actors do>

One sentence: what the feature lets which actors do.

- **Work type**: <new behavior / change to existing behavior / defect fix / port, parity or migration>
- **Must stay unchanged**: <for a change, fix or port: the behavior to preserve, with its path in the working directory; leave out for new behavior>

### T1. <What the actor achieves>

- **Actor**: <actor>
- **Path**: <Happy / Alternative / Negative>
- **Status**: <Required / Optional>
- **Source**: <specification or requirement IDs, or who said it and in which message>
- **Needs**: <task IDs separated by commas, or `none`>
- **Needs because**: <for each task under Needs, why this task's behavior cannot be observed without it; leave out when Needs is `none`>

**Scenario**: Given <the state the actor starts from>, when <what the actor does or what happens>, then <what the actor observes>. For a negative path, add how the actor recovers or gives up.

**Acceptance criteria**

- [ ] <one check an observer can run on the running system, with concrete values>
- [ ] …

### T2. <…>

…

## Feature: <Next feature name>

…

## Coverage

| Source statement | Covered by |
| --- | --- |
| <ID and words of one statement in the sources that describes behavior> | T1, T3 |
| <a statement whose outcome the sources leave open> | Q1 |

## Open questions

### Q1. <The question, in one sentence>

- **Unclear**: <what the sources say, or fail to say, and where they disagree>
- **Why it matters**: <what changes in the behavior or its checks depending on the answer>
- **Options raised**: <options the sources themselves mention, or "none raised">
- **Blocks**: T3, T5

## Resolved questions

Optional; present once a question has been answered. One line per question: `- Q1: <question> → <answer> (<source>)`.
```

## Writing rules

### One path, one actor, end to end

- A task covers one actor's one path to a result, from the first thing that actor does to the last thing that actor (or another actor) observes. It is a slice through the whole system, not a piece of one layer.
- Name the task by what the actor achieves or is told: "Member exports their expenses for a date range", "Member is told the range is too long". Never name a component: "Export service", "Date validation".
- Write the scenario with what crosses the system boundary: what the actor does, sees, receives or can do next. Leave out components, layers, files, tables, classes, frameworks, endpoints (unless an external actor calls the endpoint directly and a source specifies it), and steps of the implementation.
- Do not write a list of implementation steps, a technical approach or a "how". If the sources mention one, it is not part of the task; report it as a detail left out.

### Granularity

A task is the smallest piece of behavior that an actor can see work and that an observer can check on its own. Apply this test to every task, and again to each part after a split:

1. Can the actor's outcome be named without technical words?
2. Does it have its own trigger, its own visible result and its own completion condition?
3. Can it be done and checked once the tasks under its `Needs` are done?
4. Does it hold a second outcome that can be checked on its own, such as another actor's decision, another visible state, another validation limit or another way to recover? Then split it, and test the parts again. A scenario that needs "and" to join two outcomes, two actors or two goals is such a task.
5. Would a split leave a part that no actor can see or check alone (a layer, a setup step, a half of one outcome)? Then do not split.
6. When both ways to cut leave every part complete, take the smaller parts.

There is no maximum or minimum number of tasks. Never merge tasks to shorten the document, and never split one into layers to make it look smaller.

### Required and optional

- Status is `Required` for behavior the sources need for their core outcome, and `Optional` for behavior the sources call optional.
- An optional task never appears under the `Needs` of a required task. `taskgraph check` rejects it.

### Change, fix and port work

- In a feature with a work type other than new behavior, the tasks that touch existing behavior include a criterion that checks the behavior listed under `Must stay unchanged`, with concrete values from the sources. For a defect fix, one criterion fails before the fix and passes after it. For a port or parity feature, the criteria compare with the reference named in the sources.
- When the sources ask for a change so wide that it cannot be made as one working piece (many places move to a new behavior), write it as a short sequence of tasks: the new behavior works beside the old, then actors move to the new behavior, then the old behavior is removed. Each task states which behavior stays available to actors at that point. Do this only when the sources ask for the wide change, never to split a change that fits one task.

### Only what the sources ask for

- Every task cites a source statement. A task whose citation does not actually say the behavior is removed.
- Every value in a scenario or a check (limit, message, format, time) comes from the sources, or from a fact read in the working directory and cited by path. A value the sources do not give is an open question, not a default.
- Do not add error messages, retries, timeouts, confirmations, logging, analytics, accessibility work, performance targets, permissions or settings that no source asks for.
- Do not add tasks for tests, setup, scaffolding, refactoring, documentation or deployment. The acceptance criteria are the tests; groundwork belongs in the first task that needs it.
- Non-goals and deferred items from the sources never become tasks.

### Complete across the paths

- Each feature has a happy path task for each actor goal.
- Each alternative path and negative path that `paths.md` says belongs has a task, or an open question that stands in its place.
- A limit that the sources give has a check just inside it (in the happy path task) and a check just outside it (in the negative path task).
- A negative path task says what the actor is told, what progress is kept, and how the actor retries, corrects or gives up. If the sources do not say, mark the missing part with `[Qn]`.

### Verifiable

- Write the acceptance criteria as a checklist: one `- [ ]` item per check, so that completion is verified item by item and the task is done when every item is checked. Never join two checks in one item, and never write them as prose.
- Every item is something an observer can run against the running system without reading its code, and it passes or fails with no judgment call.
- Use concrete values: real-looking inputs, exact messages, exact limits with units.
- Each item names its trigger and the result the actor sees, so that pass or fail is decided without knowing the implementation: "Given a range of 367 days, when the member exports, then no file downloads and the limit message shows."
- Do not use words that need judgment to check: fast, slow, quickly, easily, user-friendly, intuitive, appropriate, reasonable, properly, correctly, secure, robust, scalable, flexible, as needed, if possible, etc., and so on. Replace each with the value the sources give, or with an open question.
- Use "must" for required behavior. Do not use "should" or "may".

### Order and dependencies

- Inside a feature, order the tasks: happy path, then alternative paths, then negative paths.
- Every task has a `Needs` line: the IDs of the tasks whose behavior must exist before this task's behavior can be observed, or `none`. The dependency graph that these lines form is how an agent finds the tasks that can run in parallel, so each line must be exact.
- Under `Needs because`, give one reason for each dependency, in product terms (what the other task delivers that this one's behavior cannot be seen without). If the reason is only a preferred order, delete the dependency.
- List a task under `Needs` only when this task's behavior cannot be observed without the other's. A negative path usually needs the happy path of the same goal. Do not list a dependency for any other reason, such as a preferred sequence of work, a shared file or a wish to review one task first: a needless dependency removes a task from the work that can run in parallel.
- Leave out a dependency that another dependency already implies (if T4 needs T3 and T3 needs T1, T4 does not list T1). `taskgraph check` rejects it.
- A task that no other task needs, and that needs nothing, is fine: it can start at once and run in parallel with everything.
- A `Needs` entry may point to a task above or below. The graph must have no cycle and no ID that does not exist; `taskgraph check` finds both.
- A task is done when every item of its acceptance criteria is ticked (`- [x]`). Tick the items when the checks pass; `taskgraph status` reads the ticks to tell which tasks are ready and which are blocked.
- A task that carries `[Qn]` is blocked until the question is answered. The question's `Blocks` line lists exactly the tasks that carry its marker.

### Coverage table

- The `## Coverage` table lists every statement in the sources that describes behavior (by its ID where the sources have one, with its words), and the tasks or open questions that cover it. A row with no task and no question is a missing task. A task that appears in no row has no source and is removed. `taskgraph check` finds both.
- A non-goal or a deferred item is not a row; it is listed under `Not covered` in the scope.

### Language

Write the document in the language of the sources, and keep their domain words, actor names and state names unchanged.

### IDs

- Task IDs run across the whole document (`T1`, `T2`, …), so an ID stays unique when a task moves to another feature.
- When the document is updated, existing IDs keep their meaning, new items take the next free number, and removed IDs are never reused.

## Checklist

Check the document against each item before saving it.

1. Every statement in the sources that describes behavior has a row in the `## Coverage` table, and every row names a task or an open question.
2. Every task has an actor, a path kind, a status, a source, a scenario and at least one acceptance criteria checklist item, and appears in at least one coverage row.
3. Every task's source actually states the behavior the task describes.
4. Every feature has a happy path task for each actor goal, and every alternative and negative path in the sources has a task or an open question.
5. Every forced path (see `paths.md`) has a task or an open question, and no path that fails the test in `paths.md` has a task.
6. No task describes a layer, component, file, table, class, framework or internal step, and none contains a list of implementation steps.
7. No task adds an error message, limit, retry, timeout or other value that no source gives, except as an open question.
8. No task covers a non-goal or a deferred item, and none exists only for tests, setup, scaffolding, refactoring, documentation or deployment.
9. Every limit the sources give has a check just inside it and a check just outside it.
10. Every acceptance criteria item is a single `- [ ]` check, has concrete values and an outcome an observer can check on the running system, and no banned vague word appears.
11. Every negative path task says what the actor is told, what progress is kept and how the actor recovers, or marks the missing part with `[Qn]`.
12. Every `[Qn]` marker refers to an existing open question, and every open question lists the tasks it blocks.
13. Every task passes the granularity test: one actor, one goal, one outcome that can be checked on its own; none is a layer or a fragment.
14. Every task has a `Needs` line; its entries are listed only where one task's behavior cannot be observed without the other's, each has a reason under `Needs because`, none implies another, and no required task needs an optional one. `taskgraph check` reports no problem.
15. Every feature with a change, fix or port states what must stay unchanged, and its tasks check it.
16. The document is in the language of the sources.
17. A reader who never saw the conversation can tell from the document alone who does what, what they see, and when each task is done.
