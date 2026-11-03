# React to gpui-shell concept map

One entry per React concept: the React version, the correct gpui-shell version, and the mistake an agent with React habits makes. Every gpui-shell fact comes from the official docs (https://gpui-kit.com/shell, checked 2026-11-03) or from the instructions the `gpui-shell` 0.9.0 binary prints with `gpui-shell agents`. "Source" paths are relative to `https://gpui-kit.com/shell`. When a React concept has no documented equivalent, the entry says so; do not invent one.

Imports used below: `View`, `div`, `svg`, `list`, `uniform_list` from `"gpui-kit"`; `h_flex`, `v_flex`, `Button`, `Checkbox`, `Input`, `InputState`, `v_virtual_list`, `Scrollbar` from `"gpui-base"`.

Contents

1. [Quick table](#1-quick-table)
2. [Components](#2-components)
3. [JSX and text](#3-jsx-and-text)
4. [State: `useState`](#4-state-usestate)
5. [Reducers and update logic](#5-reducers-and-update-logic)
6. [Derived values, `useMemo`, `useCallback`, `React.memo`](#6-derived-values-usememo-usecallback-reactmemo)
7. [Props](#7-props)
8. [Children and composition](#8-children-and-composition)
9. [Mount effects](#9-mount-effects)
10. [Effects that react to changes](#10-effects-that-react-to-changes)
11. [Cleanup and unmount](#11-cleanup-and-unmount)
12. [Timers](#12-timers)
13. [Data fetching](#13-data-fetching)
14. [Refs](#14-refs)
15. [Context and global state](#15-context-and-global-state)
16. [Conditional rendering](#16-conditional-rendering)
17. [Lists and keys](#17-lists-and-keys)
18. [Events](#18-events)
19. [Form inputs](#19-form-inputs)
20. [Styling](#20-styling)
21. [Scrolling](#21-scrolling)
22. [Portals, modals, toasts](#22-portals-modals-toasts)
23. [Error boundaries](#23-error-boundaries)
24. [Animation](#24-animation)
25. [Persistence: `localStorage`](#25-persistence-localstorage)
26. [Keyboard shortcuts](#26-keyboard-shortcuts)
27. [No documented equivalent](#27-no-documented-equivalent)
28. [Translating a Tailwind mockup](#28-translating-a-tailwind-mockup)

## 1. Quick table

| React | gpui-shell |
| --- | --- |
| function component with state | `class X extends View` with `init` + `render` |
| presentational component | a function returning a new element each call |
| JSX `<div>` | `div()`, `h_flex()` (row, children centred vertically), `v_flex()` (column) |
| `<Button>` from a library | `Button.new("id")` (unstyled, `gpui-base`) or `gpui-component`'s `Button.new(...)` |
| `{text}` | a string passed to `.child(...)` |
| `useState` | field set in `init`, mutated in a handler, then `cx.notify()` |
| `useReducer` | methods on the View that mutate fields and `notify` |
| `useMemo` / derived state | compute in `render` or a method; split hot parts into nested Views |
| `useCallback`, `React.memo` | nothing; a nested View is the re-render boundary |
| props | `init(props, cx)`; parent changes them with `entity.set_props(p)` → `update(props)` |
| `<Child />` with state | `this.child = cx.new(Child, props)` in `init`, `.child(this.child)` in `render` |
| `useEffect(fn, [])` | code in `init` (its `cx` survives `await`) |
| `useEffect(fn, [dep])` | do the work where `dep` changes (the handler), or in `update(props)` |
| effect cleanup | `task.cancel()`, `handle.release()`; no unmount hook is documented |
| `setTimeout` / `setInterval` | `cx.timer.after` / `cx.timer.every`, `cancel()` on the returned `Task` |
| fetch in an effect | `cx.spawn(async (cx) => { await fetch(...); ...; cx.notify(); })` + manifest grant |
| `useRef` (DOM) | `cx.focus_handle()` + `.track_focus(h)` for focus; no DOM nodes exist |
| `useRef` (mutable box) | a plain field on `this`, no `notify` |
| `createContext` / `useContext` | no equivalent; module scope or props; theme via `cx.theme()` |
| `cond && <A/>` | `.when(cond, (el) => el.child(...))`; never `.child(cond && el)` (renders "false") |
| ternary | ternary inside `.child(...)` |
| `items.map(i => <Row key>)` | `.children(items.map((i) => this.row(i)))` with a stable id per control |
| long list / windowing | `v_virtual_list`, `list`, `uniform_list` |
| `onClick` | `.on_click((event, cx) => ...)` on `Button` |
| controlled `<input value onChange>` | `InputState` in `init` + `Input.new(state)` + `state.on("change", ...)` |
| `<input type="checkbox">` | `Checkbox.new(id).checked(v).on_change((checked, cx) => ...)` |
| `className`, CSS, Tailwind | chained `snake_case` style methods |
| `:hover`, `:active`, `:focus` | `.hover(s => ...)`, `.active(...)`, `.focus(...)` |
| `createPortal` / modal | `window.open_dialog(() => element, options)` from an event |
| toast library | `window.push_toast({ title, level })` |
| error boundary | none; a failed `render` keeps the previous UI and shows a banner |
| CSS transition | `.transition(prop, policy)` / `.spring(prop, policy)` |
| `localStorage` | `localStorage` (gated; wrap in `try`) |

## 2. Components

React:

```tsx
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

gpui-shell:

```js
import { View } from "gpui-kit";
import { Button } from "gpui-base";

export default class Counter extends View {
  init() {
    this.count = 0;
  }

  render(cx) {
    return Button.new("increment")
      .px(12)
      .h(28)
      .bg(cx.theme().colors.primary)
      .text_color(cx.theme().colors.primary_foreground)
      .on_click((_event, cx) => {
        this.count += 1;
        cx.notify();
      })
      .child(`${this.count}`);
  }
}
```

A stateless, presentational piece is a function that returns a fresh element each call (the docs' `ui.js` pattern):

```js
export const label = (value, cx) =>
  div().text_size(12).text_color(cx.theme().colors.foreground).child(value);
```

Mistakes to avoid:

- A function component with hooks, or JSX. Neither exists.
- `new Button("x")` or `new View()`. Elements use `Type.new(...)`; Views are created by the host (root) or `cx.new(Class, props)` (nested).
- State as class fields (`count = 0;` in the class body). `gpui-shell agents` says to assign state in `init`, because `View`'s constructor calls `init` from inside `super()` and a class field can overwrite it. (A probe on 0.9.0 showed `init`'s value winning; the ordering is the runtime's, so follow the rule.)
- `main.js` exporting anything but a View class as default.
- A field and a method with the same name (`this.filter = "all"` in `init` and a `filter()` method). The field hides the method, and calling it throws `TypeError: not a function`. Give state fields and methods distinct names (`this.filterMode`, `visible()`).

Source: `/state` (Defining a View), `/elements` (Why `.new(id)`), `/examples` (The todo list), `gpui-shell agents`.

## 3. JSX and text

React:

```tsx
<div className="row">
  <span className="title">AAPL</span>
  {price}
</div>
```

gpui-shell:

```js
h_flex()
  .gap(8)
  .child(div().text_size(12).font_semibold().child("AAPL"))
  .child(`${price}`);
```

- A string is an element; text style comes from the element holding it. A number is accepted as a child too.
- `render` returns **one** element, `Entity` or string. A React fragment becomes a parent element with `.children([...])`.

Mistakes to avoid:

- Calling a `text()` function or wrapping text in a `<span>` equivalent for no reason; pass the string.
- Returning an array or `null` from `render` (throws `render(cx) must return an element, an Entity, or a string`).
- `new`-style constructors or camelCase host methods (`onClick`, `textColor`). Host methods are `snake_case`; your own code is camelCase.

Source: `/elements` (Text), `/state` (Defining a View), `/getting-started` (The script it loads).

## 4. State: `useState`

React:

```tsx
const [items, setItems] = useState<Todo[]>([]);
const add = (caption: string) => setItems([...items, { id: nextId(), caption, done: false }]);
```

gpui-shell:

```js
init() {
  this.items = [];
  this.nextId = 1;
}

add(caption, cx) {
  this.items = [...this.items, { id: this.nextId, caption, done: false }];
  this.nextId += 1;
  cx.notify();
}
```

- Mutate fields, then call `cx.notify()`. Several `notify` calls before the next frame produce one `render`.
- Immutability is not required for correctness (nothing compares references), but copying, as the docs do, is fine.

Mistakes to avoid:

- Forgetting `cx.notify()`. The UI silently stays stale.
- Calling `cx.notify()` inside `render`. It throws: `cx.notify() is not allowed during the render phase`.
- Expecting a setter to schedule the update. There is no setter.
- Notifying on changes the View does not display (a feed tick for an off-screen symbol). Condition the `notify`.

Source: `/state` (`cx.notify()`), `/performance` (Notify what a reader can see).

## 5. Reducers and update logic

React:

```tsx
const [state, dispatch] = useReducer(reducer, initial);
dispatch({ type: "toggle", id });
```

gpui-shell: the View's methods are the reducer. Each takes the `cx` of the event that called it.

```js
toggle(id, done, cx) {
  this.items = this.items.map((item) => (item.id === id ? { ...item, done } : item));
  cx.notify();
}
```

Mistake to avoid: building a dispatch/subscribe layer to imitate React. A method plus `cx.notify()` is the documented model.

Source: `/state` (`cx.notify()`), `/elements` (Controlled values report intent).

## 6. Derived values, `useMemo`, `useCallback`, `React.memo`

React:

```tsx
const remaining = useMemo(() => items.filter((i) => !i.done).length, [items]);
const onToggle = useCallback((id) => ..., []);
export default React.memo(Row);
```

gpui-shell:

```js
visible() {
  return this.filter === "all" ? this.items : this.items.filter((i) => i.done === (this.filter === "done"));
}

render(cx) {
  const remaining = this.items.filter((i) => !i.done).length;
  return v_flex()
    .child(`${remaining} remaining`)
    .children(this.visible().map((item) => this.row(item, cx)));
}
```

- Compute derived values in `render` or in a method. `render` only runs when the View is invalidated, so there is nothing to memoize against frames.
- There is no `memo` (`gpui.memo` is listed as not there yet). When one part of a View changes often, make it a nested View (section 7); that is the `React.memo` boundary.
- Handlers need no `useCallback`: callbacks belong to the render that registered them and are replaced wholesale on the next one.

Mistake to avoid: caching derived values in fields and updating them from "effects". Compute them where they are read.

Source: `/elements` (Not there yet, Callbacks belong to their render), `/performance` (Split a large View into small ones).

## 7. Props

React:

```tsx
<PriceChart symbol={symbol} />
```

gpui-shell, two cases:

Stateless piece: pass arguments to a helper function.

```js
const priceTag = (symbol, price, cx) =>
  h_flex().gap(4).child(symbol).child(div().text_color(cx.theme().colors.muted_foreground).child(`${price}`));
```

Stateful child: a nested View, created once, mounted as a child, updated with `set_props`.

```js
class PriceChart extends View {
  init(props) {
    this.symbol = props.symbol;
  }

  update(props) {
    this.symbol = props.symbol; // render runs after update
  }

  render(cx) {
    return div().child(this.symbol);
  }
}

export default class Terminal extends View {
  init(props, cx) {
    this.chart = cx.new(PriceChart, { symbol: "AAPL" });
  }

  select(symbol) {
    this.chart.set_props({ symbol }); // runs PriceChart.update + render; the parent is not rebuilt
  }

  render() {
    return v_flex().child(this.chart);
  }
}
```

- `init(props, cx)` receives the props once. `update(props)` runs when the parent calls `entity.set_props(next)`, followed by that child's `render`.
- `entity.release()` drops the nested View.
- Callback props: `Props` is typed `Record<string, any>`, and a probe on 0.9.0 showed a function arriving intact in the child's `init(props)`. The prose docs do not discuss it; the documented callback pattern is a closure (section 22). A child calls such a callback with its own handler's `cx`.
- After changing shared state a nested View reads (without new props), `cx.notify(entity)` invalidates that child without calling its `update`.

Mistakes to avoid:

- `cx.new(...)` inside `render`. Retained state is created in `init` or an event handler only.
- Re-creating the child to pass new props. Use `set_props`.
- Destructuring the theme or props into module-level constants. Read values at the use site.

Source: `/api` (Views, Composition patterns), `/performance` (Every View has its own Snapshot), `gpui-shell agents`.

## 8. Children and composition

React:

```tsx
function Card({ title, children }) {
  return <section><h2>{title}</h2>{children}</section>;
}
```

gpui-shell:

```js
const card = (title, body, cx) =>
  v_flex()
    .p(12)
    .gap(8)
    .bg(cx.theme().colors.surface)
    .child(div().font_semibold().child(title))
    .child(body);

render(cx) {
  return card("Today", this.list(cx), cx);
}
```

- An element built in this `render` may be passed into a helper and placed once. It is consumed when used as a child.
- Some components take slots instead of children (`content`, `trigger`, `header`, `panel`, ...). A slot is consumed by the component and rendered where it decides.

Mistake to avoid: placing the same element twice (for example a shared `icon` element used in two rows), or storing a `children` element on `this`. Build a new one per use.

Source: `/elements` (Composition, Elements are single-use), `/api` (Slots).

## 9. Mount effects

React:

```tsx
useEffect(() => {
  loadSettings();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);
```

gpui-shell:

```js
init(_props, cx) {
  this.settings = loadSettings();
  this.clock = cx.timer.every(1000, (cx) => this.tick(cx));
}
```

- `init` runs once and receives an `AsyncContext`, so work started there may `await`.
- Tasks and timers belong to the View that created them; when it goes away, their callbacks are skipped.
- `init` runs before the window has a `ShellRoot`, so opening a dialog, sheet or toast from `init` throws. Open overlays from an event handler or a task.

Mistakes to avoid:

- Starting work at module top level or in a `constructor`. They receive no `cx`, and nothing would own or cancel the work.
- Opening an overlay from `init`.

Source: `/state` (Two kinds of `cx`, Ownership and cancellation), `/overlays` (Overlays need a `ShellRoot`).

## 10. Effects that react to changes

React:

```tsx
useEffect(() => {
  localStorage.setItem("items", JSON.stringify(items));
}, [items]);
```

gpui-shell: no dependency tracking exists. Run the side effect where the state changes.

```js
add(caption, cx) {
  this.items = [...this.items, { id: this.nextId++, caption, done: false }];
  this.save(); // the "effect", called explicitly
  cx.notify();
}
```

For a nested View, the "props changed" effect is `update(props)` (section 7).

Mistakes to avoid:

- Running side effects in `render`. `render` may re-run on theme changes and reloads, and may not notify or open overlays.
- Looking for a dependency array or a watch API. There is none.

Source: `/state` (`cx.notify()`, When `render` runs, Scope phases).

## 11. Cleanup and unmount

React:

```tsx
useEffect(() => {
  const sub = feed.subscribe(onQuote);
  return () => sub.unsubscribe();
}, []);
```

gpui-shell: the docs document **no unmount lifecycle method** on a View. What they document:

```js
init(_props, cx) {
  this.poll = cx.timer.every(5000, (cx) => this.refresh(cx));
  this.draft = InputState.new({ placeholder: "Search" });
}

stopPolling() {
  this.poll.cancel();       // Task: cancel(), is_done()
}

dispose() {                  // your own method, called by the code that removes this View
  this.draft.release();     // every retained handle has release(): boolean
}
```

- A task or timer owned by a View that goes away has its callback skipped, so it does not write into dead state.
- A cancelled `cx.sleep` stays pending forever; code after the `await` never runs.
- A child process started with `process.spawn` is killed when the View goes away, the application reloads or the window closes.

Mistake to avoid: inventing `componentWillUnmount`, `onUnmount` or `destroy` hooks and assuming the runtime calls them.

Source: `/state` (Ownership and cancellation), `/api` (Retained handles, Scheduling), `gpui-shell agents`.

## 12. Timers

React:

```tsx
const id = setTimeout(() => setSaved(false), 1500);
clearTimeout(id);
```

gpui-shell:

```js
flash(cx) {
  this.saved = true;
  cx.notify();
  this.hide = cx.timer.after(1500, (cx) => {
    this.saved = false;
    cx.notify();
  });
}
// this.hide.cancel();
```

Or with `await`:

```js
cx.spawn(async (cx) => {
  await cx.sleep(1500);
  this.saved = false;
  cx.notify();
});
```

- `cx.timer.every` measures its interval from the end of the previous call.
- Callbacks receive their own `cx`; use that one.

Mistake to avoid: `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`. They are throwing stubs.

Source: `/state` (Asynchronous work, Timers and standard host APIs).

## 13. Data fetching

React:

```tsx
useEffect(() => {
  fetch("/api/todos").then((r) => r.json()).then(setTodos);
}, []);
```

gpui-shell:

```js
init(_props, cx) {
  this.loading = true;
  this.todos = [];
  cx.spawn(async (cx) => {
    try {
      const response = await fetch("https://api.example.com/v1/todos");
      this.todos = await response.json();
    } catch (error) {
      this.error = error.message;
    }
    this.loading = false;
    cx.notify();
  });
}
```

`gpui-shell.json` must grant the request:

```json
"capabilities": {
  "network": {
    "http": [{ "scheme": "https", "host": "api.example.com", "methods": ["GET"], "path_prefixes": ["/v1/"] }]
  }
}
```

- `fetch` is global and returns `{ status, ok, url, text(), json(), arrayBuffer(), bytes() }`.
- Network is denied by default; every request and redirect must match a declared host, method and path prefix.
- `cx.spawn` adopts the promise, so a rejection is logged with the script's stack instead of vanishing.
- WebSocket: `import { WebSocket } from "websocket"` and `WebSocket.connect(url)`; it is not a global and not a constructor. It needs `capabilities.network.hosts`.

Mistakes to avoid:

- `await` inside an event handler and then using that handler's `cx`. It is stale after the `await`; use `cx.spawn(async (cx) => ...)` and its `cx`.
- Relative URLs (`/api/todos`): there is no page origin.
- Forgetting the manifest grant; the refusal message names the field to add.

Source: `/capabilities` (Network and safe standard APIs, The manifest), `/state` (Asynchronous work).

## 14. Refs

React:

```tsx
const inputRef = useRef<HTMLInputElement>(null);
<input ref={inputRef} />;
inputRef.current?.focus();

const renders = useRef(0);
```

gpui-shell:

```js
init(_props, cx) {
  this.searchFocus = cx.focus_handle();
  this.renders = 0; // mutable box: a plain field
}

render() {
  return Button.new("search").tab_index(1).track_focus(this.searchFocus).child("Search");
}

// in an event handler: this.searchFocus.focus(); this.searchFocus.is_focused();
```

- There are no DOM nodes to reference. Focus goes through a `FocusHandle` the View owns (`cx.focus_handle()`, created in `init` or an event handler, never in `render`). An `InputState` also has its own `focus()`.
- Geometry: pointer events carry `position`, and `local_position` / `bounds` once the element has been painted; `window.viewport_size()` answers the drawable area and is legal from `render`.
- `forwardRef` has no counterpart: pass the `FocusHandle` (or the `InputState`) to whatever renders the element.

Mistakes to avoid:

- `cx.focus_handle()` in `render` (throws; it would be a new handle every frame).
- `track_focus` on `Link` or `Switch` (not supported; reported in the log).

Source: `/elements` (Focus and accessibility, Event objects), `/overlays` (The window itself).

## 15. Context and global state

React:

```tsx
const ThemeContext = createContext("light");
const theme = useContext(ThemeContext);
```

gpui-shell: **no equivalent is documented.** The docs say: "There is no store beyond the persistence layer ... and ordinary module scope" (listed under "Not there yet").

What exists:

- Theme: `cx.theme()` in any `render` or handler (`colors`, `spacing`, `radius`, `appearance`, `is_dark`). `set_theme({ appearance, tokens })` from `"gpui-base"` replaces it from an event or task and rebuilds token-backed Views.
- Shared data: pass it down through `cx.new(Child, props)` and `set_props`, or keep it in an ordinary module. A module-level change does not invalidate any View; the View that displays it still needs its own `cx.notify()` (or `set_props`).

Mistake to avoid: building a Provider/consumer system and assuming consumers re-render when the value changes. Nothing re-renders without `notify` or `set_props`.

Source: `/state` (Not there yet), `/styling` (Theme values).

## 16. Conditional rendering

React:

```tsx
{items.length === 0 && <p>Nothing yet</p>}
{loading ? <Spinner /> : <List />}
```

gpui-shell:

```js
v_flex()
  .when(this.items.length === 0, (el) => el.child("Nothing yet"))
  .child(this.loading ? div().child("Loading…") : this.list(cx));
```

- `.when(condition, branch)` keeps the chain in one piece. `branch` must **return the element**; returning nothing throws `when(...) must return the element`.
- For a choice between two elements, a ternary inside `.child(...)` is clearer.
- An `if` with an early `return` in `render` is ordinary JavaScript and fine: `render` runs again on every invalidation.
- A conditional child shifts the position of everything after it; give elements with pressed or focus state an `.id(...)` (section 17).

Mistakes to avoid:

- `.child(cond && el)`. `child` accepts booleans, and on 0.9.0 `.child(false)` renders the text "false" (verified with `gpui-shell check --print-spec`). Use `.when`.
- A `when` branch with a block body and no `return`.

Source: `/elements` (Composition, Ids).

## 17. Lists and keys

React:

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>
      <input type="checkbox" checked={item.done} onChange={(e) => toggle(item.id, e.target.checked)} />
      {item.caption}
    </li>
  ))}
</ul>
```

gpui-shell:

```js
row(item, cx) {
  return h_flex()
    .gap(8)
    .child(
      Checkbox.new(`item-${item.id}`)
        .checked(item.done)
        .on_change((done, cx) => this.toggle(item.id, done, cx))
        .child(item.done ? "☑" : "☐"),
    )
    .child(item.caption);
}

render(cx) {
  return v_flex().children(this.items.map((item) => this.row(item, cx)));
}
```

- There is no `key` prop. Identity comes from the id given to `Button.new(id)`, `Checkbox.new(id)`, `Link.new(id)`, `Switch.new(id)`, or `.id(name)` on a `div`/`h_flex`/`v_flex`. Use stable, unique ids (`` `item-${item.id}` ``), never an array index.
- Long lists: `v_virtual_list(id, count, item_sizes, get_key, render)` (pair with `Scrollbar.vertical(id)`), or `list(id, count, get_key, render)` for rows of unequal height and `uniform_list(...)` for equal rows. Their `render` runs in the `layout` phase during a frame: no `notify`, no retained state. Clicks on rows go through `.on_item_click((key, cx) => ...)` on the list.

```js
v_flex()
  .relative()
  .h(200)
  .child(
    v_virtual_list("rows", rows.length, 28, (index) => rows[index].id, (range) =>
      rows.slice(range.start, range.end).map((row) => div().child(row.name)),
    ).size_full(),
  )
  .child(Scrollbar.vertical("rows").absolute().inset_0());
```

Mistakes to avoid:

- Array indexes as ids; identity shifts when the list is filtered.
- `.id(...)` on `Button`/`Checkbox`/`Link`/`Switch` (ignored with a warning; their id is the constructor argument).

Source: `/elements` (Ids), `/api` (Tables and lists, Composition patterns, Events).

## 18. Events

React:

```tsx
<button onClick={(e) => { e.stopPropagation(); save(e.shiftKey); }}>Save</button>
<div onKeyDown={(e) => { if (e.metaKey && e.key === "s") save(); }} tabIndex={0} />
```

gpui-shell:

```js
Button.new("save")
  .on_click((event, cx) => this.save(event.modifiers.shift, cx))
  .child("Save");

div()
  .track_focus(this.editorFocus)
  .on_key_down((event, cx) => {
    if (event.keystroke === "cmd-s") {
      this.save(false, cx);
      cx.stop_propagation();
    }
  });
```

- Handlers take `(event, cx)`. `on_click` fires on click **and** keyboard activation and receives `{ click_count, modifiers: { shift, control, alt, platform } }`.
- `on_change` on `Checkbox`/`Switch` receives `(checked, cx)`, not an event.
- Key events: `keystroke` spells the platform modifier `cmd` on every OS; `key` and `modifiers` give the parts.
- Pointer and keyboard handlers (`on_key_down`, `on_mouse_down(button, ...)`, `on_scroll_wheel`, ...) are wired on `div`, `h_flex`, `v_flex`, `Button`, `Link`, `Checkbox`, `Switch`, `Radio`, `Toggle`, `Tabs`, `Tab` only. On any other component, wrap it and put the handler on the wrapper.
- `cx.stop_propagation()` replaces `e.stopPropagation()`. The docs document no `preventDefault`.

Mistakes to avoid:

- `function () {}` handlers: `this` is wrong. Use arrow functions.
- `(event, window, cx)` signatures copied from Rust: `cx` becomes `undefined`.
- `onClick`, `onKeyDown` names; host methods are `snake_case` (`on_click`, `on_key_down`).
- Key handlers on an element that cannot hold focus; give it a `FocusHandle` via `track_focus`.

Source: `/elements` (Behavior methods, Event objects, Where input is installed), `/overlays` (Do not copy Rust's `|event, window, cx|`).

## 19. Form inputs

React:

```tsx
const [draft, setDraft] = useState("");
<input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(draft)} />;
```

gpui-shell:

```js
init() {
  this.items = [];
  this.nextId = 1;
  this.draft = InputState.new({ placeholder: "What needs doing?" });
  this.draft.on("submit", (_event, cx) => this.add(this.draft.value(), cx));
}

add(caption, cx) {
  if (!caption.trim()) return;
  this.items = [...this.items, { id: this.nextId++, caption, done: false }];
  this.draft.set_value("");
  cx.notify();
}

render(cx) {
  return Input.new(this.draft)
    .h(28)
    .px(8)
    .border(1)
    .border_color(cx.theme().colors.input)
    .bg(cx.theme().colors.surface);
}
```

- Text lives in a retained `InputState` (or `TextareaState`), not in a View field. Read with `state.value()`, write with `state.set_value(text)`.
- Events: `state.on("change" | "submit" | "focus" | "blur", (event, cx) => ...)`. The subscription outlives renders; `on` replaces an earlier handler for the same event.
- `TextareaState`: Enter inserts a line break and reports `submit`; `set_submit_on_enter(true)` makes Enter only submit (Shift+Enter still reports `submit` with `event.shift`).
- Toggles are controlled: `Checkbox`/`Switch`/`Radio`/`Toggle` take `.checked(value)` and report `.on_change((checked, cx) => ...)`; store the value and `notify`. They draw no indicator; draw it as a child.
- `gpui-base`'s `InputState.new({ placeholder, value })` takes options; `gpui-component`'s `InputState.new(placeholder, value)` takes positional arguments. Each module's `Input` takes only its own module's state.

Mistakes to avoid:

- `InputState.new(...)` in `render` (throws).
- Mirroring every keystroke into a field and re-rendering to "control" the input.
- Expecting a `Checkbox` to toggle itself.
- Using `gpui-component`'s `Checkbox` without an `icons/check.svg` file under the application root. Observed on 0.9.0 (not in the docs): the control loads that asset and `dev` logs `asset icons/check.svg was not found` until the file exists.

Source: `/state` (Retained state, Input events), `/elements` (Controlled values report intent), `gpui-shell agents`.

## 20. Styling

React:

```tsx
<button
  className="h-8 px-3 rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40"
  style={{ lineHeight: 1.45 }}
  disabled={busy}
>Save</button>
```

gpui-shell:

```js
Button.new("save")
  .h(32)
  .px(12)
  .rounded(6)
  .border(1)
  .border_color(cx.theme().colors.border)
  .bg(cx.theme().colors.surface)
  .line_height(1.45)
  .hover((s) => s.bg(cx.theme().colors.muted))
  .disabled(this.busy)
  .when(this.busy, (el) => el.opacity(0.4))
  .child("Save");
```

- Two families of style methods. No-argument ones are generated from GPUI (`flex_col`, `items_center`, `gap_2`, `rounded_md`, `text_sm`, `size_full`, `font_semibold`, `truncate`, `cursor_pointer`, `shadow_sm`, `text_center`, ...). Argument ones are bound by hand (`w`, `h`, `p*`, `m*`, `gap`, `border*`, `rounded*`, `bg`, `text_color`, `text_size`, `line_height`, `font_family`, `opacity`, ...).
- Lengths: a number is pixels; strings carry units (`"50%"`, `"1.5rem"`, `"auto"`) only where the Rust type allows. `p("auto")` and `rounded("50%")` throw.
- `line_height(1.45)` is a multiplier, like unitless CSS `line-height`; `line_height("18px")` is fixed.
- Colours: prefer `cx.theme().colors.<token>` (`background`, `foreground`, `surface`, `surface_foreground`, `primary`, `primary_foreground`, `secondary`, `secondary_foreground`, `muted`, `muted_foreground`, `accent`, `accent_foreground`, `selection`, `destructive`, `destructive_foreground`, `border`, `input`, `ring`). A `#rrggbb` literal ignores theme changes, which is what a port of a fixed-colour brand design wants: use the design's hex values there.
- `hover`, `active`, `focus` take a function receiving a detached element; they run natively, with no JavaScript on hover. `active` and `focus` need a stable identity (`.id(...)` on a plain `div`).
- Disabled, selected and checked appearance is yours: `.disabled(v)` only blocks activation.
- Base controls (`gpui-base`) have no default look. When the binary ships `"gpui-component"`, its styled components are preferred over hand-styled base controls, except in a port of a brand design that must match exactly: there, hand-style `gpui-base` controls so every colour, radius and font comes from the design.
- Spacing and radius tokens (`cx.theme().spacing.md`, `cx.theme().radius.lg`) are values you pass to the length methods.
- Colours are theme tokens or `#rgb`, `#rrggbb`, `#rrggbbaa` literals. CSS names throw: `"transparent"` fails with ``TypeError: `transparent` is not a color value``; use `"#00000000"`.
- Fonts: `font_family(name)` takes a family name, and the docs and `gpui-kit.d.ts` document no way to bundle or load a font file with the app. Observed on 0.9.0 (macOS): fonts installed for the user (`~/Library/Fonts`) resolve by family name, variable fonts honour `font_weight`, and an icon font's ligatures work (a `"play_arrow"` child in `"Material Symbols Outlined"` draws the icon). A family that is not installed falls back silently: no error, and `check` passes. A web `@font-face` or Google Fonts link has no equivalent; tell the user which fonts must be installed. An icon-font name that the font lacks also falls back silently and draws the name as text: check each name against the font's glyph list (for example with fontTools: `TTFont(path).getGlyphOrder()`).
- Version drift: the docs' Styling page lists `shadow` as not bound, while `gpui-shell agents` 0.9.0 documents `.shadow([{ x, y, blur, spread, color, inset }])`. Check `gpui-kit.d.ts` for the target version.

Mistakes to avoid:

- `className`, `style={{...}}`, CSS files, Tailwind class strings, camelCase (`textColor`, `borderRadius`).
- Inventing CSS-only names; an unknown method throws with a "did you mean" suggestion, so run `gpui-shell check`.
- Destructuring `cx.theme()` into constants; read it at the use site.
- Assuming a web font named in `font_family` is available. Check that each family resolves on the target machine (on macOS, list the installed fonts; with fontconfig, `fc-match <family>` must name that family), and report each missing one.

Source: `/styling`, `/elements` (Behavior methods), `/` (Presentation belongs to the script), `gpui-shell agents`.

## 21. Scrolling

React:

```tsx
<div style={{ height: 240, overflowY: "auto" }}>{rows}</div>
```

gpui-shell:

```js
v_flex()
  .id("activity")
  .h(240)
  .overflow_y_scroll()
  .children(this.rows.map((row) => div().child(row.text)));
```

- Give the viewport a bounded size, then choose the axis: `overflow_scroll()`, `overflow_x_scroll()`, `overflow_y_scroll()`. The `..._scrollbar()` variants also paint native scrollbars and require `.id(...)`.
- A stable `.id(...)` keeps the scroll position across renders.

Mistake to avoid: an unbounded scroll container, or no `id` (the position resets when the tree shape changes).

Source: `/styling` (Scrolling overflow).

## 22. Portals, modals, toasts

React:

```tsx
{open && createPortal(<ConfirmDialog count={n} onConfirm={clear} onClose={() => setOpen(false)} />, document.body)}
```

gpui-shell:

```js
// confirm.js
import { Button, h_flex, v_flex } from "gpui-base";

export default (count, onConfirm) => () =>
  v_flex()
    .w(360)
    .p(24)
    .gap(12)
    .child(`Delete ${count} completed items?`)
    .child(
      h_flex()
        .justify_end()
        .gap(8)
        .child(Button.new("cancel").on_click(() => window.close_dialog()).child("Cancel"))
        .child(
          Button.new("delete")
            .on_click((_event, cx) => {
              onConfirm(cx);
              window.close_dialog();
            })
            .child("Delete"),
        ),
    );

// main.js: import confirmClear from "./confirm.js"; then, inside an event handler:
window.open_dialog(confirmClear(this.completed, (cx) => this.deleteCompleted(cx)));
window.push_toast({ title: "Saved", level: "success", id: "save" });
```

- `window` is a global (no import). `open_dialog(content, { escape_dismissable, backdrop_dismissable })` takes a **function returning an element**, which runs whenever the dialog draws. It returns the stack depth, not a handle or a promise.
- Whatever the function closes over is the dialog's state; there are no dialog props.
- Sheet: `window.open_sheet(() => el)` or `window.open_sheet_at("left" | "right" | "top" | "bottom", () => el)`. Toasts: `push_toast({ title, description, level, timeout, id })`, `remove_toast(id)`.
- Open and close overlays only from an event handler or a task; never from `render` or `init`.
- The root supplies backdrop, position, focus trap and Escape; size, padding and buttons are yours.

Mistakes to avoid:

- Passing an element or a View class to `open_dialog`.
- Capturing the opener's `cx` inside the dialog; take `cx` from the dialog button's own handler arguments.
- Rendering a modal as a floating `div` with an `open` flag.
- camelCase option names (`escapeDismissable` is refused).

Source: `/overlays`, `/examples` (The todo list).

## 23. Error boundaries

React:

```tsx
<ErrorBoundary fallback={<p>Something went wrong</p>}><Panel /></ErrorBoundary>
```

gpui-shell: **no error-boundary API is documented.** The runtime behaves this way instead:

- A `render` that throws keeps the previous Snapshot and its handlers working, with an error banner over it. A View whose first render fails shows the full error surface.
- A rejected `cx.spawn` promise is logged with the script's stack.
- A refused capability throws; catch it at the boundary and tell the user (the docs' storage example).

Mistake to avoid: relying on try/catch around child Views to render a fallback; nothing documents that a child's render error reaches the parent.

Source: `/state` (When `render` runs, Asynchronous work), `/capabilities` (Degrading when it is not granted).

## 24. Animation

React:

```tsx
<div style={{ left: open ? 320 : 16, transition: "left 220ms ease-out" }} />
```

gpui-shell:

```js
div()
  .id("drawer")
  .left(this.open ? 320 : 16)
  .opacity(this.open ? 1 : 0.5)
  .transition("left", { duration: 220, easing: "ease-out" })
  .spring("opacity", { response: 260, damping: 0.85 });
```

- Animatable: `opacity`, `width`, `height`, `left`, `top`. Change the target and `cx.notify()`; frames run natively.
- Length targets must be numeric pixels (no `"50%"`, `"1rem"`, `"auto"`). Give the element a stable `.id(...)`.
- No keyframes and no per-frame JavaScript callbacks.

Mistake to avoid: animating with `cx.timer.every` and `notify` per frame.

Source: `/styling` (Native motion, Not there yet).

## 25. Persistence: `localStorage`

React:

```tsx
const saved = JSON.parse(localStorage.getItem("items") ?? "[]");
```

gpui-shell: the same Web Storage API, as globals (`localStorage`, `sessionStorage`), but `localStorage` is a capability.

```js
export function load() {
  try {
    const saved = localStorage.getItem("todolist.items");
    const items = saved === null ? [] : JSON.parse(saved);
    return Array.isArray(items) ? items : [];
  } catch (error) {
    console.warn(`storage unavailable (${error.message})`);
    return [];
  }
}
```

- Synchronous and cached in memory, so `getItem` is fine in `render`. Writes are scheduled; `await localStorage.flush()` when you must know they reached disk.
- A manifest-less local run grants storage; a manifest may set `"storage": false`, and an ungranted `localStorage` throws.
- The Examples page still shows an older `store.get(KEY)` form; the API and Capabilities pages document `localStorage`. Follow `gpui-kit.d.ts`.

Mistake to avoid: treating a storage refusal as a crash; absorb it and tell the user the data is not saved.

Source: `/capabilities` (Storage), `/api` (Storage).

## 26. Keyboard shortcuts

React (typical):

```tsx
useEffect(() => {
  const onKey = (e) => { if (e.metaKey && e.key === "s") { e.preventDefault(); save(); } };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

gpui-shell:

```js
init(_props, cx) {
  this.editorFocus = cx.focus_handle();
  cx.bind_keys([{ keystroke: "cmd-s", action: "save", context: "Editor" }]);
}

render() {
  return div()
    .key_context("Editor")
    .track_focus(this.editorFocus)
    .on_action("save", (_event, cx) => this.save(cx))
    .child(Button.new("save").on_click(() => window.dispatch_action("save")).child("Save"));
}
```

- The keymap belongs to the application; `context` matches the `key_context(...)` an element declares.
- No `window.addEventListener`.
- Version drift: the State page still lists actions and key bindings as not bound, while the Elements and API pages document `cx.bind_keys` and `on_action`. Confirm in `gpui-kit.d.ts`.

Source: `/elements` (Actions and key bindings), `/api` (Actions and key bindings).

## 27. No documented equivalent

Do not invent these. Tell the user, and propose the nearest documented pattern or flag the feature.

| React | Status in the gpui-shell docs |
| --- | --- |
| `createContext` / Redux / Zustand-style global store | None; module scope and the persistence layer only (section 15) |
| `useLayoutEffect` | None; no DOM layout to read before paint |
| `Suspense`, `React.lazy` | None; dynamic `import()` from a handler is how heavy code is deferred |
| `useTransition`, `useDeferredValue`, `startTransition` | None |
| `useId` | None; write your own stable ids |
| `useImperativeHandle`, `forwardRef` | None; pass `FocusHandle` / `InputState` handles (section 14) |
| `useSyncExternalStore` | None; subscribe in `init`, `notify` from the callback |
| Server components, SSR, hydration | Not applicable; there is no server render |
| React Router | None; keep the current screen in a field and switch in `render` |
| `preventDefault` | Not documented; `cx.stop_propagation()` exists |
| Error boundaries | None (section 23) |
| Multiple windows (`window.open`) | None; the host opens the window |
| Tooltip / context-menu APIs | `.tooltip(text)` on `div`/`h_flex`/`v_flex`/`Button`; no context-menu API |
| React DOM libraries, npm UI kits | Not usable; there is no DOM |

## 28. Translating a Tailwind mockup

A static HTML mockup styled with Tailwind is translated class by class, but several Tailwind defaults differ from gpui-shell's. Read the mockup's `tailwind.config` (inline `<script>` or file) first: custom colours, font sizes, font families and spacing are defined there, not in the class names.

| Tailwind | gpui-shell |
| --- | --- |
| `flex` (row; children stretch to the row's height) | `h_flex()` centres its children vertically. A child that must fill the row's height gets `h_full()`, or the row gets `items_start()` / `items_stretch()` |
| `flex flex-col` | `v_flex()` (children stretch across, as in Tailwind) |
| `text-sm` (sets font size **and** line height, inherited by descendants) | `text_size(14).line_height("20px")` on the element holding the text. `text_size` sets only the size; take each line height in pixels from the config or Tailwind's defaults |
| `leading-6` | `line_height("24px")`. A bare number is a multiplier of the font size, not pixels |
| `font-display` (a family from the config) vs `text-lg` (a size) | `font_family("<family from the config>")` vs `text_size(...)`. `font-*` names a family or a weight, `text-*` a size or a colour |
| `font-semibold` | `font_semibold()` or `font_weight(600)` |
| `w-10 border` (border-box) | `w(40).border(1)`: the width includes the border, as in Tailwind |
| `shrink-0` on a fixed header, sidebar or footer | `flex_shrink_0()`; without it a fixed band shrinks inside a scroll container or a crowded row |
| `bg-transparent` | `bg("#00000000")`, or leave the background unset |
| `bg-white/10`, `bg-[#1a1d24]/80` | a `#rrggbbaa` literal (alpha `0x1a` for 10%, `0xcc` for 80%) |
| `shadow-lg` | `.shadow([{ x, y, blur, spread, color, inset }])` with the values of that Tailwind shadow (see section 20 on version drift) |
| `backdrop-blur` | none documented; leave it out and tell the user |
| `<img src>` | `image(path)` with a path relative to the application root. `image` and `svg` read only files in the application's directory, not URLs: for a remote image or CSS `background-image` URL, ask the user for the file (or whether it may be downloaded into the application), and until then draw a placeholder of the same size and report the substitution |
| `material-symbols-outlined` icon text | a text child in `font_family("Material Symbols Outlined")`, with `line_height` equal to the icon size in pixels (section 20, fonts) |

- Size the window to the design in `gpui-shell.json`: `"window": { "width": 1440, "height": 900 }`, in logical pixels. Without it the host's default size is used. The window's title is `<application directory name> — gpui-shell`.
- Text inherits its style from the nearest ancestor that sets it. Set `text_size`, `line_height`, `font_family` and `text_color` on the element that holds the text, or on one wrapper for a block whose text all shares them, as the mockup's classes do.

Mistakes to avoid:

- Translating `flex` as `h_flex()` without checking the cross axis: a sidebar or a column in a row ends up centred and clipped at the top.
- Translating `text-sm` as `text_size(14)` alone: every line then has an inherited or default line height, and the layout drifts by a few pixels per line.
- Guessing a custom class (`text-display`, `bg-panel`) instead of reading it from the config.
- Changing a colour away from the mockup's value to match a screenshot. A macOS screenshot is in the display's colour profile; convert it to sRGB before comparing colours.

Source: `gpui-kit.d.ts` 0.9.0 (`h_flex`, `line_height`, colour values), `gpui-shell agents` (the manifest's `window`), and checks on 0.9.0 with `gpui-shell check` and screenshots.
