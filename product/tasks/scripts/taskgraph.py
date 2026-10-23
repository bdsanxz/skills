#!/usr/bin/env python3
"""Read a tasks document as a dependency graph, and tell which tasks can start and which cannot.

    taskgraph.py check DOC
    taskgraph.py status DOC
    taskgraph.py waves DOC
    taskgraph.py trace DOC TASK

DOC is the tasks Markdown file. The graph comes from the `Needs` line of each task; nothing else is
stored. A task is done when every acceptance criterion in its checklist is ticked (`- [x]`), so
ticking the boxes in the document is how progress is recorded.

`check` validates the document and prints every problem with its line number: a task ID that is
used twice, a task without a `Needs` line or with a dependency that gives no reason, a `Needs`
entry that is not a task ID, names a task that does not exist or names the task itself, a
dependency cycle, a dependency that another dependency already implies, a required task that needs
an optional one, a task without an actor, a status, a valid path kind, a source or a checklist of
acceptance criteria, an open-question marker `[Qn]` that points to no question or to a question
that is resolved already, a question whose `Blocks` line disagrees with the markers in the tasks,
a source statement in the `## Coverage` table that no task and no question covers, and a task that
no row of that table covers. `status` runs the same check, then lists the tasks that are done, the tasks that are
ready to start now (they do not depend on each other, so they can run in parallel), and the tasks
that are blocked, each with what it waits for. `waves` groups all tasks by how many tasks must
finish before them: the tasks of one wave can run in parallel. `trace` shows, for one task, what it
needs, what waits for it, and which tasks it can run in parallel with.

Exit codes: 0 no problems; 1 problems were found; 2 wrong usage or an unreadable document;
3 (status only) no problems, but tasks remain and none is ready.
Standard library only.
"""

import argparse
import os
import re
import sys

PATH_KINDS = ("Happy", "Alternative", "Negative")
NONE_WORDS = ("", "none", "-", "—", "n/a")

HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
TASK_HEADING = re.compile(r"^(T\d+)\b[.:]?\s*(.*?)\s*$")
QUESTION_HEADING = re.compile(r"^(Q\d+)\b[.:]?\s*(.*?)\s*$")
FIELD = re.compile(r"^\s*[-*]\s+\*\*([^*]+)\*\*\s*:\s*(.*?)\s*$")
BOLD_LABEL = re.compile(r"^\*\*[^*]+\*\*")
CRITERIA_LABEL = re.compile(r"^\*\*Acceptance criteria\*\*\s*:?\s*$", re.I)
CHECKBOX = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(\S.*?)\s*$")
LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\S")
MARKER = re.compile(r"\[(Q\d+)\]")
RESOLVED_LINE = re.compile(r"^\s*[-*]\s+(Q\d+)\b")
TASK_ID = re.compile(r"^T\d+$")
FENCE = re.compile(r"^\s*(```|~~~)")


class UsageError(Exception):
    """A problem with the input, reported to the caller with exit code 2."""


class Task(object):
    def __init__(self, tid, title, feature, line):
        self.id = tid
        self.title = title
        self.feature = feature
        self.line = line
        self.fields = {}
        self.needs = []            # task IDs, as written
        self.needs_line = line
        self.criteria_seen = False
        self.items = []            # (ticked, text)
        self.bad_items = []        # (line, text) list items in the checklist that are no checkbox
        self.markers = {}          # question ID -> line of the first marker

    @property
    def done(self):
        return bool(self.items) and all(ticked for ticked, _ in self.items)

    @property
    def path(self):
        return self.fields.get("path", "")

    @property
    def optional(self):
        return self.fields.get("status", "").strip().lower() == "optional"

    @property
    def tag(self):
        return self.path + (", optional" if self.optional else "")

    def label(self):
        return ("%s  %s" % (self.id, self.title)).rstrip()


class Question(object):
    def __init__(self, qid, line):
        self.id = qid
        self.line = line
        self.blocks = []
        self.blocks_line = line


class Document(object):
    def __init__(self):
        self.tasks = []            # in document order, duplicates included
        self.by_id = {}            # first task of each ID
        self.questions = {}        # open questions
        self.resolved = set()      # resolved question IDs
        self.problems = []         # (line, text)
        self.features = []         # feature names in order
        self.coverage_line = None  # line of the `## Coverage` heading
        self.coverage = []         # (line, source statement, covered-by cell)
        self.coverage_header_seen = False

    def problem(self, line, text):
        self.problems.append((line, text))


def parse(text):
    doc = Document()
    section = None                 # "feature", "open", "resolved" or None
    feature = None
    task = None
    question = None
    in_criteria = False
    in_fence = False
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        heading = HEADING.match(line)
        if heading:
            level, title = len(heading.group(1)), heading.group(2)
            task, question, in_criteria = None, None, False
            if level <= 2:
                lowered = title.lower()
                if level == 2 and lowered.startswith("feature:"):
                    feature = title.split(":", 1)[1].strip()
                    doc.features.append(feature)
                    section = "feature"
                elif level == 2 and lowered == "coverage":
                    section = "coverage"
                    doc.coverage_line = number
                elif level == 2 and lowered == "open questions":
                    section = "open"
                elif level == 2 and lowered == "resolved questions":
                    section = "resolved"
                else:
                    section = None
            elif level == 3 and section == "feature":
                match = TASK_HEADING.match(title)
                if match:
                    task = Task(match.group(1), match.group(2), feature, number)
                    for marker in MARKER.findall(title):
                        task.markers.setdefault(marker, number)
                    doc.tasks.append(task)
            elif level == 3 and section == "open":
                match = QUESTION_HEADING.match(title)
                if match:
                    question = Question(match.group(1), number)
                    if question.id in doc.questions:
                        doc.problem(number, "question %s is defined twice." % question.id)
                    else:
                        doc.questions[question.id] = question
            continue
        if section == "coverage":
            if line.lstrip().startswith("|"):
                cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
                if all(re.match(r"^:?-{3,}:?$", cell) for cell in cells if cell):
                    continue
                if not doc.coverage_header_seen:
                    doc.coverage_header_seen = True
                    continue
                doc.coverage.append((number, cells[0], cells[-1] if len(cells) > 1 else ""))
            continue
        if section == "resolved":
            match = RESOLVED_LINE.match(line)
            if match:
                doc.resolved.add(match.group(1))
            continue
        if task is not None:
            for marker in MARKER.findall(line):
                task.markers.setdefault(marker, number)
            field = FIELD.match(line)
            if field:
                in_criteria = False
                name, value = field.group(1).strip().lower(), field.group(2)
                task.fields.setdefault(name, value.strip())
                if name == "needs":
                    task.needs_line = number
                    task.needs = parse_ids(doc, number, value, "Needs of %s" % task.id)
                continue
            if CRITERIA_LABEL.match(line.strip()):
                task.criteria_seen = True
                in_criteria = True
                continue
            if BOLD_LABEL.match(line.strip()):
                in_criteria = False
                continue
            if in_criteria:
                box = CHECKBOX.match(line)
                if box:
                    task.items.append((box.group(1) in "xX", box.group(2)))
                elif LIST_ITEM.match(line):
                    task.bad_items.append((number, line.strip()))
        elif question is not None:
            field = FIELD.match(line)
            if field and field.group(1).strip().lower() == "blocks":
                question.blocks_line = number
                question.blocks = parse_ids(doc, number, field.group(2), "Blocks of %s" % question.id)
    return doc


def parse_ids(doc, number, value, where):
    value = value.strip()
    if value.lower() in NONE_WORDS:
        return []
    found = []
    for token in re.split(r"[,;\s]+", value):
        if not token:
            continue
        if TASK_ID.match(token):
            if token not in found:
                found.append(token)
        else:
            doc.problem(number, "%s: `%s` is not a task ID (write IDs such as T3, separated by "
                                "commas, or leave the line out)." % (where, token))
    return found


def validate(doc):
    """Add every structural and graph problem to the document and return the problems, in order."""
    seen = {}
    for task in doc.tasks:
        if task.id in seen:
            doc.problem(task.line, "task %s is defined twice (first at line %d)." % (
                task.id, seen[task.id].line))
        else:
            seen[task.id] = task
            doc.by_id[task.id] = task
    if not doc.tasks:
        raise UsageError("no task found. A task starts with a heading like `### T1. Member exports "
                         "their expenses` inside a `## Feature:` section.")
    for task in doc.tasks:
        check_task(doc, task)
    check_graph(doc)
    check_questions(doc)
    check_coverage(doc)
    return sorted(doc.problems, key=lambda problem: problem[0])


def check_task(doc, task):
    for name, label in (("actor", "Actor"), ("source", "Source")):
        if not task.fields.get(name):
            doc.problem(task.line, "%s has no `%s` line." % (task.id, label))
    if "needs" not in task.fields:
        doc.problem(task.line, "%s has no `Needs` line (write `- **Needs**: none` when it needs no "
                               "other task)." % task.id)
    if task.fields.get("status", "").strip().lower() not in ("required", "optional"):
        doc.problem(task.line, "%s: Status is `%s`; it must be Required or Optional." % (
            task.id, task.fields.get("status", "") or "missing"))
    if task.needs and not task.fields.get("needs because"):
        doc.problem(task.needs_line, "%s needs %s but gives no `Needs because` line saying why its "
                                     "behavior cannot be observed without them." % (
                                         task.id, ", ".join(task.needs)))
    kind = task.path
    if kind not in PATH_KINDS:
        doc.problem(task.line, "%s: Path is `%s`; it must be one of %s." % (
            task.id, kind or "missing", ", ".join(PATH_KINDS)))
    if not task.criteria_seen:
        doc.problem(task.line, "%s has no `**Acceptance criteria**` checklist." % task.id)
    elif not task.items:
        doc.problem(task.line, "%s: the acceptance criteria hold no `- [ ]` item." % task.id)
    for number, item in task.bad_items:
        doc.problem(number, "%s: acceptance criterion is not a checklist item (write `- [ ] ...`): %s" % (
            task.id, item))
    for need in task.needs:
        if need == task.id:
            doc.problem(task.needs_line, "%s needs itself." % task.id)
        elif need not in doc.by_id:
            doc.problem(task.needs_line, "%s needs %s, which is not a task in this document." % (
                task.id, need))
        elif doc.by_id[need].optional and not task.optional:
            doc.problem(task.needs_line, "%s is required but needs %s, which is optional. An optional "
                                         "task must not block a required one." % (task.id, need))


def edges(doc):
    """Task ID -> the IDs it needs, with the references that are broken left out."""
    return dict((task.id, [n for n in task.needs if n in doc.by_id and n != task.id])
                for task in doc.by_id.values())


def check_graph(doc):
    graph = edges(doc)
    state = {}
    stack = []
    reported = set()

    def visit(node):
        state[node] = 1
        stack.append(node)
        for nxt in graph[node]:
            if state.get(nxt, 0) == 0:
                visit(nxt)
            elif state[nxt] == 1:
                cycle = stack[stack.index(nxt):]
                key = frozenset(cycle)
                if key not in reported:
                    reported.add(key)
                    doc.problem(doc.by_id[node].needs_line,
                                "dependency cycle: %s (an arrow means \"needs\"). Remove one "
                                "dependency so that the tasks can be done in some order." % (
                                    " -> ".join(cycle + [nxt])))
        stack.pop()
        state[node] = 2

    sys.setrecursionlimit(max(1000, 4 * len(graph) + 100))
    for node in sorted(graph, key=lambda tid: doc.by_id[tid].line):
        if state.get(node, 0) == 0:
            visit(node)
    if reported:
        return
    for node in sorted(graph, key=lambda tid: doc.by_id[tid].line):
        for need in graph[node]:
            for other in graph[node]:
                if other != need and need in reachable(graph, other):
                    doc.problem(doc.by_id[node].needs_line,
                                "%s needs %s, but %s already needs it through %s. Remove %s from "
                                "`Needs`." % (node, need, other, other, need))
                    break


def reachable(graph, start):
    found, todo = set(), list(graph[start])
    while todo:
        nxt = todo.pop()
        if nxt not in found:
            found.add(nxt)
            todo.extend(graph[nxt])
    return found


def check_questions(doc):
    for task in doc.by_id.values():
        for marker, number in sorted(task.markers.items()):
            if marker in doc.questions:
                if task.id not in doc.questions[marker].blocks:
                    doc.problem(number, "%s carries [%s], but `Blocks` of %s does not list %s." % (
                        task.id, marker, marker, task.id))
            elif marker in doc.resolved:
                doc.problem(number, "%s carries [%s], which is resolved. Replace the marker with "
                                    "the answer." % (task.id, marker))
            else:
                doc.problem(number, "%s carries [%s], but no open question %s exists." % (
                    task.id, marker, marker))
    for question in doc.questions.values():
        for tid in question.blocks:
            if tid not in doc.by_id:
                doc.problem(question.blocks_line, "%s blocks %s, which is not a task in this "
                                                  "document." % (question.id, tid))
            elif question.id not in doc.by_id[tid].markers:
                doc.problem(question.blocks_line, "%s blocks %s, but %s carries no [%s] marker." % (
                    question.id, tid, tid, question.id))
        if question.id in doc.resolved:
            doc.problem(question.line, "%s is listed under both open and resolved questions." %
                        question.id)


def check_coverage(doc):
    if doc.coverage_line is None:
        doc.problem(1, "no `## Coverage` section: add a table of every source statement with the "
                       "tasks or open questions that cover it.")
        return
    if not doc.coverage:
        doc.problem(doc.coverage_line, "the `## Coverage` table has no row.")
    covered = set()
    for number, statement, cell in doc.coverage:
        refs = re.findall(r"\b([TQ]\d+)\b", cell)
        if not refs:
            doc.problem(number, "source statement \"%s\" is covered by no task and no open question." %
                        statement)
        for ref in refs:
            if ref.startswith("T"):
                if ref in doc.by_id:
                    covered.add(ref)
                else:
                    doc.problem(number, "coverage names %s, which is not a task in this document." % ref)
            elif ref not in doc.questions and ref not in doc.resolved:
                doc.problem(number, "coverage names %s, which is not a question in this document." % ref)
    if doc.coverage:
        for task in doc.by_id.values():
            if task.id not in covered:
                doc.problem(task.line, "%s is in no row of the `## Coverage` table. A task that no "
                                       "source statement justifies must be removed." % task.id)


# --- the graph, once the document passed the check -------------------------------------------

class Graph(object):
    def __init__(self, doc):
        self.doc = doc
        self.order = [task.id for task in doc.tasks if doc.by_id[task.id] is task]
        self.needs = edges(doc)
        self.waiting = dict((tid, []) for tid in self.order)
        for tid in self.order:
            for need in self.needs[tid]:
                self.waiting[need].append(tid)
        self.depth = {}
        for tid in self.order:
            self.measure(tid)

    def measure(self, tid):
        if tid not in self.depth:
            self.depth[tid] = 1 + max([self.measure(n) for n in self.needs[tid]] or [0])
        return self.depth[tid]

    def task(self, tid):
        return self.doc.by_id[tid]

    def done(self, tid):
        return self.task(tid).done

    def open_questions(self, tid):
        return sorted(q for q in self.task(tid).markers if q in self.doc.questions)

    def unmet(self, tid):
        return [n for n in self.needs[tid] if not self.done(n)]

    def state(self, tid):
        if self.done(tid):
            return "done"
        if self.unmet(tid) or self.open_questions(tid):
            return "blocked"
        return "ready"

    def reasons(self, tid):
        parts = []
        unmet = self.unmet(tid)
        if unmet:
            parts.append("waits for " + ", ".join(unmet))
        questions = self.open_questions(tid)
        if questions:
            parts.append("open question " + ", ".join(questions))
        return "; ".join(parts)

    def reach(self, tid, links):
        found, todo = set(), list(links[tid])
        while todo:
            nxt = todo.pop()
            if nxt not in found:
                found.add(nxt)
                todo.extend(links[nxt])
        return found

    def sorted(self, ids):
        return [tid for tid in self.order if tid in ids]


# --- commands --------------------------------------------------------------------------------

def load(path):
    if not os.path.isfile(path):
        raise UsageError("%s is not a file." % path)
    try:
        with open(path, encoding="utf-8") as handle:
            return parse(handle.read())
    except (OSError, UnicodeDecodeError) as error:
        raise UsageError("cannot read %s: %s" % (path, error))


def checked(path):
    """Load and validate a document; return (doc, problems)."""
    doc = load(path)
    return doc, validate(doc)


def print_problems(path, problems):
    for number, text in problems:
        print("%s:%d: %s" % (path, number, text))
    print("%d problem%s." % (len(problems), "" if len(problems) == 1 else "s"))


def command_check(args):
    doc, problems = checked(args.doc)
    if problems:
        print_problems(args.doc, problems)
        return 1
    print("OK: %d task%s in %d feature%s, %d open question%s, no problem." % (
        len(doc.by_id), "" if len(doc.by_id) == 1 else "s",
        len(doc.features), "" if len(doc.features) == 1 else "s",
        len(doc.questions), "" if len(doc.questions) == 1 else "s"))
    return 0


def command_status(args):
    doc, problems = checked(args.doc)
    if problems:
        print_problems(args.doc, problems)
        return 1
    graph = Graph(doc)
    states = dict((tid, graph.state(tid)) for tid in graph.order)
    done = [t for t in graph.order if states[t] == "done"]
    ready = [t for t in graph.order if states[t] == "ready"]
    blocked = [t for t in graph.order if states[t] == "blocked"]
    print("Tasks: %d in all; %d done, %d ready, %d blocked." % (
        len(graph.order), len(done), len(ready), len(blocked)))
    remaining = [t for t in graph.order if states[t] != "done" and not graph.task(t).optional]
    print("Required tasks not done: %d." % len(remaining))
    if ready:
        print("\nReady to start now (%d). None needs another, so they can run in parallel:" % len(ready))
        for tid in ready:
            print("  %s (%s)" % (graph.task(tid).label(), graph.task(tid).tag))
    if blocked:
        print("\nBlocked (%d):" % len(blocked))
        for tid in blocked:
            print("  %s: %s" % (graph.task(tid).label(), graph.reasons(tid)))
    if done:
        print("\nDone (%d): %s" % (len(done), ", ".join(done)))
    print("\nPaths by feature:")
    for feature in doc.features:
        counts = [(kind, sum(1 for t in graph.order if graph.task(t).feature == feature
                             and graph.task(t).path == kind)) for kind in PATH_KINDS]
        print("  %s: %s" % (feature, ", ".join("%d %s" % (n, k.lower()) for k, n in counts)))
    if not ready and len(done) < len(graph.order):
        print("\nNothing is ready: every remaining task waits for a task or an open question.")
        return 3
    return 0


def command_waves(args):
    doc, problems = checked(args.doc)
    if problems:
        print_problems(args.doc, problems)
        return 1
    graph = Graph(doc)
    last = max(graph.depth.values())
    for wave in range(1, last + 1):
        members = [t for t in graph.order if graph.depth[t] == wave]
        if wave == 1:
            print("Wave 1 (no task needed first; can run in parallel):")
        else:
            print("\nWave %d (after the tasks they need; can run in parallel with each other):" % wave)
        for tid in members:
            notes = []
            if graph.needs[tid]:
                notes.append("needs " + ", ".join(graph.needs[tid]))
            questions = graph.open_questions(tid)
            if questions:
                notes.append("open question " + ", ".join(questions))
            if graph.task(tid).optional:
                notes.append("optional")
            if graph.done(tid):
                notes.append("done")
            print("  %s%s" % (graph.task(tid).label(), " (%s)" % "; ".join(notes) if notes else ""))
    chain = [max(graph.order, key=lambda t: (graph.depth[t], -graph.order.index(t)))]
    while graph.needs[chain[-1]]:
        chain.append(min((n for n in graph.needs[chain[-1]] if graph.depth[n] == graph.depth[chain[-1]] - 1),
                         key=graph.order.index))
    print("\nLongest chain (%d task%s, one after the other): %s" % (
        len(chain), "" if len(chain) == 1 else "s", " -> ".join(reversed(chain))))
    return 0


def command_trace(args):
    doc, problems = checked(args.doc)
    if problems:
        print_problems(args.doc, problems)
        return 1
    graph = Graph(doc)
    tid = args.task.upper()
    if tid not in graph.doc.by_id:
        raise UsageError("%s is not a task in %s. Tasks: %s." % (args.task, args.doc, ", ".join(graph.order)))
    task = graph.task(tid)
    before = graph.reach(tid, graph.needs)
    after = graph.reach(tid, graph.waiting)
    apart = set(graph.order) - before - after - set([tid])
    state = graph.state(tid)
    print("%s [%s%s]" % (task.label(), state if state != "blocked" else "blocked: " + graph.reasons(tid),
                         "; optional" if task.optional else ""))
    print("Needs directly: %s" % (", ".join(graph.needs[tid]) or "nothing"))
    print("Must finish before it starts (all, through the chain): %s" % (
        ", ".join(graph.sorted(before)) or "nothing"))
    print("Waits for it (all, through the chain): %s" % (", ".join(graph.sorted(after)) or "nothing"))
    print("Can run in parallel with (no dependency either way): %s" % (
        ", ".join(graph.sorted(apart)) or "nothing"))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="taskgraph.py",
        description="Validate a tasks document as a dependency graph and report what can start.")
    commands = parser.add_subparsers(dest="command", metavar="COMMAND")
    commands.required = True
    for name, helptext, function in (
            ("check", "validate the document and list every problem", command_check),
            ("status", "list tasks that are done, ready to start and blocked", command_status),
            ("waves", "group tasks into waves that can run in parallel", command_waves)):
        sub = commands.add_parser(name, help=helptext)
        sub.add_argument("doc", metavar="DOC", help="the tasks Markdown file")
        sub.set_defaults(run=function)
    sub = commands.add_parser("trace", help="show what one task needs and what waits for it")
    sub.add_argument("doc", metavar="DOC", help="the tasks Markdown file")
    sub.add_argument("task", metavar="TASK", help="a task ID such as T3")
    sub.set_defaults(run=command_trace)
    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except UsageError as error:
        print("error: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
