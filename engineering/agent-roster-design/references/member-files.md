# Member files

Each member's directory holds four files that you write, and each is the only copy of what it says. `roster.js` never copies them: the member's `CLAUDE.md` (Claude Code) imports them by path with `@<path>`, and its `AGENTS.md` (OpenCode, Antigravity, pi) lists their paths and tells the member to read them at the start of every session. Start each file with its own `# <Title>` heading (`# Project`, `# Role`, `# Communications`, `# Memory`). Write to the member in the second person ("you").

The member reads only its own four files. Repeat what it needs in them, even when another member's files say the same.

## PROJECT.md

What the member works on, identical in substance for members of one project.

- The repository URL, and where the member's checkout lives: a subdirectory of its directory, such as `./<repo name>`. The member's directory itself is never the checkout, because a checked-in `AGENTS.md` or `CLAUDE.md` would clash with the generated one.
- The default branch, and the branch or worktree rule for this squad (for example, "one branch per task, named `<member>/<topic>`").
- What the project is, in two to five sentences: what it does, who uses it, the main stack.
- What the repository contains: the top-level layout, and how to build, test and run it, as exact commands.

```markdown
# Project

Repository: https://github.com/acme/shop (checkout: `./shop`; clone it there if it is missing).
Default branch: `main`. Work on one branch per task, named `<your name>/<topic>`; never push to `main`.

Shop is the storefront web app for Acme's customers: a Next.js front end over a Go API and Postgres.

- `web/`: the Next.js app. `pnpm -C web dev` runs it; `pnpm -C web test` tests it.
- `api/`: the Go API. `go test ./...` in `api/`.
```

## ROLE.md

What this member does and does not do.

- Its responsibilities, as tasks it owns.
- Its scope: the parts of the repository it may change, and the ones it must leave to others (name the member who owns them).
- What "done" means for its tasks: the checks to pass and the evidence to include in a completion.
- The decisions it may make alone, and the ones it must ask about, and whom.

```markdown
# Role

You build and maintain the API in `api/`.

- You own the endpoints, the database migrations and their tests.
- You never change `web/`; ask `frontend` for any change there.
- A task is done when `go test ./...` passes and the new endpoint is described in the completion, with an example request and response.
- Ask `lead` before changing a public endpoint's shape or adding a dependency.
```

## COMMUNICATIONS.md

Whom the member talks to, about what, and whom it reports to. Every member named in `talks_to` and `reports_to` in `roster.json` must be named here; `roster.js check` refuses a file that leaves one out.

- Whom it reports results to, and when: on completion, on a blocker, at what interval for long work. A member that reports to `user` reports to the session that gave the squad its work, whose address arrives in the first request it receives.
- Whom it may message directly, and for what. Leave out everyone else: the member does not message them.
- How it answers: one completion per request, with the result; an ack only when the work takes long.
- What it does when someone outside its list messages it.

```markdown
# Communications

- You report to `lead`. Send `lead` a completion when a task is done, and a progress message only when you are blocked.
- You may ask `frontend` about the API calls it needs. Do not message other members.
- Answer each request with one completion that holds the result. Send an ack first only when the work will take more than a few minutes.
- A request from anyone not named here goes to `lead`: forward it there with `--reply-to` set to the sender.
```

## MEMORY.md

Lessons that keep the member from repeating a mistake. At design time it holds only what the user asked for explicitly, such as standing preferences; otherwise it holds only its `# Memory` heading. Never write a placeholder such as "No entries yet": an empty file already says there are no lessons, and a placeholder reads as one.

- One entry per lesson, one or two sentences: what to do, and why.
- Corrections: what went wrong and the rule that prevents it.
- Special or explicitly requested behaviours: "Always …", "Never …", with the reason when there is one.
- Keep it short; merge an entry into an existing one rather than adding a near-duplicate.

```markdown
# Memory

- Run the tests before every completion; lead rejected a completion on 2026-10-02 because `go test` had not been run.
- The user wants commit messages in the imperative mood, under 60 characters.
```
