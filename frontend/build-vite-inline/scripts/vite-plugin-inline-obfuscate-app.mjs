// vite-plugin-inline-obfuscate-app: optional app-code obfuscation for the single-file build.
//
// The inline encode plugins (inline-hex, inline-hex-base64, inline-base64,
// inline-xor) inline every chunk and script into one HTML file. Vite minifies
// bundled chunks, but inline <script> in index.html (typical for single-file
// apps) reaches the file readable, and minified names still hint at structure.
// This plugin runs BEFORE the encode plugin and feeds the app's own JavaScript
// (bundled chunks and inline scripts) through javascript-obfuscator, so after
// decoding the running app's identifiers are mangled instead of readable in
// DevTools. Behaviour is unchanged: only names change, never logic.
//
// It is a separate, optional layer. Add it BEFORE the one encode plugin, with
// the loader obfuscation (when wanted) staying last:
//   plugins: [..., inlineObfuscateApp(), inlineHexBase64(), inlineObfuscate()]
// Leave it out and the app code stays as Vite built it. It runs only in
// production builds. Unlike the encode plugins, this one needs a dependency:
//   npm install -D javascript-obfuscator
//
// The obfuscator options stay deliberately milder than the loader's: renamed
// identifiers plus compact (which also minifies), but no control-flow
// flattening and no dead-code injection, so framework runtimes
// (React, Vue, Svelte, Solid) keep running and the file stays small. The seed
// is fixed, so an unchanged source gives byte-identical output on rebuild.
// Chunks keep renameGlobals off (Vite's minifier already took the top-level
// names, and cross-chunk imports must keep working); inline scripts rename
// globals because Vite never minifies them. The encoded payload and any loader
// are never touched: when the HTML already looks like an inline loader, this
// plugin warns and skips instead of obfuscating it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAG = 'inline-obfuscate-app';
const WARN_BYTES = 800 * 1024; // the largest Gemini Canvas app known is about 800 KB

// Loader signature: exactly one script that reads its own element and writes
// the decoded payload while the parser runs. Seeing it means the encode plugin
// already ran, so obfuscating now would only touch the loader.
const looksEncoded = (html) => (html.match(/<script\b/gi) ?? []).length === 1
  && /document\.currentScript/.test(html)
  && /document\.write\(/.test(html);

// Only real JavaScript is obfuscated: no src (external scripts are refused by
// the encode plugins anyway), and no JSON, import maps, or plain text.
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
// Obfuscated code goes back into HTML, so it needs the same escaping the
// encode plugins apply to inlined chunks: the obfuscator normalises string
// escapes (`<\/script>` comes back as `</script>`), which would end the
// element early, and a `<!--` in a string would flip the parser into its
// escaped state. `\/` and `\!` are identity escapes in JS strings, so the
// values the app sees are unchanged.
const escapeJs = (code) => code.replace(/<\/script/gi, () => '<\\/script').replace(/<!--/g, () => '<\\!--');

// Fixed options and seed base: the same input gives the same bytes, so an
// unchanged source never yields a new build. Every obfuscation call in one
// build takes seedBase + its own counter, because each output declares the
// same generated helper names: two scripts obfuscated with the same seed
// overwrite each other's string table at runtime. The counter follows bundle
// order, so rebuilds stay byte-identical. stringArray hides string literals next to
// the mangled identifiers; splitStrings and renameProperties stay off so
// nothing moves or renames across a boundary the obfuscator cannot see.
const BASE_OPTIONS = {
  compact: true,
  seed: 0x0a9f5c,
  target: 'browser',
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  // Hexadecimal, not mangled: mangled names restart at `a` on every call, so
  // two scripts in one page would overwrite each other's string table at
  // runtime. Hexadecimal names derive from the seed, and each call in a build
  // takes its own seed (see optionsFor), so outputs never share helpers.
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: false,
  renameGlobals: false,
  renameProperties: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayThreshold: 1,
  transformObjectKeys: false,
};
const CHUNK_OPTIONS = { ...BASE_OPTIONS };
const INLINE_OPTIONS = { ...BASE_OPTIONS, renameGlobals: true };

// A staged failure, recorded in the trace and ended in this.error.
class StageError extends Error {
  constructor(stage, message) { super(message); this.stage = stage; }
}

// Build-time trace with named stages, through Vite's logger. Names, counts and
// sizes only: never app code.
const createTracer = (tag, logger, traceFile, error) => {
  const log = logger ?? { info() {}, warn() {}, error() {} };
  const records = [];
  const write = () => {
    if (!traceFile) return;
    try {
      mkdirSync(dirname(traceFile), { recursive: true });
      writeFileSync(traceFile, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    } catch (writeError) {
      try { log.warn(`${tag}: could not write the trace file ${traceFile}: ${writeError.message}`); } catch {}
    }
  };
  return {
    path: traceFile,
    info: (message) => log.info(`${tag}: ${message}`),
    warn: (message) => log.warn(`${tag}: ${message}`),
    async run(name, details, fn) {
      const start = performance.now();
      const stop = (status, extra) => {
        records.push({ time: new Date().toISOString(), plugin: tag, stage: name, status, duration: Math.round((performance.now() - start) * 10) / 10, details: { ...details, ...extra } });
      };
      try {
        const info = {};
        const value = await fn((message) => { throw new StageError(name, message); }, info);
        stop('ok', info);
        return value;
      } catch (cause) {
        const expected = cause instanceof StageError;
        stop('fail', { error: String(cause?.message ?? cause).slice(0, 500), ...(expected ? {} : { stack: String(cause?.stack ?? '').slice(0, 2000) }) });
        write();
        if (expected) error(`${tag}: [${cause.stage}] ${cause.message}\nTrace: ${traceFile || '(no trace file: no cacheDir)'}`);
        else {
          const wrapped = new Error(`${tag}: [${name}] unexpected error: ${cause?.message ?? cause}\nTrace: ${traceFile || '(no trace file: no cacheDir)'}`);
          wrapped.cause = cause;
          error(wrapped);
        }
      }
    },
    close() { write(); },
  };
};

const sourceOf = (asset) => (typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString('utf8'));

// Load javascript-obfuscator from wherever the project keeps it: beside this file
// when it was copied into the project, else from the project root or the working
// directory. Returns null when it is not installed anywhere reachable.
const loadObfuscator = async (root) => {
  try { return await import('javascript-obfuscator'); } catch {}
  for (const base of [root, process.cwd()].filter(Boolean)) {
    try {
      const resolved = createRequire(join(base, 'noop.js')).resolve('javascript-obfuscator');
      return await import(pathToFileURL(resolved).href);
    } catch {}
  }
  return null;
};

export default function inlineObfuscateApp() {
  let logger = null;
  let cacheDir = '';
  let root = '';
  // One counter per obfuscation call in this build; each call's seed is
  // seedBase + counter, so no two outputs share generated helper names.
  let seedCounter = 0;
  const optionsFor = (base) => ({ ...base, seed: 0x0a9f5c + seedCounter++ });
  return {
    name: TAG,
    enforce: 'post',
    apply: (_, env) => env.command === 'build' && !env.isSsrBuild,
    configResolved(resolved) {
      logger = resolved.logger ?? null;
      cacheDir = resolved.cacheDir ?? '';
      root = resolved.root ?? '';
    },
    async generateBundle(_options, bundle) {
      seedCounter = 0;
      const traceFile = cacheDir ? join(cacheDir, `${TAG}-trace.jsonl`) : '';
      const tracer = createTracer(TAG, logger, traceFile, (e) => this.error(e instanceof Error ? e : new Error(e)));

      const found = await tracer.run('find-html', {}, (fail, info) => {
        const htmlNames = Object.keys(bundle).filter((name) => name.endsWith('.html'));
        if (htmlNames.length === 0) fail('no HTML file in the bundle. Add inlineObfuscateApp() before one inline encode plugin.');
        const chunks = Object.keys(bundle).filter((name) => bundle[name].type === 'chunk');
        info.files = htmlNames.length;
        info.chunks = chunks.length;
        const skipped = htmlNames.filter((name) => looksEncoded(sourceOf(bundle[name])));
        if (skipped.length) {
          tracer.warn(`the HTML already looks like an inline loader (${skipped.join(', ')}). inlineObfuscateApp() must run BEFORE the encode plugin: move it earlier in plugins and rebuild. Skipping so the loader is never touched.`);
        }
        return { htmlNames: htmlNames.filter((name) => !skipped.includes(name)), chunks };
      });

      const js = await tracer.run('obfuscate-chunks', { files: found.chunks.length }, async (fail, info) => {
        const mod = await loadObfuscator(root);
        if (!mod) fail('javascript-obfuscator is not installed. Run: npm install -D javascript-obfuscator');
        const JavaScriptObfuscator = mod.default ?? mod;
        let before = 0;
        let after = 0;
        for (const name of found.chunks) {
          const chunk = bundle[name];
          const code = chunk.code;
          before += Buffer.byteLength(code);
          let obfuscated;
          try {
            obfuscated = JavaScriptObfuscator.obfuscate(code, optionsFor(CHUNK_OPTIONS)).getObfuscatedCode();
          } catch (cause) {
            fail(`javascript-obfuscator could not transform ${name}: ${cause?.message ?? cause}`);
          }
          chunk.code = obfuscated;
          chunk.map = null;
          after += Buffer.byteLength(obfuscated);
        }
        for (const name of Object.keys(bundle)) {
          if (name.endsWith('.map') && bundle[name].type === 'asset') delete bundle[name];
        }
        info.chunks = found.chunks.length;
        info.bytesBefore = before;
        info.bytesAfter = after;
        return { before, after };
      });

      const inline = await tracer.run('obfuscate-inline', { files: found.htmlNames.length }, async (fail, info) => {
        const mod = await loadObfuscator(root);
        if (!mod) fail('javascript-obfuscator is not installed. Run: npm install -D javascript-obfuscator');
        const JavaScriptObfuscator = mod.default ?? mod;
        let scripts = 0;
        let skipped = 0;
        let before = 0;
        let after = 0;
        for (const name of found.htmlNames) {
          const asset = bundle[name];
          // One replacer for the whole element: the body is swapped in place, so
          // no tag soup, and $ patterns in app code stay literal. The closer is
          // captured, never sliced by length, so `</script >` survives as is.
          const out = sourceOf(asset).replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (tag, open, body, close) => {
            if (attr(open, 'src') !== undefined) return tag;
            if (!JS_TYPES.has((attr(open, 'type') ?? '').toLowerCase())) { skipped++; return tag; }
            if (!body.trim()) return tag;
            before += Buffer.byteLength(body);
            let obfuscated;
            try {
              obfuscated = JavaScriptObfuscator.obfuscate(body, optionsFor(INLINE_OPTIONS)).getObfuscatedCode();
            } catch (cause) {
              fail(`javascript-obfuscator could not transform an inline script in ${name}: ${cause?.message ?? cause}`);
            }
            const safe = escapeJs(obfuscated);
            if (/<\/script/i.test(safe)) fail(`obfuscated inline script in ${name} contains </script even after escaping; refusing to write a broken file. Report it with the trace file.`);
            scripts++;
            after += Buffer.byteLength(safe);
            return `${open}${safe}${close}`;
          });
          asset.source = out;
        }
        info.scripts = scripts;
        info.skipped = skipped;
        info.bytesBefore = before;
        info.bytesAfter = after;
        return { before, after, scripts, skipped };
      });

      tracer.close();
      const total = js.after + inline.after;
      if (found.chunks.length + found.htmlNames.length === 0 || (js.before === 0 && inline.before === 0)) {
        tracer.warn('nothing was obfuscated: no chunks and no inline scripts. Leave the plugin out of builds with no app code of their own.');
      } else {
        tracer.info(`${found.htmlNames.length} HTML files: ${found.chunks.length} chunks (${js.before} to ${js.after} bytes) and ${inline.scripts} inline scripts (${inline.before} to ${inline.after} bytes) obfuscated.`);
      }
      if (total > WARN_BYTES) tracer.warn('the obfuscated app code is over 800 KB before encoding. That is larger than any Gemini Canvas app known; the final file will be larger still.');
    },
  };
}
