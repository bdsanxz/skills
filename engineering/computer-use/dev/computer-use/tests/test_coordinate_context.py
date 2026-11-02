"""Unified capture-to-desktop coordinate mapping (T004)."""

from __future__ import annotations

from PIL import Image
import pytest

from computer_use.coordinates import CoordinateContext as PublicCoordinateContext
from computer_use.grid import (
    CoordinateContext,
    CoordinateContextError,
    prepare_reference,
)
from computer_use.pointer import ActionError, drag_path, move_to
from computer_use.screen import Capture, Screen


class RecordingMouse:
    def __init__(self, position=(0, 0)):
        self.position_value = position
        self.moves = []

    def move_to(self, x, y):
        self.moves.append((x, y))
        self.position_value = (x, y)
        return self.position_value

    def position(self):
        return self.position_value


def capture(screen, size=None):
    image_size = size or (screen.width, screen.height)
    return Capture(Image.new("RGB", image_size), screen)


def test_coordinate_context_has_a_stable_public_module_alias():
    assert PublicCoordinateContext is CoordinateContext


def test_context_maps_crop_and_scale_through_screen_origin():
    screen = Screen(index=2, left=-1920, top=-100, width=800, height=600)
    context = CoordinateContext(
        screen=screen,
        capture_size=(800, 600),
        crop_offset=(100, 50),
        scale=(2.0, 1.5),
    )

    point = context.to_desktop(10, 20)

    assert (point.x, point.y) == (-1800.0, -20.0)
    assert point.screen == screen
    assert context.map_point(10, 20).capture == (120.0, 80.0)


def test_context_can_be_recovered_from_a_prepared_reference():
    source = capture(Screen(index=1, left=5, top=6, width=200, height=150))
    reference = prepare_reference(source)

    derived = CoordinateContext.from_reference(source, reference)

    assert derived == reference.context


def test_prepared_reference_carries_one_context_for_zoom_coordinates():
    screen = Screen(index=2, left=-100, top=40, width=200, height=150)
    reference = prepare_reference(capture(screen))

    point = reference.context.to_desktop(0, 0)

    assert point.screen == screen
    assert (point.x, point.y) == (
        screen.left + reference.offset[0],
        screen.top + reference.offset[1],
    )


def test_pointer_action_consumes_context_without_manual_arithmetic():
    screen = Screen(index=2, left=-100, top=40, width=200, height=150)
    context = CoordinateContext.for_capture(capture(screen))
    mouse = RecordingMouse()

    result = move_to(10, 20, controller=mouse, context=context)

    assert mouse.moves == [(-90.0, 60.0)]
    assert (result.position.x, result.position.y) == (-90.0, 60.0)


def test_context_rejects_points_outside_selected_screen():
    screen = Screen(index=1, left=10, top=20, width=100, height=80)
    context = CoordinateContext.for_capture(capture(screen))

    with pytest.raises(CoordinateContextError, match="outside"):
        context.to_desktop(100, 80)

    mouse = RecordingMouse()
    with pytest.raises(ActionError, match="outside|context"):
        move_to(100, 80, controller=mouse, context=context)
    assert mouse.moves == []


def test_non_context_mapping_object_is_rejected_as_an_action_error():
    with pytest.raises(ActionError, match="context"):
        move_to(10, 10, controller=RecordingMouse(), context=object())
    with pytest.raises(ActionError, match="context"):
        drag_path(
            [(10, 10), (20, 20)],
            controller=RecordingMouse(),
            observer=lambda: b"frame",
            context=object(),
        )


def test_stale_context_must_be_refreshed_before_pointer_action():
    screen = Screen(index=1, left=0, top=0, width=100, height=80)
    context = CoordinateContext.for_capture(capture(screen)).invalidate()

    with pytest.raises(CoordinateContextError, match="stale"):
        context.to_desktop(10, 10)

    with pytest.raises(ActionError, match="stale|context"):
        move_to(10, 10, controller=RecordingMouse(), context=context)


def test_context_validation_rejects_changed_layout():
    original = Screen(index=1, left=0, top=0, width=100, height=80)
    changed = Screen(index=1, left=50, top=0, width=100, height=80)
    context = CoordinateContext.for_capture(capture(original))

    with pytest.raises(CoordinateContextError, match="stale|changed"):
        context.validate(capture(changed))
