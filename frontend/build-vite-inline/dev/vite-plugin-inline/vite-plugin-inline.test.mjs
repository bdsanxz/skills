// Run: npm test  (node --test vite-plugin-inline.test.mjs)
//
// Real Vite builds (8, 7, 6) for all three inline plugins, plus headless-Chrome
// behaviour equality between each built file and its decoded HTML.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build as build8, createServer as server8 } from 'vite';
import { build as build7 } from 'vite7';
import { build as build6 } from 'vite6';
import inlineHex from '../../scripts/vite-plugin-inline-hex.mjs';
import inlineHexBase64 from '../../scripts/vite-plugin-inline-hex-base64.mjs';
import inlineBase64 from '../../scripts/vite-plugin-inline-base64.mjs';
import inlineXor from '../../scripts/vite-plugin-inline-xor.mjs';
import inlineObfuscate from '../../scripts/vite-plugin-inline-obfuscate.mjs';
import inlineObfuscateApp from '../../scripts/vite-plugin-inline-obfuscate-app.mjs';
import { Browser } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const CHECKER = join(SKILL, 'scripts', 'inline-check.mjs');
const PLUGINS = {
  'inline-hex': { make: inlineHex, layers: '1 layer (hex, not the default 2)' },
  'inline-hex-base64': { make: inlineHexBase64, layers: 'the default 2 layers (base64 of hex)' },
  'inline-base64': { make: inlineBase64, layers: '1 layer (base64, not the default 2)' },
  'inline-xor': { make: inlineXor, layers: '1 layer (xor, not the default 2)' },
};
// Independent FNV-1a, written from the hash spec, to check the xor keystream.
const fnvCheck = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};
const VITE = { 8: build8, 7: build7, 6: build6 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const tmpRoot = () => realpathSync(mkdtempSync(join(tmpdir(), 'inline-hex-')));
const write = (dir, name, content) => {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

// The success fixture: dynamic import, CSS, an imported image and font, non-ASCII
// text (emoji, Indonesian, CJK), the literals </script>, <!-- and $& in JS and CSS,
// <html lang> and <body class>. No top-level await: Vite 6 targets es2020.
const writeFixture = (dir) => {
  write(dir, 'index.html', `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Selamat pagi — 你好 Hex 🌅</title>
<script type="module" src="/src/main.js"></script>
</head>
<body class="inline-probe">
<div id="app"></div>
</body>
</html>`);
  write(dir, 'src/main.js', `import './style.css';
import picUrl from '../assets/pic.png';
window.__order = [];
window.__order.push('main-start');
window.__amp = '$& and $1 $\\'';
window.__closeTag = '</script>';
window.__commentOpen = '<!--';
var img = document.createElement('img');
img.src = picUrl;
img.alt = 'Selamat pagi';
document.getElementById('app').appendChild(img);
var h = document.createElement('h1');
h.textContent = 'Selamat pagi, apa kabar? 你好世界 🌅';
document.getElementById('app').prepend(h);
import('./extra.js').then(function (mod) {
  window.__order.push('main-end');
  window.__dyn = mod.mark;
  try { parent.postMessage({ cv: window.__cv || null, order: window.__order, dyn: window.__dyn, origin: window.location.origin }, '*'); } catch (e) {}
});
`);
  write(dir, 'src/extra.js', `window.__order.push('extra');
export var mark = 'extra-ok';
`);
  write(dir, 'src/style.css', `@font-face {
  font-family: 'Canvas Probe';
  src: url('../assets/font.woff2') format('woff2');
  font-weight: 400;
}
.inline-probe { background-color: rgb(12, 34, 56); color: rgb(255, 255, 255); }
.inline-probe::after { content: '$& <!-- </style>'; }
`);
  write(dir, 'assets/pic.png', PNG);
  write(dir, 'assets/font.woff2', Buffer.from('wOF2fake-font-bytes-for-inlining-test-0000000000000000000000000000'));
};

// Build with Vite's log and the plugin's console captured, so the test sees
// warnings. Never hook process.stdout here: the test reporter owns that stream.
const buildWith = async (build, plugins, dir, outName = 'dist', logLevel = 'info') => {
  const lines = [];
  const push = (...args) => { lines.push(args.join(' ')); };
  const logger = {
    hasWarned: false,
    hasErrorLogged: () => false,
    clearScreen: () => {},
    info: push, warn: push, warnOnce: push, error: push,
  };
  const origLog = console.log;
  console.log = push;
  try {
    await build({ root: dir, logLevel, customLogger: logger, plugins, build: { outDir: join(dir, outName), emptyOutDir: true } });
  } finally {
    console.log = origLog;
  }
  return lines;
};

// The trace file a build wrote: exactly one, never inside dist/.
const readTrace = (dir, pname) => {
  const found = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === `${pname}-trace.jsonl`) found.push(p);
    }
  };
  walk(dir);
  assert.equal(found.length, 1, `expected one trace file for ${pname}, found ${found.join(',') || 'none'}`);
  assert.ok(!found[0].startsWith(join(dir, 'dist')), 'the trace must never land in dist');
  return { path: found[0], records: readFileSync(found[0], 'utf8').trim().split('\n').map((line) => JSON.parse(line)) };
};

// The trace holds names, counts and sizes only: none of the fixture's words.
const assertNoContent = (trace, payloadSample = null) => {
  const text = trace.records.map((r) => JSON.stringify(r)).join('\n');
  for (const word of ['Selamat', 'inline-probe', 'extra-ok', 'apa kabar']) {
    assert.ok(!text.includes(word), `the trace leaks app content: ${word}`);
  }
  if (payloadSample) assert.ok(!text.includes(payloadSample), 'the trace leaks payload content');
};

const distFile = (dir, outName = 'dist') => {
  const files = readdirSync(join(dir, outName));
  assert.deepEqual(files, ['index.html']);
  return readFileSync(join(dir, outName, 'index.html'), 'utf8');
};

const warnings = (lines) => lines.filter((line) => /warn|deprecat/i.test(line));

const serve = (root) => new Promise((resolve) => {
  const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = createServer((req, res) => {
    try {
      const data = readFileSync(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      res.writeHead(200, { 'content-type': MIME[extname(req.url.split('?')[0])] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('no'); }
  });
  server.listen(0, '127.0.0.1', () => {
    servers.push(server);
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
});
const servers = [];
let browser = null;
after(async () => {
  for (const server of servers) await new Promise((r) => server.close(r));
  if (browser) await browser.close();
});

const sharedPart = (file) => {
  const source = readFileSync(file, 'utf8');
  const from = source.indexOf('// === INLINE SHARED START ===');
  const to = source.indexOf('// === INLINE SHARED END ===');
  assert.ok(from >= 0 && to > from, `${file} is missing a shared marker`);
  return source.slice(from, to);
};

test('the shared inlining and checking code is byte-identical in all four plugins', () => {
  const files = ['vite-plugin-inline-hex.mjs', 'vite-plugin-inline-hex-base64.mjs', 'vite-plugin-inline-base64.mjs', 'vite-plugin-inline-xor.mjs']
    .map((name) => join(SKILL, 'scripts', name));
  const parts = files.map(sharedPart);
  for (const [i, part] of parts.entries()) assert.equal(part, parts[0], `${files[i]} drifts from hex`);
});

test('no plugin file uses console', () => {
  for (const name of ['vite-plugin-inline-hex.mjs', 'vite-plugin-inline-hex-base64.mjs', 'vite-plugin-inline-base64.mjs', 'vite-plugin-inline-xor.mjs', 'vite-plugin-inline-obfuscate.mjs', 'vite-plugin-inline-obfuscate-app.mjs']) {
    assert.doesNotMatch(readFileSync(join(SKILL, 'scripts', name), 'utf8'), /console\./, `${name} uses console`);
  }
});

// Decode a built file the way inline-check.mjs does, by layer kind.
const decodeBuilt = (pname, source) => {
  if (pname === 'inline-hex') {
    const hex = source.match(/var h="([0-9a-fA-F]+)"/)[1];
    assert.ok(hex.length % 2 === 0);
    return Buffer.from(hex, 'hex').toString('utf8');
  }
  if (pname === 'inline-xor') {
    const m = source.match(/var s="([0-9a-f]{8})",x="([A-Za-z0-9+/=]+)"/);
    assert.ok(m, 'no xor seed and payload in the built file');
    const seed = m[1];
    const payload = m[2];
    const bytes = Buffer.from(payload, 'base64');
    for (let i = 0; i < bytes.length; i += 4) {
      const k = fnvCheck(`${seed}:${i / 4}`);
      for (let j = 0; j < 4 && i + j < bytes.length; j++) bytes[i + j] ^= (k >>> (8 * j)) & 255;
    }
    return bytes.toString('utf8');
  }
  const payload = source.match(/var x="([A-Za-z0-9+/=]+)"/)[1];
  if (pname === 'inline-hex-base64') {
    assert.match(payload, /[A-Z+/=]/, 'base64 payload must not look like raw hex');
    const hex = Buffer.from(payload, 'base64').toString('utf8');
    assert.match(hex, /^[0-9a-fA-F]+$/);
    assert.ok(hex.length % 2 === 0);
    return Buffer.from(hex, 'hex').toString('utf8');
  }
  return Buffer.from(payload, 'base64').toString('utf8');
};

for (const [pname, plugin] of Object.entries(PLUGINS)) {
  for (const [version, build] of Object.entries(VITE)) {
    test(`${pname} builds one warning-free file on vite ${version}`, async () => {
      const dir = tmpRoot();
      writeFixture(dir);
      const lines = await buildWith(build, [plugin.make()], dir);
      const source = distFile(dir);
      assert.match(source, /^<!doctype html><meta charset="utf-8"><script>/);
      assert.match(lines.join('\n'), new RegExp(`${pname}: .* bytes of HTML in \\d+ bytes of (hex|base64|xor) loader`), `the size log never arrived via the logger on vite ${version}`);
      assert.deepEqual(warnings(lines), [], `warnings on vite ${version}:\n${lines.join('\n')}`);
      const trace = readTrace(dir, pname);
      assert.deepEqual(trace.records.map((r) => r.stage), ['find-html', 'inline-scripts', 'inline-styles', 'check-leftovers', 'check-references', 'encode', 'verify-round-trip', 'write-loader']);
      assert.ok(trace.records.every((r) => r.status === 'ok' && r.plugin === pname && typeof r.duration === 'number' && r.time), 'trace records carry plugin, time, status, duration');
      assertNoContent(trace);
      const payloadSample = source.slice(Math.floor(source.length / 2), Math.floor(source.length / 2) + 64);
      assert.ok(!trace.records.map((r) => JSON.stringify(r)).join('\n').includes(payloadSample), 'the trace leaks payload content');
    });
  }
}

for (const [pname, plugin] of Object.entries(PLUGINS)) {
  test(`${pname} decodes to one self-contained HTML file`, async () => {
    const dir = tmpRoot();
    writeFixture(dir);
    await buildWith(build8, [plugin.make()], dir);
    const source = distFile(dir);
    const raw = decodeBuilt(pname, source);
    assert.match(raw, /^<!doctype html>/i);
    assert.match(raw, /<html lang="id">/);
    assert.match(raw, /<body class="inline-probe">/);
    assert.match(raw, /<script type="module">/);
    assert.doesNotMatch(raw, /src="\/assets/);
    assert.doesNotMatch(raw, /crossorigin/);
    assert.match(raw, /<style>/);
    assert.doesNotMatch(raw, /rel="stylesheet"/);
    assert.match(raw, /data:image\/png/);
    assert.match(raw, /data:font\//);
    assert.ok(raw.includes('$&'), 'the $& literal survives inlining');
    assert.ok(raw.includes('<\\/script'), 'JS </script is escaped');
    assert.ok(raw.includes('<\\!--'), 'JS <!-- is escaped');
    assert.ok(raw.includes('<\\/style'), 'CSS </style is escaped');
    assert.ok(raw.includes('Selamat pagi, apa kabar? 你好世界'), 'non-ASCII survives');
    const ratio = source.length / Buffer.byteLength(raw);
    const want = pname === 'inline-hex' ? [1.9, 2.3] : pname === 'inline-hex-base64' ? [2.5, 3.0] : [1.25, 1.6];
    assert.ok(ratio > want[0] && ratio < want[1], `size ratio ${ratio.toFixed(2)} outside ${want}`);
    const check = spawnSync(process.execPath, [CHECKER, join(dir, 'dist', 'index.html'), '--check'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, new RegExp(plugin.layers.replace(/[()]/g, (c) => `\\${c}`)));
    const decoded = join(dir, 'decoded.html');
    const out = spawnSync(process.execPath, [CHECKER, join(dir, 'dist', 'index.html'), '--decode', decoded], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(decoded, 'utf8'), raw);
  });
}

// A minimal project for the failure battery. extra holds per-case files.
const writeBare = (dir, html, files = {}) => {
  write(dir, 'index.html', html);
  write(dir, 'src/main.js', `document.getElementById('app').textContent = 'hi';`);
  for (const [name, content] of Object.entries(files)) write(dir, name, content);
};
const bareHtml = (head = '') => `<!doctype html>
<html><head><meta charset="utf-8"><title>t</title>
<script type="module" src="/src/main.js"></script>${head}</head>
<body><div id="app"></div></body></html>`;

const failsWith = async (tname, pname, setup, stage, patterns, extraPlugins = []) => {
  const dir = tmpRoot();
  setup(dir);
  await assert.rejects(
    buildWith(build8, [...extraPlugins, PLUGINS[pname].make()], dir),
    (error) => {
      for (const pattern of [`${pname}:`, `\\[${stage}\\]`, 'Trace: .*trace\\.jsonl', ...patterns]) {
        assert.match(error.message, new RegExp(pattern), `${tname} misses ${pattern}:\n${error.message}`);
      }
      return true;
    },
    `${tname} built when it should fail`,
  );
  const trace = readTrace(dir, pname);
  const rec = trace.records.find((r) => r.stage === stage);
  assert.ok(rec, `${tname}: no ${stage} record in the trace`);
  assert.equal(rec.status, 'fail', `${tname}: ${stage} is not fail`);
  assertNoContent(trace);
};

const emitExtraHtml = {
  name: 'emit-extra',
  buildStart() { this.emitFile({ type: 'asset', fileName: 'extra.html', source: '<!doctype html><html><body>x</body></html>' }); },
};

for (const [pname] of Object.entries(PLUGINS)) {
  test(`${pname} refuses two HTML files, naming them`, (t) => failsWith(t.name, pname,
    (dir) => writeBare(dir, bareHtml()), 'find-html', ['extra\\.html', 'index\\.html'], [emitExtraHtml]));
  test(`${pname} refuses a worker chunk, pointing at ?worker&inline`, (t) => failsWith(t.name, pname,
    (dir) => writeBare(dir, bareHtml(), {
      'src/main.js': `new Worker(new URL('./w.js', import.meta.url));`,
      'src/w.js': `postMessage('w');`,
    }), 'check-leftovers', ['w-[^"]*\\.js', '\\?worker&inline']));
  test(`${pname} refuses an external script, naming it`, (t) => failsWith(t.name, pname,
    (dir) => writeBare(dir, bareHtml('<script src="https://cdn.jsdelivr.net/npm/jquery@4.0.0/dist/jquery.min.js"></script>')),
    'check-references', ['cdn\\.jsdelivr\\.net.*jquery', 'import it from source']));
  test(`${pname} refuses an external stylesheet, naming it`, (t) => failsWith(t.name, pname,
    (dir) => writeBare(dir, bareHtml('<link rel="stylesheet" href="https://cdn.example.com/x.css">')),
    'check-references', ['cdn\\.example\\.com/x\\.css', 'fonts\\.googleapis\\.com']));
  test(`${pname} refuses a publicDir reference, saying to import it`, (t) => failsWith(t.name, pname,
    (dir) => {
      writeBare(dir, bareHtml().replace('<div id="app">', '<div id="app"><img src="/badge.png">'), { 'public/badge.png': PNG });
    }, 'check-references', ['/badge\\.png', 'Import it from source']));
  test(`${pname} refuses HTML without a doctype`, (t) => failsWith(t.name, pname,
    (dir) => writeBare(dir, bareHtml().replace('<!doctype html>\n', '')), 'check-references', ['no doctype']));
  test(`${pname} refuses a missing image, srcset, poster and font, naming them`, (t) => failsWith(t.name, pname,
    (dir) => writeBare(dir, bareHtml().replace('<div id="app">', '<div id="app"><img src="assets/flag-id.png" srcset="assets/flag-id.png 1x, assets/flag-en.png 2x" alt=""><video poster="assets/poster.png"></video>'), {
      'src/main.js': `import './style.css';\ndocument.getElementById('app').textContent = 'hi';`,
      'src/style.css': `.stage { background: url(fonts/x.ttf); }\n`,
    }), 'check-references', ['assets/flag-id\\.png', 'assets/flag-en\\.png', 'assets/poster\\.png', 'fonts/x\\.ttf']));
  test(`${pname} ignores lookalike references in scripts, styles and comments`, async () => {
    const dir = tmpRoot();
    writeBare(dir, `<!doctype html>
<html><head><meta charset="utf-8"><title>t</title>
<script type="module" src="/src/main.js"></script></head>
<body><!-- <img src="ghost-comment.png" alt=""> --><textarea><img src="ghost-textarea.png" alt=""></textarea><template><img src="ghost-template.png" alt=""></template><div id="app"></div></body></html>`, {
      'src/main.js': `import './style.css';\nvar s1 = '<img src="ghost-js.png" alt="">';\nvar s2 = '<script src="ghost-script.js"></scr' + 'ipt>';\nvar u = 'url(ghost-js-url.png)';\ndocument.getElementById('app').textContent = s1 + s2 + u;\n`,
      'src/style.css': `/* .buried { background: url(ghost-css-comment.png); } */\n.alive { color: red; }\n`,
    });
    const lines = await buildWith(build8, [PLUGINS[pname].make()], dir);
    const source = distFile(dir);
    assert.deepEqual(warnings(lines), [], lines.join('\n'));
    assert.match(decodeBuilt(pname, source), /ghost-js\.png/);
  });
  test(`${pname} encodes no whitespace before <head>`, async () => {
    const dir = tmpRoot();
    writeFixture(dir);
    await buildWith(build8, [PLUGINS[pname].make()], dir);
    assert.match(decodeBuilt(pname, distFile(dir)), /^<!doctype html><html[^>]*><head[^>]*>\n<meta charset="utf-8">/);
  });
  test(`${pname} drops the gap after the doctype when the page has no <head> tag`, async () => {
    const dir = tmpRoot();
    writeBare(dir, '<!doctype html>\n\n<title>t</title><p>x</p>');
    await buildWith(build8, [PLUGINS[pname].make()], dir);
    assert.match(decodeBuilt(pname, distFile(dir)), /^<!doctype html><title>/);
  });
  test(`${pname} leaves a "<head>" lookalike and the code before it untouched`, async () => {
    const dir = tmpRoot();
    writeBare(dir, '<!doctype html><title>t</title><pre>a>  <b</pre><script>window.s = "x>  <y <head>";</script><p>x</p>');
    await buildWith(build8, [PLUGINS[pname].make()], dir);
    const raw = decodeBuilt(pname, distFile(dir));
    assert.match(raw, /a>  <b/);
    assert.match(raw, /x>  <y <head>/);
  });
  test(`${pname} keeps font-host stylesheets on the web`, async () => {
    const dir = tmpRoot();
    writeBare(dir, bareHtml('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'));
    const lines = await buildWith(build8, [PLUGINS[pname].make()], dir);
    const source = distFile(dir);
    assert.deepEqual(warnings(lines), [], lines.join('\n'));
    const raw = decodeBuilt(pname, source);
    assert.match(raw, /fonts\.googleapis\.com\/css2/);
  });
  test(`${pname} writes the trace even with --logLevel silent`, async () => {
    const dir = tmpRoot();
    writeFixture(dir);
    await buildWith(build8, [PLUGINS[pname].make()], dir, 'dist', 'silent');
    distFile(dir);
    const trace = readTrace(dir, pname);
    assert.equal(trace.records.length, 8);
    assert.ok(trace.records.every((r) => r.status === 'ok'), 'every stage is ok');
    assertNoContent(trace);
  });

  test(`${pname} stays silent on the real CLI under --logLevel silent`, async () => {
    const dir = tmpRoot();
    writeFixture(dir);
    write(dir, 'vite.config.mjs', `import plugin from ${JSON.stringify(join(SKILL, 'scripts', `vite-plugin-${pname}.mjs`))};\nexport default { plugins: [plugin()] };\n`);
    const run = spawnSync(process.execPath, [join(HERE, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'silent'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout + run.stderr, /bytes of HTML/, 'the size log escaped silent mode');
    distFile(dir);
    const trace = readTrace(dir, pname);
    assert.equal(trace.records.length, 8);
    assert.ok(trace.records.every((r) => r.status === 'ok'), 'every stage is ok');
  });
}

test('inline plugins refuse to stack in any order, naming the plugin to remove', async (t) => {
  const names = Object.keys(PLUGINS);
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      const dir = tmpRoot();
      writeBare(dir, bareHtml());
      await assert.rejects(
        buildWith(build8, [PLUGINS[a].make(), PLUGINS[b].make()], dir),
        (error) => {
          assert.match(error.message, new RegExp(`Remove ${b}[^0-9a-zA-Z-]`), `${t.name} [${a},${b}] misses the removal:\n${error.message}`);
          return true;
        },
        `${t.name} [${a},${b}] stacked without failing`,
      );
    }
  }
});

test('the same inline plugin twice is not stacking', async () => {
  for (const [pname, plugin] of Object.entries(PLUGINS)) {
    const dir = tmpRoot();
    writeBare(dir, bareHtml());
    const lines = await buildWith(build8, [plugin.make(), plugin.make()], dir);
    distFile(dir);
    assert.deepEqual(warnings(lines), [], lines.join('\n'));
  }
});

for (const [pname, plugin] of Object.entries(PLUGINS)) {
  for (const [version, build] of Object.entries(VITE)) {
    test(`${pname} refuses two rollup inputs on vite ${version} before the bundler`, async (t) => {
      const dir = tmpRoot();
      writeBare(dir, bareHtml());
      write(dir, 'b.html', bareHtml());
      await assert.rejects(
        build({ root: dir, logLevel: 'silent', plugins: [plugin.make()], build: { outDir: join(dir, 'dist'), emptyOutDir: true, rollupOptions: { input: ['index.html', 'b.html'] } } }),
        (error) => {
          for (const pattern of [`${pname}: \\[find-html\\]`, 'one html input', 'Trace: .*trace\\.jsonl', 'index\\.html', 'b\\.html']) {
            assert.match(error.message, new RegExp(pattern), `${t.name} misses ${pattern}:\n${error.message}`);
          }
          assert.doesNotMatch(error.message, /codeSplitting|Invalid value/, `${t.name} leaked the raw bundler error:\n${error.message}`);
          return true;
        },
      );
      const trace = readTrace(dir, pname);
      const rec = trace.records.find((r) => r.stage === 'find-html');
      assert.ok(rec, `${t.name}: no find-html record in the trace`);
      assert.equal(rec.status, 'fail', `${t.name}: find-html is not fail`);
      assertNoContent(trace);
    });
  }
}

const directPlugin = (pname, dir) => {
  const plugin = PLUGINS[pname].make();
  plugin.configResolved({ publicDir: '', logger: { info() {}, warn() {}, error() {} }, cacheDir: join(dir, 'cache'), plugins: [] });
  return plugin;
};
const directCtx = () => ({ error: (e) => { throw e instanceof Error ? e : new Error(e); }, warn: () => {} });

const directFail = (bundle) => {
  const dir = tmpRoot();
  const plugin = directPlugin('inline-hex', dir);
  let caught = null;
  try { plugin.generateBundle.call(directCtx(), {}, bundle); } catch (error) { caught = error; }
  assert.ok(caught, 'expected generateBundle to throw');
  return { caught, trace: readTrace(dir, 'inline-hex') };
};

test('generateBundle fails directly on an empty bundle and on leftovers', () => {
  const empty = directFail({});
  assert.match(empty.caught.message, /inline-hex: \[find-html\] no HTML file/);
  assert.equal(empty.trace.records.find((r) => r.stage === 'find-html').status, 'fail');
  const leftover = directFail({ 'index.html': { type: 'asset', fileName: 'index.html', source: '<!doctype html><html><head></head><body></body></html>' }, 'assets/data.bin': { type: 'asset', fileName: 'assets/data.bin', source: 'x' } });
  assert.match(leftover.caught.message, /inline-hex: \[check-leftovers\][\s\S]*assets\/data\.bin[\s\S]*import it from source/);
  assert.equal(leftover.trace.records.find((r) => r.stage === 'check-leftovers').status, 'fail');
  const remaining = directFail({ 'index.html': { type: 'asset', fileName: 'index.html', source: '<!doctype html><html><head><script src="/assets/missing.js"></script></head><body></body></html>' } });
  assert.match(remaining.caught.message, /inline-hex: \[check-references\][\s\S]*script src "\/assets\/missing\.js" is still a file/);
  assert.equal(remaining.trace.records.find((r) => r.stage === 'check-references').status, 'fail');
});

test('an unexpected exception keeps its cause and lands in the trace', () => {
  const dir = tmpRoot();
  const plugin = directPlugin('inline-hex', dir);
  const ctx = directCtx();
  let caught = null;
  try {
    plugin.generateBundle.call(ctx, {}, { 'index.html': { type: 'asset', fileName: 'index.html', source: null } });
  } catch (error) { caught = error; }
  assert.ok(caught, 'expected generateBundle to throw');
  assert.match(caught.message, /inline-hex: \[find-html\] unexpected error/);
  assert.match(caught.message, /Trace: .*\-trace\.jsonl/);
  assert.ok(caught.cause instanceof TypeError, `the original cause is kept: ${caught.cause}`);
  const trace = readTrace(dir, 'inline-hex');
  const rec = trace.records.find((r) => r.stage === 'find-html');
  assert.equal(rec.status, 'fail');
  assert.ok(rec.details.stack && rec.details.stack.includes('TypeError'), 'the trace holds the stack');
});

for (const [pname, plugin] of Object.entries(PLUGINS)) {
  test(`${pname} leaves the dev server readable`, async () => {
    const dir = tmpRoot();
    writeBare(dir, bareHtml());
    const server = await server8({ root: dir, logLevel: 'silent', plugins: [plugin.make()] });
    try {
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      const out = await server.transformIndexHtml('/', html);
      assert.match(out, /\/src\/main\.js/);
      assert.doesNotMatch(out, /TextDecoder\(\)\.decode/);
    } finally {
      await server.close();
    }
  });
}

// Behaviour equality in real headless Chrome: the built file must behave exactly
// like its decoded HTML, including inside a sandboxed srcdoc iframe (origin null,
// like Canvas), where a host-set window value must survive the loader.
const RECORDER = `window.__t0=performance.now();window.__rs=[document.readyState];window.__dcl=0;window.__load=0;document.addEventListener('readystatechange',()=>{window.__rs.push(document.readyState)});document.addEventListener('DOMContentLoaded',()=>{window.__dcl++});window.addEventListener('load',()=>{window.__tLoad=performance.now()-window.__t0},{once:true});window.addEventListener('load',()=>{window.__load++});`;
const METRICS = `({html: document.documentElement.outerHTML, compat: document.compatMode, cs: document.characterSet, title: document.title, lang: document.documentElement.lang, bodyClass: document.body ? document.body.className : null, order: window.__order || null, dyn: window.__dyn || null, amp: window.__amp || null, closeTag: window.__closeTag || null, commentOpen: window.__commentOpen || null, dcl: window.__dcl, load: window.__load, rs: window.__rs, bg: document.body ? getComputedStyle(document.body).backgroundColor : null, after: getComputedStyle(document.querySelector('.inline-probe') || document.body, '::after').content})`;

const loadMetrics = async (url) => {
  const page = await browser.newPage({ width: 1440, height: 900 });
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
    await page.goto(url, { timeoutMs: 30000, settleMs: 1500 });
    const metrics = await page.eval(METRICS);
    const tLoad = await page.eval('window.__tLoad');
    return { metrics, errors: page.consoleErrors, tLoad };
  } finally {
    await page.close();
  }
};

for (const [pname, plugin] of Object.entries(PLUGINS)) {
  test(`${pname} behaves exactly like its decoded HTML in Chrome, iframe included`, async () => {
    browser ??= await Browser.launch();
    const dir = tmpRoot();
    writeFixture(dir);
    await buildWith(build8, [plugin.make()], dir);
    const built = distFile(dir);
    const raw = decodeBuilt(pname, built);
    const root = join(dir, 'srv');
    write(root, 'a/index.html', built);
    write(root, 'b/decoded.html', raw);
    write(root, 'c/combined.html', `<script>window.__cv="host-42";</script>${built}`);
    write(root, 'host.html', '<!doctype html><html><body></body></html>');
    const base = await serve(root);
    const direct = await loadMetrics(`${base}/a/index.html`);
    const plain = await loadMetrics(`${base}/b/decoded.html`);
    assert.deepEqual(direct.errors, [], `console errors in the built file: ${direct.errors.join(' | ')}`);
    assert.deepEqual(plain.errors, [], `console errors in the decoded file: ${plain.errors.join(' | ')}`);
    assert.deepEqual(direct.metrics, plain.metrics);
    assert.equal(direct.metrics.compat, 'CSS1Compat');
    assert.equal(direct.metrics.cs, 'UTF-8');
    assert.equal(direct.metrics.lang, 'id');
    assert.deepEqual(direct.metrics.order, ['main-start', 'extra', 'main-end']);
    assert.equal(direct.metrics.dyn, 'extra-ok');
    assert.equal(direct.metrics.amp, `$& and $1 $'`);
    assert.equal(direct.metrics.closeTag, '</script>');
    assert.equal(direct.metrics.commentOpen, '<!--');
    assert.equal(direct.metrics.bg, 'rgb(12, 34, 56)');
    assert.ok(direct.metrics.after.includes('$&'), `::after content lost: ${direct.metrics.after}`);
    assert.ok(direct.metrics.after.includes('<!--'), `::after comment lost: ${direct.metrics.after}`);
    assert.ok(direct.metrics.dcl >= 1 && direct.metrics.load >= 1, `load events: ${JSON.stringify({ dcl: direct.metrics.dcl, load: direct.metrics.load })}`);
    // A host value set before the loader survives in the same document.
    const same = await loadMetrics(`${base}/c/combined.html`);
    const cv = await (async () => {
      const page = await browser.newPage({ width: 800, height: 600 });
      try {
        await page.goto(`${base}/c/combined.html`, { timeoutMs: 30000, settleMs: 1500 });
        return page.eval('window.__cv');
      } finally { await page.close(); }
    })();
    assert.equal(cv, 'host-42');
    assert.deepEqual(same.errors, []);
    // Inside <iframe sandbox="allow-scripts" srcdoc> (origin null, like Canvas).
    const page = await browser.newPage({ width: 800, height: 600 });
    try {
      await page.goto(`${base}/host.html`, { timeoutMs: 30000, settleMs: 500 });
      const msg = await page.eval(`(async () => {
        const payload = ${JSON.stringify(built)};
        window.__msg = null;
        window.addEventListener('message', (e) => { window.__msg = e.data; });
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-scripts');
        f.srcdoc = '<script>window.__cv="host-42";</scr' + 'ipt>' + payload;
        document.body.appendChild(f);
        for (let i = 0; i < 200 && !window.__msg; i++) await new Promise((r) => setTimeout(r, 50));
        return window.__msg;
      })()`);
      assert.ok(msg, 'the framed app never reported back');
      assert.equal(msg.cv, 'host-42', 'host window value survives the loader in a sandboxed iframe');
      assert.deepEqual(msg.order, ['main-start', 'extra', 'main-end']);
      assert.equal(msg.dyn, 'extra-ok');
      assert.equal(msg.origin, 'null');
    } finally {
      await page.close();
    }
  });
}

test('inline-xor keystream matches between plugin and loader, builds are deterministic, plaintext is absent', async () => {
  const dir = tmpRoot();
  writeFixture(dir);
  await buildWith(build8, [inlineXor()], dir);
  const built = distFile(dir);
  for (const word of ['Selamat', 'inline-probe', 'extra-ok', '__closeTag', '<h1']) {
    assert.ok(!built.includes(word), `plaintext leaks into the file: ${word}`);
  }
  const fnSrc = built.slice(built.indexOf('function H(t){'), built.indexOf('}for(i=0;i<b.length;n++)') + 1);
  assert.ok(fnSrc.length > 50, 'no hash function in the loader');
  const H = eval(`(${fnSrc})`);
  for (const input of ['a1b2c3d4:0', 'a1b2c3d4:12345', 'seed:0', 'x']) {
    assert.equal(H(input), fnvCheck(input), `plugin and loader keystreams differ for ${input}`);
  }
  const dir2 = tmpRoot();
  writeFixture(dir2);
  await buildWith(build8, [inlineXor()], dir2);
  assert.equal(distFile(dir2), built, 'two builds of the same source differ');
});

test('inline-xor decodes two megabytes in Chrome without blocking', async () => {
  browser ??= await Browser.launch();
  const dir = tmpRoot();
  const row = `<div class="row">${'Selamat pagi apa kabar kamu? Kamu baik-baik saja? 你好世界 '.repeat(30)}</div>`;
  write(dir, 'index.html', `<!doctype html><html><head><meta charset="utf-8"><title>big</title><script type="module" src="/src/main.js"></script></head><body>${row.repeat(1200)}</body></html>`);
  write(dir, 'src/main.js', `document.title = document.title + '!';`);
  await buildWith(build8, [inlineXor()], dir);
  const built = distFile(dir);
  console.log(`xor two-megabyte build: ${built.length} bytes of file`);
  const raw = decodeBuilt('inline-xor', built);
  assert.ok(Buffer.byteLength(raw) > 2 * 1024 * 1024, `fixture is only ${Buffer.byteLength(raw)} bytes of HTML`);
  const root = join(dir, 'srv');
  write(root, 'a/index.html', built);
  write(root, 'b/decoded.html', raw);
  const base = await serve(root);
  const cdpBuilt = await loadMetrics(`${base}/a/index.html`);
  const cdpPlain = await loadMetrics(`${base}/b/decoded.html`);
  assert.deepEqual(cdpBuilt.errors, [], cdpBuilt.errors.join(' | '));
  assert.deepEqual(cdpBuilt.metrics, cdpPlain.metrics);
  console.log(`xor decode time: built ${Math.round(cdpBuilt.tLoad)} ms vs decoded ${Math.round(cdpPlain.tLoad)} ms`);
  assert.ok(cdpBuilt.tLoad < 30000, 'the built file never finished loading');
  assert.ok(cdpBuilt.tLoad - cdpPlain.tLoad < 10000, 'decoding blocks noticeably');
});

// === inline-obfuscate-app: the optional layer that obfuscates app code ===
const writeObfFixture = (dir) => {
  write(dir, 'index.html', `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Obf</title>
<script>function greetVisitor(name) { return 'Halo, ' + name + '!'; }
window.__greeting = greetVisitor('dunia');</script>
<script type="module" src="/src/main.js"></script>
</head>
<body><div id="app"></div></body>
</html>`);
  write(dir, 'src/main.js', `import './style.css';\nfunction parcelTotal(items) { return items.length; }\nwindow.__total = parcelTotal([1, 2, 3]);\ndocument.getElementById('app').textContent = window.__greeting + window.__total;\n`);
  write(dir, 'src/style.css', `.app { color: red; }\n`);
};

test('inline-obfuscate-app mangles chunk and inline identifiers, keeps a staged trace', async () => {
  const dir = tmpRoot();
  writeObfFixture(dir);
  const lines = await buildWith(build8, [inlineObfuscateApp(), inlineHexBase64()], dir);
  const built = distFile(dir);
  const raw = decodeBuilt('inline-hex-base64', built);
  // Top-level identifiers are renamed away; string literals move into the
  // obfuscator's table (still greppable there by design, without encoding).
  assert.ok(!raw.includes('greetVisitor'), 'app identifier leaks into the decoded file: greetVisitor');
  assert.ok(raw.includes('_0x'), 'no hexadecimal obfuscator identifiers in the decoded file');
  assert.ok(raw.includes('id="app"'), 'app markup lost');
  const trace = readTrace(dir, 'inline-obfuscate-app');
  assert.deepEqual(trace.records.map((r) => [r.stage, r.status]), [['find-html', 'ok'], ['obfuscate-chunks', 'ok'], ['obfuscate-inline', 'ok']]);
  const chunks = trace.records.find((r) => r.stage === 'obfuscate-chunks');
  assert.equal(chunks.details.chunks, 1);
  assert.ok(chunks.details.bytesAfter > chunks.details.bytesBefore, 'chunk transform left no trace in the sizes');
  const inline = trace.records.find((r) => r.stage === 'obfuscate-inline');
  assert.equal(inline.details.scripts, 1);
  assert.ok(inline.details.bytesAfter > inline.details.bytesBefore, 'inline transform left no trace in the sizes');
  assertNoContent(trace);
  assert.deepEqual(warnings(lines), [], lines.join('\n'));
});

test('inline-obfuscate-app builds are deterministic', async () => {
  const first = tmpRoot();
  writeObfFixture(first);
  await buildWith(build8, [inlineObfuscateApp(), inlineHexBase64()], first);
  const second = tmpRoot();
  writeObfFixture(second);
  await buildWith(build8, [inlineObfuscateApp(), inlineHexBase64()], second);
  assert.equal(distFile(second), distFile(first), 'two builds of the same source differ');
});

test('inline-obfuscate-app after the encode plugin warns and skips the loader', async () => {
  const dir = tmpRoot();
  writeObfFixture(dir);
  const lines = await buildWith(build8, [inlineHexBase64(), inlineObfuscateApp()], dir);
  const raw = decodeBuilt('inline-hex-base64', distFile(dir));
  assert.ok(raw.includes('greetVisitor'), 'misordered run should leave app code untouched');
  assert.ok(lines.some((line) => line.includes('must run BEFORE the encode plugin')), `no misorder warning:\n${lines.join('\n')}`);
});

// === inline-obfuscate: the optional layer that obfuscates the loader ===
const CLI = join(SKILL, 'scripts', 'inline-check.mjs');
const decodeViaCli = (file) => {
  const out = `${file}.decoded`;
  const d = spawnSync('node', [CLI, file, '--decode', out], { encoding: 'utf8' });
  assert.equal(d.status, 0, `${d.stdout}${d.stderr}`);
  return readFileSync(out, 'utf8');
};

// All four encode plugins on Vite 8; one each on Vite 6 and 7 for version cover.
for (const [vn, build, pname] of [
  [8, build8, 'inline-hex'], [8, build8, 'inline-hex-base64'], [8, build8, 'inline-base64'], [8, build8, 'inline-xor'],
  [6, build6, 'inline-base64'], [7, build7, 'inline-xor'],
]) {
  test(`inline-obfuscate on ${pname} (Vite ${vn}) hides the loader, round-trips, and is deterministic`, async () => {
    const make = PLUGINS[pname].make;
    const dirP = tmpRoot(); writeFixture(dirP); await buildWith(build, [make()], dirP);
    const dirO = tmpRoot(); writeFixture(dirO); await buildWith(build, [make(), inlineObfuscate()], dirO);
    const obf = distFile(dirO);
    // One script, only an opaque code-id token (no readable marker), and the plain
    // decode code is gone.
    assert.equal((obf.match(/<script/g) || []).length, 1);
    assert.match(obf, /^<!doctype html><meta charset="utf-8"><script>"[a-z0-9]{7}[2479]";/);
    assert.doesNotMatch(obf, /\/\*canvas:|\/\*p\*\/|\/\*s\*\//);
    assert.doesNotMatch(obf, /document\.currentScript,m=[a-z]\.previousElementSibling/);
    // The real checker reads it, says obfuscated, and decodes to the same HTML the
    // plain build decodes to.
    const fileO = join(dirO, 'dist', 'index.html');
    const check = spawnSync('node', [CLI, fileO, '--check'], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
    assert.match(check.stdout, /loader obfuscated/);
    assert.equal(decodeViaCli(fileO), decodeViaCli(join(dirP, 'dist', 'index.html')));
    // The same source gives the same bytes.
    const dir2 = tmpRoot(); writeFixture(dir2); await buildWith(build, [make(), inlineObfuscate()], dir2);
    assert.equal(distFile(dir2), obf);
    // Its own trace: three stages, all ok, no app content.
    const trace = readTrace(dirO, 'inline-obfuscate');
    assert.deepEqual(trace.records.map((r) => r.stage), ['find-loader', 'obfuscate', 'write-loader']);
    assert.ok(trace.records.every((r) => r.status === 'ok'), 'every obfuscate stage is ok');
    assertNoContent(trace);
  });
}

test('inline-obfuscate without an encode plugin refuses with a clear message', async () => {
  const dir = tmpRoot(); writeFixture(dir);
  await assert.rejects(buildWith(build8, [inlineObfuscate()], dir), /not an inline loader|inlineObfuscate\(\) LAST/);
});

test('an encode plugin does not reject inline-obfuscate as a stacked inline plugin', async () => {
  const dir = tmpRoot(); writeFixture(dir);
  const lines = await buildWith(build8, [inlineHexBase64(), inlineObfuscate()], dir);
  assert.ok(!lines.some((l) => /must never be stacked/.test(l)), lines.join('\n'));
  const out = distFile(dir);
  assert.match(out, /^<!doctype html><meta charset="utf-8"><script>"[a-z0-9]{7}7";/);
  assert.doesNotMatch(out, /\/\*canvas:/);
});

test('inline-obfuscate uses no console and declares its dependency', () => {
  const source = readFileSync(join(SKILL, 'scripts', 'vite-plugin-inline-obfuscate.mjs'), 'utf8');
  assert.doesNotMatch(source, /console\./);
  assert.match(source, /npm install -D javascript-obfuscator/);
});
