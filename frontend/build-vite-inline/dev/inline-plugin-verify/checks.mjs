// The checks a build matrix cannot show: stacking, dev server, determinism, trace, size warning, hidden content, file://.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, tab, sleep } from './lib-cdp.mjs';
const H = dirname(fileURLToPath(import.meta.url)), P = `${H}/../../scripts`;
const names = { hex: 'inlineHex', 'hex-base64': 'inlineHexBase64', base64: 'inlineBase64', xor: 'inlineXor' };
const plugins = Object.keys(names);
let bad = 0, good = 0;
const check = (label, ok, detail = '') => { ok ? good++ : bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `: ${String(detail).slice(0, 400)}`}`); };
import { writeFileSync, copyFileSync, cpSync, mkdirSync } from 'node:fs';
const work = (v, app, label, config) => {
  const dir = `${H}/tools/v${v}/work/checks-${app}-${label}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(`${H}/apps/${app}`, dir, { recursive: true });
  for (const p of plugins) copyFileSync(`${P}/vite-plugin-inline-${p}.mjs`, `${dir}/vite-plugin-inline-${p}.mjs`);
  writeFileSync(`${dir}/vite.config.mjs`, config);
  return dir;
};
const single = p => `import p from './vite-plugin-inline-${p}.mjs';\nexport default { plugins: [p()] };`;
const vite = (v, dir, args = ['build']) => { const r = spawnSync(`${H}/tools/v${v}/node_modules/.bin/vite`, args, { cwd: dir, encoding: 'utf8' }); return { status: r.status, out: r.stdout + r.stderr }; };
const trace = (v, p) => `${H}/tools/v${v}/node_modules/.vite/inline-${p}-trace.jsonl`;

for (const v of [8, 7, 6]) {
  // Stacking, every ordered pair.
  for (const a of plugins) for (const b of plugins) { if (a === b) continue;
    const dir = work(v, 'plain', `stack`, `import a from './vite-plugin-inline-${a}.mjs';\nimport b from './vite-plugin-inline-${b}.mjs';\nexport default { plugins: [a(), b()] };`);
    const r = vite(v, dir);
    check(`v${v} stack ${a}+${b} refused, names both`, r.status !== 0 && r.out.includes(`inline-${a}`) && r.out.includes(`inline-${b}`), r.out);
  }
  for (const p of plugins) {
    // Same input, same bytes.
    const d1 = work(v, 'react', `det-${p}`, single(p)); vite(v, d1); const one = readFileSync(`${d1}/dist/index.html`);
    vite(v, d1); check(`v${v} ${p} deterministic`, one.equals(readFileSync(`${d1}/dist/index.html`)));
    // App words are not readable in the file.
    const text = one.toString();
    check(`v${v} ${p} hides content`, !/Tambah|useState|createRoot/.test(text) && (text.match(/<script/g) || []).length === 1, text.slice(0, 200));
    check(`v${v} ${p} loader is small`, text.length - (text.match(/"[0-9A-Za-z+/=]{200,}"/)?.[0].length ?? 0) < 1200, text.length);
    if (p === 'hex-base64') { const raw = text.match(/"([0-9A-Za-z+/=]{200,})"/)?.[1] ?? ''; check(`v${v} hex-base64 shows no hex`, raw && !/^[0-9a-f]+$/.test(raw) && /^[0-9a-f]+$/.test(Buffer.from(raw, 'base64').toString())); }
    // Trace: staged, no content, written when silent, and failure recorded.
    rmSync(trace(v, p), { force: true });
    const silent = vite(v, d1, ['build', '--logLevel', 'silent']);
    const tr = existsSync(trace(v, p)) ? readFileSync(trace(v, p), 'utf8') : '';
    const stages = ['find-html', 'inline-scripts', 'inline-styles', 'check-leftovers', 'check-references', 'encode', 'verify-round-trip', 'write-loader'];
    check(`v${v} ${p} silent build still traces every stage`, silent.status === 0 && silent.out.trim() === '' && stages.every(s => tr.includes(s)), silent.out + tr.slice(0, 200));
    check(`v${v} ${p} trace holds no content`, !/<script|<html|Tambah|createRoot/.test(tr) && !tr.includes(text.slice(100, 180)));
    check(`v${v} ${p} trace is JSON lines`, tr.trim().split('\n').every(l => { try { JSON.parse(l); return true; } catch { return false; } }));
    const df = work(v, 'fail-ext-script', `tr-${p}`, single(p)); rmSync(trace(v, p), { force: true }); const f = vite(v, df);
    const tf = existsSync(trace(v, p)) ? readFileSync(trace(v, p), 'utf8') : '';
    check(`v${v} ${p} failure names stage and trace, records it`, f.status !== 0 && f.out.includes(`inline-${p}: [check-references]`) && /Trace: /.test(f.out) && tf.includes('check-references') && /fail/i.test(tf), f.out + tf.slice(0, 200));
    // Size warning past 800 KB warns, does not fail.
    const dl = work(v, 'large', `w-${p}`, single(p)); const l = vite(v, dl);
    check(`v${v} ${p} warns over 800 KB and still builds`, l.status === 0 && /800 ?KB/i.test(l.out), l.out);
    // Dev server: readable, plugin idle.
    const dd = work(v, 'react', `dev-${p}`, single(p)); const port = 5300 + v * 10 + plugins.indexOf(p);
    const srv = spawn(`${H}/tools/v${v}/node_modules/.bin/vite`, ['--port', String(port), '--strictPort'], { cwd: dd, stdio: 'ignore' });
    let html = '', main = ''; for (let i = 0; i < 80 && !main.includes('Tambah'); i++) { await sleep(250); try { html = await (await fetch(`http://localhost:${port}/`)).text(); main = await (await fetch(`http://localhost:${port}/src/main.jsx`)).text(); } catch {} }
    srv.kill();
    check(`v${v} ${p} dev server serves source as is`, html.includes('/src/main.jsx') && !/"[0-9A-Za-z+/=]{200,}"/.test(html) && main.includes('Tambah'), html.slice(0, 200));
  }
}
// Real browser from file://, what a person opening the file sees.
const b = await launch();
for (const app of ['react', 'split']) for (const p of plugins) { const t = await tab(b);
  await t.goto(`file://${H}/tools/v8/work/${app}-${p}/dist/index.html`); for (let i = 0; i < 300 && await t.ev('document.readyState') !== 'complete'; i++) await sleep(50);
  const r = await t.ev(`({ready:document.readyState,loaders:[...document.scripts].filter(s=>/document\\.write/.test(s.textContent.slice(0,300))).length,body:document.body.innerText.length})`);
  check(`file:// ${app} ${p} runs`, r.ready === 'complete' && r.loaders === 0 && r.body > 0 && !t.log.exceptions.length, JSON.stringify(r) + JSON.stringify(t.log.exceptions).slice(0, 200)); await t.close(); }
await b.close();
console.log(`${good} ok, ${bad} failed`);
process.exitCode = bad ? 1 : 0;
