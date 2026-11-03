---
name: gpui-shell-knowledges
description: Port React code to idiomatic gpui-shell JavaScript (Views rendered natively by GPUI), or write and review gpui-shell scripts, using React-to-gpui-shell equivalents taken from the official docs at gpui-kit.com/shell, so React habits (JSX, hooks, automatic re-rendering, stored elements, cx kept across await, className) do not become gpui-shell bugs. Use when the user asks to convert, migrate or port React components to gpui-shell, to write or fix a gpui-shell app or plugin script, to explain the gpui-shell equivalent of a React API, or names gpui-shell-knowledges. Do not use for Rust GPUI or gpui-component code written in Rust.
---

# gpui-shell knowledges

Port React code or an HTML mockup to gpui-shell, or write and review gpui-shell scripts. gpui-shell runs JavaScript Views inside a Rust GPUI process: no DOM, no JSX, no hooks, and nothing re-renders until the script calls `cx.notify()`. Every step below exists to stop a React habit from slipping into gpui-shell code.

## Set up

1. Identify the target version: `gpui-shell --version`, and `shell-version` in the application's `gpui-shell.json`. The mappings in this skill were checked against gpui-shell 0.9.0, whose script API is marked experimental. If the target differs, check each API you use against that version's docs (`https://gpui-kit.com/versions/<version>/shell`) before writing code, and tell the user which mappings you verified.
2. Run `gpui-shell types -d <app>` to write `gpui-kit.d.ts`, and put `// @ts-check` at the top of each script. The generated declarations are the authority over every reference in this skill: when they disagree, follow them and tell the user. The file is long, so look names up instead of reading it: `grep -nE '^\s*(export function )?(<names>)[<(]' gpui-kit.d.ts` finds a method or function declaration (such as `border_l`, `push_toast` or `image`), and `grep -nE '^\s*(<options>)\??:' gpui-kit.d.ts` finds an option's accepted values (such as `level` in toast options). Replace `<names>` or `<options>` with one name, or several joined by `|` (such as `border_l|pl|push_toast`).
3. Run `gpui-shell check -d <app>` once as the baseline and record whether it already fails. For a new application, create it with `gpui-shell new <dir>` first.
4. If the source is static HTML (for example a Tailwind mockup), first note its `tailwind.config` (colours, font sizes, families, spacing) and its font links, then strip `<script>` and `<style>` and list each screen's regions, visible text, images (`src` and `alt`) and interactive elements. Treat its classes as styling to translate (§28 of the concept map, which lists the Tailwind defaults gpui-shell does not share) and its interactive elements as state to design.
5. If the source is React code, list what it uses: components, state, effects, context, refs, lists, conditionals, events, form inputs, data fetching, timers, portals, styling approach, routing, and third-party React libraries. A React or DOM library has no automatic equivalent: ask the user for the replacement or flag it.

## Load the mental model

6. Read `references/mental-model.md` in full before writing any gpui-shell code. It explains the points behind almost every bug: Views with `init`/`render`, explicit `cx.notify()`, `render` as a cached description, single-use elements, call-scoped `cx`, scope phases, retained handles, and the View as the unit of re-rendering.
7. Keep two rules active through every later step: **change state, then `cx.notify()` from an event or task, never from `render`**, and **build every element fresh inside the render that uses it**.

## Map each concept

8. For each concept found in steps 4 and 5, or each concept the new code needs, look it up in `references/concept-map.md`. Use the quick table to find it, then follow the full entry: the correct gpui-shell form, and the mistake to avoid.
9. Translate by meaning, not by syntax:
   - A stateful component becomes a View class; a presentational one becomes a function returning a new element.
   - Derived state is computed in `render` or a method, not cached by an "effect".
   - A part of the UI that changes on its own and often becomes a nested View (`cx.new`), which replaces `React.memo`.
   - Effects with dependencies become explicit calls where the state changes, or `update(props)`.
   - Fetching becomes `cx.spawn` plus a manifest grant.
10. When a concept is not in the map, look it up in the official docs (https://gpui-kit.com/shell; append `.md` to any page path for Markdown) and in `gpui-kit.d.ts`. If neither documents an equivalent, say so to the user and use the nearest documented pattern. Never invent a gpui-shell API, and never carry over a React or DOM name on the assumption that it exists.

## Write the code

11. Plan the View boundaries first: the root View in `main.js`, a nested View for each part with independent, frequently changing state, and helper functions for everything presentational.
12. Write each View as `init` (fields, retained handles, nested Views, timers, initial tasks) followed by `render` (read state, return one element). Put state-changing methods on the View; each takes the `cx` of the call that invoked it and ends with `cx.notify()`.
13. Port bottom up: shared helpers and styling functions first (the docs' `ui.js` pattern), then leaf Views, then their parents. Keep the source's names unless the user asks otherwise.
14. Add the narrowest capability grants the code needs to `gpui-shell.json` (network hosts and paths, `fs` roots, clipboard, process).
15. Follow the application's existing conventions where they exist (module layout, `gpui-base` versus `gpui-component`, theme usage). In a new application, use `gpui-component`'s styled controls, unless the UI is a port of a brand design whose look must match exactly: then hand-style `gpui-base` controls with the design's own values.
16. When you write a long file in several chunks, read its end back before running `check`: a dropped closing `}` of the class surfaces only as a `SyntaxError` far from the cause.

## Review and verify

17. Check every file you wrote or changed against `references/review-checklist.md`. Fix each item that fails; do not skip an item because the code "looks right".
18. Run `gpui-shell check -d <app>`. It must exit 0, with no new failure compared with the baseline. It does not run nested View renders, later interactions or async states, so it is necessary but not sufficient: a green `check` can hide a crash (such as `ReferenceError`) in every View mounted with `cx.new`.
19. Render-check each nested View as a root: copy the application to a temporary directory, replace the copy's `main.js` with `import V from "./<path>/<view>.js"; export default V;`, and run `gpui-shell check -d <copy>`. If the View's `init` reads props, export a subclass that passes sample props instead: `import V from "./<path>/<view>.js"; export default class Root extends V { init(_props, cx) { super.init({ /* sample props */ }, cx); } }`. Repeat for each nested View class; each must pass. Delete the copy afterwards.
20. Run `gpui-shell dev -d <app>` and exercise each ported feature that changes state (typing, toggling, adding and removing list items, opening dialogs, loading data); watch the terminal for script errors and asset warnings (`asset ... was not found`), and confirm the window updates. A View that renders once but never updates is the typical React-habit bug (a missing `cx.notify()`). When the UI comes from a design, set `"window"` in `gpui-shell.json` to the design's size and compare the window with the design. If you cannot open a window, say that this step was not done. If you can open the window but cannot drive input, verify the first render with a screenshot, then list every state-changing feature you could not exercise in the report as not exercised, and ask the user to try them.
21. Report: each component or module ported and the View boundaries chosen, every React-only library and how it was replaced or flagged, every concept with no documented equivalent and what was done instead, every capability added, and the exact commands run with their output, including which nested Views were render-checked as roots.
