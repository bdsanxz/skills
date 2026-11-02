"""Exact field acceptance and commit waits (T007)."""

from __future__ import annotations

import pytest

from computer_use.conditions import FieldWaitResult, wait_for_field


def test_field_wait_preserves_boundary_whitespace_and_polls_fresh_values():
    values = iter([" draft", " draft ", " draft "])
    reads = []

    def reader(app):
        reads.append(app)
        return next(values)

    result = wait_for_field(
        "Editor", " draft ", reader=reader,
        timeout=1, poll_interval=0,
    )

    assert isinstance(result, FieldWaitResult)
    assert result.status == "accepted"
    assert result.satisfied is True
    assert result.accepted is True
    assert result.latest.value == " draft "
    assert [sample.value for sample in result.observations] == [
        " draft", " draft ",
    ]
    assert reads == ["Editor", "Editor"]


def test_field_wait_times_out_with_partial_or_wrong_latest_value():
    result = wait_for_field(
        "Editor", "wanted ",
        reader=lambda app: "wrong",
        timeout=0, poll_interval=0,
    )

    assert result.status == "timed_out"
    assert result.satisfied is False
    assert result.accepted is False
    assert result.expected == "wanted "
    assert result.latest.value == "wrong"


def test_commit_wait_needs_commit_evidence_in_addition_to_exact_value():
    states = iter([
        {"value": "done", "committed": False},
        {"value": "done", "committed": True},
    ])
    result = wait_for_field(
        "Editor", "done", reader=lambda app: next(states),
        committed=True, timeout=1, poll_interval=0,
    )

    assert result.status == "committed"
    assert result.satisfied is True
    assert result.accepted is True
    assert result.committed is True


def test_exact_value_does_not_get_relabelled_as_committed():
    result = wait_for_field(
        "Editor", "done",
        reader=lambda app: {"value": "done", "committed": False},
        committed=True, timeout=0, poll_interval=0,
    )

    assert result.status == "timed_out"
    assert result.accepted is True
    assert result.committed is False
    assert result.satisfied is False


def test_unavailable_field_reader_is_explicit():
    def broken(app):
        raise OSError("field oracle unavailable")

    result = wait_for_field(
        "Editor", "done", reader=broken,
        timeout=0, poll_interval=0,
    )

    assert result.status == "unavailable"
    assert result.satisfied is False
    assert "field oracle unavailable" in result.evidence


def test_missing_value_in_mapping_is_unavailable():
    result = wait_for_field(
        "Editor", "done", reader=lambda app: {"value": None},
        timeout=0, poll_interval=0,
    )

    assert result.status == "unavailable"
    assert result.satisfied is False


def test_custom_field_reader_may_be_zero_argument():
    result = wait_for_field(
        "Editor", "done", reader=lambda: "done",
        timeout=0, poll_interval=0,
    )

    assert result.status == "accepted"


def test_invalid_field_request_is_rejected_before_reader_call():
    calls = []

    with pytest.raises(ValueError, match="string"):
        wait_for_field(
            "Editor", None, reader=lambda app: calls.append(app),
        )

    assert calls == []
