"""Fresh, bounded semantic application/window waits (T006)."""

from __future__ import annotations

import pytest

from computer_use.apps import AppError, wait_for_window
from computer_use.conditions import WindowObservation, WindowWaitResult


class WindowBackend:
    def __init__(self, running=(), frontmost="Finder"):
        self.running_values = list(running)
        self.frontmost_value = frontmost
        self.running_reads = 0
        self.frontmost_reads = 0
        self.mutations = []

    def running(self):
        self.running_reads += 1
        return tuple(self.running_values)

    def frontmost(self):
        self.frontmost_reads += 1
        return self.frontmost_value

    def launch(self, name):
        self.mutations.append(("launch", name))

    def activate(self, name):
        self.mutations.append(("activate", name))


def test_wait_for_visible_window_polls_fresh_state_without_mutating():
    backend = WindowBackend(running=())
    reads = iter([(), (), ("Editor",)])

    def reader(name):
        value = next(reads)
        backend.running_reads += 1
        return {"visible": name in value, "applications": value}

    result = wait_for_window(
        "Editor", condition="visible", apps=backend, reader=reader,
        timeout=1, poll_interval=0,
    )

    assert isinstance(result, WindowWaitResult)
    assert result.status == "satisfied"
    assert result.satisfied is True
    assert result.condition == "visible"
    assert result.latest.visible is True
    assert len(result.observations) == 3
    assert backend.mutations == []


def test_wait_for_focus_times_out_with_latest_state():
    backend = WindowBackend(running=("Editor",), frontmost="Finder")
    result = wait_for_window(
        "Editor", condition="focused", apps=backend,
        timeout=0, poll_interval=0,
    )

    assert result.status == "timed_out"
    assert result.satisfied is False
    assert result.latest.visible is True
    assert result.latest.focused is False
    assert result.latest.frontmost == "Finder"
    assert "Finder" in result.evidence
    assert backend.mutations == []


def test_unavailable_reader_is_not_reported_as_timeout_or_success():
    def broken(_name):
        raise OSError("window reader gone")

    result = wait_for_window(
        "Editor", condition="visible", reader=broken,
        timeout=0, poll_interval=0,
    )

    assert result.status == "unavailable"
    assert result.satisfied is False
    assert "window reader gone" in result.evidence


def test_false_condition_is_distinct_from_unavailable_reader():
    result = wait_for_window(
        "Editor", condition="visible",
        reader=lambda name: {"visible": False, "applications": ()},
        timeout=0, poll_interval=0,
    )

    assert result.status == "timed_out"
    assert result.latest.visible is False
    assert result.status != "unavailable"


def test_malformed_window_observation_is_unavailable():
    result = wait_for_window(
        "Editor", reader=lambda name: WindowObservation(
            application="Editor", visible=1, focused=None,
        ), timeout=0,
    )

    assert result.status == "unavailable"
    assert result.satisfied is False


def test_contradictory_visibility_and_focus_is_not_success():
    result = wait_for_window(
        "Editor", condition="focused",
        reader=lambda name: {"visible": False, "focused": True},
        timeout=0, poll_interval=0,
    )

    assert result.status == "unavailable"
    assert result.satisfied is False


def test_custom_window_reader_may_be_zero_argument():
    result = wait_for_window(
        "Editor", reader=lambda: {"visible": True},
        timeout=0, poll_interval=0,
    )

    assert result.status == "satisfied"


def test_invalid_wait_arguments_are_rejected_before_backend_read():
    backend = WindowBackend(running=("Editor",))

    with pytest.raises(AppError, match="timeout"):
        wait_for_window("Editor", apps=backend, timeout=-1)
    with pytest.raises(AppError, match="timeout"):
        wait_for_window("Editor", apps=backend, timeout=10**10000)

    assert backend.running_reads == 0
    assert backend.frontmost_reads == 0
