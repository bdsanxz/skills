---
name: tdd
description: Implement a task with Test-Driven Development in Red-Green-Refactor cycles, committing every proven failing test as `[red]` and every passing implementation as `[green]`. Use when the user asks for TDD, test-driven or test-first development, red-green-refactor, or names this skill, for any feature, bug fix or behavior change in the implementation layer, such as business rules and application rules. Do not use for scaffolding and tooling work, such as project setup, linter configuration or pre-commit hooks, or for other work that has no testable behavior.
---

# TDD

Implement the task one small behavior at a time. Each behavior is one cycle: a test that fails (red), the code that makes it pass (green), then cleanup (refactor). Red and green are committed, because a test run proves each of them. Refactor has no commit of its own; it goes into the green commit.

## Scope

TDD applies only to the implementation layer: code whose behavior is defined and can be verified by a test, such as business rules and application rules.

Scaffolding and tooling are outside it: project setup, dependencies, linter and formatter configuration, pre-commit hooks, build and CI configuration, and the test runner's own setup. Do that work directly:

- Write no test for it and run no cycle. Never invent a test, such as one asserting that a config file exists, to give scaffolding a red commit.
- Commit it on its own, with an ordinary message in the project's style and no `[red]` or `[green]` prefix. Never put it inside a red or green commit.
- Finish and commit it before a cycle starts, not in the middle of one.

When a task mixes the two, split it: do the scaffolding directly, and run cycles for the behavior. When a task is scaffolding only, do it directly and run no cycle at all.

## Before the first cycle

1. Split the task by [Scope](#scope) into scaffolding and behavior.
2. Find out how the project tests: the runner, the command for a single test, the command for the full suite, and where tests live and how they are named. Follow those conventions. If the project has no test runner, set up the conventional one for its stack; that is scaffolding.
3. Run the full suite. If anything already fails, stop and tell the user: on a failing baseline no green can be proven.
4. Run `git status`. If the project is not a git repository, ask the user before creating one. If the tree holds changes that are not yours, leave them alone: in every commit below, stage only the files of the work being committed.
5. Break the behavior into a list of behaviors, each small enough for one test. Put the simplest case first (empty, zero, one), then order the rest so that each one forces the code to grow a little. For a bug fix, the first behavior is the bug itself: its test reproduces it. Revise the list as you learn.

## The cycle

### 1. Red

1. Take the next behavior from the list and write one test for it. Check the test against [Testing rules](#testing-rules) before running it.
2. Run that test. It must fail, and for the right reason: an assertion fails because the behavior is missing.
   - A syntax error, import error, missing symbol or broken setup is not red. Fix it until the failure is the assertion. When the code under test does not exist yet, add the emptiest stub that lets the test load and run: a signature with no logic.
   - A test that passes is not red. Do not commit it. Either it does not check what you meant, so rewrite it, or the behavior already exists, so drop the test and take the next behavior.
3. Run the full suite. The new test is the only failure.
4. Commit the test, with its stub if it needed one: `[red] <message>`.

### 2. Green

1. Write the minimum production code that makes the failing test pass. Write nothing for a behavior that has no test yet, however obvious it looks.
2. Leave the test as it is. If it cannot pass because it is wrong, the cycle goes back to red:
   1. Set the green-phase code aside, for example with `git stash`.
   2. Correct the test, run it, and confirm it fails for the right reason.
   3. Commit it: `[red] <message>`.
   4. Restore the code and continue green.
3. Run the full suite. Every test passes. Do not commit yet.

### 3. Refactor

1. With the suite green, clean up the code this cycle touched: duplication, names, structure.
2. Tests may be cleaned up too (names, shared setup, helpers), as long as every test still checks the same inputs against the same expected results.
3. Add no behavior. Anything that needs new behavior goes on the list and gets its own cycle.
4. Run the full suite after each change. If a test fails, undo that change; never edit a test to fit a refactor.
5. When the cleanup is finished and the full suite passes, commit the implementation and the refactoring together: `[green] <message>`. When nothing needs cleaning up, commit right away.

### 4. Repeat

Go back to Red with the next behavior. The task is done when the list is empty and nothing the task asks for is left without a test. Then run the full suite one last time and report to the user: the commits in order, and the final test result.

## Commits

- Cycles alternate in the history, one pair per behavior:

  ```
  [red] add failing test for empty cart total
  [green] return zero total for empty cart
  [red] add failing test for cart total with multiple items
  [green] sum item prices in cart total
  ```

- A `[red]` commit holds test code, plus a stub when the test needed one. A `[green]` commit holds the production code and the refactoring.
- The `[red]` message names what the test demands; the `[green]` message names the behavior that now works. After the prefix, follow the project's own message style.
- Inside a cycle, make no other commit: nothing goes between a `[red]` and its `[green]`. Scaffolding commits, which carry no prefix, sit between cycles.
- Never commit a state you did not just run: failing for `[red]`, fully passing for `[green]`.
- If a commit hook rejects a `[red]` commit because of the failing test, do not bypass the hook on your own. Ask the user how red commits are to be made in this project.

## Testing rules

Every test must protect something. A test that cannot catch a real defect is forbidden, however much it adds to the count. The examples are in JavaScript; apply the rules in the project's own language and test framework.

### No tautological tests

Never assert something that is always true, and never compute the expected value with the logic under test.

```js
// Bad: repeats the implementation, so it agrees with any bug they share
const items = [{ price: 5 }, { price: 7 }];
expect(cartTotal(items)).toBe(items.reduce((sum, item) => sum + item.price, 0));

// Good: states the expected value outright
expect(cartTotal([{ price: 5 }, { price: 7 }])).toBe(12);
```

### No false positives

Every test must be able to fail, and the red run is the proof. A test that passes before the implementation exists is invalid: rewrite it.

```js
// Bad: an empty stub returns undefined, so this passes with nothing implemented
expect(cartTotal([])).toBeFalsy();

// Good: fails against the stub, passes only when the behavior exists
expect(cartTotal([])).toBe(0);
```

### No testing the mock

Assert on observable behavior: outputs, state changes, side effects. Never assert only on a mock, stub or fixture you set up yourself, and never on implementation details.

```js
// Bad: checks the stub's own canned answer; no production code runs
const clock = { now: vi.fn().mockReturnValue(new Date("2026-01-02")) };
expect(clock.now()).toEqual(new Date("2026-01-02"));

// Good: the stub only feeds the code under test; the assertion is on its output
const clock = { now: () => new Date("2026-01-02") };
expect(isExpired({ expiresAt: new Date("2026-01-01") }, clock)).toBe(true);
```

When the call to a collaborator is itself the behavior, assert what it was called with, not merely that it was called. When that collaborator is an API service, the next rule decides how.

### No hand-made API mocks

A test that depends on an API service intercepts its requests at the network level, with a dedicated API mocking tool such as MSW (Mock Service Worker). Never mock the call by hand: do not stub `fetch`, replace the methods of an HTTP client, or write a fake service module. A hand-made mock replaces the code that builds the request and reads the response, so that code runs in no test.

- Use the API mocking tool the project already has. When it has none, add the standard network-level one for its stack (MSW in JavaScript and TypeScript) and wire it into the test setup; that is scaffolding, see [Scope](#scope).
- Make an unhandled request fail the test (in MSW, `onUnhandledRequest: "error"`), so that no test reaches a real service.
- Define each response in the test that depends on it, or in a handler shared by tests that need the same one.
- When the request itself is the behavior (an order placed, a payment charged), read it inside the handler and assert its method, URL and body.

```js
// Bad: fetch is stubbed, so the URL, the method and the response parsing are never exercised
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rate: 0.1 }) }));

// Bad: the HTTP client or the service module is replaced
vi.spyOn(axios, "get").mockResolvedValue({ data: { rate: 0.1 } });
vi.mock("./taxService", () => ({ getRate: async () => 0.1 }));

// Good: the real client code runs, and MSW answers at the network level
server.use(http.get("https://api.example.com/tax-rates/ID", () => HttpResponse.json({ rate: 0.1 })));
expect(await priceWithTax(200, "ID")).toBe(220);
```

### No meaningless assertions

When a specific expected value can be asserted, assert it.

```js
// Bad: passes for almost any return value
expect(() => parsePrice("Rp 12.500")).not.toThrow();
expect(parsePrice("Rp 12.500")).toBeDefined();

// Good
expect(parsePrice("Rp 12.500")).toBe(12500);
```

### No test changes to force a pass

In the green phase the test is fixed. Loosening an assertion, changing an expected value, or skipping or deleting the test to reach green is forbidden. A test that has to change was wrong: go back to red as described under Green.

```js
// Bad: weakened during green because the code returned 11.999999
expect(cartTotal(items)).toBeGreaterThan(0);

// Good: the test stays, and the code is fixed until it holds
expect(cartTotal(items)).toBe(12);
```

### No unnecessary tests

Each test covers a behavior no other test covers. If no defect could break the new test while leaving the existing ones green, do not write it.

```js
// Bad: the second test takes the same path as the first
test("sums two items", () => expect(cartTotal([{ price: 5 }, { price: 7 }])).toBe(12));
test("sums three items", () => expect(cartTotal([{ price: 1 }, { price: 2 }, { price: 3 }])).toBe(6));

// Good: the second test demands something new
test("sums two items", () => expect(cartTotal([{ price: 5 }, { price: 7 }])).toBe(12));
test("multiplies price by quantity", () => expect(cartTotal([{ price: 5, quantity: 3 }])).toBe(15));
```
