# Solid review checklist

Run every check against each Solid file you wrote or changed. Each item names the React habit, how to spot it, and the fix. The section numbers point to `concept-map.md`.

## Imports and React leftovers

- [ ] No import from `react`, `react-dom` or a React-only library. Search: `from "react`.
- [ ] No `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useLayoutEffect`, `forwardRef`, `React.memo`, `createPortal`. Search for each name.
- [ ] `createStore`, `produce`, `reconcile`, `unwrap` come from `solid-js/store`; `Portal`, `Dynamic`, `render` come from `solid-js/web`; everything else from `solid-js`.

## Reactivity

- [ ] Every signal and memo is **called** where its value is needed: `{count()}`, not `{count}`. (§2)
- [ ] No reactive value is read into a constant at the top level of a component and then used in JSX: `const x = count() * 2`, `const name = props.name`, `const { a } = props`, `const { user } = store`. (§2, §4, §13)
- [ ] Props are not destructured in the function signature. (§13)
- [ ] No early `return` that depends on a signal or prop before the JSX. (§15)
- [ ] No component chosen into a variable from reactive state (`const Tag = cond() ? A : B`). Use `<Dynamic>`. (§22)
- [ ] Context values pass getters or stores, not called values. (§14)

## Effects and lifecycle

- [ ] No dependency array passed to `createEffect` or `createMemo`. (§6)
- [ ] No cleanup returned from `createEffect` or `onMount`; cleanup uses `onCleanup`. (§7, §8)
- [ ] No effect whose only job is to set a signal from other signals; it is a `createMemo` or derived function. (§11)
- [ ] Memos are pure: no signal or store writes inside. (§4)
- [ ] Every timer, listener and subscription created in a component or effect has an `onCleanup`. (§7, §8)
- [ ] Data fetching uses `createResource`, not an effect that writes loading/data signals. (§20)
- [ ] `createRenderEffect` is not used to read refs or layout. (§10)

## State updates

- [ ] No in-place mutation of a signal's object or array (`list().push(x)`); updates go through the setter with a new value. (§3)
- [ ] No direct assignment to store properties; updates use the store setter, `produce` or `reconcile`. (§3)

## JSX

- [ ] Lists use `<For>` or `<Index>`; no `.map` with `key` in JSX. (§16)
- [ ] `<For>`: `index()` is called, `item` is not. `<Index>`: `item()` is called, `index` is not. (§16)
- [ ] `class` not `className`; `for` not `htmlFor`; style keys in dash-case with string values; `innerHTML` not `dangerouslySetInnerHTML`. (§19)
- [ ] A reactive `class` is not combined with `classList` on the same element. (§19)
- [ ] Text inputs update on `onInput`, not `onChange`. (§17, §18)
- [ ] `stopPropagation` that must block native ancestor listeners is on an `on:` handler. (§17)
- [ ] Refs: `let el!: T` + `ref={el}`, read in `onMount`, an effect or a handler; no `.current`, no `document.querySelector` for rendered elements. (§12)

## Verify

- [ ] The project's own type check, lint and build pass (for example `tsc --noEmit`, the lint script, `vite build`). Report the exact commands and their output.
