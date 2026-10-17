#!/bin/bash
# Offline smoke test for scripts/peers.py: stubs the claude, opencode and agy
# CLIs and checks argument validation, whoami, reply addressing, and routing.
set -u
usage() {
  cat <<'EOF'
Offline smoke test for scripts/peers.py.

Usage: smoke.sh [-h|--help]

Runs every check against stubs of the claude, opencode and agy CLIs, in a
temporary directory that is removed afterwards. It changes no real session,
inbox or workspace. Checks: argument validation, whoami, roles, reply
addressing and routing.

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
SCRIPT="$HERE/../../scripts/peers.py"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat >"$TMP/bin/claude" <<'EOF'
#!/bin/bash
[ "$1 $2" = "agents --json" ] && echo '[{"sessionId":"11111111-1111-1111-1111-111111111111","kind":"background","status":"idle","cwd":"/x","name":"peer"}]' && exit 0
echo "unexpected claude call: $*" >&2; exit 9
EOF
cat >"$TMP/bin/opencode" <<'EOF'
#!/bin/bash
case "$*" in
  "api get /api/session") echo '{"data":[]}' ;;
  "api get /api/session/active") echo '{"data":{}}' ;;
  "api post /api/session/ses_abc/prompt --data "*) case "$*" in *'"delivery": "steer"'*) echo '{"data":{"id":"msg_1","delivery":"steer"}}' ;; *) echo "not steered: $*" >&2; exit 9 ;; esac ;;
  *) echo "unexpected opencode call: $*" >&2; exit 9 ;;
esac
EOF
cat >"$TMP/bin/agy" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" >"$PEERS_HOME/agy-args"
seq=$(printf '%s\n' "${@: -1}" | sed -n 's/^PEER-SEQ: //p')
echo "start $seq" >>"$PEERS_HOME/agy-timeline"; sleep 0.5; echo "end $seq" >>"$PEERS_HOME/agy-timeline"
echo '{"conversation_id":"33333333-3333-3333-3333-333333333333","status":"SUCCESS","response":"ok"}'
EOF
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH" PEERS_HOME="$TMP/home"
unset OPENCODE_SESSION_ID CLAUDE_CODE_SESSION_ID ANTIGRAVITY_CONVERSATION_ID PEERS_SELF
mkdir -p "$PEERS_HOME"
fails=0
check() { # name, expected substring, command...
  local name=$1 want=$2; shift 2
  local got; got=$("$@" 2>&1)
  if [[ "$got" == *"$want"* ]]; then echo "ok   $name"; else echo "FAIL $name: $got"; fails=$((fails+1)); fi
}
check "whoami without session" "cannot tell which session" python3 "$SCRIPT" whoami
check "whoami opencode" "opencode:ses_me" env OPENCODE_SESSION_ID=ses_me python3 "$SCRIPT" whoami
check "whoami claude" "claude:abc" env CLAUDE_CODE_SESSION_ID=abc python3 "$SCRIPT" whoami
check "whoami antigravity" "antigravity:conv1" env ANTIGRAVITY_CONVERSATION_ID=conv1 python3 "$SCRIPT" whoami
check "whoami override" "opencode:ses_x" env PEERS_SELF=opencode:ses_x CLAUDE_CODE_SESSION_ID=abc python3 "$SCRIPT" whoami
export CLAUDE_CODE_SESSION_ID=22222222-2222-2222-2222-222222222222
check "bad address" "bad address" python3 "$SCRIPT" send foo --kind ack --seq 1 --body x
check "bad opencode id" "must start with 'ses'" python3 "$SCRIPT" send opencode:abc --kind ack --seq 1 --body x
check "bad kind" "bad kind" python3 "$SCRIPT" send opencode:ses_abc --kind nope --seq 1 --body x
check "empty body" "empty message body" python3 "$SCRIPT" send opencode:ses_abc --kind ack --seq 1 --body " "
check "self send" "to yourself" python3 "$SCRIPT" send "claude:$CLAUDE_CODE_SESSION_ID" --kind ack --seq 1 --body x
check "no delivery option" "unrecognized arguments: --delivery" python3 "$SCRIPT" send opencode:ses_abc --kind ack --seq 1 --delivery queue --body x
check "send opencode always steers" "SENT opencode:ses_abc delivery=steer message=msg_1" python3 "$SCRIPT" send opencode:ses_abc --kind request --seq 1 --body hi
check "send live claude" "via file inbox" python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind request --seq 3 --body hello
check "opencode sender told not to poll" "arrives in this session as a new user turn. End your turn now" env PEERS_SELF=opencode:ses_me python3 "$SCRIPT" send opencode:ses_abc --kind request --seq 1 --body hi
check "antigravity sender told not to poll" "Do not sleep, poll" env PEERS_SELF=antigravity:66666666-6666-6666-6666-666666666666 python3 "$SCRIPT" send opencode:ses_abc --kind request --seq 1 --body hi
check "claude without channel told to watch" "Arm one Monitor" python3 "$SCRIPT" send opencode:ses_abc --kind request --seq 1 --body hi
check "relay sender told the answer goes elsewhere" "goes to opencode:ses_boss, not to you" python3 "$SCRIPT" send opencode:ses_abc --kind request --seq 1 --reply-to opencode:ses_boss --body hi
check "no hint after an ack" "0" bash -c "python3 '$SCRIPT' send opencode:ses_abc --kind ack --seq 1 --body hi | grep -c REPLY: || true"
check "bad reply-to" "bad address" python3 "$SCRIPT" send opencode:ses_abc --kind request --seq 1 --reply-to nope --body hi
check "send antigravity" "SENT antigravity:33333333-3333-3333-3333-333333333333 via headless resume" python3 "$SCRIPT" send antigravity:33333333-3333-3333-3333-333333333333 --kind request --seq 4 --reply-to opencode:ses_boss --body "relay me"
for i in $(seq 60); do grep -q "end 4" "$PEERS_HOME/agy-timeline" 2>/dev/null && break; sleep 0.5; done
check "agy skips permissions" "--dangerously-skip-permissions" cat "$PEERS_HOME/agy-args"
check "agy prompt after -p" "PEER-REPLY-TO: opencode:ses_boss" cat "$PEERS_HOME/agy-args"
check "no reply command in messages" "0" bash -c "grep -c 'PEER-REPLY:' '$PEERS_HOME/agy-args' || true"
rm -f "$PEERS_HOME/agy-timeline"
for n in 5 6 7; do python3 "$SCRIPT" send antigravity:33333333-3333-3333-3333-333333333333 --kind notice --seq $n --body "n$n" >/dev/null; done
for i in $(seq 120); do [ "$(grep -c end "$PEERS_HOME/agy-timeline" 2>/dev/null)" = 3 ] && break; sleep 0.5; done
check "agy runs one at a time, in order" "start 5 end 5 start 6 end 6 start 7 end 7" bash -c "tr '\n' ' ' <'$PEERS_HOME/agy-timeline'"
check "agy queue drained" "0" bash -c "ls '$PEERS_HOME'/queue/antigravity-33333333-3333-3333-3333-333333333333/*.md 2>/dev/null | wc -l | tr -d ' '"
# A conversation open in an agy TUI: the presence lock holder has a terminal.
export AGY_HOME="$TMP/agy"; mkdir -p "$AGY_HOME/presence"; T=55555555-5555-5555-5555-555555555555
touch "$AGY_HOME/presence/$T.lock"
cat >"$TMP/bin/lsof" <<'EOS'
#!/bin/bash
echo 4242
EOS
cat >"$TMP/bin/ps" <<'EOS'
#!/bin/bash
[ "$*" = "-o tty= -p 4242" ] && { cat "$PEERS_HOME/tui-tty"; exit 0; }
exec /bin/ps "$@"
EOS
chmod +x "$TMP/bin/"*
# A TUI in a herdr pane: herdr's pane runs the lock holder.
echo ttys901 >"$PEERS_HOME/tui-tty"
cat >"$TMP/bin/herdr" <<'EOS'
#!/bin/bash
case "$*" in
  "session list --json") echo '{"sessions":[{"name":"main","running":true}]}' ;;
  "--session main agent list") echo '{"result":{"agents":[{"agent":"agy","pane_id":"w1:p3"}]}}' ;;
  "--session main pane process-info --pane w1:p3")
    echo '{"result":{"process_info":{"shell_pid":1,"foreground_processes":[{"pid":4242}]}}}' ;;
  "--session main agent prompt w1:p3 "*)
    [ -f "$PEERS_HOME/herdr-blocked" ] && { echo '{"error":{"code":"agent_blocked"}}' >&2; exit 1; }
    printf '%s' "${@: -1}" >"$PEERS_HOME/herdr-prompt" ;;
  *) echo "unexpected herdr call: $*" >&2; exit 9 ;;
esac
EOS
chmod +x "$TMP/bin/herdr"
check "agy TUI in herdr gets a prompt" "herdr session main pane w1:p3" python3 "$SCRIPT" send antigravity:$T --kind notice --seq 11 --body "to herdr"
check "herdr prompt is the message" "PEER-SEQ: 11" cat "$PEERS_HOME/herdr-prompt"
touch "$PEERS_HOME/herdr-blocked"
check "herdr refusal is reported" "agent_blocked" python3 "$SCRIPT" send antigravity:$T --kind notice --seq 12 --body x
cat >"$TMP/bin/herdr" <<'EOS'
#!/bin/bash
[ "$*" = "session list --json" ] && { echo '{"sessions":[]}'; exit 0; }
echo "unexpected herdr call: $*" >&2; exit 9
EOS
check "agy TUI outside herdr is refused" "outside herdr" python3 "$SCRIPT" send antigravity:$T --kind notice --seq 9 --body x
echo "??" >"$PEERS_HOME/tui-tty"
check "agy headless lock holder queues" "via headless resume" python3 "$SCRIPT" send antigravity:$T --kind notice --seq 10 --body x
INBOX="$PEERS_HOME/inbox/claude-11111111-1111-1111-1111-111111111111.md"
check "inbox content" "PEER-SEQ: 3" cat "$INBOX"
check "inbox role defaults to unassigned" "PEER-ROLE: unassigned" cat "$INBOX"
check "role header order" "PEER-ROLE: unassigned
PEER-KIND:" cat "$INBOX"
python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 20 --role lead --body r1 >/dev/null
check "role from --role" "PEER-ROLE: lead" cat "$INBOX"
PEERS_ROLE=backend python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 21 --body r2 >/dev/null
check "role from PEERS_ROLE" "PEER-ROLE: backend" cat "$INBOX"
mkdir -p "$TMP/member/repo/src" && echo '{"role": "frontend", "squad": "s"}' >"$TMP/member/.peers.json"
(cd "$TMP/member/repo/src" && python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 22 --body r3 >/dev/null)
check "role from nearest .peers.json" "PEER-ROLE: frontend" cat "$INBOX"
mkdir -p "$TMP/owned/.agents/skills/peers/scripts" && cp "$SCRIPT" "$TMP/owned/.agents/skills/peers/scripts/" && echo '{"role": "qa"}' >"$TMP/owned/.peers.json"
(cd / && python3 "$TMP/owned/.agents/skills/peers/scripts/peers.py" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 23 --body r4 >/dev/null)
check "role from the script's own member" "PEER-ROLE: qa" cat "$INBOX"
lacks "no name header without a name" "PEER-NAME" cat "$INBOX"
echo '{"role": "frontend", "squad": "s", "display_name": "Fia (frontend)"}' >"$TMP/member/.peers.json"
(cd "$TMP/member/repo/src" && python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 24 --body n1 >/dev/null)
check "name from .peers.json display_name" "PEER-ROLE: frontend
PEER-NAME: Fia (frontend)
PEER-KIND: notice
PEER-SEQ: 24" cat "$INBOX"
(cd "$TMP/member/repo/src" && python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 25 --role user --body n2 >/dev/null)
check "--role user borrows no member name" "PEER-ROLE: user
PEER-KIND: notice
PEER-SEQ: 25" cat "$INBOX"
python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 26 --role lead --name "Lena
 (lead)" --body n3 >/dev/null
check "name from --name, on one line" "PEER-ROLE: lead
PEER-NAME: Lena (lead)
PEER-KIND: notice
PEER-SEQ: 26" cat "$INBOX"
PEERS_ROLE=ops PEERS_NAME="Oki" python3 "$SCRIPT" send claude:11111111-1111-1111-1111-111111111111 --kind notice --seq 27 --body n4 >/dev/null
check "name from PEERS_NAME" "PEER-ROLE: ops
PEER-NAME: Oki" cat "$INBOX"
check "inbox end marker" "PEER-END" cat "$INBOX"
check "inbox path" "$PEERS_HOME/inbox/claude-$CLAUDE_CODE_SESSION_ID.md" python3 "$SCRIPT" inbox
check "channel config" '"channel"]' python3 "$SCRIPT" channel-config
check "channel delivers inbox as notification" "notifications/claude/channel" python3 - "$SCRIPT" <<'EOF'
import json, os, subprocess, sys, time
script = sys.argv[1]
env = dict(os.environ, PEERS_SELF="claude:44444444-4444-4444-4444-444444444444")
p = subprocess.Popen(["python3", script, "channel"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env)
p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}) + "\n")
p.stdin.flush()
init = json.loads(p.stdout.readline())
assert init["result"]["capabilities"]["experimental"]["claude/channel"] == {}, init
p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
p.stdin.flush()
time.sleep(5)
send_env = dict(os.environ, PEERS_SELF="opencode:ses_sender")
out = subprocess.run(["python3", script, "send", "claude:44444444-4444-4444-4444-444444444444", "--kind", "notice",
                      "--seq", "7", "--body", "ping"], env=send_env, capture_output=True, text=True).stdout
assert "via channel" in out, out
print(p.stdout.readline())
p.kill()
EOF
[ $fails -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
