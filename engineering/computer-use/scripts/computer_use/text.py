"""Read text out of a screen region with reliability marking.

Text observed through the accessibility tree is exact and reported as
observed; text from an OCR reader is pixel-guessed and reported as
inferred; anything else is reported unreadable rather than invented.
The native-resolution crop always travels with the result as the
authoritative reference that overrides extracted text on conflict.
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

from computer_use.grid import zoom_region

OBSERVED = "observed"
INFERRED = "inferred"
UNREADABLE = "unreadable"


class TextError(RuntimeError):
    """Raised when a text request itself is misused."""


@dataclass(frozen=True)
class TextReading:
    text: str
    reliability: str
    image: Image.Image
    offset: tuple[int, int]
    note: str = ""


def _intersects(element, box) -> bool:
    """Check that an element box overlaps the requested screen box."""

    try:
        ex, ey, ew, eh = (float(part) for part in tuple(element))
        bx, by, bw, bh = (float(part) for part in tuple(box))
    except Exception:
        return False
    return ex < bx + bw and bx < ex + ew and ey < by + bh and by < ey + eh


def _element_texts(elements, box) -> list:
    """Collect non-blank texts visible in the box, in layout order."""

    try:
        candidates = list(elements(box))
    except TypeError:
        candidates = list(elements())
    found = []
    for item in candidates:
        try:
            text, bounds = item
        except Exception:
            continue
        if type(text) is not str or not text.strip():
            continue
        if not _intersects(bounds, box):
            continue
        try:
            ox, oy, _, _ = (float(part) for part in tuple(bounds))
        except Exception:
            continue
        found.append((oy, ox, text.strip()))
    found.sort(key=lambda entry: (entry[0], entry[1]))
    return [text for _, _, text in found]


def _normalize_text(text: str) -> str:
    """Compare readings ignoring case and whitespace noise."""

    return " ".join(text.split()).casefold()


def _corroborated(lines, guessed: str) -> bool:
    """Check pixel text corroborates at least one observed line.

    OCR is noisy and incomplete, so exact full-text equality would
    manufacture conflicts; line-level containment asks only whether
    the image-derived text supports part of the tree reading.
    """

    haystack = _normalize_text(guessed)
    return any(
        line and line in haystack
        for line in (_normalize_text(item) for item in lines)
    )


def _read_ocr(guesser, crop):
    """Run the OCR reader, treating any failure as no reading."""

    try:
        guessed = guesser(crop)
    except Exception:
        return None
    if isinstance(guessed, str) and guessed.strip():
        return guessed.strip()
    return None


def _tesseract_ocr(crop: Image.Image):  # pragma: no cover - needs binary
    """Read pixels with tesseract when installed, else None."""

    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    if shutil.which("tesseract") is None:
        return None
    path = None
    try:
        handle, name = tempfile.mkstemp(
            prefix="computer-use-ocr-", suffix=".png",
        )
        path = name
        with open(handle, "wb") as stream:
            crop.save(stream, format="PNG")
        result = subprocess.run(
            ["tesseract", name, "stdout"], check=False, text=True,
            capture_output=True, timeout=60,
        )
        if result.returncode != 0:
            return None
        return result.stdout
    except Exception:
        return None
    finally:
        if path is not None:
            try:
                Path(path).unlink()
            except OSError:
                pass


def _live_ax_elements(box):  # pragma: no cover - needs a live desktop
    """List (text, bounds) for accessibility elements behind a box."""

    import ApplicationServices as AX
    from Cocoa import (
        NSApplicationActivationPolicyRegular,
        NSWorkspace,
    )

    def attribute(ref, name):
        try:
            ok, value = AX.AXUIElementCopyAttributeValue(ref, name, None)
        except Exception:
            return None
        return value if ok == 0 else None

    def frame(ref):
        position = attribute(ref, AX.kAXPositionAttribute)
        size = attribute(ref, AX.kAXSizeAttribute)
        if position is None or size is None:
            return None
        try:
            _, point = AX.AXValueGetValue(
                position, AX.kAXValueCGPointType, None,
            )
            _, extent = AX.AXValueGetValue(
                size, AX.kAXValueCGSizeType, None,
            )
            return (point.x, point.y, extent.width, extent.height)
        except Exception:
            return None

    collected: list = []
    visited = [0]

    def walk(ref, depth: int) -> None:
        if depth > 10 or visited[0] > 3000:
            return
        visited[0] += 1
        for name in (
            AX.kAXValueAttribute,
            AX.kAXTitleAttribute,
            AX.kAXDescriptionAttribute,
        ):
            value = attribute(ref, name)
            if isinstance(value, str) and value.strip():
                bounds = frame(ref)
                if bounds is not None:
                    collected.append((value.strip(), bounds))
                break
        children = attribute(ref, AX.kAXChildrenAttribute)
        if not children:
            return
        try:
            kids = list(children)[:60]
        except Exception:
            return
        for kid in kids:
            walk(kid, depth + 1)

    try:
        running = NSWorkspace.sharedWorkspace().runningApplications()
    except Exception:
        return []
    for candidate in list(running):
        try:
            regular = (
                candidate.activationPolicy()
                == NSApplicationActivationPolicyRegular
            )
        except Exception:
            continue
        if not regular:
            continue
        try:
            app = AX.AXUIElementCreateApplication(
                candidate.processIdentifier()
            )
            windows = attribute(app, AX.kAXWindowsAttribute) or ()
        except Exception:
            continue
        try:
            windows = list(windows)[:40]
        except Exception:
            continue
        for window in windows:
            try:
                if attribute(window, AX.kAXRoleAttribute) != "AXWindow":
                    continue
            except Exception:
                continue
            try:
                walk(window, 0)
            except Exception:
                continue
    return collected


def extract_region_text(image, box, offset=(0, 0), *, elements=None,
                        ocr=None) -> TextReading:
    """Read the text visible in a region of an image.

    ``box`` is (left, top, width, height) in image pixels; ``offset``
    places that image on the screen for element lookup. ``elements``
    maps a screen box to (text, bounds) pairs (default: the live
    accessibility tree); ``ocr`` maps the crop image to guessed text
    (default: tesseract when installed).
    """

    crop, crop_offset = zoom_region(image, box)
    try:
        ox, oy = (int(part) for part in tuple(offset))
    except Exception:
        raise TextError(
            f"Offset must be a pair of integers, got {offset!r}"
        ) from None
    reported = (crop_offset[0], crop_offset[1])
    screen_box = (
        ox + crop_offset[0], oy + crop_offset[1],
        crop.size[0], crop.size[1],
    )
    reader = elements if elements is not None else _live_ax_elements
    observed = _element_texts(reader, screen_box)
    guesser = ocr if ocr is not None else _tesseract_ocr
    if observed:
        guessed = _read_ocr(guesser, crop)
        if guessed is None or _corroborated(observed, guessed):
            return TextReading(
                text="\n".join(observed), reliability=OBSERVED,
                image=crop, offset=reported,
            )
        return TextReading(
            text=guessed, reliability=INFERRED, image=crop,
            offset=reported,
            note=(
                "Conflict: accessibility text"
                f" {chr(10).join(observed)!r} disagrees with"
                f" image-derived text {guessed!r}; the attached"
                " image is authoritative."
            ),
        )
    guessed = _read_ocr(guesser, crop)
    if guessed is not None:
        return TextReading(
            text=guessed, reliability=INFERRED, image=crop,
            offset=reported,
        )
    return TextReading(
        text="", reliability=UNREADABLE, image=crop, offset=reported,
        note=(
            "No accessibility text or OCR text was found in this"
            " region; the attached image is authoritative."
        ),
    )
