"""Opening and focusing applications (T006) — strict TDD Red.

Covers: open a running app (bring to front, no relaunch), open a closed
app (launch then focus), unknown app (report visible alternatives), blank
name rejection, focus reporting, and a live Calculator check.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.apps import (  # noqa: E402
    AppError,
    focus_app,
    focused_window,
    open_app,
)


class FakeApps:
    """Stand-in application backend recording launch/activate calls."""

    def __init__(self, running=(), frontmost="Finder", launch_error=None,
                 activate_error=None):
        self._running = list(running)
        self._frontmost = frontmost
        self._launch_error = launch_error
        self._activate_error = activate_error
        self.launched = []
        self.activated = []

    def running(self):
        return tuple(self._running)

    def launch(self, name):
        self.launched.append(name)
        if self._launch_error is not None:
            raise self._launch_error
        self._running.append(name)
        self._frontmost = name
        return True

    def activate(self, name):
        self.activated.append(name)
        if self._activate_error is not None:
            raise self._activate_error
        self._frontmost = name
        return True

    def frontmost(self):
        return self._frontmost


def test_open_running_app_brings_to_front_without_relaunch() -> None:
    apps = FakeApps(running=["Calculator"], frontmost="Finder")

    result = open_app("calculator", apps=apps)

    assert result.app == "Calculator"
    assert result.focused == "Calculator"
    assert result.already_open is True
    assert apps.launched == []
    assert apps.activated == ["Calculator"]


def test_open_closed_app_launches_then_focuses() -> None:
    apps = FakeApps(running=["Finder"], frontmost="Finder")

    result = open_app("TextEdit", apps=apps)

    assert result.app == "TextEdit"
    assert result.focused == "TextEdit"
    assert result.already_open is False
    assert apps.launched == ["TextEdit"]
    assert apps.activated == ["TextEdit"]


def test_unknown_app_reports_visible_alternatives() -> None:
    apps = FakeApps(running=["Calculator", "TextEdit"],
                    launch_error=OSError("no such app"))

    with pytest.raises(AppError) as caught:
        open_app("NoSuchApp", apps=apps)

    assert "Calculator" in str(caught.value)
    assert "TextEdit" in str(caught.value)


def test_blank_name_rejected_without_acting() -> None:
    apps = FakeApps()

    for bad in ("", "   ", None, 123):
        with pytest.raises(AppError):
            open_app(bad, apps=apps)

    assert apps.launched == []
    assert apps.activated == []


def test_focus_app_activates_running_application() -> None:
    apps = FakeApps(running=["TextEdit"], frontmost="Finder")

    result = focus_app("TextEdit", apps=apps)

    assert result.app == "TextEdit"
    assert result.focused == "TextEdit"
    assert apps.activated == ["TextEdit"]


def test_focus_missing_app_reports_visible_alternatives() -> None:
    apps = FakeApps(running=["Calculator"],
                    activate_error=OSError("not running"))

    with pytest.raises(AppError) as caught:
        focus_app("NoSuchApp", apps=apps)

    assert "Calculator" in str(caught.value)


def test_focused_window_reports_frontmost_application() -> None:
    apps = FakeApps(frontmost="Safari")

    assert focused_window(apps=apps) == "Safari"


def test_open_noop_activation_reports_focus_failure() -> None:
    class NoFocusApps(FakeApps):
        def activate(self, name):
            self.activated.append(name)
            return True

    apps = NoFocusApps(running=["Calculator"], frontmost="Finder")

    with pytest.raises(AppError) as caught:
        open_app("Calculator", apps=apps)

    assert "Finder" in str(caught.value)


def test_open_false_activation_rejected() -> None:
    class FalseApps(FakeApps):
        def activate(self, name):
            self.activated.append(name)
            return False

    apps = FalseApps(running=["Calculator"], frontmost="Finder")

    with pytest.raises(AppError, match="[Ff]ocus"):
        open_app("Calculator", apps=apps)


def test_focus_absent_app_rejected_before_activating() -> None:
    apps = FakeApps(running=["Finder"], frontmost="Finder")

    with pytest.raises(AppError) as caught:
        focus_app("Ghost", apps=apps)

    assert "Finder" in str(caught.value)
    assert apps.activated == []


def test_focus_noop_activation_reports_failure() -> None:
    class NoFocusApps(FakeApps):
        def activate(self, name):
            self.activated.append(name)
            return True

    apps = NoFocusApps(running=["TextEdit"], frontmost="Finder")

    with pytest.raises(AppError, match="TextEdit"):
        focus_app("TextEdit", apps=apps)


def test_focus_matches_case_insensitively_to_canonical() -> None:
    apps = FakeApps(running=["TextEdit"], frontmost="Finder")

    result = focus_app("textedit", apps=apps)

    assert result.app == "TextEdit"
    assert apps.activated == ["TextEdit"]


def test_undetermined_frontmost_rejected() -> None:
    class NoneFrontApps(FakeApps):
        def frontmost(self):
            return None

    with pytest.raises(AppError):
        focused_window(apps=NoneFrontApps())

    with pytest.raises(AppError) as caught:
        open_app("Calculator", apps=NoneFrontApps(running=["Calculator"]))
    assert "Calculator" in str(caught.value)


def test_garbage_frontmost_values_rejected() -> None:
    class GarbageFrontApps(FakeApps):
        def __init__(self, value):
            super().__init__()
            self._value = value

        def frontmost(self):
            return self._value

    for garbage in (object(), 1 + 2j, frozenset({"x"}), range(2), 42,
                    b"Safari", ["Safari"], ("Safari",), {"a": 1}):
        with pytest.raises(AppError):
            focused_window(apps=GarbageFrontApps(garbage))


def test_platform_string_subclass_accepted() -> None:
    class PlatformName(str):
        pass

    class PlatformFrontApps(FakeApps):
        def frontmost(self):
            return PlatformName("Safari")

    focused = focused_window(apps=PlatformFrontApps())

    assert focused == "Safari"
    assert type(focused) is str


def test_focus_confirms_after_async_switch() -> None:
    class FlappingApps(FakeApps):
        def __init__(self):
            super().__init__(running=["TextEdit"], frontmost="Finder")
            self.reads = 0

        def frontmost(self):
            self.reads += 1
            if self.reads < 3:
                return "Finder"
            return "TextEdit"

    apps = FlappingApps()

    result = focus_app("TextEdit", apps=apps)

    assert result.focused == "TextEdit"
    assert apps.activated == ["TextEdit"]


def test_open_waits_for_launch_to_settle() -> None:
    class SlowLaunch(FakeApps):
        def __init__(self):
            super().__init__(running=["Finder"], frontmost="Finder")
            self.lists = 0

        def running(self):
            self.lists += 1
            if self.lists >= 3:
                return ("Finder", "SlowApp")
            return ("Finder",)

        def launch(self, name):
            self.launched.append(name)
            return True

    apps = SlowLaunch()

    result = open_app("SlowApp", apps=apps)

    assert result.app == "SlowApp"
    assert result.already_open is False
    assert apps.launched == ["SlowApp"]


def test_open_rejects_launch_that_never_becomes_visible() -> None:
    class NeverVisible(FakeApps):
        def launch(self, name):
            self.launched.append(name)
            return True

    apps = NeverVisible(running=["Finder"], frontmost="Finder")

    with pytest.raises(AppError, match="visible|running"):
        open_app("MissingApp", apps=apps, timeout=0, poll_interval=0)

    assert apps.launched == ["MissingApp"]
    assert apps.activated == []


def test_focus_timeout_reports_latest_frontmost_state() -> None:
    class NeverFocus(FakeApps):
        def activate(self, name):
            self.activated.append(name)
            return True

    apps = NeverFocus(running=["TextEdit"], frontmost="Finder")

    with pytest.raises(AppError, match="Finder") as caught:
        focus_app("TextEdit", apps=apps, timeout=0, poll_interval=0)

    assert "visible but not focused" in str(caught.value)
    assert apps.activated == ["TextEdit"]


def test_invalid_wait_budget_is_rejected_before_launch_or_activation() -> None:
    apps = FakeApps(running=["Finder"], frontmost="Finder")

    with pytest.raises(AppError, match="timeout"):
        open_app("MissingApp", apps=apps, timeout=float("inf"))
    with pytest.raises(AppError, match="timeout"):
        focus_app("Finder", apps=apps, timeout=-1)

    assert apps.launched == []
    assert apps.activated == []


def test_live_open_calculator_reports_focus() -> None:
    result = open_app("Calculator")

    assert "calculator" in result.focused.lower()
    assert result.app.lower() == "calculator"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
