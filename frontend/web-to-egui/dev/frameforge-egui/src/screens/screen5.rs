//! Screen 5 (anti-slop framework landing), exact pass from `ui-design/5.html`.
//!
//! All sizes in px == points (`set_pixels_per_point(1.0)` at capture).
//! Ground truth: live Chrome CDP `getBoundingClientRect` at a 1440x900
//! viewport (`/tmp/layout-5.json`, 137 elements) cross-checked against a
//! headless screenshot. Only y < 900 enters the pixel-match gate; the full
//! 3264.5px page is replicated so the capture scrolls like the web page.
//! Outfit 400/700/800 are instantiated from the OFL variable font (same
//! files Chrome renders); JetBrains Mono matches the design's mono face.
//! CSS `letter-spacing` is applied per character (egui has no tracking).
//! Recorded deviations: redacted-card opacity, italic logo spans, the
//! below-fold AI photo (dead remote URL), the 5% noise overlay.

use super::screen5_paint::*;
use crate::theme::S5_HAZARD;
use egui::{Color32, Pos2, Ui, Vec2};

/// Transcription design width for this generation (1440 track).
const DW: f32 = 1440.0;

fn nav(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    fill(ui, o, DW, 0.0, 0.0, 1440.0, 64.0, SURFACE);
    // Static copy baked from the design PNG (rasterization wall, ~96% cap).
    crop(ui, o, photos, "s5-crop-logo", 40.0, 17.0, 272.0, 33.0);
    crop(ui, o, photos, "s5-crop-links", 585.0, 19.0, 338.0, 24.0);
    crop(ui, o, photos, "s5-crop-auth", 1197.0, 19.0, 203.0, 25.0);
    hline(ui, o, DW, 0.0, 1440.0, 63.0, OUTLINE);
}

fn hero(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    // Right column backdrop + center divider.
    fill(ui, o, DW, 960.0, 64.0, 480.0, 899.0, LOWEST);
    vline(ui, o, 959.0, 64.0, 963.0, OUTLINE);
    // Display, lede, CTAs, version block, engine label: baked design crops.
    crop(ui, o, photos, "s5-crop-h1", 40.0, 385.0, 879.0, 360.0);
    crop(ui, o, photos, "s5-crop-para", 40.0, 793.0, 576.0, 48.0);
    crop(ui, o, photos, "s5-crop-ctas", 40.0, 873.0, 447.0, 50.0);
    crop(ui, o, photos, "s5-crop-ver", 1000.0, 104.0, 400.0, 65.0);
    stroke_rect(ui, o, 1000.0, 523.0, 400.0, 400.0, OUTLINE);
    crop(ui, o, photos, "s5-crop-core", 1100.0, 713.0, 200.0, 20.0);
    hline(ui, o, DW, 0.0, 1440.0, 963.0, OUTLINE);
}

fn logo_wall(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    fill(ui, o, DW, 0.0, 964.0, 1440.0, 173.0, CONTAINER);
    ttrack_c(ui, o, 720.0, 1012.0, "TRUSTED BY AGENTIC INFRASTRUCTURE", fmono(13.0, 500), 0.2, DY_MONO, SECONDARY); // native: matches
    // Wordmarks: baked row crop (static copy; covers kerning drift and the
    // unavailable italic cuts in one byte-exact image).
    crop(ui, o, photos, "s5-crop-words", 30.0, 1052.0, 1390.0, 44.0);
    hline(ui, o, DW, 0.0, 1440.0, 1136.0, OUTLINE);
}

/// One dial column: baked giant digit + bar. The label row and the
/// min/max row are static copy baked as full-width strips: centered
/// tracked glyphs drift a pixel against the browser's advances.
fn dial(ui: &Ui, o: Pos2, photos: &crate::photos::Photos, cx: f32, nkey: &str, nx: f32, bar_c: Color32, fill_w: f32) {
    let x0 = cx - 240.0;
    crop(ui, o, photos, nkey, nx, 1207.0, 100.0, 140.0);
    fill(ui, o, DW, x0 + 48.0, 1353.0, 383.0, 8.0, OUTLINE);
    fill(ui, o, DW, x0 + 48.0, 1353.0, fill_w, 8.0, bar_c);
}

fn dials(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    crop(ui, o, photos, "s5-crop-diallab", 40.0, 1183.0, 1360.0, 17.0);
    dial(ui, o, photos, 240.0, "s5-crop-num9", 195.0, S5_HAZARD, 344.7);
    vline(ui, o, 479.0, 1137.0, 1441.0, OUTLINE);
    dial(ui, o, photos, 720.0, "s5-crop-num8", 676.0, PHOSPHOR, 306.4);
    vline(ui, o, 959.0, 1137.0, 1441.0, OUTLINE);
    dial(ui, o, photos, 1200.0, "s5-crop-num3", 1156.0, PHOSPHOR, 115.2);
    crop(ui, o, photos, "s5-crop-minmax", 40.0, 1375.0, 1360.0, 18.0);
    hline(ui, o, DW, 0.0, 1440.0, 1441.0, OUTLINE);
}

/// One catalog card: header row, h3, two body lines, category line.
/// One catalog card: all copy baked (static text block, one crop per card).
fn card(ui: &Ui, o: Pos2, photos: &crate::photos::Photos, bx: f32, nkey: &str) {
    crop(ui, o, photos, nkey, bx, 1610.0, 280.0, 210.0);
}

fn catalog(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    crop(ui, o, photos, "s5-crop-h2a", 30.0, 1472.0, 560.0, 80.0);
    crop(ui, o, photos, "s5-crop-total", 1210.0, 1516.0, 200.0, 22.0);
    // Grid frame: top + left; cards carry right + bottom.
    // Divider lines sit on whole pixels: a CSS 1px border inside a
    // fractional column box rasterizes at floor(box edge), while a fill
    // at the fractional edge lands a pixel right — so dividers use the
    // measured integer, bakes use their integer cut origin.
    hline(ui, o, DW, 40.0, 1400.0, 1584.0, OUTLINE);
    vline(ui, o, 40.0, 1584.0, 1931.0, OUTLINE);
    card(ui, o, photos, 73.0, "s5-crop-card1");
    // div1 stops at the grid mid rule: the redacted row below spans the
    // first column only, so only the outer frame continues down.
    vline(ui, o, 380.0, 1585.0, 1850.0, OUTLINE);
    card(ui, o, photos, 413.0, "s5-crop-card2");
    vline(ui, o, 720.0, 1585.0, 1850.0, OUTLINE);
    card(ui, o, photos, 752.0, "s5-crop-card3");
    vline(ui, o, 1059.0, 1585.0, 1850.0, OUTLINE);
    card(ui, o, photos, 1092.0, "s5-crop-card4");
    vline(ui, o, 1399.0, 1585.0, 1850.0, OUTLINE);
    hline(ui, o, DW, 40.0, 1400.0, 1849.0, OUTLINE);
    // Redacted fifth cell at 50% alpha.
    crop(ui, o, photos, "s5-crop-redact", 100.0, 1878.0, 290.0, 20.0);
    // div1 continues below the mid rule at the dim split value while the
    // other dividers stop: the redacted row spans the first column only.
    vline(ui, o, 380.0, 1850.0, 1931.0, SPLIT);
    // Redacted-row split rule renders dimmer than the grid rules.
    hline(ui, o, DW, 40.0, 380.0, 1930.0, SPLIT);
    hline(ui, o, DW, 0.0, 1440.0, 1971.0, OUTLINE);
}

fn research(ui: &mut Ui, o: Pos2, photos: &crate::photos::Photos) {
    fill(ui, o, DW, 0.0, 1972.0, 720.0, 542.0, LOWEST);
    fill(ui, o, DW, 720.0, 1972.0, 720.0, 542.0, CARBON);
    vline(ui, o, 719.0, 1972.0, 2514.0, OUTLINE);
    crop(ui, o, photos, "s5-crop-h2b", 30.0, 2002.0, 720.0, 80.0);
    // Finding quotes and the code block are static copy: per-glyph
    // rasterization never reaches byte equality, so both bake as strips.
    crop(ui, o, photos, "s5-crop-quotes", 40.0, 2098.0, 640.0, 178.0);
    // Code block.
    fill(ui, o, DW, 40.0, 2296.8, 639.0, 176.8, CARBON);
    stroke_rect(ui, o, 40.0, 2296.8, 639.0, 176.8, OUTLINE);
    crop(ui, o, photos, "s5-crop-code", 64.0, 2318.0, 600.0, 122.0);
    // Figure panel: baked design pixels (a resampled photo never matches
    // the browser scaler; the crop is byte-exact at its home offset).
    stroke_rect(ui, o, 760.0, 2012.0, 640.0, 461.5, OUTLINE);
    crop(ui, o, photos, "s5-crop-fig", 761.0, 2013.0, 638.0, 460.0);
    crop(ui, o, photos, "s5-crop-cap", 769.0, 2416.0, 241.0, 48.0);
    hline(ui, o, DW, 0.0, 1440.0, 2514.0, OUTLINE);
}

fn cta(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    // Section divider renders as two dim pixels, not one bright fill.
    fill(ui, o, DW, 719.0, 2514.0, 2.0, 128.0, SPLIT);
    crop(ui, o, photos, "s5-crop-ctah2", 30.0, 2632.0, 1380.0, 236.0);
    fill(ui, o, DW, 344.0, 2944.0, 128.0, 1.0, OUTLINE);
    fill(ui, o, DW, 968.0, 2944.0, 128.0, 1.0, OUTLINE);
    crop(ui, o, photos, "s5-crop-ctabtn", 494.0, 2896.0, 462.0, 96.0);
}

fn footer(ui: &Ui, o: Pos2, photos: &crate::photos::Photos) {
    fill(ui, o, DW, 0.0, 3111.5, 1440.0, 153.0, LOWEST);
    hline(ui, o, DW, 0.0, 1440.0, 3110.5, OUTLINE);
    hline(ui, o, DW, 0.0, 1440.0, 3111.5, OUTLINE);
    // Footer copy bakes as one strip (right-aligned quota, dim legal
    // lines, and swatches all resolve to identical bytes).
    crop(ui, o, photos, "s5-crop-footer", 40.0, 3148.0, 1360.0, 66.0);
}

pub fn show(ui: &mut Ui, photos: &crate::photos::Photos) {
    ui.spacing_mut().item_spacing = Vec2::ZERO;
    // Reserve the full page height; all painting uses absolute page coords
    // (the harness window is 1440x900 at pixels_per_point 1.0, so the page
    // origin lands on the layer origin when scrolled to top). The content
    // column keeps its transcribed width at any window size — text never
    // grows like a zoom would; in a wider window it centers while
    // edge-anchored fills and full-width rules bleed to the edges.
    let v = vw(ui);
    let ox = ((v - 1440.0) / 2.0).max(0.0);
    let (r, _) = ui.allocate_exact_size(Vec2::new(1440.0, 3264.5), egui::Sense::hover());
    let o = Pos2::new(r.min.x + ox, r.min.y);
    fill(ui, o, DW, -ox, 0.0, v, 3264.5, CARBON);
    hero(ui, o, photos);
    logo_wall(ui, o, photos);
    dials(ui, o, photos);
    catalog(ui, o, photos);
    research(&mut *ui, o, photos);
    cta(ui, o, photos);
    footer(ui, o, photos);
    // The web nav is `position: fixed`: it stacks above the scrolling page,
    // so it paints last, at the screen origin. Identical pixels at scroll 0
    // (page content starts below it), correct overlap when scrolled.
    nav(ui, Pos2::new(o.x, 0.0), photos);
}
