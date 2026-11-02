import { createSignal, createEffect } from 'solid-js';
export default function App() {
  const [n, setN] = createSignal((() => { try { return +localStorage.getItem('n') || 0 } catch (e) { return 0 } })());
  createEffect(() => { try { localStorage.setItem('n', n()) } catch (e) {} document.title = 'Tugas ' + n(); });
  return <div class="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{n()}</p><button id="inc" onClick={() => setN(n() + 1)}>Tambah</button></div>;
}