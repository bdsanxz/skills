---
name: nextjs-knowledges
description: Find accurate, version-matched facts about Next.js and follow its official best practices, instead of relying on training data that may predate the installed version. Use when writing, reviewing, debugging or upgrading code in a Next.js project, when answering a question about a Next.js API, convention or error, or when the user names nextjs-knowledges.
---

# Next.js knowledges

Next.js changes often: APIs, conventions and file structure may differ from your training data. Treat what you remember as a guess until a version-matched source confirms it. This skill gives you everything the Next.js-managed agent rules in `AGENTS.md` would, so follow it whether or not the project has that block.

## Workflow

1. Read the installed `next` version from `package.json` and the lockfile, or from `node_modules/next/package.json`. In a monorepo, resolve it from the app's own directory, not the repository root.
2. Read the project's own agent instruction files (`AGENTS.md`, `CLAUDE.md` or similar) in the app directory and above it, and follow the project-specific rules in them. You do not need a Next.js-managed block there: the next step tells you where the version-matched docs are.
3. Note whether the app uses the App Router (`app/`), the Pages Router (`pages/`) or both. Read only the docs for the router the code uses.
4. Before you write or change code that uses a Next.js API, read the relevant guide from the first of these sources that exists:
   - **Bundled docs** in `node_modules/next/dist/docs/`, resolved from the app's directory (in a monorepo, the `next` package may not be visible from the repository root). They match the installed version exactly and need no network. Their layout mirrors the docs site: the App Router, the Pages Router and architecture, each split into getting started, guides and API reference. Search them with `grep` or `find` for the API or file convention you need.
   - **Project-local docs** that older versions may have downloaded, such as `.next-docs/`.
   - **Online Markdown docs**. Append `.md` to any `https://nextjs.org/docs/...` URL, or send `Accept: text/markdown`. Use `https://nextjs.org/docs/llms.txt` as the index, and `https://nextjs.org/docs/llms-full.txt` for the full text. The online docs track the latest version, so check each page's version history and notes against the installed version.
   - **Error pages** under `https://nextjs.org/docs/messages/<error-name>`. They are online only. Read the one that an error's `Learn more` link names.
5. Treat the docs as the authority:
   - Heed deprecation notices and version history tables. Prefer the pattern the docs mark as current.
   - When the docs and your memory disagree, the docs win. Tell the user when an API they asked for is deprecated or has changed.
   - Cite the doc you relied on (path or URL) when you explain a decision.
6. Write the change with the canonical pattern from the guide you read, not a remembered variant. Stay within the router and features the project already uses. Do not enable an experimental flag or adopt a new feature unless the user asks for it.
7. When an error offers labeled fixes (for example, stream behind `<Suspense>`, cache the data, or allow a blocking route), read its error page, pick the fix whose trade-off fits the user's goal, and say which one you chose and why.
8. Verify the change against the running app. Do not assume it works:
   - Reuse the running dev server. Read `.next/dev/lock` for its URL and PID. If you run `next dev` while one is already running, it prints the existing server's URL instead of starting a second one. Do not stop the user's server.
   - Read the `next dev` terminal output. It includes browser console errors and warnings, so client-side failures show up there too.
   - If the dev server exposes the Next.js MCP endpoint (`/_next/mcp`), use it to list routes, read server logs, and check compilation issues for a route, instead of running a full `next build` after every edit.
   - Load the changed route and confirm the expected UI and behavior. Use a browser tool when one is available to inspect the DOM, console and network.
   - Run `next build` before you finish when the change affects prerendering, caching or routing. If a prerender error is hard to trace, run `next build --debug-prerender` for source-mapped stacks and to keep checking the other routes.
9. Report what you verified and how. State plainly anything you could not verify.
10. For larger work, use the official tooling instead of improvising:
    - **Upgrades**: prefer `next upgrade --agent`, which gathers the version-matched migration guides. Otherwise, follow the upgrading guide for the target version and verify the app afterwards.
    - **Multi-step migrations and optimizations** (such as adopting a new rendering or caching model across an app, or reducing bundle size): check whether the official Next.js Skills (`https://github.com/vercel/next.js/tree/canary/skills`) cover the task, and suggest installing the matching one with `npx skills add vercel/next.js --skill <name>`.
