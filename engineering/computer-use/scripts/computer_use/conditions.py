"""Bounded semantic waits for desktop state (T006 and later conditions)."""

from __future__ import annotations

import time
from dataclasses import dataclass

from computer_use.permissions import (
    CapabilityUnavailableError,
    require_capabilities,
)


@dataclass(frozen=True)
class WindowObservation:
    """One fresh application/window state sample."""

    application: str
    visible: bool | None
    focused: bool | None
    applications: tuple[str, ...] = ()
    frontmost: str | None = None
    raw: object = None


@dataclass(frozen=True)
class WindowWaitResult:
    """Outcome of a non-mutating bounded window condition wait."""

    application: str
    condition: str
    status: str
    satisfied: bool
    latest: WindowObservation | None
    observations: tuple[WindowObservation, ...]
    evidence: str

    @property
    def timed_out(self) -> bool:
        return self.status == "timed_out"

    @property
    def unavailable(self) -> bool:
        return self.status == "unavailable"

    @property
    def visible(self) -> bool | None:
        return None if self.latest is None else self.latest.visible

    @property
    def focused(self) -> bool | None:
        return None if self.latest is None else self.latest.focused


@dataclass(frozen=True)
class FieldObservation:
    """One fresh field value and optional independent commit evidence."""

    application: str
    value: str | None
    committed: bool | None = None
    raw: object = None


@dataclass(frozen=True)
class FieldWaitResult:
    """Outcome of an exact field-value or commit-condition wait."""

    application: str
    expected: str
    status: str
    satisfied: bool
    accepted: bool
    committed: bool | None
    latest: FieldObservation | None
    observations: tuple[FieldObservation, ...]
    evidence: str

    @property
    def timed_out(self) -> bool:
        return self.status == "timed_out"

    @property
    def unavailable(self) -> bool:
        return self.status == "unavailable"

    @property
    def value(self) -> str | None:
        return None if self.latest is None else self.latest.value

    @property
    def text(self) -> str:
        return self.expected


@dataclass(frozen=True)
class RegionChangeSample:
    """One fresh bounded-region frame compared with its baseline."""

    observation: object
    frame: bytes
    changed: bool


@dataclass(frozen=True)
class RegionChangeResult:
    """Outcome of waiting for a mapped bounded region to differ."""

    status: str
    satisfied: bool
    changed: bool | None
    baseline: object
    latest: object
    context: object
    observations: tuple[RegionChangeSample, ...]
    evidence: str
    context_invalidated: bool = False

    @property
    def timed_out(self) -> bool:
        return self.status in {"timed_out", "unchanged"}

    @property
    def unavailable(self) -> bool:
        return self.status == "unavailable"


_WINDOW_CONDITIONS = {
    "visible": "visible",
    "visibility": "visible",
    "window_visible": "visible",
    "application_visible": "visible",
    "app_visible": "visible",
    "focused": "focused",
    "focus": "focused",
    "window_focused": "focused",
    "application_focused": "focused",
    "app_focused": "focused",
}


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


def _checked_name(name) -> str:
    if type(name) is not str or not name.strip():
        raise ValueError(
            f"Application name must be a non-blank string, got"
            f" {_safe_value(name)}"
        )
    return name.strip()


def _checked_condition(condition) -> str:
    if type(condition) is not str:
        raise ValueError(
            f"Window condition must be a string, got {_safe_value(condition)}"
        )
    canonical = _WINDOW_CONDITIONS.get(condition.strip().lower())
    if canonical is None:
        raise ValueError(
            f"Unsupported window condition {_safe_value(condition)};"
            " supported conditions: visible, focused"
        )
    return canonical


def _checked_budget(value, label: str, *, allow_zero=True) -> float:
    from computer_use.apps import _checked_wait

    return _checked_wait(label, value, allow_zero=allow_zero)


def _checked_observer(reader):
    if reader is not None and not callable(reader):
        raise ValueError(
            f"window reader must be callable, got {_safe_value(reader)}"
        )
    return reader


def _call_reader(reader, application: str):
    """Call a reader with its named-app argument when its signature allows it."""

    try:
        import inspect

        signature = inspect.signature(reader)
        try:
            signature.bind(application)
        except TypeError:
            signature.bind()
            return reader()
    except (TypeError, ValueError):
        # Some extension callables have no inspectable signature; the public
        # one-argument contract is the safest default for those readers.
        return reader(application)
    return reader(application)


def _names(value) -> tuple[str, ...]:
    try:
        items = tuple(value)
    except Exception as exc:
        raise ValueError("window reader returned unusable application names") from exc
    if any(type(item) is not str for item in items):
        raise ValueError("window reader returned non-string application names")
    return tuple(items)


def _bool_or_none(value, label: str):
    if value is None:
        return None
    if type(value) is not bool:
        raise ValueError(
            f"window reader returned non-boolean {label}: {_safe_value(value)}"
        )
    return value


def _from_raw(raw, application: str, condition: str) -> WindowObservation:
    if isinstance(raw, WindowObservation):
        raw = {
            "visible": raw.visible,
            "focused": raw.focused,
            "applications": raw.applications,
            "frontmost": raw.frontmost,
        }
    if type(raw) is bool:
        return WindowObservation(
            application=application,
            visible=raw if condition == "visible" else None,
            focused=raw if condition == "focused" else None,
            raw=raw,
        )
    if not isinstance(raw, dict):
        raise ValueError(
            f"window reader returned unusable state: {_safe_value(raw)}"
        )
    visible = _bool_or_none(raw.get("visible"), "visibility")
    focused = _bool_or_none(raw.get("focused"), "focus")
    applications = _names(raw.get("applications", ()))
    frontmost = raw.get("frontmost")
    if frontmost is not None and not isinstance(frontmost, str):
        raise ValueError(
            f"window reader returned unusable frontmost name:"
            f" {_safe_value(frontmost)}"
        )
    if visible is None and applications:
        wanted = application.casefold()
        visible = any(name.casefold() == wanted for name in applications)
    if visible is False and focused is True:
        raise ValueError(
            "window reader reported a contradictory visible/focused state"
        )
    if condition == "visible" and visible is None:
        raise ValueError("window reader did not report visibility")
    if focused is None and isinstance(frontmost, str):
        focused = frontmost.casefold() == application.casefold()
        if visible is False:
            focused = False
    if condition == "focused" and focused is None:
        raise ValueError("window reader did not report focus")
    return WindowObservation(
        application=application,
        visible=visible,
        focused=focused,
        applications=applications,
        frontmost=frontmost,
        raw=raw,
    )


def _default_reader(backend, application: str, condition: str):
    try:
        applications = _names(backend.running())
        wanted = application.casefold()
        visible = any(name.casefold() == wanted for name in applications)
        frontmost = None
        focused = None
        if condition == "focused":
            frontmost = backend.frontmost()
            if not isinstance(frontmost, str) or not frontmost.strip():
                raise ValueError(
                    f"frontmost application is unusable: {_safe_value(frontmost)}"
                )
            frontmost = str(frontmost).strip()
            focused = visible and frontmost.casefold() == wanted
    except Exception:
        raise
    return WindowObservation(
        application=application,
        visible=visible,
        focused=focused,
        applications=applications,
        frontmost=frontmost,
    )


def _satisfied(sample: WindowObservation, condition: str) -> bool:
    value = sample.visible if condition == "visible" else sample.focused
    return value is True


def _evidence(status, condition, application, latest, detail="") -> str:
    if status == "satisfied":
        return (
            f"Observed {application} {condition} on a fresh window sample."
        )
    if status == "timed_out":
        if latest is None:
            state = "no usable window sample"
        else:
            state = (
                f"visible={latest.visible}, focused={latest.focused},"
                f" frontmost={_safe_value(latest.frontmost)}"
            )
        return (
            f"Timed out waiting for {application} to be {condition};"
            f" latest state: {state}."
        )
    return (
        f"Window condition for {application} is unavailable/inconclusive:"
        f" {detail or 'the reader did not provide usable evidence'}."
    )


def wait_for_window(
    application,
    condition="visible",
    apps=None,
    reader=None,
    timeout=6.0,
    poll_interval=0.2,
    prober=None,
) -> WindowWaitResult:
    """Poll a named window condition without performing desktop mutations."""

    name = _checked_name(application)
    wanted = _checked_condition(condition)
    budget = _checked_budget(timeout, "window timeout")
    pause = _checked_budget(poll_interval, "window poll interval")
    custom = _checked_observer(reader)
    backend = apps
    if backend is None:
        from computer_use.apps import detect_backend

        backend = detect_backend()
    if custom is None:
        try:
            require_capabilities("application", prober=prober)
        except CapabilityUnavailableError as exc:
            return WindowWaitResult(
                application=name,
                condition=wanted,
                status="unavailable",
                satisfied=False,
                latest=None,
                observations=(),
                evidence=_evidence(
                    "unavailable", wanted, name, None, _safe_text(exc)
                ),
            )

    deadline = time.monotonic() + budget
    observations: list[WindowObservation] = []
    latest = None
    while True:
        try:
            raw = (
                _call_reader(custom, name)
                if custom is not None
                else _default_reader(backend, name, wanted)
            )
            latest = _from_raw(raw, name, wanted)
        except Exception as exc:
            return WindowWaitResult(
                application=name,
                condition=wanted,
                status="unavailable",
                satisfied=False,
                latest=latest,
                observations=tuple(observations),
                evidence=_evidence(
                    "unavailable", wanted, name, latest, _safe_text(exc)
                ),
            )
        observations.append(latest)
        if _satisfied(latest, wanted):
            return WindowWaitResult(
                application=name,
                condition=wanted,
                status="satisfied",
                satisfied=True,
                latest=latest,
                observations=tuple(observations),
                evidence=_evidence("satisfied", wanted, name, latest),
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        delay = min(pause, remaining)
        time.sleep(delay if delay > 0 else 0)

    return WindowWaitResult(
        application=name,
        condition=wanted,
        status="timed_out",
        satisfied=False,
        latest=latest,
        observations=tuple(observations),
        evidence=_evidence("timed_out", wanted, name, latest),
    )


wait_for_application = wait_for_window
wait_for_app = wait_for_window


def _field_name(name) -> str:
    return _checked_name(name)


def _checked_expected(expected) -> str:
    if type(expected) is not str:
        raise ValueError(
            f"Expected field content must be a string, got"
            f" {_safe_value(expected)}"
        )
    return expected


def _field_observation(raw, application: str) -> FieldObservation:
    if isinstance(raw, FieldObservation):
        value = raw.value
        committed = raw.committed
    elif isinstance(raw, str):
        value = str(raw)
        committed = None
    elif isinstance(raw, dict):
        value = raw.get("value", raw.get("text"))
        committed = raw.get("committed")
    elif isinstance(raw, (tuple, list)) and len(raw) == 2:
        value, committed = raw
    else:
        raise ValueError(
            f"Field reader returned unusable value: {_safe_value(raw)}"
        )
    if value is not None and not isinstance(value, str):
        raise ValueError(
            f"Field reader returned non-string value: {_safe_value(value)}"
        )
    if committed is not None and type(committed) is not bool:
        raise ValueError(
            f"Field reader returned non-boolean commit state:"
            f" {_safe_value(committed)}"
        )
    if value is None:
        raise ValueError("Field reader did not report a field value")
    return FieldObservation(
        application=application,
        value=None if value is None else str(value),
        committed=committed,
        raw=raw,
    )


def _default_field_reader(application):
    from computer_use.ax import field_value_of

    return field_value_of(application)


def _field_evidence(status, application, expected, latest, detail="") -> str:
    if status in {"accepted", "committed"}:
        return (
            f"Observed the exact requested field content for {application};"
            f" status={status}."
        )
    if status == "timed_out":
        value = "unavailable" if latest is None else _safe_value(latest.value)
        commit = "unknown" if latest is None else _safe_value(latest.committed)
        return (
            f"Timed out waiting for {application} field acceptance of"
            f" {_safe_value(expected)}; latest value={value},"
            f" committed={commit}."
        )
    return (
        f"Field acceptance for {application} is unavailable/inconclusive:"
        f" {detail or 'the field reader provided no usable evidence'}."
    )


def wait_for_field(
    application,
    expected,
    reader=None,
    timeout=6.0,
    poll_interval=0.2,
    committed=False,
    commit_reader=None,
    prober=None,
    *,
    field_reader=None,
    commit=None,
) -> FieldWaitResult:
    """Poll an exact focused-field value, optionally requiring commit proof."""

    name = _field_name(application)
    wanted = _checked_expected(expected)
    budget = _checked_budget(timeout, "field timeout")
    pause = _checked_budget(poll_interval, "field poll interval")
    if field_reader is not None:
        if reader is not None:
            raise ValueError("Specify either reader or field_reader, not both")
        reader = field_reader
    if commit is not None:
        if type(commit) is not bool:
            raise ValueError(
                f"commit must be a boolean, got {_safe_value(commit)}"
            )
        committed = commit
    if type(committed) is not bool:
        raise ValueError(
            f"committed must be a boolean, got {_safe_value(committed)}"
        )
    if commit_reader is not None and not callable(commit_reader):
        raise ValueError(
            f"commit_reader must be callable, got {_safe_value(commit_reader)}"
        )
    if reader is not None and not callable(reader):
        raise ValueError(
            f"field reader must be callable, got {_safe_value(reader)}"
        )
    watch = reader if reader is not None else _default_field_reader
    deadline = time.monotonic() + budget
    observations: list[FieldObservation] = []
    latest = None
    while True:
        try:
            raw = _call_reader(watch, name)
            sample = _field_observation(raw, name)
            if sample.committed is None and commit_reader is not None:
                commit_state = _call_reader(commit_reader, name)
                if type(commit_state) is not bool:
                    raise ValueError(
                        f"commit reader returned non-boolean state:"
                        f" {_safe_value(commit_state)}"
                    )
                sample = FieldObservation(
                    application=name,
                    value=sample.value,
                    committed=commit_state,
                    raw=sample.raw,
                )
            latest = sample
            observations.append(sample)
        except Exception as exc:
            return FieldWaitResult(
                application=name,
                expected=wanted,
                status="unavailable",
                satisfied=False,
                accepted=False if latest is None else latest.value == wanted,
                committed=None if latest is None else latest.committed,
                latest=latest,
                observations=tuple(observations),
                evidence=_field_evidence(
                    "unavailable", name, wanted, latest, _safe_text(exc)
                ),
            )
        accepted = sample.value == wanted
        is_satisfied = accepted and (
            not committed or sample.committed is True
        )
        if is_satisfied:
            status = "committed" if committed else "accepted"
            return FieldWaitResult(
                application=name,
                expected=wanted,
                status=status,
                satisfied=True,
                accepted=accepted,
                committed=sample.committed,
                latest=sample,
                observations=tuple(observations),
                evidence=_field_evidence(
                    status, name, wanted, sample,
                ),
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        delay = min(pause, remaining)
        time.sleep(delay if delay > 0 else 0)
    return FieldWaitResult(
        application=name,
        expected=wanted,
        status="timed_out",
        satisfied=False,
        accepted=latest is not None and latest.value == wanted,
        committed=None if latest is None else latest.committed,
        latest=latest,
        observations=tuple(observations),
        evidence=_field_evidence("timed_out", name, wanted, latest),
    )


wait_for_field_acceptance = wait_for_field
wait_for_field_value = wait_for_field
wait_for_commit = wait_for_field


def _region_bytes(value) -> bytes:
    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            data = bytes(bytearray(value))
        except Exception as exc:
            raise ValueError("region observer returned unusable bytes") from exc
        if type(data) is not bytes or not data:
            raise ValueError("region observer returned an empty frame")
        return data
    image = getattr(value, "image", None)
    if image is None and hasattr(value, "tobytes"):
        image = value
    if image is None:
        raise ValueError(
            f"region observer returned unusable sample: {_safe_value(value)}"
        )
    try:
        data = image.tobytes()
    except Exception as exc:
        raise ValueError("region observer image could not be read") from exc
    if type(data) is not bytes or not data:
        raise ValueError("region observer returned an empty frame")
    return data


def _region_result(
    status, baseline, latest, context, observations, evidence,
    *, context_invalidated=False,
):
    return RegionChangeResult(
        status=status,
        satisfied=status == "changed",
        changed=(
            True if status == "changed"
            else False if status in {"unchanged", "timed_out"}
            else None
        ),
        baseline=baseline,
        latest=latest,
        context=context,
        observations=tuple(observations),
        evidence=evidence,
        context_invalidated=context_invalidated,
    )


def wait_for_region_change(
    baseline,
    observer=None,
    timeout=6.0,
    poll_interval=0.2,
    context=None,
    *,
    timeout_status="timed_out",
) -> RegionChangeResult:
    """Poll the same bounded region until its fresh frame differs."""

    from computer_use.region import RegionCapture

    baseline_region = baseline if isinstance(baseline, RegionCapture) else None
    if baseline_region is None and context is None:
        raise ValueError(
            "a raw baseline needs an explicit coordinate context"
        )
    budget = _checked_budget(timeout, "region timeout")
    pause = _checked_budget(poll_interval, "region poll interval")
    if type(timeout_status) is not str or timeout_status not in {
        "timed_out", "unchanged",
    }:
        raise ValueError(
            "timeout_status must be 'timed_out' or 'unchanged'"
        )
    active_context = (
        baseline_region.context if context is None else context
    )
    try:
        active_context.validate()
        if (
            baseline_region is not None
            and active_context != baseline_region.context
        ):
            raise ValueError("baseline and supplied coordinate contexts differ")
        baseline_frame = _region_bytes(baseline)
    except Exception as exc:
        return _region_result(
            "unavailable", baseline, None, active_context, (),
            f"Region baseline/context is unavailable: {_safe_text(exc)}",
            context_invalidated="stale" in _safe_text(exc).lower(),
        )
    if observer is None:
        if baseline_region is None:
            raise ValueError("a raw baseline needs a fresh region observer")
        observer = baseline_region.observe
    if not callable(observer):
        raise ValueError(
            f"region observer must be callable, got {_safe_value(observer)}"
        )

    deadline = time.monotonic() + budget
    samples: list[RegionChangeSample] = []
    latest = None
    while True:
        try:
            latest = observer()
            if isinstance(latest, RegionCapture):
                latest.context.validate()
                if (
                    latest.context != active_context
                    or (
                        baseline_region is not None
                        and (
                            latest.screen != baseline_region.screen
                            or latest.origin != baseline_region.origin
                            or latest.size != baseline_region.size
                        )
                    )
                ):
                    raise ValueError(
                        "fresh region uses a different or stale context"
                    )
            frame = _region_bytes(latest)
            changed = frame != baseline_frame
            if type(changed) is not bool:
                raise ValueError("region frame comparison was inconclusive")
            sample = RegionChangeSample(
                observation=latest, frame=frame, changed=changed,
            )
            samples.append(sample)
        except Exception as exc:
            detail = _safe_text(exc)
            return _region_result(
                "unavailable", baseline, latest, active_context, samples,
                f"Region observation is unavailable/inconclusive: {detail}",
                context_invalidated="context" in detail.lower()
                or "stale" in detail.lower(),
            )
        if sample.changed:
            return _region_result(
                "changed", baseline, latest, active_context, samples,
                "The selected bounded region changed on a fresh observation;"
                " this does not establish the application's semantic effect.",
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        delay = min(pause, remaining)
        time.sleep(delay if delay > 0 else 0)
    return _region_result(
        timeout_status, baseline, latest, active_context, samples,
        (
            f"The selected bounded region remained unchanged until the"
            f" {timeout_status} deadline; application meaning is unverified."
        ),
    )


wait_for_region = wait_for_region_change
