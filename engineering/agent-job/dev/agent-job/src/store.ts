// The cron database: crons, the leases of watching sessions, the outbox of lines waiting
// for a watching session, and a short event log. One SQLite file per machine.

import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Kind } from "./schedule.ts";

export type Status = "active" | "paused" | "done" | "ended";

export interface Cron {
  id: string;
  name: string;
  provider: string;
  session_id: string;
  cwd: string;
  prompt: string;
  kind: Kind;
  expr: string;
  status: Status;
  created_at: number;
  next_run: number | null;
  last_run: number | null;
  last_result: string;
  runs: number;
  max_runs: number | null;
  expires_at: number | null;
  end_reason: string;
}

export type GoalStatus = "active" | "paused" | "done" | "blocked" | "ended";

export interface Goal {
  id: string;
  provider: string;
  session_id: string;
  cwd: string;
  objective: string;
  status: GoalStatus;
  /** Continuations sent so far, one per turn end. */
  turns: number;
  max_turns: number;
  /** Compactions of the session already acted on; -1 until a runtime that counts them has looked. */
  compactions: number;
  created_at: number;
  updated_at: number;
  note: string;
}

export interface Lease {
  address: string;
  pid: number;
  token: string;
  started_at: number;
  heartbeat: number;
}

export interface OutboxRow {
  id: number;
  address: string;
  cron_id: string;
  text: string;
  created_at: number;
}

export interface EventRow {
  id: number;
  ts: number;
  cron_id: string;
  kind: string;
  detail: string;
}

export function homeDir(): string {
  return process.env.AGENT_JOB_HOME || path.join(os.homedir(), ".local", "share", "agent-job");
}

/** The one database file of a data directory: crons, goals, leases and the outbox. */
export function dbFile(dir = homeDir()): string {
  return path.join(dir, "agent-job.db");
}

export function address(provider: string, id: string): string {
  return `${provider}:${id}`;
}

export function splitAddress(a: string): { provider: string; id: string } {
  const i = a.indexOf(":");
  if (i < 1 || i === a.length - 1) throw new Error(`"${a}" is not a session address; expected <provider>:<session id>, such as claude:3f2a...`);
  return { provider: a.slice(0, i), id: a.slice(i + 1) };
}

export class Store {
  readonly db: Database;
  readonly dir: string;

  constructor(dir = homeDir()) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbFile(dir), { strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crons (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, session_id TEXT NOT NULL,
        cwd TEXT NOT NULL, prompt TEXT NOT NULL, kind TEXT NOT NULL, expr TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, next_run INTEGER, last_run INTEGER,
        last_result TEXT NOT NULL DEFAULT '', runs INTEGER NOT NULL DEFAULT 0, max_runs INTEGER,
        expires_at INTEGER, end_reason TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL,
        objective TEXT NOT NULL, status TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0,
        max_turns INTEGER NOT NULL, compactions INTEGER NOT NULL DEFAULT -1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS leases (
        address TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL,
        started_at INTEGER NOT NULL, heartbeat INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, cron_id TEXT NOT NULL,
        text TEXT NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, cron_id TEXT NOT NULL,
        kind TEXT NOT NULL, detail TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  newId(): string {
    for (;;) {
      const id = "r" + Math.random().toString(16).slice(2, 8);
      if (!this.get(id)) return id;
    }
  }

  insert(r: Cron): void {
    this.db
      .query(
        `INSERT INTO crons (id,name,provider,session_id,cwd,prompt,kind,expr,status,created_at,next_run,last_run,last_result,runs,max_runs,expires_at,end_reason)
         VALUES ($id,$name,$provider,$session_id,$cwd,$prompt,$kind,$expr,$status,$created_at,$next_run,$last_run,$last_result,$runs,$max_runs,$expires_at,$end_reason)`,
      )
      .run(r as unknown as Record<string, string | number | null>);
  }

  get(id: string): Cron | null {
    return (this.db.query("SELECT * FROM crons WHERE id = ?").get(id) as Cron | null) ?? null;
  }

  list(filter: { all?: boolean; address?: string } = {}): Cron[] {
    const rows = this.db.query("SELECT * FROM crons ORDER BY created_at, id").all() as Cron[];
    return rows.filter((r) => {
      if (filter.address && address(r.provider, r.session_id) !== filter.address) return false;
      return filter.all || r.status === "active" || r.status === "paused";
    });
  }

  update(id: string, fields: Partial<Cron>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const set = keys.map((k) => `${k} = $${k}`).join(", ");
    const params: Record<string, string | number | null> = { id };
    for (const k of keys) params[k] = (fields as Record<string, string | number | null>)[k] ?? null;
    this.db.query(`UPDATE crons SET ${set} WHERE id = $id`).run(params);
  }

  delete(id: string): boolean {
    const r = this.db.query("DELETE FROM crons WHERE id = ?").run(id);
    this.db.query("DELETE FROM outbox WHERE cron_id = ? AND delivered_at IS NULL").run(id);
    return r.changes > 0;
  }

  due(now: number): Cron[] {
    return this.db
      .query("SELECT * FROM crons WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run")
      .all(now) as Cron[];
  }

  active(): Cron[] {
    return this.db.query("SELECT * FROM crons WHERE status = 'active'").all() as Cron[];
  }

  event(cron_id: string, kind: string, detail: string, ts = Date.now()): void {
    this.db.query("INSERT INTO events (ts,cron_id,kind,detail) VALUES (?,?,?,?)").run(ts, cron_id, kind, detail);
    this.db.query("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - 2000").run();
  }

  events(cron_id?: string, limit = 20): EventRow[] {
    const rows = cron_id
      ? this.db.query("SELECT * FROM events WHERE cron_id = ? ORDER BY id DESC LIMIT ?").all(cron_id, limit)
      : this.db.query("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit);
    return (rows as EventRow[]).reverse();
  }

  // Goals: at most one active goal per session.

  newGoalId(): string {
    for (;;) {
      const id = "g" + Math.random().toString(16).slice(2, 8);
      if (!this.goal(id)) return id;
    }
  }

  insertGoal(g: Goal): void {
    this.db
      .query(
        `INSERT INTO goals (id,provider,session_id,cwd,objective,status,turns,max_turns,compactions,created_at,updated_at,note)
         VALUES ($id,$provider,$session_id,$cwd,$objective,$status,$turns,$max_turns,$compactions,$created_at,$updated_at,$note)`,
      )
      .run(g as unknown as Record<string, string | number | null>);
  }

  goal(id: string): Goal | null {
    return (this.db.query("SELECT * FROM goals WHERE id = ?").get(id) as Goal | null) ?? null;
  }

  goals(filter: { all?: boolean; address?: string } = {}): Goal[] {
    const rows = this.db.query("SELECT * FROM goals ORDER BY created_at, id").all() as Goal[];
    return rows.filter((g) => {
      if (filter.address && address(g.provider, g.session_id) !== filter.address) return false;
      return filter.all || g.status === "active" || g.status === "paused";
    });
  }

  /** The goal that governs a session: its active one, if any. */
  activeGoal(provider: string, sessionId: string): Goal | null {
    return (
      (this.db.query("SELECT * FROM goals WHERE provider = ? AND session_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(provider, sessionId) as Goal | null) ??
      null
    );
  }

  updateGoal(id: string, fields: Partial<Goal>, now = Date.now()): void {
    const all = { ...fields, updated_at: now } as Record<string, string | number | null>;
    const set = Object.keys(all).map((k) => `${k} = $${k}`).join(", ");
    this.db.query(`UPDATE goals SET ${set} WHERE id = $id`).run({ ...all, id });
  }

  deleteGoal(id: string): boolean {
    return this.db.query("DELETE FROM goals WHERE id = ?").run(id).changes > 0;
  }

  // Leases: a watching session holds one while its watch process runs.

  lease(address_: string): Lease | null {
    return (this.db.query("SELECT * FROM leases WHERE address = ?").get(address_) as Lease | null) ?? null;
  }

  takeLease(address_: string, pid: number, token: string, now = Date.now()): void {
    this.db
      .query("INSERT OR REPLACE INTO leases (address,pid,token,started_at,heartbeat) VALUES (?,?,?,?,?)")
      .run(address_, pid, token, now, now);
  }

  beat(address_: string, token: string, now = Date.now()): boolean {
    return this.db.query("UPDATE leases SET heartbeat = ? WHERE address = ? AND token = ?").run(now, address_, token).changes > 0;
  }

  dropLease(address_: string, token: string): void {
    this.db.query("DELETE FROM leases WHERE address = ? AND token = ?").run(address_, token);
  }

  // Outbox: lines for a session that receives them through its watch.

  enqueue(address_: string, cron_id: string, text: string, now = Date.now()): void {
    this.db.query("INSERT INTO outbox (address,cron_id,text,created_at) VALUES (?,?,?,?)").run(address_, cron_id, text, now);
  }

  pending(address_: string): OutboxRow[] {
    return this.db
      .query("SELECT id,address,cron_id,text,created_at FROM outbox WHERE address = ? AND delivered_at IS NULL ORDER BY id")
      .all(address_) as OutboxRow[];
  }

  markDelivered(id: number, now = Date.now()): void {
    this.db.query("UPDATE outbox SET delivered_at = ? WHERE id = ?").run(now, id);
  }

  /** Lines nobody collected in time are dropped; returns the rows dropped. */
  expireOutbox(olderThan: number): OutboxRow[] {
    const rows = this.db
      .query("SELECT id,address,cron_id,text,created_at FROM outbox WHERE delivered_at IS NULL AND created_at < ?")
      .all(olderThan) as OutboxRow[];
    for (const r of rows) this.db.query("DELETE FROM outbox WHERE id = ?").run(r.id);
    this.db.query("DELETE FROM outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?").run(Date.now() - 86_400_000);
    return rows;
  }
}
