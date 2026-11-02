"""Semantic bounded waits for a changed bounded region (T008)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from computer_use.conditions import RegionChangeResult, wait_for_region_change
from computer_use.region import capture_region


class Shooter:
    def __init__(self, frames):
        self.frames = list(frames)

    def monitors(self):
        return [
            {"left": 0, "top": 0, "width": 20, "height": 20},
            {"left": 0, "top": 0, "width": 20, "height": 20},
        ]

    def grab(self, monitor):
        frame = self.frames.pop(0) if self.frames else b"a"
        width, height = monitor["width"], monitor["height"]
        return SimpleNamespace(
            size=(width, height),
            rgb=frame * (width * height * 3),
        )


def make_region(shooter):
    return capture_region(1, (2, 3, 5, 4), shooter=shooter)


def test_region_wait_accepts_a_raw_baseline_with_an_explicit_context():
    region = make_region(Shooter([b"a"]))

    result = wait_for_region_change(
        b"before",
        observer=lambda: b"after",
        context=region.context,
        timeout=0,
        poll_interval=0,
    )

    assert result.status == "changed"
    assert result.changed is True
    assert result.context == region.context


def test_region_wait_reports_changed_with_latest_bounded_evidence():
    region = make_region(Shooter([b"a", b"a", b"b"]))

    result = wait_for_region_change(region, timeout=1, poll_interval=0)

    assert isinstance(result, RegionChangeResult)
    assert result.status == "changed"
    assert result.changed is True
    assert result.satisfied is True
    assert result.latest.image.size == (5, 4)
    assert result.context == region.context


def test_region_wait_distinguishes_unchanged_timeout():
    region = make_region(Shooter([b"a", b"a"]))

    result = wait_for_region_change(
        region, timeout=0, poll_interval=0, timeout_status="unchanged",
    )

    assert result.status == "unchanged"
    assert result.changed is False
    assert result.satisfied is False
    assert result.latest.image.size == (5, 4)


def test_region_wait_reports_timeout_without_claiming_change():
    region = make_region(Shooter([b"a", b"a"]))

    result = wait_for_region_change(region, timeout=0, poll_interval=0)

    assert result.status == "timed_out"
    assert result.changed is False
    assert result.satisfied is False


def test_region_wait_reports_unavailable_sample_separately():
    region = make_region(Shooter([b"a"]))

    result = wait_for_region_change(
        region, observer=lambda: (_ for _ in ()).throw(OSError("capture gone")),
        timeout=0, poll_interval=0,
    )

    assert result.status == "unavailable"
    assert result.changed is None
    assert "capture gone" in result.evidence


def test_region_wait_stops_on_stale_context():
    region = make_region(Shooter([b"a"]))
    stale = region.context.invalidate()

    result = wait_for_region_change(region, context=stale, timeout=0)

    assert result.status == "unavailable"
    assert result.context_invalidated is True
    assert "stale" in result.evidence.lower()


def test_malformed_sample_is_not_treated_as_unchanged():
    region = make_region(Shooter([b"a"]))

    result = wait_for_region_change(
        region, observer=lambda: b"", timeout=0, poll_interval=0,
    )

    assert result.status == "unavailable"
    assert result.changed is None
