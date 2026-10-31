// Bounded readiness waits: every wait an agent launch does, with its defaults in one
// place. `hc wait` and `herdr agent wait` report no turn status for some runtimes
// (qoder looks like a plain shell; idle agents and misclassified tabs never change
// status), so a blind 90 s wait stalls the launch. Instead each settle waits for a
// status report only briefly, then polls the screen until the terminal is gone, a
// known dialog or the agent's idle input line appears, the screen stops changing,
// or an overall cap is reached. All timings are injectable for tests; dry runs
// never consult them and stay instant.

import { sleep, strip } from "./core";
import type { Dialog } from "./herdr";

/** Overall cap for one settle, in ms. */
export const WAIT_MS = 90000;
/** How long one settle waits for a status report before polling the screen, in ms. */
export const SHORT_WAIT_MS = 10000;
/** Screen output that counts as settled: unchanged for this long, in ms. */
export const SETTLE_MS = 3000;
/** How often the screen is read while polling, in ms. */
export const POLL_MS = 1000;

export type WaitConfig = {
  /** Overall cap for one settle, in ms. */
  waitMs: number;
  /** Status-report wait before the screen poll, in ms. */
  shortMs: number;
  /** Unchanged-screen window that counts as settled, in ms. */
  settleMs: number;
  /** Screen poll interval, in ms. */
  pollMs: number;
};

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** The launch wait timings, from the environment with the defaults above. */
export function waitConfig(): WaitConfig {
  return {
    waitMs: envMs("ROSTER_WAIT_MS", WAIT_MS),
    shortMs: envMs("ROSTER_SHORT_WAIT_MS", SHORT_WAIT_MS),
    settleMs: envMs("ROSTER_SETTLE_MS", SETTLE_MS),
    pollMs: envMs("ROSTER_POLL_MS", POLL_MS),
  };
}

/** One screen read: a vanished terminal, or the screen text. */
export type Screen = { gone: boolean; text: string };

/** What the readiness poll stopped on: a vanished terminal, a known dialog, the
 * agent's idle input line, an unchanged screen, or the overall cap. */
export type PollStop = "gone" | "dialog" | "ready" | "stable" | "capped";

/** Poll read() about once per pollMs until the terminal is gone, a dialog marker
 * or the ready marker (both matched lower-cased) appears, a non-empty screen is
 * unchanged for settleMs, or the deadline passes. Always reads at least once. */
export function pollScreen(
  read: () => Screen,
  dialogs: Dialog[],
  ready: string | null | undefined,
  cfg: WaitConfig,
  deadline: number,
): PollStop {
  const markers = dialogs.map(([marker]) => marker);
  const want = (ready ?? "").toLowerCase();
  let last = "\0";
  let changedAt = Date.now();
  for (;;) {
    const now = Date.now();
    const screen = read();
    if (screen.gone) return "gone";
    const text = screen.text.toLowerCase();
    if (text !== last) {
      last = text;
      changedAt = now;
    }
    if (markers.some((marker) => text.includes(marker))) return "dialog";
    if (want !== "" && text.includes(want)) return "ready";
    if (strip(text) !== "" && now - changedAt >= cfg.settleMs) return "stable";
    if (now >= deadline) return "capped";
    if (cfg.pollMs > 0) sleep(Math.min(cfg.pollMs, Math.max(deadline - now, 0)));
  }
}
