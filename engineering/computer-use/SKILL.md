---
name: computer-use
description: |
  Operate a desktop computer like a human: observe the current screen,
  read exact coordinates from a screen reference, move and click, drag and
  scroll, focus applications, type and press keys, verify every action with
  a fresh observation, and recover failed steps without losing progress.
---

# Computer-use

Use this skill when an agent must operate a local desktop application rather
than only answer with text. The skill provides a Python capability layer for
screen capture, coordinate-aware visual references, pointer and keyboard
input, application focus, independent text or accessibility readers, and
verified multi-step task flows.

The trustworthy operating loop is:

```text
prepare runtime -> observe -> prepare coordinate reference -> locate
                  -> focus target -> perform one action or a bounded related batch
                  -> observe at the appropriate boundary -> verify -> continue or recover
```

The agent makes the decisions. The skill performs the low-level operation and
returns an explicit result or error. The target application is never treated
as successful merely because an input call returned; success is established by
fresh observation and, where available, an independent oracle.

## Non-negotiable behavior

1. **Prepare before operating.** Run operations through
   `computer_use.bootstrap.invoke` so the private runtime is ready before a
   capability is used. Never ask the operator to install the skill's Python
   dependencies globally.
2. **Observe before deciding.** Capture the current screen and use that
   observation for the next decision. Do not act from a cached frame after the
   desktop, focus, window layout, or pointer may have changed.
3. **Read coordinates; do not guess them.** Use the original capture together
   with `computer_use.grid.prepare_reference`. Coordinates must be read from
   the returned reference image in captured-image pixel space.
4. **Preserve coordinate space.** Keep the selected `Screen` and its origin
   with every coordinate. A crop's local coordinate is not a capture or
   desktop coordinate until its reported offset and screen origin are applied.
5. **Choose an appropriate action boundary.** Validate the target, focus,
   and coordinates before acting. Use one action at a time when safety,
   uncertainty, focus, target movement, or intermediate verification requires
   it. When the current progress and interaction flow are well understood,
   perform a bounded batch of predictable related actions before observing
   again. Never include an action whose target depends on an unobserved result.
6. **Focus before typing.** Use `open_app` or `focus_app`, and rely on its
   reported focused name. Keyboard input goes to whichever receiver currently
   owns focus; it is not routed by the skill to an imagined field.
7. **Verify from a fresh observation at the right boundary.** Capture again
   after an individual action when safety, uncertainty, or the next decision
   depends on that result. For a predictable batch, capture after the bounded
   batch before continuing to a dependent step. A delivery result, changed
   pointer position, or non-empty image alone is not proof that the intended
   application effect occurred.
8. **Keep uncertainty explicit.** Blank, stale, malformed, unavailable, or
   inconclusive observations remain unknown. Never replace them with a guessed
   screen, position, text, or success claim.
9. **Fail before side effects when validation is possible.** Unsupported
   buttons, keys, invalid coordinates, invalid regions, and invalid task
   inputs are rejected before the corresponding backend action.
10. **Recover only from current state.** If an effect is missing or a batch
    becomes uncertain, stop issuing dependent actions, re-observe, refresh
    focus or location as needed, and retry only the smallest unresolved step
    or a newly justified safe batch. Keep a readable progress list; do not
    replay successful earlier steps.
11. **Treat permissions as a hard gate.** Missing screen or input permission
    must stop the affected operation with plain-language repair guidance. Do
    not return a blank capture or silently issue no-op input.
12. **Report what actually happened.** Include the requested operation, the
    result returned by the backend, the fresh verification state, and any
    remaining uncertainty in the agent's report.

### Action batching policy

Action batching is an efficiency tool, not a way to avoid evidence. A batch is
appropriate when the agent has a current observation, the target application
and focus are stable, every coordinate or key sequence is already known, and
the next action does not depend on an effect that has not been observed. Keep
the batch short enough that its actions and expected state transition remain
clear in the progress report.

Split the batch and observe sooner when an action may be destructive or
irreversible, when the target or focus may change, when coordinates may move,
when an application can react asynchronously, when an action's result chooses
the next target, or when the agent cannot confidently predict the interaction
flow. After a batch, verify the resulting state before issuing dependent
actions; if any part is unclear, do not replay the whole batch blindly.

The prototype does not provide an automatic confirmation workflow for risky
actions. Perform destructive actions, sending, transactions, or changes to
important data only when the operator's instruction clearly requires them;
report the action and its verified result. In particular,
`reply_to_message(..., send=False)` does not send by default.

## Scope and platform behavior

### Core capabilities

- Automatic isolated first-use setup with required dependencies.
- Per-screen capture with pointer positions mapped through each screen's
  desktop origin.
- A readable labeled coordinate reference, one coordinate context, and
  native-resolution region crops.
- Pointer movement, left/right/double click, smooth multi-waypoint drags, and
  directional scrolling.
- Text entry, supported individual keys, and modifier shortcuts.
- Opening or focusing an application and reporting the actual focused window.
- Fresh post-action observation, semantic window/field/region waits, bounded
  predictable batches, bounded retry, and progress-preserving task composition.
- Permission status and repair guidance.

### Optional helpers

- Window minimize, maximize, resize, and resulting-state reporting.
- Independent visible-text extraction with reliability marking.
- macOS accessibility oracles for a named application's window title and
  focused field value.

### Boundaries

- This is local desktop control, not mobile control or remote-machine control.
- Capture and synthetic input depend on the operating system session allowing
  them. Linux Wayland policies may restrict either capability.
- macOS has Cocoa, Quartz, and accessibility adapters in this prototype.
  Windows and Linux include application-launch adapters, but application
  listing, focusing, and frontmost-window reporting are explicit gaps until a
  window-control backend is provided.
- The public package is Python-based; it has no bundled command-line
  interface. Use the module APIs below from the prepared runtime.

## Runtime and first-use setup

All setup state belongs under the selected workspace's own artifact area:

```text
<workspace-root>/.artifacts/computer-use/.runtime/
  bin/ or Scripts/       isolated Python interpreter
  tmp/                   installer temporary files
  pip-cache/             installer cache
  environment.json       readiness metadata
```

The default `workspace-root` is the supplied project root. Setup never writes
its temporary files or package cache to the global Python installation. The
required package specifications are currently:

| Package | Used for |
|---|---|
| `mss>=9` | Screen enumeration and capture |
| `Pillow>=10` | RGB image construction, crops, and coordinate references |
| `pynput>=1.7` | Pointer and keyboard delivery |

The runtime reuses a healthy environment only when its interpreter and
`pyvenv.cfg` prove that system site packages are excluded. If its shape is
incomplete, non-isolated, or its interpreter does not execute as a real
isolated interpreter, bootstrap repairs that owned area before checking
dependencies. Required and optional dependency probes do not use the caller's
Python search paths. Caller-controlled pip destination/configuration settings
are rejected before setup or installation; package caches and configuration
used by bootstrap stay inside the runtime-owned area. A required dependency
that cannot be installed, has an invalid requirement, or does not satisfy its
PEP 440 version constraint raises an error naming the dependency and the
cause; importability alone is not enough. Bootstrap imports its setup modules
through interpreter-owned stdlib/extension paths rather than caller path,
module-cache, or import-finder state. Setup removes inherited Python identity
and user-base controls, invalidates stale readiness metadata, and must not
report readiness or run the requested operation after a failure.

### Preferred invocation

The `computer_use` package is in this skill's `scripts/` directory. Put that
directory on `sys.path` (or run from it) before importing `computer_use`, and
pass the project being operated on as `project_root`.

Pass `invoke` a shell-free sequence of arguments for the prepared Python
interpreter. The command—not the caller's interpreter—owns the capability
operation:

```python
from pathlib import Path

from computer_use.bootstrap import invoke


result = invoke(
    Path.cwd(),
    ["-c", "import sys; print(sys.executable)"],
)
print(result.stdout)
```

Use `-m <module>` for a reusable operation module or `-c <source>` for a
small, self-contained operation. `invoke(project_root, operation, **kwargs)`
returns the prepared-interpreter process result; it rejects raw Python
callbacks because a callback would execute in the caller's interpreter. The
optional `operation_timeout` is bounded, and `operation_env` may contain only
ordinary application variables. Runtime identity, Python search-path,
virtual-environment, executable-path, pip destination/configuration, and
runtime-owned temporary/cache variables (`TMPDIR`, `TMP`, `TEMP`,
`PIP_CACHE_DIR`, and equivalent controls) cannot be overridden. If setup fails,
the command is not run. For
lower-level setup or tests, use `ensure_environment(project_root, ...)`
followed by `run_in_runtime(runtime, operation, ...)`; that lower-level call
validates the runtime is ready and canonical before executing.

- `Runtime.project_root` — the resolved project being operated on;
- `Runtime.workspace_root` — the root owning the artifact area;
- `Runtime.directory` — the isolated runtime directory;
- `Runtime.python` — the isolated interpreter path;
- `Runtime.ready` — `True` only after setup and required-package checks pass;
- `Runtime.warnings` — optional-capability warnings, if optional packages
  have been configured.

`process_environment(storage_root)` returns an environment with temporary and
pip-cache paths below `storage_root`. Optional packages, when configured by a
caller, are attempted independently: an unavailable option is recorded as a
warning and the standard fallback continues. Required packages never degrade
to a warning. A failed required check leaves `environment.json` non-ready
rather than preserving an old ready report.

### Capability versus permission preflight

Use `check_capabilities`/`require_capabilities` before interpreting an
operating-system permission result. A missing platform bridge raises
`CapabilityUnavailableError` and names the unavailable facility; a loaded
bridge that the OS blocks raises `PermissionDeniedError` with the
capability-specific grant path. Operations probe only the capability they
need, so an unrelated unavailable facility cannot block a valid operation.

```python
from computer_use.permissions import (
    check_capabilities,
    require_capabilities,
)

status = check_capabilities("screen")
require_capabilities("screen")
print(status[0].capability, status[0].available)
```

Screen, pointer, keyboard, application, and region operations stop before
their backend side effect when the relevant gate is unavailable or denied.

## Public API at a glance

The package is intentionally split by capability. Import public functions and
result/error types from their owning module rather than depending on private
backend adapters.

| Module | Public operations | Main result/error types |
|---|---|---|
| `bootstrap` | `invoke`, `ensure_environment`, `run_in_runtime`, `runtime_directory`, `runtime_python` | `Runtime`, `BootstrapError` |
| `screen` | `list_screens`, `capture_screen`, `capture_region`, `pointer_position`, `find_screen` | `Screen`, `Capture`, `Pointer`, `CaptureError`, `PointerError` |
| `grid` | `prepare_reference`, `CoordinateContext`, `add_coordinate_reference`, `zoom_region`, `to_screen`, `choose_step` | `PreparedReference`, `CoordinatePoint`, `CoordinateContextError`, `ReferenceError` |
| `region` | `capture_region`, `region_observer` | `RegionCapture`, `RegionCaptureError` |
| `pointer` | `move_to`, `click`, `right_click`, `double_click`, `drag_path`, `scroll` | `MoveResult`, `ClickResult`, `DragResult`, `ScrollResult`, `ActionError`, `IncompleteDragError` |
| `keyboard` | `type_text`, `press_key`, `hotkey` | `TypeResult`, `KeyResult`, `HotkeyResult`, `KeyActionError` |
| `apps` | `open_app`, `focus_app`, `focused_window`, `wait_for_window`, `minimize_window`, `maximize_window`, `resize_window`, `window_state` | `OpenResult`, `FocusResult`, `WindowState`, `AppError` |
| `conditions` | `wait_for_window`, `wait_for_field`, `wait_for_region_change` | `WindowWaitResult`, `FieldWaitResult`, `RegionChangeResult` |
| `batch` | `run_batch` | `BatchAction`, `ActionRecord`, `BatchReport`, `BatchError` |
| `verify` | `verify_step`, `run_sequence` | `VerifiedStep`, `SequenceReport`, `VerifyError` |
| `recovery` | `recover_step`, `recover_batch` | `Attempt`, `RecoveryReport`, `BatchAttempt`, `BatchRecoveryReport`, `RecoveryError` |
| `tasks` | `run_task`, `run_batch`, `reply_to_message`, `write_journal_entry`, `recopy_content_check` | `TaskDeps`, `StepRecord`, `TaskReport`, `TaskError` |
| `permissions` | `check_capabilities`, `require_capabilities`, `check_permissions`, `guidance_for`, `require_permissions` | `CapabilityStatus`, `CapabilityUnavailableError`, `PermissionStatus`, `Guidance`, `PermissionDeniedError` |
| `ax` | `window_title_of`, `field_value_of` | `str \| None` |
| `text` | `extract_region_text` | `TextReading`, `TextError` |

All operation-specific `controller`, `shooter`, `apps`, `observer`,
`elements`, `ocr`, and `prober` parameters are dependency-injection seams.
Use them for hermetic tests or an explicitly selected backend; do not use a
fake backend to claim that a live task happened.

The capability API examples below assume they run inside a module or source
command launched through the setup-gated `invoke`; tests may call the modules
directly with injected backends.

## Observe and locate

### Screens, captures, and pointer position

```python
from computer_use.screen import (
    capture_screen,
    find_screen,
    list_screens,
    pointer_position,
)

screens = list_screens()
capture = capture_screen(screens[0].index)
pointer = pointer_position()

print(capture.screen)
print(capture.image.mode, capture.image.size)
print(pointer.x, pointer.y)
print(find_screen(screens, pointer.x, pointer.y))
```

`list_screens()` returns `Screen` records with `index`, `left`, `top`,
`width`, and `height`. The capture backend's combined all-monitors entry is
not exposed as a selectable screen; ordinary screen indices therefore begin
at `1`. A `Capture` contains an RGB Pillow image and the exact `Screen` whose
pixel area it represents. `Pointer` contains the live `x` and `y` position.

A capture image is local to its selected screen: pixel `(0, 0)` in the image
corresponds to desktop position `(capture.screen.left,
capture.screen.top)`. `pointer_position()` and pointer-action arguments use
absolute desktop coordinates. Therefore a coordinate read from an image must
be translated by the selected screen origin before `move_to`, `click`,
`drag_path`, or `scroll`. A pointer can be outside a particular screen when
several screens are attached; use `find_screen` and the intended `Screen`
rather than assuming screen `1`.

Failures are explicit:

- `CaptureError` covers unavailable capture, malformed monitor metadata,
  unknown screen indices, mismatched dimensions, and unusable pixel buffers.
- `PointerError` covers an unavailable or malformed live pointer position.
- Neither operation returns a fabricated blank image or cached position.

### Coordinate references

Use `prepare_reference` after each capture when a target must be located:

```python
from computer_use.grid import prepare_reference, to_screen

reference = prepare_reference(capture)

# Inspect reference.image and read a target's local x/y from its labels.
# If kind == "zoom", map those local coordinates back to the capture:
full_x, full_y = to_screen(local_x, local_y, reference.offset)
```

`PreparedReference` contains:

- `original` — the untouched captured image;
- `image` — a copy with a labeled grid, or a labeled native-resolution crop;
- `kind` — `"full"` or `"zoom"`;
- `offset` — the crop's `(x, y)` origin in the original capture;
- `step` — the grid spacing in reference-image pixels;
- `context` — the `CoordinateContext` carrying screen origin, scale, crop,
  dimensions, and staleness state.

For sufficiently large images, the reference uses the full image. When a full
reference would be unreadable, the helper supplies a centered crop and its
offset. If no readable reference can be made, it raises `ReferenceError`
rather than inviting coordinate estimation. `add_coordinate_reference` draws
on a copy and does not shift the underlying pixels.

For a targeted crop, `zoom_region(image, (left, top, width, height))` clamps a
valid region to the image bounds and returns `(crop, (actual_left,
actual_top))`. The returned offset is authoritative; apply it exactly with
`to_screen`. Invalid, non-finite, non-positive, or completely outside regions
raise `ReferenceError`.

### Unified coordinate context

Prefer the context carried by `PreparedReference` or create one directly from
a capture. It maps observation-local points through crop offset and display
scale to absolute desktop coordinates, while retaining the selected screen:

```python
from computer_use.grid import CoordinateContext, prepare_reference
from computer_use.pointer import click

reference = prepare_reference(capture)
point = reference.context.to_desktop(local_x, local_y)
click(point, context=reference.context, screens=(capture.screen,))
```

`CoordinateContext.for_capture(capture, crop_offset=..., scale=...)` accepts a
scalar or `(x, y)` scale. `context.to_capture(x, y)` returns source pixels and
`context.to_desktop(x, y)` returns a `CoordinatePoint` with `x`, `y`, `screen`,
and `capture` fields. Pointer movement, clicks, drags, and scrolls accept the
same context directly; do not spread crop/origin/scale arithmetic through a
task. `context.invalidate()` marks a layout-dependent mapping stale, and
`context.validate(fresh_capture)` rejects changed screen or observation
geometry. Stale, ambiguous, and out-of-bounds points raise
`CoordinateContextError` before pointer delivery.

### Coordinate rules

- Read `x` and `y` from the current reference image, not from a remembered
  window position or an approximate visual guess.
- Keep the capture's `Screen` and the reference's `offset` with the target.
- A crop coordinate `(20, 30)` with offset `(400, 100)` maps to capture pixel
  `(420, 130)`; the desktop action coordinate is then `(420 + screen.left,
  130 + screen.top)`.
- Re-capture and re-read after scrolling, resizing, focus changes, or any
  action that could move the target.
- Never use a grid or crop image as a substitute for inspecting the original
  screen state; it is a coordinate-reading aid only.

## Pointer actions

Every pointer action validates finite numeric coordinates and, when `screens`
is supplied, rejects positions outside the known screen ranges before moving.
All pointer actions require input permission.

```python
from computer_use.pointer import click, double_click, move_to, right_click

move = move_to(x, y, screens=(capture.screen,))
left = click(x, y, screens=(capture.screen,))
right = right_click(x, y, screens=(capture.screen,))
double = double_click(x, y, screens=(capture.screen,))
```

`MoveResult.position` and `ClickResult.position` are backend-reported final
positions, not just requested values. Clicks are rejected when the backend
reports failure or the pointer misses the requested point beyond the small
position tolerance. `ActionError` names unsupported buttons, invalid or
out-of-range coordinates, delivery failures, and missed targets. An
unsupported button is never silently changed to a left click.

### Drag paths

Use the universal path operation for a straight drag, a brush stroke, a
slider, a selection, or a closed shape:

```python
from computer_use.pointer import drag_path

result = drag_path(
    [(start_x, start_y), (waypoint_x, waypoint_y), (end_x, end_y)],
    button="left",
    screens=(capture.screen,),
)
```

The full signature is:

```python
drag_path(
    points,
    button="left",
    controller=None,
    screens=None,
    observer=None,
    prober=None,
    step_px=8.0,
    interval=0.01,
    settle=0.5,
    context=None,
)
```

Pass the same `CoordinateContext` when path points are observation-local;
without it, points are absolute desktop coordinates. Behavior:

- `points` needs at least two finite `(x, y)` waypoints.
- Every waypoint must be inside a known screen when `screens` is supplied.
- A path cannot cross from one known screen to another.
- Long legs are interpolated into small moves; each waypoint is reached in
  order. Repeating the first point at the end creates a closed path with one
  press and one release.
- The pointer's arrival at the start and end is confirmed with short polling;
  a slow desktop is not treated as an immediate miss.
- The default observer captures the screen under the start point before the
  press and after release. A custom observer must return non-empty bytes-like
  frame data.

`DragResult` reports `start`, `end`, `button`, `before`, `after`, and
`changed`. `changed` is `True` when the observed frames differ, `False` when
they are identical, and `None` when either observation is unavailable. These
values describe the observation; the agent must still inspect whether the
intended target changed.

If a press, move, release, or final-position check fails, the skill attempts
to release the button and raises `IncompleteDragError`. Its `start` and
`reached` attributes preserve the progress that could be established. Do not
blindly replay an incomplete drag; observe the current pointer and target
first.

### Scrolling

```python
from computer_use.pointer import scroll

result = scroll(
    x, y,
    direction="down",
    amount=2,
    screens=(capture.screen,),
)
```

Directions are `up`, `down`, `left`, and `right`; `amount` is a positive
integer. The pointer is moved to the target and the view is observed before
and after the scroll. `ScrollResult` reports `position`, `direction`,
`amount`, and `moved`:

- `True` — observed frames differ;
- `False` — the backend explicitly reported a no-op or frames are identical;
- `None` — the outcome could not be observed.

An unchanged view is a report, not a reason to claim that scrolling worked.
Inspect the fresh capture and choose another target, direction, or recovery
step when the requested content is not visible.

### Bounded region observation

Use `capture_region` when only a local area is relevant. The default box space
is selected-screen pixels; use `space="desktop"` for absolute desktop bounds:

```python
from computer_use.region import capture_region

region = capture_region(
    capture.screen,
    (left, top, width, height),
    shooter=shooter,
)
before = region.observe()
# perform a bounded action
after = region.observe()
print(region.origin, region.desktop_origin, region.size, region.context)
```

`RegionCapture` contains the native-resolution image, selected `screen`,
requested and clipped bounds, local `origin`, `desktop_origin`, `size`,
`scale`, and a matching `CoordinateContext`. Partial boxes are clipped and
labeled with their actual origin; empty, non-finite, fractional, or wholly
outside boxes raise `RegionCaptureError` before a misleading result is
returned. `region.observe()` reuses the same source bounds and context for a
fresh sample. Bounded capture failures remain explicit unless
`fallback_full_screen=True` is selected; a fallback is labeled in `note` and
`fallback` and is not equivalent to a bounded observation.

## Focus, typing, and keys

### Application focus

```python
from computer_use.apps import focused_window, open_app

opened = open_app("Calculator")
print(opened.app, opened.focused, opened.already_open)
print(focused_window())
```

`open_app` accepts a case-insensitive application name. It brings an existing
application forward without relaunching it, or launches a missing application,
then polls current visibility and focus until both are confirmed. Its bounded
`timeout` and `poll_interval` apply to launch and activation; a launched app
that never becomes visible is not activated as a guessed fallback.
`focus_app` only accepts an application already reported as running and polls
until it is actually frontmost. `focused_window` reports the current
frontmost name without inventing a name when the platform cannot determine it.

For a read-only condition after another operation, use
`wait_for_window(application, condition="visible"|"focused", ...)`. It returns
`WindowWaitResult.status` as `satisfied`, `timed_out`, or `unavailable`, keeps
the latest fresh state, and performs no launch or activation.

Use the returned canonical application/focus name as evidence, but still take
a fresh screen capture before locating a field. If focus confirmation fails,
stop typing and report the visible alternatives or the actual frontmost name.

### Text entry

```python
from computer_use.keyboard import type_text

result = type_text("Draft title — 2026")
print(result.text, result.typed, result.failed)
```

`type_text` accepts an exact string and attempts each character separately.
Its optional `interval` (also `pace`/`inter_key_delay`) and `settle` values
are bounded and are validated before delivery. Pass `focus_check` to require
an explicit boolean focus confirmation before the first character.
`TypeResult` contains the original `text`, the successfully `typed` text,
a tuple of `failed` characters, and `delivered`. A character that the
backend cannot produce is named rather than silently skipped. A systemic
backend failure raises `KeyActionError`.

For acceptance proof, pass `field_reader` and optionally
`acceptance_timeout`, `acceptance_interval`, `committed`, or `commit_reader`.
The returned `TypeResult.acceptance` is a `FieldWaitResult`; `delivered=True`
and `accepted=True` are separate facts. Exact comparison preserves boundary
whitespace. A missing, partial, wrong, or uncommitted field is not relabeled
as accepted merely because keystrokes were delivered.

### Individual keys and shortcuts

```python
from computer_use.keyboard import hotkey, press_key

press_key("escape")
press_key("return")                 # canonical result: enter
hotkey("cmd", "a")                 # macOS select all
hotkey("ctrl", "s")                # common non-macOS save shortcut
```

Supported individual keys are:

```text
escape, enter, tab, up, down, left, right,
backspace, delete, space, home, end
```

Aliases are `esc` → `escape`, `return` → `enter`, and `del` → `delete`.
Names are case-insensitive and surrounding whitespace is ignored.

A hotkey needs one or more modifiers followed by one final printable
character. Supported modifiers are `shift`, `ctrl`, `alt`, and `cmd`, with
`option`, `control`, and `command` aliases. `KeyResult` and `HotkeyResult`
report canonical names and the exact requested chord. Unsupported keys,
modifiers, malformed chords, or delivery failures raise `KeyActionError`
instead of being replaced with another key.

## Fresh verification

The low-level action result says what the backend accepted. Verification says
what can be learned from a fresh observation. Use semantic checks whenever the
intended effect can be identified. The condition helpers are read-only and
bounded:

```python
from computer_use.conditions import wait_for_field, wait_for_window

window = wait_for_window("Editor", condition="focused", timeout=3)
field = wait_for_field("Editor", "exact title", reader=read_field)
```

`wait_for_window` reports `satisfied`, `timed_out`, or `unavailable` with its
latest `WindowObservation`. `wait_for_field` reports `accepted`, `committed`,
`timed_out`, or `unavailable` with exact `expected` content and the latest
`FieldObservation`. Neither helper mutates the application, field, or
clipboard.

`wait_for_region_change` consumes a `RegionCapture` baseline and polls the same
context. Its status is `changed`, `unchanged`, `timed_out`, or `unavailable`;
`changed` proves only a visual difference in that bounded region, not the
application's semantic meaning.

### One step

```python
from computer_use.keyboard import press_key
from computer_use.screen import capture_screen
from computer_use.verify import verify_step


def fresh_frame():
    return capture_screen(1).image.tobytes()


step = verify_step(
    "dismiss dialog",
    lambda: press_key("escape"),
    observer=fresh_frame,
)

if not step.verified:
    # Treat the step as inconclusive; do not continue blindly.
    print(step.note)
```

`verify_step(description, action, observer=None)` runs the action first and
then calls the observer. The observer's non-empty bytes-like result is
normalized as a fresh frame. `VerifiedStep.verified` means that a fresh frame
was obtained; it does **not** infer the application's semantic effect. The
agent must inspect that frame or use an action-specific check. An action
exception propagates because no post-action verification can honestly be
claimed. Observer failure or an unusable frame returns `verified=False` with
an inconclusive note.

### Ordered steps

```python
from computer_use.verify import run_sequence

sequence = run_sequence(
    [
        ("open menu", lambda: click(menu_x, menu_y)),
        ("choose item", lambda: click(item_x, item_y)),
    ],
    observer=fresh_frame,
)

if not sequence.all_verified:
    print(sequence.summary)
```

`run_sequence` observes after each step and stops at the first inconclusive
step. It never runs later steps on the basis of a missing observation.
`SequenceReport` preserves the ordered `steps`, `summary`, and `final_frame`.

### Predictable batches

Use `run_batch` when all targets are known and the interaction is stable. It
records each action while sharing one bounded pre/post observation boundary;
pass a `RegionCapture` as `region` to keep that evidence local:

```python
from computer_use.batch import BatchAction, run_batch

batch = run_batch(
    [
        ("stroke one", lambda: draw_one()),
        ("stroke two", lambda: draw_two()),
        BatchAction("choose result", choose_result,
                    requires_observation=True),
    ],
    region=region,
)
```

`BatchReport` keeps ordered `ActionRecord`s, individual `delivered` values,
`start_observation`, `end_observation`, `changed`, `progress`, and
`unresolved`. An unsafe, non-batchable, or result-dependent `BatchAction`
returns `split_required` before that action. Use a one-action batch or
`verify_step` when an intermediate result, safety boundary, focus change, or
uncertainty requires it. Delivery or observation failure is never reported as
batch completion.

Verification is not a screenshot-equality shortcut. The agent should state the
specific visible evidence it used: the intended window appeared, the selected
row became active, the field contains the requested content, the page moved to
the expected region, or the target state is still unknown.

## Recovery with progress preserved

For an action that may need retries, use `recover_step` instead of writing an
unbounded retry loop:

```python
from computer_use.recovery import recover_step

report = recover_step(
    "select the save button",
    action=lambda: click(save_x, save_y),
    check=lambda frame: save_effect_is_visible(frame),
    observer=fresh_frame,
    refresh=lambda: open_app("TextEdit"),
    progress=("opened TextEdit", "entered the document title"),
    max_attempts=3,
)
```

The operation performs the action, obtains a fresh frame, and passes that
frame to `check`. On a failed attempt it calls `refresh` before the next
attempt, when supplied. `refresh` should re-observe or restore focus/location;
it must not erase or replay earlier progress. `RecoveryReport` contains:

- `description` — the normalized failed-step description;
- `attempts` — `Attempt` records with number, outcome, frame, effect flag,
  and an explanatory note;
- `recovered` — whether a check returned true;
- `progress` — preserved earlier step descriptions;
- `question` — a specific operator question after exhaustion, otherwise
  `None`;
- `final_frame` — the last usable frame, if any.

Invalid descriptions, hooks, progress entries, or retry budgets raise
`RecoveryError`. Action errors, observer failures, and check errors are kept
in attempt notes so the agent can explain the cause. Exhaustion is not success:
stop at the failed step, report the preserved progress, and ask what should
change before another attempt. A delivered `TypeResult` whose field
acceptance is false is a stop condition, not an automatic text replay.

For partial batches, use `recover_batch`:

```python
from computer_use.recovery import recover_batch

recovered = recover_batch(
    actions,
    observer=fresh_frame,
    refresh=refresh_focus_and_reference,
    progress=("completed earlier stroke",),
    max_attempts=3,
)
```

The first pass may use the planned safe batch. Every retry starts with a fresh
observation and narrows to the unresolved action; confirmed prefix actions are
skipped and never replayed. `BatchRecoveryReport` preserves per-attempt batch
reports, confirmed `progress`, `unresolved`, the latest observation/frame, and
a specific `question` after exhaustion. A stale context, failed refresh, or
uncertain post-batch observation stops dependent work rather than guessing.

## Composing a task

`run_task` applies the same recovery contract to an ordered list of
`(description, action, check)` triples:

```python
from computer_use.tasks import run_task

report = run_task(
    "open and save a document",
    [
        ("open editor", lambda: open_app("TextEdit"),
         lambda frame: frame_is_nonempty(frame)),
        ("save document", lambda: hotkey("cmd", "s"),
         lambda frame: save_result_is_visible(frame)),
    ],
    observer=fresh_frame,
    progress=(),
)

print(report.summary)
```

`run_task` stops at the first unrecovered step. `TaskReport.completed` is the
completion gate; a summary or final frame without `completed=True` is not a
successful task. Earlier completed step descriptions are carried into later
recovery attempts.

### Built-in message and journal flows

Use these helpers only when their application-specific contracts match the
operator's task:

```python
from computer_use.tasks import reply_to_message, write_journal_entry

reply = reply_to_message(
    "Ada",
    "I will be there at 3 PM.",
    app="Messages",
    send=False,                   # sending requires an explicit instruction
    checks={
        "enter reply to Ada": content_check,
    },
)

entry = write_journal_entry(
    "Today I finished the draft.",
    app="TextEdit",
    new_document=True,
    checks={
        "enter journal entry": content_check,
    },
)
```

`reply_to_message` opens the app, selects the requested conversation (or a
fresh compose when `select="compose"`), enters the reply, and optionally sends
it when `send=True`. The default selection flow searches for the conversation
and validates the selection result. A callable `select` may provide a
purpose-built selection flow, but it cannot bypass selection or content
proof. `send` defaults to `False`.

`write_journal_entry` opens the editor, optionally creates a fresh document,
and enters the exact content. Both helpers require an explicit content-aware
check for the entry step. `recopy_content_check(deps, text)` provides a
second clipboard readback check: it selects all, copies, reads the clipboard,
and requires a non-empty fresh frame. Clipboard equality plus an unrelated
changed frame is not enough to prove that the intended field contains the
text.

On macOS, the built-in flows also require the independent accessibility
readers in `TaskDeps`: selection is checked through the named app's window
title and content through its focused field value. A missing oracle fails
closed rather than silently weakening the proof. The default `TaskDeps` wires
together the real app, keyboard, capture, clipboard, and accessibility
adapters; custom dependencies are useful for hermetic tests.

## Permission handling

Check permissions explicitly when diagnosing setup or before a user-visible
operation:

```python
from computer_use.permissions import (
    check_permissions,
    guidance_for,
    require_permissions,
)

status = check_permissions()
print(guidance_for(status).message)
require_permissions("screen")
require_permissions("input")
```

The two capability names are:

- `screen` — permission to see the screen through capture;
- `input` — permission to move, click, scroll, type, press keys, focus, or
  arrange windows.

`PermissionStatus` contains `screen_granted`, `input_granted`, and the
application name used in guidance. `Guidance` contains `missing`, `app`, and a
plain-language `message`. `require_permissions` probes only the requested
capabilities, so an unrelated probe failure does not block a valid operation.

On macOS, guidance points to:

```text
screen -> System Settings → Privacy & Security → Screen Recording
input  -> System Settings → Privacy & Security → Accessibility
```

It names the application that must be enabled and instructs the operator to
retry. `PermissionDeniedError` is a stop condition, not a signal to continue
with a blank image or simulated input. On platforms without an implemented OS
permission probe, `OpenProber` reports the gates as open; capture/input can
still fail later if the desktop session disallows them.

## Optional visual and accessibility helpers

### Independent accessibility readers

```python
from computer_use.ax import field_value_of, window_title_of

window_title = window_title_of("TextEdit")
field_value = field_value_of("TextEdit")
```

These readers are macOS-only in the current implementation. They address the
named application rather than trusting the possibly stale frontmost-app
report, settle asynchronous attribute changes, and return `None` when the
value is unavailable. They do not read pixels or the clipboard, so they are an
independent oracle for visible target and field content.

### Region text extraction

```python
from computer_use.text import extract_region_text

reading = extract_region_text(capture.image, (left, top, width, height))
print(reading.text, reading.reliability, reading.offset)
```

`extract_region_text` returns a `TextReading` with `text`, `reliability`, the
native-resolution `image`, the crop `offset`, and an optional `note`:

| Reliability | Meaning |
|---|---|
| `observed` | Text came from accessibility elements intersecting the region. |
| `inferred` | Text came from an OCR reader and may be wrong. |
| `unreadable` | Neither source produced usable text. |

The default OCR path uses `tesseract` when that executable is available. A
caller may inject `elements(box)` and `ocr(crop)` readers. If accessibility
and OCR disagree, the result is marked `inferred`, the conflict is recorded,
and the attached native-resolution image remains authoritative. Never turn an
`inferred` or `unreadable` result into an observed fact without inspecting the
image.

## Failure and recovery playbook

### Runtime setup fails

1. Keep the operation from running.
2. Read the `BootstrapError` message; it names the runtime, command, or
   dependency that failed.
3. Correct the environment (for example network/package access) and retry the
   same invocation.
4. Do not install the package globally or claim a half-created runtime is
   ready.

### Capture, pointer, or reference fails

1. Check `PermissionDeniedError`, `CaptureError`, `PointerError`, or
   `ReferenceError` and report its cause.
2. Recheck the selected screen and current display state.
3. Use a fresh capture and, for a small or dense target, a bounded
   `zoom_region`/`prepare_reference` view.
4. Ask the operator when no readable image or coordinate can establish the
   next action. Never estimate a coordinate to get past the error.

### An action is rejected or incomplete

1. Do not substitute another button, key, screen, or target.
2. For an `ActionError`, re-observe the pointer and screen, then correct the
   validated input if the target remains visible.
3. For `IncompleteDragError`, use its `reached` position and fresh capture to
   decide whether cleanup or a new path is safe.
4. For delivery failure, report the backend cause and stop until the cause is
   understood.

### The action returned but the effect is missing

1. Capture a fresh frame; do not compare against a cached pre-action image.
2. Confirm focus and reread coordinates if the UI moved.
3. Use `recover_step` or `run_task` with a semantic check and an explicit
   `refresh` hook.
4. Retry only the failed step. Preserve and report completed progress.
5. After the retry budget, return the specific `question` and wait for an
   operator decision.

### Permission is denied

Stop the affected operation, show `guidance_for(check_permissions())` or the
`PermissionDeniedError` message, and wait for the operator to grant the
named permission. Then retry the same step from a fresh observation.

### Optional capability is unavailable

Use the standard fallback and preserve the warning. For example, treat OCR as
inferred and inspect the image, or continue without window arrangement when
only focus is needed. Do not silently present an optional gap as an exact
observation.

## End-to-end workflow

Use this sequence for a real desktop task:

### 1. Establish readiness

Invoke the operation through `bootstrap.invoke`. If setup fails, stop with the
named explanation.

### 2. Observe the actual starting state

Capture the intended screen, list its dimensions and screen identity, and read
the current pointer position. Note the focused application when keyboard input
will be used.

### 3. Prepare a coordinate reference

Call `prepare_reference(capture)`. Read the target from the reference image;
if it is a zoom crop, map local coordinates using `offset`. Keep the target's
screen record with those coordinates.

### 4. Focus the target when required

Open or focus the named application, confirm the returned focus, then capture
again. Do not type into a target merely because it was previously focused.

### 5. Perform one action or a predictable batch

Validate all parameters and call either one operation or a bounded sequence of
related operations whose targets and effects are already understood. Record
each result and the batch boundary. Use a single operation when an action is
safety-sensitive, asynchronous, uncertain, or needed to determine the next
target. For a path, retain every waypoint; for a content action, retain the
exact requested text.

### 6. Re-observe at the required boundary

Take a fresh capture after an individual action when its result matters
immediately, or after a predictable batch before the next dependent decision.
Use `verify_step`/`run_sequence` when per-step frame availability is required,
and inspect the target-specific effect yourself or through an independent
oracle. Do not let batching cross an uncertainty or safety boundary.

### 7. Continue, recover, or clarify

- If the intended effect is visible, repeat from step 2 for the next target.
- If the effect is absent, recover only the smallest unresolved step or
  batch with fresh location and focus.
- If the target is ambiguous, permission is denied, or the evidence remains
  unavailable, ask the operator a specific question.

### 8. Report completion honestly

Return the ordered actions, fresh verification evidence, any recovered steps,
remaining warnings, and the final visible state. Say that the task is
complete only when the final target-specific check passes.

A compact example has two parts. Put the capability operation in an
importable module executed by the prepared interpreter:

```python
# my_task_module.py
from computer_use.grid import prepare_reference, to_screen
from computer_use.pointer import click
from computer_use.screen import capture_screen
from computer_use.verify import verify_step


def main():
    capture = capture_screen(1)
    reference = prepare_reference(capture)

    # The agent reads these from reference.image. They are not guessed.
    target_x, target_y = read_target_coordinates(reference.image)
    if reference.kind == "zoom":
        target_x, target_y = to_screen(
            target_x, target_y, reference.offset
        )
    target_x += capture.screen.left
    target_y += capture.screen.top

    return verify_step(
        "click the visible target",
        lambda: click(
            target_x, target_y, screens=(capture.screen,)
        ),
        observer=lambda: capture_screen(
            capture.screen.index
        ).image.tobytes(),
    )


if __name__ == "__main__":
    print(main())
```

Start that module through the setup gate from the host:

```python
from pathlib import Path

from computer_use.bootstrap import invoke

result = invoke(Path.cwd(), ["-m", "my_task_module"])
```

`read_target_coordinates` in this example represents the agent's visual
reading step; it must be replaced by coordinates actually read from the
reference image, never by a fixed guess. The module and all capability imports
run under the prepared interpreter; a host-side callback is intentionally not
accepted by `invoke`.

## Verification and quality checklist

Before declaring a desktop task complete, confirm:

- The runtime was prepared in `.artifacts/computer-use/.runtime` and no global
  installation was required.
- The current screen, selected screen identity, dimensions, and pointer
  position were observed.
- Every coordinate was read from a current reference and converted from a crop
  offset when necessary.
- The target application was focused before keyboard input.
- Each action or bounded batch returned explicit results and was followed by
  a fresh observation before any dependent decision; safety-sensitive or
  uncertain actions were verified individually.
- The observed effect belongs to the intended target, not merely an unrelated
  frame change.
- Any false, `None`, inferred, unreadable, or inconclusive result was reported
  as such.
- Failed steps were retried only with fresh state and prior progress preserved.
- Permission failures named the exact capability and repair location.
- Optional warnings and platform limitations remain visible in the report.
- No temporary fake backend, stale screenshot, guessed coordinate, debugging
  probe, or unsupported fallback was used to claim success.

For package development, keep backend tests hermetic by injecting controllers,
shooters, observers, probers, application backends, and text readers. Live
verification should be deliberate and read-only where possible; record what
application was opened and leave the operator's desktop state under the
operator's control.

## Truth and uncertainty contract

The agent may state as observed only what the current capture, returned
position, named-app reader, or other explicit result establishes:

- **Observed:** a current image contains a visible control; a backend reports a
  final pointer position; an accessibility reader returns a named title or
  field value; a fresh frame differs from the prior frame.
- **Inferred:** the visible change probably means a button activated, content
  is likely scrolled, or a task appears complete. Phrase this as an inference
  unless a target-specific check proves it.
- **Unknown:** a frame is empty/unavailable, a `None` outcome is returned, OCR
  is uncorroborated, focus cannot be confirmed, or the target cannot be
  distinguished. Preserve the unknown and ask for clarification or recover.

The skill's purpose is precise, observable control—not confidence theater.
Never claim pixel-perfect, delivery-perfect, or task-perfect success from an
unverified impression.
