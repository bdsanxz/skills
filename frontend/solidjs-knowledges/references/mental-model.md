# The Solid mental model, against React habits

Most Solid bugs written by React-trained agents come from one wrong assumption: that the component function runs again when state changes. In Solid it never does. Read this file before writing any Solid code.

Facts are taken from the official Solid docs (`solidjs/solid-docs`, Solid 1.x, checked 2026-11-03). Paths in "Source" lines are relative to `https://docs.solidjs.com`.

## 1. A component runs once

| React | Solid |
| --- | --- |
| The component function re-runs on every state or prop change. | The component function runs **once**, when the component is first rendered. It is never re-run. |
| The body is the render function. | The body is **setup code**: create signals, stores, memos, effects, and return JSX. |
| Fresh closures, values and handlers on every render. | One closure for the component's whole life. A `let` variable persists; a function defined in the body is created once. |

Consequences:

- A value read at the top level of the component body is read **once** and never updates: `const doubled = count() * 2` is frozen.
- An `if (...) return ...` before the JSX is evaluated once. Conditions belong inside the returned JSX (`<Show>`, `<Switch>`, or an expression).
- `useCallback`, `useMemo` for referential stability, `React.memo`, and dependency arrays have no purpose: there is no re-render to protect against.

Source: `/concepts/components/basics` (Component lifecycles, Conditional rendering).

## 2. Reactivity comes from signals read inside tracking scopes

A signal is a getter/setter pair. **Calling** the getter inside a tracking scope subscribes that scope to the signal. When the signal is set, only the subscribed scopes re-run, and only the affected DOM nodes change.

Tracking scopes:

- JSX expressions: `{count()}`, `class={...}`, `value={...}`, and props passed to components.
- `createEffect`, `createMemo`, `createRenderEffect`, `createResource`'s source.
- The `when` / `each` props of control-flow components.

Not tracking scopes:

- The component body outside JSX and outside the primitives above.
- Event handlers (they read the current value when they run, which is fine, but they never re-run on change).
- `onMount` and anything wrapped in `untrack`.

A **derived signal** (`const double = () => count() * 2`) is a plain function: it does not cache, and it is reactive only when called inside a tracking scope. `createMemo` caches and recomputes only when its dependencies change.

Sources: `/concepts/signals`, `/concepts/derived-values/derived-signals`, `/concepts/derived-values/memos`, `/concepts/effects`.

## 3. Keep the getter, not the value

The reactive connection is the getter call. Anything that turns the getter into a plain value breaks it:

- Destructuring props: `const { name } = props` or `const name = props.name` — frozen.
- Destructuring a store: `const { user } = store` at the top level — frozen.
- Passing `count` (the function) where a value is expected, or `count()` at the top level where a live value is expected.

Keep reads late: `props.name` in JSX, `() => props.name` as a local accessor, `store.user.name` in JSX.

Source: `/concepts/components/props` (Destructuring props), `/concepts/stores` (Accessing store values).

## 4. Effects are for side effects only

Effects track automatically — there is no dependency array. They run once after rendering (before paint, refs already set) and again when a tracked value changes. Derived state belongs in a memo, not in an effect that sets a signal: an effect that writes signals causes extra updates and can loop.

Sources: `/concepts/effects`, `/reference/basic-reactivity/create-effect`, `/concepts/derived-values/memos` (Best practices).

## 5. JSX produces real DOM

Solid's JSX compiles to real DOM nodes, not a virtual DOM. There is no diffing pass, so:

- Attribute names follow HTML: `class`, `for`, dash-case `style` keys.
- Lists need `<For>` / `<Index>` to update efficiently; there is no `key` prop.
- A JSX value stored in a variable is a real element that exists once. Rendering it twice moves it.

Sources: `/concepts/understanding-jsx`, `/concepts/components/class-style`, `/concepts/control-flow/list-rendering`, `/concepts/refs` (JSX as a value).

## 6. Ownership and cleanup

Every component, effect and memo is an owner. `onCleanup` registers cleanup on the current owner: in a component it runs on unmount, in an effect it runs before the effect's next run and on disposal. "Mounted" means rendered into the reactive tree, not necessarily attached to the page.

Sources: `/reference/lifecycle/on-cleanup`, `/reference/lifecycle/on-mount`.
