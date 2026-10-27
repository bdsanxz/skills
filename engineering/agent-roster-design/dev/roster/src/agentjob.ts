// The agent-job CLI: where it is, installing it with its release install script when it is missing,
// and the setup that lets each member receive crons and goals (the Claude channel and hooks, agy
// hooks, the pi extension).

import { expandUser, fail, isExecutable, isFile, isObject, join, reason, run, strip, tail, which } from "./core";
import { fetchInstaller, githubToken, mergeJson } from "./peers";

// The agent-job CLI's install script, which build runs when no agent-job command is found;
// AGENT_JOB_INSTALLER_URL names another one, such as a fork's.
export const AGENT_JOB_INSTALLER = "https://raw.githubusercontent.com/bdsanxz/agent-job/main/install.sh";

/** Where the install script puts the agent-job command. */
export function agentJobDir() {
  return process.env.AGENT_JOB_INSTALL_DIR || expandUser("~/.local/bin");
}

/** The global agent-job command, by absolute path, so hooks and channels need no PATH lookup. */
export function agentJobCommand() {
  return which("agent-job") ?? join(agentJobDir(), "agent-job");
}

export function agentJobInstalled() {
  return isExecutable(agentJobCommand());
}

export function agentJobInstaller() {
  return process.env.AGENT_JOB_INSTALLER_URL || AGENT_JOB_INSTALLER;
}

/** Install the agent-job CLI with its install script when no agent-job command is found.
 *
 * Returns the INSTALLED line, or null when agent-job was already installed. */
export async function installAgentJob() {
  if (agentJobInstalled()) return null;
  const url = agentJobInstaller();
  const byHand = `\`curl -fsSL ${url} | sh\``;
  if (!which("bun")) {
    fail(`the agent-job CLI is not installed, and it needs bun on PATH to run; install Bun (https://bun.sh), then run build again`);
  }
  const token = githubToken();
  let script: Uint8Array;
  try {
    script = await fetchInstaller(url, token);
  } catch (error) {
    fail(
      `the agent-job CLI is not installed, and its install script could not be fetched from ${url}: ${reason(error)}. ` +
        "A private repository needs GITHUB_TOKEN or a signed-in GitHub CLI (`gh auth login`). " +
        `Install it by hand with ${byHand}, then run build again`,
    );
  }
  const env = { ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) };
  const done = run(["sh", "-s"], { input: script, env });
  const log = strip(done.stdout + done.stderr);
  if (done.code !== 0 || !agentJobInstalled()) {
    fail(
      `the agent-job CLI did not install: the install script from ${url} exited ${done.code} and ` +
        `${agentJobCommand()} is not there. Its output:\n${tail(log, 1500)}\n` +
        `Fix the cause, or install it by hand with ${byHand}, then run build again`,
    );
  }
  const version = strip(run([agentJobCommand(), "--version"], { inheritStdin: true }).stdout);
  let line = `INSTALLED ${version || "agent-job"} at ${agentJobCommand()}`;
  if (!which("agent-job")) {
    line +=
      `; WARNING ${agentJobDir()} is not on PATH, so members cannot run \`agent-job\`: add it to PATH in the ` +
      "shell profile, then restart herdr so the members inherit it";
  }
  return line;
}

const CLAUDE_HOOK = "goal hook claude";
const AGY_HOOK_GROUP = "agent-job-goal";

/** Put the agent-job hook into one Claude Code hook event: drop any earlier agent-job hook, which
 * may run another path, keep every other hook, then add the current one. */
function addClaudeHook(hooks: Record<string, unknown>, event: string, entry: Record<string, unknown>) {
  const ours = (h: unknown) => isObject(h) && typeof h.command === "string" && h.command.includes(CLAUDE_HOOK);
  const list: unknown[] = [];
  for (const group of Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      list.push(group);
      continue;
    }
    const kept = group.hooks.filter((h) => !ours(h));
    if (kept.length) list.push({ ...group, hooks: kept });
  }
  list.push(entry);
  hooks[event] = list;
}

/** Claude Code: the agent-job channel in .mcp.json, approved, and the goal hooks in the project's
 * .claude/settings.local.json. */
export function configureAgentJobClaude(dir: string) {
  const cmd = agentJobCommand();
  mergeJson(join(dir, ".mcp.json"), (data) => {
    if (!isObject(data.mcpServers)) data.mcpServers = {};
    data.mcpServers["agent-job"] = { type: "stdio", command: process.execPath, args: [cmd, "channel"], env: {} };
  });
  const hook = { type: "command", command: `${cmd} ${CLAUDE_HOOK}` };
  mergeJson(join(dir, ".claude", "settings.local.json"), (data) => {
    if (!Array.isArray(data.enabledMcpjsonServers)) data.enabledMcpjsonServers = [];
    if (!data.enabledMcpjsonServers.includes("agent-job")) data.enabledMcpjsonServers.push("agent-job");
    const disabled = data.disabledMcpjsonServers;
    if (Array.isArray(disabled) && disabled.includes("agent-job")) disabled.splice(disabled.indexOf("agent-job"), 1);
    if (!isObject(data.hooks)) data.hooks = {};
    addClaudeHook(data.hooks, "Stop", { hooks: [hook] });
    addClaudeHook(data.hooks, "SessionStart", { matcher: "compact|resume", hooks: [hook] });
  });
  return `configured the agent-job channel in ${join(dir, ".mcp.json")} and its goal hooks in .claude/settings.local.json`;
}

/** Antigravity: the goal hooks in the workspace's .agents/hooks.json. */
export function configureAgentJobAgy(dir: string) {
  const cmd = agentJobCommand();
  const file = join(dir, ".agents", "hooks.json");
  mergeJson(file, (data) => {
    data[AGY_HOOK_GROUP] = {
      PreInvocation: [{ type: "command", command: `${cmd} goal hook antigravity PreInvocation` }],
      Stop: [{ type: "command", command: `${cmd} goal hook antigravity Stop` }],
    };
  });
  return `configured the agent-job goal hooks in ${file}`;
}

/** The file that holds the agent-job extension for pi, written by the installed agent-job itself, so
 * that the extension always calls that command. */
export function agentJobPiExtension() {
  const done = run([agentJobCommand(), "pi-extension", "--path"], { inheritStdin: true });
  const file = strip(done.stdout);
  if (done.code !== 0 || !isFile(file)) {
    fail(
      `\`${agentJobCommand()} pi-extension --path\` did not write the agent-job extension for pi: ` +
        `${strip(tail(done.stdout + done.stderr, 500)) || `exit ${done.code}`}; update agent-job (rerun its install script), then try again`,
    );
  }
  return file;
}
