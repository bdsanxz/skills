# gpui-shell review checklist

Run every check against each script you wrote or changed. Each item names the React habit, how to spot it, and the fix. The section numbers point to `concept-map.md`.

## React and browser leftovers

- [ ] No import from `react`, `react-dom`, a React library, or an npm package that touches the DOM. Search: `from "react`.
- [ ] No JSX, no `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`/`useReducer`/`useContext`/`createContext`/`forwardRef`/`React.memo`/`createPortal`. Search for each name. (§2, §27)
- [ ] No `document`, `window.addEventListener`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `require(`, `node:` imports. (§12, §26)
- [ ] Imports come only from the modules declared in `gpui-kit.d.ts` (`"gpui-kit"` and its alias `"gpui"`, `"gpui-base"`, `"gpui-component"`, `"gpui-fps"`, the standard modules such as `path`, `fs/promises`, `websocket`), relative files, and dependencies declared in `gpui-shell.json`.

## Views and state

- [ ] `main.js` default-exports a class extending `View`. (§2)
- [ ] State is assigned in `init`, not declared as class fields. (§2)
- [ ] No state field shares its name with a method of the same class. (§2)
- [ ] Every handler or task that changes displayed state calls `cx.notify()` afterwards; nothing calls it inside `render`. (§4)
- [ ] `notify` is conditioned on changes the View actually displays (feeds, subscriptions). (§4)
- [ ] No module-top-level or `constructor` work that needs `cx`; it starts in `init`. (§9)
- [ ] Parts that change independently and often are nested Views (`cx.new` in `init` or a handler, never in `render`); new props go through `set_props`, not re-creation. (§6, §7)
- [ ] Shared state read by a nested View is followed by `cx.notify(entity)` or `set_props`; nothing assumes a context-like re-render. (§7, §15)

## `cx` lifetime and phases

- [ ] No `cx` captured from one call and used in another: not after an `await` in an event handler, not inside a dialog, not inside a timer callback. Async work uses `cx.spawn(async (cx) => ...)` and its own `cx`. (§13, §22)
- [ ] `render` (and virtual-list item renderers) only read state and build elements: no `notify`, no overlays, no `InputState.new`, `cx.focus_handle()`, `cx.new`, timers or side effects. (§10, §17)
- [ ] No overlay is opened from `init`. (§9, §22)

## Elements

- [ ] No element stored on `this` or in module scope; no element used twice. Repeated UI is a function returning a new element. (§2, §8)
- [ ] `render` returns exactly one element, `Entity` or string (no array, `null`, `undefined`). (§3)
- [ ] Elements are built with `div()`, `h_flex()`, `v_flex()` and `Type.new(...)`, never `new Type(...)`. (§2)
- [ ] Every `.when(cond, branch)` branch returns the element; no `.child(cond && el)` (it renders the text "false"). (§16)
- [ ] Interactive controls in lists have stable unique ids (`` `item-${item.id}` ``), never array indexes; plain elements with state styles, scroll or motion have `.id(...)`. (§17, §20, §21, §24)

## Events and inputs

- [ ] Handlers are arrow functions; none use `function () {}` or `(event, window, cx)`. A handler that needs the event or `cx` takes `(event, cx)`; one that needs neither may take no parameters, such as `() => window.close_dialog()`. (§18)
- [ ] Host methods are `snake_case` (`on_click`, `on_change`, `text_color`), never camelCase. (§3, §18)
- [ ] `Checkbox`/`Switch`/`Radio`/`Toggle` are controlled: `.checked(value)` from state, `on_change((checked, cx) => ...)` stores the value and notifies; the indicator is drawn as a child. (§19)
- [ ] When the app uses `gpui-component`'s `Checkbox`, `icons/check.svg` exists under the application root: on 0.9.0 the control loads that asset, and `dev` logs `asset icons/check.svg was not found` without it. Asset paths in `svg()` and `image()` resolve against the application root, not the importing file. (§19)
- [ ] Text fields use an `InputState` (or `TextareaState`) created in `init`, read with `.value()`, subscribed with `.on("change" | "submit", ...)`; the state and `Input` come from the same module. (§19)
- [ ] Key and pointer handlers sit on `div`/`h_flex`/`v_flex` or a wired control, with a `FocusHandle` (`track_focus`) when keys are expected. (§18)

## Styling

- [ ] No `className`, `style={{...}}`, CSS or Tailwind strings. (§20)
- [ ] Colours come from `cx.theme().colors.<token>`, read at the use site; hex literals only for colours that must not follow the theme. In a port of a brand design with fixed colours, every design colour is such a colour: hex literals from the design are correct there, and the report says so. (§20)
- [ ] Length arguments respect the method's type: no `p("auto")`, no percentage `rounded`; `line_height` numbers are multipliers. (§20)
- [ ] Disabled/selected/checked appearance is drawn explicitly (`.when(disabled, el => el.opacity(0.4))`). (§20)
- [ ] Scroll containers have a bounded size and an `.id(...)`. (§21)
- [ ] Animated lengths are numeric pixels on an element with `.id(...)`. (§24)
- [ ] No CSS colour names (`"transparent"`, `"white"`); colours are tokens or `#rgb`/`#rrggbb`/`#rrggbbaa`. (§20)
- [ ] Every `font_family` value resolves to an installed font on the target machine; a missing family falls back silently and `check` cannot see it. Each font the user must install is reported. (§20)
- [ ] Every icon-font name exists in that font's glyph list. (§20)

## Ported from a Tailwind mockup

- [ ] Custom classes were read from the mockup's `tailwind.config`, not guessed. (§28)
- [ ] Every column or panel inside an `h_flex()` row that must fill the row's height has `h_full()`, or the row sets `items_start()`/`items_stretch()`. (§28)
- [ ] Every `text_size` from a Tailwind `text-*` class has its line height as `line_height("Npx")`. (§28)
- [ ] Fixed bands (headers, sidebars, footers) inside a scroll container or a crowded row have `flex_shrink_0()`. (§28)
- [ ] `gpui-shell.json` sets `"window"` to the design's size. (§28)

## Capabilities and async

- [ ] Every `fetch`, WebSocket, `fs`, clipboard and `process` use has the narrowest matching grant in `gpui-shell.json`; URLs are absolute. (§13)
- [ ] `localStorage` access is wrapped so a refusal degrades instead of crashing. (§25)
- [ ] Long-lived timers and tasks are kept as `Task` handles and cancelled when no longer needed; retained handles are released when their owner is discarded. (§11)

## Overlays

- [ ] `window.open_dialog` / `open_sheet` receive a function returning an element, not an element or View class; options are `snake_case`. (§22)
- [ ] Dialog content closes over data and callbacks, and takes `cx` from its own handler arguments. (§22)

## Verification

- [ ] Every nested View class passed `gpui-shell check` as the root of a temporary copy of the app; the app-level `check` alone does not render nested Views.
