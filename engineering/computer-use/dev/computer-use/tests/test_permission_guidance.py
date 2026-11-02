"""Explaining and recovering from missing permission (T010) — strict TDD Red.

Covers: granted permissions pass, denied screen/input guidance naming
the permission/app/grant location, partial grants, grant-and-retry,
invalid permission names, and a live read-only status check.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.permissions import (
    PermissionDeniedError,
    check_permissions,
    guidance_for,
    require_permissions,
)


class FakeProber:
    """Stand-in permission backend with flippable grants."""

    def __init__(self, screen_granted=True, input_granted=True,
                 app="TestApp"):
        self._screen = screen_granted
        self._input = input_granted
        self._app = app

    def screen_allowed(self):
        return self._screen

    def input_allowed(self):
        return self._input

    def app_name(self):
        return self._app


def test_granted_permissions_pass() -> None:
    prober = FakeProber()

    assert require_permissions("screen", "input", prober=prober) is None
    status = check_permissions(prober=prober)

    assert status.screen_granted is True
    assert status.input_granted is True
    assert status.app == "TestApp"


def test_denied_screen_names_permission_app_and_location() -> None:
    prober = FakeProber(screen_granted=False)

    with pytest.raises(PermissionDeniedError) as caught:
        require_permissions("screen", prober=prober)

    message = str(caught.value)
    assert "screen" in message.lower()
    assert "TestApp" in message
    assert "Privacy" in message or "Settings" in message


def test_denied_input_names_permission_app_and_location() -> None:
    prober = FakeProber(input_granted=False)

    with pytest.raises(PermissionDeniedError) as caught:
        require_permissions("input", prober=prober)

    message = str(caught.value)
    assert "input" in message.lower() or "type" in message.lower()
    assert "TestApp" in message
    assert "Privacy" in message or "Settings" in message


def test_partial_grant_only_blocks_missing() -> None:
    prober = FakeProber(screen_granted=True, input_granted=False)

    assert require_permissions("screen", prober=prober) is None
    with pytest.raises(PermissionDeniedError):
        require_permissions("input", prober=prober)


def test_grant_and_retry_runs_real_capture() -> None:
    from computer_use.screen import capture_screen

    from types import SimpleNamespace

    prober = FakeProber(screen_granted=False)

    class ScriptedShooter:
        def __init__(self):
            self.grabs = []

        def monitors(self):
            return [{"left": 0, "top": 0, "width": 4, "height": 4},
                    {"left": 0, "top": 0, "width": 2, "height": 2}]

        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            return SimpleNamespace(size=(2, 2), rgb=b"\x01" * 12)

    shooter = ScriptedShooter()

    def gated_capture():
        require_permissions("screen", prober=prober)
        return capture_screen(1, shooter=shooter, prober=prober)

    with pytest.raises(PermissionDeniedError):
        gated_capture()
    assert shooter.grabs == []

    prober._screen = True
    capture = gated_capture()

    assert len(shooter.grabs) == 1
    assert capture.image.size == (2, 2)


def test_invalid_permission_names_rejected() -> None:
    prober = FakeProber()

    with pytest.raises(ValueError):
        require_permissions("telepathy", prober=prober)


def test_guidance_describes_missing_and_granted() -> None:
    denied = check_permissions(prober=FakeProber(screen_granted=False))

    guidance = guidance_for(denied)

    assert guidance.missing == ("screen",)
    assert "TestApp" in guidance.message

    clear = check_permissions(prober=FakeProber())
    assert guidance_for(clear).missing == ()


def test_partial_messages_mention_only_denied_capability() -> None:
    screen_only = guidance_for(
        check_permissions(prober=FakeProber(screen_granted=False))
    )
    input_only = guidance_for(
        check_permissions(prober=FakeProber(input_granted=False))
    )

    assert "input" not in screen_only.message.lower()
    assert "capture" not in input_only.message.lower()
    assert "Screen Recording" in screen_only.message
    assert "Accessibility" in input_only.message


def test_unrelated_probe_failure_does_not_block() -> None:
    class FlakyInputProber(FakeProber):
        def input_allowed(self):
            raise OSError("input probe exploded")

    assert require_permissions("screen",
                               prober=FlakyInputProber()) is None


def test_spoof_permission_name_rejected_without_probing() -> None:
    class RecordingProber(FakeProber):
        def __init__(self):
            super().__init__()
            self.probed = []

        def screen_allowed(self):
            self.probed.append("screen")
            return True

        def input_allowed(self):
            self.probed.append("input")
            return True

    class Spoof:
        def __eq__(self, other):
            return other == "screen"

        def __hash__(self):
            return hash("screen")

    prober = RecordingProber()

    with pytest.raises(ValueError):
        require_permissions(Spoof(), prober=prober)

    assert prober.probed == []


def test_nonboolean_status_rejected() -> None:
    from computer_use.permissions import PermissionStatus

    with pytest.raises(ValueError):
        guidance_for(PermissionStatus(screen_granted="false",
                                      input_granted=True, app="X"))
    with pytest.raises(ValueError):
        guidance_for("not-a-status")


def test_none_app_name_falls_back() -> None:
    status = check_permissions(prober=FakeProber(app=None))

    assert status.app == "this application"
    assert "this application" in guidance_for(status).message


def test_denied_screen_blocks_capture_before_backend() -> None:
    from types import SimpleNamespace

    from computer_use.screen import capture_screen

    class ScriptedShooter:
        def __init__(self):
            self.grabs = []
            self._monitors = [{"left": 0, "top": 0, "width": 4,
                               "height": 4},
                              {"left": 0, "top": 0, "width": 2,
                               "height": 2}]

        def monitors(self):
            return self._monitors

        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            return SimpleNamespace(size=(2, 2), rgb=b"\x01" * 12)

    shooter = ScriptedShooter()
    prober = FakeProber(screen_granted=False)

    with pytest.raises(PermissionDeniedError):
        capture_screen(1, shooter=shooter, prober=prober)

    assert shooter.grabs == []


def test_denied_input_blocks_move_type_and_focus() -> None:
    from computer_use import keyboard as keyboard_module
    from computer_use import pointer as pointer_module

    class DeadMouse:
        def __init__(self):
            self.calls = []

        def move_to(self, x, y):
            self.calls.append(("move", x, y))
            return (x, y)

    class DeadKeyboard:
        def __init__(self):
            self.calls = []

        def type_char(self, ch):
            self.calls.append(ch)
            return True

    mouse = DeadMouse()
    board = DeadKeyboard()
    prober = FakeProber(input_granted=False)

    with pytest.raises(PermissionDeniedError):
        pointer_module.move_to(10.0, 20.0, controller=mouse, prober=prober)
    with pytest.raises(PermissionDeniedError):
        keyboard_module.type_text("hi", controller=board, prober=prober)

    assert mouse.calls == []
    assert board.calls == []


def test_granted_prober_allows_capture_move_and_type() -> None:
    from types import SimpleNamespace

    from computer_use import keyboard as keyboard_module
    from computer_use import pointer as pointer_module
    from computer_use.screen import capture_screen

    class ScriptedShooter:
        def monitors(self):
            return [{"left": 0, "top": 0, "width": 4, "height": 4},
                    {"left": 0, "top": 0, "width": 2, "height": 2}]

        def grab(self, monitor):
            return SimpleNamespace(size=(2, 2), rgb=b"\x01" * 12)

    class LiveMouse:
        def move_to(self, x, y):
            return (x, y)

    class LiveKeyboard:
        def type_char(self, ch):
            return True

    prober = FakeProber()

    assert capture_screen(1, shooter=ScriptedShooter(),
                          prober=prober).image.size == (2, 2)
    assert pointer_module.move_to(
        1.0, 1.0, controller=LiveMouse(), prober=prober).position.x == 1.0
    assert keyboard_module.type_text(
        "hi", controller=LiveKeyboard(), prober=prober).typed == "hi"


def test_malformed_prober_reports_cause() -> None:
    with pytest.raises(PermissionDeniedError) as caught:
        require_permissions("screen", prober=object())

    assert "screen" in str(caught.value).lower()


def test_drag_and_scroll_forward_prober(monkeypatch) -> None:
    from computer_use import pointer as pointer_module

    seen = []

    class FakeCapture:
        def __init__(self):
            self.image = self

        def tobytes(self):
            return b"frame"

    def fake_capture(index, prober=None):
        seen.append((index, prober))
        return FakeCapture()

    monkeypatch.setattr(pointer_module, "capture_screen", fake_capture)
    monkeypatch.setattr(pointer_module, "list_screens",
                        lambda: [FakeScreen()])
    prober = FakeProber()

    class FakeScreen:
        index = 1
        left = 0
        top = 0
        width = 1920
        height = 1080

    class FakeMouse:
        def move_to(self, x, y):
            return (x, y)

        def press(self, button):
            return True

        def release(self, button):
            return True

        def scroll(self, dx, dy):
            return None

        def position(self):
            return (30.0, 40.0)

    pointer_module.drag_path([(10.0, 20.0), (30.0, 40.0)], controller=FakeMouse(),
                        prober=prober)
    pointer_module.scroll(10.0, 10.0, "down", 1, controller=FakeMouse(),
                          prober=prober)

    assert seen == [(1, prober), (1, prober), (1, prober), (1, prober)]


@pytest.mark.skipif(sys.platform != "darwin",
                    reason="reads live macOS permission state")
def test_screen_denied_stops_default_observed_drag_and_scroll() -> None:
    from computer_use import pointer as pointer_module

    class RecordingMouse:
        def __init__(self):
            self.calls = []

        def move_to(self, x, y):
            self.calls.append(("move", x, y))
            return (x, y)

        def press(self, button):
            self.calls.append(("press", button))
            return True

        def release(self, button):
            self.calls.append(("release", button))
            return True

        def position(self):
            return (30.0, 40.0)

        def scroll(self, dx, dy):
            self.calls.append(("scroll", dx, dy))
            return None

    mouse = RecordingMouse()
    prober = FakeProber(screen_granted=False, input_granted=True)

    with pytest.raises(PermissionDeniedError) as drag_caught:
        pointer_module.drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
                            prober=prober)
    with pytest.raises(PermissionDeniedError) as scroll_caught:
        pointer_module.scroll(10.0, 10.0, "down", 1, controller=mouse,
                              prober=prober)

    assert "Screen Recording" in str(drag_caught.value)
    assert "Screen Recording" in str(scroll_caught.value)
    assert mouse.calls == []


def test_nested_screen_denial_propagates(monkeypatch) -> None:
    from computer_use import pointer as pointer_module
    from computer_use.permissions import PermissionDeniedError

    def denied_capture(index, prober=None):
        raise PermissionDeniedError("screen denied guidance")

    monkeypatch.setattr(pointer_module, "capture_screen", denied_capture)

    class RecordingMouse:
        def __init__(self):
            self.calls = []

        def move_to(self, x, y):
            self.calls.append(("move", x, y))
            return (x, y)

        def press(self, button):
            self.calls.append(("press", button))
            return True

        def release(self, button):
            self.calls.append(("release", button))
            return True

        def position(self):
            return (30.0, 40.0)

    mouse = RecordingMouse()

    with pytest.raises(PermissionDeniedError, match="guidance"):
        pointer_module.drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
                            prober=FakeProber())

    assert ("press", "left") not in mouse.calls


def test_live_status_reads_real_permissions() -> None:
    from computer_use.permissions import MacProber

    status = check_permissions(prober=MacProber())

    assert isinstance(status.screen_granted, bool)
    assert isinstance(status.input_granted, bool)
    assert type(status.app) is str and status.app.strip()
    assert guidance_for(status).message.strip()


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
