"""Pointer movement and click behavior (T004).

Moves and clicks land on requested visible targets, out-of-range requests
are rejected with the valid range, unsupported click types are reported
rather than replaced, and delivery failures name their cause.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.pointer import (
    ActionError,
    click,
    double_click,
    move_to,
    right_click,
)
from computer_use.screen import Screen


def single_screen():
    return (
        Screen(index=1, left=0, top=0, width=1920, height=1080),
    )


class FakeMouse:
    """Stand-in pointer backend recording moves and clicks."""

    def __init__(self, position=(0.0, 0.0), fail_with=None, drift=(0.0, 0.0)):
        self._position = position
        self._fail_with = fail_with
        self._drift = drift
        self.moves = []
        self.clicks = []

    def move_to(self, x, y):
        if self._fail_with is not None:
            raise self._fail_with
        self._position = (x + self._drift[0], y + self._drift[1])
        self.moves.append((x, y))
        return self._position

    def click(self, button, count):
        if self._fail_with is not None:
            raise self._fail_with
        self.clicks.append((button, count, self._position))
        return self.clicks[-1]

    def position(self):
        return self._position


class HostileValue:
    """Backend value hostile to comparison and representation."""

    def __eq__(self, other):
        raise RuntimeError("comparison gone")

    def __repr__(self):
        raise RuntimeError("repr gone")


class HostileError(Exception):
    """Backend failure hostile to string conversion."""

    def __str__(self):
        raise RuntimeError("str gone")


class SpoofButton:
    """Non-string claiming equality with every supported button."""

    def __eq__(self, other):
        return True

    def __ne__(self, other):
        return False

    def __hash__(self):
        return hash("spoof")

    def __repr__(self):
        return "spoof"


def test_spoofed_button_reports_unsupported() -> None:
    mouse = FakeMouse()

    with pytest.raises(ActionError, match="unsupported"):
        click(10.0, 10.0, button=SpoofButton(), controller=mouse)

    assert mouse.moves == []
    assert mouse.clicks == []


class FalseClickMouse(FakeMouse):
    def click(self, button, count):
        self.clicks.append((button, count, self._position))
        return False


def test_false_click_delivery_reports_an_error() -> None:
    with pytest.raises(ActionError, match="deliver"):
        click(10.0, 10.0, controller=FalseClickMouse())


def test_move_reports_the_requested_position() -> None:
    mouse = FakeMouse()

    result = move_to(321.0, 654.0, controller=mouse, screens=single_screen())

    assert (result.position.x, result.position.y) == (321.0, 654.0)
    assert mouse.moves == [(321.0, 654.0)]


def test_move_reports_the_backend_final_position() -> None:
    mouse = FakeMouse(drift=(1.0, 1.0))

    result = move_to(100.0, 200.0, controller=mouse)

    assert (result.position.x, result.position.y) == (101.0, 201.0)


def test_move_rejects_non_finite_backend_position() -> None:
    class NonFiniteMouse(FakeMouse):
        def move_to(self, x, y):
            self.moves.append((x, y))
            return (float("nan"), float("inf"))

    with pytest.raises(ActionError, match="undetermined"):
        move_to(10.0, 10.0, controller=NonFiniteMouse())


def test_click_reports_the_backend_final_position() -> None:
    mouse = FakeMouse(drift=(1.0, 0.0))

    result = click(100.0, 200.0, controller=mouse)

    assert (result.position.x, result.position.y) == (101.0, 200.0)


def test_click_missing_the_target_reports_actual_position() -> None:
    mouse = FakeMouse(drift=(30.0, 40.0))

    with pytest.raises(ActionError, match="130"):
        click(100.0, 200.0, controller=mouse)


def test_generator_screens_keep_the_valid_range() -> None:
    screens = (screen for screen in single_screen())

    with pytest.raises(ActionError, match="1919"):
        move_to(5000.0, 100.0, controller=FakeMouse(), screens=screens)


def test_extreme_button_reports_unsupported() -> None:
    mouse = FakeMouse()

    with pytest.raises(ActionError, match="unsupported"):
        click(10.0, 10.0, button=10**100000, controller=mouse)

    assert mouse.moves == []
    assert mouse.clicks == []


def test_hostile_button_reports_unsupported() -> None:
    mouse = FakeMouse()

    with pytest.raises(ActionError, match="unsupported"):
        click(10.0, 10.0, button=HostileValue(), controller=mouse)

    assert mouse.moves == []
    assert mouse.clicks == []


def test_hostile_coordinate_reports_an_error() -> None:
    with pytest.raises(ActionError):
        move_to(HostileValue(), 10.0, controller=FakeMouse())


def test_unprintable_backend_failure_reports_an_error() -> None:
    mouse = FakeMouse(fail_with=HostileError())

    with pytest.raises(ActionError):
        move_to(10.0, 10.0, controller=mouse)
    with pytest.raises(ActionError):
        click(10.0, 10.0, controller=mouse)


class FlipFloat(float):
    """Stateful number finite on first coercion, nan afterwards."""

    def __new__(cls, value):
        instance = super().__new__(cls, value)
        instance._coercions = 0
        return instance

    def __float__(self):
        self._coercions += 1
        if self._coercions == 1:
            return 1.0
        return float("nan")


def test_stateful_coordinate_uses_single_coercion() -> None:
    mouse = FakeMouse()

    result = move_to(FlipFloat(1.0), 10.0, controller=mouse)

    assert (result.position.x, result.position.y) == (1.0, 10.0)
    assert mouse.moves == [(1.0, 10.0)]


class StringMouse(FakeMouse):
    def move_to(self, x, y):
        self.moves.append((x, y))
        return "12"


def test_string_backend_position_reports_an_error() -> None:
    with pytest.raises(ActionError, match="undetermined"):
        move_to(10.0, 10.0, controller=StringMouse())


class BoolMouse(FakeMouse):
    def move_to(self, x, y):
        self.moves.append((x, y))
        return (True, False)


def test_boolean_backend_position_reports_an_error() -> None:
    with pytest.raises(ActionError, match="undetermined"):
        move_to(10.0, 10.0, controller=BoolMouse())


class StringPositionMouse(FakeMouse):
    def position(self):
        return "ab"


def test_string_click_position_reports_an_error() -> None:
    with pytest.raises(ActionError, match="undetermined"):
        click(10.0, 10.0, controller=StringPositionMouse())


def test_move_outside_screens_names_the_valid_range() -> None:
    with pytest.raises(ActionError, match="0.*1919|1919.*0"):
        move_to(5000.0, 100.0, controller=FakeMouse(), screens=single_screen())


def test_move_with_non_finite_coordinates_reports_an_error() -> None:
    with pytest.raises(ActionError):
        move_to(float("nan"), 10.0, controller=FakeMouse(), screens=single_screen())


def test_left_click_moves_then_clicks_once() -> None:
    mouse = FakeMouse()

    result = click(100.0, 200.0, controller=mouse, screens=single_screen())

    assert result.button == "left"
    assert result.clicks == 1
    assert (result.position.x, result.position.y) == (100.0, 200.0)
    assert mouse.moves == [(100.0, 200.0)]
    assert mouse.clicks == [("left", 1, (100.0, 200.0))]


def test_right_click_uses_the_right_button() -> None:
    mouse = FakeMouse()

    result = right_click(50.0, 60.0, controller=mouse, screens=single_screen())

    assert result.button == "right"
    assert result.clicks == 1
    assert mouse.clicks == [("right", 1, (50.0, 60.0))]


def test_double_click_clicks_twice() -> None:
    mouse = FakeMouse()

    result = double_click(70.0, 80.0, controller=mouse, screens=single_screen())

    assert result.button == "left"
    assert result.clicks == 2
    assert mouse.clicks == [("left", 2, (70.0, 80.0))]


def test_unsupported_button_performs_nothing() -> None:
    mouse = FakeMouse()

    with pytest.raises(ActionError, match="unsupported"):
        click(10.0, 10.0, button="side", controller=mouse, screens=single_screen())

    assert mouse.moves == []
    assert mouse.clicks == []


def test_backend_failure_names_the_cause() -> None:
    mouse = FakeMouse(fail_with=OSError("input denied"))

    with pytest.raises(ActionError, match="input denied"):
        move_to(10.0, 10.0, controller=mouse, screens=single_screen())


def test_live_move_to_current_position_is_stable() -> None:
    from computer_use.screen import list_screens, pointer_position

    screens = list_screens()
    before = pointer_position()

    result = move_to(before.x, before.y, screens=screens)

    assert abs(result.position.x - before.x) < 2.0
    assert abs(result.position.y - before.y) < 2.0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
