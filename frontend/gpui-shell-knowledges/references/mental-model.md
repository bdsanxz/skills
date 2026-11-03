# The gpui-shell mental model, against React habits

Most gpui-shell bugs written by React-trained agents come from one wrong assumption: that the UI is a function of state that the framework re-runs for you. In gpui-shell nothing re-runs on its own, nothing is a DOM node, and an element cannot be kept. Read this file before writing any gpui-shell code.

Facts are taken from the official gpui-shell docs (https://gpui-kit.com/shell, checked 2026-11-03, `gpui-shell` 0.9.0; the script API is marked experimental, milestone M0). Paths in "Source" lines are relative to `https://gpui-kit.com/shell`. Every page is also served as Markdown at the same path plus `.md`.

## 1. There is no DOM, no JSX, no browser

| React | gpui-shell |
| --- | --- |
| JSX compiles to `React.createElement`, rendered into the DOM. | No JSX, no HTML, no CSS, no DOM, no WebView, no Node.js. JavaScript runs in QuickJS inside a Rust GPUI process. |
| `<div className="...">` | `div()` / `h_flex()` / `v_flex()` with chained `snake_case` style methods. |
| Components from React libraries. | Elements from `"gpui-kit"`, unstyled components from `"gpui-base"`, styled ones from `"gpui-component"` when the binary ships that catalog. |
| `document`, `window` (browser), `setTimeout`, `require`. | No `document`. `window` is gpui-shell's overlay and window host, not a browser `Window`. `setTimeout`/`setInterval` are throwing stubs. ES modules only. |

Source: `/` (intro), `/state` (Timers and standard host APIs), `/getting-started` (The script it loads).

## 2. A View is a class with `init` and `render`

| React | gpui-shell |
| --- | --- |
| A function component, called on every render. | `class X extends View`. `init(props, cx)` runs **once** when the View is created; `render(cx)` runs when the View is **invalidated**. |
| Hooks keep state between calls. | State is plain fields on `this`, set up in `init`. There are no hooks. |
| Any component can be the root. | `main.js` must `export default` a View class; the host builds one instance and mounts it as the window's root View. |
| Return JSX, a fragment, an array or `null`. | `render` returns exactly **one** element, retained `Entity` or string. Anything else throws `render(cx) must return an element, an Entity, or a string`. |

Two kinds of things, two construction shapes: Views (which have identity and survive frames) use `class ... extends View`; elements (which do not) use `Type.new(id)` or a lowercase function, never `new Type()`.

Source: `/state` (Defining a View), `/elements` (Why `.new(id)` and not `new Button(id)`).

## 3. Nothing updates until you call `cx.notify()`

There are no signals, no observables, no `useState`, no dependency arrays and no automatic tracking. The cycle is:

```text
event handler / task:  mutate this.fields  ──▶  cx.notify()  ──▶  render() runs later
```

- A forgotten `cx.notify()` has one symptom: the screen does not change (or changes late, when something else invalidates the View). The frame rate stays healthy, so FPS is no evidence that invalidation is correct.
- Several `notify` calls before the next frame collapse into one `render`.
- `cx.notify()` inside `render` throws: notifying yourself while rendering is a loop.
- `cx.notify()` means "my description is out of date", not "something happened". Notify only when something the View displays changed.

Source: `/state` (`cx.notify()`), `/performance` (Notify what a reader can see).

## 4. `render` describes; it does not run per frame

`render` records a description (a Snapshot) that GPUI replays for every later frame until something invalidates it: `cx.notify()`, a hot reload, a theme change, or the host calling `refresh`. Hover, focus and active styles, scrolling, cursor blinking and native motion run **no** JavaScript.

Consequences:

- `render` must be pure: read state, build elements, register handlers. It may not notify, open overlays, or create retained state (inputs, focus handles, nested Views).
- Colours read from `cx.theme()` are baked into the Snapshot; a theme change rebuilds every View.
- A `render` that throws keeps the previous Snapshot and its handlers on screen, with an error banner over it.

Source: `/state` (When `render` runs, Scope phases), `/styling` (State styles).

## 5. Elements are single-use descriptions

An element is an index into a per-render arena, consumed when it is used as a child. Using one twice, or using one from an earlier render, throws:

```text
element `h_flex` was already added to a parent; elements are single-use values
this element belongs to a previous render pass; elements are single-use values
and must be rebuilt each time render runs
```

- Never store an element on `this` or in module scope.
- Factor repetition into **functions that return a new element each call** (the docs' `ui.js` pattern). That is the gpui-shell "component library" for presentational pieces.

Source: `/elements` (Elements are single-use, The shape that works).

## 6. `cx` belongs to the call that received it

| Kind | Received by | Lifetime |
| --- | --- | --- |
| `Context` | `render(cx)`, every event handler's second argument | That one call. Keeping it past the call, including across an `await`, throws `cx is no longer valid`. |
| `AsyncContext` | `init(props, cx)`, the body of `cx.spawn`, `cx.timer` callbacks | Survives `await`; resolves whatever call is running when used. |

- `cx` is never a global and never imported; it only arrives as an argument. Module top level and a bare `constructor` get none, so start work in `init`.
- In a dialog, a timer or a later event, take `cx` from that callback's own arguments; never close over an earlier one.

Source: `/state` (Two kinds of `cx`), `/overlays` (Do not carry `cx` into the dialog).

## 7. Scope phases decide what a call may do

| Phase | When | May | May not |
| --- | --- | --- | --- |
| `render` | building the description | read state, build elements, register callbacks | `notify`, open/close overlays, create retained state |
| `event` | handling a click or change | everything | block |
| `task` | resuming async work | everything | block |
| `layout` | a virtual-list item renderer inside GPUI layout | read state, build elements | `notify`, open overlays, create retained state |

Window measurements (`window.viewport_size()`, `rem_size()`, `has_active_dialog()`) are legal from `render`; everything that changes the window is not.

Source: `/state` (Scope phases), `/overlays` (The `ScopePhase` rule).

## 8. Retained state lives in handles, created outside `render`

Plain data lives in View fields. Anything with its own cross-frame machinery — a text field's text, cursor and undo history (`InputState`, `TextareaState`), a focus target (`cx.focus_handle()`), a slider, a calendar, a nested View (`cx.new`) — is a GPUI entity the script holds a **handle** to.

- Create every handle in `init` or an event handler, never in `render` (it throws).
- A handle's `on(...)` subscription outlives renders; a rendered `on_click` belongs to the render that registered it and is replaced by the next one.
- `release()` drops a handle; using a released handle throws.

Source: `/state` (Retained state, Input events), `/elements` (Callbacks belong to their render), `/api` (Retained handles).

## 9. The View is the unit of re-rendering

A View is rebuilt whole: any change to it re-describes all of it. There is no partial rebuild and no `memo` (`gpui.memo` is listed as not there yet).

- Split a part that changes on its own into a nested View: `this.chart = cx.new(Chart, props)` in `init`, then `.child(this.chart)` in `render`.
- A parent's `notify` does not re-run its children; a child's `notify` does not travel up; `entity.set_props(next)` runs that child's `update(props)` and `render` only.
- `cx.notify(entity)` invalidates one nested View after shared state it reads changed, without calling its `update`.

This replaces both `React.memo` and the "lift state, re-render subtree" model.

Source: `/performance` (Every View has its own Snapshot, Split a large View into small ones).

## 10. The foundation draws nothing for you

`gpui-base` controls carry no visual style: `Button.new("save")` with no styling draws only its children. Disabled, selected and checked **appearance** is yours; the control only reports the state. Controlled controls (`Checkbox`, `Switch`, `Radio`, `Toggle`) never change their own value: `on_change` is a request, and the script stores the value.

Source: `/` (Presentation belongs to the script), `/elements` (Behavior methods, Controlled values report intent).

## 11. Handlers are arrow functions taking `(event, cx)`

- A `function () {}` handler gets the wrong `this`; the docs call this the single most common mistake. Use arrow functions so `this` stays the View.
- The signature is `(event, cx)`. Copying Rust's `|event, window, cx|` binds `window` to the context and leaves `cx` undefined.

Source: `/elements` (Actions and key bindings tip), `/overlays` (Do not copy Rust's `|event, window, cx|`).
