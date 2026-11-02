"""Bounded predictable action batches with explicit evidence boundaries (T009)."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass


class BatchError(ValueError):
    """Raised when a batch request is invalid before actions can run."""


@dataclass(frozen=True)
class BatchAction:
    """An action plus the metadata that can require a split boundary."""

    description: str
    action: object
    safe: bool = True
    requires_observation: bool = False
    batchable: bool = True


@dataclass(frozen=True)
class ActionRecord:
    """Per-action delivery and exception record."""

    index: int
    description: str
    outcome: object
    delivered: bool
    error: str | None = None

    @property
    def success(self) -> bool:
        return self.delivered


@dataclass(frozen=True)
class BatchReport:
    """A bounded batch report retaining progress and both observations."""

    description: str
    actions: tuple[ActionRecord, ...]
    completed: bool
    status: str
    start_observation: object
    end_observation: object
    changed: bool | None
    progress: tuple[str, ...]
    unresolved: str | None
    question: str | None
    evidence: str

    @property
    def records(self) -> tuple[ActionRecord, ...]:
        return self.actions

    @property
    def steps(self) -> tuple[ActionRecord, ...]:
        return self.actions

    @property
    def pre_observation(self):
        return self.start_observation

    @property
    def post_observation(self):
        return self.end_observation

    @property
    def all_delivered(self) -> bool:
        return self.completed and all(record.delivered for record in self.actions)


BatchRecord = ActionRecord
BatchStep = ActionRecord


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


def _checked_description(value) -> str:
    if type(value) is not str or not value.strip():
        raise ValueError(
            f"Batch description must be a non-blank string, got"
            f" {_safe_value(value)}"
        )
    return value.strip()


def _checked_budget(value, label: str, maximum: float) -> float:
    try:
        number = float(value)
    except Exception:
        number = math.nan
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(number)
        or number < 0
        or number > maximum
    ):
        raise ValueError(
            f"{label} must be a finite value between 0 and {maximum:g}, got"
            f" {_safe_value(value)}"
        )
    return number


def _checked_actions(items) -> tuple[BatchAction, ...]:
    if isinstance(items, (str, bytes, bytearray)):
        raise ValueError("actions must be an iterable of action records")
    try:
        entries = tuple(items)
    except Exception as exc:
        raise ValueError("actions must be an iterable of action records") from exc
    if not entries:
        raise ValueError("A batch needs at least one action")
    checked = []
    for index, entry in enumerate(entries):
        if isinstance(entry, BatchAction):
            action = entry
        else:
            try:
                parts = tuple(entry)
            except Exception as exc:
                raise ValueError(
                    f"Action {index} must be (description, callable)"
                ) from exc
            if len(parts) not in {2, 3}:
                raise ValueError(
                    f"Action {index} must be (description, callable)"
                )
            description, callback = parts[:2]
            metadata = parts[2] if len(parts) == 3 else {}
            if metadata is None:
                metadata = {}
            if not isinstance(metadata, dict):
                raise ValueError(
                    f"Action {index} metadata must be a mapping"
                )
            action = BatchAction(
                description=description,
                action=callback,
                safe=metadata.get(
                    "safe", not metadata.get("unsafe", False)
                ),
                requires_observation=metadata.get(
                    "requires_observation",
                    metadata.get("depends_on_previous", False),
                ),
                batchable=metadata.get("batchable", True),
            )
        if type(action.description) is not str or not action.description.strip():
            raise ValueError(
                f"Action {index} needs a non-blank description"
            )
        if not callable(action.action):
            raise ValueError(
                f"Action '{action.description}' needs a callable"
            )
        for label, flag in (
            ("safe", action.safe),
            ("requires_observation", action.requires_observation),
            ("batchable", action.batchable),
        ):
            if type(flag) is not bool:
                raise ValueError(
                    f"Action '{action.description}' {label} must be boolean"
                )
        checked.append(BatchAction(
            description=action.description.strip(),
            action=action.action,
            safe=action.safe,
            requires_observation=action.requires_observation,
            batchable=action.batchable,
        ))
    return tuple(checked)


def _frame(value) -> bytes:
    image = getattr(value, "image", None)
    if image is None and hasattr(value, "tobytes") and not isinstance(
        value, (bytes, bytearray, memoryview)
    ):
        image = value
    if image is not None:
        value = image.tobytes()
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise BatchError(
            f"Observation did not provide bytes: {_safe_value(value)}"
        )
    try:
        frame = bytes(bytearray(value))
    except Exception as exc:
        raise BatchError("Observation bytes could not be normalized") from exc
    if type(frame) is not bytes or not frame:
        raise BatchError("Observation was empty or unusable")
    return frame


def _observed(value):
    """Return (original evidence, normalized bytes) for comparison."""

    return value, _frame(value)


def _delivery(outcome) -> tuple[bool, str | None]:
    if type(outcome) is bool:
        return outcome, None
    try:
        delivered = getattr(outcome, "delivered", None)
    except Exception as exc:
        return False, _safe_text(exc)
    if type(delivered) is bool:
        return delivered, None
    try:
        failed = getattr(outcome, "failed", None)
    except Exception as exc:
        return False, _safe_text(exc)
    if failed is not None:
        try:
            if len(tuple(failed)) > 0:
                return False, "action reported failed output"
        except Exception as exc:
            return False, _safe_text(exc)
    return True, None


def _question(description, status, unresolved, progress):
    kept = ", ".join(progress) if progress else "none"
    target = unresolved or "the next action"
    return (
        f"Batch '{description}' stopped with {status} at '{target}'."
        f" Confirmed progress: {kept}."
        f" What should change before retrying only '{target}'?"
    )


def _report(
    description, records, completed, status, start, end, progress, unresolved,
    evidence,
):
    if start is None or end is None:
        changed = None
    else:
        try:
            changed = _frame(start) != _frame(end)
        except Exception:
            changed = None
    question = None if completed else _question(
        description, status, unresolved, progress,
    )
    return BatchReport(
        description=description,
        actions=tuple(records),
        completed=completed,
        status=status,
        start_observation=start,
        end_observation=end,
        changed=changed,
        progress=tuple(progress),
        unresolved=unresolved,
        question=question,
        evidence=evidence,
    )


def _observation_callable(region, observer):
    if region is not None and observer is not None:
        raise ValueError("Specify either region or observer, not both")
    if region is not None:
        watch = getattr(region, "observe", None)
        if not callable(watch):
            raise ValueError("region must provide a callable observe method")
        return watch
    if observer is not None:
        if not callable(observer):
            raise ValueError(
                f"observer must be callable, got {_safe_value(observer)}"
            )
        return observer
    from computer_use.verify import _default_observer

    return _default_observer


def run_batch(
    actions_or_description=None,
    actions=None,
    observer=None,
    *,
    description="action batch",
    region=None,
    context=None,
    focus_check=None,
    max_actions=20,
    max_duration=30.0,
    observe_before=True,
    observe_after=True,
    steps=None,
) -> BatchReport:
    """Run predictable actions with one bounded pre/post observation pair.

    Passing a string first uses it as the report description, mirroring
    ``run_task``; passing an action iterable first is the compact form.
    ``BatchAction`` metadata can force a split before a dependent or unsafe
    action.  No action after an unresolved boundary is run.
    """

    if steps is not None:
        if actions_or_description is not None or actions is not None:
            raise ValueError("Specify steps or actions, not both")
        actions_or_description = steps
    if isinstance(actions_or_description, str):
        checked_description = _checked_description(actions_or_description)
        ordered_input = actions
    else:
        checked_description = _checked_description(description)
        ordered_input = actions_or_description if actions is None else actions
        if actions is not None and observer is None and callable(actions):
            observer = actions
            ordered_input = actions_or_description
    if ordered_input is None:
        raise ValueError("A batch needs actions")
    ordered = _checked_actions(ordered_input)
    if type(max_actions) is not int or isinstance(max_actions, bool) \
            or max_actions < 1 or max_actions > 100:
        raise ValueError(
            f"max_actions must be an integer between 1 and 100, got"
            f" {_safe_value(max_actions)}"
        )
    duration = _checked_budget(max_duration, "max_duration", 300.0)
    for label, flag in (
        ("observe_before", observe_before),
        ("observe_after", observe_after),
    ):
        if type(flag) is not bool:
            raise ValueError(f"{label} must be boolean")
    if focus_check is not None and not callable(focus_check):
        raise ValueError(
            f"focus_check must be callable, got {_safe_value(focus_check)}"
        )
    if context is not None:
        try:
            context.validate()
        except Exception as exc:
            return _report(
                checked_description, (), False, "context_invalidated", None,
                None, (), ordered[0].description,
                f"Batch context is stale or invalid: {_safe_text(exc)}",
            )
    watch = _observation_callable(region, observer)
    start = None
    end = None
    if observe_before:
        try:
            start = watch()
            _frame(start)
        except Exception as exc:
            return _report(
                checked_description, (), False, "observation_unavailable",
                None, None, (), ordered[0].description,
                f"Batch start observation was unavailable: {_safe_text(exc)}",
            )
    if focus_check is not None:
        try:
            focused = focus_check()
        except Exception as exc:
            return _report(
                checked_description, (), False, "not_ready", start, None, (),
                ordered[0].description,
                f"Batch focus check failed: {_safe_text(exc)}",
            )
        if type(focused) is not bool or not focused:
            return _report(
                checked_description, (), False, "not_ready", start, None, (),
                ordered[0].description,
                "Batch focus was not confirmed before any action.",
            )

    began = time.monotonic()
    records: list[ActionRecord] = []
    progress: list[str] = []
    unresolved = None
    status = "completed"
    for index, item in enumerate(ordered):
        if index >= max_actions:
            unresolved = item.description
            status = "limit_reached"
            break
        if time.monotonic() - began > duration:
            unresolved = item.description
            status = "timed_out"
            break
        if not item.safe or item.requires_observation or not item.batchable:
            unresolved = item.description
            status = "split_required"
            break
        if context is not None:
            try:
                context.validate()
            except Exception as exc:
                unresolved = item.description
                status = "context_invalidated"
                break
        if focus_check is not None and index > 0:
            try:
                focused = focus_check()
            except Exception as exc:
                unresolved = item.description
                status = "focus_lost"
                break
            if type(focused) is not bool or not focused:
                unresolved = item.description
                status = "focus_lost"
                break
        try:
            outcome = item.action()
        except Exception as exc:
            records.append(ActionRecord(
                index=index,
                description=item.description,
                outcome=None,
                delivered=False,
                error=_safe_text(exc),
            ))
            unresolved = item.description
            status = "delivery_failed"
            break
        delivered, delivery_error = _delivery(outcome)
        records.append(ActionRecord(
            index=index,
            description=item.description,
            outcome=outcome,
            delivered=delivered,
            error=(
                None if delivered
                else delivery_error or "action reported delivery failure"
            ),
        ))
        if not delivered:
            unresolved = item.description
            status = "delivery_failed"
            break
        progress.append(item.description)
    else:
        status = "completed"

    if observe_after:
        try:
            end = watch()
            _frame(end)
        except Exception as exc:
            unresolved = unresolved or (
                records[-1].description
                if records else ordered[0].description
            )
            return _report(
                checked_description, records, False,
                "observation_unavailable", start, None, progress, unresolved,
                f"Batch end observation was unavailable: {_safe_text(exc)}",
            )
    if status == "completed" and len(records) < len(ordered):
        status = "limit_reached"
        unresolved = ordered[len(records)].description
    completed = status == "completed" and len(records) == len(ordered)
    return _report(
        checked_description, records, completed, status, start, end, progress,
        unresolved,
        (
            f"Batch completed with {len(records)} ordered action records and"
            " bounded observations."
            if completed
            else f"Batch stopped after {len(records)} action records."
        ),
    )


run_actions = run_batch
perform_batch = run_batch
