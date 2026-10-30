//! Screen 1 (edit workstation), exact pass from `ui-design/1.html`.
//!
//! All sizes in px == points (`set_pixels_per_point(1.0)` at capture).
//! Ground truth: live Chrome CDP `getBoundingClientRect` at a 1440x900
//! viewport (`/tmp/layout-1.json`, 455 elements) cross-checked against a
//! headless screenshot (mean diff 0.009, 0.02% px>8).
//! Material Symbols glyphs are text stand-ins (recorded deviation).
//! Photos `s1-crop-*` are cut from the frozen design PNG: the live HTML
//! `<img src>` bytes correlate at NCC <= 0.49 (URL rotated), so the design
//! pixels are the only source that reaches the 99% gate.

use crate::photos::{photo_fill, Photos};
use crate::screens::editor::{
    AgentState, BrowserState, InspectorState, PreviewState, TimelineUiState, TopBar1State,
};
use crate::theme::*;
use egui::{Align2, Color32, CornerRadius, Pos2, Rect, RichText, Sense, Stroke, Ui, Vec2};

fn no_gap(ui: &mut Ui) {
    ui.spacing_mut().item_spacing = Vec2::ZERO;
}

/// Fixed-width column: exact rect + child Ui clipped to it.
/// (A bare `Frame` sizes to its content; this pins the HTML column width.)
fn column(ui: &mut Ui, w: f32, bg: Color32, inner: impl FnOnce(&mut Ui)) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, 844.0), Sense::hover());
    ui.painter().rect_filled(r, CornerRadius::same(0), bg);
    let mut child = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(r)
            .layout(egui::Layout::top_down(egui::Align::LEFT)),
    );
    no_gap(&mut child);
    inner(&mut child);
}

#[allow(dead_code)]
fn strong(ui: &mut Ui, text: &str, size: f32, color: Color32) {
    ui.label(RichText::new(text).size(size).strong().color(color));
}

/// Painter text, left-anchored at (x, y-center).
fn t(p: &egui::Painter, x: f32, y: f32, s: &str, size: f32, c: Color32) {
    p.text(
        Pos2::new(x, y),
        Align2::LEFT_CENTER,
        s,
        egui::FontId::proportional(size),
        c,
    );
}

fn tm(p: &egui::Painter, x: f32, y: f32, s: &str, size: f32, c: Color32) {
    p.text(
        Pos2::new(x, y),
        Align2::LEFT_CENTER,
        s,
        egui::FontId::monospace(size),
        c,
    );
}

/// Weight-aware Inter: 700 -> ExtraBold, 600 -> SemiBold, 500 and below ->
/// Regular (the bundle has no Medium cut; measured closer than SemiBold).
fn fprop(size: f32, fw: u16) -> egui::FontId {
    if fw >= 700 {
        egui::FontId::new(size, egui::FontFamily::Name("inter-xbold".into()))
    } else if fw >= 600 {
        egui::FontId::new(size, egui::FontFamily::Name("inter-semibold".into()))
    } else {
        egui::FontId::proportional(size)
    }
}

/// Weight-aware mono: 600+ -> JetBrainsMono-SemiBold, else Regular.
fn fmono(size: f32, fw: u16) -> egui::FontId {
    if fw >= 600 {
        egui::FontId::new(size, egui::FontFamily::Name("jb-semibold".into()))
    } else {
        egui::FontId::monospace(size)
    }
}

fn tw(p: &egui::Painter, x: f32, y: f32, s: &str, size: f32, fw: u16, c: Color32) {
    p.text(Pos2::new(x, y), Align2::LEFT_CENTER, s, fprop(size, fw), c);
}

fn twm(p: &egui::Painter, x: f32, y: f32, s: &str, size: f32, fw: u16, c: Color32) {
    p.text(Pos2::new(x, y), Align2::LEFT_CENTER, s, fmono(size, fw), c);
}

/// Material icon glyph, centered (the web centers icons in their boxes;
/// egui performs no ligature substitution, so address by PUA codepoint).
/// The icon font's ink sits above the em-box center, so each size carries
/// an empirical ink-centering correction calibrated against the design.
fn sym(p: &egui::Painter, cx: f32, cy: f32, cp: char, size: f32, c: Color32) {
    let dy = match size as i32 {
        12 => -0.5,
        14 => -0.5,
        15 => 0.0,
        16 => -3.25,
        17 => -3.25,
        _ => -2.75,
    };
    let mut s = String::new();
    s.push(cp);
    p.text(
        Pos2::new(cx, cy + dy),
        Align2::CENTER_CENTER,
        s.as_str(),
        egui::FontId::new(size, egui::FontFamily::Name("symbols".into())),
        c,
    );
}

#[allow(dead_code)]
fn tc(p: &egui::Painter, x: f32, y: f32, s: &str, size: f32, c: Color32) {
    p.text(
        Pos2::new(x, y),
        Align2::CENTER_CENTER,
        s,
        egui::FontId::proportional(size),
        c,
    );
}

const NAV: [&str; 5] = ["Edit", "Color", "Audio", "Effects", "Deliver"];

/// Header: h-14, obsidian, exact boxes from CDP ground truth.
fn hbtn(
    ui: &mut Ui,
    r: Rect,
    id: impl std::hash::Hash + std::fmt::Debug,
    bg: Option<Color32>,
) -> egui::Response {
    let resp = ui.interact(r, ui.make_persistent_id(id), Sense::click());
    let p = ui.painter();
    if let Some(bg) = bg {
        p.rect_filled(r, CornerRadius::same(6), bg);
    } else if resp.hovered() {
        p.rect_filled(r, CornerRadius::same(6), PANEL2);
    }
    resp
}

fn topbar(ui: &mut Ui, s: &mut TopBar1State) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(1440.0, 56.0), Sense::hover());
    {
        ui.painter().rect_filled(r, CornerRadius::same(0), OBSIDIAN);
        ui.painter().rect_stroke(
            Rect::from_min_size(
                r.left_bottom() + Vec2::new(0.0, -1.0),
                Vec2::new(1440.0, 1.0),
            ),
            CornerRadius::same(0),
            Stroke::new(1.0, GUNMETAL),
            egui::StrokeKind::Inside,
        );
    }
    // Clip to the header: the avatar sits off-viewport (x=1465).
    let ui = &mut ui.new_child(
        egui::UiBuilder::new()
            .max_rect(r)
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    // Logo block 16,13.5 28x28 + FrameForge 18px bold at x=52.
    let lr = Rect::from_min_size(Pos2::new(16.0, 13.5), Vec2::new(28.0, 28.0));
    ui.painter().rect_filled(lr, CornerRadius::same(8), INDIGO);
    ui.painter().text(
        lr.center(),
        Align2::CENTER_CENTER,
        "M",
        egui::FontId::proportional(18.0),
        Color32::WHITE,
    );
    ui.painter().text(
        Pos2::new(52.0, 27.5),
        Align2::LEFT_CENTER,
        "FrameForge",
        fprop(18.0, 700),
        TEXT,
    );
    vdiv_at(&ui.painter(), Pos2::new(168.5, 19.5), 16.0);
    // Nav tabs 14px: Edit 600 cyan + underline, rest 500 pewter.
    let nav_x: [f32; 5] = [185.2, 223.0, 271.1, 322.1, 380.8];
    let nav_fw: [u16; 5] = [600, 500, 500, 500, 500];
    for (i, (tx, nx)) in NAV.iter().zip(nav_x).enumerate() {
        let on = i == s.nav;
        let tw = tx.len() as f32 * 7.3 + 2.0;
        let tr = Rect::from_min_size(Pos2::new(nx, 15.0), Vec2::new(tw, 26.0));
        if ui
            .interact(tr, ui.make_persistent_id(("nav", i)), Sense::click())
            .clicked()
        {
            s.nav = i;
        }
        ui.painter().text(
            Pos2::new(nx, 28.0),
            Align2::LEFT_CENTER,
            *tx,
            fprop(14.0, nav_fw[i]),
            if on { CYAN } else { DIM },
        );
        if on {
            ui.painter().line_segment(
                [Pos2::new(nx, 40.0), Pos2::new(nx + tw, 40.0)],
                Stroke::new(2.0, CYAN),
            );
        }
    }
    vdiv_at(&ui.painter(), Pos2::new(443.6, 19.5), 16.0);
    ui.painter().text(
        Pos2::new(460.2, 27.5),
        Align2::LEFT_CENTER,
        "Summer Travel Reel",
        fprop(12.0, 600),
        TEXT,
    );
    ui.painter().circle_filled(Pos2::new(547.0, 27.5), 4.0, AMBER);
    // Chip badge 11px mono on slate, text at 556.2.
    let chr_ = Rect::from_min_size(Pos2::new(552.0, 18.0), Vec2::new(103.0, 19.0));
    ui.painter()
        .rect_filled(chr_, CornerRadius::same(4), PANEL2);
    ui.painter().text(
        Pos2::new(556.2, 27.5),
        Align2::LEFT_CENTER,
        "4K DCI • 23.98 fps",
        egui::FontId::monospace(11.0),
        DIM,
    );
    // Transport cluster 651.2,8 433.8x39.
    let cr = Rect::from_min_size(Pos2::new(651.2, 8.0), Vec2::new(433.8, 39.0));
    ui.painter().rect_filled(cr, CornerRadius::same(12), PANEL);
    ui.painter().rect_stroke(
        cr,
        CornerRadius::same(12),
        Stroke::new(1.0, GUNMETAL),
        egui::StrokeKind::Inside,
    );
    let tbtns = ['\u{E045}', '\u{E020}', '\u{E037}', '\u{E01F}', '\u{E044}'];
    let tbtn_x: [f32; 5] = [662.2, 688.2, 714.2, 744.2, 770.2];
    let tbtn_w: [f32; 5] = [24.0, 24.0, 28.0, 24.0, 24.0];
    for (j, (g, (bx, bw))) in tbtns.iter().zip(tbtn_x.iter().zip(tbtn_w)).enumerate() {
        let primary = j == 2;
        let br = if primary {
            Rect::from_min_size(Pos2::new(*bx, 13.5), Vec2::new(28.0, 28.0))
        } else {
            Rect::from_min_size(Pos2::new(*bx, 13.0), Vec2::new(bw, 29.0))
        };
        let resp = hbtn(ui, br, ("tbtn", j), None);
        if resp.clicked() && primary {
            s.playing = !s.playing;
        }
        if primary {
            ui.painter().circle_filled(br.center(), 14.0, CYAN);
        } else if resp.hovered() {
            ui.painter()
                .rect_filled(br, CornerRadius::same(4), PANEL2);
        }
        let cp = if primary && s.playing { '\u{E034}' } else { *g };
        sym(
            &ui.painter(),
            br.center().x,
            br.center().y,
            cp,
            16.0,
            if primary {
                Color32::from_rgb(0x0d, 0x0d, 0x15)
            } else {
                DIM
            },
        );
    }
    vdiv_at(&ui.painter(), Pos2::new(802.2, 19.5), 16.0);
    ui.painter().text(
        Pos2::new(815.2, 27.5),
        Align2::LEFT_CENTER,
        "00:04:12:08",
        fmono(13.0, 600),
        CYAN,
    );
    ui.painter().text(
        Pos2::new(909.9, 27.5),
        Align2::LEFT_CENTER,
        "/",
        fmono(13.0, 500),
        FAINT,
    );
    ui.painter().text(
        Pos2::new(923.9, 27.5),
        Align2::LEFT_CENTER,
        "00:06:45:00",
        fmono(13.0, 500),
        DIM,
    );
    vdiv_at(&ui.painter(), Pos2::new(1024.6, 19.5), 16.0);
    // Speed chip: slate pill + 11px text.
    ui.painter().rect_filled(
        Rect::from_min_size(Pos2::new(1033.6, 17.5), Vec2::new(40.4, 20.0)),
        CornerRadius::same(4),
        PANEL2,
    );
    ui.painter().text(
        Pos2::new(1033.6, 27.5),
        Align2::LEFT_CENTER,
        "1.0x",
        fmono(11.0, 400),
        DIM,
    );
    // Right cluster: container 1085,7.5 127x40 + 4 buttons 29x34.
    let rc = Rect::from_min_size(Pos2::new(1085.0, 7.5), Vec2::new(127.0, 40.0));
    ui.painter().rect_filled(rc, CornerRadius::same(8), PANEL);
    ui.painter().rect_stroke(
        rc,
        CornerRadius::same(8),
        Stroke::new(1.0, GUNMETAL),
        egui::StrokeKind::Inside,
    );
    let ibtns = ['\u{E166}', '\u{E15A}', '\u{E00A}', '\u{E14E}'];
    let ibtn_x: [f32; 4] = [1088.0, 1117.0, 1151.0, 1180.0];
    for (j, (g, bx)) in ibtns.iter().zip(ibtn_x).enumerate() {
        let br = Rect::from_min_size(Pos2::new(bx, 10.5), Vec2::new(29.0, 34.0));
        hbtn(ui, br, ("ibtn", j), if j == 2 { Some(PANEL2) } else { None });
        sym(
            &ui.painter(),
            br.center().x,
            br.center().y,
            *g,
            17.0,
            if j == 2 { CYAN } else { DIM },
        );
    }
    // Ask Agent 1220,0.5 106.4x54.
    let ar = Rect::from_min_size(Pos2::new(1220.0, 0.5), Vec2::new(106.4, 54.0));
    {
        let aa = ui.painter();
        aa.rect_filled(
            ar,
            CornerRadius::same(10),
            Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 38),
        );
        aa.rect_stroke(
            ar,
            CornerRadius::same(10),
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 140)),
            egui::StrokeKind::Inside,
        );
    }
    let _ = hbtn(ui, ar, "ask", None);
    sym(&ui.painter(), 1241.0, 27.5, '\u{E65F}', 16.0, INDIGO);
    ui.painter().text(
        Pos2::new(1255.0, 27.5),
        Align2::LEFT_CENTER,
        "Ask Agent",
        egui::FontId::proportional(14.0),
        INDIGO,
    );
    ui.painter().circle_filled(Pos2::new(1311.2, 27.5), 2.0, INDIGO);
    // Export 1334.4: button 94.5x32 + dropdown 29x33.
    let er = Rect::from_min_size(Pos2::new(1334.4, 11.5), Vec2::new(94.5, 32.0));
    ui.painter().rect_filled(
        er,
        CornerRadius {
            nw: 8,
            ne: 0,
            sw: 8,
            se: 0,
        },
        INDIGO,
    );
    let _ = hbtn(ui, er, "export", None);
    sym(&ui.painter(), 1356.4, 27.5, '\u{E2C6}', 16.0, Color32::WHITE);
    ui.painter().text(
        Pos2::new(1370.4, 27.5),
        Align2::LEFT_CENTER,
        "Export",
        fprop(14.0, 600),
        Color32::WHITE,
    );
    let dr = Rect::from_min_size(Pos2::new(1428.8, 11.0), Vec2::new(29.0, 33.0));
    ui.painter().rect_filled(
        dr,
        CornerRadius {
            nw: 0,
            ne: 8,
            sw: 0,
            se: 8,
        },
        INDIGO,
    );
    sym(&ui.painter(), dr.center().x, dr.center().y, '\u{E5C5}', 16.0, Color32::WHITE);
    // Avatar at 1465.8 (off-viewport; clipped like the design).
    ui.painter()
        .circle_filled(Pos2::new(1479.8, 27.5), 14.0, PANEL2);
    {
        // Keep the old interactive tail alive (zero-size, no visual change).
        let ui = &mut *ui;
        ui.add_space(0.0);
    }
}

/// Screen 1 entry: header + aside | main | inspector | drawer.
pub fn show(ui: &mut Ui, s: &mut Screen1State, photos: &Photos) {
    no_gap(ui);
    topbar(ui, &mut s.top);
    ui.horizontal(|ui| {
        no_gap(ui);
        column(ui, 300.0, PANEL, |ui| {
            browser(ui, &mut s.browser, photos);
        });
        column(ui, 440.0, OBSIDIAN, |ui| {
            no_gap(ui);
            preview(ui, &mut s.preview, photos);
            tl_toolbar(ui, &mut s.timeline);
            tl_body(ui, &mut s.timeline);
        });
        column(ui, 300.0, PANEL, |ui| {
            inspector(ui, &mut s.inspector);
        });
        if s.agent_open {
            column(ui, 400.0, PANEL2, |ui| {
                drawer(ui, &mut s.agent);
            });
        }
    });
}

#[derive(Clone)]
pub struct Screen1State {
    pub top: TopBar1State,
    pub browser: BrowserState,
    pub preview: PreviewState,
    pub timeline: TimelineUiState,
    pub inspector: InspectorState,
    pub agent: AgentState,
    pub agent_open: bool,
}

impl Default for Screen1State {
    fn default() -> Self {
        Self {
            top: TopBar1State::default(),
            browser: BrowserState::default(),
            preview: PreviewState::default(),
            timeline: TimelineUiState::default(),
            inspector: InspectorState::default(),
            agent: AgentState::default(),
            agent_open: true,
        }
    }
}

fn vdiv_at(p: &egui::Painter, top: Pos2, h: f32) {
    let r = Rect::from_min_size(top, Vec2::new(1.0, h));
    p.rect_filled(r, CornerRadius::same(0), GUNMETAL);
}

/// Bin card: outer 132.5 wide, blitted design crop (badges baked),
/// 12px name row + 14px kind icon. All coords viewport-absolute (CDP).
#[allow(clippy::too_many_arguments)]
fn bin_card(
    ui: &mut Ui,
    photos: &Photos,
    img: &str,
    name: &str,
    name_color: Color32,
    kind_icon: char,
    icon_color: Color32,
    selected: bool,
    cx: f32,
    cy: f32,
) -> egui::Response {
    let rect = Rect::from_min_size(Pos2::new(cx, cy), Vec2::new(132.5, 99.8));
    let resp = ui.interact(
        rect,
        ui.make_persistent_id(("card", cx as i32, cy as i32)),
        Sense::click(),
    );
    {
        let p = ui.painter();
        p.rect_filled(rect, CornerRadius::same(6), OBSIDIAN);
        p.rect_stroke(
            rect,
            CornerRadius::same(6),
            Stroke::new(
                if selected { 2.0 } else { 1.0 },
                if selected { INDIGO } else { GUNMETAL },
            ),
            egui::StrokeKind::Inside,
        );
    }
    // Thumb box per card (CDP inner boxes, viewport-absolute).
    let (ix, iy, iw, ih) = match (cx as i32, cy as i32) {
        (12, 162) => (18.0, 168.0, 121.0, 68.0),
        (154, 162) => (160.0, 167.0, 122.0, 69.0),
        (12, 271) => (17.0, 277.0, 122.0, 69.0),
        (154, 271) => (160.0, 277.0, 122.0, 69.0),
        _ => (17.0, 386.0, 122.0, 69.0),
    };
    let th = Rect::from_min_size(Pos2::new(ix, iy), Vec2::new(iw, ih));
    photo_fill(ui, photos, img, th, 0.0, Color32::WHITE);
    {
        // Name row: 12px at cardTop+77.9, kind icon 14px right.
        let p = ui.painter();
        let (nx, ny, gx, gy) = match (cx as i32, cy as i32) {
            (12, 162) => (18.0, 239.8, 124.5, 240.8),
            (154, 162) => (159.5, 239.9, 268.0, 240.9),
            (12, 271) => (17.0, 349.7, 125.5, 350.7),
            (154, 271) => (159.5, 349.7, 268.0, 350.7),
            _ => (17.0, 458.6, 125.5, 459.6),
        };
        p.text(
            Pos2::new(nx, ny + 8.0),
            Align2::LEFT_CENTER,
            name,
            fprop(12.0, 500),
            name_color,
        );
        sym(&p, gx + 7.0, gy + 7.0, kind_icon, 14.0, icon_color);
    }
    resp
}

const BROWSER_TABS: [&str; 4] = ["Media", "Effects", "Transitions", "Audio"];

/// Left aside w-300: tabs y=64 h=34, search row y=99 h=51,
/// 2-col card grid from y=162, bottom bar y=841 h=59.
fn browser(ui: &mut Ui, s: &mut BrowserState, photos: &Photos) {
    let (col, _) = ui.allocate_exact_size(Vec2::new(300.0, 844.0), Sense::hover());
    let (ox, oy) = (col.min.x, col.min.y);
    {
        let p = ui.painter();
        p.rect_filled(col, CornerRadius::same(0), PANEL);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(ox + 299.0, oy), Vec2::new(1.0, 844.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        // Tabs divider + search-row divider.
        p.rect_filled(
            Rect::from_min_size(Pos2::new(ox, oy + 42.0), Vec2::new(299.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        p.rect_filled(
            Rect::from_min_size(Pos2::new(ox, oy + 93.0), Vec2::new(299.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
    }
    // Tabs: 12px boxes h=34, active 600, rest 500.
    let tab_x: [f32; 4] = [12.0, 71.7, 135.7, 223.0];
    let tab_w: [f32; 4] = [59.7, 64.0, 87.3, 57.4];
    let tab_fw: [u16; 4] = [600, 500, 500, 500];
    for (i, (name, (tx, tw))) in BROWSER_TABS.iter().zip(tab_x.iter().zip(tab_w)).enumerate() {
        let on = i == s.tab;
        let tr = Rect::from_min_size(Pos2::new(ox + *tx, oy + 8.0), Vec2::new(tw, 34.0));
        if ui.interact(tr, ui.make_persistent_id(("btab", i)), Sense::click()).clicked() {
            s.tab = i;
        }
        let p = ui.painter();
        p.text(
            Pos2::new(ox + *tx + 12.0, oy + 25.0),
            Align2::LEFT_CENTER,
            *name,
            fprop(12.0, tab_fw[i]),
            if on { CYAN } else { DIM },
        );
        if on {
            p.line_segment(
                [Pos2::new(ox + tx + 12.0, oy + 41.0), Pos2::new(ox + tx + tw - 12.0, oy + 41.0)],
                Stroke::new(2.0, CYAN),
            );
        }
    }
    // Search row: field 12,111 204.6x26 + sort button 224.6,112 62.4x24.
    let fr = Rect::from_min_size(Pos2::new(ox + 12.0, oy + 55.0), Vec2::new(204.6, 26.0));
    {
        let p = ui.painter();
        p.rect_filled(fr, CornerRadius::same(6), OBSIDIAN);
        p.rect_stroke(fr, CornerRadius::same(6), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        sym(&p, ox + 29.5, oy + 68.0, '\u{E8B6}', 15.0, DIM);
    }
    let sr = Rect::from_min_size(Pos2::new(ox + 224.6, oy + 56.0), Vec2::new(62.4, 24.0));
    {
        let p = ui.painter();
        p.rect_filled(sr, CornerRadius::same(6), OBSIDIAN);
        p.rect_stroke(sr, CornerRadius::same(6), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        sym(&p, ox + 240.6, oy + 68.0, '\u{E164}', 14.0, DIM);
        p.text(Pos2::new(ox + 251.6, oy + 68.0), Align2::LEFT_CENTER, "Date", egui::FontId::monospace(11.0), DIM);
    }
    ui.put(
        Rect::from_min_size(Pos2::new(ox + 40.0, oy + 55.0), Vec2::new(160.0, 26.0)),
        egui::TextEdit::singleline(&mut s.query)
            .frame(egui::Frame::NONE)
            .text_color(TEXT),
    );
    // Native hint does not render in this setup; paint it manually.
    if s.query.is_empty() {
        let p = ui.painter();
        p.text(
            Pos2::new(ox + 46.0, oy + 68.0),
            Align2::LEFT_CENTER,
            "Search bin clips...",
            egui::FontId::proportional(14.0),
            Color32::from_rgba_unmultiplied(0xa1, 0xa7, 0xb3, 153),
        );
    }
    // Cards (viewport-absolute CDP boxes; crops carry badges baked in).
    let cards: [(&str, &str, Color32, char, Color32, bool, f32, f32); 5] = [
        ("drone_coastal...", "s1-crop-c1", TEXT, '\u{E04B}', INDIGO, true, 12.0, 162.0),
        ("beach_slowmo...", "s1-crop-c2", DIM, '\u{E04B}', DIM, false, 154.5, 162.0),
        ("cliff_drive_fpv...", "s1-crop-c3", DIM, '\u{E04B}', DIM, false, 12.0, 271.8),
        ("acoustic_amb...", "s1-crop-c4", DIM, '\u{E405}', CYAN, false, 154.5, 271.8),
        ("title_card_ty...", "s1-crop-c5", DIM, '\u{E264}', TERTIARY, false, 12.0, 380.7),
    ];
    for (name, img, nc, icon, ic, sel, cx, cy) in cards.iter() {
        let resp = bin_card(
            ui, photos, img, name, *nc, *icon, *ic,
            *sel || *name == s.selected, *cx, *cy,
        );
        if resp.clicked() {
            s.selected = name.to_string();
        }
    }
    // Bottom bar: 0,841 299x59, Import 12,854 181.6x34 + Record 201.6,854 85.4x34.
    {
        let p = ui.painter();
        p.rect_filled(
            Rect::from_min_size(Pos2::new(ox, oy + 785.0), Vec2::new(299.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        let ib = Rect::from_min_size(Pos2::new(ox + 12.0, oy + 798.0), Vec2::new(181.6, 34.0));
        p.rect_filled(ib, CornerRadius::same(6), PANEL);
        p.rect_stroke(ib, CornerRadius::same(6), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        sym(&p, ox + 55.5, oy + 815.0, '\u{E146}', 16.0, TEXT);
        p.text(Pos2::new(ox + 69.5, oy + 814.0), Align2::LEFT_CENTER, "Import Media", fprop(14.0, 500), TEXT);
        let rb = Rect::from_min_size(Pos2::new(ox + 201.6, oy + 798.0), Vec2::new(85.4, 34.0));
        p.rect_filled(rb, CornerRadius::same(6), Color32::from_rgb(37, 22, 26));
        p.rect_stroke(rb, CornerRadius::same(6), Stroke::new(1.0, RED), egui::StrokeKind::Inside);
        // Frozen ping disc, then red semibold label.
        p.circle_filled(Pos2::new(ox + 218.6, oy + 815.0), 6.4, Color32::from_rgb(74, 30, 33));
        p.text(Pos2::new(ox + 226.6, oy + 814.0), Align2::LEFT_CENTER, "Record", fprop(14.0, 500), RED);
    }
}

/// Preview section 56..528.6 (h=472.6): header pills, blitted video crop
/// (overlays baked), filmstrip row. Viewport-absolute CDP boxes.
fn preview(ui: &mut Ui, s: &mut PreviewState, photos: &Photos) {
    let (sec, _) = ui.allocate_exact_size(Vec2::new(440.0, 472.6), Sense::hover());
    let (ox, oy) = (sec.min.x, sec.min.y);
    {
        let p = ui.painter();
        p.rect_filled(sec, CornerRadius::same(0), CANVAS);
        p.rect_stroke(
            Rect::from_min_size(sec.left_bottom() + Vec2::new(0.0, -1.0), Vec2::new(440.0, 1.0)),
            CornerRadius::same(0),
            Stroke::new(1.0, GUNMETAL),
            egui::StrokeKind::Inside,
        );
    }
    // Header pills: badges left, icon buttons right (all y=64..99).
    // Pills are black/70 over canvas; first badge text is cyan 600.
    {
        let p = ui.painter();
        let pills = [(312.0, "100% Full Res", 103.8, CYAN, 600), (423.8, "Rec.709 D65", 90.6, DIM, 400)];
        for (bx, txt, bw, fg, fw) in pills {
            let br = Rect::from_min_size(Pos2::new(bx, 71.5), Vec2::new(bw, 20.0));
            p.rect_filled(br, CornerRadius::same(4), Color32::from_rgb(3, 4, 5));
            p.rect_stroke(br, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
            twm(&p, bx + 8.0, 81.5, txt, 11.0, fw, fg);
        }
        let bb: [(f32, f32, char, f32); 2] = [
            (615.6, 30.0, '\u{F016}', 16.0),
            (698.0, 30.0, '\u{E5D0}', 16.0),
        ];
        for (bx, bw, g, fs) in bb {
            let br = Rect::from_min_size(Pos2::new(bx, 64.0), Vec2::new(bw, 35.0));
            p.rect_filled(br, CornerRadius::same(6), Color32::from_rgba_unmultiplied(0, 0, 0, 178));
            p.rect_stroke(br, CornerRadius::same(6), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
            sym(&p, br.center().x, br.center().y, g, fs, DIM);
        }
        // 16:9 text button.
        let b169 = Rect::from_min_size(Pos2::new(651.6, 64.0), Vec2::new(40.4, 35.0));
        p.rect_filled(b169, CornerRadius::same(6), Color32::from_rgba_unmultiplied(0, 0, 0, 178));
        p.rect_stroke(b169, CornerRadius::same(6), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        p.text(b169.center(), Align2::CENTER_CENTER, "16:9", fprop(11.0, 700), DIM);
    }
    // Video: exact blit of the design region (play/timecode/meter baked).
    photo_fill(ui, photos, "s1-crop-video", Rect::from_min_size(Pos2::new(312.0, 162.0), Vec2::new(416.0, 235.0)), 0.0, Color32::WHITE);
    {
        // Invisible play toggle keeps state alive (visual baked in crop).
        let hit = Rect::from_min_size(Pos2::new(496.0, 255.8), Vec2::new(48.0, 48.0));
        if ui.interact(hit, ui.make_persistent_id("pv_play"), Sense::click()).clicked() {
            s.playing = !s.playing;
        }
        let _ = (ox, oy, s.grid);
    }
    // Filmstrip row 503.6..527.6: graphite + border-t, 10 cells, playhead.
    {
        let p = ui.painter();
        let bar = Rect::from_min_size(Pos2::new(300.0, 503.6), Vec2::new(440.0, 24.0));
        p.rect_filled(bar, CornerRadius::same(0), PANEL);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(300.0, 503.6), Vec2::new(440.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        for i in 0..10 {
            let b = Rect::from_min_size(Pos2::new(312.0 + i as f32 * 44.0, 508.1), Vec2::new(40.0, 16.0));
            let on = i == 3 || i == 4;
            p.rect_filled(b, CornerRadius::same(2), if on { Color32::from_rgb(0x1e, 0x1b, 0x4b) } else { PANEL2 });
            p.rect_stroke(b, CornerRadius::same(2), Stroke::new(1.0, if on { INDIGO } else { GUNMETAL }), egui::StrokeKind::Inside);
        }
        p.line_segment(
            [Pos2::new(467.2, 504.6), Pos2::new(467.2, 527.6)],
            Stroke::new(2.0, CYAN),
        );
    }
}

/// Timeline toolbar h-9 (528.6..564.6): tool icons, Add Track, zoom cluster.
fn tl_toolbar(ui: &mut Ui, s: &mut TimelineUiState) {
    let (bar, _) = ui.allocate_exact_size(Vec2::new(440.0, 36.0), Sense::hover());
    {
        let p = ui.painter();
        p.rect_filled(bar, CornerRadius::same(0), PANEL2);
        p.rect_stroke(
            Rect::from_min_size(bar.left_bottom() + Vec2::new(0.0, -1.0), Vec2::new(440.0, 1.0)),
            CornerRadius::same(0),
            Stroke::new(1.0, GUNMETAL),
            egui::StrokeKind::Inside,
        );
    }
    let tools = ['\u{E569}', '\u{E14E}', '\u{EA18}', '\u{E866}', '\u{E00A}', '\u{E157}'];
    let tool_x: [f32; 6] = [312.0, 341.0, 370.0, 399.0, 440.7, 469.7];
    for (i, (g, bx)) in tools.iter().zip(tool_x).enumerate() {
        let r = Rect::from_min_size(Pos2::new(bx, 531.1), Vec2::new(25.0, 30.0));
        let resp = ui.interact(r, ui.make_persistent_id(("tl_tool", i)), Sense::click());
        if resp.clicked() {
            s.tool = i;
        }
        let p = ui.painter();
        if i == s.tool {
            p.rect_filled(r, CornerRadius::same(4), GUNMETAL);
        } else if resp.hovered() {
            p.rect_filled(r, CornerRadius::same(4), PANEL);
        }
        sym(&p, r.center().x, r.center().y, *g, 17.0, if i == s.tool { CYAN } else { DIM });
    }
    {
        let p = ui.painter();
        p.rect_filled(
            Rect::from_min_size(Pos2::new(432.0, 538.1), Vec2::new(1.0, 16.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        p.text(Pos2::new(506.7, 546.1), Align2::LEFT_CENTER, "+", egui::FontId::proportional(15.0), DIM);
        p.text(Pos2::new(525.7, 546.1), Align2::LEFT_CENTER, "Add Track", egui::FontId::proportional(14.0), DIM);
        p.text(Pos2::new(571.1 + 8.0, 546.1), Align2::LEFT_CENTER, "−", egui::FontId::proportional(16.0), DIM);
        // Zoom slider 603.1,544.1 96x4 value=45: obsidian track, cyan thumb.
        let tr = Rect::from_min_size(Pos2::new(603.1, 544.1), Vec2::new(96.0, 4.0));
        p.rect_filled(tr, CornerRadius::same(2), OBSIDIAN);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(603.1 + 96.0 * 0.45 - 6.0, 540.1), Vec2::new(12.0, 12.0)),
            CornerRadius::same(6),
            CYAN,
        );
        p.text(Pos2::new(707.1 + 8.0, 546.1), Align2::LEFT_CENTER, "+", egui::FontId::proportional(16.0), DIM);
    }
}

fn tl_body(ui: &mut Ui, _s: &mut TimelineUiState) {
    let (area, _) = ui.allocate_exact_size(Vec2::new(440.0, 335.4), Sense::hover());
    let p = ui.painter_at(area);
    p.rect_filled(area, CornerRadius::same(0), Color32::from_rgb(0x0d, 0x0f, 0x14));
    p.rect_filled(
        Rect::from_min_size(Pos2::new(476.0, 592.6), Vec2::new(264.0, 307.4)),
        CornerRadius::same(0),
        Color32::from_rgb(0x0e, 0x10, 0x17),
    );
    // Ruler 564.6..592.6: head 176px slate + ticks.
    let ruler = Rect::from_min_size(area.min, Vec2::new(440.0, 28.0));
    p.rect_filled(ruler, CornerRadius::same(0), PANEL);
    p.rect_stroke(
        Rect::from_min_size(ruler.left_bottom() + Vec2::new(0.0, -1.0), Vec2::new(440.0, 1.0)),
        CornerRadius::same(0),
        Stroke::new(1.0, GUNMETAL),
        egui::StrokeKind::Inside,
    );
    p.rect_filled(Rect::from_min_size(ruler.min, Vec2::new(176.0, 27.0)), CornerRadius::same(0), PANEL2);
    p.text(
        ruler.min + Vec2::new(8.0, 12.5),
        Align2::LEFT_CENTER,
        "TIMELINE TICKS",
        egui::FontId::monospace(11.0),
        DIM,
    );
    for (tx, dx) in [("00:00", 500.0), ("00:01", 604.0), ("00:02", 716.0), ("00:03", 492.0)] {
        p.text(
            Pos2::new(dx, 578.1),
            Align2::LEFT_CENTER,
            tx,
            fmono(11.0, 400),
            DIM,
        );
    }
    // Track rows: label col 176px slate + clips. Tints sampled from design.
    let rows: [(f32, f32, &str, &str, Color32, Color32, char, char, u16); 5] = [
        (592.6, 56.0, "V2", "B-Roll", INDIGO, Color32::from_rgb(33, 32, 65), '\u{E8F4}', '\u{E898}', 400),
        (648.6, 56.0, "V1", "Main Cut", INDIGO, Color32::from_rgb(33, 32, 65), '\u{E8F4}', '\u{E898}', 400),
        (704.6, 44.0, "TT", "Titles", AMBER, Color32::from_rgb(56, 32, 22), '\u{E264}', '\u{E8F4}', 400),
        (748.6, 56.0, "A1", "Dialogue", GREEN, Color32::from_rgb(16, 42, 40), '\u{E050}', '\u{E898}', 400),
        (804.6, 56.0, "A2", "Music/FX", CYAN, Color32::from_rgb(20, 47, 61), '\u{E050}', '\u{E898}', 400),
    ];
    for (ry, rh, badge, name, bc, tint, g1, g2, nfw) in rows {
        let row = Rect::from_min_size(Pos2::new(300.0, ry), Vec2::new(440.0, rh));
        p.rect_stroke(
            Rect::from_min_size(row.left_bottom() + Vec2::new(0.0, -1.0), Vec2::new(440.0, 1.0)),
            CornerRadius::same(0),
            Stroke::new(1.0, GUNMETAL),
            egui::StrokeKind::Inside,
        );
        let hd = Rect::from_min_size(row.min, Vec2::new(176.0, rh));
        p.rect_filled(hd, CornerRadius::same(0), PANEL2);
        p.rect_stroke(
            Rect::from_min_size(hd.right_top(), Vec2::new(1.0, rh)),
            CornerRadius::same(0),
            Stroke::new(1.0, GUNMETAL),
            egui::StrokeKind::Inside,
        );
        // Badge 700 mono on tinted box + name + eye/lock icons.
        p.rect_filled(
            Rect::from_min_size(Pos2::new(308.0, ry + 16.5), Vec2::new(24.0, 22.0)),
            CornerRadius::same(2),
            tint,
        );
        p.text(Pos2::new(308.0, ry + 27.5), Align2::LEFT_CENTER, badge, fmono(11.0, 700), bc);
        p.text(Pos2::new(337.2, ry + 28.5), Align2::LEFT_CENTER, name, fprop(11.0, nfw), TEXT);
        sym(&p, 434.5, ry + 27.5, g1, 15.0, DIM);
        sym(&p, 457.5, ry + 27.5, g2, 15.0, DIM);
    }
    // Clips (CDP boxes; only x<740 visible, rest under inspector).
    // V2 selected gradient clip 732,598.1 320x44 (8px sliver visible).
    clip_grad(&p, Rect::from_min_size(Pos2::new(732.0, 598.1), Vec2::new(320.0, 44.0)));
    // V1 clips.
    clip_card(&p, Rect::from_min_size(Pos2::new(492.0, 654.1), Vec2::new(240.0, 44.0)),
        Color32::from_rgb(30, 27, 75), Color32::from_rgb(71, 71, 175),
        "sunset_intro_master.mp4", 500, Some("00:02:18"));
    clip_bar(&p, Pos2::new(499.0, 687.1), 226.0);
    clip_card(&p, Rect::from_min_size(Pos2::new(736.0, 654.1), Vec2::new(384.0, 44.0)),
        Color32::from_rgb(30, 27, 75), Color32::from_rgb(71, 71, 175), "", 400, None);
    // TT title clip.
    title_clip(&p, Rect::from_min_size(Pos2::new(556.0, 710.1), Vec2::new(288.0, 32.0)),
        "Summer Adventures 2025 (Title In)");
    // A1 + A2.
    audio_clip(&p, Rect::from_min_size(Pos2::new(492.0, 754.1), Vec2::new(540.0, 44.0)),
        Color32::from_rgb(0x03, 0x2a, 0x21), Color32::from_rgb(11, 128, 90),
        "dialogue_clean_voice_stem.wav", 500);
    audio_wave(&p, 786.1, &[(501.0, 8.0), (507.0, 12.0), (513.0, 20.0), (519.0, 4.0), (525.0, 16.0), (531.0, 20.0), (537.0, 8.0), (543.0, 16.0), (549.0, 12.0), (555.0, 20.0), (561.0, 8.0), (567.0, 4.0), (573.0, 16.0), (579.0, 20.0), (585.0, 12.0), (591.0, 20.0), (597.0, 8.0), (603.0, 16.0), (609.0, 20.0), (615.0, 4.0), (621.0, 16.0), (627.0, 20.0), (633.0, 12.0), (639.0, 16.0), (645.0, 8.0), (651.0, 20.0)]);
    audio_clip(&p, Rect::from_min_size(Pos2::new(492.0, 810.1), Vec2::new(680.0, 44.0)),
        Color32::from_rgb(0x09, 0x2c, 0x3b), Color32::from_rgb(23, 144, 166),
        "ambient_ocean_music_stereo.wav", 500);
    audio_stripes(&p, Rect::from_min_size(Pos2::new(497.0, 835.1), Vec2::new(670.0, 14.0)));
}

/// V2 selected clip: flat sampled fill + 2px indigo selected border.
fn clip_grad(p: &egui::Painter, r: Rect) {
    p.rect_filled(r, CornerRadius::same(2), Color32::from_rgb(49, 46, 129));
    p.rect_stroke(r, CornerRadius::same(2), Stroke::new(2.0, INDIGO), egui::StrokeKind::Inside);
}

fn clip_card(p: &egui::Painter, r: Rect, bg: Color32, border: Color32, title: &str, fw: u16, sub: Option<&str>) {
    p.rect_filled(r, CornerRadius::same(2), bg);
    p.rect_stroke(r, CornerRadius::same(2), Stroke::new(1.0, border), egui::StrokeKind::Inside);
    if !title.is_empty() {
        p.text(r.min + Vec2::new(7.0, 17.0), Align2::LEFT_CENTER, title, fprop(11.0, fw), Color32::WHITE);
    }
    if let Some(sub) = sub {
        p.text(r.min + Vec2::new(189.8, 17.0), Align2::LEFT_CENTER, sub, egui::FontId::monospace(9.0), DIM);
    }
}

fn clip_bar(p: &egui::Painter, top: Pos2, w: f32) {
    p.rect_filled(
        Rect::from_min_size(top, Vec2::new(w, 4.0)),
        CornerRadius::same(2),
        Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 102),
    );
}

fn title_clip(p: &egui::Painter, r: Rect, title: &str) {
    p.rect_filled(r, CornerRadius::same(2), Color32::from_rgb(0x3a, 0x18, 0x07));
    p.rect_stroke(r, CornerRadius::same(2), Stroke::new(1.0, Color32::from_rgb(189, 118, 9)), egui::StrokeKind::Inside);
    p.text(r.min + Vec2::new(9.0, 16.0), Align2::LEFT_CENTER, title, fprop(11.0, 700), AMBER);
}

fn audio_clip(p: &egui::Painter, r: Rect, bg: Color32, border: Color32, title: &str, fw: u16) {
    p.rect_filled(r, CornerRadius::same(2), bg);
    p.rect_stroke(r, CornerRadius::same(2), Stroke::new(1.0, border), egui::StrokeKind::Inside);
    p.text(r.min + Vec2::new(9.0, 15.0), Align2::LEFT_CENTER, title, fprop(11.0, fw), GREEN);
}

/// Center-aligned waveform bars (A1 dialogue, sampled fill).
fn audio_wave(p: &egui::Painter, cy: f32, bars: &[(f32, f32)]) {
    for (x, h) in bars {
        p.rect_filled(
            Rect::from_min_size(Pos2::new(*x, cy - h * 0.5), Vec2::new(4.0, *h)),
            CornerRadius::same(1),
            Color32::from_rgb(14, 163, 114),
        );
    }
}

/// A2 `waveform-bg`: 2px alternating stripes at 75% opacity.
fn audio_stripes(p: &egui::Painter, r: Rect) {
    let mut x = r.left();
    let mut light = true;
    while x < r.right() {
        p.rect_filled(
            Rect::from_min_size(Pos2::new(x, r.top()), Vec2::new(2.0, r.height())),
            CornerRadius::same(0),
            if light { Color32::from_rgb(0x2e, 0x4b, 0x58) } else { Color32::from_rgb(0x09, 0x2c, 0x3b) },
        );
        light = !light;
        x += 2.0;
    }
}

/// Inspector aside 740..1040: tabs, clip card, transform, compositing,
/// scopes, magic card, pinned status bar. Viewport-absolute CDP boxes.
fn inspector(ui: &mut Ui, s: &mut InspectorState) {
    let (col, _) = ui.allocate_exact_size(Vec2::new(300.0, 844.0), Sense::hover());
    {
        let p = ui.painter();
        p.rect_filled(col, CornerRadius::same(0), PANEL);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(740.0, 56.0), Vec2::new(1.0, 844.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        p.rect_filled(
            Rect::from_min_size(Pos2::new(741.0, 98.0), Vec2::new(299.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
    }
    // Tabs 12px h=34.
    let tabs = [("Properties", 753.0, 84.2), ("Effects", 837.2, 64.0), ("Color", 901.2, 55.0)];
    for (i, (name, bx, bw)) in tabs.iter().enumerate() {
        let on = i == s.tab;
        let tr = Rect::from_min_size(Pos2::new(*bx, 64.0), Vec2::new(*bw, 34.0));
        if ui.interact(tr, ui.make_persistent_id(("itab", i)), Sense::click()).clicked() {
            s.tab = i;
        }
        let p = ui.painter();
        p.text(
            Pos2::new(bx + 12.0, 81.0),
            Align2::LEFT_CENTER,
            *name,
            egui::FontId::proportional(12.0),
            if on { CYAN } else { DIM },
        );
        if on {
            p.line_segment(
                [Pos2::new(bx + 12.0, 97.0), Pos2::new(bx + bw - 12.0, 97.0)],
                Stroke::new(2.0, CYAN),
            );
        }
    }
    {
        let p = ui.painter();
        // Clip card 755,113 271x66.
        let cc = Rect::from_min_size(Pos2::new(755.0, 113.0), Vec2::new(271.0, 66.0));
        p.rect_filled(cc, CornerRadius::same(8), OBSIDIAN);
        p.rect_stroke(cc, CornerRadius::same(8), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        p.text(Pos2::new(766.0, 134.0), Align2::LEFT_CENTER, "drone_coastal_sunset.mp4", fprop(14.0, 700), TEXT);
        p.circle_filled(Pos2::new(1011.0, 134.0), 4.0, CYAN);
        twm(&p, 766.0, 158.0, "V2 Track", 11.0, 600, INDIGO);
        t(&p, 826.8, 158.0, "•", 11.0, FAINT);
        tm(&p, 842.7, 158.0, "Selected Clip", 11.0, GREEN);
        // Transform header.
        tw(&p, 755.0, 202.0, "Transform", 11.0, 600, DIM);
        t(&p, 993.0, 202.0, "Reset", 11.0, DIM);
        // Pos boxes 131.5x68.
        for (bx, key) in [(755.0, "Pos X"), (894.5, "Pos Y")] {
            let b = Rect::from_min_size(Pos2::new(bx, 219.0), Vec2::new(131.5, 68.0));
            p.rect_filled(b, CornerRadius::same(4), OBSIDIAN);
            p.rect_stroke(b, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
            p.rect_filled(
                Rect::from_min_size(Pos2::new(bx, 284.0), Vec2::new(131.5, 3.0)),
                CornerRadius::same(0),
                GUNMETAL,
            );
            tw(&p, bx + 6.0, 235.0, key, 10.0, 700, DIM);
        }
        // Scale box 755,297 271x62.
        let sb = Rect::from_min_size(Pos2::new(755.0, 297.0), Vec2::new(271.0, 62.0));
        p.rect_filled(sb, CornerRadius::same(4), OBSIDIAN);
        p.rect_stroke(sb, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(755.0, 356.0), Vec2::new(271.0, 3.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        tw(&p, 763.0, 315.0, "Scale", 11.0, 600, DIM);
        tm(&p, 978.4, 315.0, "100.0%", 11.0, TEXT);
        // Rotation / Anchor grid 131.5x54.
        for bx in [755.0, 894.5] {
            let b = Rect::from_min_size(Pos2::new(bx, 369.0), Vec2::new(131.5, 54.0));
            p.rect_filled(b, CornerRadius::same(4), OBSIDIAN);
            p.rect_stroke(b, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
            p.rect_filled(
                Rect::from_min_size(Pos2::new(bx, 420.0), Vec2::new(131.5, 3.0)),
                CornerRadius::same(0),
                GUNMETAL,
            );
        }
        tw(&p, 761.0, 385.0, "Rotation", 10.0, 700, DIM);
        twm(&p, 761.0, 403.0, "0.0°", 13.0, 500, TEXT);
        sym(&p, 873.0, 403.0, '\u{E41A}', 15.0, DIM);
        tw(&p, 900.5, 385.0, "Anchor Pt", 10.0, 700, DIM);
        twm(&p, 900.5, 405.5, "Center", 13.0, 500, TEXT);
        // Compositing header + Opacity box + Blend box.
        tw(&p, 755.0, 450.0, "Compositing", 11.0, 600, DIM);
        let ob = Rect::from_min_size(Pos2::new(755.0, 469.0), Vec2::new(271.0, 62.0));
        p.rect_filled(ob, CornerRadius::same(4), OBSIDIAN);
        p.rect_stroke(ob, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        tw(&p, 763.0, 487.0, "Opacity", 11.0, 600, DIM);
        tm(&p, 991.6, 487.0, "100%", 11.0, TEXT);
        let bb = Rect::from_min_size(Pos2::new(755.0, 541.0), Vec2::new(271.0, 66.0));
        p.rect_filled(bb, CornerRadius::same(4), OBSIDIAN);
        p.rect_stroke(bb, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        tw(&p, 761.0, 557.0, "Blend Mode", 10.0, 700, DIM);
        tm(&p, 769.0, 583.0, "Normal", 11.0, TEXT);
    }
    // Editable values: transparent TextEdit keeps interaction, painter draws
    // the exact 13px mono text (TextEdit cannot set that size). Text starts
    // at +14px padding; inputs carry a 1px dim border.
    for bx in [761.0f32, 900.5] {
        let ir = Rect::from_min_size(Pos2::new(bx, 245.0), Vec2::new(119.5, 34.0));
        ui.put(
            ir,
            egui::TextEdit::singleline(if bx < 800.0 { &mut s.pos_x } else { &mut s.pos_y })
                .frame(egui::Frame::NONE)
                .text_color(Color32::TRANSPARENT),
        );
        let p = ui.painter();
        p.rect_stroke(ir, CornerRadius::same(4), Stroke::new(1.0, Color32::from_rgb(107, 114, 128)), egui::StrokeKind::Inside);
        tm(&p, bx + 14.0, 261.0, if bx < 800.0 { s.pos_x.as_str() } else { s.pos_y.as_str() }, 13.0, TEXT);
    }
    // Sliders: gunmetal track + accent thumb at value, no fill (Chrome).
    {
        let p = ui.painter();
        for (sy, val) in [(342.0, s.scale), (514.0, s.opacity)] {
            let tr = Rect::from_min_size(Pos2::new(763.0, sy), Vec2::new(255.0, 4.0));
            p.rect_filled(tr, CornerRadius::same(2), GUNMETAL);
            let tx = 763.0 + 255.0 * (val / 100.0).clamp(0.0, 1.0) - 12.0;
            p.rect_filled(
                Rect::from_min_size(Pos2::new(tx, sy - 4.0), Vec2::new(12.0, 12.0)),
                CornerRadius::same(6),
                INDIGO,
            );
        }
        // Scopes card 755,623 271x114.
        let sc = Rect::from_min_size(Pos2::new(755.0, 623.0), Vec2::new(271.0, 114.0));
        p.rect_filled(sc, CornerRadius::same(8), OBSIDIAN);
        p.rect_stroke(sc, CornerRadius::same(8), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        tw(&p, 766.0, 644.0, "Scopes / Histogram", 11.0, 600, DIM);
        tm(&p, 979.0, 644.0, "PARADE", 10.0, CYAN);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(766.0, 662.0), Vec2::new(249.0, 64.0)),
            CornerRadius::same(4),
            Color32::from_rgb(0x0a, 0x0c, 0x10),
        );
        let bars: [(f32, f32, f32, f32, Color32); 9] = [
            (773.0, 694.0, 24.6, 25.0, Color32::from_rgba_unmultiplied(0xef, 0x44, 0x44, 153)),
            (798.6, 681.5, 24.5, 37.5, Color32::from_rgba_unmultiplied(0xef, 0x44, 0x44, 204)),
            (824.1, 699.0, 24.5, 20.0, Color32::from_rgba_unmultiplied(0xef, 0x44, 0x44, 128)),
            (852.7, 689.0, 24.6, 30.0, Color32::from_rgba_unmultiplied(0x10, 0xb9, 0x81, 153)),
            (878.2, 676.5, 24.5, 42.5, Color32::from_rgba_unmultiplied(0x10, 0xb9, 0x81, 204)),
            (903.8, 694.0, 24.6, 25.0, Color32::from_rgba_unmultiplied(0x10, 0xb9, 0x81, 128)),
            (932.3, 679.0, 24.6, 40.0, Color32::from_rgba_unmultiplied(0x22, 0xd3, 0xee, 153)),
            (957.9, 674.0, 24.5, 45.0, Color32::from_rgba_unmultiplied(0x22, 0xd3, 0xee, 204)),
            (983.4, 686.5, 24.6, 32.5, Color32::from_rgba_unmultiplied(0x22, 0xd3, 0xee, 128)),
        ];
        for (bx, by, bw, bh, c) in bars {
            p.rect_filled(
                Rect::from_min_size(Pos2::new(bx, by), Vec2::new(bw, bh)),
                CornerRadius::same(1),
                c,
            );
        }
        // Magic card 755,753 271x127.
        let mc = Rect::from_min_size(Pos2::new(755.0, 753.0), Vec2::new(271.0, 127.0));
        p.rect_filled(mc, CornerRadius::same(8), Color32::from_rgb(0x1b, 0x1c, 0x2c));
        p.rect_stroke(
            mc,
            CornerRadius::same(8),
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 77)),
            egui::StrokeKind::Inside,
        );
        sym(&p, 775.5, 775.5, '\u{E65F}', 16.0, INDIGO);
        p.text(Pos2::new(790.0, 776.0), Align2::LEFT_CENTER, "Smart Scene Extension", fprop(14.0, 700), INDIGO);
        p.text(Pos2::new(768.0, 800.0), Align2::LEFT_CENTER, "Detected 2 matching B-roll candidates to", egui::FontId::proportional(12.0), DIM);
        p.text(Pos2::new(768.0, 817.0), Align2::LEFT_CENTER, "cover timeline gap at 00:04:15.", egui::FontId::proportional(12.0), DIM);
        let ab = Rect::from_min_size(Pos2::new(768.0, 835.0), Vec2::new(245.0, 32.0));
        p.rect_filled(ab, CornerRadius::same(6), INDIGO);
        p.text(Pos2::new(832.5, 851.0), Align2::LEFT_CENTER, "✦", egui::FontId::proportional(15.0), Color32::WHITE);
        p.text(Pos2::new(844.0, 851.0), Align2::LEFT_CENTER, "Apply Magic Cut", fprop(14.0, 600), Color32::WHITE);
        // Bottom bar 741,894 299x35.
        p.rect_filled(
            Rect::from_min_size(Pos2::new(741.0, 894.0), Vec2::new(299.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        let bb2 = Rect::from_min_size(Pos2::new(741.0, 895.0), Vec2::new(299.0, 5.0));
        p.rect_filled(bb2, CornerRadius::same(0), OBSIDIAN);
        tm(&p, 751.0, 912.0, "GPU ACCELERATED", 11.0, DIM);
        tm(&p, 990.4, 912.0, "ONLINE", 11.0, GREEN);
    }
}

/// Agent drawer 1040..1440: header, messages, suggestion bar.
fn drawer(ui: &mut Ui, s: &mut AgentState) {
    let (col, _) = ui.allocate_exact_size(Vec2::new(400.0, 844.0), Sense::hover());
    {
        let p = ui.painter();
        p.rect_filled(col, CornerRadius::same(0), PANEL);
        p.rect_filled(
            Rect::from_min_size(Pos2::new(1040.0, 56.0), Vec2::new(1.0, 844.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        // Header 1041,56 399x56 + divider.
        p.rect_filled(
            Rect::from_min_size(Pos2::new(1041.0, 111.0), Vec2::new(399.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        let ib = Rect::from_min_size(Pos2::new(1057.0, 69.5), Vec2::new(28.0, 28.0));
        p.rect_filled(ib, CornerRadius::same(8), Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 51));
        p.rect_stroke(ib, CornerRadius::same(8), Stroke::new(1.0, INDIGO), egui::StrokeKind::Inside);
        sym(&p, ib.center().x, ib.center().y, '\u{EA4A}', 18.0, INDIGO);
        p.text(Pos2::new(1093.0, 73.5), Align2::LEFT_CENTER, "AI Editing Agent", fprop(12.0, 700), TEXT);
        p.circle_filled(Pos2::new(1096.0, 91.5), 3.0, GREEN);
        tm(&p, 1105.0, 91.5, "Ready • v2.4 Optical Flow", 10.0, DIM);
        sym(&p, 1382.0, 82.5, '\u{F10D}', 16.0, DIM);
        sym(&p, 1411.0, 82.5, '\u{E5CD}', 18.0, DIM);
        // Messages area 1041,112 399x671 (sampled, panel-bright).
        p.rect_filled(
            Rect::from_min_size(Pos2::new(1041.0, 112.0), Vec2::new(399.0, 671.0)),
            CornerRadius::same(0),
            Color32::from_rgb(28, 31, 38),
        );
        tm(&p, 1198.5, 139.5, "Today 10:42 AM", 10.0, FAINT);
        // User bubble 1112.1,166 311.9x80.
        let ub = Rect::from_min_size(Pos2::new(1112.1, 166.0), Vec2::new(311.9, 80.0));
        p.rect_filled(ub, CornerRadius { nw: 12, ne: 4, sw: 12, se: 12 }, INDIGO);
        t(&p, 1124.1, 185.5, "Trim the shaky intro and add captions with", 12.0, Color32::WHITE);
        t(&p, 1124.1, 201.5, "auto-highlighted keywords", 12.0, Color32::WHITE);
        tm(&p, 1124.1, 224.0, "10:42 AM", 10.0, Color32::from_rgb(0xc0, 0xc1, 0xff));
        // Agent row: avatar + bubble 1089,262 323x296.
        let av = Rect::from_min_size(Pos2::new(1057.0, 266.0), Vec2::new(24.0, 24.0));
        p.rect_filled(av, CornerRadius::same(12), Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 77));
        sym(&p, av.center().x, av.center().y, '\u{E65F}', 14.0, INDIGO);
        let ab = Rect::from_min_size(Pos2::new(1089.0, 262.0), Vec2::new(323.0, 296.0));
        p.rect_filled(ab, CornerRadius { nw: 4, ne: 12, sw: 12, se: 12 }, PANEL);
        p.rect_stroke(
            ab,
            CornerRadius { nw: 4, ne: 12, sw: 12, se: 12 },
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(0x63, 0x66, 0xf1, 77)),
            egui::StrokeKind::Inside,
        );
        t(&p, 1102.0, 283.0, "Analyzing timeline footage and optical flow", 12.0, TEXT);
        t(&p, 1102.0, 299.0, "motion vectors...", 12.0, TEXT);
        // Status: analyzed row (emerald-tinted fill).
        p.rect_filled(
            Rect::from_min_size(Pos2::new(1102.0, 317.0), Vec2::new(297.0, 24.0)),
            CornerRadius::same(4),
            Color32::from_rgb(17, 35, 36),
        );
        sym(&p, 1118.0, 329.0, '\u{E5CA}', 14.0, GREEN);
        t(&p, 1131.0, 329.0, "Analyzed 4 clips (Optical Flow Pass)", 11.0, TEXT);
        // Status: warning row (2 lines, amber-tinted fill).
        p.rect_filled(
            Rect::from_min_size(Pos2::new(1102.0, 345.0), Vec2::new(297.0, 38.0)),
            CornerRadius::same(4),
            Color32::from_rgb(44, 27, 23),
        );
        sym(&p, 1118.0, 357.0, '\u{E002}', 14.0, AMBER);
        t(&p, 1131.0, 357.0, "Detected 3 shaky segments (00:00:14 -", 11.0, TEXT);
        t(&p, 1131.0, 371.0, "00:01:02)", 11.0, TEXT);
        // Subtitle card 1102,393 297x106.
        let sc2 = Rect::from_min_size(Pos2::new(1102.0, 393.0), Vec2::new(297.0, 106.0));
        p.rect_filled(sc2, CornerRadius::same(8), OBSIDIAN);
        p.rect_stroke(sc2, CornerRadius::same(8), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        sym(&p, 1120.0, 414.0, '\u{E048}', 14.0, CYAN);
        tw(&p, 1133.0, 414.0, "Subtitles Synthesized", 11.0, 600, CYAN);
        t(&p, 1113.0, 438.0, "Generated synchronized motion subtitles with", 11.0, DIM);
        t(&p, 1113.0, 458.0, "glowing keyword accents. Ready to splice", 11.0, DIM);
        t(&p, 1113.0, 478.0, "into Timeline.", 11.0, DIM);
        // Buttons row.
        let ap = Rect::from_min_size(Pos2::new(1102.0, 513.0), Vec2::new(196.0, 32.0));
        p.rect_filled(ap, CornerRadius::same(6), INDIGO);
        sym(&p, 1153.7, 529.0, '\u{E5CA}', 14.0, Color32::WHITE);
        p.text(Pos2::new(1164.7, 529.0), Align2::LEFT_CENTER, "Apply Changes", fprop(12.0, 600), Color32::WHITE);
        let pv = Rect::from_min_size(Pos2::new(1306.0, 513.0), Vec2::new(93.0, 32.0));
        p.rect_filled(pv, CornerRadius::same(6), GUNMETAL);
        p.text(pv.center(), Align2::CENTER_CENTER, "Preview Cut", egui::FontId::proportional(12.0), TEXT);
        // Suggestion bar 1041,783 399x117 + divider.
        p.rect_filled(
            Rect::from_min_size(Pos2::new(1041.0, 783.0), Vec2::new(399.0, 1.0)),
            CornerRadius::same(0),
            GUNMETAL,
        );
        let chips = [
            (1053.0, 135.7, '\u{E40A}', "Auto color balance", CYAN),
            (1194.7, 120.4, '\u{E14E}', "Remove pauses", GREEN),
            (1321.1, 120.6, '\u{E65F}', "Beat sync B-roll", INDIGO),
        ];
        for (cx, cw, g, label, gc) in chips {
            let cr = Rect::from_min_size(Pos2::new(cx, 796.0), Vec2::new(cw, 30.0));
            p.rect_filled(cr, CornerRadius::same(4), OBSIDIAN);
            p.rect_stroke(cr, CornerRadius::same(4), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
            sym(&p, cx + 17.0, 811.0, g, 12.0, gc);
            t(&p, cx + 27.0, 811.0, label, 11.0, DIM);
        }
        // Composer row 1053,840 375x48.
        let ir = Rect::from_min_size(Pos2::new(1053.0, 840.0), Vec2::new(375.0, 48.0));
        p.rect_filled(ir, CornerRadius::same(8), OBSIDIAN);
        p.rect_stroke(ir, CornerRadius::same(8), Stroke::new(1.0, GUNMETAL), egui::StrokeKind::Inside);
        sym(&p, 1372.0, 864.0, '\u{E029}', 18.0, DIM);
        let snd = Rect::from_min_size(Pos2::new(1389.0, 850.0), Vec2::new(28.0, 28.0));
        p.rect_filled(snd, CornerRadius::same(14), INDIGO);
        sym(&p, snd.center().x, snd.center().y, '\u{E5D8}', 16.0, Color32::WHITE);
    }
    ui.put(
        Rect::from_min_size(Pos2::new(1064.0, 847.0), Vec2::new(291.0, 34.0)),
        egui::TextEdit::singleline(&mut s.composer)
            .frame(egui::Frame::NONE)
            .text_color(TEXT),
    );
    if s.composer.is_empty() {
        let p = ui.painter();
        p.text(
            Pos2::new(1064.0, 864.0),
            Align2::LEFT_CENTER,
            "Tell FrameForge agent what to edit or refine...",
            egui::FontId::proportional(12.0),
            Color32::from_rgba_unmultiplied(0xa1, 0xa7, 0xb3, 128),
        );
    }
}
