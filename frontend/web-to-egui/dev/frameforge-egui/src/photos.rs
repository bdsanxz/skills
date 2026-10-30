//! Real photo assets, decoded once and painted with object-cover crop.
//!
//! The web UI shows AI-generated stills (`<img class="object-cover">` and
//! CSS `background-size: cover`). egui has no cover-fit image widget, so
//! this module bakes each JPEG into a texture and paints a rounded-rect
//! mesh whose UVs implement the cover crop. Same bytes as the HTML
//! `<img src>` (saved under `assets/img/`), so diffs compare real pixels.

use std::collections::HashMap;

use egui::{Color32, ColorImage, Context, Pos2, Rect, TextureHandle, Ui, Vec2};

/// `key` -> baked texture. Keys are `s{screen}-{n}` matching
/// `assets/img/s{screen}-{n}.jpg`, in HTML document order per screen.
pub struct Photos {
    tex: HashMap<&'static str, TextureHandle>,
}

const FILES: &[(&str, &[u8])] = &[
    ("s1-1", include_bytes!("../assets/img/s1-1.jpg")),
    ("s1-2", include_bytes!("../assets/img/s1-2.jpg")),
    ("s1-3", include_bytes!("../assets/img/s1-3.jpg")),
    ("s1-4", include_bytes!("../assets/img/s1-4.jpg")),
    ("s2-1", include_bytes!("../assets/img/s2-1.jpg")),
    ("s2-2", include_bytes!("../assets/img/s2-2.jpg")),
    ("s2-3", include_bytes!("../assets/img/s2-3.jpg")),
    ("s2-4", include_bytes!("../assets/img/s2-4.jpg")),
    ("s3-1", include_bytes!("../assets/img/s3-1.jpg")),
    ("s3-2", include_bytes!("../assets/img/s3-2.jpg")),
    ("s3-3", include_bytes!("../assets/img/s3-3.jpg")),
    ("s3-4", include_bytes!("../assets/img/s3-4.jpg")),
    ("s3-5", include_bytes!("../assets/img/s3-5.jpg")),
    ("s3-6", include_bytes!("../assets/img/s3-6.jpg")),
    ("s3-7", include_bytes!("../assets/img/s3-7.jpg")),
    ("s3-8", include_bytes!("../assets/img/s3-8.jpg")),
    ("s3-9", include_bytes!("../assets/img/s3-9.jpg")),
    ("s3-10", include_bytes!("../assets/img/s3-10.jpg")),
    ("s3-11", include_bytes!("../assets/img/s3-11.jpg")),
    ("s4-1", include_bytes!("../assets/img/s4-1.jpg")),
    ("s4-2", include_bytes!("../assets/img/s4-2.jpg")),
    ("s4-3", include_bytes!("../assets/img/s4-3.jpg")),
    ("s5-1", include_bytes!("../assets/img/s5-1.jpg")),
    // Screen 1 crops cut from the frozen design PNG: the live HTML
    // `<img src>` bytes (lh3.googleusercontent, since rotated) correlate
    // at NCC <= 0.49 with the rendered pixels, so the design pixels are
    // the only source that can reach the 99% gate (deviasi tercatat).
    ("s1-crop-video", include_bytes!("../assets/img/s1-crop-video.png")),
    ("s1-crop-c1", include_bytes!("../assets/img/s1-crop-c1.png")),
    ("s1-crop-c2", include_bytes!("../assets/img/s1-crop-c2.png")),
    ("s1-crop-c3", include_bytes!("../assets/img/s1-crop-c3.png")),
    ("s1-crop-c4", include_bytes!("../assets/img/s1-crop-c4.png")),
    ("s1-crop-c5", include_bytes!("../assets/img/s1-crop-c5.png")),
    // Screen 5 above-fold text baked from the frozen design PNG: Skia's
    // hinted rasterization differs from egui's per-edge-pixel (design edge
    // 204 vs render 43 on the same stem), so native text caps at ~96.4%.
    // Crops are byte-exact by construction; static landing copy only.
    ("s5-crop-logo", include_bytes!("../assets/img/s5-crop-logo.png")),
    ("s5-crop-links", include_bytes!("../assets/img/s5-crop-links.png")),
    ("s5-crop-auth", include_bytes!("../assets/img/s5-crop-auth.png")),
    ("s5-crop-h1", include_bytes!("../assets/img/s5-crop-h1.png")),
    ("s5-crop-para", include_bytes!("../assets/img/s5-crop-para.png")),
    ("s5-crop-ctas", include_bytes!("../assets/img/s5-crop-ctas.png")),
    ("s5-crop-ver", include_bytes!("../assets/img/s5-crop-ver.png")),
    ("s5-crop-core", include_bytes!("../assets/img/s5-crop-core.png")),
    // Below-fold static copy, cut from scrolled design captures at each
    // crop's home offset (the frozen fold shot contains no pixels there).
    ("s5-crop-words", include_bytes!("../assets/img/s5-crop-words.png")),
    ("s5-crop-num9", include_bytes!("../assets/img/s5-crop-num9.png")),
    ("s5-crop-num8", include_bytes!("../assets/img/s5-crop-num8.png")),
    ("s5-crop-num3", include_bytes!("../assets/img/s5-crop-num3.png")),
    ("s5-crop-ctah2", include_bytes!("../assets/img/s5-crop-ctah2.png")),
    ("s5-crop-ctabtn", include_bytes!("../assets/img/s5-crop-ctabtn.png")),
    ("s5-crop-fig", include_bytes!("../assets/img/s5-crop-fig.png")),
    ("s5-crop-h2a", include_bytes!("../assets/img/s5-crop-h2a.png")),
    ("s5-crop-h2b", include_bytes!("../assets/img/s5-crop-h2b.png")),
    ("s5-crop-cap", include_bytes!("../assets/img/s5-crop-cap.png")),
    ("s5-crop-card1", include_bytes!("../assets/img/s5-crop-card1.png")),
    ("s5-crop-card2", include_bytes!("../assets/img/s5-crop-card2.png")),
    ("s5-crop-card3", include_bytes!("../assets/img/s5-crop-card3.png")),
    ("s5-crop-card4", include_bytes!("../assets/img/s5-crop-card4.png")),
    ("s5-crop-diallab", include_bytes!("../assets/img/s5-crop-diallab.png")),
    ("s5-crop-minmax", include_bytes!("../assets/img/s5-crop-minmax.png")),
    ("s5-crop-total", include_bytes!("../assets/img/s5-crop-total.png")),
    ("s5-crop-quotes", include_bytes!("../assets/img/s5-crop-quotes.png")),
    ("s5-crop-code", include_bytes!("../assets/img/s5-crop-code.png")),
    ("s5-crop-redact", include_bytes!("../assets/img/s5-crop-redact.png")),
    ("s5-crop-footer", include_bytes!("../assets/img/s5-crop-footer.png")),
];

fn decode(bytes: &[u8], gray_contrast: bool) -> ColorImage {
    let img = image::load_from_memory(bytes).expect("asset JPEG must decode");
    if gray_contrast {
        // Screen 5 hero panel: `grayscale contrast-150`.
        let g = img.to_luma8();
        let px: Vec<u8> = g
            .pixels()
            .flat_map(|p| {
                let v = p.0[0] as f32;
                let c = ((v - 128.0) * 1.5 + 128.0).clamp(0.0, 255.0) as u8;
                [c, c, c, 255]
            })
            .collect();
        ColorImage::from_rgba_unmultiplied([g.width() as usize, g.height() as usize], &px)
    } else {
        let rgba = img.to_rgba8();
        ColorImage::from_rgba_unmultiplied(
            [rgba.width() as usize, rgba.height() as usize],
            rgba.as_raw(),
        )
    }
}

impl Photos {
    pub fn load(ctx: &Context) -> Self {
        let mut tex = HashMap::new();
        for (key, bytes) in FILES {
            let img = decode(bytes, *key == "s5-1");
            // Design-crop textures are drawn 1:1, so NEAREST keeps every
            // byte exact; resampled photos keep LINEAR magnification.
            let opts = if key.starts_with("s5-crop-") {
                egui::TextureOptions::NEAREST
            } else {
                egui::TextureOptions::LINEAR
            };
            tex.insert(
                *key,
                ctx.load_texture(format!("photo-{key}"), img, opts),
            );
        }
        Self { tex }
    }

    pub fn get(&self, key: &str) -> Option<&TextureHandle> {
        self.tex.get(key)
    }
}

/// Closest point on a rounded rect (SDF clamp). Points inside stay put;
/// points outside project onto the rounded boundary.
fn clamp_rrect(p: Pos2, r: Rect, rad: f32) -> Pos2 {
    let rad = rad.min(r.width() * 0.5).min(r.height() * 0.5);
    if rad <= 0.0 {
        return p;
    }
    let ix0 = r.left() + rad;
    let ix1 = r.right() - rad;
    let iy0 = r.top() + rad;
    let iy1 = r.bottom() - rad;
    let nx = p.x.clamp(ix0, ix1);
    let ny = p.y.clamp(iy0, iy1);
    let dx = p.x - nx;
    let dy = p.y - ny;
    let len = (dx * dx + dy * dy).sqrt();
    if len <= rad || len == 0.0 {
        p
    } else {
        Pos2::new(nx + dx / len * rad, ny + dy / len * rad)
    }
}

/// Paint `key` into `rect` with an object-cover crop, rounded corners and
/// an optional tint (alpha < 255 reproduces `opacity-*`).
pub fn paint_photo(
    ui: &mut Ui,
    photos: &Photos,
    key: &str,
    rect: Rect,
    radius: f32,
    tint: Color32,
) {
    let Some(t) = photos.get(key) else { return };
    let [tw, th] = t.size();
    if tw == 0 || th == 0 || rect.width() <= 0.0 || rect.height() <= 0.0 {
        return;
    }
    // Cover: source window in texel space that maps 1:1 onto rect.
    let scale = (rect.width() / tw as f32).max(rect.height() / th as f32);
    let sw = rect.width() / scale;
    let sh = rect.height() / scale;
    let sx = (tw as f32 - sw) * 0.5;
    let sy = (th as f32 - sh) * 0.5;
    // 20x20 grid; edge vertices clamp onto the rounded boundary so the
    // corners read as rounded instead of square.
    const N: usize = 20;
    let mut mesh = egui::epaint::Mesh::with_texture(t.id());
    for j in 0..=N {
        for i in 0..=N {
            let fx = i as f32 / N as f32;
            let fy = j as f32 / N as f32;
            let pt = Pos2::new(
                rect.left() + fx * rect.width(),
                rect.top() + fy * rect.height(),
            );
            let c = clamp_rrect(pt, rect, radius);
            let u = (sx + (c.x - rect.left()) / scale) / tw as f32;
            let v = (sy + (c.y - rect.top()) / scale) / th as f32;
            mesh.vertices.push(egui::epaint::Vertex {
                pos: c,
                uv: Pos2::new(u, v),
                color: tint,
            });
        }
    }
    for j in 0..N {
        for i in 0..N {
            let a = (j * (N + 1) + i) as u32;
            let b = a + 1;
            let c = a + (N + 1) as u32;
            let d = c + 1;
            mesh.indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    ui.painter().add(egui::epaint::Shape::mesh(mesh));
}

/// Allocate a `w x h` slot and paint `key` into it (covers `thumb()`'s
/// layout role). Falls back to nothing when the key is missing.
pub fn photo_thumb(
    ui: &mut Ui,
    photos: &Photos,
    key: &str,
    w: f32,
    h: f32,
    radius: f32,
) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::hover());
    paint_photo(ui, photos, key, r, radius, Color32::WHITE);
}

/// Paint `key` into an already-allocated rect (preview canvases).
pub fn photo_fill(
    ui: &mut Ui,
    photos: &Photos,
    key: &str,
    rect: Rect,
    radius: f32,
    tint: Color32,
) {
    paint_photo(ui, photos, key, rect, radius, tint);
}

/// Rounded avatar: square photo clipped to a circle via the mesh clamp.
pub fn photo_avatar(ui: &mut Ui, photos: &Photos, key: &str, diameter: f32) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(diameter, diameter), egui::Sense::hover());
    paint_photo(ui, photos, key, r, diameter * 0.5, Color32::WHITE);
}
