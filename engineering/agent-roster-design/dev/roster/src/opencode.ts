// An opencode member's own setup: merge only the loop entry into its
// opencode.json, and place the loop plugin under .opencode/plugins/. The member
// may set anything else in opencode.json; the build keeps every existing key.
// The sidecar finds the OpenCode service itself, so the entry sets only the
// command, ROSTER_LOG and codemode: no URL or password that would rot when the
// service restarts on another port.

import fs from "node:fs";
import {
  type JsonObject,
  OPENCODE_ROSTER_MCP,
  OPENCODE_ROSTER_PLUGIN,
  fail,
  isFile,
  isObject,
  join,
  readText,
} from "./core";
import { mergeJson } from "./peers";

/** The loop plugin's file under a member's .opencode/plugins/. */
export const ROSTER_PLUGIN_FILE = "opencode-roster-plugin.js";

/** Merge the loop sidecar into an opencode member's opencode.json and copy the
 * loop plugin into its .opencode/plugins/. Idempotent: a second run with the
 * same roster writes the same bytes. */
export function configureOpencode(_workspace: string, dir: string) {
  if (!isFile(OPENCODE_ROSTER_MCP)) {
    fail(
      `${OPENCODE_ROSTER_MCP} is missing; build the loop sidecar first (in dev/opencode-roster: bun run build), then build again`,
    );
  }
  if (!isFile(OPENCODE_ROSTER_PLUGIN)) {
    fail(
      `${OPENCODE_ROSTER_PLUGIN} is missing; build the loop plugin first (in dev/opencode-roster: bun run build), then build again`,
    );
  }
  const config = join(dir, "opencode.json");
  mergeJson(config, (data) => {
    if (!isObject(data.mcp)) data.mcp = {};
    const mcp = data.mcp as JsonObject;
    if (!isObject(mcp.servers)) mcp.servers = {};
    const servers = mcp.servers as JsonObject;
    const kept = isObject(servers.roster) ? servers.roster : {};
    const environment = isObject(kept.environment) ? { ...(kept.environment as JsonObject) } : {};
    environment.ROSTER_LOG = join(dir, "logs", "roster.jsonl");
    servers.roster = {
      ...kept,
      type: "local",
      command: [process.execPath, "run", OPENCODE_ROSTER_MCP],
      environment,
      codemode: false,
    };
  });
  const plugin = readText(OPENCODE_ROSTER_PLUGIN);
  const dest = join(dir, ".opencode", "plugins", ROSTER_PLUGIN_FILE);
  if (!isFile(dest) || readText(dest) !== plugin) {
    fs.mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true });
    fs.writeFileSync(dest + ".tmp", plugin);
    fs.renameSync(dest + ".tmp", dest);
  }
  return `merged mcp.servers.roster into ${config} and placed the loop plugin in ${dest}`;
}
