# Tasks Format

This document defines the canonical local task set produced from one specification. It keeps each task independently actionable while preserving the specification's product behavior and dependency graph.

## Artifact set

For task set `<name>`, write:

```text
_swe/tasks/<name>/tasks.md
_swe/tasks/<name>/tasks/<TNNN>-<slug>.md
```

The index is the canonical entry point. Each task file is a durable implementation contract. Workflow `progress.md`, scout reports, and archived revisions are not tasks and must not appear in the current task list.

Do not write one giant task containing all work. Do not compress one feature or specification capability into one task when it contains several independently verifiable outcomes. Prefer many small complete tasks, even when the resulting task set and index are long. Do not write a technical checklist split by database, API, UI, infrastructure, or test layer.

## Reference-aware citations

Reference-aware mode is opt-in and is entered only when the user explicitly asks to use references as a source of truth. The specification remains the product contract; references provide evidence for task sequencing, dependencies, contracts, risks, verification seams, or implementation patterns and never silently change product behavior.

- Any existing regular file outside the workspace may be cited as read-only reference evidence.
- A citation is an absolute path that resolves outside the workspace. Symlinks are allowed only when they resolve to regular files outside it.
- Use path-only citations in final artifacts, without line ranges or symbols. Inline citations may be wrapped in backticks; the path itself must remain the only citation value.
- The source specification path in the index and task provenance is not a reference citation and is not repeated in `## References`.
- In reference-aware mode, cite substantive evidence-backed claims near the claim. Every inline citation in a task also appears in that task's `## References` section and in the index's deduplicated trailing `## References` section.
- When no references are used, each `## References` section contains exactly `None`, including specification-only mode and reference-aware runs that proceed without citable evidence after user confirmation.
- Cited files are read-only inputs. Do not modify, move, rename, or delete them.
- Preserve any additional user-supplied reference instructions or notes verbatim in the applicable task/reference section; do not silently drop or paraphrase their substance.

## Index format

Use this exact top-level structure:

```markdown
# Tasks — <Specification title>

> Source specification: <workspace-relative specification path>
> Name: <name>

## Source and scope

<The product outcome, primary actors, authority, in-scope boundary, out-of-scope boundary, and core success criterion.>

## Dependency order

| Order | Task | Title | Blocked by | Required or optional | Outcome |
|---|---|---|---|---|---|
| 1 | [T001](tasks/T001-<slug>.md) | <title> | None — can start immediately | Required | <outcome> |

## Tasks

- [T001 — <title>](tasks/T001-<slug>.md) — <one-line outcome>

## Traceability

| Specification identifier | Covered by | Coverage note |
|---|---|---|
| `CAP-001` | `T001` | <how the task covers it> |

## References

<Union of all inline citable paths in the current index and task files, deduplicated and sorted, or `None` when no references are used.>
```

Rules:

1. Start task numbering at `T001` and continue without gaps.
2. List tasks in topological dependency order: every blocker appears before every task it blocks.
3. Use the same title, identifier, and filename slug in the dependency table, task list, and task file.
4. List every current task exactly once; do not list archived tasks as current.
5. Include every required specification capability in traceability. Include optional capabilities only when they become explicit non-blocking tasks.
6. A specification identifier may map to many tasks; traceability is many-to-many where the behavior requires it, not one capability to one task.
7. Include journey, state, interaction, and recovery identifiers when they materially constrain a task; do not force irrelevant identifiers into the table.
8. Explain every non-empty blocking edge with a concise product or contract reason in the relevant task file.
9. The index must remain understandable without the original conversation. The source specification path is provenance, not a substitute for the copied outcome and scope.
10. Do not add implementation plans, technical file lists, function names, code snippets, or command transcripts. Qualifying external reference paths are allowed only under the citation rules above.

If the specification has no required work, do not create an empty task set. Stop and report that the specification has no outstanding implementation outcomes. The workflow may still retain its progress log, but no `tasks.md` with fabricated tasks is written.

## Per-task format

Every task file uses this structure:

```markdown
# T001 — <Task title>

> Source specification: <specification title>

**Required or optional:** Required

**Blocked by:** None — can start immediately

**Unblocks:** <task IDs or `None`>

## Specification traceability

- Capabilities: `CAP-001`
- Journey steps: `J-01`
- States: `STATE-01`, `STATE-02`
- Interactions: `INT-001` or `None`
- Recovery scenarios: `REC-001` or `None`

## What to build

<One end-to-end, user-observable outcome delivered by this task.>

## Why this slice exists

<Why the outcome matters and why it is a valid independent slice.>

## Scope boundary

<What this task includes and what it deliberately leaves to later tasks.>

## Acceptance criteria

- [ ] <Observable success criterion>
- [ ] <Observable validation, empty, permission, or boundary criterion when relevant>
- [ ] <Observable failure and recovery criterion when relevant>

## Verification notes

<How an implementer or reviewer can demonstrate the outcome without relying on a particular implementation file.>

## Out of scope

- <Behavior intentionally left to another task or excluded by the specification>

## References

<Relevant citable paths used by this task, one per line, or `None` when no reference is used.>
```

## Field rules

### Title

Use `# TNNN — <short outcome title>`. The title must name the actor-visible outcome, not a technical layer. Good titles describe a user result such as `Review an incomplete submission`; poor titles describe `Create database table` or `Build API endpoint`.

### Source specification

Use the specification title in each task. The index carries the verified workspace-relative source path. Do not make the task depend on reopening the specification to understand its behavior.

### References

In reference-aware mode, cite relevant external reference paths in the task's substantive sections and repeat exactly those paths in the task's trailing `## References` section. The index's trailing `## References` section is the deduplicated, lexicographically sorted union of every inline citation in the index and all current task files. When no reference-aware evidence is used, each references section contains exactly `None`.

### Required or optional

Use `Required` for an outcome needed by the specification's core success criterion. Use `Optional` only for behavior explicitly listed as optional in the specification. Optional tasks must not block required tasks.

### Blocked by

Use one of:

- `None — can start immediately`;
- a comma-separated list of existing task IDs and titles;
- `External prerequisite — <observable prerequisite>` when the specification names a prerequisite outside this task set.

Every listed blocker must be a genuine prerequisite for starting this task, not merely a related task or a preferred sequence. A task must not depend on an optional task unless the specification explicitly makes that optional outcome a prerequisite.

### Unblocks

List the current task IDs that directly depend on this task, or `None`. This is a convenience check, not a second source of truth; it must agree with every dependent task's `Blocked by` field.

### Specification traceability

Use only identifiers present in the source specification. At least one `CAP-*` or another direct behavior identifier is required. Traceability explains why the task exists; it does not license adding behavior absent from the specification.

### What to build

Describe one complete path through the product needed for the task's outcome. Include the actor, trigger, visible result, system response, state change, and final outcome. Include relevant uncertainty, authority, review, or correction behavior. Do not list implementation layers or files.

### Why this slice exists

Explain the independent value or prerequisite boundary in product terms. If the task is a prerequisite, state the observable capability it unlocks. Do not justify a task only by saying that a developer needs setup.

### Scope boundary

State the behavior included in this slice and the neighboring specification behavior intentionally left for later tasks. Prevent overlap and hidden work. Do not turn the boundary into a task list.

### Acceptance criteria

Use unchecked Markdown checklist items. Criteria must be observable, testable, falsifiable, and scoped to this task. Name the trigger and the actor-visible result in each criterion so pass or fail can be decided without implementation knowledge. Use untestable adjectives such as fast, seamless, robust, full, efficient, or gracefully only alongside such an observable test. Include:

- the normal success path;
- invalid or incomplete input when relevant;
- empty, permission, authority, or boundary behavior when relevant;
- partial failure, preserved progress, retry, correction, cancellation, or fallback when relevant;
- preserved existing behavior or compatibility behavior when the task changes prior behavior, fixes a defect, or targets porting or parity;
- accessibility, privacy, security, reliability, or audit behavior when it materially affects the promised outcome.

Do not assert that a particular file, function, framework, endpoint, database, library, command, or test file exists. Do not copy every specification sentence mechanically; slice the criteria to this task's outcome. Do not write umbrella criteria that hide several independently verifiable outcomes behind one checklist item.

### Verification notes

Describe a concise demonstration or behavioral verification path. It may mention a user flow, test seam, review observation, or acceptance session, but it must not prescribe a command transcript or implementation structure.

### Out of scope

List only neighboring behavior explicitly deferred or excluded. Every deferred behavior should be covered by another task or by the specification's out-of-scope boundary. Do not use out-of-scope text to hide unresolved ambiguity.

## Granularity and expected-outcome test

Run this test for every specification capability and every resulting task:

1. Can an actor name the task's outcome without technical vocabulary?
2. Does the task have a distinct trigger, visible result, and completion condition?
3. Does the slice cross every necessary implementation concern without describing those concerns as separate tasks?
4. Can it be demonstrated or verified once its listed blockers are complete?
5. Does it have its own meaningful acceptance criteria and recovery boundary?
6. Does the capability contain another independently verifiable outcome that should become a separate task?
7. Would combining this task with a neighbor hide a meaningful user decision, state, validation, or failure path?
8. Would splitting it create a fragment with no independent product value?
9. Does the union of the resulting tasks still cover the complete expected outcome and core success criterion?

If a capability still contains multiple independently verifiable outcomes, split it again. Do not stop at one task per capability, and do not merge valid slices merely to reduce the count or shorten the artifact. There is no artificial maximum task count, phase count, or document length; behavioral completeness and small scope are the constraints.

## Dependency-graph test

Before finalization:

- all task IDs are unique and continuous;
- every `Blocked by` reference resolves to a current task or an explicitly named external prerequisite;
- every `Unblocks` reference resolves to a current task;
- no task blocks itself;
- no cycle exists;
- blockers precede dependents in the index;
- independent frontier tasks remain parallel;
- optional tasks do not block required tasks;
- the index and per-task edges agree exactly;
- reference-aware citations use only qualifying external regular-file paths, every inline citation is listed in the appropriate references section, and the index union is deduplicated and sorted.

## Language and durability

Use the specification's language and preserve its product vocabulary. Keep the current task files self-contained and implementation-agnostic. The task set may mention stable product contracts, permissions, state names, and domain terms from the specification, but must not prescribe concrete source files, functions, signatures, code, or infrastructure. Reference-aware citations are the only allowed exception for qualifying external file paths, and they must remain read-only evidence rather than implementation instructions.
