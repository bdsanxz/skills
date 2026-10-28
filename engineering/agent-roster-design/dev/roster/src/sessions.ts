// Runtime sessions: the agent session id behind each member, stored in roster.json as
// `session: {runtime, id}`. peers send/open resolve members by herdr name and never read
// it, but rebuild and launch do: launch records the id of the session it started, and
// check/launch warn when the recorded session is not live.
//
// Liveness is what the runtime lists right now: an opencode session the service lists,
// a claude session `claude agents` lists, a muse session whose lease process still runs.
// agy conversations and pi session files persist after their sessions end, so an outside
// process cannot tell a live one: for those runtimes liveness is unknown (null) and no
// warning is printed.

import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, which } from "./core";

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
      default:
        return null;
    }
  } catch {
    return null;
  }
}
