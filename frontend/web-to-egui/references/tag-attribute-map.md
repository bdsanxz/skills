# Tag & attribute map: HTML/CSS to egui

Scope: every non-obsolete HTML tag with its attributes and CSS properties,
each with an egui equivalent. Obsolete tags are not mapped (not rendered by
modern browsers, no meaningful equivalent): acronym, applet, basefont, big,
blink, center, content, dir, font, frame, frameset, marquee, menuitem, nobr,
noembed, noframes, param, plaintext, rb, rtc, shadow, strike, tt, xmp.

Reading rule: the egui column is the equivalent to use; the note column is
what does NOT transfer plus the acknowledged deviation. Transcribe every
size verbatim from the design (px = point at 1:1 capture), never derived
from CSS semantics. Numbers in these tables illustrate the pattern, not any
particular project.

## Tags to egui (114 tags, non-obsolete)

### Document & metadata

| Tag | egui | Note |
| --- | --- | --- |
| `html` | root `Ui` | `lang`/i18n: LTR only; RTL not supported |
| `head`, `title`, `base`, `link`, `meta`, `style` | dropped (non-visual) | font `link` → `FontDefinitions`; `style` → theme module |
| `body` | root `Ui` (marginless frame — the default panel has an 8px inset; zero it or every column shifts) | body `margin/padding/bg` = root bg + viewport size |

### Structure

| Tag | egui | Note |
| --- | --- | --- |
| `article`, `section` | vertical band (`Frame` + bg) | one `Frame` per visual band, not per DOM nesting |
| `nav` | horizontal row + underline | — |
| `aside` | pinned column (exact `w-[...]` width) | never a bare `Frame` — it sizes to content |
| `hgroup` | `vertical` title + subtitle | — |
| `header` | exact-h band + 1px border-b | content vertically centered (`Align::Center`) |
| `footer` | leftover spacer + bottom band (justify-between/mt-auto) | compute `total - used - h` |
| `address` | small label, oblique→upright (deviation) | no italic cut |
| `main` | main flexible column/band | — |
| `search` | search-row pattern (input + button) | — |

### Headings

| Tag | egui | Note |
| --- | --- | --- |
| `h1`–`h6` | scaled proportional labels (32/24/20/18/16/14) | no heading margins; bold via `.strong()` when the design is bold |

### Text & grouping

| Tag | egui | Note |
| --- | --- | --- |
| `p` | `label` + `add_space` between paragraphs | — |
| `hr` | full-width 1px rect + border color | — |
| `pre` | monospace label, literal `\n`, inside bg frame | `white-space: pre` = never wrap |
| `blockquote` | left-border band + label | `quotes` ignored |
| `figure` | `vertical` (media + caption) | — |
| `figcaption` | small centered label | — |
| `div` | row/column/rect per context | see flex & position map |
| `br` | `add_space(line_height)` | — |
| `wbr` | nothing (wrap follows width) | — |

### Lists

| Tag | egui | Note |
| --- | --- | --- |
| `ol`, `ul` | `vertical` + manual markers | numbers/`•` as label/painter before content |
| `menu` | horizontal toolbar row | — |
| `li` | row (marker + content) | — |
| `dl` | `vertical` of pairs | — |
| `dt` | `.strong()` label | — |
| `dd` | indented label (+12px) | — |

### Inline text (27 tags)

| Tag | egui | Note |
| --- | --- | --- |
| `a` | clickable label (`Sense::click`) | no navigation; `href/target` = app action |
| `em`, `i`, `cite`, `dfn`, `var` | upright label (deviation: no italic cut) | bundle only upright Inter/InterTight/JetBrains Mono |
| `strong`, `b` | `.strong()` | one bold level |
| `small` | size ×0.85 | — |
| `s`, `del` | label + painter strikethrough | no native strikethrough |
| `u`, `ins` | label + painter underline | `ins` + bg tint |
| `mark` | label + highlight rect | yellow → theme accent color |
| `cite` | see `em` | — |
| `q` | add literal quotation marks | — |
| `abbr` | label + dotted-underline painter | `title` → tooltip |
| `ruby`, `rt` | base label + small label above | no ruby layout |
| `rp` | dropped (non-ruby fallback) | — |
| `data`, `time` | plain label | machine attributes ignored |
| `code`, `samp` | monospace label (+bg frame) | — |
| `kbd` | bordered box + mono label | — |
| `sub`, `sup` | small label with painter baseline offset | no native support; ±3px |
| `span` | label / painter text | — |
| `bdi`, `bdo` | LTR label | RTL not supported (deviation) |

### Edits

| Tag | egui | Note |
| --- | --- | --- |
| `ins` | see inline | — |
| `del` | see inline | — |

### Media (11 tags)

| Tag | egui | Note |
| --- | --- | --- |
| `picture` | texture mesh (`source` picked at build time) | manual selection, not runtime |
| `source` | non-visual (selection only) | — |
| `img` | cover mesh + radius (see `references/web-images.md`) | never `egui::Image` for design photos |
| `iframe`, `embed`, `object` | placeholder rect + label | no embedded web content (deviation) |
| `video` | frame texture + play button | no playback (deviation); or frame strip |
| `audio` | waveform/slider row | no playback (deviation) |
| `track` | ignored | no cues/subtitles |
| `map`, `area` | invisible click zones over the image | `Sense::click` per area |

### Tables (10 tags)

| Tag | egui | Note |
| --- | --- | --- |
| `table` | `egui::Grid` | no spans — merged cells = manual rect (deviation) |
| `caption` | label above grid | `caption-side` bottom = label below |
| `colgroup`, `col` | exact width per column | — |
| `tbody`, `thead`, `tfoot` | row groups (header: bg + bold + border-b) | `border-collapse` = grid spacing |
| `tr` | grid row | — |
| `td`, `th` | cell label (`th` + `.strong()` + bg) | padding via spacing; `scope` ignored |

### Forms (15 tags)

| Tag | egui | Note |
| --- | --- | --- |
| `form` | `vertical` + state struct | validation in code; `action/method` = app logic |
| `label` | 11px caption | `for` = manual link; no automatic focus |
| `input` text/search/password/etc | `TextEdit::singleline` inside themed frame | `placeholder/required/readonly/disabled/min/max/pattern` → params/state |
| `input` checkbox/radio | 14px box + glyph, bool state | `accent-color` drawn manually |
| `input` range | custom slider row (track + fill + knob) | no `Slider` widget |
| `input` color/date/file/etc | text-field + button stand-in | OS pickers out of scope (deviation) |
| `button` | exact rect + label + click | split = two rects; `disabled` = tint |
| `select` | closed combo + `▾` | popup only when the design shows it open |
| `datalist` | ignored (options = hint) | — |
| `optgroup` | custom popup section header | — |
| `option` | popup row + state | `selected` = state |
| `textarea` | `TextEdit::multiline` | `rows/cols/wrap` = rect size |
| `output` | label from state | — |
| `progress`, `meter` | proportional fill bar / segments | `value/min/max` = fraction |
| `fieldset` | bordered group frame | — |
| `legend` | group title | — |
| `selectedcontent` | custom combo value label | — |

### Interactive, script, components

| Tag | egui | Note |
| --- | --- | --- |
| `details` | bool state + header row | content below when open |
| `summary` | header row + `▸/▾` | `cursor:pointer` = click |
| `dialog` | centered modal frame + dim backdrop | `open` = bool |
| `script`, `noscript`, `template` | dropped | static content rendered directly |
| `slot` | child-`Ui` closure parameter | — |
| `canvas` | custom painter surface | procedural drawing goes here |
| `fencedframe` | opaque placeholder rect | (deviation) |

## CSS properties to egui (uncommon first)

| Property | egui |
| --- | --- |
| `display: block/flex/grid/inline/inline-block/contents/none/table/...` | band / row / `Grid` / painter text / exact rect / dropped / `Grid` |
| `flex-direction`, `flex-wrap`, `order`, `flex-grow/shrink/basis`, `flex` | layout direction; wrap/order ignored; `flex-1` = computed leftover px |
| `gap`, `row-gap`, `column-gap`, `space-x/y` | literal `add_space` |
| `justify-content`, `align-items`, `align-self`, `place-*` | leftover spacer / `Align` / `Align2` |
| `width/height`, `min/max-*`, `aspect-ratio`, `box-sizing` | exact `Vec2`; always border-box (rect already includes padding) |
| `margin*`, `padding*` | `add_space` / `Margin` — never drop small gaps like `pt-2` |
| `position: static/relative/absolute/fixed/sticky`, `top/right/bottom/left`, `inset-*` | normal flow / rect + offset / window rect / window rect / top rect; absolute children = painter inside parent rect |
| `z-index` | code order (later = on top) |
| `overflow`, `overflow-x/y`, `overscroll` | `painter_at` clip / `ScrollArea` with hidden bars; absolute paint must add the scrolled content origin (see `references/layout-patterns.md`, absolute painting) |
| `float`, `clear` | reorder manually; no floats |
| `color`, `background-color/image`, `border-color`, `caret-color` | theme tokens; images = assets; caret = default |
| `background: gradient/from/via/to` | solid base + 1–2 overlays; multi-stop = approximation (deviation) |
| `box-shadow`, `text-shadow`, `outline`, `ring` | translucent offset rect / outer stroke; text shadow ignored on dark UI |
| `border*`, `border-radius` (+per-side), `border-collapse`, `border-spacing`, `caption-side` | `rect_stroke` + `CornerRadius` (+per-corner struct); grid spacing; caption top/bottom |
| `font-family/weight/size/style`, `line-height`, `letter-spacing`, `word-spacing` | bundled families / `.strong()` / literal px / upright only / manual rhythm; letter-spacing = glyph-wise tracked text with pair kerning, word-spacing folded into it (see `references/layout-patterns.md`, tracked text) |
| `text-align/decoration/transform/indent`, `white-space`, `vertical-align`, `list-style*`, `quotes`, `tab-size`, `hyphens` | `Align2` / painter rule / literal `uppercase` / first-line offset / wrap-vs-nowrap / row `Align` / manual markers / literal quotes / spaces / no hyphens |
| `direction`, `unicode-bidi`, `writing-mode`, `text-orientation` | LTR only; vertical text = deviation |
| `opacity`, `visibility`, `mix-blend-mode`, `filter`, `backdrop-filter` | tint alpha / skip-vs-image / bake into asset / flat fill |
| `object-fit/position`, `image-rendering` | mesh cover / contain / fill; always LINEAR |
| `transform` (scale/rotate/translate), `transform-origin` | bake the end state into the rect |
| `transition/animation`, `duration/ease/delay`, `animate-*` | rest state; hover/active via `Response`; animation = one frozen frame |
| `cursor`, `pointer-events`, `touch-action` | `Sense` (+automatic hand); touch ignored |
| `accent-color`, `appearance`, `resize`, `caret-color` | custom controls; fixed size |
| `content`, `counter-*`, `quotes` | literal text; manual numbering |
| `clip-path`, `mask` | rect clip only; complex paths = deviation |
| `scroll-behavior/snap/*`, `overscroll-behavior` | no smooth/snap; hidden bars |
| `columns`, `break-*`, `widows/orphans` | single column / no pagination |
| `table-layout`, `caption-side`, `empty-cells` | fixed widths; caption top/bottom; empty cell = empty rect |
| `font-kerning/variant/*`, `font-stretch`, `font-optical-sizing` | default shaping; small-caps → uppercase |
| `forced-color-adjust`, `color-scheme`, `print/*` | ignored (dark mode only) |
| `:hover`, `:active`, `:focus`, `:visited`, `:disabled`, `:checked` | `Response` states (`hovered`, clicked, focused); visited = normal label |
| `::backdrop`, `::cue`, `::placeholder`, `::selection` | dim layer behind modal / ignored / hint color / selection color |
| `background-image` | baked asset (same rule as `img`) |
| `margin: auto` | centering via leftover `add_space` on both sides |

## HTML attributes to egui

| Attribute | egui |
| --- | --- |
| `id` | `Id` key / persistent (`make_persistent_id`, `id_salt`) |
| `class`, `style` | theme tokens + rect (no runtime styling) |
| `title` | `.on_hover_text` |
| `hidden`, `disabled`, `readonly`, `required` | skip render / tint + non-interactive / `TextEdit` flag / code validation |
| `tabindex`, `accesskey` | default focus order; no accesskey |
| `lang`, `dir`, `translate` | LTR only |
| `draggable`, `dropzone` | drag API when needed, none by default |
| `spellcheck`, `contenteditable` | editable `TextEdit` |
| `data-*`, `aria-*`, `role` | app state / tooltip / ignored |
| `value`, `checked`, `selected`, `open` | state variables |
| `datetime` (`time`, `del`, `ins`), `optimum` (`meter`) | state value / target fraction |
| `icon` (`link`), `xmlns` | ignored (non-visual) |
| `placeholder`, `alt`, `abbr-title` | hint/text/tooltip |
| `href`, `hreflang`, `target`, `download`, `action` | app action (no network navigation) |
| `src`, `srcset`, `poster` | baked assets (picked at build time) |
| `type`, `name`, `min/max/step`, `pattern`, `multiple`, `accept`, `rows/cols`, `colspan/rowspan` | widget picker / validation / rect size / manual merged rect |
| `width`, `height`, `size` | exact rect |
| `on*` (all event handlers) | app callbacks on `Response` (`clicked`, `changed`, hover) |
| Global: `autofocus`, `inert`, `popover`, `inputmode`, `enterkeyhint`, `autocapitalize`, `nonce`, `translate` | initial focus / skip subtree / modal frame / keyboard hint only / ignored |
| `form`: `novalidate`, `enctype`, `accept-charset` | code validation / submit encoding / ignored |
| `input`: `autocomplete`, `maxlength`, `autofocus`, `dirname` | hint / length cap / initial focus / ignored |
| `select`/`option`: `multiple`, `size` | multi-select state / visible-row count |
| `ol`: `reversed`, `start`, `type` | manual numbering with offset |
| `table`: `headers`, `scope`, `abbr` | ignored (flat grid, no semantics) |
| `area`: `coords`, `shape` | rect / circle / polygon click zones over the image |
| `img`/`video`: `loading`, `decoding`, `fetchpriority`, `crossorigin`, `referrerpolicy`, `integrity` | ignored — assets are baked at build time |
| `video`/`audio`: `autoplay`, `loop`, `muted`, `playsinline`, `preload`, `controls` | rest-frame policy / loop flag / muted flag / ignored / baked frame / custom controls |
| `track`: `kind`, `srclang`, `label` | ignored (no cues/subtitles) |
| `script`: `async`, `defer`, `nomodule`, `blocking` | load order only — static content renders directly |
| `meta`: `charset`, `http-equiv`, `content` | ignored (non-visual) |
| `iframe`: `sandbox`, `allow`, `loading`, `referrerpolicy` | placeholder rect (no embedded web content) |
| `dialog`: `closedby` | dismiss rule for the modal bool |
| `details`: `open` + `name` | bool state (+exclusive group) |
| `select`: `required` | code validation |
