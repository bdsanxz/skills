mod photos;
mod screens;
mod theme;
mod widgets;

// TEMPORARY capture harness for the 5-screen run. Reverted after capture.
// Env: FF_SCREEN=1..5 selects one screen (0 = all stacked), FF_OUT=png path.
struct App {
    s1: screens::screen1::Screen1State,
    s4: screens::screen4::Screen4State,
    photos: photos::Photos,
    frames: u64,
}

fn interactive() -> bool {
    std::env::var("FF_INTERACTIVE").ok().as_deref() == Some("1")
}

fn which_screen() -> i32 {
    let parsed = std::env::var("FF_SCREEN")
        .ok()
        .and_then(|v| v.parse().ok());
    match parsed {
        Some(n) => n,
        None if interactive() => 2,
        None => 0,
    }
}

fn out_path() -> String {
    std::env::var("FF_OUT").unwrap_or_else(|_| "/tmp/ff-shot.png".to_string())
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        ui.ctx().set_pixels_per_point(1.0);
        self.frames += 1;
        let n = self.frames;
        let screen = which_screen();
        let out = out_path();
        egui::CentralPanel::default()
            .frame(egui::Frame {
                inner_margin: egui::Margin::same(0),
                outer_margin: egui::Margin::same(0),
                ..Default::default()
            })
            .show(ui, |ui| {
            let mut area = egui::ScrollArea::vertical().scroll_bar_visibility(
                if interactive() {
                    egui::scroll_area::ScrollBarVisibility::VisibleWhenNeeded
                } else {
                    egui::scroll_area::ScrollBarVisibility::AlwaysHidden
                },
            );
            // Capture-only test hook: pin the scroll offset for scrolled
            // screenshots. Never active in interactive mode — a forced
            // offset overrides user scrolling every frame.
            if !interactive() {
                if let Some(f) = std::env::var("FF_SCROLL")
                    .ok()
                    .and_then(|v| v.parse::<f32>().ok())
                {
                    area = area.vertical_scroll_offset(f);
                }
            }
            area
                .show(ui, |ui| {
                match screen {
                    1 => screens::screen1::show(ui, &mut self.s1, &self.photos),
                    2 => screens::screen2::show(ui, &self.photos),
                    3 => screens::screen3::show(ui, &self.photos),
                    4 => screens::screen4::show(ui, &mut self.s4, &self.photos),
                    5 => screens::screen5::show(ui, &self.photos),
                    _ => {
                        screens::screen1::show(ui, &mut self.s1, &self.photos);
                        ui.add_space(16.0);
                        screens::screen5::show(ui, &self.photos);
                        ui.add_space(16.0);
                        screens::screen4::show(ui, &mut self.s4, &self.photos);
                    }
                }
            });
        });
        if !interactive() && n == 30 {
            let out2 = out.clone();
            ui.ctx().request_screenshot(
                move |img: std::sync::Arc<egui::ColorImage>| {
                    let w = img.size[0] as u32;
                    let h = img.size[1] as u32;
                    let mut buf = Vec::with_capacity((w * h * 4) as usize);
                    for p in &img.pixels {
                        buf.extend_from_slice(&[p.r(), p.g(), p.b(), p.a()]);
                    }
                    if let Some(raw) = image::RgbaImage::from_raw(w, h, buf) {
                        let _ = raw.save(&out2);
                    }
                },
            );
        }
        if !interactive() {
            // Capture mode: repaint every frame so hidden windows finish in
            // seconds instead of waiting on event-driven repaints.
            ui.ctx().request_repaint();
        }
        if !interactive() && n > 30 {
            if std::path::Path::new(&out).exists() {
                std::process::exit(0);
            }
        }
        if !interactive() && n > 900 {
            eprintln!("CAPTURE TIMEOUT after 900 frames");
            std::process::exit(2);
        }
    }
}

fn main() -> eframe::Result<()> {
    if !interactive() {
        // Fresh capture only: a stale file would pass the exit check
        // before the new screenshot lands.
        let _ = std::fs::remove_file(out_path());
    }
    let hidden = std::env::var("FF_HIDDEN").ok().as_deref() != Some("0");
    let view = interactive() || !hidden;
    // Capture-size override for proof shots at other widths (the design
    // viewport stays the scoring contract; wider shots exercise fit-width).
    let w: f32 = std::env::var("FF_W").ok().and_then(|v| v.parse().ok()).unwrap_or(1440.0);
    let h: f32 = std::env::var("FF_H").ok().and_then(|v| v.parse().ok()).unwrap_or(900.0);
    let mut vp = egui::ViewportBuilder::default()
        .with_inner_size([w, h])
        .with_decorations(interactive())
        .with_visible(view);
    if interactive() {
        // Second 1920-wide display sits right of the main one.
        vp = vp.with_position([1940.0, 30.0]);
    }
    let options = eframe::NativeOptions {
        viewport: vp,
        ..Default::default()
    };
    eframe::run_native(
        "FrameForge",
        options,
        Box::new(|cc| {
            cc.egui_ctx.set_fonts(theme::fonts());
            Ok(Box::new(App {
                s1: screens::screen1::Screen1State::default(),
                s4: screens::screen4::Screen4State::default(),
                photos: photos::Photos::load(&cc.egui_ctx),
                frames: 0,
            }))
        }),
    )
}
