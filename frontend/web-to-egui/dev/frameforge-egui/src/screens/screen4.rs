//! Screen 4: Export & Render modal over a dimmed editor backdrop.
//!
//! Bottom-up composition: tokens come from `theme`, shared widgets from
//! `widgets`. Each component is a `fn(ui: &mut Ui)` (state passed by
//! `&mut` where the HTML control is interactive); sections compose them
//! and `show` is the screen entry point.

use crate::theme::*;
use crate::widgets::*;
use egui::{Align, Color32, Layout, RichText, Ui, Vec2};

pub const FORMATS: [&str; 4] = ["MP4", "QuickTime", "WebM", "ProRes"];
pub const CODECS: [&str; 4] = ["H.265", "H.264", "AV1", "ProRes"];
pub const RESOLUTIONS: [&str; 4] = ["3840x2160 4K", "2560x1440 2K", "1920x1080 FHD", "1080x1920 Vertical"];
pub const FRAMERATES: [&str; 5] = ["60", "59.94", "30", "24", "23.976"];

#[derive(Debug, Clone)]
pub struct Screen4State {
    pub selected_preset: usize,
    pub format: String,
    pub codec: String,
    pub resolution: String,
    pub framerate: String,
    pub bitrate: f32,
    pub audio_on: bool,
    pub ai_on: bool,
    pub deblur: bool,
    pub denoise: bool,
    pub upscale: bool,
    pub open_folder: bool,
}

impl Default for Screen4State {
    fn default() -> Self {
        Self {
            selected_preset: 0,
            format: FORMATS[0].into(),
            codec: CODECS[0].into(),
            resolution: RESOLUTIONS[0].into(),
            framerate: FRAMERATES[0].into(),
            bitrate: 45.0,
            audio_on: true,
            ai_on: true,
            deblur: true,
            denoise: true,
            upscale: true,
            open_folder: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

fn toggle(ui: &mut Ui, on: &mut bool) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(36.0, 20.0), egui::Sense::hover());
    let resp = ui.interact(r, ui.make_persistent_id("tgl"), egui::Sense::click());
    if resp.clicked() {
        *on = !*on;
    }
    let bg = if *on { INDIGO } else { LINE };
    ui.painter()
        .rect_filled(r, egui::CornerRadius::same(10), bg);
    let kx = if *on { r.right() - 9.0 } else { r.left() + 9.0 };
    ui.painter()
        .circle_filled(egui::Pos2::new(kx, r.center().y), 7.0, Color32::WHITE);
}

fn select_row(ui: &mut Ui, label: &str, value: &mut String, options: &[&str]) {
    ui.horizontal(|ui| {
        tiny_dim(label, ui);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            egui::ComboBox::from_label("")
                .selected_text(value.as_str())
                .show_ui(ui, |ui| {
                    for o in options {
                        ui.selectable_value(value, o.to_string(), *o);
                    }
                });
        });
    });
}

fn preset_card(ui: &mut Ui, idx: usize, sel: &mut usize, name: &str, desc: &str, chips: &[&str]) {
    let selected = *sel == idx;
    let resp = if selected {
        egui::Frame::new()
            .fill(PANEL2)
            .stroke(egui::Stroke::new(2.0, INDIGO))
            .corner_radius(egui::CornerRadius::same(6))
            .inner_margin(egui::Margin::same(8))
            .show(ui, |ui| {
                ui.set_min_width(252.0);
                preset_body(ui, name, desc, chips, true);
            })
            .response
    } else {
        frame_raised()
            .show(ui, |ui| {
                ui.set_min_width(252.0);
                preset_body(ui, name, desc, chips, false);
            })
            .response
    };
    if ui
        .interact(resp.rect, ui.make_persistent_id(("preset", idx)), egui::Sense::click())
        .clicked()
    {
        *sel = idx;
    }
}

fn preset_body(ui: &mut Ui, name: &str, desc: &str, chips: &[&str], selected: bool) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(name).size(12.0).strong().color(TEXT));
        if selected {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                tag("Selected", Color32::WHITE, INDIGO, ui);
            });
        }
    });
    tiny_dim(desc, ui);
    ui.horizontal(|ui| {
        for c in chips {
            tag(c, DIM, BG, ui);
        }
    });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

fn header(ui: &mut Ui) {
    frame_panel()
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                egui::Frame::new()
                    .fill(INDIGO_DEEP)
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(8, 6))
                    .show(ui, |ui| {
                        ui.label(RichText::new("Up").size(12.0).strong().color(Color32::WHITE));
                    });
                ui.vertical(|ui| {
                    ui.label(RichText::new("Export Video").size(18.0).strong().color(TEXT));
                    tiny_dim("FrameForge AI render pipeline", ui);
                });
                hspace(ui, 8.0);
                tag("AI upscaled 4K", Color32::WHITE, INDIGO_DEEP, ui);
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let _ = ui.button("X");
                });
            });
        });
}

fn presets(ui: &mut Ui, s: &mut Screen4State) {
    ui.horizontal(|ui| {
        top_button("Presets", true, ui);
        hspace(ui, 6.0);
        top_button("Custom", false, ui);
    });
    ui.add_space(6.0);
    preset_card(ui, 0, &mut s.selected_preset, "YouTube 4K", "Best for video essays & travel films", &["3840x2160", "60fps", "H.265", "MP4"]);
    ui.add_space(4.0);
    preset_card(ui, 1, &mut s.selected_preset, "Instagram Reel", "Vertical 9:16, captions burned in", &["1080x1920", "30fps", "H.264"]);
    ui.add_space(4.0);
    preset_card(ui, 2, &mut s.selected_preset, "Twitter / X 1080p", "Compact landscape for the timeline", &["1920x1080", "30fps", "H.264"]);
    ui.add_space(4.0);
    preset_card(ui, 3, &mut s.selected_preset, "ProRes Master HQ", "Archival mezzanine, large files", &["3840x2160", "23.976", "ProRes"]);
    ui.add_space(4.0);
    preset_card(ui, 4, &mut s.selected_preset, "Custom preset ...", "Tune every knob and save it", &["custom"]);
}

fn destination(ui: &mut Ui) {
    ui.add_space(6.0);
    section_title("DESTINATION", ui);
    frame_raised().show(ui, |ui| {
        ui.horizontal(|ui| {
            tag("folder", CYAN, PANEL2, ui);
            ui.label(mono("~/Movies/Exports/FrameForge/", 10.0, TEXT));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let _ = ui.button("Browse");
            });
        });
    });
}

fn settings(ui: &mut Ui, s: &mut Screen4State) {
    section_title("FORMAT & CODEC", ui);
    select_row(ui, "Format", &mut s.format, &FORMATS);
    select_row(ui, "Codec", &mut s.codec, &CODECS);
    select_row(ui, "Resolution", &mut s.resolution, &RESOLUTIONS);
    select_row(ui, "Frame rate", &mut s.framerate, &FRAMERATES);
    ui.add_space(6.0);
    section_title("BITRATE", ui);
    ui.horizontal(|ui| {
        tiny_dim("Quality", ui);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(RichText::new(format!("{:.0} Mbps", s.bitrate)).size(12.0).strong().color(CYAN));
        });
    });
    ui.add(egui::Slider::new(&mut s.bitrate, 10.0..=100.0).show_value(false));
    ui.horizontal(|ui| {
        tiny_dim("10 Draft", ui);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            tiny_dim("Lossless 100", ui);
        });
    });
    ui.add_space(6.0);
    section_title("AUDIO", ui);
    frame_raised().show(ui, |ui| {
        ui.horizontal(|ui| {
            tag("eq", CYAN, PANEL2, ui);
            ui.label(RichText::new("AAC 320kbps / 48kHz").size(11.0).color(TEXT));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                toggle(ui, &mut s.audio_on);
            });
        });
    });
    ui.add_space(6.0);
    egui::Frame::new()
        .fill(PANEL2)
        .stroke(egui::Stroke::new(1.0, INDIGO))
        .corner_radius(egui::CornerRadius::same(6))
        .inner_margin(egui::Margin::same(8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("AI Enhancer").size(12.0).strong().color(TEXT));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    toggle(ui, &mut s.ai_on);
                });
            });
            ui.label(mono("ENABLED", 10.0, CYAN));
            ui.add(egui::Checkbox::new(&mut s.deblur, "De-blur shaky segments"));
            ui.add(egui::Checkbox::new(&mut s.denoise, "Noise reduction"));
            ui.add(egui::Checkbox::new(&mut s.upscale, "4K upscale"));
        });
}

/// Media pool (2-col thumb grid) + program preview, as in the HTML:
/// a `Media Pool` grid of small stills beside a `FIT 54% • REC709` monitor.
fn media_pool_preview(ui: &mut Ui, photos: &crate::photos::Photos) {
    ui.add_space(6.0);
    ui.horizontal_top(|ui| {
        ui.vertical(|ui| {
            ui.set_min_size(Vec2::new(300.0, 0.0));
            ui.set_max_width(300.0);
            section_title("PREVIEW", ui);
            ui.horizontal(|ui| {
                tag("FIT 54% • REC709", DIM, PANEL2, ui);
            });
            ui.add_space(2.0);
            let w = ui.available_width();
            let h = (w * 9.0 / 16.0).clamp(120.0, 190.0);
            let (r, _) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::hover());
            // s4-3 is the HTML export preview (`opacity-85`).
            crate::photos::photo_fill(
                ui,
                photos,
                "s4-3",
                r,
                6.0,
                Color32::from_rgba_unmultiplied(255, 255, 255, 217),
            );
        });
        hspace(ui, 12.0);
        ui.vertical(|ui| {
            section_title("MEDIA POOL", ui);
            ui.add_space(2.0);
            egui::Grid::new("s4_pool")
                .num_columns(2)
                .spacing(Vec2::new(8.0, 8.0))
                .show(ui, |ui| {
                    for key in ["s4-1", "s4-2"] {
                        frame_raised().show(ui, |ui| {
                            crate::photos::photo_thumb(ui, photos, key, 120.0, 44.0, 4.0);
                            ui.add_space(2.0);
                            tiny_dim("pool still", ui);
                        });
                    }
                    ui.end_row();
                });
        });
    });
}

fn queue(ui: &mut Ui) {
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        section_title("RENDER QUEUE", ui);
        hspace(ui, 6.0);
        tag("1 active, 1 queued", TEXT, PANEL2, ui);
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            let _ = ui.button("Cancel All");
        });
    });
    frame_raised().show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label(mono("Summer_Travel_Reel_4K.mp4", 11.0, TEXT));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                tag("Rendering", Color32::WHITE, INDIGO_DEEP, ui);
            });
        });
        ui.horizontal(|ui| {
            tiny_dim("64%  ·  ETA 2m14s", ui);
        });
        ui.add(egui::ProgressBar::new(0.64).text("64%").show_percentage());
    });
    ui.add_space(4.0);
    frame_raised().show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label(mono("BTS_trip_rough_cut.mp4", 11.0, TEXT));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                tag("Queued", Color32::BLACK, AMBER, ui);
            });
        });
        ui.add(egui::ProgressBar::new(0.0).text("0%"));
    });
}

fn footer(ui: &mut Ui, s: &mut Screen4State) {
    ui.add_space(6.0);
    frame_panel().show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label(mono("Est. 1.24 GB", 11.0, CYAN));
            hspace(ui, 10.0);
            ui.label(mono("00:04:12:08", 11.0, DIM));
        });
        ui.add(egui::Checkbox::new(&mut s.open_folder, "Open destination folder when done"));
        ui.horizontal(|ui| {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                egui::Frame::new()
                    .fill(INDIGO)
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(16, 6))
                    .show(ui, |ui| {
                        ui.label(RichText::new("Start Render").size(12.0).strong().color(Color32::WHITE));
                    });
                hspace(ui, 8.0);
                let _ = ui.button("Cancel");
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Screen entry
// ---------------------------------------------------------------------------

pub fn show(ui: &mut Ui, s: &mut Screen4State, photos: &crate::photos::Photos) {
    let bg = ui.available_rect_before_wrap();
    ui.painter().rect_filled(bg, egui::CornerRadius::same(0), BG);
    ui.vertical_centered(|ui| {
        egui::Frame::new()
            .fill(RAISED)
            .stroke(egui::Stroke::new(1.0, LINE))
            .corner_radius(egui::CornerRadius::same(8))
            .inner_margin(egui::Margin::same(12))
            .show(ui, |ui| {
                ui.set_max_width(775.0);
                header(ui);
                ui.add_space(8.0);
                ui.horizontal_top(|ui| {
                    ui.allocate_ui_with_layout(
                        Vec2::new(292.0, 0.0),
                        Layout::top_down(Align::LEFT),
                        |ui| {
                            presets(ui, s);
                            destination(ui);
                        },
                    );
                    hspace(ui, 12.0);
                    ui.allocate_ui_with_layout(
                        Vec2::new(ui.available_width(), 0.0),
                        Layout::top_down(Align::LEFT),
                        |ui| {
                            settings(ui, s);
                        },
                    );
                });
                media_pool_preview(ui, photos);
                queue(ui);
                footer(ui, s);
            });
    });
}
