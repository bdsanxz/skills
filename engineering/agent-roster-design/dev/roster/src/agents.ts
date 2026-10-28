// Agents. Everything that differs between agents is in AGENTS and the functions it names;
// to add an agent, add an entry and its two functions.

import {
  type JsonObject,
  LaunchError,
  dumps,
  fail,
  isObject,
  join,
  partition,
  repr,
  rpartition,
  run,
  sessionLabel,
  shlexJoin,
  strip,
  tail,
  which,
} from "./core";
import { type Dialog, FIRST_PROMPT, Herdr, WAIT_MS, field, text } from "./herdr";
import { mergeJson, peersCommand, peersKnowsPi, piExtension } from "./peers";
import { agentJobPiExtension, configureAgentJobAgy, configureAgentJobClaude } from "./agentjob";

// Effort levels, lowest first: the levels claude --effort and agy --effort take.
export const LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const DEFAULT_AGENT = "claude";

/** A member with its effective agent, model and effort, and where each came from. */
export type Member = {
  name: string;
  cwd: string;
  summary: string;
  reports_to: string;
  talks_to?: string[];
  skills?: { source: string; skill: string }[];
  display_name?: unknown;
  agent: string;
  agent_from: string;
  model: string | null;
  model_from: string;
  dropped_model: string | null;
  effort: string | null;
  effort_from: string;
  ignored: string[];
};

export type Agent = {
  label: string;
  command: string;
  instructions: string;
  imports: boolean;
  skillsDir: string;
  skillsCli: string;
  modelPattern: RegExp;
  modelHint: string;
  listModels: string[] | null;
  /** The model ids in listModels' output; by default, each line's first word. */
  parseModels?: (output: string) => string[];
  /** Whether launch can set the agent's model and effort level. When it is false, the agent
   * manages both itself, as settingsNote says, and a model or effort set for its members is
   * ignored with a warning. */
  launchSettings: boolean;
  settingsNote?: string;
  dialogs: Dialog[];
  configure: (workspace: string, dir: string, member: Member) => string | null;
  launch: (h: Herdr, member: Member, pane: string, name: string, dir: string) => void;
};

/** Load the peers and agent-job channels at project scope, approved so they start without a prompt,
 * and the agent-job goal hooks. */
function configureClaude(_workspace: string, dir: string) {
  const peers = peersCommand();
  mergeJson(join(dir, ".mcp.json"), (data) => {
    if (!isObject(data.mcpServers)) data.mcpServers = {};
    data.mcpServers.peers = { type: "stdio", command: peers, args: ["channel"], env: {} };
  });
  // Project servers wait for approval unless the project settings enable them.
  mergeJson(join(dir, ".claude", "settings.local.json"), (data) => {
    if (!Array.isArray(data.enabledMcpjsonServers)) data.enabledMcpjsonServers = [];
    if (!data.enabledMcpjsonServers.includes("peers")) data.enabledMcpjsonServers.push("peers");
    const disabled = data.disabledMcpjsonServers;
    if (Array.isArray(disabled) && disabled.includes("peers")) disabled.splice(disabled.indexOf("peers"), 1);
  });
  return (
    `configured the peers channel in ${join(dir, ".mcp.json")} (approved in .claude/settings.local.json); ` +
    configureAgentJobClaude(dir)
  );
}

function configureAgy(_workspace: string, dir: string) {
  return configureAgentJobAgy(dir);
}

/** Muse Code needs no per-member files: its peers notifications arrive through an armed
 * `peers watch`, and agent-job polls its session log, so there is no channel or hook to write. */
function configureMuse() {
  return null;
}

function configureNothing() {
  return null;
}

function launchClaude(h: Herdr, m: Member, pane: string, name: string) {
  const cmd = ["claude", "--dangerously-skip-permissions", "-n", sessionLabel(m, name)];
  if (m.model) cmd.push("--model", m.model);
  if (m.effort) cmd.push("--effort", m.effort);
  // Keep the "--": the channels flag takes several values and would swallow the prompt.
  cmd.push("--dangerously-load-development-channels", "server:peers", "server:agent-job", "--", FIRST_PROMPT);
  h.run(["pane", "run", pane, shlexJoin(cmd)]);
  // Claude asks to trust a new folder, then to confirm the development channel.
  h.run(["pane", "wait-output", pane, "--regex", "Yes, I trust this folder|local development", "--timeout", WAIT_MS]);
  if (h.dryRun || h.text(["pane", "read", pane, "--source", "visible"]).includes("Yes, I trust this folder")) {
    // "No, exit" is preselected; the member cwd is one the roster names.
    h.run(["pane", "send-keys", pane, "down", "enter"], "only when Claude asks to trust the folder");
    h.run(
      ["pane", "wait-output", pane, "--match", "local development", "--timeout", WAIT_MS],
      "only when Claude asked to trust the folder",
    );
  }
  h.run(["pane", "send-keys", pane, "enter"]);
  h.run(["pane", "wait-output", pane, "--match", "inject directly", "--timeout", WAIT_MS]);
}

function launchOpencode(h: Herdr, m: Member, pane: string, name: string, dir: string) {
  // The OpenCode TUI takes no model or effort flag. With a model in the roster, launch
  // creates the member's session, opens the TUI on it, and sets the model, with the
  // effort as its variant, through OpenCode's API before the first prompt. Without
  // one, OpenCode uses its own opencode.json or /models.
  const dialogs = AGENTS.opencode!.dialogs;
  if (!m.model) {
    h.startAgent(name, "opencode", pane, []);
    h.firstPrompt(name, pane, dialogs);
    return;
  }
  const created = h.opencodeApi(dir, "session.create", {}, {
    title: `${sessionLabel(m, name)} (peers squad member)`,
    location: { directory: dir },
  });
  const session = text(field(created, "data"), "id");
  if (!session && !h.dryRun) {
    throw new LaunchError(`\`opencode api session.create\` returned no session id: ${tail(dumps(created), 400)}`);
  }
  h.startAgent(name, "opencode", pane, ["--session", session]);
  h.settle(name, pane);
  const [provider, , modelId] = partition(m.model, "/");
  const model: JsonObject = { providerID: provider, id: modelId, ...(m.effort ? { variant: m.effort } : {}) };
  h.opencodeApi(dir, "session.switchModel", { sessionID: session }, { model });
  // switchModel accepts any name, so read the session back: check validated the model and variant.
  const now = field(field(h.opencodeApi(dir, "session.get", { sessionID: session }), "data"), "model");
  const variant = m.effort || "default";
  const same = now.providerID === provider && now.id === modelId && ((now.variant as string) || "default") === variant;
  if (!h.dryRun && !same) {
    throw new LaunchError(
      `OpenCode session ${session} reports model ${repr(now)}, not ${m.model} with variant ${variant}`,
    );
  }
  h.firstPrompt(name, pane, dialogs);
}

/** A pi member loads the peers extension for pi that the peers CLI holds, so notifications arrive
 * as turns. The extension comes from the CLI, not from a skill, so it always matches the binary. */
function configurePi() {
  if (!peersKnowsPi()) {
    fail(
      `the installed peers CLI (${peersCommand()}) cannot write the peers extension for pi ` +
        "(`peers pi-extension --path`), so a pi member cannot receive notifications; " +
        "update peers (rerun its install script), then build again",
    );
  }
  return (
    "pi loads the peers extension from `peers pi-extension --path` and the agent-job extension from " +
    "`agent-job pi-extension --path` at launch"
  );
}

/** pi --list-models prints a table: provider, model, then more columns. A member may name either form. */
function parsePiModels(output: string) {
  const ids: string[] = [];
  for (const line of output.split(/\r?\n/).slice(1)) {
    const [provider, model] = strip(line).split(/\s+/);
    if (provider && model) ids.push(`${provider}/${model}`, model);
  }
  return ids;
}

function launchPi(h: Herdr, m: Member, pane: string, name: string) {
  // --approve trusts the member's cwd, which the roster made, so pi loads its skills without
  // asking. -e loads the peers and agent-job extensions for this session only, from the files the
  // installed CLIs write, so each matches its binary. pi's --thinking takes every level.
  const args = ["--approve", "-e", piExtension(), "-e", agentJobPiExtension(), "--name", sessionLabel(m, name)];
  if (m.model) args.push("--model", m.model);
  if (m.effort) args.push("--thinking", m.effort);
  h.startAgent(name, "pi", pane, args);
  h.firstPrompt(name, pane, AGENTS.pi!.dialogs);
}

function launchAgy(h: Herdr, m: Member, pane: string, name: string) {
  const args = ["--dangerously-skip-permissions"];
  if (m.model) args.push("--model", m.model);
  if (m.effort) args.push("--effort", m.effort);
  h.startAgent(name, "agy", pane, args, true);
  h.firstPrompt(name, pane, AGENTS.agy!.dialogs);
}

function launchMuse(h: Herdr, m: Member, pane: string, name: string) {
  // Muse peers always run with --yolo: nobody answers a peer's approval prompts, and the member's
  // cwd is trusted so its AGENTS.md and project skills load without asking.
  const args = ["--yolo"];
  if (m.model) args.push("--model", m.model);
  if (m.effort) args.push("--effort", m.effort);
  h.startAgent(name, "muse", pane, args);
  h.firstPrompt(name, pane, AGENTS.muse!.dialogs);
}

export const AGENTS: Record<string, Agent> = {
  claude: {
    label: "Claude Code",
    command: "claude",
    instructions: "CLAUDE.md",
    imports: true,
    skillsDir: join(".claude", "skills"),
    skillsCli: "claude-code",
    modelPattern: /^(default|fable|opus|sonnet|haiku|opusplan)(\[1m\])?$|^claude-[a-z0-9.-]+(\[1m\])?$/,
    modelHint: "an alias (fable, opus, sonnet, haiku) or a full name such as claude-sonnet-5-5",
    listModels: null,
    launchSettings: true,
    dialogs: [],
    configure: configureClaude,
    launch: launchClaude,
  },
  opencode: {
    label: "OpenCode",
    command: "opencode",
    instructions: "AGENTS.md",
    imports: false,
    skillsDir: join(".agents", "skills"),
    skillsCli: "opencode",
    modelPattern: /^[^/\s#]+\/[^\s#]+$/,
    modelHint: "provider/model, as `opencode models` lists it",
    listModels: ["opencode", "models"],
    // The TUI takes neither as a flag: launchOpencode sets both through OpenCode's API.
    launchSettings: true,
    dialogs: [],
    configure: configureNothing,
    launch: launchOpencode,
  },
  agy: {
    label: "Antigravity CLI",
    command: "agy",
    instructions: "AGENTS.md",
    imports: false,
    skillsDir: join(".agents", "skills"),
    skillsCli: "antigravity",
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    modelHint: "a model id from `agy models`",
    listModels: ["agy", "models"],
    launchSettings: true,
    // Shown before agy takes its first prompt: the folder-trust question ("Yes" is
    // preselected) and one-time notices that wait for Esc.
    dialogs: [
      ["trust", ["enter"]],
      ["esc to dismiss", ["esc"]],
    ],
    configure: configureAgy,
    launch: launchAgy,
  },
  pi: {
    label: "pi",
    command: "pi",
    instructions: "AGENTS.md",
    imports: false,
    skillsDir: join(".agents", "skills"),
    skillsCli: "pi",
    modelPattern: /^([A-Za-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*$/,
    modelHint: "provider/model or model, as `pi --list-models` lists it, such as anthropic/claude-opus-4-8",
    listModels: ["pi", "--list-models"],
    parseModels: parsePiModels,
    launchSettings: true,
    dialogs: [],
    configure: configurePi,
    launch: launchPi,
  },
  muse: {
    label: "Muse Code",
    command: "muse",
    instructions: "AGENTS.md",
    imports: false,
    skillsDir: join(".agents", "skills"),
    // The skills CLI names no muse agent yet; opencode writes the same shared
    // .agents/skills directory, which Muse Code reads as its project skills.
    skillsCli: "opencode",
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    modelHint: "a Muse Code model id such as muse-spark-1.3",
    listModels: null,
    launchSettings: true,
    dialogs: [],
    configure: configureMuse,
    launch: launchMuse,
  },
};
// Older rosters name the agent in "runtime", and agy as "antigravity".
export const LEGACY_AGENTS: Record<string, string> = { antigravity: "agy" };

export function isAgent(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(AGENTS, value);
}

export function isLevel(value: unknown): value is string {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function agent(name: string): Agent {
  return AGENTS[name]!;
}

type Listed<T> = [T, null] | [null, string | null];

// What each agent's CLI lists, asked once per run.
const modelLists = new Map<string, Listed<Set<string>>>();
const variantLists = new Map<string, Listed<Map<string, string[]>>>();

export function forgetLists() {
  modelLists.clear();
  variantLists.clear();
}

/** [set of model ids, null], or [null, why they cannot be listed]; [null, null] when the agent lists none. */
export function availableModels(name: string): Listed<Set<string>> {
  const cmd = agent(name).listModels;
  if (!cmd) return [null, null];
  if (!modelLists.has(name)) {
    if (!which(cmd[0]!)) {
      modelLists.set(name, [null, `\`${cmd[0]}\` is not on PATH`]);
    } else {
      const done = run(cmd, { timeoutMs: 120000 });
      const parse = agent(name).parseModels;
      const ids = new Set(
        parse
          ? parse(done.stdout)
          : done.stdout
              .split(/\r?\n/)
              .filter((line) => strip(line) && !line.startsWith("Fetching"))
              .map((line) => strip(line).split(/\s+/)[0]!),
      );
      if (done.timedOut) modelLists.set(name, [null, `\`${cmd.join(" ")}\` timed out`]);
      else if (done.code === 0 && ids.size) modelLists.set(name, [ids, null]);
      else modelLists.set(name, [null, `\`${cmd.join(" ")}\` failed: ${tail(strip(done.stderr || done.stdout), 300)}`]);
    }
  }
  return modelLists.get(name)!;
}

/** [{provider/model: [variant, ...]}, null], or [null, why they cannot be listed]. */
export function opencodeVariants(): Listed<Map<string, string[]>> {
  if (!variantLists.has("all")) {
    const cmd = ["opencode", "api", "model.list"];
    const why = `\`${cmd.join(" ")}\` printed no model list; is OpenCode's background service running (\`opencode service status\`)?`;
    if (!which("opencode")) {
      variantLists.set("all", [null, "`opencode` is not on PATH"]);
    } else {
      const done = run(cmd, { timeoutMs: 120000 });
      variantLists.set("all", done.timedOut ? [null, why] : parseVariants(done.stdout, why));
    }
  }
  return variantLists.get("all")!;
}

function parseVariants(output: string, why: string): Listed<Map<string, string[]>> {
  try {
    const data = (JSON.parse(output) as JsonObject).data;
    if (!Array.isArray(data)) return [null, why];
    const variants = new Map<string, string[]>();
    for (const model of data) {
      if (!isObject(model) || !("providerID" in model) || !("id" in model)) return [null, why];
      const listed = model.variants;
      if (listed && !Array.isArray(listed)) return [null, why];
      const ids: string[] = [];
      for (const variant of Array.isArray(listed) ? listed : []) {
        if (isObject(variant)) {
          if (!("id" in variant)) return [null, why];
          ids.push(String(variant.id));
        } else ids.push(String(variant));
      }
      variants.set(`${model.providerID}/${model.id}`, ids);
    }
    return [variants, null];
  } catch {
    return [null, why];
  }
}

/** [levels the member's agent and model support, null], or [null, why they cannot be known]. */
export function effortLevels(member: { agent: string; model: string | null }): Listed<Set<string>> {
  // claude --effort takes every level for every model; pi --thinking and muse --effort too.
  if (member.agent === "claude" || member.agent === "pi" || member.agent === "muse") return [new Set(LEVELS), null];
  if (!member.model) {
    return [
      null,
      `${member.agent} needs a model to check an effort level against; set the member's model, or leave the effort out`,
    ];
  }
  if (member.agent === "opencode") {
    const [variants, why] = opencodeVariants();
    if (!variants) return [null, why];
    return [new Set((variants.get(member.model) ?? []).filter(isLevel)), null];
  }
  const [ids, why] = availableModels("agy");
  if (!ids) return [null, why];
  // agy lists one id per model and level, such as gemini-3.8-flash-low. The base name
  // takes any of its levels through --effort; a full id takes only its own level.
  const families = new Map<string, Set<string>>();
  for (const id of ids) {
    const [base, , level] = rpartition(id, "-");
    if (base && isLevel(level)) {
      if (!families.has(base)) families.set(base, new Set());
      families.get(base)!.add(level);
    }
  }
  if (families.has(member.model)) return [families.get(member.model)!, null];
  const [base, , level] = rpartition(member.model, "-");
  return [families.has(base) && isLevel(level) ? new Set([level]) : new Set(), null];
}

/** The supported level closest to level, the lower one on a tie. */
export function nearest(level: string, supported: Set<string>) {
  const at = LEVELS.indexOf(level as (typeof LEVELS)[number]);
  return [...LEVELS]
    .filter((candidate) => supported.has(candidate))
    .sort((a, b) => Math.abs(LEVELS.indexOf(a) - at) - Math.abs(LEVELS.indexOf(b) - at) || LEVELS.indexOf(a) - LEVELS.indexOf(b))[0]!;
}
