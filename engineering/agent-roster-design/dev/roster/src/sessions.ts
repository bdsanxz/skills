// Runtime sessions: the agent session id behind each member, stored in roster.json as
// `session: {runtime, id}`. peers send/open resolve members by herdr name and never read
// it, but rebuild and launch do: launch records the id of the session it started, and
// check/launch warn when the recorded session is not live.
//
// Liveness is what the runtime lists right now: an opencode session the service lists,
// a claude session `claude agents` lists, a muse session whose lease process still runs.
// agy conversations, pi session files and qoder session files persist after their
// sessions end, so an outside process cannot tell a live one: for those runtimes
// liveness is unknown (null) and no warning is printed.

import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, sleep, which } from "./core";

/** A recorded member session, as roster.json holds it. */
export interface MemberSession {
  runtime: string;
  id: string;
}

/** Whether a roster.json value is a member session shape: non-empty runtime and id strings. */
export function validSession(value: unknown): value is MemberSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const runtime = (value as Record<string, unknown>).runtime;
  const id = (value as Record<string, unknown>).id;
  return (
    typeof runtime === "string" &&
    runtime.trim() !== "" &&
    typeof id === "string" &&
    id.trim() !== ""
  );
}

function home(): string {
  return os.homedir();
}

function envNonempty(key: string): string | null {
  const v = process.env[key];
  return v !== undefined && v.trim() !== "" ? v : null;
}

function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Sessions the opencode service lists: its id and working directory each. */
function opencodeSessions(): { id: string; dir: string }[] {
  if (!which("opencode")) return [];
  const done = run(["opencode", "api", "get", "/api/session"], { timeoutMs: 60000 });
  if (done.code !== 0) return [];
  const v = parseJson(done.stdout);
  const items = Array.isArray(v) ? v : (v as { data?: unknown })?.data;
  if (!Array.isArray(items)) return [];
  const out: { id: string; dir: string }[] = [];
  for (const s of items) {
    if (typeof s !== "object" || s === null) continue;
    const id = (s as Record<string, unknown>).id;
    const rec = s as Record<string, unknown>;
    const loc = rec.location;
    const dir =
      (typeof loc === "object" && loc !== null
        ? (loc as Record<string, unknown>).directory
        : undefined) ??
      rec.directory ??
      rec.cwd;
    if (typeof id === "string" && id !== "" && typeof dir === "string" && dir !== "") {
      out.push({ id, dir });
    }
  }
  return out;
}

/** Sessions `claude agents` lists: its session id and working directory each. */
function claudeSessions(): { id: string; dir: string }[] {
  if (!which("claude")) return [];
  const done = run(["claude", "agents", "--json"], { timeoutMs: 60000 });
  if (done.code !== 0) return [];
  const v = parseJson(done.stdout);
  if (!Array.isArray(v)) return [];
  const out: { id: string; dir: string }[] = [];
  for (const s of v) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    const id = rec.sessionId ?? rec.id;
    const dir = rec.cwd ?? rec.directory;
    if (typeof id === "string" && id !== "" && typeof dir === "string" && dir !== "") {
      out.push({ id, dir });
    }
  }
  return out;
}

/** Where Antigravity keeps its data; AGY_HOME names another one. */
function agyHome(): string {
  return envNonempty("AGY_HOME") ?? path.join(home(), ".gemini", "antigravity-cli");
}

/** Antigravity conversations: their id and first workspace directory each. */
function agyConversations(): { id: string; dir: string }[] {
  const db = path.join(agyHome(), "conversation_summaries.db");
  if (!fs.existsSync(db)) return [];
  let conn: Database;
  try {
    conn = new Database(`file:${db}?mode=ro`, { readonly: true });
  } catch {
    return [];
  }
  try {
    const rows = conn
      .query("select conversation_id, workspace_uris from conversation_summaries")
      .all() as { conversation_id: string; workspace_uris: string }[];
    const out: { id: string; dir: string }[] = [];
    for (const r of rows) {
      let dirs: unknown = [];
      try {
        dirs = JSON.parse(r.workspace_uris || "[]");
      } catch {
        dirs = [];
      }
      const first =
        Array.isArray(dirs) && typeof dirs[0] === "string" && dirs[0].startsWith("file://")
          ? (dirs[0] as string).slice("file://".length)
          : "";
      if (r.conversation_id && first) out.push({ id: r.conversation_id, dir: first });
    }
    return out;
  } catch {
    return [];
  } finally {
    conn.close();
  }
}

/** Where pi saves its sessions. */
function piSessionsDir(): string {
  return (
    envNonempty("PI_CODING_AGENT_SESSION_DIR") ??
    (envNonempty("PI_CODING_AGENT_DIR")
      ? path.join(envNonempty("PI_CODING_AGENT_DIR")!, "sessions")
      : path.join(home(), ".pi", "agent", "sessions"))
  );
}

/** Saved pi sessions, oldest change first: their id, directory and change time each. */
function piSessions(): { id: string; dir: string; modified: number }[] {
  const root = piSessionsDir();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      let inner: fs.Dirent[] = [];
      try {
        inner = fs.readdirSync(p, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of inner) {
        if (!f.isDirectory() && f.name.endsWith(".jsonl")) files.push(path.join(p, f.name));
      }
    } else if (e.name.endsWith(".jsonl")) {
      files.push(p);
    }
  }
  const out: { id: string; dir: string; modified: number }[] = [];
  for (const file of files) {
    let head = "";
    try {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
    } catch {
      continue;
    }
    const v = parseJson(head) as { type?: unknown; id?: unknown; cwd?: unknown } | null;
    if (!v || v.type !== "session" || typeof v.id !== "string" || v.id === "") continue;
    let modified = 0;
    try {
      modified = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    out.push({ id: v.id, dir: typeof v.cwd === "string" ? v.cwd : "", modified });
  }
  out.sort((a, b) => a.modified - b.modified);
  return out;
}

/** Where Muse Code keeps its data. */
function museHome(): string {
  return path.join(envNonempty("XDG_DATA_HOME") ?? path.join(home(), ".local", "share"), "muse");
}

/** Muse Code sessions in its session index: their id and workspace directory each. */
function museSessions(): { id: string; dir: string }[] {
  const db = path.join(museHome(), "session-index.db");
  if (!fs.existsSync(db)) return [];
  let conn: Database;
  try {
    conn = new Database(`file:${db}?mode=ro`, { readonly: true });
  } catch {
    return [];
  }
  try {
    const rows = conn
      .query("select session_id, workspace_root from sessions")
      .all() as { session_id: string; workspace_root: string }[];
    return rows
      .filter((r) => r.session_id && r.workspace_root)
      .map((r) => ({ id: r.session_id, dir: r.workspace_root }));
  } catch {
    return [];
  } finally {
    conn.close();
  }
}

/** Whether the Muse Code session's lease process still runs. */
function museLive(id: string): boolean | null {
  const rec = path.join(museHome(), "runtime", "muse", "sessions", `${id}.json`);
  let hint = "";
  try {
    hint = (parseJson(fs.readFileSync(rec, "utf8")) as { endpoint_hint?: unknown })?.endpoint_hint as string;
  } catch {
    return null;
  }
  if (typeof hint !== "string" || hint === "") return null;
  let pid = 0;
  try {
    pid =
      (parseJson(fs.readFileSync(path.join(museHome(), "runtime", "muse", `${hint}.lease`), "utf8")) as { pid?: unknown })
        ?.pid as number;
  } catch {
    return null;
  }
  if (typeof pid !== "number" || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Where Qoder CLI keeps its data; QODER_CONFIG_DIR (its --config-dir) names another root. */
function qoderHome(): string {
  return envNonempty("QODER_CONFIG_DIR") ?? path.join(home(), ".qoder");
}

/** Qoder's directory for a project: the working directory with every
 * non-alphanumeric as a dash (qodercli 1.1.81; names past 200 characters are cut
 * there with a base-36 hash of the full path). */
function qoderProjectDir(cwd: string): string {
  const name = canonical(cwd).replace(/[^a-zA-Z0-9]/g, "-");
  if (name.length <= 200) return name;
  let hash = 5381;
  const full = canonical(cwd);
  for (let index = 0; index < full.length; index++) hash = (hash * 33) ^ full.charCodeAt(index);
  return `${name.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

/** Saved qoder sessions with both file times, oldest change first. Each session is
 * one <id>.jsonl file in the project's directory; the files outlive their runs. */
function qoderSessionFiles(cwd: string): { id: string; modified: number; born: number }[] {
  const root = path.join(qoderHome(), "projects", qoderProjectDir(cwd));
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { id: string; modified: number; born: number }[] = [];
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith(".jsonl")) continue;
    let modified = 0;
    let born = 0;
    try {
      const st = fs.statSync(path.join(root, e.name));
      modified = st.mtimeMs;
      born = st.birthtimeMs;
    } catch {
      continue;
    }
    out.push({ id: e.name.slice(0, -".jsonl".length), modified, born });
  }
  out.sort((a, b) => a.modified - b.modified);
  return out;
}

/** Saved qoder sessions, oldest change first: their id each. Each session is one
 * <id>.jsonl file in the project's directory; the files outlive their runs. */
function qoderSessions(cwd: string): { id: string; modified: number }[] {
  return qoderSessionFiles(cwd).map(({ id, modified }) => ({ id, modified }));
}

function parseWaitEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** How long launch waits for a new qoder session file after the first prompt,
 * and how often it looks. Both are injectable for tests through the environment;
 * a zero timeout means a single lookup with no sleep. */
export function qoderWaitConfig(): { timeoutMs: number; intervalMs: number } {
  return {
    timeoutMs: parseWaitEnv(process.env.ROSTER_QODER_WAIT_MS, 30000),
    intervalMs: parseWaitEnv(process.env.ROSTER_QODER_INTERVAL_MS, 1000),
  };
}

/** The newest qoder session id whose file is at or after `sinceMs` (mtime or
 * birthtime), or null. A file older than the launch start belongs to an earlier
 * run and must not count as the new member's session. */
export function findQoderSessionSince(cwd: string, sinceMs: number): string | null {
  const mine = qoderSessionFiles(cwd).filter((s) => s.modified >= sinceMs || s.born >= sinceMs);
  return mine.length ? mine[mine.length - 1]!.id : null;
}

/** Poll for the qoder session file newer than `sinceMs` until it appears or the
 * timeout passes. The file only appears after the member processes its first
 * prompt, so the lookup runs after that prompt was delivered. Returns the newest
 * matching id, or null when none appears in time. */
export function waitForQoderSession(
  cwd: string,
  sinceMs: number,
  opts?: { timeoutMs?: number; intervalMs?: number },
): string | null {
  const cfg = qoderWaitConfig();
  const timeoutMs = opts?.timeoutMs ?? cfg.timeoutMs;
  const intervalMs = opts?.intervalMs ?? cfg.intervalMs;
  const start = Date.now();
  for (;;) {
    const found = findQoderSessionSince(cwd, sinceMs);
    if (found) return found;
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) return null;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) return null;
    if (intervalMs > 0) sleep(Math.min(intervalMs, remaining));
  }
}

/** The id of the runtime's newest session working in `cwd`, or null when none is known. */
export function findSession(runtime: string, cwd: string): string | null {
  try {
    const want = canonical(cwd);
    const match = (dir: string): boolean => dir !== "" && canonical(dir) === want;
    switch (runtime) {
      case "opencode": {
        let found: string | null = null;
        for (const s of opencodeSessions()) if (match(s.dir)) found = s.id;
        return found;
      }
      case "claude": {
        let found: string | null = null;
        for (const s of claudeSessions()) if (match(s.dir)) found = s.id;
        return found;
      }
      case "antigravity":
      case "agy": {
        let found: string | null = null;
        for (const s of agyConversations()) if (match(s.dir)) found = s.id;
        return found;
      }
      case "pi": {
        const mine = piSessions().filter((s) => match(s.dir));
        return mine.length ? mine[mine.length - 1]!.id : null;
      }
      case "muse": {
        let found: string | null = null;
        for (const s of museSessions()) if (match(s.dir)) found = s.id;
        return found;
      }
      case "qoder": {
        const mine = qoderSessions(cwd);
        return mine.length ? mine[mine.length - 1]!.id : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Whether the runtime lists the session id now: true, false, or null when it cannot be told
 * (an unavailable CLI or database, or a runtime whose saved sessions outlive their runs). */
export function sessionLive(runtime: string, id: string): boolean | null {
  try {
    switch (runtime) {
      case "opencode":
        if (!which("opencode")) return null;
        return opencodeSessions().some((s) => s.id === id);
      case "claude":
        if (!which("claude")) return null;
        return claudeSessions().some((s) => s.id === id);
      case "antigravity":
      case "agy":
        return null;
      case "pi":
        return null;
      case "muse": {
        if (!museSessions().some((s) => s.id === id)) {
          return fs.existsSync(path.join(museHome(), "session-index.db")) ? false : null;
        }
        return museLive(id);
      }
      case "qoder":
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
