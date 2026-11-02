"""Verifying every step by re-observing (T008) — strict TDD Red.

Covers: post-action observation ordering, inconclusive reporting when
captures are blocked, action-failure propagation without observing,
per-step Grade 2 sequencing with summary, mid-sequence blindness, and
non-bytes observations, plus a live single-step check.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.verify import run_sequence, verify_step


class Recorder:
    """Scripted actions and observations recording their call order."""

    def __init__(self, frames, blind_from=None):
        self._frames = list(frames)
        self._blind_from = blind_from
        self.calls = []
        self.sees = 0

    def act(self, label):
        def action():
            self.calls.append(("act", label))
            return f"did-{label}"

        return action

    def observe(self):
        self.sees += 1
        self.calls.append(("see", self.sees))
        if self._blind_from is not None and self.sees >= self._blind_from:
            raise OSError("lens cap on")
        return self._frames.pop(0)


def test_step_observes_after_action_in_order() -> None:
    rec = Recorder([b"post"])

    step = verify_step("click OK", rec.act("click"), observer=rec.observe)

    assert rec.calls == [("act", "click"), ("see", 1)]
    assert step.description == "click OK"
    assert step.outcome == "did-click"
    assert step.frame == b"post"
    assert step.verified is True


def test_blocked_capture_reports_inconclusive() -> None:
    rec = Recorder([], blind_from=1)

    step = verify_step("scroll down", rec.act("scroll"), observer=rec.observe)

    assert step.outcome == "did-scroll"
    assert step.frame is None
    assert step.verified is False
    assert "lens cap on" in step.note


def test_action_failure_propagates_without_observing() -> None:
    rec = Recorder([b"unused"])

    def broken():
        raise ValueError("button missing")

    with pytest.raises(ValueError, match="button missing"):
        verify_step("click ghost", broken, observer=rec.observe)

    assert rec.calls == []


def test_sequence_verifies_each_step_before_next() -> None:
    rec = Recorder([b"opened", b"clicked", b"typed", b"saved", b"scrolled"])
    steps = [
        ("open app", rec.act("open")),
        ("click field", rec.act("click")),
        ("type text", rec.act("type")),
        ("save", rec.act("save")),
        ("scroll", rec.act("scroll")),
    ]

    report = run_sequence(steps, observer=rec.observe)

    assert rec.calls == [
        ("act", "open"), ("see", 1),
        ("act", "click"), ("see", 2),
        ("act", "type"), ("see", 3),
        ("act", "save"), ("see", 4),
        ("act", "scroll"), ("see", 5),
    ]
    assert [step.frame for step in report.steps] == [
        b"opened", b"clicked", b"typed", b"saved", b"scrolled",
    ]
    assert all(step.verified for step in report.steps)
    assert report.all_verified is True
    assert report.final_frame == b"scrolled"
    for label in ("open app", "click field", "type text", "save", "scroll"):
        assert label in report.summary


def test_subclass_frame_normalized_to_exact_bytes() -> None:
    class SelfBytes(bytes):
        def __bytes__(self):
            return self

    rec = Recorder([SelfBytes(b"post")])

    step = verify_step("click OK", rec.act("click"), observer=rec.observe)

    assert step.verified is True
    assert type(step.frame) is bytes
    assert step.frame == b"post"


def test_sequence_stops_at_first_inconclusive() -> None:
    rec = Recorder([b"opened"], blind_from=2)
    steps = [
        ("open app", rec.act("open")),
        ("click field", rec.act("click")),
        ("type text", rec.act("type")),
    ]

    report = run_sequence(steps, observer=rec.observe)

    assert rec.calls == [("act", "open"), ("see", 1),
                         ("act", "click"), ("see", 2)]
    assert [step.description for step in report.steps] == [
        "open app", "click field",
    ]
    assert report.steps[0].verified is True
    assert report.steps[1].verified is False
    assert report.all_verified is False
    assert report.final_frame is None
    assert "click field" in report.summary


def test_empty_frame_payloads_are_inconclusive() -> None:
    rec = Recorder([b"", bytearray(), memoryview(b"")])

    for index in range(3):
        step = verify_step(f"step {index}", rec.act(f"a{index}"),
                           observer=rec.observe)

        assert step.verified is False
        assert step.frame is None
        assert "inconclusive" in step.note


def test_non_bytes_observation_is_inconclusive() -> None:
    rec = Recorder(["not-bytes"])

    step = verify_step("click OK", rec.act("click"), observer=rec.observe)

    assert step.verified is False
    assert step.frame is None


def test_live_single_step_is_verified() -> None:
    from computer_use.keyboard import press_key

    report = run_sequence([("press escape", lambda: press_key("escape"))])

    assert report.all_verified is True
    assert isinstance(report.final_frame, bytes)
    assert len(report.final_frame) > 0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
