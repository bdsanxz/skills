# Capture harness: one binary, every screen, deterministic shots

Pixel-diff scoring needs screenshots at exact size and density. The pattern:
one binary renders every screen, selected by environment, and exits after
saving the shot.

## One binary, env-selected screen

- `FF_SCREEN=<n>` selects one screen (`0` stacks several for harness-only
  overview). Never hardcode the screen; the same binary serves capture,
  check, and interactive modes.
- `FF_OUT=path.png` arms the screenshot: at a fixed frame the app requests
  `ctx.request_screenshot`, saves the `ColorImage` as PNG, and exits 0 once
  the file exists. Past a frame budget without a file it exits nonzero
  (timeout). Delete a stale file at startup so a previous shot can never
  pass as a new one.
- `FF_INTERACTIVE=1` disables the auto-shot and auto-exit and shows the
  window with decorations. This is the human-check mode; captures never
  use it. Scroll bars stay hidden in capture mode but switch to
  visible-when-needed in interactive mode, so a human can drag through a
  tall page; a scrollbar in a capture is a defect, not a feature.
- Window size equals the design viewport (for example 1440x900),
  `with_decorations(false)`, `set_pixels_per_point(1.0)` in app code so one
  egui point equals one CSS pixel. Repaint every frame in capture mode so
  the shot never waits on an event loop.

## Determinism proof

Capture any screen twice without changes and byte-compare (`cmp`): identical
bytes required before any scoring round counts. Animated content (playheads,
VU meters, progress) must rest at fixed state values during capture — state
lives in app state with fixed defaults, never random or time-based. For the
design side, freeze animations first (inject a style that disables
animation, transition, and caret blink) and prove stillness across reloads
and across scrolled offsets: overlap-diff two captures of the same page
rows and require zero structural difference before cutting below-fold
crops. A blurred diff that still mismatches in one band while the rest
matches points at genuinely scroll-dependent content (parallax, reveal
wipes) rather than noise — isolate that band instead of re-cutting
everything.

## Multi-offset captures

A tall page is verified at several scroll offsets, not just the fold:
the harness takes an env scroll offset that applies only in capture
mode (a forced offset overrides user scrolling every frame, so never
enable it interactively). For each offset, capture the scrolled design
reference the same way (scripted scroll, same viewport) and diff the
pair. Two traps: viewport-relative units (`min-h-screen`, `100vh`)
change the layout with the viewport height, so a tall-viewport
full-page shot is a different layout, never the reference — always
scroll the design viewport instead. And scroll clamping differs per
engine: keep test offsets within the browser's maximum
(content minus viewport), and confirm the rendered offset from pixels
before trusting a pair.

## Scoring loop input

Feed the PNGs to a pixel-diff scorer against the design screenshots at the
same size. The project's gate (content match, per-tile floor, tolerance)
decides pass or fail. A screen that stops below the gate is reported with
its score table plus the acknowledged deviation — never re-tuned by
regenerating the reference.
