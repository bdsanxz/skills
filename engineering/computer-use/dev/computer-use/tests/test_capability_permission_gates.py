"""Capability availability and operating-system permission boundaries."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from computer_use.apps import open_app
from computer_use.permissions import (
    CapabilityUnavailable,
    CapabilityUnavailableError,
    PermissionDeniedError,
    check_capability,
    require_capabilities,
)
from computer_use.screen import capture_screen, pointer_position
from computer_use.pointer import move_to


class ControlledProbe:
    """Independent capability and permission state for hermetic tests."""

    def __init__(self, capabilities=None, permissions=None, app="TestApp"):
        self.capabilities = {
            "screen": True,
            "input": True,
            "application": True,
        }
        self.capabilities.update(capabilities or {})
        self.permissions = {"screen": True, "input": True}
        self.permissions.update(permissions or {})
        self.app = app
        self.calls = []

    def capability_available(self, name):
        self.calls.append(("capability", name))
        value = self.capabilities[name]
        if isinstance(value, BaseException):
            raise value
        return value

    def screen_allowed(self):
        self.calls.append(("permission", "screen"))
        return self.permissions["screen"]

    def input_allowed(self):
        self.calls.append(("permission", "input"))
        return self.permissions["input"]

    def app_name(self):
        return self.app


class ScriptedShooter:
    def __init__(self):
        self.grabs = []

    def monitors(self):
        return [
            {"left": 0, "top": 0, "width": 4, "height": 4},
            {"left": 0, "top": 0, "width": 2, "height": 2},
        ]

    def grab(self, monitor):
        self.grabs.append(dict(monitor))
        return SimpleNamespace(size=(2, 2), rgb=b"\x01" * 12)


class RecordingMouse:
    def __init__(self):
        self.calls = []

    def move_to(self, x, y):
        self.calls.append(("move", x, y))
        return (x, y)


class RecordingPointer:
    def __init__(self):
        self.calls = 0

    def position(self):
        self.calls += 1
        return (10, 20)


class RecordingApps:
    def __init__(self):
        self.launched = []
        self.activated = []

    def running(self):
        return ()

    def launch(self, name):
        self.launched.append(name)

    def activate(self, name):
        self.activated.append(name)
        return True

    def frontmost(self):
        return "TestApp"


def test_singular_capability_probe_reports_the_same_status_contract():
    probe = ControlledProbe(capabilities={"screen": False})

    status = check_capability("screen", prober=probe)

    assert status.capability == "screen"
    assert status.available is False
    assert status.state == "unavailable"
    with pytest.raises(CapabilityUnavailable):
        require_capabilities("screen", prober=probe)


def test_missing_screen_bridge_is_unavailable_before_capture():
    probe = ControlledProbe(capabilities={"screen": False})
    shooter = ScriptedShooter()

    with pytest.raises(CapabilityUnavailableError) as caught:
        capture_screen(1, shooter=shooter, prober=probe)

    message = str(caught.value).lower()
    assert "capability unavailable" in message
    assert "screen" in message
    assert "permission" not in message
    assert shooter.grabs == []
    assert ("permission", "screen") not in probe.calls


def test_denied_input_is_distinct_and_stops_pointer_delivery():
    probe = ControlledProbe(permissions={"input": False})
    mouse = RecordingMouse()

    with pytest.raises(PermissionDeniedError) as caught:
        move_to(10, 20, controller=mouse, prober=probe)

    message = str(caught.value)
    assert "permission denied" in message.lower()
    assert "input" in message.lower()
    assert "TestApp" in message
    assert "Accessibility" in message
    assert mouse.calls == []


def test_missing_input_bridge_is_unavailable_before_pointer_read():
    probe = ControlledProbe(capabilities={"input": False})
    pointer = RecordingPointer()

    with pytest.raises(CapabilityUnavailableError) as caught:
        pointer_position(pointer, prober=probe)

    assert "capability unavailable" in str(caught.value).lower()
    assert "input" in str(caught.value).lower()
    assert pointer.calls == 0


def test_required_capability_probe_does_not_touch_unrelated_capabilities():
    class ScreenOnlyProbe(ControlledProbe):
        def capability_available(self, name):
            if name != "screen":
                raise AssertionError(f"unexpected capability probe: {name}")
            return super().capability_available(name)

    probe = ScreenOnlyProbe()

    assert require_capabilities("screen", prober=probe) is None
    assert probe.calls == [("capability", "screen")]


def test_missing_application_bridge_stops_before_launch():
    probe = ControlledProbe(capabilities={"application": False})
    apps = RecordingApps()

    with pytest.raises(CapabilityUnavailableError) as caught:
        open_app("TestApp", apps=apps, prober=probe)

    assert "capability unavailable" in str(caught.value).lower()
    assert "application" in str(caught.value).lower()
    assert apps.launched == []
    assert apps.activated == []


def test_granted_permission_retries_the_same_capture_path():
    probe = ControlledProbe(permissions={"screen": False})
    shooter = ScriptedShooter()

    with pytest.raises(PermissionDeniedError):
        capture_screen(1, shooter=shooter, prober=probe)
    assert shooter.grabs == []

    probe.permissions["screen"] = True
    capture = capture_screen(1, shooter=shooter, prober=probe)

    assert capture.image.size == (2, 2)
    assert len(shooter.grabs) == 1
