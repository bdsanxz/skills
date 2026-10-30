use crate::theme::*;
use crate::widgets::*;
use egui::{Color32, RichText, Ui, Vec2};

pub fn topbar(ui: &mut Ui, project: &str) {
    ui.horizontal(|ui| {
        ui.label(RichText::new("FrameForge").size(15.0).strong().color(TEXT));
        hspace(ui, 12.0);
        for (t, a) in [("Edit", true), ("Color", false), ("Audio", false), ("Effects", false), ("Deliver", false)] {
            top_button(t, a, ui);
            hspace(ui, 6.0);
        }
        hspace(ui, 12.0);
        tag(project, TEXT, PANEL2, ui);
        hspace(ui, 6.0);
        ui.label(mono("4K DCI 23.98 fps", 10.0, DIM));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            egui::Frame::new()
                .fill(INDIGO)
                .corner_radius(egui::CornerRadius::same(6))
                .inner_margin(egui::Margin::symmetric(10, 5))
                .show(ui, |ui| {
                    ui.label(RichText::new("Export").size(12.0).strong().color(Color32::WHITE));
                });
            hspace(ui, 8.0);
            egui::Frame::new()
                .fill(PANEL2)
                .corner_radius(egui::CornerRadius::same(6))
                .inner_margin(egui::Margin::symmetric(10, 5))
                .show(ui, |ui| {
                    ui.label(RichText::new("Ask Agent").size(12.0).color(TEXT));
                });
            hspace(ui, 8.0);
            for g in ["|◀", "◀◀", "▶", "▶▶", "▶|"] {
                transport_button(ui, g, g == "▶");
            }
            hspace(ui, 8.0);
            ui.label(mono("00:04:12:08 / 00:06:45:00", 12.0, CYAN));
            hspace(ui, 6.0);
            tag("1.0x", DIM, PANEL2, ui);
        });
    });
}

pub fn media_browser(ui: &mut Ui) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            for (t, a) in [("Media", true), ("Effects", false), ("Transitions", false), ("Audio", false)] {
                top_button(t, a, ui);
            }
        });
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            tag("Search bin clips...", FAINT, PANEL2, ui);
            tag("Date", DIM, PANEL2, ui);
        });
        ui.add_space(6.0);
        egui::Grid::new("bin_grid").spacing(Vec2::new(8.0, 8.0)).show(ui, |ui| {
            media_card(ui, "drone_coastal…", "00:42", Color32::from_rgb(0x3a, 0x5a, 0x8a), true);
            media_card(ui, "beach_slowm…", "01:15", Color32::from_rgb(0x2a, 0x7a, 0x9a), false);
            ui.end_row();
            media_card(ui, "cliff_dive_fpv…", "00:28", Color32::from_rgb(0x6a, 0x4a, 0x2a), false);
            media_card(ui, "acoustic_amb…", "03:10", Color32::from_rgb(0x1a, 0x3a, 0x3a), false);
            ui.end_row();
        });
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            egui::Frame::new()
                .fill(PANEL2)
                .corner_radius(egui::CornerRadius::same(6))
                .inner_margin(egui::Margin::symmetric(12, 6))
                .show(ui, |ui| {
                    ui.label(RichText::new("Import Media").size(11.0).color(TEXT));
                });
            egui::Frame::new()
                .fill(Color32::from_rgb(0x3a, 0x1a, 0x1a))
                .corner_radius(egui::CornerRadius::same(6))
                .inner_margin(egui::Margin::symmetric(12, 6))
                .show(ui, |ui| {
                    ui.label(RichText::new("Record").size(11.0).color(RED));
                });
        });
    });
}

pub fn preview(ui: &mut Ui, title: &str) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            tag("100% Full Res", CYAN, PANEL2, ui);
            tag("Rec.709 D65", DIM, PANEL2, ui);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                tag("16:9", DIM, PANEL2, ui);
            });
        });
        thumb(ui, ui.available_width(), 300.0, Color32::from_rgb(0x2a, 0x3a, 0x5a), Color32::from_rgb(0xd4, 0x6a, 0x2a), title);
        ui.horizontal(|ui| {
            ui.label(mono("00:04:12:08", 11.0, CYAN));
            tiny_dim("filmstrip", ui);
        });
    });
}

pub fn timeline(ui: &mut Ui) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            tiny_dim("TIMELINE TICKS", ui);
            hspace(ui, 20.0);
            ui.label(mono("00:00:00   00:00:01   00:00:02", 10.0, FAINT));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                tag("+ Add Track", DIM, PANEL2, ui);
            });
        });
        track_lane(ui, "V2", VIOLET, &[("B-Roll", 120.0, Color32::from_rgb(0x4a, 0x2a, 0x7a))]);
        track_lane(
            ui,
            "V1",
            INDIGO,
            &[("sunset_intro_master.mp4", 220.0, Color32::from_rgb(0x2a, 0x2a, 0x5a))],
        );
        track_lane(
            ui,
            "TT",
            ORANGE,
            &[("Summer Adventures 2025 (Title)", 200.0, Color32::from_rgb(0x6a, 0x3a, 0x0a))],
        );
        ui.horizontal(|ui| {
            egui::Frame::new().fill(PANEL2).inner_margin(egui::Margin::same(4)).show(ui, |ui| {
                ui.set_min_size(Vec2::new(150.0, 40.0));
                ui.horizontal(|ui| {
                    tag("A1", Color32::WHITE, GREEN, ui);
                    tiny_dim("Dialogue", ui);
                });
            });
            let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 40.0), egui::Sense::hover());
            ui.painter().rect_filled(r, 4.0, Color32::from_rgb(0x0a, 0x2a, 0x1a));
            waveform(ui, 0.0, 0.0, GREEN, 7);
            let _ = r;
        });
        ui.horizontal(|ui| {
            egui::Frame::new().fill(PANEL2).inner_margin(egui::Margin::same(4)).show(ui, |ui| {
                ui.set_min_size(Vec2::new(150.0, 40.0));
                ui.horizontal(|ui| {
                    tag("A2", Color32::WHITE, CYAN, ui);
                    tiny_dim("Music/FX", ui);
                });
            });
            let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 40.0), egui::Sense::hover());
            ui.painter().rect_filled(r, 4.0, Color32::from_rgb(0x0a, 0x2a, 0x2e));
        });
    });
}

// ============ Screen-1 sections (composed from widgets) ============

#[derive(Clone)]
pub struct TopBar1State {
    pub nav: usize,
    pub playing: bool,
    pub frame_off: i32,
    pub speed: usize,
    pub export_fmt: usize,
    pub exported: bool,
}

impl Default for TopBar1State {
    fn default() -> Self {
        Self { nav: 0, playing: false, frame_off: 0, speed: 2, export_fmt: 0, exported: false }
    }
}

pub const NAV_TABS: [&str; 5] = ["Edit", "Color", "Audio", "Effects", "Deliver"];
pub const SPEEDS: [&str; 5] = ["0.5x", "0.75x", "1.0x", "1.5x", "2.0x"];
pub const EXPORT_FMTS: [&str; 3] = ["MP4 · H.264", "ProRes 422", "GIF preview"];

fn timecode(off: i32) -> String {
    format!("00:04:12:{:02}", (8 + off).rem_euclid(24))
}

/// Screen-1 app bar: brand + dirty dot, nav, project/codec, transport pill,
/// Ask-Agent toggle (drives the agent drawer), split-Export, avatar.
pub fn topbar1(ui: &mut Ui, s: &mut TopBar1State, project: &str, agent_open: &mut bool, dirty: bool) {
    ui.horizontal(|ui| {
        ui.label(RichText::new("FrameForge").size(15.0).strong().color(TEXT));
        if dirty {
            ui.label(RichText::new("●").size(9.0).color(AMBER));
        }
        hspace(ui, 10.0);
        for (i, t) in NAV_TABS.iter().enumerate() {
            let on = i == s.nav;
            let resp = ui.selectable_label(
                on,
                RichText::new(*t).size(13.0).color(if on { TEXT } else { DIM }),
            );
            if resp.clicked() {
                s.nav = i;
            }
            if on {
                ui.painter().line_segment(
                    [
                        resp.rect.left_bottom() + Vec2::new(0.0, 1.0),
                        resp.rect.right_bottom() + Vec2::new(0.0, 1.0),
                    ],
                    egui::Stroke::new(2.0, CYAN),
                );
            }
            hspace(ui, 4.0);
        }
        hspace(ui, 10.0);
        tag(project, TEXT, PANEL2, ui);
        hspace(ui, 6.0);
        ui.label(mono("4K DCI 23.98 fps", 10.0, DIM));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            tag("BO", PLATINUM, GUNMETAL, ui);
            hspace(ui, 6.0);
            combo(ui, "export_fmt", &mut s.export_fmt, &EXPORT_FMTS);
            if ui.small_button("Export").clicked() {
                s.exported = true;
            }
            if s.exported {
                tag("Queued", EMERALD_SYNC, PANEL2, ui);
            }
            hspace(ui, 6.0);
            if toolbar_button(ui, "Ask Agent", *agent_open).clicked() {
                *agent_open = !*agent_open;
            }
            hspace(ui, 6.0);
            combo(ui, "speed", &mut s.speed, &SPEEDS);
            ui.label(mono(&timecode(s.frame_off), 12.0, CYAN));
            if ui.small_button("▶|").clicked() {
                s.frame_off += 24;
            }
            if ui.small_button("▶▶").clicked() {
                s.frame_off += 1;
            }
            let play_g = if s.playing { "II" } else { "▶" };
            let (pr, presp) = ui.allocate_exact_size(Vec2::new(34.0, 24.0), egui::Sense::click());
            ui.painter().rect_filled(pr, egui::CornerRadius::same(6), CYAN);
            ui.painter().text(
                pr.center(),
                egui::Align2::CENTER_CENTER,
                play_g,
                egui::FontId::proportional(12.0),
                Color32::BLACK,
            );
            if presp.clicked() {
                s.playing = !s.playing;
            }
            if ui.small_button("◀◀").clicked() {
                s.frame_off -= 1;
            }
            if ui.small_button("|◀").clicked() {
                s.frame_off -= 24;
            }
        });
    });
}

#[derive(Clone)]
pub struct BrowserState {
    pub tab: usize,
    pub query: String,
    pub sort: usize,
    pub selected: String,
    pub extra: usize,
    pub rec: bool,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self { tab: 0, query: String::new(), sort: 0, selected: "drone_coastal".into(), extra: 0, rec: false }
    }
}

pub const BROWSER_TABS: [&str; 4] = ["Media", "Effects", "Transitions", "Audio"];
pub const SORTS: [&str; 3] = ["Date", "Name", "Duration"];

/// Left media browser: tabs, search + sort, 2-col bin grid, import/record.
pub fn browser_panel(ui: &mut Ui, s: &mut BrowserState, photos: &crate::photos::Photos) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            for (i, t) in BROWSER_TABS.iter().enumerate() {
                let on = i == s.tab;
                let resp = ui.selectable_label(
                    on,
                    RichText::new(*t).size(12.0).color(if on { TEXT } else { DIM }),
                );
                if resp.clicked() {
                    s.tab = i;
                }
                if on {
                    ui.painter().line_segment(
                        [
                            resp.rect.left_bottom() + Vec2::new(0.0, 1.0),
                            resp.rect.right_bottom() + Vec2::new(0.0, 1.0),
                        ],
                        egui::Stroke::new(2.0, CYAN),
                    );
                }
            }
        });
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            search_field(ui, &mut s.query);
            combo(ui, "sort", &mut s.sort, &SORTS);
        });
        ui.add_space(6.0);
        // s1-1..s1-3 are the HTML bin-card stills, in document order.
        let mut cards: Vec<(String, &str, Color32, MediaKind, Option<&str>)> = vec![
            ("drone_coastal".into(), "00:42", INDIGO_DEEP, MediaKind::Video, Some("s1-1")),
            ("beach_slowmo".into(), "01:15", GUNMETAL, MediaKind::Video, Some("s1-2")),
            ("cliff_dive_fpv".into(), "00:28", VIOLET, MediaKind::Video, Some("s1-3")),
            ("acoustic_amb".into(), "03:10", WAVE_BG_CYAN, MediaKind::Audio, None),
            ("SUMMER'25".into(), "TITLE", CLIP_AMBER_BG, MediaKind::Title, None),
        ];
        for i in 0..s.extra {
            cards.push((format!("import_{:02}", i + 1), "00:00", RAIL, MediaKind::Video, None));
        }
        let q = s.query.to_lowercase();
        egui::Grid::new("bin_grid1").spacing(Vec2::new(8.0, 8.0)).show(ui, |ui| {
            let mut col = 0;
            for (name, dur, hue, kind, img) in &cards {
                if !q.is_empty() && !name.to_lowercase().contains(&q) {
                    continue;
                }
                if col == 2 {
                    ui.end_row();
                    col = 0;
                }
                let photo = img.map(|key| (photos, key));
                let resp = media_card_full(ui, name, dur, *hue, *kind, *name == s.selected, photo);
                if resp.clicked() {
                    s.selected = name.clone();
                }
                col += 1;
            }
            ui.end_row();
        });
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            if ui.small_button("Import Media").clicked() {
                s.extra += 1;
            }
            if ui.small_button(if s.rec { "■ Stop" } else { "● Record" }).clicked() {
                s.rec = !s.rec;
            }
        });
        if s.rec {
            status_dot(ui, "REC capturing input", RUBY);
        }
    });
}

#[derive(Clone, Default)]
pub struct PreviewState {
    pub playing: bool,
    pub grid: bool,
}

/// Center preview: canvas pills, 16:9 frame with title-safe dashes,
/// play control, timecode stamp + VU, filmstrip + playhead.
pub fn preview_section(
    ui: &mut Ui,
    s: &mut PreviewState,
    playhead: f32,
    photos: &crate::photos::Photos,
) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            tag("100% Full Res", CYAN, PANEL2, ui);
            tag("Rec.709 D65", DIM, PANEL2, ui);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                tag("16:9", DIM, PANEL2, ui);
                if toolbar_button(ui, "Grid", s.grid).clicked() {
                    s.grid = !s.grid;
                }
            });
        });
        let w = ui.available_width();
        let h = (w * 9.0 / 16.0).clamp(200.0, 340.0);
        let (r, _) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::hover());
        let v = egui::Rect::from_min_size(r.min + Vec2::new(8.0, 8.0), Vec2::new(w - 16.0, h - 16.0));
        {
            let p = ui.painter();
            p.rect_filled(r, egui::CornerRadius::same(6), CANVAS);
        }
        // s1-4 is the HTML program-monitor still; overlays stay drawn.
        crate::photos::photo_fill(ui, photos, "s1-4", v, 2.0, Color32::WHITE);
        let p = ui.painter();
        dashed_rect(p, v.shrink(12.0), CYAN);
        dashed_rect(p, v.shrink(24.0), INDIGO);
        if s.grid {
            for f in [1.0 / 3.0, 2.0 / 3.0] {
                let x = v.left() + v.width() * f;
                let y = v.top() + v.height() * f;
                p.line_segment(
                    [egui::Pos2::new(x, v.top()), egui::Pos2::new(x, v.bottom())],
                    egui::Stroke::new(1.0, DIM),
                );
                p.line_segment(
                    [egui::Pos2::new(v.left(), y), egui::Pos2::new(v.right(), y)],
                    egui::Stroke::new(1.0, DIM),
                );
            }
        }
        let c = v.center();
        p.circle_filled(c, 26.0, Color32::from_rgba_unmultiplied(10, 12, 16, 200));
        p.circle_stroke(c, 26.0, egui::Stroke::new(2.0, CYAN));
        if s.playing {
            let bar = Vec2::new(5.0, 16.0);
            p.rect_filled(
                egui::Rect::from_center_size(c + Vec2::new(-7.0, 0.0), bar),
                egui::CornerRadius::same(1),
                Color32::WHITE,
            );
            p.rect_filled(
                egui::Rect::from_center_size(c + Vec2::new(7.0, 0.0), bar),
                egui::CornerRadius::same(1),
                Color32::WHITE,
            );
        } else {
            let (a, b, d) = (
                c + Vec2::new(-8.0, -11.0),
                c + Vec2::new(-8.0, 11.0),
                c + Vec2::new(10.0, 0.0),
            );
            let st = egui::Stroke::new(2.0, Color32::WHITE);
            p.line_segment([a, b], st);
            p.line_segment([b, d], st);
            p.line_segment([d, a], st);
        }
        let hit = egui::Rect::from_center_size(c, Vec2::new(56.0, 56.0));
        if ui.interact(hit, ui.scope_id().with("preview_play"), egui::Sense::click()).clicked() {
            s.playing = !s.playing;
        }
        ui.horizontal(|ui| {
            ui.label(mono("00:04:12:08", 11.0, CYAN));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                vu_meter(ui, 110.0, 0.72, 0.58);
            });
        });
        filmstrip(ui, ui.available_width(), playhead);
    });
}

#[derive(Clone)]
pub struct TimelineUiState {
    pub tool: usize,
    pub snap: bool,
    pub zoom: f32,
    pub playhead: f32,
    pub eyes: [bool; 5],
    pub locks: [bool; 5],
    pub extra_tracks: usize,
    pub extra_on: Vec<bool>,
    pub extra_lock: Vec<bool>,
}

impl Default for TimelineUiState {
    fn default() -> Self {
        Self {
            tool: 0,
            snap: true,
            zoom: 45.0,
            playhead: 0.38,
            eyes: [true; 5],
            locks: [false; 5],
            extra_tracks: 0,
            extra_on: Vec::new(),
            extra_lock: Vec::new(),
        }
    }
}

pub const TOOLS: [&str; 6] = ["Select", "Cut", "Sync", "Mark", "Key", "Link"];

fn lane_row(
    ui: &mut Ui,
    badge: &str,
    name: &str,
    color: Color32,
    eye: &mut bool,
    lock: &mut bool,
    paint: impl FnOnce(&mut Ui, egui::Rect),
) {
    ui.horizontal(|ui| {
        track_header(ui, badge, name, color, eye, lock);
        let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 52.0), egui::Sense::hover());
        ui.painter().rect_filled(r, egui::CornerRadius::same(4), PANEL2);
        paint(ui, r);
    });
}

/// Center timeline: tool toolbar + Add Track, zoom cluster, ruler with
/// ticks + needle, five track lanes with clips and a cyan playhead.
pub fn timeline_section(ui: &mut Ui, s: &mut TimelineUiState) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            for (i, t) in TOOLS.iter().enumerate() {
                if toolbar_button(ui, t, i == s.tool).clicked() {
                    s.tool = i;
                }
            }
            if toolbar_button(ui, "Snap", s.snap).clicked() {
                s.snap = !s.snap;
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.small_button("+ Add Track").clicked() {
                    s.extra_tracks += 1;
                    s.extra_on.push(true);
                    s.extra_lock.push(false);
                }
            });
        });
        zoom_row(ui, &mut s.zoom);
        ui.horizontal(|ui| {
            egui::Frame::new().fill(PANEL2).inner_margin(egui::Margin::same(4)).show(ui, |ui| {
                ui.set_min_size(Vec2::new(150.0, 26.0));
                tiny_dim("TIMELINE TICKS", ui);
            });
            let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 30.0), egui::Sense::hover());
            let p = ui.painter();
            for i in 0..8 {
                let x = r.left() + r.width() * i as f32 / 7.0;
                let active = (s.playhead * 7.0).round() as usize == i;
                p.text(
                    egui::Pos2::new(x, r.center().y),
                    egui::Align2::CENTER_CENTER,
                    format!("00:0{i}"),
                    egui::FontId::monospace(8.0),
                    if active { CYAN } else { FAINT },
                );
                p.line_segment(
                    [egui::Pos2::new(x, r.bottom() - 4.0), egui::Pos2::new(x, r.bottom())],
                    egui::Stroke::new(1.0, FAINT),
                );
            }
            playhead_line(p, r, s.playhead);
        });
        let ph = s.playhead;
        let dim = [!s.eyes[0], !s.eyes[1], !s.eyes[2], !s.eyes[3], !s.eyes[4]];
        lane_row(ui, "V2", "B-Roll", VIOLET, &mut s.eyes[0], &mut s.locks[0], |ui, r| {
            let p = ui.painter();
            let cr = egui::Rect::from_min_size(
                egui::Pos2::new(r.left() + r.width() * 0.08, r.top() + 4.0),
                Vec2::new(r.width() * 0.55, 44.0),
            );
            paint_clip(p, cr, "drone_cut_overhead", "FX:Stabilizer · Speed 100%", CLIP_INDIGO_BG, true, dim[0]);
            playhead_line(p, r, ph);
        });
        lane_row(ui, "V1", "Main Cut", INDIGO, &mut s.eyes[1], &mut s.locks[1], |ui, r| {
            let p = ui.painter();
            paint_clip(
                p,
                egui::Rect::from_min_size(
                    egui::Pos2::new(r.left() + 4.0, r.top() + 4.0),
                    Vec2::new(r.width() * 0.38, 44.0),
                ),
                "sunset_intro_master",
                "Speed 100%",
                INDIGO_DEEP,
                false,
                dim[1],
            );
            paint_clip(
                p,
                egui::Rect::from_min_size(
                    egui::Pos2::new(r.left() + r.width() * 0.42, r.top() + 4.0),
                    Vec2::new(r.width() * 0.28, 44.0),
                ),
                "beach_broll_02",
                "Speed 100%",
                GUNMETAL,
                false,
                dim[1],
            );
            playhead_line(p, r, ph);
        });
        lane_row(ui, "TT", "Titles", ORANGE, &mut s.eyes[2], &mut s.locks[2], |ui, r| {
            let p = ui.painter();
            paint_clip(
                p,
                egui::Rect::from_min_size(
                    egui::Pos2::new(r.left() + r.width() * 0.2, r.top() + 4.0),
                    Vec2::new(r.width() * 0.5, 44.0),
                ),
                "Summer Adventures 2025",
                "Title · Fade In",
                CLIP_AMBER_BG,
                false,
                dim[2],
            );
            playhead_line(p, r, ph);
        });
        lane_row(ui, "A1", "Dialogue", GREEN, &mut s.eyes[3], &mut s.locks[3], |ui, r| {
            let p = ui.painter();
            paint_audio_clip(
                p,
                egui::Rect::from_min_size(
                    egui::Pos2::new(r.left() + 4.0, r.top() + 4.0),
                    Vec2::new(r.width() - 8.0, 44.0),
                ),
                "dialogue_take3",
                "-14.2 LUFS",
                WAVE_BG_GREEN,
                GREEN,
                7,
                dim[3],
            );
            playhead_line(p, r, ph);
        });
        lane_row(ui, "A2", "Music", CYAN, &mut s.eyes[4], &mut s.locks[4], |ui, r| {
            let p = ui.painter();
            paint_audio_clip(
                p,
                egui::Rect::from_min_size(
                    egui::Pos2::new(r.left() + 4.0, r.top() + 4.0),
                    Vec2::new(r.width() - 8.0, 44.0),
                ),
                "ambient_bed",
                "Stereo 48kHz",
                WAVE_BG_CYAN,
                CYAN,
                21,
                dim[4],
            );
            playhead_line(p, r, ph);
        });
        for i in 0..s.extra_tracks {
            let (on, lk) = (s.extra_on[i], s.extra_lock[i]);
            let mut eye = on;
            let mut lock = lk;
            lane_row(ui, "V3", "Extra", PEWTER, &mut eye, &mut lock, |ui, r| {
                playhead_line(ui.painter(), r, ph);
            });
            s.extra_on[i] = eye;
            s.extra_lock[i] = lock;
        }
    });
}

#[derive(Clone)]
pub struct InspectorState {
    pub tab: usize,
    pub pos_x: String,
    pub pos_y: String,
    pub scale: f32,
    pub rotation: String,
    pub anchor: usize,
    pub opacity: f32,
    pub blend: usize,
    pub effects: usize,
    pub saturation: f32,
    pub applied: bool,
}

impl Default for InspectorState {
    fn default() -> Self {
        Self {
            tab: 0,
            pos_x: "1920".into(),
            pos_y: "1080".into(),
            scale: 100.0,
            rotation: "0.0".into(),
            anchor: 0,
            opacity: 100.0,
            blend: 0,
            effects: 2,
            saturation: 100.0,
            applied: false,
        }
    }
}

pub const INSPECTOR_TABS: [&str; 3] = ["Properties", "Effects", "Color"];
pub const BLEND_MODES: [&str; 4] = ["Normal", "Screen", "Multiply", "Overlay"];
pub const ANCHORS: [&str; 4] = ["Center", "Top-Left", "Top-Right", "Bottom-Left"];

/// Right inspector: tabs, clip card, transform/compositing/scopes,
/// suggestion card, GPU/ONLINE footer.
pub fn inspector_section(ui: &mut Ui, s: &mut InspectorState) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            for (i, t) in INSPECTOR_TABS.iter().enumerate() {
                let on = i == s.tab;
                let resp = ui.selectable_label(
                    on,
                    RichText::new(*t).size(12.0).color(if on { TEXT } else { DIM }),
                );
                if resp.clicked() {
                    s.tab = i;
                }
                if on {
                    ui.painter().line_segment(
                        [
                            resp.rect.left_bottom() + Vec2::new(0.0, 1.0),
                            resp.rect.right_bottom() + Vec2::new(0.0, 1.0),
                        ],
                        egui::Stroke::new(2.0, CYAN),
                    );
                }
            }
        });
        ui.add_space(4.0);
        ui.label(RichText::new("drone_coastal_sunset.mp4").size(13.0).strong().color(TEXT));
        ui.horizontal(|ui| {
            tag("V2 Track", CYAN, PANEL2, ui);
            tiny_dim("Selected Clip", ui);
        });
        match s.tab {
            0 => {
                ui.horizontal(|ui| {
                    section_title("TRANSFORM", ui);
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.small_button("Reset").clicked() {
                            s.pos_x = "1920".into();
                            s.pos_y = "1080".into();
                            s.scale = 100.0;
                            s.rotation = "0.0".into();
                            s.anchor = 0;
                        }
                    });
                });
                ui.horizontal(|ui| {
                    inspector_text(ui, "POS X", &mut s.pos_x);
                    inspector_text(ui, "POS Y", &mut s.pos_y);
                });
                ui.horizontal(|ui| {
                    tiny_dim("SCALE", ui);
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(mono(&format!("{:.1}%", s.scale), 10.0, TEXT));
                    });
                });
                ui.add(egui::Slider::new(&mut s.scale, 10.0..=200.0));
                ui.horizontal(|ui| {
                    inspector_text(ui, "ROTATION", &mut s.rotation);
                    tiny_dim("ANCHOR", ui);
                    combo(ui, "anchor", &mut s.anchor, &ANCHORS);
                });
                section_title("COMPOSITING", ui);
                ui.horizontal(|ui| {
                    tiny_dim("OPACITY", ui);
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(mono(&format!("{:.0}%", s.opacity), 10.0, TEXT));
                    });
                });
                ui.add(egui::Slider::new(&mut s.opacity, 0.0..=100.0));
                tiny_dim("BLEND MODE", ui);
                combo(ui, "blend", &mut s.blend, &BLEND_MODES);
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    section_title("SCOPES / HISTOGRAM", ui);
                    tag("PARADE", DIM, PANEL2, ui);
                });
                rgb_parade(ui, ui.available_width(), 60.0);
            }
            1 => {
                section_title("EFFECTS STACK", ui);
                tool_chip(ui, "Stabilizer · Optical Flow", EMERALD_SYNC);
                tool_chip(ui, "Color Pop · Sunset", CYAN);
                for i in 2..s.effects {
                    tool_chip(ui, &format!("Effect {}", i + 1), DIM);
                }
                if ui.small_button("+ Add Effect").clicked() {
                    s.effects += 1;
                }
            }
            _ => {
                section_title("COLOR", ui);
                rgb_parade(ui, ui.available_width(), 60.0);
                ui.horizontal(|ui| {
                    tiny_dim("SATURATION", ui);
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(mono(&format!("{:.0}%", s.saturation), 10.0, TEXT));
                    });
                });
                ui.add(egui::Slider::new(&mut s.saturation, 0.0..=200.0));
            }
        }
        ui.add_space(4.0);
        frame_raised().show(ui, |ui| {
            ui.label(RichText::new("Smart Scene Extension").size(12.0).strong().color(INDIGO));
            ui.label(
                RichText::new("Detected 2 matching B-roll candidates to cover timeline gap at 00:04:15.")
                    .size(10.0)
                    .color(DIM),
            );
            if ui.small_button(if s.applied { "Applied" } else { "Apply Magic Cut" }).clicked() {
                s.applied = true;
            }
        });
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            status_dot(ui, "GPU ACCELERATED", EMERALD_SYNC);
            hspace(ui, 12.0);
            status_dot(ui, "ONLINE", EMERALD_SYNC);
        });
    });
}

#[derive(Clone, Default)]
pub struct AgentMsg {
    pub mine: bool,
    pub text: String,
}

#[derive(Clone, Default)]
pub struct AgentState {
    pub composer: String,
    pub applied: bool,
    pub pinned: bool,
    pub history: Vec<AgentMsg>,
}

/// Agent drawer: header + READY, transcript, tool chips, quick
/// suggestions, composer. Close writes back through `open`.
pub fn agent_drawer(ui: &mut Ui, s: &mut AgentState, open: &mut bool) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            ui.label(RichText::new("AI Editing Agent").size(13.0).strong().color(TEXT));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.small_button("×").clicked() {
                    *open = false;
                }
                if toolbar_button(ui, "Pin", s.pinned).clicked() {
                    s.pinned = !s.pinned;
                }
            });
        });
        status_dot(ui, "READY · V2.4 OPTICAL FLOW", EMERALD_SYNC);
        ui.add_space(6.0);
        egui::ScrollArea::vertical()
            .max_height(300.0)
            .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
            .show(ui, |ui| {
            ui.vertical(|ui| {
                tiny_dim("Today 10:42 AM", ui);
                bubble_user(ui, "Trim the shaky intro and add captions with auto-highlighted keywords");
                bubble_agent(ui, "Analyzing timeline footage and optical flow motion vectors…");
                tool_chip(ui, "Analyzed 4 clips (Optical Flow Pass)", EMERALD_SYNC);
                tool_chip(ui, "Detected 3 shaky segments (00:00:14 – 00:01:02)", AMBER);
                tool_chip(ui, "Subtitles Synthesized", CYAN);
                for m in &s.history {
                    if m.mine {
                        bubble_user(ui, &m.text);
                    } else {
                        bubble_agent(ui, &m.text);
                    }
                }
            });
        });
        ui.horizontal(|ui| {
            if ui.small_button(if s.applied { "Applied" } else { "Apply Changes" }).clicked() {
                s.applied = true;
            }
            if ui.small_button("Preview Cut").clicked() {
                s.history.push(AgentMsg { mine: false, text: "Preview cut rendered to the canvas.".into() });
            }
        });
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            for q in ["Auto color balance", "Remove pauses", "Beat sync B-roll"] {
                if ui.small_button(q).clicked() {
                    if !s.composer.is_empty() {
                        s.composer.push(' ');
                    }
                    s.composer.push_str(q);
                }
            }
        });
        if composer(ui, &mut s.composer) {
            let sent = std::mem::take(&mut s.composer);
            s.history.push(AgentMsg { mine: true, text: sent });
            s.history.push(AgentMsg { mine: false, text: "On it — analyzing the timeline.".into() });
        }
    });
}
