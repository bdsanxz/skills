#!/usr/bin/env python3
"""Check, build and launch a squad of peer agents from <workspace>/roster.json.

The workspace holds roster.json and one directory per member, each with the
member's PROJECT.md, ROLE.md, COMMUNICATIONS.md and MEMORY.md. Each member
runs one agent (claude, opencode or agy) with one model and one effort
level. Run `roster.py <command> --help` for the details of one command.

Each member has a member name ("name": kebab-case, also its cwd, and what
reports_to, talks_to, --member and the PEER-ROLE header use) and may have a
human-readable "display_name" (1-48 characters on one line, unique in the
squad, such as "Rina (backend)"). Without one, the member name is shown.
The display name appears in each member's instruction file and squad
directory, in .peers.json (peers sends it as PEER-NAME), in check's MEMBER
lines, and at launch as the herdr pane label and the session's title.

Agent, model and effort, highest precedence first:
  agent: --agent MEMBER=AGENT (check, launch), the member's "agent",
         the roster's "defaults": {"agent": ...}, then claude.
  model: --model MEMBER=MODEL (check, launch), the member's "model" (only
         while the member runs the agent it was written for), the roster's
         "defaults": {"models": {"<agent>": ...}}, then no model at all:
         the agent starts with its own default model.
  effort: --effort MEMBER=LEVEL (check, launch), the member's "effort", the
         roster's "defaults": {"effort": ...}, then no level at all: the
         agent uses its own default effort for the model.

How launch applies them: claude --model and --effort; agy --model and
--effort; opencode, whose TUI takes neither flag, through OpenCode's API:
launch creates the member's session (session.create), opens the TUI on it
(--session), sets the model with the effort as its variant
(session.switchModel), reads the session back to confirm, and only then sends
the first prompt. An opencode member without a model starts plain and uses
its own opencode.json or /models; roster.py never writes opencode.json.

Effort levels are low, medium, high, xhigh and max: claude takes every level
for every model; opencode the model's variants that are levels (from
`opencode api model.list`); agy the levels `agy models` lists for the model.
opencode and agy need a model for an effort level, to check it. A level the
member's own "effort" or --effort names that its agent and model do not
support is an error. A level from defaults.effort moves to the nearest level
the member supports (the lower one on a tie), or to none when it supports
none; check prints a NOTE.

Examples:
  python3 roster.py check ~/squads/shop
  python3 roster.py build ~/squads/shop
  python3 roster.py launch ~/squads/shop --dry-run
  python3 roster.py launch ~/squads/shop --agent web=opencode --model web=opencode/beam-free
  python3 roster.py launch ~/squads/shop --effort lead=max --effort web=low

A mixed team in roster.json: a Claude lead on opus at high effort, an
OpenCode member on beam-free at low effort, an OpenCode member on whatever
its opencode.json or /models sets, and an agy member on Gemini Flash at
medium effort:
  "members": [
    {"name": "lead", "display_name": "Lena (lead)", "agent": "claude", "model": "opus", "effort": "high", ...},
    {"name": "api", "display_name": "Rina (backend)", "agent": "opencode", "model": "opencode/beam-free", "effort": "low", ...},
    {"name": "docs", "agent": "opencode", ...},
    {"name": "web", "agent": "agy", "model": "gemini-3.8-flash", "effort": "medium", ...}]

Layout: the whole squad lives in one herdr workspace, squad-<squad>. A window
is one tab of it, labelled "<squad> <n>", and holds at most MEMBERS_PER_WINDOW
members. Window 1 puts the supervisor, the member that reports to "user",
in a pane across the top, SUPERVISOR_SHARE of its height, and the
members below it in the hierarchy side by side underneath. The members that do
not fit fill further windows of the same workspace, in hierarchy order (steps
of reports_to from "user", then roster order), in rows of at most
MEMBERS_PER_ROW panes; no window is left with a lone member, whose pane
would be larger than the supervisor's. The three settings sit at the top of
roster.py's Layout section, and plan_layout() is the one place that places
members. check and launch print one WINDOW line per window and validate the
layout first: every member in exactly one window, no window over the limit,
and the supervisor alone on top with the largest pane; a failed check is a
`PROBLEM layout: ...` line. The settings now: {settings}.

Exit codes: 0 on success, 1 when the roster has problems or a step fails
(the output says why), 2 on a usage error.
"""
import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time

SCRIPT = os.path.abspath(__file__)
PARTS = (("PROJECT.md", "Project"), ("ROLE.md", "Role"),
         ("COMMUNICATIONS.md", "Communications"), ("MEMORY.md", "Memory"))
MARKER = "<!-- generated by peers-roster-design"
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
# The peers skill sits next to this skill, both in this repository and
# where installers put skills; roster.json can name another source.
DEFAULT_PEERS = os.path.normpath(os.path.join(os.path.dirname(SCRIPT), "..", "..", "peers"))
DEFAULT_AGENT = "claude"
# Effort levels, lowest first: the levels claude --effort and agy --effort take.
LEVELS = ("low", "medium", "high", "xhigh", "max")
FIRST_PROMPT = "Read your instructions, then wait for messages from your squad."
WAIT_MS = "60000"


def fail(msg):
    print(f"roster: error: {msg}", file=sys.stderr)
    sys.exit(1)


class LaunchError(Exception):
    pass


# ---------------------------------------------------------------------------
# Agents. Everything that differs between agents is in AGENTS and the
# functions it names; to add an agent, add an entry and its two functions.
# ---------------------------------------------------------------------------

def configure_claude(workspace, d, m):
    """Load the peers channel at project scope, approved so it starts without a prompt."""
    peers = peers_command()

    def add_server(data):
        data.setdefault("mcpServers", {})["peers"] = {
            "type": "stdio", "command": peers, "args": ["channel"], "env": {}}

    def approve(data):
        enabled = data.setdefault("enabledMcpjsonServers", [])
        if "peers" not in enabled:
            enabled.append("peers")
        disabled = data.get("disabledMcpjsonServers", [])
        if "peers" in disabled:
            disabled.remove("peers")

    merge_json(os.path.join(d, ".mcp.json"), add_server)
    # Project servers wait for approval unless the project settings enable them.
    merge_json(os.path.join(d, ".claude", "settings.local.json"), approve)
    return f"configured the peers channel in {os.path.join(d, '.mcp.json')} (approved in .claude/settings.local.json)"


def configure_nothing(workspace, d, m):
    return None


def launch_claude(h, m, pane, name, d):
    cmd = ["claude", "--dangerously-skip-permissions", "-n", session_label(m, name)]
    if m["model"]:
        cmd += ["--model", m["model"]]
    if m["effort"]:
        cmd += ["--effort", m["effort"]]
    # Keep the "--": the channels flag takes several values and would swallow the prompt.
    cmd += ["--dangerously-load-development-channels", "server:peers", "--", FIRST_PROMPT]
    h.run("pane", "run", pane, shlex.join(cmd))
    # Claude asks to trust a new folder, then to confirm the development channel.
    h.run("pane", "wait-output", pane, "--regex", "Yes, I trust this folder|local development", "--timeout", WAIT_MS)
    if h.dry_run or "Yes, I trust this folder" in h.text("pane", "read", pane, "--source", "visible"):
        # "No, exit" is preselected; the member cwd is one the roster names.
        h.run("pane", "send-keys", pane, "down", "enter", note="only when Claude asks to trust the folder")
        h.run("pane", "wait-output", pane, "--match", "local development", "--timeout", WAIT_MS,
              note="only when Claude asked to trust the folder")
    h.run("pane", "send-keys", pane, "enter")
    h.run("pane", "wait-output", pane, "--match", "inject directly", "--timeout", WAIT_MS)


def launch_opencode(h, m, pane, name, d):
    # The OpenCode TUI takes no model or effort flag. With a model in the roster, launch
    # creates the member's session, opens the TUI on it, and sets the model, with the
    # effort as its variant, through OpenCode's API before the first prompt. Without
    # one, OpenCode uses its own opencode.json or /models.
    if not m["model"]:
        h.start_agent(name, "opencode", pane, [])
        h.first_prompt(name, pane, AGENTS["opencode"]["dialogs"])
        return
    created = h.opencode_api(d, "session.create", data={"title": f"{session_label(m, name)} (peers squad member)",
                                                        "location": {"directory": d}})
    session = created["data"]["id"]
    h.start_agent(name, "opencode", pane, ["--session", session])
    h.settle(name, pane)
    provider, _, model_id = m["model"].partition("/")
    model = {"providerID": provider, "id": model_id, **({"variant": m["effort"]} if m["effort"] else {})}
    h.opencode_api(d, "session.switchModel", params={"sessionID": session}, data={"model": model})
    # switchModel accepts any name, so read the session back: check validated the model and variant.
    now = h.opencode_api(d, "session.get", params={"sessionID": session})["data"].get("model") or {}
    want = (provider, model_id, m["effort"] or "default")
    if not h.dry_run and (now.get("providerID"), now.get("id"), now.get("variant") or "default") != want:
        raise LaunchError(f"OpenCode session {session} reports model {now}, not {m['model']} "
                          f"with variant {m['effort'] or 'default'}")
    h.first_prompt(name, pane, AGENTS["opencode"]["dialogs"])


def launch_agy(h, m, pane, name, d):
    args = ["--dangerously-skip-permissions"] + (["--model", m["model"]] if m["model"] else []) \
        + (["--effort", m["effort"]] if m["effort"] else [])
    h.start_agent(name, "agy", pane, args, allow_not_ready=True)
    h.first_prompt(name, pane, AGENTS["agy"]["dialogs"])


# launch_settings: whether launch can set the agent's model and effort level. When
# it is False, the agent manages both itself, as settings_note says, and a model or
# effort set for its members is ignored with a warning.
AGENTS = {
    "claude": {
        "label": "Claude Code", "command": "claude", "peers_runtime": "claude",
        "instructions": "CLAUDE.md", "imports": True,
        "skills_dir": os.path.join(".claude", "skills"), "skills_cli": "claude-code",
        "model_pattern": r"^(default|fable|opus|sonnet|haiku|opusplan)(\[1m\])?$|^claude-[a-z0-9.-]+(\[1m\])?$",
        "model_hint": "an alias (fable, opus, sonnet, haiku) or a full name such as claude-sonnet-5-5",
        "list_models": None,
        "launch_settings": True,
        "configure": configure_claude, "launch": launch_claude,
    },
    "opencode": {
        "label": "OpenCode", "command": "opencode", "peers_runtime": "opencode",
        "instructions": "AGENTS.md", "imports": False,
        "skills_dir": os.path.join(".agents", "skills"), "skills_cli": "opencode",
        "model_pattern": r"^[^/\s#]+/[^\s#]+$",
        "model_hint": "provider/model, as `opencode models` lists it",
        "list_models": ["opencode", "models"],
        # The TUI takes neither as a flag: launch_opencode sets both through OpenCode's API.
        "launch_settings": True,
        "dialogs": [],
        "configure": configure_nothing, "launch": launch_opencode,
    },
    "agy": {
        "label": "Antigravity CLI", "command": "agy", "peers_runtime": "antigravity",
        "instructions": "AGENTS.md", "imports": False,
        "skills_dir": os.path.join(".agents", "skills"), "skills_cli": "antigravity",
        "model_pattern": r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "model_hint": "a model id from `agy models`",
        "list_models": ["agy", "models"],
        "launch_settings": True,
        # Shown before agy takes its first prompt: the folder-trust question ("Yes" is
        # preselected) and one-time notices that wait for Esc.
        "dialogs": [("trust", ["enter"]), ("esc to dismiss", ["esc"])],
        "configure": configure_nothing, "launch": launch_agy,
    },
}
# Older rosters name the agent in "runtime", and agy as "antigravity".
LEGACY_AGENTS = {"antigravity": "agy"}
_model_lists = {}


def available_models(agent):
    """(set of model ids, None), or (None, why they cannot be listed)."""
    cmd = AGENTS[agent]["list_models"]
    if not cmd:
        return None, None
    if agent not in _model_lists:
        if not shutil.which(cmd[0]):
            _model_lists[agent] = (None, f"`{cmd[0]}` is not on PATH")
        else:
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
                ids = {line.split()[0] for line in out.stdout.splitlines()
                       if line.strip() and not line.startswith("Fetching")}
                _model_lists[agent] = (ids, None) if out.returncode == 0 and ids else \
                    (None, f"`{' '.join(cmd)}` failed: {(out.stderr or out.stdout).strip()[-300:]}")
            except subprocess.TimeoutExpired:
                _model_lists[agent] = (None, f"`{' '.join(cmd)}` timed out")
    return _model_lists[agent]


_variants = {}


def opencode_variants():
    """({provider/model: [variant, ...]}, None), or (None, why they cannot be listed)."""
    if "all" not in _variants:
        cmd = ["opencode", "api", "model.list"]
        if not shutil.which("opencode"):
            _variants["all"] = (None, "`opencode` is not on PATH")
        else:
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
                data = json.loads(out.stdout)["data"]
                _variants["all"] = ({f"{x['providerID']}/{x['id']}": [v["id"] if isinstance(v, dict) else v
                                                                     for v in x.get("variants") or []]
                                     for x in data}, None)
            except (subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
                _variants["all"] = (None, f"`{' '.join(cmd)}` printed no model list; is OpenCode's background "
                                          "service running (`opencode service status`)?")
    return _variants["all"]


def effort_levels(e):
    """(levels the member's agent and model support, None), or (None, why they cannot be known)."""
    if e["agent"] == "claude":
        return set(LEVELS), None  # claude --effort takes every level for every model
    if not e["model"]:
        return None, (f"{e['agent']} needs a model to check an effort level against; "
                      "set the member's model, or leave the effort out")
    if e["agent"] == "opencode":
        variants, why = opencode_variants()
        if variants is None:
            return None, why
        return {v for v in variants.get(e["model"], []) if v in LEVELS}, None
    ids, why = available_models("agy")
    if ids is None:
        return None, why
    # agy lists one id per model and level, such as gemini-3.8-flash-low. The base name
    # takes any of its levels through --effort; a full id takes only its own level.
    families = {}
    for i in ids:
        base, _, level = i.rpartition("-")
        if base and level in LEVELS:
            families.setdefault(base, set()).add(level)
    if e["model"] in families:
        return families[e["model"]], None
    base, _, level = e["model"].rpartition("-")
    return ({level} if base in families and level in LEVELS else set()), None


def nearest(level, supported):
    """The supported level closest to level, the lower one on a tie."""
    i = LEVELS.index(level)
    return min(supported, key=lambda x: (abs(LEVELS.index(x) - i), LEVELS.index(x)))


# ---------------------------------------------------------------------------
# Roster
# ---------------------------------------------------------------------------

def load_roster(workspace):
    path = os.path.join(workspace, "roster.json")
    if not os.path.isfile(path):
        fail(f"{path} does not exist; write the roster first")
    try:
        roster = json.load(open(path))
    except json.JSONDecodeError as e:
        fail(f"{path} is not valid JSON: {e}")
    return roster


def resolve(roster, overrides):
    """Each member with its effective "agent", "model" and "effort", and where each came from."""
    defaults = roster.get("defaults") or {}
    out = []
    for m in roster["members"]:
        e = dict(m)
        own = m.get("agent") or defaults.get("agent") or DEFAULT_AGENT
        e["agent_from"] = ("member" if m.get("agent") else
                           "defaults.agent" if defaults.get("agent") else "built-in default")
        e["agent"] = overrides["agent"].get(m["name"], own)
        if m["name"] in overrides["agent"]:
            e["agent_from"] = "--agent"
        default_model = (defaults.get("models") or {}).get(e["agent"])
        if m["name"] in overrides["model"]:
            e["model"], e["model_from"] = overrides["model"][m["name"]], "--model"
        elif m.get("model") and e["agent"] == own:
            e["model"], e["model_from"] = m["model"].strip(), "member"
        elif default_model:
            e["model"], e["model_from"] = default_model.strip(), f"defaults.models.{e['agent']}"
        else:
            e["model"], e["model_from"] = None, "none set"
        e["dropped_model"] = m.get("model") if (m.get("model") and e["agent"] != own) else None
        if m["name"] in overrides["effort"]:
            e["effort"], e["effort_from"] = overrides["effort"][m["name"]], "--effort"
        elif m.get("effort"):
            e["effort"], e["effort_from"] = m["effort"], "member"
        elif defaults.get("effort"):
            e["effort"], e["effort_from"] = defaults["effort"], "defaults.effort"
        else:
            e["effort"], e["effort_from"] = None, "none set"
        e["ignored"] = []
        if not AGENTS.get(e["agent"], {}).get("launch_settings", True):
            # The agent takes no model or effort at launch. A value meant for it is reported;
            # defaults.effort is meant for the whole squad, so it just does not apply.
            for key in ("model", "effort"):
                if e[key] and e[f"{key}_from"] != "defaults.effort":
                    e["ignored"].append(f"{key} {e[key]!r} ({e[f'{key}_from']})")
                e[key], e[f"{key}_from"] = None, "managed by the agent"
            e["dropped_model"] = None
        out.append(e)
    return out


def shown(e):
    return f" ({display(e)})" if e.get("display_name") else ""


def describe(e):
    if not AGENTS[e["agent"]]["launch_settings"]:
        return f"agent {e['agent']} ({e['agent_from']}), model and effort managed by {AGENTS[e['agent']]['label']}"
    model = (f"model {e['model']} ({e['model_from']})" if e["model"]
             else "the agent's own default model (no model set)")
    effort = (f"effort {e['effort']} ({e['effort_from']})" if e["effort"]
              else "the agent's own default effort (no effort set)")
    return f"agent {e['agent']} ({e['agent_from']}), {model}, {effort}"


def structure_problems(roster, overrides):
    problems = []
    if not isinstance(roster, dict):
        return ["roster.json must be an object with \"squad\", \"goal\" and \"members\""]
    for key in ("squad", "goal"):
        if not isinstance(roster.get(key), str) or not roster[key].strip():
            problems.append(f"roster.json: \"{key}\" must be a non-empty string")
    agents = ", ".join(AGENTS)
    defaults = roster.get("defaults", {})
    levels = ", ".join(LEVELS)
    if not isinstance(defaults, dict) or set(defaults) - {"agent", "models", "effort"}:
        problems.append("roster.json: \"defaults\" must be an object with \"agent\", \"models\" and/or \"effort\"")
    else:
        if "effort" in defaults and defaults["effort"] not in LEVELS:
            problems.append(f"roster.json: defaults.effort {defaults['effort']!r} is not an effort level; use one of {levels}")
        if "agent" in defaults and defaults["agent"] not in AGENTS:
            problems.append(f"roster.json: defaults.agent {defaults['agent']!r} is not an agent; use one of {agents}")
        models = defaults.get("models", {})
        if not isinstance(models, dict):
            problems.append("roster.json: defaults.models must map an agent to its default model")
        else:
            for agent, model in models.items():
                if agent not in AGENTS:
                    problems.append(f"roster.json: defaults.models names {agent!r}, which is not an agent; use {agents}")
                elif not (isinstance(model, str) and model.strip()):
                    problems.append(f"roster.json: defaults.models.{agent} must be a model name, {AGENTS[agent]['model_hint']}")
    members = roster.get("members")
    if not isinstance(members, list) or not members:
        return problems + ["roster.json: \"members\" must be a non-empty list"]
    names, cwds, shown_names = set(), set(), set()
    for i, m in enumerate(members):
        where = f"members[{i}]"
        if not isinstance(m, dict):
            problems.append(f"{where} must be an object")
            continue
        name = m.get("name")
        if not isinstance(name, str) or not NAME_RE.match(name):
            problems.append(f"{where}: \"name\" must be kebab-case, 1-32 characters, starting with a letter")
        elif name in names:
            problems.append(f"{where}: name {name!r} is used twice")
        else:
            names.add(name)
            where = f"member {name!r}"
        if "runtime" in m:
            if "agent" in m:
                problems.append(f"{where}: has both \"agent\" and the older \"runtime\"; keep only \"agent\"")
            else:
                m["agent"] = LEGACY_AGENTS.get(m["runtime"], m["runtime"])
        if "agent" in m and m["agent"] not in AGENTS:
            problems.append(f"{where}: \"agent\" {m['agent']!r} is not an agent; use one of {agents}, "
                            "or leave it out to use the default")
        if not isinstance(m.get("summary"), str) or not m["summary"].strip():
            problems.append(f"{where}: \"summary\" must be a one-line description of the role")
        if "display_name" in m:
            shown = m["display_name"]
            if not (isinstance(shown, str) and shown.strip()) or len(shown.strip()) > 48 \
                    or any(c in shown for c in "\n\r|`"):
                problems.append(f"{where}: \"display_name\" must be a human-readable name of 1-48 characters "
                                "on one line, without | or `, such as \"Rina (backend)\"; or leave it out")
            elif shown.strip().lower() in shown_names:
                problems.append(f"{where}: display_name {shown.strip()!r} is used by another member")
            else:
                shown_names.add(shown.strip().lower())
        # The model's form depends on the agent, so model_problems checks it.
        if "model" in m and not (isinstance(m["model"], str) and m["model"].strip()):
            problems.append(f"{where}: \"model\" must be one model name for its agent, such as \"haiku\" for claude")
        if "effort" in m and m["effort"] not in LEVELS:
            problems.append(f"{where}: \"effort\" {m['effort']!r} is not an effort level; use one of {levels}, "
                            "or leave it out to use the default")
        cwd = m.get("cwd")
        if not isinstance(cwd, str) or not cwd or os.path.isabs(cwd) or ".." in cwd.split("/") or "/" in cwd.strip("/"):
            problems.append(f"{where}: \"cwd\" must be one directory name inside the workspace")
        elif cwd in cwds:
            problems.append(f"{where}: cwd {cwd!r} is used by another member")
        else:
            cwds.add(cwd)
        if "talks_to" in m and not (isinstance(m["talks_to"], list) and all(isinstance(t, str) for t in m["talks_to"])):
            problems.append(f"{where}: \"talks_to\" must be a list of member names")
        if not isinstance(m.get("reports_to"), str):
            problems.append(f"{where}: \"reports_to\" must be a member name or \"user\"")
        for j, sk in enumerate(m.get("skills", []) if isinstance(m.get("skills", []), list) else [None]):
            if not (isinstance(sk, dict) and all(isinstance(sk.get(k), str) and sk[k].strip() for k in ("source", "skill"))):
                problems.append(f"{where}: skills[{j}] must be {{\"source\": <package, URL or path>, \"skill\": <name>}}")
            elif sk["skill"] == "peers":
                problems.append(f"{where}: skills[{j}] lists peers, which every member gets; set \"peers_source\" instead")
    if "peers_source" in roster and not (isinstance(roster["peers_source"], str) and roster["peers_source"].strip()):
        problems.append("roster.json: \"peers_source\" must be a package, URL or path of the peers skill")
    for flag in ("agent", "model", "effort"):
        for name, value in overrides[flag].items():
            if name not in names:
                problems.append(f"--{flag} {name}={value}: no member named {name!r} in roster.json")
            elif flag == "agent" and value not in AGENTS:
                problems.append(f"--agent {name}={value}: {value!r} is not an agent; use one of {agents}")
            elif flag == "effort" and value not in LEVELS:
                problems.append(f"--effort {name}={value}: {value!r} is not an effort level; use one of {levels}")
    return problems


def model_problems(members, strict):
    """Problems and notes about each member's agent, model and effort, for its effective agent.
    A default effort the member cannot use is moved to its nearest level here, with a note."""
    problems, notes = [], []
    for e in members:
        where, spec = f"member {e['name']!r}", AGENTS[e["agent"]]
        if e["ignored"]:
            notes.append(f"WARNING {where}: ignored {' and '.join(e['ignored'])}; {e['agent']} is launched "
                         f"without them. {spec['settings_note']}.")
        if e["dropped_model"]:
            notes.append(f"{where}: its model {e['dropped_model']!r} is for its roster agent, so with agent "
                         f"{e['agent']} it uses " + (e["model"] or "the agent's own default model"))
        if strict and not shutil.which(spec["command"]):
            problems.append(f"{where}: agent {e['agent']} needs the `{spec['command']}` command, which is not on PATH")
        if e["model"]:
            if not re.match(spec["model_pattern"], e["model"]):
                problems.append(f"{where}: model {e['model']!r} ({e['model_from']}) is not a {e['agent']} model; "
                                f"expected {spec['model_hint']}")
                continue
            ids, why = available_models(e["agent"])
            if e["agent"] == "agy" and ids is not None:
                # A base name such as gemini-3.8-flash takes its level from --effort.
                ids = ids | {i.rpartition("-")[0] for i in ids if i.rpartition("-")[2] in LEVELS}
            if ids is not None and e["model"] not in ids:
                problems.append(f"{where}: model {e['model']!r} ({e['model_from']}) is not available to "
                                f"{e['agent']}; `{' '.join(spec['list_models'])}` lists: {', '.join(sorted(ids))}")
                continue
            if why:
                (problems if strict else notes).append(f"{where}: cannot confirm model {e['model']!r}: {why}")
        if not e["effort"]:
            continue
        supported, why = effort_levels(e)
        model = e["model"] or f"{e['agent']}'s default model"
        if supported is None:
            if e["effort_from"] == "defaults.effort":
                notes.append(f"{where}: defaults.effort {e['effort']!r} does not apply: {why}; "
                             "it uses the agent's own default effort")
                e["effort"], e["effort_from"] = None, "defaults.effort, not applicable"
            elif not e["model"]:
                problems.append(f"{where}: effort {e['effort']!r} ({e['effort_from']}): {why}")
            else:
                (problems if strict else notes).append(f"{where}: cannot confirm effort {e['effort']!r}: {why}")
        elif e["effort"] not in supported:
            have = ", ".join(x for x in LEVELS if x in supported)
            have = f"it has {have}" if have else "it has no effort levels"
            if e["effort_from"] == "defaults.effort":
                level = nearest(e["effort"], supported) if supported else None
                notes.append(f"{where}: {model} has no {e['effort']!r} effort ({have}), so it uses "
                             + (f"the nearest, {level!r}" if level else "the agent's own default effort"))
                e["effort"], e["effort_from"] = level, ("nearest to defaults.effort" if level
                                                        else "defaults.effort, not supported")
            else:
                hint = f"; the nearest it has is {nearest(e['effort'], supported)!r}" if supported else ""
                base = e["model"].rpartition("-")[0] if e["agent"] == "agy" and e["model"] else ""
                if base and len(supported) == 1 and e["effort"] in (effort_levels(dict(e, model=base))[0] or ()):
                    hint += f"; or set the model to {base!r}, which takes its level from the effort"
                problems.append(f"{where}: effort {e['effort']!r} ({e['effort_from']}) is not supported by "
                                f"{e['agent']} with {model}; {have}{hint}")
    return problems, notes


def roster_problems(workspace, roster, overrides=None, strict=False):
    """(problems, notes, effective members). strict is for launch: every agent's CLI must be there."""
    overrides = overrides or {"agent": {}, "model": {}, "effort": {}}
    problems = structure_problems(roster, overrides)
    if problems:
        return problems, [], None
    members = resolve(roster, overrides)
    names = {m["name"] for m in members}
    for m in members:
        where = f"member {m['name']!r}"
        if m["reports_to"] != "user" and m["reports_to"] not in names:
            problems.append(f"{where}: reports_to {m['reports_to']!r} is not a member or \"user\"")
        if m["reports_to"] == m["name"]:
            problems.append(f"{where}: reports to itself")
        for t in m.get("talks_to", []):
            if t not in names:
                problems.append(f"{where}: talks_to {t!r} is not a member")
            elif t == m["name"]:
                problems.append(f"{where}: talks_to names itself")
    if not any(m["reports_to"] == "user" for m in members):
        problems.append("no member reports to \"user\": someone must report the squad's results out")
    # A report chain that loops never reaches the user.
    boss = {m["name"]: m["reports_to"] for m in members}
    for name in boss:
        seen, cur = set(), name
        while cur in boss and cur not in seen:
            seen.add(cur)
            cur = boss[cur]
        if cur in boss:
            problems.append(f"member {name!r}: its report chain loops ({' -> '.join(sorted(seen))}) and never reaches \"user\"")
            break
    if not problems:  # the layout follows the report chains, so it is checked once they are sound
        problems += [f"layout: {p}" for p in layout_problems(plan_layout(members), members)]
    agent_problems, notes = model_problems(members, strict)
    problems += agent_problems
    for m in members:
        d = os.path.join(workspace, m["cwd"])
        for fname, title in PARTS:
            p = os.path.join(d, fname)
            if not os.path.isfile(p):
                problems.append(f"member {m['name']!r}: {p} is missing")
            elif fname != "MEMORY.md" and not body(open(p).read(), title):  # MEMORY.md starts with no entries
                problems.append(f"member {m['name']!r}: {p} is empty")
        comms = os.path.join(d, "COMMUNICATIONS.md")
        if os.path.isfile(comms):
            text = open(comms).read()
            for other in sorted(set(m.get("talks_to", [])) | ({m["reports_to"]} - {"user"})):
                if not re.search(rf"(?<![a-z0-9-]){re.escape(other)}(?![a-z0-9-])", text):
                    problems.append(f"member {m['name']!r}: COMMUNICATIONS.md never names {other!r}, "
                                    "whom roster.json says it talks or reports to")
        target = os.path.join(d, AGENTS[m["agent"]]["instructions"])
        if os.path.isfile(target) and MARKER not in open(target).read():
            problems.append(f"member {m['name']!r}: {target} exists and was not generated by this script; "
                            "move its content into the member's files, then delete it")
    return problems, notes, members


def body(text, title):
    """The file's text without a leading `# <title>` heading."""
    lines = text.strip().splitlines()
    if lines and re.match(rf"^#\s+{re.escape(title)}\s*$", lines[0], re.IGNORECASE):
        lines = lines[1:]
    return "\n".join(lines).strip()


def peers_command():
    """The global peers binary, by absolute path so Claude Code starts the channel without a PATH lookup."""
    return shutil.which("peers") or os.path.expanduser("~/.local/bin/peers")


def display(m):
    """The member's human-readable name: its display_name, else its member name."""
    return (m.get("display_name") or "").strip() or m["name"]


def session_label(m, name):
    """What herdr, Claude Code and OpenCode show for the member's session."""
    return f"{display(m)} [{name}]" if m.get("display_name") else name


def assemble(workspace, roster, members, m):
    """The member's instruction file: who it is, references to its four files
    (never their content: each file stays the one source of truth), and the
    squad directory."""
    d = os.path.join(workspace, m["cwd"])
    named, any_named = bool(m.get("display_name")), any(o.get("display_name") for o in members)
    rebuild = f"python3 {SCRIPT} assemble {workspace} --member {m['name']}"
    lines = [
        f"{MARKER}: do not edit this file. Your instructions are in the files it references; edit those. "
        f"After roster.json changes, regenerate this file with: {rebuild} -->",
        "",
        f"# {display(m)} (`{m['name']}`): member of the {roster['squad']} squad" if named else
        f"# {m['name']}: member of the {roster['squad']} squad",
        "",
        f"Squad goal: {roster['goal'].strip()}",
        "",
        (f"You are {display(m)}, the member `{m['name']}`." if named else f"You are `{m['name']}`.")
        + f" You work in `{d}`. Other members are separate agent sessions; "
        f"you reach them only through the peers skill (`peers`).",
        "",
        "## Your instructions",
        "",
    ]
    if AGENTS[m["agent"]]["imports"]:
        # Claude Code loads @-imports itself, from the files' own paths.
        lines += ["These files are your instructions, and the only place they are kept; they load with this file. "
                  "Follow them as if they were written here.", ""]
        lines += [f"- {title}: @{os.path.join(d, fname)}" for fname, title in PARTS]
    else:
        lines += ["These files are your instructions, and the only place they are kept. Read all four, in this order, "
                  "at the start of every session, before you answer the first message or do anything else, and follow "
                  "them as if they were written here. Read a file again whenever someone tells you it changed.", ""]
        lines += [f"- {title}: `{os.path.join(d, fname)}`" for fname, title in PARTS]
    lines += ["", f"When you are corrected, or asked to behave in a particular way from now on, add the lesson to "
              f"`{os.path.join(d, 'MEMORY.md')}` as one short entry. Never record lessons in this file."]
    if any_named:
        lines += ["", "Each member has a member name (in backticks below), which `roster.json`, `reports_to`, "
                  "`talks_to` and the PEER-ROLE header use, and a human-readable name, which peers sends as "
                  "PEER-NAME. Call members by their human-readable name when you write to or about them; use "
                  "the member name wherever a file or command asks for one."]
    lines += ["", "## Squad directory", "",
              "Find a member's address with `peers contacts`, which lists every member that has used peers "
              "in this squad, or with `peers list --all-dirs`, picking the row whose cwd is the member's "
              "directory below. Addresses change when a member is restarted; "
              "look them up again rather than reusing an old one.", "",
              "| Member |" + (" Name |" if any_named else "") + " Agent | Model | Effort | Role | Directory | Reports to |",
              "| --- |" + (" --- |" if any_named else "") + " --- | --- | --- | --- | --- | --- |"]
    for o in members:
        me = " (you)" if o["name"] == m["name"] else ""
        default = "agent default" if AGENTS[o["agent"]]["launch_settings"] else f"set in {AGENTS[o['agent']]['label']}"
        lines.append(f"| `{o['name']}`{me} |" + (f" {display(o)} |" if any_named else "") +
                     f" {o['agent']} | {o['model'] or default} | "
                     f"{o['effort'] or default} | {o['summary'].strip()} | "
                     f"`{os.path.join(workspace, o['cwd'])}` | {o['reports_to']} |")
    return "\n".join(lines) + "\n"


def merge_json(path, update):
    data = {}
    if os.path.isfile(path):
        try:
            data = json.load(open(path))
        except json.JSONDecodeError as e:
            fail(f"{path} is not valid JSON ({e}); fix or remove it, then build again")
    update(data)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(path + ".tmp", path)


def install_skills(d, m, peers_source):
    """Install peers and the member's other skills into its cwd, for its agent."""
    spec = AGENTS[m["agent"]]
    wanted = [(peers_source, "peers")] + [(sk["source"], sk["skill"]) for sk in m.get("skills", [])]
    by_source = {}
    for source, skill in wanted:
        by_source.setdefault(source, []).append(skill)
    installed = []
    for source, skills in by_source.items():
        cmd = ["npx", "-y", "skills@latest", "add", source, "-a", spec["skills_cli"], "-y", "--copy"]
        for skill in skills:
            cmd += ["--skill", skill]
        out = subprocess.run(cmd, cwd=d, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        if out.returncode != 0:
            tail = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", (out.stderr + out.stdout)).strip()[-1500:]
            fail(f"installing {', '.join(skills)} from {source} for member {m['name']!r} failed "
                 f"(exit {out.returncode}): {' '.join(cmd)}\n{tail}")
        for skill in skills:
            if not os.path.isfile(os.path.join(d, spec["skills_dir"], skill, "SKILL.md")):
                fail(f"`{' '.join(cmd)}` in {d} did not install {skill!r} into {spec['skills_dir']}; "
                     "check that the source has a skill by that name with valid SKILL.md frontmatter "
                     f"(`npx -y skills@latest add {source} --list`)")
            installed.append(skill)
    return installed


def write_instructions(workspace, roster, members, m):
    d = os.path.join(workspace, m["cwd"])
    target = os.path.join(d, AGENTS[m["agent"]]["instructions"])
    with open(target + ".tmp", "w") as f:
        f.write(assemble(workspace, roster, members, m))
    os.replace(target + ".tmp", target)
    for name in {spec["instructions"] for spec in AGENTS.values()}:  # left from an earlier agent
        stale = os.path.join(d, name)
        if stale != target and os.path.isfile(stale) and MARKER in open(stale).read():
            os.remove(stale)
    return target


def identity_path(workspace, m):
    return os.path.join(workspace, m["cwd"], ".peers.json")


def write_identity(workspace, roster, m):
    # peers reads the sender's role and display_name from the nearest .peers.json and puts
    # them in PEER-ROLE and PEER-NAME;
    # launch compares the agent, model and effort recorded here with the ones it is asked to start.
    def update(data):
        data.update(role=m["name"], squad=roster["squad"], agent=m["agent"])
        for key in ("display_name", "model", "effort"):
            if m.get(key):
                data[key] = m[key].strip()
            else:
                data.pop(key, None)

    path = identity_path(workspace, m)
    merge_json(path, update)
    return path


def build_member(workspace, roster, members, m, peers_source):
    d = os.path.join(workspace, m["cwd"])
    done = [f"wrote {write_instructions(workspace, roster, members, m)}",
            f"wrote {write_identity(workspace, roster, m)}"]
    skills = install_skills(d, m, peers_source)
    done.append(f"installed {', '.join(skills)} in {os.path.join(d, AGENTS[m['agent']]['skills_dir'])}")
    configured = AGENTS[m["agent"]]["configure"](workspace, d, m)
    if configured:
        done.append(configured)
    return done


def selected(members, name):
    if not name:
        return members
    found = [m for m in members if m["name"] == name]
    if not found:
        fail(f"no member named {name!r} in roster.json")
    return found


def overrides_of(args):
    return {k: dict(getattr(args, k, None) or []) for k in ("agent", "model", "effort")}


def checked(args, strict=False):
    """Validate; print NOTE and PROBLEM lines, or OK and one MEMBER line each. Exit 1 on problems."""
    workspace = os.path.abspath(args.workspace)
    roster = load_roster(workspace)
    problems, notes, members = roster_problems(workspace, roster, overrides_of(args), strict)
    for n in notes:
        print(n if n.startswith("WARNING ") else f"NOTE {n}")
    for p in problems:
        print(f"PROBLEM {p}")
    if problems:
        sys.exit(1)
    print(f"OK {len(members)} members in {workspace}")
    for e in members:
        print(f"MEMBER {e['name']}{shown(e)}: {describe(e)}")
    for line in layout_lines(roster, plan_layout(members), {m["name"]: m for m in members}):
        print(line)
    return workspace, roster, members


def cmd_check(args):
    checked(args)


def cmd_assemble(args):
    workspace, roster, members = checked(args)
    for m in selected(members, args.member):
        print(f"ASSEMBLED {m['name']} ({m['agent']}): wrote {write_instructions(workspace, roster, members, m)} "
              f"and {write_identity(workspace, roster, m)}")


def peers_source_of(roster):
    peers_source = roster.get("peers_source", DEFAULT_PEERS)
    if os.path.isabs(peers_source) and not os.path.isfile(os.path.join(peers_source, "SKILL.md")):
        fail(f"no peers skill at {peers_source}; set \"peers_source\" in roster.json to its directory, "
             "package or URL")
    if not shutil.which("npx"):
        fail("npx is not on PATH; install Node.js, which the skills CLI needs")
    return peers_source


def cmd_build(args):
    workspace, roster, members = checked(args)
    peers_source = peers_source_of(roster)
    for m in selected(members, args.member):
        print(f"BUILT {m['name']} ({m['agent']}): " + "; ".join(build_member(workspace, roster, members, m, peers_source)))


# ---------------------------------------------------------------------------
# Layout. These settings and plan_layout() decide where every member's pane
# goes; launch only carries the plan out. Change the layout here, and only here.
# ---------------------------------------------------------------------------
# The whole squad lives in one herdr workspace. A window is one tab of it. The
# first window puts the supervisor, the member that reports to "user", in a pane
# across the top, and the members below it in the hierarchy underneath; the
# members that do not fit go to further windows of the same workspace, in
# hierarchy order: by how many steps of reports_to separate them from "user",
# then by their order in roster.json.
MEMBERS_PER_WINDOW = 5   # the most members one window holds, the supervisor included
SUPERVISOR_SHARE = 0.6   # the share of the first window's height the supervisor's pane takes
MEMBERS_PER_ROW = 4      # the most panes side by side in one row, so that none gets too narrow


def workspace_label(roster):
    return f"squad-{roster['squad']}"


def window_label(roster, number):
    return f"{roster['squad']} {number}"


def hierarchy(members):
    """The members in hierarchy order: by their distance from "user" along reports_to, then roster order."""
    boss = {m["name"]: m["reports_to"] for m in members}

    def depth(name, seen=()):
        if boss[name] == "user":
            return 0
        if boss[name] not in boss or boss[name] in seen:
            return len(boss)  # a broken chain, which check reports; it sorts last
        return 1 + depth(boss[name], seen + (name,))
    return sorted(members, key=lambda m: (depth(m["name"]), members.index(m)))


def rows_of(names, height):
    """Rows of at most MEMBERS_PER_ROW names, as even as possible, sharing height equally."""
    if not names:
        return []
    count = -(-len(names) // MEMBERS_PER_ROW)
    size, extra = divmod(len(names), count)
    rows, start = [], 0
    for r in range(count):
        n = size + (1 if r < extra else 0)
        rows.append({"share": height / count, "members": names[start:start + n]})
        start += n
    return rows


def plan_layout(members):
    """The squad's windows: [{"number": n, "rows": [{"share": height share, "members": [names]}]}]."""
    names = [m["name"] for m in hierarchy(members)]
    if not names:
        return []
    supervisor, rest = names[0], names[1:]
    groups = [rest[:MEMBERS_PER_WINDOW - 1]]
    rest = rest[MEMBERS_PER_WINDOW - 1:]
    while rest:
        groups.append(rest[:MEMBERS_PER_WINDOW])
        rest = rest[MEMBERS_PER_WINDOW:]
    # A member alone in a window would get a pane larger than the supervisor's:
    # give it the last member of the window before, which keeps the hierarchy order.
    if len(groups) > 1 and len(groups[-1]) == 1 and groups[-2]:
        groups[-1].insert(0, groups[-2].pop())
    top = SUPERVISOR_SHARE if groups[0] else 1.0
    windows = [{"number": 1, "rows": [{"share": top, "members": [supervisor]}] + rows_of(groups[0], 1.0 - top)}]
    for group in groups[1:]:
        windows.append({"number": len(windows) + 1, "rows": rows_of(group, 1.0)})
    return windows


def window_members(window):
    return [n for row in window["rows"] for n in row["members"]]


def pane_areas(window):
    """Each member's share of its window's area."""
    return {n: row["share"] / len(row["members"]) for row in window["rows"] for n in row["members"]}


def layout_problems(windows, members):
    """What is wrong with a layout: each member in exactly one window, none over the limit,
    the supervisor alone across the top of the first window with the largest pane."""
    problems = []
    if not (isinstance(MEMBERS_PER_WINDOW, int) and MEMBERS_PER_WINDOW >= 1):
        problems.append(f"MEMBERS_PER_WINDOW is {MEMBERS_PER_WINDOW!r}; it must be a whole number of at least 1")
    if not (isinstance(MEMBERS_PER_ROW, int) and MEMBERS_PER_ROW >= 1):
        problems.append(f"MEMBERS_PER_ROW is {MEMBERS_PER_ROW!r}; it must be a whole number of at least 1")
    if not (isinstance(SUPERVISOR_SHARE, (int, float)) and 0 < SUPERVISOR_SHARE < 1):
        problems.append(f"SUPERVISOR_SHARE is {SUPERVISOR_SHARE!r}; it must be between 0 and 1")
    if problems or not members:
        return problems
    placed = {}
    for w in windows:
        names = window_members(w)
        if not names:
            problems.append(f"window {w['number']} holds no member")
        if len(names) > MEMBERS_PER_WINDOW:
            problems.append(f"window {w['number']} holds {len(names)} members; at most {MEMBERS_PER_WINDOW} fit")
        if abs(sum(r["share"] for r in w["rows"]) - 1.0) > 1e-6:
            problems.append(f"window {w['number']}'s rows do not fill its height")
        for n in names:
            placed.setdefault(n, []).append(w["number"])
    for m in members:
        where = placed.pop(m["name"], [])
        if len(where) != 1:
            problems.append(f"member {m['name']!r} is in {len(where)} windows ({', '.join(map(str, where)) or 'none'}); "
                            "it must be in exactly one")
    for n in placed:
        problems.append(f"the layout places {n!r}, who is not a member")
    supervisor = hierarchy(members)[0]["name"]
    first = windows[0]["rows"][0]["members"] if windows and windows[0]["rows"] else []
    if first != [supervisor]:
        problems.append(f"the supervisor {supervisor!r} is not alone across the top of window 1")
    areas = {n: a for w in windows for n, a in pane_areas(w).items()}
    larger = [n for n, a in areas.items() if n != supervisor and a >= areas.get(supervisor, 0)]
    if larger:
        problems.append(f"the supervisor {supervisor!r} does not have the largest pane: "
                        f"{', '.join(larger)} {'has' if len(larger) == 1 else 'have'} one as large or larger")
    return problems


def layout_lines(roster, windows, by_name):
    """One WINDOW line per window: its tab label, then each row's members and their share of the window."""
    lines = []
    for w in windows:
        areas = pane_areas(w)
        rows = " / ".join(", ".join(f"{n}{shown(by_name[n])} {areas[n]:.0%}" for n in r["members"]) for r in w["rows"])
        lines.append(f"WINDOW {w['number']} (tab {window_label(roster, w['number'])!r}, "
                     f"{len(window_members(w))} of at most {MEMBERS_PER_WINDOW} members): {rows}")
    return lines


def split_steps(window, present):
    """How to build a window from its first pane, for the members in present only.

    Returns [(member, None, None, None)] for the first pane, then one
    (member, target member, direction, ratio) per pane: split the target's pane in
    that direction, the target keeping ratio of it. Rows are split off top to
    bottom first, then each row into its columns, so every row spans the window.
    """
    rows = [dict(r, members=[n for n in r["members"] if n in present]) for r in window["rows"]]
    rows = [r for r in rows if r["members"]]
    if not rows:
        return []
    total = sum(r["share"] for r in rows)
    steps = [(rows[0]["members"][0], None, None, None)]
    for i in range(1, len(rows)):
        left = sum(r["share"] for r in rows[i - 1:]) / total
        steps.append((rows[i]["members"][0], rows[i - 1]["members"][0], "down", round(rows[i - 1]["share"] / total / left, 4)))
    for r in rows:
        n = len(r["members"])
        for j in range(1, n):
            steps.append((r["members"][j], r["members"][j - 1], "right", round(1 / (n - j + 1), 4)))
    return steps


# ---------------------------------------------------------------------------
# Launch
# ---------------------------------------------------------------------------

class Herdr:
    """Runs herdr commands in one session, or only prints them with --dry-run."""

    def __init__(self, session, dry_run):
        self.session, self.dry_run, self.count = session, dry_run, 0

    def call(self, *args, note=None):
        cmd = ["herdr", "--session", self.session, *args]
        if self.dry_run:
            print("RUN " + shlex.join(cmd) + (f"   # {note}" if note else ""))
            return 0, ""
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise LaunchError(f"`{shlex.join(cmd)}` did not answer within 120 s")
        return out.returncode, (out.stdout + out.stderr)

    def run(self, *args, note=None):
        code, text = self.call(*args, note=note)
        if code != 0:
            raise LaunchError(f"`herdr {shlex.join(args)}` failed (exit {code}): {text.strip()[-800:]}")
        return text

    def text(self, *args):
        return "" if self.dry_run else self.run(*args)

    def created(self, *args):
        """Create a workspace, tab or pane; return the "result" of herdr's JSON reply."""
        text = self.run(*args)
        if self.dry_run:
            self.count += 1
            return {"workspace": {"workspace_id": "<workspace>"}, "tab": {"tab_id": f"<tab-{self.count}>"},
                    "root_pane": {"pane_id": f"<pane-{self.count}>"}, "pane": {"pane_id": f"<pane-{self.count}>"}}
        try:
            return json.loads(text)["result"]
        except (ValueError, KeyError, TypeError):
            raise LaunchError(f"`herdr {shlex.join(args)}` printed no result: {text.strip()[-400:]}")

    def query(self, *args):
        """Run a herdr command that only reads, also with --dry-run; return its "result", or {}."""
        cmd = ["herdr", "--session", self.session, *args]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
            return json.loads(out.stdout).get("result") or {} if out.returncode == 0 else {}
        except (subprocess.TimeoutExpired, ValueError, AttributeError):
            return {}

    def settle(self, name, pane):
        """Return once herdr reports the agent idle or blocked on a dialog; never polls."""
        code, text = self.call("agent", "wait", name, "--until", "idle", "--until", "blocked", "--timeout", "90000")
        if code != 0:
            raise LaunchError(f"{name} in pane {pane} did not settle within 90 s: {text.strip()[-400:]}")

    def opencode_api(self, cwd, operation, params=None, data=None):
        """Run `opencode api <operation>` against OpenCode's background service; return its JSON."""
        cmd = ["opencode", "api", operation] + [x for k, v in (params or {}).items() for x in ("--param", f"{k}={v}")]
        if data is not None:
            cmd += ["-d", json.dumps(data)]
        if self.dry_run:
            print("RUN " + shlex.join(cmd))
            return {"data": {"id": "<session>", "model": {}}}
        try:
            out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise LaunchError(f"`{shlex.join(cmd)}` did not answer within 120 s")
        if out.returncode != 0:
            raise LaunchError(f"`{shlex.join(cmd)}` failed (exit {out.returncode}): "
                              f"{(out.stderr + out.stdout).strip()[-600:]}; is OpenCode's background service "
                              "running (`opencode service status`)?")
        if not out.stdout.strip():
            return {}
        try:
            return json.loads(out.stdout)
        except ValueError:
            raise LaunchError(f"`{shlex.join(cmd)}` printed no JSON: {out.stdout.strip()[-400:]}")

    def first_prompt(self, name, pane, dialogs):
        """Send the first prompt, answering the agent's known dialogs while herdr says it is blocked."""
        for marker, keys in dialogs if self.dry_run else []:
            self.run("agent", "send-keys", name, *keys, note=f"only when the screen shows {marker!r}")
        for _ in range(len(dialogs) + 2):
            self.settle(name, pane)
            code, text = self.call("agent", "prompt", name, FIRST_PROMPT)
            if code == 0:
                return
            if "agent_blocked" not in text and "agent_not_ready" not in text:
                raise LaunchError(f"`herdr agent prompt {name}` failed: {text.strip()[-800:]}")
            screen = self.run("agent", "read", name, "--source", "visible")
            answer = next((keys for marker, keys in dialogs if marker in screen.lower()), None)
            if not answer:
                raise LaunchError(f"{name} in pane {pane} waits for input this script does not know how to "
                                  f"answer; its screen ends:\n{screen.strip()[-800:]}")
            self.run("agent", "send-keys", name, *answer)
        raise LaunchError(f"{name} in pane {pane} still waits for input after its known dialogs were answered")

    def start_agent(self, name, kind, pane, args, allow_not_ready=False):
        cmd = ["agent", "start", name, "--kind", kind, "--pane", pane] + (["--", *args] if args else [])
        # A new pane's shell takes a moment to start; herdr says so with agent_pane_busy.
        # This bounded retry waits for a shell to come up, never for a member's work.
        for _ in range(20):
            code, text = self.call(*cmd)
            if code == 0:
                return "started"
            if "agent_pane_busy" in text:
                time.sleep(1)
                continue
            if allow_not_ready and "agent_not_ready" in text:
                return "not_ready"
            raise LaunchError(f"`herdr {shlex.join(cmd)}` failed: {text.strip()[-800:]}")
        raise LaunchError(f"pane {pane} stayed busy for 20 s; its shell did not start")


def herdr_session(requested):
    """The running herdr session to launch in, or a problem."""
    if not shutil.which("herdr"):
        return None, "herdr is not on PATH; install it, or start the members by hand"
    out = subprocess.run(["herdr", "session", "list", "--json"], capture_output=True, text=True)
    try:
        sessions = json.loads(out.stdout).get("sessions", [])
    except ValueError:
        return None, f"`herdr session list --json` printed no JSON: {(out.stderr or out.stdout).strip()[-300:]}"
    for s in sessions:
        if (s.get("name") == requested) if requested else s.get("default"):
            if s.get("running"):
                return s["name"], None
            return None, (f"herdr session {s['name']!r} is not running; ask the user to start it from their own "
                          f"terminal (`herdr --session {s['name']}`, or `herdr` for the default session)")
    return None, (f"no herdr session named {requested!r}; `herdr session list` shows the sessions" if requested
                  else "no default herdr session; ask the user to start herdr from their own terminal")


def settings_change(m):
    if not AGENTS[m["agent"]]["launch_settings"]:
        return f"CLEAR {m['name']}'s model and effort: {AGENTS[m['agent']]['label']} manages them"
    return f"SET {m['name']}'s model to {m['model'] or 'the agent default'}, effort {m['effort'] or 'the agent default'}"


def squad_state(h, roster):
    """The squad's workspace in herdr, if it exists: (workspace id or None, {tab label: tab id}, [panes])."""
    found = [w for w in h.query("workspace", "list").get("workspaces", []) if w.get("label") == workspace_label(roster)]
    if not found:
        return None, {}, []
    ws = found[0]["workspace_id"]
    tabs = {t.get("label"): t["tab_id"] for t in h.query("tab", "list", "--workspace", ws).get("tabs", [])}
    return ws, tabs, h.query("pane", "list", "--workspace", ws).get("panes", [])


def lay_out_window(h, roster, workspace, window, by_name, ws, tab, panes, new, made_for):
    """Build one window of the plan in the squad's workspace; return the workspace id.

    new: the members to start here, each in a pane split for it. Any other member
    of the window that already runs (its pane carries its label) is moved into
    its place. ws and tab are the squad's workspace and this window's tab, or None
    when they do not exist yet; panes: every pane in that workspace. made_for
    receives {member: pane id} for each new member's pane as soon as it exists.
    """
    label_of = {display(by_name[n]): n for n in window_members(window)}
    running = {label_of[p["label"]]: p["pane_id"] for p in panes if p.get("label") in label_of}
    steps = split_steps(window, set(new) | set(running))
    if not steps:
        return ws
    cwd = {n: os.path.join(workspace, by_name[n]["cwd"]) for n in window_members(window)}
    root, label, park = steps[0][0], window_label(roster, window["number"]), None
    if ws is None:
        made = h.created("workspace", "create", "--cwd", cwd[root], "--label", workspace_label(roster), "--no-focus")
        anchor = made["root_pane"]["pane_id"]
        ws = (made.get("workspace") or {}).get("workspace_id") or anchor.split(":")[0]
        tab = (made.get("tab") or {}).get("tab_id") or f"{ws}:t1"
        h.run("tab", "rename", tab, label)
    elif tab is None:
        made = h.created("tab", "create", "--workspace", ws, "--cwd", cwd[root], "--label", label, "--no-focus")
        anchor, tab = made["root_pane"]["pane_id"], made["tab"]["tab_id"]
    else:
        # Rebuild the existing window: split a fresh pane to build from, and park
        # every other pane of the window in a tab of its own while the window fills.
        here = [p["pane_id"] for p in panes if p.get("tab_id") == tab]
        anchor = h.created("pane", "split", here[0], "--direction", "down", "--cwd", cwd[root],
                           "--no-focus")["pane"]["pane_id"]
        parked = h.created("tab", "create", "--workspace", ws, "--cwd", workspace,
                           "--label", f"{roster['squad']} parked", "--no-focus")
        park = parked["root_pane"]["pane_id"]
        for p in here:
            h.run("pane", "move", p, "--tab", parked["tab"]["tab_id"], "--target-pane", park, "--split", "right",
                  "--no-focus")
    placed = {}
    if root in running:
        h.run("pane", "move", running[root], "--tab", tab, "--target-pane", anchor, "--split", "right", "--no-focus")
        h.run("pane", "close", anchor)
        placed[root] = running[root]
    else:
        placed[root] = made_for[root] = anchor
    for n, target, direction, ratio in steps[1:]:
        if n in running:
            h.run("pane", "move", running[n], "--tab", tab, "--target-pane", placed[target], "--split", direction,
                  "--ratio", str(ratio), "--no-focus")
            placed[n] = running[n]
        else:
            try:
                placed[n] = made_for[n] = h.created("pane", "split", placed[target], "--direction", direction,
                                                    "--ratio", str(ratio), "--cwd", cwd[n], "--no-focus")["pane"]["pane_id"]
            except LaunchError as e:
                raise LaunchError(f"could not make {n}'s pane in window {window['number']}: {e}")
    if park:
        h.run("pane", "close", park)  # the parked tab closes with its last pane
    for n in new:
        h.run("pane", "rename", placed[n], display(by_name[n]))  # herdr shows the label above the pane; --member finds it
    return ws


def cmd_launch(args):
    workspace = os.path.abspath(args.workspace)
    roster = load_roster(workspace)
    problems, notes, members = roster_problems(workspace, roster, overrides_of(args), strict=True)
    session, windows, state = None, [], (None, {}, [])
    if members is not None:
        session, why = herdr_session(args.session)
        if why:
            problems.append(why)
        windows = plan_layout(members)
    if session:
        state = squad_state(Herdr(session, True), roster)
    ws = state[0]
    rebuild, retune = [], []
    for m in (selected(members, args.member) if members else []):
        path = identity_path(workspace, m)
        built = json.load(open(path)) if os.path.isfile(path) else {}
        instructions = os.path.join(workspace, m["cwd"], AGENTS[m["agent"]]["instructions"])
        if "agent" not in built and os.path.isfile(instructions):
            built["agent"] = m["agent"]  # built before .peers.json recorded the agent
        if not built:
            problems.append(f"member {m['name']!r} is not built; run `python3 {SCRIPT} build {workspace}` first")
        elif built.get("agent") != m["agent"]:
            rebuild.append(m)
        elif built.get("model") != m["model"] or built.get("effort") != m["effort"]:
            retune.append(m)
        held = [p["pane_id"] for p in state[2] if p.get("label") == display(m)]
        if args.member and held:
            problems.append(f"member {m['name']!r} already has pane {held[0]} in the squad's workspace {ws}; stop its "
                            f"session and close the pane (`herdr --session {session} pane close {held[0]}`) first")
    if ws and not args.member:
        problems.append(f"herdr session {session} already holds the squad's workspace {workspace_label(roster)} ({ws}); "
                        f"close it (`herdr --session {session} workspace close {ws}`) to start the whole squad again, "
                        "or start single members into it with --member")
    for n in notes:
        print(n if n.startswith("WARNING ") else f"NOTE {n}")
    for p in problems:
        print(f"PROBLEM {p}")
    if problems:
        print("Nothing was launched.")
        sys.exit(1)
    targets = selected(members, args.member)
    by_name = {m["name"]: m for m in members}
    print(f"OK {len(targets)} of {len(members)} members, herdr session {session}")
    for e in targets:
        print(f"MEMBER {e['name']}{shown(e)}: {describe(e)}")
    for line in layout_lines(roster, windows, by_name):
        print(line)

    # The agent, model or effort differs from the last build: bring the member's files in line first.
    if rebuild or retune:
        if args.dry_run:
            for m in rebuild:
                print(f"WOULD REBUILD {m['name']} for agent {m['agent']} (instruction file, skills, configuration)")
            for m in retune:
                print(f"WOULD {settings_change(m)}")
        else:
            peers_source = peers_source_of(roster) if rebuild else None
            for m in rebuild:
                print(f"REBUILT {m['name']} ({m['agent']}): " + "; ".join(build_member(workspace, roster, members, m, peers_source)))
            for m in retune:
                d = os.path.join(workspace, m["cwd"])
                write_identity(workspace, roster, m)
                AGENTS[m["agent"]]["configure"](workspace, d, m)
                print(settings_change(m))
            for m in members:  # every squad directory shows each member's agent, model and effort
                write_instructions(workspace, roster, members, m)

    h = Herdr(session, args.dry_run)
    wanted = {m["name"] for m in targets}
    launched, waiting, failed = [], {}, None  # (member, pane) of each member started; {member: pane} not started yet
    try:
        for w in windows:
            new = [n for n in window_members(w) if n in wanted]
            if not new:
                continue
            failed = (None, None)  # laying out the window: the error names the member
            ws = lay_out_window(h, roster, workspace, w, by_name, ws, state[1].get(window_label(roster, w["number"])),
                                state[2], new, waiting)
            for n in new:
                m, pane = by_name[n], waiting[n]
                failed = (m, pane)
                d = os.path.join(workspace, m["cwd"])
                # Zoomed, the pane has the window's full size while the agent's dialogs are read and answered.
                h.run("pane", "zoom", pane, "--on")
                AGENTS[m["agent"]]["launch"](h, m, pane, f"{roster['squad']}-{m['name']}", d)
                h.run("pane", "zoom", pane, "--off")
                launched.append((m, waiting.pop(n)))
                if AGENTS[m["agent"]]["launch_settings"]:
                    settings = (f"model {m['model'] or 'the agent' + chr(39) + 's own default'}, "
                                f"effort {m['effort'] or 'the agent' + chr(39) + 's own default'}")
                else:
                    settings = f"model and effort managed by {AGENTS[m['agent']]['label']}"
                print(f"{'WOULD LAUNCH' if args.dry_run else 'LAUNCHED'} {m['name']}{shown(m)} ({m['agent']}, {settings}) "
                      f"in herdr session {session}, window {w['number']}, pane {pane}")
    except LaunchError as e:
        m, pane = failed
        print(f"FAILED {m['name']} ({m['agent']}) in pane {pane}: {e}" if m else f"FAILED laying out the panes: {e}")
        running = ", ".join(f"{x['name']} (pane {p})" for x, p in launched) or "none"
        idle = ", ".join(f"{n} (pane {p})" for n, p in waiting.items())
        close = " ".join(f"`herdr --session {session} pane close {p}`" for p in waiting.values())
        print(f"Already running: {running}. Not started: "
              + ", ".join(n for n in by_name if n in wanted and n not in {x['name'] for x, _ in launched})
              + f". Fix the cause, "
              + (f"close the panes of the members that did not start, {idle} ({close}), then " if waiting else "then ")
              + "launch each member that is not running with --member; it takes its place in its window.")
        sys.exit(1)
    if not args.dry_run:
        print("Find each member's address with `peers list --all-dirs`, "
              "by its directory. The squad starts working when the lead receives a request through peers.")


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

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


def member_value(text):
    name, sep, value = text.partition("=")
    if not sep or not name.strip() or not value.strip() or " " in value.strip():
        raise argparse.ArgumentTypeError(f"{text!r} must be MEMBER=VALUE, such as web=opencode or web=high")
    return name.strip(), value.strip()


def add_overrides(p):
    p.add_argument("--agent", action="append", type=member_value, metavar="MEMBER=AGENT",
                   help=f"run MEMBER on AGENT ({', '.join(AGENTS)}) instead of its roster agent; repeat for "
                        "more members. Its roster model then no longer applies (default: the roster's agent)")
    p.add_argument("--model", action="append", type=member_value, metavar="MEMBER=MODEL",
                   help="run MEMBER on MODEL, which must be valid for its agent; repeat for more members "
                        "(default: the roster's model, then defaults.models, then the agent's own default)")
    p.add_argument("--effort", action="append", type=member_value, metavar="MEMBER=LEVEL",
                   help=f"run MEMBER at effort LEVEL ({', '.join(LEVELS)}), which its agent and model must "
                        "support; repeat for more members (default: the roster's effort, then defaults.effort, "
                        "then the agent's own default)")


def main():
    p = Parser(prog="roster.py", description=__doc__.split("\n\n", 1)[0],
               epilog=__doc__.split("\n\n", 1)[1].replace("{settings}", (
                   f"MEMBERS_PER_WINDOW = {MEMBERS_PER_WINDOW}, SUPERVISOR_SHARE = {SUPERVISOR_SHARE}, "
                   f"MEMBERS_PER_ROW = {MEMBERS_PER_ROW}")))
    sub = p.add_subparsers(dest="cmd", required=True, metavar="<command>", parser_class=Parser)
    workspace_help = "the squad's root directory, which holds roster.json"
    member_help = "only this member, by its name in roster.json (default: every member)"

    c = command(sub, "check", "Validate roster.json and every member's files; write nothing.", f"""
Validates each member's agent ({', '.join(AGENTS)}), model and effort: the
model must have the agent's form, and for opencode and agy it must be one that
`opencode models` or `agy models` lists (a NOTE says when the CLI is missing);
the effort ({', '.join(LEVELS)}) must be one the agent and model support
(opencode: the model's variants in `opencode api model.list`). A
defaults.effort a member cannot use moves to its nearest level, with a NOTE.
--agent, --model and --effort check a launch override before you launch.
Validates the layout too (see `roster.py --help`): every member in exactly
one window, no window over MEMBERS_PER_WINDOW, the supervisor alone on top
of window 1 with the largest pane.
Output: `OK <n> members in <workspace>`, one `MEMBER <name> (<display
name>): agent ..., model ..., effort ...` line per member, saying where each
value came from (the display name shows only when the roster sets one), and
one `WINDOW <n> (tab '<squad> <n>', <k> of at most {MEMBERS_PER_WINDOW} members): ...` line per
window, listing each row's members and their share of the window, rows
separated by " / " (exit 0); or one `PROBLEM <what>` line per issue (exit 1): a
`layout: ...` fault, a bad name,
display name, agent, model, cwd or
skill entry, a link to an unknown member, a report chain that never reaches
"user", a missing or empty member file, a COMMUNICATIONS.md that never names a
linked member, or a hand-written CLAUDE.md or AGENTS.md.""",
                ["python3 roster.py check ~/squads/shop",
                 "python3 roster.py check ~/squads/shop --agent web=agy --model web=gemini-3.8-flash --effort web=high"])
    c.add_argument("workspace", help=workspace_help)
    add_overrides(c)
    c.set_defaults(func=cmd_check)

    a = command(sub, "assemble", "Check, then write each member's instruction file and .peers.json.", """
Writes CLAUDE.md (claude) or AGENTS.md (opencode, agy), which references the
member's four files by path and lists the squad with each member's display
name, agent, model and effort, and .peers.json, which records the member's
role, display name, agent, model and effort.
Installs nothing. Use it after roster.json changes.
Output: the check's lines, then one `ASSEMBLED <member>` line per member.""",
                 ["python3 roster.py assemble ~/squads/shop", "python3 roster.py assemble ~/squads/shop --member api"])
    a.add_argument("workspace", help=workspace_help)
    a.add_argument("--member", metavar="NAME", help=member_help)
    a.set_defaults(func=cmd_assemble)

    b = command(sub, "build", "Check and assemble, then install skills and configure each member.", """
For each member: writes its instruction file and .peers.json, installs peers
and its roster skills into its cwd with `npx -y skills@latest add` for its
agent, and applies the agent's own setup: the peers channel for claude
(.mcp.json, approved in .claude/settings.local.json). It never writes a model
or effort into an opencode member's opencode.json. Needs npx (Node.js). Safe
to run again.
Output: the check's lines, then one `BUILT <member>` line per member. A
failed install prints the exact npx command and its output (exit 1).""",
                 ["python3 roster.py build ~/squads/shop", "python3 roster.py build ~/squads/shop --member web"])
    b.add_argument("workspace", help=workspace_help)
    b.add_argument("--member", metavar="NAME", help=member_help)
    b.set_defaults(func=cmd_build)

    n = command(sub, "launch", "Start the built squad in herdr, one workspace laid out by the hierarchy, each member on its agent, model and effort.", f"""
Validates everything first and launches nothing on a problem: the roster,
every member's agent, model and effort, each agent's command on PATH, a running herdr
session, that each member is built, and the layout (see `roster.py --help`).
A full launch also refuses when the session already holds the squad's
workspace; with --member, a member that still has a pane there is refused.
Then it creates the squad's one herdr workspace, squad-<squad>, with one tab
per window: the supervisor in a pane across the top of window 1, the members
below it underneath, and the rest in further windows of at most
{MEMBERS_PER_WINDOW} members.
It zooms each member's pane while that member starts, so the agent's dialogs
are read at full size, and starts each member with its agent's own
command, model and effort: claude --model --effort, agy --model --effort, and
for opencode, whose TUI takes neither flag, OpenCode's API: it creates the
member's session, opens the TUI on it with --session, sets the model with the
effort as its variant (session.switchModel), and confirms it with session.get
before the first prompt (needs OpenCode's background service; an opencode
member without a model starts plain, on its opencode.json or /models). It
answers
the folder-trust, channel and one-time notice prompts it knows, and gives each
its first prompt; a prompt it does not know stops the launch with the screen.
Every member runs with --dangerously-skip-permissions. Launch does not watch
the members afterwards: their replies reach the lead through peers.
--member NAME starts one member into the squad's existing workspace: its
window is rebuilt in place, the running members' panes moved (not restarted)
around a new pane for it, so the window matches the plan again. Without the
workspace, it creates it.
--agent, --model and --effort override the roster for this launch: a member
whose agent, model or effort differs from its last build is rebuilt or
reconfigured first, and every member's squad directory is rewritten to match.
The next build or assemble goes back to roster.json; edit roster.json to keep
a change.
Output: the check's MEMBER and WINDOW lines, then one `LAUNCHED <member>
(<agent>, model <model>, effort <level>) in herdr session <s>, window <n>,
pane <id>` line per member, with the display name after the member name when
the roster sets one; the pane is labelled with that name, or the member name.
With --dry-run, the herdr commands it would run. On a failure it stops, names
the member and pane, lists the members already running and the panes of those
that did not start, to close before launching each with --member (exit 1).""",
                 ["python3 roster.py launch ~/squads/shop --dry-run",
                  "python3 roster.py launch ~/squads/shop",
                  "python3 roster.py launch ~/squads/shop --model api=opencode/beam-free --effort api=high "
                  "--model lead=opus --effort lead=max --model web=gemini-3.8-flash --effort web=low",
                  "python3 roster.py launch ~/squads/shop --member web --session work"])
    n.add_argument("workspace", help=workspace_help)
    n.add_argument("--member", metavar="NAME", help=member_help)
    add_overrides(n)
    n.add_argument("--session", metavar="NAME", help="herdr session to launch in (default: herdr's default session)")
    n.add_argument("--dry-run", action="store_true",
                   help="validate and print the herdr commands, but start and change nothing")
    n.set_defaults(func=cmd_launch)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
