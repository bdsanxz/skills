import type { Task } from "./parse";

export type Status = "done" | "in-progress" | "ready" | "blocked";

export interface Tracker {
  started: string[];
  done: string[];
}

export function topoOrder(tasks: Task[]): { order: string[]; cycle: string[] | null } {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id, 0);
    out.set(t.id, []);
  }
  for (const t of tasks)
    for (const b of t.blockers)
      if (ids.has(b)) {
        indeg.set(t.id, indeg.get(t.id)! + 1);
        out.get(b)!.push(t.id);
      }
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of out.get(id)!) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) {
        queue.push(n);
        queue.sort();
      }
    }
  }
  if (order.length === tasks.length) return { order, cycle: null };
  return { order, cycle: findCycle(tasks) };
}

function findCycle(tasks: Task[]): string[] {
  const by = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, number>();
  const stack: string[] = [];
  let found: string[] = [];
  const visit = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const b of by.get(id)?.blockers ?? []) {
      if (!by.has(b)) continue;
      if (state.get(b) === 1) {
        found = [...stack.slice(stack.indexOf(b)), b];
        return true;
      }
      if (!state.get(b) && visit(b)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };
  for (const t of tasks) if (!state.get(t.id) && visit(t.id)) break;
  return found;
}

export function statusOf(task: Task, all: Map<string, Task>, tracker: Tracker): Status {
  const done = (id: string) => tracker.done.includes(id);
  if (done(task.id)) return "done";
  const open = task.blockers.filter((b) => all.has(b) && !done(b));
  if (open.length) return "blocked";
  if (tracker.started.includes(task.id)) return "in-progress";
  return "ready";
}

/** Longest chain of not-yet-done tasks, by number of tasks, ending anywhere. */
export function criticalPath(tasks: Task[], tracker: Tracker): string[] {
  const { order, cycle } = topoOrder(tasks);
  if (cycle) return [];
  const by = new Map(tasks.map((t) => [t.id, t]));
  const best = new Map<string, string[]>();
  for (const id of order) {
    if (tracker.done.includes(id)) continue;
    let longest: string[] = [];
    for (const b of by.get(id)!.blockers) {
      const p = best.get(b);
      if (p && p.length > longest.length) longest = p;
    }
    best.set(id, [...longest, id]);
  }
  let top: string[] = [];
  for (const p of best.values()) if (p.length > top.length) top = p;
  return top;
}

export function mermaid(tasks: Task[], tracker: Tracker): string {
  const all = new Map(tasks.map((t) => [t.id, t]));
  const lines = ["flowchart TD"];
  for (const t of tasks) {
    const st = statusOf(t, all, tracker);
    const label = `${t.id}: ${t.title.replace(/"/g, "'")}`;
    lines.push(`  ${t.id}["${label}"]:::${st.replace("-", "")}`);
  }
  for (const t of tasks) for (const b of t.blockers) if (all.has(b)) lines.push(`  ${b} --> ${t.id}`);
  lines.push("  classDef done fill:#d1fae5,stroke:#059669");
  lines.push("  classDef inprogress fill:#fef3c7,stroke:#d97706");
  lines.push("  classDef ready fill:#dbeafe,stroke:#2563eb");
  lines.push("  classDef blocked fill:#f3f4f6,stroke:#6b7280");
  return lines.join("\n");
}
