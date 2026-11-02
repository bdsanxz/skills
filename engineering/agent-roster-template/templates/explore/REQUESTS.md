# Requests

How to ask this member for work. Each example is a request you could send; name the task, the thoroughness when it matters, and the report file.

<example>
Context: The requester needs to know where session expiry is enforced before changing it.
requester: "I'll ask the explore member where session expiry is enforced."
prompt: "Find where a session's expiry is decided and enforced, and which tests cover it. Thoroughness: medium. Write your report to /repo/_swe/explores/session-expiry.md."
<commentary>
The prompt is one bounded question with a thoroughness level and the report file. It names no suspected answer.
</commentary>
</example>

<example>
Context: A previous explore run on the same topic stopped with its report in progress.
requester: "I'll ask the explore member to continue the session-expiry report."
prompt: "Continue the exploration of where a session's expiry is decided and enforced. Thoroughness: medium. Your report so far is /repo/_swe/explores/session-expiry.md; read it first and resume from its last checkpoint."
<commentary>
A resume matches the report's task summary and scope, so the prompt repeats the same task and points to the existing report.
</commentary>
</example>
