import fs from "node:fs";
import path from "node:path";
import { criticalPath, mermaid, statusOf, topoOrder, type Tracker } from "./graph";
import { load, validateSet, validateSpecFile } from "./validate";

const USAGE = `tasks - validate and track a task set under _swe/tasks/<name>/

Usage:
  tasks validate-spec [<name>|--file <path>]   check a specification against the canonical structure
  tasks validate [--set <name>]                check the index, task files, dependency graph and traceability
  tasks status [--set <name>]                  show every task with its state (done, in-progress, ready, blocked)
  tasks next [--set <name>]                    show the tasks that can start now and the longest remaining chain
  tasks start <T001> [--set <name>]            mark a ready task as in progress
  tasks done <T001> [--set <name>]             mark a task done; every acceptance criterion must be checked
  tasks reopen <T001> [--set <name>]           clear the done or in-progress mark of a task
  tasks graph [--set <name>]                   print the dependency graph as Mermaid

Run from the project directory. --set can be left out when exactly one task set exists.
Exit code 0 means success, 1 means the check found problems, 2 means the call was wrong.`;

class UsageError extends Error {}

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--set" || a === "--file") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new UsageError(`${a} needs a value.`);
      flags[a.slice(2)] = v;
    } else if (a.startsWith("--")) throw new UsageError(`Unknown option ${a}.`);
    else pos.push(a);
  }
  return { flags, pos };
}

function root(): string {
  return path.join(process.cwd(), "_swe");
}

function setDir(name: string | undefined): { name: string; dir: string } {
  const base = path.join(root(), "tasks");
  if (name) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new UsageError(`"${name}" is not a lowercase kebab-case name.`);
    const dir = path.join(base, name);
    if (!fs.existsSync(dir)) throw new UsageError(`No task set at ${dir}.`);
    return { name, dir };
  }
  const sets = fs.existsSync(base) ? fs.readdirSync(base).filter((n) => fs.statSync(path.join(base, n)).isDirectory()).sort() : [];
  if (sets.length === 0) throw new UsageError(`No task set found under ${base}.`);
  if (sets.length > 1) throw new UsageError(`Several task sets exist (${sets.join(", ")}); pass --set <name>.`);
  return { name: sets[0]!, dir: path.join(base, sets[0]!) };
}

function trackerFile(dir: string): string {
  return path.join(dir, "tasks", "tracker.json");
}

function readTracker(dir: string): Tracker {
  const f = trackerFile(dir);
  if (!fs.existsSync(f)) return { started: [], done: [] };
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    return { started: Array.isArray(j.started) ? j.started : [], done: Array.isArray(j.done) ? j.done : [] };
  } catch {
    throw new UsageError(`${f} is not valid JSON. Fix or delete it.`);
  }
}

function writeTracker(dir: string, t: Tracker) {
  const tmp = trackerFile(dir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ started: [...new Set(t.started)].sort(), done: [...new Set(t.done)].sort() }, null, 2) + "\n");
  fs.renameSync(tmp, trackerFile(dir));
}

function report(problems: string[], okMessage: string): number {
  if (!problems.length) {
    console.log(okMessage);
    return 0;
  }
  console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.log(`- ${p}`);
  return 1;
}

function requireTask(id: string | undefined, ids: string[]): string {
  if (!id) throw new UsageError("Name a task ID, such as T001.");
  if (!ids.includes(id)) throw new UsageError(`${id} is not a task in this set (${ids.join(", ") || "none"}).`);
  return id;
}

export function run(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return cmd ? 0 : 2;
  }
  const { flags, pos } = parseArgs(rest);
  if (cmd === "validate-spec") {
    const file = flags.file ?? path.join(root(), "specifications", pos[0] ?? setDir(undefined).name, "specification.md");
    return report(validateSpecFile(file), `Specification is valid: ${file}`);
  }
  const { name, dir } = setDir(flags.set);
  if (cmd === "validate") {
    const spec = path.join(root(), "specifications", name, "specification.md");
    const hasSpec = fs.existsSync(spec);
    const problems = validateSet(dir, hasSpec ? spec : null);
    const note = hasSpec ? "" : " (specification not found at the default path, so traceability was not checked)";
    return report(problems, `Task set ${name} is valid${note}.`);
  }
  const loaded = load(dir);
  if (!loaded.tasks.length) throw new UsageError(`No task files under ${path.join(dir, "tasks")}.`);
  const ids = loaded.tasks.map((t) => t.id);
  const all = new Map(loaded.tasks.map((t) => [t.id, t]));
  const tracker = readTracker(dir);
  const { cycle } = topoOrder(loaded.tasks);
  if (cycle && ["status", "next", "start", "graph"].includes(cmd)) {
    console.log(`The dependency graph has a cycle: ${cycle.join(" -> ")}. Run \`tasks validate\` and fix it first.`);
    return 1;
  }
  const state = (id: string) => statusOf(all.get(id)!, all, tracker);
  if (cmd === "status") {
    const counts: Record<string, number> = { done: 0, "in-progress": 0, ready: 0, blocked: 0 };
    for (const t of loaded.tasks) {
      const s = state(t.id);
      counts[s]!++;
      const checked = t.criteria.filter((c) => c.checked).length;
      const open = t.blockers.filter((b) => state(b) !== "done");
      const tail = s === "blocked" ? `  waiting for ${open.join(", ")}` : "";
      console.log(`${t.id}  ${s.padEnd(11)} ${checked}/${t.criteria.length}  ${t.requirement === "Optional" ? "(optional) " : ""}${t.title}${tail}`);
    }
    console.log(`\n${ids.length} tasks: ${counts.done} done, ${counts["in-progress"]} in progress, ${counts.ready} ready, ${counts.blocked} blocked`);
    const stale = loaded.tasks.filter((t) => state(t.id) !== "done" && t.criteria.length && t.criteria.every((c) => c.checked));
    for (const t of stale) console.log(`Note: ${t.id} has every criterion checked; run \`tasks done ${t.id}\`.`);
    const odd = tracker.done.filter((id) => all.has(id) && all.get(id)!.criteria.some((c) => !c.checked));
    for (const id of odd) console.log(`Warning: ${id} is marked done but has unchecked criteria.`);
    return 0;
  }
  if (cmd === "next") {
    const ready = loaded.tasks.filter((t) => state(t.id) === "ready");
    const going = loaded.tasks.filter((t) => state(t.id) === "in-progress");
    if (going.length) console.log(`In progress: ${going.map((t) => t.id).join(", ")}`);
    if (ready.length) {
      console.log(`Ready now (can run in parallel): ${ready.length}`);
      for (const t of ready) console.log(`- ${t.id} ${t.title}${t.requirement === "Optional" ? " (optional)" : ""}  -> ${path.relative(process.cwd(), t.file)}`);
    } else if (!going.length) console.log(loaded.tasks.every((t) => state(t.id) === "done") ? "Every task is done." : "No task is ready; every remaining task is blocked.");
    const cp = criticalPath(loaded.tasks, tracker);
    if (cp.length) console.log(`Longest remaining chain: ${cp.join(" -> ")}`);
    return 0;
  }
  if (cmd === "graph") {
    console.log(mermaid(loaded.tasks, tracker));
    return 0;
  }
  if (cmd === "start" || cmd === "done" || cmd === "reopen") {
    const id = requireTask(pos[0], ids);
    const t = all.get(id)!;
    const open = t.blockers.filter((b) => state(b) !== "done");
    if (cmd === "reopen") {
      tracker.done = tracker.done.filter((x) => x !== id);
      tracker.started = tracker.started.filter((x) => x !== id);
      writeTracker(dir, tracker);
      console.log(`${id} reopened.`);
      return 0;
    }
    if (open.length) {
      console.log(`${id} is blocked by ${open.join(", ")}; finish those first.`);
      return 1;
    }
    if (cmd === "start") {
      if (state(id) === "done") {
        console.log(`${id} is already done; use \`tasks reopen ${id}\` first.`);
        return 1;
      }
      tracker.started.push(id);
      writeTracker(dir, tracker);
      console.log(`${id} started.`);
      return 0;
    }
    const unchecked = t.criteria.filter((c) => !c.checked);
    if (!t.criteria.length || unchecked.length) {
      console.log(`${id} cannot be marked done: ${t.criteria.length ? `${unchecked.length} acceptance criteria unchecked` : "it has no acceptance criteria"}.`);
      for (const c of unchecked) console.log(`- [ ] ${c.text}`);
      return 1;
    }
    tracker.done.push(id);
    tracker.started = tracker.started.filter((x) => x !== id);
    writeTracker(dir, tracker);
    const unlocked = loaded.tasks.filter((x) => x.blockers.includes(id) && state(x.id) === "ready").map((x) => x.id);
    console.log(`${id} done.${unlocked.length ? ` Now ready: ${unlocked.join(", ")}.` : ""}`);
    return 0;
  }
  throw new UsageError(`Unknown command "${cmd}". Run \`tasks help\`.`);
}

if (import.meta.main) {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}
