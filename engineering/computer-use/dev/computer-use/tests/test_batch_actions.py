"""Bounded predictable action batches with explicit observation boundaries (T009)."""

from __future__ import annotations

import pytest

from computer_use.batch import BatchAction, BatchReport, run_batch


def test_predictable_batch_records_each_action_and_one_boundary_pair():
    calls = []
    frames = iter([b"before", b"after"])

    actions = [
        ("draw first", lambda: calls.append("first") or "first-result"),
        ("draw second", lambda: calls.append("second") or "second-result"),
        ("draw third", lambda: calls.append("third") or "third-result"),
    ]
    report = run_batch(actions, observer=lambda: next(frames), max_actions=3)

    assert isinstance(report, BatchReport)
    assert report.status == "completed"
    assert report.completed is True
    assert calls == ["first", "second", "third"]
    assert [record.description for record in report.actions] == [
        "draw first", "draw second", "draw third",
    ]
    assert all(record.delivered for record in report.actions)
    assert report.start_observation == b"before"
    assert report.end_observation == b"after"
    assert report.changed is True
    assert report.steps == report.actions
    assert report.actions[0].success is True


def test_batch_can_be_intentionally_split_before_dependent_action():
    calls = []
    actions = [
        ("open menu", lambda: calls.append("menu")),
        BatchAction(
            "choose dynamic item", lambda: calls.append("item"),
            requires_observation=True,
        ),
    ]

    report = run_batch(
        actions, observer=lambda: b"frame", max_actions=2,
    )

    assert report.status == "split_required"
    assert report.completed is False
    assert calls == ["menu"]
    assert report.unresolved == "choose dynamic item"
    assert len(report.actions) == 1


def test_single_action_boundary_uses_the_same_contract():
    calls = []
    report = run_batch(
        [("safe click", lambda: calls.append("click"))],
        observer=lambda: b"frame", max_actions=1,
    )

    assert report.completed is True
    assert report.status == "completed"
    assert calls == ["click"]
    assert len(report.actions) == 1


def test_delivery_failure_stops_later_actions_and_preserves_progress():
    calls = []
    frames = iter([b"before", b"after"])
    actions = [
        ("confirmed stroke", lambda: calls.append("one") or True),
        ("uncertain stroke", lambda: calls.append("two") or False),
        ("dependent stroke", lambda: calls.append("three") or True),
    ]

    report = run_batch(actions, observer=lambda: next(frames), max_actions=3)

    assert report.status == "delivery_failed"
    assert report.completed is False
    assert calls == ["one", "two"]
    assert report.progress == ("confirmed stroke",)
    assert report.unresolved == "uncertain stroke"
    assert report.actions[1].delivered is False


def test_focus_gate_stops_batch_before_any_action():
    calls = []
    report = run_batch(
        [("type", lambda: calls.append("typed"))],
        observer=lambda: b"frame",
        focus_check=lambda: False,
    )

    assert report.status == "not_ready"
    assert report.completed is False
    assert calls == []
    assert report.unresolved == "type"


def test_post_batch_observation_failure_is_not_success():
    frames = iter([b"before"])
    report = run_batch(
        [("action", lambda: True)],
        observer=lambda: next(frames),
    )

    assert report.status == "observation_unavailable"
    assert report.completed is False
    assert report.unresolved == "action"
    assert report.actions[0].delivered is True


def test_hostile_delivery_metadata_becomes_a_recorded_failure():
    class Hostile:
        @property
        def delivered(self):
            raise OSError("receipt unavailable")

    report = run_batch(
        [("action", lambda: Hostile())],
        observer=lambda: b"frame",
    )

    assert report.status == "delivery_failed"
    assert report.completed is False
    assert report.actions[0].delivered is False
    assert "receipt" in report.actions[0].error


def test_invalid_batch_budget_is_rejected_before_action():
    calls = []

    with pytest.raises(ValueError, match="max_actions"):
        run_batch(
            [("action", lambda: calls.append("ran"))],
            observer=lambda: b"frame", max_actions=0,
        )
    with pytest.raises(ValueError, match="max_duration"):
        run_batch(
            [("action", lambda: calls.append("ran"))],
            observer=lambda: b"frame", max_duration=10**10000,
        )

    assert calls == []
