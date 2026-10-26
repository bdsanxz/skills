# Finding skills for a member

Use this to choose a member's skills besides `peers`, which every member gets without asking. You only find and propose skills here. What the user agrees to goes into the member's `skills` in the roster, and `roster.js build` installs it into the member's cwd. Never install a skill globally (`-g`), and never install one the user has not agreed to.

## 1. Work out what the member needs

From the member's role, name:

- the domain: for example React, Go, testing, design, deployment;
- the specific tasks: for example writing end-to-end tests, reviewing pull requests, writing a changelog;
- whether the task is common enough that a skill likely exists. Skip the search for a member whose work is ordinary coding in a stack its agent already knows well, and say so.

## 2. Check the leaderboard first

Read the skills.sh leaderboard at `https://skills.sh/` with your web-fetch tool, or `curl -sL https://skills.sh/` and strip the HTML. It ranks skills by total installs, so the most used and tested skills come first. Its topic pages (React, Next.js, Design & UI, Testing, Databases and others) list the leading skills in each area.

Well-known sources include `vercel-labs/agent-skills` (React, Next.js, web design) and `anthropics/skills` (frontend design, document processing, web app testing).

## 3. Search, when the leaderboard does not cover the need

```bash
npx -y skills@latest find <query> [--owner <owner>]
```

Always pass a query: without one, `find` opens an interactive picker. It prints one result per skill as `<owner/repo@skill> <installs>`, followed by its skills.sh link.

| Need | Query |
| --- | --- |
| A faster React app | `find react performance` |
| Pull request reviews | `find pr review` |
| A changelog | `find changelog` |

Query ideas by category:

| Category | Queries |
| --- | --- |
| Web development | react, nextjs, typescript, css, tailwind |
| Testing | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| Documentation | docs, readme, changelog, api-docs |
| Code quality | review, lint, refactor, best-practices |
| Design | ui, ux, design-system, accessibility |
| Productivity | workflow, automation, git |

- Use specific keywords: `react testing` finds more relevant skills than `testing`.
- Try other terms when a search finds nothing: `deployment` or `ci-cd` instead of `deploy`.
- Search a trusted owner directly with `--owner`, for example `--owner vercel-labs`.

## 4. Check quality before proposing a skill

Never propose a skill from the leaderboard or search results alone. Open its page, `https://skills.sh/<owner>/<repo>/<skill>`, which shows its installs, the repository's GitHub stars and its security audits, and check:

- **Installs:** prefer 1K or more. Be cautious below 100.
- **Source:** official sources, such as `vercel-labs`, `anthropics` and `microsoft`, are more trustworthy than unknown authors.
- **GitHub stars:** treat a repository with fewer than 100 stars with skepticism.
- **Security audits:** drop a skill whose audits do not pass.

Confirm that the skill exists under that name: `npx -y skills@latest add <owner/repo> --list`.

A skill that fails the installs, source or stars check can still be proposed when nothing better exists, but say which check it fails. A skill whose audits do not pass is never proposed.

## 5. Propose the options

For each skill you propose, give its name and what it does for this member, its install count and source, the command `build` will run in the member's cwd, and its skills.sh link:

```text
For `web`, "vercel-react-best-practices" gives React and Next.js performance
guidelines from Vercel Engineering (810K installs, vercel-labs/agent-skills,
32K stars, audits pass).

Install (in web's cwd): npx -y skills@latest add vercel-labs/agent-skills --skill vercel-react-best-practices -a antigravity -y --copy
Learn more: https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

Then ask which of them the member gets, with your recommendation first. A skill the user accepts goes into the member's roster entry as `{"source": "<owner/repo>", "skill": "<skill>"}`. `build` installs it in the member's cwd with `npx -y skills@latest add <owner/repo> --skill <skill> -a <agent> -y --copy`, where `<agent>` is the skills CLI's name for the member's agent: `claude-code` for claude, `opencode` for opencode, `antigravity` for agy. Do not run the install yourself.

## 6. When nothing fits

1. Say that you found no existing skill for the need, and what you searched for.
2. Propose that the member works without one, from its ROLE.md and its agent's own abilities.
3. If the user does this kind of work often, suggest writing a custom skill with `npx -y skills@latest init <skill-name>`, in a directory the user picks outside every member's cwd. Write it only after the user confirms the roster. Its absolute path is then the skill's `source` in the roster.
