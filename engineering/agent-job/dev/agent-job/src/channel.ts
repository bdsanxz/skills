// `agent-job channel`: an MCP stdio server that Claude Code loads as a channel. It holds the
// session's lease like `watch` does, and pushes each fired cron into the conversation as a turn
// (`notifications/claude/channel`), so the agent arms nothing. It dies with the session: Claude Code
// closes its stdin and stops it, which is how the daemon learns the session is gone.

import { trace } from "./trace.ts";
import { address } from "./store.ts";
import type { Store } from "./store.ts";
import { pidAlive, run } from "./providers.ts";

const BEAT_MS = 1000;
const PROTOCOL = "2025-06-18";

const INSTRUCTIONS =
  'Messages from source "agent-job" are crons fired for this session: each one is an instruction the user or you scheduled earlier. Do what it says, then report briefly. Reply with nothing else; there is no reply tool.';

/** This session's id: the environment, else the `claude agents` entry whose pid is our parent. */
export function claudeSessionId(parent: number, env: Record<string, string | undefined> = process.env): string | null {
  if (env.CLAUDE_CODE_SESSION_ID) return env.CLAUDE_CODE_SESSION_ID;
  const r = run("claude", ["agents", "--json"]);
  try {
    const list = JSON.parse(r.out) as { pid?: number; sessionId?: string }[];
    return list.find((s) => s.pid === parent)?.sessionId ?? null;
  } catch {
    return null;
  }
}

export async function channel(store: Store): Promise<void> {
  const parent = process.ppid;
  const token = crypto.randomUUID();
  let addr: string | null = null;
  const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");
  const release = () => {
    try {
      if (addr) store.dropLease(addr, token);
    } catch {}
  };
  process.on("exit", release);
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP", "SIGPIPE"] as const) {
    process.on(s, () => {
      release();
      process.exit(0);
    });
  }
  process.stdout.on("error", () => process.exit(0));

  const reply = (id: unknown, result: object) => send({ jsonrpc: "2.0", id, result });
  const handle = (line: string) => {
    let m: { id?: unknown; method?: string; params?: { protocolVersion?: string } };
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.method === "initialize") {
      reply(m.id, {
        protocolVersion: m.params?.protocolVersion ?? PROTOCOL,
        capabilities: { experimental: { "claude/channel": {} } },
        serverInfo: { name: "agent-job", version: "1" },
        instructions: INSTRUCTIONS,
      });
    } else if (m.method === "ping") reply(m.id, {});
    else if (m.id !== undefined && m.method) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  };

  // The beat: find the session, hold its lease, push what is queued.
  void (async () => {
    for (;;) {
      if (!pidAlive(parent)) process.exit(0);
      if (!addr) {
        const id = claudeSessionId(parent);
        if (id) {
          addr = address("claude", id);
          store.takeLease(addr, process.pid, token);
        }
      } else if (!store.beat(addr, token)) {
        process.exit(0); // another channel or watch took the lease
      } else {
        for (const row of store.pending(addr)) {
          send({ jsonrpc: "2.0", method: "notifications/claude/channel", params: { content: row.text.replace(/ ⏎ /g, "\n"), meta: { cron: row.cron_id ?? "" } } });
          store.markDelivered(row.id);
          trace("channel", "push", { addr, cron: row.cron_id });
        }
      }
      await Bun.sleep(addr ? BEAT_MS : 2000);
    }
  })();

  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) handle(line);
    }
  }
  release();
}
