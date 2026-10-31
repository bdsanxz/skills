// Launch: start the built squad in herdr, one workspace with a tab per member.

import fs from "node:fs";
import {
  Exit,
  LaunchError,
  PI_ROSTER,
  SCRIPT,
  type JsonObject,
  type SkillSources,
  display,
  dumps,
  fail,
  home,
  isFile,
  isObject,
  join,
  parseJsonFile,
  print,
  partition,
  readText,
  reason,
  repr,
  run,
  sessionLabel,
  shown,
  strip,
  tail,
  which,
} from "./core";
import { type Member, agent, agyArgv, claudeBaseArgv, museArgv, piArgv, qoderArgv } from "./agents";
import { Hc, appSpaces, haveApp, hcSpaceName, hcTerminals } from "./hc";
import { FIRST_PROMPT, Herdr, field, herdrSession, list, text } from "./herdr";
import { type Pane, type Tab, layoutLines, moveToEnd, openTab, planLayout, squadState, tabSteps, workspaceLabel } from "./layout";
import { peersInstalled } from "./peers";
import { agentShellInstalled } from "./agentshell";
import {
  type Overrides,
  type Roster,
  buildMember,
  describe,
  identityPath,
  loadRoster,
  rosterProblems,
  selected,
  writeIdentity,
  writeInstructions,
} from "./roster";
import { findSession, qoderWaitConfig, sessionLive, validSession, waitForQoderSession } from "./sessions";

export type LaunchArgs = {
  workspace: string;
  member: string | null;
  session: string | null;
  dryRun: boolean;
  overrides: Overrides;
};

/** Print NOTE (or WARNING) lines for the notes, then PROBLEM lines. */
export function report(notes: string[], problems: string[]) {
  for (const note of notes) print(note.startsWith("WARNING ") ? note : `NOTE ${note}`);
  for (const problem of problems) print(`PROBLEM ${problem}`);
}

/** Where the skills every member gets come from: roster.json's peers_source and
 * agent_shell_source, else the copies next to this skill. */
export function skillSourcesOf(roster: Roster, fallback: SkillSources): SkillSources {
  const peers = "peers_source" in roster ? (roster.peers_source as string) : fallback.peers;
  const agentShell = "agent_shell_source" in roster ? (roster.agent_shell_source as string) : fallback.agentShell;
  for (const [skill, source, key] of [["peers", peers, "peers_source"], ["agent-shell", agentShell, "agent_shell_source"]]) {
    if (source!.startsWith("/") && !isFile(join(source!, "SKILL.md"))) {
      fail(`no ${skill} skill at ${source}; set "${key}" in roster.json to its directory, package or URL`);
    }
  }
  if (!which("npx")) fail("npx is not on PATH; install Node.js, which the skills CLI needs");
  return { peers, agentShell };
}

function settingsChange(m: Member) {
  const spec = agent(m.agent);
  if (!spec.launchSettings) return `CLEAR ${m.name}'s model and effort: ${spec.label} manages them`;
  return `SET ${m.name}'s model to ${m.model || "the agent default"}, effort ${m.effort || "the agent default"}`;
}

/** The agent, model and effort the member was last built for, from its .peers.json. */
function builtFor(workspace: string, m: Member) {
  const file = identityPath(workspace, m);
  const built = isFile(file) ? parseJsonFile(file, `fix or remove it, then run \`bun ${SCRIPT} build\` again`) : {};
  if (!isObject(built)) fail(`${file} must hold a JSON object; remove it, then run \`bun ${SCRIPT} build\` again`);
  if (!("agent" in built) && isFile(join(workspace, m.cwd, agent(m.agent).instructions))) {
    built.agent = m.agent; // built before .peers.json recorded the agent
  }
  return built;
}

/** Build one member's agent argv for herdr-core, without the first prompt: it is
 * always sent with `hcx send` (untagged; `hc send` when hcx is missing or
 * fails) after the tab opens, so it is delivered exactly once even when the
 * tab opens on a trust dialog. Returns the argv and the runtime session id
 * when creating one is part of opening the tab. */
function hcMemberArgv(h: Hc, m: Member, dir: string, label: string): { argv: string[]; session: string | null } {
  switch (m.agent) {
    case "claude":
      return { argv: claudeBaseArgv(m, label), session: null };
    case "opencode": {
      if (!m.model) return { argv: ["opencode"], session: null };
      const created = h.opencodeApi(dir, "session.create", {}, {
        title: `${label} (peers squad member)`,
        location: { directory: dir },
      });
      const session = text(field(created, "data"), "id");
      if (!session && !h.dryRun) {
        throw new LaunchError(`\`opencode api session.create\` returned no session id: ${tail(dumps(created), 400)}`);
      }
      return { argv: ["opencode", "--session", session], session: session || null };
    }
    case "pi":
      return { argv: piArgv(m, label, [PI_ROSTER]), session: null };
    case "agy":
      return { argv: agyArgv(m), session: null };
    case "muse":
      return { argv: museArgv(m), session: null };
    case "qoder":
      return { argv: qoderArgv(m, label), session: null };
    default:
      throw new LaunchError(`unknown agent ${repr(m.agent)} for member ${repr(m.name)}`);
  }
}

/** Read an OpenCode session's model back after switchModel: session.get first, then the
 * session.list entry, which carries the same model. Returns null when neither read-back
 * works, after a WARN that names the failed commands; the caller then carries on. */
function readOpencodeModelHc(h: Hc, dir: string, member: string, session: string): JsonObject | null {
  try {
    return field(field(h.opencodeApi(dir, "session.get", { sessionID: session }), "data"), "model");
  } catch (getError) {
    const getMsg = getError instanceof Error ? getError.message : String(getError);
    try {
      const found = list(h.opencodeApi(dir, "session.list"), "data").find((s) => text(s, "id") === session);
      if (found) return field(found, "model");
      print(
        `WARN opencode member ${repr(member)}: could not verify the model switch: ` +
          `\`opencode api session.get\` failed (${tail(strip(getMsg), 300)}), and \`opencode api session.list\` ` +
          `has no session ${session}. Carrying on with the member's first prompt.`,
      );
      return null;
    } catch (listError) {
      const listMsg = listError instanceof Error ? listError.message : String(listError);
      print(
        `WARN opencode member ${repr(member)}: could not verify the model switch: ` +
          `\`opencode api session.get\` failed (${tail(strip(getMsg), 300)}), and \`opencode api session.list\` ` +
          `failed (${tail(strip(listMsg), 300)}). Carrying on with the member's first prompt.`,
      );
      return null;
    }
  }
}

/** Settle one member's tab, answer its known dialogs, and send the first prompt. */
function launchHcAgent(h: Hc, m: Member, dir: string, terminal: string, session: string | null) {
  const dialogs = agent(m.agent).dialogs;
  if (m.agent === "claude") {
    if (h.dryRun || h.readScreen(terminal).includes("Yes, I trust this folder")) {
      h.sendKeys(terminal, ["down", "enter"], "only when Claude asks to trust the folder");
    }
    h.settle(terminal);
    h.sendPrompt(terminal, FIRST_PROMPT);
    return;
  }
  h.settle(terminal);
  if (m.agent === "opencode" && session) {
    const [provider, , modelId] = partition(m.model ?? "", "/");
    const model: JsonObject = { providerID: provider, id: modelId, ...(m.effort ? { variant: m.effort } : {}) };
    h.opencodeApi(dir, "session.switchModel", { sessionID: session }, { model });
    // session.get on OpenCode 2.0.29 can fail with a GET-body TypeError; fall back to the
    // session.list entry. A read-back that fails on its own never aborts the launch.
    const now = readOpencodeModelHc(h, dir, m.name, session);
    if (now !== null) {
      const variant = m.effort || "default";
      const same = now.providerID === provider && now.id === modelId && ((now.variant as string) || "default") === variant;
      if (!h.dryRun && !same) {
        throw new LaunchError(
          `OpenCode session ${session} reports model ${repr(now)}, not ${m.model} with variant ${variant}`,
        );
      }
    }
  }
  h.firstPrompt(terminal, dialogs);
}

/** Record the member's runtime session in roster.json, so rebuild and a later launch
 * know which session is the member's. The id is what the launch established, else the
 * runtime's newest session in the member's directory. For qoder the session file only
 * appears after the member processes its first prompt, so the lookup waits for a file
 * newer than the member's launch start; when none appears nothing is recorded and a
 * NOTE says why. peers send/open never read it. */
function recordSession(
  args: LaunchArgs,
  roster: Roster,
  m: Member,
  dir: string,
  established: string | null,
  sinceMs: number,
): void {
  if (args.dryRun) return;
  let id: string | null;
  if (established) {
    id = established;
  } else if (m.agent === "qoder") {
    id = waitForQoderSession(dir, sinceMs);
    if (!id) {
      const cfg = qoderWaitConfig();
      const within = cfg.timeoutMs >= 1000 ? `${Math.round(cfg.timeoutMs / 1000)} s` : `${cfg.timeoutMs} ms`;
      print(
        `NOTE member ${repr(m.name)}: qoder session id could not be recorded: ` +
          `no new session file appeared within ${within} of the first prompt; ` +
          `relaunch with --member ${m.name} to record it`,
      );
      return;
    }
  } else {
    id = findSession(m.agent, dir);
    if (!id) return;
  }
  if (!id) return;
  const raw = (roster.members as JsonObject[]).find((r) => r.name === m.name);
  if (!isObject(raw)) return;
  const cur = validSession(raw.session) ? raw.session : null;
  if (cur && cur.runtime === m.agent && cur.id === id) return;
  raw.session = { runtime: m.agent, id };
  try {
    fs.writeFileSync(join(args.workspace, "roster.json"), JSON.stringify(roster, null, 2) + "\n");
  } catch (error) {
    fail(`cannot record ${m.name}'s session in roster.json: ${reason(error)}`);
  }
  print(`RECORDED ${m.name}: session ${m.agent}:${id} in roster.json`);
}

/** The OpenCode background-service pid from its state file, or null. */
function opencodeServicePid(): number | null {
  try {
    const pid = (JSON.parse(readText(join(home(), ".local", "state", "opencode", "service.json"))) as JsonObject).pid;
    return typeof pid === "number" && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Parse an opencode.json file that may have trailing commas; null when unreadable. */
function readOpencodeConfig(file: string): JsonObject | null {
  let text: string;
  try {
    text = readText(file);
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    try {
      const parsed: unknown = JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

/** The env name in a provider's options.apiKey: {env: NAME} or the string "{env:NAME}". */
function apiKeyEnv(value: unknown): string | null {
  if (isObject(value)) {
    const env = (value as JsonObject).env;
    return typeof env === "string" && env !== "" ? env : null;
  }
  if (typeof value === "string") {
    const found = /^\{env:([^}]+)\}$/.exec(strip(value));
    return found ? strip(found[1]!) : null;
  }
  return null;
}

/** Env names a provider entry declares: its env list, its options.apiKey, and the model's own. */
function providerEnvNames(provider: unknown, modelId: string): string[] {
  const names: string[] = [];
  const take = (value: unknown) => {
    if (typeof value === "string" && value !== "" && !names.includes(value)) names.push(value);
  };
  if (!isObject(provider)) return names;
  const entry = provider as JsonObject;
  if (Array.isArray(entry.env)) for (const name of entry.env) take(name);
  if (isObject(entry.options)) take(apiKeyEnv((entry.options as JsonObject).apiKey));
  if (isObject(entry.models)) {
    const model = (entry.models as JsonObject)[modelId];
    if (isObject(model)) {
      if (Array.isArray((model as JsonObject).env)) for (const name of (model as JsonObject).env as unknown[]) take(name);
      if (isObject((model as JsonObject).options)) take(apiKeyEnv(((model as JsonObject).options as JsonObject).apiKey));
    }
  }
  return names;
}

/** Env names the provider needs, from the global and the member's opencode.json files. */
function requiredServiceEnv(provider: string, modelId: string, workspace: string, memberCwd: string): string[] {
  const names: string[] = [];
  for (const file of [join(home(), ".config", "opencode", "opencode.json"), join(workspace, memberCwd, "opencode.json")]) {
    const config = readOpencodeConfig(file);
    const providers = config ? (config as JsonObject).providers : null;
    if (isObject(providers)) {
      for (const name of providerEnvNames((providers as JsonObject)[provider], modelId)) {
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  return names;
}

/** Whether pid's environment holds NAME (name only; the value is never read out). Null when unreadable. */
function serviceEnvHas(pid: number, name: string): boolean | null {
  try {
    const proc = join("/proc", String(pid), "environ");
    if (isFile(proc)) {
      return readText(proc)
        .split("\0")
        .some((entry) => entry.startsWith(`${name}=`));
    }
  } catch {
    // fall through to ps
  }
  if (!which("ps")) return null;
  const done = run(["ps", "eww", "-p", String(pid)], { timeoutMs: 15000 });
  if (done.timedOut || done.code !== 0) return null;
  return new RegExp(`(^|\\s)${name}=`).test(done.stdout + done.stderr);
}

/** Check the OpenCode background service has each opencode member's provider API-key
 * variables before launch. The names come only from opencode.json provider entries
 * (never guessed); `opencode api provider.list` names no variables, so it is not used.
 * Prints one WARN per missing variable (its name only, never its value) and carries on,
 * or one NOTE when the check cannot be done. Only reads; never starts or stops anything. */
function checkOpencodeServiceEnv(members: Member[], workspace: string): void {
  const wanted = new Map<string, string>();
  for (const m of members) {
    if (m.agent !== "opencode" || !m.model) continue;
    const [provider, , modelId] = partition(m.model, "/");
    if (!provider || !modelId) continue;
    for (const name of requiredServiceEnv(provider, modelId, workspace, m.cwd)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      if (!wanted.has(name)) wanted.set(name, provider);
    }
  }
  if (!wanted.size) return;
  const pid = opencodeServicePid();
  if (pid === null) {
    print("NOTE could not check the OpenCode service environment (no service pid found); skipping the API-key check.");
    return;
  }
  if (!isFile(join("/proc", String(pid), "environ")) && !which("ps")) {
    print("NOTE could not check the OpenCode service environment (neither /proc nor ps is available); skipping the API-key check.");
    return;
  }
  for (const [name, provider] of wanted) {
    const has = serviceEnvHas(pid, name);
    if (has === null) {
      print(`NOTE could not check the OpenCode service environment (pid ${pid} is unreadable); skipping the API-key check.`);
      return;
    }
    if (!has) {
      print(
        `WARN the OpenCode background service (pid ${pid}) is missing ${name}, which the ${repr(provider)} provider needs: ` +
          `an opencode member may fail with 'API key is required'. Restart it from a shell that sets it ` +
          `(\`opencode service stop && opencode service start\`), then launch again. Carrying on with the launch.`,
      );
    }
  }
}

export function cmdLaunchHc(
  args: LaunchArgs,
  workspace: string,
  roster: Roster,
  members: Member[],
  tabs: Tab[],
  terminals: { address: string; name: string; cwd: string }[],
  defaultSources: SkillSources,
  problems: string[],
  notes: string[],
  herdrWhy: string | null,
) {
  const squad = String(roster.squad);
  const space = hcSpaceName(squad);
  const byName = new Map(members.map((m) => [m.name, m]));
  const terminalOf = (m: Member): { address: string; name: string; cwd: string } | null => {
    const dir = join(workspace, m.cwd);
    return terminals.find((t) => t.cwd !== "" && t.cwd === dir) ?? null;
  };
  notes.push(
    `old herdr ${herdrWhy ?? "session is not running"}; launching with herdr-core instead: ` +
      `each member opens its own tab in Herdr app space ${space} via \`herdr-app do\` (no parent terminal), notified with \`hcx send\` (untagged; \`hc send\` fallback)`,
  );
  if (!haveApp()) {
    problems.push("the Herdr app CLI (herdr-app) is not on PATH; install it before launching to herdr-core");
  }
  let spaceId: string | null = null;
  const spaces = haveApp() ? appSpaces() : null;
  if (haveApp() && !spaces) {
    problems.push("the Herdr app did not answer (`herdr-app ls` failed); open the Herdr app and launch again");
  }
  if (spaces) spaceId = spaces.get(space) ?? null;
  const rebuild: Member[] = [];
  const retune: Member[] = [];
  for (const m of selected(members, args.member)) {
    const built = builtFor(workspace, m);
    if (!Object.keys(built).length) {
      problems.push(`member ${repr(m.name)} is not built; run \`bun ${SCRIPT} build ${workspace}\` first`);
    } else if (built.agent !== m.agent) rebuild.push(m);
    else if ((built.model ?? null) !== m.model || (built.effort ?? null) !== m.effort) retune.push(m);
    const held = terminalOf(m);
    if (args.member && held) {
      problems.push(
        `member ${repr(m.name)} already runs as hc terminal ${held.address}; stop it (\`hc kill ${held.address}\`) first`,
      );
    }
  }
  if (args.member) {
    if (spaces && !spaceId) {
      problems.push(`no Herdr app space named ${space}; launch the whole squad first`);
    }
  } else if (spaceId) {
    problems.push(
      `the Herdr app already has a space named ${space}; close it in the app to start the whole squad again, ` +
        `or start single members with --member`,
    );
  } else {
    const running = selected(members, null).filter((m) => terminalOf(m));
    if (running.length) {
      problems.push(
        `herdr-core already runs ${running.map((m) => `${repr(m.name)} (${terminalOf(m)!.address})`).join(", ")}; ` +
          `stop each with \`hc kill <terminal>\` to start the whole squad again, or start single members with --member`,
      );
    }
  }
  for (const m of members) {
    if (validSession(m.session) && sessionLive(m.session.runtime, m.session.id)) {
      notes.push(`member ${repr(m.name)}: session ${m.session.runtime}:${m.session.id} is already live`);
    }
  }
  report(notes, problems);
  if (problems.length) {
    print("Nothing was launched.");
    throw new Exit(1);
  }
  const targets = selected(members, args.member);
  checkOpencodeServiceEnv(targets, workspace);
  print(`OK ${targets.length} of ${members.length} members, herdr-core (hc)`);
  for (const e of targets) print(`MEMBER ${e.name}${shown(e)}: ${describe(e)}`);
  for (const line of layoutLines(tabs, byName)) print(line);
  if (rebuild.length || retune.length) {
    if (args.dryRun) {
      for (const m of rebuild) print(`WOULD REBUILD ${m.name} for agent ${m.agent} (instruction file, skills, configuration)`);
      for (const m of retune) print(`WOULD ${settingsChange(m)}`);
    } else {
      const sources = rebuild.length ? skillSourcesOf(roster, defaultSources) : defaultSources;
      for (const m of rebuild) {
        print(`REBUILT ${m.name} (${m.agent}): ` + buildMember(workspace, roster, members, m, sources).join("; "));
      }
      for (const m of retune) {
        writeIdentity(workspace, roster, m);
        agent(m.agent).configure(workspace, join(workspace, m.cwd), m);
        print(settingsChange(m));
      }
      for (const m of members) writeInstructions(workspace, roster, members, m);
    }
  }
  const h = new Hc(args.dryRun);
  const wanted = new Set(targets.map((m) => m.name));
  const launched: [Member, string][] = [];
  let failed: [Member, string | null] | null = null;
  let sid = spaceId;
  try {
    for (const tab of tabs) {
      if (!wanted.has(tab.member)) continue;
      const m = byName.get(tab.member)!;
      failed = [m, null];
      const memberStart = Date.now();
      const dir = join(workspace, m.cwd);
      const label = display(m);
      const { argv, session } = hcMemberArgv(h, m, dir, sessionLabel(m, `${squad}-${m.name}`));
      let terminal: string;
      if (sid === null && !args.member) {
        const opened = h.spaceNew(space, dir, label, argv);
        sid = opened.space;
        terminal = opened.terminal;
      } else if (sid !== null) {
        terminal = h.tabNew(sid, label, dir, argv);
      } else {
        throw new LaunchError(`no Herdr app space named ${space}; launch the whole squad first`);
      }
      failed = [m, terminal];
      launchHcAgent(h, m, dir, terminal, session);
      launched.push([m, terminal]);
      const settings = agent(m.agent).launchSettings
        ? `model ${m.model || "the agent's own default"}, effort ${m.effort || "the agent's own default"}`
        : `model and effort managed by ${agent(m.agent).label}`;
      print(
        `${args.dryRun ? "WOULD LAUNCH" : "LAUNCHED"} ${m.name}${shown(m)} (${m.agent}, ${settings}) ` +
          `in Herdr app space ${space}, tab ${repr(label)} (terminal ${terminal})`,
      );
      recordSession(args, roster, m, dir, h.dryRun ? null : session, memberStart);
    }
  } catch (error) {
    if (!(error instanceof LaunchError) || !failed) throw error;
    const [m, terminal] = failed;
    print(`FAILED ${m.name} (${m.agent}) in Herdr app space ${space} (terminal ${terminal ?? "none yet"}): ${error.message}`);
    const started = new Set(launched.map(([x]) => x.name));
    const runningNow = launched.map(([x, t]) => `${x.name} (terminal ${t})`).join(", ") || "none";
    print(
      `Already running: ${runningNow}. Not started: ` +
        [...byName.keys()].filter((n) => wanted.has(n) && !started.has(n)).join(", ") +
        ". Fix the cause, " +
        (launched.length ? `stop what started with \`hc kill <terminal>\`, then ` : "then ") +
        "launch each member that is not running with --member.",
    );
    throw new Exit(1);
  }
  if (!args.dryRun) {
    print(
      "Find each member's address with `peers list`, " +
        "by its directory. The squad starts working when the lead receives a request through peers.",
    );
  }
  print(`NOTE the members run in Herdr app space ${space}, one tab per member in TAB order, with no parent terminal.`);
}

export function cmdLaunch(args: LaunchArgs, defaultSources: SkillSources) {
  const workspace = args.workspace;
  const roster = loadRoster(workspace);
  const [problems, notes, members] = rosterProblems(workspace, roster, args.overrides, true);
  let session: string | null = null;
  let tabs: Tab[] = [];
  let state: [string | null, Pane[]] = [null, []];
  if (!peersInstalled()) {
    problems.push(`the peers CLI is not installed; run \`bun ${SCRIPT} build ${workspace}\` first, which installs it`);
  }
  if (!agentShellInstalled()) {
    problems.push(`the agent-shell CLI is not installed; run \`bun ${SCRIPT} build ${workspace}\` first, which installs it`);
  }
  let herdrWhy: string | null = null;
  if (members !== null) {
    const [found, why] = herdrSession(args.session);
    session = found;
    herdrWhy = why;
    tabs = planLayout(members);
    if (!session && args.session === null) {
      const terminals = hcTerminals();
      if (terminals !== null) {
        cmdLaunchHc(args, workspace, roster, members, tabs, terminals, defaultSources, problems, notes, herdrWhy);
        return;
      }
      if (why) problems.push(`${why}; no herdr-core terminal either (\`hc ls\` failed: is herdr-core running?)`);
    } else if (!session && why) {
      problems.push(why);
    }
  }
  if (session) state = squadState(new Herdr(session, true), roster);
  let ws = state[0];
  const rebuild: Member[] = [];
  const retune: Member[] = [];
  for (const m of members ? selected(members, args.member) : []) {
    const built = builtFor(workspace, m);
    if (!Object.keys(built).length) {
      problems.push(`member ${repr(m.name)} is not built; run \`bun ${SCRIPT} build ${workspace}\` first`);
    } else if (built.agent !== m.agent) rebuild.push(m);
    else if ((built.model ?? null) !== m.model || (built.effort ?? null) !== m.effort) retune.push(m);
    const held = state[1].filter((pane) => pane.label === display(m)).map((pane) => pane.pane_id);
    if (args.member && held.length) {
      problems.push(
        `member ${repr(m.name)} already has pane ${held[0]} in the squad's workspace ${ws}; stop its ` +
          `session and close the pane (\`herdr --session ${session} pane close ${held[0]}\`) first`,
      );
    }
  }
  if (ws && !args.member) {
    problems.push(
      `herdr session ${session} already holds the squad's workspace ${workspaceLabel(roster)} (${ws}); ` +
        `close it (\`herdr --session ${session} workspace close ${ws}\`) to start the whole squad again, ` +
        "or start single members into it with --member",
    );
  }
  for (const m of members ?? []) {
    if (validSession(m.session) && sessionLive(m.session.runtime, m.session.id)) {
      notes.push(`member ${repr(m.name)}: session ${m.session.runtime}:${m.session.id} is already live`);
    }
  }
  report(notes, problems);
  if (problems.length || !members || !session) {
    print("Nothing was launched.");
    throw new Exit(1);
  }
  const targets = selected(members, args.member);
  const byName = new Map(members.map((m) => [m.name, m]));
  checkOpencodeServiceEnv(targets, workspace);
  print(`OK ${targets.length} of ${members.length} members, herdr session ${session}`);
  for (const e of targets) print(`MEMBER ${e.name}${shown(e)}: ${describe(e)}`);
  for (const line of layoutLines(tabs, byName)) print(line);

  // The agent, model or effort differs from the last build: bring the member's files in line first.
  if (rebuild.length || retune.length) {
    if (args.dryRun) {
      for (const m of rebuild) print(`WOULD REBUILD ${m.name} for agent ${m.agent} (instruction file, skills, configuration)`);
      for (const m of retune) print(`WOULD ${settingsChange(m)}`);
    } else {
      const sources = rebuild.length ? skillSourcesOf(roster, defaultSources) : defaultSources;
      for (const m of rebuild) {
        print(`REBUILT ${m.name} (${m.agent}): ` + buildMember(workspace, roster, members, m, sources).join("; "));
      }
      for (const m of retune) {
        writeIdentity(workspace, roster, m);
        agent(m.agent).configure(workspace, join(workspace, m.cwd), m);
        print(settingsChange(m));
      }
      // Every squad directory shows each member's agent, model and effort.
      for (const m of members) writeInstructions(workspace, roster, members, m);
    }
  }

  const h = new Herdr(session, args.dryRun);
  const wanted = new Set(targets.map((m) => m.name));
  const running = new Map<string, string>();
  for (const name of byName.keys()) {
    for (const pane of state[1]) if (pane.label === display(byName.get(name)!)) running.set(name, pane.pane_id);
  }
  // [member, pane] of each member started; {member: pane} opened but not started; the member being worked on.
  const launched: [Member, string][] = [];
  const waiting = new Map<string, string>();
  let failed: [Member, string | null] | null = null;
  try {
    for (const [step, tab] of tabSteps(tabs, new Set(running.keys()), wanted)) {
      const n = tab.member;
      const m = byName.get(n)!;
      failed = [m, null];
      if (step === "move") {
        moveToEnd(h, m, running.get(n)!);
        print(
          `${args.dryRun ? "WOULD MOVE" : "MOVED"} ${n}${shown(m)} to a new last tab, ` +
            `keeping it running in pane ${running.get(n)}`,
        );
        continue;
      }
      let pane: string;
      const memberStart = Date.now();
      [ws, pane] = openTab(h, roster, workspace, m, ws);
      waiting.set(n, pane);
      failed = [m, pane];
      const spec = agent(m.agent);
      const dir = join(workspace, m.cwd);
      const established = spec.launch(h, m, pane, `${roster.squad}-${n}`, dir);
      waiting.delete(n);
      launched.push([m, pane]);
      const settings = spec.launchSettings
        ? `model ${m.model || "the agent's own default"}, effort ${m.effort || "the agent's own default"}`
        : `model and effort managed by ${spec.label}`;
      print(
        `${args.dryRun ? "WOULD LAUNCH" : "LAUNCHED"} ${n}${shown(m)} (${m.agent}, ${settings}) ` +
          `in herdr session ${session}, tab ${tab.number} ${repr(display(m))}, pane ${pane}`,
      );
      recordSession(args, roster, m, dir, established, memberStart);
    }
  } catch (error) {
    if (!(error instanceof LaunchError) || !failed) throw error;
    const [m, pane] = failed;
    print(
      pane
        ? `FAILED ${m.name} (${m.agent}) in pane ${pane}: ${error.message}`
        : `FAILED opening or moving ${m.name}'s tab: ${error.message}`,
    );
    const started = new Set(launched.map(([x]) => x.name));
    const runningNow = launched.map(([x, p]) => `${x.name} (pane ${p})`).join(", ") || "none";
    const idle = [...waiting].map(([n, p]) => `${n} (pane ${p})`).join(", ");
    const close = [...waiting.values()].map((p) => `\`herdr --session ${session} pane close ${p}\``).join(" ");
    print(
      `Already running: ${runningNow}. Not started: ` +
        [...byName.keys()].filter((n) => wanted.has(n) && !started.has(n)).join(", ") +
        ". Fix the cause, " +
        (waiting.size ? `close the tabs of the members that did not start, ${idle} (${close}), then ` : "then ") +
        "launch each member that is not running with --member; it takes its place in the tab order.",
    );
    throw new Exit(1);
  }
  if (!args.dryRun) {
    print(
      "Find each member's address with `peers list`, " +
        "by its directory. The squad starts working when the lead receives a request through peers.",
    );
  }
}
