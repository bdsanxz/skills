// Schedules: 5-field cron (local time), one-shot "at", and fixed "every" intervals.

export type Kind = "cron" | "at" | "every";

export interface Schedule {
  kind: Kind;
  /** The cron expression, the ISO time of the one shot, or the interval in milliseconds. */
  expr: string;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

export interface CronExpr {
  sets: Set<number>[];
  domAny: boolean;
  dowAny: boolean;
}

function parseField(text: string, i: number): Set<number> {
  const { name, min, max } = FIELDS[i]!;
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad ${name} field "${text}" in the cron expression`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`step 0 in the ${name} field "${text}"`);
    let lo: number = min;
    let hi: number = max;
    if (m[1] !== "*") {
      const [a, b] = m[1]!.split("-");
      lo = Number(a);
      hi = b === undefined ? (m[2] === undefined ? lo : max) : Number(b);
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`${name} field "${text}" is outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`a cron expression has 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}: "${expr}"`);
  const sets = parts.map((p, i) => parseField(p, i));
  const dow = sets[4]!;
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return { sets, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

function dayMatches(c: CronExpr, d: Date): boolean {
  const dom = c.sets[2]!.has(d.getDate());
  const dow = c.sets[4]!.has(d.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dow;
  if (c.dowAny) return dom;
  return dom || dow; // both restricted: either matches, as in classic cron
}

/** The first minute strictly after `from` that matches, or null within five years. */
export function nextCron(expr: string, from: number): number | null {
  const c = parseCron(expr);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from + 5 * 366 * 86_400_000;
  while (d.getTime() <= limit) {
    if (!c.sets[3]!.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
    } else if (!dayMatches(c, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
    } else if (!c.sets[1]!.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
    } else if (!c.sets[0]!.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1);
    } else {
      return d.getTime();
    }
  }
  return null;
}

const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "90s", "5m", "2h", "1d", "1h30m" -> milliseconds. */
export function parseDuration(text: string): number {
  const t = text.trim().toLowerCase();
  if (!/^(\d+[smhd])+$/.test(t)) throw new Error(`bad duration "${text}"; use forms such as 90s, 5m, 2h, 1d or 1h30m`);
  let ms = 0;
  for (const m of t.matchAll(/(\d+)([smhd])/g)) ms += Number(m[1]) * UNIT[m[2]!]!;
  return ms;
}

/** "+10m", "in 10m", "2026-10-28T09:00" (local time unless it has a zone), or "09:00" (next occurrence). */
export function parseAt(text: string, now: number): number {
  const t = text.trim();
  const rel = /^(?:\+|in\s+)(.+)$/i.exec(t);
  if (rel) return now + parseDuration(rel[1]!);
  const clock = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (clock) {
    const d = new Date(now);
    d.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const ms = Date.parse(t.includes(" ") && !t.includes("T") ? t.replace(" ", "T") : t);
  if (Number.isNaN(ms)) throw new Error(`cannot read the time "${text}"; use +10m, 09:00 or 2026-10-28T09:00`);
  return ms;
}

export const MIN_EVERY_MS = 10_000;

/** The first run of a new schedule. */
export function firstRun(s: Schedule, now: number): number {
  if (s.kind === "at") return Number(s.expr);
  if (s.kind === "every") return now + Number(s.expr);
  const n = nextCron(s.expr, now);
  if (n === null) throw new Error(`the cron expression "${s.expr}" never matches`);
  return n;
}

/** The run after a run that was due at `due`; null when the schedule is finished. */
export function runAfter(s: Schedule, due: number, now: number): number | null {
  if (s.kind === "at") return null;
  if (s.kind === "every") {
    const step = Number(s.expr);
    return due + Math.max(1, Math.floor((now - due) / step) + 1) * step;
  }
  return nextCron(s.expr, Math.max(due, now - 1));
}

export function describe(s: Schedule): string {
  if (s.kind === "cron") return `cron ${s.expr}`;
  if (s.kind === "every") return `every ${Number(s.expr) / 1000}s`;
  return `once at ${new Date(Number(s.expr)).toISOString()}`;
}
