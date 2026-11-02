"""Arrange application windows and report resulting state (T014).

Minimizing, maximizing, and resizing reach the requested state and the
actual resulting state is reported on re-observation; a refused change
reports the actual state instead of failing.
"""

from __future__ import annotations

import pytest

from computer_use.apps import (
    AppError,
    WindowState,
    maximize_window,
    minimize_window,
    resize_window,
    window_state,
)


class FakeApps:
    """Scripted application backend with arrangeable windows."""

    def __init__(self, info=None, screen=(1000, 800), refuse=()):
        self._info = dict(info if info is not None else {
            "Calculator": [False, (100, 100, 320, 480)],
        })
        self._screen = screen
        self._refuse = set(refuse)
        self.calls = []

    def running(self):
        return tuple(sorted(self._info))

    def frontmost(self):
        return "Calculator"

    def launch(self, name):
        self.calls.append(("launch", name))
        return True

    def activate(self, name):
        self.calls.append(("activate", name))
        return True

    def minimize(self, name):
        self.calls.append(("minimize", name))
        if "minimize" in self._refuse:
            return False
        self._info[name][0] = True
        return True

    def maximize(self, name):
        self.calls.append(("maximize", name))
        if "maximize" in self._refuse:
            return False
        self._info[name][0] = False
        self._info[name][1] = (0, 0) + self._screen
        return True

    def resize(self, name, width, height):
        self.calls.append(("resize", name, width, height))
        if "resize" in self._refuse:
            return False
        self._info[name][0] = False
        x, y, _, _ = self._info[name][1]
        self._info[name][1] = (x, y, width, height)
        return True

    def window_info(self, name):
        minimized, bounds = self._info[name]
        return minimized, tuple(bounds)

    def screen_size(self):
        return self._screen


def test_minimize_leaves_foreground_and_reports_state() -> None:
    apps = FakeApps()

    state = minimize_window("calculator", apps=apps)

    assert isinstance(state, WindowState)
    assert state.app == "Calculator"
    assert state.state == "minimized"
    assert ("minimize", "Calculator") in apps.calls


def test_maximize_fills_screen_and_reports_state() -> None:
    apps = FakeApps()

    state = maximize_window("Calculator", apps=apps)

    assert state.state == "maximized"
    assert (state.width, state.height) == (1000, 800)


def test_resize_reports_resulting_dimensions() -> None:
    apps = FakeApps()

    state = resize_window("Calculator", 800, 600, apps=apps)

    assert state.state == "normal"
    assert (state.width, state.height) == (800, 600)


def test_refused_change_reports_actual_state() -> None:
    apps = FakeApps(refuse=("resize",))

    state = resize_window("Calculator", 800, 600, apps=apps)

    assert state.state == "normal"
    assert (state.width, state.height) == (320, 480)


def test_invalid_dimensions_rejected_without_acting() -> None:
    apps = FakeApps()

    for bad in (0, -100, "800", 800.5, True, None):
        with pytest.raises(AppError):
            resize_window("Calculator", bad, 600, apps=apps)
        with pytest.raises(AppError):
            resize_window("Calculator", 800, bad, apps=apps)

    assert [call for call in apps.calls if call[0] == "resize"] == []


def test_unknown_application_rejected() -> None:
    apps = FakeApps()

    with pytest.raises(AppError):
        minimize_window("NoSuchApp", apps=apps)


def test_backend_without_arrange_reports_gap() -> None:
    class OldApps(FakeApps):
        minimize = None
        maximize = None
        resize = None
        window_info = None
        screen_size = None

    with pytest.raises(AppError):
        minimize_window("Calculator", apps=OldApps())


def test_live_resize_restores_textedit() -> None:
    import time

    from computer_use.apps import open_app

    open_app("TextEdit")
    before = window_state("TextEdit")
    # Shrink: growing past the visible area is refused/clamped by the
    # window manager, while shrinking the main window always fits.
    target = (max(400, before.width - 60), max(300, before.height - 60))

    moved = None
    for _ in range(10):
        moved = resize_window("TextEdit", *target)
        if (moved.width, moved.height) != (
            before.width, before.height,
        ):
            break
        time.sleep(0.3)

    try:
        assert (moved.width, moved.height) != (
            before.width, before.height,
        )
    finally:
        restored = None
        for _ in range(10):
            restored = resize_window(
                "TextEdit", before.width, before.height,
            )
            if (restored.width, restored.height) == (
                before.width, before.height,
            ):
                break
            time.sleep(0.3)

    assert (restored.width, restored.height) == (
        before.width, before.height,
    )
