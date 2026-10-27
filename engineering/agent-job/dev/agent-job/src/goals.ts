// Goals: an objective that follows a session. It is sent when the goal is created, again at every
// turn end until the agent marks the goal done or blocked, and again after the session's context
// is compacted. Each runtime reports those events its own way; this module decides what to say.

import { trace } from "./trace.ts";
import { address, type Goal, type Store } from "./store.ts";

/** `max_turns` 0 means no limit: the goal goes on until the agent marks it done or blocked. */
export const UNLIMITED_TURNS = 0;

export type GoalEvent = "turn-end" | "compacted" | "resumed";

/** The command line an agent runs to talk back to the goal, with this script's absolute path. */
export function selfCommand(): string {
  return `bun ${process.argv[1] ?? "agent-job.js"}`;
}

function closing(g: Goal): string {
  const cmd = selfCommand();
  return [
    `When the condition holds, run: ${cmd} goal done ${g.id} --note "<the evidence>"`,
    `If you cannot go on without the user, run: ${cmd} goal blocked ${g.id} --note "<what you need>"`,
  ].join("\n");
}

/** Shaped like Claude Code's own /goal: the condition, then what to do with it. */
export function startText(g: Goal): string {
  return `A goal is now active with condition: "${g.objective.trim()}". Briefly acknowledge the goal, then immediately start working toward it. Treat the condition itself as your directive and do not pause to ask the user what to do. Stopping is blocked until the condition holds.\n${closing(g)}`;
}

function progress(g: Goal): string {
  return g.max_turns === UNLIMITED_TURNS ? `${g.turns}` : `${g.turns} of ${g.max_turns}`;
}

/** What a runtime shows when the agent stops while the goal is open: "[condition]: why it goes on". */
export function continueText(g: Goal): string {
  return `[${g.objective.trim()}]: Condition not met yet; it has not been marked done (continuation ${progress(g)}). Keep working toward it and do not pause to ask the user what to do.\n${closing(g)}`;
}

export function compactedText(g: Goal): string {
  return `[${g.objective.trim()}]: Your context was compacted while this goal is open (continuation ${progress(g)}). Carry on from where you were; the condition is not met yet.\n${closing(g)}`;
}

/** The last message of a goal that ran out of continuations: it is sent once, then the session may stop. */
export function limitText(g: Goal): string {
  return `[${g.objective.trim()}]: This goal has stopped after ${g.max_turns} continuations without being marked done, and no more will be sent. Tell the user briefly where it stands and what is left.`;
}

/** What to inject for an event of the session `addr`, or null when nothing is owed. */
export function onGoalEvent(store: Store, addr: string, event: GoalEvent, now = Date.now(), opts: { afterCompaction?: boolean } = {}): string | null {
  const i = addr.indexOf(":");
  const g = store.activeGoal(addr.slice(0, i), addr.slice(i + 1));
  if (!g) {
    trace("goal", event, { addr, decision: "none", why: "no active goal" });
    return null;
  }
  if (event === "turn-end") {
    if (g.max_turns !== UNLIMITED_TURNS && g.turns >= g.max_turns) {
      store.updateGoal(g.id, { status: "ended", note: `stopped after ${g.max_turns} continuations without being marked done` }, now);
      trace("goal", event, { addr, goal: g.id, decision: "limit-text", why: "max-turns", turns: g.turns });
      return limitText(g);
    }
    const next = { ...g, turns: g.turns + 1 };
    store.updateGoal(g.id, { turns: next.turns }, now);
    const kind = opts.afterCompaction ? "compacted-text" : "continue-text";
    trace("goal", event, { addr, goal: g.id, decision: kind, turns: next.turns, of: g.max_turns });
    return opts.afterCompaction ? compactedText(next) : continueText(next);
  }
  trace("goal", event, { addr, goal: g.id, decision: "compacted-text", turns: g.turns, of: g.max_turns });
  return compactedText(g);
}

export function goalLine(g: Goal): string {
  return `${g.id}  ${g.status.padEnd(7)}  ${address(g.provider, g.session_id)}  ${g.turns}/${g.max_turns === UNLIMITED_TURNS ? "∞" : g.max_turns}  ${g.objective.trim().replace(/\s+/g, " ").slice(0, 70)}`;
}
