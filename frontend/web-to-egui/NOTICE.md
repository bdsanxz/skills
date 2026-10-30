# Third-party material bundled with web-to-egui

## Fonts (`dev/frameforge-egui/assets/fonts/`)

- Inter Regular / SemiBold / ExtraBold, InterTight Bold / Black, JetBrains
  Mono Regular / SemiBold, Outfit Regular / Bold / ExtraBold (the last
  instantiated from the variable font) — SIL Open Font License 1.1
  (https://scripts.sil.org/OFL).
- Material Icons Regular — Apache License 2.0
  (https://www.apache.org/licenses/LICENSE-2.0), from
  `google/material-design-icons` (static icon font; icon names address it by
  PUA codepoint because egui performs no ligature substitution).

## Photo assets (`dev/frameforge-egui/assets/img/s{1..5}-*.jpg`)

- Origin: `<img>` / CSS background URLs in `ui-design/1-4.html` (screen 5:
  hero panel background), hosted on `lh3.googleusercontent.com/aida-public`
  (Google Stitch AI-generated stills), downloaded once for offline,
  byte-identical rendering.
- License: unknown — no license metadata ships with the files. Treat every
  file as an unredistributable placeholder: same bytes are required for the
  99% pixel-match experiment, and each must be replaced with licensed art
  (or a regenerated still the project owns) before any release. Do not copy
  these files into a shipped product.
- `s5-crop-*.png` are different: crops cut from the project's own design
  screenshot (no third-party bytes), used for byte-exact static copy. They
  carry no license constraint but must be re-cut if the design changes.

## Rust dependencies (`dev/frameforge-egui/Cargo.toml`)

- `egui` / `eframe` 0.37, `image` 0.25 — MIT OR Apache-2.0.
