// JSON files merged in place, and the peers CLI: where it is, and installing it when it is missing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type JsonObject,
  dumps,
  expandUser,
  fail,
  isExecutable,
  isFile,
  isObject,
  join,
  parseJsonFile,
  reason,
  run,
  strip,
  tail,
  which,
} from "./core";

// The peers CLI's install script, which build runs when no peers binary is found;
// PEERS_INSTALLER_URL names another one, such as a fork's.
export const PEERS_INSTALLER = "https://raw.githubusercontent.com/bdsanxz/peers/main/install.sh";

/** Update a JSON object file in place: keep what is there, change what update changes. */
export function mergeJson(file: string, update: (data: JsonObject) => void) {
  let data: JsonObject = {};
  if (isFile(file)) {
    const parsed = parseJsonFile(file, "fix or remove it, then build again");
    if (!isObject(parsed)) fail(`${file} must hold a JSON object; fix or remove it, then build again`);
    data = parsed;
  }
  update(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", dumps(data, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
}

/** Where the install script puts the peers binary. */
export function peersDir() {
  return process.env.PEERS_INSTALL_DIR || expandUser("~/.local/bin");
}

/** The global peers binary: one bundled file that runs with Bun, installed by its install script. */
export function peersCommand() {
  return which("peers") ?? join(peersDir(), "peers");
}

export function peersInstalled() {
  return isExecutable(peersCommand());
}

export function peersInstaller() {
  return process.env.PEERS_INSTALLER_URL || PEERS_INSTALLER;
}

/** GITHUB_TOKEN, else the GitHub CLI's token, else nothing: a private peers repository needs one. */
export function githubToken() {
  let token = strip(process.env.GITHUB_TOKEN ?? "");
  if (!token && which("gh")) token = strip(run(["gh", "auth", "token"], { inheritStdin: true }).stdout);
  return token;
}

export async function fetchInstaller(url: string, token: string): Promise<Uint8Array> {
  if (url.startsWith("file:")) return fs.readFileSync(fileURLToPath(url));
  const headers: Record<string, string> = {};
  // The token goes only to GitHub, never to another installer URL.
  if (token && url.startsWith("https://raw.githubusercontent.com/")) headers.Authorization = `Bearer ${token}`;
  const answer = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  if (!answer.ok) throw new Error(`HTTP Error ${answer.status}: ${answer.statusText}`);
  return new Uint8Array(await answer.arrayBuffer());
}

/** Install the peers CLI with its install script when no peers binary is found.
 *
 * Returns the INSTALLED line, or null when peers was already installed. */
export async function installPeers() {
  if (peersInstalled()) return null;
  const url = peersInstaller();
  const byHand = `\`curl -fsSL ${url} | sh\``;
  const token = githubToken();
  let script: Uint8Array;
  try {
    script = await fetchInstaller(url, token);
  } catch (error) {
    fail(
      `the peers CLI is not installed, and its install script could not be fetched from ${url}: ${reason(error)}. ` +
        "A private repository needs GITHUB_TOKEN or a signed-in GitHub CLI (`gh auth login`). " +
        `Install it by hand with ${byHand}, then run build again`,
    );
  }
  const env = { ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) };
  const done = run(["sh", "-s"], { input: script, env });
  const log = strip(done.stdout + done.stderr);
  if (done.code !== 0 || !peersInstalled()) {
    fail(
      `the peers CLI did not install: the install script from ${url} exited ${done.code} and ` +
        `${peersCommand()} is not there. Its output:\n${tail(log, 1500)}\n` +
        `Fix the cause, or install it by hand with ${byHand}, then run build again`,
    );
  }
  const version = strip(run([peersCommand(), "--version"], { inheritStdin: true }).stdout);
  let line = `INSTALLED ${version || "peers"} at ${peersCommand()}`;
  if (!which("peers")) {
    line +=
      `; WARNING ${peersDir()} is not on PATH, so members cannot run \`peers\`: add it to PATH in the ` +
      "shell profile, then restart herdr and the agents' services so they inherit it";
  }
  return line;
}
