"""Move the pointer and click targets.

Every move and click reports exactly what was performed. Out-of-range
requests are rejected with the valid range before anything moves,
unsupported buttons are reported rather than replaced, and delivery
failures name their cause.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from computer_use.grid import CoordinateContextError, CoordinatePoint
from computer_use.screen import (
    Pointer,
    capture_screen,
    find_screen,
    list_screens,
)
from computer_use.permissions import (
    PermissionDeniedError,
    require_permissions,
)

BUTTONS = ("left", "right", "middle")
DIRECTIONS = ("up", "down", "left", "right")
DIRECTION_VECTORS = {
    "up": (0, 1),
    "down": (0, -1),
    "left": (-1, 0),
    "right": (1, 0),
}
POSITION_TOLERANCE = 2.0


class ActionError(RuntimeError):
    """Raised when a pointer action cannot be performed as requested."""


@dataclass(frozen=True)
class MoveResult:
    position: Pointer


@dataclass(frozen=True)
class ClickResult:
    button: str
    clicks: int
    position: Pointer


class IncompleteDragError(ActionError):
    """A drag that stopped early, carrying the progress reached."""

    def __init__(self, message, *, start, reached):
        super().__init__(message)
        self.start = start
        self.reached = reached


@dataclass(frozen=True)
class DragResult:
    start: Pointer
    end: Pointer
    button: str
    before: bytes | None
    after: bytes | None
    changed: bool | None


@dataclass(frozen=True)
class ScrollResult:
    position: Pointer
    direction: str
    amount: int
    moved: bool | None


class _PynputMouse:
    """Real pointer backend driving the live mouse."""

    def move_to(self, x, y):  # pragma: no cover - thin adapter over pynput
        from pynput.mouse import Controller

        controller = Controller()
        controller.position = (x, y)
        return controller.position

    def click(self, button, count):  # pragma: no cover - thin adapter
        from pynput.mouse import Controller

        controller = Controller()
        controller.click(_pynput_button(button), count)
        return (button, count, controller.position)

    def press(self, button):  # pragma: no cover - thin adapter over pynput
        from pynput.mouse import Controller

        Controller().press(_pynput_button(button))
        return True

    def release(self, button):  # pragma: no cover - thin adapter over pynput
        from pynput.mouse import Controller

        Controller().release(_pynput_button(button))
        return True

    def scroll(self, dx, dy):  # pragma: no cover - thin adapter over pynput
        from pynput.mouse import Controller

        Controller().scroll(dx, dy)
        return None

    def position(self):  # pragma: no cover - thin adapter over pynput
        from pynput.mouse import Controller

        return Controller().position


def _safe_value(value) -> str:
    """Render backend- or caller-supplied data without trusting it."""

    if type(value) is int:
        try:
            return repr(value)
        except ValueError:
            sign = "-" if value < 0 else ""
            digits = int(value.bit_length() * 0.30103) + 1
            return f"{sign}<integer with about {digits} digits>"
    try:
        text = repr(value)
    except Exception:
        return f"<unrepresentable {type(value).__name__}>"
    if len(text) > 300:
        return (
            f"<{type(value).__name__} with"
            f" a {len(text)}-character representation>"
        )
    return text


def _safe_cause(exc: Exception) -> str:
    """Render a backend failure without trusting its string conversion."""

    try:
        return str(exc)
    except Exception:
        return f"<unprintable {type(exc).__name__}>"


def _number(name: str, value) -> float:
    """Coerce once, validate that exact value, and return it."""

    try:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"non-numeric coordinate: {_safe_value(value)}")
        coerced = float(value)
    except ActionError:
        raise
    except Exception as exc:
        raise ActionError(
            f"Coordinate {name} is not a number: {type(exc).__name__}"
        ) from exc
    if not math.isfinite(coerced):
        raise ActionError(
            f"Coordinate {name} is not finite: {_safe_value(value)}"
        )
    return coerced


def _mapped_coordinates(x, y, context):
    """Resolve either desktop coordinates or a context-local target."""

    if context is None:
        if y is None and isinstance(x, CoordinatePoint):
            return _number("x", x.x), _number("y", x.y)
        return _number("x", x), _number("y", y)
    try:
        if y is None:
            if not isinstance(x, CoordinatePoint) or x.context is not context:
                raise CoordinateContextError(
                    "a CoordinatePoint from this context is required"
                )
            point = x
        else:
            point = context.to_desktop(x, y)
    except Exception as exc:
        raise ActionError(
            f"Coordinate context rejected the target: {_safe_cause(exc)}"
        ) from exc
    return _number("x", point.x), _number("y", point.y)


def _result_component(action: str, name: str, raw) -> float:
    """Validate one backend-reported coordinate exactly once."""

    try:
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(f"non-numeric {name}")
        coerced = float(raw)
    except ActionError:
        raise
    except Exception as exc:
        raise ActionError(
            f"{action} result is undetermined: {type(exc).__name__}"
        ) from exc
    if not math.isfinite(coerced):
        raise ActionError(
            f"{action} result is undetermined: non-finite {name}"
        )
    return coerced


def _backend_position(reported, action: str) -> Pointer:
    """Require a genuine two-coordinate finite backend position."""

    if isinstance(reported, (str, bytes, bytearray)):
        raise ActionError(
            f"{action} result is undetermined: not a coordinate pair"
        )
    try:
        x_raw, y_raw = reported
    except Exception as exc:
        raise ActionError(
            f"{action} result is undetermined: {type(exc).__name__}"
        ) from exc
    return Pointer(
        x=_result_component(action, "x", x_raw),
        y=_result_component(action, "y", y_raw),
    )


def _ranges_text(known) -> str:
    """Render the valid ranges of materialized screens."""

    return "; ".join(
        f"screen {screen.index}: x in [{screen.left},"
        f" {screen.left + screen.width - 1}], y in [{screen.top},"
        f" {screen.top + screen.height - 1}]"
        for screen in known
    )


def _locate(x: float, y: float, screens) -> None:
    """Reject positions outside every known screen with the valid ranges."""

    if screens is None:
        return
    known = tuple(screens)
    if find_screen(known, x, y) is not None:
        return
    raise ActionError(
        f"Position ({x}, {y}) is outside every known screen:"
        f" {_ranges_text(known)}"
    )


def move_to(x, y=None, controller=None, screens=None, prober=None,
            context=None) -> MoveResult:
    """Move the pointer and report the resulting position.

    When ``context`` is supplied, ``x``/``y`` are observation-local and are
    mapped to desktop coordinates before validation or delivery.
    """

    px, py = _mapped_coordinates(x, y, context)
    _locate(px, py, screens)
    require_permissions("input", prober=prober)
    active = controller if controller is not None else _PynputMouse()
    try:
        reported = active.move_to(px, py)
    except ActionError:
        raise
    except Exception as exc:
        raise ActionError(
            f"Could not move the pointer to ({px}, {py}):"
            f" {_safe_cause(exc)}"
        ) from exc
    return MoveResult(position=_backend_position(reported, "Move"))


def _pynput_button(button):
    """Map a validated button name to the backend button value."""

    from pynput.mouse import Button

    return {
        "left": Button.left,
        "right": Button.right,
        "middle": Button.middle,
    }[button]


def _checked_button(button) -> str:
    """Require a supported button string without acting on anything else."""

    try:
        supported = type(button) is str and button in BUTTONS
    except Exception:
        supported = False
    if not supported:
        raise ActionError(
            f"unsupported button {_safe_value(button)};"
            " supported buttons: left, right, middle"
        )
    return button


def _checked_direction(direction) -> str:
    """Require a supported scroll direction without acting."""

    try:
        supported = type(direction) is str and direction in DIRECTIONS
    except Exception:
        supported = False
    if not supported:
        raise ActionError(
            f"unsupported scroll direction {_safe_value(direction)};"
            " supported directions: up, down, left, right"
        )
    return direction


def _checked_amount(amount) -> int:
    """Require a positive scroll amount without acting."""

    if type(amount) is not int or amount <= 0:
        raise ActionError(
            f"scroll amount must be a positive integer: {_safe_value(amount)}"
        )
    return amount


def _perform_click(x, y, button, count, controller, screens,
                   prober, context) -> ClickResult:
    checked = _checked_button(button)
    px, py = _mapped_coordinates(x, y, context)
    _locate(px, py, screens)
    require_permissions("input", prober=prober)
    active = controller if controller is not None else _PynputMouse()
    try:
        active.move_to(px, py)
        delivery = active.click(checked, count)
        final = active.position()
    except ActionError:
        raise
    except Exception as exc:
        raise ActionError(
            f"Could not click {checked} {count}x at ({px}, {py}):"
            f" {_safe_cause(exc)}"
        ) from exc
    if delivery is False:
        raise ActionError(
            f"Click was not delivered at ({px}, {py}):"
            " the controller reported failure"
        )
    actual = _backend_position(final, "Click")
    if math.hypot(actual.x - px, actual.y - py) > POSITION_TOLERANCE:
        raise ActionError(
            f"Click missed its target: requested ({px}, {py})"
            f" but the pointer is at ({actual.x}, {actual.y})"
        )
    return ClickResult(button=checked, clicks=count, position=actual)


def click(x, y=None, button="left", controller=None, screens=None,
          prober=None, context=None) -> ClickResult:
    """Move to a position and click once with the requested button."""

    return _perform_click(
        x, y, button, 1, controller, screens, prober, context
    )


def right_click(x, y=None, controller=None, screens=None,
                prober=None, context=None) -> ClickResult:
    """Move to a position and click once with the right button."""

    return _perform_click(
        x, y, "right", 1, controller, screens, prober, context
    )


def double_click(x, y=None, controller=None, screens=None,
                 prober=None, context=None) -> ClickResult:
    """Move to a position and click twice with the left button."""

    return _perform_click(
        x, y, "left", 2, controller, screens, prober, context
    )


def _checked_point(index: int, point) -> tuple[float, float]:
    """Validate one path waypoint as an exact (x, y) pair."""

    try:
        parts = tuple(point)
    except Exception:
        raise ActionError(
            f"Drag path point {index} is not a coordinate pair:"
            f" {_safe_value(point)}"
        ) from None
    if isinstance(point, (str, bytes, bytearray)) or len(parts) != 2:
        raise ActionError(
            f"Drag path point {index} needs exactly (x, y),"
            f" got {_safe_value(point)}"
        )
    return (
        _number(f"point[{index}].x", parts[0]),
        _number(f"point[{index}].y", parts[1]),
    )


def _checked_path(points) -> tuple[tuple[float, float], ...]:
    """Require at least two valid waypoints before anything moves."""

    if isinstance(points, (str, bytes, bytearray)):
        raise ActionError(
            f"Drag path needs at least two points,"
            f" got {_safe_value(points)}"
        )
    try:
        items = tuple(points)
    except Exception:
        raise ActionError(
            f"Drag path needs at least two points,"
            f" got {_safe_value(points)}"
        ) from None
    if len(items) < 2:
        raise ActionError(
            f"Drag path needs at least two points,"
            f" got {len(items)}"
        )
    return tuple(
        _checked_point(index, point) for index, point in enumerate(items)
    )


def _interpolated_legs(waypoints, step_px: float):
    """Expand waypoint legs into interpolated moves ending at each point."""

    moves: list = []
    for (sx, sy), (ex, ey) in zip(waypoints, waypoints[1:]):
        dist = math.hypot(ex - sx, ey - sy)
        legs = max(1, math.ceil(dist / step_px))
        for leg in range(1, legs + 1):
            moves.append((sx + (ex - sx) * leg / legs,
                          sy + (ey - sy) * leg / legs))
    return moves


def _mapped_path(points, context):
    """Map every path point once while retaining one context boundary."""

    waypoints = _checked_path(points)
    if context is None:
        return waypoints
    mapped = []
    for index, (x, y) in enumerate(waypoints):
        try:
            point = context.to_desktop(x, y)
        except Exception as exc:
            raise ActionError(
                f"Coordinate context rejected drag point {index}:"
                f" {_safe_cause(exc)}"
            ) from exc
        mapped.append((point.x, point.y))
    return tuple(mapped)


def _checked_step_px(step_px) -> float:
    """Require a positive interpolation step without acting."""

    try:
        bad_type = isinstance(step_px, bool) or not isinstance(
            step_px, (int, float)
        )
        value = float(step_px)
    except Exception:
        raise ActionError(
            f"Drag step must be a positive number:"
            f" {_safe_value(step_px)}"
        ) from None
    if bad_type or not math.isfinite(value) or value <= 0:
        raise ActionError(
            f"Drag step must be a positive number:"
            f" {_safe_value(step_px)}"
        )
    return value


def _checked_interval(interval) -> float:
    """Require a non-negative settle between moves without acting."""

    try:
        bad_type = isinstance(interval, bool) or not isinstance(
            interval, (int, float)
        )
        value = float(interval)
    except Exception:
        raise ActionError(
            f"Drag interval must be a non-negative number:"
            f" {_safe_value(interval)}"
        ) from None
    if bad_type or not math.isfinite(value) or value < 0:
        raise ActionError(
            f"Drag interval must be a non-negative number:"
            f" {_safe_value(interval)}"
        )
    return value


def _confirmed_position(active, tx: float, ty: float, action: str,
                        tries: int = 5, pause: float = 0.2) -> Pointer:
    """Poll the backend until the pointer actually arrives at target.

    Synthetic moves settle asynchronously on real desktops, so a stale
    first read must not fail a correctly delivered move.
    """

    import time as _time

    actual = _backend_position(active.position(), action)
    for _ in range(tries - 1):
        if math.hypot(actual.x - tx, actual.y - ty) <= POSITION_TOLERANCE:
            return actual
        _time.sleep(pause)
        actual = _backend_position(active.position(), action)
    return actual


def drag_path(points, button="left", controller=None, screens=None,
              observer=None, prober=None, step_px=8.0, interval=0.01,
              settle=0.5, context=None) -> DragResult:
    """Press at the first point, walk every waypoint, release at the end.

    Each leg is interpolated into small moves so brush strokes, sliders,
    selections, and window drags stay smooth instead of teleporting.
    Closed paths (first point repeated last) draw one continuous shape
    with a single press and release.

    The view is observed before the press and after the release.
    ``changed`` is True when the frames differ, False when they are
    identical, and None when the outcome cannot be observed.
    """

    checked = _checked_button(button)
    waypoints = _mapped_path(points, context)
    pace = _checked_step_px(step_px)
    pause = _checked_interval(interval)
    rest = _checked_interval(settle)
    known = tuple(screens) if screens is not None else None
    for wx, wy in waypoints:
        _locate(wx, wy, known)
    require_permissions("input", prober=prober)
    if observer is None:
        require_permissions("screen", prober=prober)
    if known is not None:
        home = find_screen(known, waypoints[0][0], waypoints[0][1])
        for wx, wy in waypoints[1:]:
            other = find_screen(known, wx, wy)
            if other.index != home.index:
                raise ActionError(
                    f"Drag path crosses screens: start on"
                    f" screen {home.index}, point ({wx}, {wy}) on"
                    f" screen {other.index}: {_ranges_text(known)}"
                )
    active = controller if controller is not None else _PynputMouse()
    sx, sy = waypoints[0]
    ex, ey = waypoints[-1]
    start = move_to(sx, sy, controller=active, prober=prober).position
    try:
        confirmed = _confirmed_position(active, sx, sy, "Drag")
        start = confirmed
    except Exception:
        # An unreadable backend keeps the move_to report; a readable
        # but distant pointer still fails the check below.
        pass
    if math.hypot(start.x - sx, start.y - sy) > POSITION_TOLERANCE:
        start = move_to(sx, sy, controller=active, prober=prober).position
    if math.hypot(start.x - sx, start.y - sy) > POSITION_TOLERANCE:
        raise ActionError(
            f"Drag start missed: requested ({sx}, {sy})"
            f" but the pointer is at ({start.x}, {start.y})"
        )
    watch = observer if observer is not None else _default_observer(
        known, sx, sy, prober
    )
    try:
        before = _frame_bytes(watch())
    except PermissionDeniedError:
        raise
    except Exception:
        before = None
    try:
        press_delivery = active.press(checked)
    except Exception as exc:
        raise ActionError(
            f"Could not press {checked} at ({sx}, {sy}):"
            f" {_safe_cause(exc)}"
        ) from exc
    if press_delivery is False:
        raise ActionError(
            f"Drag press was not delivered at ({sx}, {sy})"
        )
    released = False
    try:
        if rest > 0:
            import time as _time

            _time.sleep(rest)
        for mx, my in _interpolated_legs(waypoints, pace):
            move_to(mx, my, controller=active, prober=prober)
            if pause > 0:
                import time as _time

                _time.sleep(pause)
        release_delivery = active.release(checked)
        if release_delivery is False:
            raise ActionError(
                f"Drag release was not delivered at ({ex}, {ey})"
            )
        released = True
        actual = _confirmed_position(active, ex, ey, "Drag")
        if math.hypot(actual.x - ex, actual.y - ey) > POSITION_TOLERANCE:
            raise ActionError(
                f"Drag missed its end: requested ({ex}, {ey})"
                f" but the pointer is at ({actual.x}, {actual.y})"
            )
    except Exception as original:
        release_note = ""
        if not released:
            try:
                cleanup = active.release(checked)
                if cleanup is False:
                    release_note = "; release also reported failure"
            except Exception as cleanup_exc:
                release_note = (
                    f"; release also failed: {_safe_cause(cleanup_exc)}"
                )
        try:
            reached = _backend_position(active.position(), "Drag")
            progress = f"the pointer reached ({reached.x}, {reached.y})"
        except Exception:
            reached = None
            progress = "the release position is unknown"
        detail = _safe_cause(original)
        raise IncompleteDragError(
            f"Incomplete drag from ({sx}, {sy}): {detail};"
            f" {progress}{release_note}",
            start=start,
            reached=reached,
        ) from original
    try:
        after = _frame_bytes(watch())
    except PermissionDeniedError:
        raise
    except Exception:
        after = None
    if before is None or after is None:
        changed = None
    else:
        changed = _compare_frames(before, after)
    return DragResult(
        start=start, end=actual, button=checked,
        before=before, after=after, changed=changed,
    )


def _default_observer(screens, x, y, prober=None):
    """Observe the view under a position as raw frame bytes."""

    def observe():
        if screens is None:
            known = list(list_screens())
        else:
            known = list(screens)
        target = find_screen(known, x, y)
        if target is None:
            raise ActionError(
                f"No known screen contains ({x}, {y}) for observation"
            )
        return capture_screen(target.index, prober=prober).image.tobytes()

    return observe


def _frame_bytes(frame) -> bytes:
    """Coerce an observed frame to exact base bytes for safe comparison."""

    if not isinstance(frame, (bytes, bytearray, memoryview)):
        raise ActionError(
            f"Unusable observation frame: {_safe_value(frame)}"
        )
    try:
        converted = bytes(bytearray(frame))
    except Exception as exc:
        raise ActionError(
            f"Unusable observation frame: {_safe_value(frame)}"
        ) from exc
    if type(converted) is not bytes:
        raise ActionError(
            f"Unusable observation frame: {_safe_value(frame)}"
        )
    return converted


def _compare_frames(first: bytes, second: bytes):
    """Compare exact frames, exposing only True, False, or None."""

    try:
        outcome = first != second
    except Exception:
        return None
    return outcome if isinstance(outcome, bool) else None


def scroll(x, y=None, direction="down", amount=1, controller=None,
           screens=None, observer=None, prober=None, context=None) -> ScrollResult:
    """Scroll content under a position and report the observed outcome.

    The view is observed before and after the scroll. ``moved`` is True
    when the frames differ, False when the backend reports an explicit
    no-op or the frames are identical, and None when the outcome cannot
    be observed.
    """

    checked = _checked_direction(direction)
    steps = _checked_amount(amount)
    px, py = _mapped_coordinates(x, y, context)
    known = tuple(screens) if screens is not None else None
    _locate(px, py, known)
    require_permissions("input", prober=prober)
    if observer is None:
        require_permissions("screen", prober=prober)
    active = controller if controller is not None else _PynputMouse()
    at = move_to(px, py, controller=active, prober=prober).position
    if math.hypot(at.x - px, at.y - py) > POSITION_TOLERANCE:
        raise ActionError(
            f"Scroll target missed: requested ({px}, {py})"
            f" but the pointer is at ({at.x}, {at.y})"
        )
    watch = observer if observer is not None else _default_observer(
        known, px, py, prober
    )
    try:
        before = _frame_bytes(watch())
    except PermissionDeniedError:
        raise
    except Exception:
        before = None
    unit_x, unit_y = DIRECTION_VECTORS[checked]
    try:
        delivery = active.scroll(unit_x * steps, unit_y * steps)
    except Exception as exc:
        raise ActionError(
            f"Could not scroll {checked} by {steps} at ({px}, {py}):"
            f" {_safe_cause(exc)}"
        ) from exc
    if delivery is False:
        raise ActionError(
            f"Scroll was not delivered at ({px}, {py})"
        )
    try:
        after = _frame_bytes(watch())
    except PermissionDeniedError:
        raise
    except Exception:
        after = None
    try:
        explicit_noop = tuple(delivery) == (0, 0)
    except Exception:
        explicit_noop = False
    if explicit_noop:
        moved = False
    elif before is None or after is None:
        moved = None
    else:
        moved = _compare_frames(before, after)
    return ScrollResult(
        position=at, direction=checked, amount=steps, moved=moved
    )
