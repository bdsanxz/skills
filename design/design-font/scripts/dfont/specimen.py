"""An HTML specimen beside the built web fonts."""
import html
import os

from .compile import ps_safe
from .proof import TEXT

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{family} specimen</title>
<style>
{faces}
:root {{ --ink: #161616; --paper: #fbfaf7; --muted: #6b6b70; --rule: #dedbd3; }}
@media (prefers-color-scheme: dark) {{ :root {{ --ink: #f1efe9; --paper: #151515; --muted: #9a9aa0; --rule: #333; }} }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }}
.specimen {{ max-width: 1100px; margin: 0 auto; padding: 32px 16px 80px; }}
.specimen__title {{ font-family: "{family} VF", "{family}"; font-size: clamp(48px, 10vw, 120px); line-height: 1; margin: 0 0 8px; }}
.specimen__meta {{ color: var(--muted); margin: 0 0 32px; }}
.specimen__section {{ border-top: 1px solid var(--rule); padding: 24px 0; }}
.specimen__label {{ color: var(--muted); font-size: 13px; margin: 0 0 12px; }}
.specimen__control {{ display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }}
.specimen__slider {{ width: min(420px, 100%); }}
.specimen__sample {{ font-family: "{family} VF", "{family}"; font-size: 64px; line-height: 1.1; margin: 0; overflow-wrap: anywhere; }}
.specimen__style {{ margin: 0 0 8px; font-size: 40px; line-height: 1.15; overflow-wrap: anywhere; }}
.specimen__style-name {{ color: var(--muted); font: 13px system-ui, sans-serif; display: block; }}
.specimen__text {{ font-family: "{family} VF", "{family}"; max-width: 68ch; margin: 0 0 16px; }}
.specimen__text--small {{ font-size: 15px; line-height: 1.5; }}
.specimen__text--medium {{ font-size: 21px; line-height: 1.45; }}
.specimen__grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px; }}
.specimen__glyph {{ font-family: "{family} VF", "{family}"; font-size: 36px; text-align: center; padding: 10px 0; border: 1px solid var(--rule); border-radius: 4px; }}
.specimen__waterfall-line {{ font-family: "{family} VF", "{family}"; margin: 0 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
</style>
</head>
<body>
<main class="specimen">
<h1 class="specimen__title">{family}</h1>
<p class="specimen__meta">Version {version} · {styles}</p>
{variable_section}
<section class="specimen__section">
<p class="specimen__label">Styles</p>
{style_lines}
</section>
<section class="specimen__section">
<p class="specimen__label">Text</p>
{text_blocks}
</section>
<section class="specimen__section">
<p class="specimen__label">Waterfall</p>
{waterfall}
</section>
<section class="specimen__section">
<p class="specimen__label">Characters</p>
<div class="specimen__grid">{grid}</div>
</section>
</main>
{script}
</body>
</html>
"""


def write_specimen(project, build, out_dir, files):
    fam = ps_safe(project.family)
    faces = []
    styles = []
    for inst in project.instances:
        name = "{}-{}.woff2".format(fam, ps_safe(inst["name"]))
        if os.path.exists(os.path.join(out_dir, "webfonts", name)):
            w = int(round(inst["location"].get("wght", 400)))
            faces.append("@font-face {{ font-family: \"{}\"; src: url(\"webfonts/{}\") format(\"woff2\"); "
                         "font-weight: {}; }}".format(project.family, name, w))
            styles.append((inst["name"], w))
    vf = [f for f in files if f.endswith(".woff2") and "/variable/" in f.replace("\\", "/")]
    variable_section = ""
    script = ""
    if vf and project.axes:
        a = project.axes[0]
        rel = "variable/" + os.path.basename(vf[0])
        faces.append("@font-face {{ font-family: \"{} VF\"; src: url(\"{}\") format(\"woff2\"); "
                     "font-weight: {} {}; }}".format(project.family, rel, int(a["min"]), int(a["max"])))
        variable_section = (
            "<section class=\"specimen__section\">"
            "<div class=\"specimen__control\"><label class=\"specimen__label\" for=\"axis\">{name} "
            "<output id=\"axis-value\">{df}</output></label>"
            "<input class=\"specimen__slider\" id=\"axis\" type=\"range\" min=\"{lo}\" max=\"{hi}\" value=\"{df}\">"
            "</div><p class=\"specimen__sample\" id=\"sample\" contenteditable=\"true\" "
            "style=\"font-variation-settings: '{tag}' {df}\">Hamburgefontsiv 0123</p></section>"
        ).format(name=html.escape(a["name"]), lo=int(a["min"]), hi=int(a["max"]), df=int(a["default"]), tag=a["tag"])
        script = ("<script>const s=document.getElementById('axis'),o=document.getElementById('axis-value'),"
                  "t=document.getElementById('sample');s.addEventListener('input',()=>{o.textContent=s.value;"
                  "t.style.fontVariationSettings=\"'" + a["tag"] + "' \"+s.value;});</script>")
    style_lines = "\n".join(
        "<p class=\"specimen__style\" style=\"font-family: '{f}'; font-weight: {w}\">"
        "<span class=\"specimen__style-name\">{n} · {w}</span>Sphinx of black quartz, judge my vow</p>".format(
            f=html.escape(project.family), w=w, n=html.escape(n)) for n, w in styles)
    text_blocks = "\n".join(
        "<p class=\"specimen__text specimen__text--{}\">{}</p>".format(size, html.escape(t))
        for size in ("medium", "small") for t in TEXT[:2])
    waterfall = "\n".join(
        "<p class=\"specimen__waterfall-line\" style=\"font-size: {0}px\">{0}px — The quick brown fox jumps over "
        "the lazy dog</p>".format(px) for px in (12, 14, 16, 20, 24, 32, 48, 72))
    chars = []
    for name in build.order:
        for u in build.glyphs[name].unicodes[:1]:
            if u > 0x20 and not 0x300 <= u < 0x370:
                chars.append("<div class=\"specimen__glyph\" title=\"{}\">{}</div>".format(
                    html.escape(name), html.escape(chr(u))))
    page = TEMPLATE.format(family=html.escape(project.family), version=html.escape(project.version),
                           styles=html.escape(", ".join(n for n, _ in styles) or "no static styles"),
                           faces="\n".join(faces), variable_section=variable_section, style_lines=style_lines,
                           text_blocks=text_blocks, waterfall=waterfall, grid="".join(chars), script=script)
    path = os.path.join(out_dir, "specimen.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)
    return path
