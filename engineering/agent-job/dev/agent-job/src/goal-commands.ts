import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bool, parseArgs, str, UsageError, unknownFlags } from "./args.ts";
import { ensureDaemon } from "./daemon.ts";
import { UNLIMITED_TURNS, goalLine, onGoalEvent, selfCommand, startText } from "./goals.ts";
import { adapterFor, leaseLive, run, whoami } from "./providers.ts";
import { trace } from "./trace.ts";
import { address, dbFile, splitAddress, Store, type Goal } from "./store.ts";

export const GOAL_HELP: Record<string, string> = {
  "": `agent-job goal: an objective that follows a session.

Usage: agent-job goal <command> [options]

Commands:
  create   Set a goal for a session; it is sent at once, at every turn end, and after compaction
  list     List goals
  show     Show one goal
  done     Mark a goal achieved (the agent runs this, with the evidence)
  blocked  Mark a goal stuck on the user (the agent runs this, with what it needs)
  pause    Stop sending a goal until it is resumed
  resume   Resume a paused goal
  delete   Delete a goal
  setup    Print, or check, the configuration that makes a runtime report its events
  event    Print what a runtime must inject for an event (used by the runtime's hook)
  hook     Entry point of a runtime's own hook (reads the runtime's JSON on stdin)

A goal ends when the agent marks it done or blocked, after --max-turns continuations, or when its session closes.
Run \`agent-job goal <command> --help\` first.`,
  create: `Usage: agent-job goal create (--prompt <objective> | <objective on stdin>) [--session <addr>] [--max-turns <n>] [--force]
Sets the goal of a session (default: this one); a session has at most one active goal. --max-turns <n> caps the continuations; without it the goal has no limit.
Writes the objective so that it stands alone and says how to tell it is achieved. Prints a SETUP line when the session's runtime is not yet configured to report its events.`,
  list: `Usage: agent-job goal list [--all] [--session <addr>] [--json]`,
  show: `Usage: agent-job goal show <id> [--json]`,
  done: `Usage: agent-job goal done <id> [--note <evidence>]   The goal is achieved; nothing more is sent.`,
  blocked: `Usage: agent-job goal blocked <id> [--note <what you need>]   The goal needs the user; nothing more is sent.`,
  pause: `Usage: agent-job goal pause <id>`,
  resume: `Usage: agent-job goal resume <id>   Resumes a paused goal.`,
  delete: `Usage: agent-job goal delete <id>...`,
  setup: `Usage: agent-job goal setup <provider> [--check]
Prints what the runtime needs so that it reports turn ends and compaction to \`agent-job\`. --check says whether it is in place.
Providers: claude, opencode, antigravity, pi.`,
  event: `Usage: agent-job goal event <turn-end|compacted|resumed> [--session <addr>]
Prints the text a runtime must inject for the event, or nothing when the session has no active goal.`,
  hook: `Usage: agent-job goal hook <provider> [event]   Reads the runtime's hook JSON on stdin; prints the runtime's reply. Never fails.`,
};

function needGoal(g: Goal | null, id: string): Goal {
  if (!g) throw new Error(`no goal ${id}; \`agent-job goal list --all\` shows them`);
  return g;
}

// ---------------------------------------------------------------- setup per runtime

const SETUP: Record<string, { text: (cmd: string) => string; check: () => string | null }> = {};

/** Where project-level hooks are looked for: the working directory, or the target session's when it is known. */
let projectDir = process.cwd();

function claudeSettingsFiles(): string[] {
  const cwd = projectDir;
  return [
    path.join(os.homedir(), ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.local.json"),
  ];
}

SETUP.claude = {
  text: (cmd) =>
    JSON.stringify(
      {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: `${cmd} goal hook claude` }] }],
          SessionStart: [{ matcher: "compact|resume", hooks: [{ type: "command", command: `${cmd} goal hook claude` }] }],
        },
      },
      null,
      2,
    ),
  check() {
    for (const f of claudeSettingsFiles()) {
      try {
        const t = fs.readFileSync(f, "utf8");
        if (t.includes("goal hook claude")) return f;
      } catch {}
    }
    return null;
  },
};

function agySettingsFiles(): string[] {
  return [path.join(os.homedir(), ".gemini", "config", "hooks.json"), path.join(projectDir, ".agents", "hooks.json")];
}

SETUP.antigravity = {
  text: (cmd) =>
    JSON.stringify(
      {
        "agent-job-goal": {
          PreInvocation: [{ type: "command", command: `${cmd} goal hook antigravity PreInvocation` }],
          Stop: [{ type: "command", command: `${cmd} goal hook antigravity Stop` }],
        },
      },
      null,
      2,
    ),
  check() {
    for (const f of agySettingsFiles()) {
      try {
        if (fs.readFileSync(f, "utf8").includes("goal hook antigravity")) return f;
      } catch {}
    }
    return null;
  },
};

const PI_EXTENSION = path.join(os.homedir(), ".pi", "agent", "extensions", "agent-job.ts");

SETUP.pi = {
  text: (cmd) =>
    `pi reports its events to agent-job through the agent-job extension, which also delivers crons. Ask the user to run:\n  mkdir -p ~/.pi/agent/extensions && ${cmd} pi-extension > ~/.pi/agent/extensions/agent-job.ts\nand then /reload in the pi session. Run it again after the skill moves.`,
  check() {
    try {
      return fs.readFileSync(PI_EXTENSION, "utf8").includes("goal") ? PI_EXTENSION : null;
    } catch {
      return null;
    }
  },
};

export function setupHint(provider: string): string | null {
  const s = SETUP[provider];
  if (!s || s.check()) return null;
  return `SETUP: ${provider} does not report its events to agent-job yet. Run \`agent-job goal setup ${provider}\` and ask the user to apply it; until then the goal is sent only when it is created.`;
}

// ---------------------------------------------------------------- hooks

/** Claude Code's hook JSON in, Claude Code's reply out. Any problem means "no opinion". */
function claudeHook(input: string): string {
  const payload = JSON.parse(input) as { hook_event_name?: string; session_id?: string; source?: string };
  if (!payload.session_id) return "";
  if (!fs.existsSync(dbFile())) return "";
  const store = new Store();
  const addr = address("claude", payload.session_id);
  const raw = payload as { stop_hook_active?: boolean };
  trace("claude-hook", payload.hook_event_name ?? "?", { addr, startSource: payload.source, stop_hook_active: raw.stop_hook_active });
  if (payload.hook_event_name === "Stop") {
    const text = onGoalEvent(store, addr, "turn-end");
    if (!text) return "";
    // With a channel (or a watch) the continuation arrives as an ordinary turn, as a cron does. Blocking the
    // stop shows as a hook error and repeats the text with the hook's command, so it is the fallback.
    const goal = store.goals().find((g) => g.provider === "claude" && g.session_id === payload.session_id && g.status === "active");
    if (goal && leaseLive(store, addr)) {
      store.enqueue(addr, goal.id, text);
      trace("claude-hook", "continuation", { addr, goal: goal.id, via: "channel" });
      return "";
    }
    trace("claude-hook", "continuation", { addr, via: "block" });
    return JSON.stringify({ decision: "block", reason: text });
  }
  if (payload.hook_event_name === "SessionStart" && (payload.source === "compact" || payload.source === "resume")) {
    const text = onGoalEvent(store, addr, payload.source === "compact" ? "compacted" : "resumed");
    if (!text) return "";
    // Context added here is seen only at the next turn, and an idle session has none: with a channel (or a
    // watch) the restated goal arrives as a turn, so the agent carries on at once.
    const goal = store.goals().find((g) => g.provider === "claude" && g.session_id === payload.session_id && g.status === "active");
    if (goal && leaseLive(store, addr)) {
      store.enqueue(addr, goal.id, text);
      trace("claude-hook", "restated", { addr, goal: goal.id, after: payload.source, via: "channel" });
      return "";
    }
    trace("claude-hook", "restated", { addr, after: payload.source, via: "context" });
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } });
  }
  return "";
}

/** Compactions of an agy conversation: each one leaves a CHECKPOINT step in its transcript. */
export function agyCompactions(transcriptPath: string): number {
  try {
    return fs.readFileSync(transcriptPath, "utf8").split("\n").filter((l) => l.includes('"type":"CHECKPOINT"')).length;
  } catch {
    return 0;
  }
}

/** agy's hook JSON in (the event name is the hook's argument), agy's reply out. */
function antigravityHook(input: string, event: string | undefined): string {
  const payload = JSON.parse(input) as { conversationId?: string; transcriptPath?: string; terminationReason?: string };
  if (!payload.conversationId || !fs.existsSync(dbFile())) return "";
  const store = new Store();
  const goal = store.activeGoal("antigravity", payload.conversationId);
  trace("agy-hook", event ?? "?", { addr: address("antigravity", payload.conversationId), terminationReason: payload.terminationReason, goal: goal?.id ?? null, keys: Object.keys(payload), checkpoints: payload.transcriptPath ? agyCompactions(payload.transcriptPath) : null });
  if (!goal) return "";
  if (event === "Stop") {
    // /compact ends with a Stop of its own (TERMINAL_CUSTOM_HOOK) and leaves a CHECKPOINT step in the transcript:
    // a rise in their number means a compaction just finished, and the goal is restated at once.
    const count = payload.transcriptPath ? agyCompactions(payload.transcriptPath) : null;
    const compacted = count !== null && (goal.compactions >= 0 ? count > goal.compactions : payload.terminationReason === "TERMINAL_CUSTOM_HOOK" && count > 0);
    if (count !== null && count !== goal.compactions) store.updateGoal(goal.id, { compactions: count });
    if (compacted) {
      const addr = address("antigravity", payload.conversationId);
      // A turn that ended normally around the compaction still counts as a continuation.
      const text = payload.terminationReason === "NO_TOOL_CALL" ? onGoalEvent(store, addr, "turn-end", Date.now(), { afterCompaction: true }) : onGoalEvent(store, addr, "compacted");
      trace("agy-hook", "restated", { goal: goal.id, checkpoints: count, via: "Stop" });
      return text ? JSON.stringify({ decision: "continue", reason: text }) : "";
    }
    // Only a normal end of turn goes on; a cancel by the user, an error or a limit is respected.
    if (payload.terminationReason !== "NO_TOOL_CALL") {
      trace("goal", "turn-end", { addr: address("antigravity", payload.conversationId), goal: goal.id, decision: "none", why: `terminationReason ${payload.terminationReason}` });
      return "";
    }
    const text = onGoalEvent(store, address("antigravity", payload.conversationId), "turn-end");
    return text ? JSON.stringify({ decision: "continue", reason: text }) : "";
  }
  if (event === "PreInvocation" && payload.transcriptPath) {
    const count = agyCompactions(payload.transcriptPath);
    trace("agy-hook", "checkpoints", { goal: goal.id, count, seen: goal.compactions });
    if (goal.compactions < 0) store.updateGoal(goal.id, { compactions: count });
    else if (count > goal.compactions) {
      store.updateGoal(goal.id, { compactions: count });
      const text = onGoalEvent(store, address("antigravity", payload.conversationId), "compacted");
      return text ? JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] }) : "";
    }
  }
  return "";
}

const HOOKS: Record<string, (input: string, event?: string) => string> = { claude: claudeHook, antigravity: antigravityHook };

// ---------------------------------------------------------------- commands

export async function goalDispatch(sub: string | undefined, argv: string[]): Promise<number> {
  if (!sub) {
    console.log(GOAL_HELP[""]);
    return 2;
  }
  const p = parseArgs(argv, ["all", "json", "force", "check"]);
  if (p.flags.has("help")) {
    console.log(GOAL_HELP[sub] ?? GOAL_HELP[""]);
    return 0;
  }
  const out = (s: string) => console.log(s);

  switch (sub) {
    case "create": {
      unknownFlags(p, ["prompt", "session", "max-turns", "force"]);
      const objective = (str(p, "prompt") ?? (process.stdin.isTTY ? "" : (await Bun.stdin.text()))).trim();
      if (!objective) throw new UsageError("give the objective with --prompt or on stdin");
      const me = whoami();
      const addr = str(p, "session") ?? me;
      if (!addr) throw new Error("cannot tell which session this is; pass --session <provider>:<id>");
      const { provider, id: sessionId } = splitAddress(addr);
      const adapter = adapterFor(provider);
      const store = new Store();
      const existing = store.activeGoal(provider, sessionId);
      if (existing) throw new Error(`${addr} already has the active goal ${existing.id}; finish it (goal done|blocked) or delete it first`);
      const live = adapter.liveness(store, sessionId);
      if (live.state === "dead" && !bool(p, "force")) throw new Error(`${addr} does not look open (${live.detail}). Use --force to create the goal anyway`);
      const rawTurns = str(p, "max-turns");
      const maxTurns = rawTurns === undefined ? UNLIMITED_TURNS : Number(rawTurns);
      if (rawTurns !== undefined && !(Number.isInteger(maxTurns) && maxTurns >= 1)) throw new UsageError("--max-turns must be a whole number, 1 or more");
      const now = Date.now();
      const g: Goal = { id: store.newGoalId(), provider, session_id: sessionId, cwd: process.cwd(), objective, status: "active", turns: 0, max_turns: maxTurns, compactions: -1, created_at: now, updated_at: now, note: "" };
      store.insertGoal(g);
      if (addr === me) {
        out(`GOAL ${g.id} set for this session. Work toward it now; it is sent again at every turn end until you run \`${selfCommand()} goal done ${g.id}\` or \`... goal blocked ${g.id}\`.`);
      } else {
        const d = live.state === "live" ? adapter.deliver(store, sessionId, g.id, startText(g)) : { ok: false, detail: `session state is ${live.state}: ${live.detail}` };
        out(`GOAL ${g.id} set for ${addr}; start ${d.ok ? "sent: " + d.detail : "not sent: " + d.detail}`);
      }
      if (adapter.poll) {
        const d = ensureDaemon(store);
        out(`DAEMON: ${d.started ? "started" : "running"} (pid ${d.pid}); ${provider} has no hook, so the daemon watches the session for turn ends`);
      }
      if (provider === "claude") {
        try {
          const list = JSON.parse(run("claude", ["agents", "--json"]).out) as { sessionId?: string; cwd?: string }[];
          projectDir = list.find((x) => x.sessionId === sessionId)?.cwd ?? projectDir;
        } catch {}
      }
      const hint = setupHint(provider);
      if (hint) out(hint);
      return 0;
    }

    case "list": {
      unknownFlags(p, ["all", "session", "json"]);
      const rows = new Store().goals({ all: bool(p, "all"), address: str(p, "session") });
      if (bool(p, "json")) out(JSON.stringify(rows, null, 2));
      else if (rows.length === 0) out("No goals.");
      else for (const g of rows) out(goalLine(g));
      return 0;
    }

    case "show": {
      unknownFlags(p, ["json"]);
      const id = p.positionals[0];
      if (!id) throw new UsageError("show needs a goal id");
      const g = needGoal(new Store().goal(id), id);
      if (bool(p, "json")) out(JSON.stringify(g, null, 2));
      else {
        out(goalLine(g));
        out(`objective: ${g.objective}`);
        if (g.note) out(`note: ${g.note}`);
      }
      return 0;
    }

    case "done":
    case "blocked":
    case "pause":
    case "resume": {
      unknownFlags(p, ["note"]);
      const id = p.positionals[0];
      if (!id) throw new UsageError(`${sub} needs a goal id`);
      const store = new Store();
      const g = needGoal(store.goal(id), id);
      const status = ({ done: "done", blocked: "blocked", pause: "paused", resume: "active" } as const)[sub];
      if (sub === "resume" && g.status !== "paused") throw new Error(`${id} is ${g.status}, not paused`);
      if (sub !== "resume" && g.status !== "active" && g.status !== "paused") throw new Error(`${id} is already ${g.status}`);
      store.updateGoal(id, { status, note: str(p, "note") ?? g.note });
      out(`${status.toUpperCase()} ${id}`);
      return 0;
    }

    case "delete": {
      unknownFlags(p, []);
      if (p.positionals.length === 0) throw new UsageError("delete needs one or more goal ids");
      const store = new Store();
      let missing = 0;
      for (const id of p.positionals) {
        if (store.deleteGoal(id)) out(`DELETED ${id}`);
        else {
          out(`no goal ${id}`);
          missing++;
        }
      }
      return missing ? 1 : 0;
    }

    case "setup": {
      unknownFlags(p, ["check"]);
      const provider = p.positionals[0];
      if (!provider) throw new UsageError("setup needs a provider: claude, opencode, antigravity or pi");
      adapterFor(provider);
      const s = SETUP[provider];
      if (!s) throw new Error(`no goal setup is built for ${provider} yet`);
      if (bool(p, "check")) {
        const where = s.check();
        out(where ? `OK ${provider}: configured in ${where}` : `MISSING ${provider}: run \`agent-job goal setup ${provider}\``);
        return where ? 0 : 1;
      }
      out(s.text(selfCommand()));
      return 0;
    }

    case "event": {
      unknownFlags(p, ["session", "raw"]);
      const ev = p.positionals[0];
      const known = ev === "turn-end" || ev === "compacted" || ev === "resumed";
      if (!known && ev !== "aborted") throw new UsageError("event takes turn-end, compacted, resumed or aborted");
      const addr = str(p, "session") ?? whoami();
      if (!addr) throw new Error("cannot tell which session this is; pass --session");
      trace("event-cmd", ev, { addr, raw: str(p, "raw") });
      if (!known) {
        // The user stopped the turn: nothing is owed, but the trace shows it was seen and respected.
        trace("goal", "turn-end", { addr, decision: "none", why: "aborted by the user" });
        return 0;
      }
      const text = onGoalEvent(new Store(), addr, ev);
      if (text) process.stdout.write(text + "\n");
      return 0;
    }

    case "hook": {
      const provider = p.positionals[0];
      try {
        const reply = HOOKS[provider ?? ""]?.(await Bun.stdin.text(), p.positionals[1]) ?? "";
        if (reply) process.stdout.write(reply + "\n");
      } catch {}
      return 0; // a hook never fails the runtime
    }

    default:
      throw new UsageError(`unknown goal command "${sub}"`);
  }
}

