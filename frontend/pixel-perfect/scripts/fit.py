"""Tune values of a harness until an element matches a reference.

For values no probe can read off the design directly: a shadow's blur, spread
and alpha, an icon's stroke width, the exact geometry of a small glyph. Build a
harness that shows the element and takes those values from outside, start each
one at the best reading a probe gives, then let this refine them: each --var is
stepped up and down, one at a time, and a step is kept when the element's
pixels come closer to the reference's.

--render is a shell command that draws the harness with one set of values and
saves a screenshot of it to the --shot file. Every `{name}` in the command is
replaced by that variable's value, and the same value is in the environment as
PP_FIT_<NAME>. The command runs once per trial, so make it quick: have the
harness read the values when it starts, without building again.

It can also show a ceiling. When the best fit of a text line in the right font
still leaves most of its pixels mismatched, no value will make that text match
this reference, and the stop rule applies.

This is measuring by trial, not scoring. Copy the fitted values into the
component, then score it with `check` or `diff`.

Exit status: 0 done, 2 error.
"""
import argparse
import os
import re
import subprocess

import numpy as np

import diff
from pp_common import Parser, PPError, emit, full_region, load_rgb, num, parse_region, run_cli

VAR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_var(text):
    """Split NAME=START:STEP into a variable to search."""
    name, sep, rest = text.partition("=")
    parts = rest.split(":")
    try:
        if not sep or not VAR_NAME.match(name) or len(parts) != 2:
            raise ValueError
        start, step = float(parts[0]), float(parts[1])
    except ValueError:
        raise PPError("--var must look like NAME=START:STEP, with a name of letters, digits and _; got '{}'".format(text))
    if step <= 0:
        raise PPError("the step of --var {} must be positive".format(name))
    return {"name": name, "start": start, "step": step}


def render_command(template, values):
    """The --render command with each {name} replaced by its value."""
    command = template
    for name, value in values.items():
        command = command.replace("{" + name + "}", "{:g}".format(value))
    return command


def take_shot(template, values, shot, timeout):
    """Run the render command for one set of values and load the screenshot it saves."""
    if os.path.exists(shot):
        # A shot left by an earlier trial must never be read as this one's.
        os.remove(shot)
    env = dict(os.environ)
    env.update({"PP_FIT_" + name.upper(): "{:g}".format(value) for name, value in values.items()})
    command = render_command(template, values)
    try:
        done = subprocess.run(command, shell=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise PPError("the render command did not finish in {:g} s: {}".format(timeout, command))
    if done.returncode != 0:
        raise PPError("the render command exited with status {}: {}\n{}".format(done.returncode, command, done.stdout[-800:].strip()))
    if not os.path.isfile(shot):
        raise PPError("the render command did not save a screenshot at {}: {}".format(shot, command))
    return load_rgb(shot)[0]


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
    parser.add_argument("--render", required=True, metavar="COMMAND",
                        help="shell command that draws the harness with the values and saves a screenshot to --shot; {name} is replaced by each value")
    parser.add_argument("--shot", required=True, metavar="SCREENSHOT.png", help="the file the render command saves")
    parser.add_argument("--box", help="x,y,w,h of the element's wrapper in the screenshot (default: all of it); its size must equal the reference region")
    parser.add_argument("--reference", required=True, help="reference crop of the design")
    parser.add_argument("--region", help="x,y,w,h inside the reference (default: all of it)")
    parser.add_argument("--var", action="append", required=True, metavar="NAME=START:STEP",
                        help="a value to search, e.g. blur=6:1; START is the probe's reading (repeatable)")
    parser.add_argument("--tolerance", type=int, default=diff.DEFAULT_TOLERANCE, help="largest channel difference that still matches")
    parser.add_argument("--sweeps", type=int, default=6, help="passes over all variables")
    parser.add_argument("--span", type=int, default=16, help="how many steps a variable may move from its start")
    parser.add_argument("--max-evals", type=int, default=150, help="most renders to try")
    parser.add_argument("--timeout", type=float, default=120, help="seconds one render may take")
    parser.add_argument("--json", action="store_true", help="print JSON instead of TOON")
    parser.add_argument("--dry", "--dry-run", dest="dry", action="store_true",
                        help="check the arguments and report the first command that would run, without running it")
    args = parser.parse_args()

    variables = [parse_var(text) for text in args.var]
    if len(set(v["name"] for v in variables)) != len(variables):
        raise PPError("each --var needs its own name")
    image, _ = load_rgb(args.reference)
    x, y, w, h = parse_region(args.region, image.shape) if args.region else full_region(image.shape)
    reference = image[y : y + h, x : x + w]
    first = {v["name"]: v["start"] for v in variables}
    if args.dry:
        emit({"dry_run": True, "first_command": render_command(args.render, first), "shot": args.shot,
              "reference": args.reference, "vars": variables, "writes": [args.shot]}, args.json)
        return 0

    seen = {}

    def render(values):
        key = tuple(values[v["name"]] for v in variables)
        if key not in seen:
            shot = take_shot(args.render, values, args.shot, args.timeout)
            bx, by, bw, bh = parse_region(args.box, shot.shape) if args.box else full_region(shot.shape)
            if (bw, bh) != (w, h):
                raise PPError("the screenshot's box is {}x{} and the reference region {}x{}; they must be equal".format(bw, bh, w, h))
            result = diff.compare(reference, shot[by : by + bh, bx : bx + bw], args.tolerance)
            # The summed difference falls smoothly as a soft edge or a shadow
            # nears the reference; a count of mismatched pixels is flat until
            # they overlap, and would rather erase the element.
            seen[key] = (float(result["delta"].astype(np.float64).sum()), int(result["mismatch"].sum()))
        return seen[key]

    values, _, used = descend(lambda trial: render(trial)[0], variables, args.sweeps, args.max_evals, args.span)
    start, best = render(first)[1], render(values)[1]

    emit(
        {
            "region_pixels": w * h,
            "mismatched_pixels": {"start": start, "best": best},
            "evaluations": used,
            "renders": len(seen),
            "vars": [
                {
                    "name": v["name"],
                    "start": num(v["start"], 4),
                    "value": num(values[v["name"]], 4),
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
