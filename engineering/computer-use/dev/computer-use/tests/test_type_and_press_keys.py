"""Typing text and pressing keys (T007) — strict TDD Red.

Covers: mixed-language typing with exact reporting, failed-character
naming, non-string rejection, backend breakdown causes, single-key
presses with aliases, unsupported-key reports, hotkey chords with bad
modifiers, chord delivery failures, and a live Escape press.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.keyboard import (
    KeyActionError,
    UnsupportedCharacter,
    hotkey,
    press_key,
    type_text,
)


class FakeKeyboard:
    """Stand-in keyboard backend recording typed chars, taps, and chords."""

    def __init__(self, fail_chars=(), type_error=None, tap_error=None,
                 chord_error=None):
        self._fail_chars = set(fail_chars)
        self._type_error = type_error
        self._tap_error = tap_error
        self._chord_error = chord_error
        self.typed = []
        self.tapped = []
        self.chords = []

    def type_char(self, ch):
        if self._type_error is not None:
            raise self._type_error
        if ch in self._fail_chars:
            raise UnsupportedCharacter(ch)
        self.typed.append(ch)
        return True

    def tap(self, key):
        if self._tap_error is not None:
            raise self._tap_error
        self.tapped.append(key)
        return True

    def chord(self, modifiers, key):
        if self._chord_error is not None:
            raise self._chord_error
        self.chords.append((tuple(modifiers), key))
        return True


def test_type_mixed_language_text_reports_exactly() -> None:
    board = FakeKeyboard()

    result = type_text("Hi, мир! 123 ±", controller=board)

    assert result.text == "Hi, мир! 123 ±"
    assert result.typed == "Hi, мир! 123 ±"
    assert result.failed == ()
    assert "".join(board.typed) == "Hi, мир! 123 ±"


def test_type_names_failed_characters_without_skipping_silently() -> None:
    board = FakeKeyboard(fail_chars={"é"})

    result = type_text("café", controller=board)

    assert result.typed == "caf"
    assert result.failed == ("é",)
    assert board.typed == ["c", "a", "f"]


def test_type_rejects_non_string_without_acting() -> None:
    board = FakeKeyboard()

    for bad in (None, 123, b"text", ["a"]):
        with pytest.raises(KeyActionError):
            type_text(bad, controller=board)

    assert board.typed == []


def test_type_backend_breakdown_reports_cause() -> None:
    board = FakeKeyboard(type_error=OSError("keyboard gone"))

    with pytest.raises(KeyActionError, match="keyboard gone"):
        type_text("hi", controller=board)


def test_press_supported_keys_reports_canonical_names() -> None:
    board = FakeKeyboard()

    for name in ("escape", "enter", "tab", "up", "down", "left", "right",
                 "backspace", "delete", "space", "home", "end"):
        result = press_key(name, controller=board)

        assert result.key == name
        assert result.pressed == name

    assert board.tapped == ["escape", "enter", "tab", "up", "down", "left",
                            "right", "backspace", "delete", "space",
                            "home", "end"]


def test_press_alias_normalizes_to_canonical() -> None:
    board = FakeKeyboard()

    assert press_key("esc", controller=board).pressed == "escape"
    assert press_key("return", controller=board).pressed == "enter"
    assert press_key("del", controller=board).pressed == "delete"


def test_press_unsupported_key_reports_without_pressing() -> None:
    board = FakeKeyboard()

    with pytest.raises(KeyActionError) as caught:
        press_key("f13", controller=board)

    assert "escape" in str(caught.value)
    assert board.tapped == []


def test_hotkey_chord_reports_modifiers_and_key() -> None:
    board = FakeKeyboard()

    result = hotkey("cmd", "c", controller=board)

    assert result.modifiers == ("cmd",)
    assert result.key == "c"
    assert result.pressed == ("cmd", "c")
    assert board.chords == [(("cmd",), "c")]


def test_hotkey_bad_modifier_reports_without_pressing() -> None:
    board = FakeKeyboard()

    with pytest.raises(KeyActionError) as caught:
        hotkey("hyper", "c", controller=board)

    assert "cmd" in str(caught.value)
    assert board.chords == []


def test_hotkey_delivery_failure_reports_cause() -> None:
    board = FakeKeyboard(chord_error=OSError("chord stuck"))

    with pytest.raises(KeyActionError, match="chord stuck"):
        hotkey("cmd", "c", controller=board)


def test_adapter_propagates_systemic_failure(monkeypatch) -> None:
    from computer_use.keyboard import _PynputKeyboard

    class BrokenController:
        def type(self, ch):
            raise OSError("keyboard permission denied")

    monkeypatch.setattr(
        _PynputKeyboard, "_controller",
        staticmethod(lambda: BrokenController()),
    )

    with pytest.raises(OSError, match="permission denied"):
        _PynputKeyboard().type_char("a")


def test_adapter_maps_supported_modifiers() -> None:
    from pynput.keyboard import Key

    from computer_use.keyboard import _PynputKeyboard

    assert _PynputKeyboard._pynput_key("shift") is Key.shift
    assert _PynputKeyboard._pynput_key("ctrl") is Key.ctrl
    assert _PynputKeyboard._pynput_key("alt") is Key.alt
    assert _PynputKeyboard._pynput_key("cmd") is Key.cmd


def test_live_press_escape_reports_key() -> None:
    result = press_key("escape")

    assert result.pressed == "escape"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
