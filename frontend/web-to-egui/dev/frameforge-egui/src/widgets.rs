use crate::theme::*;
use egui::{Color32, RichText, Stroke, Ui, Vec2};

pub fn top_button(text: &str, active: bool, ui: &mut Ui) {
    let rt = RichText::new(text).size(13.0).color(if active {
        TEXT
    } else {
        DIM
    });
    if active {
        let _ = ui.label(rt.strong());
        let r = ui.min_rect();
        ui.painter().line_segment(
            [r.left_bottom() + Vec2::new(0.0, 2.0), r.right_bottom() + Vec2::new(0.0, 2.0)],
            Stroke::new(2.0, CYAN),
        );
    } else {
        ui.label(rt);
    }
}

pub fn media_card(ui: &mut Ui, name: &str, dur: &str, hue: Color32, selected: bool) {
    frame_raised().show(ui, |ui| {
        ui.set_min_size(Vec2::new(118.0, 86.0));
        ui.set_max_size(Vec2::new(118.0, 86.0));
        let (r, _) = ui.allocate_exact_size(Vec2::new(102.0, 52.0), egui::Sense::hover());
        ui.painter().rect_filled(r, 4.0, hue);
        ui.painter().text(
            r.right_bottom() + Vec2::new(-6.0, -6.0),
            egui::Align2::RIGHT_BOTTOM,
            dur,
            egui::FontId::monospace(9.0),
            Color32::WHITE,
        );
        ui.label(RichText::new(name).size(10.0).color(TEXT));
    });
    if selected {
        let r = ui.min_rect();
        let _ = r;
    }
}

pub fn track_lane(ui: &mut Ui, label: &str, color: Color32, clips: &[(&str, f32, Color32)]) {
    ui.horizontal(|ui| {
        egui::Frame::new()
            .fill(PANEL2)
            .inner_margin(egui::Margin::same(4))
            .show(ui, |ui| {
                ui.set_min_size(Vec2::new(150.0, 40.0));
                ui.horizontal(|ui| {
                    tag(label, Color32::WHITE, color, ui);
                    tiny_dim("track", ui);
                });
            });
        for (name, w, c) in clips {
            egui::Frame::new()
                .fill(*c)
                .corner_radius(egui::CornerRadius::same(4))
                .inner_margin(egui::Margin::same(4))
                .show(ui, |ui| {
                    ui.set_min_size(Vec2::new(*w, 32.0));
                    ui.label(RichText::new(*name).size(9.0).color(Color32::WHITE));
                });
        }
    });
}

pub fn slider_row(ui: &mut Ui, label: &str, value: &str) {
    ui.horizontal(|ui| {
        tiny_dim(label, ui);
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(mono(value, 10.0, TEXT));
        });
    });
    let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 14.0), egui::Sense::hover());
    let y = r.center().y;
    ui.painter()
        .line_segment([r.left_top() + Vec2::new(0.0, 7.0), r.right_top() + Vec2::new(0.0, 7.0)], Stroke::new(3.0, LINE));
    let fx = r.left() + r.width() * 0.7;
    ui.painter()
        .line_segment([r.left_top() + Vec2::new(0.0, 7.0), egui::Pos2::new(fx, y)], Stroke::new(3.0, INDIGO));
    ui.painter().circle_filled(egui::Pos2::new(fx, y), 6.0, INDIGO);
    let _ = CYAN;
}

pub fn transport_button(ui: &mut Ui, glyph: &str, primary: bool) {
    if primary {
        egui::Frame::new()
            .fill(CYAN)
            .corner_radius(egui::CornerRadius::same(6))
            .inner_margin(egui::Margin::symmetric(10, 5))
            .show(ui, |ui| {
                ui.label(RichText::new(glyph).size(14.0).color(Color32::BLACK).strong());
            });
    } else {
        ui.label(RichText::new(glyph).size(14.0).color(DIM));
    }
}

pub fn waveform(ui: &mut Ui, w: f32, h: f32, color: Color32, seed: u64) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::hover());
    let mid = r.center().y;
    let n = (w / 3.0) as usize;
    for i in 0..n {
        let x = r.left() + i as f32 * 3.0;
        let mut v = (i as u64).wrapping_mul(2654435761).wrapping_add(seed);
        v ^= v >> 13;
        let amp = ((v % 100) as f32 / 100.0) * (h * 0.44) + 1.0;
        ui.painter().line_segment(
            [egui::Pos2::new(x, mid - amp), egui::Pos2::new(x, mid + amp)],
            Stroke::new(1.5, color),
        );
    }
}

pub fn thumb(ui: &mut Ui, w: f32, h: f32, c1: Color32, c2: Color32, label: &str) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::hover());
    ui.painter().rect_filled(r, 4.0, c1);
    let inner = egui::Rect::from_min_size(r.min + Vec2::new(w * 0.15, h * 0.2), Vec2::new(w * 0.7, h * 0.6));
    ui.painter().rect_filled(inner, 8.0, c2);
    ui.painter().text(
        r.center_bottom() + Vec2::new(0.0, -4.0),
        egui::Align2::CENTER_BOTTOM,
        label,
        egui::FontId::proportional(9.0),
        Color32::from_rgba_unmultiplied(255, 255, 255, 200),
    );
}

pub fn hist_bars(ui: &mut Ui, w: f32, h: f32, vals: &[f32], color: Color32) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::hover());
    let n = vals.len() as f32;
    let bw = w / n;
    for (i, v) in vals.iter().enumerate() {
        let bh = v * h;
        let bar = egui::Rect::from_min_size(
            egui::Pos2::new(r.left() + i as f32 * bw + 1.0, r.bottom() - bh),
            Vec2::new(bw - 2.0, bh),
        );
        ui.painter().rect_filled(bar, 1.0, color);
    }
}

// ============ Screen-1 components (tokens only from theme) ============

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
    Title,
}

/// Small status chip: colored dot + text on a panel pill.
pub fn tool_chip(ui: &mut Ui, text: &str, color: Color32) {
    egui::Frame::new()
        .fill(PANEL2)
        .corner_radius(egui::CornerRadius::same(4))
        .inner_margin(egui::Margin::symmetric(6, 3))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("●").size(8.0).color(color));
                ui.label(RichText::new(text).size(10.0).color(TEXT));
            });
        });
}

/// Clickable media-bin card. Selected card gets a 2px indigo stroke
/// (closest Frame approximation of the web selected-glow shadow).
pub fn media_card_full(
    ui: &mut Ui,
    name: &str,
    dur: &str,
    hue: Color32,
    kind: MediaKind,
    selected: bool,
    photo: Option<(&crate::photos::Photos, &str)>,
) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(118.0, 92.0), egui::Sense::click());
    let th = egui::Rect::from_min_size(rect.min + Vec2::new(6.0, 6.0), Vec2::new(106.0, 54.0));
    {
        let p = ui.painter();
        p.rect_filled(rect, egui::CornerRadius::same(6), RAISED);
        if photo.is_none() {
            p.rect_filled(th, egui::CornerRadius::same(4), hue);
        }
    }
    if let Some((photos, key)) = photo {
        crate::photos::photo_fill(ui, photos, key, th, 4.0, Color32::WHITE);
    }
    let p = ui.painter();
    match kind {
        MediaKind::Video => {
            p.text(
                th.center(),
                egui::Align2::CENTER_CENTER,
                "▶",
                egui::FontId::proportional(14.0),
                Color32::from_rgba_unmultiplied(255, 255, 255, 220),
            );
        }
        MediaKind::Audio => {
            for i in 0..24 {
                let x = th.left() + 5.0 + i as f32 * 4.0;
                let h = 5.0 + (i as f32 * 37.0 % 23.0);
                p.line_segment(
                    [
                        egui::Pos2::new(x, th.center().y - h * 0.5),
                        egui::Pos2::new(x, th.center().y + h * 0.5),
                    ],
                    Stroke::new(2.0, Color32::from_rgba_unmultiplied(255, 255, 255, 200)),
                );
            }
        }
        MediaKind::Title => {
            p.text(
                th.center(),
                egui::Align2::CENTER_CENTER,
                "Aa",
                egui::FontId::proportional(18.0),
                Color32::WHITE,
            );
        }
    }
    p.text(
        th.right_bottom() + Vec2::new(-4.0, -2.0),
        egui::Align2::RIGHT_BOTTOM,
        dur,
        egui::FontId::monospace(8.0),
        Color32::WHITE,
    );
    p.text(
        rect.left_bottom() + Vec2::new(6.0, -4.0),
        egui::Align2::LEFT_BOTTOM,
        name,
        egui::FontId::proportional(10.0),
        TEXT,
    );
    if selected {
        p.rect_stroke(
            rect,
            egui::CornerRadius::same(6),
            Stroke::new(2.0, INDIGO),
            egui::StrokeKind::Inside,
        );
    } else if resp.hovered() {
        p.rect_stroke(
            rect,
            egui::CornerRadius::same(6),
            Stroke::new(1.0, DIM),
            egui::StrokeKind::Inside,
        );
    }
    resp
}

/// Stereo VU meter: two level bars, emerald below 85%, amber above
/// (flat-fill approximation of the web emerald->amber gradient).
pub fn vu_meter(ui: &mut Ui, w: f32, left: f32, right: f32) {
    for (lab, v) in [("L", left), ("R", right)] {
        ui.horizontal(|ui| {
            ui.label(mono(lab, 9.0, DIM));
            let (r, _) = ui.allocate_exact_size(Vec2::new(w, 8.0), egui::Sense::hover());
            let p = ui.painter();
            p.rect_filled(r, egui::CornerRadius::same(2), PANEL2);
            let fw = (r.width() * v.clamp(0.0, 1.0)).max(2.0);
            let fill = egui::Rect::from_min_size(r.min, Vec2::new(fw, r.height()));
            p.rect_filled(fill, egui::CornerRadius::same(2), if v > 0.85 { AMBER } else { EMERALD_SYNC });
        });
    }
}

/// Thumbnail strip with a cyan playhead line at `frac` (0..1).
pub fn filmstrip(ui: &mut Ui, w: f32, frac: f32) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, 22.0), egui::Sense::hover());
    let p = ui.painter();
    p.rect_filled(r, egui::CornerRadius::same(3), PANEL2);
    let n = (w / 6.0) as usize;
    for i in 0..n {
        let x = r.left() + i as f32 * 6.0 + 2.0;
        let tall = i % 4 == 0;
        let h = if tall { 12.0 } else { 7.0 };
        p.line_segment(
            [
                egui::Pos2::new(x, r.center().y - h * 0.5),
                egui::Pos2::new(x, r.center().y + h * 0.5),
            ],
            Stroke::new(1.5, if tall { DIM } else { FAINT }),
        );
    }
    let px = r.left() + r.width() * frac.clamp(0.0, 1.0);
    p.line_segment(
        [egui::Pos2::new(px, r.top()), egui::Pos2::new(px, r.bottom())],
        Stroke::new(2.0, CYAN),
    );
}

/// Dashed rectangle (approximation of the CSS dashed title-safe borders).
pub fn dashed_rect(p: &egui::Painter, r: egui::Rect, color: Color32) {
    let st = Stroke::new(1.0, color);
    let (dash, gap) = (7.0, 5.0);
    for y in [r.top(), r.bottom()] {
        let mut x = r.left();
        while x < r.right() {
            let x2 = (x + dash).min(r.right());
            p.line_segment([egui::Pos2::new(x, y), egui::Pos2::new(x2, y)], st);
            x += dash + gap;
        }
    }
    for x in [r.left(), r.right()] {
        let mut y = r.top();
        while y < r.bottom() {
            let y2 = (y + dash).min(r.bottom());
            p.line_segment([egui::Pos2::new(x, y), egui::Pos2::new(x, y2)], st);
            y += dash + gap;
        }
    }
}

/// Track header: badge + name + working eye/lock toggles.
/// Glyphs stand in for the Material Symbols icon font (not bundled).
pub fn track_header(
    ui: &mut Ui,
    badge: &str,
    name: &str,
    color: Color32,
    eye_open: &mut bool,
    locked: &mut bool,
) {
    egui::Frame::new().fill(PANEL2).inner_margin(egui::Margin::same(5)).show(ui, |ui| {
        ui.set_min_size(Vec2::new(150.0, 42.0));
        ui.vertical(|ui| {
            ui.horizontal(|ui| {
                tag(badge, Color32::WHITE, color, ui);
                ui.label(RichText::new(name).size(10.0).color(TEXT));
            });
            ui.horizontal(|ui| {
                if ui.small_button(if *eye_open { "●" } else { "○" }).clicked() {
                    *eye_open = !*eye_open;
                }
                if ui.small_button(if *locked { "■" } else { "□" }).clicked() {
                    *locked = !*locked;
                }
                if *locked {
                    tiny_dim("locked", ui);
                }
            });
        });
    });
}

/// Paint a video/title clip body into a caller-owned rect.
pub fn paint_clip(
    p: &egui::Painter,
    r: egui::Rect,
    title: &str,
    sub: &str,
    fill: Color32,
    selected: bool,
    dimmed: bool,
) {
    let f = if dimmed { fill.gamma_multiply(0.4) } else { fill };
    p.rect_filled(r, egui::CornerRadius::same(4), f);
    p.rect_stroke(
        r,
        egui::CornerRadius::same(4),
        Stroke::new(1.0, LINE),
        egui::StrokeKind::Inside,
    );
    if selected {
        p.rect_stroke(
            r.shrink(1.0),
            egui::CornerRadius::same(4),
            Stroke::new(2.0, INDIGO),
            egui::StrokeKind::Inside,
        );
    }
    p.text(
        r.left_top() + Vec2::new(6.0, 13.0),
        egui::Align2::LEFT_TOP,
        title,
        egui::FontId::proportional(9.0),
        Color32::WHITE,
    );
    p.text(
        r.left_bottom() + Vec2::new(6.0, -3.0),
        egui::Align2::LEFT_BOTTOM,
        sub,
        egui::FontId::monospace(8.0),
        Color32::from_rgba_unmultiplied(255, 255, 255, 190),
    );
}

/// Paint an audio clip body (dark lane + seeded waveform bars) into a rect.
pub fn paint_audio_clip(
    p: &egui::Painter,
    r: egui::Rect,
    title: &str,
    sub: &str,
    bg: Color32,
    wave: Color32,
    seed: u64,
    dimmed: bool,
) {
    let b = if dimmed { bg.gamma_multiply(0.5) } else { bg };
    let wv = if dimmed { wave.gamma_multiply(0.5) } else { wave };
    p.rect_filled(r, egui::CornerRadius::same(4), b);
    let n = (r.width() / 4.0) as usize;
    for i in 0..n {
        let x = r.left() + 6.0 + i as f32 * 4.0;
        if x > r.right() - 6.0 {
            break;
        }
        let mut v = (i as u64).wrapping_mul(2654435761).wrapping_add(seed);
        v ^= v >> 13;
        let amp = ((v % 100) as f32 / 100.0) * 12.0 + 1.5;
        let y = r.center().y + 5.0;
        p.line_segment(
            [egui::Pos2::new(x, y - amp), egui::Pos2::new(x, y + amp)],
            Stroke::new(1.5, wv),
        );
    }
    p.text(
        r.left_top() + Vec2::new(6.0, 11.0),
        egui::Align2::LEFT_TOP,
        title,
        egui::FontId::proportional(9.0),
        Color32::WHITE,
    );
    p.text(
        r.right_top() + Vec2::new(-6.0, 11.0),
        egui::Align2::RIGHT_TOP,
        sub,
        egui::FontId::monospace(8.0),
        Color32::from_rgba_unmultiplied(255, 255, 255, 190),
    );
}

/// Cyan playhead line + top needle across a lane rect.
pub fn playhead_line(p: &egui::Painter, lane: egui::Rect, frac: f32) {
    let x = lane.left() + lane.width() * frac.clamp(0.0, 1.0);
    p.line_segment(
        [egui::Pos2::new(x, lane.top()), egui::Pos2::new(x, lane.bottom())],
        Stroke::new(2.0, CYAN),
    );
    p.line_segment(
        [egui::Pos2::new(x - 5.0, lane.top()), egui::Pos2::new(x + 5.0, lane.top())],
        Stroke::new(2.0, CYAN),
    );
}

/// Toolbar toggle button (text label; stands in for Material Symbols icons).
pub fn toolbar_button(ui: &mut Ui, label: &str, active: bool) -> egui::Response {
    ui.selectable_label(active, RichText::new(label).size(11.0))
}

/// RGB parade: three fixed scope groups (R/G/B channel hues from theme).
pub fn rgb_parade(ui: &mut Ui, w: f32, h: f32) {
    let groups: [(&str, Color32, [f32; 4]); 3] = [
        ("R", RUBY, [0.35, 0.6, 0.45, 0.7]),
        ("G", EMERALD_SYNC, [0.5, 0.75, 0.55, 0.85]),
        ("B", CYAN, [0.4, 0.65, 0.5, 0.6]),
    ];
    ui.horizontal(|ui| {
        for (lab, c, vals) in groups {
            ui.vertical(|ui| {
                ui.label(mono(lab, 9.0, DIM));
                hist_bars(ui, w / 3.0 - 8.0, h, &vals, c);
            });
        }
    });
}

/// Right-aligned (user, indigo) chat bubble.
pub fn bubble_user(ui: &mut Ui, text: &str) {
    ui.with_layout(egui::Layout::top_down(egui::Align::Max), |ui| {
        egui::Frame::new()
            .fill(INDIGO_DEEP)
            .corner_radius(egui::CornerRadius::same(8))
            .inner_margin(egui::Margin::same(8))
            .show(ui, |ui| {
                ui.label(RichText::new(text).size(11.0).color(Color32::WHITE));
            });
    });
}

/// Left-aligned (agent, raised) chat bubble.
pub fn bubble_agent(ui: &mut Ui, text: &str) {
    ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
        frame_raised().show(ui, |ui| {
            ui.label(RichText::new(text).size(11.0).color(TEXT));
        });
    });
}

/// Inspector label + single-line text field.
pub fn inspector_text(ui: &mut Ui, label: &str, value: &mut String) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(label).size(10.0).color(DIM));
        ui.add(egui::TextEdit::singleline(value).desired_width(80.0));
    });
}

/// Generic drop-down bound to an index into `options`.
pub fn combo(ui: &mut Ui, id_salt: &str, sel: &mut usize, options: &[&str]) {
    let cur = options.get(*sel).copied().unwrap_or("");
    egui::ComboBox::from_id_salt(id_salt).selected_text(cur).show_ui(ui, |ui| {
        for (i, o) in options.iter().enumerate() {
            ui.selectable_value(sel, i, *o);
        }
    });
}

/// Bin search field.
pub fn search_field(ui: &mut Ui, q: &mut String) {
    ui.add(egui::TextEdit::singleline(q).hint_text("Search bin clips…").desired_width(140.0));
}

/// Agent composer: multiline input + mic/send. Returns true on send.
pub fn composer(ui: &mut Ui, text: &mut String) -> bool {
    let mut send = false;
    ui.horizontal(|ui| {
        let w = (ui.available_width() - 76.0).max(120.0);
        ui.add(
            egui::TextEdit::multiline(text)
                .hint_text("Ask the agent…")
                .desired_rows(2)
                .desired_width(w),
        );
        ui.vertical(|ui| {
            let _ = ui.small_button("mic");
            if ui.small_button("Send").clicked() && !text.trim().is_empty() {
                send = true;
            }
        });
    });
    send
}

/// Colored status dot + label (GPU/ONLINE/READY/REC rows).
pub fn status_dot(ui: &mut Ui, label: &str, color: Color32) {
    ui.horizontal(|ui| {
        ui.label(RichText::new("●").size(8.0).color(color));
        ui.label(mono(label, 9.0, color));
    });
}

/// Timeline zoom cluster: out / slider / in / Zoom to Fit (= 45).
pub fn zoom_row(ui: &mut Ui, zoom: &mut f32) {
    ui.horizontal(|ui| {
        tiny_dim("Zoom", ui);
        if ui.small_button("-").clicked() {
            *zoom = (*zoom - 5.0).max(5.0);
        }
        ui.add(egui::Slider::new(zoom, 5.0..=100.0));
        if ui.small_button("+").clicked() {
            *zoom = (*zoom + 5.0).min(100.0);
        }
        if ui.small_button("Zoom to Fit").clicked() {
            *zoom = 45.0;
        }
    });
}
