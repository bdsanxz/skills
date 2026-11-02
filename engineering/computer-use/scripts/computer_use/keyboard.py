"""Type text and press keys into the focused target (T007).

Keystrokes land wherever the focused receiver is (see T006), so every
function reports exactly what was attempted: typed characters with any
failed characters named, canonical key names, and modifier chords. The
keyboard backend is injectable so tests stay hermetic.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass

from computer_use.permissions import require_permissions


class KeyActionError(RuntimeError):
    """Raised when text or keys cannot be validated, delivered, or named."""


class UnsupportedCharacter(Exception):
    """A backend signal that one character cannot be produced."""

    def __init__(self, character: str):
        super().__init__(character)
        self.character = character


@dataclass(frozen=True)
class TypeResult:
    text: str
    typed: str
    failed: tuple = ()
    acceptance: object = None

    @property
    def delivered(self) -> bool:
        return self.typed == self.text and self.failed == ()

    @property
    def accepted(self) -> bool | None:
        if self.acceptance is None:
            return None
        return getattr(self.acceptance, "satisfied", False)

    @property
    def committed(self) -> bool | None:
        if self.acceptance is None:
            return None
        return getattr(self.acceptance, "committed", None)


TextEntryResult = TypeResult


@dataclass(frozen=True)
class KeyResult:
    key: str
    pressed: str


@dataclass(frozen=True)
class HotkeyResult:
    modifiers: tuple
    key: str
    pressed: tuple


SUPPORTED_KEYS = frozenset({
    "escape", "enter", "tab", "up", "down", "left", "right", "backspace",
    "delete", "space", "home", "end",
})

_KEY_ALIASES = {
    "esc": "escape",
    "return": "enter",
    "del": "delete",
}

SUPPORTED_MODIFIERS = frozenset({"shift", "ctrl", "alt", "cmd"})

_MODIFIER_ALIASES = {
    "option": "alt",
    "command": "cmd",
    "control": "ctrl",
}


def _safe_cause(exc: Exception) -> str:
    """Render a backend failure without trusting its string conversion."""

    try:
        return str(exc)
    except Exception:
        return f"<unprintable {type(exc).__name__}>"


def _safe_value(value) -> str:
    """Render backend- or caller-supplied data without trusting it."""

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


def _checked_text(text) -> str:
    """Accept only exact strings so per-character reporting stays safe."""

    if type(text) is not str:
        raise KeyActionError(
            f"Text must be a string, got {_safe_value(text)}"
        )
    return text


def _checked_key(key) -> str:
    """Normalize a key name to its canonical supported form."""

    if type(key) is not str or not key.strip():
        raise KeyActionError(
            f"Key must be a non-blank string, got {_safe_value(key)}"
        )
    canonical = _KEY_ALIASES.get(key.strip().lower(), key.strip().lower())
    if canonical not in SUPPORTED_KEYS:
        supported = ", ".join(sorted(SUPPORTED_KEYS))
        raise KeyActionError(
            f"Unsupported key {_safe_value(key)};"
            f" supported keys: {supported}"
        )
    return canonical


def _checked_modifier(modifier) -> str:
    """Normalize one modifier name to its canonical supported form."""

    if type(modifier) is not str or not modifier.strip():
        raise KeyActionError(
            f"Modifier must be a non-blank string,"
            f" got {_safe_value(modifier)}"
        )
    canonical = _MODIFIER_ALIASES.get(
        modifier.strip().lower(), modifier.strip().lower()
    )
    if canonical not in SUPPORTED_MODIFIERS:
        supported = ", ".join(sorted(SUPPORTED_MODIFIERS))
        raise KeyActionError(
            f"Unsupported modifier {_safe_value(modifier)};"
            f" supported modifiers: {supported}"
        )
    return canonical


def _checked_chord_key(key) -> str:
    """Accept a single printable chord key without pressing anything else."""

    if type(key) is not str or len(key) != 1:
        raise KeyActionError(
            f"Hotkey key must be one character, got {_safe_value(key)}"
        )
    return key.lower()


_MAX_INTER_KEY_INTERVAL = 1.0
_MAX_SETTLE = 10.0
_MAX_ACCEPTANCE_TIMEOUT = 60.0


def _checked_delay(label: str, value, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
    ):
        raise KeyActionError(
            f"{label} must be a finite value between 0 and {maximum:g},"
            f" got {_safe_value(value)}"
        )
    try:
        delay = float(value)
    except Exception as exc:
        raise KeyActionError(
            f"{label} must be a finite value between 0 and {maximum:g},"
            f" got {_safe_value(value)}"
        ) from exc
    if not math.isfinite(delay) or delay < 0 or delay > maximum:
        raise KeyActionError(
            f"{label} must be a finite value between 0 and {maximum:g},"
            f" got {_safe_value(value)}"
        )
    return delay


def _checked_bool(label: str, value) -> bool:
    if type(value) is not bool:
        raise KeyActionError(
            f"{label} must be boolean, got {_safe_value(value)}"
        )
    return value


def type_text(
    text,
    controller=None,
    prober=None,
    interval=0.0,
    settle=0.0,
    focus_check=None,
    field_reader=None,
    acceptance_timeout=6.0,
    acceptance_interval=0.2,
    committed=False,
    *,
    pace=None,
    inter_key_delay=None,
    focus=None,
    acceptance_reader=None,
    commit_reader=None,
    require_acceptance=False,
    commit=None,
    application="focused",
    app=None,
) -> TypeResult:
    """Type exact text with optional pacing, focus, and field proof.

    Delivery is always recorded separately from semantic field acceptance.
    ``field_reader`` is called only after all requested characters have been
    attempted; it must return the focused field value or a field observation.
    """

    checked = _checked_text(text)
    if pace is not None:
        if interval != 0.0:
            raise KeyActionError("Specify either interval or pace, not both")
        interval = pace
    if inter_key_delay is not None:
        if interval != 0.0:
            raise KeyActionError(
                "Specify either interval or inter_key_delay, not both"
            )
        interval = inter_key_delay
    if focus is not None:
        if focus_check is not None:
            raise KeyActionError("Specify either focus_check or focus, not both")
        if callable(focus):
            focus_check = focus
        elif type(focus) is bool:
            focus_check = lambda: focus
        else:
            raise KeyActionError(
                f"focus must be a callable or boolean, got {_safe_value(focus)}"
            )
    if acceptance_reader is not None:
        if field_reader is not None:
            raise KeyActionError(
                "Specify either field_reader or acceptance_reader, not both"
            )
        field_reader = acceptance_reader
    if app is not None:
        if application != "focused":
            raise KeyActionError("Specify either application or app, not both")
        application = app
    if type(application) is not str or not application.strip():
        raise KeyActionError(
            f"application must be a non-blank string, got"
            f" {_safe_value(application)}"
        )
    interval_value = _checked_delay(
        "inter-key interval", interval, _MAX_INTER_KEY_INTERVAL
    )
    settle_value = _checked_delay("settle", settle, _MAX_SETTLE)
    timeout_value = _checked_delay(
        "acceptance timeout", acceptance_timeout, _MAX_ACCEPTANCE_TIMEOUT
    )
    acceptance_pause = _checked_delay(
        "acceptance interval", acceptance_interval, _MAX_INTER_KEY_INTERVAL
    )
    committed = _checked_bool("committed", committed)
    require_acceptance = _checked_bool(
        "require_acceptance", require_acceptance
    )
    if commit is not None:
        commit = _checked_bool("commit", commit)
        committed = commit
    if focus_check is not None and not callable(focus_check):
        raise KeyActionError(
            f"focus_check must be callable, got {_safe_value(focus_check)}"
        )
    if field_reader is not None and not callable(field_reader):
        raise KeyActionError(
            f"field_reader must be callable, got {_safe_value(field_reader)}"
        )
    if commit_reader is not None and not callable(commit_reader):
        raise KeyActionError(
            f"commit_reader must be callable, got {_safe_value(commit_reader)}"
        )
    if require_acceptance and field_reader is None:
        # The default accessibility reader is still a valid proof path.
        pass
    require_permissions("input", prober=prober)
    if focus_check is not None:
        try:
            focused = focus_check()
        except Exception as exc:
            raise KeyActionError(
                f"Could not confirm the focused receiver: {_safe_cause(exc)}"
            ) from exc
        if type(focused) is not bool or not focused:
            raise KeyActionError(
                "The intended field is not confirmed focused; text was not typed"
            )
    active = controller if controller is not None else _PynputKeyboard()
    typed: list = []
    failed: list = []
    for index, character in enumerate(checked):
        try:
            delivery = active.type_char(character)
        except UnsupportedCharacter:
            failed.append(character)
        except Exception as exc:
            raise KeyActionError(
                f"Could not type {_safe_value(checked)}:"
                f" {_safe_cause(exc)}"
            ) from exc
        else:
            if delivery is False:
                failed.append(character)
            else:
                typed.append(character)
        if index < len(checked) - 1 and interval_value > 0:
            time.sleep(interval_value)
    if settle_value > 0:
        time.sleep(settle_value)

    acceptance = None
    if (
        field_reader is not None
        or require_acceptance
        or committed
        or commit_reader is not None
    ):
        from computer_use.conditions import wait_for_field

        acceptance = wait_for_field(
            application,
            checked,
            reader=field_reader,
            timeout=timeout_value,
            poll_interval=acceptance_pause,
            committed=committed,
            commit_reader=commit_reader,
            prober=prober,
        )
    return TypeResult(
        text=checked,
        typed="".join(typed),
        failed=tuple(failed),
        acceptance=acceptance,
    )


def press_key(key, controller=None, prober=None) -> KeyResult:
    """Press and release one supported key, reporting its canonical name."""

    canonical = _checked_key(key)
    require_permissions("input", prober=prober)
    active = controller if controller is not None else _PynputKeyboard()
    try:
        delivery = active.tap(canonical)
    except Exception as exc:
        raise KeyActionError(
            f"Could not press {canonical}: {_safe_cause(exc)}"
        ) from exc
    if delivery is False:
        raise KeyActionError(
            f"Key press was not delivered for {canonical}"
        )
    return KeyResult(key=canonical, pressed=canonical)


def hotkey(*keys, controller=None, prober=None) -> HotkeyResult:
    """Press modifiers plus one final key, reporting the exact chord."""

    if len(keys) < 2:
        raise KeyActionError(
            f"A hotkey needs at least one modifier and one key,"
            f" got {_safe_value(keys)}"
        )
    modifiers = tuple(_checked_modifier(part) for part in keys[:-1])
    final = _checked_chord_key(keys[-1])
    require_permissions("input", prober=prober)
    active = controller if controller is not None else _PynputKeyboard()
    try:
        delivery = active.chord(modifiers, final)
    except Exception as exc:
        names = "+".join([*modifiers, final])
        raise KeyActionError(
            f"Could not press {names}: {_safe_cause(exc)}"
        ) from exc
    if delivery is False:
        names = "+".join([*modifiers, final])
        raise KeyActionError(
            f"Hotkey was not delivered for {names}"
        )
    return HotkeyResult(
        modifiers=modifiers, key=final, pressed=(*modifiers, final)
    )


class _PynputKeyboard:  # pragma: no cover - thin adapter over pynput
    """Real key delivery through pynput.

    Small settles keep modifier chords and taps together when the
    target application processes input slowly.
    """

    _PRESS_SETTLE = 0.05
    _TAP_SETTLE = 0.02

    _KEY_ATTRIBUTES = {
        "escape": "esc",
        "enter": "enter",
        "tab": "tab",
        "up": "up",
        "down": "down",
        "left": "left",
        "right": "right",
        "backspace": "backspace",
        "delete": "delete",
        "space": "space",
        "home": "home",
        "end": "end",
        "shift": "shift",
        "ctrl": "ctrl",
        "alt": "alt",
        "cmd": "cmd",
    }

    @staticmethod
    def _controller():
        from pynput.keyboard import Controller

        return Controller()

    @classmethod
    def _pynput_key(cls, name: str):
        from pynput.keyboard import Key

        return getattr(Key, cls._KEY_ATTRIBUTES[name])

    def type_char(self, ch):
        from pynput.keyboard import Controller

        board = self._controller()
        try:
            board.type(ch)
        except Controller.InvalidCharacterException as exc:
            raise UnsupportedCharacter(ch) from exc
        return True

    def tap(self, key):
        import time

        board = self._controller()
        resolved = self._pynput_key(key)
        board.press(resolved)
        time.sleep(self._TAP_SETTLE)
        board.release(resolved)
        return True

    def chord(self, modifiers, key):
        import time

        board = self._controller()
        held = [self._pynput_key(part) for part in modifiers]
        for modifier in held:
            board.press(modifier)
        time.sleep(self._PRESS_SETTLE)
        try:
            board.tap(key)
        finally:
            time.sleep(self._TAP_SETTLE)
            for modifier in reversed(held):
                board.release(modifier)
        return True
