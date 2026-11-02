"""Completing a real multi-step task end to end (T011) — strict TDD Red-2.

Covers: deterministic conversation selection, clipboard-confirmed
content entry, lossless summaries, focus-refresh recovery, compose-mode
selection, and live Messages/TextEdit demonstrations with content proof.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.tasks import (
    TaskError,
    recopy_content_check,
    reply_to_message,
    run_task,
    write_journal_entry,
)
from types import SimpleNamespace


class FakeDeps:
    """Scripted task dependencies recording every primitive call."""

    def __init__(self, frames, pasted=(), ax_title=None, ax_value=None):
        self._frames = list(frames)
        self._pasted = list(pasted)
        self._ax_title = ax_title
        self._ax_value = ax_value
        self.calls = []

    def open_app(self, name):
        self.calls.append(("open", name))
        return SimpleNamespace(app=name, focused=name)

    def type_text(self, text):
        self.calls.append(("type", text))
        return SimpleNamespace(typed=text, failed=())

    def press_key(self, name):
        self.calls.append(("key", name))
        return SimpleNamespace(pressed=name)

    def hotkey(self, *keys):
        self.calls.append(("hotkey", tuple(keys)))
        return SimpleNamespace(pressed=tuple(keys))

    def observe(self):
        self.calls.append(("see", len(self.calls)))
        return self._frames.pop(0)

    def select_conversation(self, name):
        self.calls.append(("select", name))

        class Selected:
            conversation = name

        return Selected()

    def read_clipboard(self):
        self.calls.append(("paste", len(self.calls)))
        if self._pasted:
            return self._pasted.pop(0)
        return ""

    def ax_title(self, app):
        self.calls.append(("ax-title", app))
        return self._ax_title

    def ax_value(self, app):
        self.calls.append(("ax-value", app))
        return self._ax_value


def test_progress_string_bytes_rejected() -> None:
    ran = []

    def action():
        ran.append(1)
        return "did"

    rec = FakeDeps([b"frame"])
    steps = [("step", action, lambda frame: True)]

    with pytest.raises(TaskError):
        run_task("task", steps, observer=rec.observe, progress="prior")
    with pytest.raises(TaskError):
        run_task("task", steps, observer=rec.observe, progress=b"prior")

    assert ran == []
    assert rec.calls == []


def test_enter_requires_explicit_check() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["hi"], ax_title="Ada", ax_value="hi")

    with pytest.raises(TaskError):
        reply_to_message("Ada", "hi", deps=deps)

    assert deps.calls == []


def test_recopy_check_rereads_field() -> None:
    deps = FakeDeps([b"f"], pasted=["hi"])

    check = recopy_content_check(deps, "hi")

    assert check(b"frame") is True
    hotkeys = [call for call in deps.calls if call[0] == "hotkey"]
    assert len(hotkeys) == 2

    stale = FakeDeps([b"f"], pasted=["other"])
    assert recopy_content_check(stale, "hi")(b"frame") is False


def test_recopy_check_preserves_boundary_whitespace() -> None:
    deps = FakeDeps([b"f"], pasted=["  padded  "])

    check = recopy_content_check(deps, "  padded  ")

    assert check(b"frame") is True


def test_entry_rejects_wrong_field_value() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["hi"], ax_title="Ada", ax_value="other")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False
    assert ("type", "hi") in deps.calls


def test_select_rejects_wrong_visible_target() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["hi"], ax_title="Com", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False
    assert ("type", "hi") not in deps.calls


def test_select_requires_target_reader() -> None:
    class NoAx(FakeDeps):
        ax_title = None
        ax_value = None

    deps = NoAx([b"app"], pasted=["hi"])

    with pytest.raises(TaskError):
        reply_to_message(
            "Ada", "hi", deps=deps,
            checks={"enter reply to Ada": lambda frame: True},
        )

    assert deps.calls == []


def test_enter_requires_field_reader() -> None:
    class NoAx(FakeDeps):
        ax_title = None
        ax_value = None

    deps = NoAx([b"app"], pasted=["hi"])

    with pytest.raises(TaskError):
        write_journal_entry(
            "Today.", deps=deps,
            checks={"enter journal entry": lambda frame: True},
        )

    assert deps.calls == []


def test_lowercase_app_name_completes_with_oracle() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["hi"], ax_title="Ada", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, app="messages",
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is True
    assert ("open", "messages") in deps.calls
    assert ("ax-title", "messages") in deps.calls
    assert ("ax-value", "messages") in deps.calls


def test_reply_selects_conversation_before_typing() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["On my way!"], ax_title="Ada",
                    ax_value="On my way!")

    report = reply_to_message(
        "Ada", "On my way!", deps=deps,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is True
    assert [step.description for step in report.steps] == [
        "open Messages",
        "select conversation with Ada",
        "enter reply to Ada",
    ]
    kinds = [call[0] for call in deps.calls]
    assert kinds.index("select") < kinds.index("type")
    assert ("select", "Ada") in deps.calls
    assert ("type", "On my way!") in deps.calls


def test_default_search_select_uses_find_flow() -> None:
    from computer_use.tasks import _messages_select

    deps = FakeDeps([b"app"])

    selected = _messages_select(deps, "Ada")

    kinds = [(call[0], call[1] if len(call) > 1 else None)
             for call in deps.calls]
    assert selected.conversation == "Ada"
    assert ("hotkey", ("cmd", "f")) in kinds
    assert ("type", "Ada") in kinds
    assert ("key", "enter") in kinds
    find = kinds.index(("hotkey", ("cmd", "f")))
    assert kinds.index(("type", "Ada")) > find
    assert kinds.index(("key", "enter")) > kinds.index(("type", "Ada"))


def test_override_cannot_bypass_selection() -> None:
    class WrongSelect(FakeDeps):
        def select_conversation(self, name):
            self.calls.append(("select", name))

            class Selected:
                conversation = "Mallory"

            return Selected()

    deps = WrongSelect([b"app", b"found"], pasted=["hi"],
                       ax_title="Mallory", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"select conversation with Ada": lambda frame: True,
                "enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False
    assert ("type", "hi") not in deps.calls


def test_override_cannot_bypass_content() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["WRONG"], ax_title="Ada", ax_value="WRONG")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False


def test_unchanged_view_rejects_entry() -> None:
    deps = FakeDeps([b"app", b"found", b"same", b"same"],
                    pasted=["hi"], ax_title="Ada", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False


def test_boundary_whitespace_preserved_exact() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["  padded  "], ax_title="Ada",
                    ax_value="  padded  ")

    report = reply_to_message(
        "Ada", "  padded  ", deps=deps,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is True
    assert ("type", "  padded  ") in deps.calls
    assert "  padded  " in report.summary


def test_selection_delivery_validated() -> None:
    class DeafKeys(FakeDeps):
        def hotkey(self, *keys):
            self.calls.append(("hotkey", tuple(keys)))
            return SimpleNamespace(pressed=("nope",))

    deps = DeafKeys([b"app", b"found"], pasted=["hi"],
                    ax_title="Ada", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False
    assert ("type", "hi") not in deps.calls


def test_wrong_selection_stops_before_typing() -> None:
    class WrongSelect(FakeDeps):
        def select_conversation(self, name):
            self.calls.append(("select", name))

            class Selected:
                conversation = "Mallory"

            return Selected()

    deps = WrongSelect([b"app", b"found", b"typed"], pasted=["hi"],
                       ax_title="Mallory", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=1,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False
    assert "select conversation with Ada" in report.question
    assert ("type", "hi") not in deps.calls


def test_enter_confirms_clipboard_content() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["garbled", "On my way!"], ax_title="Ada",
                    ax_value="On my way!")

    report = reply_to_message(
        "Ada", "On my way!", deps=deps,
        checks={"enter reply to Ada": lambda frame: True},
        refresh=lambda: None,
    )

    assert report.completed is True
    assert report.steps[2].attempts == 1
    opens = [call for call in deps.calls if call[0] == "open"]
    assert len(opens) == 1
    clears = [call for call in deps.calls
              if call == ("hotkey", ("cmd", "a"))]
    assert clears


def test_unrelated_frames_never_prove_content() -> None:
    deps = FakeDeps(
        [b"app", b"found", b"p1", b"o1", b"p2", b"o2"],
        pasted=["wrong"] * 12, ax_title="Ada", ax_value="wrong",
    )

    report = reply_to_message(
        "Ada", "hi", deps=deps, max_attempts=2,
        checks={"enter reply to Ada": lambda frame: False},
    )

    assert report.completed is False
    assert report.final_frame == b"o2"


def test_summaries_carry_full_content() -> None:
    long_reply = ("word " * 100).strip()
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=[long_reply], ax_title="Ada",
                    ax_value=long_reply)

    reply = reply_to_message(
        "Ada", long_reply, deps=deps,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert long_reply in reply.summary

    long_entry = ("line " * 100).strip()
    journal_deps = FakeDeps([b"editor", b"pre", b"post"],
                            pasted=[long_entry], ax_value=long_entry)
    journal = write_journal_entry(
        long_entry, deps=journal_deps,
        checks={"enter journal entry": lambda frame: True},
    )

    assert long_entry in journal.summary


def test_focus_loss_refreshes_and_completes() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post", b"p2", b"o2"],
                    pasted=["garbled"] * 6 + ["hi"], ax_title="Ada",
                    ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is True
    opens = [call for call in deps.calls if call[0] == "open"]
    assert len(opens) == 2
    assert report.steps[2].attempts == 2


def test_compose_selection_opens_fresh_compose() -> None:
    deps = FakeDeps([b"app", b"pre", b"post"], pasted=["hello"],
                    ax_value="hello")

    report = reply_to_message(
        "Nobody", "hello", deps=deps, select="compose",
        checks={"enter reply to Nobody": lambda frame: True},
    )

    assert report.completed is True
    assert [step.description for step in report.steps] == [
        "open Messages",
        "enter reply to Nobody",
    ]
    assert ("hotkey", ("cmd", "n")) in deps.calls
    assert ("key", "tab") in deps.calls
    assert ("select", "Nobody") not in deps.calls


def test_journal_entry_confirms_content() -> None:
    deps = FakeDeps([b"editor", b"blank", b"pre", b"post"],
                    pasted=["Today I shipped."],
                    ax_value="Today I shipped.")

    report = write_journal_entry(
        "Today I shipped.", deps=deps, new_document=True,
        checks={"enter journal entry": lambda frame: True},
    )

    assert report.completed is True
    assert [step.description for step in report.steps] == [
        "open editor",
        "open fresh document",
        "enter journal entry",
    ]
    assert report.final_frame == b"post"


def test_exhausted_step_stops_with_progress_kept() -> None:
    deps = FakeDeps([b"app", b"found", b"p1", b"o1", b"p2", b"o2"],
                    pasted=["nope", "nope"], ax_title="Ada",
                    ax_value="nope")

    report = reply_to_message(
        "Ada", "On my way!", deps=deps, max_attempts=2,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is False
    assert "enter reply to Ada" in report.question
    assert "select conversation with Ada" in report.question
    opens = [call for call in deps.calls if call[0] == "open"]
    types = [call for call in deps.calls if call[0] == "type"]
    assert len(opens) >= 1
    assert len(types) == 2


def test_invalid_task_inputs_rejected_without_acting() -> None:
    deps = FakeDeps([b"frame"])

    with pytest.raises(TaskError):
        reply_to_message("", "hi", deps=deps)
    with pytest.raises(TaskError):
        reply_to_message("Ada", "  ", deps=deps)
    with pytest.raises(TaskError):
        reply_to_message("Ada", "hi", deps=deps, select="teleport")
    with pytest.raises(TaskError):
        write_journal_entry("", deps=deps)
    with pytest.raises(TaskError):
        run_task("", [("step", lambda: None, lambda frame: True)],
                 observer=deps.observe)
    with pytest.raises(TaskError):
        run_task("task", [], observer=deps.observe)

    assert deps.calls == []


def test_send_step_presses_enter_after_typing() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post", b"spre",
                     b"spost"],
                    pasted=["hi"], ax_title="Ada", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps, send=True,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is True
    assert [step.description for step in report.steps][-1] == \
        "send reply to Ada"
    kinds = [call[0] for call in deps.calls]
    assert kinds.index("type") < len(kinds) - 1
    assert deps.calls[-2][0] in ("key", "see")
    assert ("key", "enter") in deps.calls


def test_no_send_by_default() -> None:
    deps = FakeDeps([b"app", b"found", b"pre", b"post"],
                    pasted=["hi"], ax_title="Ada", ax_value="hi")

    report = reply_to_message(
        "Ada", "hi", deps=deps,
        checks={"enter reply to Ada": lambda frame: True},
    )

    assert report.completed is True
    assert len(report.steps) == 3
    enter_presses = [call for call in deps.calls
                     if call == ("key", "enter")]
    assert enter_presses == []


def _frame_diff_fraction(before: bytes, after: bytes) -> float:
    """Fraction of pixels that visibly changed between two frames."""

    import io

    from PIL import Image, ImageChops

    from computer_use.screen import capture_screen

    size = capture_screen(1).image.size
    first = Image.frombytes("RGB", size, before)
    second = Image.frombytes("RGB", size, after)
    if first.size != second.size:
        return 1.0
    diff = ImageChops.difference(first, second).convert("L")
    histogram = diff.histogram()
    changed = sum(
        count for value, count in enumerate(histogram) if value > 8
    )
    total = first.size[0] * first.size[1]
    return changed / total


def _confirm_delivered(deps, body: str) -> None:
    """Prove the body reached the thread via Telegram message search.

    Searching the exact probe text and opening the top hit jumps from
    the search view into the thread view (a large frame change) only
    when the message exists. A missing message leaves the empty
    "No Results" view, so the frames stay nearly identical. The
    threshold sits far above cursor/clock noise and far below a view
    jump. Read-only: nothing is sent, edited, or deleted.
    """

    import time as _time

    deps.hotkey("cmd", "f")
    _time.sleep(1.0)
    deps.hotkey("cmd", "a")
    deps.press_key("backspace")
    deps.type_text(body)
    _time.sleep(2.0)
    before = deps.observe()
    deps.press_key("down")
    deps.press_key("enter")
    _time.sleep(1.5)
    after = deps.observe()
    deps.press_key("escape")
    _time.sleep(0.3)
    deps.press_key("escape")
    assert _frame_diff_fraction(before, after) > 0.005


def test_live_telegram_reply_to_notes() -> None:
    import datetime

    from computer_use.tasks import default_deps

    deps = default_deps()
    body = (
        "computer-use probe"
        f" {datetime.datetime.now(datetime.timezone.utc):%H:%M:%S}"
    )

    def select_notes(name):
        import time as _time

        _time.sleep(1.5)
        # Normalize first: every attempt starts from the thread
        # with the panel closed, so cmd+shift+f always opens a
        # fresh panel instead of retargeting a stale one.
        # (A clipboard focus-proof was tried here and removed:
        # its own copies poison later attempts with stale text.)
        deps.press_key("escape")
        _time.sleep(1.0)
        deps.press_key("escape")
        _time.sleep(1.0)
        # cmd+shift+f is the global chat search; plain cmd+f is a
        # context-sensitive message search that cannot open chats.
        deps.hotkey("cmd", "shift", "f")
        _time.sleep(1.5)
        deps.hotkey("cmd", "a")
        deps.press_key("backspace")
        _time.sleep(0.3)
        deps.type_text(name)
        _time.sleep(2.5)
        # Down highlights the top hit explicitly: Enter alone only
        # opens it when Telegram auto-highlighted the result.
        deps.press_key("down")
        _time.sleep(0.5)
        deps.press_key("enter")
        _time.sleep(2.0)
        # NOTE: no trailing Escape here. From an open thread,
        # Escape navigates back to the chat list and would destroy
        # the selection this step just made.
        return {"selected": name}

    report = reply_to_message(
        "notes", body, deps=deps, app="Telegram",
        select=select_notes, send=True,
        checks={"enter reply to notes": recopy_content_check(deps, body)},
    )

    assert report.completed is True
    assert body in report.summary
    assert isinstance(report.final_frame, bytes)
    assert len(report.final_frame) > 0
    _confirm_delivered(deps, body)


def test_live_message_compose_unsent() -> None:
    import datetime

    body = (
        # Capitalized: TextEdit/Messages auto-correct a lowercase
        # sentence start, so a lowercase body would honestly fail.
        "Computer-use probe"
        f" {datetime.datetime.now(datetime.timezone.utc):%H:%M:%S}"
        " (unsent: no recipient)"
    )

    from computer_use.tasks import default_deps

    deps = default_deps()
    report = reply_to_message(
        "Probe Compose", body, deps=deps, select="compose",
        checks={"enter reply to Probe Compose":
                recopy_content_check(deps, body)},
    )

    assert report.completed is True
    assert body in report.summary
    assert isinstance(report.final_frame, bytes)
    assert len(report.final_frame) > 0


def test_live_journal_entry_in_textedit() -> None:
    import datetime

    line = (
        # Capitalized: TextEdit auto-corrects a lowercase start.
        "Computer-use probe"
        f" {datetime.datetime.now(datetime.timezone.utc):%H:%M:%S}"
    )

    from computer_use.tasks import default_deps

    deps = default_deps()
    report = write_journal_entry(
        line, deps=deps, new_document=True,
        checks={"enter journal entry": recopy_content_check(deps, line)},
    )

    assert report.completed is True
    assert line in report.summary
    assert isinstance(report.final_frame, bytes)
    assert len(report.final_frame) > 0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
