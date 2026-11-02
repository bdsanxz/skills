"""Drag and scroll behavior (T005).

Drags press, move through the stated path, and release; scrolls move the
content under a stated position. Both report what was applied, validate
ranges up front, and name delivery failures instead of claiming success.
"""

from __future__ import annotations

import sys

import pytest

from computer_use.pointer import ActionError, drag_path, scroll
from computer_use.screen import Screen


def single_screen():
    return (
        Screen(index=1, left=0, top=0, width=1920, height=1080),
    )


def two_screens():
    return (
        Screen(index=1, left=0, top=0, width=1920, height=1080),
        Screen(index=2, left=1920, top=0, width=1920, height=1080),
    )


class FakeGestureMouse:
    """Stand-in pointer backend recording press/move/release/scroll order."""

    def __init__(self, position=(0.0, 0.0), fail_with=None, drift=(0.0, 0.0),
                 fail_on_call=None):
        self._position = position
        self._fail_with = fail_with
        self._drift = drift
        self._fail_on_call = fail_on_call or {}
        self._calls = 0
        self.events = []

    def _guard(self, name):
        self._calls += 1
        failure = self._fail_on_call.get(name, self._fail_with)
        if failure is not None:
            raise failure

    def move_to(self, x, y):
        self._guard("move_to")
        self._position = (x + self._drift[0], y + self._drift[1])
        self.events.append(("move", x, y))
        return self._position

    def press(self, button):
        self._guard("press")
        self.events.append(("press", button))
        return True

    def release(self, button):
        self._guard("release")
        self.events.append(("release", button))
        return True

    def scroll(self, dx, dy):
        self._guard("scroll")
        self.events.append(("scroll", dx, dy))
        return (dx, dy)

    def position(self):
        return self._position


def test_drag_presses_moves_and_releases_in_order() -> None:
    mouse = FakeGestureMouse()

    result = drag_path([(10.0, 20.0), (100.0, 200.0)], controller=mouse,
                  screens=single_screen(), observer=moving_view(),
                  step_px=1000, interval=0, settle=0)

    assert mouse.events == [
        ("move", 10.0, 20.0),
        ("press", "left"),
        ("move", 100.0, 200.0),
        ("release", "left"),
    ]
    assert (result.start.x, result.start.y) == (10.0, 20.0)
    assert (result.end.x, result.end.y) == (100.0, 200.0)
    assert result.button == "left"


def test_drag_outside_screens_moves_nothing() -> None:
    mouse = FakeGestureMouse()

    with pytest.raises(ActionError, match="1919"):
        drag_path([(10.0, 20.0), (5000.0, 20.0)], controller=mouse, screens=single_screen())

    assert mouse.events == []


def test_drag_reports_backend_failure_with_cause() -> None:
    mouse = FakeGestureMouse(fail_with=OSError("grip lost"))

    with pytest.raises(ActionError, match="grip lost"):
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse)


def scripted_observer(*frames):
    """Replay scripted view frames for the scroll observation step."""

    remaining = list(frames)

    def observe():
        if not remaining:
            raise AssertionError("observer called more than scripted")
        return remaining.pop(0)

    return observe


def still_view():
    return scripted_observer(b"frame", b"frame")


def moving_view():
    return scripted_observer(b"before", b"after")


def test_hostile_backend_error_still_reports_incomplete() -> None:
    class HostileError(ActionError):
        def __str__(self):
            raise OSError("no print")

    mouse = FakeGestureMouse()
    calls = {"moves": 0}
    original_move = mouse.move_to

    def flaky_move(x, y):
        calls["moves"] += 1
        if calls["moves"] > 1:
            raise HostileError("hidden")
        return original_move(x, y)

    mouse.move_to = flaky_move

    with pytest.raises(ActionError) as caught:
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
             observer=still_view())

    assert ("release", "left") in mouse.events
    assert (caught.value.reached.x, caught.value.reached.y) == (10.0, 20.0)


def test_failed_end_move_releases_and_reports_progress() -> None:
    mouse = FakeGestureMouse()
    calls = {"moves": 0}
    original_move = mouse.move_to

    def flaky_move(x, y):
        calls["moves"] += 1
        if calls["moves"] > 1:
            raise OSError("end lost")
        return original_move(x, y)

    mouse.move_to = flaky_move

    with pytest.raises(ActionError, match="end lost") as caught:
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
             observer=still_view())

    assert mouse.events[0] == ("move", 10.0, 20.0)
    assert ("press", "left") in mouse.events
    assert ("release", "left") in mouse.events
    assert (caught.value.reached.x, caught.value.reached.y) == (10.0, 20.0)


def test_false_release_reports_actual_position() -> None:
    class NoReleaseMouse(FakeGestureMouse):
        def release(self, button):
            self.events.append(("release", button))
            return False

    mouse = NoReleaseMouse()

    with pytest.raises(ActionError) as caught:
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
             observer=still_view())

    assert (caught.value.reached.x, caught.value.reached.y) == (30.0, 40.0)


def test_release_exception_reports_progress() -> None:
    class RaisingReleaseMouse(FakeGestureMouse):
        def release(self, button):
            self.events.append(("release", button))
            raise OSError("release blew up")

    mouse = RaisingReleaseMouse()

    with pytest.raises(ActionError, match="release blew up") as caught:
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
             observer=still_view())

    assert ("release", "left") in mouse.events
    assert (caught.value.reached.x, caught.value.reached.y) == (30.0, 40.0)


def test_position_failure_reports_unknown_release() -> None:
    class BlindMouse(FakeGestureMouse):
        def position(self):
            raise OSError("position gone")

    with pytest.raises(ActionError, match="unknown") as caught:
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=BlindMouse(),
             observer=still_view())

    assert caught.value.reached is None


def test_cross_screen_drag_rejected_before_acting() -> None:
    mouse = FakeGestureMouse()

    with pytest.raises(ActionError, match="screen 1"):
        drag_path([(100.0, 100.0), (2000.0, 100.0)], controller=mouse, screens=two_screens())

    with pytest.raises(ActionError, match="screen 2"):
        drag_path([(100.0, 100.0), (2000.0, 100.0)], controller=mouse, screens=two_screens())

    assert mouse.events == []


def test_generator_screens_cover_both_endpoints() -> None:
    mouse = FakeGestureMouse()
    screens = (screen for screen in single_screen())

    result = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse, screens=screens,
                  observer=still_view())

    assert (result.end.x, result.end.y) == (30.0, 40.0)
    assert ("release", "left") in mouse.events


def test_start_miss_aborts_before_press() -> None:
    mouse = FakeGestureMouse(drift=(30.0, 40.0))

    with pytest.raises(ActionError, match="start"):
        drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse)

    assert ("press", "left") not in mouse.events
    assert ("release", "left") not in mouse.events


def test_scroll_moves_content_in_the_requested_direction() -> None:
    mouse = FakeGestureMouse()

    result = scroll(
        500.0, 500.0, "down", 3, controller=mouse,
        screens=single_screen(), observer=moving_view(),
    )

    assert result.direction == "down"
    assert result.amount == 3
    assert result.moved is True
    assert (result.position.x, result.position.y) == (500.0, 500.0)
    assert mouse.events[0] == ("move", 500.0, 500.0)
    assert mouse.events[1] == ("scroll", 0, -3)


def test_noop_scroll_reports_unchanged() -> None:
    class NoopMouse(FakeGestureMouse):
        def scroll(self, dx, dy):
            self.events.append(("scroll", dx, dy))
            return (0, 0)

    result = scroll(10.0, 10.0, "down", 2, controller=NoopMouse(),
                    observer=still_view())

    assert result.moved is False


def test_changed_view_reports_moved() -> None:
    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=moving_view())

    assert result.moved is True


def test_still_view_reports_unchanged() -> None:
    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=still_view())

    assert result.moved is False


def test_broken_observation_reports_unknown() -> None:
    def broken():
        raise OSError("camera gone")

    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=broken)

    assert result.moved is None


def test_explicit_noop_wins_over_observation() -> None:
    class NoopMouse(FakeGestureMouse):
        def scroll(self, dx, dy):
            self.events.append(("scroll", dx, dy))
            return (0, 0)

    result = scroll(10.0, 10.0, "down", 2, controller=NoopMouse(),
                    observer=moving_view())

    assert result.moved is False


def test_scroll_target_miss_rejected_before_scrolling() -> None:
    mouse = FakeGestureMouse(drift=(30.0, 40.0))

    with pytest.raises(ActionError, match="target"):
        scroll(10.0, 10.0, "up", 2, controller=mouse)

    assert [event[0] for event in mouse.events] == ["move"]


def test_scroll_rejects_unknown_direction_without_acting() -> None:
    mouse = FakeGestureMouse()

    with pytest.raises(ActionError, match="direction"):
        scroll(10.0, 10.0, "diagonal", 2, controller=mouse)

    assert mouse.events == []


def test_scroll_rejects_non_positive_amount_without_acting() -> None:
    mouse = FakeGestureMouse()

    with pytest.raises(ActionError, match="amount"):
        scroll(10.0, 10.0, "up", 0, controller=mouse)

    assert mouse.events == []


def test_scroll_reports_backend_failure_with_cause() -> None:
    mouse = FakeGestureMouse(fail_with=OSError("wheel stuck"))

    with pytest.raises(ActionError, match="wheel stuck"):
        scroll(10.0, 10.0, "up", 2, controller=mouse, observer=still_view())


def test_live_scroll_down_then_up_restores_the_view() -> None:
    from computer_use.screen import list_screens, pointer_position

    screens = list_screens()
    pointer = pointer_position()

    down = scroll(pointer.x, pointer.y, "down", 1, screens=screens)
    up = scroll(pointer.x, pointer.y, "up", 1, screens=screens)
    after = pointer_position()

    assert (down.direction, up.direction) == ("down", "up")
    assert (down.amount, up.amount) == (1, 1)
    # The observed moved flag depends on the live content under the pointer,
    # so only the hermetic scripted-frame tests pin its True/False/None
    # contract; here the scroll must simply run and preserve the pointer.
    assert abs(after.x - pointer.x) < 2.0
    assert abs(after.y - pointer.y) < 2.0


def test_default_observer_uses_target_screen(monkeypatch) -> None:
    seen = []

    class FakeCapture:
        def __init__(self, payload):
            self.image = payload

    class FakeImage:
        def tobytes(self):
            return b"screen-bytes"

    def fake_capture(index, prober=None):
        seen.append(index)
        return FakeCapture(FakeImage())

    monkeypatch.setattr("computer_use.pointer.capture_screen", fake_capture)
    screens = (screen for screen in two_screens())

    result = scroll(2000.0, 100.0, "down", 1, controller=FakeGestureMouse(),
                    screens=screens)

    assert seen == [2, 2]
    assert result.moved is False


def test_hostile_frames_report_unknown() -> None:
    class HostileFrame:
        def __eq__(self, other):
            raise OSError("no compare")

        def __ne__(self, other):
            raise OSError("no compare")

    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=scripted_observer(HostileFrame(), HostileFrame()))

    assert result.moved is None


def test_non_bytes_frames_report_unknown() -> None:
    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=scripted_observer(object(), object()))

    assert result.moved is None


def test_drag_observes_changed_view() -> None:
    mouse = FakeGestureMouse()

    result = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
                  observer=moving_view())

    assert result.before == b"before"
    assert result.after == b"after"
    assert result.changed is True


def test_drag_observes_still_view() -> None:
    result = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=FakeGestureMouse(),
                  observer=still_view())

    assert result.changed is False


def test_drag_broken_observation_reports_unknown() -> None:
    def broken():
        raise OSError("camera gone")

    result = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=FakeGestureMouse(),
                  observer=broken)

    assert result.before is None
    assert result.after is None
    assert result.changed is None


class HostileBytes(bytes):
    def __eq__(self, other):
        raise OSError("no compare")

    def __ne__(self, other):
        raise OSError("no compare")


class LyingBytes(bytes):
    def __ne__(self, other):
        return "yes"


def test_hostile_bytes_frames_compare_safely() -> None:
    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=scripted_observer(HostileBytes(b"same"),
                                               HostileBytes(b"same")))

    assert result.moved is False

    dragged = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=FakeGestureMouse(),
                   observer=scripted_observer(HostileBytes(b"x"),
                                              HostileBytes(b"y")))

    assert dragged.changed is True


def test_lying_bytes_frames_normalize_to_bool() -> None:
    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=scripted_observer(LyingBytes(b"same"),
                                               LyingBytes(b"same")))

    assert result.moved is False
    assert type(result.moved) is bool


def test_default_observer_resolves_screen_without_metadata(monkeypatch) -> None:
    seen = []

    class FakeCapture:
        def __init__(self, payload):
            self.image = payload

    class FakeImage:
        def tobytes(self):
            return b"screen-bytes"

    def fake_capture(index, prober=None):
        seen.append(index)
        return FakeCapture(FakeImage())

    monkeypatch.setattr("computer_use.pointer.capture_screen", fake_capture)
    monkeypatch.setattr(
        "computer_use.pointer.list_screens", lambda: list(two_screens())
    )

    result = scroll(2000.0, 100.0, "down", 1,
                    controller=FakeGestureMouse())

    assert seen == [2, 2]
    assert result.moved is False


def test_default_observer_reports_unresolvable_target(monkeypatch) -> None:
    seen = []

    def fake_capture(index, prober=None):
        seen.append(index)
        raise AssertionError("must not capture an unresolvable target")

    monkeypatch.setattr("computer_use.pointer.capture_screen", fake_capture)
    monkeypatch.setattr(
        "computer_use.pointer.list_screens", lambda: list(single_screen())
    )

    result = scroll(99999.0, 99999.0, "down", 1,
                    controller=FakeGestureMouse())

    assert seen == []
    assert result.moved is None


class SelfBytes(bytes):
    """Hostile frame surviving bytes() via __bytes__ returning itself."""

    def __bytes__(self):
        return self

    def __ne__(self, other):
        return "yes"


def test_self_returning_bytes_frames_stay_boolean() -> None:
    result = scroll(10.0, 10.0, "up", 1, controller=FakeGestureMouse(),
                    observer=scripted_observer(SelfBytes(b"same"),
                                               SelfBytes(b"same")))

    assert result.moved is False
    assert type(result.moved) is bool

    dragged = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=FakeGestureMouse(),
                   observer=scripted_observer(SelfBytes(b"x"),
                                              SelfBytes(b"y")))

    assert dragged.changed is True
    assert type(dragged.changed) is bool


def test_drag_path_walks_waypoints_smoothly_in_order() -> None:
    mouse = FakeGestureMouse()
    points = [(10.0, 20.0), (30.0, 40.0), (50.0, 20.0)]

    result = drag_path(points, controller=mouse, screens=single_screen(),
                       observer=still_view(), step_px=1000, interval=0,
                       settle=0)

    assert mouse.events == [
        ("move", 10.0, 20.0),
        ("press", "left"),
        ("move", 30.0, 40.0),
        ("move", 50.0, 20.0),
        ("release", "left"),
    ]
    assert (result.start.x, result.start.y) == (10.0, 20.0)
    assert (result.end.x, result.end.y) == (50.0, 20.0)
    assert result.button == "left"
    assert result.changed is False


def test_drag_path_interpolates_long_legs_into_small_steps() -> None:
    mouse = FakeGestureMouse()

    result = drag_path([(0.0, 0.0), (10.0, 0.0)], controller=mouse,
                       observer=still_view(), step_px=3, interval=0,
                       settle=0)

    moves = [event for event in mouse.events if event[0] == "move"]
    assert moves[0] == ("move", 0.0, 0.0)
    assert moves[-1] == ("move", 10.0, 0.0)
    assert len(moves) == 5
    assert (result.end.x, result.end.y) == (10.0, 0.0)


def test_drag_path_rejects_too_few_points_without_acting() -> None:
    for bad in ([], [(1.0, 2.0)]):
        mouse = FakeGestureMouse()

        with pytest.raises(ActionError, match="at least two"):
            drag_path(bad, controller=mouse, screens=single_screen())

        assert mouse.events == []


def test_drag_path_rejects_bad_point_without_acting() -> None:
    bad_sets = [
        [(10.0, 20.0), ("x", 20.0)],
        [(10.0, 20.0), None],
        [(10.0, 20.0), (float("nan"), 5.0)],
        "nope",
    ]
    for bad in bad_sets:
        mouse = FakeGestureMouse()

        with pytest.raises(ActionError, match="point"):
            drag_path(bad, controller=mouse, screens=single_screen())

        assert mouse.events == []


def test_drag_path_rejects_outside_point_before_acting() -> None:
    mouse = FakeGestureMouse()

    with pytest.raises(ActionError, match="1919"):
        drag_path([(10.0, 20.0), (5000.0, 20.0)], controller=mouse,
                   screens=single_screen())

    assert mouse.events == []


def test_drag_path_rejects_cross_screen_path() -> None:
    mouse = FakeGestureMouse()

    with pytest.raises(ActionError, match="screen 1"):
        drag_path([(100.0, 100.0), (2000.0, 100.0)], controller=mouse,
                   screens=two_screens())

    assert mouse.events == []


def test_drag_path_supports_closed_shapes() -> None:
    mouse = FakeGestureMouse()
    square = [(10.0, 10.0), (30.0, 10.0), (30.0, 30.0), (10.0, 30.0),
               (10.0, 10.0)]

    result = drag_path(square, controller=mouse, observer=still_view(),
                       step_px=1000, interval=0, settle=0)

    assert (result.start.x, result.start.y) == (10.0, 10.0)
    assert (result.end.x, result.end.y) == (10.0, 10.0)
    assert mouse.events.count(("press", "left")) == 1
    assert mouse.events.count(("release", "left")) == 1


def test_drag_path_mid_failure_releases_and_reports_progress() -> None:
    mouse = FakeGestureMouse()
    calls = {"moves": 0}
    original_move = mouse.move_to

    def flaky_move(x, y):
        calls["moves"] += 1
        if calls["moves"] > 2:
            raise OSError("leg lost")
        return original_move(x, y)

    mouse.move_to = flaky_move

    with pytest.raises(ActionError, match="leg lost") as caught:
        drag_path([(10.0, 20.0), (30.0, 40.0), (50.0, 60.0)],
                   controller=mouse, observer=still_view(), step_px=1000,
                   interval=0, settle=0)

    assert ("press", "left") in mouse.events
    assert ("release", "left") in mouse.events
    assert (caught.value.reached.x, caught.value.reached.y) == (30.0, 40.0)


def test_drag_path_observes_view_change() -> None:
    mouse = FakeGestureMouse()

    result = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
                       observer=moving_view(), step_px=1000, interval=0,
                       settle=0)

    assert result.before == b"before"
    assert result.after == b"after"
    assert result.changed is True


def test_drag_path_tolerates_slow_pointer_settle() -> None:
    class SlowMouse(FakeGestureMouse):
        def __init__(self):
            super().__init__()
            self._reads = 0

        def move_to(self, x, y):
            self.events.append(("move", x, y))
            self._pending = (x, y)
            self._reads = 0
            return self._position

        def position(self):
            self._reads += 1
            if self._reads >= 3:
                self._position = self._pending
            return self._position

    mouse = SlowMouse()

    result = drag_path([(10.0, 20.0), (30.0, 40.0)], controller=mouse,
                       observer=still_view(), step_px=1000, interval=0,
                       settle=0)

    assert (result.start.x, result.start.y) == (10.0, 20.0)
    assert (result.end.x, result.end.y) == (30.0, 40.0)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
