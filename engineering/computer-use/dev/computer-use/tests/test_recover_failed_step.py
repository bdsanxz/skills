"""Recovering a failed step with progress kept (T009) — strict TDD Red.

Covers: immediate success without retry, retry-only-failed-step with
preserved progress, relocated retry after a move, specific operator
questions on exhaustion, input validation, action-error retries, and a
live immediate-recovery check.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.recovery import RecoveryError, recover_step


class Stage:
    """Scripted action/check/observer stage recording its call order."""

    def __init__(self, frames, fail_actions=()):
        self._frames = list(frames)
        self._fail_actions = set(fail_actions)
        self.calls = []
        self.action_runs = 0
        self.refresh_runs = 0
        self.position = "old"

    def action(self):
        self.action_runs += 1
        self.calls.append(("act", self.action_runs, self.position))
        if self.action_runs in self._fail_actions:
            raise OSError("transient slip")
        return f"ran-{self.action_runs}-at-{self.position}"

    def observe(self):
        self.calls.append(("see", len(self.calls)))
        return self._frames.pop(0)

    def refresh(self):
        self.refresh_runs += 1
        self.position = "new"
        self.calls.append(("refresh", self.refresh_runs))


def test_immediate_success_needs_no_retry() -> None:
    stage = Stage([b"good"])

    report = recover_step(
        "click save", stage.action, lambda frame: frame == b"good",
        observer=stage.observe,
    )

    assert report.recovered is True
    assert len(report.attempts) == 1
    assert report.attempts[0].effect_seen is True
    assert report.question is None
    assert report.final_frame == b"good"


def test_retry_only_failed_step_preserves_progress() -> None:
    stage = Stage([b"bad", b"good"])
    earlier = []

    report = recover_step(
        "click save", stage.action, lambda frame: frame == b"good",
        observer=stage.observe, progress=("open app",),
    )

    assert report.recovered is True
    assert len(report.attempts) == 2
    assert report.attempts[0].effect_seen is False
    assert report.progress == ("open app",)
    assert earlier == []
    assert stage.action_runs == 2
    assert [call[0] for call in stage.calls] == ["act", "see", "act", "see"]


def test_relocated_retry_succeeds_after_move() -> None:
    stage = Stage([b"stale", b"fresh"])

    def check(frame):
        return frame == b"fresh" and stage.position == "new"

    report = recover_step(
        "click moved button", stage.action, check,
        observer=stage.observe, refresh=stage.refresh,
    )

    assert report.recovered is True
    assert stage.refresh_runs == 1
    assert report.attempts[1].outcome == "ran-2-at-new"


def test_exhaustion_asks_specific_question_with_progress() -> None:
    stage = Stage([b"bad", b"bad"])

    report = recover_step(
        "click save", stage.action, lambda frame: False,
        observer=stage.observe, progress=("open app", "type text"),
        max_attempts=2,
    )

    assert report.recovered is False
    assert len(report.attempts) == 2
    assert report.progress == ("open app", "type text")
    assert "click save" in report.question
    assert "2 attempts" in report.question
    assert "open app" in report.question
    assert report.final_frame == b"bad"


def test_invalid_inputs_rejected_without_acting() -> None:
    stage = Stage([b"good"])

    with pytest.raises(RecoveryError):
        recover_step("", stage.action, lambda frame: True,
                     observer=stage.observe)
    with pytest.raises(RecoveryError):
        recover_step("step", "not-callable", lambda frame: True,
                     observer=stage.observe)
    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, "not-callable",
                     observer=stage.observe)
    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, lambda frame: True,
                     observer=stage.observe, max_attempts=0)
    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, lambda frame: True,
                     observer=stage.observe, max_attempts=True)

    assert stage.calls == []


def test_action_error_retried_then_reported() -> None:
    stage = Stage([b"bad", b"good"], fail_actions={1})

    report = recover_step(
        "click save", stage.action, lambda frame: frame == b"good",
        observer=stage.observe, max_attempts=3,
    )

    assert report.recovered is True
    assert "transient slip" in report.attempts[0].note

    stuck = Stage([b"bad"], fail_actions={1, 2})
    failed = recover_step(
        "click save", stuck.action, lambda frame: False,
        observer=stuck.observe, max_attempts=2,
    )

    assert failed.recovered is False
    assert "transient slip" in failed.question


def test_observer_failure_cause_preserved() -> None:
    def blind():
        raise OSError("lens cap on")

    stage = Stage([b"unused"])

    report = recover_step(
        "click save", stage.action, lambda frame: True,
        observer=blind, max_attempts=2,
    )

    assert report.recovered is False
    assert len(report.attempts) == 2
    assert all("lens cap on" in attempt.note for attempt in report.attempts)
    assert "lens cap on" in report.question


def test_unprintable_observer_cause_rendered_safely() -> None:
    class HostileError(OSError):
        def __str__(self):
            raise OSError("no print")

    def blind():
        raise HostileError("hidden")

    stage = Stage([b"unused"])

    report = recover_step(
        "click save", stage.action, lambda frame: True,
        observer=blind, max_attempts=1,
    )

    assert "unprintable" in report.attempts[0].note
    assert "unprintable" in report.question


def test_scalar_and_blank_progress_rejected() -> None:
    stage = Stage([b"good"])

    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, lambda frame: True,
                     observer=stage.observe, progress="open app")
    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, lambda frame: True,
                     observer=stage.observe, progress=("open app", "  "))
    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, lambda frame: True,
                     observer=stage.observe, progress=("",))

    assert stage.calls == []


def test_non_callable_observer_rejected_before_acting() -> None:
    stage = Stage([b"good"])

    with pytest.raises(RecoveryError):
        recover_step("step", stage.action, lambda frame: True,
                     observer="not-callable")

    assert stage.calls == []
    assert stage.action_runs == 0


def test_released_memoryview_cause_preserved() -> None:
    broken = memoryview(b"abc")
    broken.release()
    stage = Stage([broken])

    report = recover_step(
        "click save", stage.action, lambda frame: True,
        observer=stage.observe, max_attempts=1,
    )

    assert report.recovered is False
    assert "fresh capture failed" in report.attempts[0].note
    assert "fresh capture failed" in report.question


def test_delivered_text_without_acceptance_is_not_replayed() -> None:
    from types import SimpleNamespace
    from computer_use.keyboard import TypeResult

    calls = []
    result = TypeResult(
        text="draft",
        typed="draft",
        acceptance=SimpleNamespace(satisfied=False, committed=None),
    )
    report = recover_step(
        "enter draft",
        lambda: calls.append("typed") or result,
        lambda frame: True,
        observer=lambda: b"fresh",
        max_attempts=3,
    )

    assert report.recovered is False
    assert calls == ["typed"]
    assert "acceptance" in report.question


def test_live_recovery_is_immediate() -> None:
    from computer_use.keyboard import press_key

    report = recover_step(
        "press escape", lambda: press_key("escape"),
        lambda frame: len(frame) > 0,
    )

    assert report.recovered is True
    assert len(report.attempts) == 1


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
