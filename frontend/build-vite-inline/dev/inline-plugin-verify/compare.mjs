import http from 'node:http'; import { readFileSync, existsSync, writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { extname, join } from 'node:path';
import { launch, tab, sleep } from './lib-cdp.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const H = dirname(fileURLToPath(import.meta.url));
const S = H;
const [vers, apps, plugins] = [process.argv[2].split(','), process.argv[3].split(','), (process.argv[4] || 'hex,hex-base64,base64,xor').split(',')];
const mime = { '.html': 'text/html; charset=utf-8', '.txt': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x');
  if (u.pathname === '/host') { const src = readFileSync(join(S, 'tools', u.searchParams.get('f'))); r.setHeader('content-type', 'text/html; charset=utf-8');
    return r.end(`<!doctype html><title>host</title><body style="margin:0"><iframe id=f style="width:1280px;height:800px;border:0" sandbox="${u.searchParams.get('s')}"></iframe><script>window.got=[];addEventListener('message',e=>got.push(e.data));f.srcdoc=${JSON.stringify(src.toString('utf8')).replace(/</g,'\\u003c')};</script>`); }
  const p = join(S, 'tools', decodeURIComponent(u.pathname)); if (!existsSync(p)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', mime[extname(p)] || 'application/octet-stream'); r.end(readFileSync(p)); });
await new Promise(r => srv.listen(0, r)); const port = srv.address().port; const base = `http://localhost:${port}`;
const INIT = `(function(){if(window!==top)return;let seed=12345;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};let t=1000;performance.now=()=>t;let q=[];const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=f=>{q.push(f);return q.length};window.__step=n=>new Promise(res=>{raf(()=>{for(let i=0;i<n;i++){t+=16;const c=q;q=[];c.forEach(f=>f(t))}raf(()=>res())})});window.__firebase_config='{"host":"cfg"}';window.__app_id='app-1';window.__host={dcl:0,load:0};document.addEventListener('DOMContentLoaded',()=>__host.dcl++);addEventListener('load',()=>__host.load++);})()`;
const SNAP = `(()=>{const ls={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);ls[k]=localStorage.getItem(k)}}catch(e){ls.err=1}return {dom:(document.doctype?'<!doctype '+document.doctype.name+'>':'')+document.documentElement.outerHTML,mode:document.compatMode,cs:document.characterSet,title:document.title,url:location.href.includes('/'),host:window.__host,fb:typeof __firebase_config==='string'?__firebase_config:null,p:window.__p||null,nasty:window.__nasty||null,lazy:window.__lazy||null,assets:window.__assets||null,big:window.__big?window.__big.length:null,ls,loaderGlobals:['h','b','s','m','d','hex','bytes'].filter(k=>k in window&&k!=='h'||false)}})()`;
const firstLine = s => String(s).split('\n')[0];
const b = await launch(); const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 10);
async function top(path) { const t = await tab(b, { init: INIT }); await t.goto(base + path);
  for (let i = 0; i < 200 && await t.ev('document.readyState').catch(() => '') !== 'complete'; i++) await sleep(50);
  await t.ev('document.fonts.ready.then(()=>1)').catch(()=>{}); await sleep(500); await t.ev('window.__step(30)');
  const s1 = await t.ev(SNAP); const px1 = sha(await t.shot());
  await t.click(640, 400); await t.ev('document.querySelector("#inc")&&document.querySelector("#inc").click();1'); await sleep(300); await t.ev('window.__step(30)'); const s2 = await t.ev(SNAP); const px2 = sha(await t.shot());
  const log = { ex: t.log.exceptions.map(firstLine), con: t.log.console.slice() }; await t.close(); return { s1, s2, px1, px2, log }; }
async function frame(f, s) { const t = await tab(b); await t.goto(`${base}/host?f=${encodeURIComponent(f)}&s=${encodeURIComponent(s)}`); let got = [];
  for (let i = 0; i < 40; i++) { if (i >= 10 && !got.length) break; await sleep(500); await t.ev(`got.length=0;f.contentWindow.postMessage('report','*');1`); await sleep(100); got = await t.ev('got'); if (got.some(x => x && x.ready === 'complete')) break; } const ex = t.log.exceptions.map(firstLine); await t.close(); return { rep: got.find(x => x && x.kind === 'report') ?? null, ex }; }
const rows = [], pixelRetries = [];
for (const v of vers) for (const app of apps) for (const pl of plugins) {
  const d = `v${v}/work/${app}-${pl}/dist`; if (!existsSync(join(S, 'tools', d, 'index.html'))) { rows.push(`v${v} ${app} ${pl}: NO BUILD`); continue; }
  const dec = `${d}/decoded.html.txt`; const issues = [];
  const A = await top(`/${dec}`), B = await top(`/${d}/index.html`);
  for (const k of ['s1', 's2']) { const a = A[k], c = B[k]; for (const f of Object.keys(a)) { if (f === 'host') continue; if (JSON.stringify(a[f]) !== JSON.stringify(c[f])) issues.push(`${k}.${f} differs` + (f === 'dom' ? ` (${a.dom.length} vs ${c.dom.length}) at ${(()=>{let i=0;while(a.dom[i]===c.dom[i])i++;return i+': '+JSON.stringify(a.dom.slice(Math.max(0,i-50),i+50))+' VS '+JSON.stringify(c.dom.slice(Math.max(0,i-50),i+50))})()}` : `: ${JSON.stringify(a[f]).slice(0, 180)} VS ${JSON.stringify(c[f]).slice(0, 180)}`)); }
    if (JSON.stringify(a.host) !== JSON.stringify(c.host)) issues.push(`${k}.host ${JSON.stringify(a.host)} vs ${JSON.stringify(c.host)}`); }
  // Pixels: a page with remote fonts or pictures can paint late. One exact match on both frames settles it; the retries are reported.
  let px = [A, B], tries = 0;
  while ((px[0].px1 !== px[1].px1 || px[0].px2 !== px[1].px2) && tries < 4) { tries++; px = [await top(`/${dec}`), await top(`/${d}/index.html`)]; }
  if (tries) pixelRetries.push(`v${v} ${app} ${pl}: ${tries}`);
  if (px[0].px1 !== px[1].px1) issues.push('pixels before click differ'); if (px[0].px2 !== px[1].px2) issues.push('pixels after click differ');
  if (JSON.stringify(A.log) !== JSON.stringify(B.log)) issues.push(`log differs: ${JSON.stringify(A.log).slice(0, 300)} VS ${JSON.stringify(B.log).slice(0, 300)}`);
  // Sandboxed iframes, Canvas-like. Reports exist only where the probe is built in.
  for (const sb of ['allow-scripts', 'allow-scripts allow-same-origin']) { const fa = await frame(dec, sb), fb = await frame(`${d}/index.html`, sb);
    if (JSON.stringify(fa.rep) !== JSON.stringify(fb.rep)) issues.push(`iframe[${sb}] report differs: ${JSON.stringify(fa.rep)?.slice(0, 300)} VS ${JSON.stringify(fb.rep)?.slice(0, 300)}`);
    if (JSON.stringify(fa.ex) !== JSON.stringify(fb.ex)) issues.push(`iframe[${sb}] exceptions: ${JSON.stringify(fa.ex).slice(0,200)} VS ${JSON.stringify(fb.ex).slice(0,200)}`); }
  rows.push(`v${v} ${app} ${pl}: ${issues.length ? 'DIFF\n   - ' + issues.join('\n   - ') : 'SAME'} [ex=${B.log.ex.length} order=${(B.s1.p?.order||[]).length} ls=${Object.keys(B.s2.ls).length} clickchangedpx=${B.px1!==B.px2}]`);
  console.log(rows.at(-1));
}
// Against a plain Vite build of the same app: same look and same state, though the markup differs by design.
for (const v of vers) for (const app of apps) { const none = `v${v}/work/${app}-none/dist/index.html`, enc = `v${v}/work/${app}-${plugins.includes('hex-base64') ? 'hex-base64' : plugins[0]}/dist/index.html`;
  if (!existsSync(join(S, 'tools', none)) || !existsSync(join(S, 'tools', enc))) continue;
  const A = await top('/' + none), B = await top('/' + enc), issues = [];
  for (const f of ['title', 'mode', 'cs', 'nasty', 'lazy', 'big', 'ls', 'fb']) if (JSON.stringify(A.s2[f]) !== JSON.stringify(B.s2[f])) issues.push(`${f}: ${JSON.stringify(A.s2[f])?.slice(0, 120)} VS ${JSON.stringify(B.s2[f])?.slice(0, 120)}`);
  let px = [A, B], tries = 0;
  while ((px[0].px1 !== px[1].px1 || px[0].px2 !== px[1].px2) && tries < 4) { tries++; px = [await top('/' + none), await top('/' + enc)]; }
  if (tries) pixelRetries.push(`v${v} ${app} baseline: ${tries}`);
  if (px[0].px1 !== px[1].px1) issues.push('pixels before click differ'); if (px[0].px2 !== px[1].px2) issues.push('pixels after click differ'); if (A.log.ex.length !== B.log.ex.length) issues.push(`exceptions ${A.log.ex.length} vs ${B.log.ex.length}`);
  rows.push(`v${v} ${app} baseline: ${issues.length ? 'DIFF\n   - ' + issues.join('\n   - ') : 'SAME'}`); console.log(rows.at(-1)); }
const diffs = rows.filter(r => !r.includes(': SAME'));
// Noise control: the same decoded file against itself, for every app with a retry.
for (const app of new Set(pixelRetries.map(x => x.split(' ')[1]))) { const f = `/v${vers[0]}/work/${app}-hex-base64/dist/decoded.html.txt`; if (!existsSync(join(S, 'tools', f))) continue; const seen = new Set(); for (let i = 0; i < 4; i++) seen.add((await top(f)).px1); console.log(`control ${app}: ${seen.size} distinct pictures from 4 loads of one file`); }
console.log(`pixel retries: ${pixelRetries.join(', ') || 'none'}`);
console.log(`${rows.length} comparisons, ${diffs.length} not the same`);
process.exitCode = diffs.length ? 1 : 0;
await b.close(); srv.close();
