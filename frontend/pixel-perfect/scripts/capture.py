"""Take a deterministic screenshot of a web page or of one element.

The viewport is in CSS pixels; --scale is the device scale factor, so the
saved image is viewport x scale pixels and lines up with a design image of the
same density. Animations, transitions and the text caret are frozen, and the
shot waits for web fonts and images.

A capture is valid evidence only when every request and font loaded and the
browser honored the viewport. An invalid capture is still saved, but it is
reported with `valid: false` and exit status 4, and must not be diffed.

Exit status: 0 saved and valid, 2 error, 3 browser not installed, 4 saved but
not valid.
"""
import argparse
import io
import os
import sys

from PIL import Image

from pp_common import Parser, PPError, emit, num, parse_ints, run_cli

BROWSER_MISSING_EXIT = 3
INVALID_EXIT = 4
ACTIONS = ("hover", "focus", "click", "press", "wait", "wait-ms", "scroll")

FREEZE_CSS = """
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
"""

ASSETS_READY_JS = """
async () => {
  await document.fonts.ready;
  await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => {})));
  return Array.from(document.fonts, (f) => ({
    family: f.family.replace(/^["']|["']$/g, ""), weight: f.weight, style: f.style, status: f.status,
  }));
}
"""

IMAGES_JS = """
() => Array.from(document.images)
  .filter((img) => img.naturalWidth && img.getClientRects().length && !/\\.svg(\\?|$)|^data:image\\/svg/.test(img.currentSrc))
  .map((img) => { const r = img.getBoundingClientRect(); return {
    src: img.currentSrc.split('/').pop().split('?')[0], x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height,
    fw: img.naturalWidth, fh: img.naturalHeight,
  }; })
"""

BOX_JS = (
    "(el) => { const r = el.getBoundingClientRect();"
    " return {x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height}; }"
)


class BrowserMissing(Exception):
    """Chromium is not in the shared Playwright cache."""


def parse_action(text):
    kind, _, value = text.partition(":")
    if kind not in ACTIONS or not value:
        raise PPError("action must look like kind:value with kind in {}; got '{}'".format(", ".join(ACTIONS), text))
    return kind, value


def perform(page, kind, value, timeout):
    if kind == "hover":
        page.locator(value).first.hover(timeout=timeout)
    elif kind == "focus":
        page.locator(value).first.focus(timeout=timeout)
    elif kind == "click":
        page.locator(value).first.click(timeout=timeout)
    elif kind == "scroll":
        page.locator(value).first.scroll_into_view_if_needed(timeout=timeout)
    elif kind == "press":
        page.keyboard.press(value)
    elif kind == "wait":
        page.locator(value).first.wait_for(state="visible", timeout=timeout)
    else:
        page.wait_for_timeout(int(value))


def crop_box(full, box, scale):
    """Cut a CSS-pixel box out of a full-page shot, on device pixels."""
    edges = [box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"]]
    return full.crop(tuple(int(round(edge * scale)) for edge in edges))


def images_not_one_to_one(images, scale):
    """Raster images the browser has to resample at this scale.

    An image is drawn exactly when its box, in device pixels, is its file's
    pixel size and sits on whole device pixels. Anything else is resampled,
    and every one of its pixels then differs a little from the file.
    """
    found = []
    for image in images:
        drawn = (image["w"] * scale, image["h"] * scale)
        problems = []
        if abs(drawn[0] - image["fw"]) > 0.01 or abs(drawn[1] - image["fh"]) > 0.01:
            problems.append("drawn {:g}x{:g} px from a {}x{} px file".format(drawn[0], drawn[1], image["fw"], image["fh"]))
        if any(abs(image[key] * scale - round(image[key] * scale)) > 0.01 for key in ("x", "y")):
            problems.append("starts off the pixel grid at {:g},{:g}".format(image["x"] * scale, image["y"] * scale))
        if problems:
            found.append({"src": image["src"], "problem": "; ".join(problems)})
    return found


def fractional(box, scale):
    """Whether a CSS-pixel box misses whole device pixels at this scale."""
    return any(abs(box[key] * scale - round(box[key] * scale)) > 0.01 for key in ("x", "y", "width", "height"))


class Browser:
    """One Chromium window at a fixed viewport and device scale factor."""

    def __init__(self, width, height, scale, color_scheme="light"):
        self.width, self.height, self.scale = width, height, scale
        self.color_scheme = color_scheme
        self.console_errors, self.failed_requests = [], []

    def __enter__(self):
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright

        self.error = PlaywrightError
        self.playwright = sync_playwright().start()
        try:
            # The scale factor is set on the browser, not emulated per page.
            # Emulation snaps layout to whole CSS pixels, so a half-pixel size
            # at scale 2 would be resampled instead of landing on device pixels.
            self.browser = self.playwright.chromium.launch(
                args=[
                    "--force-device-scale-factor={:g}".format(self.scale),
                    "--window-size={},{}".format(self.width, self.height),
                    "--hide-scrollbars",
                    "--force-color-profile=srgb",
                    "--disable-lcd-text",
                    "--font-render-hinting=none",
                ]
            )
        except PlaywrightError as error:
            self.playwright.stop()
            if "Executable doesn't exist" in str(error):
                raise BrowserMissing()
            raise PPError("could not start Chromium: {}".format(error))
        context = self.browser.new_context(no_viewport=True, color_scheme=self.color_scheme, reduced_motion="reduce")
        self.page = context.new_page()
        self.page.on("console", lambda message: self.console_errors.append(message.text) if message.type == "error" else None)
        self.page.on("pageerror", lambda error: self.console_errors.append(str(error)))
        self.page.on("requestfailed", lambda request: self.failed_requests.append(request.url))
        self.page.on("response", lambda response: self.failed_requests.append(response.url) if response.status >= 400 else None)
        return self

    def __exit__(self, *_):
        self.browser.close()
        self.playwright.stop()

    def load(self, url, actions=(), wait_until="load", settle_ms=100, timeout=30000, ignore=(), retries=1):
        """Open the URL, run the actions, wait for fonts and images.

        A load with failed requests is tried again up to `retries` times, since
        a busy local server can drop one. Returns the report that decides
        whether shots of this page are valid evidence.
        """
        attempts = 0
        while True:
            attempts += 1
            del self.console_errors[:], self.failed_requests[:]
            try:
                self.page.goto(url, wait_until=wait_until, timeout=timeout)
                self.page.add_style_tag(content=FREEZE_CSS)
                for kind, value in actions:
                    perform(self.page, kind, value, timeout)
                fonts = self.page.evaluate(ASSETS_READY_JS)
                images = self.page.evaluate(IMAGES_JS)
                actual = self.page.evaluate("({width: innerWidth, height: innerHeight, scale: devicePixelRatio})")
                self.page.wait_for_timeout(settle_ms)
            except self.error as error:
                raise PPError("capture failed: {}".format(str(error).splitlines()[0]))
            failed = [u for u in dict.fromkeys(self.failed_requests) if not any(part in u for part in ignore)]
            if not failed or attempts > retries:
                break
        fonts_failed = sorted(set(f["family"] for f in fonts if f["status"] == "error"))
        problems = []
        if failed:
            problems.append("{} request(s) failed, so the page is missing content".format(len(failed)))
        if fonts_failed:
            problems.append("font(s) failed to load: {}".format(", ".join(fonts_failed)))
        if (actual["width"], actual["height"]) != (self.width, self.height) or abs(actual["scale"] - self.scale) > 0.001:
            problems.append(
                "the browser used a {}x{} viewport at scale {:g}, not the requested {}x{} at {:g}".format(
                    actual["width"], actual["height"], actual["scale"], self.width, self.height, self.scale
                )
            )
        return {
            "valid": not problems,
            "problems": problems,
            "actual_viewport": actual,
            "attempts": attempts,
            "fonts": fonts,
            "fonts_failed": fonts_failed,
            "console_errors": self.console_errors[:10],
            "failed_requests": failed[:10],
            "images": len(images),
            "images_not_1to1": images_not_one_to_one(images, self.scale),
        }

    def shot(self, full_page=True):
        """The page as an image in device pixels."""
        try:
            data = self.page.screenshot(full_page=full_page, animations="disabled", caret="hide", scale="device")
        except self.error as error:
            raise PPError("capture failed: {}".format(str(error).splitlines()[0]))
        with Image.open(io.BytesIO(data)) as image:
            return image.convert("RGB")

    def box(self, selector, timeout=30000):
        """An element's box in CSS pixels of the page, or None when it is not there."""
        target = self.page.locator(selector).first
        try:
            target.wait_for(state="visible", timeout=timeout)
            return target.evaluate(BOX_JS)
        except self.error:
            return None


def add_page_arguments(parser):
    """The options that describe which page to open and how; shared with `check`."""
    parser.add_argument("--url", required=True)
    parser.add_argument("--viewport", required=True, help="width,height in CSS pixels")
    parser.add_argument("--scale", type=float, default=1.0, help="device scale factor; use the design's pixel density")
    parser.add_argument("--action", action="append", default=[], metavar="KIND:VALUE",
                        help="run before the shot, in order: hover:SEL focus:SEL click:SEL scroll:SEL wait:SEL press:KEY wait-ms:N")
    parser.add_argument("--color-scheme", choices=["light", "dark"], default="light")
    parser.add_argument("--wait-until", choices=["load", "domcontentloaded", "networkidle"], default="load")
    parser.add_argument("--settle-ms", type=int, default=100, help="pause after the page is ready and actions have run")
    parser.add_argument("--timeout", type=int, default=30000, help="milliseconds for navigation and for each action")
    parser.add_argument("--ignore-request", action="append", default=[], metavar="TEXT",
                        help="a failed request whose URL contains TEXT does not make the capture invalid (repeatable)")
    parser.add_argument("--retries", type=int, default=1, help="reloads to try when requests fail")
    parser.add_argument("--json", action="store_true", help="print JSON instead of TOON")


def page_arguments(args):
    width, height = parse_ints(args.viewport, 2, "--viewport")
    if width <= 0 or height <= 0 or args.scale <= 0:
        raise PPError("--viewport and --scale must be positive")
    return width, height, [parse_action(text) for text in args.action]


def main():
    parser = Parser(prog="capture", description=__doc__)
    add_page_arguments(parser)
    parser.add_argument("--out", required=True, help="PNG path to write")
    parser.add_argument("--selector", help="capture only this element's box")
    parser.add_argument("--full-page", action="store_true", help="capture the whole scrollable page, not just the viewport")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the arguments and report what would run, without starting the browser or writing")
    args = parser.parse_args()

    width, height, actions = page_arguments(args)
    if args.selector and args.full_page:
        raise PPError("--selector and --full-page cannot be combined")
    if args.dry:
        emit(
            {
                "dry_run": True,
                "url": args.url,
                "viewport": {"width": width, "height": height},
                "scale": num(args.scale),
                "target": args.selector or ("full page" if args.full_page else "viewport"),
                "viewport_image": {"width": int(round(width * args.scale)), "height": int(round(height * args.scale))},
                "actions": [{"kind": kind, "value": value} for kind, value in actions],
                "writes": [args.out],
            },
            args.json,
        )
        return 0
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    try:
        with Browser(width, height, args.scale, args.color_scheme) as browser:
            report = browser.load(
                args.url, actions, args.wait_until, args.settle_ms, args.timeout, args.ignore_request, args.retries
            )
            box = None
            if args.selector:
                box = browser.box(args.selector, args.timeout)
                if box is None:
                    raise PPError("no visible element matches {}".format(args.selector))
                # An element shot rounds its box to whole CSS pixels. Crop the
                # box out of a full-page shot instead, on device pixels, so a
                # box that ends on a half CSS pixel keeps its exact size.
                image = crop_box(browser.shot(full_page=True), box, args.scale)
            else:
                image = browser.shot(full_page=args.full_page)
            image.save(args.out)
    except BrowserMissing:
        print("error: Chromium is not installed", file=sys.stderr)
        return BROWSER_MISSING_EXIT

    result = {
        "out": args.out,
        "valid": report["valid"],
        "problems": report["problems"],
        "width": image.width,
        "height": image.height,
        "viewport": {"width": width, "height": height},
        "actual_viewport": report["actual_viewport"],
        "scale": num(args.scale),
        "url": args.url,
    }
    if box:
        result["selector"] = args.selector
        result["css_box"] = {key: num(box[key], 3) for key in ("x", "y", "width", "height")}
        result["fractional_box"] = fractional(box, args.scale)
    for key in ("attempts", "fonts", "fonts_failed", "console_errors", "failed_requests", "images"):
        result[key] = report[key]
    result["images_not_1to1"] = report["images_not_1to1"][:12]
    emit(result, args.json)
    return 0 if report["valid"] else INVALID_EXIT


if __name__ == "__main__":
    run_cli(main)
