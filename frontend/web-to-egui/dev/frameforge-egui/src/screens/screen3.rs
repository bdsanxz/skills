//! Screen 3: Projects + Media Library Hub.
//!
//! Bottom-up composition: tokens come from `theme`, shared widgets from
//! `widgets` and `screens::editor`. Each component is a `fn(ui: &mut Ui)` and
//! sections compose them; `show` is the screen entry point.

use crate::screens::editor::topbar;
use crate::theme::*;
use crate::widgets::*;
use egui::{Align, Color32, Layout, RichText, Ui, Vec2};

// ---------------------------------------------------------------------------
// Top app bar (screen-3 variant: workspace dropdown + section nav)
// ---------------------------------------------------------------------------

fn app_bar(ui: &mut Ui, photos: &crate::photos::Photos) {
    ui.horizontal(|ui| {
        ui.label(RichText::new("FrameForge").size(15.0).strong().color(TEXT));
        hspace(ui, 10.0);
        tag("Neon Orbit VFX / All Projects", TEXT, PANEL2, ui);
        hspace(ui, 10.0);
        for (t, a) in [
            ("Projects", true),
            ("Assets", false),
            ("Templates", false),
            ("Render Queue", false),
        ] {
            top_button(t, a, ui);
            hspace(ui, 6.0);
        }
        tag("1", Color32::BLACK, AMBER, ui);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            // Avatar: s3-1 is the HTML user avatar (28px rounded).
            crate::photos::photo_avatar(ui, photos, "s3-1", 28.0);
            hspace(ui, 6.0);
            egui::Frame::new()
                .fill(INDIGO)
                .corner_radius(egui::CornerRadius::same(6))
                .inner_margin(egui::Margin::symmetric(10, 5))
                .show(ui, |ui| {
                    ui.label(RichText::new("New Project").size(12.0).strong().color(Color32::WHITE));
                });
            hspace(ui, 6.0);
            tag("AI Assistant", TEXT, PANEL2, ui);
            hspace(ui, 6.0);
            tag("Search  [Cmd K]", FAINT, PANEL2, ui);
        });
    });
}

// ---------------------------------------------------------------------------
// Side nav
// ---------------------------------------------------------------------------

fn nav_item(ui: &mut Ui, label: &str, count: &str, active: bool) {
    if active {
        egui::Frame::new()
            .fill(PANEL2)
            .stroke(egui::Stroke::new(1.0, LINE))
            .corner_radius(egui::CornerRadius::same(6))
            .inner_margin(egui::Margin::symmetric(8, 5))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    // Active left-border accent (2px cyan bar).
                    let (r, _) =
                        ui.allocate_exact_size(Vec2::new(2.0, 16.0), egui::Sense::hover());
                    ui.painter().rect_filled(r, 1.0, CYAN);
                    ui.label(RichText::new(label).size(12.0).strong().color(CYAN));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        ui.label(mono(count, 10.0, DIM));
                    });
                });
            });
    } else {
        ui.horizontal(|ui| {
            ui.label(RichText::new(label).size(12.0).color(DIM));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(mono(count, 10.0, FAINT));
            });
        });
    }
}

fn storage_meter(ui: &mut Ui, pct: f32, label: &str) {
    frame_raised().show(ui, |ui| {
        ui.vertical(|ui| {
            tiny_dim("STORAGE", ui);
            let (r, _) =
                ui.allocate_exact_size(Vec2::new(ui.available_width(), 6.0), egui::Sense::hover());
            ui.painter().rect_filled(r, 3.0, LINE);
            let fill = egui::Rect::from_min_size(r.min, Vec2::new(r.width() * pct, 6.0));
            ui.painter().rect_filled(fill, 3.0, INDIGO);
            ui.label(mono(label, 10.0, DIM));
        });
    });
}

fn side_nav(ui: &mut Ui) {
    ui.vertical(|ui| {
        ui.set_min_size(Vec2::new(200.0, 640.0));
        ui.set_max_size(Vec2::new(200.0, 640.0));
        // Studio card.
        frame_raised().show(ui, |ui| {
            ui.horizontal(|ui| {
                egui::Frame::new()
                    .fill(INDIGO_DEEP)
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(8, 6))
                    .show(ui, |ui| {
                        ui.label(RichText::new("NO").size(12.0).strong().color(Color32::WHITE));
                    });
                ui.vertical(|ui| {
                    ui.label(RichText::new("Neon Orbit VFX").size(12.0).strong().color(TEXT));
                    tiny_dim("Enterprise Tier", ui);
                });
            });
        });
        ui.add_space(6.0);
        egui::Frame::new()
            .fill(PANEL2)
            .corner_radius(egui::CornerRadius::same(6))
            .inner_margin(egui::Margin::symmetric(12, 6))
            .show(ui, |ui| {
                ui.label(RichText::new("Import Media").size(11.0).color(TEXT));
            });
        ui.add_space(6.0);
        nav_item(ui, "All Projects", "12", true);
        nav_item(ui, "Shared Workspaces", "4", false);
        nav_item(ui, "Cloud Assets", "48", false);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Smart Collections").size(12.0).color(DIM));
            tag("AI", CYAN, PANEL2, ui);
        });
        ui.horizontal(|ui| {
            ui.label(RichText::new("Trash").size(12.0).color(DIM));
        });
        ui.add_space(8.0);
        storage_meter(ui, 0.284, "28.4 GB / 100 GB");
        ui.add_space(4.0);
        tiny_dim("Preferences", ui);
    });
}

// ---------------------------------------------------------------------------
// Hero + AI strip
// ---------------------------------------------------------------------------

fn hero(ui: &mut Ui) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.set_min_size(Vec2::new(420.0, 120.0));
            ui.horizontal(|ui| {
                tag("GPU CLOUD ONLINE", GREEN, PANEL2, ui);
                ui.label(mono("NVENC v4.2 Enabled", 10.0, DIM));
            });
            ui.label(RichText::new("Welcome back, Alex").size(24.0).strong().color(TEXT));
            ui.horizontal(|ui| {
                ui.label(RichText::new("3 active projects").size(12.0).color(DIM));
                hspace(ui, 6.0);
                ui.label(RichText::new("1 render queued").size(12.0).color(AMBER));
            });
        });
        // AI card.
        frame_panel().show(ui, |ui| {
            ui.set_min_size(Vec2::new(320.0, 120.0));
            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new("Intelligent Asset Organization")
                            .size(12.0)
                            .strong()
                            .color(TEXT),
                    );
                });
                ui.horizontal(|ui| {
                    tag("AGENT READY", CYAN, PANEL2, ui);
                    ui.label(mono("~24s run · Deep Vision v3", 10.0, DIM));
                });
                egui::Frame::new()
                    .fill(INDIGO)
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(12, 5))
                    .show(ui, |ui| {
                        ui.label(
                            RichText::new("Run Auto-Tag").size(11.0).strong().color(Color32::WHITE),
                        );
                    });
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Project cards
// ---------------------------------------------------------------------------

fn status_badge(ui: &mut Ui, text: &str, fg: Color32) {
    tag(text, fg, PANEL2, ui);
}

fn progress_bar(ui: &mut Ui, pct: f32) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 5.0), egui::Sense::hover());
    ui.painter().rect_filled(r, 2.0, LINE);
    let fill = egui::Rect::from_min_size(r.min, Vec2::new(r.width() * pct, 5.0));
    ui.painter().rect_filled(fill, 2.0, CYAN);
}

fn project_card(
    ui: &mut Ui,
    photos: &crate::photos::Photos,
    photo_key: &str,
    title: &str,
    spec: &str,
    status: &str,
    status_color: Color32,
    meta: &str,
    detail: &str,
    progress: Option<f32>,
) {
    frame_panel().show(ui, |ui| {
        ui.set_min_size(Vec2::new(220.0, 190.0));
        ui.set_max_size(Vec2::new(220.0, 190.0));
        ui.vertical(|ui| {
            crate::photos::photo_thumb(ui, photos, photo_key, 200.0, 80.0, 4.0);
            ui.horizontal(|ui| {
                tag(spec, DIM, PANEL2, ui);
                status_badge(ui, status, status_color);
            });
            ui.label(RichText::new(title).size(12.0).strong().color(TEXT));
            ui.label(mono(meta, 10.0, DIM));
            tiny_dim(detail, ui);
            if let Some(p) = progress {
                progress_bar(ui, p);
            }
        });
    });
}

fn recent_projects(ui: &mut Ui, photos: &crate::photos::Photos) {
    ui.horizontal(|ui| {
        section_title("Recent Projects", ui);
        hspace(ui, 6.0);
        tag("3 active", CYAN, PANEL2, ui);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            tag("Grid", CYAN, PANEL2, ui);
            tag("List", DIM, PANEL2, ui);
            hspace(ui, 6.0);
            tag("Sort: Last Modified", DIM, PANEL2, ui);
        });
    });
    ui.add_space(4.0);
    egui::Grid::new("projects_grid")
        .spacing(Vec2::new(10.0, 10.0))
        .show(ui, |ui| {
            project_card(
                ui,
                photos,
                "s3-2",
                "Summer Travel Reel 2025",
                "4K DCI · 60fps",
                "Rendering...",
                AMBER,
                "06:45 · Edited 12m ago",
                "12 Video Tracks · 4 Audio stems",
                Some(0.84),
            );
            project_card(
                ui,
                photos,
                "s3-3",
                "SaaS Product Walkthrough",
                "1080p · 30fps",
                "AI Active",
                INDIGO,
                "Stabilizing & Auto-Captions",
                "Frame 420/890",
                None,
            );
            project_card(
                ui,
                photos,
                "s3-4",
                "Cinematic FPV Drone Reel",
                "4K ProRes 422",
                "Ready to review",
                GREEN,
                "04:12 · Edited 2h ago",
                "Open",
                None,
            );
            ui.end_row();
        });
}

// ---------------------------------------------------------------------------
// Template cards
// ---------------------------------------------------------------------------

fn template_card(
    ui: &mut Ui,
    photos: &crate::photos::Photos,
    photo_key: Option<&str>,
    title: &str,
    desc: &str,
    meta: &str,
    aspect: &str,
    w: f32,
    h: f32,
) {
    frame_panel().show(ui, |ui| {
        ui.set_min_size(Vec2::new(170.0, 210.0));
        ui.set_max_size(Vec2::new(170.0, 210.0));
        ui.vertical(|ui| {
            match photo_key {
                // s3-9..s3-11 are the HTML template stills, in order.
                Some(key) => crate::photos::photo_thumb(ui, photos, key, w, h, 4.0),
                // HTML shows no 4th template still; drawn placeholder stays.
                None => thumb(
                    ui,
                    w,
                    h,
                    Color32::from_rgb(0x2a, 0x2a, 0x4a),
                    Color32::from_rgb(0x4a, 0x6a, 0x9a),
                    aspect,
                ),
            }
            ui.label(RichText::new(title).size(12.0).strong().color(TEXT));
            tiny_dim(desc, ui);
            ui.label(mono(meta, 10.0, DIM));
            egui::Frame::new()
                .fill(PANEL2)
                .corner_radius(egui::CornerRadius::same(6))
                .inner_margin(egui::Margin::symmetric(10, 5))
                .show(ui, |ui| {
                    ui.label(RichText::new("Use template").size(11.0).color(TEXT));
                });
        });
    });
}

fn templates(ui: &mut Ui, photos: &crate::photos::Photos) {
    section_title("Quick Start Templates", ui);
    ui.add_space(4.0);
    egui::Grid::new("templates_grid")
        .spacing(Vec2::new(10.0, 10.0))
        .show(ui, |ui| {
            template_card(ui, photos, Some("s3-9"), "Travel Reel", "Vertical cut starter", "8 Cut Points", "9:16", 48.0, 64.0);
            template_card(ui, photos, Some("s3-10"), "Product Demo", "Walkthrough kit", "4 Titles · 60fps", "16:9", 64.0, 48.0);
            template_card(ui, photos, Some("s3-11"), "Social Clip", "Beat-synced edit", "AI Beat Markers", "9:16", 48.0, 64.0);
            template_card(ui, photos, None, "Mini Doc", "Film look pack", "Film Grain + LUT", "2.39:1", 64.0, 40.0);
            ui.end_row();
        });
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

fn filter_chips(ui: &mut Ui) {
    ui.horizontal(|ui| {
        for (t, active) in [
            ("All Media (48)", true),
            ("Video (32)", false),
            ("Audio (10)", false),
            ("Images (4)", false),
            ("Graphics & Titles (2)", false),
        ] {
            if active {
                tag(t, CYAN, PANEL2, ui);
            } else {
                tag(t, DIM, PANEL2, ui);
            }
        }
    });
}

fn asset_card(
    ui: &mut Ui,
    photos: &crate::photos::Photos,
    photo_key: Option<&str>,
    name: &str,
    meta: &str,
    label_tag: &str,
    dur: &str,
    checked: bool,
    audio: bool,
) {
    let mut frame = frame_raised();
    if checked {
        // 2px indigo selected ring approximation.
        frame = frame.stroke(egui::Stroke::new(2.0, INDIGO));
    }
    frame.show(ui, |ui| {
        ui.set_min_size(Vec2::new(150.0, 130.0));
        ui.set_max_size(Vec2::new(150.0, 130.0));
        ui.vertical(|ui| {
            ui.horizontal(|ui| {
                // Checkbox approximation: checked/unchecked glyph chip.
                tag(if checked { "[x]" } else { "[ ]" }, DIM, PANEL2, ui);
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(mono(dur, 9.0, DIM));
                });
            });
            if audio {
                waveform(ui, 130.0, 44.0, CYAN, 3);
            } else if let Some(key) = photo_key {
                // s3-5..s3-8 are the HTML media-library thumbs, in order.
                crate::photos::photo_thumb(ui, photos, key, 130.0, 52.0, 4.0);
            } else {
                thumb(
                    ui,
                    130.0,
                    52.0,
                    Color32::from_rgb(0x2a, 0x3a, 0x4a),
                    Color32::from_rgb(0x5a, 0x7a, 0xaa),
                    dur,
                );
            }
            ui.label(RichText::new(name).size(10.0).color(TEXT));
            ui.horizontal(|ui| {
                ui.label(mono(meta, 9.0, DIM));
            });
            tag(label_tag, INDIGO, PANEL2, ui);
        });
    });
}

fn media_library(ui: &mut Ui, photos: &crate::photos::Photos) {
    ui.horizontal(|ui| {
        section_title("Media Library", ui);
        hspace(ui, 6.0);
        tag("28.4 GB of 100 GB used", DIM, PANEL2, ui);
    });
    ui.add_space(4.0);
    filter_chips(ui);
    ui.add_space(4.0);
    egui::Grid::new("media_grid")
        .spacing(Vec2::new(10.0, 10.0))
        .show(ui, |ui| {
            asset_card(ui, photos, Some("s3-5"), "drone_beach_sunset.mp4", "4K RAW · 1.2GB", "B-roll", "00:42", true, false);
            asset_card(ui, photos, Some("s3-6"), "cliff_jump_fpv.mov", "4K UHD · 840MB", "Action", "00:28", true, false);
            asset_card(ui, photos, Some("s3-7"), "founder_interview.mp4", "4K · 620MB", "Talking Head", "02:10", false, false);
            ui.end_row();
            asset_card(ui, photos, None, "summer_vibes_bgm.wav", "48kHz WAV · 42MB", "Music", "03:10", false, true);
            asset_card(ui, photos, Some("s3-8"), "lower_third_clean.mov", "ProRes 4444 · 18MB", "Titles", "00:12", false, false);
            ui.end_row();
        });
    ui.add_space(6.0);
    // Dropzone: solid-stroke approximation (no dotted border in egui 0.37).
    egui::Frame::new()
        .fill(PANEL)
        .stroke(egui::Stroke::new(1.0, LINE))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(14))
        .show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.label(RichText::new("Drag footage here or browse").size(12.0).color(DIM));
                tiny_dim("MP4 · MOV · WAV · PNG  ·  up to 4K", ui);
            });
        });
}

fn batch_bar(ui: &mut Ui) {
    egui::Frame::new()
        .fill(PANEL2)
        .stroke(egui::Stroke::new(1.0, INDIGO))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::symmetric(12, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                tag("2 assets selected (2.04 GB)", CYAN, PANEL2, ui);
                hspace(ui, 8.0);
                egui::Frame::new()
                    .fill(INDIGO)
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(10, 5))
                    .show(ui, |ui| {
                        ui.label(
                            RichText::new("Add to Sequence").size(11.0).strong().color(Color32::WHITE),
                        );
                    });
                tag("Batch Tag with AI", TEXT, PANEL2, ui);
                tag("Delete", RED, PANEL2, ui);
            });
        });
}

// ---------------------------------------------------------------------------
// Screen entry
// ---------------------------------------------------------------------------

/// Screen 3 entry point: Projects + Media Library Hub.
pub fn show(ui: &mut Ui, photos: &crate::photos::Photos) {
    // Reuse the shared editor topbar idiom for the transport/export cluster,
    // then the screen-3 app bar row below it.
    topbar(ui, "Neon Orbit VFX");
    ui.add_space(4.0);
    app_bar(ui, photos);
    ui.add_space(6.0);
    ui.horizontal_top(|ui| {
        side_nav(ui);
        ui.vertical(|ui| {
            hero(ui);
            ui.add_space(8.0);
            recent_projects(ui, photos);
            ui.add_space(8.0);
            templates(ui, photos);
            ui.add_space(8.0);
            media_library(ui, photos);
        });
    });
    ui.add_space(8.0);
    batch_bar(ui);
}
