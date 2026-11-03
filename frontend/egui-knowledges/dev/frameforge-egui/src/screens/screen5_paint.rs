//! Shared paint helpers for the screen-5 transcriptions (1440 + wide).
//!
//! All helpers paint in page coordinates relative to an origin `o`; `dw`
//! is the transcription's design width (1440 or 1920) and drives the
//! edge-bleed rules, so both generations stay capture-exact at their own
//! width while sharing one implementation.

use crate::theme::*;
use egui::{Align2, Color32, CornerRadius, FontFamily, FontId, Pos2, Rect, Stroke, Ui, Vec2};

pub(crate) const CARBON: Color32 = Color32::from_rgb(0x0a, 0x0a, 0x0a);
pub(crate) const SURFACE: Color32 = Color32::from_rgb(0x18, 0x18, 0x18);
pub(crate) const LOWEST: Color32 = Color32::from_rgb(0x13, 0x13, 0x13);
pub(crate) const CONTAINER: Color32 = Color32::from_rgb(0x1f, 0x20, 0x20);
pub(crate) const OUTLINE: Color32 = Color32::from_rgb(0x33, 0x33, 0x33);
/// Dimmer split rule used inside the redacted catalog row.
pub(crate) const SPLIT: Color32 = Color32::from_rgb(0x1E, 0x1E, 0x1E);
pub(crate) const PHOSPHOR: Color32 = Color32::from_rgb(0xea, 0xea, 0xea);
pub(crate) const SECONDARY: Color32 = Color32::from_rgb(0xc6, 0xc6, 0xc6);

/// Vertical ink correction for the surviving native caption row.
pub(crate) const DY_MONO: f32 = -1.0;

/// Window content width: stable across scrollbar show/hide, unlike the
/// in-ScrollArea available width which would feed back into centering.
pub(crate) fn vw(ui: &Ui) -> f32 {
    ui.ctx().viewport_rect().width()
}

/// Weight-aware mono: 600+ -> JetBrainsMono-SemiBold, else Regular
/// (measured closer than SemiBold for the 500 cuts).
pub(crate) fn fmono(size: f32, fw: u16) -> FontId {
    if fw >= 600 {
        FontId::new(size, FontFamily::Name("jb-semibold".into()))
    } else {
        FontId::monospace(size)
    }
}

/// Advance of one char measured through the font's own shaper.
pub(crate) fn ch_w(p: &egui::Painter, ch: char, font: &FontId) -> f32 {
    p.layout_no_wrap(ch.to_string(), font.clone(), Color32::TRANSPARENT).size().x
}

/// Total advance of `s` including pair kerning and CSS-style trailing
/// letter-spacing, measured exactly the way `ttrack` draws.
pub(crate) fn twidth(ui: &Ui, s: &str, font: &FontId, track_em: f32) -> f32 {
    let p = ui.painter();
    let t = track_em * font.size;
    let chs: Vec<char> = s.chars().collect();
    let mut w = 0.0;
    for (i, ch) in chs.iter().enumerate() {
        w += ch_w(p, *ch, font);
        if i + 1 < chs.len() {
            w += pair_k(p, *ch, chs[i + 1], font);
        }
        w += t;
    }
    w
}

/// Pair kerning between two adjacent glyphs, measured through the shaper:
/// positive when the pair sets wider than its parts.
pub(crate) fn pair_k(p: &egui::Painter, a: char, b: char, font: &FontId) -> f32 {
    let mut s = String::new();
    s.push(a);
    s.push(b);
    p.layout_no_wrap(s, font.clone(), Color32::TRANSPARENT).size().x - ch_w(p, a, font) - ch_w(p, b, font)
}

/// Tracked text, left-anchored at (x, y_top + dy), drawn one glyph at a time
/// with measured pair kerning between neighbours. Per-glyph layout widths
/// run ~0.1px under the browser's advances, so callers pass a per-line
/// tracking fudge (measured, ~±0.005em) that absorbs the drift; CSS
/// letter-spacing is added after every glyph including the last, matching
/// the browser.
pub(crate) fn ttrack(ui: &Ui, o: Pos2, x: f32, y: f32, s: &str, font: FontId, track_em: f32, dy: f32, c: Color32) {
    let p = ui.painter();
    let t = track_em * font.size;
    let y = y + dy;
    let chs: Vec<char> = s.chars().collect();
    let mut cx = x;
    for (i, ch) in chs.iter().enumerate() {
        let w = ch_w(p, *ch, &font);
        p.text(Pos2::new(cx + o.x, y + o.y), Align2::LEFT_TOP, ch.to_string(), font.clone(), c);
        let k = if i + 1 < chs.len() { pair_k(p, *ch, chs[i + 1], &font) } else { 0.0 };
        cx += w + k + t;
    }
}

/// Tracked text centered on `cx`.
pub(crate) fn ttrack_c(
    ui: &Ui, o: Pos2, cx: f32, y: f32, s: &str, font: FontId, track_em: f32, dy: f32, c: Color32,
) {
    let x = cx - twidth(ui, s, &font, track_em) / 2.0;
    ttrack(ui, o, x, y, s, font, track_em, dy, c);
}

/// Edge-anchored fills bleed to the window edge in wider windows while
/// the content column stays fixed-width and centered: full-width bands
/// (`x == 0, w == dw`) span the window, and right-edge-anchored panels
/// extend to it. At the design width nothing changes (capture-exact).
pub(crate) fn fill(ui: &Ui, o: Pos2, dw: f32, x: f32, y: f32, w: f32, h: f32, c: Color32) {
    let v = vw(ui);
    // Bleed bands ignore the centering offset and anchor at the window
    // edge instead: full-width bands span 0..vw, and a panel ending at
    // the content edge extends to vw. At the design width o.x is 0 and
    // every branch below is exactly what it was (capture-exact).
    let (x, w) = if x == 0.0 && w == dw {
        (-o.x, v)
    } else if x + w == dw && w < dw {
        (x, v - (x + o.x))
    } else {
        (x, w)
    };
    ui.painter().rect_filled(
        Rect::from_min_size(Pos2::new(x + o.x, y + o.y), Vec2::new(w, h)),
        CornerRadius::same(0),
        c,
    );
}

pub(crate) fn hline(ui: &Ui, o: Pos2, dw: f32, x0: f32, x1: f32, y: f32, c: Color32) {
    // Full-width rules bleed like the bands; grid rules keep their span.
    let x1 = if x0 == 0.0 && x1 == dw { vw(ui) } else { x1 };
    fill(ui, o, dw, x0, y, x1 - x0, 1.0, c);
}

pub(crate) fn vline(ui: &Ui, o: Pos2, x: f32, y0: f32, y1: f32, c: Color32) {
    fill(ui, o, f32::MAX, x, y0, 1.0, y1 - y0, c);
}

pub(crate) fn stroke_rect(ui: &Ui, o: Pos2, x: f32, y: f32, w: f32, h: f32, c: Color32) {
    ui.painter().rect_stroke(
        Rect::from_min_size(Pos2::new(x + o.x, y + o.y), Vec2::new(w, h)),
        CornerRadius::same(0),
        Stroke::new(1.0, c),
        egui::StrokeKind::Inside,
    );
}

/// Design-crop image drawn 1:1 (byte-exact for static copy).
pub(crate) fn crop(ui: &Ui, o: Pos2, photos: &crate::photos::Photos, key: &str, x: f32, y: f32, w: f32, h: f32) {
    if let Some(t) = photos.get(key) {
        ui.painter().image(
            t.id(),
            Rect::from_min_size(Pos2::new(x + o.x, y + o.y), Vec2::new(w, h)),
            Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
            Color32::WHITE,
        );
    }
}
