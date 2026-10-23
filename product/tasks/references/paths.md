# Paths

A path is one way a single actor's attempt at one goal can go, seen from outside the system. Completeness means every path that belongs is covered. Restraint means no path that does not belong is added. This file defines both.

## The three kinds

- **Happy path**: the actor does what the sources describe and reaches the goal. Each goal has exactly one.
- **Alternative path**: the actor still reaches the goal, but by another route, with another choice, or from another starting state, and the sources say so. Examples: picking a tax year instead of typing two dates; signing in with a code instead of a password; exporting a range that contains no expenses and getting an empty file, when the sources say that is what happens.
- **Negative path**: the actor does not reach the goal. Examples: input the sources forbid is refused; an actor without the authority the sources require is turned away; a precondition the sources name is not met; an external system the sources name fails or does not answer; there is nothing to act on.

A negative path ends in something the actor observes and in a way forward: what the actor is told, what progress is kept, and how the actor retries, corrects or gives up. When part of an operation fails, it also says what happens to the parts that succeeded.

## What makes a path belong

A path belongs when at least one of these holds:

1. **Stated**: a source describes it, in a statement, a decision, an acceptance criterion or a specification's failure path.
2. **Forced**: a source states a rule that the happy path makes possible to break, and so the behavior is undefined without the path. The forced paths are these, and only these:
   - a **limit or format** the sources state (maximum size, length, range, accepted values, required fields) has a violating input: one path for the violation, and the boundary value just inside the limit belongs to the happy path's checks;
   - an **authority** the sources state (who may do this, who may only observe) has an actor without it;
   - a **precondition** the sources name (signed in, has a balance, item in stock) can be unmet;
   - an **external system** the sources name as part of the behavior can fail;
   - an **empty state**: the behavior acts on a collection or a result that can hold nothing.

If neither holds, the path does not belong, however plausible it is. A path that is only imaginable ("what if the network drops", "what if two people click at once") is not in the sources and does not become a task. When the sources are silent on a condition that the product plainly touches, raise one open question instead of a task; the user decides whether the path exists.

## The outcome of a forced path

A forced path needs an outcome, and the sources may not give one. Then:

- do not write a plausible default (a generic error, a retry count, a timeout);
- keep the path on the list, write its task with the missing part marked by the open question's ID, or leave the task out and let the open question stand in its place when nothing about the path is settled;
- reuse an existing behavior from the working directory (for example the message the app already shows for a rejected input) only as an option in the open question, never as the answer.

## The test

For each path, ask: **if this path were left out, would an actor who follows the sources meet behavior that nothing defines?** If yes, it belongs. If the answer is "no, but it would be nice", it does not belong.

For each task, ask the reverse: **which statement in the sources would be violated if this task were not done?** If none, remove it.

## Grouping paths into tasks

- Each happy and alternative path is its own task.
- Negative paths with the same trigger, the same actor and the same outcome share one task, with one check per case (for example, an end date before the start date, and a range over the limit, when both show the same message).
- Negative paths whose outcome differs, or which different actors observe, are separate tasks.
