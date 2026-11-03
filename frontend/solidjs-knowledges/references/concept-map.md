# React to Solid concept map

One entry per React concept: the React version, the correct Solid version, and the mistake an agent with React habits makes. Every Solid fact comes from the official Solid docs (`solidjs/solid-docs`, Solid 1.x, checked 2026-11-03). "Source" paths are relative to `https://docs.solidjs.com`.

Contents

1. [Quick table](#1-quick-table)
2. [State: `useState`](#2-state-usestate)
3. [Objects, arrays and `useReducer`: stores](#3-objects-arrays-and-usereducer-stores)
4. [Derived values and `useMemo`](#4-derived-values-and-usememo)
5. [`useCallback`](#5-usecallback)
6. [`useEffect` with dependencies](#6-useeffect-with-dependencies)
7. [Effect cleanup](#7-effect-cleanup)
8. [Mount and unmount](#8-mount-and-unmount)
9. [Explicit dependencies and skipping the first run](#9-explicit-dependencies-and-skipping-the-first-run)
10. [`useLayoutEffect`](#10-uselayouteffect)
11. [State synced in an effect](#11-state-synced-in-an-effect)
12. [Refs and `forwardRef`](#12-refs-and-forwardref)
13. [Props: reading, defaults, rest, children](#13-props-reading-defaults-rest-children)
14. [Context](#14-context)
15. [Conditional rendering](#15-conditional-rendering)
16. [Lists](#16-lists)
17. [Events](#17-events)
18. [Form inputs](#18-form-inputs)
19. [Attributes: class, style, for, innerHTML](#19-attributes-class-style-for-innerhtml)
20. [Data fetching](#20-data-fetching)
21. [`lazy`, `Suspense`, error boundaries](#21-lazy-suspense-error-boundaries)
22. [Dynamic components and portals](#22-dynamic-components-and-portals)
23. [`useTransition`, `useId`, batching](#23-usetransition-useid-batching)

## 1. Quick table

| React | Solid | Import |
| --- | --- | --- |
| `useState` | `createSignal` (call the getter: `count()`) | `solid-js` |
| `useState` with an object, `useReducer` | `createStore` + setter with path syntax | `solid-js/store` |
| `useMemo` | `createMemo`, or a plain derived function when cheap | `solid-js` |
| `useCallback` | a plain function | — |
| `useEffect(fn, deps)` | `createEffect(fn)` (auto-tracked, no deps) | `solid-js` |
| `useEffect(fn, [])` | `onMount(fn)` | `solid-js` |
| effect cleanup / unmount | `onCleanup(fn)` | `solid-js` |
| `useLayoutEffect` | `onMount` / `createEffect` (run after DOM creation, before paint) | `solid-js` |
| `useRef` (DOM) | `let el!: HTMLElement` + `ref={el}` | — |
| `useRef` (mutable box) | a plain `let` variable | — |
| `forwardRef` | pass `ref={props.ref}` to the inner element | — |
| `createContext` / `useContext` | `createContext` / `useContext` | `solid-js` |
| `cond && <A/>`, ternary | `<Show when fallback>` | `solid-js` |
| `switch` / chained ternaries | `<Switch>` + `<Match when>` | `solid-js` |
| `items.map(i => <li key>)` | `<For each>` (by identity) or `<Index each>` (by position) | `solid-js` |
| default props | `mergeProps` | `solid-js` |
| `const { a, ...rest } = props` | `splitProps` | `solid-js` |
| `props.children` read many times | `children(() => props.children)` | `solid-js` |
| `className` / `htmlFor` | `class` / `for` | — |
| `style={{ fontSize: 12 }}` | `style={{ "font-size": "12px" }}` | — |
| `dangerouslySetInnerHTML` | `innerHTML` | — |
| `onChange` on text input | `onInput` | — |
| fetch in `useEffect` | `createResource` | `solid-js` |
| `React.lazy` / `Suspense` | `lazy` / `Suspense` | `solid-js` |
| error boundary class | `<ErrorBoundary fallback={(err, reset) => ...}>` | `solid-js` |
| `createPortal` | `<Portal mount>` | `solid-js/web` |
| `<Tag />` from a variable | `<Dynamic component>` | `solid-js/web` |
| `useTransition` | `useTransition` (`pending` is an accessor) | `solid-js` |
| `useId` | `createUniqueId` | `solid-js` |
| `React.memo` | nothing: components never re-run | — |

## 2. State: `useState`

React:

```tsx
const [count, setCount] = useState(0);
return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
```

Solid:

```tsx
import { createSignal } from "solid-js";

const [count, setCount] = createSignal(0);
return <button onClick={() => setCount(c => c + 1)}>{count()}</button>;
```

Mistake:

```tsx
return <span>{count}</span>;          // renders the function, not the value
const label = `Count: ${count()}`;   // top-level read: frozen at 0
return <span>{label}</span>;
```

`count` is a getter; it must be called, and called inside JSX or another tracking scope. The setter takes a value or an updater `(prev) => next`. Source: `/concepts/signals`, `/reference/basic-reactivity/create-signal`.

## 3. Objects, arrays and `useReducer`: stores

React:

```tsx
const [todos, setTodos] = useState<Todo[]>([]);
setTodos(ts => ts.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
```

Solid, signal with an immutable update (fine for small state):

```tsx
const [todos, setTodos] = createSignal<Todo[]>([]);
setTodos(ts => [...ts, newTodo]);
```

Solid, store with path syntax (fine-grained, preferred for nested or frequently updated state):

```tsx
import { createStore } from "solid-js/store";

const [state, setState] = createStore({ todos: [] as Todo[] });
setState("todos", t => t.id === id, "done", done => !done);  // filter + updater
setState("todos", state.todos.length, newTodo);              // append
setState("todos", 0, { title: "New" });                      // shallow merge into an object
```

Mistake:

```tsx
todos().push(newTodo);        // mutates in place: the setter is not called, nothing updates
state.todos[0].done = true;   // stores are changed through the setter (or produce), not by assignment
```

For many mutations at once, use `produce` inside the setter: `setState("todos", 0, produce(t => { t.done = true; t.title = "x"; }))`. To merge fresh server data, use `reconcile`. To hand a plain object to a third-party library, use `unwrap`. A `useReducer` becomes a store plus named action functions next to it. Source: `/concepts/signals` (Updating values), `/concepts/stores`.

## 4. Derived values and `useMemo`

React:

```tsx
const fullName = `${first} ${last}`;
const visible = useMemo(() => items.filter(matches(query)), [items, query]);
```

Solid:

```tsx
const fullName = () => `${first()} ${last()}`;                       // cheap: derived function
const visible = createMemo(() => items().filter(matches(query())));  // expensive: cached
return <p>{fullName()} — {visible().length}</p>;
```

Mistake:

```tsx
const fullName = `${first()} ${last()}`;  // computed once at setup, never updates
```

A derived function is reactive only where it is called inside a tracking scope and is recomputed on every call. A memo caches its result, re-runs only when a dependency changes, and stops propagation when the new value is `===` the old one. Keep memos pure: no signal writes inside. Source: `/concepts/derived-values/derived-signals`, `/concepts/derived-values/memos`, `/reference/basic-reactivity/create-memo`.

## 5. `useCallback`

React:

```tsx
const onSave = useCallback(() => save(draft), [draft]);
```

Solid:

```tsx
const onSave = () => save(draft());
```

Mistake: wrapping handlers in a memo or adding a dependency list. The component runs once, so the function is created once and reads the current `draft()` when called. Source: `/concepts/components/basics` (Component lifecycles).

## 6. `useEffect` with dependencies

React:

```tsx
useEffect(() => {
  document.title = `${count} clicks`;
}, [count]);
```

Solid:

```tsx
import { createEffect } from "solid-js";

createEffect(() => {
  document.title = `${count()} clicks`;
});
```

Mistake:

```tsx
createEffect(() => { document.title = `${count()} clicks`; }, [count]);
```

There is no dependency array: an effect tracks every signal it reads. The second argument of `createEffect` is the **initial value** passed to the first run, so passing a deps array silently does something else. An effect runs once after rendering, then once per batch of changes; the order between effects is not guaranteed. Effects never run during SSR. Source: `/concepts/effects`, `/reference/basic-reactivity/create-effect`.

## 7. Effect cleanup

React:

```tsx
useEffect(() => {
  const id = setInterval(tick, delay);
  return () => clearInterval(id);
}, [delay]);
```

Solid:

```tsx
import { createEffect, onCleanup } from "solid-js";

createEffect(() => {
  const id = setInterval(tick, delay());
  onCleanup(() => clearInterval(id));  // runs before the next run and on disposal
});
```

Mistake:

```tsx
createEffect(() => {
  const id = setInterval(tick, delay());
  return () => clearInterval(id);  // NOT a cleanup: the return value is passed to the next run
});
```

Source: `/reference/lifecycle/on-cleanup`, `/reference/basic-reactivity/create-effect` (Parameters: `fn`).

## 8. Mount and unmount

React:

```tsx
useEffect(() => {
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}, []);
```

Solid:

```tsx
import { onCleanup, onMount } from "solid-js";

onMount(() => window.addEventListener("resize", onResize));
onCleanup(() => window.removeEventListener("resize", onResize));
```

Mistake: returning a cleanup function from `onMount`. It does not register cleanup; use `onCleanup` (inside `onMount` or at the component's top level). `onMount` does not track and runs once; refs are already assigned when it runs. Code that is safe to run during setup (such as `setInterval`) can also sit directly in the component body with an `onCleanup` next to it. Source: `/reference/lifecycle/on-mount`, `/concepts/effects` (Lifecycle functions).

## 9. Explicit dependencies and skipping the first run

React:

```tsx
const first = useRef(true);
useEffect(() => {
  if (first.current) { first.current = false; return; }
  log(userId, filter);   // re-run only when userId changes
}, [userId]);
```

Solid:

```tsx
import { createEffect, on } from "solid-js";

createEffect(on(userId, id => log(id, filter()), { defer: true }));
```

`on(deps, fn)` tracks only `deps`; everything read inside `fn` is untracked. `{ defer: true }` skips the initial run. For a single untracked read inside a normal effect, use `untrack(() => filter())`. With stores, pass an accessor: `on(() => state.a, ...)`, not `on(state.a, ...)`. Source: `/reference/reactive-utilities/on-util`, `/reference/reactive-utilities/untrack`.

## 10. `useLayoutEffect`

React:

```tsx
useLayoutEffect(() => setWidth(box.current!.offsetWidth), []);
```

Solid:

```tsx
let box!: HTMLDivElement;
onMount(() => setWidth(box.offsetWidth));
return <div ref={box}>...</div>;
```

Mistake: reaching for `createRenderEffect` to get "layout" timing. It runs during the render phase, before refs are assigned and before the DOM is connected. `createEffect` and `onMount` already run after the DOM is created and before paint. Source: `/reference/basic-reactivity/create-effect` (Execution timing), `/reference/secondary-primitives/create-render-effect`.

## 11. State synced in an effect

React (an anti-pattern there too):

```tsx
const [message, setMessage] = useState("");
useEffect(() => setMessage(count > 10 ? "Too high" : ""), [count]);
```

Solid:

```tsx
const message = createMemo(() => (count() > 10 ? "Too high" : ""));
```

Mistake: `createEffect(() => setMessage(...))`. Writing signals in effects causes extra updates and can loop. Derived state belongs in a memo or a derived function. Source: `/concepts/effects` (note), `/concepts/derived-values/memos` (Keep logic in memos).

## 12. Refs and `forwardRef`

React:

```tsx
const input = useRef<HTMLInputElement>(null);
useEffect(() => input.current?.focus(), []);
const renders = useRef(0);
return <input ref={input} />;
```

Solid:

```tsx
let input!: HTMLInputElement;     // definite assignment for TypeScript
onMount(() => input.focus());
let clicks = 0;                    // a mutable box is just a variable: the body runs once
return <input ref={input} />;
```

Callback form, when you need the element at creation: `ref={el => (input = el)}`. For an element that may come and go (inside `<Show>`), store it in a signal: `const [el, setEl] = createSignal<HTMLElement>(); <p ref={setEl} />`.

Forwarding:

```tsx
// React
const Canvas = forwardRef<HTMLCanvasElement>((props, ref) => <canvas ref={ref} />);

// Solid: ref arrives as a prop
function Canvas(props: { ref?: HTMLCanvasElement | ((el: HTMLCanvasElement) => void) }) {
  return <canvas ref={props.ref} />;
}
```

Mistake: `input.current`, `useRef`, or reading `input` in the component body. Refs are assigned during rendering; read them in `onMount`, an effect, or an event handler. Do not use `document.querySelector` for elements Solid renders. Source: `/concepts/refs`, `/reference/jsx-attributes/ref`.

## 13. Props: reading, defaults, rest, children

React:

```tsx
function Button({ label, size = "md", children, ...rest }: Props) {
  return <button class={size} {...rest}>{label}{children}</button>;
}
```

Solid:

```tsx
import { children, mergeProps, splitProps } from "solid-js";

function Button(props: Props) {
  const merged = mergeProps({ size: "md" }, props);
  const [local, rest] = splitProps(merged, ["label", "size", "children"]);
  const content = children(() => local.children);
  return (
    <button class={local.size} {...rest}>
      {local.label}
      {content()}
    </button>
  );
}
```

Mistake:

```tsx
function Button({ label }: Props) { ... }   // destructured in the signature: frozen
const label = props.label;                  // copied at setup: frozen
```

Read `props.x` where it is used (JSX, effects, memos) or wrap it: `const label = () => props.label`. Reading a prop once to seed local state is fine and intentional: `createSignal(props.initialValue)`. Passing `value={count()}` to a child stays reactive, because the child reads `props.value` lazily. Use `children()` when `props.children` is read more than once or inspected, so children are not created again. Source: `/concepts/components/props`, `/reference/reactive-utilities/merge-props`, `/reference/reactive-utilities/split-props`, `/reference/component-apis/children`, `/reference/reactive-utilities/untrack` (Notes).

## 14. Context

React:

```tsx
const CounterContext = createContext<CounterValue | null>(null);
function CounterProvider({ children }) {
  const [count, setCount] = useState(0);
  return <CounterContext.Provider value={{ count, setCount }}>{children}</CounterContext.Provider>;
}
```

Solid:

```tsx
import { createContext, createSignal, useContext, type ParentProps } from "solid-js";

const CounterContext = createContext<[() => number, { increment(): void }]>();

export function CounterProvider(props: ParentProps) {
  const [count, setCount] = createSignal(0);
  const value: [() => number, { increment(): void }] = [count, { increment: () => setCount(c => c + 1) }];
  return <CounterContext.Provider value={value}>{props.children}</CounterContext.Provider>;
}

export function useCounter() {
  const ctx = useContext(CounterContext);
  if (!ctx) throw new Error("useCounter must be used inside CounterProvider");
  return ctx;
}
```

Mistake: putting `count()` (the value) in the context value, which hands consumers a frozen number. Pass the getter (or a store) so consumers stay reactive. Without a default value, `useContext` returns `undefined` outside a provider; wrap it in a helper that throws. Define the context in its own module so its identity stays stable. For multiple values, the docs recommend a store. Source: `/concepts/context`, `/reference/component-apis/create-context`.

## 15. Conditional rendering

React:

```tsx
if (!user) return <Login />;
return (
  <>
    {isAdmin && <AdminBar />}
    {status === "loading" ? <Spinner /> : status === "error" ? <Error /> : <Data />}
  </>
);
```

Solid:

```tsx
import { Match, Show, Switch } from "solid-js";

return (
  <Show when={user()} fallback={<Login />}>
    {u => (
      <>
        <Show when={u().isAdmin}><AdminBar /></Show>
        <Switch fallback={<Data />}>
          <Match when={status() === "loading"}><Spinner /></Match>
          <Match when={status() === "error"}><Error /></Match>
        </Switch>
      </>
    )}
  </Show>
);
```

Mistake:

```tsx
if (!user()) return <Login />;   // evaluated once at setup: never switches after login
```

The callback child of `<Show>` receives an accessor of the narrowed (non-null) value; with `keyed`, it receives the value itself and re-renders when the value changes. Without `keyed`, `<Show>` re-renders only when truthiness changes. Ternaries and `&&` inside JSX are reactive too, but `<Show>` / `<Switch>` are the idiomatic, more readable form. Source: `/concepts/components/basics` (Conditional rendering), `/concepts/control-flow/conditional-rendering`, `/reference/components/show`.

## 16. Lists

React:

```tsx
<ul>{todos.map((t, i) => <li key={t.id}>{i}: {t.title}</li>)}</ul>
```

Solid:

```tsx
import { For, Index } from "solid-js";

<ul>
  <For each={todos()} fallback={<li>No todos</li>}>
    {(todo, i) => <li>{i()}: {todo.title}</li>}
  </For>
</ul>

<Index each={names()}>
  {(name, i) => <input value={name()} />}
</Index>
```

| | `<For>` | `<Index>` |
| --- | --- | --- |
| Keyed by | item identity | position |
| `item` | value | accessor: `item()` |
| `index` | accessor: `i()` | number: `i` |
| Use for | arrays of objects whose order or length changes | primitives or inputs at stable positions whose content changes |

Mistake: `{todos().map(t => <li key={t.id}>...)}` — Solid has no `key` prop. `<For>` and `<Index>` are the list primitives: `<For>` moves an item's existing node when the item changes position, and `<Index>` updates content in place. Also: using `i` as a number in `<For>` or `item` as a value in `<Index>`. Source: `/concepts/control-flow/list-rendering`, `/reference/components/for`, `/reference/components/index-component`.

## 17. Events

React:

```tsx
<button onClick={e => { e.stopPropagation(); select(id); }}>Pick</button>
```

Solid:

```tsx
<button onClick={() => select(id)}>Pick</button>            // delegated (common events)
<button onClick={[select, id]}>Pick</button>                 // bound data: select(id, event)
<button on:click={e => { e.stopPropagation(); pick(); }}>   // native listener
<div on:scroll={onScroll}>...</div>                          // events that are not delegated
```

Mistakes:

- `stopPropagation()` in a delegated `onClick` does not stop native listeners on ancestors, because delegated handlers are attached to `document`. Use `on:click` when propagation control matters.
- Expecting a handler to swap when a signal holding it changes. Handlers are not reactive; call the current one: `onClick={() => props.onSelect?.()}`.
- `onChange` on a text input fires on blur, as in plain DOM. Use `onInput` for per-keystroke updates.
- `on:` names are case-sensitive; `onX` delegated names are not. Rare events (`mousemove` you only need briefly) are better as native `on:` listeners.

Source: `/concepts/components/event-handlers`.

## 18. Form inputs

React:

```tsx
<input value={query} onChange={e => setQuery(e.target.value)} />
```

Solid:

```tsx
<input value={query()} onInput={e => setQuery(e.currentTarget.value)} />
```

Mistake: `value={query}` (the getter), or `onChange` expecting React's per-keystroke behavior. Source: `/reference/basic-reactivity/create-memo` (Basic usage), `/concepts/components/event-handlers` (onInput / onChange).

## 19. Attributes: class, style, for, innerHTML

React:

```tsx
<label htmlFor="name" className={active ? "tab active" : "tab"} style={{ fontSize: 14, marginTop: 4 }} />
<div dangerouslySetInnerHTML={{ __html: html }} />
```

Solid:

```tsx
<label for="name" class="tab" classList={{ active: active() }} style={{ "font-size": "14px", "margin-top": "4px" }} />
<div innerHTML={html()} />
```

Mistakes:

- `className`, `htmlFor`, camelCase style keys, or numbers without units. Solid follows HTML: `class`, `for`, dash-case keys with string values.
- Mixing a reactive `class` with `classList`: when `class` changes, it overwrites the whole attribute and drops the `classList` classes. Keep `class` static (or put a computed `class` before `classList`).
- `classList` does not work through a prop spread or in `<Dynamic>`.
- `innerHTML` with unsanitized user data is a security hole.

Source: `/concepts/components/class-style`, `/concepts/understanding-jsx`, `/reference/jsx-attributes/innerhtml`, `/reference/component-apis/create-unique-id` (label `for`).

## 20. Data fetching

React:

```tsx
const [user, setUser] = useState<User>();
const [loading, setLoading] = useState(true);
useEffect(() => {
  setLoading(true);
  fetchUser(id).then(u => { setUser(u); setLoading(false); });
}, [id]);
```

Solid:

```tsx
import { createResource, ErrorBoundary, Suspense } from "solid-js";

const [user, { refetch, mutate }] = createResource(() => props.id, fetchUser);

return (
  <ErrorBoundary fallback={err => <p>Failed: {String(err)}</p>}>
    <Suspense fallback={<p>Loading…</p>}>
      <h1>{user()?.name}</h1>
    </Suspense>
  </ErrorBoundary>
);
```

Mistake: fetching in `createEffect` and writing signals by hand. `createResource` refetches when the source changes, skips the fetch when the source is `undefined`, `null` or `false`, exposes `loading`, `error`, `state` and `latest`, and integrates with `<Suspense>`. `mutate` updates the value optimistically; `refetch` re-runs the fetcher. Source: `/reference/basic-reactivity/create-resource`, `/guides/fetching-data`.

## 21. `lazy`, `Suspense`, error boundaries

React:

```tsx
const Chart = React.lazy(() => import("./Chart"));
<ErrorBoundaryClass fallback={<Oops />}><Suspense fallback={<Spin />}><Chart /></Suspense></ErrorBoundaryClass>
```

Solid:

```tsx
import { ErrorBoundary, lazy, Suspense } from "solid-js";

const Chart = lazy(() => import("./Chart"));   // module must export the component as default
<ErrorBoundary fallback={(err, reset) => <button onClick={reset}>Retry</button>}>
  <Suspense fallback={<Spin />}>
    <Chart />
  </Suspense>
</ErrorBoundary>
```

Differences to remember: `Chart.preload()` starts loading without rendering. `<ErrorBoundary>` is a built-in component; its function fallback receives `reset`. It does **not** catch errors thrown in event handlers or in callbacks scheduled outside Solid's render/update flow. `onMount` and effects inside a suspended subtree run after the boundary resolves. Source: `/reference/component-apis/lazy`, `/reference/components/error-boundary`, `/reference/components/suspense`.

## 22. Dynamic components and portals

React:

```tsx
const Tag = isLink ? "a" : "button";
return <Tag {...rest}>{label}</Tag>;
return createPortal(<Modal />, document.body);
```

Solid:

```tsx
import { Dynamic, Portal } from "solid-js/web";

return <Dynamic component={isLink() ? "a" : "button"} {...rest}>{label}</Dynamic>;
return <Portal mount={document.body}><Modal /></Portal>;
```

Mistake: `const Tag = isLink() ? "a" : "button"` in the body — picked once at setup. `<Portal>` defaults to `document.body`; events from inside it propagate through the component tree, not the DOM tree. Source: `/reference/components/dynamic`, `/reference/components/portal`.

## 23. `useTransition`, `useId`, batching

React → Solid:

```tsx
const [isPending, startTransition] = useTransition();   // React: isPending is a boolean
const [pending, start] = useTransition();               // Solid: pending is an accessor → pending()
await start(() => setUserId(2));                        // Solid: start returns a Promise

const id = useId();                                     // React
const id = createUniqueId();                            // Solid
```

Batching: React batches state updates automatically. Solid batches inside effects, `onMount` and a single store setter call; elsewhere, wrap several signal writes in `batch(() => { ... })` so downstream computations run once. Inside an async `batch`, only writes before the first `await` are batched. Source: `/reference/reactive-utilities/use-transition`, `/reference/component-apis/create-unique-id`, `/reference/reactive-utilities/batch`.
