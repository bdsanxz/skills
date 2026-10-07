"""Tune CSS custom properties of a harness page until an element matches a reference.

For values no probe can read off the design directly: a shadow's blur, spread
and alpha, an icon's stroke width, the exact geometry of a small glyph. Build a
harness page whose element takes those values from CSS custom properties, start
each one at the best reading a probe gives, then let this refine them: each --var is stepped up and down, one at a time, and a
step is kept when the element's pixels come closer to the reference's.

It can also show a ceiling. When the best fit of a text line in the right font
still leaves most of its pixels mismatched, no value will make that text match
this reference, and the stop rule applies.

This is measuring by trial, not scoring. Copy the fitted values into the
component, then score it with `check` or `diff`.

Exit status: 0 done, 2 error, 3 browser not installed, 4 page not valid.
"""
import argparse
import sys

import numpy as np

import diff
from capture import BROWSER_MISSING_EXIT, BOX_JS, INVALID_EXIT, Browser, BrowserMissing, add_page_arguments, crop_box, page_arguments
from pp_common import Parser, PPError, emit, full_region, load_rgb, num, parse_region, run_cli

SET_JS = "(values) => { for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value); }"


def parse_var(text):
    """Split NAME=START:STEP[:UNIT] into a variable to search."""
    name, sep, rest = text.partition("=")
    parts = rest.split(":")
    try:
        if not sep or not name or len(parts) not in (2, 3):
            raise ValueError
        start, step = float(parts[0]), float(parts[1])
    except ValueError:
        raise PPError("--var must look like NAME=START:STEP or NAME=START:STEP:UNIT; got '{}'".format(text))
    if step <= 0:
        raise PPError("the step of --var {} must be positive".format(name))
    return {"name": name if name.startswith("--") else "--" + name, "start": start, "step": step, "unit": parts[2] if len(parts) == 3 else ""}


def allowed(variable, value, span):
    """A value stays within `span` steps of its start and keeps the start's sign."""
    if abs(value - variable["start"]) > span * variable["step"] + 1e-9:
        return False
    return value * variable["start"] >= 0


def descend(cost, variables, sweeps, max_evals, span=16):
    """Coordinate descent: step each variable while the cost falls.

    Each variable is searched with strides of 4, 2 and then 1 step, so a start
    that is some way off is crossed quickly and the last passes refine. The
    search is local: it refines measured starting values, and a variable is
    never taken past `span` steps from its start or through zero, so it
    cannot erase the element to make the difference smaller.
    """
    values = {v["name"]: v["start"] for v in variables}
    best, used = cost(values), 1
    for stride in (4, 2, 1):
        for _ in range(sweeps):
            improved = False
            for variable in variables:
                for sign in (1, -1):
                    while used < max_evals:
                        trial = dict(values)
                        trial[variable["name"]] = round(trial[variable["name"]] + sign * stride * variable["step"], 4)
                        if not allowed(variable, trial[variable["name"]], span):
                            break
                        value = cost(trial)
                        used += 1
                        if value >= best:
                            break
                        values, best, improved = trial, value, True
            if not improved or used >= max_evals:
                break
    return values, best, used


def main():
    parser = Parser(prog="fit", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_page_arguments(parser)
    parser.add_argument("--selector", required=True, help="the element to compare; its box must equal the reference region")
    parser.add_argument("--reference", required=True, help="reference crop of the design")
    parser.add_argument("--region", help="x,y,w,h inside the reference (default: all of it)")
    parser.add_argument("--var", action="append", required=True, metavar="NAME=START:STEP[:UNIT]",
                        help="a CSS custom property to search, e.g. shadow-blur=6:1:px; START is the probe's reading (repeatable)")
    parser.add_argument("--tolerance", type=int, default=diff.DEFAULT_TOLERANCE, help="largest channel difference that still matches")
    parser.add_argument("--sweeps", type=int, default=6, help="passes over all variables")
    parser.add_argument("--span", type=int, default=16, help="how many steps a variable may move from its start")
    parser.add_argument("--max-evals", type=int, default=400, help="most renders to try")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the arguments and report what would run, without starting the browser")
    args = parser.parse_args()

    width, height, actions = page_arguments(args)
    variables = [parse_var(text) for text in args.var]
    image, _ = load_rgb(args.reference)
    x, y, w, h = parse_region(args.region, image.shape) if args.region else full_region(image.shape)
    reference = image[y : y + h, x : x + w]
    if args.dry:
        emit({"dry_run": True, "url": args.url, "selector": args.selector, "reference": args.reference,
              "vars": variables, "writes": []}, args.json)
        return 0

    try:
        with Browser(width, height, args.scale, args.color_scheme) as browser:
            report = browser.load(args.url, actions, args.wait_until, args.settle_ms, args.timeout, args.ignore_request, args.retries)
            if not report["valid"]:
                emit({"url": args.url, "valid": False, "problems": report["problems"],
                      "failed_requests": report["failed_requests"], "fonts_failed": report["fonts_failed"]}, args.json)
                return INVALID_EXIT
            if browser.box(args.selector, args.timeout) is None:
                raise PPError("no visible element matches {}".format(args.selector))
            target = browser.page.locator(args.selector).first

            def render(values):
                browser.page.evaluate(SET_JS, {v["name"]: "{:g}{}".format(values[v["name"]], v["unit"]) for v in variables})
                shot = np.asarray(crop_box(browser.shot(full_page=True), target.evaluate(BOX_JS), args.scale))
                return diff.compare(reference, shot, args.tolerance)

            def cost(values):
                # The summed difference falls smoothly as a soft edge or a
                # shadow nears the reference; a count of mismatched pixels is
                # flat until they overlap, and would rather erase the element.
                return float(render(values)["delta"].astype(np.float64).sum())

            def mismatched(values):
                return int(render(values)["mismatch"].sum())

            first = {v["name"]: v["start"] for v in variables}
            values, _, used = descend(cost, variables, args.sweeps, args.max_evals, args.span)
            start, best = mismatched(first), mismatched(values)
    except BrowserMissing:
        print("error: Chromium is not installed", file=sys.stderr)
        return BROWSER_MISSING_EXIT

    emit(
        {
            "url": args.url,
            "selector": args.selector,
            "valid": True,
            "region_pixels": w * h,
            "mismatched_pixels": {"start": start, "best": best},
            "evaluations": used,
            "vars": [
                {
                    "name": v["name"],
                    "start": num(v["start"], 4),
                    "value": num(values[v["name"]], 4),
                    "unit": v["unit"],
                    # Stopped by the search limit, not by a worse result: the start was too far off.
                    "at_limit": not allowed(v, values[v["name"]] + v["step"], args.span)
                    or not allowed(v, values[v["name"]] - v["step"], args.span),
                }
                for v in variables
            ],
            "note": "measured by trial, not a score; copy the values into the component and score it with check",
        },
        args.json,
    )
    return 0


if __name__ == "__main__":
    run_cli(main)
