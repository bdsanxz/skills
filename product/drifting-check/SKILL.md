---
name: drifting-check
description: "Check whether a set of tasks stays on the same track as the specs and the target outcome, and report every drift clearly with quotes from both sides: tasks that go beyond the specs (over-engineering, which it can also trim from the tasks), specs that no task covers, tasks that contradict the specs, and tasks that no longer serve the target outcome. Use when the user asks to check, audit or verify that tasks, tickets, a plan, a backlog or the work in progress still match the specs, requirements or goal, asks whether the work has drifted or crept in scope, or names this skill. Do not use to write specifications or tasks, to review code, or to test the running product."
---

# Drifting check

Compare three things and report where they part: the **specs** (what must be true), the **tasks** (what will be built), and the **target outcome** (why any of it matters). Drift has four kinds, defined in `references/drift-types.md`:

- **Beyond**: a task asks for something no spec item asks for. This is the guard against over-engineering: extra options, retries, layers, logging, abstractions and similar additions that the specs never ask for are flagged and, with the user's say, trimmed from the tasks.
- **Missing**: a spec item, or the outcome, is not covered by the tasks.
- **Conflict**: a task says something different from a spec item about the same point.
- **Off-target**: a task is allowed by the specs but does not bring about the outcome.

The check reads and reports. It edits a spec or a task only after the user chooses the resolution (step 6), because the fix may be on either side and that choice is the user's. Every finding quotes both sides; a finding that cannot be quoted is not reported. A point that depends on how an ambiguous spec is read is listed as unclear, never counted as drift.

## Workflow

### 1. Collect the three inputs

1. **Specs**: the specification or requirements document the user names, or a ticket, or the user's request in this session. If the user names none, look for a specifications document in the project's usual location (`_swe/specifications/` by default) and tell the user which one you took.
2. **Tasks**: the tasks document, ticket list, plan or backlog the user names, or the task list of this session. If the user names none, look for a tasks document (`_swe/tasks/` by default) that cites the specs. A tasks document's own `Coverage` table and `Source` lines are claims to check, not evidence.
3. **Target outcome**: what the user wants the work to achieve. Take it from the user's words first, then from the specs' purpose or goal section, then from the `Outcome` line in the tasks document's scope. If these disagree, that is itself an off-target signal: use the user's words, or ask which one holds. Never write an outcome yourself.
4. If the specs or the tasks cannot be found, or an input is not text you can read, ask the user for it and stop.
5. If the user limits the check to one feature or part, limit the scope to it.
6. Read the specs and the tasks in full. If either is not a file (a conversation, a ticket text, a session task list), copy it word for word into the work directory of step 2, so that the check and its quotes rest on a fixed text.

### 2. Write the baseline

1. Pick a `<slug>`: the feature or product area in kebab-case, or the tasks file's name. Create the work directory `_swe/drifting-check/<slug>/` in the current working directory, with a `reports/` directory inside.
2. Split the target outcome into outcome statements `O1`, `O2`, …: each a checkable sentence of what an actor can do or what is true when the work succeeds, in the words of its source. If the outcome is too vague to split without inventing content ("improve onboarding"), ask the user one question that pins it down, using the question tool when one is available, and record the answer and its source.
3. List the non-goals and deferred items the specs name, any open questions they mark, and the answers recorded as resolved in the specs or the tasks (each with its source). Note whether each spec item is required or optional.
4. Number every spec item and every task that has no ID, in reading order (`S1`…, `t1`…), as `references/drift-types.md` explains.
5. Write all of this to `baseline.md` in the work directory. This file is what every auditor and a resumed run read.

### 3. Audit

1. Divide the work into units: one per feature when the specs or the tasks are grouped by feature, otherwise one unit for the whole.
2. Invoke `drifting-check-auditor` once per unit, all units at the same time. Give it the unit, the absolute paths of the specs, the tasks and `baseline.md`, the absolute paths of `references/drift-types.md` and `references/report-format.md` (in this skill's directory, not in the work directory), and the report file `reports/audit-<unit>.md` in the work directory. Give it no opinion about where drift might be.
3. Read each report file. Do not rely on the agent's reply or on your own memory of it. A report whose `Status` is not `done` is incomplete: invoke a new `drifting-check-auditor` to continue it from the report file, and read the file again when it returns.
4. After a compaction, or when a run is resumed, list `reports/` in the work directory and read `baseline.md`. Reuse every report with `Status: done`, continue every other one, and invoke the auditor only for units that have no report.

### 4. Verify and merge

1. For each finding in the reports, open the cited places in the specs and the tasks and check that the quotes are exact and that the kind's test in `references/drift-types.md` holds. Remove a finding that fails, and move it to unclear if the cause is an ambiguous spec.
2. Remove duplicates across units and renumber the findings `D1`, `D2`, … across the whole report.
3. Check the outcome: from the trace tables, mark each outcome statement as reached when at least one task serves it and every spec item that task chain needs is covered in full. For an outcome statement that is not reached, add a Missing finding at outcome level that names the lacking spec items or tasks.
4. Make sure every spec item and every task appears in the joined trace. If one does not, send the unit's auditor back to it.

### 5. Write the report

1. Write the final drift report in the format of `references/report-format.md`. If the user named a path, write it there. Otherwise write it to `drift/<slug>.md` in the current working directory.
2. Set the verdict as `references/report-format.md` defines it.
3. Check the report once: every finding has both quotes and one kind and severity; the summary counts match the findings; every outcome statement has a status.

### 6. Tell the user

Give the user:

1. The verdict and the path of the report.
2. The counts by kind, then the High findings one line each, with the task or spec IDs involved.
3. The unclear points as questions, one line each.
4. Anything not checked, and why.

Do not change any spec or task yet. If there are Beyond findings marked as over-engineering, offer first to trim them: for each one, show the exact text to remove from the task. On the user's yes, remove only those parts from the tasks document and nothing else. Keep the IDs of the remaining tasks, never reuse the ID of a removed task, and remove the removed task's mentions from `Needs`, coverage rows and open-question `Blocks` lines. Do not add, reword or reorder anything. Then offer to go through the other findings with the user. If the user agrees, ask one finding at a time, using the question tool when one is available, with the options each finding lists under "Resolve by". Apply a resolution only to the document the user chooses, and only after the user has chosen it. After the edits, run this check again on the changed documents.
