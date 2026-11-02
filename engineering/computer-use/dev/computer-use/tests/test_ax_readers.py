"""Hermetic tests for the accessibility oracle readers.

The readers import their macOS frameworks lazily, so these tests
install stub frameworks and prove named-application resolution without
touching the live accessibility subsystem.
"""

from __future__ import annotations

import sys
import types

import pytest

from computer_use import ax as ax_module


class _FakeRunning:
    def __init__(self, name, pid=4242):
        self._name = name
        self._pid = pid

    def localizedName(self):
        return self._name

    def processIdentifier(self):
        return self._pid


class _FakeElement:
    def __init__(self, attrs):
        self.attrs = attrs


def _install_stub_frameworks(monkeypatch):
    field = _FakeElement({"VALUE": "hi"})
    window = _FakeElement({"TITLE": "Ada Chat"})
    app = _FakeElement({"WINDOW": window, "ELEMENT": field})

    fake_ax = types.ModuleType("ApplicationServices")
    fake_ax.AXUIElementCreateApplication = lambda pid: app
    fake_ax.AXUIElementCopyAttributeValue = (
        lambda ref, attr, _ignored: (0, ref.attrs.get(attr))
    )
    fake_ax.kAXFocusedWindowAttribute = "WINDOW"
    fake_ax.kAXTitleAttribute = "TITLE"
    fake_ax.kAXFocusedUIElementAttribute = "ELEMENT"
    fake_ax.kAXValueAttribute = "VALUE"

    fake_appkit = types.ModuleType("AppKit")

    class _FakeWorkspace:
        @staticmethod
        def sharedWorkspace():
            return _FakeWorkspace()

        def runningApplications(self):
            return [_FakeRunning("Messages")]

    fake_appkit.NSWorkspace = _FakeWorkspace
    monkeypatch.setitem(sys.modules, "ApplicationServices", fake_ax)
    monkeypatch.setitem(sys.modules, "AppKit", fake_appkit)


def test_window_title_resolves_app_name_case_insensitively(monkeypatch):
    _install_stub_frameworks(monkeypatch)

    assert ax_module.window_title_of("Messages") == "Ada Chat"
    assert ax_module.window_title_of("messages") == "Ada Chat"
    assert ax_module.window_title_of("MESSAGES") == "Ada Chat"


def test_field_value_resolves_app_name_case_insensitively(monkeypatch):
    _install_stub_frameworks(monkeypatch)

    assert ax_module.field_value_of("Messages") == "hi"
    assert ax_module.field_value_of("messages") == "hi"
