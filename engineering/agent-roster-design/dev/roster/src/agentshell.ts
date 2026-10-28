// The agent-shell CLI: where it is, and installing it with its release install script when
// it is missing. Members need no per-agent setup for it: a finished job notifies through one
// `herdr agent prompt` turn, which reaches every member's session.

import { expandUser, fail, isExecutable, join, reason, run, strip, tail, which } from "./core";
import { fetchInstaller, githubToken } from "./peers";

// The agent-shell CLI's install script, which build runs when no agent-shell command is found;
// AGENT_SHELL_INSTALLER_URL names another one, such as a fork's.
export const AGENT_SHELL_INSTALLER = "https://raw.githubusercontent.com/bdsanxz/agent-shell/main/install.sh";

/** Where the install script puts the agent-shell command. */
export function agentShellDir() {
  return process.env.AGENT_SHELL_INSTALL_DIR || expandUser("~/.local/bin");
}

/** The global agent-shell command, by absolute path, so members need no PATH lookup. */
export function agentShellCommand() {
  return which("agent-shell") ?? join(agentShellDir(), "agent-shell");
}

export function agentShellInstalled() {
  return isExecutable(agentShellCommand());
}

export function agentShellInstaller() {
  return process.env.AGENT_SHELL_INSTALLER_URL || AGENT_SHELL_INSTALLER;
}

/** Install the agent-shell CLI with its install script when no agent-shell command is found.
 *
 * Returns the INSTALLED line, or null when agent-shell was already installed. */
export async function installAgentShell() {
  if (agentShellInstalled()) return null;
  const url = agentShellInstaller();
  const byHand = `\`curl -fsSL ${url} | sh\``;
  if (!which("bun")) {
    fail(`the agent-shell CLI is not installed, and it needs bun on PATH to run; install Bun (https://bun.sh), then run build again`);
  }
  const token = githubToken();
  let script: Uint8Array;
  try {
    script = await fetchInstaller(url, token);
  } catch (error) {
    fail(
      `the agent-shell CLI is not installed, and its install script could not be fetched from ${url}: ${reason(error)}. ` +
        "A private repository needs GITHUB_TOKEN or a signed-in GitHub CLI (`gh auth login`). " +
        `Install it by hand with ${byHand}, then run build again`,
    );
  }
  const env = { ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) };
  const done = run(["sh", "-s"], { input: script, env });
  const log = strip(done.stdout + done.stderr);
  if (done.code !== 0 || !agentShellInstalled()) {
    fail(
      `the agent-shell CLI did not install: the install script from ${url} exited ${done.code} and ` +
        `${agentShellCommand()} is not there. Its output:\n${tail(log, 1500)}\n` +
        `Fix the cause, or install it by hand with ${byHand}, then run build again`,
    );
  }
  const version = strip(run([agentShellCommand(), "--version"], { inheritStdin: true }).stdout);
  let line = `INSTALLED ${version || "agent-shell"} at ${agentShellCommand()}`;
  if (!which("agent-shell")) {
    line +=
      `; WARNING ${agentShellDir()} is not on PATH, so members cannot run \`agent-shell\`: add it to PATH in the ` +
      "shell profile, then restart herdr so the members inherit it";
  }
  return line;
}
