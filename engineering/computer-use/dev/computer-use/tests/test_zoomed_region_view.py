"""Zoomed region views with full-screen mapping (T013).

A requested region returns a native-resolution crop plus its offset so
coordinates read from the crop still map to the full screen, and
out-of-bounds requests are rejected naming the valid bounds.
"""

from __future__ import annotations

from PIL import Image

import pytest

from computer_use.grid import ReferenceError, to_screen, zoom_region


def test_out_of_bounds_names_valid_bounds() -> None:
    image = Image.new("RGB", (200, 100))

    with pytest.raises(ReferenceError, match=r"200x100"):
        zoom_region(image, (500, 500, 10, 10))


def test_fully_negative_region_names_valid_bounds() -> None:
    image = Image.new("RGB", (200, 100))

    with pytest.raises(ReferenceError, match=r"200x100"):
        zoom_region(image, (-50, -50, 10, 10))


def test_crop_keeps_native_resolution() -> None:
    image = Image.new("RGB", (200, 100), (10, 20, 30))

    crop, offset = zoom_region(image, (20, 10, 60, 40))

    assert offset == (20, 10)
    assert crop.size == (60, 40)
    assert crop.tobytes() == image.crop((20, 10, 80, 50)).tobytes()


def test_crop_coordinates_map_to_full_screen() -> None:
    crop, offset = zoom_region(Image.new("RGB", (200, 100)), (20, 10, 60, 40))

    assert crop.size == (60, 40)
    assert to_screen(0, 0, offset) == (20, 10)
    assert to_screen(59, 39, offset) == (79, 49)
    assert to_screen(7.5, 2.5, offset) == (27.5, 12.5)


def test_clamped_region_reports_actual_offset() -> None:
    image = Image.new("RGB", (200, 100))

    crop, offset = zoom_region(image, (-10, -5, 50, 40))

    assert offset == (0, 0)
    assert crop.size == (40, 35)
    assert to_screen(39, 34, offset) == (39, 34)


def test_live_crop_point_drives_pointer_and_back() -> None:
    from computer_use import pointer
    from computer_use.screen import capture_screen, pointer_position

    capture = capture_screen(1)
    width, height = capture.image.size
    strip_height = min(120, height)
    _, offset = zoom_region(capture.image, (0, 0, width, strip_height))
    target = to_screen(width / 2, strip_height / 2, offset)

    start = pointer_position()
    try:
        pointer.move_to(*target)
        reached = pointer_position()
        assert abs(reached.x - target[0]) <= 5
        assert abs(reached.y - target[1]) <= 5
    finally:
        pointer.move_to(start.x, start.y)
