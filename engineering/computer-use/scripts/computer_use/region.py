"""Native-resolution, bounded screen-region observations (T005)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from PIL import Image

from computer_use.permissions import require_permissions
from computer_use.screen import (
    Capture,
    Screen,
    _list_screens,
    _shared_shooter,
)


class RegionCaptureError(RuntimeError):
    """Raised when a bounded region cannot be observed safely."""


@dataclass(frozen=True)
class RegionCapture:
    """One bounded observation and the context needed to interpret it."""

    image: Image.Image
    screen: Screen
    origin: tuple[int, int]
    size: tuple[int, int]
    scale: tuple[float, float]
    context: object
    requested: tuple[int, int, int, int]
    clipped: bool = False
    fallback: bool = False
    note: str = ""
    _observer: object = field(default=None, repr=False, compare=False)

    @property
    def desktop_origin(self) -> tuple[int, int]:
        return (
            self.screen.left + self.origin[0],
            self.screen.top + self.origin[1],
        )

    @property
    def bounds(self) -> tuple[int, int, int, int]:
        return (*self.origin, *self.size)

    @property
    def actual_origin(self) -> tuple[int, int]:
        return self.origin

    @property
    def mapping(self):
        return self.context

    def observe(self, *, shooter=None, prober=None) -> "RegionCapture":
        """Capture the same bounded source using the same mapping context."""

        if self._observer is None:
            raise RegionCaptureError(
                "This region has no capture backend for a fresh observation"
            )
        return self._observer(shooter=shooter, prober=prober)

    capture = observe

    def frame(self, *, shooter=None, prober=None):
        """Return a fresh native-resolution image for this region."""

        return self.observe(shooter=shooter, prober=prober).image


def _safe_text(value) -> str:
    try:
        return str(value)
    except Exception:
        return f"<unrepresentable {type(value).__name__}>"


def _safe_value(value) -> str:
    try:
        text = repr(value)
    except Exception:
        return f"<unrepresentable {type(value).__name__}>"
    return text if len(text) <= 160 else f"<{type(value).__name__} value>"


def _number(name: str, value) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RegionCaptureError(
            f"Region {name} must be a finite whole-pixel number, got"
            f" {_safe_value(value)}"
        )
    try:
        number = float(value)
    except Exception as exc:
        raise RegionCaptureError(
            f"Region {name} is unusable: {_safe_text(value)}"
        ) from exc
    if not math.isfinite(number) or not number.is_integer():
        raise RegionCaptureError(
            f"Region {name} must be a finite whole-pixel number, got"
            f" {_safe_value(value)}"
        )
    return int(number)


def _box(box) -> tuple[int, int, int, int]:
    if isinstance(box, (str, bytes, bytearray)):
        raise RegionCaptureError(
            f"Region box needs (left, top, width, height), got"
            f" {_safe_value(box)}"
        )
    try:
        parts = tuple(box)
    except Exception as exc:
        raise RegionCaptureError(
            f"Region box is unusable: {_safe_text(box)}"
        ) from exc
    if len(parts) != 4:
        raise RegionCaptureError(
            f"Region box needs 4 components, got {len(parts)}"
        )
    left, top, width, height = (
        _number(name, value)
        for name, value in zip(("left", "top", "width", "height"), parts)
    )
    if width <= 0 or height <= 0:
        raise RegionCaptureError(
            f"Region width and height must be positive, got"
            f" {width}x{height}"
        )
    return left, top, width, height


def _screen_geometry(screen) -> tuple[int, int, int, int]:
    try:
        values = (screen.left, screen.top, screen.width, screen.height)
    except Exception as exc:
        raise RegionCaptureError(
            f"Selected screen has unusable geometry: {_safe_text(exc)}"
        ) from exc
    try:
        numbers = tuple(_number(name, value) for name, value in zip(
            ("left", "top", "width", "height"), values
        ))
    except RegionCaptureError:
        raise
    if numbers[2] <= 0 or numbers[3] <= 0:
        raise RegionCaptureError("Selected screen dimensions must be positive")
    return numbers


def _checked_space(space) -> str:
    if type(space) is not str or space.strip().lower() not in {
        "screen", "desktop",
    }:
        raise RegionCaptureError(
            f"Region space must be 'screen' or 'desktop', got"
            f" {_safe_value(space)}"
        )
    return space.strip().lower()


def _checked_scale(scale) -> tuple[float, float]:
    if isinstance(scale, (int, float)) and not isinstance(scale, bool):
        scale = (scale, scale)
    try:
        parts = tuple(scale)
    except Exception as exc:
        raise RegionCaptureError(
            f"Region scale is unusable: {_safe_text(scale)}"
        ) from exc
    if len(parts) != 2:
        raise RegionCaptureError("Region scale needs two positive values")
    try:
        numbers = tuple(float(part) for part in parts)
    except Exception as exc:
        raise RegionCaptureError(
            f"Region scale is unusable: {_safe_text(scale)}"
        ) from exc
    if any(not math.isfinite(part) or part <= 0 for part in numbers):
        raise RegionCaptureError("Region scale needs two positive finite values")
    return numbers


def _resolve_screen(screen_or_index, shooter):
    if isinstance(screen_or_index, Screen):
        return screen_or_index
    if type(screen_or_index) is int and screen_or_index > 0:
        screens = _list_screens(shooter)
        for screen in screens:
            if screen.index == screen_or_index:
                return screen
        valid = ", ".join(str(screen.index) for screen in screens)
        raise RegionCaptureError(
            f"Unknown screen {screen_or_index}; valid screens: {valid}"
        )
    raise RegionCaptureError(
        f"Region screen must be a Screen or positive index, got"
        f" {_safe_value(screen_or_index)}"
    )


def _bounds(screen, requested):
    _, _, screen_width, screen_height = _screen_geometry(screen)
    left, top, width, height = requested
    right, bottom = left + width, top + height
    actual_left = max(0, left)
    actual_top = max(0, top)
    actual_right = min(screen_width, right)
    actual_bottom = min(screen_height, bottom)
    if actual_right <= actual_left or actual_bottom <= actual_top:
        raise RegionCaptureError(
            f"Region {requested!r} lies wholly outside screen bounds"
            f" (0, 0, {screen_width}, {screen_height})"
        )
    actual = (
        actual_left, actual_top,
        actual_right - actual_left, actual_bottom - actual_top,
    )
    return actual, actual != requested


def _validate_context_shape(context, screen, origin, size):
    """Validate a region context before any fresh region backend call."""

    context.validate()
    if (
        context.screen != screen
        or tuple(context.crop_offset) != tuple(origin)
        or tuple(context._reference_dimensions()) != tuple(size)
    ):
        raise RegionCaptureError(
            "Region coordinate context does not match the requested"
            " screen or bounds"
        )


def _as_context(screen, image, origin, scale, context=None):
    if context is not None:
        try:
            _validate_context_shape(context, screen, origin, image.size)
        except Exception as exc:
            raise RegionCaptureError(
                f"Region coordinate context is stale or invalid:"
                f" {_safe_text(exc)}"
            ) from exc
        return context
    from computer_use.grid import CoordinateContext

    try:
        return CoordinateContext.for_capture(
            Capture(image=image, screen=screen),
            crop_offset=origin,
            scale=scale,
            reference_size=image.size,
        )
    except Exception as exc:
        raise RegionCaptureError(
            f"Region has no usable coordinate context: {_safe_text(exc)}"
        ) from exc


def _decode(shot, size, screen):
    try:
        shot_size = tuple(shot.size)
        payload = shot.rgb
        if type(shot_size[0]) is not int or type(shot_size[1]) is not int:
            raise TypeError("capture dimensions must be integers")
        if not isinstance(payload, (bytes, bytearray, memoryview)):
            raise TypeError("capture pixels must be bytes-like")
        rgb = bytes(bytearray(payload))
    except Exception as exc:
        raise RegionCaptureError(
            f"Screen {screen.index} returned unusable region pixels:"
            f" {_safe_text(exc)}"
        ) from exc
    if shot_size != size:
        raise RegionCaptureError(
            f"Screen {screen.index} returned region dimensions {shot_size!r};"
            f" expected {size!r}"
        )
    if len(rgb) != size[0] * size[1] * 3:
        raise RegionCaptureError(
            f"Screen {screen.index} returned {len(rgb)} region pixel bytes;"
            f" expected {size[0] * size[1] * 3}"
        )
    try:
        return Image.frombytes("RGB", size, rgb)
    except Exception as exc:
        raise RegionCaptureError(
            f"Region pixels for screen {screen.index} are unusable:"
            f" {_safe_text(exc)}"
        ) from exc


def _capture_known(
    screen, origin, size, requested, clipped, shooter, prober, scale,
    context=None, fallback=False, note="", gate=True,
):
    if gate:
        require_permissions("screen", prober=prober)
    if context is not None:
        try:
            _validate_context_shape(context, screen, origin, size)
        except Exception as exc:
            if isinstance(exc, RegionCaptureError):
                raise
            raise RegionCaptureError(
                f"Region coordinate context is stale or invalid:"
                f" {_safe_text(exc)}"
            ) from exc
    active = shooter if shooter is not None else _shared_shooter()
    desktop = {
        "left": screen.left + origin[0],
        "top": screen.top + origin[1],
        "width": size[0],
        "height": size[1],
    }
    try:
        shot = active.grab(desktop)
        image = _decode(shot, size, screen)
    except Exception as exc:
        if not fallback:
            if isinstance(exc, RegionCaptureError):
                raise
            raise RegionCaptureError(
                f"Region capture is unavailable for screen {screen.index}:"
                f" {_safe_text(exc)}"
            ) from exc
        from computer_use.screen import capture_screen
        try:
            full = capture_screen(screen.index, shooter=active, prober=prober)
            image = full.image.crop((
                origin[0], origin[1], origin[0] + size[0], origin[1] + size[1],
            ))
            fallback = True
            note = (
                "bounded capture unavailable; used the explicitly requested"
                " full-screen fallback"
            )
        except Exception as fallback_exc:
            raise RegionCaptureError(
                f"Region capture is unavailable and full-screen fallback"
                f" failed: {_safe_text(fallback_exc)}"
            ) from fallback_exc
    context = _as_context(screen, image, origin, scale, context=context)

    captured_prober = prober

    def observe_again(*, shooter=None, prober=None):
        return _capture_known(
            screen, origin, size, requested, clipped,
            shooter if shooter is not None else active,
            captured_prober if prober is None else prober,
            scale, context=context, fallback=fallback, note=note,
        )

    return RegionCapture(
        image=image,
        screen=screen,
        origin=origin,
        size=size,
        scale=scale,
        context=context,
        requested=requested,
        clipped=clipped,
        fallback=fallback,
        note=note,
        _observer=observe_again,
    )


def capture_region(
    screen=1,
    region=None,
    shooter=None,
    prober=None,
    *,
    space="screen",
    fallback_full_screen=False,
    scale=1.0,
    context=None,
    screen_index=None,
    box=None,
) -> RegionCapture:
    """Capture a bounded region and return its source/mapping context.

    ``region`` is screen-local by default.  Set ``space='desktop'`` for
    absolute desktop coordinates.  A partial region is clipped; a wholly
    outside or invalid region is rejected before the backend is called.
    """

    if screen_index is not None:
        if screen != 1:
            raise RegionCaptureError(
                "Specify either screen or screen_index, not both"
            )
        screen = screen_index
    if box is not None:
        if region is not None:
            raise RegionCaptureError("Specify either region or box, not both")
        region = box
    if region is None:
        raise RegionCaptureError("A region box is required")
    checked_space = _checked_space(space)
    requested_box = _box(region)
    checked_scale = _checked_scale(scale)
    require_permissions("screen", prober=prober)

    source_capture = screen if isinstance(screen, Capture) else None
    if source_capture is not None:
        selected = source_capture.screen
        base_image = source_capture.image
        try:
            image_size = tuple(base_image.size)
        except Exception as exc:
            raise RegionCaptureError(
                f"Source capture has no usable image: {_safe_text(exc)}"
            ) from exc
        geometry = _screen_geometry(selected)
        if image_size != geometry[2:]:
            raise RegionCaptureError(
                "Source capture dimensions do not match its selected screen"
            )
        active = None
    else:
        selected = _resolve_screen(screen, shooter)
        base_image = None
        active = shooter if shooter is not None else _shared_shooter()

    left, top, width, height = requested_box
    if checked_space == "desktop":
        left -= selected.left
        top -= selected.top
    local_requested = (left, top, width, height)
    actual, clipped = _bounds(selected, local_requested)
    origin = actual[:2]
    size = actual[2:]

    if source_capture is not None:
        try:
            image = base_image.crop((
                origin[0], origin[1],
                origin[0] + size[0], origin[1] + size[1],
            ))
        except Exception as exc:
            raise RegionCaptureError(
                f"Source capture region is unusable: {_safe_text(exc)}"
            ) from exc
        return _region_from_image(
            selected, image, origin, size, local_requested, clipped,
            checked_scale, context,
        )

    return _capture_known(
        selected, origin, size, local_requested, clipped, active, prober,
        checked_scale, context=context, fallback=fallback_full_screen,
        gate=False,
    )


def _region_from_image(
    screen, image, origin, size, requested, clipped, scale, context,
):
    context = _as_context(screen, image, origin, scale, context=context)

    def observe_again(*, shooter=None, prober=None):
        if shooter is None:
            raise RegionCaptureError(
                "A source-capture region needs a shooter for fresh observation"
            )
        return _capture_known(
            screen, origin, size, requested, clipped, shooter, prober, scale,
            context=context,
        )

    return RegionCapture(
        image=image,
        screen=screen,
        origin=origin,
        size=size,
        scale=scale,
        context=context,
        requested=requested,
        clipped=clipped,
        note="source capture cropped at native resolution",
        _observer=observe_again,
    )


# Friendly aliases for callers that name the result/error generically.
Region = RegionCapture
RegionError = RegionCaptureError
capture_screen_region = capture_region


def region_observer(region: RegionCapture, *, as_image=False):
    """Return a callable that obtains bounded observations from a region."""

    if not isinstance(region, RegionCapture):
        raise RegionCaptureError("region_observer needs a RegionCapture")
    if as_image:
        return lambda: region.observe().image
    return region.observe
