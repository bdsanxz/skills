"""Coordinate reference overlay behavior (T003).

Positions must be read from the image, never estimated. The skill provides
the original capture alongside a reference copy carrying a labeled grid in
the same pixel space, zooming in when a full-screen grid would be unreadable.
"""

from __future__ import annotations

import sys

import pytest
from PIL import Image

from computer_use.grid import (
    ReferenceError,
    choose_step,
    prepare_reference,
    to_screen,
    zoom_region,
)
from computer_use.screen import Capture, Screen


def solid(width, height, color=(128, 128, 128)):
    return Image.new("RGB", (width, height), color)


def fake_capture(width, height):
    screen = Screen(index=1, left=0, top=0, width=width, height=height)
    return Capture(image=solid(width, height), screen=screen)


def non_background_count(image, column=None, row=None):
    pixels = image.load()
    width, height = image.size
    count = 0
    if column is not None:
        for y in range(height):
            if pixels[column, y] != (128, 128, 128):
                count += 1
    if row is not None:
        for x in range(width):
            if pixels[x, row] != (128, 128, 128):
                count += 1
    return count


def test_overlay_preserves_size_mode_and_original() -> None:
    capture = fake_capture(800, 600)
    before = capture.image.tobytes()

    reference = prepare_reference(capture)

    assert reference.kind == "full"
    assert reference.image.size == (800, 600)
    assert reference.image.mode == "RGB"
    assert capture.image.tobytes() == before
    assert reference.original.tobytes() == before


def test_grid_lines_land_on_step_multiples() -> None:
    reference = prepare_reference(fake_capture(800, 600))
    step = reference.step

    assert step >= 40
    assert non_background_count(reference.image, column=step) > 100
    assert non_background_count(reference.image, row=step) > 100


def test_step_keeps_column_counts_readable() -> None:
    for width in (400, 800, 1470, 3840):
        step = choose_step(width)
        columns = width // step

        assert step >= 40
        assert 8 <= columns <= 16


def test_small_image_falls_back_to_zoomed_reference() -> None:
    reference = prepare_reference(fake_capture(200, 150))

    assert reference.kind == "zoom"
    assert reference.image.size == (100, 75)
    assert to_screen(0, 0, reference.offset) == reference.offset
    assert to_screen(10, 20, reference.offset) == (
        reference.offset[0] + 10,
        reference.offset[1] + 20,
    )
    assert non_background_count(reference.image, column=reference.step) > 10


def test_tiny_image_reports_no_readable_reference() -> None:
    with pytest.raises(ReferenceError):
        prepare_reference(fake_capture(50, 40))


@pytest.mark.parametrize("size", [(100, 75), (101, 76)])
def test_minimum_zoom_source_without_readable_grid_reports_error(size) -> None:
    with pytest.raises(ReferenceError):
        prepare_reference(fake_capture(*size))


@pytest.mark.parametrize("size", [(100, 300), (300, 100)])
def test_clipped_label_zoom_source_reports_error(size) -> None:
    with pytest.raises(ReferenceError):
        prepare_reference(fake_capture(*size))


@pytest.mark.parametrize("size", [(112, 200), (300, 104)])
def test_stroked_label_zoom_source_reports_error(size) -> None:
    with pytest.raises(ReferenceError):
        prepare_reference(fake_capture(*size))


def test_readable_zoom_boundary_still_zooms() -> None:
    reference = prepare_reference(fake_capture(160, 160))

    assert reference.kind == "zoom"
    assert reference.image.size == (80, 80)


def test_zoom_region_clamps_to_image_bounds() -> None:
    image = solid(100, 80)

    crop, offset = zoom_region(image, (-50, -50, 200, 200))

    assert crop.size == (100, 80)
    assert offset == (0, 0)


def test_fully_outside_zoom_region_reports_an_error() -> None:
    with pytest.raises(ReferenceError):
        zoom_region(solid(100, 80), (500, 500, 10, 10))


def test_infinite_zoom_region_reports_an_error() -> None:
    with pytest.raises(ReferenceError):
        zoom_region(solid(100, 80), (float("inf"), 0, 10, 10))
    with pytest.raises(ReferenceError):
        zoom_region(solid(100, 80), (0, 0, float("inf"), 10))


def test_extreme_zoom_region_reports_an_error() -> None:
    with pytest.raises(ReferenceError):
        zoom_region(solid(100, 80), (10**100000, 0, 10, 10))


def test_full_reference_maps_coordinates_identically() -> None:
    reference = prepare_reference(fake_capture(800, 600))

    assert reference.offset == (0, 0)
    assert to_screen(123, 456, reference.offset) == (123, 456)


def test_live_capture_gets_a_full_size_reference(tmp_path) -> None:
    from computer_use.screen import capture_screen, list_screens

    screens = list_screens()
    reference = prepare_reference(capture_screen(screens[0].index))

    assert reference.kind == "full"
    assert reference.image.size == (
        reference.original.size[0],
        reference.original.size[1],
    )
    out = tmp_path / "reference.png"
    reference.image.save(out)
    assert Image.open(out).size == reference.image.size


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
