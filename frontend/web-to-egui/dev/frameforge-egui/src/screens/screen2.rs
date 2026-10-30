use crate::theme::*;
use crate::widgets::*;
use egui::{Align2, Color32, CornerRadius, Margin, RichText, Sense, Stroke, Ui, Vec2};

// Screen 2: editor workbench with transport bar, media browser,
// program monitor, timeline, inspector and agent drawer.
// Tokens come only from `theme`; shared widgets from `widgets`.

fn temp_bool(ui: &mut Ui, key: &str, def: bool) -> bool {
    ui.ctx()
        .data(|d| d.get_temp::<bool>(egui::Id::unique(key)).unwrap_or(def))
}

fn set_temp_bool(ui: &mut Ui, key: &str, v: bool) {
    ui.ctx().data_mut(|d| d.insert_temp(egui::Id::unique(key), v));
}

fn temp_f32(ui: &mut Ui, key: &str, def: f32) -> f32 {
    ui.ctx()
        .data(|d| d.get_temp::<f32>(egui::Id::unique(key)).unwrap_or(def))
}

fn temp_string(ui: &mut Ui, key: &str) -> String {
    ui.ctx()
        .data(|d| d.get_temp::<String>(egui::Id::unique(key)).unwrap_or_default())
}

fn icon_btn(ui: &mut Ui, glyph: &str, active: bool, key: &str) -> bool {
    let (r, _) = ui.allocate_exact_size(Vec2::new(28.0, 28.0), Sense::hover());
    let fill = if active {
        Color32::from_rgb(0x2e, 0x31, 0x66)
    } else {
        PANEL2
    };
    ui.painter().rect_filled(r, CornerRadius::same(6), fill);
    if active {
        ui.painter()
            .rect_stroke(r, CornerRadius::same(6), Stroke::new(1.0, CYAN), egui::StrokeKind::Inside);
    }
    ui.painter().text(
        r.center(),
        Align2::CENTER_CENTER,
        glyph,
        egui::FontId::proportional(13.0),
        if active { CYAN } else { DIM },
    );
    let resp = ui.interact(r, egui::Id::unique(key), Sense::click());
    if resp.clicked() {
        set_temp_bool(ui, key, !active);
        return true;
    }
    false
}

fn avatar(ui: &mut Ui, initials: &str) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(28.0, 28.0), Sense::hover());
    ui.painter().circle_filled(r.center(), 14.0, INDIGO);
    ui.painter().text(
        r.center(),
        Align2::CENTER_CENTER,
        initials,
        egui::FontId::proportional(11.0),
        Color32::WHITE,
    );
}

fn transport_bar(ui: &mut Ui) {
    frame_panel().show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label(RichText::new("FrameForge").size(15.0).strong().color(TEXT));
            hspace(ui, 8.0);
            tag("Sunset_Vlog_01", TEXT, PANEL2, ui);
            hspace(ui, 6.0);
            tag("4K UHD", CYAN, PANEL2, ui);
            tag("60FPS", CYAN, PANEL2, ui);
            tag("ProRes", DIM, PANEL2, ui);
            hspace(ui, 16.0);
            for (g, primary) in [("|<", false), ("<<", false), (">", true), (">>", false), (">|", false)] {
                transport_button(ui, g, primary);
            }
            hspace(ui, 8.0);
            ui.label(mono("00:04:12:08", 12.0, CYAN));
            ui.label(mono("/ 00:06:45:00", 11.0, DIM));
            tag("1.0x", DIM, PANEL2, ui);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                avatar(ui, "JD");
                hspace(ui, 8.0);
                egui::Frame::new()
                    .fill(INDIGO)
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(Margin::symmetric(12, 6))
                    .show(ui, |ui| {
                        ui.label(RichText::new("Export").size(12.0).strong().color(Color32::WHITE));
                    });
                hspace(ui, 8.0);
                let agent_on = temp_bool(ui, "s2_agent", true);
                let (r, _) = ui.allocate_exact_size(Vec2::new(96.0, 28.0), Sense::hover());
                ui.painter().rect_filled(
                    r,
                    CornerRadius::same(6),
                    Color32::from_rgb(0x2e, 0x31, 0x66),
                );
                ui.painter().circle_filled(
                    r.left_center() + Vec2::new(12.0, 0.0),
                    4.0,
                    if agent_on { CYAN } else { FAINT },
                );
                ui.painter().text(
                    r.center() + Vec2::new(6.0, 0.0),
                    Align2::CENTER_CENTER,
                    "Ask Agent",
                    egui::FontId::proportional(11.0),
                    TEXT,
                );
                let resp = ui.interact(r, egui::Id::unique("s2_agent_btn"), Sense::click());
                if resp.clicked() {
                    set_temp_bool(ui, "s2_agent", !agent_on);
                }
                hspace(ui, 8.0);
                let snap = temp_bool(ui, "s2_snap", true);
                let _ = icon_btn(ui, "S", snap, "s2_snap");
                let mark = temp_bool(ui, "s2_mark", false);
                let _ = icon_btn(ui, "M", mark, "s2_mark");
                let undo = temp_bool(ui, "s2_undo", false);
                let _ = icon_btn(ui, "<", undo, "s2_undo");
                let redo = temp_bool(ui, "s2_redo", false);
                let _ = icon_btn(ui, ">", redo, "s2_redo");
                hspace(ui, 4.0);
                tag("v2.4", DIM, PANEL2, ui);
            });
        });
    });
}

fn asset_card_video(
    ui: &mut Ui,
    photos: &crate::photos::Photos,
    photo_key: &str,
    title: &str,
    badge: &str,
    dur: &str,
    fps: &str,
    _hue: Color32,
    selected: bool,
    warn: bool,
) {
    let mut f = frame_raised();
    if selected {
        f = f.stroke(Stroke::new(2.0, INDIGO));
    } else if warn {
        f = f.stroke(Stroke::new(1.0, AMBER));
    }
    f.show(ui, |ui| {
        ui.set_min_size(Vec2::new(240.0, 64.0));
        ui.horizontal(|ui| {
            crate::photos::photo_thumb(ui, photos, photo_key, 96.0, 54.0, 4.0);
            ui.vertical(|ui| {
                ui.label(RichText::new(title).size(11.0).strong().color(TEXT));
                ui.horizontal(|ui| {
                    tag(badge, CYAN, PANEL2, ui);
                    ui.label(mono(dur, 10.0, DIM));
                });
                ui.horizontal(|ui| {
                    tiny_dim(fps, ui);
                    if warn {
                        tag("SHAKY INTRO", AMBER, PANEL2, ui);
                    } else if selected {
                        tag("OK", GREEN, PANEL2, ui);
                    }
                });
            });
        });
    });
}

fn asset_row_audio(ui: &mut Ui, title: &str, meta: &str) {
    frame_raised().show(ui, |ui| {
        ui.set_min_size(Vec2::new(240.0, 40.0));
        ui.horizontal(|ui| {
            ui.label(RichText::new("EQ").size(12.0).strong().color(AMBER));
            ui.vertical(|ui| {
                ui.label(RichText::new(title).size(11.0).color(TEXT));
                tiny_dim(meta, ui);
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                waveform(ui, 64.0, 24.0, AMBER, 21);
            });
        });
    });
}

fn media_panel(ui: &mut Ui, photos: &crate::photos::Photos) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            for (t, a) in [("Media", true), ("Effects", false), ("Transitions", false), ("Audio", false)] {
                top_button(t, a, ui);
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let grid = temp_bool(ui, "s2_grid", true);
                let _ = icon_btn(ui, "#", grid, "s2_grid");
            });
        });
        ui.add_space(4.0);
        let mut q = temp_string(ui, "s2_search");
        let resp = ui.add(
            egui::TextEdit::singleline(&mut q)
                .hint_text("Search bin clips...")
                .desired_width(f32::INFINITY),
        );
        if resp.changed() {
            ui.ctx().data_mut(|d| d.insert_temp(egui::Id::unique("s2_search"), q));
        }
        ui.add_space(6.0);
        egui::ScrollArea::vertical()
            .max_height(380.0)
            .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
            .show(ui, |ui| {
            ui.vertical(|ui| {
                asset_card_video(
                    ui,
                    photos,
                    "s2-1",
                    "drone_beach_sunset.mp4",
                    "4K RAW",
                    "00:42:15",
                    "60fps",
                    Color32::from_rgb(0x3a, 0x5a, 0x8a),
                    true,
                    false,
                );
                asset_card_video(
                    ui,
                    photos,
                    "s2-2",
                    "cliff_jump.mov",
                    "4K UHD",
                    "01:14:02",
                    "120fps",
                    Color32::from_rgb(0x2a, 0x7a, 0x9a),
                    false,
                    false,
                );
                asset_card_video(
                    ui,
                    photos,
                    "s2-3",
                    "vlog_a_roll_take2.mp4",
                    "HD",
                    "02:08:19",
                    "24fps",
                    Color32::from_rgb(0x6a, 0x4a, 0x2a),
                    false,
                    true,
                );
                asset_row_audio(ui, "summer_vibes_bgm.wav", "48kHz stereo loop");
            });
        });
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            egui::Frame::new()
                .fill(PANEL2)
                .corner_radius(CornerRadius::same(6))
                .inner_margin(Margin::symmetric(12, 6))
                .show(ui, |ui| {
                    ui.label(RichText::new("Import Media").size(11.0).color(TEXT));
                });
            egui::Frame::new()
                .fill(Color32::from_rgb(0x3a, 0x1a, 0x1a))
                .corner_radius(CornerRadius::same(6))
                .inner_margin(Margin::symmetric(12, 6))
                .show(ui, |ui| {
                    ui.label(RichText::new("● Record").size(11.0).color(RED));
                });
        });
    });
}

fn monitor_header(ui: &mut Ui) {
    ui.horizontal(|ui| {
        section_title("PROGRAM MONITOR", ui);
        hspace(ui, 8.0);
        tag("REC.709 3840x2160", DIM, PANEL2, ui);
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let fs = temp_bool(ui, "s2_fs", false);
            let _ = icon_btn(ui, "[ ]", fs, "s2_fs");
            let split = temp_bool(ui, "s2_split", false);
            let _ = icon_btn(ui, "| |", split, "s2_split");
            let guides = temp_bool(ui, "s2_guides", true);
            let _ = icon_btn(ui, "+", guides, "s2_guides");
            tag("Fit 58%", DIM, PANEL2, ui);
            hspace(ui, 4.0);
            tag("Guides On", CYAN, PANEL2, ui);
        });
    });
}

fn monitor_canvas(ui: &mut Ui, photos: &crate::photos::Photos) {
    let w = ui.available_width();
    let h = w * 9.0 / 16.0;
    let (r, resp) = ui.allocate_exact_size(Vec2::new(w, h), Sense::hover());
    // s2-4 is the HTML program-monitor still; guides + HUD stay drawn.
    crate::photos::photo_fill(ui, photos, "s2-4", r, 6.0, Color32::WHITE);
    let guides = temp_bool(ui, "s2_guides", true);
    if guides {
        for frac in [0.05, 0.10] {
            let g = egui::Rect::from_min_size(
                r.min + Vec2::new(w * frac, h * frac),
                Vec2::new(w * (1.0 - 2.0 * frac), h * (1.0 - 2.0 * frac)),
            );
            ui.painter().rect_stroke(
                g,
                CornerRadius::same(2),
                Stroke::new(1.0, CYAN),
                egui::StrokeKind::Inside,
            );
        }
        ui.painter().line_segment(
            [egui::Pos2::new(r.center().x, r.top() + 8.0), egui::Pos2::new(r.center().x, r.bottom() - 8.0)],
            Stroke::new(1.0, CYAN),
        );
        ui.painter().line_segment(
            [egui::Pos2::new(r.left() + 8.0, r.center().y), egui::Pos2::new(r.right() - 8.0, r.center().y)],
            Stroke::new(1.0, CYAN),
        );
    }
    if resp.hovered() {
        let hud = egui::Rect::from_min_size(
            egui::Pos2::new(r.left() + 8.0, r.bottom() - 30.0),
            Vec2::new(r.width() - 16.0, 22.0),
        );
        ui.painter().rect_filled(hud, CornerRadius::same(4), Color32::from_black_alpha(140));
        ui.painter().text(
            hud.left_center() + Vec2::new(8.0, 0.0),
            Align2::LEFT_CENTER,
            "||  00:04:12:08",
            egui::FontId::monospace(11.0),
            CYAN,
        );
        ui.painter().text(
            hud.right_center() + Vec2::new(-8.0, 0.0),
            Align2::RIGHT_CENTER,
            "16:9  [o]",
            egui::FontId::proportional(11.0),
            TEXT,
        );
    }
}

fn filmstrip(ui: &mut Ui) {
    let w = ui.available_width();
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, 28.0), Sense::hover());
    ui.painter().rect_filled(r, CornerRadius::same(4), PANEL2);
    let n = 24;
    let bw = r.width() / n as f32;
    for i in 0..n {
        let c = if i % 3 == 0 {
            Color32::from_rgb(0x2e, 0x8a, 0xa8)
        } else {
            INDIGO_DEEP
        };
        let b = egui::Rect::from_min_size(
            egui::Pos2::new(r.left() + i as f32 * bw + 1.0, r.top() + 3.0),
            Vec2::new(bw - 2.0, r.height() - 6.0),
        );
        ui.painter().rect_filled(b, CornerRadius::same(2), c);
    }
    let hx = r.left() + r.width() * 0.62;
    ui.painter().line_segment(
        [egui::Pos2::new(hx, r.top()), egui::Pos2::new(hx, r.bottom())],
        Stroke::new(2.0, CYAN),
    );
    ui.painter().circle_filled(egui::Pos2::new(hx, r.top() + 4.0), 4.0, CYAN);
}

fn timeline_toolbar(ui: &mut Ui) {
    ui.horizontal(|ui| {
        let sel = temp_bool(ui, "s2_tool_sel", true);
        let _ = icon_btn(ui, "Sel", sel, "s2_tool_sel");
        let cut = temp_bool(ui, "s2_tool_cut", false);
        let _ = icon_btn(ui, "Cut", cut, "s2_tool_cut");
        let link = temp_bool(ui, "s2_tool_link", false);
        let _ = icon_btn(ui, "Lnk", link, "s2_tool_link");
        let swap = temp_bool(ui, "s2_tool_swap", false);
        let _ = icon_btn(ui, "Swp", swap, "s2_tool_swap");
        hspace(ui, 8.0);
        tag("+ Sequence 01", TEXT, PANEL2, ui);
        hspace(ui, 8.0);
        let mut zoom = temp_f32(ui, "s2_zoom", 60.0);
        ui.label(RichText::new("-").size(12.0).color(DIM));
        let resp = ui.add(egui::Slider::new(&mut zoom, 10.0..=100.0).show_value(false));
        if resp.changed() {
            ui.ctx().data_mut(|d| d.insert_temp(egui::Id::unique("s2_zoom"), zoom));
        }
        ui.label(mono(&format!("{zoom:.0}%"), 10.0, TEXT));
        ui.label(RichText::new("+").size(12.0).color(DIM));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let fit = temp_bool(ui, "s2_fit", false);
            let _ = icon_btn(ui, "Fit", fit, "s2_fit");
        });
    });
}

fn track_head(ui: &mut Ui, name: &str, color: Color32, sub: &str, db: &str) {
    egui::Frame::new()
        .fill(PANEL2)
        .inner_margin(Margin::same(4))
        .show(ui, |ui| {
            ui.set_min_size(Vec2::new(168.0, 48.0));
            ui.horizontal(|ui| {
                tag(name, Color32::WHITE, color, ui);
                ui.vertical(|ui| {
                    tiny_dim(sub, ui);
                    ui.label(mono(db, 9.0, DIM));
                });
            });
            ui.horizontal(|ui| {
                tiny_dim("lock eye", ui);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    tag("M", DIM, RAISED, ui);
                    tag("S", DIM, RAISED, ui);
                });
            });
        });
}

fn clip_block(ui: &mut Ui, w: f32, name: &str, meta: &str, fill: Color32, selected: bool) {
    let mut f = egui::Frame::new()
        .fill(fill)
        .corner_radius(CornerRadius::same(4))
        .inner_margin(Margin::same(4));
    if selected {
        f = f.stroke(Stroke::new(2.0, INDIGO));
    }
    f.show(ui, |ui| {
        ui.set_min_size(Vec2::new(w, 40.0));
        ui.label(RichText::new(name).size(10.0).strong().color(Color32::WHITE));
        ui.label(mono(meta, 9.0, Color32::from_rgb(0xd8, 0xd8, 0xe2)));
    });
}

fn lane_row(ui: &mut Ui, lane_w: f32, inner: impl FnOnce(&mut Ui)) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(lane_w, 56.0), Sense::hover());
    ui.painter().rect_filled(r, CornerRadius::same(4), PANEL2);
    let mut child = ui.new_child(egui::UiBuilder::new().max_rect(r.shrink(4.0)).layout(egui::Layout::left_to_right(egui::Align::Center)));
    inner(&mut child);
    let hx = r.left() + r.width() * 0.625;
    ui.painter().line_segment(
        [egui::Pos2::new(hx, r.top()), egui::Pos2::new(hx, r.bottom())],
        Stroke::new(2.0, CYAN),
    );
}

fn timeline_body(ui: &mut Ui) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.set_min_size(Vec2::new(176.0, 24.0));
            tiny_dim("TRACKS", ui);
            track_head(ui, "V2", INDIGO, "Titles", "");
            track_head(ui, "V1", CYAN, "Video", "");
            track_head(ui, "A1", GREEN, "Voice", "-2.4dB");
            track_head(ui, "A2", AMBER, "Music", "-6.0dB");
        });
        ui.vertical(|ui| {
            ui.horizontal(|ui| {
                for t in ["00:00", "00:01", "00:02", "00:03", "00:04", "00:05", "00:06"] {
                    let c = if t == "00:04" { TEXT } else { FAINT };
                    ui.label(mono(t, 9.0, c));
                    hspace(ui, 18.0);
                }
                tag("00:04:12:08", CYAN, PANEL2, ui);
            });
            let lane_w = ui.available_width().max(420.0);
            lane_row(ui, lane_w, |ui| {
                clip_block(ui, 200.0, "Cinematic Title Intro (Dissolve)", "03:12", VIOLET, false);
            });
            lane_row(ui, lane_w, |ui| {
                clip_block(ui, 120.0, "cliff_jump.mov", "4K", Color32::from_rgb(0x2a, 0x2a, 0x5a), false);
                clip_block(
                    ui,
                    200.0,
                    "drone_beach_sunset.mp4",
                    "RAW 02:36:00",
                    Color32::from_rgb(0x2a, 0x3a, 0x6a),
                    true,
                );
                clip_block(ui, 110.0, "vlog_a_roll_take2.mp4", "HD", Color32::from_rgb(0x2a, 0x2a, 0x34), false);
            });
            lane_row(ui, lane_w, |ui| {
                clip_block(
                    ui,
                    260.0,
                    "Dialogue_Take1.wav Sync Locked",
                    "VOICE",
                    Color32::from_rgb(0x0a, 0x2a, 0x1a),
                    false,
                );
                waveform(ui, 120.0, 32.0, GREEN, 7);
            });
            lane_row(ui, lane_w, |ui| {
                clip_block(
                    ui,
                    300.0,
                    "summer_vibes_bgm.wav (Full Loop)",
                    "-6.0dB",
                    Color32::from_rgb(0x2a, 0x22, 0x0a),
                    false,
                );
                waveform(ui, 100.0, 32.0, AMBER, 13);
            });
        });
    });
}

fn inspector(ui: &mut Ui) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            for (t, a) in [("Properties", true), ("Effects", false), ("Color", false)] {
                top_button(t, a, ui);
            }
        });
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("drone_beach_sunset").size(13.0).strong().color(TEXT));
            tag("clip", CYAN, PANEL2, ui);
        });
        section_title("TRANSFORM", ui);
        egui::Grid::new("s2_transform").spacing(Vec2::new(8.0, 4.0)).show(ui, |ui| {
            tiny_dim("POSITION X", ui);
            tag("1920", TEXT, PANEL2, ui);
            tiny_dim("POSITION Y", ui);
            tag("1080", TEXT, PANEL2, ui);
            ui.end_row();
            tiny_dim("SCALE", ui);
            tag("100.0%", TEXT, PANEL2, ui);
            tiny_dim("LINK", ui);
            tag("on", CYAN, PANEL2, ui);
            ui.end_row();
        });
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            tiny_dim("OPACITY  100%", ui);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                tag("Normal", TEXT, PANEL2, ui);
            });
        });
        let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 14.0), Sense::hover());
        ui.painter().line_segment(
            [r.left_center(), r.right_center()],
            Stroke::new(4.0, LINE),
        );
        ui.painter().line_segment(
            [r.left_center(), r.right_center()],
            Stroke::new(4.0, CYAN),
        );
        ui.painter().circle_filled(r.right_center(), 6.0, CYAN);
    });
}

fn agent_drawer(ui: &mut Ui) {
    let open = temp_bool(ui, "s2_drawer", true);
    ui.horizontal(|ui| {
        ui.painter().circle_filled(
            ui.cursor().min + Vec2::new(5.0, 9.0),
            4.0,
            GREEN,
        );
        hspace(ui, 12.0);
        ui.label(RichText::new("AI Editing Agent").size(13.0).strong().color(TEXT));
        hspace(ui, 6.0);
        tag("READY", GREEN, PANEL2, ui);
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let _ = icon_btn(ui, ">", !open, "s2_drawer");
        });
    });
    if !open {
        tiny_dim("Drawer collapsed.", ui);
        return;
    }
    ui.add_space(4.0);
    egui::Frame::new()
        .fill(INDIGO_DEEP)
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::same(8))
        .show(ui, |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::TOP), |ui| {
                ui.label(RichText::new("Trim the shaky intro and add captions").size(11.0).color(Color32::WHITE));
            });
            ui.label(mono("14:28", 9.0, Color32::from_rgb(0xc0, 0xc1, 0xff)));
        });
    frame_raised().show(ui, |ui| {
        ui.label(RichText::new("Analyzing timeline footage...").size(10.0).color(TEXT));
        ui.add_space(4.0);
        tag("stabilize_shot 0.4s", GREEN, PANEL2, ui);
        tag("detect_cuts 0.2s", GREEN, PANEL2, ui);
        tag("caption_audio 1.1s", GREEN, PANEL2, ui);
    });
    frame_raised().show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label(
                RichText::new("Magic Stabilization & Auto-Captions")
                    .size(11.0)
                    .strong()
                    .color(TEXT),
            );
            tag("PROPOSED", INDIGO, PANEL2, ui);
        });
        ui.horizontal(|ui| {
            let applied = temp_bool(ui, "s2_applied", false);
            let resp = ui.add(egui::Button::new(
                RichText::new(if applied { "Applied" } else { "Apply to Timeline" })
                    .size(11.0)
                    .color(Color32::WHITE),
            ));
            if resp.clicked() {
                set_temp_bool(ui, "s2_applied", !applied);
            }
            let _ = ui.add(egui::Button::new(
                RichText::new("Preview Changes").size(11.0).color(TEXT),
            ));
        });
    });
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        for p in ["Palette", "Cut", "Clips", "Mute"] {
            tag(p, DIM, PANEL2, ui);
        }
    });
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        let _ = icon_btn(ui, "mic", false, "s2_mic");
        let mut msg = temp_string(ui, "s2_composer");
        let resp = ui.add(
            egui::TextEdit::singleline(&mut msg)
                .hint_text("Ask the agent...")
                .desired_width(ui.available_width() - 40.0),
        );
        if resp.changed() {
            ui.ctx().data_mut(|d| d.insert_temp(egui::Id::unique("s2_composer"), msg));
        }
        let _ = icon_btn(ui, "^", false, "s2_send");
    });
}

pub fn show(ui: &mut Ui, photos: &crate::photos::Photos) {
    transport_bar(ui);
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        frame_panel().show(ui, |ui| {
            ui.set_min_size(Vec2::new(280.0, 700.0));
            ui.set_max_size(Vec2::new(280.0, 700.0));
            media_panel(ui, photos);
        });
        ui.vertical(|ui| {
            frame_panel().show(ui, |ui| {
                monitor_header(ui);
                ui.add_space(4.0);
                monitor_canvas(ui, photos);
                ui.add_space(4.0);
                filmstrip(ui);
            });
            ui.add_space(6.0);
            frame_panel().show(ui, |ui| {
                timeline_toolbar(ui);
                ui.add_space(4.0);
                egui::ScrollArea::horizontal()
                    .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                    .show(ui, |ui| {
                        timeline_body(ui);
                    });
            });
        });
        frame_panel().show(ui, |ui| {
            ui.set_min_size(Vec2::new(360.0, 700.0));
            ui.set_max_size(Vec2::new(360.0, 700.0));
            egui::ScrollArea::vertical()
                .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                .show(ui, |ui| {
                    inspector(ui);
                ui.add_space(8.0);
                agent_drawer(ui);
            });
        });
    });
}
