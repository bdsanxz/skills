use egui::{Color32, FontData, FontDefinitions, FontFamily, Margin, CornerRadius, Stroke, Vec2};

pub const BG: Color32 = Color32::from_rgb(0x13, 0x13, 0x1b);
pub const PANEL: Color32 = Color32::from_rgb(0x1a, 0x1d, 0x24);
pub const PANEL2: Color32 = Color32::from_rgb(0x25, 0x29, 0x33);
pub const RAISED: Color32 = Color32::from_rgb(0x2f, 0x34, 0x40);
pub const LINE: Color32 = Color32::from_rgb(0x2f, 0x34, 0x40);
pub const TEXT: Color32 = Color32::from_rgb(0xe6, 0xe8, 0xee);
pub const DIM: Color32 = Color32::from_rgb(0xa1, 0xa7, 0xb3);
pub const FAINT: Color32 = Color32::from_rgb(0x68, 0x68, 0x74);
pub const CYAN: Color32 = Color32::from_rgb(0x22, 0xd3, 0xee);
pub const INDIGO: Color32 = Color32::from_rgb(0x63, 0x66, 0xf1);
pub const INDIGO_DEEP: Color32 = Color32::from_rgb(0x4f, 0x46, 0xe5);
pub const GREEN: Color32 = Color32::from_rgb(0x10, 0xb9, 0x81);
pub const AMBER: Color32 = Color32::from_rgb(0xf5, 0x9e, 0x0b);
pub const RED: Color32 = Color32::from_rgb(0xef, 0x44, 0x44);
pub const RED_DEEP: Color32 = Color32::from_rgb(0xc4, 0x0f, 0x0f);
pub const VIOLET: Color32 = Color32::from_rgb(0x8b, 0x5c, 0xf6);
pub const ORANGE: Color32 = Color32::from_rgb(0xf5, 0x7c, 0x0b);
pub const OBSIDIAN: Color32 = Color32::from_rgb(0x0f, 0x11, 0x15);
pub const S5_HAZARD: Color32 = Color32::from_rgb(0xe6, 0x19, 0x19);

pub fn fonts() -> FontDefinitions {
    let mut f = FontDefinitions::default();
    f.font_data.insert(
        "Inter".into(),
        FontData::from_static(include_bytes!("../assets/fonts/Inter-Regular.ttf")).into(),
    );
    f.font_data.insert(
        "Inter-SemiBold".into(),
        FontData::from_static(include_bytes!("../assets/fonts/Inter-SemiBold.ttf")).into(),
    );
    f.font_data.insert(
        "Inter-ExtraBold".into(),
        FontData::from_static(include_bytes!("../assets/fonts/Inter-ExtraBold.ttf")).into(),
    );
    f.font_data.insert(
        "InterTight-Bold".into(),
        FontData::from_static(include_bytes!("../assets/fonts/InterTight-Bold.ttf")).into(),
    );
    f.font_data.insert(
        "InterTight-Black".into(),
        FontData::from_static(include_bytes!("../assets/fonts/InterTight-Black.ttf")).into(),
    );
    f.font_data.insert(
        "JetBrainsMono".into(),
        FontData::from_static(include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf")).into(),
    );
    f.font_data.insert(
        "JetBrainsMono-SemiBold".into(),
        FontData::from_static(include_bytes!("../assets/fonts/JetBrainsMono-SemiBold.ttf")).into(),
    );
    f.font_data.insert(
        "MaterialIcons".into(),
        FontData::from_static(include_bytes!("../assets/fonts/MaterialIcons-Regular.ttf")).into(),
    );
    f.font_data.insert(
        "Outfit".into(),
        FontData::from_static(include_bytes!("../assets/fonts/Outfit-Regular.ttf")).into(),
    );
    f.font_data.insert(
        "Outfit-Bold".into(),
        FontData::from_static(include_bytes!("../assets/fonts/Outfit-Bold.ttf")).into(),
    );
    f.font_data.insert(
        "Outfit-ExtraBold".into(),
        FontData::from_static(include_bytes!("../assets/fonts/Outfit-ExtraBold.ttf")).into(),
    );
    f.families.insert(
        FontFamily::Proportional,
        vec!["Inter".into(), "Inter-SemiBold".into()],
    );
    f.families.insert(
        FontFamily::Monospace,
        vec!["JetBrainsMono".into(), "JetBrainsMono-SemiBold".into()],
    );
    f.families.insert(
        FontFamily::Name("tight-bold".into()),
        vec!["InterTight-Bold".into()],
    );
    f.families.insert(
        FontFamily::Name("tight-black".into()),
        vec!["InterTight-Black".into()],
    );
    f.families.insert(
        FontFamily::Name("inter-xbold".into()),
        vec!["Inter-ExtraBold".into(), "Inter".into()],
    );
    f.families.insert(
        FontFamily::Name("inter-semibold".into()),
        vec!["Inter-SemiBold".into(), "Inter".into()],
    );
    f.families.insert(
        FontFamily::Name("jb-semibold".into()),
        vec!["JetBrainsMono-SemiBold".into(), "JetBrainsMono".into()],
    );
    f.families.insert(
        FontFamily::Name("symbols".into()),
        vec!["MaterialIcons".into()],
    );
    f.families.insert(
        FontFamily::Name("outfit".into()),
        vec!["Outfit".into()],
    );
    f.families.insert(
        FontFamily::Name("outfit-bold".into()),
        vec!["Outfit-Bold".into(), "Outfit".into()],
    );
    f.families.insert(
        FontFamily::Name("outfit-xbold".into()),
        vec!["Outfit-ExtraBold".into(), "Outfit".into()],
    );
    f
}

pub fn frame_panel() -> egui::Frame {
    egui::Frame::new()
        .fill(PANEL)
        .stroke(Stroke::new(1.0, LINE))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::same(10))
}

pub fn frame_raised() -> egui::Frame {
    egui::Frame::new()
        .fill(RAISED)
        .stroke(Stroke::new(1.0, LINE))
        .corner_radius(CornerRadius::same(6))
        .inner_margin(Margin::same(8))
}

pub fn tag(text: &str, fg: Color32, bg: Color32, ui: &mut egui::Ui) {
    egui::Frame::new()
        .fill(bg)
        .corner_radius(CornerRadius::same(4))
        .inner_margin(Margin {
            left: 6,
            right: 6,
            top: 2,
            bottom: 2,
        })
        .show(ui, |ui| {
            ui.label(egui::RichText::new(text).size(10.0).color(fg));
        });
}

pub fn section_title(text: &str, ui: &mut egui::Ui) {
    ui.label(
        egui::RichText::new(text)
            .size(11.0)
            .strong()
            .color(Color32::from_rgb(0xc9, 0xc9, 0xd2)),
    );
}

pub fn tiny_dim(text: &str, ui: &mut egui::Ui) {
    ui.label(egui::RichText::new(text).size(10.0).color(DIM));
}

pub fn mono(text: &str, size: f32, color: Color32) -> egui::RichText {
    egui::RichText::new(text)
        .family(FontFamily::Monospace)
        .size(size)
        .color(color)
}

pub fn hspace(ui: &mut egui::Ui, w: f32) {
    ui.add_space(w);
    let _ = Vec2::ZERO;
}

// --- Screen-1 spec tokens (exact web hex from the tailwind inventory) ---
// Existing GREEN/RED/ORANGE consts are kept untouched for current users;
// these add the exact spec values screen 1 needs.
pub const EMERALD_SYNC: Color32 = Color32::from_rgb(0x10, 0xb9, 0x81);
pub const RUBY: Color32 = Color32::from_rgb(0xef, 0x44, 0x44);
pub const PEWTER: Color32 = Color32::from_rgb(0xa1, 0xa7, 0xb3);
pub const PLATINUM: Color32 = Color32::from_rgb(0xe6, 0xe8, 0xee);
pub const TERTIARY: Color32 = Color32::from_rgb(0xff, 0xb7, 0x83);
pub const CANVAS: Color32 = Color32::from_rgb(0x0b, 0x0c, 0x10);
pub const RAIL: Color32 = Color32::from_rgb(0x25, 0x29, 0x33);
pub const GUNMETAL: Color32 = Color32::from_rgb(0x2f, 0x34, 0x40);
pub const WAVE_BG_GREEN: Color32 = Color32::from_rgb(0x0a, 0x2a, 0x1a);
pub const WAVE_BG_CYAN: Color32 = Color32::from_rgb(0x0a, 0x2a, 0x2e);
pub const CLIP_AMBER_BG: Color32 = Color32::from_rgb(0x6a, 0x3a, 0x0a);
pub const CLIP_INDIGO_BG: Color32 = Color32::from_rgb(0x2a, 0x2a, 0x5a);
