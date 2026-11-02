import { createSignal, onMount, onCleanup, For } from 'solid-js';
import { startGarden, TOOL_IDS } from './garden.js';

// Pixel art for the tool icons, one row of single-letter colour codes each.
// Kept in step with TOOL_IDS so the keyboard shortcuts match the toolbar order.
const TOOLS = [
  { id: 'look', label: 'Look', art: ['.......', '..www..', '.wkkkw.', 'wkkbkkw', '.wkkkw.', '..www..', '.......'] },
  { id: 'tulip', label: 'Tulip', art: ['.r.r.r.', '.rrrrr.', '.rrrrr.', '..rrr..', '...g...', '.g.g.g.', '..ggg..'] },
  { id: 'lavender', label: 'Lavender', art: ['.p...p.', '.pp.pp.', '.p.p.p.', '.g.p.g.', '.g.g.g.', '..ggg..', '...g...'] },
  { id: 'sunflower', label: 'Sunflower', art: ['y.y.y..', '.yyy...', 'yybyy..', '.yyy...', '..g.g..', '..gg...', '..g....'] },
  { id: 'cabbage', label: 'Cabbage', art: ['.......', '..lll..', '.lgggl.', 'lglglgl', 'lggggl.', '.lllll.', '.......'] },
  { id: 'tree', label: 'Apple', art: ['..ggg..', '.gggrg.', 'grgggg.', '.gggrg.', '...t...', '...t...', '..ttt..'] },
  { id: 'dig', label: 'Dig up', art: ['....ss.', '...sss.', '..tss..', '.tt....', 'tt.....', 'b......', '.......'] }
];
const ICON = { w: '#f6efdc', k: '#3d2c1f', b: '#5c3a1e', r: '#e5383b', g: '#3f8e2f', p: '#8d67d6', y: '#ffcf33', l: '#8fd968', t: '#7a5636', s: '#b9bcc4' };

function drawIcon(cv, art) {
  const x = cv.getContext('2d');
  art.forEach((row, py) => [...row].forEach((ch, px) => { if (ICON[ch]) { x.fillStyle = ICON[ch]; x.fillRect(px, py, 1, 1); } }));
}

export default function App() {
  const [stats, setStats] = createSignal('');
  const [readout, setReadout] = createSignal('16:30');
  const [sliderValue, setSliderValue] = createSignal(16.5);
  const [activeTool, setActiveTool] = createSignal('look');
  const [cycling, setCycling] = createSignal(false);
  const [raining, setRaining] = createSignal(false);
  const [toastText, setToastText] = createSignal('');
  const [toastVisible, setToastVisible] = createSignal(false);
  // 0 when idle, else the pending timer id while a reset waits for confirmation.
  const [resetArmed, setResetArmed] = createSignal(0);

  let canvasEl, garden, toastTimer = 0;

  // The engine pushes UI state out through these callbacks; it never touches the DOM UI.
  const api = {
    setStats,
    setReadout,
    setSlider: setSliderValue,
    setActiveTool,
    setCycling,
    setRaining,
    toast(msg) {
      setToastText(msg); setToastVisible(true);
      clearTimeout(toastTimer); toastTimer = setTimeout(() => setToastVisible(false), 2400);
    },
  };

  onMount(() => { garden = startGarden(canvasEl, api); });
  onCleanup(() => { clearTimeout(toastTimer); const a = resetArmed(); if (a) clearTimeout(a); });

  const onReset = () => {
    if (!resetArmed()) {
      setResetArmed(setTimeout(() => setResetArmed(0), 3000));
      return;
    }
    clearTimeout(resetArmed()); setResetArmed(0);
    garden && garden.reset();
  };

  return (
    <>
      <canvas class="garden__canvas" id="garden-canvas" ref={canvasEl}
        aria-label="A rotating 3D voxel garden on a floating island"></canvas>
      <div class="garden__ui">
        <div class="garden__top">
          <section class="sign">
            <h1 class="sign__title">Voxel Garden</h1>
            <p class="sign__hint">Drag to orbit, scroll or pinch to zoom. Pick a plant, then click open grass or soil.</p>
            <p class="sign__stats" id="garden-stats">{stats()}</p>
          </section>
          <section class="sign clock" aria-label="Time and weather">
            <div class="clock__row">
              <label class="clock__label" for="time-slider">Time of day</label>
              <span class="clock__time" id="time-readout">{readout()}</span>
            </div>
            <input class="clock__slider" id="time-slider" type="range" min="0" max="24" step="0.05"
              value={sliderValue()}
              onInput={(e) => { const v = +e.currentTarget.value; setSliderValue(v); garden && garden.setHours(v); }} />
            <div class="clock__actions">
              <button class="chip" classList={{ 'chip--on': cycling() }} id="cycle-toggle" type="button"
                aria-pressed={cycling()} onClick={() => garden && garden.toggleCycle()}>
                {cycling() ? 'Stop clock' : 'Run clock'}
              </button>
              <button class="chip" classList={{ 'chip--on': raining() }} id="rain-toggle" type="button"
                aria-pressed={raining()} onClick={() => garden && garden.toggleRain()}>Rain</button>
              <button class="chip" classList={{ 'chip--warn': !!resetArmed() }} id="reset-button" type="button"
                onClick={onReset}>{resetArmed() ? 'Confirm reset' : 'Reset'}</button>
            </div>
          </section>
        </div>
        <div class="tools sign" id="tools" role="toolbar" aria-label="Garden tools">
          <For each={TOOLS}>{(t, i) => (
            <button class="tool" classList={{ 'tool--active': activeTool() === t.id }}
              type="button" id={'tool-' + t.id} data-tool={t.id}
              aria-pressed={activeTool() === t.id}
              onClick={() => garden && garden.setTool(t.id)}>
              <canvas class="tool__icon" width="7" height="7" aria-hidden="true"
                ref={(el) => drawIcon(el, t.art)}></canvas>
              <span>{t.label} <span class="tool__key">{i() + 1}</span></span>
            </button>
          )}</For>
        </div>
      </div>
      <div class="toast" classList={{ 'toast--visible': toastVisible() }} id="toast" role="status" aria-live="polite">{toastText()}</div>
    </>
  );
}
