import { cpSync, rmSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const H = dirname(fileURLToPath(import.meta.url));
const S = H;
const P = `${H}/../../scripts`;
// Each variant is an ordered list of [plugin-file, factory]; the encode plugin is
// first, inline-obfuscate (when present) last. `tag` is the plugin that owns a
// refusal message, so a must-fail app is matched against the encode plugin even
// when the obfuscate layer is stacked on top.
const E = { hex: 'inlineHex', 'hex-base64': 'inlineHexBase64', base64: 'inlineBase64', xor: 'inlineXor' };
const variants = {};
for (const [k, f] of Object.entries(E)) {
  variants[k] = { steps: [[k, f]], tag: `inline-${k}` };
  variants[`${k}-obf`] = { steps: [[k, f], ['obfuscate', 'inlineObfuscate']], tag: `inline-${k}` };
  // App-code obfuscation runs before the encode plugin (and, with -obf, the
  // loader obfuscation stays last). The factory name is documentary: every
  // step is default-imported as p<i> and called in array order.
  variants[`${k}-appobf`] = { steps: [['obfuscate-app', 'inlineObfuscateApp'], [k, f]], tag: `inline-${k}` };
  variants[`${k}-appobf-obf`] = { steps: [['obfuscate-app', 'inlineObfuscateApp'], [k, f], ['obfuscate', 'inlineObfuscate']], tag: `inline-${k}` };
}
const chosen = process.argv[4] ? process.argv[4].split(',') : Object.keys(variants);
const apps = process.argv[3] ? process.argv[3].split(',') : readdirSync(`${H}/apps`);
const mustFail = app => app.startsWith('fail-') || app === 'no-doctype';
const out = [];
const run = (v, app, variant) => {
  const dir = `${S}/tools/v${v}/work/${app}-${variant ?? 'none'}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(`${S}/apps/${app}`, dir, { recursive: true });
  // A framework app ships framework.mjs (its own Vite plugins); they come first,
  // before any inline plugin, in both the baseline and the plugin builds.
  const fw = existsSync(`${dir}/framework.mjs`);
  const fwImport = fw ? "import fw from './framework.mjs';\n" : '';
  const fwSpread = fw ? '...fw' : '';
  let cfg = `${fwImport}export default { base: './', plugins: [${fwSpread}] };`;
  if (variant) { const spec = variants[variant];
    for (const [file] of spec.steps) copyFileSync(`${P}/vite-plugin-inline-${file}.mjs`, `${dir}/vite-plugin-inline-${file}.mjs`);
    const imports = spec.steps.map(([file, factory], i) => `import p${i} from './vite-plugin-inline-${file}.mjs';`).join('\n');
    const list = [fwSpread, ...spec.steps.map((_, i) => `p${i}()`)].filter(Boolean).join(', ');
    cfg = `${fwImport}${imports}\nexport default { plugins: [${list}]${app === 'fail-two-html' ? ", build:{rollupOptions:{input:['index.html','b.html']}}" : ''} };`; }
  writeFileSync(`${dir}/vite.config.mjs`, cfg);
  const r = spawnSync(`${S}/tools/v${v}/node_modules/.bin/vite`, ['build'], { cwd: dir, encoding: 'utf8' });
  const dist = `${dir}/dist`; const files = existsSync(dist) ? readdirSync(dist, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => e.name) : [];
  let size = 0, sha = '', dec = '';
  if (r.status === 0 && variant) { const b = readFileSync(`${dist}/index.html`); size = b.length; sha = createHash('sha1').update(b).digest('hex').slice(0, 8);
    const c = spawnSync('node', [`${P}/inline-check.mjs`, `${dist}/index.html`, '--check'], { encoding: 'utf8' });
    const d = spawnSync('node', [`${P}/inline-check.mjs`, `${dist}/index.html`, '--decode', `${dist}/decoded.html.txt`], { encoding: 'utf8' });
    dec = `check=${c.status} decode=${d.status} ${c.stdout.trim().split('\n')[0]}`; }
  out.push({ v, app, plugin: variant ?? 'none', tag: variant ? variants[variant].tag : '', status: r.status, files: files.join(','), size, sha, dec, tail: r.status ? (r.stdout + r.stderr).trim().split('\n').filter(l => /error|\binline-[a-z0-9-]+: \[|stage/i.test(l)).slice(0, 8).join(" / ").slice(0, 900) : '' });
};
for (const v of (process.argv[2] ?? '8,7,6').split(',')) for (const app of apps) { run(v, app, null); for (const p of chosen) run(v, app, p); }
for (const o of out) console.log([`v${o.v}`, o.app, o.plugin, `exit=${o.status}`, o.size, o.sha, o.files, o.dec, o.tail].join(' | '));
// MATRIX_OUT overrides the report path so parallel shards (one process per
// Vite version) do not overwrite each other; merge the shards afterwards.
writeFileSync(process.env.MATRIX_OUT ?? `${H}/tools/matrix.json`, JSON.stringify(out, null, 1));
// Pass or fail: a valid app gives exactly one file that checks and decodes; a refused app stops with the encode plugin's own message.
const bad = out.filter(o => o.plugin !== 'none').filter(o => mustFail(o.app)
  ? o.status === 0 || !o.tail.includes(`${o.tag}: [`)
  : o.status !== 0 || o.files !== 'index.html' || !o.dec.startsWith('check=0 decode=0'));
console.log(`${out.filter(o => o.plugin !== 'none').length} plugin builds, ${bad.length} wrong`);
for (const o of bad) console.log('WRONG', o.v, o.app, o.plugin, o.status, o.files, o.dec, o.tail);
process.exitCode = bad.length ? 1 : 0;
