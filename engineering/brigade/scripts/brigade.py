#!/usr/bin/env python3
"""Keep the plan of a brigade run and do its git work: one worktree and one branch per order.

    brigade.py init PLAN --task TEXT --criteria-from FILE [--criteria-from FILE ...]
    brigade.py init PLAN --task TEXT --criterion TEXT [--criterion TEXT ...]
    brigade.py check PLAN
    brigade.py start PLAN [ORDER ...]
    brigade.py brief PLAN ORDER
    brigade.py inspect PLAN [ORDER ...]
    brigade.py rework PLAN ORDER --findings FILE
    brigade.py merge PLAN ORDER --checked TEXT
    brigade.py deliver PLAN --gates TEXT
    brigade.py status PLAN
    brigade.py clean PLAN [--integration]

`init` writes a new plan with the criteria word for word. `check` lists what is wrong with the
plan as a graph of orders: a criterion no order covers, an order that serves no criterion, orders
that wait for each other in a circle, two orders that could change the same file at the same time.
An order marked `foundation` runs alone, before every order that is not. `start` creates the
integration tree, and a tree for each order named. `brief` writes the work order to hand to a
subagent, which names the file the subagent writes its report to. `inspect` compares what an
order's branch holds with what the order allows, and refuses an order whose report is not on file.
`rework` opens a new round for an order that was not accepted, and writes its rework order.
`merge` merges an inspected order into the integration branch, then removes the order's tree, with
its build output, and its branch, whose commits are now in the integration branch, and keeps only
the .txt and .md files of the lead's checks of the order. `status` shows
where every order and criterion stands. `deliver` fast-forwards the branch the run started from to
the integration branch, once the gates have passed there. `clean` removes the trees and branches of merged orders
that are still there.

The run directory keeps what each subagent was asked in `orders`, and what it answered in
`reports`: <order>.md for the first round, <order>.round-2.md for the next, and so on.

Every command ends with a line on standard error: what the current folder takes on disk, and what
its disk has free.

Exit codes: 0 nothing is wrong (for `status`: every order is merged); 1 problems were found;
2 wrong usage or an unreadable plan; 3 (`status` only) nothing is wrong, but orders are not
merged yet.
Standard library only. Needs git 2.38 or newer to foresee merge conflicts.
"""

import argparse
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import time

PLAN_FORMAT = "brigade/plan@1"
STATE_FORMAT = "brigade/state@1"
INTEGRATION = "integration"
RUN_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
ORDER_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
ORDER = (
    ("id", ""),
    ("title", ""),
    ("goal", ""),
    ("covers", []),
    ("support", ""),
    ("owns", []),
    ("after", []),
    ("foundation", False),
    ("checks", []),
    ("notes", ""),
    ("dropped", ""),
)
LIST_ITEM = re.compile(r"^\s*(?:[-*+]\s+(?:\[[ xXuU~]\]\s+)?|\d+[.)]\s+)(.+?)\s*$")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)")
# Added lines worth reading before an order is accepted: a test that no longer runs, work left
# as a placeholder, a check that was silenced.
FLAGS = re.compile(
    r"#\[ignore|\.skip\(|\.only\(|\bx(?:it|test|describe)\(|\b(?:it|test)\.todo\("
    r"|pytest\.mark\.(?:skip|xfail)|unittest\.skip|\bt\.Skip|@Disabled\b|@Ignore\b"
    r"|\bTODO\b|\bFIXME\b|\bXXX\b|unimplemented!|todo!|NotImplementedError|[Nn]ot implemented"
    r"|eslint-disable|@ts-ignore|@ts-expect-error|#\s*type:\s*ignore|#\s*noqa|#\[allow\("
    r"|//\s*nolint|--no-verify"
)
MOST_FLAGS = 15
MOST_FILES = 10


class UsageError(Exception):
    """A problem with the input, reported to the caller with exit code 2."""


class Problem(Exception):
    """Something that stops the command, reported to the caller with exit code 1."""


# ----------------------------------------------------------------------------------- git


def git(folder, *args, **options):
    """Runs git in a folder. Raises Problem when it fails, unless check=False is given."""
    command = ["git", "-C", folder, "-c", "core.quotePath=false"] + list(args)
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                universal_newlines=True)
    except OSError as error:
        raise UsageError("git cannot be run: %s" % error)
    if result.returncode and options.get("check", True):
        said = (result.stderr or result.stdout).strip()
        raise Problem("git %s failed in %s:\n%s" % (" ".join(args), folder, said))
    return result


def said(result):
    return result.stdout.strip()


def toplevel(folder):
    """The root of the checkout a folder is in, or None when it is in no git repository."""
    if not os.path.isdir(folder):
        return None
    result = git(folder, "rev-parse", "--show-toplevel", check=False)
    return os.path.realpath(said(result)) if result.returncode == 0 and said(result) else None


def commit_of(folder, ref):
    result = git(folder, "rev-parse", "--verify", "--quiet", "%s^{commit}" % ref, check=False)
    return said(result) if result.returncode == 0 else None


def short(commit):
    return commit[:8]


def dirty(folder):
    """The uncommitted and untracked entries of a checkout, as `git status --porcelain` lines."""
    return [line for line in git(folder, "status", "--porcelain").stdout.splitlines() if line]


# ---------------------------------------------------------------------------------- init


def criteria_from(path, section):
    """The criteria written in a file: its list items, or else every line that is not a heading."""
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise UsageError("criteria file %s: %s" % (path, error))
    if section:
        lines = section_of(lines, section, path)
    items = [match.group(1) for match in map(LIST_ITEM.match, lines) if match]
    if not items:
        items = [line.strip() for line in lines if line.strip() and not HEADING.match(line)]
    if not items:
        where = " under the heading %r" % section if section else ""
        raise UsageError("criteria file %s holds no criteria%s." % (path, where))
    return items


def criteria_of(files, section):
    """The criteria of one or more files, each with an id and the file it comes from.

    With one file the ids are c1, c2, and so on. With several, each id starts with a short name
    of its file, so that a ticket's criteria stay together: t038-c1, t038-c2, t039-c1.
    """
    if len(files) == 1:
        return [{"id": "c%d" % (index + 1), "text": text, "source": files[0]}
                for index, text in enumerate(criteria_from(files[0], section))]
    return [{"id": "%s-c%d" % (prefix, index + 1), "text": text, "source": path}
            for path, prefix in zip(files, prefixes(files))
            for index, text in enumerate(criteria_from(path, section))]


def prefixes(files):
    """A short, distinct name for each file: its first word, else its whole name, else f1, f2."""
    stems = [os.path.splitext(os.path.basename(path))[0].lower() for path in files]
    first = [re.match(r"[a-z0-9]*", stem).group(0) for stem in stems]
    whole = [re.sub(r"[^a-z0-9]+", "-", stem).strip("-") for stem in stems]
    for names in (first, whole):
        if all(names) and len(set(names)) == len(names):
            return names
    return ["f%d" % (index + 1) for index in range(len(files))]


def section_of(lines, section, path):
    wanted = section.strip().lower()
    start = level = None
    for index, line in enumerate(lines):
        match = HEADING.match(line)
        if not match:
            continue
        if start is None and match.group(2).strip().lower() == wanted:
            start, level = index + 1, len(match.group(1))
        elif start is not None and len(match.group(1)) <= level:
            return lines[start:index]
    if start is None:
        raise UsageError("criteria file %s has no heading %r." % (path, section))
    return lines[start:]


def init(args):
    path = os.path.abspath(args.plan)
    folder = os.path.dirname(path)
    if os.path.exists(path):
        raise UsageError("%s exists already. Edit it, or choose another run directory." % path)
    if args.criteria_from:
        criteria = criteria_of(args.criteria_from, args.section)
    else:
        criteria = [{"id": "c%d" % (index + 1), "text": text.strip()}
                    for index, text in enumerate(args.criterion or []) if text.strip()]
    if not criteria:
        raise UsageError("give the criteria with --criteria-from FILE or --criterion TEXT.")
    if not args.task.strip():
        raise UsageError("--task is empty.")
    repo = toplevel(os.path.abspath(args.repo))
    if not repo:
        raise UsageError("%s is not in a git repository. Worktrees need one: ask the user "
                         "before creating it." % os.path.abspath(args.repo))
    base = args.base
    if not base:
        base = said(git(repo, "symbolic-ref", "--short", "-q", "HEAD", check=False))
        base = base or commit_of(repo, "HEAD")
    if not base or not commit_of(repo, base):
        raise UsageError("the base %r is not a commit of %s. A repository with no commit "
                         "cannot have worktrees." % (base or "HEAD", repo))
    name = args.run or os.path.basename(folder)
    if not RUN_NAME.match(name):
        raise UsageError("the run name %r must be lowercase letters, digits, '.', '_' and '-'. "
                         "Give one with --run." % name)
    os.makedirs(folder, exist_ok=True)
    folder = os.path.realpath(folder)
    plan = {
        "format": PLAN_FORMAT,
        "run": name,
        "task": args.task.strip(),
        "repo": os.path.relpath(repo, folder),
        "base": base,
        "source": args.source or "",
        "trees": args.trees or "trees",
        "setup": [],
        "gates": [],
        "conventions": [],
        "criteria": criteria,
        "orders": [],
    }
    write_json(path, plan)
    print("Wrote %s: run %s, %d criteri%s, from %s (%s) of %s." % (
        args.plan, name, len(criteria), "on" if len(criteria) == 1 else "a", base,
        short(commit_of(repo, base)), repo))
    left = [line for line in dirty(repo)
            if not inside(folder, os.path.join(repo, line[3:].rstrip("/")))]
    if left:
        print("note: uncommitted or untracked in the checkout: %s. This is not part of %s, so no "
              "tree will hold it." % (some([line[3:] for line in left]), base))
    return 0


def write_json(path, value):
    partial = path + ".partial"
    with open(partial, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(partial, path)


# ----------------------------------------------------------------------------------- run


class Run:
    """A plan, the state the script keeps beside it, and the repository they are about."""

    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.dir = os.path.realpath(os.path.dirname(self.path))
        self.plan = self.read(self.path, "plan")
        if self.plan.get("format") != PLAN_FORMAT:
            raise UsageError("%s is not a brigade plan (its format is %r, not %r)." % (
                path, self.plan.get("format"), PLAN_FORMAT))
        self.shape = self.shape_problems()
        if self.shape:
            return
        self.name = self.plan["run"]
        self.repo = toplevel(os.path.join(self.dir, self.plan["repo"]))
        if not self.repo:
            raise UsageError("the plan's `repo` (%s) is not in a git repository." % (
                os.path.join(self.dir, self.plan["repo"])))
        self.trees = os.path.normpath(os.path.join(self.dir, self.plan.get("trees") or "trees"))
        self.orders = [dict(ORDER, **order) for order in self.plan["orders"]]
        self.by_id = {order["id"]: order for order in self.orders}
        self.live = [order for order in self.orders if not order["dropped"].strip()]
        self.foundation = [order for order in self.live if order["foundation"]]
        self.stated = {order["id"]: list(order["after"]) for order in self.orders}
        self.add_foundation_edges()
        self.state_path = os.path.join(self.dir, "state.json")
        self.state = {"format": STATE_FORMAT, "base_commit": "", "checkout": [], "orders": {}}
        if os.path.exists(self.state_path):
            self.state.update(self.read(self.state_path, "state"))

    def add_foundation_edges(self):
        """Chains the foundation orders as they are listed, and puts every other order after."""
        def wait(order, other):
            if other["id"] not in order["after"]:
                order["after"] = order["after"] + [other["id"]]

        for index, order in enumerate(self.foundation[1:]):
            wait(order, self.foundation[index])
        for order in self.live:
            if self.foundation and not order["foundation"]:
                wait(order, self.foundation[-1])

    @staticmethod
    def read(path, what):
        try:
            with open(path, encoding="utf-8") as handle:
                value = json.load(handle)
        except (OSError, UnicodeDecodeError) as error:
            raise UsageError("%s %s: %s" % (what, path, error))
        except ValueError as error:
            raise UsageError("%s %s is not valid JSON: %s" % (what, path, error))
        if not isinstance(value, dict):
            raise UsageError("%s %s must hold a JSON object." % (what, path))
        return value

    def save(self):
        write_json(self.state_path, self.state)

    def tree(self, order_id):
        return os.path.join(self.trees, order_id)

    def branch(self, order_id):
        return "brigade/%s/%s" % (self.name, order_id)

    def round_of(self, order_id):
        return int(self.state["orders"].get(order_id, {}).get("round", 1))

    def paper(self, folder, order_id, number=None):
        """The file of an order in `orders` (what was asked) or `reports` (what was answered)."""
        number = number or self.round_of(order_id)
        name = order_id if number == 1 else "%s.round-%d" % (order_id, number)
        return os.path.join(self.dir, folder, name + ".md")

    def shown(self, path):
        """A path as the reader of the output can use it: relative to where they stand."""
        relative = os.path.relpath(path)
        return path if relative == "." or relative.startswith("..") else relative

    def started(self, order_id):
        return order_id in self.state["orders"]

    def merged(self, order_id):
        return bool(self.state["orders"].get(order_id, {}).get("merged"))

    def state_of(self, order):
        if order["dropped"].strip():
            return "dropped"
        if self.merged(order["id"]):
            return "merged"
        if self.started(order["id"]):
            return "started"
        if all(self.merged(other) for other in order["after"]):
            return "ready"
        return "waiting"

    def require_shape(self):
        if self.shape:
            for text in self.shape:
                print("PROBLEM  %s" % text)
            raise Problem("the plan cannot be read as a plan: fix it first.")

    # ------------------------------------------------------------------------ the plan

    def shape_problems(self):
        """What makes the plan unreadable: a missing field, a wrong type, an unknown name."""
        plan, problems = self.plan, []
        for key in ("run", "task", "repo", "base"):
            if not isinstance(plan.get(key), str) or not plan[key].strip():
                problems.append("`%s` must be a text that is not empty." % key)
        if isinstance(plan.get("run"), str) and not RUN_NAME.match(plan["run"]):
            problems.append("`run` (%r) must be lowercase letters, digits, '.', '_' and '-'."
                            % plan["run"])
        if not isinstance(plan.get("trees", ""), str):
            problems.append("`trees` must be a path.")
        if not isinstance(plan.get("source", ""), str):
            problems.append("`source` must be a text.")
        for key in ("setup", "gates", "conventions"):
            if not is_strings(plan.get(key, [])):
                problems.append("`%s` must be a list of texts." % key)
        criteria = plan.get("criteria")
        known = []
        if not isinstance(criteria, list) or not criteria:
            problems.append("`criteria` must be a list with at least one criterion.")
            criteria = []
        for index, criterion in enumerate(criteria):
            if (not isinstance(criterion, dict) or not text_in(criterion, "id")
                    or not text_in(criterion, "text")):
                problems.append("criterion %d must have an `id` and a `text`." % (index + 1))
            elif criterion["id"] in known:
                problems.append("two criteria have the id %s." % criterion["id"])
            else:
                known.append(criterion["id"])
        orders = plan.get("orders")
        if not isinstance(orders, list):
            problems.append("`orders` must be a list.")
            orders = []
        ids = [order.get("id") if isinstance(order, dict) else None for order in orders]
        for index, order in enumerate(orders):
            problems.extend(self.order_shape(order, index, ids, known))
        return problems

    @staticmethod
    def order_shape(order, index, ids, criteria):
        if not isinstance(order, dict):
            return ["order %d must be an object." % (index + 1)]
        name = order.get("id")
        if not isinstance(name, str) or not ORDER_ID.match(name) or name == INTEGRATION:
            return ["order %d: `id` (%r) must be lowercase letters, digits and '-', and not %r."
                    % (index + 1, name, INTEGRATION)]
        problems = []
        for key, default in ORDER:
            value = order.get(key, default)
            if isinstance(default, bool):
                if not isinstance(value, bool):
                    problems.append("order %s: `%s` must be true or false." % (name, key))
            elif isinstance(default, list) and not is_strings(value):
                problems.append("order %s: `%s` must be a list of texts." % (name, key))
            elif isinstance(default, str) and not isinstance(value, str):
                problems.append("order %s: `%s` must be a text." % (name, key))
        if problems:
            return problems
        if ids.count(name) > 1 and ids.index(name) == index:
            problems.append("order %s: its id is used %d times." % (name, ids.count(name)))
        unknown = sorted(set(order) - {key for key, _ in ORDER})
        if unknown:
            problems.append("order %s: unknown field %s." % (name, ", ".join(unknown)))
        for criterion in order.get("covers", []):
            if criterion not in criteria:
                problems.append("order %s: `covers` names %s, which is not a criterion." % (
                    name, criterion))
        for other in order.get("after", []):
            if other == name or other not in ids:
                problems.append("order %s: `after` names %s, which is not another order." % (
                    name, other))
        for path in order.get("owns", []):
            if owned_path(path) is None:
                problems.append("order %s: `owns` holds %r. A path is relative to the "
                                "repository root and stays inside it." % (name, path))
        return problems

    def plan_problems(self):
        """Problems and notes about the plan as a whole. Shape problems come first and alone."""
        if self.shape:
            return list(self.shape), []
        problems, notes = [], []
        if not self.live:
            problems.append("the plan has no orders.")
        for order in self.live:
            name = order["id"]
            if not order["goal"].strip():
                problems.append("order %s: `goal` is empty. The subagent gets nothing to do."
                                % name)
            if not order["owns"]:
                problems.append("order %s: `owns` is empty. Name the files and folders it may "
                                "change." % name)
            if not order["covers"] and not order["support"].strip():
                problems.append("order %s covers no criterion and gives no `support` reason. "
                                "Work that serves no criterion was not asked for." % name)
            for other in self.stated[name]:
                if self.by_id[other]["dropped"].strip():
                    problems.append("order %s comes `after` %s, which is dropped." % (name, other))
                elif order["foundation"] and not self.by_id[other]["foundation"]:
                    problems.append(
                        "order %s is foundation and comes `after` %s, which is not. The "
                        "foundation is finished before any other order starts." % (name, other))
        for criterion in self.plan["criteria"]:
            if not any(criterion["id"] in order["covers"] for order in self.live):
                problems.append("criterion %s is covered by no order: %s" % (
                    criterion["id"], cut(criterion["text"], 90)))
        cycle = self.cycle()
        if cycle:
            problems.append("orders wait for each other in a circle (each for the next): %s."
                            % " -> ".join(cycle))
            return problems, notes
        problems.extend(self.overlaps())
        if not self.plan.get("gates"):
            notes.append("`gates` is empty: name the commands that decide whether the code is "
                         "sound, so that every work order carries them.")
        if self.live and not self.foundation:
            notes.append("no order is marked `foundation`. If any part sets up what the others "
                         "build on (scaffolding, tooling, shared structure), mark it, so that it "
                         "is finished alone before the others start.")
        waves = self.waves()
        if waves:
            notes.append("order of work: %s." % " -> ".join(
                ", ".join(wave) + (" at once" if len(wave) > 1 else "") for wave in waves))
            if len(waves) == len(self.live) and len(waves) > 1:
                notes.append("no two orders can run at the same time. If that is what the task "
                             "needs, tell the user that the split saves no time.")
        return problems, notes

    def before(self, order_id, seen=None):
        """Every live order that must be merged before this one starts, however far back."""
        seen = set() if seen is None else seen
        for other in self.by_id[order_id]["after"]:
            if other not in seen and other in self.by_id:
                seen.add(other)
                self.before(other, seen)
        return seen

    def cycle(self):
        done, path = set(), []

        def visit(name):
            if name in path:
                return path[path.index(name):] + [name]
            if name in done:
                return None
            path.append(name)
            for other in self.by_id[name]["after"]:
                found = visit(other)
                if found:
                    return found
            path.pop()
            done.add(name)
            return None

        for order in self.live:
            found = visit(order["id"])
            if found:
                return found
        return None

    def overlaps(self):
        problems = []
        for index, first in enumerate(self.live):
            for second in self.live[index + 1:]:
                if first["id"] in self.before(second["id"]):
                    continue
                if second["id"] in self.before(first["id"]):
                    continue
                shared = sorted({
                    max(owned_path(one), owned_path(two), key=len)
                    for one in first["owns"] for two in second["owns"]
                    if overlap(owned_path(one), owned_path(two))})
                if shared:
                    problems.append(
                        "orders %s and %s could run at the same time and both own %s. Give the "
                        "path to one of them, or put one `after` the other." % (
                            first["id"], second["id"], ", ".join(shared)))
        return problems

    def waves(self):
        """The live orders grouped by how early each can start."""
        level = {}

        def depth(name):
            if name not in level:
                waits = [depth(other) for other in self.by_id[name]["after"]
                         if not self.by_id[other]["dropped"].strip()]
                level[name] = 1 + max(waits or [0])
            return level[name]

        waves = {}
        for order in self.live:
            waves.setdefault(depth(order["id"]), []).append(order["id"])
        return [waves[key] for key in sorted(waves)]

    # ----------------------------------------------------------------------- the trees

    def ensure_integration(self):
        """Creates the integration branch and its tree on first use. Returns its commit."""
        branch, tree = self.branch(INTEGRATION), self.tree(INTEGRATION)
        if not self.state["base_commit"]:
            base = commit_of(self.repo, self.plan["base"])
            if not base:
                raise Problem("the plan's `base` (%s) is not a commit of %s." % (
                    self.plan["base"], self.repo))
            if commit_of(self.repo, "refs/heads/" + branch):
                raise Problem("the branch %s exists, from an earlier run with this name. "
                              "Choose another `run` name in the plan." % branch)
            if os.path.exists(tree):
                raise Problem("%s exists already. Choose another run directory." % tree)
            self.keep_out_of_status()
            self.state["checkout"] = dirty(self.repo)
            os.makedirs(self.trees, exist_ok=True)
            git(self.repo, "worktree", "add", "-b", branch, tree, base)
            self.state["base_commit"] = base
            self.save()
            print("%-12s %s  on %s, from %s (%s)" % (
                INTEGRATION, self.shown(tree), branch, self.plan["base"], short(base)))
        elif not os.path.isdir(tree):
            git(self.repo, "worktree", "prune")
            git(self.repo, "worktree", "add", tree, branch)
            print("%-12s %s  on %s (its tree was missing and was made again)" % (
                INTEGRATION, self.shown(tree), branch))
        return commit_of(self.repo, branch)

    def keep_out_of_status(self):
        """Hides trees that lie inside the checkout from its `git status` and `git add`."""
        if not inside(self.trees, self.repo):
            return
        relative = os.path.relpath(self.trees, self.repo).replace(os.sep, "/")
        if git(self.repo, "check-ignore", "-q", relative + "/x", check=False).returncode == 0:
            return
        exclude = said(git(self.repo, "rev-parse", "--git-path", "info/exclude"))
        exclude = os.path.join(self.repo, exclude)
        try:
            os.makedirs(os.path.dirname(exclude), exist_ok=True)
            with open(exclude, "a", encoding="utf-8") as handle:
                handle.write("\n# worktrees of brigade run %s\n/%s/\n" % (self.name, relative))
        except OSError as error:
            raise Problem(
                "the trees would lie inside the checkout, at %s, and git could not be told to "
                "leave them out of `git status` (%s). Add the line /%s/ to %s yourself, or put "
                "the trees elsewhere with `trees` in the plan." % (
                    relative, error, relative, exclude))
        print("note: added /%s/ to %s, so the trees stay out of `git status`." % (
            relative, self.shown(exclude)))

    def inspect(self, order_id):
        """What an order's branch holds, set against what the order allows.

        Returns the facts in one line, the problems and the notes.
        """
        order, problems, notes = self.by_id[order_id], [], []
        branch, tree = self.branch(order_id), self.tree(order_id)
        target = self.branch(INTEGRATION)
        head = commit_of(self.repo, "refs/heads/" + branch)
        if not head:
            return "", ["its branch %s is gone." % branch], notes
        report = self.paper("reports", order_id)
        if not filled(report):
            problems.append(
                "no report on file at %s. Have the subagent write it. If it cannot, save its "
                "reply there yourself, word for word, and say in the first line that you did."
                % self.shown(report))
        if not os.path.isdir(tree):
            problems.append("its tree %s is gone." % self.shown(tree))
        else:
            current = said(git(tree, "rev-parse", "--abbrev-ref", "HEAD", check=False))
            if current != branch:
                problems.append("its tree is on %s, not on %s. The work may be on the wrong "
                                "branch." % (current or "no branch", branch))
            left = [line[3:] for line in dirty(tree)]
            if left:
                problems.append("uncommitted or untracked in its tree: %s. The branch does not "
                                "hold this work." % some(left))
        base = self.state["orders"][order_id]["base"]
        if git(self.repo, "merge-base", "--is-ancestor", base, head, check=False).returncode:
            problems.append("its branch no longer holds the commit it started from (%s). It was "
                            "rebased or reset, so it cannot be compared or merged." % short(base))
            return "", problems, notes
        commits = int(said(git(self.repo, "rev-list", "--count", "%s..%s" % (target, branch))))
        if not commits:
            problems.append("no commit on %s. The work was not done, or not committed." % branch)
        changed = git(self.repo, "diff", "--name-status", "--no-renames",
                      "%s...%s" % (target, branch)).stdout.splitlines()
        files = [line.split("\t", 1) for line in changed if "\t" in line]
        outside = [path for _, path in files if not owns(order["owns"], path)]
        if outside:
            problems.append("changed outside the paths it owns: %s." % some(outside))
        deleted = [path for kind, path in files if kind == "D"]
        if deleted:
            notes.append("deleted: %s." % some(deleted))
        clash = self.conflicts(target, branch)
        if clash is None:
            notes.append("this git cannot foresee merge conflicts (it needs 2.38 or newer).")
        elif clash:
            problems.append(
                "would conflict with %s in: %s. Have the order's subagent merge %s into its "
                "tree, resolve the conflict there, and run the gates again." % (
                    target, some(clash), target))
        behind = int(said(git(self.repo, "rev-list", "--count", "%s..%s" % (branch, target))))
        if behind:
            notes.append("%s has %d commits this tree does not hold: other orders were merged "
                         "since it started." % (target, behind))
        notes.extend(self.flagged(target, branch))
        facts = "%d commit%s, %d file%s changed" % (
            commits, "" if commits == 1 else "s", len(files), "" if len(files) == 1 else "s")
        return facts, problems, notes

    def conflicts(self, target, branch):
        """The files a merge would conflict in, or None when this git cannot tell."""
        result = git(self.repo, "merge-tree", "--write-tree", "--name-only", "--no-messages",
                     target, branch, check=False)
        if result.returncode == 0:
            return []
        if result.returncode != 1:
            return None
        return [line for line in result.stdout.splitlines()[1:] if line.strip()]

    def flagged(self, target, branch):
        """Added lines that may hide unfinished work: a skipped test, a stub, a silenced check."""
        diff = git(self.repo, "diff", "-U0", "--no-color", "--no-renames",
                   "%s...%s" % (target, branch)).stdout
        found, path, number = [], None, 0
        for line in diff.splitlines():
            if line.startswith("+++ "):
                path = line[6:] if line.startswith("+++ b/") else None
            elif line.startswith("@@"):
                match = HUNK.match(line)
                number = int(match.group(1)) if match else 0
            elif line.startswith("+") and path:
                if FLAGS.search(line[1:]):
                    found.append("%s:%d: %s" % (path, number, cut(line[1:].strip(), 100)))
                number += 1
        notes = ["read this line: %s" % text for text in found[:MOST_FLAGS]]
        if len(found) > MOST_FLAGS:
            notes.append("and %d more lines like these." % (len(found) - MOST_FLAGS))
        return notes

    def checkout_note(self):
        """A note when the checkout the run started in has changed since the run began."""
        new = [line[3:] for line in dirty(self.repo) if line not in self.state["checkout"]
               and not inside(os.path.join(self.repo, line[3:].rstrip("/")), self.dir)
               and not inside(self.dir, os.path.join(self.repo, line[3:].rstrip("/")))]
        if not new:
            return None
        return ("the checkout at %s has changes it did not have when the run began: %s. "
                "A subagent may have written outside its tree." % (self.shown(self.repo),
                                                                    some(new)))


def filled(path):
    """Whether a file exists and holds more than white space."""
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return bool(handle.read().strip())
    except OSError:
        return False


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text.rstrip("\n") + "\n")


def report_part(report, parts, earlier=False):
    """The closing part of an order: where the report goes, and what it holds."""
    out = ["## Your report", ""]
    out.append("Write %s: `%s`. %sIt is the only file outside your copy that you write. Write it "
               "after your last commit, with these parts, in this order:" % (
                   "the report of this round to a new file" if earlier
                   else "your report to this file", report,
                   "Leave the reports of earlier rounds as they are. " if earlier else ""))
    out.append("")
    out.extend("%d. %s" % (index + 1, part) for index, part in enumerate(parts))
    out.append("")
    out.append("Then end with a reply of one line: your result (done, partly done, or blocked) "
               "and the path of the report file. If the file cannot be written, say so, and "
               "reply with the whole report instead.")
    return out


def is_strings(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def text_in(holder, key):
    return isinstance(holder.get(key), str) and bool(holder[key].strip())


def owned_path(path):
    """A path of `owns` in its plain form, '.' for the whole repository, None when not allowed."""
    if not path.strip() or path.startswith(("/", "~")) or "\\" in path:
        return None
    plain = posixpath.normpath(path.strip())
    return None if plain == ".." or plain.startswith("../") else plain


def overlap(one, two):
    return (one == two or "." in (one, two)
            or one.startswith(two + "/") or two.startswith(one + "/"))


def owns(paths, changed):
    return any(overlap(owned_path(path), changed) and len(owned_path(path)) <= len(changed)
               or owned_path(path) == "." for path in paths)


def inside(path, folder):
    return os.path.commonpath([os.path.realpath(path), folder]) == folder


def cut(text, most):
    text = " ".join(text.split())
    return text if len(text) <= most else text[:most - 1] + "…"


def some(items):
    listed = ", ".join(items[:MOST_FILES])
    return listed if len(items) <= MOST_FILES else "%s and %d more" % (
        listed, len(items) - MOST_FILES)


def known_orders(run, names):
    for name in names:
        if name not in run.by_id:
            raise UsageError("%s is not an order of the plan. Its orders: %s." % (
                name, ", ".join(sorted(run.by_id)) or "none"))


def print_plan(problems, notes):
    for text in problems:
        print("PROBLEM  %s" % text)
    for text in notes:
        print("note     %s" % text)


# ------------------------------------------------------------------------------ commands


def check(args):
    run = Run(args.plan)
    problems, notes = run.plan_problems()
    print_plan(problems, notes)
    if problems:
        print("%d problem%s in the plan." % (len(problems), "" if len(problems) == 1 else "s"))
        return 1
    orders, criteria = len(run.live), len(run.plan["criteria"])
    print("The plan holds: %d order%s, %d criteri%s, each covered." % (
        orders, "" if orders == 1 else "s", criteria, "on" if criteria == 1 else "a"))
    return 0


def start(args):
    run = Run(args.plan)
    run.require_shape()
    known_orders(run, args.orders)
    if args.orders:
        problems, _ = run.plan_problems()
        for name in args.orders:
            state = run.state_of(run.by_id[name])
            if state == "waiting":
                waits = [other for other in run.by_id[name]["after"] if not run.merged(other)]
                problems.append("order %s comes after %s, which %s not merged yet." % (
                    name, ", ".join(waits), "is" if len(waits) == 1 else "are"))
            elif state != "ready":
                problems.append("order %s is %s already." % (name, state))
            elif os.path.exists(run.tree(name)):
                problems.append("order %s: %s exists already." % (name, run.shown(run.tree(name))))
            elif commit_of(run.repo, "refs/heads/" + run.branch(name)):
                problems.append("order %s: the branch %s exists already." % (
                    name, run.branch(name)))
        if problems:
            print_plan(problems, [])
            print("Nothing was started.")
            return 1
    head = run.ensure_integration()
    for name in args.orders:
        git(run.repo, "worktree", "add", "-b", run.branch(name), run.tree(name), head)
        run.state["orders"][name] = {"base": head, "merged": "", "checked": "", "round": 1}
        os.makedirs(os.path.join(run.dir, "reports"), exist_ok=True)
        run.save()
        print("%-12s %s  on %s, from %s" % (
            name, run.shown(run.tree(name)), run.branch(name), short(head)))
    return 0


def brief(args):
    run = Run(args.plan)
    run.require_shape()
    known_orders(run, [args.order])
    order = run.by_id[args.order]
    if not run.started(args.order):
        raise Problem("order %s has no tree yet. Start it first: start %s %s" % (
            args.order, args.plan, args.order))
    tree, branch = run.tree(args.order), run.branch(args.order)
    base = run.state["orders"][args.order]["base"]
    texts = {criterion["id"]: criterion["text"] for criterion in run.plan["criteria"]}
    out = []
    out.append("# Work order %s%s" % (order["id"], ": " + order["title"] if order["title"] else ""))
    out.append("")
    out.append("You are one of several agents who build one task part by part. Each works in its "
               "own copy of the repository. The lead, who sent you this order, will read your "
               "changes, run the checks again, and merge your part with the others. You know "
               "nothing about the task beyond this order, so everything you need is here. Where "
               "it is not, stop and report.")
    out.append("")
    out.append("## Where you work")
    out.append("")
    out.append("- Your copy of the repository: `%s`" % tree)
    out.append("- It is a git worktree on the branch `%s`, started from commit `%s`." % (
        branch, short(base)))
    out.append("- Run every command from inside that folder, and read and change files only "
               "inside it. Start each shell command with `cd %s`." % quoted(tree))
    out.append("- Other copies of this repository exist, among them `%s`. They belong to "
               "others. Never write to them, and do not take their content for yours." % run.repo)
    if run.plan["setup"]:
        out.append("- Your copy is a fresh checkout. Before anything else, run in it:")
        out.extend("  - `%s`" % command for command in run.plan["setup"])
    out.append("")
    out.append("## The task as a whole")
    out.append("")
    out.append(run.plan["task"])
    out.append("")
    out.append("## Where your part stands")
    out.append("")
    if order["foundation"]:
        out.append("Your part is foundation: the other parts are built on it. You work alone, "
                   "and they start only after your part is checked and merged. Whatever you set "
                   "up here, every later part follows, so set up one way of doing each thing "
                   "(layout, naming, tooling, configuration, shared helpers) and keep to it.")
    elif run.foundation:
        out.append("The foundation of the task is already in your copy: %s. Build on it. Do not "
                   "set up a second layout, toolchain, configuration or helper for something "
                   "it already provides, and follow the patterns it uses." % ", ".join(
                       "%s (%s)" % (other["id"], other["title"]) if other["title"]
                       else other["id"] for other in run.foundation))
    else:
        out.append("Build on what is already in your copy, and follow the patterns it uses.")
    earlier = sorted(name for name in run.before(order["id"])
                     if not run.by_id[name]["foundation"])
    if earlier:
        out.append("")
        out.append("Also merged into your copy, and there to build on: %s." % ", ".join(
            "%s (%s)" % (name, run.by_id[name]["title"]) if run.by_id[name]["title"] else name
            for name in earlier))
    if run.plan.get("conventions"):
        out.append("")
        out.append("Every part follows these conventions:")
        out.append("")
        out.extend("- %s" % text for text in run.plan["conventions"])
    out.append("")
    out.append("## Your part")
    out.append("")
    out.append(order["goal"].strip())
    out.append("")
    if order["covers"]:
        out.append("## Criteria your part must meet")
        out.append("")
        out.append("These are the user's words. You may not change, reinterpret or drop any.")
        out.append("")
        out.extend("- %s: %s" % (name, texts[name]) for name in order["covers"])
    else:
        out.append("## Why this part exists")
        out.append("")
        out.append(order["support"].strip())
    out.append("")
    out.append("## Paths you own")
    out.append("")
    if any(owned_path(path) == "." for path in order["owns"]):
        out.append("The whole repository, inside your copy. Change only what your part needs.")
    else:
        out.extend("- `%s`" % path for path in order["owns"])
        out.append("")
        out.append("Create, change and delete files only under these paths. %s If your part "
                   "cannot be done without a change elsewhere, do not make that change: report "
                   "which file, and what it needs." % (
                       "The rest belongs to the parts that come after yours."
                       if order["foundation"] else
                       "Other agents may be changing the rest right now."))
    if order["notes"].strip():
        out.append("")
        out.append("## What the lead has fixed")
        out.append("")
        out.append(order["notes"].strip())
    out.append("")
    out.append("## Rules")
    out.append("")
    out.append("- Build what this order asks, and nothing more: no extra feature, no refactoring, "
               "no renaming, no dependency upgrade, no reformatting of code you did not have to "
               "change.")
    out.append("- Finish the work. No placeholder, no stub, no value written to match a test, no "
               "TODO in place of code.")
    out.append("- Never skip, ignore, disable, delete or weaken a test or a check to get a pass. "
               "A test you cannot make pass is reported as failing.")
    out.append("- When this order is unclear, contradicts itself or cannot be done, stop and "
               "report. Do not guess, and do not choose for the user.")
    out.append("- Do not push, merge, rebase, reset, switch branches, or create branches or "
               "worktrees. The one exception: when a rework order asks you to, merge `%s` into "
               "your copy. Do not install anything outside your copy." % run.branch(INTEGRATION))
    out.append("- A file you need only for a check goes inside your copy, and is removed before "
               "your last commit.")
    out.append("")
    out.append("## Before you report")
    out.append("")
    step = 1
    if run.plan["gates"]:
        out.append("%d. Run every gate in your copy. Each must pass:" % step)
        out.extend("   - `%s`" % command for command in run.plan["gates"])
        step += 1
    if order["checks"]:
        out.append("%d. Check your part the way the lead will:" % step)
        out.extend("   - %s" % text for text in order["checks"])
        step += 1
    out.append("%d. Commit all of your work on `%s`. `git status` must show nothing left." % (
        step, branch))
    out.append("")
    parts = ["**Result:** done, partly done, or blocked."]
    if order["covers"]:
        parts.append("**Criteria:** for each one above, met or not met, with the command you ran "
                     "and what it printed, or the place in the code that shows it.")
    else:
        parts.append("**What exists now:** what you built, and how you checked that it works.")
    parts.append("**Commits:** the output of `git log --oneline %s..HEAD`." % short(base))
    parts.append("**Gates:** each command, its exit code, and its last lines as printed.")
    parts.append("**Not done:** what is missing, and why.")
    parts.append("**Deviations:** everything that differs from this order, every assumption you "
                 "made, every file you touched outside your paths.")
    parts.append("**For the lead:** defects you saw in other parts, and open questions.")
    if order["foundation"]:
        parts.append("**Conventions you set:** the layout, the names, the patterns, and the "
                     "commands to install, build and test, as the later parts must follow them.")
    out.extend(report_part(run.paper("reports", args.order), parts))
    path = run.paper("orders", args.order, 1)
    write_text(path, "\n".join(out))
    print("Wrote %s. The report goes to %s." % (
        run.shown(path), run.shown(run.paper("reports", args.order))))
    print("Prompt for the subagent:")
    print("Your work order is the file %s. Read it in full first, then carry it out exactly as "
          "written. It also tells you where to write your report." % path)
    return 0


def rework(args):
    run = Run(args.plan)
    run.require_shape()
    known_orders(run, [args.order])
    name = args.order
    state = run.state_of(run.by_id[name])
    if state != "started":
        raise Problem("order %s is %s. Only an order that is started can be sent back." % (
            name, state))
    try:
        if args.findings == "-":
            findings = sys.stdin.read()
        else:
            with open(args.findings, encoding="utf-8") as handle:
                findings = handle.read()
    except (OSError, UnicodeDecodeError) as error:
        raise UsageError("findings file %s: %s" % (args.findings, error))
    if not findings.strip():
        raise UsageError("the findings are empty. Say what you ran, what you saw, and which "
                         "words of the order or of a criterion it fails.")
    last = run.paper("reports", name)
    if not filled(last):
        raise Problem(
            "round %d of order %s has no report on file at %s. Put it there before the next "
            "round starts: the subagent's own report, or its reply saved word for word, or a "
            "line saying that it gave none." % (run.round_of(name), name, run.shown(last)))
    tree, branch = run.tree(name), run.branch(name)
    head = commit_of(run.repo, "refs/heads/" + branch) or run.state["orders"][name]["base"]
    run.state["orders"][name]["round"] = run.round_of(name) + 1
    run.save()
    number = run.round_of(name)
    first, path, report = (run.paper("orders", name, 1), run.paper("orders", name),
                           run.paper("reports", name))
    out = ["# Rework of order %s, round %d" % (name, number), ""]
    out.append("The lead checked the work on `%s` and did not accept it. What the lead found is "
               "below. The work order, `%s`, still holds in full: the same copy of the "
               "repository (`%s`), the same branch, the same paths, the same rules, and the "
               "same steps before you report." % (branch, first, tree))
    out.extend(["", "## What the lead found", "", findings.strip(), "", "## What to do", ""])
    out.append("- Fix each finding in your copy, and change nothing else.")
    out.append("- Where you think a finding is wrong, do not work around it. Say so in your "
               "report, with the command and the output that show it.")
    out.append("- Run every gate again, and commit all of your work on `%s`." % branch)
    out.append("")
    out.extend(report_part(report, [
        "**Result:** done, partly done, or blocked.",
        "**Findings:** for each finding above, fixed, not fixed, or disputed, with the command "
        "you ran and what it printed.",
        "**Commits:** the output of `git log --oneline %s..HEAD`." % short(head),
        "**Gates:** each command, its exit code, and its last lines as printed.",
        "**Deviations:** everything that differs from the work order or from this rework "
        "order, and every assumption you made.",
        "**For the lead:** defects you saw in other parts, and open questions.",
    ], earlier=True))
    write_text(path, "\n".join(out))
    print("Wrote %s: round %d of order %s. The report goes to %s." % (
        run.shown(path), number, name, run.shown(report)))
    print("Prompt for the same subagent, continued:")
    print("Your work was checked and sent back. The rework order is the file %s. Read it in "
          "full first, then carry it out exactly as written. It also tells you where to write "
          "your report." % path)
    print("Prompt for a new subagent:")
    print("Another agent worked on a work order, and its work was sent back. The work order is "
          "the file %s, and the rework order is the file %s. Read both in full, the work order "
          "first, then carry out the rework order exactly as written. It also tells you where "
          "to write your report." % (first, path))
    return 0


def quoted(path):
    return "'%s'" % path.replace("'", "'\\''")


def inspect(args):
    run = Run(args.plan)
    run.require_shape()
    known_orders(run, args.orders)
    names = args.orders or [name for name in run.state["orders"]
                            if name in run.by_id and not run.merged(name)]
    if not names:
        print("No order is started and not merged.")
        return 0
    bad = 0
    for name in names:
        if not run.started(name):
            print("%s: not started." % name)
            bad += 1
            continue
        if run.merged(name):
            print("%s: merged at %s." % (name, short(run.state["orders"][name]["merged"])))
            continue
        facts, problems, notes = run.inspect(name)
        print("%s: %s  (%s)" % (name, facts or "nothing to compare", run.shown(run.tree(name))))
        print_plan(["  " + text for text in problems], ["  " + text for text in notes])
        bad += len(problems)
    note = run.checkout_note()
    if note:
        print("note     %s" % note)
    return 1 if bad else 0


def merge(args):
    run = Run(args.plan)
    run.require_shape()
    known_orders(run, [args.order])
    name, order = args.order, run.by_id[args.order]
    if not args.checked.strip():
        raise UsageError("--checked is empty. Say what you ran and read yourself for this order.")
    state = run.state_of(order)
    if state != "started":
        raise Problem("order %s is %s. Only an order that is started can be merged." % (
            name, state))
    facts, problems, notes = run.inspect(name)
    if problems:
        print("%s: %s" % (name, facts))
        print_plan(["  " + text for text in problems], [])
        raise Problem("order %s was not merged. Have the problems fixed in its tree first." % name)
    target, tree = run.branch(INTEGRATION), run.tree(INTEGRATION)
    run.ensure_integration()
    if said(git(tree, "rev-parse", "--abbrev-ref", "HEAD")) != target or dirty(tree):
        raise Problem("the integration tree %s must be on %s with nothing uncommitted. Nobody "
                      "works in it: find out what changed it." % (run.shown(tree), target))
    message = "brigade: merge %s%s" % (name, ": " + order["title"] if order["title"] else "")
    result = git(tree, "merge", "--no-ff", "-m", message, run.branch(name), check=False)
    if result.returncode:
        git(tree, "merge", "--abort", check=False)
        raise Problem("git could not merge %s into %s, and the merge was undone:\n%s" % (
            run.branch(name), target, (result.stdout + result.stderr).strip()))
    head = commit_of(run.repo, target)
    run.state["orders"][name].update(merged=head, checked=args.checked.strip())
    run.save()
    print("Merged %s into %s at %s (%s)." % (name, target, short(head), facts))
    removed, said_text = remove_order(run, name, tree)
    print(("%s: %s" if removed else "note: %s: %s Run clean once it is free.") % (name, said_text))
    pruned = prune_checks(run, name)
    if pruned:
        print("%s: removed from %s what is not a .txt or .md record: %s." % (
            name, run.shown(os.path.join(run.dir, "checks", name)), some(pruned)))
    print("Run the gates in %s, then deliver the result to %s." % (
        run.shown(tree), run.plan["base"]))
    ready = [other["id"] for other in run.live if run.state_of(other) == "ready"]
    if ready:
        print("Ready to start now: %s." % ", ".join(ready))
    return 0


def status(args):
    run = Run(args.plan)
    problems, notes = run.plan_problems()
    if run.shape:
        print_plan(problems, notes)
        return 1
    states = {order["id"]: run.state_of(order) for order in run.orders}
    counts = {state: list(states.values()).count(state)
              for state in ("merged", "started", "ready", "waiting", "dropped")}
    print("Run %s: %s." % (run.name, ", ".join(
        "%d %s" % (counts[state], state) for state in counts if counts[state]) or "no orders"))
    width = max([len(order["id"]) for order in run.orders] + [5])
    for order in run.orders:
        name, state = order["id"], states[order["id"]]
        detail = []
        if order["after"]:
            detail.append("after %s" % ", ".join(order["after"]))
        detail.append("covers %s" % ", ".join(order["covers"]) if order["covers"] else "support")
        if state in ("started", "merged") and run.round_of(name) > 1:
            detail.append("round %d" % run.round_of(name))
        if state == "started":
            detail.append(run.shown(run.tree(name)))
        if state == "merged":
            detail.append("checked: %s" % cut(run.state["orders"][name]["checked"], 80))
        if state == "dropped":
            detail = [cut(order["dropped"], 80)]
        print("  %-*s  %-8s %s" % (width, name, state, "; ".join(detail)))
    for name in run.state["orders"]:
        if name not in run.by_id:
            print("  %-*s  %-8s removed from the plan; its tree and branch are left in place"
                  % (width, name, "?"))
    print("Criteria:")
    for criterion in run.plan["criteria"]:
        cover = [order["id"] for order in run.live if criterion["id"] in order["covers"]]
        waiting = [name for name in cover if states[name] != "merged"]
        where = ("covered by no order" if not cover
                 else "waits for %s" % ", ".join(waiting) if waiting
                 else "merged (%s)" % ", ".join(cover))
        print("  %-4s %-22s %s" % (criterion["id"], where, cut(criterion["text"], 70)))
    if run.state["base_commit"]:
        branch = run.branch(INTEGRATION)
        head = commit_of(run.repo, branch)
        print("Integration: %s at %s, in %s." % (
            branch, short(head or "gone"), run.shown(run.tree(INTEGRATION))))
        base, start = run.plan["base"], run.state["base_commit"]
        now = commit_of(run.repo, "refs/heads/" + base)
        if not now:
            print("Started from %s (%s), which is not a branch: nothing is delivered." % (
                base, short(start)))
        else:
            ahead = int(said(git(run.repo, "rev-list", "--count", "%s..%s" % (base, branch))))
            print("Started from %s at %s. %s is now at %s: %s." % (
                base, short(start), base, short(now),
                "every merge is delivered" if not ahead else
                "%d commit%s of the integration branch not delivered yet" % (
                    ahead, "" if ahead == 1 else "s")))
    ready = [name for name in states if states[name] == "ready"]
    if ready:
        print("Ready to start now: %s." % ", ".join(ready))
    print_plan(problems, notes)
    if problems:
        return 1
    return 0 if run.live and all(states[order["id"]] == "merged" for order in run.live) else 3


KEPT_RECORDS = (".txt", ".md")


def prune_checks(run, name):
    """Deletes from checks/<order>/ every file that is not a text record. Returns what it deleted."""
    folder = os.path.join(run.dir, "checks", name)
    deleted = []
    for path in sorted(files_in(folder)):
        if not path.endswith(KEPT_RECORDS):
            os.remove(path)
            deleted.append(os.path.relpath(path, folder))
    for parent, _, _ in sorted(os.walk(folder), reverse=True):
        if parent != folder and not os.listdir(parent):
            os.rmdir(parent)
    return deleted


def files_in(folder):
    """Every file under a folder, symbolic links included and not followed."""
    found = []
    for parent, folders, names in os.walk(folder):
        found.extend(os.path.join(parent, name) for name in names)
        found.extend(os.path.join(parent, name) for name in folders
                     if os.path.islink(os.path.join(parent, name)))
    return found


def deliver(args):
    run = Run(args.plan)
    run.require_shape()
    if not args.gates.strip():
        raise UsageError("--gates is empty. Say which gates you ran in the integration tree, "
                         "and that they passed.")
    if not run.state["base_commit"]:
        raise Problem("the run has no integration branch yet. Start it first: start %s"
                      % args.plan)
    base, target = run.plan["base"], run.branch(INTEGRATION)
    if not commit_of(run.repo, "refs/heads/" + base):
        raise Problem("the run started from %s, which is not a branch. There is no branch to "
                      "deliver to: ask the user where the result goes." % base)
    tree = run.tree(INTEGRATION)
    if os.path.isdir(tree) and dirty(tree):
        raise Problem("the integration tree %s has uncommitted changes. Nothing is delivered "
                      "that is not committed: find out what changed it." % run.shown(tree))
    head, current = commit_of(run.repo, target), commit_of(run.repo, base)
    if head == current:
        print("%s is at %s already, as is %s. Nothing to deliver." % (base, short(head), target))
        return 0
    if git(run.repo, "merge-base", "--is-ancestor", current, head, check=False).returncode:
        raise Problem(
            "%s has commits that %s does not hold, so it cannot be fast-forwarded. Someone "
            "committed to it during the run. Ask the user: merge %s into %s in the integration "
            "tree, run the gates again and deliver, or stop delivering." % (
                base, target, base, target))
    holder = checked_out(run, base)
    if holder and os.path.realpath(holder) != run.repo:
        raise Problem("%s is checked out in %s. Deliver from the checkout the run started in, or "
                      "ask the user." % (base, holder))
    if holder:
        changed = [line[3:] for line in dirty(run.repo) if not line.startswith("??")
                   and not inside(os.path.join(run.repo, line[3:].rstrip("/")), run.dir)]
        if changed:
            raise Problem("the checkout %s has uncommitted changes to tracked files: %s. They are "
                          "the user's: ask the user before delivering." % (
                              run.shown(run.repo), some(changed)))
        result = git(run.repo, "merge", "--ff-only", "-q", target, check=False)
    else:
        result = git(run.repo, "fetch", "-q", ".", "refs/heads/%s:refs/heads/%s" % (target, base),
                     check=False)
    if result.returncode:
        raise Problem("%s was not fast-forwarded to %s:\n%s" % (
            base, target, (result.stdout + result.stderr).strip()))
    run.state.setdefault("delivered", []).append({"commit": head, "gates": args.gates.strip()})
    run.save()
    print("Delivered: %s is now at %s, the head of %s. Nothing was pushed." % (
        base, short(head), target))
    return 0


def checked_out(run, branch):
    """The folder in which a branch is checked out, or None when it is checked out nowhere."""
    folder = None
    for line in git(run.repo, "worktree", "list", "--porcelain").stdout.splitlines():
        if line.startswith("worktree "):
            folder = line[len("worktree "):]
        elif line == "branch refs/heads/" + branch:
            return folder
    return None


def remove_order(run, name, home):
    """Removes the tree and the branch of a merged order. Returns whether it did, and what happened.

    `git worktree remove` takes the tree's ignored build output with it, and refuses a tree that
    holds uncommitted or untracked work. `git branch -d` refuses a branch that is not merged.
    """
    tree, branch = run.tree(name), run.branch(name)
    if os.path.isdir(tree):
        result = git(run.repo, "worktree", "remove", tree, check=False)
        if result.returncode:
            return False, "its tree %s was not removed: %s" % (
                run.shown(tree), result.stderr.strip())
    if commit_of(run.repo, "refs/heads/" + branch):
        result = git(home, "branch", "-d", branch, check=False)
        if result.returncode:
            return False, "its branch was not deleted: %s" % result.stderr.strip()
    return True, "tree and branch removed; its commits are in %s." % run.branch(INTEGRATION)


def clean(args):
    run = Run(args.plan)
    run.require_shape()
    bad = 0
    home = run.tree(INTEGRATION) if os.path.isdir(run.tree(INTEGRATION)) else run.repo
    for name, record in run.state["orders"].items():
        tree, branch = run.tree(name), run.branch(name)
        has_branch = bool(commit_of(run.repo, "refs/heads/" + branch))
        if not os.path.isdir(tree) and not has_branch:
            continue
        if not record.get("merged"):
            why = ("dropped" if name in run.by_id and run.by_id[name]["dropped"].strip()
                   else "removed from the plan" if name not in run.by_id else "not merged")
            print("%s: left in place (%s). Its work is only on %s. To discard it, once the user "
                  "agrees: git worktree remove --force %s && git branch -D %s" % (
                      name, why, branch, quoted(tree), branch))
            continue
        removed, text = remove_order(run, name, home)
        if not removed:
            print("PROBLEM  %s: %s" % (name, text))
            bad += 1
            continue
        print("%s: %s" % (name, text))
    if args.integration and run.state["base_commit"]:
        bad += clean_integration(run)
    git(run.repo, "worktree", "prune", check=False)
    if os.path.isdir(run.trees) and not os.listdir(run.trees):
        os.rmdir(run.trees)
    return 1 if bad else 0


def clean_integration(run):
    target, tree = run.branch(INTEGRATION), run.tree(INTEGRATION)
    waiting = [name for name, record in run.state["orders"].items()
               if not record.get("merged") and os.path.isdir(run.tree(name))]
    if waiting:
        print("PROBLEM  the integration tree stays: %s still %s a tree." % (
            ", ".join(waiting), "has" if len(waiting) == 1 else "have"))
        return 1
    has_branch = bool(commit_of(run.repo, "refs/heads/" + target))
    if has_branch and git(run.repo, "merge-base", "--is-ancestor", target, "HEAD",
                          check=False).returncode:
        print("PROBLEM  the integration tree and branch stay: the branch checked out in %s does "
              "not hold the commits of %s. The result of the run is only on that branch." % (
                  run.shown(run.repo), target))
        return 1
    if os.path.isdir(tree):
        result = git(run.repo, "worktree", "remove", tree, check=False)
        if result.returncode:
            print("PROBLEM  the integration tree was not removed: %s" % result.stderr.strip())
            return 1
    if has_branch:
        result = git(run.repo, "branch", "-d", target, check=False)
        if result.returncode:
            print("PROBLEM  %s was not deleted: %s" % (target, result.stderr.strip()))
            return 1
    print("%s: tree and branch removed; its commits are in the branch checked out in %s." % (
        INTEGRATION, run.shown(run.repo)))
    return 0


# ---------------------------------------------------------------------------------- disk

# How long the disk footer may spend counting the current folder. A larger folder is reported as
# "at least" what was counted in that time.
DISK_SECONDS = 5


def folder_size(folder, seconds):
    """The bytes the files under a folder take on disk, and whether the count finished in time.

    Counts the blocks each file takes, as `du` does, once per file however many links it has,
    without following symbolic links.
    """
    total, seen, stack = 0, set(), [folder]
    stop = time.monotonic() + seconds
    while stack:
        if time.monotonic() > stop:
            return total, False
        try:
            entries = os.scandir(stack.pop())
        except OSError:
            continue
        with entries:
            for entry in entries:
                try:
                    info = entry.stat(follow_symlinks=False)
                    is_folder = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                if is_folder:
                    stack.append(entry.path)
                elif info.st_nlink > 1:
                    if (info.st_dev, info.st_ino) in seen:
                        continue
                    seen.add((info.st_dev, info.st_ino))
                total += getattr(info, "st_blocks", 0) * 512 or info.st_size
    return total, True


def amount(size):
    for unit in ("bytes", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return ("%d %s" if unit == "bytes" else "%.1f %s") % (size, unit)
        size /= 1024.0


def disk_footer(program):
    """Ends every command with what the current folder takes on disk, and what its disk has free."""
    sys.stdout.flush()
    try:
        here = os.getcwd()
        size, whole = folder_size(here, DISK_SECONDS)
        free = shutil.disk_usage(here)
    except OSError as error:
        print("%s: disk: could not be measured: %s" % (program, error), file=sys.stderr)
        return
    print("%s: disk: the current folder %s takes %s%s%s; its disk has %s free of %s." % (
        program, here, "" if whole else "at least ", amount(size),
        "" if whole else " (counting stopped after %g s)" % DISK_SECONDS,
        amount(free.free), amount(free.total)), file=sys.stderr)


# ---------------------------------------------------------------------------------- main


def parser():
    top = argparse.ArgumentParser(
        prog="brigade.py",
        description="Keep the plan of a brigade run and do its git work.",
        epilog="Exit codes: 0 nothing is wrong; 1 problems; 2 wrong usage; "
               "3 (status) orders are not merged yet.")
    commands = top.add_subparsers(dest="command")
    commands.required = True

    one = commands.add_parser("init", help="write a new plan with the criteria word for word")
    one.add_argument("plan", metavar="PLAN", help="the plan file to write, in the run directory")
    one.add_argument("--task", required=True, help="the task in one line")
    one.add_argument("--criteria-from", action="append", metavar="FILE",
                     help="a file whose list items are the criteria; repeat for each ticket")
    one.add_argument("--section", metavar="HEADING",
                     help="take the criteria from under this heading of each file only")
    one.add_argument("--criterion", action="append", metavar="TEXT",
                     help="one criterion, word for word; repeat for each")
    one.add_argument("--source", metavar="TEXT",
                     help="the plan or tickets the orders and their dependencies are taken from")
    one.add_argument("--repo", default=".", metavar="DIR",
                     help="a folder of the git repository (default: the current folder)")
    one.add_argument("--base", metavar="REF",
                     help="the branch or commit the work starts from (default: the current one)")
    one.add_argument("--run", metavar="NAME",
                     help="the run name, used in branch names (default: the plan's folder name)")
    one.add_argument("--trees", metavar="DIR",
                     help="where the worktrees go, relative to the plan (default: trees)")
    one.set_defaults(run_command=init)

    one = commands.add_parser("check", help="list what is wrong with the plan")
    one.add_argument("plan", metavar="PLAN")
    one.set_defaults(run_command=check)

    one = commands.add_parser(
        "start", help="create the integration tree, and a tree for each order named")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("orders", nargs="*", metavar="ORDER")
    one.set_defaults(run_command=start)

    one = commands.add_parser("brief", help="write the work order to hand to a subagent")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("order", metavar="ORDER")
    one.set_defaults(run_command=brief)

    one = commands.add_parser(
        "inspect", help="compare what an order's branch holds with what the order allows")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("orders", nargs="*", metavar="ORDER",
                     help="default: every order that is started and not merged")
    one.set_defaults(run_command=inspect)

    one = commands.add_parser(
        "rework", help="open a new round for an order that was not accepted")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("order", metavar="ORDER")
    one.add_argument("--findings", required=True, metavar="FILE",
                     help="a file with what you found, or - to read it from standard input")
    one.set_defaults(run_command=rework)

    one = commands.add_parser(
        "merge", help="merge an order into the integration branch, and remove its tree and branch")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("order", metavar="ORDER")
    one.add_argument("--checked", required=True, metavar="TEXT",
                     help="what you ran and read yourself before accepting the order")
    one.set_defaults(run_command=merge)

    one = commands.add_parser(
        "deliver", help="fast-forward the branch the run started from to the integration branch")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("--gates", required=True, metavar="TEXT",
                     help="which gates you ran in the integration tree, and that they passed")
    one.set_defaults(run_command=deliver)

    one = commands.add_parser("status", help="show where every order and criterion stands")
    one.add_argument("plan", metavar="PLAN")
    one.set_defaults(run_command=status)

    one = commands.add_parser(
        "clean", help="remove the trees and branches of merged orders that are still there")
    one.add_argument("plan", metavar="PLAN")
    one.add_argument("--integration", action="store_true",
                     help="also remove the integration tree and branch, once the result is in "
                          "the branch the run started from")
    one.set_defaults(run_command=clean)
    return top


def main(argv=None):
    try:
        return command_line(argv)
    finally:
        disk_footer("brigade.py")


def command_line(argv):
    args = parser().parse_args(argv)
    if args.command == "init" and args.criteria_from and args.criterion:
        print("brigade.py: give --criteria-from or --criterion, not both.", file=sys.stderr)
        return 2
    try:
        return args.run_command(args)
    except UsageError as error:
        print("brigade.py: %s" % error, file=sys.stderr)
        return 2
    except Problem as error:
        print("brigade.py: %s" % error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
