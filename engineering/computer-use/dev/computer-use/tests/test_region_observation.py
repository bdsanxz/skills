"""Bounded native-resolution region observations (T005)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from computer_use.screen import Capture, Screen
from computer_use.region import RegionCapture, RegionCaptureError, capture_region


class RegionShooter:
    def __init__(self, monitors):
        self._monitors = monitors
        self.grabs = []
        self.frames = [b"a", b"b"]

    def monitors(self):
        return self._monitors

    def grab(self, monitor):
        request = dict(monitor)
        self.grabs.append(request)
        width, height = request["width"], request["height"]
        payload = self.frames.pop(0) if self.frames else b"b"
        return SimpleNamespace(
            size=(width, height),
            rgb=payload * (width * height * 3),
        )


def layout():
    return [
        {"left": -200, "top": 0, "width": 400, "height": 100},
        {"left": 0, "top": 0, "width": 100, "height": 80},
        {"left": -200, "top": 20, "width": 100, "height": 80},
        {"left": 100, "top": 0, "width": 100, "height": 80},
    ]


def test_region_returns_native_image_and_mapping_context():
    shooter = RegionShooter(layout())

    result = capture_region(1, (10, 5, 20, 10), shooter=shooter)

    assert isinstance(result, RegionCapture)
    assert result.screen.index == 1
    assert result.image.size == (20, 10)
    assert result.origin == (10, 5)
    assert result.desktop_origin == (10, 5)
    assert result.size == (20, 10)
    assert result.scale == (1.0, 1.0)
    assert result.context.to_desktop(0, 0).x == 10
    assert shooter.grabs == [{"left": 10, "top": 5, "width": 20, "height": 10}]


def test_partial_region_is_clipped_and_reports_actual_bounds():
    shooter = RegionShooter(layout())

    result = capture_region(1, (90, 70, 30, 30), shooter=shooter)

    assert result.origin == (90, 70)
    assert result.size == (10, 10)
    assert result.clipped is True
    assert shooter.grabs[-1] == {
        "left": 90, "top": 70, "width": 10, "height": 10,
    }


def test_desktop_region_preserves_negative_monitor_origin():
    shooter = RegionShooter(layout())

    result = capture_region(
        2, (-190, 30, 20, 15), shooter=shooter, space="desktop",
    )

    assert result.desktop_origin == (-190, 30)
    assert result.origin == (10, 10)
    assert result.context.to_desktop(0, 0).x == -190


def test_wholly_outside_or_invalid_region_is_rejected_without_grab():
    shooter = RegionShooter(layout())

    for box in ((500, 500, 10, 10), (0, 0, 0, 5), (0, 0, -1, 5)):
        with pytest.raises(RegionCaptureError):
            capture_region(1, box, shooter=shooter)

    assert shooter.grabs == []


def test_region_observer_reuses_context_and_captures_only_the_region():
    shooter = RegionShooter(layout())
    region = capture_region(1, (10, 5, 20, 10), shooter=shooter)

    before = region.observe()
    after = region.observe()

    assert before.image.size == (20, 10)
    assert after.image.size == (20, 10)
    assert before.context == region.context
    assert after.context == region.context
    assert len(shooter.grabs) == 3
    assert all(request["width"] == 20 and request["height"] == 10
               for request in shooter.grabs)


def test_malformed_source_capture_is_reported_as_region_error():
    class BadImage:
        size = (100, 80)

        def crop(self, box):
            raise OSError("crop failed")

    source = Capture(
        image=BadImage(),
        screen=Screen(index=1, left=0, top=0, width=100, height=80),
    )

    with pytest.raises(RegionCaptureError, match="crop failed|unusable"):
        capture_region(source, (1, 1, 5, 5))


def test_stale_context_is_rejected_before_a_region_grab():
    shooter = RegionShooter(layout())
    initial = capture_region(1, (5, 6, 7, 8), shooter=shooter)

    with pytest.raises(RegionCaptureError, match="stale|invalid"):
        capture_region(
            1, (5, 6, 7, 8), shooter=shooter,
            context=initial.context.invalidate(),
        )

    assert len(shooter.grabs) == 1


def test_failed_bounded_capture_does_not_fallback_without_opt_in():
    class Broken(RegionShooter):
        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            raise OSError("region bridge missing")

    shooter = Broken(layout())

    with pytest.raises(RegionCaptureError, match="unavailable|fallback"):
        capture_region(1, (5, 6, 7, 8), shooter=shooter)

    assert len(shooter.grabs) == 1


def test_full_screen_fallback_is_explicitly_labeled():
    class RegionOnlyBroken(RegionShooter):
        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            if monitor["width"] < 100 or monitor["height"] < 80:
                raise OSError("bounded capture unavailable")
            return SimpleNamespace(
                size=(monitor["width"], monitor["height"]),
                rgb=b"z" * (monitor["width"] * monitor["height"] * 3),
            )

    shooter = RegionOnlyBroken(layout())
    result = capture_region(
        1, (5, 6, 7, 8), shooter=shooter, fallback_full_screen=True,
    )

    assert result.fallback is True
    assert "full-screen fallback" in result.note
    assert result.image.size == (7, 8)
    assert len(shooter.grabs) == 2


def test_region_can_be_reused_with_a_supplied_screen_record():
    shooter = RegionShooter(layout())
    screen = Screen(index=1, left=0, top=0, width=100, height=80)

    result = capture_region(screen, (5, 6, 7, 8), shooter=shooter)

    assert result.screen == screen
    assert result.image.size == (7, 8)
