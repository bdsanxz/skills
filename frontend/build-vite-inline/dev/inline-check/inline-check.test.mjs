// Run: node --test dev/inline-check/inline-check.test.mjs
//
// inline-check.mjs --check/--decode against real builds of all four plugins,
// plus its refusals and usage errors.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = join(SKILL, 'scripts', 'inline-check.mjs');
const require = createRequire(join(SKILL, 'dev', 'vite-plugin-inline', 'package.json'));
const { build } = require('vite');
const PLUGINS = {
  'inline-hex': { load: () => require(join(SKILL, 'scripts', 'vite-plugin-inline-hex.mjs')).default(), layers: '1 layer (hex, not the default 2)' },
  'inline-hex-base64': { load: () => require(join(SKILL, 'scripts', 'vite-plugin-inline-hex-base64.mjs')).default(), layers: 'the default 2 layers (base64 of hex)' },
  'inline-base64': { load: () => require(join(SKILL, 'scripts', 'vite-plugin-inline-base64.mjs')).default(), layers: '1 layer (base64, not the default 2)' },
  'inline-xor': { load: () => require(join(SKILL, 'scripts', 'vite-plugin-inline-xor.mjs')).default(), layers: '1 layer (xor, not the default 2)' },
};

const write = (dir, name, content) => {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const fixture = (dir) => {
  write(dir, 'index.html', '<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n<title>Halo — 你好 🌅</title>\n<script type="module" src="/src/main.js"></script>\n</head>\n<body>\n<div id="app"></div>\n</body>\n</html>');
  write(dir, 'src/main.js', `import './style.css';\ndocument.getElementById('app').textContent = 'Halo, apa kabar? 你好世界 🌅';\n`);
  write(dir, 'src/style.css', `.app { background-color: rgb(12, 34, 56); }\n`);
};
const run = (...args) => spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });

for (const [pname, plugin] of Object.entries(PLUGINS)) {
  test(`inline-check.mjs checks and decodes a ${pname} file`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-hex-'));
    fixture(dir);
    await build({ root: dir, logLevel: 'silent', plugins: [plugin.load()], build: { outDir: join(dir, 'dist'), emptyOutDir: true } });
    const built = join(dir, 'dist', 'index.html');
    const check = run(built, '--check');
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, new RegExp(`HEX OK: .* is one loader with ${plugin.layers.replace(/[()]/g, (c) => `\\${c}`)}`));
    const decoded = join(dir, 'decoded.html');
    const out = run(built, '--decode', decoded);
    assert.equal(out.status, 0, out.stderr);
    const raw = readFileSync(decoded, 'utf8');
    assert.match(raw, /^<!doctype html><html[^>]*><head[^>]*>\n<meta charset="utf-8">/);
    assert.match(raw, /Halo, apa kabar\? 你好世界 🌅/);
    assert.match(raw, /\.app\{background-color:#0c2238\}/);
  });
}

test('inline-check.mjs refuses a file that skipped the plugin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inline-hex-'));
  const plain = join(dir, 'plain.html');
  writeFileSync(plain, '<!doctype html><html><head></head><body>hi</body></html>');
  const check = run(plain, '--check');
  assert.equal(check.status, 1);
  assert.match(check.stderr, /NOT HEX: .* did not go through an inline plugin/);
  assert.match(check.stderr, /Rebuild it/);
});

test('inline-check.mjs usage errors exit 2 with what to do', () => {
  assert.equal(run().status, 2);
  const dir = mkdtempSync(join(tmpdir(), 'inline-hex-'));
  const plain = join(dir, 'plain.html');
  writeFileSync(plain, '<!doctype html><html></html>');
  assert.equal(run(plain, '--check', '--decode', join(dir, 'o.html')).status, 2);
  assert.equal(run(join(dir, 'missing.html'), '--check').status, 2);
  assert.equal(run(plain).status, 2);
});
