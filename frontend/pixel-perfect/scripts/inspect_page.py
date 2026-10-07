"""Read from the browser where it put each element of a rendered component.

Lists the element matched by --selector and its descendants: each one's box
relative to that root, in CSS pixels, and the font of every element that
holds text. Use it to see why a render differs, never to decide what the
design is: design values come from probes on the design image.

With --against-selector (and --against-url when it is on another page) the
same component mounted in two places is compared box by box. A component must
lay out identically alone on its harness and inside its section; when it does
not, one of the two mounts is giving it something the other is not.

Exit status: 0 done (1 when two mounts were compared and differ), 2 error,
3 browser not installed, 4 page not valid.
"""
import argparse
import sys

from capture import BROWSER_MISSING_EXIT, INVALID_EXIT, Browser, BrowserMissing, add_page_arguments, page_arguments
from pp_common import Parser, PPError, emit, num, run_cli

NODES_JS = """
([selector, depth, limit]) => {
  const root = document.querySelector(selector);
  if (!root) return null;
  const origin = root.getBoundingClientRect();
  const out = [];
  const visit = (el, level) => {
    if (out.length >= limit || !el.getClientRects().length) return;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean) : [];
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    out.push({
      el: '  '.repeat(level) + el.tagName.toLowerCase() + classes.map((c) => '.' + c).join(''),
      x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height,
      font_px: hasText ? parseFloat(cs.fontSize) : null,
      line_px: hasText ? (parseFloat(cs.lineHeight) || null) : null,
      weight: hasText ? cs.fontWeight : null,
      family: hasText ? cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() : null,
    });
    if (level < depth) for (const child of el.children) visit(child, level + 1);
  };
  visit(root, 0);
  return out;
}
"""


def tidy(nodes):
    for node in nodes:
        for key in ("x", "y", "w", "h", "font_px", "line_px"):
            if node[key] is not None:
                node[key] = num(node[key], 2)
    return nodes


def differences(first, second, slack=0.25):
    """Box-by-box differences between two mounts of the same component."""
    def shape(nodes):
        # The root may be a different tag in each mount (an li in a list, a div alone); what is inside may not.
        return [len(node["el"]) - len(node["el"].lstrip()) for node in nodes[:1]] + [node["el"].split(".")[0] for node in nodes[1:]]

    if shape(first) != shape(second):
        return None
    rows = []
    for a, b in zip(first, second):
        delta = {key: num(b[key] - a[key], 2) for key in ("x", "y", "w", "h")}
        fonts = [key for key in ("font_px", "line_px", "weight", "family") if a[key] != b[key]]
        if max(abs(value) for value in delta.values()) > slack or fonts:
            rows.append({"el": a["el"].strip(), "dx": delta["x"], "dy": delta["y"], "dw": delta["w"], "dh": delta["h"],
                         "font_differs": ",".join(fonts)})
    return rows


def main():
    parser = Parser(prog="inspect", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_page_arguments(parser)
    parser.add_argument("--selector", required=True, help="the component's root element")
    parser.add_argument("--depth", type=int, default=6, help="how many levels of descendants to list")
    parser.add_argument("--against-selector", help="the same component mounted elsewhere; compare the two box by box")
    parser.add_argument("--against-url", help="page of --against-selector (default: the same page)")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the arguments and report what would run, without starting the browser")
    args = parser.parse_args()

    width, height, actions = page_arguments(args)
    if args.against_url and not args.against_selector:
        raise PPError("--against-url needs --against-selector")
    if args.dry:
        emit({"dry_run": True, "url": args.url, "selector": args.selector,
              "against": args.against_selector, "writes": []}, args.json)
        return 0

    def read(browser, url, selector):
        report = browser.load(url, actions, args.wait_until, args.settle_ms, args.timeout, args.ignore_request, args.retries)
        if not report["valid"]:
            return report, None
        nodes = browser.page.evaluate(NODES_JS, [selector, args.depth, 200])
        if nodes is None:
            raise PPError("no element matches {} on {}".format(selector, url))
        return report, tidy(nodes)

    try:
        with Browser(width, height, args.scale, args.color_scheme) as browser:
            report, nodes = read(browser, args.url, args.selector)
            other = None
            if nodes is not None and args.against_selector:
                report, other = read(browser, args.against_url or args.url, args.against_selector)
    except BrowserMissing:
        print("error: Chromium is not installed", file=sys.stderr)
        return BROWSER_MISSING_EXIT
    if not report["valid"]:
        emit({"valid": False, "problems": report["problems"], "failed_requests": report["failed_requests"]}, args.json)
        return INVALID_EXIT

    if other is None:
        emit({"url": args.url, "selector": args.selector, "units": "css px, relative to the selected element",
              "truncated": len(nodes) >= 200, "nodes": nodes}, args.json)
        return 0
    rows = differences(nodes, other)
    if rows is None:
        emit({"identical": False, "structure_differs": True, "elements": len(nodes), "against_elements": len(other),
              "note": "the two mounts do not hold the same elements, so they are not the same component"}, args.json)
        return 1
    worst = max([max(abs(row[key]) for key in ("dx", "dy", "dw", "dh")) for row in rows] or [0])
    emit({"identical": not rows, "elements": len(nodes), "largest_difference": worst,
          "units": "css px; the --against mount minus the first", "differences": rows}, args.json)
    return 0 if not rows else 1


if __name__ == "__main__":
    run_cli(main)
