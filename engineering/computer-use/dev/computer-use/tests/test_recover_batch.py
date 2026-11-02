"""Progress-preserving recovery for partial batches (T011)."""

from __future__ import annotations

from computer_use.batch import BatchAction
from computer_use.recovery import BatchRecoveryReport, recover_batch


def test_partial_batch_retries_only_the_unresolved_action():
    calls = []
    attempts = {"second": 0}
    frames = iter([b"a", b"b", b"c", b"d", b"e", b"f"])

    def first():
        calls.append("first")
        return True

    def second():
        attempts["second"] += 1
        calls.append("second")
        return attempts["second"] > 1

    def third():
        calls.append("third")
        return True

    report = recover_batch(
        [
            ("first", first),
            ("second", second),
            ("third", third),
        ],
        observer=lambda: next(frames),
        refresh=lambda: calls.append("refresh"),
        max_attempts=3,
    )

    assert isinstance(report, BatchRecoveryReport)
    assert report.recovered is True
    assert calls == ["first", "second", "refresh", "second", "refresh", "third"]
    assert report.progress == ("first", "second", "third")
    assert report.question is None
    assert len(report.attempts) == 3


def test_recovery_exhaustion_keeps_progress_and_asks_specific_question():
    calls = []
    frames = iter([b"a", b"b", b"c", b"d"])

    report = recover_batch(
        [
            ("already done", lambda: calls.append("done") or True),
            ("stuck", lambda: calls.append("stuck") or False),
            BatchAction("dependent", lambda: calls.append("dependent") or True),
        ],
        observer=lambda: next(frames),
        max_attempts=2,
    )

    assert report.recovered is False
    assert calls == ["done", "stuck", "stuck"]
    assert report.progress == ("already done",)
    assert report.unresolved == "stuck"
    assert "stuck" in report.question
    assert "already done" in report.question
    assert report.final_observation == b"d"


def test_batch_effect_timeout_retries_only_the_last_unverified_action():
    calls = []
    frames = iter([b"a", b"same", b"c", b"changed"])
    checks = iter([False, True])

    report = recover_batch(
        [
            ("first", lambda: calls.append("first") or True),
            ("second", lambda: calls.append("second") or True),
        ],
        observer=lambda: next(frames),
        check=lambda frame: next(checks),
        max_attempts=2,
    )

    assert report.recovered is True
    assert calls == ["first", "second", "second"]
    assert report.progress == ("first", "second")


def test_post_observation_failure_preserves_the_last_usable_sample():
    frames = iter([b"start"])
    report = recover_batch(
        [("action", lambda: True)],
        observer=lambda: next(frames),
        max_attempts=1,
    )

    assert report.recovered is False
    assert report.final_observation == b"start"
    assert report.progress == ()
    assert report.unresolved == "action"


def test_refresh_failure_never_replays_confirmed_actions():
    calls = []
    frames = iter([b"a", b"b"])

    report = recover_batch(
        [("confirmed", lambda: calls.append("confirmed") or False)],
        observer=lambda: next(frames),
        refresh=lambda: (_ for _ in ()).throw(OSError("focus unavailable")),
        max_attempts=2,
    )

    assert report.recovered is False
    assert calls == ["confirmed"]
    assert "focus unavailable" in report.question
