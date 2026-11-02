# obf-app report: optional app-code obfuscation before the encode step

Goal: a NEW, separate, optional Vite plugin that minifies+obfuscates the APP's own JavaScript BEFORE the encode step, so that after decode the running app's identifiers are mangled instead of readable in DevTools. Distinct from the existing loader-only obfuscator.

Verdict: built, verified, all green. No blocking issues.

## What was built

New file (standalone, ~280 lines, no imports from sibling plugins):
- `/Users/budisantoso/Dev/bdsanxz/SWE/skills/prompting/based-on-gemini-canvas/scripts/vite-plugin-inline-obfuscate-app.mjs`
- name `inline-obfuscate-app`, default export `inlineObfuscateApp()`, build-only via `apply: (_, env) => env.command === 'build' && !env.isSsrBuild`.
- Mirrors `scripts/vite-plugin-inline-obfuscate.mjs`: `StageError`, async `createTracer` (JSONL at `<cacheDir>/inline-obfuscate-app-trace.jsonl`, names/counts/sizes only, no code), `loadObfuscator(root)` (bare import, then project root, then cwd; fails clearly with `npm install -D javascript-obfuscator`), `WARN_BYTES = 800*1024`, no `console.*`.
- Three trace stages: `find-html`, `obfuscate-chunks`, `obfuscate-inline`.
- Pipeline, each layer independently optional: `vite build` -> `inline-obfuscate-app` (app JS) -> one encode plugin (`hex`/`hex-base64`/`base64`/`xor`) -> `inline-obfuscate` (loader, optional). Installed as `plugins: [..., inlineObfuscateApp(), inlineHexBase64(), inlineObfuscate()]`.
- Ordering: same `enforce: 'post'` as the siblings, runs before the encode plugin's `generateBundle` by plugin-array order. Verified empirically three ways: (1) decoded output contains mangled names, which is only possible if obfuscation ran before inlining; (2) a dev test builds `[encode, obfuscateApp]` (reversed) and asserts the loader is left untouched plus a warning naming the correct order; (3) a `looksEncoded` guard (one `<script>` + `document.currentScript` + `document.write(`) warns and skips instead of touching a loader.
- Scope: ALL bundled JS chunks (vanilla-with-imports, React, Vue, Svelte, Solid) and inline `<script>` without `src` whose type is empty/`module`/`text/javascript`/`application/javascript`. Skips `application/json`, `importmap`, `text/plain`, any `<script src>`, and empty bodies. Sourcemap assets are deleted with the chunk maps (obfuscated code invalidates them; the encode pipeline disables sourcemaps anyway).
- NEVER touches the encoded payload or the loader. The 4 encode plugins, the loader obfuscate plugin, and their shared byte-identical block are unmodified (the byte-identical test still passes inside the 112-green suite).
- Chunk options: `renameGlobals: false` (Vite's minifier already took top-level names; cross-chunk imports keep working). Inline options: `renameGlobals: true` (Vite never minifies inline scripts; needed so e.g. voxel `SWAY` disappears).
- Common options: `compact: true` (covers minify), fixed `seed` base `0x0a9f5c`, `target: 'browser'`, `controlFlowFlattening: false`, `deadCodeInjection: false`, `debugProtection: false`, `disableConsoleOutput: false`, `identifierNamesGenerator: 'hexadecimal'`, `numbersToExpressions: false`, `renameProperties: false`, `selfDefending: false`, `simplify: true`, `splitStrings: false`, `stringArray: true`, `stringArrayThreshold: 1`, `transformObjectKeys: false`.

## Decisions on ambiguous points (recorded per brief)

- `javascript-obfuscator` was already pinned at 5.9.0 in `dev/vite-plugin-inline/package.json` and installed in `tools/v6`, `tools/v7`, `tools/v8`: no install was needed.
- Real trace from a passing build (`tools/v8/node_modules/.vite/inline-obfuscate-app-trace.jsonl`):

```json
{"time":"2026-11-02T02:48:22.650Z","plugin":"inline-obfuscate-app","stage":"find-html","status":"ok","duration":0.4,"details":{"files":1,"chunks":0}}
{"time":"2026-11-02T02:48:23.547Z","plugin":"inline-obfuscate-app","stage":"obfuscate-chunks","status":"ok","duration":896.7,"details":{"files":0,"chunks":0,"bytesBefore":0,"bytesAfter":0}}
{"time":"2026-11-02T02:48:25.590Z","plugin":"inline-obfuscate-app","stage":"obfuscate-inline","status":"ok","duration":2043.3,"details":{"files":1,"scripts":4,"skipped":0,"bytesBefore":51203,"bytesAfter":88134}}
```

- No `stringArrayEncoding`: string literals move into the string table (relocated, still greppable there); the goal and proof concern identifiers, and encoding would not hide runtime values in DevTools anyway.
- Multiple HTML inputs are tolerated (every `.html` asset processed); the encode plugin still enforces singleness with the better message.
- `dev/inline-plugin-verify` boundary: the standing rule said read-only, but this task explicitly ordered extending `build-matrix.mjs`, so I extended it additively only (new variant rows + `MATRIX_OUT` override, 12 added lines, nothing else touched) and merged results back preserving the original 27 rows. No fixture, app, tool, or other harness file was modified. Scratch pilot/bisect scripts were removed afterwards.
- `check-prompts.mjs` was deliberately NOT extended with obfuscation rules (not requested; "obfuscate" alone stays a legal generic verb in stories).

## Bugs found while tuning (all fixed, all in the file)

1. Same-seed string-table collision: two scripts obfuscated with the same seed overwrite each other's string table at runtime (`TypeError ... reading 'wkkbkkw'`). Isolated by bisect (each script clean alone, broken together). Fix: per-call seeds, `seedBase + counter` following bundle order, counter reset per build -> deterministic and collision-free.
2. `identifierNamesGenerator: 'mangled'` restarts helper names at `a`/`b` on EVERY call regardless of seed, so collisions persisted across seeds. Measured: `mangled-shuffled` also collides (`L` vs `L`); `hexadecimal` differs per seed (`_0x2aa0` vs `_0x1213`). Fix: `hexadecimal`.
3. The obfuscator normalises string escapes (`<\/script>` comes back as `</script>`), which would end the inline element early. Fix: same `escapeJs` as the encode plugins on inline output plus an asserting refusal as canary.
4. False alarm, not a bug: matrix `sha` column is SHA-1 while my manual hashes were SHA-256. Same size + different string sent me debugging; direct byte diffs proved artifacts identical twice, then `sha1` matched the matrix value exactly. Determinism was never broken.

## Verification: build matrix (the main job)

Extended `dev/inline-plugin-verify/build-matrix.mjs` with 8 combos per encode (`<enc>-appobf` = app-obfuscate before encode; `<enc>-appobf-obf` = plus loader obfuscation last), tag still the encode plugin so must-fail rows match its messages. Ran one process per Vite version, all fixtures, in parallel:

```sh
cd skills/prompting/based-on-gemini-canvas/dev/inline-plugin-verify
MATRIX_OUT=/tmp/mx-v8a.json node build-matrix.mjs 8 "" "hex-appobf,hex-base64-appobf,base64-appobf,xor-appobf"
MATRIX_OUT=/tmp/mx-v8b.json node build-matrix.mjs 8 "inline,split,react" "hex-appobf-obf,hex-base64-appobf-obf,base64-appobf-obf,xor-appobf-obf"
# same pair with 7 and 6
```

Printed output (all six shards):

```text
132 plugin builds, 0 wrong   (v8a, v7a, v6a: every app x 4 appobf variants)
12 plugin builds, 0 wrong    (v8b, v7b, v6b: inline/split/react x 4 triple-stack)
```

432 plugin builds, 0 wrong: every valid app produced exactly one file with `check=0 decode=0` on Vite 6.4.5 / 7.3.7 / 8.3.5, and every must-fail app (`fail-*`, `no-doctype`, `fail-two-html`) was refused with the encode plugin's own staged message, e.g. `inline-hex-base64: [find-html] 2 HTML inputs (index.html, b.html)...` and `inline-hex-base64: [check-references] the build cannot become one Canvas file: ...`. Shard JSONs were merged into `tools/matrix.json` preserving the original 27 rows (backup at `/tmp/matrix-orig.json`).

## Verification: Chrome equality via compare.mjs

```sh
node compare.mjs 8 "plain,inline,split,react,vue,svelte,solid,edge,large,lookalike,comment-before-html,ui-nocdn-1,ui-nocdn-2,ui-nocdn-3,ui-nocdn-4,ui-nocdn-5" "hex-appobf,hex-base64-appobf,base64-appobf,xor-appobf"
node compare.mjs 8 "inline,split,react" "hex-appobf-obf,hex-base64-appobf-obf,base64-appobf-obf,xor-appobf-obf"
# same pair with 7 and 6
```

Printed tallies:

```text
v8a: 80 comparisons, 4 not the same   (all comment-before-html, the known DIFF)
v8b: 15 comparisons, 0 not the same   (triple-stack, pixel retries: none)
v7a: 80 comparisons, 5 not the same   (4 known + 1 pixel flake, see below)
v7b: 15 comparisons, 0 not the same
v6a: 80 comparisons, 5 not the same   (4 known + 1 pixel flake, see below)
v6b: 15 comparisons, 0 not the same
```

Zero `NO BUILD` / `MISSING` rows anywhere. Every SAME row shows `ex=0` (no new exceptions; ui pages carry their pre-existing `ex=1` equally on both sides), matching script order, `ls=1` where the app persists (react/vue/svelte/solid/split lazy), `clickchangedpx=true` where clicks change pixels, and identical DOM inside `<iframe sandbox="allow-scripts" srcdoc>`.

The two non-known DIFFs are both `ui-nocdn-4` pixel-only diffs (DOM identical, exceptions/order/storage identical), each on a different version+variant (`v7 xor-appobf`, `v6 hex-base64-appobf`), and each re-ran SAME in isolation:

```text
$ node compare.mjs 7 "ui-nocdn-4" "xor-appobf"
v7 ui-nocdn-4 xor-appobf: SAME [ex=1 order=0 ls=0 clickchangedpx=false]
2 comparisons, 0 not the same
$ node compare.mjs 6 "ui-nocdn-4" "hex-base64-appobf"
v6 ui-nocdn-4 hex-base64-appobf: SAME [ex=1 order=0 ls=0 clickchangedpx=false]
2 comparisons, 0 not the same
```

The control lines show these pages render non-deterministically on their own, e.g. `control ui-nocdn-4: 2 distinct pictures from 4 loads of one file` (also seen for ui-nocdn-1/2). Verdict: environmental pixel flake, not the plugin.

## Verification: mangling proof, determinism, size, ordering

Before/after grep on the voxel fixture (decoded output of `inline-hex-base64-appobf`):

```text
fixture: 18          # SWAY|PLANT|mulberry|vnoise occurrences in fixtures/voxel-garden.html
decoded: 0
loader file: 0
```

Determinism: rebuilt `tools/v8/work/inline-hex-base64-appobf` twice in place plus the dev-suite two-directory build — byte-identical every time (matrix SHA-1 `68e87847` stable across all runs; the earlier scare was my SHA-256 vs the harness SHA-1).

Size (largest combos, v8): `large-hex-base64-appobf` 2573409 bytes of file (964888 bytes HTML); `react-*-appobf-obf` ~450000 bytes. The plugin's own 800 KB warning fires as specified, verified by rebuild:

```text
inline-obfuscate-app: 1 HTML files: 0 chunks (0 to 0 bytes) and 2 inline scripts (961325 to 964785 bytes) obfuscated.
inline-obfuscate-app: the obfuscated app code is over 800 KB before encoding. The largest Canvas app known is about 800 KB; the final file will be larger still.
inline-hex-base64: the final file is over 800 KB. The largest Canvas app known is about 800 KB; Canvas's own limit is unknown.
```

Ordering: three independent proofs — (1) decoded output is mangled, possible only if obfuscation ran before inlining; (2) dev test builds `[encode, obfuscateApp]` reversed and asserts the loader is untouched plus the `must run BEFORE the encode plugin` warning; (3) same-`enforce: 'post'` array order, matching the documented install order.

## Verification: dev tests and docs

- `node --test --test-concurrency=1 vite-plugin-inline.test.mjs` in `dev/vite-plugin-inline`: **112 tests, 112 pass, 0 fail** (3 new: identifier mangling + staged trace, determinism, misorder warn-and-skip; `no plugin file uses console` extended to both obfuscate plugins; `javascript-obfuscator` was already a devDep, no package change).
- `node --test dev/based-on-gemini-canvas/*.test.mjs` in the skill dir: **54 tests, 54 pass, 0 fail**.
- Phase-7-style chain on a real default-plugin build: `inline-check.mjs --check` prints `HEX OK: ...`, `--decode` round-trips, `lint.mjs --app` on the decoded file gives `RESULT: 0 FAIL, 0 WARN`, `inspect.mjs --app` on the final file renders screenshots plus `report.json`.
- `references/local-build.md`: new paragraph for the optional plugin (separate, optional, before encode, needs the dependency, heavier, fragile-app warning with the `window.*` rule, still not encryption) plus two consistency fixes the new layer required ("add it last" -> order-aware wording; "only inline plugin meant to sit alongside another" -> both obfuscation layers stack with one encode plugin, never two encodes). Prompt 0 template + `zero()` fixture reworded the same way ("after any app-code plugins").
- Skill-wide re-check: remaining "stack" hits are layout vocabulary; `check-prompts.mjs` untouched by choice (see decisions).

## Files changed

- NEW `skills/prompting/based-on-gemini-canvas/scripts/vite-plugin-inline-obfuscate-app.mjs`
- `skills/prompting/based-on-gemini-canvas/dev/inline-plugin-verify/build-matrix.mjs` (+12 additive lines: 8 variant rows, `MATRIX_OUT`)
- `skills/prompting/based-on-gemini-canvas/dev/inline-plugin-verify/tools/matrix.json` (merged: original 27 rows + 540 new)
- `skills/prompting/based-on-gemini-canvas/dev/vite-plugin-inline/vite-plugin-inline.test.mjs` (+3 tests, import, console list)
- `skills/prompting/based-on-gemini-canvas/references/local-build.md` (new layer paragraph + 2 consistency fixes)
- `skills/prompting/based-on-gemini-canvas/references/prompt-format.md` + `dev/based-on-gemini-canvas/check-prompts.test.mjs` (`zero()`, 1 line each, same rewording)
- NEW this report. Repo is not git: nothing committed, per instruction.

## Unverified / blocking

No blocking issues. Not tested: a real paste into Canvas itself (standing note: code-view size acceptance, AI key supply) — same as the previous report; the skill's user decides.
