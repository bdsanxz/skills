# Specification format

A specification document is one Markdown `.md` file with the sections below, in this order. The specifications are grouped by feature: one `## Feature:` section per feature, even when there is only one. Leave out a section only where this file says it is optional.

## Document structure

```markdown
# <Feature, or product area when there are several features>: Specification

## Purpose

One or two paragraphs: the problem this solves, for whom, and the outcome they get, in the conversation's words.

## Scope

- In scope: <each feature the document covers, by the name of its section>
- Non-goals: <each thing the conversation excluded, including rejected alternatives, with its source>

Deferred: optional; one line per postponed item: `- <what exactly waits>: <reason>; next: <what happens next, or [Qn]> (<source>)`.

## Actors

| Actor | Kind | Description | Authority |
| --- | --- | --- | --- |
| <name> | user / external system / operator / time | <who or what it is, and what it wants from the system> | <what it may provide, approve, change, publish or undo; what it may only observe> |

## Terms

Optional. One line per domain term the specifications rely on: `**Term**: meaning.`

## Requirements

| ID | Requirement | Feature | Source |
| --- | --- | --- | --- |
| R1 | <the need, in the conversation's words> | <feature name> | <who said it, which message> |

## Decisions

Optional. One line per choice the conversation settled, with its source: `- D1: <decision> (<source>)`.

## Facts

Optional; present when a specification relies on existing behavior. One line per fact read in the working directory, stated as an actor observes it, with its path: `- F1: <existing behavior> (<path>:<line>)`.

## Information and authority

Optional; present when the system shows information of different trust.

| Kind of information | How actors see it | Wins over |
| --- | --- | --- |
| <entered by an actor / verified / estimated / inferred / generated / unknown> | <the label or presentation> | <the kinds it overrides when they disagree> |

## Feature: <Feature name, by what it lets actors do>

One or two sentences: what the feature lets which actors do.

- **Work type**: <new behavior / change to existing behavior / defect fix / port, parity or migration>
- **Must stay unchanged**: <for a change, fix or port: the behavior that must be preserved, with facts; leave out for new behavior>
- **Actors**: <every actor whose experience this feature changes>
- **Requirements**: R1, R2

### Journey

Present when the feature has more than one specification.

| Step | Actor | Action or event | Visible result | Spec |
| --- | --- | --- | --- | --- |
| 1 | <actor> | <what the actor does> | <what that actor or another one sees> | S1 |

<Mermaid journey diagram, see `diagrams.md`>

### States

Optional; present when the feature has states that change what an actor can do.

| From | Trigger | To | Visible result | Spec |
| --- | --- | --- | --- | --- |
| <state> | <actor action or event> | <state> | <what the actor sees> | S1 |

<Mermaid state diagram, see `diagrams.md`>

### S1. <Behavior, named by what the actor achieves>

- **Actor**: <actor>
- **Status**: <Required / Optional; for optional, what the actor sees when it is unavailable>
- **Traces to**: R1, D1, F1
- **Preconditions**: <the state that must hold before the trigger, as an actor can observe it>
- **Trigger**: <what the actor does, or the event that happens>
- **Outcome**: <what the actor, and any other actor, observes in return>

**Alternative and failure paths**

- <condition>: <what the actor observes instead, what progress is kept, and how the actor recovers>

**Acceptance criteria**

1. Given <concrete state>, when <concrete action>, then <concrete, observable result>.
2. …

### S2. <The same feature, from another actor's point of view>

…

## Feature: <Next feature name>

…

### S3. <Behavior>

…

## Open questions

### Q1. <The question, in one sentence>

- **Unclear**: <what the sources say, or fail to say, and where they disagree>
- **Why it matters**: <what changes in the behavior or its verification depending on the answer>
- **Options raised**: <options the conversation itself mentioned, or "none raised">
- **Blocks**: S2, S4

## Resolved questions

Optional; present once a question has been answered. One line per question, with the answer and its source: `- Q1: <question> → <answer> (<source>)`.
```

## Writing rules

### Grouped by feature

- A feature is a capability the conversation asks for, named by what it lets actors do ("Expense export"), never by a component ("Export module").
- Every specification sits under exactly one feature. A behavior that several features share sits under the feature it serves first; the others refer to its ID instead of repeating it.
- A feature holds one specification per end-to-end behavior. When several actors experience the feature, each actor whose experience changes gets its own specification from their point of view: the user who starts the action, the operator who later reviews or undoes it, the external system that receives what it sends.
- Specification IDs run across the whole document (`S1`, `S2`, …), not per feature, so an ID stays unique when a feature gains a specification or a specification moves to another feature.
- Actors, terms, requirements, decisions, facts and open questions are listed once for the whole document; each feature section lists the actors and requirements it covers by name and ID.

### End to end, from the actor's side

- A feature's journey runs from the first actor's trigger to the last visible outcome, across every actor it hands off to. A hand-off is a step whose result another actor observes, such as a report a member files that a support operator then sees.
- A state is something an actor can observe or act within, such as `Draft` or `Published`, never an internal flag such as `JobRunning`. Add a state only when it changes what an actor can do or understand.
- Every failure path says what the actor is told, what progress is kept, and how the actor retries, corrects or gives up. When part of an operation fails, say what happens to the parts that succeeded.
- For automated or AI behavior, specify what it may do on its own and what it only suggests, how it shows uncertainty, how an actor corrects its output, and what it says instead of inventing an answer when information is missing.

- Name each specification by what the actor achieves ("Member exports their expenses"), never by a component ("Export service").
- Write the outcome as what the actor sees, receives or can do next. "The member receives an email with the subject `Your export is ready`" is a specification; "The worker publishes an `export.done` event" is implementation.
- An interface is part of a specification only when an external actor depends on it directly: a public API that an external system calls, a file an actor downloads, a message an actor receives. Then specify it as precisely as the actor needs: fields, formats, status codes, error messages.
- Data stored by the system is in scope only through what an actor can later observe: "the expense appears in the list after reload", not "a row is written to `expenses`".

### Concrete and verifiable

- Every acceptance criterion is a check an observer can run against the running system without reading its code, and that passes or fails with no judgment call.
- Use concrete values in acceptance criteria: real-looking inputs, exact messages, exact limits with units ("at most 10 MB", "within 5 seconds", "dates in `YYYY-MM-DD`, in the member's time zone").
- Test each limit at its boundary: one criterion just inside it and one just outside it, when the sources give the limit.
- Do not use words that need judgment to check: fast, slow, quickly, easily, user-friendly, intuitive, appropriate, reasonable, properly, correctly, secure, robust, scalable, flexible, as needed, if possible, etc., and so on. Replace each one with the value the sources give, or with an open question.
- Use "must" for required behavior. Do not use "should", "may" or "ideally" in a specification: the behavior is either required or it is an open question. An optional specification says so in its Status; its behavior, when present, is still stated with "must".

### No assumptions

- Every value, message, limit and rule comes from the sources: the conversation, a decision in it, a document the user supplied as part of it, or a fact read in the working directory and listed under Facts with its path.
- State a fact as the behavior an actor observes ("visitors who are not signed in are sent to the sign-in page"), not as the code that produces it. The path shows where it was read; it is not part of the behavior.
- A fact about a different feature does not settle a point by itself. Offer it as an option of the open question instead.
- When the conversation and a fact disagree and the conversation does not say it wants a change, the disagreement is an open question that cites both.
- Where the sources do not settle a point, write `[Qn]` in its place and add the open question. Do not write a plausible default, and do not soften a guess into "e.g." or "such as".
- A precondition or trigger that the sources do not state is a gap too.

### Traceability

- Every specification lists the requirements, decisions and facts it traces to.
- Every requirement is covered by at least one specification or at least one open question.
- Every decision appears in a specification, a non-goal, the deferred list or an open question. A later decision replaces an earlier statement; the document reflects only the latest.
- IDs are stable. When the document is updated, existing IDs keep their meaning, new items take the next free number, and removed IDs are never reused.

## Checklist

Check the document against each item before saving it.

1. Every actor in a specification is listed under Actors, and every listed actor appears in at least one specification.
2. Every requirement traces to at least one specification or open question.
3. Every specification traces to at least one requirement or decision.
4. Every specification has an actor, a trigger, an outcome and at least one acceptance criterion.
5. Every acceptance criterion has concrete values and an outcome an observer can check on the running system.
6. No banned vague word appears in a specification or acceptance criterion.
7. No specification names a layer, component, table, class, framework or internal step, except an interface an external actor depends on directly.
8. Every limit the sources give has a criterion just inside it and one just outside it.
9. Every `[Qn]` marker refers to an existing open question, and every open question lists the specifications it blocks.
10. Nothing is assumed: each value can be pointed to in the sources, or is marked as open.
11. Every specification sits under exactly one feature section, every requirement names a feature, and every actor a feature lists has at least one specification or open question in that feature.
12. Every fact has a path, still matches the working directory, and is used by at least one specification or open question.
13. Every decision appears in a specification, a non-goal, the deferred list or an open question, and no non-goal or deferred item appears as a specification.
14. Every specification states Required or Optional, and every optional one says what the actor sees when it is unavailable.
15. Every feature with a change, fix or port states what must stay unchanged.
16. Every failure path says what the actor is told, what progress is kept, and how the actor recovers, or marks the missing part with `[Qn]`.
17. Every feature with more than one specification has a journey; every journey step and state transition names a specification; every diagram passes the checklist in `diagrams.md`.
18. A reader who never saw the conversation can tell from the document alone who does what, what they see, and when each behavior is met.
