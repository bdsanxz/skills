"""Verify every step by re-observing (T008).

Verification discipline turns isolated actions into a trustworthy loop:
after every state-changing action the next decision is made from a fresh
capture taken after that action, never from a cached pre-action image.
When a fresh capture cannot be obtained, the step is reported as
inconclusive rather than assumed successful.
"""

from __future__ import annotations

from dataclasses import dataclass


class VerifyError(RuntimeError):
    """Raised when a verification step itself is misused."""


@dataclass(frozen=True)
class VerifiedStep:
    description: str
    outcome: object
    frame: bytes | None
    verified: bool
    note: str


@dataclass(frozen=True)
class SequenceReport:
    steps: tuple
    summary: str
    final_frame: bytes | None
    all_verified: bool


def _safe_cause(exc: Exception) -> str:
    """Render an observation failure without trusting its conversion."""

    try:
        return str(exc)
    except Exception:
        return f"<unprintable {type(exc).__name__}>"


def _safe_value(value) -> str:
    """Render caller-supplied data without trusting it."""

    try:
        text = repr(value)
    except Exception:
        return f"<unprintable {type(value).__name__}>"
    if len(text) > 120:
        return (
            f"<{type(value).__name__} with"
            f" a {len(text)}-character representation>"
        )
    return text


def _checked_description(description) -> str:
    """Accept only exact non-blank step descriptions."""

    if type(description) is not str or not description.strip():
        raise VerifyError(
            f"Step description must be a non-blank string,"
            f" got {_safe_value(description)}"
        )
    return description.strip()


def _default_observer():
    """Capture the primary screen as fresh frame bytes."""

    from computer_use.screen import capture_screen

    return capture_screen(1).image.tobytes()


def _observe(observer):
    """Take one observation as exact base bytes, or None when unusable."""

    raw = observer()
    if not isinstance(raw, (bytes, bytearray, memoryview)):
        return None
    try:
        converted = bytes(bytearray(raw))
    except Exception:
        return None
    if type(converted) is not bytes or len(converted) == 0:
        return None
    return converted


def verify_step(description, action, observer=None) -> VerifiedStep:
    """Run one action, then verify it against a fresh post-action capture."""

    checked = _checked_description(description)
    if not callable(action):
        raise VerifyError(
            f"Step action must be callable, got {_safe_value(action)}"
        )
    watch = observer if observer is not None else _default_observer
    outcome = action()
    try:
        frame = _observe(watch)
    except Exception as exc:
        return VerifiedStep(
            description=checked,
            outcome=outcome,
            frame=None,
            verified=False,
            note=f"inconclusive: fresh capture failed: {_safe_cause(exc)}",
        )
    if frame is None:
        return VerifiedStep(
            description=checked,
            outcome=outcome,
            frame=None,
            verified=False,
            note="inconclusive: observation did not yield frame bytes",
        )
    return VerifiedStep(
        description=checked,
        outcome=outcome,
        frame=frame,
        verified=True,
        note=f"verified against a fresh capture after {checked}",
    )


def run_sequence(steps, observer=None) -> SequenceReport:
    """Run ordered steps, observing freshly after each before the next."""

    ordered = list(steps)
    if not ordered:
        raise VerifyError("A sequence needs at least one step")
    done: list = []
    for description, action in ordered:
        step = verify_step(description, action, observer=observer)
        done.append(step)
        if not step.verified:
            break
    verified_count = sum(1 for step in done if step.verified)
    total = len(ordered)
    if len(done) == total and verified_count == total:
        summary = (
            f"completed {total} steps, all verified:"
            f" {', '.join(step.description for step in done)}"
        )
    else:
        summary = (
            f"stopped after {len(done)} of {total} steps"
            f" at inconclusive '{done[-1].description}':"
            f" {', '.join(step.description for step in done)}"
        )
    final_frame = done[-1].frame
    return SequenceReport(
        steps=tuple(done),
        summary=summary,
        final_frame=final_frame,
        all_verified=verified_count == total,
    )
