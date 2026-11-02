"""Complete a real multi-step task end to end (T011).

The full loop — open, select, act, verify each step by fresh
observation, recover failed steps with progress kept — composed into
real tasks: a message reply and a journal entry. Every step runs through
``recover_step`` so verification and recovery are structural.

Content proof comes from the clipboard round-trip: after entering text
the field is selected, copied, and read back, so completion requires the
exact text to be present — unrelated fresh frames never pass. Precise
vision checks can additionally plug in through ``checks``.
"""

from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from types import SimpleNamespace

from computer_use.recovery import RecoveryError


class TaskError(RecoveryError):
    """Raised when a task request itself is misused."""


@dataclass(frozen=True)
class TaskDeps:
    open_app: object
    type_text: object
    press_key: object
    hotkey: object
    observe: object
    select_conversation: object
    read_clipboard: object
    ax_title: object = None
    ax_value: object = None


@dataclass(frozen=True)
class StepRecord:
    description: str
    attempts: int
    recovered: bool


@dataclass(frozen=True)
class TaskReport:
    task: str
    steps: tuple
    completed: bool
    summary: str
    final_frame: bytes | None
    question: str | None


_DEP_FIELDS = (
    "open_app", "type_text", "press_key", "hotkey", "observe",
    "select_conversation", "read_clipboard",
)


def _safe_value(value) -> str:
    """Render caller-supplied data without trusting it."""

    try:
        text = repr(value)
    except Exception:
        return f"<unprintable {type(value).__name__}>"
    if len(text) > 120:
        return (
            f"<{type(value).__name__} with"
            f" a {len(text)}-character representation>"
        )
    return text


def _checked_text(label, value) -> str:
    """Accept only exact non-blank strings, normalized for identifiers."""

    if type(value) is not str or not value.strip():
        raise TaskError(
            f"{label} must be a non-blank string, got {_safe_value(value)}"
        )
    return value.strip()


def _checked_content(label, value) -> str:
    """Accept non-blank content while preserving it exactly."""

    if type(value) is not str or not value.strip():
        raise TaskError(
            f"{label} must be a non-blank string, got {_safe_value(value)}"
        )
    return value
    """Accept only exact non-blank strings for task content."""

    if type(value) is not str or not value.strip():
        raise TaskError(
            f"{label} must be a non-blank string, got {_safe_value(value)}"
        )
    return value.strip()


def _checked_deps(deps) -> TaskDeps:
    """Require working task dependencies before anything runs."""

    for field_name in _DEP_FIELDS:
        try:
            candidate = getattr(deps, field_name)
        except Exception:
            raise TaskError(
                f"deps.{field_name} is missing,"
                f" got {_safe_value(deps)}"
            )
        if not callable(candidate):
            raise TaskError(
                f"deps.{field_name} must be callable,"
                f" got {_safe_value(candidate)}"
            )
    if isinstance(deps, TaskDeps):
        return deps
    return TaskDeps(
        **{name: getattr(deps, name) for name in _DEP_FIELDS},
        ax_title=getattr(deps, "ax_title", None),
        ax_value=getattr(deps, "ax_value", None),
    )


def _checked_steps(steps) -> list:
    """Require non-empty (description, action, check) step triples."""

    try:
        ordered = list(steps)
    except Exception:
        raise TaskError(
            f"steps must be an iterable of step triples,"
            f" got {_safe_value(steps)}"
        )
    if not ordered:
        raise TaskError("A task needs at least one step")
    for entry in ordered:
        try:
            description, action, check = entry
        except Exception:
            raise TaskError(
                f"Each step must be (description, action, check),"
                f" got {_safe_value(entry)}"
            )
        if type(description) is not str or not description.strip():
            raise TaskError(
                f"Step description must be a non-blank string,"
                f" got {_safe_value(description)}"
            )
        if not callable(action) or not callable(check):
            raise TaskError(
                f"Step '{description}' needs callable action and check"
            )
    return ordered


def _fresh_frame_check(frame) -> bool:
    """Confirm a fresh viewable frame without claiming to read it."""

    return isinstance(frame, bytes) and len(frame) > 0


def _confirm_mod() -> str:
    """Modifier for select-all/copy chords on this platform."""

    return "cmd" if sys.platform == "darwin" else "ctrl"


def _read_system_clipboard() -> str:
    """Read the OS clipboard as exact text with platform tools."""

    try:
        if sys.platform == "darwin":
            out = subprocess.run(
                ["pbpaste"], capture_output=True, timeout=10,
            )
        elif sys.platform == "win32":
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
                capture_output=True, timeout=10,
            )
        else:
            try:
                out = subprocess.run(
                    ["xclip", "-selection", "clipboard", "-o"],
                    capture_output=True, timeout=10,
                )
            except FileNotFoundError:
                out = subprocess.run(
                    ["xsel", "--clipboard", "--output"],
                    capture_output=True, timeout=10,
                )
    except Exception as exc:
        raise TaskError(f"Could not read the clipboard: {exc}") from exc
    if out.returncode != 0:
        raise TaskError("Could not read the clipboard")
    try:
        return out.stdout.decode("utf-8", errors="replace")
    except Exception as exc:
        raise TaskError(f"Clipboard text is unusable: {exc}") from exc


def _messages_select(keys, name: str):
    """Select a Messages conversation through the find flow.

    Every delivery receipt is validated; a silent no-op raises instead
    of reporting a selection that never happened.
    """

    chord = keys.hotkey("cmd", "f")
    if getattr(chord, "pressed", None) != ("cmd", "f"):
        raise TaskError("conversation search chord was not delivered")
    typed = keys.type_text(name)
    if (
        getattr(typed, "typed", None) != name
        or getattr(typed, "failed", None) != ()
    ):
        raise TaskError("conversation name was not entered")
    tapped = keys.press_key("enter")
    if getattr(tapped, "pressed", None) != "enter":
        raise TaskError("conversation confirm key was not delivered")
    return SimpleNamespace(conversation=name)


def default_deps() -> TaskDeps:
    """Wire the real application, keyboard, and observation backends."""

    from computer_use import apps, keyboard
    from computer_use import ax as ax_backend
    from computer_use.screen import capture_screen

    return TaskDeps(
        open_app=apps.open_app,
        type_text=keyboard.type_text,
        press_key=keyboard.press_key,
        hotkey=keyboard.hotkey,
        observe=lambda: capture_screen(1).image.tobytes(),
        select_conversation=lambda name: _messages_select(keyboard, name),
        read_clipboard=_read_system_clipboard,
        ax_title=ax_backend.window_title_of,
        ax_value=ax_backend.field_value_of,
    )


_NEED_AX = sys.platform == "darwin"


def _require_ax(active, *readers) -> None:
    """Require accessibility readers where the oracle exists.

    On macOS the window-title and field-value oracles are available,
    so builders fail closed without them; elsewhere the explicit
    caller checks remain the gate.
    """

    if not _NEED_AX:
        return
    missing = [
        name for name in readers
        if not callable(getattr(active, name, None))
    ]
    if missing:
        raise TaskError(
            f"darwin tasks require ax readers"
            f" ({', '.join(missing)}) on their deps;"
            f" wire computer_use.ax readers so the visible target"
            f" and field content are established independently."
        )


def _ax_title_shows(active, app: str, who: str) -> bool:
    """Check the named app's window title names the intended target."""

    reader = getattr(active, "ax_title", None)
    try:
        title = reader(app) if callable(reader) else None
    except Exception:
        return False
    return (
        isinstance(title, str) and who.lower() in title.lower()
    )


def _ax_value_shows(active, app: str, text: str) -> bool:
    """Check the named app's focused field matches the content."""

    reader = getattr(active, "ax_value", None)
    try:
        shown = reader(app) if callable(reader) else None
    except Exception:
        return False
    return isinstance(shown, str) and shown == text


def _selected_name(result) -> str | None:
    """Read the selected conversation name from known result shapes."""

    for source in (result,):
        for attr in ("conversation", "selected"):
            try:
                value = getattr(source, attr, None)
            except Exception:
                continue
            if type(value) is str and value.strip():
                return value.strip()
        try:
            items = dict(source) if not isinstance(source, dict) else source
        except Exception:
            continue
        for key in ("conversation", "selected"):
            try:
                value = items.get(key)
            except Exception:
                continue
            if type(value) is str and value.strip():
                return value.strip()
    return None


def _resolve_checks(checks, descriptions) -> dict:
    """Merge caller content checks over fresh-frame defaults."""

    resolved = {description: _fresh_frame_check for description in descriptions}
    if checks is None:
        return resolved
    try:
        items = dict(checks)
    except Exception:
        raise TaskError(
            f"checks must map step descriptions to callables,"
            f" got {_safe_value(checks)}"
        )
    for description, check in items.items():
        if description not in resolved:
            raise TaskError(
                f"Unknown step {_safe_value(description)} in checks"
            )
        if not callable(check):
            raise TaskError(
                f"Check for '{description}' must be callable,"
                f" got {_safe_value(check)}"
            )
        resolved[description] = check
    return resolved


def _combine(resolved, checks, description, mandatory):
    """Combine a mandatory invariant with an optional caller check.

    Caller checks supplement the structural proof but can never replace
    it: both must pass.
    """

    if checks is not None and description in dict(checks):
        custom = resolved[description]

        def combined(frame):
            return bool(mandatory(frame)) and bool(custom(frame))

        return combined
    return mandatory


def _checked_select(select):
    """Accept the default flows or a custom selection callable."""

    if select is None or select in ("search", "compose"):
        return select or "search"
    if callable(select):
        return select
    raise TaskError(
        f"select must be 'search', 'compose', or callable,"
        f" got {_safe_value(select)}"
    )


def run_task(task, steps, observer=None, refresh=None, progress=(),
             max_attempts=3) -> TaskReport:
    """Run ordered verified steps, stopping at the first unrecovered one."""

    from computer_use.recovery import recover_step, _checked_progress

    checked_task = _checked_text("task", task)
    ordered = _checked_steps(steps)
    try:
        # Reuse the recovery progress guard so run_task never converts
        # a string/bytes into character entries before validation.
        kept = _checked_progress(progress)
    except Exception as exc:
        raise TaskError(str(exc))
    done: list = []
    records: list = []
    final_frame: bytes | None = None
    for description, action, check in ordered:
        step_report = recover_step(
            description.strip(), action, check, observer=observer,
            refresh=refresh, progress=tuple(kept) + tuple(done),
            max_attempts=max_attempts,
        )
        records.append(StepRecord(
            description=description.strip(),
            attempts=len(step_report.attempts),
            recovered=step_report.recovered,
        ))
        final_frame = step_report.final_frame
        if not step_report.recovered:
            return TaskReport(
                task=checked_task,
                steps=tuple(records),
                completed=False,
                summary=(
                    f"{checked_task} stopped at"
                    f" '{description.strip()}'"
                    f" after {len(records)} of {len(ordered)} steps."
                ),
                final_frame=final_frame,
                question=step_report.question,
            )
        done.append(description.strip())
    return TaskReport(
        task=checked_task,
        steps=tuple(records),
        completed=True,
        summary=(
            f"{checked_task} complete: {len(records)} steps"
            f" ({', '.join(done)}). Final state captured."
        ),
        final_frame=final_frame,
        question=None,
    )


_SETTLE_POLLS = 5
_SETTLE_INTERVAL = 0.5


def _enter_with_confirm(active, text: str, prepare=None, app=None):
    """Type text, then prove it reads back through the clipboard.

    The field is cleared first so retries never append to a partial
    entry, and the clipboard is re-read briefly because applications
    can lag behind delivered keystrokes. An optional ``prepare`` hook
    runs first on every attempt (for example opening a fresh compose
    so each attempt starts from a guaranteed-empty field).
    """

    mod = _confirm_mod()
    cell: dict = {}

    def do_enter():
        if prepare is not None:
            prepare()
        before = active.observe()
        if not isinstance(before, bytes) or len(before) == 0:
            before = None
        active.hotkey(mod, "a")
        active.press_key("delete")
        typed = active.type_text(text)
        pasted = ""
        for poll in range(_SETTLE_POLLS):
            active.hotkey(mod, "a")
            active.hotkey(mod, "c")
            pasted = active.read_clipboard()
            if pasted == text or poll == _SETTLE_POLLS - 1:
                break
            time.sleep(_SETTLE_INTERVAL)
        cell["pasted"] = pasted
        cell["before"] = before
        return typed

    def check_enter(frame) -> bool:
        before = cell.get("before")
        if _NEED_AX and _ax_value_shows(active, app, text) is False:
            return False
        return (
            cell.get("pasted") == text
            and isinstance(frame, bytes)
            and len(frame) > 0
            and before is not None
            and frame != before
        )

    return do_enter, check_enter


_COMPOSE_SETTLE = 0.5


def _compose_prepare(active):
    """Open a fresh compose so each attempt starts from empty input."""

    def prepare():
        active.hotkey("cmd", "n")
        active.press_key("tab")
        time.sleep(_COMPOSE_SETTLE)

    return prepare


def recopy_content_check(active, text):
    """Build an independent re-read check for live content proof.

    Select-all plus copy samples the focused field a second time,
    after the entry action finished, so focus drift between entry
    and verification is caught instead of trusted. The caller must
    still supply this check explicitly: clipboard equality and a
    changed frame alone never prove the intended content is shown.
    """

    expected = _checked_content("content", text)

    def check(frame):
        mod = _confirm_mod()
        active.hotkey(mod, "a")
        active.hotkey(mod, "c")
        return (
            active.read_clipboard() == expected
            and _fresh_frame_check(frame)
        )

    return check


def _require_content_check(checks, description):
    """Refuse to report content completion without an explicit check."""

    try:
        present = checks is not None and description in dict(checks)
    except Exception:
        present = False
    if not present:
        raise TaskError(
            f"'{description}' requires an explicit content-aware check;"
            f" supply checks['{description}'] (see recopy_content_check)"
            f" because clipboard equality plus a changed frame alone"
            f" never proves the intended content is shown."
        )


def reply_to_message(conversation, reply, deps=None, app="Messages",
                     select=None, checks=None, refresh=None,
                     max_attempts=3, send=False) -> TaskReport:
    """Open a conversation, enter a reply, and verify it on screen."""

    who = _checked_text("conversation", conversation)
    text = _checked_content("reply", reply)
    target_app = _checked_text("app", app)
    mode = _checked_select(select)
    active = _checked_deps(deps if deps is not None else default_deps())
    if refresh is None:
        refresh = lambda: active.open_app(target_app)  # noqa: E731

    open_desc = f"open {target_app}"
    select_desc = (
        "open fresh compose" if mode == "compose"
        else f"select conversation with {who}"
    )
    enter_desc = f"enter reply to {who}"
    send_desc = f"send reply to {who}"
    known_descriptions = [open_desc, select_desc, enter_desc]
    if send:
        known_descriptions.append(send_desc)
    resolved = _resolve_checks(checks, known_descriptions)
    _require_content_check(checks, enter_desc)
    if mode == "compose":
        _require_ax(active, "ax_value")
    else:
        _require_ax(active, "ax_title", "ax_value")

    select_cell: dict = {}

    def do_search_select():
        if callable(mode):
            result = mode(who)
        else:
            result = active.select_conversation(who)
        select_cell["selected"] = _selected_name(result)
        return result

    def check_select(frame) -> bool:
        if _NEED_AX and not _ax_title_shows(active, target_app, who):
            return False
        return (
            isinstance(select_cell.get("selected"), str)
            and select_cell["selected"].lower() == who.lower()
            and _fresh_frame_check(frame)
        )

    do_enter, default_enter_check = _enter_with_confirm(
        active, text, app=target_app,
    )
    send_cell: dict = {}
    def do_send():
        send_cell["before"] = active.observe()
        return active.press_key("enter")

    def check_sent(frame) -> bool:
        before = send_cell.get("before")
        return (
            isinstance(frame, bytes)
            and len(frame) > 0
            and before is not None
            and frame != before
        )

    if mode == "compose":
        compose_enter, compose_enter_check = _enter_with_confirm(
            active, text, prepare=_compose_prepare(active),
            app=target_app,
        )
        steps = [
            (open_desc, lambda: active.open_app(target_app),
             _combine(resolved, checks, open_desc, _fresh_frame_check)),
            (enter_desc, compose_enter,
             _combine(resolved, checks, enter_desc, compose_enter_check)),
        ]
    else:
        steps = [
            (open_desc, lambda: active.open_app(target_app),
             _combine(resolved, checks, open_desc, _fresh_frame_check)),
            (select_desc, do_search_select,
             _combine(resolved, checks, select_desc, check_select)),
            (enter_desc, do_enter,
             _combine(resolved, checks, enter_desc, default_enter_check)),
        ]
    if send:
        steps.append(
            (send_desc, do_send,
             _combine(resolved, checks, send_desc, check_sent))
        )
    report = run_task(f"reply to {who}", steps, observer=active.observe,
                      refresh=refresh, max_attempts=max_attempts)
    if not report.completed:
        return report
    return TaskReport(
        task=report.task,
        steps=report.steps,
        completed=True,
        summary=f"{report.summary} Reply: {text}",
        final_frame=report.final_frame,
        question=None,
    )


def run_batch(*args, **kwargs):
    """Expose the generic bounded batch helper beside task composition."""

    from computer_use.batch import run_batch as _run_batch

    return _run_batch(*args, **kwargs)


def write_journal_entry(content, deps=None, app="TextEdit",
                        new_document=False, checks=None, refresh=None,
                        max_attempts=3) -> TaskReport:
    """Open the editor, enter content, and verify it on screen."""

    text = _checked_content("content", content)
    target_app = _checked_text("app", app)
    active = _checked_deps(deps if deps is not None else default_deps())
    if refresh is None:
        refresh = lambda: active.open_app(target_app)  # noqa: E731

    planned: list = [("open editor", lambda: active.open_app(target_app))]
    if new_document:
        planned.append(
            ("open fresh document", lambda: active.hotkey("cmd", "n")),
        )
    planned.append(("enter journal entry", None))
    descriptions = [description for description, _ in planned]
    resolved = _resolve_checks(checks, descriptions)
    _require_content_check(checks, "enter journal entry")
    _require_ax(active, "ax_value")
    do_enter, default_enter_check = _enter_with_confirm(
        active, text, app=target_app,
    )
    steps = []
    for description, action in planned:
        if action is None:
            steps.append(
                (description, do_enter,
                 _combine(resolved, checks, description,
                          default_enter_check))
            )
        else:
            steps.append(
                (description, action,
                 _combine(resolved, checks, description,
                          _fresh_frame_check))
            )
    report = run_task("write journal entry", steps, observer=active.observe,
                      refresh=refresh, max_attempts=max_attempts)
    if not report.completed:
        return report
    return TaskReport(
        task=report.task,
        steps=report.steps,
        completed=True,
        summary=f"{report.summary} Entry: {text}",
        final_frame=report.final_frame,
        question=None,
    )
