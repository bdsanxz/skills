---
name: improve-my-instruction
description: Rewrite an instruction the user provides so that it is clearer, better organized and unambiguous, using facts found in the codebase, without changing what it asks for. Use when the user asks to improve, rewrite, clarify, tighten or clean up an instruction, prompt, task description or request, or names this skill. Do not use to carry out the instruction, or to review or extend what it asks for.
---

# Improve My Instruction

Rewrite the user's instruction so that a reader can follow it without guessing, and so that it still asks for exactly what the user asked for. The codebase is the source of facts: it settles what the instruction refers to and fills what it leaves vague. The result is the rewritten instruction only. Do not carry the instruction out.

## Workflow

### 1. Read the instruction

1. Take the instruction exactly as the user gave it. If none was given, ask for it.
2. State its intent to yourself: the outcome it asks for, and every requirement, constraint and step it contains. This is the baseline that the rewrite is checked against in step 4.
3. List what a reader could not act on as written:
   - vague references ("the config", "that script", "the usual format");
   - terms with more than one reading;
   - missing steps, inputs or outputs;
   - steps out of order, and statements that contradict each other.

### 2. Search the codebase for facts

1. Search for everything the instruction mentions or depends on: the files, directories, names, commands, conventions and existing work it refers to, and the project's own instruction files, such as `AGENTS.md`, `CLAUDE.md` and `README.md`.
2. Search for each item on the list from step 1, to learn what the instruction means by it.
3. Keep only facts you read in the codebase, each with the path it came from. A guess is not a fact.
4. If the codebase holds nothing relevant, or there is no codebase, continue with the instruction's own text.

### 3. Rewrite the instruction

Use the facts for one purpose only: to make what the instruction already says exact.

- Replace each vague reference with what it refers to, such as the real path, name or command.
- Where a term has more than one reading and the facts support only one, write that reading.
- Fill a missing step, input or output only when the facts, or the rest of the instruction, leave one possible answer.
- Put the steps in the order they must happen, and group related statements together.
- State each requirement once, in plain and direct words. Remove repetition and filler.
- Resolve a contradiction only when the facts, or the rest of the instruction, show which side the user means.
- Keep the user's own format (prose, list, steps) unless another one is clearly easier to follow, and keep the user's language.

Leave everything else alone:

- Add no requirement, assumption, constraint, example or context that the instruction does not contain or directly imply. A fact from the codebase that the instruction does not need stays out.
- Remove and weaken no requirement, and change no scope.
- When an ambiguity, gap or contradiction cannot be settled without choosing for the user, keep the user's wording at that point and report it in step 5.
- Make the result no longer and no more structured than it needs to be to be complete and unambiguous. A short, clear instruction may need only a few changed words, or none.

### 4. Check the rewrite

Compare the rewrite with the baseline from step 2 of [Read the instruction](#1-read-the-instruction):

1. Every requirement, constraint and step of the original is in the rewrite, with the same meaning.
2. Everything in the rewrite is in the original, or is a fact from the codebase that makes an original statement exact.
3. The steps are in a workable order, and no two statements contradict each other.
4. Nothing can be removed without losing meaning or clarity.

Fix whatever fails and check again.

### 5. Report

Give the user:

1. The improved instruction, in a code block, ready to copy.
2. What changed, briefly: each reference or ambiguity that was resolved, and the path of the fact that resolved it.
3. Open questions: each point left as written because only the user can settle it. Leave this part out when there are none.

If the instruction was already clear and complete, say so and return it unchanged.
