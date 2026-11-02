---
name: tasks
description: |
  Turn one finalized specification output file into a dependency-ordered set of
  tracer-bullet implementation tasks with explicit blocking edges. Supports
  specification-only, greenfield, and explicit reference-aware evidence modes.
argument-hint: "Provide a specification path or ask to generate tasks from a specification; optionally request reference-aware evidence."
---

# Task

Generate one durable, dependency-ordered task set from exactly one finalized specification artifact. The specification is the product behavior baseline. This skill decomposes that behavior into independently valuable tracer-bullet implementation tasks without turning the specification into a technical task list or silently changing its scope. A specification capability is not automatically one task or one phase: when a downstream workflow treats tasks as phases, it must preserve the same small-slice decomposition.

The output is intended for developers, implementers, reviewers, and downstream orchestration skills. Each task must be understandable on its own, demoable or verifiable on its own, and explicit about the other tasks that genuinely block it.

## Interface

### Input

Accept:

- an explicit path to one finalized specification Markdown file;
- a specification slug when the matching file is at `_swe/specifications/<slug>/specification.md`;
- an explicit task set name, when the user wants one different from the specification slug;
- an optional request to use current codebase evidence for sequencing and testing seams;
- an explicit request to use reference material as a source of truth (reference-aware mode), optionally with reference paths or bounded questions to investigate.

The specification must be inside the active workspace and must be a regular file. Resolve it before reading any other product source. If no specification path or slug is supplied:

1. discover `_swe/specifications/*/specification.md`;
2. use the only candidate when exactly one exists;
3. ask the user to choose when multiple candidates exist;
4. stop when no candidate exists.

Do not choose a specification by modification time, filename similarity, or an unrelated conversation assumption.

The specification is the source of truth for product intent, actors, scope, capabilities, states, authority, failure behavior, and success. Current codebase evidence may refine task sequencing, dependencies, compatibility, and verification seams, but it may not silently change the specification's product behavior.

### Output

Write a local task set consisting of:

```text
_swe/tasks/<name>/tasks.md
_swe/tasks/<name>/tasks/<TNNN>-<slug>.md
_swe/tasks/<name>/tasks/progress.md
_swe/tasks/<name>/tasks/tracker.json
_swe/tasks/<name>/tasks/scouts/round-<RRR>/...
```

`tasks.md` is the canonical index. Each `<TNNN>-<slug>.md` is one canonical task. `progress.md`, `tracker.json` and `scouts/` are workflow state and evidence, not product tasks. Preserve unrelated files under the task set directory.

Use the specification filename as the default lowercase kebab-case `<name>`. Use a user-supplied name only when it is lowercase kebab-case and the user explicitly requests it. Do not use an implementation project name guessed from the repository.

The generated set must:

- contain one index and one file per task;
- list tasks in dependency order, with blockers before dependents;
- use continuous identifiers `T001`, `T002`, and so on;
- trace every required task to specification capability, journey, state, interaction, or recovery identifiers;
- describe the smallest useful complete vertical slice per task;
- preserve the complete expected outcome across the union of tasks rather than compressing a feature into one task;
- allow as many tasks as the behavior requires; do not optimize for a short task list or short document;
- declare exact blocking edges with `Blocked by`;
- include observable acceptance criteria for success and relevant validation, permission, empty, failure, recovery, accessibility, security, privacy, and reliability behavior;
- keep optional specification capabilities non-blocking unless the specification makes them necessary for the core outcome;
- contain no project implementation file paths, function names, concrete signatures, code snippets, command transcripts, unresolved alternatives, or open product questions; qualifying external reference paths are allowed only under the reference-aware citation rules.

This skill writes local Markdown artifacts only. It does not publish to GitHub, Linear, Jira, or another external tracker and does not modify source code.

## Trigger boundary

Run this skill only when the user explicitly asks to create, regenerate, replace, or resume implementation tasks from one named specification, or to check, track, or advance an existing task set.

Do not run it for:

- creating or revising a specification;
- feature discovery or task generation without a finalized specification;
- casual brainstorming;
- source-code implementation;
- task generation from multiple specifications in one invocation.

Process one specification per invocation. If a user asks for several specifications, resolve one run at a time rather than merging their scope.

## Core invariants

1. Exactly one specification is the product source for one task-set generation round.
2. The specification must be structurally valid and finalized before tasks are synthesized.
3. Out-of-scope specification behavior never becomes a task.
4. Product ambiguity is resolved before task synthesis; it is never hidden in a task.
5. Tasks are vertical slices, not horizontal database, API, UI, test, or infrastructure layers.
6. Every task has a real completion outcome and can be demoed or verified independently once its blockers are complete.
7. `Blocked by` contains only genuine prerequisites; do not serialize unrelated tasks.
8. Optional capabilities never block required core tasks.
9. Codebase scouts provide evidence only. They never write tasks, progress, or source code.
10. The host owns source resolution, task decomposition, dependency ordering, quality validation, writing, and verification.
11. Never overwrite an existing task set without an explicit regeneration or overwrite decision.
12. Never delete unrelated files or silently remove a previous task from history.
13. Reference-aware mode is opt-in and never silently replaces the specification as the product source of truth.
14. Citable reference paths are validated, read-only, and outside the resolved project codebase root.
15. Greenfield task generation remains valid without implementation scouts; reference-aware greenfield generation pauses for user clarification when no bounded reference scope can be established.

## Specification source contract

The `specifications` skill is responsible for emitting the canonical specification structure described below. This skill is a validation-and-consumption boundary: it must read the specification as written and must not normalize headings, infer or renumber identifiers, redistribute content between sections, repair missing scope decisions, or silently rewrite product behavior. If the source is not valid, stop and require specification revision before task synthesis.

Before task generation, read the complete specification and verify:

- it begins with `# Specification:`;
- these 12 required sections are present and ordered:
  1. `## 1. Overview`;
  2. `## 2. Actors and authority`;
  3. `## 3. Scope and non-goals`;
  4. `## 4. End-to-end journey`;
  5. `## 5. Capability contracts`;
  6. `## 6. State model and transitions`;
  7. `## 7. Cross-experience interactions`;
  8. `## 8. Information, truth, and uncertainty`;
  9. `## 9. Validation, review, finalization, and revision`;
  10. `## 10. Failure and recovery`;
  11. `## 11. Edge cases and quality expectations`;
  12. `## 12. Final expected experience and success criterion`;
- at least one `CAP-*` capability is defined;
- journey, state, authority, scope, failure, and success behavior are sufficiently concrete;
- material ambiguity is not left in the specification;
- capability, journey, state, interaction, and recovery identifiers are not duplicated or malformed;
- the final experience and core product success criterion are explicit;
- each capability states an observable trigger, an actor-visible outcome, a clear boundary, and relevant failure handling rather than hiding several independently verifiable outcomes behind one umbrella heading;
- scope decisions distinguish in-scope behavior, non-goals, explicitly deferred behavior with boundary and reason, and unknown items needing a decision; deferred behavior is never silently treated as in-scope or out-of-scope;
- when the specification changes existing behavior, fixes a defect, or targets porting or parity, it records current versus desired behavior, what must remain unchanged or compatible, and the oracle or compatibility scope when one applies.

If the specification is missing required sections, leaves behavior-affecting ambiguity, uses umbrella or untestable capabilities, or omits required scope, preservation, or compatibility boundaries, do not repair it inside this skill. Tell the user to revise or regenerate the specification first. Do not use the conversation to silently supersede a finalized specification unless the user explicitly asks to revise the specification and that change is completed before task generation. Do not silently ignore material product decisions from the conversation or from referenced discussion transcripts and decision logs when they are absent from the specification; require the specification revision first.

## Managed paths and regeneration

For task set `<name>`, the workflow manages only:

```text
_swe/tasks/<name>/tasks.md
_swe/tasks/<name>/tasks/progress.md
_swe/tasks/<name>/tasks/<TNNN>-<slug>.md
_swe/tasks/<name>/tasks/scouts/round-<RRR>/
_swe/tasks/<name>/tasks/revisions/<RRR>/
```

Preserve every other artifact under `_swe/tasks/<name>/`.

When `tasks.md` already exists:

1. For an explicit fresh generation, ask whether to keep the current set or regenerate it with archival.
2. If the user keeps it, append the disposition to progress and stop without changing task files.
3. If the user regenerates, archive the exact current index and every task named by that index under the next `tasks/revisions/<RRR>/` directory before writing the new set.
4. Verify the archive byte-for-byte by reading it back before replacing any canonical file.
5. Preserve the existing `progress.md`, scout reports, and prior revisions.
6. Never delete a stale task silently; it must remain in the archived revision.

An explicit resume continues the latest non-terminal workflow round. Do not start an overlapping fresh round while a previous round is paused or in progress.

## Project location and citation scope

The active workspace is the current working directory, and it is the project codebase root. `_swe/` holds this workflow's artifacts and is not implementation evidence.

1. Use only the workspace for repository discovery. Do not modify it, except for the managed paths under `_swe/tasks/<name>/`.
2. Citable reference material is any existing regular file outside the workspace, read-only. A citation is an absolute path that resolves outside the workspace; symlinks are allowed only when they resolve to such a file. Final task artifacts use path-only citations without line ranges or symbols; the source specification path remains provenance rather than a reference citation.
3. Never cite a file inside the workspace and never modify a cited file.

## Optional discovery

The specification source and all task artifacts must remain inside the workspace.

Current-codebase discovery is optional because the task contract is specification-first:

1. If the user does not request repository evidence or references, use specification-only mode and launch zero scouts.
2. If the user requests repository evidence, or the workspace holds implementation relevant to the specification and sequencing or verification needs it, use fresh bounded `tasks-scout` reports.
3. When no relevant implementation exists, record greenfield mode and synthesize from the verified specification unless reference-aware mode requires a bounded reference investigation.
4. In reference-aware greenfield mode with a clear reference scope, use fresh bounded scouts for the references only; do not treat the empty workspace as implementation evidence.
5. In reference-aware greenfield mode without a clear reference scope, pause and ask the user what reference files or bounded questions to scout.

The workspace is read-only evidence for this workflow. Do not include its paths in final task artifacts. Scouts may retain precise project paths in private reports; final tasks carry durable behavioral consequences and only qualifying external reference citations.

## Required context gate

Generation may proceed only after the host has captured:

1. specification path, title, and source identity;
2. task set name and output paths;
3. primary actors and authority;
4. in-scope and out-of-scope behavior;
5. required and optional capabilities;
6. success journey, states, interactions, and recovery boundaries;
7. the specification's language;
8. whether codebase evidence is requested or necessary;
9. any known dependencies that affect blocking edges;
10. whether evidence mode is `specification-only` or `reference-aware`, and the explicit reference scope or paths when reference-aware;
11. when reference-aware and greenfield, whether the reference scope is bounded enough to define a scout question without inferring from an empty codebase;
12. any additional user-supplied reference instructions or notes, preserved verbatim when present.

If a task-affecting interpretation is unclear, gather all related questions and ask the user one question at a time through the question tool when available. Do not ask separate questions for ordinary implementation discovery. Do not synthesize a task set while a material ambiguity, source conflict, or missing specification section remains unresolved.

## Reference-Aware Mode

Reference-aware mode is manual: enter it only when the user explicitly asks to use references as a source of truth. Do not activate it merely because reference files exist. The specification remains the product contract; references provide evidence for task sequencing, dependencies, contracts, risks, verification seams, or implementation patterns and may not silently change specification behavior.

### Citation scope

- Any existing regular file outside the resolved project codebase root may be used as read-only reference evidence.
- Reference paths are absolute and must resolve outside the project codebase root.
- Scouts verify reference paths before citing them. Final `tasks.md` and task files carry path-only citations without line ranges or symbols; the report may retain precise line-level evidence.
- Every inline citation in a task must appear in that task's `## References` section; every inline citation in the index must appear in the index's trailing `## References` section; the index section is the deduplicated union of all current-artifact citations. When no references are used, the sections contain `None`.
- Cited files are read-only. Neither the coordinator nor a scout may modify, move, rename, or delete them.

### Behavior by context

- If the user explicitly asks to use references, enter reference-aware mode and preserve relevant path citations in substantive index and task content wherever references provide evidence.
- Preserve any additional user-supplied reference instructions or notes verbatim in the applicable task/reference section and in the progress context; do not silently drop or paraphrase their substance.
- If reference-aware investigation finds no relevant evidence, tell the user and ask whether to continue without citations, add reference material, or take another action. Do not fabricate citations. If the user explicitly requires citations and no citable material exists, reject the request.
- In an established codebase, derive bounded reference and codebase questions from the specification and available evidence, then delegate only those questions to fresh `tasks-scout` reports.
- In a greenfield codebase, do not invent a scout scope from an empty project. Continue with specification-only task synthesis when references are not requested. If reference-aware mode is requested but no concrete reference paths or bounded questions identify what to investigate, pause before scouting or writing task artifacts with `reason=reference-scope-unclear` and ask: `The project is greenfield, and reference-aware mode has no bounded reference scope to investigate. Which reference files or specific questions should I scout?`
- When a clear reference scope is supplied in greenfield mode, delegate bounded reference-only scouts; do not inspect the empty codebase as if it contained implementation evidence. A reference-only scout may complete with `None` for current implementation evidence when the references answer its bounded questions. If the scoped references are insufficient, follow the no-relevant-evidence rule above.

## Running the tasks script

`tasks` below stands for this shell function:

```bash
tasks() { bun "<this skill's directory>/scripts/tasks.js" "$@"; }
```

Define it at the start of every shell command that uses it, because shell state does not carry over between commands. It needs [Bun](https://bun.sh) and nothing else; when `bun` is not found, tell the user to install it and stop. Run it from the workspace root. `--set <name>` can be left out when exactly one task set exists. Exit code 0 means success, 1 means problems were found, 2 means the call was wrong.

- `tasks validate-spec <name>` checks a specification against the canonical structure and identifiers.
- `tasks validate` checks the index, task files, dependency graph, and traceability against the specification.
- `tasks status`, `tasks next`, `tasks graph` show the state of every task, the tasks that can start now with the longest remaining chain, and the dependency graph as Mermaid.
- `tasks start <T001>`, `tasks done <T001>`, `tasks reopen <T001>` record progress in `tasks/tracker.json`. `done` refuses while an acceptance criterion is unchecked or a blocker is open.

## Tracking progress

When the user asks what to work on, what is blocked, or to record progress on an existing task set:

1. Run `tasks validate`; when it reports problems, say so before tracking and offer to regenerate or repair the set through the workflow below.
2. Run `tasks next` and give the user the ready tasks and the longest remaining chain; tasks listed together can run in parallel.
3. When work on a task begins, run `tasks start <id>`. As each acceptance criterion is shown to hold, change its `- [ ]` to `- [x]` in the task file, with the user's yes when the criterion was not demonstrated in this session. Never check a criterion that was not demonstrated.
4. When every criterion is checked, run `tasks done <id>` and report the tasks it unlocks.
5. Never edit `tracker.json` by hand, and never edit a task's contract while tracking; a change to scope is a regeneration.

## Workflow

### 1. Resolve and validate the specification

1. Resolve the explicit specification path, slug, or unique specification candidate.
2. Confirm it stays inside the workspace and is a regular file.
3. Read the complete file.
4. Run `tasks validate-spec <name>` (see Running the tasks script). Treat every problem it reports as a stop under the source contract. Then validate the specification title, 12 required sections, stable identifiers, scope, authority, state behavior, recovery behavior, core success criterion, capability specificity, scope taxonomy, and work-type boundaries from the specification source contract.
5. Reconcile newer product decisions from the current conversation and from referenced discussion transcripts or decision logs against the specification. If material decisions are absent from or contradict the specification, pause and require a specification revision before synthesis; neither silently fold the newer detail into tasks nor silently ignore it.
6. Derive or confirm the task set name.
7. Determine artifact language from the specification; preserve product terminology exactly.
8. Resolve and validate evidence mode and any reference scope before discovery or managed artifact writes.
9. Create only the managed output directories after source and evidence validation passes.
10. Read existing `progress.md` and apply fresh/resume and overlap rules. Follow [Progress Log Format](./references/PROGRESS-LOG-FORMAT.md) for every progress event and for recovery after a compaction or resume.
11. Check existing `tasks.md` and apply the regeneration disposition before drafting.
12. Append `workflow-started`, `source-resolved`, and `context-captured` progress events.

### 2. Classify evidence and discovery mode

Perform only light classification first and record two independent dimensions:

- **evidence mode** — `specification-only` when the specification is the only source of truth, or `reference-aware` when the user explicitly asks to use citable references;
- **discovery mode** — `greenfield` when no relevant implementation exists, or `established` when relevant implementation exists and evidence is needed for sequencing or verification.

Apply the following rules:

- In `specification-only` mode, launch zero scouts when no current-codebase evidence is requested or when discovery confirms greenfield context is sufficient. Record `coverage-evaluated` with `reports=0` and the reason.
- In `specification-only` established mode, use fresh bounded `tasks-scout` reports only when the user requests or the workflow requires current-codebase evidence.
- In `reference-aware` established mode, define bounded reference and codebase questions, then use fresh `tasks-scout` reports for those questions.
- In `reference-aware` greenfield mode, do not scout an empty codebase. If the user supplied clear reference paths or bounded questions, delegate reference-only scouting. If not, pause before scouting or writing artifacts and ask the clarification specified in `Reference-Aware Mode`.

### 3. Plan discovery scopes

Define focused topics before delegating any scout. Sort topics lexicographically. Each topic must have:

- a lowercase kebab-case name;
- a bounded included and excluded scope;
- concrete evidence questions;
- a direct connection to task boundaries, dependencies, current behavior, risk, or testing;
- a safe report path under `_swe/tasks/<name>/tasks/scouts/round-<RRR>/`;
- an explicit `resume` boolean;
- when reference-aware, the explicitly permitted reference paths or bounded reference scope and the `reference_mode` value passed to the scout.

Useful topics include:

- `current-behavior` — which specification outcomes are already supported or partial;
- `integration-boundaries` — existing user-facing entry points and dependency edges;
- `data-and-state` — current state and compatibility constraints;
- `testing-seams` — highest usable behavioral verification seams;
- `risks-and-dependencies` — permissions, privacy, reliability, accessibility, migration, and operational constraints;
- `reference-context` — relevant external reference guidance and the product decisions it can evidence, only in reference-aware mode.

Use no more than five scouts per wave, three waves, or fifteen scout invocations per authorized discovery cycle. A corrected retry or narrower replacement consumes budget.

Before any delegation, validate every brief. If validation fails, return `REJECTED: missing required inputs: ...` or `REJECTED: invalid input: ...` and do not append a scout lifecycle event or mutate a report.

### 4. Delegate `tasks-scout`

Run each scout as a worker from the `tasks-scout` template (skill `agent-roster-template`, "Run a template once as a worker"). Provide every required input listed in [Scout Report Format](./references/SCOUT-REPORT-FORMAT.md) (the contract `tasks-scout` follows; pass its absolute path as `report_format_path`), including `reference_mode` and `reference_scope`. Include any additional user-supplied reference instructions or notes verbatim in `specification_context`. Before each delegation, append `scout-started` with the cycle, wave, topic, scope, report path, attempt, and `resume` value. In reference-aware mode, the brief must identify the read-only reference paths or bounded reference questions the scout may investigate.

A scout returns only:

```text
report_path: <path>
status: completed | in-progress | blocked
reason: <required only when blocked>
```

Read every returned report, including partial `in-progress` evidence, before evaluating coverage. A returned `in-progress` report cannot satisfy complete coverage. The host remains the only progress writer.

If a scout rejects its input, record `scout-blocked` with `report=none`, correct the coordinator input, and retry the same topic once. If a terminal report collision occurs, preserve the report and pause for a new report path. For an operationally blocked report, retry once with corrected instructions and then use one narrower replacement scope; preserve every report.

### 5. Evaluate evidence coverage

Before synthesis, verify that the specification and reports establish:

- the complete product outcome, exclusions, explicitly deferred behavior with boundaries, and unknown items;
- current supported, partial, or missing behavior when discovery was used;
- stable contract and state implications;
- vertical-slice opportunities and genuine prerequisites;
- dependency, permission, privacy, security, accessibility, reliability, migration, rollout, and operational constraints when relevant;
- usable behavioral verification seams for every task candidate;
- conflicts, unknowns, and stale evidence;
- relevant reference evidence and verified citation paths when reference-aware;
- omission checks: every required capability, journey step, state, interaction, recovery scenario, and material edge case maps to at least one task candidate or is explicitly classified as a cross-cutting principle with its enforcing tasks named; deferred behavior never becomes a task candidate while its boundary is preserved; non-goals never become task candidates.

If coverage leaves a required identifier, edge case, preservation boundary, or compatibility boundary without a task, return to decomposition rather than leaving the gap implicit. If reference-aware investigation finds no relevant evidence, tell the user and ask whether to continue without citations, add reference material, or take another action. Do not fabricate citations. If evidence changes the interpretation of the specification, do not silently alter tasks. Ask the user to resolve the conflict or to revise the specification. Re-run affected discovery after clarified scope.

### 6. Decompose the specification into task candidates

Start from the primary journey and required capabilities. Model the complete expected outcome first, then decompose it repeatedly into the smallest useful complete slices. Use journey steps, meaningful state transitions, validation boundaries, review decisions, interaction hand-offs, and recovery scenarios to find split points.

Do not stop at one task per capability or one task per feature. One specification capability may legitimately produce many tasks when its journey contains several independently verifiable outcomes. A long task set and a long index are acceptable; a falsely broad task is not.

Apply these rules:

1. A task delivers one smallest useful independently recognizable actor outcome.
2. A task cuts through every relevant layer required for that outcome, but describes the result rather than listing technical layers.
3. Scope size is judged by behavioral independence, not by a maximum task count, document length, or arbitrary phase limit.
4. A task includes its own success path and material non-success behavior.
5. A prerequisite task is allowed only when its outcome is itself demoable or verifiable and genuinely gates another task.
6. Do not create setup, scaffolding, schema-only, API-only, UI-only, test-only, or documentation-only tasks without an independent product outcome.
7. When a wide mechanical refactor cannot remain green as a vertical slice, use an explicit expand–migrate–contract sequence and state the compatibility boundary; do not hide it inside an unrelated task.
8. Keep optional capabilities out of the core blocking chain. Include them as non-blocking tasks only when the specification makes them a concrete desired outcome.
9. Combine steps only when splitting them would create a non-demoable fragment or break the expected outcome.
10. Split a broad capability when it contains distinct actor decisions, visible states, completion conditions, validation boundaries, or recovery paths.
11. Re-run the granularity test recursively after every split. If a resulting task still contains two independently verifiable outcomes, split it again.
12. When uncertain whether to merge or split, prefer the smaller task if both resulting slices remain behaviorally complete.
13. For enhancements, defect fixes, and porting or parity work, preserve existing behavior explicitly: include the current-versus-desired boundary, unchanged or compatible behavior, and the oracle or compatibility scope in the affected tasks rather than leaving preservation implicit.
14. For deferred behavior, record the boundary and next step in the nearest task scope boundary without turning the deferred work itself into a task.

The union of tasks must still cover the specification's complete expected outcome, core success criterion, required capabilities, and material failure/recovery behavior. Each candidate must be traceable to one or more specification IDs (`CAP-*`, `J-*`, `STATE-*`, `INT-*`, or `REC-*`). No task may be justified only by an implementation file or scout suggestion.

### 7. Order and validate blocking edges

Build a directed dependency graph where an edge `T001 -> T002` means T001 must finish before T002 can start. Then:

- place blockers before dependents;
- keep independent tasks parallel when possible;
- reject cycles and resolve them by splitting or removing an unjustified edge;
- avoid transitive duplicate edges when a direct blocker is already implied by another blocker, unless the direct relationship matters for recovery;
- ensure every task is reachable from the initial frontier or explain the external prerequisite;
- ensure optional tasks do not block required tasks;
- ensure every `Blocked by` entry names an existing task ID and title;
- ensure no task depends on a later task.

The index must show the dependency order and a concise reason for every non-empty blocking edge.

### 8. Synthesize artifacts

Read [Tasks Format](./references/TASKS-FORMAT.md) before writing. Synthesize:

- the canonical `tasks.md` index;
- one complete task file per task;
- a dependency order with blockers first;
- specification traceability for every task;
- observable acceptance criteria and relevant recovery behavior, with each criterion naming its trigger and actor-visible result so pass or fail can be decided without implementation knowledge, and with untestable adjectives allowed only alongside such an observable test;
- preservation or compatibility criteria in affected tasks when the specification changes existing behavior, fixes a defect, or targets porting or parity;
- no project implementation paths or code snippets; qualifying external reference paths are allowed only under the reference-aware citation rules.
- in reference-aware mode, path-only citations in substantive task and index content, with matching `## References` sections as required by [Tasks Format](./references/TASKS-FORMAT.md).

Tasks must use the language of the specification. Keep identifiers, domain names, state names, and authority terms unchanged.

### 9. Apply the quality gate

The host alone performs this gate. Do not delegate it. The mechanical items below are also enforced by `tasks validate` in step 10; the judgment items are yours.

#### Source integrity

- exactly one valid specification is identified;
- all required specification sections and identifiers were read;
- out-of-scope behavior is absent and deferred behavior appears only as a recorded boundary, never as a task;
- specification conflicts and task-affecting ambiguity are resolved, including newer conversation or transcript decisions reconciled against the specification;
- umbrella or untestable capabilities, missing scope taxonomy, and missing preservation or compatibility boundaries were rejected back to specification revision rather than carried into tasks;
- every task traces to specification behavior.

#### Vertical-slice quality

- every task is independently demoable or verifiable after its blockers;
- no task is merely a technical layer or vague umbrella;
- each task has one smallest useful actor outcome, trigger, boundary, and completion condition;
- each task contains success and relevant invalid, empty, permission, failure, recovery, accessibility, privacy, security, and reliability behavior;
- every broad capability was tested for further meaningful splits rather than being emitted as one feature-sized task;
- the task set is allowed to be long and contains no artificial maximum or compression for convenience;
- the union of tasks covers the specification's complete expected outcome and core success criterion, including required identifiers, material edge cases, preservation boundaries, and compatibility boundaries;
- optional tasks do not block required tasks;
- the dependency graph is acyclic, minimal, and ordered.

#### Artifact completeness

- `tasks.md` and every task file follow `TASKS-FORMAT.md`;
- task IDs are continuous and filenames match their IDs and slugs;
- every `Blocked by` entry resolves to a task in the same set or explicitly names an external prerequisite;
- acceptance criteria are observable and testable without requiring a particular file or function, with each criterion naming its trigger and actor-visible result and with untestable adjectives allowed only alongside an observable test;
- the index lists all and only the current task files;
- no project source paths, function names, signatures, code snippets, command transcripts, unresolved alternatives, or open questions appear, except qualifying external reference paths in reference-aware mode;
- in reference-aware mode, every substantive reference-backed claim has a nearby qualifying path-only citation, and the index and task-level `## References` sections are complete and consistent;
- the source specification, task count, dependency order, and revision status are visible in the index.

#### Durability

- each task can be understood without reopening the conversation;
- the index plus task files preserve enough behavior and dependency context for an implementer to begin at the frontier;
- retained scout reports are evidence only and are not required to understand the task contract;
- artifacts are written inside the active workspace and existing sets are archived before replacement;
- cited reference files remain outside the project codebase root, are read-only, and are not required for specification-only task generation.

If a check fails, return to specification clarification, discovery, decomposition, or synthesis as appropriate. Never write a partial task set.

### 10. Archive, write, and verify

After the quality gate passes:

1. archive the existing canonical task set when regeneration requires it;
2. write `tasks.md` and all task files under their managed paths;
3. read every written file back and run `tasks validate --set <name>`; fix every problem it reports and run it again until it passes;
4. verify IDs, filename slugs, specification traceability, blockers, dependency order, acceptance criteria, index membership, and reference sections;
5. verify no task is missing, duplicated, stale, or unlisted;
6. append `task-write-verified` with the index path, task count, revision, and scout count;
7. append `workflow-completed`.

If any write or verification step fails, preserve the progress checkpoint, do not claim completion, and pause with the exact remediation required.

## Do not

- Do not read any other document as a substitute for the specification source in this skill.
- Do not process multiple specifications in one invocation.
- Do not turn every capability into exactly one task; repeatedly split broad capabilities into the smallest useful complete slices.
- Do not merge tasks merely to reduce the task count, phase count, or document length.
- Do not create horizontal tasks for database, API, UI, tests, infrastructure, or documentation alone.
- Do not use implementation paths, function names, concrete signatures, code snippets, or command transcripts in final task artifacts.
- Do not add behavior that appears only in scout evidence and not in the specification.
- Do not alter the specification from inside this skill.
- Do not make optional capabilities block the core journey.
- Do not create cycles, hidden dependencies, or blanket sequential edges.
- Do not overwrite an existing task set without archival and explicit regeneration handling.
- Do not publish to an external issue tracker or modify source code.
