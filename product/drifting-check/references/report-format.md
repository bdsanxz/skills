# Report format

Two documents use the finding and trace formats below: the auditor's report on one unit, and the final drift report. Both are Markdown `.md` files. The kinds and severities are defined in `drift-types.md`.

## Auditor report (one unit)

```markdown
# Audit: <unit name>

- Agent: drifting-check-auditor
- Status: in progress / done / blocked
- Unit: <the feature or the part of the documents audited>
- Specs: <absolute paths>
- Tasks: <absolute paths>
- Baseline: <absolute path of baseline.md>
- Report file: <absolute path of this file>

## Findings

<one entry per finding, in the finding format below; "None." when there are none>

## Unclear

<one entry per point, in the unclear format below; "None." when there are none>

## Trace

### Spec items

| Spec item | Kind | Status | Covered by | Coverage |
| --- | --- | --- | --- | --- |
| R1 | requirement | required | T1, T4 | full / partial / none / not required |

### Tasks

| Task | Spec items it implements | Outcome statements it serves | Result |
| --- | --- | --- | --- |
| T1 | R1, S1 | O1 | on track / D1 |

## Not checked

<what the auditor could not read or judge, and why; "Nothing." when complete>
```

The auditor writes its report before it replies, every time. `Status` is `done` only when every spec item and every task of the unit appears in the trace.

## Finding format

```markdown
### D<n>. <Kind>: <what drifted, in one line>

- **Kind**: Beyond / Missing / Conflict / Off-target
- **Severity**: High / Medium / Low
- **Task**: <task ID and title; "none" for Missing>
- **Task says**: "<exact quote>" (<document>:<section or line>)
- **Spec says**: "<exact quote>" (<ID>, <document>:<section or line>); for Off-target, the outcome statement (O<n>); for Beyond, "nothing" and the places searched
- **Why it is drift**: <one or two sentences that apply the test of this kind>
- **Over-engineering**: yes (Beyond only, when it matches a pattern in `drift-types.md`; leave out otherwise)
- **Cause**: task / spec (Off-target only, when the spec item is what drifted)
- **Resolve by**: <the options, such as "remove the part from the task", "add the behavior to the spec", "add a task for it"; the user chooses>
```

Number findings `D1`, `D2`, … in a report. In the final report they run across all units.

## Unclear format

```markdown
### U<n>. <the point, in one line>

- **Spec says**: "<exact quote>" (<ID>, <location>)
- **Task says**: "<exact quote>" (<ID>, <location>)
- **Reading A**: <meaning, and why it would be drift>
- **Reading B**: <meaning, and why it would not>
- **Question**: <the one question the user must answer>
```

## Final drift report

Written by the main agent after it has read every auditor report and checked every finding.

```markdown
# Drift report: <slug>

- **Verdict**: On track / Drifted / Cannot judge
- **Checked**: <date, UTC>
- **Specs**: <paths>
- **Tasks**: <paths>
- **Target outcome**: <source of the outcome: a spec section, or the user's words and which message>

## Target outcome

| ID | Outcome statement | Reached by tasks | Status |
| --- | --- | --- | --- |
| O1 | <statement> | T1, T2 | reached / not reached |

## Summary

| Kind | High | Medium | Low |
| --- | --- | --- | --- |
| Beyond | 0 | 0 | 0 |
| Missing | 0 | 0 | 0 |
| Conflict | 0 | 0 | 0 |
| Off-target | 0 | 0 | 0 |

Spec items covered in full: <n> of <n>. Tasks on track: <n> of <n>. Over-engineering to trim: <n> findings in <n> tasks.

## Findings

<every finding, highest severity first, then in document order>

## Unclear

<every unclear point>

## Trace

<the spec items table and the tasks table of every unit, joined; one row per spec item and per task>

## Not checked

<what could not be judged, and why>
```

The verdict is **On track** when there is no finding and no unclear point that blocks one; **Drifted** when there is at least one finding; **Cannot judge** when an input is missing or unreadable, or the target outcome is too vague to name outcome statements and the user did not settle it.
