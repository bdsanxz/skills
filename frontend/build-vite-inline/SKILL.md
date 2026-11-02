---
name: build-vite-inline
description: Build any Vite web project into one self-contained HTML file with all its code, styles, and assets inside, encoded behind a small loader and optionally obfuscated. The file works wherever a single HTML page can be opened or hosted, and is compatible with Google Gemini Canvas. Use when the user wants a Vite app as a single file, asks to inline or encode a Vite build, needs one portable HTML file (for Gemini Canvas or any other host), or wants to check or decode a file made this way.
---

# Build Vite Inline

Turn the user's Vite project into `dist/index.html`: one file that holds the whole app and runs on its own, opened from disk, served by any static host, or pasted into Gemini Canvas. Only production builds change, so the development server stays readable.

`<skill>` below means this skill's directory. Run every script by its absolute path, from the project directory. If the user only wants to check or decode an existing file, go to Phase 4.

## Phase 1: Choose the layers

1. Find the project: `vite.config.*`, `index.html`, and the installed Vite version. Vite 6, 7, and 8 are supported. If there is no Vite project, create one with the user's framework, or plain JavaScript if they named none. On an older Vite, tell the user it is untested and upgrade only if they agree.
   Note from the request where the file will run. If the user names Gemini Canvas, the Canvas-specific steps below apply; otherwise skip them.
2. Choose one encode plugin. Use `vite-plugin-inline-hex-base64.mjs` without asking, unless the user asks for another:

   | Plugin file | Factory | Encoding | File size |
   | --- | --- | --- | --- |
   | `vite-plugin-inline-hex-base64.mjs` | `inlineHexBase64()` | hex, then base64 (default) | about 2.67× |
   | `vite-plugin-inline-hex.mjs` | `inlineHex()` | hex | 2× |
   | `vite-plugin-inline-base64.mjs` | `inlineBase64()` | base64 | about 1.34× |
   | `vite-plugin-inline-xor.mjs` | `inlineXor()` | XOR, then base64; the key is inside the file | about 1.34× |

   Never use two encode plugins: the build refuses it.
3. Add an obfuscation layer only if the user asks for it. Say what it costs first. Both need a development dependency.
   - To hide the decode method, add `vite-plugin-inline-obfuscate.mjs`, factory `inlineObfuscate()`. The payload stays byte-for-byte and the file grows by a few hundred bytes.
   - To hide the app's own code, add `vite-plugin-inline-obfuscate-app.mjs`, factory `inlineObfuscateApp()`. Builds take longer, the file grows, and fragile apps can break. Inline scripts must share state through `window.*`, not bare globals.

## Phase 2: Install the plugins

1. Copy the chosen plugin files from `<skill>/scripts/` into the project root. `inline-check.mjs` stays in the skill.
2. If an obfuscation layer was chosen, run `npm install -D javascript-obfuscator`. The encode plugins need no dependency.
3. Import each plugin as a default import in `vite.config`, creating `vite.config.js` if the project has none. List them after the app's own plugins, in this order:

   ```js
   import inlineHexBase64 from './vite-plugin-inline-hex-base64.mjs';

   plugins: [...appPlugins, inlineObfuscateApp(), inlineHexBase64(), inlineObfuscate()]
   ```

   Leave out the layers you did not choose. The plugins set the single-file build options themselves, so do not add a single-file plugin or set those options by hand.

## Phase 3: Build

1. Run the project's production build, or `npx vite build` if it has none.
2. If the build stops, do what its message says, then rebuild. If the message is not enough, read the trace at `<cacheDir>/<plugin-name>-trace.jsonl`, which is `node_modules/.vite/` by default. It names the failed stage, with file names and sizes only.

   | The build refuses | Fix |
   | --- | --- |
   | More than one HTML input | Keep one `index.html` and import everything else |
   | An external script | Install the package and import it |
   | An external stylesheet | Install or save it locally and import it. Only fonts from `fonts.googleapis.com` and `api.fontshare.com` may stay on the web, which keeps the file working in Gemini Canvas too |
   | A local picture, font, or file in markup or CSS that nothing imports | Import it from source |
   | A file in `publicDir` | Move it into the source tree, import it, and set the reference from the imported value. A `src="/logo.png"` in markup must change too |
   | A web worker | Import it with `?worker&inline` |
   | An HTML file with no doctype | Put `<!doctype html>` first |

   Pictures by remote URL, and very large runtime data such as model or wasm files, may stay on the web. Never put a secret in the app.

## Phase 4: Verify the file

1. Run `node <skill>/scripts/inline-check.mjs dist/index.html --check`. Exit 0 prints the layers and sizes. Exit 1 means the file skipped the plugins: fix the config and rebuild, never patch the file. Exit 2 is a usage error and says what to do.
2. To inspect the contents, run `node <skill>/scripts/inline-check.mjs dist/index.html --decode <readable.html>`, with the output outside `dist/`. If the project has a source linter, run it on this decoded file, because on the built file it sees only the loader.
3. Serve the file with `npx vite preview` and exercise the app's main path with a browser tool. Without one, confirm the first render with headless Chrome or Edge using `--dump-dom --virtual-time-budget=5000`, and report the interactions as not verified instead of writing a browser driver. If an obfuscation layer breaks the app, remove that layer, rebuild, and tell the user.
4. For Gemini Canvas only: compare the file size with 800 KB, the largest Canvas app known; Canvas's own limit is unknown. Over that, make the app smaller and rebuild, or warn the user if it cannot shrink. Other hosts need no size check.

## Phase 5: Hand over

Tell the user:

- the absolute path of `dist/index.html`, its size, and the layers it holds;
- what you verified in Phase 4, and what you did not;
- to change the source and rebuild for every change, because editing the output by hand does not last;
- that encoding and obfuscation are not protection: anyone can decode the file and read the running code.

If the file is for Gemini Canvas, also tell the user:

- to paste the whole file into the code view of a one-line placeholder page in Canvas, never into the chat box, and to paste again after every rebuild;
- that nothing is proved in Canvas until they paste it and report what they saw. This includes Canvas's AI, storage, and network access.

A comment placed before `<html>` ends up inside `<head>`. Mention this only if the project has one.
