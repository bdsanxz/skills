---
name: solidjs-knowledges
description: Port React code to idiomatic SolidJS, or write and review SolidJS code, using React-to-Solid equivalents taken from the official Solid docs, so React habits (re-running components, dependency arrays, destructured props, .map with key, className) do not become Solid bugs. Use when the user asks to convert, migrate or port React components or hooks to Solid, to write or fix Solid code, to explain the Solid equivalent of a React API, or names solidjs-knowledges. Do not use for Solid projects on a major version other than 1 without first checking that version's docs.
---

# React to SolidJS

Solid looks like React but runs differently: a component runs once, and only signals read inside tracking scopes update the DOM. Every step below exists to stop a React habit from slipping into Solid code.

## Set up

1. Identify the target Solid version from `package.json` (`solid-js`). The mappings in this skill are for Solid 1.x. If the major version is not 1, stop and check each API you use against that version's docs at https://docs.solidjs.com before writing code, and tell the user which mappings you verified.
2. Identify the project's toolchain: TypeScript or JavaScript, the build tool (usually Vite with `vite-plugin-solid`), the lint setup, and the type-check, lint and build commands. Run them once as a baseline; record which already fail.
3. If the source is React code, list what it uses: hooks, context, refs, lists, conditionals, event handlers, data fetching, lazy loading, portals, and third-party React libraries. A React-only library has no automatic equivalent: ask the user for the Solid replacement or flag it.

## Load the mental model

4. Read `references/mental-model.md` in full before writing any Solid code. It explains the points behind almost every bug: components run once, values must be read through getters inside tracking scopes, effects are only for side effects, and JSX produces real DOM.
5. Keep one rule active through every later step: **never turn a getter into a plain value at setup time** (top-level reads, destructured props or stores, early returns, components picked into a variable).

## Map each concept

6. For each React concept found in step 3, or each concept the new code needs, look up its entry in `references/concept-map.md`. Use the quick table to find it, then follow the full entry: the correct Solid form, and the mistake to avoid.
7. Translate by meaning, not by syntax. Prefer the idiomatic Solid form over a literal port:
   - Derived state becomes a derived function or `createMemo`, not an effect that sets a signal.
   - Fetching becomes `createResource` with `<Suspense>` and `<ErrorBoundary>`.
   - Nested or frequently updated state becomes a store.
   - `useCallback`, `React.memo` and dependency arrays are dropped.
8. When a concept is not in the map, look it up in the official docs (https://docs.solidjs.com, source at https://github.com/solidjs/solid-docs) and base the code on what they say. Never invent a Solid API or carry over a React API name on the assumption that it exists.

## Write the code

9. Write each component as setup code followed by returned JSX: create signals, stores, memos, resources, effects and cleanups first, then return the JSX that reads them.
10. Port bottom up: shared state, context and utilities first, then leaf components, then their parents. Keep the source's file structure and names unless the user asks otherwise.
11. Follow the project's existing Solid conventions where they exist (file layout, store versus signal usage, styling approach).

## Review and verify

12. Check every file you wrote or changed against `references/review-checklist.md`. Fix each item that fails; do not skip an item because the code "looks right".
13. Run the type check, lint and build from step 2. They must pass, with no new failures compared with the baseline.
14. When the project has a way to run the app or its tests, exercise each ported feature that has state changes (typing, toggling, adding and removing list items, loading data) and confirm the DOM updates. A component that renders correctly once but never updates is the typical failure of a React-habit bug.
15. Report: each component or module ported, every React-only library and how it was replaced or flagged, every place where behavior intentionally differs from the React version, and the exact commands run with their output.
