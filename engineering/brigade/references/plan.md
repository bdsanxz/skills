# The plan

`plan.json` is written by `brigade init` and edited by you. It holds the criteria, the orders, and the graph they form. The script keeps its own record of trees, rounds and merges in `state.json` beside it; do not edit that file.

## The file

| Field | Holds |
| --- | --- |
| `run` | The run name. It is part of every branch name: `brigade/<run>/<order>`. Written by `init`. |
| `task` | The task in one line. Every work order carries it. |
| `repo` | The repository, relative to the plan's own directory. Written by `init`; leave it. |
| `base` | The branch or commit the run starts from. The integration branch is created from it. |
| `source` | The user's plan or tickets, when the orders and their dependencies are taken from one. Empty when you mapped the graph yourself. |
| `trees` | Where the trees go, relative to the plan's directory. `trees` unless you have a reason. |
| `setup` | The commands a fresh checkout needs before its gates can pass. Every work order carries them. |
| `gates` | The commands that decide whether the code is sound. Every work order carries them. |
| `conventions` | The patterns every part follows: the layout, the naming, how a part is added, the commands. Every work order carries them. Written from the code that exists: the project's own, or the merged foundation. |
| `criteria` | The criteria, each with an `id` and its `text` word for word, and the `source` file it was taken from. Change a text only when the user changed the criterion. |
| `orders` | The orders. |

## An order

| Field | Holds |
| --- | --- |
| `id` | Lowercase letters, digits and `-`. The id of the ticket when the order is one (`t038`), or else what it builds (`orders-api`). |
| `title` | A few words, for the work order's heading and the merge commit. |
| `goal` | What the subagent builds, in full. It knows nothing else about the task: name the behavior, the inputs and outputs, the files to read first, and what is out of scope. |
| `covers` | The ids of the criteria this order must meet. |
| `support` | Used when `covers` is empty: why the order exists although it meets no criterion by itself. A foundation order usually has one. |
| `owns` | The files and folders the order may create, change and delete, relative to the repository root. A folder covers everything under it. `.` is the whole repository. |
| `after` | The ids of the orders that must be merged before this one starts. |
| `foundation` | `true` for an order that sets up what the others build on. Foundation orders run one at a time, in the order they are listed, and every other order waits for the last one. You do not write these edges in `after`. |
| `checks` | What you will run or look at when the order comes back. The subagent is told to do the same before reporting. |
| `notes` | What you fixed for this order: an interface it shares with another order, a port or a database name that is its own, a decision the user made. |
| `dropped` | The reason, when the order was given up. A dropped order covers nothing, cannot be started, and nothing may come after it. Keep it in the plan as a record. |

## An example

A task with three criteria in a project that does not exist yet. `scaffold` and `contract` are the foundation and run one after the other. `api` and `web` then run at the same time. `flow` joins them.

```json
{
  "format": "brigade/plan@1",
  "run": "checkout",
  "task": "Build the checkout: an orders API, a checkout page, and the flow between them.",
  "repo": "../../..",
  "base": "main",
  "source": "",
  "trees": "trees",
  "setup": ["npm ci"],
  "gates": ["npm test", "npm run lint", "npm run typecheck"],
  "conventions": [
    "One workspace per part under packages/; shared types come from packages/contract only.",
    "A test sits beside its file as <name>.test.ts."
  ],
  "criteria": [
    {"id": "c1", "text": "POST /orders answers 201 with the order's id.", "source": "docs/checkout.md"},
    {"id": "c2", "text": "The checkout page shows the total with tax.", "source": "docs/checkout.md"},
    {"id": "c3", "text": "An order placed on the page appears in the list.", "source": "docs/checkout.md"}
  ],
  "orders": [
    {
      "id": "scaffold",
      "title": "Scaffold the workspace",
      "goal": "Create an npm workspace with the packages api, web and contract, one test runner, one linter and one type check for all of them, and the scripts test, lint and typecheck at the root.",
      "covers": [],
      "support": "Every other order builds in this workspace and runs these gates.",
      "owns": ["."],
      "foundation": true,
      "checks": ["npm ci in a fresh tree, then each gate, passes with one sample test per package"]
    },
    {
      "id": "contract",
      "title": "Shared order types",
      "goal": "In packages/contract, define the types Order, OrderItem and NewOrder, and the request and response of POST /orders and GET /orders.",
      "covers": [],
      "support": "The api and the page are built at the same time and must agree on these types.",
      "owns": ["packages/contract"],
      "foundation": true,
      "checks": ["the types compile; nothing outside packages/contract changed"]
    },
    {
      "id": "api",
      "title": "Orders API",
      "goal": "In packages/api, implement POST /orders and GET /orders on the types of packages/contract, storing orders in memory.",
      "covers": ["c1"],
      "owns": ["packages/api"],
      "checks": ["start the server on port 4101 and POST an order with curl: 201 and an id"],
      "notes": "Use port 4101 for anything you start."
    },
    {
      "id": "web",
      "title": "Checkout page",
      "goal": "In packages/web, build the checkout page: the items, the total with tax, and a button that posts the order through the client in packages/contract.",
      "covers": ["c2"],
      "owns": ["packages/web"],
      "checks": ["open the page on port 4102: the total with tax is shown for the sample cart"],
      "notes": "Use port 4102 for anything you start. Tax is 11% of the subtotal, rounded to the cent."
    },
    {
      "id": "flow",
      "title": "Order flow, end to end",
      "goal": "Add an end-to-end test that places an order on the page against the real api and finds it in the list.",
      "covers": ["c3"],
      "owns": ["tests/e2e"],
      "after": ["api", "web"],
      "checks": ["the end-to-end test passes with both servers started by the test itself"]
    }
  ]
}
```

For this plan `brigade check` prints: `order of work: scaffold -> contract -> api, web at once -> flow.`

## What `brigade check` refuses

- a criterion that no order covers;
- an order that covers no criterion and gives no `support`;
- an order with no `goal` or no `owns`;
- orders that wait for each other in a circle;
- two orders that could run at the same time and own a path in common: the same path, or a folder and something under it;
- a foundation order that comes `after` an order that is not foundation;
- an order that comes `after` a dropped order, an unknown order, or itself;
- a path in `owns` that is absolute or leaves the repository.

It notes, without refusing: a plan with no foundation order, a plan with no gates, and a plan in which no two orders can run at the same time.

`brigade start` runs the same check, and starts no order while a problem stands.
