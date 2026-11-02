"""Recover a failed step with progress kept (T009).

When a performed action shows no intended effect on the fresh capture,
the agent recovers without losing what already worked: the failed step
is retried (optionally after a refresh hook that re-reads position,
zooms, or restores focus) while earlier successful steps are never
re-run. When retries are exhausted, the report asks a specific operator
question with all progress kept.
"""

from __future__ import annotations

from dataclasses import dataclass


class RecoveryError(RuntimeError):
    """Raised when a recovery request itself is misused."""


@dataclass(frozen=True)
class Attempt:
    number: int
    outcome: object
    frame: bytes | None
    effect_seen: bool
    note: str


@dataclass(frozen=True)
class RecoveryReport:
    description: str
    attempts: tuple
    recovered: bool
    progress: tuple
    question: str | None
    final_frame: bytes | None
    unresolved: str | None = None

    @property
    def confirmed_progress(self) -> tuple:
        return self.progress


def _safe_cause(exc: Exception) -> str:
    """Render a failure without trusting its string conversion."""

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
        raise RecoveryError(
            f"Step description must be a non-blank string,"
            f" got {_safe_value(description)}"
        )
    return description.strip()


def _checked_callable(label, value):
    """Accept only callable hooks, rejecting anything else early."""

    if not callable(value):
        raise RecoveryError(
            f"{label} must be callable, got {_safe_value(value)}"
        )
    return value


def _checked_progress(progress) -> tuple:
    """Keep preserved progress as exact-string step descriptions."""

    try:
        items = tuple(progress)
    except Exception:
        raise RecoveryError(
            f"Progress must be an iterable of step descriptions,"
            f" got {_safe_value(progress)}"
        )
    if isinstance(progress, (str, bytes)):
        raise RecoveryError(
            f"Progress must be an iterable of step descriptions,"
            f" got {_safe_value(progress)}"
        )
    for item in items:
        if type(item) is not str or not item.strip():
            raise RecoveryError(
                f"Progress entries must be non-blank step descriptions,"
                f" got {_safe_value(item)}"
            )
    return tuple(item.strip() for item in items)


def _checked_attempts(max_attempts) -> int:
    """Accept only genuine positive integers for the retry budget."""

    if type(max_attempts) is not int or max_attempts < 1:
        raise RecoveryError(
            f"max_attempts must be a positive integer,"
            f" got {_safe_value(max_attempts)}"
        )
    return max_attempts


def _default_observer():
    """Capture the primary screen as fresh frame bytes."""

    from computer_use.screen import capture_screen

    return capture_screen(1).image.tobytes()


def _observe(observer):
    """Take one observation as exact base bytes.

    Observer-call and payload-conversion exceptions propagate so the
    retry loop can record their safe cause; unusable payloads yield None.
    """

    raw = observer()
    if not isinstance(raw, (bytes, bytearray, memoryview)):
        return None
    converted = bytes(bytearray(raw))
    if type(converted) is not bytes or len(converted) == 0:
        return None
    return converted


def _acceptance_failure(outcome) -> bool:
    """Recognize delivered text whose semantic field proof did not pass."""

    try:
        delivered = getattr(outcome, "delivered", None)
        accepted = getattr(outcome, "accepted", None)
    except Exception:
        return False
    return type(delivered) is bool and delivered and type(accepted) is bool \
        and not accepted


def recover_step(description, action, check, observer=None, refresh=None,
                 progress=(), max_attempts=3) -> RecoveryReport:
    """Retry one failed step until its effect shows or budget runs out."""

    checked = _checked_description(description)
    _checked_callable("action", action)
    _checked_callable("check", check)
    if refresh is not None:
        _checked_callable("refresh", refresh)
    kept = _checked_progress(progress)
    budget = _checked_attempts(max_attempts)
    if observer is not None:
        _checked_callable("observer", observer)
    watch = observer if observer is not None else _default_observer

    attempts: list = []
    final_frame: bytes | None = None
    for number in range(1, budget + 1):
        if number > 1 and refresh is not None:
            try:
                refresh()
            except Exception as exc:
                note = f"refresh failed: {_safe_cause(exc)}"
                attempts.append(Attempt(
                    number=number, outcome=None, frame=None,
                    effect_seen=False, note=note,
                ))
                continue
        try:
            outcome = action()
        except Exception as exc:
            attempts.append(Attempt(
                number=number, outcome=None, frame=None,
                effect_seen=False,
                note=f"action failed: {_safe_cause(exc)}",
            ))
            continue
        try:
            frame = _observe(watch)
        except Exception as exc:
            note = (
                f"inconclusive: fresh capture failed:"
                f" {_safe_cause(exc)}"
            )
            if _acceptance_failure(outcome):
                note += (
                    "; text was delivered but field acceptance was not"
                    " established; dependent work must stop"
                )
            attempts.append(Attempt(
                number=number, outcome=outcome, frame=None,
                effect_seen=False, note=note,
            ))
            if _acceptance_failure(outcome):
                break
            continue
        final_frame = frame
        if frame is None:
            note = "inconclusive: fresh capture unusable"
            if _acceptance_failure(outcome):
                note = (
                    "text was delivered but field acceptance was not"
                    " established; dependent work must stop"
                )
            attempts.append(Attempt(
                number=number, outcome=outcome, frame=None,
                effect_seen=False, note=note,
            ))
            if _acceptance_failure(outcome):
                break
            continue
        if _acceptance_failure(outcome):
            attempts.append(Attempt(
                number=number, outcome=outcome, frame=frame,
                effect_seen=False,
                note=(
                    "text was delivered but field acceptance was not"
                    " established; dependent work must stop"
                ),
            ))
            break
        try:
            seen = check(frame)
        except Exception as exc:
            attempts.append(Attempt(
                number=number, outcome=outcome, frame=frame,
                effect_seen=False,
                note=f"effect check failed: {_safe_cause(exc)}",
            ))
            continue
        if type(seen) is not bool:
            attempts.append(Attempt(
                number=number, outcome=outcome, frame=frame,
                effect_seen=False,
                note=(
                    "effect check returned a non-boolean result;"
                    " verification is inconclusive"
                ),
            ))
            continue
        if seen:
            attempts.append(Attempt(
                number=number, outcome=outcome, frame=frame,
                effect_seen=True,
                note=f"effect of {checked} visible on fresh capture",
            ))
            return RecoveryReport(
                description=checked,
                attempts=tuple(attempts),
                recovered=True,
                progress=kept,
                question=None,
                final_frame=frame,
            )
        attempts.append(Attempt(
            number=number, outcome=outcome, frame=frame,
            effect_seen=False,
            note=f"effect of {checked} absent from fresh capture",
        ))

    last_note = attempts[-1].note if attempts else "no attempts ran"
    if kept:
        preserved = f" Preserved progress: {', '.join(kept)}."
    else:
        preserved = " No earlier progress was recorded."
    actual_attempts = len(attempts)
    question = (
        f"Step '{checked}' did not show its effect after"
        f" {actual_attempts} attempts ({last_note}).{preserved}"
        f" What should I change before retrying '{checked}'?"
    )
    return RecoveryReport(
        description=checked,
        attempts=tuple(attempts),
        recovered=False,
        progress=kept,
        question=question,
        final_frame=final_frame,
        unresolved=checked,
    )


@dataclass(frozen=True)
class BatchAttempt:
    """One bounded batch attempt, including any partial report."""

    number: int
    report: object | None
    note: str


@dataclass(frozen=True)
class BatchRecoveryReport:
    """Recovery outcome that never replays confirmed batch progress."""

    description: str
    attempts: tuple[BatchAttempt, ...]
    recovered: bool
    progress: tuple
    unresolved: str | None
    question: str | None
    final_observation: object
    final_frame: bytes | None

    @property
    def confirmed_progress(self) -> tuple:
        return self.progress


def _checked_batch_attempts(max_attempts) -> int:
    if type(max_attempts) is not int or max_attempts < 1:
        raise RecoveryError(
            f"max_attempts must be a positive integer, got"
            f" {_safe_value(max_attempts)}"
        )
    return max_attempts


def recover_batch(
    actions_or_description,
    actions=None,
    observer=None,
    *,
    refresh=None,
    progress=(),
    max_attempts=3,
    max_actions=20,
    max_duration=30.0,
    region=None,
    context=None,
    focus_check=None,
    check=None,
    effect_check=None,
    description="action batch",
) -> BatchRecoveryReport:
    """Resume a partial batch from its smallest unresolved safe action."""

    from computer_use.batch import _checked_actions, run_batch

    if isinstance(actions_or_description, str):
        checked_description = _checked_description(actions_or_description)
        items = actions
    else:
        checked_description = _checked_description(description)
        items = actions_or_description if actions is None else actions
        if actions is not None and observer is None and callable(actions):
            observer = actions
            items = actions_or_description
    if items is None:
        raise RecoveryError("A batch recovery needs actions")
    try:
        ordered = _checked_actions(items)
        kept = _checked_progress(progress)
    except Exception as exc:
        if isinstance(exc, RecoveryError):
            raise
        raise RecoveryError(str(exc)) from exc
    budget = _checked_batch_attempts(max_attempts)
    if refresh is not None:
        _checked_callable("refresh", refresh)
    if observer is not None:
        _checked_callable("observer", observer)
    if check is not None and effect_check is not None:
        raise RecoveryError("Specify either check or effect_check, not both")
    verification = check if check is not None else effect_check
    if verification is not None:
        _checked_callable("check", verification)
    if region is not None and observer is not None:
        raise RecoveryError("Specify either region or observer, not both")

    start_index = 0
    # Progress is trusted only as a contiguous prefix of this exact plan.
    for entry in kept:
        if start_index >= len(ordered) or ordered[start_index].description != entry:
            break
        start_index += 1
    confirmed = list(kept)
    attempts: list[BatchAttempt] = []
    final_observation = None
    final_frame = None
    unresolved = None
    stop_note = ""

    for number in range(1, budget + 1):
        if start_index >= len(ordered):
            return BatchRecoveryReport(
                description=checked_description,
                attempts=tuple(attempts),
                recovered=True,
                progress=tuple(confirmed),
                unresolved=None,
                question=None,
                final_observation=final_observation,
                final_frame=final_frame,
            )
        if number > 1 and refresh is not None:
            try:
                refresh()
            except Exception as exc:
                stop_note = f"refresh failed: {_safe_cause(exc)}"
                attempts.append(BatchAttempt(number, None, stop_note))
                continue
        remaining = ordered[start_index:]
        # The first pass may be a safe batch; every recovery pass narrows to
        # one unresolved action so an uncertain action cannot replay progress.
        planned = remaining if number == 1 else remaining[:1]
        try:
            report = run_batch(
                planned,
                observer=observer,
                region=region,
                context=context,
                focus_check=focus_check,
                max_actions=min(max_actions, len(planned)),
                max_duration=max_duration,
                description=checked_description,
            )
        except Exception as exc:
            stop_note = f"batch attempt failed: {_safe_cause(exc)}"
            attempts.append(BatchAttempt(number, None, stop_note))
            continue
        report_status = report.status
        report_note = report.evidence
        effect_unverified = False
        if verification is not None and report.status == "completed":
            try:
                effect = verification(report.end_observation)
                if type(effect) is not bool:
                    raise ValueError("effect check returned a non-boolean result")
            except Exception as exc:
                effect = False
                report_note = (
                    f"Batch effect verification was inconclusive:"
                    f" {_safe_cause(exc)}"
                )
            if not effect:
                effect_unverified = True
                report_status = "effect_unverified"
        attempts.append(BatchAttempt(number, report, report_note))
        if report.end_observation is not None:
            final_observation = report.end_observation
            try:
                from computer_use.batch import _frame

                final_frame = _frame(final_observation)
            except Exception:
                final_frame = None
        elif report.start_observation is not None:
            # A failed post-boundary still has a usable pre-boundary sample;
            # retain it rather than reporting that all evidence disappeared.
            final_observation = report.start_observation
            try:
                from computer_use.batch import _frame

                final_frame = _frame(final_observation)
            except Exception:
                final_frame = None
        delivered = 0
        for record in report.actions:
            if not record.delivered:
                break
            delivered += 1
        post_evidence_missing = (
            report.status == "observation_unavailable"
            and report.end_observation is None
            and delivered > 0
            and delivered == len(report.actions)
        )
        if (effect_unverified or post_evidence_missing) and delivered:
            delivered -= 1
        if delivered:
            for item in remaining[:delivered]:
                if not confirmed or confirmed[-1] != item.description:
                    confirmed.append(item.description)
            start_index += delivered
        if report.status == "completed" and start_index == len(ordered):
            return BatchRecoveryReport(
                description=checked_description,
                attempts=tuple(attempts),
                recovered=True,
                progress=tuple(confirmed),
                unresolved=None,
                question=None,
                final_observation=final_observation,
                final_frame=final_frame,
            )
        if effect_unverified and start_index < len(ordered):
            unresolved = ordered[start_index].description
        elif report.unresolved is not None:
            unresolved = report.unresolved
        elif start_index < len(ordered):
            unresolved = ordered[start_index].description
        if report_status in {
            "split_required", "context_invalidated", "not_ready",
            "focus_lost", "observation_unavailable",
        }:
            stop_note = report_note
            break
        if start_index >= len(ordered):
            unresolved = "verification"
            stop_note = report_note
            break
        stop_note = report_note

    if unresolved is None and start_index < len(ordered):
        unresolved = ordered[start_index].description
    if unresolved is None:
        unresolved = "verification"
    kept_text = ", ".join(confirmed) if confirmed else "none"
    question = (
        f"Batch '{checked_description}' stopped at '{unresolved}' after"
        f" {len(attempts)} attempts ({stop_note})."
        f" Confirmed progress: {kept_text}."
        f" Should I refresh state and retry only '{unresolved}'?"
    )
    return BatchRecoveryReport(
        description=checked_description,
        attempts=tuple(attempts),
        recovered=False,
        progress=tuple(confirmed),
        unresolved=unresolved,
        question=question,
        final_observation=final_observation,
        final_frame=final_frame,
    )


recover_partial_batch = recover_batch
resume_batch = recover_batch
