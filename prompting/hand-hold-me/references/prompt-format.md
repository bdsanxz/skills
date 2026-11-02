# Prompt format

## What each phase does

| Phase | Steps cover |
| --- | --- |
| Setup | Creating the project so it opens and runs, then saving a first version the user can return to. Each is its own step. If a tool the project needs is missing from the user's computer, the coding agent stops and names it in its report. The guide then helps the user install it. |
| Core features | One flow or feature part per step, the most essential first, each usable when its step ends. Something a feature needs in order to work, such as sign-in, gets its own steps before that feature. |
| Polish | Making one existing screen or flow clearer and easier to use per step, such as its wording, layout, and error messages. No new features. |
| Testing | One step per feature the user asked for, trying it from start to finish. A feature that was split is tried as one journey through its flows. These steps report failures and do not fix them, and each failure gets its own fix prompt. Then one step for a way to check the main path again, which the coding agent's report explains how to run. |
| Release | Delivering the project where the user wants it: published online, shared as a package, or, if they named no destination, a short README that says how to install and run it. The prompt asks to publish only to the destination the user chose. |

## Keep prompts high level

Each prompt says what the user wants and what they see when it is done. The coding agent decides how to build it.

Never put these in a prompt:

- exact code, function bodies, or line-by-line edits;
- file paths, code locations, or commands;
- step-by-step technical procedures;
- library internals;
- numbered technical requirement lists.

Name the tech stack as a constraint and background context: the language, framework, UI library, styling approach, database, and key tools, such as "This project uses React, TypeScript, and Tailwind." Include only what you found in the project or the user explicitly chose, so the coding agent builds with the right tools and introduces no alternatives. Naming the stack never says how to use it.

The stack is the only technical specific a prompt may hold, with one exception that does not say how to build anything: an error message the user reported, quoted exactly as evidence.

Other facts from the codebase tell you what exists. Describe them in the user's terms, by what the user sees and uses, and let the coding agent find where they live.

Never write:

> In src/api/client.ts, add a retry wrapper that catches 429 and 5xx, waits with exponential backoff, then calls the next model in the list.

Write:

> When the AI service is temporarily busy, I want my request to recover by itself, and I only see a short friendly message if it still cannot finish.

## Keep prompts small

One prompt never covers a broad feature. Each covers one small, complete slice of what the user does and sees: a single flow, or a single part of a feature, that can be finished and checked on its own.

- **Split large features.** Split a feature that is large or has several flows into a sequence of prompts, each with its own checks. Split "user accounts" into signing up, signing in, and signing out, instead of one prompt for all three. If a slice needs more than five checks, it is too wide, so split it. A test step walks one journey through a feature's flows and builds nothing. If that journey needs more than five checks, split the test too.
- **Name the edges.** The prompt names the flow it covers, and `NOT YET` names what it does not cover, so the coding agent does not wander. `NOT YET` names the neighboring flows and roadmap items as plain facts. It never introduces a feature the user did not ask for.
- **Leave the app working.** When a prompt ends, everything the user can reach works, with no half-finished flow, so they can check the result before moving on. If a slice would leave a button that leads nowhere, leave the button out until the step that makes it work.

## The instructions file

`instructions.md` holds every step in order, each written like this. Write the labels in the user's language.

````markdown
## Step [N] of [M]: [step title]

[One or two plain sentences: what this prompt does and why it comes at this point.]

```text
[The prompt]
```

**What to expect:** [What the coding agent will do and reply, in one or two sentences.]

**How to check:** [The things the user can do and see themselves, matching the prompt's checks.]
````

Every prompt goes in its own fenced `text` block, so it copies whole in one click. If the prompt itself contains a fence, make the outer fence longer than the inner one.

A fix prompt or a diagnosis goes directly under its step, with the same parts, under the heading `### Fix [n]` or `### Diagnosis [n]`. In the chat, open it with one short, calm sentence on what is still missing, and end it by asking for the result, any error, or "done" if every check worked.

## Writing the prompt

A prompt reads like the user telling the coding agent a short story about what they want. Write each one fresh, in the words of this project and this user. The template below shows the shape, not sentences to copy: reword it, merge sentences, and drop what this step does not need. The only fixed parts are the two headings, the `NOT YET` label, and the report words `PASSED`, `FAILED`, and `NOT VERIFIED`.

```text
This is [the project: what it is, who it is for, and the language its users read]. It uses [the stack], so build with these and do not bring in alternatives. Work in the folder you are open in. Right now, [what exists and works, as I see and use it].

The piece I want now is [the one flow]. I am [who I am in this moment]. I want [what], because [why it matters to me].

WHAT I DO AND SEE:
[A few first-person sentences that walk through the flow: what I do, what I see, and what I see when the likely thing goes wrong.]

HOW I KNOW IT WORKS:
- [Something I can do and see with the result.]

NOT YET: [The neighboring flows and other work this leaves alone.]

Do only this. Keep [what already works] as it is, and when you finish, everything I can reach still works, with nothing half-finished. Add nothing I did not describe, publish or delete nothing I did not ask for, and never write passwords or keys into code or your report. If the project does not match what I said exists, stop and tell me what differs before you change anything. If something cannot be done, tell me why in plain words and never fake a result. Then reply briefly in [my language]: report each check as PASSED, FAILED, or NOT VERIFIED (PASSED only if you tried it and saw it work), tell me how to see the result, and copy any error message exactly.
```

Every prompt must still carry:

- **The project and the stack.** If the project exists, you cannot read it, and the user does not know its stack, write "Use what the project already uses." If you cannot establish the current state, ask the coding agent to look at the project first. If nothing exists, say so.
- **The one flow, the checks, and `NOT YET`.** Give one to five checks. If nothing neighbors the flow, write "Nothing else in this step."
- **What must not change, and how to report.** Keep the limits, the instruction to stop if the project does not match, and the report request in the closing, in whatever words fit.

For a step with no user flow, such as saving a version or a test run, the same shape applies: `WHAT I DO AND SEE` says what the user gets and sees. A test step says to report what fails and to fix nothing.

## Fix prompts

A fix prompt stands on its own too, and is shorter:

```text
This is [the project], and it uses [the stack]. [The flow, as I see it] does not work the way it should. Do not add features or redesign anything.

CHECK THAT FAILED: [the check in its original words, or the part of the flow that is missing]
WHAT I DID: [my exact actions]
WHAT HAPPENED: [what I saw]
ANYTHING ELSE SHOWN: [the exact error text, or "none"]

Find out why, and tell me in plain words. Fix only that, and leave everything I can reach working. These must still work: [all the step's other checks, in their original words]. Then reply briefly in [my language]: report each of these checks as PASSED, FAILED, or NOT VERIFIED (PASSED only if you tried it and saw it work), and copy any error message exactly.
```

A diagnosis prompt adds `WHAT EARLIER FIXES TRIED:` and replaces the closing paragraph with: "Find out why this happens and explain it in plain words, with the file or setting it comes from and what shows it. Change no files." Its chat message ends by asking the user to paste that explanation back, not by asking for "done".

## Before you finish a prompt

Reread the prompt as a coding agent in a brand-new session that has seen nothing else:

- Is every statement about the tech stack and the current state from the conversation, the codebase, a report, or what the earlier prompts in the sequence build? Replace any guess with the real fact, or leave it out so the coding agent finds it in the project.
- Does it rely on another prompt, this conversation, or the user's memory? Remove every phrase such as "as before", "the previous step", or "the next step", and state the fact itself.
- Does it cover more than one feature, flow, or outcome? Split it, update the roadmap, and check coverage again.
- Does it name the one flow it covers and what is not yet covered, without pointing at another prompt? Does it leave everything the user can reach working?
- Does it ask for anything the user did not ask for and the step does not need? Remove it.
- Does it say how to build anything? Rewrite that line as what the user wants and sees, as "Keep prompts high level" says. Is the stack stated only as a constraint, and is any file path, code location, or command left in? Remove it.
- Can the user check every item by seeing or using the result? For a situation they cannot cause, such as a busy service, write what they see if it happens.
- Does it use a command or tool that only one coding agent has? Remove it unless the user named that agent.
- Does it read like this user talking about this project, not like a filled-in form?
- Do "What to expect" and "How to check" match the prompt?

## Worked example

The user is a beginner building a recipe tracker. The earlier steps create a page that opens with a heading and save its first version. The guide writes this entry in `instructions.md`:

````markdown
## Step 3 of 9: Add a recipe

This step lets you add your first recipe and keep it. It comes first among the features because everything else in the app needs saved recipes.

```text
This is a recipe tracker for one home cook, with screens in English. It uses Vite and plain JavaScript, so build with these and do not bring in alternatives. Work in the folder you are open in. Right now, a page opens in my browser with the heading "My Recipes" and nothing else.

The piece I want now is adding a recipe. I am a home cook with a recipe I do not want to lose. I want to write it down here and find it still there later, because my recipes are scattered everywhere.

WHAT I DO AND SEE:
Under the heading I see a form for a recipe name and its ingredients. I fill it in and press Save, and my recipe appears in a list below the form. I reload the page and it is still there. If I press Save with no name, one short sentence tells me a name is needed, and nothing is saved.

HOW I KNOW IT WORKS:
- I save a recipe and I see it in the list.
- I reload the page and my recipe is still there.
- I press Save with an empty name and I see the message, and nothing is added.

NOT YET: Finding a saved recipe by searching.

Do only this. Keep the heading and the way I start the app as they are. When you finish, everything I can reach still works, with nothing half-finished. Add nothing I did not describe, publish or delete nothing, and never write passwords or keys into code or your report. If the project does not match what I said exists, stop and tell me what differs before you change anything. If something cannot be done, tell me why in plain words and never fake a result. Then reply briefly in English: report each check as PASSED, FAILED, or NOT VERIFIED (PASSED only if you tried it and saw it work), tell me how to see the result, and copy any error message exactly.
```

**What to expect:** The agent adds the form and the list, then replies with a short report and how to open the result.

**How to check:** Open the app and save a recipe. Reload the page and see that it is still there. Then press Save with an empty name and see the message.
````
