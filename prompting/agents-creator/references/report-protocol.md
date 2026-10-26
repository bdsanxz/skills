# Report protocol

Every agent created with this skill carries the text between the two markers below in its own instructions, word for word. The agent knows only its prompt and its instructions, so the protocol cannot be left in this file and pointed to.

When you copy it:

- Replace every `{{AGENT_NAME}}` with the agent's name.
- Copy the markers too. They let `scripts/check_agent.js` find the block.
- Change nothing else. The check compares the block with this file.
- Put the task's own report sections in the agent's instructions, before the protocol, under a heading "Report sections". The protocol refers to them.

<!-- BEGIN REPORT PROTOCOL -->
## Report file

Your work is recorded in a report file, and the file is written while you work, not at the end. Your context window is limited and can be compacted at any time. What you only hold in mind can be lost with it. What is in the file stays. So you write each result to the file as soon as you have it, and the file, not your memory, is the record of your work: for the agent that sent you, and for yourself after a compaction.

### 1. Find the report file

1. Use the path the prompt gives for your report.
2. If the prompt gives none, use `_agent-reports/{{AGENT_NAME}}/<UTC date and time as YYYYMMDD-HHMMSS>.md` in your working directory. Say in your reply that you chose it.
3. Use the absolute path from here on.
4. If the file exists and holds a report, you are continuing earlier work. Read it in full before you do anything else, go on from its last entry and its "Next" line, and keep everything already written. If its last line is not `<!-- next entry -->`, add that line at the end and set its status back to `in progress`.

### 2. Start the file before you start the work

Create the file before your first step of the task, with this content:

```markdown
# Report: <the task in one line>

- Agent: {{AGENT_NAME}}
- Status: in progress
- Started: <UTC date and time>
- Report file: <absolute path of this file>

## Task

<the prompt you were given, word for word>

## Plan

<the steps you intend to take, numbered>

## Log

<!-- next entry -->
```

### 3. Write each result as soon as you have it

1. Add an entry to the log after each step of your plan, after each finding, and before you begin anything that depends on what you just learned. In a long step, add an entry at least every five tool calls. Do not collect results to write later.
2. Add an entry by putting it directly above the line `<!-- next entry -->`, with your edit tool, or by any other means you have that changes only that place. Never rewrite the whole file, and never change an entry once it is written.
3. Write each entry in this form, and leave out the lines that do not apply:

   ```markdown
   ### <number>. <what this step was, in a few words> (<UTC time>)

   - Did: <what you did>
   - Ran: `<exact command>`, exit <code>: <the lines of output that matter, as printed>
   - Changed: <absolute paths of files you changed>
   - Found: <each finding, with its absolute path and line>
   - Assumed: <each assumption you made, and why>
   - Next: <what you will do next>
   ```

4. Write what matters, not everything. Quote the lines of output that support an entry, not the whole output. When a command prints more than you need, save its full output to a file in a folder next to the report, named like the report with `.files` in place of `.md`, and give that file's path in the entry.
5. Once an entry is written, let it go. Do not repeat it in your messages, and do not read the report again except to recover (step 4) and to check it at the end (step 5).

### 4. Recover from the file

When your context was compacted, or you are no longer sure what you have done, read the report file in full before you do anything else. Go on from the last entry and its "Next" line. Do not redo a step the log shows as done, and do not trust a summary over the file.

### 5. Finish the file

Do this every time you stop: when the task is done, when it is partly done, and when it is blocked or failed.

1. Replace the line `<!-- next entry -->` with a final section, "## Result", that holds the report sections your instructions list, in their order. If they list none, write: the result in one or two sentences, what was done, what is not done, and what the agent that sent you must decide.
2. Write every section for a reader who has only this file: give absolute paths and exact commands, quote output as printed, and never write "as above" or "as discussed". State what failed and what you did not do as plainly as what you did.
3. Set the status line to `done`, `partly done` or `blocked`.
4. Read the file once from the top. Check that it is complete and that nothing you meant to report is missing.

### 6. Limits

1. The report file and its `.files` folder are the only files you write that your task did not ask for. This holds when your task says to change no file.
2. Never change or delete another report file.
3. Never leave something for your reply that is not in the file.

### 7. Reply

End with one line: your status (`done`, `partly done` or `blocked`) and the absolute path of the report file. If the file could not be written, say so and give the whole report in your reply instead.
<!-- END REPORT PROTOCOL -->
