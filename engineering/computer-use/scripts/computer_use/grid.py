"""Coordinate reference overlays so positions are read, not estimated.

The agent always receives the original capture alongside a reference copy
carrying a labeled grid in the identical pixel space. When a full-screen
grid would be unreadable, a zoomed center crop is provided instead, with
its offset so crop coordinates still map to the full screen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

from computer_use.screen import Screen

GRID_MIN_STEP = 40
GRID_TARGET_COLUMNS = 12
FULL_MIN_WIDTH = 400
FULL_MIN_HEIGHT = 300
ZOOM_SOURCE_MIN_WIDTH = 100
ZOOM_SOURCE_MIN_HEIGHT = 75

LINE_COLOR = (0, 255, 255)
SHADOW_COLOR = (0, 0, 0)
TEXT_COLOR = (255, 255, 255)


class ReferenceError(RuntimeError):
    """Raised when no readable coordinate reference can be produced."""


class CoordinateContextError(ReferenceError):
    """Raised when a coordinate mapping is invalid or no longer current."""


@dataclass(frozen=True)
class CoordinatePoint:
    """A desktop point retaining its source screen and capture position."""

    x: float
    y: float
    screen: Screen
    capture: tuple[float, float]
    context: "CoordinateContext | None" = None


@dataclass(frozen=True)
class CoordinateContext:
    """Map observation-local points to one screen's desktop coordinates.

    ``scale`` is the number of source/capture pixels represented by one
    observation pixel.  ``crop_offset`` is expressed in source/capture
    pixels, so a point is mapped as ``offset + point * scale + screen origin``.
    """

    screen: Screen
    capture_size: tuple[float, float]
    crop_offset: tuple[float, float] = (0.0, 0.0)
    scale: tuple[float, float] = (1.0, 1.0)
    window_bounds: tuple[float, float, float, float] | None = None
    reference_size: tuple[float, float] | None = None
    stale: bool = False

    def __post_init__(self) -> None:
        _screen_geometry(self.screen)
        _size_pair("capture size", self.capture_size)
        _pair("crop offset", self.crop_offset)
        scale = _scale_pair(self.scale)
        crop = _pair("crop offset", self.crop_offset)
        source = _size_pair("capture size", self.capture_size)
        if self.reference_size is None:
            reference = (
                (source[0] - crop[0]) / scale[0],
                (source[1] - crop[1]) / scale[1],
            )
        else:
            reference = _size_pair("reference size", self.reference_size)
        reference = _size_pair("reference size", reference)
        if crop[0] < 0 or crop[1] < 0:
            raise CoordinateContextError(
                "Coordinate crop offset cannot be negative"
            )
        if (
            crop[0] + reference[0] * scale[0] > source[0]
            or crop[1] + reference[1] * scale[1] > source[1]
        ):
            raise CoordinateContextError(
                "Coordinate reference lies outside the capture bounds"
            )
        if self.window_bounds is not None:
            _window_box(self.window_bounds)

    @classmethod
    def for_capture(
        cls,
        capture,
        *,
        crop_offset=(0, 0),
        scale=1.0,
        window_bounds=None,
        reference_size=None,
    ) -> "CoordinateContext":
        """Build a context from a capture without losing its screen origin."""

        try:
            screen = capture.screen
            image_size = tuple(capture.image.size)
        except Exception as exc:
            raise CoordinateContextError(
                f"Capture has no usable coordinate context: {_safe_text(exc)}"
            ) from exc
        _size_pair("capture image size", image_size)
        geometry = _screen_geometry(screen)
        if reference_size is None:
            reference_size = image_size
        if isinstance(scale, (int, float)) and not isinstance(scale, bool):
            scale = (scale, scale)
        return cls(
            screen=screen,
            capture_size=(geometry[2], geometry[3]),
            crop_offset=crop_offset,
            scale=scale,
            window_bounds=window_bounds,
            reference_size=reference_size,
        )

    @classmethod
    def from_reference(cls, capture, reference, *, scale=1.0):
        """Recover the already-authenticated context of a reference."""

        existing = getattr(reference, "context", None)
        if isinstance(existing, cls):
            existing.validate()
            return existing
        try:
            offset = tuple(reference.offset)
            image = reference.image
        except Exception as exc:
            raise CoordinateContextError(
                f"Reference has no usable coordinate mapping: {_safe_text(exc)}"
            ) from exc
        return cls.for_capture(
            capture,
            crop_offset=offset,
            scale=scale,
            reference_size=image.size,
        )

    from_capture = for_capture

    @property
    def origin(self) -> tuple[float, float]:
        """Desktop origin of the selected source screen."""

        left, top, _, _ = _screen_geometry(self.screen)
        return (left, top)

    @property
    def dimensions(self) -> tuple[float, float]:
        """Native source dimensions represented by this context."""

        return _size_pair("capture size", self.capture_size)

    @property
    def is_stale(self) -> bool:
        return self.stale

    @property
    def valid(self) -> bool:
        return not self.stale

    def invalidate(self) -> "CoordinateContext":
        """Return a context that refuses further mapping."""

        return dataclass_replace(self, stale=True)

    def validate(self, capture=None, *, screen=None, window_bounds=None) -> bool:
        """Confirm that a fresh observation still supports this mapping."""

        if self.stale:
            raise CoordinateContextError(
                "Coordinate context is stale; capture a fresh observation"
            )
        current = screen
        if capture is not None:
            try:
                current = capture.screen
                image_size = tuple(capture.image.size)
            except Exception as exc:
                raise CoordinateContextError(
                    f"Fresh capture has no usable coordinate context:"
                    f" {_safe_text(exc)}"
                ) from exc
            reference = self._reference_dimensions()
            full = _size_pair("fresh capture size", image_size)
            if full != self.dimensions and full != reference:
                raise CoordinateContextError(
                    "Coordinate context is stale: observation dimensions changed"
                )
        if current is not None and _screen_geometry(current) != _screen_geometry(self.screen):
            raise CoordinateContextError(
                "Coordinate context is stale: screen layout changed"
            )
        if window_bounds is not None and self.window_bounds != window_bounds:
            raise CoordinateContextError(
                "Coordinate context is stale: window bounds changed"
            )
        return True

    def to_capture(self, x, y) -> tuple[float, float]:
        """Map a reference-local point to source/capture pixel coordinates."""

        if self.stale:
            raise CoordinateContextError(
                "Coordinate context is stale; capture a fresh observation"
            )
        px, py = _point("x", x), _point("y", y)
        reference = self._reference_dimensions()
        if not (0 <= px < reference[0] and 0 <= py < reference[1]):
            raise CoordinateContextError(
                f"Point ({_safe_text(x)}, {_safe_text(y)}) is outside"
                f" the observation bounds {_safe_text(reference)}"
            )
        scale_x, scale_y = _scale_pair(self.scale)
        offset_x, offset_y = _pair("crop offset", self.crop_offset)
        result = (offset_x + px * scale_x, offset_y + py * scale_y)
        source = _size_pair("capture size", self.capture_size)
        if not (0 <= result[0] < source[0] and 0 <= result[1] < source[1]):
            raise CoordinateContextError(
                "Mapped point is outside the selected capture bounds"
            )
        return result

    def to_desktop(self, x, y) -> CoordinatePoint:
        """Map a reference-local point to an absolute desktop point."""

        capture_point = self.to_capture(x, y)
        left, top = self.origin
        return CoordinatePoint(
            x=left + capture_point[0],
            y=top + capture_point[1],
            screen=self.screen,
            capture=capture_point,
            context=self,
        )

    map_point = to_desktop
    map_to_desktop = to_desktop

    def _reference_dimensions(self) -> tuple[float, float]:
        if self.reference_size is not None:
            return _size_pair("reference size", self.reference_size)
        source = _size_pair("capture size", self.capture_size)
        crop = _pair("crop offset", self.crop_offset)
        scale = _scale_pair(self.scale)
        return (
            (source[0] - crop[0]) / scale[0],
            (source[1] - crop[1]) / scale[1],
        )

    def contains(self, x, y) -> bool:
        """Return whether a reference-local point can be mapped safely."""

        try:
            self.to_capture(x, y)
        except CoordinateContextError:
            return False
        return True


def dataclass_replace(value, **changes):
    """Small local wrapper so context invalidation has one import boundary."""

    from dataclasses import replace

    return replace(value, **changes)


def _safe_text(value) -> str:
    try:
        return str(value)
    except Exception:
        return f"<unrepresentable {type(value).__name__}>"


def _point(name: str, value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CoordinateContextError(
            f"Coordinate {name} is not finite numeric data: {_safe_text(value)}"
        )
    try:
        number = float(value)
    except Exception as exc:
        raise CoordinateContextError(
            f"Coordinate {name} is not usable: {_safe_text(value)}"
        ) from exc
    if not math.isfinite(number):
        raise CoordinateContextError(
            f"Coordinate {name} is not finite: {_safe_text(value)}"
        )
    return number


def _pair(name: str, value) -> tuple[float, float]:
    try:
        parts = tuple(value)
    except Exception as exc:
        raise CoordinateContextError(
            f"{name} must contain two numeric values: {_safe_text(value)}"
        ) from exc
    if len(parts) != 2:
        raise CoordinateContextError(
            f"{name} must contain two numeric values"
        )
    return (_point(f"{name}[0]", parts[0]), _point(f"{name}[1]", parts[1]))


def _size_pair(name: str, value) -> tuple[float, float]:
    pair = _pair(name, value)
    if pair[0] <= 0 or pair[1] <= 0:
        raise CoordinateContextError(f"{name} must be positive")
    return pair


def _scale_pair(value) -> tuple[float, float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = (value, value)
    pair = _pair("scale", value)
    if pair[0] <= 0 or pair[1] <= 0:
        raise CoordinateContextError("Coordinate scale must be positive")
    return pair


def _window_box(value) -> tuple[float, float, float, float]:
    try:
        parts = tuple(value)
    except Exception as exc:
        raise CoordinateContextError(
            f"window bounds are unusable: {_safe_text(value)}"
        ) from exc
    if len(parts) != 4:
        raise CoordinateContextError("window bounds need (x, y, width, height)")
    x, y, width, height = (_point(f"window[{i}]", part)
                           for i, part in enumerate(parts))
    if width <= 0 or height <= 0:
        raise CoordinateContextError("window bounds need positive size")
    return x, y, width, height


def _screen_geometry(screen) -> tuple[float, float, float, float]:
    try:
        values = (
            screen.left, screen.top, screen.width, screen.height,
        )
    except Exception as exc:
        raise CoordinateContextError(
            f"Screen has unusable geometry: {_safe_text(exc)}"
        ) from exc
    left, top, width, height = (
        _point(name, value)
        for name, value in zip(("left", "top", "width", "height"), values)
    )
    if width <= 0 or height <= 0:
        raise CoordinateContextError("Screen dimensions must be positive")
    return left, top, width, height


@dataclass(frozen=True)
class PreparedReference:
    original: Image.Image
    image: Image.Image
    kind: str
    offset: tuple[int, int]
    step: int
    context: CoordinateContext | None = None


_LABEL_FONT = None


def _label_font():
    global _LABEL_FONT
    if _LABEL_FONT is None:
        _LABEL_FONT = ImageFont.load_default()
    return _LABEL_FONT


_PROBE_DRAW = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def _label_box(text: str, xy: tuple[int, int]) -> tuple[int, int, int, int]:
    """Measure the exact stroked box the drawing path will paint."""

    return _PROBE_DRAW.textbbox(xy, text, font=_label_font(), stroke_width=1)


def _readable_reference(width: int, height: int, step: int) -> bool:
    """Check that both axes keep one fully visible interior label."""

    def axis_readable(size: int, vertical: bool, limit_w: int, limit_h: int) -> bool:
        multiple = 1
        while multiple * step < size:
            position = multiple * step
            if vertical:
                box = _label_box(str(position), (4, position + 4))
            else:
                box = _label_box(str(position), (position + 4, 4))
            if box[0] >= 0 and box[1] >= 0 and box[2] <= limit_w and box[3] <= limit_h:
                return True
            multiple += 1
        return False

    return axis_readable(width, False, width, height) and axis_readable(
        height, True, width, height
    )


def choose_step(width: int) -> int:
    """Pick a grid step that keeps column labels readable."""

    return max(GRID_MIN_STEP, width // GRID_TARGET_COLUMNS)


def add_coordinate_reference(image: Image.Image, step: int | None = None) -> Image.Image:
    """Draw a labeled grid copy without shifting any pixel."""

    base = image if image.mode == "RGB" else image.convert("RGB")
    overlay = base.copy()
    width, height = overlay.size
    resolved_step = step if step is not None else choose_step(width)
    if resolved_step <= 0:
        raise ReferenceError(f"Grid step must be positive: {resolved_step!r}")
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.load_default()
    for x in range(0, width, resolved_step):
        draw.line([(x, 0), (x, height - 1)], fill=SHADOW_COLOR)
        if x + 1 < width:
            draw.line([(x + 1, 0), (x + 1, height - 1)], fill=LINE_COLOR)
        draw.text((x + 4, 4), str(x), font=font, fill=TEXT_COLOR,
                  stroke_width=1, stroke_fill=SHADOW_COLOR)
    for y in range(0, height, resolved_step):
        draw.line([(0, y), (width - 1, y)], fill=SHADOW_COLOR)
        if y + 1 < height:
            draw.line([(0, y + 1), (width - 1, y + 1)], fill=LINE_COLOR)
        if y > 0:
            draw.text((4, y + 4), str(y), font=font, fill=TEXT_COLOR,
                      stroke_width=1, stroke_fill=SHADOW_COLOR)
    return overlay


def _safe_number_text(value) -> str:
    """Render a region number without trusting its size or repr."""

    if type(value) is int:
        try:
            return repr(value)
        except ValueError:
            sign = "-" if value < 0 else ""
            digits = int(value.bit_length() * 0.30103) + 1
            return f"{sign}<integer with about {digits} digits>"
    try:
        return repr(value)
    except Exception:
        return f"<unrepresentable {type(value).__name__}>"


def zoom_region(
    image: Image.Image, box: tuple[float, float, float, float]
) -> tuple[Image.Image, tuple[int, int]]:
    """Crop a region with clamping, returning the crop and its offset."""

    try:
        parts = tuple(box)
    except Exception as exc:
        raise ReferenceError(
            f"Unusable zoom region: {type(exc).__name__}"
        ) from exc
    if len(parts) != 4:
        raise ReferenceError(
            f"Zoom region needs 4 components, got {len(parts)}"
        )
    names = ("left", "top", "width", "height")
    numbers: list[int] = []
    for name, raw in zip(names, parts):
        try:
            finite = (
                not isinstance(raw, bool)
                and isinstance(raw, (int, float))
                and math.isfinite(float(raw))
            )
        except Exception as exc:
            raise ReferenceError(
                f"Unusable zoom region {name}: {type(exc).__name__}"
            ) from exc
        if not finite:
            raise ReferenceError(
                f"Zoom region {name} is not finite:"
                f" {_safe_number_text(raw)}"
            )
        try:
            numbers.append(int(raw))
        except Exception as exc:
            raise ReferenceError(
                f"Unusable zoom region {name}: {type(exc).__name__}"
            ) from exc
    left, top, width, height = numbers
    if width <= 0 or height <= 0:
        raise ReferenceError(
            f"Zoom region needs positive size: {_safe_number_text(width)}x"
            f"{_safe_number_text(height)}"
        )
    x0 = max(0, left)
    y0 = max(0, top)
    x1 = min(image.size[0], left + width)
    y1 = min(image.size[1], top + height)
    if x1 <= x0 or y1 <= y0:
        raise ReferenceError(
            f"Zoom region ({left}, {top}, {width}, {height})"
            f" lies outside the image bounds"
            f" {image.size[0]}x{image.size[1]}"
        )
    return image.crop((x0, y0, x1, y1)), (x0, y0)


def to_screen(x: float, y: float, offset: tuple[int, int]) -> tuple[float, float]:
    """Map reference-image coordinates back to captured-image pixels."""

    return (offset[0] + x, offset[1] + y)


def _reference_context(capture, image, offset, scale):
    """Build the mapping carried by a prepared reference."""

    try:
        return CoordinateContext.for_capture(
            capture,
            crop_offset=offset,
            scale=scale,
            reference_size=image.size,
        )
    except CoordinateContextError as exc:
        raise ReferenceError(
            f"Capture cannot provide a usable coordinate context: {_safe_text(exc)}"
        ) from exc


def prepare_reference(capture, scale=1.0) -> PreparedReference:
    """Provide the original capture plus a readable gridded reference."""

    try:
        image = capture.image
        width, height = image.size
    except (AttributeError, TypeError) as exc:
        raise ReferenceError(f"Capture has no usable image: {exc}") from exc
    if width >= FULL_MIN_WIDTH and height >= FULL_MIN_HEIGHT:
        step = choose_step(width)
        if _readable_reference(width, height, step):
            return PreparedReference(
                original=image,
                image=add_coordinate_reference(image, step),
                kind="full",
                offset=(0, 0),
                step=step,
                context=_reference_context(capture, image, (0, 0), scale),
            )
    if width < ZOOM_SOURCE_MIN_WIDTH or height < ZOOM_SOURCE_MIN_HEIGHT:
        raise ReferenceError(
            f"Image {width}x{height} is too small for a readable reference"
        )
    crop_width, crop_height = width // 2, height // 2
    crop_step = choose_step(crop_width)
    if not _readable_reference(crop_width, crop_height, crop_step):
        raise ReferenceError(
            f"Image {width}x{height} cannot support a readable"
            " zoomed reference"
        )
    left, top = (width - crop_width) // 2, (height - crop_height) // 2
    crop, offset = zoom_region(image, (left, top, crop_width, crop_height))
    step = choose_step(crop.size[0])
    return PreparedReference(
        original=image,
        image=add_coordinate_reference(crop, step),
        kind="zoom",
        offset=offset,
        step=step,
        context=_reference_context(capture, crop, offset, scale),
    )
