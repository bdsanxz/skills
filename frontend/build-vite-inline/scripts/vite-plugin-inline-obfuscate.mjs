// vite-plugin-inline-obfuscate: optional loader obfuscation for the single-file build.
//
// The inline encode plugins (inline-hex, inline-hex-base64, inline-base64,
// inline-xor) turn the whole app into one HTML file whose only readable code is a
// small loader that decodes the payload while the parser runs. This plugin takes
// that loader and runs its decode code through javascript-obfuscator, so the
// decode method (atob, the hex walk, the XOR keystream) is no longer in plain
// sight. The encoded payload itself is never fed to the obfuscator: it is pulled
// out first, kept byte-for-byte, and put back inside stable /*p*/"..."/*/p*/
// markers, so inline-check.mjs --check and --decode still read and decode the file.
//
// It is a separate, optional layer. Add it LAST, after the one encode plugin:
//   plugins: [..., inlineHexBase64(), inlineObfuscate()]
// Leave it out and the loader stays readable. It runs only in production builds.
// Unlike the encode plugins, this one needs a dependency:
//   npm install -D javascript-obfuscator
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAG = 'inline-obfuscate';
const WARN_BYTES = 800 * 1024; // the largest Gemini Canvas app known is about 800 KB

// The production file carries no readable marker. The only
// anchor is one opaque code-id string at the head of the script: a fixed token
// plus one digit that encodes the layer. inline-check.mjs knows this token and the
// digit map; nothing in the file names the scheme. Keep both in step with the
// CODE_ID and CODE_LAYER values in scripts/inline-check.mjs.
const CODE_ID = 'q7fa2k9';
const CODE_LAYER = { hex: '2', hexb64: '7', base64: '4', xor: '9' };

// The exact plain loaders the four encode plugins write, with the payload (and,
// for xor, the seed) captured. The leading /* ... */ comment is part of each.
// These must stay in step with the loaders in the encode plugins.
const LOADERS = [
  { layer: 'hex', re: /^(<!doctype html><meta charset="utf-8"><script>)((?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var h=)("[0-9a-fA-F]+")(,b=new Uint8Array\(h\.length\/2\)[\s\S]*?\}\)\(\))(<\/script>\n?)$/ },
  { layer: 'hexb64', re: /^(<!doctype html><meta charset="utf-8"><script>)((?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var x=)("[A-Za-z0-9+/=]+")(,h=atob\(x\),b=new Uint8Array\(h\.length\/2\)[\s\S]*?\}\)\(\))(<\/script>\n?)$/ },
  { layer: 'base64', re: /^(<!doctype html><meta charset="utf-8"><script>)((?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var x=)("[A-Za-z0-9+/=]+")(,h=atob\(x\),b=new Uint8Array\(h\.length\),[\s\S]*?\}\)\(\))(<\/script>\n?)$/ },
  { layer: 'xor', re: /^(<!doctype html><meta charset="utf-8"><script>)((?:\/\*[\s\S]*?\*\/)?\(function\(\)\{var s=)("[0-9a-f]{8}")(,x=)("[A-Za-z0-9+/=]+")(,h=atob\(x\)[\s\S]*?\}\)\(\))(<\/script>\n?)$/ },
];

// Fixed options and seed: the same loader gives the same obfuscated bytes, so an
// unchanged source never yields a new build. stringArray and splitStrings are off
// so no string literal (payload or otherwise) is ever moved or cut; the payload is
// not present at obfuscation time anyway. renameGlobals is off so the payload and
// seed placeholders survive to be replaced afterwards.
const OBFUSCATE_OPTIONS = {
  compact: true,
  seed: 0x0ca0a5,
  target: 'browser',
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: false,
  numbersToExpressions: false,
  simplify: true,
  stringArray: false,
  splitStrings: false,
  renameGlobals: false,
  selfDefending: false,
  identifierNamesGenerator: 'mangled',
};

// A staged failure, recorded in the trace and ended in this.error.
class StageError extends Error {
  constructor(stage, message) { super(message); this.stage = stage; }
}

// Build-time trace with named stages, through Vite's logger. Names, counts and
// sizes only: never the loader code or the payload.
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

export default function inlineObfuscate() {
  let logger = null;
  let cacheDir = '';
  let root = '';
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
      const traceFile = cacheDir ? join(cacheDir, `${TAG}-trace.jsonl`) : '';
      const tracer = createTracer(TAG, logger, traceFile, (e) => this.error(e));

      const found = await tracer.run('find-loader', {}, (fail, info) => {
        const htmlNames = Object.keys(bundle).filter((name) => name.endsWith('.html'));
        if (htmlNames.length !== 1) {
          fail(htmlNames.length === 0
            ? 'no HTML file in the bundle. Add inlineObfuscate() after one inline encode plugin.'
            : `${htmlNames.length} HTML files (${htmlNames.join(', ')}). The single file is one page; keep one html input.`);
        }
        const name = htmlNames[0];
        const source = sourceOf(bundle[name]);
        const match = LOADERS.map((l) => ({ layer: l.layer, m: source.match(l.re) })).find((x) => x.m);
        if (!match) {
          fail('the HTML is not an inline loader. Add inlineObfuscate() LAST, after one inline encode plugin (inlineHexBase64, inlineHex, inlineBase64, or inlineXor), so it obfuscates the loader that plugin writes.');
        }
        info.layer = match.layer;
        return { name, asset: bundle[name], parts: match.m, layer: match.layer };
      });

      const rebuilt = await tracer.run('obfuscate', { file: found.name, layer: found.layer }, async (fail, info) => {
        const mod = await loadObfuscator(root);
        if (!mod) fail('javascript-obfuscator is not installed. Run: npm install -D javascript-obfuscator');
        const JavaScriptObfuscator = mod.default ?? mod;

        // Rebuild the loader JS with the payload (and seed) swapped for free
        // identifiers, so the obfuscator never sees the long encoded string.
        const p = found.parts;
        let code;
        let payload;
        let seed = null;
        if (found.layer === 'xor') {
          seed = p[3]; // "seedHex"
          payload = p[5]; // "base64"
          code = `${p[2]}__CVS__${p[4]}__CVP__${p[6]}`;
        } else {
          payload = p[3]; // "payload"
          code = `${p[2]}__CVP__${p[4]}`;
        }

        let obfuscated;
        try {
          obfuscated = JavaScriptObfuscator.obfuscate(code, OBFUSCATE_OPTIONS).getObfuscatedCode();
        } catch (cause) {
          fail(`javascript-obfuscator could not transform the loader: ${cause?.message ?? cause}`);
        }

        // Put the untouched payload and seed back as plain string literals. No
        // marker is left in the file: inline-check.mjs finds the payload as the one
        // long literal and recognises the layer by decoding it.
        const inject = (text, token, literal, what) => {
          const count = text.split(token).length - 1;
          if (count !== 1) fail(`expected exactly one ${what} placeholder after obfuscation, found ${count}. This is a plugin bug: report it with the trace file.`);
          return text.replace(token, () => literal);
        };
        let injected = inject(obfuscated, '__CVP__', payload, 'payload');
        if (seed !== null) injected = inject(injected, '__CVS__', seed, 'seed');
        if (/<\/script/i.test(injected)) fail('obfuscated loader contains </script; refusing to write a broken file. Report it with the trace file.');

        const final = `<!doctype html><meta charset="utf-8"><script>"${CODE_ID}${CODE_LAYER[found.layer]}";${injected}</script>`;
        info.bytes = Buffer.byteLength(final);
        return final;
      });

      await tracer.run('write-loader', { file: found.name }, (fail, info) => {
        found.asset.source = rebuilt;
        info.bytes = Buffer.byteLength(rebuilt);
        return null;
      });

      tracer.close();
      const bytes = Buffer.byteLength(rebuilt);
      tracer.info(`${found.name}: loader obfuscated, ${bytes} bytes of file.`);
      if (bytes > WARN_BYTES) tracer.warn('the final file is over 800 KB. That is larger than any Gemini Canvas app known; Canvas may refuse it (its own limit is unknown). Other hosts are unaffected.');
    },
  };
}
