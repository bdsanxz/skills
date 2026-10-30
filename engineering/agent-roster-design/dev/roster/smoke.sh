#!/bin/bash
# Offline smoke test for scripts/roster.js (built from src/ with `bun run build`): stubs npx (the skills CLI), the
# claude, opencode and agy CLIs and herdr, and checks roster validation, agent,
# model and effort selection, assembly, skill installs, the Claude channel and launch.
set -u
usage() {
  cat <<'EOF'
Offline smoke test for scripts/roster.js, the file `bun run build` makes from src/.

Usage: smoke.sh [-h|--help]

Runs every check against stubs of npx (the skills CLI), the claude, opencode
and agy CLIs and herdr, in a temporary directory that is removed afterwards.
It changes no real session, herdr workspace or squad. Checks: roster
validation, agent, model and effort selection with defaults and overrides,
the effort mapping and fallback per agent, opencode's model and effort set
through OpenCode's API at launch, the reusable "no launch settings" path,
assembly,
skill installs, the Claude channel, and launch for every agent.

Output: one `ok <name>` or `FAIL <name>: <output>` line per check, then
`all passed` or `<n> failed`.
Exit codes: 0 when every check passes, 1 when any fails, 2 on a usage error.

Example:
  bash smoke.sh
EOF
}
case "${1-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) echo "smoke.sh: error: unexpected argument '$1'" >&2
     echo "Run \`smoke.sh --help\` for usage." >&2; exit 2 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../../scripts/roster.js"
BUN=$(command -v bun)
PY=$(command -v python3)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat >"$TMP/bin/npx" <<'EOF'
#!/bin/bash
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
for s in "${skills[@]}"; do
  [ "$s" = broken ] && { echo "No matching skills found for: broken"; exit 1; }
  [ "$s" = silent ] && continue
  mkdir -p "$dir/$s" && echo "from $src" >"$dir/$s/SKILL.md"
done
EOF
cat >"$TMP/bin/claude" <<'EOF'
#!/bin/bash
echo "unexpected claude call: $*" >&2; exit 9
EOF
cat >"$TMP/bin/opencode" <<'EOF'
#!/bin/bash
# opencode: lists models and variants, and answers the session API calls launch makes.
# Its calls also go to HERDR_LOG, to check their order against the herdr calls.
# OC_WRONG_MODEL=1 makes session.get report another model.
echo "$*" >>"$OPENCODE_LOG"; echo "opencode $*" >>"$HERDR_LOG"
case "$*" in
  models) printf 'opencode/big-pickle\nopencode/beam-free\n' ;;
  "api model.list") echo '{"data":[{"providerID":"opencode","id":"big-pickle","variants":[]},
    {"providerID":"opencode","id":"beam-free","variants":[{"id":"none"},{"id":"low"},{"id":"medium"},{"id":"high"},{"id":"xhigh"},{"id":"max"}]}]}' ;;
  "api session.create"*) echo "{\"data\":{\"id\":\"ses_test1\",\"cwd\":\"$PWD\"}}" ;;
  "api session.switchModel"*) python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[-1])["model"]))' "$@" >"$OPENCODE_LOG.model" ;;
  "api session.get"*)
    [ "${OC_WRONG_MODEL:-}" = 1 ] && { echo '{"data":{"model":{"providerID":"opencode","id":"other"}}}'; exit 0; }
    echo "{\"data\":{\"id\":\"ses_test1\",\"model\":$(cat "$OPENCODE_LOG.model")}}" ;;
  *) echo "unexpected opencode call: $*" >&2; exit 9 ;;
esac
EOF
cat >"$TMP/bin/agy" <<'EOF'
#!/bin/bash
[ "$*" = models ] && printf 'Fetching available models...\ngem-fast\tGem Fast\ngem-pro\tGem Pro\ngem-flash-low\tGem Flash (Low)\ngem-flash-high\tGem Flash (High)\n' && exit 0
echo "unexpected agy call: $*" >&2; exit 9
EOF
# herdr: logs every call; answers like herdr does. HERDR_SESSIONS sets `session list`,
# HERDR_WORKSPACES `workspace list`, HERDR_PANES the panes `pane list` shows,
# HERDR_TAB_BASE where the ids of new tabs and their panes start,
# HERDR_FAIL_TAB=1 fails the first tab create. agy blocks its first prompt on the trust
# question, then on an Esc notice; HERDR_ODD_DIALOG=1 shows a dialog launch does not know.
cat >"$TMP/bin/herdr" <<'EOF'
#!/bin/bash
echo "$*" >>"$HERDR_LOG"
[ "$1" = --session ] && shift 2
case "$1 $2" in
  "session list") running='{"sessions":[{"name":"default","default":true,"running":true}]}'
                  echo "${HERDR_SESSIONS:-$running}" ;;
  "workspace create") echo '{"result":{"workspace":{"workspace_id":"w9"},"tab":{"tab_id":"w9:t1"},"root_pane":{"pane_id":"w9:p1"}}}' ;;
  "workspace list") none='{"result":{"workspaces":[]}}'; echo "${HERDR_WORKSPACES:-$none}" ;;
  "tab create") [ "${HERDR_FAIL_TAB:-}" = 1 ] && { echo '{"error":"tab_create_failed"}'; exit 1; }
                n=$(($(grep -c "tab create" "$HERDR_LOG")+${HERDR_TAB_BASE:-1}))
                echo "{\"result\":{\"tab\":{\"tab_id\":\"w9:t$n\"},\"root_pane\":{\"pane_id\":\"w9:p$n\"}}}" ;;
  "pane list") echo "{\"result\":{\"panes\":[${HERDR_PANES:-}]}}" ;;
  "pane move") n=$(($(grep -c "pane move" "$HERDR_LOG")+50))
               echo "{\"result\":{\"move_result\":{\"changed\":true,\"created_tab\":{\"tab_id\":\"w9:t$n\"}}}}" ;;
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
    [ "${HERDR_ODD_DIALOG:-}" = 1 ] && { echo 'Pick a color theme: > Dark'; exit 0; }
    case "$(grep -c 'agent send-keys demo-docs' "$HERDR_LOG")" in
      0) echo 'Do you trust this folder? > Yes' ;;
      *) echo 'Verbosity now defaults to medium (esc to dismiss)' ;;
    esac ;;
  *) echo '{"result":{}}' ;;
esac
EOF
cat >"$TMP/bin/peers" <<'EOF'
#!/bin/sh
echo peers 0.0.1
EOF
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH" NPX_LOG="$TMP/npx.log" HERDR_LOG="$TMP/herdr.log" OPENCODE_LOG="$TMP/opencode.log"
fails=0
check() { # name, expected substring, command...
  local name=$1 want=$2; shift 2
  local got; got=$("$@" 2>&1)
  if [[ "$got" == *"$want"* ]]; then echo "ok   $name"; else echo "FAIL $name: $got"; fails=$((fails+1)); fi
}
lacks() { # name, substring that must be absent, command...
  local name=$1 bad=$2; shift 2
  local got; got=$("$@" 2>&1)
  if [[ "$got" != *"$bad"* ]]; then echo "ok   $name"; else echo "FAIL $name: $got"; fails=$((fails+1)); fi
}
exits() { # name, expected exit code, command...
  local name=$1 want=$2; shift 2
  "$@" >/dev/null 2>&1; local got=$?
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: exit $got, want $want"; fails=$((fails+1)); fi
}
W="$TMP/squad"
member() { # name, communications text
  mkdir -p "$W/$1"
  printf '# Project\n\nRepository: https://example.com/r.git (checkout: ./r)\n' >"$W/$1/PROJECT.md"
  printf '# Role\n\nYou are %s.\n' "$1" >"$W/$1/ROLE.md"
  printf '# Communications\n\n%s\n' "$2" >"$W/$1/COMMUNICATIONS.md"
  printf '# Memory\n' >"$W/$1/MEMORY.md"
}
roster() { printf '%s\n' "$1" >"$W/roster.json"; }
edit() { "$PY" - "$W/roster.json" "$1" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1])); exec(sys.argv[2]); json.dump(r, open(sys.argv[1], "w"))
EOF
}
mkdir -p "$W"

# --- roster structure ---
check "missing roster" "write the roster first" bun "$SCRIPT" check "$W"
roster '{"squad":"s","goal":"g","members":[{"name":"Lead","agent":"x","cwd":"../a","summary":"","reports_to":"user"}]}'
check "bad name" "must be kebab-case" bun "$SCRIPT" check "$W"
check "unknown agent rejected" "\"agent\" 'x' is not an agent; use one of claude, opencode, agy" bun "$SCRIPT" check "$W"
check "bad cwd" "one directory name inside the workspace" bun "$SCRIPT" check "$W"
check "empty summary" "\"summary\" must be" bun "$SCRIPT" check "$W"
roster '{"squad":"s","goal":"g","members":[
 {"name":"a","agent":"claude","cwd":"a","summary":"A","reports_to":"b"},
 {"name":"b","agent":"opencode","cwd":"b","summary":"B","reports_to":"a","talks_to":["zed"]}]}'
check "unknown talks_to" "talks_to 'zed' is not a member" bun "$SCRIPT" check "$W"
check "nobody reports to user" "no member reports to \"user\"" bun "$SCRIPT" check "$W"
check "report loop" "never reaches \"user\"" bun "$SCRIPT" check "$W"
check "missing files" "PROJECT.md is missing" bun "$SCRIPT" check "$W"
roster '{"squad":"s","goal":"g","members":[{"name":"a","agent":"claude","cwd":"a","summary":"A","reports_to":"user","model":"two words"}]}'
check "model with a space" "model 'two words' (member) is not a claude model" bun "$SCRIPT" check "$W"
roster '{"squad":"s","goal":"g","members":[{"name":"a","agent":"claude","runtime":"claude","cwd":"a","summary":"A","reports_to":"user"}]}'
check "agent and runtime together" "has both \"agent\" and the older \"runtime\"" bun "$SCRIPT" check "$W"
roster '{"squad":"s","goal":"g","defaults":{"agent":"gpt","models":{"cursor":"x"}},"members":[{"name":"a","cwd":"a","summary":"A","reports_to":"user"}]}'
check "bad defaults.agent" "defaults.agent 'gpt' is not an agent" bun "$SCRIPT" check "$W"
check "bad defaults.models agent" "defaults.models names 'cursor'" bun "$SCRIPT" check "$W"

# --- a mixed team: one member per agent, models from member, defaults and none ---
roster '{"squad":"demo","goal":"Ship it.","members":[
 {"name":"lead","agent":"claude","model":"haiku","cwd":"lead","summary":"Leads","reports_to":"user","talks_to":["api","docs"]},
 {"name":"api","agent":"opencode","cwd":"api","summary":"Builds the API","reports_to":"lead","model":"opencode/big-pickle",
  "skills":[{"source":"acme/skills","skill":"go-testing"},{"source":"acme/skills","skill":"sql"}]},
 {"name":"docs","runtime":"antigravity","cwd":"docs","summary":"Writes docs","reports_to":"lead"}]}'
member lead "Assign work to api."
member api "Report to lead."
member docs "Report to lead."
check "comms must name linked members" "COMMUNICATIONS.md never names 'docs'" bun "$SCRIPT" check "$W"
member lead "Assign work to api and docs. Report to the user."
echo "hand-written" >"$W/api/AGENTS.md"
check "hand-written AGENTS.md refused" "was not generated by this script" bun "$SCRIPT" check "$W"
rm "$W/api/AGENTS.md"
check "valid mixed team" "OK 3 members" bun "$SCRIPT" check "$W"
check "claude model from the member" "MEMBER lead: agent claude (member), model haiku (member)" bun "$SCRIPT" check "$W"
check "opencode model from the member" "MEMBER api: agent opencode (member), model opencode/big-pickle (member)" bun "$SCRIPT" check "$W"
check "legacy runtime antigravity is agy" "MEMBER docs: agent agy (member), the agent's own default model" bun "$SCRIPT" check "$W"

# --- defaults and fallbacks ---
edit 'del r["members"][2]["runtime"]'
check "built-in default agent is claude" "MEMBER docs: agent claude (built-in default), the agent's own default model" bun "$SCRIPT" check "$W"
edit 'r["defaults"] = {"agent": "agy"}'
check "defaults.agent applies" "MEMBER docs: agent agy (defaults.agent)" bun "$SCRIPT" check "$W"
edit 'r["defaults"]["models"] = {"agy": "gem-fast", "claude": "haiku"}'
check "defaults.models applies to its agent" "MEMBER docs: agent agy (defaults.agent), model gem-fast (defaults.models.agy)" bun "$SCRIPT" check "$W"
check "member model beats defaults.models" "MEMBER lead: agent claude (member), model haiku (member)" bun "$SCRIPT" check "$W"

# --- model validation, per agent ---
edit 'r["members"][0]["model"] = "gpt-5"'
check "claude model form" "model 'gpt-5' (member) is not a claude model; expected an alias" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["model"] = "claude-haiku-4-5"'
check "claude full model name" "MEMBER lead: agent claude (member), model claude-haiku-4-5" bun "$SCRIPT" check "$W"
edit 'r["members"][1]["model"] = "big-pickle"'
check "opencode model form" "is not a opencode model; expected provider/model" bun "$SCRIPT" check "$W"
edit 'r["members"][1]["model"] = "opencode/nope"'
check "opencode model not listed" "model 'opencode/nope' (member) is not available to opencode; \`opencode models\` lists: opencode/beam-free, opencode/big-pickle" bun "$SCRIPT" check "$W"
edit 'r["defaults"]["models"]["agy"] = "gem-ultra"'
check "agy model not listed" "model 'gem-ultra' (defaults.models.agy) is not available to agy; \`agy models\` lists: gem-fast, gem-flash, gem-flash-high, gem-flash-low, gem-pro" bun "$SCRIPT" check "$W"
edit 'r["members"][1]["model"] = "opencode/big-pickle"; r["defaults"]["models"]["agy"] = "gem-fast"'
mkdir -p "$TMP/noagy"; for t in npx claude opencode herdr; do ln -sf "$TMP/bin/$t" "$TMP/noagy/$t"; done
check "agy missing is a note for check" "NOTE member 'docs': cannot confirm model 'gem-fast': \`agy\` is not on PATH" env PATH="$TMP/noagy:/usr/bin:/bin" "$BUN" "$SCRIPT" check "$W"
exits "agy missing still passes check" 0 env PATH="$TMP/noagy:/usr/bin:/bin" "$BUN" "$SCRIPT" check "$W"

# --- effort: default, mapping per agent, validation and fallback ---
check "no effort is the agent's default" "model claude-haiku-4-5 (member), the agent's own default effort (no effort set)" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["effort"] = "extreme"'
check "unknown member effort" "\"effort\" 'extreme' is not an effort level; use one of low, medium, high, xhigh, max" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["effort"] = "high"'
check "claude effort from the member" "MEMBER lead: agent claude (member), model claude-haiku-4-5 (member), effort high (member)" bun "$SCRIPT" check "$W"
check "claude takes every level" "effort max (--effort)" bun "$SCRIPT" check "$W" --effort lead=max
check "--effort unknown level" "--effort lead=extreme: 'extreme' is not an effort level" bun "$SCRIPT" check "$W" --effort lead=extreme
check "--effort unknown member" "--effort nope=low: no member named 'nope'" bun "$SCRIPT" check "$W" --effort nope=low
check "opencode model without variants" "effort 'low' (--effort) is not supported by opencode with opencode/big-pickle; it has no effort levels" bun "$SCRIPT" check "$W" --effort api=low
check "opencode variant accepted" "MEMBER api: agent opencode (member), model opencode/beam-free (--model), effort xhigh (--effort)" bun "$SCRIPT" check "$W" --model api=opencode/beam-free --effort api=xhigh
check "agy model without levels" "effort 'high' (--effort) is not supported by agy with gem-fast; it has no effort levels" bun "$SCRIPT" check "$W" --effort docs=high
check "agy base model takes its levels" "MEMBER docs: agent agy (defaults.agent), model gem-flash (--model), effort high (--effort)" bun "$SCRIPT" check "$W" --model docs=gem-flash --effort docs=high
check "explicit unsupported level is an error" "it has low, high; the nearest it has is 'low'" bun "$SCRIPT" check "$W" --model docs=gem-flash --effort docs=medium
exits "explicit unsupported level exits 1" 1 bun "$SCRIPT" check "$W" --model docs=gem-flash --effort docs=medium
check "agy id fixed to a level" "it has low; the nearest it has is 'low'; or set the model to 'gem-flash'" bun "$SCRIPT" check "$W" --model docs=gem-flash-low --effort docs=high
edit 'del r["defaults"]["models"]["agy"]'
check "agy effort needs a model" "effort 'low' (--effort): agy needs a model to check an effort level against" bun "$SCRIPT" check "$W" --effort docs=low
edit 'r["defaults"]["models"]["agy"] = "gem-fast"; r["defaults"]["effort"] = "max"'
check "defaults.effort applies" "MEMBER api: agent claude (--agent), model haiku (defaults.models.claude), effort max (defaults.effort)" bun "$SCRIPT" check "$W" --agent api=claude
check "member effort beats defaults.effort" "effort high (member)" bun "$SCRIPT" check "$W"
check "defaults.effort on an opencode model without variants" "NOTE member 'api': opencode/big-pickle has no 'max' effort (it has no effort levels), so it uses the agent's own default effort" bun "$SCRIPT" check "$W"
check "defaults.effort on an opencode variant" "model opencode/beam-free (--model), effort max (defaults.effort)" bun "$SCRIPT" check "$W" --model api=opencode/beam-free
check "defaults.effort without levels falls back" "NOTE member 'docs': gem-fast has no 'max' effort (it has no effort levels), so it uses the agent's own default effort" bun "$SCRIPT" check "$W"
check "defaults.effort moves to the nearest" "MEMBER docs: agent agy (defaults.agent), model gem-flash (--model), effort high (nearest to defaults.effort)" bun "$SCRIPT" check "$W" --model docs=gem-flash
edit 'r["defaults"]["effort"] = "medium"'
check "nearest takes the lower on a tie" "so it uses the nearest, 'low'" bun "$SCRIPT" check "$W" --model docs=gem-flash
exits "defaults.effort fallback still passes" 0 bun "$SCRIPT" check "$W" --model docs=gem-flash
edit 'r["defaults"]["effort"] = "huge"'
check "bad defaults.effort" "defaults.effort 'huge' is not an effort level" bun "$SCRIPT" check "$W"
edit 'del r["defaults"]["effort"]'
edit 'r["defaults"]["models"]["opencode"] = "opencode/beam-free"; del r["members"][1]["model"]'
check "defaults.models.opencode applies" "MEMBER api: agent opencode (member), model opencode/beam-free (defaults.models.opencode)" bun "$SCRIPT" check "$W"
edit 'del r["defaults"]["models"]["opencode"]; r["members"][1]["model"] = "opencode/big-pickle"'
# The capability stays reusable: an agent with launch_settings off ignores a model and effort with a warning.
check "an agent without launch settings warns" "WARNING member 'api': ignored model 'opencode/big-pickle' (member) and effort 'high' (--effort); opencode is launched without them. Set them in the agent." "$BUN" -e '
import { AGENTS } from "'"$HERE"'/src/agents.ts"; import { main } from "'"$HERE"'/src/commands.ts";
Object.assign(AGENTS.opencode, { launchSettings: false, settingsNote: "Set them in the agent" });
process.exitCode = await main(["check", process.argv[1], "--effort", "api=high"]);' "$W"

# --- launch-time overrides, checked by check ---
check "--agent override" "MEMBER api: agent agy (--agent), model gem-fast (defaults.models.agy)" bun "$SCRIPT" check "$W" --agent api=agy
check "override drops the roster model" "NOTE member 'api': its model 'opencode/big-pickle' is for its roster agent, so with agent agy it uses gem-fast" bun "$SCRIPT" check "$W" --agent api=agy
check "--model override" "MEMBER api: agent agy (--agent), model gem-pro (--model)" bun "$SCRIPT" check "$W" --agent api=agy --model api=gem-pro
check "--model must suit the agent" "model 'gem-fast' (--model) is not a claude model" bun "$SCRIPT" check "$W" --model lead=gem-fast
check "--agent unknown agent" "--agent api=gpt: 'gpt' is not an agent" bun "$SCRIPT" check "$W" --agent api=gpt
check "--agent unknown member" "--agent nope=claude: no member named 'nope'" bun "$SCRIPT" check "$W" --agent nope=claude
check "--model needs MEMBER=MODEL" "must be MEMBER=VALUE" bun "$SCRIPT" check "$W" --model haiku
exits "--model usage error exits 2" 2 bun "$SCRIPT" check "$W" --model haiku
check "launch overrides are not build options" "unrecognized arguments: --agent" bun "$SCRIPT" build "$W" --agent api=agy

# --- build ---
: >"$HERDR_LOG"
check "launch before build is refused" "member 'lead' is not built" bun "$SCRIPT" launch "$W"
check "refused launch says nothing started" "Nothing was launched." bun "$SCRIPT" launch "$W"
check "refused launch touches no pane" "0" bash -c "grep -c -e 'workspace create' -e 'tab create' -e 'agent start' '$HERDR_LOG' || true"
check "build" "BUILT docs (agy)" bun "$SCRIPT" build "$W"
check "claude gets CLAUDE.md" "# lead: member of the demo squad" cat "$W/lead/CLAUDE.md"
check "opencode gets AGENTS.md" "# api: member of the demo squad" cat "$W/api/AGENTS.md"
check "agents file references, never copies" "absent" bash -c "grep -q 'You are api.' '$W/api/AGENTS.md' && echo copied || echo absent"
check "agents file lists the role path" "- Role: \`$W/api/ROLE.md\`" cat "$W/api/AGENTS.md"
check "agents file says to read them first" "Read all four" cat "$W/api/AGENTS.md"
check "claude file imports by path" "- Memory: @$W/lead/MEMORY.md" cat "$W/lead/CLAUDE.md"
check "claude file copies nothing" "absent" bash -c "grep -q 'You are lead.' '$W/lead/CLAUDE.md' && echo copied || echo absent"
check "squad directory shows agent and model" '`docs` (you) | agy | gem-fast |' cat "$W/docs/AGENTS.md"
check "squad directory shows a member model" '`lead` | claude | claude-haiku-4-5 | high |' cat "$W/docs/AGENTS.md"
check "peers command in the instructions" "through the peers skill (\`peers\`)" cat "$W/docs/AGENTS.md"
check "lessons go to MEMORY.md" "as one short entry. Never record lessons in this file." cat "$W/api/AGENTS.md"
check "regenerate hint names assemble" "roster.js assemble $W --member api" cat "$W/api/AGENTS.md"
printf -- '# Memory\n' >"$W/api/MEMORY.md"
check "heading-only memory is fine" "OK 3 members" bun "$SCRIPT" check "$W"
printf -- '# Role\n' >"$W/api/ROLE.md"
check "heading-only role is empty" "ROLE.md is empty" bun "$SCRIPT" check "$W"
printf -- '# Role\n\nYou are api.\n' >"$W/api/ROLE.md"
check "peers installed for claude" "SKILL.md" ls "$W/lead/.claude/skills/peers"
check "peers installed for agy" "SKILL.md" ls "$W/docs/.agents/skills/peers"
check "extra skills in one call" "add acme/skills -a opencode -y --copy --skill go-testing --skill sql" cat "$NPX_LOG"
check "agy skills agent name" "-a antigravity" cat "$NPX_LOG"
check "claude needs no .mcp.json" "absent" bash -c "[ -e '$W/lead/.mcp.json' ] && echo present || echo absent"
check "claude needs no settings.local.json" "absent" bash -c "[ -e '$W/lead/.claude/settings.local.json' ] && echo present || echo absent"
check "agy gets no hooks.json" "absent" bash -c "[ -e '$W/docs/.agents/hooks.json' ] && echo present || echo absent"
check "build merges the loop entry into opencode.json" '"roster"' cat "$W/api/opencode.json"
check "opencode records its model" '"model": "opencode/big-pickle"' cat "$W/api/.peers.json"
check "squad directory shows the opencode model" '`api` | opencode | opencode/big-pickle | agent default |' cat "$W/lead/CLAUDE.md"
check "role file for each member" '"role": "api"' cat "$W/api/.peers.json"
check "role file names the squad" '"squad": "demo"' cat "$W/lead/.peers.json"
check "role file records agent and model" '"agent": "agy",
  "model": "gem-fast"' cat "$W/docs/.peers.json"
check "no channel for opencode" "absent" bash -c "[ -e '$W/api/.mcp.json' ] && echo present || echo absent"
echo '{"mcpServers":{"other":{"command":"x"}},"x":1}' >"$W/lead/.mcp.json"
bun "$SCRIPT" build "$W" --member lead >/dev/null
check "existing .mcp.json kept" '"other"' cat "$W/lead/.mcp.json"
check "rebuild writes no settings.local.json" "absent" bash -c "[ -e '$W/lead/.claude/settings.local.json' ] && echo present || echo absent"
echo '{"model":"opencode/beam-free#high"}' >"$W/api/opencode.json"
bun "$SCRIPT" build "$W" --member api >/dev/null
check "build keeps the member's own opencode.json" '"model": "opencode/beam-free#high"' cat "$W/api/opencode.json"
: >"$NPX_LOG"
check "assemble writes only instructions" "ASSEMBLED api" bun "$SCRIPT" assemble "$W" --member api
check "assemble installs nothing" "0" bash -c "wc -l <'$NPX_LOG' | tr -d ' '"
check "unknown member" "no member named 'nope'" bun "$SCRIPT" assemble "$W" --member nope

# --- launch: validation before anything starts ---
: >"$HERDR_LOG"
check "launch needs a running herdr session" "herdr session 'default' is not running" env HERDR_SESSIONS='{"sessions":[{"name":"default","default":true,"running":false}]}' bun "$SCRIPT" launch "$W"
check "launch needs the named session" "no herdr session named 'work'" bun "$SCRIPT" launch "$W" --session work
check "launch needs each agent's CLI" "member 'docs': agent agy needs the \`agy\` command, which is not on PATH" env PATH="$TMP/noagy:/usr/bin:/bin" "$BUN" "$SCRIPT" launch "$W"
check "launch rejects an invalid model" "model 'opus-9' (--model) is not available to agy" bun "$SCRIPT" launch "$W" --model docs=opus-9
check "failed validation starts nothing" "0" bash -c "grep -c -e 'workspace create' -e 'tab create' -e 'agent start' -e 'pane run' '$HERDR_LOG' || true"

# --- launch: dry run prints each agent's own command and model setting ---
check "dry run claude with --model and --effort" "claude --dangerously-skip-permissions -n demo-lead --model claude-haiku-4-5 --effort high --" bun "$SCRIPT" launch "$W" --dry-run
check "dry run opencode starts as a herdr agent" "agent start demo-api --kind opencode --pane '<pane-2>'" bun "$SCRIPT" launch "$W" --dry-run
check "dry run agy with --model" "agent start demo-docs --kind agy --pane '<pane-3>' -- --dangerously-skip-permissions --model gem-fast" bun "$SCRIPT" launch "$W" --dry-run
check "dry run shows agy's dialog answers" "agent send-keys demo-docs esc   # only when the screen shows 'esc to dismiss'" bun "$SCRIPT" launch "$W" --dry-run
check "dry run opencode creates its session" "RUN opencode api session.create -d" bun "$SCRIPT" launch "$W" --dry-run
check "dry run opencode opens that session" "agent start demo-api --kind opencode --pane '<pane-2>' -- --session '<session>'" bun "$SCRIPT" launch "$W" --dry-run
check "dry run opencode sets the model by API" "RUN opencode api session.switchModel --param 'sessionID=<session>' -d '{\"model\": {\"providerID\": \"opencode\", \"id\": \"big-pickle\"}}'" bun "$SCRIPT" launch "$W" --dry-run
check "dry run reports the model per member" "WOULD LAUNCH api (opencode, model opencode/big-pickle, effort the agent's own default)" bun "$SCRIPT" launch "$W" --dry-run
check "dry run with an agent override would rebuild" "WOULD REBUILD api for agent claude" bun "$SCRIPT" launch "$W" --dry-run --agent api=claude --model api=haiku
check "dry run changes nothing" '"agent": "opencode"' cat "$W/api/.peers.json"

# --- launch: real run against the herdr stub ---
: >"$HERDR_LOG"
check "launch starts every member" "LAUNCHED docs (agy, model gem-fast, effort the agent's own default) in herdr session default, tab 3 'docs', pane w9:p3" bun "$SCRIPT" launch "$W"
check "claude started with its model" "pane run w9:p1 claude --dangerously-skip-permissions -n demo-lead --model claude-haiku-4-5" cat "$HERDR_LOG"
check "claude trust prompt answered" "pane send-keys w9:p1 down enter" cat "$HERDR_LOG"
check "claude settles before first prompt" "agent wait demo-lead --until idle --until blocked" cat "$HERDR_LOG"
check "opencode retried a busy pane" "busy-once" cat "$HERDR_LOG"
check "opencode got its first prompt" "agent prompt demo-api Read your instructions" cat "$HERDR_LOG"
check "agy trust prompt answered" "agent send-keys demo-docs enter" cat "$HERDR_LOG"
check "agy notice dismissed" "agent send-keys demo-docs esc" cat "$HERDR_LOG"
check "launch waits for the agent to settle" "agent wait demo-docs --until idle --until blocked" cat "$HERDR_LOG"
check "agy started with its model" "--kind agy --pane w9:p3 -- --dangerously-skip-permissions --model gem-fast" cat "$HERDR_LOG"
check "opencode session created in the member cwd" "\"location\": {\"directory\": \"$W/api\"}" cat "$OPENCODE_LOG"
check "opencode TUI opens that session" "agent start demo-api --kind opencode --pane w9:p2 -- --session ses_test1" cat "$HERDR_LOG"
lacks "opencode gets no model flag" "--kind opencode --pane w9:p2 -- --model" cat "$HERDR_LOG"
check "opencode model set by API" 'api session.switchModel --param sessionID=ses_test1 -d {"model": {"providerID": "opencode", "id": "big-pickle"}}' cat "$OPENCODE_LOG"
check "model set after start, before the first prompt" "start<settle<switch<get<prompt" bash -c "awk '/agent start demo-api/{a=NR} /agent wait demo-api/ && !w{w=NR} /session.switchModel/{s=NR} /session.get/{g=NR} /agent prompt demo-api/{p=NR} END{print (a<w&&w<s&&s<g&&g<p)?\"start<settle<switch<get<prompt\":a\" \"w\" \"s\" \"g\" \"p}' '$HERDR_LOG'"
check "launch override rebuilds the member" "REBUILT api (claude)" bun "$SCRIPT" launch "$W" --member api --agent api=claude --model api=haiku
check "override rebuild writes CLAUDE.md" "CLAUDE.md AGENTS.md:absent" bash -c "[ -e '$W/api/CLAUDE.md' ] && printf 'CLAUDE.md '; [ -e '$W/api/AGENTS.md' ] && echo AGENTS.md:present || echo AGENTS.md:absent"
check "override shows in the squad directory" '`api` | claude | haiku |' cat "$W/lead/CLAUDE.md"
check "override records agent and model" '"model": "haiku"' cat "$W/api/.peers.json"
bun "$SCRIPT" build "$W" --member api >/dev/null
: >"$HERDR_LOG"
check "opencode override launches with its effort" "LAUNCHED api (opencode, model opencode/beam-free, effort xhigh)" bun "$SCRIPT" launch "$W" --member api --model api=opencode/beam-free --effort api=xhigh
check "opencode effort is the session variant" '{"model": {"providerID": "opencode", "id": "beam-free", "variant": "xhigh"}}' cat "$OPENCODE_LOG"
lacks "opencode.json untouched by launch" "xhigh" cat "$W/api/opencode.json"
check "a session that reports another model fails" "reports model {'providerID': 'opencode', 'id': 'other'}, not opencode/beam-free with variant xhigh" env OC_WRONG_MODEL=1 bun "$SCRIPT" launch "$W" --member api --model api=opencode/beam-free --effort api=xhigh
edit 'del r["members"][1]["model"]'
bun "$SCRIPT" assemble "$W" --member api >/dev/null
: >"$HERDR_LOG"
check "opencode without a model starts plain" "LAUNCHED api (opencode, model the agent's own default" bun "$SCRIPT" launch "$W" --member api
lacks "plain opencode makes no API call" "session.create" cat "$HERDR_LOG"
lacks "plain opencode gets no flags" "--kind opencode --pane w9:p1 --" cat "$HERDR_LOG"
edit 'r["members"][1]["model"] = "opencode/big-pickle"'
bun "$SCRIPT" assemble "$W" --member api >/dev/null
check "effort-only override retunes" "SET lead's model to claude-haiku-4-5, effort low" bun "$SCRIPT" launch "$W" --member lead --effort lead=low
check "effort recorded in .peers.json" '"effort": "low"' cat "$W/lead/.peers.json"
check "squad directory shows the effort" '`lead` | claude | claude-haiku-4-5 | low |' cat "$W/api/AGENTS.md"
check "claude gets the overridden effort" "--model claude-haiku-4-5 --effort low" cat "$HERDR_LOG"
: >"$HERDR_LOG"
check "agy launches with its effort" "LAUNCHED docs (agy, model gem-flash, effort high)" bun "$SCRIPT" launch "$W" --member docs --model docs=gem-flash --effort docs=high
check "agy gets --model and --effort" "--kind agy --pane w9:p1 -- --dangerously-skip-permissions --model gem-flash --effort high" cat "$HERDR_LOG"
check "launch refuses an unsupported effort" "is not supported by agy with gem-fast" bun "$SCRIPT" launch "$W" --effort docs=high
bun "$SCRIPT" build "$W" --member lead >/dev/null
check "build returns to roster.json" '"effort": "high"' cat "$W/lead/.peers.json"
check "launch failure names the member" "FAILED opening or moving api's tab: \`herdr tab create" env HERDR_FAIL_TAB=1 bun "$SCRIPT" launch "$W"
check "launch failure lists who runs" "Already running: lead (pane w9:p1). Not started: api, docs." env HERDR_FAIL_TAB=1 bun "$SCRIPT" launch "$W"
exits "launch failure exits 1" 1 env HERDR_FAIL_TAB=1 bun "$SCRIPT" launch "$W"
: >"$HERDR_LOG"
# --- launch: one workspace, one tab per member in hierarchy order ---
: >"$HERDR_LOG"
bun "$SCRIPT" launch "$W" >/dev/null
check "one workspace for the squad" "1" bash -c "grep -c 'workspace create' '$HERDR_LOG'"
check "the supervisor's tab comes first" "tab rename w9:t1 lead" cat "$HERDR_LOG"
check "each member gets its own tab" "tab create --workspace w9 --cwd $W/api --label api --no-focus" cat "$HERDR_LOG"
check "tabs follow the hierarchy" "lead<api<docs" bash -c "awk '/tab rename w9:t1 lead/{l=NR} /--label api/{a=NR} /--label docs/{d=NR} END{print (l<a&&a<d)?\"lead<api<docs\":l\" \"a\" \"d}' '$HERDR_LOG'"
check "each pane is labelled" "pane rename w9:p3 docs" cat "$HERDR_LOG"
lacks "no pane is split" "pane split" cat "$HERDR_LOG"
lacks "no pane is zoomed" "pane zoom" cat "$HERDR_LOG"
check "launch prints the tabs" "TAB 1 'lead': lead" bun "$SCRIPT" launch "$W" --dry-run
check "check prints the tabs" "TAB 3 'docs': docs" bun "$SCRIPT" check "$W"
SQUAD_WS='{"result":{"workspaces":[{"label":"squad-demo","workspace_id":"w9"}]}}'
check "a second full launch is refused" "already holds the squad's workspace squad-demo (w9)" env HERDR_WORKSPACES="$SQUAD_WS" bun "$SCRIPT" launch "$W"
check "a member that still has a pane is refused" "member 'lead' already has pane w9:p1" env HERDR_WORKSPACES="$SQUAD_WS" HERDR_PANES='{"label":"lead","pane_id":"w9:p1","tab_id":"w9:t1"}' bun "$SCRIPT" launch "$W" --member lead
: >"$HERDR_LOG"
check "a relaunched last member gets a new tab" "tab 3 'docs', pane w9:p11" env HERDR_TAB_BASE=10 HERDR_WORKSPACES="$SQUAD_WS" HERDR_PANES='{"label":"lead","pane_id":"w9:p1","tab_id":"w9:t1"},{"label":"api","pane_id":"w9:p2","tab_id":"w9:t2"}' bun "$SCRIPT" launch "$W" --member docs
lacks "it makes no second workspace" "workspace create" cat "$HERDR_LOG"
lacks "a last member moves nobody" "pane move" cat "$HERDR_LOG"
: >"$HERDR_LOG"
env HERDR_TAB_BASE=10 HERDR_WORKSPACES="$SQUAD_WS" HERDR_PANES='{"label":"api","pane_id":"w9:p2","tab_id":"w9:t2"},{"label":"docs","pane_id":"w9:p3","tab_id":"w9:t3"}' bun "$SCRIPT" launch "$W" --member lead >"$TMP/relaunch.out" 2>&1
check "a relaunched supervisor gets a new tab" "tab create --workspace w9 --cwd $W/lead --label lead" cat "$HERDR_LOG"
check "the members after it move behind it" "MOVED api to a new last tab, keeping it running in pane w9:p2" cat "$TMP/relaunch.out"
check "a moved member's new tab is labelled" "tab rename w9:t51 api" cat "$HERDR_LOG"
check "moves keep the hierarchy order" "lead<api<docs" bash -c "awk '/--label lead/{l=NR} /pane move w9:p2 --new-tab/{a=NR} /pane move w9:p3 --new-tab/{d=NR} END{print (l<a&&a<d)?\"lead<api<docs\":l\" \"a\" \"d}' '$HERDR_LOG'"
lacks "moved members are not restarted" "agent start demo-api" cat "$HERDR_LOG"
: >"$HERDR_LOG"

check "unknown dialog fails with the screen" "Pick a color theme" env HERDR_ODD_DIALOG=1 bun "$SCRIPT" launch "$W" --member docs
lacks "unknown dialog gets no keys" "agent send-keys demo-docs" cat "$HERDR_LOG"

# --- display names ---
edit 'r["members"][0]["display_name"] = "Lena | lead"'
check "display name rejects |" "\"display_name\" must be a human-readable name" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "x" * 49'
check "display name too long" "\"display_name\" must be a human-readable name" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "Rina Putri"'
check "display name rejects a space" "\"display_name\" must be a human-readable name" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "Rina\tP"'
check "display name rejects a tab" "\"display_name\" must be a human-readable name" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "Rina (lead)"'
check "display name rejects a role" "\"display_name\" must be a human-readable name" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "Rina\u00a0Putri"'
check "display name rejects unicode whitespace" "\"display_name\" must be a human-readable name" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = " Rina "; r["members"][1]["display_name"] = "Mary-Ann"'
check "surrounding spaces are stripped, hyphenated name accepted" "OK 3 members" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "Rina"; r["members"][1]["display_name"] = "rina"'
check "display name must be unique" "display_name 'rina' is used by another member" bun "$SCRIPT" check "$W"
edit 'r["members"][0]["display_name"] = "Lena"; r["members"][1]["display_name"] = "Rina"'
check "MEMBER line shows the display name" "MEMBER lead (Lena): agent claude" bun "$SCRIPT" check "$W"
check "unnamed MEMBER line unchanged" "MEMBER docs: agent agy" bun "$SCRIPT" check "$W"
bun "$SCRIPT" assemble "$W" >/dev/null
check "heading shows the display name" "# Lena (\`lead\`): member of the demo squad" cat "$W/lead/CLAUDE.md"
check "intro shows the display name" "You are Rina, the member \`api\`." cat "$W/api/AGENTS.md"
check "squad directory gets a Name column" '| `api` | Rina | opencode |' cat "$W/lead/CLAUDE.md"
check "unnamed member shows its member name" '| `docs` (you) | docs | agy |' cat "$W/docs/AGENTS.md"
check "files explain the two names" "Call members by their human-readable name" cat "$W/docs/AGENTS.md"
check ".peers.json records the display name" '"display_name": "Rina"' cat "$W/api/.peers.json"
lacks "unnamed .peers.json has no display name" "display_name" cat "$W/docs/.peers.json"
: >"$HERDR_LOG"; : >"$OPENCODE_LOG"
check "LAUNCHED shows the display name" "LAUNCHED api (Rina) (opencode" bun "$SCRIPT" launch "$W" --member api
check "pane labelled with the display name" "pane rename w9:p1 Rina" cat "$HERDR_LOG"
check "opencode session title" "Rina [demo-api] (peers squad member)" cat "$OPENCODE_LOG"
: >"$HERDR_LOG"
bun "$SCRIPT" launch "$W" --member lead >/dev/null
check "claude session name" "-n 'Lena [demo-lead]'" cat "$HERDR_LOG"
: >"$HERDR_LOG"
bun "$SCRIPT" launch "$W" --member docs >/dev/null
check "unnamed member's pane is labelled with its member name" "pane rename w9:p1 docs" cat "$HERDR_LOG"
edit 'del r["members"][0]["display_name"]; del r["members"][1]["display_name"]'
bun "$SCRIPT" assemble "$W" >/dev/null
lacks "removing names clears .peers.json" "display_name" cat "$W/api/.peers.json"

# --- build failures ---
edit 'r["members"][1]["agent"] = "claude"; del r["members"][1]["model"]'
bun "$SCRIPT" build "$W" --member api >/dev/null
check "agent change swaps the generated file" "CLAUDE.md AGENTS.md:absent" bash -c "[ -e '$W/api/CLAUDE.md' ] && printf 'CLAUDE.md '; [ -e '$W/api/AGENTS.md' ] && echo AGENTS.md:present || echo AGENTS.md:absent"
edit 'r["members"][2]["skills"] = [{"source": "acme/skills", "skill": "broken"}]'
check "failed install shows the command" "npx -y skills@latest add acme/skills -a antigravity" bun "$SCRIPT" build "$W" --member docs
edit 'r["members"][2]["skills"] = [{"source": "acme/skills", "skill": "silent"}]'
check "install that leaves nothing is caught" "did not install 'silent'" bun "$SCRIPT" build "$W" --member docs
edit 'r["members"][2]["skills"] = [{"source": "acme/skills", "skill": "peers"}]'
check "peers is not listed by hand" "which every member gets" bun "$SCRIPT" check "$W"

# --- the peers CLI: build installs it when it is missing ---
edit 'r["members"][2].pop("skills", None)'
mkdir -p "$TMP/nopeers" "$TMP/home"
for t in npx claude opencode agy herdr; do ln -sf "$TMP/bin/$t" "$TMP/nopeers/$t"; done
cat >"$TMP/installer.sh" <<'EOF'
[ "${INSTALLER_FAIL:-}" = 1 ] && { echo "peers-install: error: no release" >&2; exit 1; }
dir="${PEERS_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir" && printf '#!/bin/sh\necho peers 0.0.1\n' >"$dir/peers" && chmod +x "$dir/peers"
EOF
rm -f "$W/lead/.mcp.json"
nopeers() { env PATH="$TMP/nopeers:/usr/bin:/bin" HOME="$TMP/home" GITHUB_TOKEN= PEERS_INSTALL_DIR= PEERS_INSTALLER_URL="file://$TMP/installer.sh" "$@"; }
check "check notes a missing peers CLI" "NOTE the peers CLI is not installed; build installs it with file://$TMP/installer.sh" nopeers "$BUN" "$SCRIPT" check "$W"
check "launch needs the peers CLI" "the peers CLI is not installed; run" nopeers "$BUN" "$SCRIPT" launch "$W" --dry-run
check "a failed peers install shows its output" "peers-install: error: no release" nopeers env INSTALLER_FAIL=1 "$BUN" "$SCRIPT" build "$W" --member lead
check "an unreachable installer is named" "could not be fetched from file://$TMP/missing.sh" nopeers env PEERS_INSTALLER_URL="file://$TMP/missing.sh" "$BUN" "$SCRIPT" build "$W" --member lead
nopeers "$BUN" "$SCRIPT" build "$W" --member lead >"$TMP/install.out" 2>&1
check "build installs a missing peers CLI" "INSTALLED peers 0.0.1 at $TMP/home/.local/bin/peers" cat "$TMP/install.out"
check "the install warns when its directory is not on PATH" "is not on PATH, so members cannot run \`peers\`" cat "$TMP/install.out"
check "claude still needs no .mcp.json" "absent" bash -c "[ -e '$W/lead/.mcp.json' ] && echo present || echo absent"
lacks "an installed peers CLI is not installed again" "INSTALLED" nopeers "$BUN" "$SCRIPT" build "$W" --member lead
check "PEERS_INSTALL_DIR picks the directory" "INSTALLED peers 0.0.1 at $TMP/pdir/peers" nopeers env HOME="$TMP/home2" PEERS_INSTALL_DIR="$TMP/pdir" "$BUN" "$SCRIPT" build "$W" --member lead
bun "$SCRIPT" build "$W" --member lead >/dev/null
[ $fails -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
