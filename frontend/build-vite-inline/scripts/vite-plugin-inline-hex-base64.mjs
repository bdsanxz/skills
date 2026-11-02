// vite-plugin-inline-hex-base64: single-file production-build plugin for any Vite web app.
//
// The production build gives one self-contained HTML file whose whole content is
// turned into hex and then base64. The final file holds only a minimal loader that
// decodes base64, then hex, while the parser is running, and writes the original
// HTML back. Copy this file into the Vite project and add it last in vite.config:
// plugins: [..., inlineHexBase64()]. It runs only in production builds; the dev
// server stays readable. Zero dependencies. This is the default: double obfuscation.
// For one layer only, use vite-plugin-inline-hex.mjs instead. Never stack inline plugins.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TAG = 'inline-hex-base64';

// === INLINE SHARED START ===
// Everything down to INLINE SHARED END is duplicated verbatim in the other
// inline plugin files, so each one works alone when copied.

const INLINE_LIMIT = 100 * 1024 * 1024; // every imported asset lands inside the file
const WARN_BYTES = 800 * 1024; // the largest Gemini Canvas app known is about 800 KB
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'api.fontshare.com']);

const isExternal = (value) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(?:data|blob):/i.test(value));
const isInlineRef = (value) => /^(?:data|blob):/i.test(value) || value.startsWith('#') || value === '';
const hostOf = (value) => (value.match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#:]+)/i) ?? [])[1]?.toLowerCase();
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
const stripAttrs = (attrs, ...names) => attrs.replace(new RegExp(`\\s*\\b(?:${names.join('|')})(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'gi'), '').trim();
// Rollup/Vite output holds no ">" inside these tags' quotes, so a flat match is enough.
const bundleKey = (value) => decodeURIComponent(value.split(/[?#]/)[0].replace(/^\//, ''));

const escapeJs = (code) => code.replace(/<\/script/gi, () => '<\\/script').replace(/<!--/g, () => '<\\!--');
const escapeCss = (css) => css.replace(/<\/style/gi, () => '<\\/style');
// The loader's parser is already inside <head> when it writes the payload, so
// whitespace a fresh parse drops before <head> would survive as text nodes.
// Walk only the leading doctype, comments, <html>, and <head>, and drop the
// whitespace around them; the page may omit any of these tags. Whitespace after
// <head> is kept, since a fresh parse keeps it too. A comment before <html>
// still lands in <head>.
const stripHeadWhitespace = (html) => {
  const lead = html.match(/^(?:\s*(?:<!doctype[^>]*>|<!--[\s\S]*?-->|<html\b[^>]*>))*(?:\s*<head\b[^>]*>)?\s*/i)[0];
  const tags = lead.match(/<!doctype[^>]*>|<!--[\s\S]*?-->|<html\b[^>]*>|<head\b[^>]*>/gi) ?? [];
  const keep = /<head\b[^>]*>\s*$/i.test(lead) ? lead.match(/\s*$/)[0] : '';
  return tags.join('') + keep + html.slice(lead.length);
};
// Split the inlined page into open tags, scannable markup and inlined CSS in
// one left-to-right pass, so lookalikes never leak across regions: a JS string
// such as '<img src="x.png">' is not a reference, a '<!--' in JS or CSS never
// starts a comment, and everything inside a comment is ignored. `tags` keeps
// every open tag (their attributes are scanned); `markup` holds neither
// comments nor script, style, link, textarea or template elements; `css`
// holds the inlined style bodies for the url(...) scan.
const splitScan = (html) => {
  const css = [];
  let tags = '';
  let markup = '';
  let last = 0;
  const token = /<!--|<\/(script|style|textarea|template)\s*>|<(script|style|textarea|template)\b[^>]*>|<link\b[^>]*>/gi;
  const closeAt = (pattern, from) => { pattern.lastIndex = from; return pattern.exec(html); };
  let match;
  while ((match = token.exec(html)) !== null) {
    const text = match[0];
    if (text === '<!--') {
      tags += html.slice(last, match.index);
      markup += html.slice(last, match.index);
      const end = closeAt(/-->/g, token.lastIndex);
      last = end ? end.index + end[0].length : html.length;
      token.lastIndex = last;
    } else if (match[2]) {
      const name = match[2].toLowerCase();
      tags += html.slice(last, token.lastIndex);
      markup += html.slice(last, match.index);
      if (name === 'style') {
        const end = closeAt(/<\/style\s*>/gi, token.lastIndex);
        css.push(html.slice(token.lastIndex, end ? end.index : html.length));
        last = end ? end.index + end[0].length : html.length;
      } else if (name === 'script' || name === 'textarea' || name === 'template') {
        const end = closeAt(new RegExp(`</${name}\\s*>`, 'gi'), token.lastIndex);
        last = end ? end.index + end[0].length : html.length;
      } else {
        last = token.lastIndex;
      }
      token.lastIndex = last;
    } else if (/^<link\b/i.test(text)) {
      tags += html.slice(last, token.lastIndex);
      markup += html.slice(last, match.index);
      last = token.lastIndex;
    }
    // A stray closer outside its element is literal text: last keeps it.
  }
  tags += html.slice(last);
  markup += html.slice(last);
  return { tags, markup, css };
};
// Vite's own marker cleanup (vite:build-import-analysis generateBundle) runs after
// ours, so a chunk snapshot taken here still holds __VITE_PRELOAD__ markers. One
// chunk means nothing left to preload, which is exactly what Vite writes in that
// case, so finish its job here: replace every marker with an empty dep list.
const finalizeChunkCode = (code) => code.replace(/__VITE_PRELOAD__/g, () => '[]');

const publicFiles = (dir) => {
  const out = new Set();
  const walk = (prefix) => {
    let entries = [];
    try { entries = readdirSync(join(dir, prefix), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(prefix + entry.name + '/');
      else out.add((prefix + entry.name).toLowerCase());
    }
  };
  if (dir) walk('');
  return out;
};

// Force one self-contained client build. Runs in the config hook, so every client
// build gets it whatever --mode; the dev server never does (see apply below).
const forceSingleFileConfig = (config) => {
  config.build ??= {};
  const build = config.build;
  build.assetsInlineLimit = INLINE_LIMIT;
  build.cssCodeSplit = false;
  // modulePreload is left alone on purpose: dynamic imports call into the
  // preload helper at runtime, and disabling it breaks them with
  // __VITE_PRELOAD__ is not defined. One chunk means no preload links anyway.
  build.sourcemap = false;
  build.copyPublicDir = false;
  // One JS chunk. Vite 8 keeps build.rollupOptions as a warning-free alias of
  // build.rolldownOptions, so this one name serves Vite 6, 7 and 8.
  build.rollupOptions ??= {};
  const current = build.rollupOptions.output;
  if (Array.isArray(current)) for (const entry of current) entry.inlineDynamicImports = true;
  else build.rollupOptions.output = { ...current, inlineDynamicImports: true };
};

// Refuse to stack with another inline plugin: each already holds its own layers.
const assertUnstacked = (resolved) => {
  for (const plugin of resolved?.plugins ?? []) {
    const name = plugin?.name;
    if (name !== TAG && (name === 'inline-hex' || name === 'inline-hex-base64' || name === 'inline-base64' || name === 'inline-xor')) {
      throw new Error(`${TAG}: ${name} is also in this config. Remove ${name}: inline plugins must never be stacked (each already holds its own encoding layers).`);
    }
  }
};

// On Vite 8 (rolldown) output.inlineDynamicImports is deprecated in favour of
// output.codeSplitting: false. Detect rolldown by its option proxy: after compat
// setup, build.rollupOptions reads back the same object as build.rolldownOptions.
// Older Vites have no rolldownOptions key, so they keep inlineDynamicImports.
const fixupOutputOptions = (resolved) => {
  const build = resolved?.build ?? {};
  const rolldown = build.rolldownOptions;
  if (!rolldown || typeof rolldown !== 'object' || build.rollupOptions !== rolldown) return;
  const outputs = Array.isArray(rolldown.output) ? rolldown.output : [rolldown.output];
  for (const output of outputs) {
    if (!output || typeof output !== 'object') continue;
    delete output.inlineDynamicImports;
    output.codeSplitting = false;
  }
};

// A staged failure: the stage wrapper records it in the trace and ends it in
// this.error, so the message is the traceable one.
class StageError extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
  }
}

// Build-time trace with named stages. All lines go through Vite's resolved logger
// (so --logLevel is honoured); the trace file is written on every build whatever
// the log level. error() ends failures in this.error. The trace holds names,
// counts and sizes only, never HTML, code or payload content.
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
    run(name, details, fn) {
      const start = performance.now();
      const stop = (status, extra) => {
        records.push({ time: new Date().toISOString(), plugin: tag, stage: name, status, duration: Math.round((performance.now() - start) * 10) / 10, details: { ...details, ...extra } });
      };
      try {
        const info = {};
        const value = fn((message) => { throw new StageError(name, message); }, info);
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

// Steps find-html through check-references: the one HTML file, inlined and
// refused. Each step runs in the tracer with its counts; failures name files,
// never content.
const prepareHtml = (bundle, publicDir, tracer) => {
  const sourceOf = (key) => {
    const file = bundle[key];
    if (!file) return null;
    if (file.type === 'chunk') return file.code;
    return typeof file.source === 'string' ? file.source : Buffer.from(file.source).toString('utf8');
  };
  const found = tracer.run('find-html', {}, (fail, info) => {
    const htmlNames = Object.keys(bundle).filter((name) => name.endsWith('.html'));
    if (htmlNames.length !== 1) {
      fail(htmlNames.length === 0
        ? 'no HTML file in the bundle. Keep index.html as the build input.'
        : `${htmlNames.length} HTML files in the bundle (${htmlNames.join(', ')}). The single file is one page: build one html input and import anything else so it can be inlined.`);
    }
    const name = htmlNames[0];
    const asset = bundle[name];
    info.file = name;
    const html = typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString('utf8');
    return { name, asset, html };
  });
  const inlined = new Set();
  const externalScripts = [];
  const externalStyles = [];
  // Inline local scripts and stylesheets. Replacer functions throughout,
  // so $& and other $-patterns in app code stay literal.
  found.html = tracer.run('inline-scripts', { file: found.name }, (fail, info) => {
    const before = inlined.size;
    // One replacer for the whole element: a nested replace would splice the
    // new element into the old tag instead of replacing it.
    const out = found.html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (tag) => {
      const src = attr(tag, 'src');
      if (src === undefined) return tag;
      if (isExternal(src)) { externalScripts.push(src); return tag; }
      if (isInlineRef(src)) return tag;
      const key = bundleKey(src);
      const code = sourceOf(key);
      if (code === null) return tag; // named in check-references as a remaining local src
      inlined.add(key);
      const isModule = /\btype\s*=\s*(["']?)module\1/i.test(tag);
      const rest = stripAttrs(tag.slice('<script'.length, tag.indexOf('>')), 'src', 'crossorigin', 'type');
      const js = bundle[key]?.type === 'chunk' ? finalizeChunkCode(code) : code;
      return `<script${isModule ? ' type="module"' : ''}${rest ? ` ${rest}` : ''}>${escapeJs(js)}</script>`;
    });
    info.scripts = inlined.size - before;
    info.files = [...inlined].slice(before);
    return out;
  });
  found.html = tracer.run('inline-styles', { file: found.name }, (fail, info) => {
    const before = inlined.size;
    const out = found.html.replace(/<link\b[^>]*>/gi, (tag) => {
      const href = attr(tag, 'href');
      if (href === undefined) return tag;
      if (isExternal(href)) {
        if (/\brel\s*=\s*(["'])[^"']*stylesheet[^"']*\1/i.test(tag) && !FONT_HOSTS.has(hostOf(href))) externalStyles.push(href);
        return tag;
      }
      if (isInlineRef(href) || !/\brel\s*=\s*(["'])[^"']*stylesheet[^"']*\1/i.test(tag)) return tag;
      const css = sourceOf(bundleKey(href));
      if (css === null) return tag; // named in check-references as a remaining local href
      inlined.add(bundleKey(href));
      const media = attr(tag, 'media');
      return `<style${media ? ` media="${media}"` : ''}>${escapeCss(css)}</style>`;
    });
    info.stylesheets = inlined.size - before;
    info.files = [...inlined].slice(before);
    return out;
  });
  tracer.run('check-leftovers', { file: found.name }, (fail, info) => {
    for (const key of inlined) delete bundle[key];
    info.removed = inlined.size;
    const leftover = Object.keys(bundle).filter((key) => key !== found.name);
    if (leftover.length) {
      fail(`${leftover.length === 1 ? 'this file' : 'these files'} cannot go in the one-file build: ${leftover.join(', ')}. If it is a web worker, import it with ?worker&inline; otherwise import it from source so it can be inlined.`);
    }
    return null;
  });
  tracer.run('check-references', { file: found.name }, (fail, info) => {
    const problems = [];
    for (const src of externalScripts) problems.push(`external script "${src}". Install the package in the project and import it from source so it lands inside the file.`);
    for (const href of externalStyles) problems.push(`external stylesheet "${href}". Self-host it and import it from source; only fonts from fonts.googleapis.com and api.fontshare.com may stay on the web.`);
    const known = publicFiles(publicDir);
    // Empty stays allowed (a placeholder the app fills at runtime); anything
    // else local cannot load from one file, so it fails the build.
    const localRef = (value) => value !== '' && !isExternal(value) && !isInlineRef(value);
    const missing = (value) => known.has(bundleKey(value).toLowerCase())
      ? `"${value}" points at a file in publicDir. Import it from source (src or assets) instead, so it is inlined; publicDir files are not copied into the single file.`
      : null;
    const { tags, markup, css } = splitScan(found.html);
    for (const match of markup.matchAll(/\b(src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
      if (!localRef(value)) continue;
      problems.push(missing(value) ?? `${match[1]} "${value}" is still a file. Import it from source so it can be inlined.`);
    }
    for (const match of markup.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      for (const part of (match[1] ?? match[2] ?? match[3] ?? '').split(',')) {
        const value = part.trim().replace(/\s+\d[\d.]*[xw]$/i, '');
        if (!localRef(value)) continue;
        problems.push(missing(value) ?? `srcset "${value}" is still a file. Import it from source so it can be inlined.`);
      }
    }
    for (const body of css) {
      for (const match of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi)) {
        const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (!localRef(value)) continue;
        problems.push(missing(value) ?? `url("${value}") in CSS is still a file. Import it from source so it can be inlined.`);
      }
    }
    for (const match of tags.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
      if (localRef(match[2])) problems.push(`script src "${match[2]}" is still a file. Import it from source so it can be inlined.`);
    }
    for (const match of tags.matchAll(/<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
      if (localRef(match[2])) problems.push(`link href "${match[2]}" is still a file. Import it from source so it can be inlined.`);
    }
    if (!/^\s*<!doctype html/i.test(found.html)) problems.push('the HTML has no doctype. Keep <!doctype html> first: the loader stands in standards mode, so it must match the original.');
    info.problems = problems.length;
    if (problems.length) fail(`the build cannot become one self-contained file:\n- ${problems.join('\n- ')}`);
    return null;
  });
  // Pictures by remote URL stay as they are: nothing above touches them.
  // Whitespace-only changes cannot create or hide references, so the head
  // whitespace strip runs last, right before encoding.
  found.html = stripHeadWhitespace(found.html);
  return found;
};

// More than one HTML input cannot become one self-contained file. Detect it here, in
// configResolved, before the forced single-chunk options meet the bundler:
// otherwise the user gets the bundler's raw option error with no stage.
const failOnMultiInput = (resolved, tracer) => {
  tracer.run('find-html', {}, (fail, info) => {
    const input = resolved?.build?.rollupOptions?.input ?? resolved?.build?.rolldownOptions?.input;
    const inputs = Array.isArray(input) ? input : (input && typeof input === 'object' ? Object.keys(input) : [input]);
    info.inputs = inputs.length;
    if (inputs.length > 1) {
      fail(`${inputs.length} HTML inputs (${inputs.join(', ')}). The single file is one page: keep one html input in build.rollupOptions.input and import anything else so it can be inlined.`);
    }
    return null;
  });
};

// === INLINE SHARED END ===

// The loader. document.write runs while the parser is running, so written scripts
// run in order, DOMContentLoaded and load fire once for real, readyState is true,
// and the same window, origin, and any values or listeners the host set up
// (Gemini Canvas, for example, supplies __firebase_config) survive. document.open after load
// would erase host listeners; a srcdoc iframe or a blob URL would change the origin
// and frame depth. <meta charset> commits UTF-8 before the script; the loader
// removes both nodes, so the DOM matches the original. No document.close, no globals.
const loaderFor = (payload) =>
  `<!doctype html><meta charset="utf-8"><script>/*document.write while parsing: same window, origin, listeners and load timing*/(function(){var x="${payload}",h=atob(x),b=new Uint8Array(h.length/2),i=0,s=document.currentScript,m=s.previousElementSibling;for(;i<b.length;i++)b[i]=parseInt(h.substr(2*i,2),16);m.remove();s.remove();document.write(new TextDecoder().decode(b))})()</script>`;

export default function inlineHexBase64() {
  let publicDir = '';
  let logger = null;
  let cacheDir = '';
  return {
    name: 'inline-hex-base64',
    enforce: 'post',
    apply: (_, env) => env.command === 'build' && !env.isSsrBuild,
    config: forceSingleFileConfig,
    configResolved(resolved) {
      publicDir = resolved.publicDir ?? '';
      logger = resolved.logger ?? null;
      cacheDir = resolved.cacheDir ?? '';
      failOnMultiInput(resolved, createTracer(TAG, logger, cacheDir ? join(cacheDir, `${TAG}-trace.jsonl`) : '', (e) => { throw e instanceof Error ? e : new Error(e); }));
      assertUnstacked(resolved);
      fixupOutputOptions(resolved);
    },
    generateBundle(_options, bundle) {
      const tracer = createTracer(TAG, logger, cacheDir ? join(cacheDir, `${TAG}-trace.jsonl`) : '', (e) => this.error(e));
      const found = prepareHtml(bundle, publicDir, tracer);
      const payload = tracer.run('encode', { file: found.name }, (fail, info) => {
        const hex = Buffer.from(found.html, 'utf8').toString('hex');
        const out = Buffer.from(hex, 'utf8').toString('base64');
        info.bytes = Buffer.byteLength(found.html);
        info.payloadChars = out.length;
        return out;
      });
      tracer.run('verify-round-trip', { file: found.name }, (fail, info) => {
        const ascii = Buffer.from(payload, 'base64').toString('utf8');
        if (!/^[0-9a-fA-F]+$/.test(ascii) || ascii.length % 2 !== 0) fail(`decoded payload is not hex (${ascii.length} chars). This is a plugin bug: report it with the trace file.`);
        const decoded = Buffer.from(ascii, 'hex').toString('utf8');
        info.bytes = Buffer.byteLength(decoded);
        if (decoded !== found.html) fail(`decoded output differs from the source HTML (${info.bytes} vs ${Buffer.byteLength(found.html)} bytes). This is a plugin bug: report it with the trace file.`);
        return null;
      });
      const final = tracer.run('write-loader', { file: found.name }, (fail, info) => {
        found.asset.source = loaderFor(payload);
        info.bytes = found.asset.source.length;
        return found.asset.source.length;
      });
      tracer.close();
      tracer.info(`${found.name}: ${Buffer.byteLength(found.html)} bytes of HTML in ${final} bytes of base64 loader.`);
      if (final > WARN_BYTES) tracer.warn('the final file is over 800 KB. That is larger than any Gemini Canvas app known; Canvas may refuse it (its own limit is unknown). Other hosts are unaffected.');
    },
  };
}
