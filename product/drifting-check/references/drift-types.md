# Drift types

Drift is a gap between what the tasks would build and what the specs and the target outcome ask for. There are four kinds. Every finding has exactly one kind and one severity. The tests below decide the kind; apply them in the order given and stop at the first one that fails.

## Terms

- **Spec item**: one statement in the specs that the work must honor: a requirement, a specification, an acceptance criterion, a limit, a failure path and its recovery, a decision, or a "must stay unchanged" statement. When the specs have IDs, use them. When they have none, number the statements in reading order (`S1`, `S2`, …) and keep the numbering in the baseline.
- **Task**: one unit of work in the tasks. When the tasks have IDs, use them. When they have none, number them in reading order (`t1`, `t2`, …) and keep the numbering in the baseline.
- **Outcome statement**: one checkable sentence of the target outcome (`O1`, `O2`, …), such as "A member can export their expenses for a date range". The baseline lists them.
- **Non-goal** and **deferred item**: what the specs exclude or postpone. Neither is a spec item to cover.
- **Open question**: a point the specs leave unsettled and mark as such. A task that depends on one carries its marker (such as `[Q2]`) and leaves the value open; that is not drift. Once a question is recorded as resolved, with an answer and a source, the answer is a spec item.
- **Required** and **optional**: whether the specs call a spec item required or optional. A task document may carry its own status per task; it is checked against the spec item's status.
- **Coverage claim**: a task's `Source` line or a coverage table row that says which spec item a task covers. It is a claim to verify by reading the task, never evidence that the item is covered.

## 1. Beyond

A task, or a part of one, asks for something that no spec item asks for.

**Test**: name the spec item that would be unmet if this task, or this part of it, were not done. If none exists, it is **Beyond**.

Check at two levels: the whole task, and each scenario sentence and each acceptance criterion inside it. Beyond covers:

- a whole task with no spec item behind it;
- a value, limit, message, retry, timeout, format, option or setting in a task that the specs do not give;
- work on a non-goal or a deferred item;
- a task that settles a point the specs mark as an open question, by choosing an answer;
- a task that cites a spec item, where the spec item does not say what the task says.

**Over-engineering** is the commonest Beyond. Mark a Beyond finding `Over-engineering: yes` when the task or the part adds any of these and no spec item asks for it:
- configurability, options, settings, feature flags or extension points "for later";
- support for more actors, formats, platforms, scales or locales than the specs name;
- retries, timeouts, fallbacks, caching, queues, batching or rate limits;
- extra confirmations, error messages, states or screens;
- logging, monitoring, analytics, audit trails, accessibility work, security hardening or performance targets;
- tasks for setup, scaffolding, refactoring, documentation, tests or deployment that no required behavior needs;
- a new abstraction, shared component or migration for a need that one spec item has today.

If a spec item does ask for one of these, it is covered, not Beyond.

**Not Beyond**:
- groundwork that a required behavior cannot be built without, when the task names the behavior it enables or the dependency is plain from the tasks themselves. If the dependency cannot be shown, it is Beyond;
- a value that a resolved question gives, or a task marked with an open question's marker that leaves the value open;
- a step of a sequence that moves a wide change in stages (the new behavior beside the old, then actors move, then the old is removed), when the specs ask for the wide change.

## 2. Missing

A spec item, or part of one, is not covered by any task; or the target outcome cannot be reached by the tasks as written.

**Test**: for each spec item, find the tasks that cover it, by reading the tasks, not by trusting their `Source` lines. If a spec item is covered only in part, the finding names the part that is not.

Missing covers:

- a spec item with no task;
- a spec item with a task that covers only some of it: a limit checked inside but not outside, a failure path without its recovery, an actor left out, a "must stay unchanged" statement that no task protects with a check;
- a spec item that a coverage claim says is covered by a task that does not cover it;
- an **outcome statement** that the tasks cannot bring about even if every one is done. State which spec items or tasks the chain lacks.

**Not Missing**: a non-goal, a deferred item, an open question, and a spec item marked optional that no task claims. An optional item that a task claims only in part is Missing for the part left out.

## 3. Conflict

A task says something different from a spec item about the same point.

**Test**: find the spec item that addresses the same point as the task statement. If both exist and they cannot both hold, it is a **Conflict**.

Conflict covers a different value (limit, format, message, time), a different actor or authority, a different order of steps, a decision reversed, a task marked optional for a required spec item (or required for an optional one), and an acceptance criterion that checks the opposite of what the spec item requires. When the spec says nothing about the point, it is Beyond, not Conflict.

## 4. Off-target

A task is allowed by the specs, but doing it does not bring about the target outcome. This is the kind that appears when work follows the letter of the specs while the goal has moved or was never served.

**Test**: name the outcome statement this task helps bring about, and how. If none can be named, it is **Off-target**. A task that failed the Beyond or Conflict test is reported under that kind, not here.

Off-target covers:

- a task that serves an actor or goal other than the ones the outcome names;
- a task that traces to a spec item that itself serves no outcome statement. Mark such a finding `Cause: spec`, because the spec item has drifted from the outcome, and say so; it is then the spec item, not the task, that the user must look at;
- a task that builds something the outcome made obsolete: the outcome or a later decision replaced the need.

## Unclear

When the spec items can be read in two ways and the drift exists under one reading only, do not report a finding. Put it in the **Unclear** list with both readings, the spec text, the task text, and the question the user must answer. A guess recorded as a finding is itself a drift of the audit.

## Severity

- **High**: an outcome statement cannot be reached; a required spec item has no task; a task contradicts a spec item; a task builds a non-goal or a deferred item.
- **Medium**: a spec item is covered in part; a task adds behavior or a value that no spec item gives; a task is Off-target; a task settles an open question.
- **Low**: a missing boundary check, or an added detail in an acceptance criterion that does not change what an actor can observe.

## Evidence rules

1. Every finding cites both sides. Beyond, Conflict and Off-target quote the task text and the spec or outcome text it was judged against, each with its ID and location. Missing quotes the spec item and lists the tasks that were read and found not to cover it.
2. A quote is short and exact. Do not paraphrase a quote.
3. A finding with only one side cited is removed.
4. Judge the content, not the citation. A task whose `Source` line names a spec item that does not say what the task says is a finding, not a pass.
5. Leave style, wording, naming, ordering, task granularity, dependencies between tasks and estimates alone unless they change what an actor observes.
