"""Paced text delivery with separate field-acceptance proof (T010)."""

from __future__ import annotations

import pytest

import computer_use.keyboard as keyboard
from computer_use.keyboard import KeyActionError, TypeResult, type_text


class Board:
    def __init__(self, fail=()):
        self.fail = set(fail)
        self.typed = []

    def type_char(self, char):
        if char in self.fail:
            raise keyboard.UnsupportedCharacter(char)
        self.typed.append(char)
        return True


def test_type_text_uses_bounded_inter_key_pacing(monkeypatch):
    board = Board()
    sleeps = []
    monkeypatch.setattr(keyboard.time, "sleep", sleeps.append)

    result = type_text("abc", controller=board, interval=0.1, settle=0.2)

    assert isinstance(result, TypeResult)
    assert result.typed == "abc"
    assert result.delivered is True
    assert board.typed == ["a", "b", "c"]
    assert sleeps == [0.1, 0.1, 0.2]


def test_invalid_pacing_is_rejected_before_delivery():
    board = Board()

    for kwargs in (
        {"interval": -1},
        {"interval": 2},
        {"interval": 10**10000},
        {"settle": float("inf")},
    ):
        with pytest.raises(KeyActionError, match="pace|interval|settle"):
            type_text("abc", controller=board, **kwargs)

    assert board.typed == []


def test_unconfirmed_focus_stops_before_typing():
    board = Board()

    with pytest.raises(KeyActionError, match="focus"):
        type_text("abc", controller=board, focus_check=lambda: False)

    assert board.typed == []


def test_delivery_and_exact_field_acceptance_are_reported_separately():
    values = iter(["partial", "exact"])
    board = Board()

    result = type_text(
        "exact", controller=board,
        field_reader=lambda app: next(values),
        acceptance_timeout=1, acceptance_interval=0,
    )

    assert result.delivered is True
    assert result.acceptance.status == "accepted"
    assert result.accepted is True
    assert result.acceptance.expected == "exact"


def test_full_delivery_does_not_claim_wrong_field_was_accepted():
    board = Board()

    result = type_text(
        "wanted ", controller=board,
        field_reader=lambda app: "other",
        acceptance_timeout=0, acceptance_interval=0,
    )

    assert result.typed == "wanted "
    assert result.failed == ()
    assert result.delivered is True
    assert result.accepted is False
    assert result.acceptance.status == "timed_out"
    assert result.acceptance.latest.value == "other"


def test_failed_character_is_preserved_and_named():
    board = Board(fail={"é"})

    result = type_text("café", controller=board, interval=0)

    assert result.text == "café"
    assert result.typed == "caf"
    assert result.failed == ("é",)
    assert result.delivered is False
    assert result.accepted is None


def test_slow_field_can_settle_with_bounded_acceptance_polling():
    states = iter(["d", "do", "done"])
    board = Board()

    result = type_text(
        "done", controller=board,
        field_reader=lambda app: next(states),
        acceptance_timeout=1, acceptance_interval=0,
    )

    assert result.accepted is True
    assert len(result.acceptance.observations) == 3
