"""Read text out of a screen region with reliability marking (T015).

Text comes from the accessibility tree when elements are visible in the
region (directly observed), from an OCR reader when one is available
(inferred), and is otherwise reported unreadable rather than invented.
The native-resolution crop always travels with the result as the
authoritative reference that overrides extracted text on conflict.
"""

from __future__ import annotations

import pytest
from PIL import Image

from computer_use.grid import ReferenceError
from computer_use.text import TextReading, extract_region_text


def test_observed_text_comes_from_region_elements() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    def elements(box):
        assert box == (20, 10, 60, 40)
        return [
            ("Hello", (25, 15, 50, 12)),
            ("Elsewhere", (150, 80, 40, 10)),
        ]

    reading = extract_region_text(image, (20, 10, 60, 40), elements=elements)

    assert isinstance(reading, TextReading)
    assert reading.text == "Hello"
    assert reading.reliability == "observed"
    assert reading.offset == (20, 10)
    assert reading.image.size == (60, 40)
    assert reading.image.tobytes() == image.crop((20, 10, 80, 50)).tobytes()


def test_region_elements_read_in_layout_order() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    def elements(box):
        return [
            ("second", (10, 40, 30, 10)),
            ("first", (10, 10, 30, 10)),
        ]

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=elements,
    )

    assert reading.text == "first\nsecond"
    assert reading.reliability == "observed"


def test_ocr_text_is_marked_inferred() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=lambda box: [],
        ocr=lambda crop: "Guessed",
    )

    assert reading.text == "Guessed"
    assert reading.reliability == "inferred"


def test_blank_ocr_reports_unreadable() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=lambda box: [],
        ocr=lambda crop: "   ",
    )

    assert reading.text == ""
    assert reading.reliability == "unreadable"
    assert reading.note != ""


def test_no_source_reports_unreadable() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=lambda box: [], ocr=None,
    )

    assert reading.text == ""
    assert reading.reliability == "unreadable"


def test_out_of_bounds_names_valid_bounds() -> None:
    image = Image.new("RGB", (200, 100))

    with pytest.raises(ReferenceError, match=r"200x100"):
        extract_region_text(image, (500, 500, 10, 10), elements=lambda b: [])


def test_conflicting_sources_report_conflict_with_image_authority() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    def elements(box):
        return [("Tree text", (10, 10, 50, 12))]

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=elements,
        ocr=lambda crop: "Pixel text",
    )

    assert reading.text == "Pixel text"
    assert reading.reliability == "inferred"
    assert "conflict" in reading.note.lower()
    assert "image" in reading.note.lower()
    assert "Tree text" in reading.note
    assert reading.image.size == (200, 100)


def test_agreeing_sources_return_observed() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))

    def elements(box):
        return [("Same words", (10, 10, 50, 12))]

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=elements,
        ocr=lambda crop: "same  words",
    )

    assert reading.text == "Same words"
    assert reading.reliability == "observed"
    assert reading.note == ""


def test_pixel_reader_runs_despite_observed_text() -> None:
    image = Image.new("RGB", (200, 100), (255, 255, 255))
    seen: list = []

    def elements(box):
        return [("Same", (10, 10, 50, 12))]

    def ocr(crop):
        seen.append(crop.size)
        return "Same"

    reading = extract_region_text(
        image, (0, 0, 200, 100), elements=elements, ocr=ocr,
    )

    assert reading.reliability == "observed"
    assert seen == [(200, 100)]


def test_live_textedit_paragraph_reads_observed() -> None:
    import time

    from computer_use import keyboard
    from computer_use.apps import open_app
    from computer_use.screen import capture_screen

    marker = "Tesseract never wrote this line"
    open_app("TextEdit")
    keyboard.hotkey("cmd", "n")
    time.sleep(1.0)
    keyboard.type_text(marker)
    time.sleep(1.5)

    capture = capture_screen(1)
    width, height = capture.image.size
    reading = extract_region_text(capture.image, (0, 0, width, height))

    assert reading.reliability == "observed"
    assert marker in reading.text
