// Builds every test app into apps/ from fixtures/: voxel-garden shapes, React, edge cases, must-fail cases, and the real pages.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const H = dirname(fileURLToPath(import.meta.url));
const fixture = `${H}/fixtures/voxel-garden.html`, out = `${H}/apps`;
const raw = readFileSync(fixture, 'utf8');
// solid-voxel is kept by hand: nothing below generates it, so a rebuild must not delete it.
const HAND_KEPT = new Set(['solid-voxel']);
mkdirSync(out, { recursive: true });
for (const d of readdirSync(out)) if (!HAND_KEPT.has(d)) rmSync(`${out}/${d}`, { recursive: true, force: true });
export const PROBE = `<script>window.__p={order:['head-inline'],events:[],errors:[],host:typeof window.__firebase_config==='undefined'?null:window.__firebase_config,writes:0};addEventListener('error',function(e){__p.errors.push(String(e.message||e.target&&e.target.src))},true);addEventListener('unhandledrejection',function(e){__p.errors.push('rej:'+e.reason)});document.addEventListener('DOMContentLoaded',function(){__p.events.push('DCL:'+document.readyState)});addEventListener('load',function(){__p.events.push('load:'+document.readyState)});addEventListener('message',function(e){if(e.data!=='report')return;var ls;try{localStorage.setItem('x','1');localStorage.removeItem('x');ls=true}catch(_){ls=false}var c=document.querySelector('canvas');parent.postMessage({kind:'report',p:__p,title:document.title,mode:document.compatMode,cs:document.characterSet,ready:document.readyState,ls:ls,canvas:!!c,gl:c&&!!c.getContext('webgl2'),metas:document.querySelectorAll('meta').length,scripts:document.scripts.length,styles:document.querySelectorAll('style').length,loaders:[].slice.call(document.scripts).filter(function(s){return /document\\.write/.test(s.textContent)&&s.textContent.length<8000000&&/atob|parseInt/.test(s.textContent.slice(0,400))}).length,text:document.body.innerText.slice(0,300)},'*')})</script>`;
const nasty = `<script>__p.order.push('body-inline');window.__nasty=["<\\/script>","<!-- x -->","$&","$'","$\`","\\u00e9","日本語 🌱 — é","\\\\x41"].join('|');document.addEventListener('DOMContentLoaded',function(){__p.order.push('dcl-handler')})</script><script defer>__p.order.push('inline-defer-ignored')</script><span id="nasty">日本語 🌱 — é &amp; &lt;b&gt;</span>`;
const dt = '<!doctype html>\n';
// A: as given (no doctype). B: doctype only. C: doctype + probe + nasty strings inline.
const mk = (d, html, extra = {}) => { mkdirSync(`${out}/${d}`, { recursive: true }); writeFileSync(`${out}/${d}/index.html`, html); for (const [k, v] of Object.entries(extra)) { mkdirSync(`${out}/${d}/${k.split('/').slice(0, -1).join('/') || '.'}`, { recursive: true }); writeFileSync(`${out}/${d}/${k}`, v); } };
mk('no-doctype', raw);
mk('plain', dt + raw);
const withProbe = dt + raw.replace('<title>', () => '<meta charset="utf-8">' + PROBE + '<title>').replace(/<script>(?![\s\S]*<script>)/, () => nasty + '<script>');
mk('inline', withProbe);
// split
const css = raw.match(/<style>([\s\S]*?)<\/style>/)[1];
const js = raw.match(/<script>([\s\S]*)<\/script>/)[1];
const html = dt + raw.replace(/<style>[\s\S]*?<\/style>/, () => '').replace(/<script>[\s\S]*<\/script>/, () => '').replace('<title>', () => '<meta charset="utf-8">' + PROBE + '<title>') + nasty + '<script type="module" src="/src/main.js"></script>';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#b6e06a"/></svg>';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
mkdirSync(`${out}/split/src`, { recursive: true });
mk('split', html, {
 'src/style.css': css + '\n.probe-bg{background:url(./dot.png)}\n/* </style> <!-- $& */ .probe-q::before{content:"</style> é 日本"}',
 'src/dot.png': png, 'src/dot.svg': svg,
 'src/lazy.js': `export const lazy = 'lazy-ok </script> $& 日本語 ' + (6*7);`,
 'src/garden.js': js,
 'src/main.js': `import './style.css';\nimport dot from './dot.png';\nimport svg from './dot.svg';\nimport './garden.js';\n__p.order.push('module-main');window.__assets=[dot.slice(0,10),svg.slice(0,10)];\nimport('./lazy.js').then(m=>{window.__lazy=m.lazy;__p.order.push('lazy-done')});\ndocument.addEventListener('DOMContentLoaded',()=>__p.order.push('module-dcl'));\n`,
});

// React + CSS, the shape most Canvas apps have.
mk('react', dt + `<html lang="id"><head><meta charset="utf-8"><title>Tugas</title>${PROBE}</head><body class="b"><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`, {
 'src/a.css': `.b{margin:0;font:16px/1.4 system-ui;background:#f6efdc}.card{padding:24px;width:400px;background:#fff}button{padding:8px 16px;background:#2b1e15;color:#fff;border:0}`,
 'src/main.jsx': `import React,{useState,useEffect,lazy,Suspense} from 'react';import {createRoot} from 'react-dom/client';import './a.css';
const Late=lazy(()=>import('./late.jsx'));
function App(){const [n,setN]=useState(()=>{try{return +localStorage.getItem('n')||0}catch(e){return 0}});useEffect(()=>{try{localStorage.setItem('n',n)}catch(e){};document.title='Tugas '+n},[n]);
return <div className="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{n}</p><button id="inc" onClick={()=>setN(n+1)}>Tambah</button>{n>0&&<Suspense fallback={<i>…</i>}><Late/></Suspense>}</div>}
__p.order.push('react-main');createRoot(document.getElementById('root')).render(<App/>);`,
 'src/late.jsx': `import React from 'react';export default function Late(){return <p id="late">late chunk ok </p>}`,
});

// The same counter in Vue, Svelte and Solid: each builds through its own Vite
// plugin, declared in framework.mjs, so the inline plugins meet real framework
// bundle output. Each has the #inc button, #count, localStorage 'n' and title the
// probe and compare harness drive, like react.
const fwHtml = (src) => dt + `<html lang="id"><head><meta charset="utf-8"><title>Tugas</title>${PROBE}</head><body class="b"><div id="root"></div><script type="module" src="${src}"></script></body></html>`;
const CARD = `.b{margin:0}.card{padding:24px;width:400px;background:#fff;font:16px/1.4 system-ui}button{padding:8px 16px}`;

mk('vue', fwHtml('/src/main.js'), {
 'framework.mjs': `import vue from '@vitejs/plugin-vue';\nexport default [vue()];`,
 'src/main.js': `import { createApp } from 'vue';import App from './App.vue';__p.order.push('vue-main');createApp(App).mount('#root');`,
 'src/App.vue': `<script setup>
import { ref, watch } from 'vue';
const read = () => { try { return +localStorage.getItem('n') || 0 } catch (e) { return 0 } };
const n = ref(read());
watch(n, (v) => { try { localStorage.setItem('n', v) } catch (e) {} document.title = 'Tugas ' + v }, { immediate: true });
</script>
<template><div class="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{{ n }}</p><button id="inc" @click="n++">Tambah</button></div></template>
<style>` + CARD + `</style>`,
});

mk('svelte', fwHtml('/src/main.js'), {
 'framework.mjs': `import { svelte } from '@sveltejs/vite-plugin-svelte';\nexport default [svelte()];`,
 'svelte.config.js': `export default {};`,
 'src/main.js': `import { mount } from 'svelte';import App from './App.svelte';__p.order.push('svelte-main');mount(App, { target: document.getElementById('root') });`,
 'src/App.svelte': `<script>
let n = $state((() => { try { return +localStorage.getItem('n') || 0 } catch (e) { return 0 } })());
$effect(() => { try { localStorage.setItem('n', n) } catch (e) {} document.title = 'Tugas ' + n });
</script>
<div class="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{n}</p><button id="inc" onclick={() => n++}>Tambah</button></div>
<style>` + CARD + `</style>`,
});

mk('solid', fwHtml('/src/main.jsx'), {
 'framework.mjs': `import solid from 'vite-plugin-solid';\nexport default [solid()];`,
 'src/main.jsx': `import { render } from 'solid-js/web';import App from './App.jsx';__p.order.push('solid-main');render(App, document.getElementById('root'));`,
 'src/App.jsx': `import { createSignal, createEffect } from 'solid-js';
export default function App() {
  const [n, setN] = createSignal((() => { try { return +localStorage.getItem('n') || 0 } catch (e) { return 0 } })());
  createEffect(() => { try { localStorage.setItem('n', n()) } catch (e) {} document.title = 'Tugas ' + n(); });
  return <div class="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{n()}</p><button id="inc" onClick={() => setN(n() + 1)}>Tambah</button></div>;
}`,
});

// Odd but legal markup and scripts that look at the document.
mk('edge', dt + `<html lang="id" data-a="1" class="root"><head><meta charset="utf-8"><title>Edge &amp; Tépi</title><base target="_blank">${PROBE}<style media="screen">.e{color:rgb(1,2,3)}</style><link rel="icon" href="data:,"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi"></head><body data-b="2" onload="__p.order.push('body-onload')"><noscript><p>no js</p></noscript><template id="t"><script>__p.order.push('NEVER')</script></template><svg width="8" height="8"><title>s</title><circle r="4"/></svg><textarea id="ta"></script> </textarea><img id="remote" alt="" src="https://example.invalid/x.png"><script>__p.order.push('cs:'+(document.currentScript&&document.currentScript.tagName));document.write('<p id=dw>written é</p>');__p.order.push('dw:'+!!document.getElementById('dw'))</script><script type="application/json" id="data">{"k":"</scr"}</script><script type="text/plain" id="tp">$& $' $\` <!-- x</script><script>var topLevelVar=1;__p.order.push('global:'+(window.topLevelVar===1));__p.order.push('loaderLeft:'+Object.keys(window).filter(function(k){return /^(h|b|i|s|m|d)$/.test(k)}).length)</script><script type="module">__p.order.push('inline-module');</script><p class="e" id="e">ok</p></body></html>`);
// Large: well past the 800 KB warning.
mk('large', dt + `<meta charset="utf-8"><title>Besar</title>${PROBE}<script>window.__big=${JSON.stringify('日本語abc🌱'.repeat(60000))};__p.order.push('big:'+__big.length)</script><p>besar</p>`);
// Must fail.
const f = (n, b, e) => mk('fail-' + n, dt + `<meta charset="utf-8"><title>x</title>${b}`, e);
f('ext-script', '<script src="https://cdn.example.com/x.js"></script>');
f('ext-style', '<link rel="stylesheet" href="https://cdn.example.com/x.css">');
f('public-ref', '<img src="/logo.png">', { 'public/logo.png': png });
f('worker', '<script type="module" src="/m.js"></script>', { 'm.js': `import W from './w.js?worker';new W();`, 'w.js': 'self.postMessage(1)' });
f('protocol-rel', '<script src="//cdn.example.com/x.js"></script>');
f('local-img', '<img src="/missing.png">');
f('local-css-url', '<style>@font-face{font-family:x;src:url(/missing.woff2)}</style>');
f('local-srcset', '<img alt="" srcset="/a.png 1x, /b.png 2x">');
f('local-poster', '<video poster="/p.png"></video>');
// Documented limit: a comment before <html> lands in <head>. Everything else must still match.
mk('comment-before-html', dt + `<!-- top comment --><html lang="id"><head><meta charset="utf-8"><title>c</title>${PROBE}</head><body><p>c</p></body></html>`);
// Lookalikes in code and comments must not fail the build.
mk('lookalike', dt + `<meta charset="utf-8"><title>l</title>${PROBE}<!-- <img src="/x.png"> --><style>/* url(/x.png) */</style><textarea><img src="/x.png"></textarea><template><img src="/x.png"></template><script>window.__l='<img src="/x.png"> url(/y.png)'</script><p>l</p>`);
// The real pages, unchanged: Tailwind by CDN and local assets must be refused.
for (const n of [1, 2, 3, 4, 5]) {
  const page = readFileSync(`${H}/fixtures/ui-design/${n}.html`, 'utf8');
  mk(`fail-ui-cdn-${n}`, page);
  mk(`ui-nocdn-${n}`, page.replace(/<script[^>]*src="https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*><\/script>/g, ''));
}
mk('fail-samples', readFileSync(`${H}/fixtures/samples/index.html`, 'utf8'));
mk('fail-two-html', dt + '<title>a</title><p>a', { 'b.html': dt + '<title>b</title><p>b', 'vite.extra.json': JSON.stringify({ input: ['index.html', 'b.html'] }) });
