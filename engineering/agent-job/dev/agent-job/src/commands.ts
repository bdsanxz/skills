import fs from "node:fs";
import path from "node:path";
import { bool, parseArgs, str, UsageError, unknownFlags, type Parsed } from "./args.ts";
import { daemonPid, defaultDeps, deliverNow, ensureDaemon, logFile, runDaemon, stopDaemon } from "./daemon.ts";
import { adapterFor, have, leaseLive, PROVIDERS, whoami } from "./providers.ts";
import piExtension from "./pi-extension.txt";
import { describe, firstRun, MIN_EVERY_MS, parseAt, parseCron, parseDuration, type Schedule } from "./schedule.ts";
import { address, splitAddress, Store, type Cron } from "./store.ts";
import { channel } from "./channel.ts";
import { traceFile, traceMarker, traceOn } from "./trace.ts";
import { watch } from "./watch.ts";

const fmt = (ms: number | null) => (ms === null ? "-" : new Date(ms).toLocaleString("sv-SE").slice(0, 19));

export const HELP: Record<string, string> = {
  "": `agent-job: scheduled instructions and goals for agent sessions, across runtimes.

Usage: agent-job <command> [options]

Commands:
  cron         Schedule an instruction for a session (cron expression, one time, or every interval)
  goal         Give a session an objective that is sent at creation, at every turn end and after compaction
  whoami       Print this session's address (<provider>:<session id>)
  watch        Hold this session's lease and print fired crons, one line each (for a Monitor)
  trace        on | off | show | clear: the log of the real events agent-job sees and what it decided
  channel      Run the Claude Code channel (an MCP stdio server) that turns fired crons into turns
  channel-config Print the --mcp-config JSON that loads the channel
  pi-extension Print the extension that delivers crons and goals into pi sessions
  daemon       run | start | stop | status: the process that fires crons
  doctor       Check what this machine offers for each provider

Providers (the address prefix): claude, opencode, antigravity, pi.
A cron or goal reaches a session only while it is open; when the session closes it ends and nothing is run headless.
Run \`agent-job cron --help\`, \`agent-job goal --help\` or \`agent-job <command> --help\` first.
Exit codes: 0 done, 1 the request failed, 2 wrong usage.`,
  cron: `agent-job cron: scheduled instructions, like a cron tool.

Usage: agent-job cron <command> [options]

Commands:
  create    Schedule an instruction for a session (cron expression, one time, or every interval)
  list      List crons
  show      Show one cron with its recent events
  pause     Stop a cron from firing until it is resumed
  resume    Resume a paused cron
  run-now   Send a cron now, outside its schedule
  delete    Delete a cron
Run \`agent-job cron <command> --help\` first.`,
  whoami: `Usage: agent-job whoami
Prints this shell's session address from the runtime's variable (CLAUDE_CODE_SESSION_ID,
OPENCODE_SESSION_ID, ANTIGRAVITY_CONVERSATION_ID, PI_SESSION_ID), or AGENT_JOB_SELF when set.`,
  create: `Usage: agent-job cron create (--cron "<5 fields>" | --at <time> | --every <duration>) (--prompt <text> | <prompt on stdin>) [options]

Schedule (exactly one):
  --cron "*/5 * * * *"   minute hour day-of-month month day-of-week, local time
  --at +30m              one time: +10m, in 2h, 09:00 (next occurrence), 2026-10-28T09:00 (local)
  --every 15m            fixed interval (at least 10s): 90s, 5m, 2h, 1d, 1h30m
Options:
  --session <addr>       target session, default: this one (see whoami)
  --name <text>          short label
  --max-runs <n>         stop after n sends
  --expires <duration>   stop this long from now
  --force                create even when the session does not look open
Starts the daemon when it is not running. Prints what a Claude Code or pi session must still do to receive.
Example: agent-job cron create --cron "0 9 * * 1-5" --name standup --prompt "Summarize yesterday's commits."`,
  list: `Usage: agent-job cron list [--all] [--session <addr>] [--json]
Lists active and paused crons; --all adds done and ended ones.`,
  show: `Usage: agent-job cron show <id> [--json]   Details and the last events of one cron.`,
  pause: `Usage: agent-job cron pause <id>`,
  resume: `Usage: agent-job cron resume <id>   Resumes a paused cron, or an ended one whose session is open again.`,
  "run-now": `Usage: agent-job cron run-now <id>   Sends it now to the open session; the schedule is unchanged.`,
  delete: `Usage: agent-job cron delete <id>...`,
  watch: `Usage: agent-job watch [<addr>]
Holds the lease of a Claude Code or pi session and prints one line per fired cron. It prints
nothing else. Run it under the Monitor tool; it stops when the session ends. Address default: whoami.`,
  trace: `Usage: agent-job trace on|off|show [--tail <n>]|clear
Records every hook, extension event, poll, channel push and cron fire with the decision taken (sent, or none and why) as one JSON line each in trace.log of the data directory. \`on\` is a marker file, so hooks started without your environment write too; AGENT_JOB_TRACE=1 does the same for one process.`,
  channel: `Usage: agent-job channel   An MCP stdio server for Claude Code; do not run it by hand.
Holds the session's lease and pushes each fired cron into the conversation as a turn, so no Monitor is needed. Load it with:
  claude --mcp-config "$(agent-job channel-config)" --dangerously-load-development-channels server:agent-job`,
  "channel-config": `Usage: agent-job channel-config   Prints the --mcp-config JSON that loads \`agent-job channel\` as the MCP server "agent-job".`,
  "pi-extension": `Usage: agent-job pi-extension [--path]
Prints the pi extension (with this script's path filled in); --path writes it to a file and prints the path.`,
  daemon: `Usage: agent-job daemon run|start|stop|status
run: in the foreground. start: detached, log in the data directory (create starts it for you). status: pid and log.`,
  doctor: `Usage: agent-job doctor   Reports the tools and the daemon each provider needs.`,
};

function help(cmd: string): string {
  return HELP[cmd] ?? HELP[""]!;
}

function need(r: Cron | null, id: string): Cron {
  if (!r) throw new Error(`no cron ${id}; \`agent-job list --all\` shows them`);
  return r;
}

function target(p: Parsed): string {
  const a = str(p, "session") ?? whoami();
  if (!a) throw new Error("cannot tell which session this is; pass --session <provider>:<id> or set AGENT_JOB_SELF");
  const { provider } = splitAddress(a);
  adapterFor(provider);
  return a;
}

function line(r: Cron): string {
  return `${r.id}  ${r.status.padEnd(6)}  ${address(r.provider, r.session_id)}  ${describe(r)}  next ${fmt(r.next_run)}  runs ${r.runs}${r.name ? `  "${r.name}"` : ""}`;
}

async function stdinText(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return (await Bun.stdin.text()).trim();
}

export async function dispatch(cmd: string, argv: string[]): Promise<number> {
  const p = parseArgs(argv, ["all", "json", "force", "path"]);
  if (p.flags.has("help")) {
    console.log(help(cmd));
    return 0;
  }
  const out = (s: string) => console.log(s);

  switch (cmd) {
    case "whoami": {
      unknownFlags(p, []);
      const a = whoami();
      if (!a) throw new Error("not inside a known agent session; set AGENT_JOB_SELF=<provider>:<id> only when the user tells you which session this is");
      out(a);
      return 0;
    }

    case "create": {
      unknownFlags(p, ["cron", "at", "every", "prompt", "session", "name", "max-runs", "expires", "force"]);
      const chosen = ["cron", "at", "every"].filter((k) => p.flags.has(k));
      if (chosen.length !== 1) throw new UsageError("give exactly one of --cron, --at, --every");
      const now = Date.now();
      let schedule: Schedule;
      if (chosen[0] === "cron") {
        const expr = str(p, "cron")!.trim().replace(/\s+/g, " ");
        parseCron(expr);
        schedule = { kind: "cron", expr };
      } else if (chosen[0] === "at") {
        const at = parseAt(str(p, "at")!, now);
        if (at <= now) throw new Error(`${fmt(at)} is in the past`);
        schedule = { kind: "at", expr: String(at) };
      } else {
        const ms = parseDuration(str(p, "every")!);
        if (ms < MIN_EVERY_MS) throw new Error(`--every must be at least ${MIN_EVERY_MS / 1000}s`);
        schedule = { kind: "every", expr: String(ms) };
      }
      const prompt = (str(p, "prompt") ?? (await stdinText())).trim();
      if (!prompt) throw new UsageError("give the instruction with --prompt or on stdin");
      const addr = target(p);
      const { provider, id: sessionId } = splitAddress(addr);
      const adapter = adapterFor(provider);
      const store = new Store();
      const live = adapter.liveness(store, sessionId);
      if (live.state === "dead" && !bool(p, "force")) {
        throw new Error(`${addr} does not look open (${live.detail}); a cron is sent only while its session is open. Use --force to create it anyway`);
      }
      const maxRuns = str(p, "max-runs");
      const expires = str(p, "expires");
      const r: Cron = {
        id: store.newId(),
        name: str(p, "name") ?? "",
        provider,
        session_id: sessionId,
        cwd: process.cwd(),
        prompt,
        kind: schedule.kind,
        expr: schedule.expr,
        status: "active",
        created_at: now,
        next_run: firstRun(schedule, now),
        last_run: null,
        last_result: "",
        runs: 0,
        max_runs: maxRuns ? Number(maxRuns) : null,
        expires_at: expires ? now + parseDuration(expires) : null,
        end_reason: "",
      };
      if (r.max_runs !== null && !(r.max_runs >= 1)) throw new UsageError("--max-runs must be 1 or more");
      store.insert(r);
      store.event(r.id, "created", `${describe(r)} for ${addr}`, now);
      const d = ensureDaemon(store);
      out(`CREATED ${r.id} for ${addr}: ${describe(r)}; first run ${fmt(r.next_run)}`);
      out(`DAEMON: ${d.started ? "started" : "running"} (pid ${d.pid})`);
      if (adapter.mode === "watch" && !leaseLive(store, addr)) {
        out(
          provider === "claude"
            ? `ARM: this session was not started with the agent-job channel, so it cannot receive yet. Ask the user to restart it with: \`claude --mcp-config "$(bun ${process.argv[1]} channel-config)" --dangerously-load-development-channels server:agent-job -- \` (resume it with \`--resume ${sessionId}\`). Without a channel, a Monitor running \`bun ${process.argv[1]} watch ${addr}\` receives instead. Until one of them runs, the line waits up to 30 minutes.`
            : `ARM: no pi extension listener runs for this session. Ask the user to install it: \`bun ${process.argv[1]} pi-extension > ~/.pi/agent/extensions/agent-job.ts\`, then /reload in the session. Do not install it yourself.`,
        );
      }
      return 0;
    }

    case "list": {
      unknownFlags(p, ["all", "session", "json"]);
      const store = new Store();
      const rows = store.list({ all: bool(p, "all"), address: str(p, "session") });
      if (bool(p, "json")) out(JSON.stringify(rows, null, 2));
      else if (rows.length === 0) out("No crons.");
      else for (const r of rows) out(line(r));
      return 0;
    }

    case "show": {
      unknownFlags(p, ["json"]);
      const id = p.positionals[0];
      if (!id) throw new UsageError("show needs a cron id");
      const store = new Store();
      const r = need(store.get(id), id);
      if (bool(p, "json")) {
        out(JSON.stringify({ ...r, events: store.events(id) }, null, 2));
        return 0;
      }
      out(line(r));
      out(`prompt: ${r.prompt}`);
      out(`created ${fmt(r.created_at)}; last run ${fmt(r.last_run)} ${r.last_result}`.trimEnd());
      if (r.end_reason) out(`ended: ${r.end_reason}`);
      for (const e of store.events(id)) out(`  ${fmt(e.ts)}  ${e.kind}  ${e.detail}`);
      return 0;
    }

    case "pause":
    case "resume": {
      unknownFlags(p, []);
      const id = p.positionals[0];
      if (!id) throw new UsageError(`${cmd} needs a cron id`);
      const store = new Store();
      const r = need(store.get(id), id);
      if (cmd === "pause") {
        if (r.status !== "active") throw new Error(`${id} is ${r.status}, not active`);
        store.update(id, { status: "paused" });
        store.event(id, "paused", "by the agent");
        out(`PAUSED ${id}`);
        return 0;
      }
      if (r.status === "done") throw new Error(`${id} is done; create a new cron`);
      if (r.status === "active") throw new Error(`${id} is already active`);
      const schedule = { kind: r.kind, expr: r.expr };
      if (r.status === "ended") {
        const live = adapterFor(r.provider).liveness(store, r.session_id);
        if (live.state !== "live") throw new Error(`the session of ${id} is not open (${live.state}: ${live.detail}); resume it from a session that is open`);
      }
      let next: number;
      try {
        next = firstRun(schedule, Date.now());
      } catch {
        throw new Error(`${id} has no run left to schedule; create a new cron`);
      }
      store.update(id, { status: "active", next_run: next, end_reason: "" });
      store.event(id, "resumed", "by the agent");
      ensureDaemon(store);
      out(`RESUMED ${id}; next run ${fmt(next)}`);
      return 0;
    }

    case "run-now": {
      unknownFlags(p, []);
      const id = p.positionals[0];
      if (!id) throw new UsageError("run-now needs a cron id");
      const store = new Store();
      const d = deliverNow(store, defaultDeps(), need(store.get(id), id));
      if (!d.ok) throw new Error(d.detail);
      out(`SENT ${id}: ${d.detail}`);
      return 0;
    }

    case "delete": {
      unknownFlags(p, []);
      if (p.positionals.length === 0) throw new UsageError("delete needs one or more cron ids");
      const store = new Store();
      let missing = 0;
      for (const id of p.positionals) {
        if (store.delete(id)) out(`DELETED ${id}`);
        else {
          out(`no cron ${id}`);
          missing++;
        }
      }
      return missing ? 1 : 0;
    }

    case "watch": {
      unknownFlags(p, []);
      const addr = p.positionals[0] ?? whoami();
      if (!addr) throw new Error("cannot tell which session to watch; pass <provider>:<id>");
      const { provider } = splitAddress(addr);
      if (adapterFor(provider).mode !== "watch") throw new Error(`${provider} sessions are reached directly by the daemon and need no watch`);
      await watch(new Store(), addr);
      return 0;
    }

    case "trace": {
      unknownFlags(p, ["tail"]);
      const sub = p.positionals[0];
      const store = new Store();
      const file = traceFile(store.dir);
      if (sub === "on") {
        fs.writeFileSync(traceMarker(store.dir), "");
        out(`TRACE on: ${file}`);
      } else if (sub === "off") {
        fs.rmSync(traceMarker(store.dir), { force: true });
        out("TRACE off");
      } else if (sub === "clear") {
        fs.rmSync(file, { force: true });
        out("TRACE cleared");
      } else if (sub === "show") {
        const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
        const n = Number(str(p, "tail") ?? lines.length);
        out(lines.slice(-n).join("\n") || `no trace yet (${traceOn(store.dir) ? "on" : "off"}): ${file}`);
      } else throw new UsageError("trace takes on, off, show or clear");
      return 0;
    }

    case "channel": {
      unknownFlags(p, []);
      await channel(new Store());
      return 0;
    }

    case "channel-config": {
      unknownFlags(p, []);
      const script = fs.realpathSync(process.argv[1]!);
      out(JSON.stringify({ mcpServers: { "agent-job": { command: process.execPath, args: [script, "channel"] } } }));
      return 0;
    }

    case "pi-extension": {
      unknownFlags(p, ["path"]);
      const script = fs.realpathSync(process.argv[1]!);
      const source = piExtension.replace("__BUN__", JSON.stringify(process.execPath)).replace("__SCRIPT__", JSON.stringify(script));
      if (!bool(p, "path")) {
        process.stdout.write(source);
        return 0;
      }
      const store = new Store();
      const file = path.join(store.dir, "pi-extension.ts");
      fs.writeFileSync(file, source);
      out(file);
      return 0;
    }

    case "daemon": {
      unknownFlags(p, []);
      const sub = p.positionals[0];
      const store = new Store();
      if (sub === "run") {
        runDaemon(store);
        await new Promise(() => {});
      } else if (sub === "start") {
        const d = ensureDaemon(store);
        out(`${d.started ? "STARTED" : "RUNNING"} daemon pid ${d.pid}; log ${logFile(store)}`);
      } else if (sub === "stop") {
        const pid = stopDaemon(store);
        out(pid ? `STOPPED daemon pid ${pid}` : "The daemon was not running.");
      } else if (sub === "status") {
        const pid = daemonPid(store);
        out(pid ? `RUNNING pid ${pid}; log ${logFile(store)}` : "NOT RUNNING; `agent-job daemon start` starts it");
        out(`active crons: ${store.active().length}`);
      } else throw new UsageError("daemon takes run, start, stop or status");
      return 0;
    }

    case "doctor": {
      unknownFlags(p, []);
      const store = new Store();
      const pid = daemonPid(store);
      out(`daemon: ${pid ? `running (pid ${pid})` : "not running"}; data ${store.dir}`);
      out(`bun: ${process.execPath}`);
      const rows: [string, boolean, string][] = [
        ["claude", have("claude"), "needs `claude`; the session arms `watch` with the Monitor tool"],
        ["opencode", have("opencode"), "needs `opencode`; liveness is a running turn, a TUI process opened with the id, or its TUI in herdr"],
        ["antigravity", have("agy") && have("lsof"), "needs `agy` and `lsof`; delivery needs the agy TUI in herdr"],
        ["pi", have("pi"), "needs `pi` with the extension from `pi-extension` installed"],
      ];
      for (const [name, ok, note] of rows) out(`${name.padEnd(12)} ${ok ? "ok     " : "missing"}  ${note}`);
      out(`herdr: ${have("herdr") ? "found" : "missing (needed for antigravity delivery and one OpenCode check)"}`);
      out(`providers: ${PROVIDERS.join(", ")}`);
      return 0;
    }

    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}
