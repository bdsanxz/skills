---
name: specifications
description: |
  Extract the requirements in a conversation into specifications: concrete, verifiable statements of how the system must behave end to end for its actors, grounded in facts from the working directory, with every unclear point flagged as an open question instead of assumed. Use when the user asks to write, extract or update specs from a conversation, request, meeting notes or requirements, or names this skill. Do not use to design the implementation, write code or tests, or plan tasks.
---

# Specifications

Turn what the conversation says into specifications. Requirements answer "what is needed"; specifications answer "what exactly it looks like": the behavior an actor can observe when the requirement is met. Every specification describes behavior end to end, across the system boundary, as an actor sees it. It never breaks the system down layer by layer (UI, API, service, database), because that detail goes stale as soon as the implementation changes. Every specification is verifiable: an observer who has the running system and no access to its code can tell whether it holds. Every specification is grounded: each value in it comes from the conversation or from a fact read in the current working directory. Whatever neither source settles becomes an open question. Never fill a gap with a guess.

Write for a reader who never saw the conversation: a developer, a tester, a planner or another agent must learn from the document alone who the actors are, what each one can do, how the system responds in normal and failure conditions, which behavior is required and which is optional, and when each behavior counts as met.

The result is one specification document, a Markdown `.md` file, with the specifications grouped by feature. Do not design or build the system.

## Workflow

### 1. Collect the sources

The specifications rest on two sources: the conversation, which says what is needed, and the current working directory, which shows what already exists. Use both, so that every specification is grounded in a fact and none in a guess.

1. Take the conversation: every message in this session, plus any notes, transcripts, tickets or documents the user pastes or names as part of it.
2. If the user names a part of the conversation or a single feature, limit the scope to it. Otherwise cover everything the conversation asks the system to do.
3. Search the current working directory for facts about everything in scope. Look for:
   - the project's own instruction and documentation files, such as `README.md`, `AGENTS.md`, `CLAUDE.md` and any docs directory;
   - existing specifications, requirements, tickets, ADRs, design notes, discussion transcripts and decision logs, and the directory and style they are kept in;
   - the behavior that already exists where the conversation's features touch the system: the actors and roles it knows, the routes, screens, commands, public APIs, files and messages actors see, the validation rules, limits, error messages and formats it already applies, and the tests that pin any of these down;
   - the domain terms the code and its documentation use for what the conversation names.
4. Keep only facts you read in the working directory, each with the path it came from (and the line, where it helps). A guess about what the code probably does is not a fact. Read the code to learn behavior an actor can observe; its internal structure stays out of the specifications (step 4).
5. If the user names an existing specification to update, read it in full. Step 6 explains how to update it.
6. If the working directory holds nothing relevant, or there is none, continue with the conversation alone, and say so in the report.
7. If the conversation contains no requirement at all, say so and ask what the specification should cover. Stop there.

### 2. Extract the requirements and the facts

Read the sources and list, in the conversation's own words where it has them:

1. **Features**: each capability the conversation asks for, named by what it lets actors do, such as "Expense export". A feature usually involves more than one actor, and so more than one end-to-end behavior. When the conversation covers a single feature, there is one.
2. **Work type** of each feature, because it decides what the specification must also pin down:
   - *new behavior*: nothing more;
   - *change to existing behavior*: the current behavior (a fact), the desired behavior, and what must stay unchanged;
   - *defect fix*: the observed failure, the expected behavior, and the unrelated behavior that must be preserved;
   - *port, parity or migration*: the reference the result must match, what must stay compatible, and what is excluded.
3. **Actors**: everyone and everything that interacts with the system from outside, such as user roles, external systems, operators, and scheduled triggers like time. A component of the system itself is not an actor. For each actor, note its authority: what it may provide, approve, change, publish or undo, and what it may only observe.
4. **Requirements**: each need, goal, rule or constraint the conversation states. Give each one an ID (`R1`, `R2`, …), note where it was said, such as who said it and which message, and note the feature it belongs to.
5. **Decisions**: each choice the conversation settles, such as "we agreed exports are CSV only", including each alternative it explicitly rejected. Go through the whole conversation, not only its opening request: a later decision replaces an earlier statement, and the document must reflect the latest one. A decision is a source, not an assumption.
6. **Non-goals**: each thing the conversation explicitly excludes. A non-goal never becomes a specification.
7. **Deferred**: each thing the conversation postpones, with its boundary (what exactly waits), the reason, and what happens next, as far as the conversation says. Deferred behavior is neither in scope nor a non-goal.
8. **Information and authority**, only when the system shows information of different trust, such as values an actor entered, values the system verified, estimated, inferred or generated, and unknown values: how each kind is shown, and which source wins when they disagree.
9. **Facts**: each piece of existing behavior from step 1 that a specification will rely on, such as an existing role, limit, error message, format or public API. Give each one an ID (`F1`, `F2`, …) and its path. A fact is a source, not an assumption.
10. **Terms**: each domain word the conversation or the codebase uses with a specific meaning. Where both name the same thing, use the codebase's word and note the conversation's.

Keep only what the conversation states or directly implies, and what you read in the working directory. Then compare the two:

- When the conversation explicitly asks to change existing behavior, the change is a requirement; record the current behavior as a fact so that the specification states what changes.
- When the conversation describes behavior that contradicts what exists, and does not say that it wants a change, record the contradiction as an open question with both sides and the path of the fact.
- When two statements in the conversation contradict each other and a later one does not explicitly replace the earlier one, record the contradiction as an open question.

### 3. Find the gaps

For each requirement, ask what an observer would need to know to check that it is met, and look for the answer first in the conversation, then in the facts. When neither has it, search the working directory again for that point before you give up on it:

- **Who**: which actor triggers the behavior, and which actors see the result. Then go through every actor listed in step 2 and ask whether the feature touches them too, such as an operator who reviews what a user did, or an external system that receives what the feature sends.
- **When**: the trigger and the preconditions.
- **What**: the exact observable outcome, such as what is shown, sent, stored where an actor can see it, or refused.
- **How much**: numbers with units, such as limits, sizes, durations, counts, formats and time zones.
- **What else**: invalid input, missing permissions, failures of external systems, empty states, duplicates, concurrent actions, and the boundary values of every limit.
- **Recovery**: for each failure, what the actor is told, what progress is kept, and how the actor retries, corrects or gives up. Partial success counts: when one part fails, what happens to the parts that succeeded.
- **Lifecycle**, when the feature creates, uploads, processes, generates or publishes something: input, validation and feedback, processing and what the actor sees meanwhile, completion, review and correction, finalization or publication, and later revision, including what other actors see while a revision is prepared.
- **Conditions**, only those the product touches: interrupted sessions, slow or no network, mobile devices, accessibility, privacy, and what each actor is not allowed to do.
- **Automated or AI behavior**, when the feature has it: what context it uses, what it may do on its own and what it only suggests, how it shows uncertainty, how an actor reviews and corrects its output, how generated information stays distinguishable from facts, and what it must not invent when information is missing.

Fill a gap from a fact only when the fact applies to the behavior in scope, such as an existing password rule that the new sign-up flow reuses. A fact about a different feature is a hint, not an answer: raise it as an option of the open question. Each question the sources do not answer becomes an open question with an ID (`Q1`, `Q2`, …). Raise only the questions that change what a specification says or how it is verified. Do not ask about implementation choices that no actor can observe.

### 4. Write the specifications

Write the document in the format `references/spec-format.md` defines, and follow its rules for wording. `examples/expense-reports.md` shows a finished document.

1. Give each feature its own section, in the order the conversation introduced them, and place every specification under the feature it belongs to. A behavior shared by several features goes under the feature it serves first, and the others refer to its ID.
2. Within a feature, write one specification per end-to-end behavior, from the point of view of the actor who experiences it. When the feature involves several actors, each one whose experience it changes gets its own specification, such as the member who asks for an export and the support operator who later sees that export in the member's history. Number specifications across the whole document (`S1`, `S2`, …), not per feature, so that each ID is unique. Each specification:
   - names the actor and states the preconditions, the trigger and the observable outcome;
   - states whether it is required or optional, as the sources settle it. An optional behavior never blocks the required ones: say what the actor sees when it is unavailable;
   - states its acceptance criteria as checks an observer can run on the running system, with concrete values;
   - lists the requirements, decisions and facts it traces to;
   - covers the alternative and failure paths of its behavior that the sources settle, each with what the actor observes and how the actor recovers.
3. Give each feature a journey when it has more than one specification: a table of the steps from the first actor's trigger to the last visible outcome, each step naming its actor and the specification that defines it, so that the hand-offs between actors are visible. Add the actor-visible states and their transitions when the feature has states that change what an actor can do, such as draft, in review and published. Draw the journey, and the states when present, as Mermaid diagrams, following `references/diagrams.md`. A diagram shows only behavior the specifications state.
4. Where the sources leave a part of a specification unsettled, write the part that is settled and mark the gap inline with the open question's ID, such as `[Q3]`. Never write a plausible value in its place.
5. Describe only what crosses the system boundary: what an actor does, and what that actor or another actor observes in return. A message format or an interface is in scope only when an external actor depends on it directly, such as a public API, a file an actor downloads, or an email an actor receives. Leave out components, layers, tables, classes, frameworks and internal steps, even when the conversation mentions them. Report each technical detail you left out in step 7, so the user knows it was not lost by accident.
6. Write the open questions after the features, each with what is unclear, why it matters, the options the conversation itself raised (if any), and the IDs of the specifications it blocks.

### 5. Check the document

Go through the checklist at the end of `references/spec-format.md`. In summary:

1. Every requirement traces to at least one specification or open question. A requirement with neither is missing from the document.
2. Every specification traces to at least one requirement or decision. A specification with neither is invented and must be removed. A fact alone does not justify a specification: existing behavior is specified only where the conversation's scope needs it.
3. Every acceptance criterion names an observable outcome and concrete values. Replace vague words such as "fast", "user-friendly", "appropriate", "properly" or "etc." with a value from the sources, or with an open question.
4. No specification describes a layer, component or internal step.
5. Every `[Q…]` marker points to an open question, and every open question names the specifications it blocks.
6. Nothing in the document is an assumption: each value comes from the conversation, a decision or a fact with its path, or is marked as open.
7. Every specification sits under exactly one feature, and every actor a feature involves has a specification or an open question in that feature.
8. Every decision from step 2 appears in a specification, a non-goal, the deferred list or an open question; none was dropped, and none was overridden by an earlier statement.
9. Every specification states required or optional, and every changed or fixed behavior states what must stay unchanged.
10. Every journey step and every state transition points to a specification, and every diagram matches its table and the specifications.
11. Every fact still matches the working directory: reopen its path and check it, since the code may have changed while you worked.

Fix whatever fails and check again.

### 6. Save the document

The document is always one Markdown `.md` file, whatever the number of features.

1. If the user named a path, write the document there. If that path does not end in `.md`, ask before writing anything else.
2. If you are updating an existing specification, edit that file in place. Keep the IDs of existing requirements, specifications and questions unchanged, give new ones the next free number, and never reuse a removed ID. Move each answered question to the resolved list with its answer and its source.
3. Otherwise, if the project already keeps specifications in a directory, write the document there, following that directory's file naming. If not, write it to `_swe/specifications/<slug>.md` in the current working directory, where `<slug>` names the feature, or the product area when there are several features, in kebab-case.

### 7. Report

Give the user:

1. The path of the `.md` file, the features it covers with the number of specifications in each, and the number of facts and open questions.
2. The contradictions found between the conversation and the existing behavior, each with its open question ID. Leave this part out when there are none. If the working directory held nothing relevant, say so instead.
3. The open questions, each in one line with its ID, so the user can answer them without opening the file.
4. The technical details from the conversation that were left out because they describe the implementation, not the behavior. Leave this part out when there are none.

Then offer to go through the open questions. If the user agrees, ask them one at a time, using the question tool when one is available. After each answer, update the affected specifications, move the question to the resolved list, and check the document again with step 5 before asking the next question.
