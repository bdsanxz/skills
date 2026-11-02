// Installs the three Vite versions the plugins target into tools/, then builds apps/. Both are ignored by git.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const H = dirname(fileURLToPath(import.meta.url));
for (const [v, vite] of [[6, '6.4.5'], [7, '7.3.7'], [8, '8.3.5']]) {
  const dir = `${H}/tools/v${v}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, JSON.stringify({ private: true, type: 'module', dependencies: {
    vite, react: '18.3.1', 'react-dom': '18.3.1', 'javascript-obfuscator': '5.9.0',
    // Framework fixtures. Peer ranges differ per Vite major, so install loose; the
    // matrix reports any framework/Vite combo that its own plugin cannot build.
    vue: 'latest', '@vitejs/plugin-vue': 'latest',
    'solid-js': 'latest', 'vite-plugin-solid': 'latest',
    svelte: 'latest', '@sveltejs/vite-plugin-svelte': 'latest',
  } }, null, 2));
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent', '--legacy-peer-deps'], { cwd: dir, stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}
const r = spawnSync('node', [`${H}/make-apps.mjs`], { stdio: 'inherit' });
process.exit(r.status ?? 1);
