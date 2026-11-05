// figma-access: drive Figma Desktop from the shell through the Desktop Bridge plugin.
//
// A small daemon listens on the first free port in 9223-9232, where the Desktop Bridge
// plugin looks for a server (HTTP /health, then a WebSocket). Every CLI command talks to
// that daemon over a token-protected local HTTP endpoint, and the daemon relays the
// command to the plugin running in the chosen Figma file.

import "./runtime";
import * as commands from "./commands";
import { EXIT_USAGE, VERSION } from "./config";
import { runDaemon } from "./daemon";
import * as restApi from "./rest";
import { spec } from "./spec";
import { compare } from "./compare";
import { showHelp } from "./help";
import { fail } from "./util";

const table: Record<string, (argv: string[]) => unknown> = {
  setup: commands.setup,
  status: commands.status,
  files: commands.files,
  daemon: commands.daemon,
  exec: commands.exec,
  screenshot: commands.screenshot,
  selection: commands.selection,
  logs: commands.logs,
  changes: commands.changes,
  call: commands.call,
  methods: commands.methods,
  file: restApi.file,
  node: restApi.node,
  spec,
  render: restApi.render,
  "image-fills": restApi.imageFills,
  api: restApi.api,
  compare,
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "__daemon") {
  await runDaemon();
} else if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  showHelp(rest[0] ?? "main");
} else if (cmd === "--version" || cmd === "-v") {
  process.stdout.write(VERSION + "\n");
} else {
  const run = table[cmd];
  if (!run) fail(EXIT_USAGE, `Unknown command "${cmd}". Run \`figma-access --help\`.`);
  await run(rest);
}
