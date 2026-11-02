"""Screen capture and pointer position behavior (T002).

The agent must see the current screen with known dimensions and know where
the pointer is, in one shared pixel space. Capture backends are injectable
so unit tests stay hermetic; live tests prove the real machine path.
"""

from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from computer_use import bootstrap
from computer_use.screen import (
    CaptureError,
    PointerError,
    capture_screen,
    find_screen,
    list_screens,
    pointer_position,
)


class FakeShooter:
    """Stand-in capture backend with scripted monitors and pixels."""

    def __init__(
        self, monitors, rgb=b"\x01\x02\x03", fail_with=None,
        shot_size=None, shot_rgb="auto",
    ):
        self._monitors = monitors
        self._rgb = rgb
        self._fail_with = fail_with
        self._shot_size = shot_size
        self._shot_rgb = shot_rgb
        self.grabs = []

    def monitors(self):
        return self._monitors

    def grab(self, monitor):
        self.grabs.append(dict(monitor))
        if self._fail_with is not None:
            raise self._fail_with
        width = monitor["width"]
        height = monitor["height"]
        size = self._shot_size or (width, height)
        rgb = self._rgb * size[0] * size[1] if self._shot_rgb == "auto" else self._shot_rgb
        return SimpleNamespace(size=size, rgb=rgb)


class FakeController:
    """Stand-in pointer backend with a scripted position."""

    def __init__(self, position=(10.0, 20.0), fail_with=None):
        self._position = position
        self._fail_with = fail_with
        self.reads = 0

    def position(self):
        self.reads += 1
        if self._fail_with is not None:
            raise self._fail_with
        return self._position


def two_monitor_layout():
    return [
        {"left": 0, "top": 0, "width": 3840, "height": 1080},
        {"left": 0, "top": 0, "width": 1920, "height": 1080},
        {"left": 1920, "top": 0, "width": 1920, "height": 1080},
    ]


def test_list_screens_skips_combined_monitor_and_maps_geometry() -> None:
    screens = list_screens(FakeShooter(two_monitor_layout()))

    assert [(s.index, s.left, s.top, s.width, s.height) for s in screens] == [
        (1, 0, 0, 1920, 1080),
        (2, 1920, 0, 1920, 1080),
    ]


def test_capture_returns_rgb_image_sized_to_the_screen() -> None:
    capture = capture_screen(2, FakeShooter(two_monitor_layout()))

    assert capture.screen.index == 2
    assert capture.image.mode == "RGB"
    assert capture.image.size == (1920, 1080)


def test_capture_of_unknown_screen_names_the_valid_range() -> None:
    with pytest.raises(CaptureError, match="1.*2"):
        capture_screen(7, FakeShooter(two_monitor_layout()))


def test_extreme_unknown_screen_id_reports_capture_error() -> None:
    with pytest.raises(CaptureError, match="valid screens"):
        capture_screen(10**100000, FakeShooter(two_monitor_layout()))


def test_unhashable_screen_id_reports_capture_error() -> None:
    with pytest.raises(CaptureError, match="valid screens"):
        capture_screen(["1"], FakeShooter(two_monitor_layout()))


def test_capture_backend_failure_reports_explicitly() -> None:
    shooter = FakeShooter(
        two_monitor_layout(), fail_with=OSError("display gone")
    )

    with pytest.raises(CaptureError, match="display gone"):
        capture_screen(1, shooter)


def test_malformed_monitor_metadata_reports_capture_error() -> None:
    broken = [
        {"left": 0, "top": 0, "width": 3840, "height": 1080},
        {"left": 0, "top": 0},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


def test_non_positive_monitor_geometry_reports_capture_error() -> None:
    broken = [
        {"left": 0, "top": 0, "width": 3840, "height": 1080},
        {"left": 0, "top": 0, "width": 0, "height": 1080},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


@pytest.mark.parametrize("bad_width", ["1920", None, True, float("nan")])
def test_non_numeric_monitor_geometry_reports_capture_error(bad_width) -> None:
    broken = [
        {"left": 0, "top": 0, "width": 1920, "height": 1080},
        {"left": 0, "top": 0, "width": bad_width, "height": 1080},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


class HostileRepr:
    """Backend value whose representation itself fails."""

    def __repr__(self):
        raise RuntimeError("repr gone")


class HostileFormat(float):
    """Finite backend number whose formatting itself fails."""

    def __format__(self, spec):
        raise RuntimeError("format gone")


def test_hostile_monitor_value_reports_capture_error() -> None:
    broken = [
        {"left": 0, "top": 0, "width": 1920, "height": 1080},
        {"left": 0, "top": 0, "width": HostileRepr(), "height": 1080},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


def test_hostile_format_geometry_reports_capture_error() -> None:
    broken = [
        {"left": 0, "top": 0, "width": 1920, "height": 1080},
        {"left": 0, "top": 0, "width": HostileFormat(-5.0), "height": 1080},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


def small_layout():
    return [
        {"left": 0, "top": 0, "width": 100, "height": 80},
        {"left": 0, "top": 0, "width": 100, "height": 80},
    ]


def test_mismatched_payload_dimensions_report_capture_error() -> None:
    shooter = FakeShooter(small_layout(), shot_size=(1, 1))

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, shooter)


def test_short_pixel_buffer_reports_capture_error() -> None:
    class ShortBufferShooter(FakeShooter):
        def grab(self, monitor):
            shot = super().grab(monitor)
            return SimpleNamespace(size=shot.size, rgb=b"\x00" * 3)

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, ShortBufferShooter(small_layout()))


def tiny_layout():
    return [
        {"left": 0, "top": 0, "width": 1, "height": 1},
        {"left": 0, "top": 0, "width": 1, "height": 1},
    ]


@pytest.mark.parametrize("bad_dim", [1.5, True, "1"])
def test_lossy_shot_dimensions_report_capture_error(bad_dim) -> None:
    shooter = FakeShooter(
        tiny_layout(), shot_size=(bad_dim, 1), shot_rgb=b"\x00\x01\x02"
    )

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, shooter)


def test_hostile_shot_dimension_reports_capture_error() -> None:
    shooter = FakeShooter(
        tiny_layout(),
        shot_size=(HostileRepr(), 1),
        shot_rgb=b"\x00\x01\x02",
    )

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, shooter)


def test_hostile_format_screen_reports_capture_error() -> None:
    monitors = [
        {"left": 0, "top": 0, "width": 100, "height": 80},
        {
            "left": 0,
            "top": 0,
            "width": HostileFormat(100.0),
            "height": 80,
        },
    ]
    shooter = FakeShooter(
        monitors, shot_size=(1, 1), shot_rgb=b"\x00\x01\x02"
    )

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, shooter)


def test_integer_rgb_payload_reports_capture_error() -> None:
    shooter = FakeShooter(tiny_layout(), shot_rgb=3)

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, shooter)


@pytest.mark.parametrize(
    "huge_dim", [10**100000, -(10**100000)], ids=["positive", "negative"]
)
def test_extreme_shot_dimensions_report_capture_error(huge_dim) -> None:
    shooter = FakeShooter(
        small_layout(), shot_size=(huge_dim, 80), shot_rgb=b"\x00\x01\x02"
    )

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, shooter)


def test_huge_integer_geometry_reports_capture_error() -> None:
    broken = [
        {"left": 0, "top": 0, "width": 1920, "height": 1080},
        {"left": 0, "top": 0, "width": 10**1000, "height": 1080},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


def test_exploding_numeric_geometry_reports_capture_error() -> None:
    class ExplodingFloat(float):
        def __float__(self):
            raise RuntimeError("conversion gone")

    broken = [
        {"left": 0, "top": 0, "width": 1920, "height": 1080},
        {"left": 0, "top": 0, "width": ExplodingFloat(100.0), "height": 80},
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(broken))


def test_failing_monitor_iteration_reports_capture_error() -> None:
    class ExplodingMonitors(FakeShooter):
        def monitors(self):
            yield {"left": 0, "top": 0, "width": 100, "height": 80}
            raise RuntimeError("enumeration gone")

    with pytest.raises(CaptureError, match="enumeration gone"):
        list_screens(ExplodingMonitors(small_layout()))


def test_failing_monitor_mapping_reports_capture_error() -> None:
    class ExplodingMapping:
        def __getitem__(self, key):
            raise RuntimeError("mapping gone")

    monitors = [
        {"left": 0, "top": 0, "width": 100, "height": 80},
        ExplodingMapping(),
    ]

    with pytest.raises(CaptureError, match="1"):
        list_screens(FakeShooter(monitors))


def test_truncated_shot_size_reports_capture_error() -> None:
    class TruncatedShooter(FakeShooter):
        def grab(self, monitor):
            return SimpleNamespace(size=(100,), rgb=b"\x00" * 3)

    with pytest.raises(CaptureError, match="1"):
        capture_screen(1, TruncatedShooter(small_layout()))


def test_unreadable_pixel_stream_reports_capture_error() -> None:
    class ExplodingShot:
        size = (100, 80)

        @property
        def rgb(self):
            raise OSError("stream gone")

    class ExplodingShooter(FakeShooter):
        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            return ExplodingShot()

    with pytest.raises(CaptureError, match="stream gone"):
        capture_screen(1, ExplodingShooter(small_layout()))


def test_exploding_shot_size_reports_capture_error() -> None:
    class SizeExplodingShot:
        @property
        def size(self):
            raise RuntimeError("size gone")

        rgb = b"\x00" * 3

    class SizeExplodingShooter(FakeShooter):
        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            return SizeExplodingShot()

    with pytest.raises(CaptureError, match="size gone"):
        capture_screen(1, SizeExplodingShooter(small_layout()))


def test_exploding_rgb_reports_capture_error() -> None:
    class RgbExplodingShot:
        size = (100, 80)

        @property
        def rgb(self):
            raise RuntimeError("pixels gone")

    class RgbExplodingShooter(FakeShooter):
        def grab(self, monitor):
            self.grabs.append(dict(monitor))
            return RgbExplodingShot()

    with pytest.raises(CaptureError, match="pixels gone"):
        capture_screen(1, RgbExplodingShooter(small_layout()))


def test_pointer_returns_the_controller_position() -> None:
    pointer = pointer_position(FakeController((321.5, 654.25)))

    assert (pointer.x, pointer.y) == (321.5, 654.25)


def test_pointer_backend_failure_reports_instead_of_guessing() -> None:
    controller = FakeController(fail_with=OSError("no permission"))

    with pytest.raises(PointerError, match="no permission"):
        pointer_position(controller)
    with pytest.raises(PointerError, match="no permission"):
        pointer_position(controller)
    assert controller.reads == 2


@pytest.mark.parametrize(
    "bad_position", [None, ("left", "top"), (float("nan"), 10.0), (10.0,)],
)
def test_malformed_pointer_result_reports_pointer_error(bad_position) -> None:
    with pytest.raises(PointerError):
        pointer_position(FakeController(bad_position))


def test_huge_integer_pointer_reports_pointer_error() -> None:
    with pytest.raises(PointerError):
        pointer_position(FakeController((10**1000, 5)))


def test_failing_pointer_iteration_reports_pointer_error() -> None:
    def explode():
        raise OSError("iter gone")
        yield  # pragma: no cover - makes this a generator

    with pytest.raises(PointerError, match="iter gone"):
        pointer_position(FakeController(explode()))


def test_find_screen_locates_offset_and_outside_positions() -> None:
    screens = list_screens(FakeShooter(two_monitor_layout()))

    assert find_screen(screens, 100, 100).index == 1
    assert find_screen(screens, 2000, 500).index == 2
    assert find_screen(screens, 5000, 500) is None


def test_live_capture_matches_a_listed_screen() -> None:
    screens = list_screens()
    assert len(screens) >= 1

    capture = capture_screen(screens[0].index)

    assert capture.image.mode == "RGB"
    assert capture.image.size == (capture.screen.width, capture.screen.height)
    assert len(capture.image.tobytes()) == (
        capture.screen.width * capture.screen.height * 3
    )


def test_live_pointer_sits_inside_a_listed_screen() -> None:
    screens = list_screens()
    pointer = pointer_position()

    assert find_screen(screens, pointer.x, pointer.y) is not None


def test_default_required_packages_cover_capture_and_pointer(tmp_path) -> None:
    modules = {module for _, module in bootstrap.REQUIRED_PACKAGES}

    assert {"mss", "PIL", "pynput"} <= modules

    runtime = bootstrap.ensure_environment(tmp_path)

    check = (
        "import mss, PIL, pynput; print('deps-ok')"
    )
    import subprocess

    completed = subprocess.run(
        [str(runtime.python), "-c", check],
        check=True,
        text=True,
        capture_output=True,
        timeout=300,
    )
    assert completed.stdout.strip() == "deps-ok"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
