"""See the screen and know the pointer position.

Capture backends are injectable so behavior tests stay hermetic; the
default backend drives the real machine through lightweight adapters.
All coordinates share the captured-image pixel space.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from computer_use.permissions import (
    CapabilityUnavailableError,
    require_permissions,
)
from PIL import Image


class CaptureError(RuntimeError):
    """Raised when the screen cannot be listed or captured explicitly."""


class PointerError(RuntimeError):
    """Raised when the pointer position cannot be determined explicitly."""


@dataclass(frozen=True)
class Screen:
    index: int
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class Capture:
    image: Image.Image
    screen: Screen


@dataclass(frozen=True)
class Pointer:
    x: float
    y: float


class _MssShooter:
    """Real capture backend reusing one capture session."""

    def __init__(self) -> None:
        import mss

        self._grabber = mss.MSS()

    def monitors(self):  # pragma: no cover - thin adapter over mss
        return self._grabber.monitors

    def grab(self, monitor):  # pragma: no cover - thin adapter over mss
        return self._grabber.grab(monitor)


class _PynputController:
    """Real pointer backend reading the live position."""

    def position(self):  # pragma: no cover - thin adapter over pynput
        from pynput.mouse import Controller

        return Controller().position


_SHARED_SHOOTER: _MssShooter | None = None


def _shared_shooter() -> _MssShooter:
    global _SHARED_SHOOTER
    if _SHARED_SHOOTER is None:
        try:
            _SHARED_SHOOTER = _MssShooter()
        except Exception as exc:
            raise CapabilityUnavailableError(
                "screen",
                f"the screen bridge could not be loaded: {_safe_text(exc)}",
            ) from exc
    return _SHARED_SHOOTER


def _geometry_number(index: int, name: str, value) -> float:
    """Require a finite numeric pixel component or explain the monitor."""

    try:
        valid = (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(float(value))
        )
    except Exception as exc:
        raise CaptureError(
            f"Screen {index} reported unusable {name}: {_safe_text(exc)}"
        ) from exc
    if not valid:
        raise CaptureError(
            f"Screen {index} reported non-numeric {name}: {_safe_text(value)}"
        )
    return value


def _safe_text(part) -> str:
    """Render backend-supplied data without trusting its representation."""

    try:
        return str(part)
    except Exception:
        return f"<unrepresentable {type(part).__name__}>"


def _safe_integer_text(value) -> str:
    """Format an integer without tripping the string-conversion limit."""

    try:
        return repr(value)
    except ValueError:
        sign = "-" if value < 0 else ""
        digits = int(value.bit_length() * 0.30103) + 1
        return f"{sign}<integer with about {digits} digits>"


def _pixel_dimension(screen_index: int, name: str, value) -> int:
    """Require a genuine positive integer pixel dimension."""

    if type(value) is not int or value <= 0:
        raise CaptureError(
            f"Screen {screen_index} reported non-integer {name}:"
            f" {_safe_integer_text(value) if type(value) is int else _safe_text(value)}"
        )
    return value


def _screen_from_metadata(index: int, monitor) -> Screen:
    """Build a Screen or explain exactly which monitor metadata failed."""

    try:
        left = monitor["left"]
        top = monitor["top"]
        width = monitor["width"]
        height = monitor["height"]
    except Exception as exc:
        raise CaptureError(
            f"Screen {index} reported unusable geometry: {_safe_text(exc)}"
        ) from exc
    left = _geometry_number(index, "left", left)
    top = _geometry_number(index, "top", top)
    width = _geometry_number(index, "width", width)
    height = _geometry_number(index, "height", height)
    if width <= 0 or height <= 0:
        raise CaptureError(
            f"Screen {index} reported non-positive geometry:"
            f" {_safe_text(width)}x{_safe_text(height)}"
        )
    return Screen(index=index, left=left, top=top, width=width, height=height)


def _list_screens(shooter=None) -> tuple[Screen, ...]:
    """List screens after the public capability/permission gate."""

    active = shooter if shooter is not None else _shared_shooter()
    try:
        monitors = list(active.monitors())
    except CaptureError:
        raise
    except Exception as exc:
        raise CaptureError(f"Could not list screens: {_safe_text(exc)}") from exc
    screens = tuple(
        _screen_from_metadata(index, monitor)
        for index, monitor in enumerate(monitors)
        if index > 0
    )
    if not screens:
        raise CaptureError("The capture backend reported no screens")
    return screens


def list_screens(shooter=None, prober=None) -> tuple[Screen, ...]:
    """List real screens, skipping the combined all-monitors entry."""

    require_permissions("screen", prober=prober)
    return _list_screens(shooter)


def _safe_request_text(value) -> str:
    """Render a caller-supplied identifier without trusting its size."""

    if type(value) is int:
        return _safe_integer_text(value)
    return _safe_text(value)


def capture_screen(screen_index: int = 1, shooter=None,
                   prober=None) -> Capture:
    """Capture one screen as an RGB image in that screen's pixel space."""

    require_permissions("screen", prober=prober)
    screens = _list_screens(shooter)
    by_index = {screen.index: screen for screen in screens}
    try:
        known = screen_index in by_index
    except Exception:
        known = False
    if not known:
        valid = ", ".join(str(index) for index in sorted(by_index))
        raise CaptureError(
            f"Unknown screen {_safe_request_text(screen_index)};"
            f" valid screens: {valid}"
        )
    screen = by_index[screen_index]
    active = shooter if shooter is not None else _shared_shooter()
    try:
        shot = active.grab(
            {
                "left": screen.left,
                "top": screen.top,
                "width": screen.width,
                "height": screen.height,
            }
        )
    except CaptureError:
        raise
    except Exception as exc:
        raise CaptureError(
            f"Could not capture screen {screen_index}: {_safe_text(exc)}"
        ) from exc
    try:
        shot_size = shot.size
        if len(shot_size) != 2:
            raise ValueError(f"expected 2 dimensions, got {len(shot_size)}")
        payload = shot.rgb
        if isinstance(payload, bool) or not isinstance(
            payload, (bytes, bytearray, memoryview)
        ):
            raise TypeError(
                f"expected bytes-like pixels, got {type(payload).__name__}"
            )
        rgb = bytes(payload)
    except Exception as exc:
        raise CaptureError(
            f"Screen {screen_index} returned unusable pixels: {_safe_text(exc)}"
        ) from exc
    shot_width = _pixel_dimension(screen_index, "width", shot_size[0])
    shot_height = _pixel_dimension(screen_index, "height", shot_size[1])
    if (shot_width, shot_height) != (screen.width, screen.height):
        raise CaptureError(
            f"Screen {screen_index} returned"
            f" {_safe_integer_text(shot_width)}x{_safe_integer_text(shot_height)}"
            f" pixels for a {_safe_text(screen.width)}x{_safe_text(screen.height)}"
            " screen"
        )
    if len(rgb) != shot_width * shot_height * 3:
        raise CaptureError(
            f"Screen {screen_index} returned"
            f" {len(rgb)} pixel bytes for a"
            f" {shot_width}x{shot_height} image"
        )
    try:
        image = Image.frombytes("RGB", (shot_width, shot_height), rgb)
    except Exception as exc:
        raise CaptureError(
            f"Captured pixels for screen {screen_index} are unusable:"
            f" {_safe_text(exc)}"
        ) from exc
    return Capture(image=image, screen=screen)


def pointer_position(controller=None, prober=None) -> Pointer:
    """Read the live pointer position without guessing or caching."""

    require_permissions("input", prober=prober)
    if controller is None:
        try:
            position = _PynputController().position()
        except Exception as exc:
            raise PointerError(
                f"Could not read pointer position: {_safe_text(exc)}"
            ) from exc
    else:
        try:
            position = controller.position()
        except PointerError:
            raise
        except Exception as exc:
            raise PointerError(
                f"Could not read pointer position: {_safe_text(exc)}"
            ) from exc
    try:
        x_raw, y_raw = position
        x, y = float(x_raw), float(y_raw)
    except Exception as exc:
        raise PointerError(
            f"Pointer position is undetermined: {_safe_text(exc)}"
        ) from exc
    if not (math.isfinite(x) and math.isfinite(y)):
        raise PointerError(
            "Pointer position is undetermined: non-finite coordinates"
        )
    return Pointer(x=x, y=y)


def find_screen(
    screens: tuple[Screen, ...], x: float, y: float
) -> Screen | None:
    """Locate which listed screen contains a pixel position, if any."""

    for screen in screens:
        if (
            screen.left <= x < screen.left + screen.width
            and screen.top <= y < screen.top + screen.height
        ):
            return screen
    return None


def capture_region(*args, **kwargs):
    """Lazy compatibility entry point for bounded region capture."""

    from computer_use.region import capture_region as _capture_region

    return _capture_region(*args, **kwargs)


capture_screen_region = capture_region
