#!/usr/bin/env python3
"""Entry point for every pixel-perfect script.

Uses only the standard library. On first use it creates a shared virtual
environment in the user cache, installs the pinned requirements, then runs the
requested tool inside it.

    run.py measure <probe> ...     measurement probes
    run.py diff <design> <render>  score a render against the design
    run.py check --shot ...        score components, sections and pages from one screenshot
    run.py compare <ref> <render>  the same items in both images, with position and size deltas
    run.py fit --render ...        tune a harness's values to a reference
    run.py scores                  latest and best score of every item, and the stop rule
    run.py exec <file.py> [args]   run one-off analysis code in the environment
    run.py test                    run the bundled script tests
    run.py setup                   create the environment

Every tool accepts --help, and --dry to check its arguments and report what it
would do without writing anything. With --dry, run.py itself never creates the
environment: when the environment is missing it reports the steps it would
take and stops.
"""
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REQUIREMENTS = SCRIPTS / "requirements.txt"
TOOLS = {
    "measure": "measure.py",
    "diff": "diff.py",
    "compare": "compare.py",
    "scores": "scores.py",
    "check": "check.py",
    "fit": "fit.py",
}


def log(message):
    print("pixel-perfect: " + message, file=sys.stderr, flush=True)


def fail(message):
    log("error: " + message)
    sys.exit(2)


def cache_root():
    override = os.environ.get("PIXEL_PERFECT_HOME")
    if override:
        return Path(override).expanduser()
    base = os.environ.get("XDG_CACHE_HOME")
    return (Path(base).expanduser() if base else Path.home() / ".cache") / "pixel-perfect"


def venv_dir():
    digest = hashlib.sha256()
    digest.update(REQUIREMENTS.read_bytes())
    digest.update("{}.{}".format(*sys.version_info[:2]).encode())
    return cache_root() / ("venv-" + digest.hexdigest()[:12])


def venv_python(venv):
    if os.name == "nt":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def run_quiet(command):
    """Run a setup command; show its output only when it fails."""
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
    return result.returncode == 0


def build_venv(target):
    uv = shutil.which("uv")
    if uv:
        ok = run_quiet([uv, "venv", "--python", sys.executable, str(target)]) and run_quiet(
            [uv, "pip", "install", "--python", str(venv_python(target)), "-r", str(REQUIREMENTS)]
        )
        if ok:
            return True
        log("uv install failed, falling back to venv + pip")
        shutil.rmtree(target, ignore_errors=True)
    if not run_quiet([sys.executable, "-m", "venv", str(target)]):
        return False
    return run_quiet(
        [str(venv_python(target)), "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", str(REQUIREMENTS)]
    )


def ensure_venv():
    venv = venv_dir()
    if (venv / ".ready").exists() and venv_python(venv).exists():
        return venv
    log("creating environment at {} (first run only)".format(venv))
    venv.parent.mkdir(parents=True, exist_ok=True)
    # Build beside the final location and rename, so a crashed or concurrent
    # build never leaves a half-installed environment in place.
    staging = venv.parent / "{}.tmp-{}".format(venv.name, os.getpid())
    shutil.rmtree(staging, ignore_errors=True)
    if not build_venv(staging):
        shutil.rmtree(staging, ignore_errors=True)
        fail("could not install dependencies from " + str(REQUIREMENTS))
    (staging / ".ready").write_text("ok\n")
    if venv.exists() and not (venv / ".ready").exists():
        shutil.rmtree(venv, ignore_errors=True)
    try:
        staging.rename(venv)
    except OSError:
        # Another process finished the same build first.
        shutil.rmtree(staging, ignore_errors=True)
        if not (venv / ".ready").exists():
            fail("could not move the environment into place at " + str(venv))
    return venv


def child_env():
    env = dict(os.environ)
    env["PYTHONPATH"] = str(SCRIPTS) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def dry_report(tool, args):
    """Say what a run would do, without creating or installing anything."""
    venv = venv_dir()
    ready = (venv / ".ready").exists()
    print("dry_run: true")
    print("tool: " + tool)
    print("environment: " + str(venv))
    print("environment_ready: " + ("true" if ready else "false"))
    steps = []
    if not ready:
        steps.append("create the environment and install " + str(REQUIREMENTS))
    if tool == "test":
        steps.append("run the unit tests in " + str(SCRIPTS / "tests"))
    elif tool == "exec":
        steps.append("run " + " ".join(a for a in args if a not in ("--dry", "--dry-run")))
    elif tool != "setup":
        steps.append("run {} with the given arguments (not validated: the environment does not exist yet)".format(TOOLS[tool]))
    print("would[{}]:".format(len(steps)))
    for step in steps:
        print("  - " + step)
    return 0


def main(argv):
    if sys.version_info < (3, 9):
        fail("Python 3.9 or newer is required")
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    tool, args = argv[0], argv[1:]
    known = list(TOOLS) + ["exec", "test", "setup"]
    if tool not in known:
        fail("unknown tool '{}'. Expected one of: {}".format(tool, ", ".join(known)))
    dry = "--dry" in args or "--dry-run" in args
    if dry and (tool in ("setup", "test", "exec") or not (venv_dir() / ".ready").exists()):
        return dry_report(tool, args)
    venv = ensure_venv()
    python = str(venv_python(venv))
    if tool == "setup":
        print("environment: " + str(venv))
        return 0
    if tool == "test":
        command = [python, "-m", "unittest", "discover", "-s", str(SCRIPTS / "tests")] + args
        return subprocess.call(command, env=child_env(), cwd=str(SCRIPTS))
    if tool == "exec":
        if not args:
            fail("exec needs a Python file to run")
        return subprocess.call([python] + args, env=child_env())
    return subprocess.call([python, str(SCRIPTS / TOOLS[tool])] + args, env=child_env())


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
