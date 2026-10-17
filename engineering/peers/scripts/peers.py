#!/usr/bin/env python3
"""Send messages between OpenCode, Claude Code and Antigravity agent sessions on this machine.

A peer's address is <runtime>:<id>: opencode:<ses_...>, claude:<session uuid>
or antigravity:<conversation uuid>. Run `peers.py <command> --help` for the
details of one command.

Examples:
  python3 peers.py whoami
  python3 peers.py list --all-dirs
  python3 peers.py send opencode:ses_abc --kind request --seq 1 --body "Review api/."

Exit codes: 0 on success, 2 on a usage error or a failed command (the error
line says why).
"""

import argparse
import datetime
import fcntl
import glob
import json
import os
import shutil
import subprocess
import sys
import time

KINDS = ("request", "ack", "progress", "completion", "receipt", "notice")
PEERS_HOME = os.environ.get("PEERS_HOME", os.path.expanduser("~/.peers"))
SCRIPT = os.path.abspath(__file__)
RUNTIMES = ("opencode", "claude", "antigravity")
# Each runtime's own session id variable, as it sets it in its tool shells.
SELF_VARS = {"opencode": "OPENCODE_SESSION_ID", "claude": "CLAUDE_CODE_SESSION_ID",
             "antigravity": "ANTIGRAVITY_CONVERSATION_ID"}
# Process names that identify a runtime in the ancestor chain.
PROCESS_NAMES = {"opencode": "opencode", "claude": "claude", "agy": "antigravity"}
AGY_HOME = os.environ.get("AGY_HOME", os.path.expanduser("~/.gemini/antigravity-cli"))


def fail(msg, code=2):
    print(f"peers: error: {msg}", file=sys.stderr)
    sys.exit(code)


def parse_address(addr):
    runtime, sep, sid = addr.partition(":")
    if not sep or runtime not in RUNTIMES or not sid:
        fail(f"bad address {addr!r}; expected opencode:<ses_...>, claude:<uuid> or antigravity:<uuid> (see `peers.py --help`)")
    if runtime == "opencode" and not sid.startswith("ses"):
        fail(f"bad OpenCode session id {sid!r}; it must start with 'ses'")
    return runtime, sid


def innermost_runtime():
    """Runtime of the nearest ancestor process that is one of PROCESS_NAMES."""
    pid = os.getppid()
    for _ in range(40):
        try:
            out = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)],
                                 capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            return None
        if not out:
            return None
        ppid, _, comm = out.partition(" ")
        name = os.path.basename(comm.strip()).lower()
        if name in PROCESS_NAMES:
            return PROCESS_NAMES[name]
        if int(ppid) <= 1:
            return None
        pid = int(ppid)
    return None


def self_address():
    if os.environ.get("PEERS_SELF"):
        return os.environ["PEERS_SELF"]
    found = {rt: os.environ[var] for rt, var in SELF_VARS.items() if os.environ.get(var)}
    if not found:
        fail("cannot tell which session this is: none of " + ", ".join(SELF_VARS.values()) +
             " is set. Run this from inside an OpenCode, Claude Code or Antigravity session, "
             "or set PEERS_SELF=<address>.")
    if len(found) == 1:
        rt, sid = next(iter(found.items()))
        return f"{rt}:{sid}"
    # A peer launched from another runtime's shell inherits that runtime's
    # variable too; the nearest ancestor process says which session we are.
    rt = innermost_runtime()
    if rt in found:
        return f"{rt}:{found[rt]}"
    fail("cannot tell which session this is: several of " + ", ".join(SELF_VARS[r] for r in found) +
         " are set and no runtime process is among the ancestors. Set PEERS_SELF=<address>.")


def run_json(cmd):
    if not shutil.which(cmd[0]):
        return None
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        fail(f"timed out: {' '.join(cmd)}")
    if out.returncode != 0:
        fail(f"{' '.join(cmd)} failed (exit {out.returncode}): {out.stderr.strip() or out.stdout.strip()}")
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        fail(f"{' '.join(cmd)} did not print JSON: {out.stdout.strip()[:300]}")


def claude_sessions(include_done=False):
    cmd = ["claude", "agents", "--json"] + (["--all"] if include_done else [])
    return run_json(cmd) or []


def opencode_sessions():
    got = run_json(["opencode", "api", "get", "/api/session"])
    if got is None:
        return []
    items = got.get("data", got)
    active = (run_json(["opencode", "api", "get", "/api/session/active"]) or {}).get("data", {})
    for s in items:
        s["_status"] = "running" if s["id"] in active else (s.get("outcome") or "idle")
    return items


def antigravity_sessions():
    db = os.path.join(AGY_HOME, "conversation_summaries.db")
    if not os.path.exists(db):
        return []
    import sqlite3
    query = ("select conversation_id, title, preview, last_modified_time, workspace_uris, "
             "status from conversation_summaries order by last_modified_time")
    rows = None
    # agy may hold the database open for writing; an immutable read still works.
    for mode in ("mode=ro", "mode=ro&immutable=1"):
        try:
            con = sqlite3.connect(f"file:{db}?{mode}", uri=True, timeout=5)
            rows = con.execute(query).fetchall()
            con.close()
            break
        except sqlite3.Error as e:
            err = e
    if rows is None:
        print(f"peers: warning: cannot read Antigravity conversations from {db}: {err}", file=sys.stderr)
        return []
    out = []
    for cid, title, preview, modified, uris, status in rows:
        try:
            dirs = [u[len("file://"):] for u in json.loads(uris or "[]") if u.startswith("file://")]
        except json.JSONDecodeError:
            dirs = []
        status = (status or "").replace("CASCADE_RUN_STATUS_", "").lower() or "?"
        out.append({"id": cid, "title": title, "preview": preview, "modified": modified,
                    "dirs": dirs, "status": status})
    return out


def claude_live(sid):
    return any(s.get("sessionId") == sid for s in claude_sessions())


def inbox_path(address):
    runtime, sid = parse_address(address)
    return os.path.join(PEERS_HOME, "inbox", f"{runtime}-{sid}.md")


def cmd_whoami(_):
    print(self_address())


def cmd_list(args):
    cwd = os.getcwd()
    me = self_address() if any(os.environ.get(v) for v in SELF_VARS.values()) else None
    rows = []
    for s in claude_sessions(args.all):
        rows.append(("claude:" + s["sessionId"], s.get("kind", "?"), s.get("status", "?"),
                     s.get("cwd", ""), s.get("name") or ""))
    for s in opencode_sessions():
        if s.get("parentID") and not args.children:
            continue
        rows.append(("opencode:" + s["id"], "child" if s.get("parentID") else "top", s["_status"],
                     s.get("location", {}).get("directory", ""), s.get("title") or ""))
    for s in antigravity_sessions():
        rows.append(("antigravity:" + s["id"], "conversation", s["status"],
                     s["dirs"][0] if s["dirs"] else "", s["title"] or ""))
    for addr, kind, status, where, name in rows:
        if addr == me or (not args.all_dirs and where != cwd):
            continue
        print(f"{addr}  kind={kind}  status={status}  name={name!r}" + (f"  cwd={where}" if args.all_dirs else ""))


def identity_file():
    """The nearest .peers.json above the working directory or this script that names a role."""
    for d in (os.getcwd(), os.path.dirname(SCRIPT)):
        while True:
            path = os.path.join(d, ".peers.json")
            if os.path.isfile(path):
                try:
                    with open(path) as f:
                        data = json.load(f)
                    if str(data.get("role", "")).strip():
                        return data
                except (OSError, ValueError, AttributeError):
                    pass
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    return {}


def one_line(text):
    return " ".join(str(text).split())


def own_identity(role_flag=None, name_flag=None):
    # The sender's squad role: --role, then $PEERS_ROLE, then the nearest .peers.json above
    # the working directory or this script (roster builds write one per member), else "unassigned".
    # Its human-readable name: --name, then $PEERS_NAME, then that .peers.json's display_name,
    # but only when the role came from it too, so `--role user` never borrows a member's name.
    role = one_line(role_flag or "") or one_line(os.environ.get("PEERS_ROLE", ""))
    name = one_line(name_flag or "") or one_line(os.environ.get("PEERS_NAME", ""))
    if not role:
        data = identity_file()
        role = one_line(data.get("role", "")) or "unassigned"
        name = name or one_line(data.get("display_name", ""))
    return role, name


def compose(sender, role, kind, seq, body, reply_to=None, name=None):
    name_line = f"PEER-NAME: {name}\n" if name else ""
    to_line = f"PEER-REPLY-TO: {reply_to}\n" if reply_to else ""
    return (f"PEER-FROM: {sender}\nPEER-ROLE: {role}\n{name_line}PEER-KIND: {kind}\nPEER-SEQ: {seq}\n{to_line}"
            f"---\n{body.strip()}\n")


def send_opencode(sid, text):
    # Always steer: a queued prompt waits in the service and never appears in an open TUI.
    payload = json.dumps({"text": text, "delivery": "steer", "resume": True})
    got = run_json(["opencode", "api", "post", f"/api/session/{sid}/prompt", "--data", payload])
    if got is None:
        fail("opencode is not on PATH")
    msg = got.get("data", got)
    print(f"SENT opencode:{sid} delivery={msg.get('delivery', 'steer')} message={msg.get('id', '?')}")


def channel_marker(sid):
    return os.path.join(PEERS_HOME, "channels", f"claude-{sid}.pid")


def channel_listening(sid):
    try:
        pid = int(open(channel_marker(sid)).read().strip())
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def send_claude_inbox(address, text):
    path = inbox_path(address)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(text + "PEER-END\n\n")
        f.flush()
    if channel_listening(parse_address(address)[1]):
        print(f"SENT {address} via channel (it arrives in the session as a turn)")
    else:
        print(f"SENT {address} via file inbox {path} (no channel is listening; the session reads "
              "it only with an inbox watch, or when it next starts with the peers channel)")


def send_claude_resume(sid, text):
    if not shutil.which("claude"):
        fail("claude is not on PATH")
    logs = os.path.join(PEERS_HOME, "logs")
    os.makedirs(logs, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log = os.path.join(logs, f"claude-{sid}-{stamp}.json")
    # Claude peers always skip permission prompts: a headless or background
    # peer has nobody to answer them. The prompt goes on stdin so no
    # multi-value flag can swallow it.
    cmd = ["claude", "-p", "--resume", sid, "--output-format", "json",
           "--dangerously-skip-permissions"]
    with open(log, "w") as out:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=out, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        proc.stdin.write(text)
        proc.stdin.close()
    print(f"SENT claude:{sid} via headless resume pid={proc.pid} log={log}")


def antigravity_queue(cid):
    return os.path.join(PEERS_HOME, "queue", f"antigravity-{cid}")


def antigravity_tui(cid):
    """Where the conversation is open in an agy TUI: ("herdr", (session, pane)),
    ("terminal", tty) or (None, None).

    Every agy process on a conversation holds its presence lock; a TUI has a
    terminal, a headless run started by this script has none."""
    lock = os.path.join(AGY_HOME, "presence", f"{cid}.lock")
    if not os.path.exists(lock) or not shutil.which("lsof"):
        return None, None
    pids = subprocess.run(["lsof", "-t", lock], capture_output=True, text=True).stdout.split()
    ttys, tui_pids = set(), []
    for pid in pids:
        tty = subprocess.run(["ps", "-o", "tty=", "-p", pid], capture_output=True, text=True).stdout.strip()
        if tty and "?" not in tty:
            ttys.add(tty if tty.startswith("/dev/") else f"/dev/{tty}")
            tui_pids.append(pid)
    if not ttys:
        return None, None
    if shutil.which("herdr"):
        found = herdr_pane(tui_pids)
        if found:
            return "herdr", found
    return "terminal", sorted(ttys)[0]


def process_ancestors(pid):
    seen = set()
    while pid and pid not in ("0", "1") and pid not in seen:
        seen.add(pid)
        pid = subprocess.run(["ps", "-o", "ppid=", "-p", pid], capture_output=True, text=True).stdout.strip()
    return seen


def herdr_json(*args):
    out = subprocess.run(["herdr", *args], capture_output=True, text=True)
    try:
        return json.loads(out.stdout) if out.returncode == 0 else {}
    except json.JSONDecodeError:
        return {}


def herdr_pane(pids):
    """(session, pane) of the herdr pane running one of pids, or None.

    Herdr shows no pane ttys, so the match is by process: the pane's shell or
    foreground process is the agy process or one of its ancestors."""
    ancestors = set().union(*(process_ancestors(pid) for pid in pids))
    for session in herdr_json("session", "list", "--json").get("sessions", []):
        if not session.get("running"):
            continue
        name = session["name"]
        agents = herdr_json("--session", name, "agent", "list").get("result", {}).get("agents", [])
        for agent in agents:
            if agent.get("agent") != "agy":
                continue
            info = herdr_json("--session", name, "pane", "process-info", "--pane", agent["pane_id"])
            info = info.get("result", {}).get("process_info", {})
            owned = {str(info.get("shell_pid"))} | {str(p.get("pid")) for p in info.get("foreground_processes", [])}
            if owned & ancestors:
                return name, agent["pane_id"]
    return None


def tui_label(pane):
    return f"herdr session {pane[0]} pane {pane[1]}"


def paste_into_tui(cid, pane, text):
    # herdr agent prompt pastes with the pane's bracketed-paste mode, so the
    # message's newlines do not submit it early, then presses Enter; a busy agy
    # queues it until its turn ends. The lock keeps concurrent senders in order.
    lockdir = antigravity_queue(cid)
    os.makedirs(lockdir, exist_ok=True)
    with open(os.path.join(lockdir, ".paste.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        session, pane_id = pane
        out = subprocess.run(["herdr", "--session", session, "agent", "prompt", pane_id, text.rstrip("\n")],
                             capture_output=True, text=True)
        if out.returncode != 0:
            raise RuntimeError(f"herdr agent prompt failed: {(out.stderr or out.stdout).strip()}")


def send_antigravity(cid, text):
    where, pane = antigravity_tui(cid)
    if where == "herdr":
        try:
            paste_into_tui(cid, pane, text)
        except RuntimeError as e:
            fail(f"antigravity:{cid} is open in an agy TUI ({tui_label(pane)}) but the message did not "
                 f"reach it: {e}; look at that pane, since agy may be waiting on a dialog")
        print(f"SENT antigravity:{cid} into its live agy TUI ({tui_label(pane)}; "
              "it queues while agy is busy)")
        return
    if where == "terminal":
        fail(f"antigravity:{cid} is open in an agy TUI on {pane}, outside herdr, so a message cannot "
             "reach it and a headless run would interleave with it; ask the user to close it there, or to run "
             "it in herdr")
    if not shutil.which("agy"):
        fail("agy is not on PATH")
    # Concurrent runs on one conversation interleave their turns, so messages
    # are spooled and one drainer per conversation runs them in order.
    qdir = antigravity_queue(cid)
    os.makedirs(qdir, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    entry = os.path.join(qdir, f"{stamp}.md")
    with open(entry + ".tmp", "w") as f:
        f.write(text)
    os.rename(entry + ".tmp", entry)
    proc = subprocess.Popen([sys.executable, SCRIPT, "_drain-antigravity", cid], stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    log = os.path.join(PEERS_HOME, "logs", f"antigravity-{cid}-{stamp}.json")
    print(f"SENT antigravity:{cid} via headless resume (queued behind any run in progress) "
          f"drainer={proc.pid} log={log}")


def cmd_drain_antigravity(args):
    cid = args.cid
    qdir = antigravity_queue(cid)
    logs = os.path.join(PEERS_HOME, "logs")
    os.makedirs(logs, exist_ok=True)
    lock = open(os.path.join(qdir, ".lock"), "w")
    pending = lambda: sorted(glob.glob(os.path.join(qdir, "*.md")))
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return  # the drainer holding the lock takes this message next
        try:
            while (entries := pending()):
                entry = entries[0]
                text = open(entry).read()
                where, pane = antigravity_tui(cid)
                if where == "herdr":  # opened in a TUI meanwhile: deliver there instead
                    paste_into_tui(cid, pane, text)
                    os.remove(entry)
                    continue
                stamp = os.path.basename(entry)[:-3]
                # Antigravity peers always skip permission prompts: nobody can
                # answer them. -p takes the prompt as its value, so it goes last.
                cmd = ["agy", "--conversation", cid, "--dangerously-skip-permissions",
                       "--output-format", "json", "-p", text]
                log = os.path.join(logs, f"antigravity-{cid}-{stamp}.json")
                with open(log[:-5] + ".prompt.md", "w") as f:  # the turn's input, for diagnostics
                    f.write(text)
                with open(log, "w") as out:
                    subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT)
                os.remove(entry)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
        if not pending():  # a message spooled while unlocking needs another pass
            return


def cmd_send(args):
    runtime, sid = parse_address(args.target)
    if args.kind not in KINDS:
        fail(f"bad kind {args.kind!r}; use one of {', '.join(KINDS)} (see `peers.py send --help`)")
    body = args.body if args.body is not None else sys.stdin.read()
    if not body.strip():
        fail("empty message body; pass --body TEXT or pipe the body on stdin (see `peers.py send --help`)")
    sender = self_address()
    if sender == args.target:
        fail("refusing to send a message to yourself")
    if args.reply_to:
        parse_address(args.reply_to)
    role, name = own_identity(args.role, args.name)
    text = compose(sender, role, args.kind, args.seq, body, args.reply_to, name)
    if runtime == "opencode":
        send_opencode(sid, text)
    elif runtime == "antigravity":
        send_antigravity(sid, text)
    # A listening channel proves the session is live; check it before asking claude.
    elif channel_listening(sid) or claude_live(sid):
        send_claude_inbox(args.target, text)
    else:
        send_claude_resume(sid, text)
    if args.reply_to:
        print(f"REPLY: the answer goes to {args.reply_to}, not to you. End your turn now; do not wait for it.")
    elif args.kind in ("request", "notice", "completion"):
        print(reply_hint(sender))


def reply_hint(sender):
    """How the reply reaches the sender, so it ends its turn instead of polling for it."""
    runtime, sid = parse_address(sender)
    stop = ("End your turn now. Do not sleep, poll, loop, re-read the inbox, list sessions or start a "
            "background task or timer to wait for it.")
    if runtime == "opencode":
        return f"REPLY: the answer arrives in this session as a new user turn. {stop}"
    if runtime == "antigravity":
        return (f"REPLY: the answer is pushed into this conversation as a new user turn, typed into your agy "
                f"TUI or run as a new turn after this one ends. {stop}")
    if channel_listening(sid):
        return f"REPLY: the answer arrives in this session through the peers channel as a new turn. {stop}"
    return ("REPLY: this session has no peers channel; the answer lands in its file inbox. Arm one Monitor "
            f"watch on `python3 {SCRIPT} watch` if none is armed, then end your turn; do not poll.")


def cmd_inbox(_):
    path = inbox_path(self_address())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "a").close()
    print(path)


def cmd_watch(_):
    path = inbox_path(self_address())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "a").close()
    os.execvp("tail", ["tail", "-n0", "-F", path])


def claude_ancestor_session():
    """Session id of the nearest claude ancestor, from Claude's session registry."""
    if os.environ.get("PEERS_SELF", "").startswith("claude:"):
        return os.environ["PEERS_SELF"].split(":", 1)[1]
    pid = os.getppid()
    for _ in range(40):
        out = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)],
                             capture_output=True, text=True).stdout.strip()
        if not out:
            break
        ppid, _, comm = out.partition(" ")
        if os.path.basename(comm.strip()).lower() == "claude":
            try:
                with open(os.path.expanduser(f"~/.claude/sessions/{pid}.json")) as f:
                    return json.load(f).get("sessionId")
            except (OSError, json.JSONDecodeError):
                break
        if int(ppid) <= 1:
            break
        pid = int(ppid)
    return os.environ.get("CLAUDE_CODE_SESSION_ID")


CHANNEL_INSTRUCTIONS = (
    "Messages from peer agent sessions (OpenCode, Claude Code, Antigravity) arrive as "
    "<channel source=\"peers\"> events. Each one starts with PEER-FROM, PEER-ROLE, PEER-KIND and "
    "PEER-SEQ headers; PEER-ROLE is the sender's role in your squad, and PEER-NAME, when present, its "
    "human-readable name. Treat it as a request from a "
    "teammate, not from the user. Answer with your peers skill's send command, to PEER-REPLY-TO "
    "when present, otherwise to PEER-FROM, reusing PEER-SEQ; never answer an ack or a receipt.")


def cmd_channel(_):
    import threading
    import time
    out_lock = threading.Lock()

    def emit(msg):
        with out_lock:
            sys.stdout.write(json.dumps(msg) + "\n")
            sys.stdout.flush()

    def deliver_loop():
        sid, offset = None, 0
        while True:
            cur = claude_ancestor_session()
            if cur and cur != sid:
                if sid:
                    try:
                        os.remove(channel_marker(sid))
                    except OSError:
                        pass
                sid = cur
                os.makedirs(os.path.dirname(channel_marker(sid)), exist_ok=True)
                with open(channel_marker(sid), "w") as f:
                    f.write(str(os.getpid()))
                path = inbox_path("claude:" + sid)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, "a").close()
                state = channel_marker(sid)[:-4] + ".offset"
                try:
                    offset = int(open(state).read())
                except (OSError, ValueError):
                    offset = os.path.getsize(path)
            if sid:
                with open(path) as f:
                    f.seek(offset)
                    data = f.read()
                while "PEER-END\n" in data:
                    block, _, data = data.partition("PEER-END\n")
                    offset += len(block.encode()) + len("PEER-END\n")
                    block = block.strip()
                    if block:
                        meta = {}
                        for line in block.splitlines():
                            if line == "---":
                                break
                            k, _, v = line.partition(": ")
                            if k in ("PEER-FROM", "PEER-ROLE", "PEER-NAME", "PEER-KIND", "PEER-SEQ", "PEER-REPLY-TO"):
                                meta[k[5:].lower().replace("-", "_")] = v
                        emit({"jsonrpc": "2.0", "method": "notifications/claude/channel",
                              "params": {"content": block, "meta": meta}})
                    with open(state, "w") as f:
                        f.write(str(offset))
            time.sleep(1)

    started = False
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        method, rid = req.get("method"), req.get("id")
        if method == "initialize":
            emit({"jsonrpc": "2.0", "id": rid, "result": {
                "protocolVersion": (req.get("params") or {}).get("protocolVersion", "2025-06-18"),
                "capabilities": {"experimental": {"claude/channel": {}}, "tools": {}},
                "serverInfo": {"name": "peers", "version": "1"},
                "instructions": CHANNEL_INSTRUCTIONS}})
        elif method == "notifications/initialized":
            if not started:
                started = True
                threading.Thread(target=deliver_loop, daemon=True).start()
        elif method == "tools/list":
            emit({"jsonrpc": "2.0", "id": rid, "result": {"tools": []}})
        elif method == "ping":
            emit({"jsonrpc": "2.0", "id": rid, "result": {}})
        elif rid is not None:
            emit({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"unknown method {method}"}})


def cmd_channel_config(_):
    print(json.dumps({"mcpServers": {"peers": {"command": "python3", "args": [SCRIPT, "channel"]}}}))


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def cmd_show(args):
    runtime, sid = parse_address(args.target)
    turns = []
    if runtime == "antigravity":
        # Its turns are stored as protobuf; the summary keeps a text preview.
        match = [s for s in antigravity_sessions() if s["id"] == sid]
        if not match:
            fail(f"no Antigravity conversation {sid} in {AGY_HOME}")
        s = match[0]
        print(f"title: {s['title']}\nstatus: {s['status']}\nmodified: {s['modified']}\npreview: {s['preview'][:1200]}")
        return
    if runtime == "opencode":
        got = run_json(["opencode", "api", "get", f"/api/session/{sid}/message"]) or {}
        items = sorted(got.get("data", got) or [], key=lambda m: (m.get("time") or {}).get("created", 0))
        for m in items:
            kind = m.get("type")
            if kind not in ("user", "assistant"):
                continue
            txt = m.get("text") or (m.get("payload") or {}).get("text") or text_of(m.get("content"))
            turns.append((kind, txt))
    else:
        files = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{sid}.jsonl"))
        if not files:
            fail(f"no transcript found for claude:{sid}")
        with open(files[0]) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if d.get("type") in ("user", "assistant") and isinstance(d.get("message"), dict):
                    txt = text_of(d["message"].get("content"))
                    if txt.strip():
                        turns.append((d["type"], txt))
    for kind, txt in turns[-args.last:]:
        print(f"{kind}: {str(txt).strip()[:400]}")


class Parser(argparse.ArgumentParser):
    """Prints help with its examples verbatim, and points to --help on a usage error."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("formatter_class", argparse.RawDescriptionHelpFormatter)
        super().__init__(*args, **kwargs)

    def error(self, message):
        print(f"{self.prog}: error: {message}\nRun `{self.prog} --help` for usage.", file=sys.stderr)
        sys.exit(2)


def command(sub, name, summary, details, examples):
    return sub.add_parser(name, help=summary, description=f"{summary}\n\n{details.strip()}",
                          epilog="Examples:\n" + "\n".join(f"  {e}" for e in examples))


def main():
    p = Parser(prog="peers.py", description=__doc__.split("\n\n", 1)[0],
               epilog=__doc__.split("\n\n", 1)[1])
    sub = p.add_subparsers(dest="cmd", required=True, metavar="<command>",
                           parser_class=Parser)

    s = command(sub, "whoami", "Print this session's peer address.", """
Reads OPENCODE_SESSION_ID, CLAUDE_CODE_SESSION_ID or ANTIGRAVITY_CONVERSATION_ID;
when several are set, the nearest runtime process among the ancestors decides.
$PEERS_SELF=<address> overrides them all.
Output: one line, the address. Fails (exit 2) outside an agent session.""",
                ["python3 peers.py whoami"])
    s.set_defaults(fn=cmd_whoami)

    s = command(sub, "list", "List peer sessions of every runtime.", """
By default only sessions whose directory is the current directory, without
your own session, finished Claude background sessions or OpenCode child sessions.
Output: one line per session: address, kind, status and name (and cwd with
--all-dirs). Nothing is printed when no session matches.""",
                ["python3 peers.py list", "python3 peers.py list --all-dirs --all"])
    s.add_argument("--all-dirs", action="store_true", help="include sessions in every directory, and show each one's cwd")
    s.add_argument("--all", action="store_true", help="include finished Claude background sessions")
    s.add_argument("--children", action="store_true", help="include OpenCode child sessions")
    s.set_defaults(fn=cmd_list)

    s = command(sub, "send", "Send one peer message to another session.", f"""
Adds the PEER-FROM, PEER-ROLE, PEER-KIND, PEER-SEQ (and PEER-NAME, PEER-REPLY-TO) headers
to the body and routes it by the target's runtime: steered into an OpenCode
session, into a live Claude session's file inbox, as a headless resume of a
stopped Claude session, typed into an agy TUI in herdr, or as a headless agy run.
Output: a SENT line saying how it went, then for a request, notice or
completion a REPLY line saying how the answer will reach you.
Fails (exit 2) on a bad address or kind, an empty body, a send to yourself,
or a runtime CLI that is missing or fails.""",
                ["python3 peers.py send opencode:ses_abc --kind request --seq 1 --body \"Summarize README.md.\"",
                 "python3 peers.py send claude:<uuid> --kind completion --seq 1 < result.md",
                 "python3 peers.py send antigravity:<uuid> --kind request --seq 2 --reply-to opencode:ses_boss --body \"...\""])
    s.add_argument("target", help="the receiver's address, such as opencode:ses_abc")
    s.add_argument("--kind", required=True, metavar="KIND", help=f"message kind, one of: {', '.join(KINDS)}")
    s.add_argument("--seq", required=True, type=int, metavar="N",
                   help="exchange number: reuse the request's number for every reply in its exchange")
    s.add_argument("--body", metavar="TEXT", help="message body (default: read from stdin)")
    s.add_argument("--reply-to", metavar="ADDRESS",
                   help="address the receiver must answer, when not you (default: none; the receiver answers you)")
    s.add_argument("--role", metavar="ROLE",
                   help="your role in the squad (default: $PEERS_ROLE, then the nearest .peers.json, else \"unassigned\")")
    s.add_argument("--name", metavar="NAME",
                   help="your human-readable name, sent as PEER-NAME (default: $PEERS_NAME, then the display_name "
                        "in the .peers.json that gave your role, else no PEER-NAME header)")
    s.set_defaults(fn=cmd_send)

    s = command(sub, "inbox", "Print this session's file inbox path, creating the file if needed.", """
A live Claude Code session receives messages from other runtimes in this file.
Output: one line, the path.""", ["python3 peers.py inbox"])
    s.set_defaults(fn=cmd_inbox)

    s = command(sub, "watch", "Stream new messages from this session's file inbox.", """
For a Claude Code session without the peers channel: run it as a Monitor
command. It never exits on its own; each message ends with a PEER-END line.""",
                ["python3 peers.py watch"])
    s.set_defaults(fn=cmd_watch)

    s = command(sub, "channel", "Run the peers channel: an MCP stdio server for Claude Code.", """
Claude Code starts it from --mcp-config or .mcp.json; it pushes each new
file-inbox message into the session as a turn. Do not run it by hand: it
speaks JSON-RPC on stdin and stdout until stdin closes.""",
                ["claude --mcp-config \"$(python3 peers.py channel-config)\" --dangerously-load-development-channels server:peers"])
    s.set_defaults(fn=cmd_channel)

    s = command(sub, "channel-config", "Print the --mcp-config JSON that loads the peers channel.", """
Output: one line of JSON for `claude --mcp-config`.""", ["python3 peers.py channel-config"])
    s.set_defaults(fn=cmd_channel_config)

    s = command(sub, "show", "Print the last turns of a session.", """
OpenCode and Claude: one line per turn, cut to 400 characters. Antigravity
stores turns as protobuf, so it prints the title, status and preview instead.
Fails (exit 2) when the session or its transcript does not exist.""",
                ["python3 peers.py show opencode:ses_abc", "python3 peers.py show claude:<uuid> --last 10"])
    s.add_argument("target", help="the session's address")
    s.add_argument("--last", type=int, default=6, metavar="N", help="number of turns to print (default: 6)")
    s.set_defaults(fn=cmd_show)

    # Internal: started by send to run spooled Antigravity messages in order; hidden from help.
    s = sub.add_parser("_drain-antigravity")
    s.add_argument("cid")
    s.set_defaults(fn=cmd_drain_antigravity)
    sub._choices_actions = [a for a in sub._choices_actions if a.dest != "_drain-antigravity"]

    args = p.parse_args()
    args.fn(args)

if __name__ == "__main__":
    main()
