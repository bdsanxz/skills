# Requests

How to ask this member for work. Each example is a request you could send; give every input by absolute path, and name the report file.

<example>
Context: The control glyphs n, o, H and O are drawn and pass the build and check, and the proofs for round 1 are in the project's reviews directory.
requester: "I'll ask the font-design-critic member to review the control glyphs."
prompt: "Review round 1. Scope: the control glyphs n, o, H, O, in every master; checklist sections 1 and 2. Brief: /work/fonts/harbor-sans/brief.md. Checklist: /skills/design/font-design/references/review-checklist.md. Proofs: every PNG in /work/fonts/harbor-sans/reviews/round-1/. Write your report to /work/fonts/harbor-sans/reviews/round-1.md. It is the only file you write."
<commentary>
The prompt names the scope and the checklist sections, points to every file by absolute path, and names the report file. It says nothing about what the requester thinks is wrong.
</commentary>
</example>

<example>
Context: Round 3 reviewed the lowercase and found blocking problems; the requester fixed them and proofed again.
requester: "I'll ask the font-design-critic member for round 4, to check the fixes to the lowercase."
prompt: "Review round 4. Scope: the lowercase a to z and dotlessi, in every master; checklist sections 1, 3 and 5. Brief: /work/fonts/harbor-sans/brief.md. Checklist: /skills/design/font-design/references/review-checklist.md. Proofs: every PNG in /work/fonts/harbor-sans/reviews/round-4/. Previous round: /work/fonts/harbor-sans/reviews/round-3.md; say for each of its findings whether it is fixed. Write your report to /work/fonts/harbor-sans/reviews/round-4.md. It is the only file you write."
<commentary>
A follow-up round gets the previous report, so the critic can confirm each fix from the new proofs instead of trusting that it was made.
</commentary>
</example>

<example>
Context: An earlier critic ran out of context during round 6 and left its report with Status in progress.
assistant: "I'll invoke a new font-design-critic member to continue round 6 from its report."
prompt: "Continue the review of round 6. Your report so far is /work/fonts/harbor-sans/reviews/round-6.md; read it first and go on from the first sheet it has not reviewed. Scope: the whole font; checklist sections 1 to 8. Brief: /work/fonts/harbor-sans/brief.md. Checklist: /skills/design/font-design/references/review-checklist.md. Proofs: every PNG in /work/fonts/harbor-sans/reviews/round-6/. Write to the same report file."
<commentary>
A new critic knows nothing of the first one. The report file is the only memory, so the prompt points to it and tells the new critic to continue it.
</commentary>
</example>
