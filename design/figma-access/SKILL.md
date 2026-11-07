---
name: figma-access
description: |
  Read and change Figma designs from the shell, without an MCP server, through the `figma-access` CLI. From a Figma URL and a personal access token it reads any file through the REST API (frames, exact node styles, rendered images, original image fills), with no Figma Desktop needed; with the Desktop Bridge plugin running in Figma Desktop it also runs Figma Plugin API code in the open file, exports screenshots, reads the selection, console logs and changes, and manages variables, components, FigJam boards and Slides. Use when the user shares a Figma link or asks to inspect, implement in code, export, create, edit, audit or screenshot something in Figma, to work with Figma variables, tokens or components, or names this skill.
---

# Figma access

You work with Figma through one command-line tool. It prints KDL and saves its data files as `.kdl`: one node per line, with a node's plain fields as `key=value` on that line, so `grep`, `awk` and `sed` work on it directly. The exceptions are `spec`, which prints its own one-line-per-node text outline, `daemon log`, which prints the daemon's log lines as they are, and `render`, `screenshot`, `image-fills` and `compare`, which save image files (their summary on stdout is still KDL). It has two ways in:

- **REST** (`file`, `node`, `spec`, `render`, `image-fills`, `api`): reads any file from its URL with the user's token. Nothing has to be open. Reads are cached locally and retried on rate limits.
- **Plugin** (`exec`, `screenshot`, `selection`, `logs`, `changes`, `call`): a background daemon talks to the Desktop Bridge plugin running in Figma Desktop. This is the only way to change a file. Your main tool here is `exec`, which runs Figma Plugin API JavaScript in the file.

`references/tips.md` holds lessons from real runs, by situation. They are guidance, not rules: read the section for the situation you are in, and adapt it to your case.

## Rules

- **Never show the token.** Do not print, echo or log it; test it with `figma-access api /v1/me`.
- **Look before and after you change anything.** Judge every visible result on an image, not on the code that made it.
- **Read values, don't guess them; the render decides.** Take colors, sizes, spacing, fonts and text from the file, never by eye from an image. When the file's data and the render disagree, the render is what the user sees.
- **Change only what the user asked for.** Reading is always fine. Never delete or overwrite the user's existing work unless the request says so.
- **A timeout is not a failure.** Figma cannot stop a running script; check `logs` and the file before running it again.

## Workflow

### 1. Set up

1. `<skill>` is the directory of this `SKILL.md`. Run the tool as `bun <skill>/scripts/figma-access.js COMMAND ...`; this file writes it as `figma-access COMMAND ...`. It runs on Bun, not Node: always start it with `bun`, never `node`, and run any JavaScript or TypeScript helper you write with `bun` too. To shorten the command, define a shell function at the start of each shell call (`fa(){ bun <skill>/scripts/figma-access.js "$@"; }; fa ...`), not a variable: zsh does not split a variable into words. Quote every URL and node id you pass: `?`, `&` and `;` are special to the shell. If `bun` is missing, tell the user to install it from https://bun.sh and stop.
2. Run `figma-access --help` once, and `figma-access <command> --help` before the first use of each command. Exit codes: 0 ok, 1 Figma reported a failure, 2 bad arguments, 3 daemon, plugin or token not available. "Reading the output" in `references/tips.md` explains the format and how to search it.
3. Choose the path from the request, as "Choosing a path" in `references/tips.md` describes: a URL and a read-only job → REST; any change to the file → plugin; both may be used together.

### 2a. Connect through REST

1. Run `figma-access api /v1/me`. On "no token": find where the user set it and load it in the same command, as "Token" in `references/tips.md` describes. Ask the user for a token (Figma: Settings > Security > Personal access tokens, file content read) only when none is set anywhere.
2. Run `figma-access file <url>` to see the pages and top-level frames. Pick the node to work on, following "Finding the right node" in `references/tips.md`.

### 2b. Connect through the plugin

1. Run `figma-access status`. It starts the daemon when needed.
   - Files listed: go on.
   - No files: run `figma-access files`, which waits for the plugin. If it exits with 3, run `figma-access setup` and give the user its `steps` in plain words: import the plugin once from the printed manifest path, then run **Plugins > Development > Figma Desktop Bridge** in the file and keep its window open. Ask the user to tell you when it is running, then run `figma-access files` again.
2. More than one file connected: pass `--file <fileKey>` on every command after this.

### 3. Understand the design

1. Read the smallest view that answers the question, outline first and details only where you work:
   - structure: `figma-access node <url|key> <id> --outline 2` (REST), or the page-outline recipe in `references/plugin-api.md` (plugin);
   - everything code needs, one line per visible node: `figma-access spec <url|key> <id> -o <file>`; for a big frame, save it once with `node ... -o <file>` and pass `--from <file>` to every later `spec`, as "Rate limits and the cache" in `references/tips.md` describes;
   - what the user means by "this" or "the selected": `figma-access selection`;
   - how it looks: `figma-access render <key> <id>` (REST, exact size) or `figma-access screenshot <id>` (plugin), then open the image.
2. Read the `reports` of `node`: fonts, image fills, and how many hidden layers were pruned. Read "Hidden layers" and "Reading a design image" in `references/tips.md`.
3. For components, variants, variables and styles, read their real structure before you change or copy them, and reuse what exists instead of creating duplicates.

### 4. Do the job

**Implement a design in code.** Before you write code, read "From design to code" in `references/tips.md`: most of the differences that remain after a first build (image crops, fonts, text offsets, page width) are covered there. Write the code where the user or their project says it belongs (the path they name, or the project's own structure); `_swe/figma-access/` holds only working artifacts such as renders, saved node files, specs, screenshots and scripts.

1. Render the frame at scale 1 as the reference, and read it in parts when it is tall. Save the frame's node data once with `node <url> -o <node file>`.
2. Generate the starting page with `figma-access spec <key> <frame id> --from <node file> --html <dir>`, with `<dir>` where the page belongs. It writes `index.html` and its `assets/`: auto layout as flex from its rules, children of groups and frames without auto layout at their boxes, page-wide sections that span the window around a centred content column, live text, and Figma's own renders of icons, masks and image layers. The first run renders and downloads every asset, which takes about a minute for a long page. It prints, per font, whether Google Fonts has it; a family Google does not have gets the Google family whose texts come out closest in width as a stand-in, behind the design's family. It also prints notes on what it could only approximate. Start from this page instead of writing your own generator. When the project needs another form (components, a framework), port it section by section and keep its values.
3. For each family `--html` reports as not on Google Fonts, look in the project for its files and add them with `@font-face` under the design's family name; ask the user, in one message, for the ones still missing, and for anything else you cannot get from the file. Until they arrive, or when you cannot ask, keep the stand-in `--html` chose and name it in the report.
4. Measure the page against the reference with `figma-access compare <reference.png> <page> --nodes <node file> --wide <px> --apply-css`: it captures the page, prints the differing pixels per section of the frame with the shift that explains each one, how far each text style and node sits off, and which are missing, writes a difference image, and checks a wider window. With `--nodes` it takes the sections from the frame's own children and crops a reference that the frame's shadow widened. With `--apply-css` it writes the offsets it measured for each text style into the page, in a `<style id="figma-access-css">` block that later runs rewrite; run it again to measure the page with them.
5. The generated page is where the work starts, not the result. After the text offsets are in, fix the worst section first, starting from the notes `--html` printed and every part marked `LAYOUT DRIFT`; read that section's values with `spec <key> <section id> --from <node file>`. Put your own CSS in a block of its own, outside `figma-access-css`, and edit the generated page instead of generating it again, which would undo your changes. Keep auto layout as flex from its rules and do not position every node absolutely at its stored box: that copies every stale box and breaks when a text runs longer. Look at the capture and the difference image too, cutting your views of the design from the `reference.png` that `compare` saved, so they line up with the capture, and repeat until each section matches.
6. Do not stop at the generated page. Keep refining until every section differs by less than 5%, or until, for each section still above that, you have looked at its capture and difference image, tried a fix, and can name what is left and why (a font that is not loaded, an image crop that is not in the data, a gradient or blur tone). Keep the numbers of every pass for the report. Leave out device or browser chrome, and keep the page adapting to the window unless the user asks for a fixed width. When the user asks for a pixel-perfect or 1:1 result and a skill for that is listed in your session, use it with these renders as the design images.

**Change the file.** Through the plugin:

1. Write the change as Plugin API code and run it with `figma-access exec`, following `references/plugin-api.md` for what the API enforces and for placement. Long code goes in a working file (for example under `_swe/figma-access/`) and runs with `exec -f`. Always `return` the ids you need next; add `--timeout 30s` or more for long work.
2. For jobs a ready-made plugin routine covers (component sets, lint and accessibility audits, image fills, annotations, FigJam and Slides helpers), use `figma-access call <METHOD> '<json>'`; `figma-access methods <filter>` lists the params.
3. Read the output every time: on `ok #false`, fix the cause and remove partial work before retrying; on a `warning` under `resultAnalysis`, check ids and names; for the script's own trace, `figma-access logs --since 2m`.
4. Screenshot every node you created or changed (`--scale 2` for small ones) and check it against the request. Fix and screenshot again; after three rounds that still miss, tell the user what is left and why.

"Working through the plugin" in `references/tips.md` covers what usually goes wrong here.

### 5. Report

Tell the user what you read or changed, with node names and ids, and the paths of the renders, screenshots and files you wrote. Name anything you did not do, every assumption you made (a substitute font, a skipped hidden layer, left-out chrome), and what was not verified. After implementing a design, give the differing share per section for the first and the last pass, and the cause of each section still at 5% or more.

## Troubleshooting

- **"Rate limit exceeded" (429):** the CLI already waited and retried. Follow "Rate limits and the cache" in `references/tips.md`, and wait a minute before the next large read.
- **Exit 3, no file connected:** the plugin is not running in that file, or is still searching (it checks every few seconds). Ask the user to run it again. `figma-access daemon log` shows connections as they happen.
- **Another tool uses the same plugin** (such as figma-console-mcp): both work side by side; `figma-access status` shows whether this daemon has the file.
- **Stale behaviour after the skill was updated:** run `figma-access setup` again, ask the user to re-import the manifest in Figma, then run `figma-access daemon restart`.
- **"Plugin disconnected before it answered":** the user closed the plugin or the file, or the plugin reloaded. Check the file before you repeat the change.
