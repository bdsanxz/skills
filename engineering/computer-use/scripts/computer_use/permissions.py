"""Distinguish unavailable platform facilities from denied permissions (T002).

A capability must be loadable before its operating-system permission is
interpreted. The two gates intentionally have different errors: a missing
bridge is a capability-unavailable condition, while a loaded bridge that the
OS refuses is a permission-denied condition. Operation modules inject both
kinds of probe in tests so denied operations cannot return blank captures or
claim no-op input delivery.
"""

from __future__ import annotations

import importlib
import sys
from dataclasses import dataclass


class CapabilityUnavailableError(RuntimeError):
    """Raised when a required platform bridge or facility is unavailable."""

    def __init__(self, capability: str, detail: str | None = None):
        self.capability = capability
        self.detail = detail or "the required platform bridge or facility is unavailable"
        super().__init__(
            f"capability unavailable: {capability}; {self.detail}"
        )


CapabilityUnavailable = CapabilityUnavailableError


class PermissionDeniedError(RuntimeError):
    """Raised when an OS permission is missing, carrying plain guidance."""


@dataclass(frozen=True)
class PermissionStatus:
    screen_granted: bool
    input_granted: bool
    app: str


@dataclass(frozen=True)
class Guidance:
    missing: tuple
    app: str
    message: str


@dataclass(frozen=True)
class CapabilityStatus:
    """Result of one explicit capability probe."""

    capability: str
    available: bool
    detail: str = ""

    @property
    def state(self) -> str:
        return "available" if self.available else "unavailable"

    @property
    def capability_available(self) -> bool:
        return self.available


KNOWN_PERMISSIONS = ("screen", "input")
KNOWN_CAPABILITIES = (
    "screen", "input", "application", "accessibility", "text",
)
_CAPABILITY_ALIASES = {
    "display": "screen",
    "capture": "screen",
    "pointer": "input",
    "keyboard": "input",
    "app": "application",
    "apps": "application",
}

_CAPABILITY_MODULES = {
    "screen": ("mss", "PIL"),
    "input": ("pynput.mouse", "pynput.keyboard"),
    "accessibility": ("ApplicationServices",),
    "text": ("PIL",),
}

_WHAT_IT_BLOCKS = {
    "screen": "see the screen (captures would come back black or stale)",
    "input": "move the pointer, click, or type (input would go nowhere)",
}

_SETTINGS_PATH = {
    "screen": "System Settings → Privacy & Security → Screen Recording",
    "input": "System Settings → Privacy & Security → Accessibility",
}

_DENIED_WARNING = {
    "screen": "While denied, no screen capture will be returned.",
    "input": "While denied, no pointer or keyboard input will be delivered.",
}


def _safe_cause(exc: Exception) -> str:
    """Render a backend failure without trusting its string conversion."""

    try:
        return str(exc)
    except Exception:
        return f"<unprintable {type(exc).__name__}>"


def _safe_value(value) -> str:
    """Render backend- or caller-supplied data without trusting it."""

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


def _checked_names(names) -> tuple:
    """Accept only exact known permission names before any prober call."""

    wanted = tuple(names)
    for name in wanted:
        if type(name) is not str or name not in KNOWN_PERMISSIONS:
            raise ValueError(
                f"Unknown permission {_safe_value(name)};"
                f" known permissions: {', '.join(KNOWN_PERMISSIONS)}"
            )
    if not wanted:
        raise ValueError("At least one permission must be required")
    return wanted


def _checked_capability_names(names) -> tuple:
    """Normalize capability aliases without probing unrelated facilities."""

    try:
        raw_names = tuple(names)
    except Exception:
        raise ValueError("Capabilities must be named strings") from None
    if len(raw_names) == 1 and not isinstance(raw_names[0], str):
        try:
            raw_names = tuple(raw_names[0])
        except Exception:
            raise ValueError("Capabilities must be named strings") from None
    wanted = []
    for name in raw_names:
        if type(name) is not str:
            raise ValueError(
                f"Unknown capability {_safe_value(name)};"
                f" known capabilities: {', '.join(KNOWN_CAPABILITIES)}"
            )
        canonical = _CAPABILITY_ALIASES.get(name.strip().lower(), name.strip().lower())
        if canonical not in KNOWN_CAPABILITIES:
            raise ValueError(
                f"Unknown capability {_safe_value(name)};"
                f" known capabilities: {', '.join(KNOWN_CAPABILITIES)}"
            )
        wanted.append(canonical)
    if not wanted:
        raise ValueError("At least one capability must be required")
    return tuple(wanted)


class DefaultCapabilityProber:
    """Probe whether the bridge needed by a capability can be loaded."""

    def capability_available(self, name: str) -> bool:
        if name == "application":
            # The application adapters are stdlib-backed on Windows/Linux;
            # macOS needs Cocoa before it can enumerate or activate apps.
            if sys.platform == "darwin":
                importlib.import_module("Cocoa")
            return True
        modules = _CAPABILITY_MODULES.get(name)
        if modules is None:
            return False
        for module in modules:
            importlib.import_module(module)
        return True


def detect_capability_prober():
    """Return the platform bridge probe used by normal operations."""

    return DefaultCapabilityProber()


def _capability_probe(active, name: str) -> bool:
    """Read one capability from an injected or default probe.

    Older injected permission probers do not expose capability methods. They
    remain compatible and are treated as already-available bridges; a real
    operation still reports any backend failure explicitly. New probers can
    expose one generic method, a per-capability method, or a capabilities
    mapping, and only the requested name is read.
    """

    sentinel = object()
    try:
        generic = getattr(active, "capability_available", sentinel)
    except Exception as exc:
        raise CapabilityUnavailableError(
            name, f"could not inspect the capability bridge: {_safe_cause(exc)}"
        ) from exc
    try:
        if generic is not sentinel:
            value = generic(name) if callable(generic) else generic
        else:
            mapping = getattr(active, "capabilities", sentinel)
            if mapping is not sentinel:
                try:
                    value = mapping[name]
                except Exception as exc:
                    raise CapabilityUnavailableError(
                        name, f"the capability probe has no {name} result"
                    ) from exc
            else:
                candidates = (
                    f"{name}_available", f"{name}_capable", f"has_{name}",
                )
                value = sentinel
                for attribute in candidates:
                    candidate = getattr(active, attribute, sentinel)
                    if candidate is not sentinel:
                        value = candidate() if callable(candidate) else candidate
                        break
                if value is sentinel:
                    # Compatibility for the pre-T002 permission-only probe.
                    return True
    except CapabilityUnavailableError:
        raise
    except Exception as exc:
        raise CapabilityUnavailableError(
            name, f"the bridge probe failed: {_safe_cause(exc)}"
        ) from exc
    if type(value) is not bool:
        raise CapabilityUnavailableError(
            name, f"the bridge probe returned {_safe_value(value)} instead of a boolean"
        )
    return value


def check_capabilities(*names, prober=None) -> tuple[CapabilityStatus, ...]:
    """Inspect only the requested platform capabilities."""

    wanted = _checked_capability_names(names)
    active = prober if prober is not None else detect_capability_prober()
    statuses = []
    for name in wanted:
        try:
            available = _capability_probe(active, name)
            detail = "" if available else "the required platform bridge or facility is unavailable"
        except CapabilityUnavailableError as exc:
            available = False
            detail = exc.detail
        statuses.append(CapabilityStatus(name, available, detail))
    return tuple(statuses)


def require_capabilities(*names, prober=None) -> None:
    """Stop with a capability-unavailable error before permission probing."""

    wanted = _checked_capability_names(names)
    active = prober if prober is not None else detect_capability_prober()
    for name in wanted:
        try:
            available = _capability_probe(active, name)
        except CapabilityUnavailableError:
            raise
        if not available:
            raise CapabilityUnavailableError(
                name, "the required platform bridge or facility is unavailable"
            )


def require_capability(name, prober=None) -> None:
    """Singular convenience form for one capability gate."""

    require_capabilities(name, prober=prober)


def check_capability(name, prober=None) -> CapabilityStatus:
    """Return the status for one capability without raising for absence."""

    return check_capabilities(name, prober=prober)[0]


def _message_for(missing: tuple, app: str) -> str:
    """Explain each denied capability with its own grant location."""

    parts = []
    for name in missing:
        parts.append(
            f"permission denied for {name}: "
            f"Computer-use cannot {_WHAT_IT_BLOCKS[name]} yet."
            f" Grant access to '{app}': {_SETTINGS_PATH[name]}"
            f" → turn on '{app}', then retry this step."
            f" {_DENIED_WARNING[name]}"
        )
    return "\n\n".join(parts)


def _checked_status(status) -> PermissionStatus:
    """Enforce the public status shape before deriving guidance."""

    if not isinstance(status, PermissionStatus):
        raise ValueError(
            f"Status must be a PermissionStatus,"
            f" got {_safe_value(status)}"
        )
    for name in KNOWN_PERMISSIONS:
        flag = getattr(status, f"{name}_granted")
        if type(flag) is not bool:
            raise ValueError(
                f"Status flag {name}_granted must be a boolean,"
                f" got {_safe_value(flag)}"
            )
    return status


def _checked_flag(label, value) -> bool:
    """Accept only real booleans for grant flags."""

    if type(value) is not bool:
        raise PermissionDeniedError(
            f"Could not determine {label} permission, got"
            f" {_safe_value(value)}"
        )
    return value


def _checked_app(app) -> str:
    """Accept only usable application names for guidance."""

    if type(app) is not str or not app.strip():
        return "this application"
    return app.strip()


def detect_prober():
    """Select the permission prober for the current platform."""

    if sys.platform == "darwin":
        return MacProber()
    return OpenProber()


def check_permissions(prober=None) -> PermissionStatus:
    """Read the current screen and input permission state."""

    active = prober if prober is not None else detect_prober()
    try:
        screen = active.screen_allowed()
    except Exception as exc:
        raise PermissionDeniedError(
            f"permission denied for screen: could not determine"
            f" permission: {_safe_cause(exc)}"
        ) from exc
    try:
        allowed = active.input_allowed()
    except Exception as exc:
        raise PermissionDeniedError(
            f"permission denied for input: could not determine"
            f" permission: {_safe_cause(exc)}"
        ) from exc
    try:
        app = active.app_name()
    except Exception:
        app = "this application"
    return PermissionStatus(
        screen_granted=_checked_flag("screen", screen),
        input_granted=_checked_flag("input", allowed),
        app=_checked_app(app),
    )


def guidance_for(status: PermissionStatus) -> Guidance:
    """Explain in plain language what is missing and where to grant it."""

    checked = _checked_status(status)
    app = _checked_app(checked.app)
    missing = tuple(
        name for name in KNOWN_PERMISSIONS
        if not getattr(checked, f"{name}_granted")
    )
    if not missing:
        return Guidance(
            missing=(),
            app=app,
            message=(
                f"All permissions are granted for {app}:"
                f" it can see the screen and control input."
            ),
        )
    return Guidance(
        missing=missing, app=app, message=_message_for(missing, app)
    )


def _probe_one(active, name: str) -> bool:
    """Probe one requested operating-system permission."""

    try:
        probe = getattr(active, f"{name}_allowed", None)
        if not callable(probe):
            generic = getattr(active, "permission_allowed", None)
            if not callable(generic):
                raise AttributeError(f"missing {name}_allowed probe")
            probe = lambda: generic(name)
        granted = probe()
    except Exception as exc:
        raise PermissionDeniedError(
            f"permission denied for {name}: could not determine"
            f" permission: {_safe_cause(exc)}"
        ) from exc
    if type(granted) is not bool:
        raise PermissionDeniedError(
            f"permission denied for {name}: could not determine"
            f" permission, got {_safe_value(granted)}"
        )
    return granted


def require_permissions(*names, prober=None) -> None:
    """Stop with plain guidance unless every named permission is granted.

    The matching capability bridge is checked first. Only requested
    capabilities and permissions are probed, so an unrelated failure never
    blocks a valid operation.
    """

    wanted = _checked_names(names)
    require_capabilities(*wanted, prober=prober)
    active = prober if prober is not None else detect_prober()
    try:
        app = _checked_app(active.app_name())
    except Exception:
        app = "this application"
    denied = tuple(name for name in wanted if not _probe_one(active, name))
    if denied:
        raise PermissionDeniedError(_message_for(denied, app))


class MacProber:  # pragma: no cover - thin adapter over PyObjC
    """macOS screen and input permission state."""

    def screen_allowed(self):
        from Quartz import CGPreflightScreenCaptureAccess

        return bool(CGPreflightScreenCaptureAccess())

    def input_allowed(self):
        from ApplicationServices import AXIsProcessTrusted

        return bool(AXIsProcessTrusted())

    def app_name(self):
        from Cocoa import NSRunningApplication

        try:
            name = NSRunningApplication.currentApplication().localizedName()
        except Exception:
            return "this application"
        if type(name) is not str or not name.strip():
            return "this application"
        return name


class OpenProber:
    """Platforms without an OS gate report open permissions honestly."""

    def screen_allowed(self):
        return True

    def input_allowed(self):
        return True

    def app_name(self):
        return "this application"
