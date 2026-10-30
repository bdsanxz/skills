// What the tests share: stubs of every CLI the script runs, a squad workspace, and main() run
// in this process with its output captured. Nothing leaves the machine or touches a real squad.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/commands";
import { io } from "../src/core";

/** npx (the skills CLI): installs a stub SKILL.md, fails for "broken", installs nothing for "silent".
 */
const NPX = `#!/bin/bash
# npx -y skills@latest add SOURCE -a AGENT -y --copy --skill NAME...
echo "$PWD: $*" >>"$NPX_LOG"
src=$4 agent= skills=()
shift 4
while [ $# -gt 0 ]; do
  case "$1" in
    -a) agent=$2; shift ;;
    --skill) skills+=("$2"); shift ;;
  esac; shift
done
[ "$agent" = claude-code ] && dir=.claude/skills || dir=.agents/skills
for s in "\${skills[@]}"; do
  [ "$s" = broken ] && { echo "No matching skills found for: broken"; exit 1; }
  [ "$s" = silent ] && continue
  mkdir -p "$dir/$s" && echo "from $src" >"$dir/$s/SKILL.md"
done
`;

const CLAUDE = `#!/bin/bash
if [ "$1 $2" = "agents --json" ]; then cat "$HOME/claude-agents.json" 2>/dev/null || echo '[]'; exit 0; fi
echo "unexpected claude call: $*" >&2; exit 9
`;

/** opencode: lists models and variants, and answers the session API calls launch makes.
 * Its calls also go to HERDR_LOG, to check their order against the herdr calls.
 * OC_WRONG_MODEL=1 makes session.get and session.list report another model.
 * OC_GET_FAIL=1 makes session.get fail like OpenCode 2.0.29 with a body on GET.
 * OC_LIST_FAIL=1 makes session.list fail the same way. */
const OPENCODE = `#!/bin/bash
echo "$*" >>"$OPENCODE_LOG"; echo "opencode $*" >>"$HERDR_LOG"
case "$*" in
  models) printf 'opencode/big-pickle\\nopencode/beam-free\\n' ;;
  "api model.list") echo '{"data":[{"providerID":"opencode","id":"big-pickle","variants":[]},
    {"providerID":"opencode","id":"beam-free","variants":[{"id":"none"},{"id":"low"},{"id":"medium"},{"id":"high"},{"id":"xhigh"},{"id":"max"}]}]}' ;;
  "api session.create"*) echo "{\\"data\\":{\\"id\\":\\"ses_test1\\",\\"cwd\\":\\"$PWD\\"}}" ;;
  "api session.switchModel"*) m=\${@: -1}; m=\${m#\\{\\"model\\": }; echo "\${m%\\}}" >"$OPENCODE_LOG.model" ;;
  "api session.get"*)
    [ "\${OC_GET_FAIL:-}" = 1 ] && { echo "UnknownError: TypeError: fetch() request with GET/HEAD method cannot have body." >&2; exit 1; }
    [ "\${OC_WRONG_MODEL:-}" = 1 ] && { echo '{"data":{"model":{"providerID":"opencode","id":"other"}}}'; exit 0; }
    echo "{\\"data\\":{\\"id\\":\\"ses_test1\\",\\"model\\":$(cat "$OPENCODE_LOG.model")}}" ;;
  "api session.list")
    [ "\${OC_LIST_FAIL:-}" = 1 ] && { echo "UnknownError: TypeError: fetch() request with GET/HEAD method cannot have body." >&2; exit 1; }
    [ "\${OC_WRONG_MODEL:-}" = 1 ] && { echo '{"data":[{"id":"ses_test1","model":{"providerID":"opencode","id":"other"}}]}'; exit 0; }
    echo "{\\"data\\":[{\\"id\\":\\"ses_test1\\",\\"model\\":$(cat "$OPENCODE_LOG.model")}]}" ;;
  "api get /api/session") cat "$HOME/opencode-sessions.json" 2>/dev/null || echo '{"data":[]}' ;;
  *) echo "unexpected opencode call: $*" >&2; exit 9 ;;
esac
`;

const AGY = `#!/bin/bash
[ "$*" = models ] && printf 'Fetching available models...\\ngem-fast\\tGem Fast\\ngem-pro\\tGem Pro\\ngem-flash-low\\tGem Flash (Low)\\ngem-flash-high\\tGem Flash (High)\\n' && exit 0
echo "unexpected agy call: $*" >&2; exit 9
`;

/** pi: lists its models as pi --list-models does: a header, then provider and model columns. */
const PI = `#!/bin/bash
[ "$*" = --list-models ] && printf 'provider   model            context  max-out  thinking  images\\nanthropic  claude-opus-4-8  1M       128K     yes       yes\\nopenai     gpt-5            400K     128K     yes       yes\\n' && exit 0
echo "unexpected pi call: $*" >&2; exit 9
`;

/** muse: present so launch finds its command; no listable models, like claude. */
const MUSE = `#!/bin/bash
echo "unexpected muse call: $*" >&2; exit 9
`;

/** herdr: logs every call; answers like herdr does. HERDR_SESSIONS sets \`session list\`,
 * HERDR_WORKSPACES \`workspace list\`, HERDR_PANES the panes \`pane list\` shows,
 * HERDR_TAB_BASE where the ids of new tabs and their panes start,
 * HERDR_FAIL_TAB=1 fails the first tab create. agy blocks its first prompt on the trust
 * question, then on an Esc notice; HERDR_ODD_DIALOG=1 shows a dialog launch does not know. */
const HERDR = `#!/bin/bash
echo "$*" >>"$HERDR_LOG"
[ "$1" = --session ] && shift 2
case "$1 $2" in
  "session list") running='{"sessions":[{"name":"default","default":true,"running":true}]}'
                  echo "\${HERDR_SESSIONS:-$running}" ;;
  "workspace create") echo '{"result":{"workspace":{"workspace_id":"w9"},"tab":{"tab_id":"w9:t1"},"root_pane":{"pane_id":"w9:p1"}}}' ;;
  "workspace list") none='{"result":{"workspaces":[]}}'; echo "\${HERDR_WORKSPACES:-$none}" ;;
  "tab create") [ "\${HERDR_FAIL_TAB:-}" = 1 ] && { echo '{"error":"tab_create_failed"}'; exit 1; }
                n=$(($(grep -c "tab create" "$HERDR_LOG")+\${HERDR_TAB_BASE:-1}))
                echo "{\\"result\\":{\\"tab\\":{\\"tab_id\\":\\"w9:t$n\\"},\\"root_pane\\":{\\"pane_id\\":\\"w9:p$n\\"}}}" ;;
  "pane list") echo "{\\"result\\":{\\"panes\\":[\${HERDR_PANES:-}]}}" ;;
  "pane move") n=$(($(grep -c "pane move" "$HERDR_LOG")+50))
               echo "{\\"result\\":{\\"move_result\\":{\\"changed\\":true,\\"created_tab\\":{\\"tab_id\\":\\"w9:t$n\\"}}}}" ;;
  "pane read") echo 'Quick safety check ... Yes, I trust this folder' ;;
  "agent start")
    if [ "$5" = opencode ] && ! grep -q busy-once "$HERDR_LOG"; then
      echo busy-once >>"$HERDR_LOG"; echo '{"error":{"code":"agent_pane_busy"}}'; exit 1
    fi
    [ "$5" = agy ] && { echo '{"error":{"code":"agent_not_ready"}}'; exit 1; }
    echo '{"result":{}}' ;;
  "agent prompt")
    [ "$3" = demo-docs ] || { echo '{"result":{}}'; exit 0; }
    case "$(grep -c 'agent send-keys demo-docs' "$HERDR_LOG")" in
      0|1) echo '{"error":{"code":"agent_blocked"}}'; exit 1 ;;
      *) echo '{"result":{}}' ;;
    esac ;;
  "agent read")
    [ "\${HERDR_ODD_DIALOG:-}" = 1 ] && { echo 'Pick a color theme: > Dark'; exit 0; }
    case "$(grep -c 'agent send-keys demo-docs' "$HERDR_LOG")" in
      0) echo 'Do you trust this folder? > Yes' ;;
      *) echo 'Verbosity now defaults to medium (esc to dismiss)' ;;
    esac ;;
  *) echo '{"result":{}}' ;;
esac
`;

/** peers: prints its version, and writes the peers extension for pi with pi-extension --path.
 * PEERS_OLD=1 makes it a version without pi support. */
const PEERS = `#!/bin/sh
if [ "$1" = pi-extension ]; then
  [ "\${PEERS_OLD:-}" = 1 ] && { echo "error: unrecognized subcommand 'pi-extension'" >&2; exit 2; }
  case "$2" in
    --help) echo '      --path  Write the extension to the peers cache and print the file path instead' ;;
    --path) f="$PEERS_CACHE/pi-extension/peers.ts"
            mkdir -p "$(dirname "$f")" && echo '// peers extension: spawns peers _pi-listen' >"$f" && echo "$f" ;;
    *) echo '// peers extension: spawns peers _pi-listen' ;;
  esac
  exit 0
fi
echo peers 0.0.1
`;

/** agent-job: prints its version, and writes the agent-job extension for pi with pi-extension --path. */
const AGENT_JOB = `#!/bin/sh
case "$1" in
  --version) echo "agent-job 0.0.1" ;;
  pi-extension) f="$AGENT_JOB_HOME/pi-extension.ts"
                mkdir -p "$AGENT_JOB_HOME" && echo '// agent-job extension: spawns agent-job watch' >"$f" && echo "$f" ;;
  *) echo "unexpected agent-job call: $*" >&2; exit 9 ;;
esac
`;

/** agent-shell: prints its version. */
const AGENT_SHELL = `#!/bin/sh
case "$1" in
  --version) echo "agent-shell 0.0.1" ;;
  *) echo "unexpected agent-shell call: $*" >&2; exit 9 ;;
esac
`;

/** herdr-app: logs every call; HCAPP_JSON sets the `ls` spaces, HCAPP_LS_CODE=1
 * makes it fail. space.new and tab.new report fixed test terminals. */
const HCAPP = `#!/bin/bash
echo "$*" >>"$HCAPP_LOG"
if [ "$1 $2" = "do space.new" ]; then printf '{"space":"sp-test","tab":"tb-test1","terminal":"t-test1"}'; exit 0; fi
if [ "$1 $2" = "do tab.new" ]; then printf '{"space":"sp-test","tab":"tb-test2","terminal":"t-test2"}'; exit 0; fi
if [ "$1" = ls ]; then if [ -n "\${HCAPP_JSON:-}" ]; then printf '%s' "$HCAPP_JSON"; else printf '{"spaces":[]}'; fi; exit \${HCAPP_LS_CODE:-0}; fi
echo "unexpected herdr-app call: $*" >&2; exit 9
`;

/** hc: logs every call; HC_LS_CODE=0 with HC_JSON makes `hc ls --json` list a
 * live core, otherwise it fails and the old herdr path stays in charge. */
const HC = `#!/bin/bash
echo "$*" >>"$HC_LOG"
if [ "$1" = ls ]; then
  [ "\${HC_LS_CODE:-1}" != 0 ] && exit 1
  if [ -n "\${HC_JSON:-}" ]; then printf '%s' "$HC_JSON"; else printf '{"terminals":[]}'; fi
  exit 0
fi
if [ "$1" = run ]; then echo '{"address":"t99","name":"hc-test"}'; exit 0; fi
if [ "$1" = wait ]; then exit 0; fi
if [ "$1" = read ]; then exit 0; fi
if [ "$1" = send ]; then exit 0; fi
if [ "$1" = keys ]; then exit 0; fi
echo "unexpected hc call: $*" >&2; exit 9
`;

/** hcx: logs every call; HCX_FAIL=1 makes `hcx send` fail, so launch falls back to `hc send`. */
const HCX = `#!/bin/bash
echo "$*" >>"$HCX_LOG"
if [ "$1" = send ]; then
  [ "\${HCX_FAIL:-}" = 1 ] && { echo "hcx send failed" >&2; exit 1; }
  exit 0
fi
echo "unexpected hcx call: $*" >&2; exit 9
`;

/** The agent-job install script build fetches; INSTALLER_FAIL=1 makes it fail. */
export const AGENT_JOB_INSTALLER = `[ "\${INSTALLER_FAIL:-}" = 1 ] && { echo "agent-job-install: error: no release" >&2; exit 1; }
dir="\${AGENT_JOB_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir" && printf '#!/bin/sh\\necho agent-job 0.0.1\\n' >"$dir/agent-job" && chmod +x "$dir/agent-job"
`;

/** The agent-shell install script build fetches; INSTALLER_FAIL=1 makes it fail. */
export const AGENT_SHELL_INSTALLER = `[ "\${INSTALLER_FAIL:-}" = 1 ] && { echo "agent-shell-install: error: no release" >&2; exit 1; }
dir="\${AGENT_SHELL_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir" && printf '#!/bin/sh\\necho agent-shell 0.0.1\\n' >"$dir/agent-shell" && chmod +x "$dir/agent-shell"
`;

/** The peers install script build fetches; INSTALLER_FAIL=1 makes it fail. */
export const INSTALLER = `[ "\${INSTALLER_FAIL:-}" = 1 ] && { echo "peers-install: error: no release" >&2; exit 1; }
dir="\${PEERS_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir" && printf '#!/bin/sh\\necho peers 0.0.1\\n' >"$dir/peers" && chmod +x "$dir/peers"
`;

export type Squad = {
  tmp: string;
  bin: string;
  w: string;
  npxLog: string;
  herdrLog: string;
  opencodeLog: string;
  hcLog: string;
  hcxLog: string;
  hcappLog: string;
};

const STUBS: Record<string, string> = { npx: NPX, claude: CLAUDE, opencode: OPENCODE, agy: AGY, pi: PI, muse: MUSE, herdr: HERDR, hc: HC, hcx: HCX, "herdr-app": HCAPP, peers: PEERS, "agent-job": AGENT_JOB, "agent-shell": AGENT_SHELL };
let savedEnv: Record<string, string | undefined> = {};

/** A fresh temporary directory with the stubs first on PATH, and an empty workspace. */
export function setUp(): Squad {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "roster-test-")));
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  for (const [name, script] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  const squad = {
    tmp,
    bin,
    w: path.join(tmp, "squad"),
    npxLog: path.join(tmp, "npx.log"),
    herdrLog: path.join(tmp, "herdr.log"),
    opencodeLog: path.join(tmp, "opencode.log"),
    hcLog: path.join(tmp, "hc.log"),
    hcxLog: path.join(tmp, "hcx.log"),
    hcappLog: path.join(tmp, "hcapp.log"),
  };
  fs.mkdirSync(squad.w);
  savedEnv = { ...process.env };
  Object.assign(process.env, {
    PATH: `${bin}:${process.env.PATH}`,
    NPX_LOG: squad.npxLog,
    HERDR_LOG: squad.herdrLog,
    OPENCODE_LOG: squad.opencodeLog,
    HC_LOG: squad.hcLog,
    HCX_LOG: squad.hcxLog,
    HCAPP_LOG: squad.hcappLog,
    PEERS_CACHE: path.join(tmp, "cache"),
    AGENT_JOB_INSTALL_DIR: path.join(tmp, "agent-job-bin"),
    AGENT_JOB_HOME: path.join(tmp, "agent-job-home"),
  });
  return squad;
}

export function tearDown(squad: Squad) {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  fs.rmSync(squad.tmp, { recursive: true, force: true });
}

export type Result = { code: number; out: string; stdout: string; stderr: string };

/** Run main() with these arguments, and with env set (undefined removes a variable) for the run only. */
export async function roster(args: string[], env: Record<string, string | undefined> = {}): Promise<Result> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const [out, err] = [io.out, io.err];
  const before: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    before[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  io.out = (text) => void stdout.push(text + "\n");
  io.err = (text) => void stderr.push(text + "\n");
  try {
    const code = await main(args);
    return { code, out: stdout.join("") + stderr.join(""), stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    [io.out, io.err] = [out, err];
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

export function exists(file: string) {
  return fs.existsSync(file);
}

export function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A member's four files; its COMMUNICATIONS.md says the given text. */
export function member(squad: Squad, name: string, communications: string) {
  const dir = path.join(squad.w, name);
  write(path.join(dir, "PROJECT.md"), "# Project\n\nRepository: https://example.com/r.git (checkout: ./r)\n");
  write(path.join(dir, "ROLE.md"), `# Role\n\nYou are ${name}.\n`);
  write(path.join(dir, "COMMUNICATIONS.md"), `# Communications\n\n${communications}\n`);
  write(path.join(dir, "MEMORY.md"), "# Memory\n");
}

export type MemberData = Record<string, unknown>;
export type RosterData = {
  squad: string;
  goal: string;
  defaults?: { agent?: string; models?: Record<string, string>; effort?: string };
  members: MemberData[];
  peers_source?: string;
};

export function setRoster(squad: Squad, data: RosterData | string) {
  write(path.join(squad.w, "roster.json"), typeof data === "string" ? data : JSON.stringify(data));
}

/** Change roster.json in place. */
export function edit(squad: Squad, change: (roster: RosterData) => void) {
  const file = path.join(squad.w, "roster.json");
  const data = JSON.parse(read(file)) as RosterData;
  change(data);
  write(file, JSON.stringify(data));
}

export function clear(file: string) {
  fs.writeFileSync(file, "");
}

/** A directory of links to some of the stubs, for a PATH without the others. */
export function partialBin(squad: Squad, name: string, tools: string[]) {
  const dir = path.join(squad.tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const tool of tools) {
    const link = path.join(dir, tool);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(squad.bin, tool), link);
  }
  return dir;
}
