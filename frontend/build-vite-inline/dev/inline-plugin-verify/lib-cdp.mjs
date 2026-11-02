// Minimal Chrome DevTools Protocol driver, no dependencies.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
  const p = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--window-size=1280,800', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => { let b = ''; p.stderr.on('data', d => { b += d; const m = b.match(/ws:\/\/\S+/); if (m) res(m[0]); }); setTimeout(() => rej(new Error('chrome no ws: ' + b)), 20000); });
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(), listeners = new Set();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else for (const l of listeners) l(m); });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return { send, on: l => listeners.add(l), off: l => listeners.delete(l), close: async () => { p.kill(); await sleep(300); try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}
// One isolated browser context with one tab.
export async function tab(b, { init } = {}) {
  const { browserContextId } = await b.send('Target.createBrowserContext');
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank', browserContextId, width: 1280, height: 800 });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => b.send(m, p, sessionId);
  const log = { console: [], exceptions: [] };
  const l = m => { if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') log.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled') log.console.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`); };
  b.on(l);
  await s('Page.enable'); await s('Runtime.enable');
  if (init) await s('Page.addScriptToEvaluateOnNewDocument', { source: init });
  const ev = async expr => { const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  return { s, ev, log, goto: url => s('Page.navigate', { url }),
    shot: async () => (await s('Page.captureScreenshot', { format: 'png' })).data,
    click: async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' }); },
    close: async () => { b.off(l); await b.send('Target.closeTarget', { targetId }); await b.send('Target.disposeBrowserContext', { browserContextId }); } };
}
