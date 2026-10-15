#!/usr/bin/env python3
"""Keep the evidence ledger of a task, and refuse every claim the evidence does not back.

    ledger.py init LEDGER --task TEXT --criteria-from FILE [--section HEADING]
    ledger.py init LEDGER --task TEXT --criterion TEXT [--criterion TEXT ...]
    ledger.py check LEDGER [LEDGER ...]
    ledger.py table LEDGER
    ledger.py prune LEDGER

`init` writes a new ledger with one open row per criterion. `check` reads the ledger and the
files it names, and lists every row that claims more than those files show. It refuses a record
that points into the `work` folder beside the ledger, which is deleted after use, and it refuses to
call a run complete while that folder still holds anything. It notes an evidence folder larger than
100 MB, and every picture or recording larger than 5 MB. `prune` deletes the `work` folder of a run
that is closed and backed, and checks the ledger again. `table` prints the
ledger as a Markdown table for the report, and prints nothing while `check` finds a problem.

Every command ends with a line on standard error: what the current folder takes on disk, and what
its disk has free.

Exit codes: 0 every criterion is closed and backed; 1 problems were found; 2 wrong usage or an
unreadable ledger; 3 no problems, but criteria are still open or waiting for the user.
Standard library only.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ElementTree

FORMAT = "edd/ledger@1"
STATUSES = ("open", "proven", "user-check", "waived")
MB = 1024 * 1024
EVIDENCE_LIMIT = 100 * MB   # an evidence folder larger than this holds evidence worth deleting
MEDIA_LIMIT = 5 * MB        # a picture or recording larger than this is worth making smaller
MEDIA = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".tif", ".tiff", ".bmp",
         ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".y4m")
ROW = (
    ("id", ""),
    ("criterion", ""),
    ("on_screen", None),
    ("status", "open"),
    ("tests", []),
    ("no_test", ""),
    ("evidence", []),
    ("made_by", []),
    ("shows", ""),
    ("stand_in", ""),
    ("accepted", ""),
    ("note", ""),
)
SKIPPED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "target", "dist", "build", "out", "coverage",
    "__pycache__", ".venv", "venv", ".tox", ".next", ".cache", ".gradle", "DerivedData",
}
FAIL = re.compile(r"not ok\b|\bFAIL(ED|URE)?\b|\bfailed\b|\bERROR\b|\bpanicked\b|[✗✕✘×]")
SKIP = re.compile(r"\b(ignored|skipped|SKIP(PED)?|pending|todo|disabled)\b|[○↓]", re.I)
PASS = re.compile(r"\bok\b|\bPASS(ED)?\b|\bpassed\b|[✓✔√]")
LIST_ITEM = re.compile(r"^\s*(?:[-*+]\s+(?:\[[ xXuU~]\]\s+)?|\d+[.)]\s+)(.+?)\s*$")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


class UsageError(Exception):
    """A problem with the input, reported to the caller with exit code 2."""


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
    ledger = os.path.abspath(args.ledger)
    if os.path.exists(ledger):
        raise UsageError("%s already exists. Edit it, or give this run another name." % args.ledger)
    if args.criteria_from:
        texts = criteria_from(args.criteria_from, args.section)
    elif args.criterion:
        texts = [text.strip() for text in args.criterion]
    else:
        raise UsageError("give the criteria with --criteria-from FILE or with --criterion TEXT.")
    if any(not text for text in texts):
        raise UsageError("a criterion is empty.")
    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        raise UsageError("--root %s is not a directory." % args.root)
    home = os.path.dirname(ledger)
    evidence = os.path.abspath(args.evidence_dir) if args.evidence_dir else os.path.join(home, "evidence")
    for path in args.code:
        if not os.path.exists(os.path.join(root, path)):
            raise UsageError("--code %s does not exist under %s." % (path, args.root))
    rows = []
    for number, text in enumerate(texts, 1):
        row = {key: (list(value) if isinstance(value, list) else value) for key, value in ROW}
        row.update(id="c%d" % number, criterion=text)
        rows.append(row)
    doc = {
        "format": FORMAT,
        "task": args.task.strip(),
        "root": os.path.relpath(root, home),
        "evidence_dir": os.path.relpath(evidence, root),
        "code": list(args.code),
        "test_logs": [],
        "criteria": rows,
    }
    os.makedirs(home, exist_ok=True)
    os.makedirs(evidence, exist_ok=True)
    with open(ledger, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print("wrote %s: %d criteria, all open" % (args.ledger, len(rows)))
    print("evidence goes in %s" % os.path.relpath(evidence))
    return 0


# --------------------------------------------------------------------------------- check


class Ledger:
    """A ledger read from disk, with the problems and notes found while checking it."""

    def __init__(self, path):
        self.path = path
        try:
            with open(path, encoding="utf-8") as handle:
                self.doc = json.load(handle)
        except OSError as error:
            raise UsageError("ledger %s: %s" % (path, error))
        except ValueError as error:
            raise UsageError("ledger %s is not valid JSON: %s" % (path, error))
        doc = self.doc
        if not isinstance(doc, dict) or doc.get("format") != FORMAT:
            raise UsageError("ledger %s was not written by `ledger.py init`." % path)
        rows = doc.get("criteria")
        if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
            raise UsageError("ledger %s: `criteria` must be a list of rows, and not an empty one." % path)
        for key in ("code", "test_logs"):
            if not is_strings(doc.get(key, [])):
                raise UsageError("ledger %s: `%s` must be a list of paths." % (path, key))
        for key in ("root", "evidence_dir"):
            if not isinstance(doc.get(key), str) or not doc[key]:
                raise UsageError("ledger %s: `%s` must be a path." % (path, key))
        self.rows = rows
        self.root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(path)), doc["root"]))
        if not os.path.isdir(self.root):
            raise UsageError("ledger %s: its `root`, %s, is not a directory." % (path, self.root))
        self.evidence_dir = self.full(doc["evidence_dir"])
        self.problems = []
        self.notes = []
        self._texts = {}
        self.work = os.path.join(os.path.dirname(os.path.abspath(path)), "work")
        self.work_problem = None

    def full(self, relative):
        return os.path.normpath(os.path.join(self.root, relative))

    def text_of(self, relative):
        """The file's content when it is text, with runs of whitespace squashed; None when it is not."""
        if relative not in self._texts:
            try:
                with open(self.full(relative), "rb") as handle:
                    data = handle.read()
                self._texts[relative] = None if b"\0" in data else squash(data.decode("utf-8"))
            except (OSError, UnicodeDecodeError):
                self._texts[relative] = None
        return self._texts[relative]

    def usable(self, relative):
        full = self.full(relative)
        return os.path.isfile(full) and os.path.getsize(full) > 0

    def check(self):
        self.check_shape()
        if self.problems:
            return
        newest = self.newest_code()
        logs = self.test_logs(newest)
        for row in self.rows:
            if row["status"] == "proven":
                self.check_proven(row, newest, logs)
            elif row["status"] == "user-check":
                self.check_files(row, "made_by")
                if not row["note"].strip():
                    self.problem(row, "`note` must say exactly what the user has to run or look at.")
            elif row["status"] == "waived":
                if not row["accepted"].strip():
                    self.problem(row, "a waived criterion needs `accepted`: the user's own words and the date. "
                                      "Ask the user, or set the status back to open.")
                if not row["note"].strip():
                    self.problem(row, "`note` must say why the criterion is not met and what the closest behaviour is.")
        self.check_evidence_dir()
        self.check_work()

    def check_work(self):
        """Work folders are deleted once read: nothing may point into them, and none may outlive the run."""
        work = self.work
        named = [(row, item) for row in self.rows for item in row["evidence"] + row["made_by"]]
        named += [(None, item) for item in self.doc["test_logs"]]
        for row, item in named:
            if inside(self.full(item), work):
                self.problem(row, "%s is in the work folder, which is deleted after use. Copy it into the "
                                  "evidence folder, or have the script write it there, and name that copy." % item)
        try:
            left = sorted(name for name in os.listdir(work) if name != ".DS_Store")
        except OSError:
            return
        if not left:
            return
        shown = ", ".join(left[:8]) + (" and %d more" % (len(left) - 8) if len(left) > 8 else "")
        text = ("%s still holds %d entr%s: %s. Delete each work folder, by its exact path, once its "
                "transcripts are read and recorded" % (os.path.relpath(work, self.root), len(left),
                                                       "y" if len(left) == 1 else "ies", shown))
        counts = self.counts()
        if counts["open"] or counts["user-check"]:
            self.notes.append(text + ".")
        else:
            self.work_problem = text + "; the run is not closed while it holds any."
            self.problem(None, self.work_problem)

    def problem(self, row, text):
        self.problems.append("%s: %s" % (row["id"], text) if row else text)

    def check_shape(self):
        seen = set()
        for number, row in enumerate(self.rows, 1):
            for key, default in ROW:
                row.setdefault(key, list(default) if isinstance(default, list) else default)
            name = row["id"] if isinstance(row["id"], str) and row["id"] else "row %d" % number
            shown = {"id": name}
            if name in seen:
                self.problem(None, "two rows have the id %s." % name)
            seen.add(name)
            row["id"] = name
            for key in ("criterion", "no_test", "shows", "stand_in", "accepted", "note"):
                if not isinstance(row[key], str):
                    self.problem(shown, "`%s` must be text." % key)
                    row[key] = ""
            for key in ("tests", "evidence", "made_by"):
                if not is_strings(row[key]):
                    self.problem(shown, "`%s` must be a list of text values." % key)
                    row[key] = []
            if not row["criterion"].strip():
                self.problem(shown, "`criterion` is empty. It holds the criterion word for word.")
            if row["status"] not in STATUSES:
                self.problem(shown, "`status` is %r; it must be one of: %s." % (row["status"], ", ".join(STATUSES)))
            if row["on_screen"] not in (True, False, None):
                self.problem(shown, "`on_screen` must be true or false.")

    def check_files(self, row, key):
        for item in row[key]:
            if not self.usable(item):
                self.problem(row, "%s file %s is missing or empty." % ("evidence" if key == "evidence" else "script", item))

    def check_proven(self, row, newest, logs):
        if row["on_screen"] is None:
            self.problem(row, "`on_screen` is not decided. Set it to true when the criterion is about "
                              "something a person sees, and to false otherwise.")
        self.check_files(row, "evidence")
        self.check_files(row, "made_by")
        present = [item for item in row["evidence"] if self.usable(item)]
        if not row["evidence"]:
            self.problem(row, "no evidence file is named. Without evidence the status is open.")
        texts = [self.text_of(item) for item in present]
        if row["on_screen"] is True and present and all(text is not None for text in texts):
            self.problem(row, "the criterion is about something seen, and its evidence is text only. "
                              "Add a picture or a recording that shows it.")
        self.check_shows(row, present, [text for text in texts if text is not None])
        if row["stand_in"].strip() and not row["accepted"].strip():
            self.problem(row, "it was checked by a stand-in that nobody accepted. Ask the user, and put "
                              "their own words and the date in `accepted`; until then the status is open.")
        self.check_tests(row, logs)
        scripts = [(os.path.getmtime(self.full(item)), item) for item in row["made_by"] if self.usable(item)]
        for item in present:
            made = os.path.getmtime(self.full(item))
            if newest and made < newest[0]:
                self.problem(row, "%s was made at %s, before %s last changed (%s). Make it again from the "
                                  "current code and read the new result." % (item, clock(made), newest[1], clock(newest[0])))
            for changed, source in scripts:
                if made < changed and item != source:
                    self.problem(row, "%s was made at %s, before its script %s last changed (%s). Run the "
                                      "script again and read the new result." % (item, clock(made), source, clock(changed)))

    def check_shows(self, row, present, texts):
        shows = row["shows"].strip()
        if not shows:
            self.problem(row, "`shows` is empty. Say what the evidence shows, quoting its lines in backticks.")
            return
        quotes = [squash(quote) for quote in re.findall(r"`([^`]+)`", shows)]
        if not present:
            return
        if not texts:
            if quotes:
                self.problem(row, "`shows` quotes text, and the evidence holds no text file to find it in. "
                                  "Backticks are only for words copied from a text evidence file.")
            return
        if not quotes:
            self.problem(row, "`shows` quotes nothing. Copy the lines or values that prove the criterion "
                              "from the evidence file, in backticks.")
        for quote in quotes:
            if not any(quote in text for text in texts):
                self.problem(row, "`shows` quotes `%s`, and no text evidence file of this row holds it. "
                                  "Quote the file exactly, or correct the claim." % quote)

    def check_tests(self, row, logs):
        if not row["tests"]:
            if not row["no_test"].strip():
                self.problem(row, "no test is named. Name the tests that cover it, or say in `no_test` "
                                  "why none can and what checks it in their place.")
            return
        if not self.doc["test_logs"]:
            self.problem(row, "tests are named and `test_logs` is empty. Save the output of the final "
                              "test run in the evidence folder and name it in `test_logs`.")
            return
        for name in row["tests"]:
            state = best(test_state(name, log) for log in logs)
            if state == "absent":
                self.problem(row, "test %s is in no test log. Check the name, and that the log shows each test by name." % name)
            elif state == "failed":
                self.problem(row, "test %s failed in the test log." % name)
            elif state == "skipped":
                self.problem(row, "test %s was skipped or ignored in the test log. A test that did not run proves nothing." % name)
            elif state == "unknown":
                self.problem(row, "test %s is named in the test log with no result on its line. "
                                  "Run the tests so that each one is listed with its result." % name)

    def test_logs(self, newest):
        logs = []
        for item in self.doc["test_logs"]:
            if not self.usable(item):
                self.problem(None, "test log %s is missing or empty." % item)
                continue
            if newest and os.path.getmtime(self.full(item)) < newest[0]:
                self.problem(None, "test log %s was made at %s, before %s last changed (%s). Run the tests "
                                   "again on the current code." % (item, clock(os.path.getmtime(self.full(item))),
                                                                   newest[1], clock(newest[0])))
            with open(self.full(item), "rb") as handle:
                logs.append(handle.read().decode("utf-8", "replace"))
        return logs

    def newest_code(self):
        """The time and path of the code file changed last, or None when no code is listed."""
        if not any(row["status"] == "proven" for row in self.rows):
            return None
        if not self.doc["code"]:
            self.problem(None, "`code` is empty. List the files and folders this task changes (product code "
                               "and tests), so that evidence older than the code is found.")
            return None
        newest = None
        own = (self.evidence_dir, os.path.dirname(os.path.abspath(self.path)))
        for item in self.doc["code"]:
            full = self.full(item)
            if not os.path.exists(full):
                self.problem(None, "`code` names %s, which does not exist." % item)
                continue
            for path in files_under(full):
                if any(inside(path, folder) for folder in own):
                    continue
                stamp = os.path.getmtime(path)
                if newest is None or stamp > newest[0]:
                    newest = (stamp, os.path.relpath(path, self.root))
        return newest

    def check_evidence_dir(self):
        named = set()
        for row in self.rows:
            named.update(self.full(item) for item in row["evidence"] + row["made_by"])
        named.update(self.full(item) for item in self.doc["test_logs"])
        named.add(os.path.abspath(self.path))
        if os.path.isdir(self.evidence_dir):
            for folder, _, names in sorted(os.walk(self.evidence_dir)):
                for name in sorted(names):
                    path = os.path.join(folder, name)
                    if path not in named and name != ".DS_Store":
                        self.problem(None, "%s is named by no row. Delete it when it is superseded or a "
                                           "leftover; otherwise name it in the row it proves."
                                     % os.path.relpath(path, self.root))
        self.check_size()
        by_hash = {}
        for row in self.rows:
            for item in row["evidence"]:
                if self.usable(item):
                    with open(self.full(item), "rb") as handle:
                        by_hash.setdefault(hashlib.sha256(handle.read()).hexdigest(), set()).add(item)
        for items in by_hash.values():
            if len(items) > 1:
                self.notes.append("these evidence files hold the same bytes: %s. Keep both only when "
                                  "that is intended." % ", ".join(sorted(items)))

    def check_size(self):
        """Notes an evidence folder that has grown large, and the pictures and recordings that make it so."""
        if not os.path.isdir(self.evidence_dir):
            return
        sizes = []
        for folder, _, names in os.walk(self.evidence_dir):
            for name in names:
                path = os.path.join(folder, name)
                if not os.path.islink(path):
                    sizes.append((os.path.getsize(path), os.path.relpath(path, self.root)))
        sizes.sort(reverse=True)
        total = sum(size for size, _ in sizes)
        if total > EVIDENCE_LIMIT:
            self.notes.append(
                "the evidence folder %s holds %s, more than %s. Delete the evidence that is no longer "
                "relevant, and make large pictures and recordings smaller. The largest files: %s." % (
                    os.path.relpath(self.evidence_dir, self.root), megabytes(total),
                    megabytes(EVIDENCE_LIMIT),
                    ", ".join("%s (%s)" % (name, megabytes(size)) for size, name in sizes[:5])))
        for size, name in sizes:
            if size > MEDIA_LIMIT and name.lower().endswith(MEDIA):
                self.notes.append(
                    "%s takes %s. Remove it when no criterion needs it; otherwise replace it with a "
                    "cropped or scaled-down picture, or a sheet of frames, and name that instead."
                    % (name, megabytes(size)))

    def counts(self):
        return {status: sum(row["status"] == status for row in self.rows) for status in STATUSES}

    def summary(self):
        counts = self.counts()
        stand_ins = sum(row["status"] == "proven" and bool(row["stand_in"].strip()) for row in self.rows)
        proven = "%d proven" % counts["proven"]
        if stand_ins:
            proven += " (%d by a stand-in the user accepted)" % stand_ins
        return "%d criteria: %s, %d open, %d for the user to check, %d waived" % (
            len(self.rows), proven, counts["open"], counts["user-check"], counts["waived"])

    def exit_code(self):
        if self.problems:
            return 1
        counts = self.counts()
        return 3 if counts["open"] or counts["user-check"] else 0


def is_strings(value):
    return isinstance(value, list) and all(isinstance(item, str) and item for item in value)


def squash(text):
    return re.sub(r"\s+", " ", text).strip()


def clock(stamp):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stamp))


def inside(path, folder):
    return os.path.commonpath([os.path.abspath(path), folder]) == folder


def files_under(path):
    """The files of a code path: the files git knows or would add, or else a walk past build folders."""
    if os.path.isfile(path):
        return [path]
    try:
        listed = subprocess.run(
            ["git", "ls-files", "-co", "--exclude-standard", "-z"],
            cwd=path, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True,
        ).stdout.decode("utf-8", "replace")
        found = [os.path.join(path, name) for name in listed.split("\0") if name]
        return [name for name in found if os.path.isfile(name)]
    except (OSError, subprocess.CalledProcessError):
        found = []
        for folder, folders, names in os.walk(path):
            folders[:] = [name for name in folders if name not in SKIPPED_DIRS]
            found.extend(os.path.join(folder, name) for name in names)
        return found


def test_state(name, log):
    """How a test log reports one test: passed, failed, skipped, unknown or absent."""
    if log.lstrip().startswith("<"):
        state = junit_state(name, log)
        if state:
            return state
    named = re.compile(r"(?<!\w)%s(?![\w./-])" % re.escape(name))
    states = set()
    for line in log.splitlines():
        if not named.search(line):
            continue
        rest = named.sub(" ", line)
        if FAIL.search(rest):
            states.add("failed")
        elif SKIP.search(rest):
            states.add("skipped")
        elif PASS.search(rest):
            states.add("passed")
        else:
            states.add("unknown")
    return best(states, worst_first=True)


def junit_state(name, log):
    try:
        tree = ElementTree.fromstring(log)
    except ElementTree.ParseError:
        return None
    states = set()
    for case in tree.iter("testcase"):
        own = case.get("name", "")
        joined = "%s.%s" % (case.get("classname", ""), own)
        if name not in (own, joined) and not joined.endswith("." + name) and not joined.endswith("::" + name):
            continue
        children = {child.tag for child in case}
        if children & {"failure", "error"}:
            states.add("failed")
        elif "skipped" in children:
            states.add("skipped")
        else:
            states.add("passed")
    return best(states, worst_first=True) if states else "absent"


def best(states, worst_first=False):
    """One state out of several: the worst one within a log, the best one across logs."""
    states = set(states)
    order = ("failed", "skipped", "passed", "unknown") if worst_first else ("passed", "failed", "skipped", "unknown")
    for state in order:
        if state in states:
            return state
    return "absent"


def report(ledger, stream):
    print("%s: %s" % (ledger.path, ledger.summary()), file=stream)
    if ledger.problems:
        print("problems:", file=stream)
        for text in ledger.problems:
            print("  " + text, file=stream)
    if ledger.notes:
        print("notes:", file=stream)
        for text in ledger.notes:
            print("  " + text, file=stream)
    waiting = [row for row in ledger.rows if row["status"] in ("open", "user-check")]
    if waiting:
        print("not closed:", file=stream)
        for row in waiting:
            print("  %s [%s]: %s" % (row["id"], row["status"], squash(row["note"]) or "no reason recorded"), file=stream)
    code = ledger.exit_code()
    if code == 1:
        print("result: problems found. Nothing in this ledger may be reported as proven until they are fixed.", file=stream)
    elif code == 3:
        print("result: no problems, and the task is not complete: the rows above are not closed.", file=stream)
    else:
        print("result: every criterion is closed and backed by its evidence.", file=stream)


def check(args):
    codes = set()
    for path in args.ledger:
        ledger = Ledger(path)
        ledger.check()
        report(ledger, sys.stdout)
        codes.add(ledger.exit_code())
    return 1 if 1 in codes else 3 if 3 in codes else 0


# --------------------------------------------------------------------------------- prune


def prune(args):
    ledger = Ledger(args.ledger)
    ledger.check()
    other = [text for text in ledger.problems if text != ledger.work_problem]
    counts = ledger.counts()
    if other or counts["open"] or counts["user-check"]:
        report(ledger, sys.stdout)
        print("Nothing was deleted: prune only a run that `check` finds closed and backed, apart "
              "from its work folder.")
        return 1
    if os.path.isdir(ledger.work):
        left = sorted(os.listdir(ledger.work))
        shutil.rmtree(ledger.work, onerror=writable_then_retry)
        print("Deleted %s: %d entr%s (%s)." % (
            os.path.relpath(ledger.work, ledger.root), len(left), "y" if len(left) == 1 else "ies",
            ", ".join(left[:8]) + (" and %d more" % (len(left) - 8) if len(left) > 8 else "")))
    else:
        print("No work folder to delete.")
    again = Ledger(args.ledger)
    again.check()
    report(again, sys.stdout)
    return again.exit_code()


def writable_then_retry(function, path, _):
    """Lets `rmtree` delete a read-only file, such as one in a copied git repository."""
    os.chmod(os.path.dirname(path), 0o700)
    if not os.path.islink(path):
        os.chmod(path, 0o700)
    function(path)


def megabytes(size):
    return "%.1f MB" % (size / float(MB))


# --------------------------------------------------------------------------------- table


def cell(text):
    return squash(text).replace("|", "\\|")


def table(args):
    ledger = Ledger(args.ledger)
    ledger.check()
    if ledger.problems:
        report(ledger, sys.stderr)
        print("no table: fix the problems first.", file=sys.stderr)
        return 1
    print("%s." % ledger.summary())
    print()
    print("| # | Criterion | Status | Tests | Evidence | What it shows |")
    print("| --- | --- | --- | --- | --- | --- |")
    for row in ledger.rows:
        status, shows = row["status"], cell(row["shows"])
        if status == "proven" and row["stand_in"].strip():
            status = "proven by a stand-in"
            shows += " **Stand-in:** %s **Accepted:** %s" % (cell(row["stand_in"]), cell(row["accepted"]))
        elif status == "user-check":
            status = "for the user to check"
            shows = "**To check:** %s" % cell(row["note"])
        elif status == "waived":
            shows = "**Not met:** %s **Accepted:** %s" % (cell(row["note"]), cell(row["accepted"]))
        elif status == "open":
            shows = "**Open:** %s" % (cell(row["note"]) or "no reason recorded")
        if row["status"] == "proven" and row["note"].strip():
            shows += " **Note:** %s" % cell(row["note"])
        tests = ", ".join("`%s`" % name for name in row["tests"]) or cell(row["no_test"])
        files = ", ".join("`%s`" % item for item in row["evidence"] + row["made_by"])
        print("| %s | %s | %s | %s | %s | %s |" % (row["id"], cell(row["criterion"]), status, tests, files, shows.strip()))
    return ledger.exit_code()


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
        prog="ledger.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = top.add_subparsers(dest="command")
    commands.required = True
    new = commands.add_parser("init", help="write a new ledger with one open row per criterion")
    new.add_argument("ledger", help="the ledger file to write; it must not exist yet")
    new.add_argument("--task", required=True, help="the task in one line")
    new.add_argument("--criteria-from", metavar="FILE",
                     help="a file holding the criteria: its list items, or else one criterion per line")
    new.add_argument("--section", metavar="HEADING",
                     help="read only the part of the criteria file under this Markdown heading")
    new.add_argument("--criterion", action="append", metavar="TEXT", help="one criterion; repeat for each")
    new.add_argument("--root", default=".", metavar="DIR",
                     help="the project root that every path in the ledger is relative to (default: here)")
    new.add_argument("--evidence-dir", metavar="DIR",
                     help="where the evidence files go (default: evidence/ beside the ledger)")
    new.add_argument("--code", action="append", default=[], metavar="PATH",
                     help="a file or folder this task changes, relative to the root; repeat for each")
    new.set_defaults(run=init)
    look = commands.add_parser("check", help="list every row that claims more than its files show")
    look.add_argument("ledger", nargs="+")
    look.set_defaults(run=check)
    show = commands.add_parser("table", help="print the ledger as a Markdown table for the report")
    show.add_argument("ledger")
    show.set_defaults(run=table)
    cut = commands.add_parser("prune", help="delete the work folder of a run that is closed and backed")
    cut.add_argument("ledger")
    cut.set_defaults(run=prune)
    return top


def main(argv=None):
    try:
        return command_line(argv)
    finally:
        disk_footer("ledger.py")


def command_line(argv):
    args = parser().parse_args(argv)
    if args.command == "init" and args.criteria_from and args.criterion:
        print("ledger.py: give --criteria-from or --criterion, not both.", file=sys.stderr)
        return 2
    try:
        return args.run(args)
    except UsageError as error:
        print("ledger.py: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
