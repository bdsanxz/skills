# Requests

How to ask this member for work. Each example is a request you could send; give every input by absolute path, and name the report file.

<example>
Context: The baseline for the checkout work is written and the specs and tasks both have a section for the feature "Expense export".
requester: "I'll ask the drifting-check-auditor member for the feature Expense export."
prompt: "Audit the unit 'Expense export'. Specs: /repo/specs/expenses.md. Tasks: /repo/tasks/expenses.md. Baseline (outcome statements and numbering): /repo/_swe/drifting-check/expenses/baseline.md. Definitions: /repo/skills/product/drifting-check/references/drift-types.md. Report format: /repo/skills/product/drifting-check/references/report-format.md. Write your report to /repo/_swe/drifting-check/expenses/reports/audit-expense-export.md. It is the only file you write."
<commentary>
The prompt names the unit and points to every file by absolute path, and names the report file. It carries no summary of the documents and no hint about where drift might be.
</commentary>
</example>

<example>
Context: The tasks are a flat list with no feature sections, and the specs are a short ticket. The baseline numbers both.
requester: "I'll ask the drifting-check-auditor member for the whole task list as one unit."
prompt: "Audit the unit 'whole list'. Specs: /repo/_swe/drifting-check/import/specs.md (the ticket, copied word for word). Tasks: /repo/_swe/drifting-check/import/tasks.md (the session's task list, copied word for word). Baseline: /repo/_swe/drifting-check/import/baseline.md. Definitions: /repo/skills/product/drifting-check/references/drift-types.md. Report format: /repo/skills/product/drifting-check/references/report-format.md. Write your report to /repo/_swe/drifting-check/import/reports/audit-whole-list.md. It is the only file you write."
<commentary>
When the sources are not files, the requester copies them into the work directory first, so that the auditor reads exactly the text that was checked and the report can quote it.
</commentary>
</example>

<example>
Context: An earlier auditor ran out of context on the unit "Sign-in" and left its report with Status in progress.
assistant: "I'll invoke a new drifting-check-auditor member to continue the unit Sign-in from its report."
prompt: "Continue the audit of the unit 'Sign-in'. Your report so far is /repo/_swe/drifting-check/app/reports/audit-sign-in.md; read it first and go on from its last entry. Specs: /repo/specs/app.md. Tasks: /repo/tasks/app.md. Baseline: /repo/_swe/drifting-check/app/baseline.md. Definitions: /repo/skills/product/drifting-check/references/drift-types.md. Report format: /repo/skills/product/drifting-check/references/report-format.md. Write to the same report file."
<commentary>
A new auditor knows nothing of the first one. The report file is the only memory, so the prompt points to it and tells the new auditor to continue it.
</commentary>
</example>
