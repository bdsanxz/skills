import { EXIT_OK, LOG_BUFFER, LOG_FILE, PLUGIN_DIR, VERSION } from "./config";

const COMMON_HELP = `Common options:
  --file <key|name>   Target this connected file (fileKey, exact name, or part of the name).
                      Default: the file the user touched last.
  --wait <duration>   How long to wait for the plugin to connect (default 12s, 20s on a cold start).
  -h, --help          Show help for the command.`;

export const HELP: Record<string, string> = {
  main: `figma-access ${VERSION} - read Figma files through the REST API, and change them in Figma Desktop through the
Desktop Bridge plugin.

Usage: bun figma-access.js <command> [options]   (runs on Bun, not Node)

Setup and connection
  setup                 Install the Desktop Bridge plugin files and print the one-time import steps.
  status                Daemon state and every connected file (key, name, page, selection, editor).
  files                 Connected files only (waits for the plugin).
  daemon <start|stop|restart|status|log>
                        Manage the background daemon (other commands start it on demand).

Work in a file
  exec [code]           Run JavaScript with the Figma Plugin API in the file and print what it returns.
  screenshot [nodeId]   Export a node (default: the current page) to an image file.
  selection             The current selection, read live.
  logs                  Console output captured from the plugin sandbox.
  changes               Document changes the plugin observed since it connected.
  call <METHOD> [json]  Send any Desktop Bridge method with JSON params.
  methods [filter]      List every method \`call\` accepts with its params.

Read a file through the Figma REST API (no Figma Desktop or plugin needed; token in
FIGMA_TOKEN_KEY, FIGMA_ACCESS_TOKEN or FIGMA_TOKEN)
  file <url|key>        File name, pages and top-level frames with their boxes.
  node <url|key> [ids]  Full node data (exact styles, layout, text) to a .kdl file, plus an outline.
  spec <url|key> [ids]  Compact CSS-ready outline of the visible tree, one line per node.
  render <url|key> [ids]
                        Render nodes to PNG, JPG, SVG or PDF files.
  image-fills <url|key> Download the original images used as fills, named by imageRef.
  api <path>            Any GET endpoint, e.g. /v1/files/<key>/styles.

Check an implementation (needs Chrome, Chromium or Edge)
  compare <ref.png> <page>
                        Capture a page and measure it against a render, per section.

Exit codes: 0 ok, 1 Figma reported a failure, 2 bad arguments, 3 daemon, plugin or token not available.
Output is KDL on stdout (https://kdl.dev), and the data files the CLI saves (node, api -o) are
KDL: one node per line, an object's plain fields as key=value on its line, nested objects and
arrays as indented blocks, array items as nodes named "-". Exceptions: \`spec\` prints its own
one-line-per-node text outline (with -o it writes that text and prints a KDL summary),
\`daemon log\` prints the daemon's log lines as they are, and render, screenshot and image-fills
save image files and print a KDL summary of them, as does compare. Every command has --help.`,

  setup: `Usage: figma-access setup

Copies the Desktop Bridge plugin (manifest.json, code.js, ui.html, icon.png) to ${PLUGIN_DIR}
and prints the steps to import it in Figma Desktop once. Run it again after the skill is updated,
then re-import the manifest in Figma so it loads the new files.`,

  status: `Usage: figma-access status

Starts the daemon if needed, then prints its port and pid and every connected file. Does not wait for the plugin.`,

  files: `Usage: figma-access files [--wait <duration>]

Prints the connected files, waiting for the plugin if none is connected yet.`,

  daemon: `Usage: figma-access daemon <start|stop|restart|status|log>

  start     Start the daemon in the background (no-op when it already runs).
  stop      Stop it. Open plugins go back to searching for a server.
  restart   Stop, then start.
  status    Print pid, port and whether it answers.
  log       Print the last 60 lines of ${LOG_FILE}.`,

  exec: `Usage: figma-access exec [code] [-f file.js] [--timeout <duration>] [--file <key|name>]

Runs the code as the body of an async function inside the plugin sandbox, with the
\`figma\` global (Figma Plugin API). Use \`await\`, and \`return\` the value you want back;
it must be JSON-serializable (return ids and plain objects, not nodes).
Code comes from the argument, from -f <file>, or from stdin when the argument is "-" or absent.

  -f, --code-file <path>   Read the code from this file.
  -t, --timeout <duration> Plugin-side time limit (default 5s, max 300s), e.g. 30s.

Prints ok, result, resultAnalysis and fileContext. resultAnalysis's warning flags empty or null
results, which often mean the code found nothing.

${COMMON_HELP}`,

  screenshot: `Usage: figma-access screenshot [nodeId] [-o out.png] [--scale n] [--format PNG|JPG|SVG|PDF]

Exports the node (default: the current page) through the plugin and writes it to a file.
The longest side is capped at 1568 px (the plugin lowers the scale), which is what vision models read.

  -o, --out <path>     Output file (default: _swe/figma-access/screenshots/<node>-<time>.<ext>
                       under the current directory).
  --scale <n>          Export scale (default 1).
  --format <fmt>       PNG (default), JPG, SVG or PDF.

Prints the file path, the node, its bounds and the scale actually used.

${COMMON_HELP}`,

  selection: `Usage: figma-access selection

Reads the current page's selection live: id, name, type, position, size and parent of each node.

${COMMON_HELP}`,

  logs: `Usage: figma-access logs [--since <dur|ISO>] [--level log,info,warn,error,debug] [--limit n] [--clear] [--follow]

Console output from the plugin sandbox, including every console.log your exec code writes.
The daemon keeps the last ${LOG_BUFFER} entries per file while it runs.

  --since <dur|ISO>  Only entries newer than this (30s, 5m, 2h or an ISO time).
  --level <list>     Only these levels, comma-separated.
  --limit <n>        At most n entries, the newest (default 100).
  --clear            Empty the buffer after reading.
  --follow           Keep printing new entries, one "- ..." node each, until interrupted.

${COMMON_HELP}`,

  changes: `Usage: figma-access changes [--since <dur|ISO>] [--clear]

Document and metadata changes the plugin observed (changed node ids, style changes), newest last.
Shows what changed in the file, for example what the user edited by hand.

${COMMON_HELP}`,

  call: `Usage: figma-access call <METHOD> [params-json | -] [-p file.json] [--timeout <duration>]

Sends one Desktop Bridge method with JSON params and prints its result.
Params come from the argument, from -p <file>, or from stdin when the argument is "-".
Run \`figma-access methods\` for the list of methods and params.

  -p, --params-file <path>  Read params from this JSON file.
  -t, --timeout <duration>  Override the method's default time limit.

${COMMON_HELP}`,

  file: `Usage: figma-access file <url|fileKey> [--depth n]

Prints the file's name, version and pages, and the nodes under each page down to --depth
(default 2: pages and their top-level frames), each with its box [x, y, width, height].`,

  node: `Usage: figma-access node <url|fileKey> [nodeId ...] [--depth n] [--geometry] [--keep-hidden] [--outline n] [-o file.kdl]

Fetches the full data of the nodes (the node-id in the URL, or the ids given) and writes it to a file:
fills, strokes, effects, corner radii, auto layout, constraints, text with its style overrides.
Hidden layers (visible: false) and everything under them are removed from the file, because
design files often keep most of their nodes hidden, some on top of visible content.
Prints the file path, a report per node (font families and text styles, image fill refs,
visible node types, how many hidden nodes were pruned) and an outline down to --outline levels
(default 2). On a page it lists the page's frames instead, so you can pick the design frame.

  --depth <n>      Limit how deep the data goes (default: the whole subtree).
  --geometry       Include vector paths (fillGeometry, strokeGeometry).
  --keep-hidden    Keep hidden layers in the file (they are still counted in the report).
  --refresh        Fetch again instead of using the local cache (use after the design changed).
  -o, --out <path> Output file (default: _swe/figma-access/<fileKey>/nodes/<ids>.kdl).`,

  spec: `Usage: figma-access spec <url|fileKey> [nodeId ...] [--depth n] [--origin x,y] [--from file] [--refresh] [-o file.txt]

Prints the visible tree under each node, one line per node, with what code needs:
type, name, id, box [x,y wxh] relative to the node (or to --origin), render[x,y wxh] when the
area visible on the canvas differs (shadows grow it, masks and clipping parents shrink it),
opacity, blend, clip,
component id, text with font family weight size/line-height, letter spacing, alignment and case
(valign center|bottom when a fixed-height box is taller than its lines),
fills as CSS colors or gradients, top layer first as in a CSS background list (image fills as
image(<imageRef>, <scaleMode>)), borders,
radii, shadows and blurs, and auto layout as flex direction, gap, padding, justify and align.
Text with mixed styles lists its runs: runs[ "13 ": base | "GB": font ... ].
Hidden layers are skipped. A subtree made only of vectors is one line marked
"ICON → render as svg", and a node holding a mask is one line marked "MASKED → render as
svg or png": export those with \`render\` instead of rebuilding them; export[x,y wxh] then
gives the area the exported file covers, where it differs from the box (clipping by parents
does not shrink an export, so place the file there and clip it in code).
An auto layout frame whose stored boxes break its own gap, padding, hug or fill rules is marked
"LAYOUT DRIFT": its boxes, or a child's, are stale (often a hidden child still counted), so lay it out
from its direction, gap, padding and sizing, not its boxes, and check it against the render.

  --depth <n>       Stop after n levels (default: all).
  --origin <x,y>    Measure boxes from this canvas point instead of the node's corner,
                    e.g. the page frame's corner, to get page coordinates for every section.
  --from <file>     Read a .kdl file saved by \`node\` (holding the node or an ancestor), or any
                    .json of the same shape, instead of calling the API.
  --refresh         Fetch again instead of using the local cache.
  -o, --out <path>  Write to a file instead of stdout.

File and node reads are cached under ~/.figma-access/cache, since the API rate-limits them;
pass --refresh after the design changed.`,

  render: `Usage: figma-access render <url|fileKey> [nodeId ...] [--scale n] [--format png|jpg|svg|pdf] [-o dir]

Renders each node through Figma's own renderer and downloads the files. Exact for comparisons;
SVG keeps text as text and node ids as element ids. Prints each PNG's width and height, with a
note when a side is over 2000 px (read such an image in parts).

  --scale <n>      0.01 to 4 (default 1).
  --format <fmt>   png (default), jpg, svg or pdf.
  -o, --out <dir>  Output directory (default: _swe/figma-access/<fileKey>/renders/).`,

  "image-fills": `Usage: figma-access image-fills <url|fileKey> [-o dir]

Downloads every image used as an image fill in the file, at its original resolution, named
<imageRef>.<ext>. That includes images used only by hidden layers; the image(<imageRef>, ...)
entries in \`spec\` name the ones the visible design uses.

  -o, --out <dir>  Output directory (default: _swe/figma-access/<fileKey>/image-fills/).`,

  compare: `Usage: figma-access compare <reference.png> <page.html|url|capture.png> [--sections spec] [--band n]
                          [--nodes file.kdl [--node id]] [--crop x,y,w,h] [--width n] [--shift n]
                          [--threshold n] [--wide n] [--wait ms] [-o dir]

Captures the page in headless Chrome at the reference's size (set CHROME_PATH to choose the browser),
then prints, for the whole page and each section, the share of differing pixels (a channel off by
more than --threshold, default 24) and the mean channel difference (0-255; use it for gradients
and tints, which a threshold misses). For each section it also tries the capture shifted up to
--shift pixels (default 3) each way: when a shift explains the difference, the section is right
and something before it has the wrong size. Writes the capture and diff.png (the reference faded,
differing pixels red) to the output directory; open diff.png to see where the pixels differ.

  <reference.png>       The design render, e.g. from \`render\` at scale 1.
  <page>                An HTML file or URL to capture, or a PNG you captured yourself.
  --sections <spec>     Named areas in page pixels, separated by ";": name=x,y,w,h, or
                        name=top-bottom for a full-width band ("nav=0-48;cards=399,289,602,496").
                        Default: full-width bands of --band pixels (default 100).
  --nodes <file.kdl>     The node file of the rendered node (from \`node ... -o\`): also measure each
                        text, icon and image of the design on both images. Prints, per text style,
                        how far its copies sit off (dy, dx) and how wide they are against the design
                        (widthRatio), then the nodes that are off by half a pixel or more, or missing.
                        Positive dx and dy: the page draws it further right or lower. On a busy
                        background (a photo) a node is matched as a whole: whole-pixel dx and dy,
                        no widthRatio.
  --node <id>           The rendered node inside that file, when it is not the file's first node.
  --crop x,y,w,h        Use only this part of the reference, e.g. to leave out browser chrome.
  --width <px>          The page width in CSS pixels when the reference is not at scale 1
                        (a 2880 px wide render of a 1440 frame: --width 1440).
  --wide <px>           Also capture at this wider window and report whether the content stays
                        centred or sticks to the left.
  --wait <ms>           Time the page gets to load fonts and images (default 8000).
  -o, --out <dir>       Output directory (default: _swe/figma-access/compare/).`,

  api: `Usage: figma-access api <path> [-o file.kdl]

GETs any Figma REST endpoint and prints the response as KDL, or writes it to the file.
Examples: /v1/me, /v1/files/<key>/styles, /v1/files/<key>/variables/local, /v1/files/<key>/comments.`,

  methods: `Usage: figma-access methods [filter]

Lists every method \`call\` accepts with its params. An optional filter keeps names containing it.`,
};

export function showHelp(name: string): never {
  process.stdout.write((HELP[name] ?? HELP.main) + "\n");
  process.exit(EXIT_OK);
}
