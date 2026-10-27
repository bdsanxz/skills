// `agent-job watch`: a session's lease and its line of delivery. The process prints one line per
// fired cron to stdout, which the runtime turns into a turn (a Monitor event in Claude Code,
// a user message through the pi extension). It dies with its session, which is how the daemon learns
// that the session is gone: the runtime stops its child processes when the session ends.

import { pidAlive } from "./providers.ts";
import type { Store } from "./store.ts";

export const BEAT_MS = 1000;

/** Prints the lines waiting for `addr` and marks them delivered; returns how many. */
export function flush(store: Store, addr: string, out: (line: string) => void): number {
  const rows = store.pending(addr);
  for (const row of rows) {
    out(row.text.replace(/\n/g, " ⏎ "));
    store.markDelivered(row.id);
  }
  return rows.length;
}

export async function watch(store: Store, addr: string): Promise<void> {
  const token = crypto.randomUUID();
  const parent = process.ppid;
  store.takeLease(addr, process.pid, token);
  const release = () => {
    try {
      store.dropLease(addr, token);
    } catch {}
  };
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP", "SIGPIPE"] as const) {
    process.on(s, () => {
      release();
      process.exit(0);
    });
  }
  process.on("exit", release);
  process.stdout.on("error", () => {
    release();
    process.exit(0);
  });
  for (;;) {
    if (!store.beat(addr, token)) return; // another watch took the lease
    if (!pidAlive(parent)) return release(); // the session's shell is gone
    flush(store, addr, (line) => process.stdout.write(line + "\n"));
    await Bun.sleep(BEAT_MS);
  }
}
