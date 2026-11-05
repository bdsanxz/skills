# Writing `exec` code for the Figma Plugin API

`figma-access exec` runs your code as the body of an `async` function in the Desktop Bridge plugin's sandbox. The `figma` global is the full Figma Plugin API (https://developers.figma.com/docs/plugins/api/api-reference/). This page lists what trips agents up and the recipes that cover most work.

## The contract

- `return` the value you want back. Without `return` the result is `undefined` and the `warning` under `resultAnalysis` says so.
- Return plain JSON: ids, names, numbers, arrays of small objects. Never return a node; map it to `{ id, name, type }`.
- Use `await` freely. The default time limit is 5 s; pass `--timeout 30s` (up to `300s`) for big loops, font loading or whole-file scans.
- Each run is isolated: variables do not survive between runs. Pass state forward through ids you returned.
- `console.log` output is kept by the daemon; read it with `figma-access logs --since 1m`.

## Rules the API enforces

- **Dynamic page access.** Use the async getters: `await figma.getNodeByIdAsync(id)`, `await figma.getStyleByIdAsync(id)`, `await figma.variables.getLocalVariablesAsync()`, `await figma.variables.getVariableByIdAsync(id)`, `await figma.getLocalPaintStylesAsync()`. The sync forms throw. Before you walk another page, `await page.loadAsync()`; `await figma.loadAllPagesAsync()` before `figma.root.findAll...`.
- **Fonts before text.** Before you set `characters`, `fontSize`, `fontName` or any text property, `await figma.loadFontAsync(font)` for every font in the node:
  ```js
  const t = await figma.getNodeByIdAsync(id);
  const fonts = t.characters.length ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
  for (const f of fonts) await figma.loadFontAsync(f);
  t.characters = "New label";
  ```
  For a new text node, load the font first, then `figma.createText()`, set `fontName`, then `characters`. `Inter` Regular, Medium, Semi Bold and Bold are always available.
- **Paints are immutable.** Copy, change, assign: `const fills = JSON.parse(JSON.stringify(node.fills)); fills[0].color = { r: 1, g: 0, b: 0 }; node.fills = fills;`. Colors are 0..1, not 0..255. `figma.util.solidPaint("#FF5733")` and `figma.util.rgb("#FF5733")` convert hex.
- **Auto layout sizing.** `layoutSizingHorizontal/Vertical = "FILL" | "HUG"` only work once the node is a child of an auto-layout frame: `parent.appendChild(child)` first, then set sizing. Set `layoutMode` on the frame before padding, spacing and alignment.
- **Instances.** Text inside an instance is controlled by component properties. Read `instance.componentProperties` (keys may end in `#123:45`) and change them with `instance.setProperties({ "Label#123:45": "Buy" })`, or `figma-access call SET_INSTANCE_PROPERTIES`. Editing the inner text node directly fails silently or is reset.
- **Variables bind through helpers.** Fills and strokes: `figma.variables.setBoundVariableForPaint(paint, "color", variable)` returns a new paint to assign. Number fields: `node.setBoundVariable("paddingLeft", variable)`. Values per mode: `variable.setValueForMode(modeId, value)`.
- **`figma.mixed`.** Properties such as `fontSize`, `cornerRadius` or `fills` on text ranges may be the `figma.mixed` symbol; check before you use them, and never return it.
- **Selection and viewport.** `figma.currentPage.selection = [node]` selects; `figma.viewport.scrollAndZoomIntoView([node])` shows the result to the user.

## Placement and housekeeping

- Place new work in clear space, never on top of existing content: screenshot the page, or list the top-level frames with their bounds, first.
- Put new work inside a named Section or Frame, not loose on the canvas: `const s = figma.createSection(); s.name = "Buttons"; s.x = x; s.y = y;`.
- Partial work from a failed step (empty frames, helper layers, blank pages) goes with `node.remove()`.
- Backgrounds behind content: `parent.insertChild(0, bg)`.

## Recipes

Page outline (top level only, cheap):
```js
return figma.currentPage.children.map(n => ({ id: n.id, name: n.name, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height }));
```

Find nodes by name across the current page:
```js
const hits = figma.currentPage.findAll(n => n.name.toLowerCase().includes("button"));
return hits.slice(0, 50).map(n => ({ id: n.id, name: n.name, type: n.type }));
```

Inspect one node in depth (style, layout, bound variables):
```js
const n = await figma.getNodeByIdAsync("12:34");
return {
  id: n.id, name: n.name, type: n.type, w: n.width, h: n.height,
  fills: n.fills, strokes: n.strokes, cornerRadius: n.cornerRadius === figma.mixed ? "mixed" : n.cornerRadius,
  layout: "layoutMode" in n ? { mode: n.layoutMode, gap: n.itemSpacing, pad: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] } : null,
  boundVariables: n.boundVariables,
  children: "children" in n ? n.children.map(c => ({ id: c.id, name: c.name, type: c.type })) : [],
};
```

Create an auto-layout button component:
```js
await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
const c = figma.createComponent();
c.name = "Button/Primary";
c.layoutMode = "HORIZONTAL";
c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "AUTO";
c.paddingLeft = c.paddingRight = 16; c.paddingTop = c.paddingBottom = 10;
c.cornerRadius = 8;
c.fills = [figma.util.solidPaint("#2563EB")];
const label = figma.createText();
label.fontName = { family: "Inter", style: "Semi Bold" };
label.characters = "Button";
label.fills = [figma.util.solidPaint("#FFFFFF")];
c.appendChild(label);
c.addComponentProperty("Label", "TEXT", "Button");
return { id: c.id };
```

List variables with their values per mode:
```js
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const out = [];
for (const col of cols) {
  for (const id of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    out.push({ collection: col.name, name: v.name, type: v.resolvedType, values: Object.fromEntries(col.modes.map(m => [m.name, v.valuesByMode[m.modeId]])) });
  }
}
return out;
```

Create a color variable and bind it to a fill:
```js
const col = figma.variables.createVariableCollection("Tokens");
const v = figma.variables.createVariable("color/brand", col, "COLOR");
v.setValueForMode(col.modes[0].modeId, figma.util.rgba("#2563EB"));
const node = await figma.getNodeByIdAsync("12:34");
node.fills = [figma.variables.setBoundVariableForPaint(figma.util.solidPaint("#000000"), "color", v)];
return { collectionId: col.id, variableId: v.id };
```

Export a node's SVG markup as text:
```js
const n = await figma.getNodeByIdAsync("12:34");
return await n.exportAsync({ format: "SVG_STRING" });
```

## When `call` is better than `exec`

`figma-access call` runs a ready-made routine of the plugin. Prefer it for the jobs that are long to write by hand:

- `GET_COMPONENT`, `DEEP_GET_COMPONENT`, `ANALYZE_COMPONENT_SET`: a component's full structure, tokens and variant matrix.
- `CREATE_COMPONENT_SET`: combine components into a variant set and lay it out.
- `LINT_DESIGN`, `AUDIT_COMPONENT_ACCESSIBILITY`: design and accessibility findings for a node.
- `SET_IMAGE_FILL`: put a base64 image into one or more nodes.
- `GET_ANNOTATIONS`, `SET_ANNOTATIONS`: Dev Mode annotations.
- FigJam (`CREATE_STICKIES`, `CREATE_CONNECTOR`, `GET_BOARD_CONTENTS`, ...) and Slides (`LIST_SLIDES`, `ADD_TEXT_TO_SLIDE`, ...) helpers.

`figma-access methods` lists every method with its params.
