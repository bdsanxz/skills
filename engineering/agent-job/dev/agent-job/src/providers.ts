// What each agent runtime offers: who the current session is, whether a session is still alive,
// and how a line is injected into it. Nothing here ever starts a session or runs one headless.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { address, type Store } from "./store.ts";

export const PROVIDERS = ["claude", "opencode", "antigravity", "pi"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** live: the session is open. dead: it is gone. unknown: this machine cannot tell right now. */
export interface Liveness {
  state: "live" | "dead" | "unknown";
  detail: string;
}

export interface Delivery {
  ok: boolean;
  detail: string;
}

export interface Adapter {
  provider: string;
  /** "watch": the session collects lines through `agent-job watch`. "push": the daemon injects them. */
  mode: "watch" | "push";
  liveness(store: Store, sessionId: string): Liveness;
  deliver(store: Store, sessionId: string, cronId: string, text: string): Delivery;
  /** For a runtime that offers no hook: the daemon reads the session's record to see its turns end. */
  poll?(sessionId: string, cursor: string | null, sinceMs: number): Polled | null;
}

/** What a runtime's own record of a session shows since the last look. */
export interface Polled {
  /** The newest message seen; pass it back next time. */
  cursor: string | null;
  /** Turns that ended successfully since the cursor. A turn the user interrupted does not count. */
  turnEnds: number;
  compacted: boolean;
}

export interface Run {
  code: number;
  out: string;
  err: string;
}

export function run(cmd: string, args: string[], timeoutMs = 15_000): Run {
  try {
    const p = Bun.spawnSync([cmd, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    return { code: p.exitCode ?? 1, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
  } catch (e) {
    return { code: 127, out: "", err: e instanceof Error ? e.message : String(e) };
  }
}

export function have(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const LEASE_FRESH_MS = 10_000;

export function leaseLive(store: Store, addr: string, now = Date.now()): boolean {
  const l = store.lease(addr);
  return !!l && pidAlive(l.pid) && now - l.heartbeat <= LEASE_FRESH_MS;
}

// ---------------------------------------------------------------- who am I

const ENV: Record<Provider, string> = {
  claude: "CLAUDE_CODE_SESSION_ID",
  opencode: "OPENCODE_SESSION_ID",
  antigravity: "ANTIGRAVITY_CONVERSATION_ID",
  pi: "PI_SESSION_ID",
};

/** The address of the session this shell belongs to, from the runtime's own variable. */
export function whoami(env: Record<string, string | undefined> = process.env): string | null {
  const own = env.AGENT_JOB_SELF;
  if (own) return own;
  const nearest = nearestRuntimeAncestor();
  const found = PROVIDERS.filter((p) => env[ENV[p]]);
  if (found.length === 0) return null;
  // A runtime started from another runtime's shell inherits both variables; the nearest ancestor decides.
  const pick = found.length > 1 && nearest && found.includes(nearest) ? nearest : found[0]!;
  return address(pick, env[ENV[pick]]!);
}

const RUNTIME_PROCESS: Record<string, Provider> = { claude: "claude", opencode: "opencode", agy: "antigravity", pi: "pi" };

function nearestRuntimeAncestor(): Provider | null {
  let pid = process.ppid;
  for (let i = 0; i < 12 && pid > 1; i++) {
    const r = run("ps", ["-o", "ppid=,comm=", "-p", String(pid)], 3000);
    const m = /^\s*(\d+)\s+(.*)$/.exec(r.out);
    if (!m) return null;
    const hit = RUNTIME_PROCESS[path.basename(m[2]!.trim())];
    if (hit) return hit;
    pid = Number(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------- herdr

interface HerdrAgent {
  session: string;
  pane: string;
  agent: string;
  title: string;
  cwd: string;
}

function herdrAgents(kind: string): HerdrAgent[] {
  if (!have("herdr")) return [];
  const sessions = json(run("herdr", ["session", "list", "--json"]).out) as { sessions?: { name?: string; running?: boolean }[] } | null;
  const out: HerdrAgent[] = [];
  for (const s of sessions?.sessions ?? []) {
    if (!s.running || !s.name) continue;
    const got = json(run("herdr", ["--session", s.name, "agent", "list"]).out) as {
      result?: { agents?: Record<string, string>[] };
    } | null;
    for (const a of got?.result?.agents ?? []) {
      if (a.agent === kind) out.push({ session: s.name, pane: a.pane_id ?? "", agent: kind, title: (a.terminal_title ?? "").trim(), cwd: a.foreground_cwd || a.cwd || "" });
    }
  }
  return out;
}

function ancestors(pid: string): Set<string> {
  const seen = new Set<string>();
  let cur = pid;
  while (cur && cur !== "0" && cur !== "1" && !seen.has(cur)) {
    seen.add(cur);
    cur = run("ps", ["-o", "ppid=", "-p", cur], 3000).out.trim();
  }
  return seen;
}

function paste(session: string, pane: string, text: string): Delivery {
  const r = run("herdr", ["--session", session, "agent", "prompt", pane, text.replace(/\n+$/, "")]);
  return r.code === 0
    ? { ok: true, detail: `typed into herdr session ${session} pane ${pane}` }
    : { ok: false, detail: `herdr agent prompt failed: ${r.err || r.out}` };
}

// ---------------------------------------------------------------- claude

export const claude: Adapter = {
  provider: "claude",
  mode: "watch",
  liveness(store, id) {
    if (leaseLive(store, address("claude", id))) return { state: "live", detail: "its watch is running" };
    if (!have("claude")) return { state: "unknown", detail: "claude is not on PATH" };
    const r = run("claude", ["agents", "--json"]);
    const list = json(r.out);
    if (r.code !== 0 || !Array.isArray(list)) return { state: "unknown", detail: `claude agents failed: ${r.err || r.out}`.slice(0, 200) };
    return (list as { sessionId?: string }[]).some((s) => s.sessionId === id)
      ? { state: "live", detail: "listed by `claude agents`, without a watch" }
      : { state: "dead", detail: "no watch and not listed by `claude agents`" };
  },
  deliver: (store, id, rid, text) => enqueueForWatch(store, address("claude", id), rid, text),
};

function enqueueForWatch(store: Store, addr: string, rid: string, text: string): Delivery {
  const watching = leaseLive(store, addr);
  store.enqueue(addr, rid, text);
  return watching
    ? { ok: true, detail: "queued for the session's watch" }
    : { ok: true, detail: "queued; the session has no watch running, so it waits until one starts (dropped after 30 minutes)" };
}

// ---------------------------------------------------------------- pi

export const pi: Adapter = {
  provider: "pi",
  mode: "watch",
  liveness(store, id) {
    return leaseLive(store, address("pi", id))
      ? { state: "live", detail: "the pi extension's listener is running" }
      : { state: "dead", detail: "no pi extension listener (the session closed, or the extension is not installed)" };
  },
  deliver: (store, id, rid, text) => enqueueForWatch(store, address("pi", id), rid, text),
};

// ---------------------------------------------------------------- opencode

function opencodeSession(id: string): { title: string; directory: string } | null {
  const got = json(run("opencode", ["api", "get", `/api/session/${id}`]).out) as { data?: { title?: string; location?: { directory?: string } } } | null;
  return got?.data ? { title: got.data.title ?? "", directory: got.data.location?.directory ?? "" } : null;
}

/** A session is open when it runs a turn, a process was opened with its id, or a herdr pane shows it. */
export const opencode: Adapter = {
  provider: "opencode",
  mode: "push",
  liveness(_store, id) {
    if (!have("opencode")) return { state: "unknown", detail: "opencode is not on PATH" };
    const active = run("opencode", ["api", "get", "/api/session/active"]);
    if (active.code !== 0) return { state: "unknown", detail: `the OpenCode service did not answer: ${active.err || active.out}`.slice(0, 200) };
    const data = (json(active.out) as { data?: unknown } | null)?.data;
    const running = Array.isArray(data) ? data.some((x) => x === id || (x as { id?: string })?.id === id) : !!data && typeof data === "object" && id in data;
    if (running) return { state: "live", detail: "a turn is running" };
    const byArgs = run("ps", ["-ax", "-o", "args="]).out.split("\n").some((l) => {
      const w = l.trim().split(/\s+/);
      return path.basename(w[0] ?? "") === "opencode" && w.includes(id);
    });
    if (byArgs) return { state: "live", detail: "a TUI process was opened with its id" };
    const me = opencodeSession(id);
    if (!me) return { state: "dead", detail: "the session is not in the OpenCode service" };
    const all = (json(run("opencode", ["api", "get", "/api/session"]).out) as { data?: { title?: string; location?: { directory?: string } }[] } | null)?.data ?? [];
    if (me.title) {
      const same = all.filter((s) => s.title === me.title).length;
      if (same === 1 && herdrAgents("opencode").some((a) => a.title === `OC | ${me.title}`)) return { state: "live", detail: "its TUI is open in herdr" };
    } else if (me.directory) {
      // A session that has no title yet shows as "OpenCode": it is the only untitled one in its directory.
      const untitled = all.filter((s) => !s.title && s.location?.directory === me.directory).length;
      if (untitled === 1 && herdrAgents("opencode").some((a) => a.title === "OpenCode" && a.cwd === me.directory)) return { state: "live", detail: "its untitled TUI is open in herdr" };
    }
    return { state: "dead", detail: "no TUI shows the session" };
  },
  poll(id, cursor, sinceMs) {
    const r = run("opencode", ["api", "get", `/api/session/${id}/message?limit=30&order=desc`]);
    const list = (json(r.out) as { data?: { id: string; type: string; outcome?: string; time?: { created?: number } }[] } | null)?.data;
    if (r.code !== 0 || !Array.isArray(list)) return null;
    const fresh = list.filter((m) => (cursor ? m.id > cursor : (m.time?.created ?? 0) >= sinceMs));
    return {
      cursor: list.reduce<string | null>((top, m) => (top === null || m.id > top ? m.id : top), cursor),
      turnEnds: fresh.filter((m) => m.type === "idle" && m.outcome === "succeeded").length,
      compacted: fresh.some((m) => m.type === "compaction"),
    };
  },
  deliver(_store, id, _rid, text) {
    const body = JSON.stringify({ text, delivery: "steer", resume: true });
    const r = run("opencode", ["api", "post", `/api/session/${id}/prompt`, "--data", body]);
    return r.code === 0
      ? { ok: true, detail: "steered into the session" }
      : { ok: false, detail: `opencode api failed: ${r.err || r.out}`.slice(0, 300) };
  },
};

// ---------------------------------------------------------------- antigravity (agy)

function agyHome(): string {
  return process.env.AGY_HOME || path.join(os.homedir(), ".gemini", "antigravity-cli");
}

/** The pids that hold the session's presence lock, and the herdr pane of its TUI if it runs in herdr. */
function agyTui(id: string): { open: boolean; pane: { session: string; pane: string } | null } {
  const lock = path.join(agyHome(), "presence", `${id}.lock`);
  if (!fs.existsSync(lock) || !have("lsof")) return { open: false, pane: null };
  const pids = run("lsof", ["-t", lock]).out.split(/\s+/).filter(Boolean);
  const onTty = pids.filter((p) => {
    const tty = run("ps", ["-o", "tty=", "-p", p], 3000).out;
    return tty !== "" && !tty.includes("?");
  });
  if (onTty.length === 0) return { open: false, pane: null };
  const mine = new Set(onTty.flatMap((p) => [...ancestors(p)]));
  for (const a of herdrAgents("agy")) {
    const info = json(run("herdr", ["--session", a.session, "pane", "process-info", "--pane", a.pane]).out) as {
      result?: { process_info?: { shell_pid?: unknown; foreground_processes?: { pid?: unknown }[] } };
    } | null;
    const pi_ = info?.result?.process_info;
    const owned = [pi_?.shell_pid, ...(pi_?.foreground_processes ?? []).map((f) => f.pid)].map(String);
    if (owned.some((p) => mine.has(p))) return { open: true, pane: { session: a.session, pane: a.pane } };
  }
  return { open: true, pane: null };
}

export const antigravity: Adapter = {
  provider: "antigravity",
  mode: "push",
  liveness(_store, id) {
    if (!have("lsof")) return { state: "unknown", detail: "lsof is not on PATH" };
    const t = agyTui(id);
    if (!t.open) return { state: "dead", detail: "no agy TUI holds the session's presence lock" };
    return { state: "live", detail: t.pane ? `its TUI runs in herdr (${t.pane.session} ${t.pane.pane})` : "its TUI runs outside herdr" };
  },
  deliver(_store, id, _rid, text) {
    const t = agyTui(id);
    if (!t.pane) return { ok: false, detail: "the agy TUI is not in herdr, where text cannot be typed into it" };
    return paste(t.pane.session, t.pane.pane, text);
  },
};

export const ADAPTERS: Record<string, Adapter> = { claude, opencode, antigravity, pi };

export function adapterFor(provider: string): Adapter {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`unknown provider "${provider}"; use one of ${PROVIDERS.join(", ")}`);
  return a;
}
