---
name: specifications
description: |
  Create one clear, granular, behavior-first product specification from the product idea
  established in the current conversation context.
argument-hint: "Describe the product idea, intended users, problem, or desired outcome."
---

Create a specification from the product idea already established in the current conversation context.

Save the finalized specification as `_swe/specifications/<name>/specification.md` in the current working directory, where `<name>` is a short, lowercase, hyphenated name for the product idea. If that file already exists, read it and revise it in place, retaining identifiers for unchanged behavior. Do not edit `.gitignore`. Tell the user the path and that `_swe/` is not git-ignored.

The specification will be consumed by users, developers, planners, architects, and AI agents, so write it as a clear upstream product specification that can be used as shared context for later planning and implementation. It is also the canonical product contract for downstream task planning; a finalized specification must be directly usable without downstream normalization, restructuring, or inferred identifiers.

Focus primarily on end-to-end behavioral specifications and the experience that should be realized in the application.

Describe the product in terms of what actors do, what the system does in response, what state changes occur, what information is visible, and how the experience behaves from beginning to end.

## Canonical output contract

Every finalized specification must use this exact top-level structure, in this exact order:

1. `## 1. Overview`
2. `## 2. Actors and authority`
3. `## 3. Scope and non-goals`
4. `## 4. End-to-end journey`
5. `## 5. Capability contracts`
6. `## 6. State model and transitions`
7. `## 7. Cross-experience interactions`
8. `## 8. Information, truth, and uncertainty`
9. `## 9. Validation, review, finalization, and revision`
10. `## 10. Failure and recovery`
11. `## 11. Edge cases and quality expectations`
12. `## 12. Final expected experience and success criterion`

The first line must be `# Specification: <title>`. Keep the twelve headings unchanged and ordered; use `###` or deeper headings for detail inside them. Do not add another top-level `##` section. This heading structure is part of the specification-to-task interface, not a suggested presentation format.

Use stable, unique identifiers whenever the corresponding concept applies:

- `CAP-001`, `CAP-002`, ... for capability contracts in section 5;
- `J-01`, `J-02`, ... for journey steps or independently meaningful journey branches in section 4;
- `STATE-01`, `STATE-02`, ... for user-visible states in section 6;
- `INT-001`, `INT-002`, ... for cross-experience hand-offs in section 7;
- `REC-001`, `REC-002`, ... for distinct failure and recovery paths in section 10.

Start each identifier family at its documented prefix and number it sequentially. Never reuse an identifier for a different behavior, and retain identifiers for unchanged behavior when revising a specification. If a category does not apply, state `Not applicable` and explain why instead of inventing an identifier.

The twelve sections must establish the following contract:

- **Overview** records product intent, problem, expected outcome, work type, and any current-versus-desired or compatibility boundary that applies.
- **Actors and authority** identifies every important actor and who may provide, approve, correct, publish, revise, or merely observe each important piece of information.
- **Scope and non-goals** separates in-scope behavior, non-goals, explicitly deferred behavior with its boundary/reason/next step, and unknown items requiring a decision. Material unknowns must be clarified before finalization.
- **End-to-end journey** uses `J-*` identifiers to show the main successful journey and meaningful incomplete, failure, correction, or revision branches from actor trigger to visible outcome.
- **Capability contracts** uses `CAP-*` identifiers. Each capability states its observable trigger, actor-visible outcome, boundary, required or optional status, and relevant validation or failure handling. Split independently verifiable outcomes instead of hiding them in umbrella capabilities.
- **State model and transitions** uses `STATE-*` identifiers for states the actor can observe or act within, and names the trigger and visible result for every material transition.
- **Cross-experience interactions** uses `INT-*` identifiers for hand-offs between actors or experience areas, including the information or decision transferred and the visible acknowledgement. If none apply, say why.
- **Information, truth, and uncertainty** distinguishes owner-provided, verified, detected, estimated, inferred, generated, simulated, and unknown information, including which source has authority when they conflict.
- **Validation, review, finalization, and revision** describes input validation, review and correction, explicit finalization or publication, later updates, version boundaries, and what remains unchanged while a revision is prepared.
- **Failure and recovery** uses `REC-*` identifiers for meaningful failure paths, including the cause, explanation, preserved progress, user choice, retry/correction path, and unrecoverable outcome when applicable.
- **Edge cases and quality expectations** records relevant permission, privacy, safety, integrity, accessibility, device, performance, offline, interruption, and unsupported-condition behavior as observable outcomes.
- **Final expected experience and success criterion** states the resulting experience for each important actor and the clear actor-visible condition that defines product success.

Downstream task planning consumes the specification as written; it must not be expected to rename headings, infer missing identifiers, redistribute content, or repair ambiguity.

The specification should describe:

- the product intent
- the main problem being solved
- the expected outcome
- the primary actors
- the complete user journey from start to finish
- what users should be able to do
- what the system should do in response
- how the system should behave during normal flows
- how the system should behave when information is incomplete
- how the system should behave when something fails
- how users recover from failures or incomplete progress
- important application states visible to the user
- important transitions between those states
- interactions between different parts of the experience
- validation behavior
- review and correction behavior
- publishing or finalization behavior when applicable
- update and revision behavior after something has already been created or published
- differences between factual, estimated, inferred, generated, simulated, or unknown information when relevant
- privacy, safety, integrity, or trust-related behavior when relevant
- desktop, mobile, degraded-performance, offline, slow-network, or interrupted-session behavior when relevant
- optional capabilities without making them mandatory for the core experience
- the main successful end-to-end scenario
- the main failure and recovery scenarios
- the behavioral principles that should remain true across the entire product
- the final experience the product should create for each important actor
- a clear final definition of what success means for the product

When the idea includes AI, automation, reconstruction, generation, inference, or intelligent assistance, describe the expected observable behavior of those capabilities without prescribing how they must technically be implemented.

For AI-assisted behavior, specify:

- what context the AI should understand
- what actions the AI may perform
- when the AI should act versus only answer
- how uncertainty should be communicated
- how incorrect AI-generated information can be reviewed or corrected
- how generated or simulated information must remain distinguishable from factual information
- what the AI must not invent when source information is unavailable

When the product involves creation, capture, upload, processing, transformation, analysis, or generation, describe the full lifecycle, including:

input
→ validation
→ feedback
→ processing
→ intermediate state
→ completion
→ review
→ correction
→ finalization
→ later update

Do not limit the specification to happy paths. Include meaningful recovery behavior for partial success, invalid input, interrupted progress, missing information, processing failures, conflicting information, and unsupported conditions.

Reconcile the full conversation before writing.

Inventory every product decision already established in the conversation, including agreed scope, constraints, compatibility boundaries, deferred items, and explicitly rejected alternatives. If the workspace contains discussion transcripts, decision logs, or other product sources referenced by the conversation, reconcile them as well. Resolve contradictions before writing; do not let the specification reflect only the initial idea while later decisions remain only in chat. If a material decision is missing, contradictory, or unclear, pause and clarify rather than guessing.

Frame the work type without prescribing implementation.

Identify whether the request is new behavior, an enhancement or change to existing behavior, a defect fix, a porting or parity or migration effort, or another development task. For changes to existing behavior, capture current versus desired behavior and what must remain unchanged. For porting or parity work, capture the oracle or compatibility scope, what must remain compatible, and what is explicitly deferred or excluded. For defects, capture the observable failure, the expected behavior, and which unrelated behavior must be preserved. Keep this framing behavioral; do not turn it into architecture, phases, or tasks.

Make scope decisions explicit.

Distinguish in-scope behavior, non-goals, explicitly deferred behavior, and unknown items needing a decision. Deferred behavior is neither in-scope nor a non-goal: record its boundary, the reason for deferral, and what happens next. Unknown items must not be silently treated as in-scope or out-of-scope. Non-goals never become capabilities.

Write each capability as a verifiable contract.

Give every capability an observable trigger, an actor-visible outcome, a clear boundary, and relevant failure handling. Do not write umbrella capabilities that hide several independently verifiable outcomes behind one heading. Avoid untestable adjectives such as fast, seamless, robust, full, efficient, or gracefully unless the same sentence or capability states the observable test that decides pass or fail.

Use concrete examples of user-facing states, messages, flows, and interactions when they make the intended behavior easier to understand.

Prefer behavioral statements such as:

- "The user should be able to..."
- "The system should..."
- "When X happens, the system should..."
- "If the system cannot determine X confidently, it should..."
- "The user should remain able to..."
- "The system must distinguish between..."

Avoid implementation-oriented requirements such as:

- programming languages
- frameworks
- databases
- cloud providers
- infrastructure topology
- package structure
- source-code architecture
- API schemas
- internal interfaces
- specific algorithms
- specific models
- specific libraries
- deployment strategy

Do not prescribe technical decisions unless the product idea explicitly requires a particular technology as part of the actual user-facing product.

Do not create an implementation roadmap.

Do not divide the specification into implementation phases.

Do not provide task breakdowns, milestones, sprints, coding instructions, package structures, or engineering execution plans.

Do not prematurely convert product behaviors into technical architecture.

Keep technical decisions intentionally open so downstream developers and AI agents can determine the appropriate implementation based on the codebase, constraints, available technology, and future planning.

The specification should be sufficiently detailed that another user, developer, architect, planner, or AI agent who has never seen the original conversation can understand:

1. what product should exist,
2. who uses it,
3. how it behaves end to end,
4. what users experience in normal and failure conditions,
5. which behaviors are mandatory,
6. which capabilities are optional,
7. what information is authoritative,
8. how users remain in control,
9. and what successful completion looks like.

Organize the specification with clear headings and logical sections.

Use concise diagrams, state flows, or example interactions when they materially improve understanding.

Do not add unrelated features, speculative requirements, or unnecessary complexity beyond the product idea already established in the conversation.

Preserve the original product intent exactly while making implicit behavioral requirements explicit.

Run a specification self-check before finalizing.

Confirm every inventoried conversation decision appears in the specification or is explicitly recorded as deferred, non-goal, or unknown; the first line is `# Specification: <title>`; all twelve canonical sections are present in the required order with no extra top-level sections; identifier families are unique, sequential, and stable; every capability is falsifiable from actor-visible behavior; every journey step, state, interaction, and recovery path has corresponding capability detail; no deferred or unknown item was silently dropped; no diagram introduces behavior absent from the prose; and no implementation prescription slipped in beyond an explicitly required product technology.

The resulting document should function as a durable upstream behavioral specification that downstream agents can later use to derive architecture, plans, technical specifications, tests, and implementation decisions. It must be usable for task planning without normalization or a second interpretation pass.

## References

The main `SKILL.md` owns the interface, workflow, quality gate, and default output behavior. Read these bundled companions before producing a specification:

- [Mermaid Diagrams](./references/MERMAID-DIAGRAMS.md) — required diagram types, focused modeling rules, compatible syntax, labels, and diagram validation.

## Examples

- [Property Exploration](./examples/property-exploration.md) - example of what the specification output structure should look like.
