---
name: web-to-egui
description: Translate a web UI into idiomatic egui Rust code with equivalent layout, style, and components, verified by cargo check. Use when the user supplies a web reference (HTML/CSS, React, Tailwind, a live page, or design images of a web UI) and asks for the egui version, an egui port, or names web-to-egui. Do not use for a loose "build something like this" without a web source, or for pixel-exact proof (use pixel-perfect for that).
---

# Web to egui

Turn a web UI into real egui code with the same structure and look, using the project's egui version and idioms. The loop is: inventory the web UI, map each pattern to its egui equivalent, build bottom up, then prove it compiles.

## Phase 0: Set up

1. Identify the web source: framework, styling approach (plain CSS, Tailwind, CSS-in-JS), and component conventions. If the source is a live site, save its HTML/CSS or screenshots as the frozen reference.
2. Identify the egui target: read `Cargo.toml` for the `egui`/`eframe` version and follow that API only. Never mix APIs from another egui version.
3. Run `cargo check` once as the baseline. It must pass before and after the work.

## Phase 1: Inventory the web UI

1. Break the web UI into three levels, in dependency order:
   - **Tokens**: colors, fonts, radii, borders, shadows, spacing scale.
   - **Components**: button, badge, input, tab, card, nav item, section heading. One entry per reusable thing, with every variant and state.
   - **Sections/screens**: full-width bands and screens composed from components, in order.
2. For each token, record the exact web value (hex, px, font name/weight). For each component, record its box model (size, padding, gap), its states (default, hover, disabled, active), and its text content verbatim.
3. Inventory every web image (`<img>` and CSS backgrounds) in document order per screen with its role, box, and treatment (cover crop, radius, opacity, grayscale, overlays). Follow `references/web-images.md` section 1. Every image must render from the same bytes in egui; painted placeholders never match.

## Phase 2: Map to the equivalent egui stack

Translate each web pattern to its egui equivalent, never by copying CSS semantics into egui:

| Web | egui |
| --- | --- |
| `div` block / column | `Ui::vertical` |
| `flex row` | `Ui::horizontal` |
| grid | `egui::Grid` |
| scroll container | `egui::ScrollArea` |
| box (background, border, radius, padding) | `egui::Frame` + `Margin` + `Stroke` + `Rounding` |
| text, heading | `egui::Label` / `RichText` |
| button | `egui::Button` |
| text input | `egui::TextEdit` |
| image (`object-cover`, radius, `opacity-*`, `grayscale`) | baked texture + rounded-rect cover mesh, treatments per layer — follow `references/web-images.md` section 2, never `egui::Image` for design photos |
| icon font (glyph name + size) | bundled static cut addressed by codepoint, ink-centered per size — see `references/layout-patterns.md`, text honesty; text stand-in only when the name is missing from the cut |
| text weight (400/500/600/700) | bundled cut per weight (see `references/layout-patterns.md`, text honesty); same-size text in the wrong cut drifts in width and fails a diff |
| page/section wrapper | one `Frame` per section, composed in a parent `Ui` |
| CSS colors / Tailwind palette | `egui::Color32` constants in one `theme` module |
| CSS spacing scale | `egui::Vec2` / `Margin` constants in the same module |
| `letter-spacing` / `word-spacing` | glyph-wise tracked text with measured pair kerning — follow `references/layout-patterns.md`, tracked text |
| tall scroll page with absolute paint | `ScrollArea` + page origin added to every painted coordinate — follow `references/layout-patterns.md`, absolute painting |
| full-page noise/grain overlay | measured flat mean-lift, or baked crops when the spread demands it — follow `references/web-images.md`, sections 3–4 |

1. Write the token mapping first as one `theme` module: every color, rounding, stroke, and spacing constant lives there. Components take values only from it, never as inline literals repeated per call site.
2. Map layout structure before style: direction, nesting, and scroll behavior first, then colors, borders, and text metrics. Apply `references/layout-patterns.md` for the skeleton and recurring components before inventing new widgets. Map every tag and every CSS attribute through `references/tag-attribute-map.md` — transcribe resolved px values verbatim, never approximate a flex distribution.
3. When a web pattern has no direct egui equivalent (CSS shadow blur, complex gradients, web-only flow), pick the closest `Frame`/`Stroke` approximation and record it as an accepted deviation in the report. Never invent an egui API.

## Phase 3: Build bottom up

1. Implement tokens, then components in dependency order, then sections, then screens. Never draft a whole screen first and tune it afterwards.
2. Follow the target project's idiom: its widget conventions, state ownership (`use_state`-equivalent in egui is explicit app state), and file layout. Reuse an existing project widget when it matches exactly.
3. Each component is a function rendering into a `Ui`, with every variant reachable through real app state, never through preview-only parameters.

## Phase 4: Verify

1. Run `cargo check`. It must pass with no errors and no new warnings from the added code. Capture every screen with the env-selected harness in `references/capture-harness.md` and prove determinism (two identical bytes) before trusting any screenshot.
2. Run `cargo clippy -- -D warnings` only if the project already uses clippy clean; otherwise skip it rather than reforming the project.
3. Report done only when `cargo check` passes: list each screen/section/component ported, each accepted deviation from step 2 of Phase 2, and the exact check command and its output.
