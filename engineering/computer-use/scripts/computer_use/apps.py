"""Open applications and report the focused window (T006).

Every typing and shortcut action needs a known focused receiver, so this
module opens a named application (or brings an already-open one to the
front) and reports which window is now focused.

Platform coverage: macOS is fully implemented through Cocoa; Windows can
launch through the standard shell and Linux through ``.desktop`` entries,
while window listing and focusing on those platforms raise an explicit
error until a window-control backend lands. All backends are injectable so
tests stay hermetic.
"""

from __future__ import annotations

import math
import subprocess
import sys
from dataclasses import dataclass

from computer_use.permissions import require_capabilities, require_permissions


class AppError(RuntimeError):
    """Raised when an application cannot be opened, focused, or reported."""


@dataclass(frozen=True)
class OpenResult:
    app: str
    focused: str
    already_open: bool


@dataclass(frozen=True)
class FocusResult:
    app: str
    focused: str


@dataclass(frozen=True)
class WindowState:
    app: str
    state: str
    width: int
    height: int
    x: int = 0
    y: int = 0


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


def _checked_name(name) -> str:
    """Accept only exact non-blank strings so diagnostics stay safe."""

    if type(name) is not str or not name.strip():
        raise AppError(
            f"Application name must be a non-blank string, got"
            f" {_safe_value(name)}"
        )
    return name.strip()


def _checked_size(label: str, value) -> int:
    """Accept only positive integer dimensions for window resizes."""

    if type(value) is not int or isinstance(value, bool) or value <= 0:
        raise AppError(
            f"Window {label} must be a positive integer, got"
            f" {_safe_value(value)}"
        )
    return value


_ARRANGE_METHODS = (
    "minimize", "maximize", "resize", "window_info", "screen_size",
)

_MAX_WAIT_SECONDS = 60.0
_DEFAULT_WAIT_SECONDS = 6.0
_DEFAULT_POLL_INTERVAL = 0.2


def _checked_wait(label: str, value, *, allow_zero: bool = True) -> float:
    """Validate a finite, bounded polling budget before reading the backend."""

    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
    ):
        raise AppError(
            f"{label} must be a finite number of seconds, got"
            f" {_safe_value(value)}"
        )
    try:
        seconds = float(value)
    except Exception as exc:
        raise AppError(
            f"{label} must be a finite number of seconds, got"
            f" {_safe_value(value)}"
        ) from exc
    if (
        not math.isfinite(seconds)
        or (seconds < 0 if allow_zero else seconds <= 0)
        or seconds > _MAX_WAIT_SECONDS
    ):
        bound = "0" if allow_zero else "greater than 0"
        raise AppError(
            f"{label} must be {bound} and at most {_MAX_WAIT_SECONDS:g}"
            f" seconds, got {_safe_value(value)}"
        )
    return seconds


def _arrange_backend(backend):
    """Require a window-control backend before arranging anything."""

    missing = [
        name for name in _ARRANGE_METHODS
        if not callable(getattr(backend, name, None))
    ]
    if missing:
        raise AppError(
            "Window arranging is not implemented by this backend"
            f" (missing: {', '.join(missing)})"
        )
    return backend


def _window_target(backend, checked: str, visible) -> str:
    """Resolve a running application for window operations."""

    target = _match(visible, checked)
    if target is None:
        raise AppError(
            f"Could not arrange {checked}: it is not among the running"
            f" applications."
            f" Visible applications: {_visible_text(visible)}"
        )
    return target


def _read_window_state(backend, target: str) -> WindowState:
    """Re-observe a window and report its actual resulting state."""

    try:
        minimized, bounds = backend.window_info(target)
        screen = backend.screen_size()
    except Exception as exc:
        raise AppError(
            f"Could not read the window state of {target}:"
            f" {_safe_cause(exc)}"
        ) from exc
    try:
        x, y, width, height = (int(part) for part in tuple(bounds))
        screen_width, screen_height = (
            int(part) for part in tuple(screen)
        )
    except Exception:
        raise AppError(
            f"Could not read the window state of {target}:"
            f" unusable bounds or screen size"
        ) from None
    if minimized:
        state = "minimized"
    elif x <= 0 and y <= 0 and width >= screen_width \
            and height >= screen_height:
        state = "maximized"
    else:
        state = "normal"
    return WindowState(
        app=target, state=state, width=width, height=height, x=x, y=y,
    )


def _arrange(name, action: str, apps=None, prober=None,
             size: tuple | None = None) -> WindowState:
    """Request a window change, then report the actual state.

    A refused or failed request never raises by itself: the window is
    always re-observed and the actual resulting state is reported.
    """

    checked = _checked_name(name)
    require_capabilities("application", prober=prober)
    require_permissions("input", prober=prober)
    backend = _arrange_backend(
        apps if apps is not None else detect_backend()
    )
    visible = _listed_running(backend)
    target = _window_target(backend, checked, visible)
    try:
        if size is None:
            getattr(backend, action)(target)
        else:
            getattr(backend, action)(target, *size)
    except Exception:
        # A refused request is not a failure here: the actual
        # resulting state below is the honest report.
        pass
    return _read_window_state(backend, target)


def minimize_window(name, apps=None, prober=None) -> WindowState:
    """Minimize a window, reporting the actual resulting state."""

    return _arrange(name, "minimize", apps=apps, prober=prober)


def maximize_window(name, apps=None, prober=None) -> WindowState:
    """Maximize a window, reporting the actual resulting state."""

    return _arrange(name, "maximize", apps=apps, prober=prober)


def resize_window(name, width, height, apps=None,
                  prober=None) -> WindowState:
    """Resize a window, reporting the actual resulting dimensions."""

    size = (_checked_size("width", width), _checked_size("height", height))
    return _arrange(name, "resize", apps=apps, prober=prober, size=size)


def window_state(name, apps=None, prober=None) -> WindowState:
    """Report a window's current state without changing anything."""

    checked = _checked_name(name)
    require_capabilities("application", prober=prober)
    require_permissions("screen", prober=prober)
    backend = _arrange_backend(
        apps if apps is not None else detect_backend()
    )
    visible = _listed_running(backend)
    target = _window_target(backend, checked, visible)
    return _read_window_state(backend, target)


def _match(visible, name: str):
    """Return the canonical running name matching case-insensitively."""

    wanted = name.lower()
    for candidate in visible:
        if type(candidate) is str and candidate.lower() == wanted:
            return candidate
    return None


def _visible_text(visible) -> str:
    """Render up to ten safe visible names for clarification reports."""

    names = [
        _safe_value(candidate)
        for candidate in list(visible)[:10]
        if type(candidate) is str
    ]
    return ", ".join(names) if names else "<no visible applications>"


def _listed_running(backend) -> tuple:
    """List running applications, normalizing backend failures."""

    try:
        return tuple(backend.running())
    except Exception as exc:
        raise AppError(
            f"Could not list running applications: {_safe_cause(exc)}"
        ) from exc


def _read_focused(backend) -> str:
    """Read the frontmost application, rejecting undetermined answers.

    Only string values are accepted (adapters normalize platform string
    objects such as Cocoa NSString to exact ``str`` first). Anything else
    raises instead of becoming a fabricated application name.
    """

    try:
        focused = backend.frontmost()
    except Exception as exc:
        raise AppError(
            f"Could not determine the focused window: {_safe_cause(exc)}"
        ) from exc
    if not isinstance(focused, str):
        raise AppError(
            "Could not determine the focused window, got"
            f" {_safe_value(focused)}"
        )
    try:
        cleaned = focused.strip()
    except Exception as exc:
        raise AppError(
            f"Could not determine the focused window: {_safe_cause(exc)}"
        ) from exc
    if type(cleaned) is not str or not cleaned:
        raise AppError(
            "Could not determine the focused window, got"
            f" {_safe_value(focused)}"
        )
    return cleaned


def _activate(backend, target: str, checked: str, visible) -> None:
    """Bring a running application to the front with a clear report."""

    try:
        delivery = backend.activate(target)
    except Exception as exc:
        raise AppError(
            f"Could not focus {checked}: {_safe_cause(exc)}."
            f" Visible applications: {_visible_text(visible)}"
        ) from exc
    if delivery is False:
        raise AppError(
            f"Could not focus {checked}: activation of {target}"
            f" was not delivered."
            f" Visible applications: {_visible_text(visible)}"
        )


def _read_focus_for_target(backend, checked: str, visible) -> str:
    try:
        return _read_focused(backend)
    except AppError as exc:
        raise AppError(
            f"{_safe_cause(exc)} Visible applications:"
            f" {_visible_text(visible)}"
        ) from exc


def _confirm_focused(backend, target: str, checked: str, visible,
                   timeout: float = _DEFAULT_WAIT_SECONDS,
                   poll_interval: float = _DEFAULT_POLL_INTERVAL) -> str:
    """Poll the current frontmost name until the target is actually focused."""

    import time

    budget = _checked_wait("focus timeout", timeout)
    pause = _checked_wait("focus poll interval", poll_interval)
    deadline = time.monotonic() + budget
    focused = _read_focus_for_target(backend, checked, visible)
    while True:
        if focused.lower() == target.lower():
            return focused
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        delay = min(pause, remaining)
        if delay > 0:
            time.sleep(delay)
        else:
            time.sleep(0)
        focused = _read_focus_for_target(backend, checked, visible)
    raise AppError(
        f"Could not focus {checked}: {target} was visible but not"
        f" focused (focused: {focused})."
        f" Visible applications: {_visible_text(visible)}"
    )


def _wait_for_running(backend, checked: str, initial, timeout: float,
                      poll_interval: float):
    """Wait for a launched application to enter the visible running set."""

    import time

    budget = _checked_wait("launch timeout", timeout)
    pause = _checked_wait("launch poll interval", poll_interval)
    deadline = time.monotonic() + budget
    latest = tuple(initial)
    while True:
        target = _match(latest, checked)
        if target is not None:
            return target, latest
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AppError(
                f"Could not open {checked}: it did not become visible"
                f" before the {budget:g}-second deadline."
                f" Visible applications: {_visible_text(latest)}"
            )
        delay = min(pause, remaining)
        if delay > 0:
            time.sleep(delay)
        else:
            time.sleep(0)
        latest = _listed_running(backend)


def open_app(name, apps=None, prober=None, timeout=_DEFAULT_WAIT_SECONDS,
             poll_interval=_DEFAULT_POLL_INTERVAL) -> OpenResult:
    """Open an application or bring it to the front, reporting focus."""

    checked = _checked_name(name)
    budget = _checked_wait("launch/focus timeout", timeout)
    pause = _checked_wait("launch/focus poll interval", poll_interval)
    require_capabilities("application", prober=prober)
    require_permissions("input", prober=prober)
    backend = apps if apps is not None else detect_backend()
    visible = _listed_running(backend)
    hit = _match(visible, checked)
    if hit is not None:
        _activate(backend, hit, checked, visible)
        confirmed = _confirm_focused(
            backend, hit, checked, visible,
            timeout=budget, poll_interval=pause,
        )
        return OpenResult(app=hit, focused=confirmed, already_open=True)
    try:
        delivery = backend.launch(checked)
    except Exception as exc:
        raise AppError(
            f"Could not open {checked}: {_safe_cause(exc)}."
            f" Visible applications: {_visible_text(visible)}"
        ) from exc
    if delivery is False:
        raise AppError(
            f"Could not open {checked}: launch was not delivered."
            f" Visible applications: {_visible_text(visible)}"
        )
    target, refreshed = _wait_for_running(
        backend, checked, visible, budget, pause,
    )
    try:
        _activate(backend, target, checked, refreshed)
    except AppError as exc:
        raise AppError(f"Opened {checked} but {exc}") from exc
    try:
        focused = _confirm_focused(
            backend, target, checked, refreshed,
            timeout=budget, poll_interval=pause,
        )
    except AppError as exc:
        raise AppError(f"Opened {checked} but {exc}") from exc
    return OpenResult(app=target, focused=focused, already_open=False)


def focus_app(name, apps=None, prober=None, timeout=_DEFAULT_WAIT_SECONDS,
              poll_interval=_DEFAULT_POLL_INTERVAL) -> FocusResult:
    """Bring an already-visible application to the front, reporting focus."""

    checked = _checked_name(name)
    budget = _checked_wait("focus timeout", timeout)
    pause = _checked_wait("focus poll interval", poll_interval)
    require_capabilities("application", prober=prober)
    require_permissions("input", prober=prober)
    backend = apps if apps is not None else detect_backend()
    visible = _listed_running(backend)
    target = _match(visible, checked)
    if target is None:
        raise AppError(
            f"Could not focus {checked}: it is not among the running"
            f" applications."
            f" Visible applications: {_visible_text(visible)}"
        )
    _activate(backend, target, checked, visible)
    return FocusResult(
        app=target,
        focused=_confirm_focused(
            backend, target, checked, visible,
            timeout=budget, poll_interval=pause,
        ),
    )


def focused_window(apps=None, prober=None) -> str:
    """Report which application window is currently focused."""

    require_capabilities("application", prober=prober)
    backend = apps if apps is not None else detect_backend()
    return _read_focused(backend)


def wait_for_window(*args, **kwargs):
    """Wait for a named window condition without mutating the desktop."""

    from computer_use.conditions import wait_for_window as _wait_for_window

    return _wait_for_window(*args, **kwargs)


wait_for_application = wait_for_window
wait_for_app = wait_for_window


def detect_backend():
    """Select the application backend for the current platform."""

    if sys.platform == "darwin":
        return CocoaApps()
    if sys.platform == "win32":
        return WindowsApps()
    return LinuxApps()


class CocoaApps:  # pragma: no cover - thin adapter over PyObjC Cocoa
    """macOS application control through NSWorkspace."""

    @staticmethod
    def _workspace():
        from Cocoa import NSWorkspace

        return NSWorkspace.sharedWorkspace()

    @staticmethod
    def _regular_apps():
        from Cocoa import NSApplicationActivationPolicyRegular

        workspace = CocoaApps._workspace()
        return [
            app
            for app in workspace.runningApplications()
            if app.activationPolicy()
            == NSApplicationActivationPolicyRegular
        ]

    def running(self):
        return tuple(
            sorted(str(app.localizedName()) for app in self._regular_apps())
        )

    def launch(self, name):
        if not self._workspace().launchApplication_(name):
            raise OSError(f"macOS refused to open {name}")

    def activate(self, name):
        wanted = name.lower()
        matches = [
            str(app.localizedName()) for app in self._regular_apps()
            if str(app.localizedName()).lower() == wanted
        ]
        if not matches:
            raise OSError(f"{name} is not running")
        if not self._workspace().launchApplication_(matches[0]):
            raise OSError(f"macOS refused to focus {name}")

    def frontmost(self):
        import re
        import subprocess

        try:
            asn = subprocess.run(
                ["lsappinfo", "front"], capture_output=True, text=True,
                timeout=10,
            ).stdout.splitlines()[0].strip()
            info = subprocess.run(
                ["lsappinfo", "info", "-only", "name", "-app", asn],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except Exception as exc:
            raise OSError(f"lsappinfo could not read frontmost: {exc}")
        match = re.search(r'"LSDisplayName"="([^"]+)"', info)
        if match is None:
            raise OSError("lsappinfo returned no display name")
        return match.group(1)

    @staticmethod
    def _ax_app(name):
        import ApplicationServices as AX
        from Cocoa import NSWorkspace

        wanted = name.lower()
        for running in NSWorkspace.sharedWorkspace() \
                .runningApplications():
            if str(running.localizedName()).lower() == wanted:
                return AX.AXUIElementCreateApplication(
                    running.processIdentifier()
                )
        raise OSError(f"{name} is not running")

    @staticmethod
    def _ax_main_window(name):
        import ApplicationServices as AX

        app = CocoaApps._ax_app(name)
        ok, window = AX.AXUIElementCopyAttributeValue(
            app, AX.kAXMainWindowAttribute, None,
        )
        if ok != 0 or window is None:
            ok, window = AX.AXUIElementCopyAttributeValue(
                app, AX.kAXFocusedWindowAttribute, None,
            )
        if ok != 0 or window is None:
            raise OSError(f"{name} has no controllable window")
        return window

    @staticmethod
    def _ax_set(window, attribute, value) -> None:
        import ApplicationServices as AX

        ok = AX.AXUIElementSetAttributeValue(window, attribute, value)
        if ok != 0:
            raise OSError(
                f"macOS refused the window change ({attribute}: {ok})"
            )

    def minimize(self, name):
        import ApplicationServices as AX

        window = self._ax_main_window(name)
        self._ax_set(window, AX.kAXMinimizedAttribute, True)
        return True

    def maximize(self, name):
        import ApplicationServices as AX

        window = self._ax_main_window(name)
        self._ax_set(window, AX.kAXFullscreenAttribute, True)
        return True

    def resize(self, name, width, height):
        import ApplicationServices as AX
        from AppKit import NSMakeSize

        window = self._ax_main_window(name)
        size = AX.AXValueCreate(
            AX.kAXValueCGSizeType, NSMakeSize(width, height),
        )
        self._ax_set(window, AX.kAXSizeAttribute, size)
        return True

    def window_info(self, name):
        import ApplicationServices as AX
        from Quartz import (
            CGWindowListCopyWindowInfo,
            kCGNullWindowID,
            kCGWindowListOptionOnScreenOnly,
        )

        window = self._ax_main_window(name)
        ok, minimized = AX.AXUIElementCopyAttributeValue(
            window, AX.kAXMinimizedAttribute, None,
        )
        try:
            entries = CGWindowListCopyWindowInfo(
                kCGWindowListOptionOnScreenOnly, kCGNullWindowID,
            )
        except Exception as exc:
            raise OSError(f"Quartz could not list windows: {exc}")
        best = None
        for entry in entries or ():
            try:
                owner = str(entry.get("kCGWindowOwnerName", ""))
                bounds = entry.get("kCGWindowBounds", {})
                box = (bounds.get("X", 0), bounds.get("Y", 0),
                       bounds.get("Width", 0), bounds.get("Height", 0))
            except Exception:
                continue
            if owner.lower() != name.lower():
                continue
            if best is None or box[2] * box[3] > best[2] * best[3]:
                best = box
        if best is None:
            raise OSError(f"{name} has no listed window")
        return bool(minimized) if ok == 0 else False, tuple(best)

    @staticmethod
    def screen_size():
        from Cocoa import NSScreen

        frame = NSScreen.mainScreen().frame()
        return (int(frame.size.width), int(frame.size.height))


class WindowsApps:  # pragma: no cover - needs a live Windows desktop
    """Windows launching through the standard shell.

    Window listing and focusing need a window-control backend and raise
    an explicit error until one lands.
    """

    _GAP = (
        "window listing and focusing are not implemented on Windows"
        " in this prototype"
    )

    def running(self):
        raise OSError(self._GAP)

    def activate(self, name):
        raise OSError(self._GAP)

    def frontmost(self):
        raise OSError(self._GAP)

    def launch(self, name):
        import os

        try:
            os.startfile(name)  # noqa: PTH118 - Windows shell verb
        except Exception as exc:
            raise OSError(f"Windows refused to open {name}") from exc


class LinuxApps:  # pragma: no cover - needs a live Linux desktop
    """Linux launching through ``.desktop`` entries.

    Window listing and focusing need a window-control backend and raise
    an explicit error until one lands.
    """

    _GAP = (
        "window listing and focusing are not implemented on Linux"
        " in this prototype"
    )

    def running(self):
        raise OSError(self._GAP)

    def activate(self, name):
        raise OSError(self._GAP)

    def frontmost(self):
        raise OSError(self._GAP)

    def launch(self, name):
        import os
        from pathlib import Path

        wanted = name.lower()
        roots = [
            Path("/usr/share/applications"),
            Path.home() / ".local/share/applications",
        ]
        for root in roots:
            try:
                entries = sorted(root.glob("*.desktop"))
            except OSError:
                continue
            for entry in entries:
                try:
                    text = entry.read_text(
                        encoding="utf-8", errors="replace"
                    )
                except OSError:
                    continue
                if f"\nname={wanted}\n" not in text.lower():
                    continue
                for line in text.splitlines():
                    if line.startswith("Exec="):
                        argv = line[len("Exec="):].split()
                        argv = [
                            part for part in argv
                            if not part.startswith("%")
                        ]
                        subprocess.Popen(argv)  # noqa: S603 - desktop entry
                        return
        if os.path.sep in name:
            raise OSError(f"{name} looks like a path, not an app name")
        raise OSError(f"Could not find a desktop entry for {name}")
