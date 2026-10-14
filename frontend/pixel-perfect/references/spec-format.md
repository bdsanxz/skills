# Inventory and component spec format

Both files are TOON: `key: value`, two-space indentation for nesting, `name[N]: a,b,c` for lists of plain values, and `name[N]{f1,f2}:` followed by one comma-separated row per item for lists of uniform records. Quote a string only when it contains a comma, a colon, quotes or brackets, or would read as a number or boolean.

All coordinates are image pixels of the named design image. Lengths meant for code are points and say so in their key (`_pt`).

## Run directory layout

Each run has its own directory, named in Phase 0, so several designs can be worked on in one project without their files mixing. `pp check`, `pp compare` and `pp scores` reach it with `--run <name>`.

```
_swe/pixel-perfect/<name>/
  inventory.toon
  report.md
  components/<component>/
    spec.toon
    ref/<variant>.png    the reference crop `pp check` scores against
    iter-01/<variant>/   render.png, capture.toon, diff.toon, diff.json, overview.png, cluster-N.png
    iter-02/<variant>/
  sections/<section>/
    spec.toon            what was measured between its components
    ref/<variant>.png    `default`, or a design image's id when the section appears in more than one
    iter-01/<variant>/   the same files, for the section cut out of its page's screenshot
  pages/<page>/
    iter-01/<image>/     the same files, for the page against one design image
  sheets/iter-NN.png     reference beside render for a round's small items (`check --sheet`)
  shots/                 the screenshots the rounds were scored from
  adhoc/                 one-off measuring scripts
```

`pp check` creates the iteration directories, giving all items of a round the same number, and refuses to overwrite one. A variant named `default` is used when a component has only one. The final round, run with `--images all`, also holds `composite.png` and `heatmap.png`. `pp scores` reads `diff.json` from every iteration to report where each item stands.

## inventory.toon

```
platform: web
stack: React + Tailwind
capture: headless Chromium via the project's Playwright, device scale factor = design scale, full-page shot
thresholds:
  content: 99
  tile_floor: 95
  tolerance: 8
  source: default
soft_sources: user has no lossless export; record ceiling stops as deviations without asking again
images[3]{id,path,kind,page,width_pt,scale,width,height,source_quality}:
  home-desktop,designs/home-1440.png,page,home,1440,1,1440,3200,sharp
  home-mobile,designs/home-375@2x.png,breakpoint,home,375,2,750,5400,sharp
  home-menu-open,designs/home-menu.png,state,home,1440,1,1440,3200,soft
substitutions[1]{id,image,from_x,from_y,from_w,from_h,slot_x,slot_y,slot_w,slot_h,anchor}:
  story-6,home-desktop,120,900,300,420,1320,900,120,420,tl
blanks[1]{asset,x,y,w,h,ui_hex,pixels,share_pct,shape_from}:
  story-1,1210,906,30,29,#ffffff,412,47.4,
fonts[2]{family,weights,source,status}:
  Inter,"400,600",user confirmed,available
  Canela,700,substituted with Playfair Display,deviation
assets[4]{id,kind,source,image,x,y,w,h,file,status}:
  hero-photo,photo,crop,home-desktop,0,96,1440,640,public/img/hero.png,cropped
  story-1,photo,blanked crop,home-desktop,120,900,300,420,public/img/story-1.png,cropped
  logo,logo,user file,home-desktop,48,28,120,40,public/img/logo.svg,supplied
  icon-search,icon,project icon library,home-desktop,1320,36,24,24,,from library
components[4]{name,depends_on,has_text,variants,rendered,status,best_score,iterations}:
  dots,,no,"default,small",harness,passed,99.4,2
  button,,yes,"primary,primary-hover,ghost",harness,passed,99.6,3
  nav-link,,yes,"default,active",harness,in progress,97.2,4
  card,button,yes,"default,with-badge",harness,pending,,0
sections[3]{name,page,components,x,y,w,h,status,best_score,iterations}:
  header,home,"button,nav-link",0,0,1440,96,pending,,0
  hero,home,button,0,96,1440,640,pending,,0
  cards,home,card,0,736,1440,820,pending,,0
pages[1]{name,images,sections,status,best_score,iterations}:
  home,"home-desktop,home-mobile,home-menu-open","header,hero,cards",pending,,0
```

- `platform` is what the UI runs on (`web`, `egui desktop app`, `iOS app`), and `capture` the steps that produce a screenshot meeting the capture contract, written so that a resumed run can repeat them.
- `kind` of an image is `page`, `breakpoint` (another width or window size of a page) or `state`. `width_pt` is the width of its screen or window in points.
- `path` of an image is the file every probe and check uses: the `.subs` copy when Phase 1 made one, otherwise the original. `substitutions` lists every swap in it, images and text alike, as `pp measure substitute` prints them; leave the table out when there are none.
- `blanks` lists the code-built UI removed from blanked crops, as `pp measure crops --blank` prints them; leave the table out when there are none.
- `source_quality` of an image is `source.quality` from `pp measure info`. A `soft` image is one the user has been told about.
- `soft_sources` records what the user decided about images whose source quality is `soft`. Leave it out when every source is sharp.
- A component is one of the smallest reusable entities; a section is a full-width band of a page that arranges components. `x,y,w,h` of a section is its reference rectangle in its page's design image.
- `rendered` says where a component is captured: `preview tool` or `harness`. The list of `--item` arguments for its round, with each wrapper's box, is kept in a file beside the harness, so a resumed run can repeat the round.
- `best_score` and `iterations` are copied from `pp scores`.
- `source` under `thresholds` is `default` or `user`.
- `status` of a component, section or page is `pending`, `in progress`, `passed`, `stopped` (loop ended without a pass, awaiting the user) or `accepted deviation` (the user accepted a score below threshold).
- An asset's `source` is one of `user file`, `project icon library`, `crop`, `blanked crop`, `placeholder`. Every `crop`, `blanked crop` and `placeholder` row carries its rectangle. The asset of an item whose image was substituted carries the substitute's box, the `from_` values of its `substitutions` row.

## components/<component>/spec.toon

```
name: button
purpose: Primary call to action, used in header and cards
props[3]: label,variant,disabled
variants[3]{name,image,x,y,w,h,margin,ref,backdrop,trigger}:
  primary,home-desktop,1240,28,152,40,0,ref/primary.png,#ffffff,
  primary-hover,home-menu-open,1240,28,152,40,0,ref/primary-hover.png,#ffffff,hover
  ghost,home-desktop,1080,28,136,40,0,ref/ghost.png,#ffffff,
box:
  width_pt: content
  height_pt: 40
  padding_pt: 0 20
  radius_pt: 8
  border: none
  background: #1e5ac8
  shadow: none
text:
  content: Get started
  family: Inter
  weight: 600
  size_pt: 14
  line_height_pt: 20
  color: #ffffff
measurements[6]{value,result,probe,confidence}:
  box,"1240,28,152,40",edges --row 48 and --col 1316,measured
  background,#1e5ac8,"color --region 1244,32,144,6",measured
  radius,8,"radius --region 1240,28,152,40",measured
  padding-x,20,"bbox --region 1240,28,152,40 --bg #1e5ac8",measured
  text ascent / x-height,10 / 7,"text --region 1260,36,112,24 --bg #1e5ac8",measured
  font weight,600,compared text width at 500 and 600 on the render,estimated
notes: Label width varies with content, so the width comes from padding, not a fixed value.
```

- `x,y,w,h` is the component's own box in the image. `margin` is how many pixels the reference crop extends beyond that box on every side, so that shadows are inside the crop; the harness wrapper uses the same value, converted to points, as padding.
- `backdrop` is the color behind the component in the design; the harness wrapper uses it as its background.
- `trigger` is how the state is reached at capture time: empty, `hover`, `focus`, or a short description such as `click the menu button`.
- A section's `spec.toon` holds the same `measurements` table for its paddings, gaps and backgrounds, and its rectangle in every further design image it appears in.
- `confidence` is `measured` or `estimated`. Every `estimated` value is the first suspect when a diff fails nearby. A value refined by `pp fit` is `measured`, with `fit` named as its probe.
