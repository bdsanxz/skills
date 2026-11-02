"""Independent on-screen oracles through the accessibility API.

The clipboard proves what the agent delivered; these readers prove what
the screen shows through a second channel: a named application's window
title identifies the visible target and its focused field value shows
the visible content. Neither touches the clipboard nor any pixel, so a
scripted observer or a same-channel round-trip cannot satisfy them.

Readers address the target application by name instead of trusting the
frontmost application, because the reported frontmost application can
lag behind an application switch for many seconds. Every reader returns
None when unavailable or unreadable, and callers treat an unavailable
oracle as a failed check rather than a pass.

Currently implemented on macOS through the accessibility API.
"""

from __future__ import annotations

_SETTLE_READS = 3
_SETTLE_INTERVAL = 0.3


def _app_element(AX, workspace, name):
    """Return the accessibility element for a running app, or None."""

    try:
        for running in workspace.runningApplications():
            try:
                if running.localizedName().lower() == name.lower():
                    return AX.AXUIElementCreateApplication(
                        running.processIdentifier()
                    )
            except Exception:
                continue
    except Exception:
        pass
    return None


def _attribute(AX, ref, name):
    """Read one accessibility attribute, returning None when unreadable."""

    try:
        ok, value = AX.AXUIElementCopyAttributeValue(ref, name, None)
    except Exception:
        return None
    if ok != 0:
        return None
    return value


def _settled(reader):
    """Return the first consecutively repeated read.

    Attribute propagation can lag briefly behind keystrokes, so poll
    and accept a value only once it repeats; fall back to the last
    read when nothing settles.
    """

    import time

    previous = reader()
    for _ in range(_SETTLE_READS - 1):
        time.sleep(_SETTLE_INTERVAL)
        current = reader()
        if current == previous and current is not None:
            return current
        previous = current
    return previous


def _workspace():
    try:
        from AppKit import NSWorkspace

        return NSWorkspace.sharedWorkspace()
    except Exception:
        return None


def _window_title_once(app_name: str) -> str | None:
    try:
        import ApplicationServices as AX
    except Exception:
        return None
    workspace = _workspace()
    if workspace is None:
        return None
    app = _app_element(AX, workspace, app_name)
    if app is None:
        return None
    window = _attribute(AX, app, AX.kAXFocusedWindowAttribute)
    title = _attribute(AX, window, AX.kAXTitleAttribute)
    return title if isinstance(title, str) else None


def window_title_of(app_name: str) -> str | None:
    """Return the named app's focused window title, or None."""

    return _settled(lambda: _window_title_once(app_name))


def _field_value_once(app_name: str) -> str | None:
    try:
        import ApplicationServices as AX
    except Exception:
        return None
    workspace = _workspace()
    if workspace is None:
        return None
    app = _app_element(AX, workspace, app_name)
    if app is None:
        return None
    window = _attribute(AX, app, AX.kAXFocusedWindowAttribute)
    element = _attribute(AX, app, AX.kAXFocusedUIElementAttribute)
    if element is None:
        element = _attribute(AX, window, AX.kAXFocusedUIElementAttribute)
    value = _attribute(AX, element, AX.kAXValueAttribute)
    return value if isinstance(value, str) else None


def field_value_of(app_name: str) -> str | None:
    """Return the named app's focused field value, or None."""

    return _settled(lambda: _field_value_once(app_name))
