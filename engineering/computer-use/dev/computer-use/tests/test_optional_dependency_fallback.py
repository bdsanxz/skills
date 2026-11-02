"""Optional dependency fallback behavior (T012).

When an optional dependency cannot be installed, setup must still
complete through the standard fallback: the operation runs, a warning
naming the option is recorded in the runtime state, and the warning
surfaces alongside results instead of failing the task. When the option
later becomes available, a fresh invocation uses it with no warning.
"""

from __future__ import annotations

import json
from pathlib import Path

from computer_use.bootstrap import (
    BootstrapError,
    ensure_environment,
    invoke,
    runtime_directory,
)

BLOCKED = (("no-such-option-xyz==0.0.0", "no_such_option_xyz"),)


def test_unavailable_optional_package_warns_and_completes(
    tmp_path: Path,
) -> None:
    runtime = ensure_environment(tmp_path, required=(), optional=BLOCKED)

    assert runtime.ready is True
    assert any("no-such-option-xyz" in warning for warning in runtime.warnings)


def test_optional_warning_recorded_in_runtime_state(tmp_path: Path) -> None:
    runtime = ensure_environment(tmp_path, required=(), optional=BLOCKED)

    assert any(
        "no-such-option-xyz" in warning
        for warning in runtime.as_dict()["warnings"]
    )
    stored = json.loads(
        (runtime.directory / "environment.json").read_text(encoding="utf-8")
    )
    assert any("no-such-option-xyz" in warning for warning in stored["warnings"])


def test_optional_warning_surfaced_with_results_not_failure(
    tmp_path: Path,
) -> None:
    metadata = runtime_directory(tmp_path) / "environment.json"
    operation = [
        "-c",
        (
            "import json; from pathlib import Path; "
            f"print(json.loads(Path({str(metadata)!r}).read_text())['warnings'])"
        ),
    ]

    result = invoke(tmp_path, operation, required=(), optional=BLOCKED)

    assert result.returncode == 0
    assert "no-such-option-xyz" in result.stdout


def test_optional_available_later_clears_warning(tmp_path: Path) -> None:
    blocked = ensure_environment(tmp_path, required=(), optional=BLOCKED)

    assert blocked.warnings != ()

    fresh = ensure_environment(
        tmp_path, required=(), optional=(("stdlib-json", "json"),)
    )

    assert fresh.ready is True
    assert fresh.warnings == ()


def test_optional_probe_launch_failure_warns_and_completes(
    tmp_path: Path, monkeypatch
) -> None:
    import computer_use.bootstrap as bootstrap

    def boom(python, module):
        raise BootstrapError("probe boom")

    monkeypatch.setattr(bootstrap, "_module_available", boom)

    runtime = ensure_environment(
        tmp_path, required=(),
        optional=(("probe-option>=1", "probe_option_mod"),),
    )

    assert runtime.ready is True
    assert any("probe-option" in warning for warning in runtime.warnings)


def test_optional_post_install_probe_failure_warns(
    tmp_path: Path, monkeypatch
) -> None:
    import computer_use.bootstrap as bootstrap

    calls: list = []

    def probe(python, module):
        calls.append(module)
        if len(calls) == 1:
            return False
        raise BootstrapError("post-install probe boom")

    monkeypatch.setattr(bootstrap, "_module_available", probe)
    monkeypatch.setattr(bootstrap, "_install", lambda *args, **kwargs: None)

    runtime = ensure_environment(
        tmp_path, required=(),
        optional=(("probe-option>=1", "probe_option_mod"),),
    )

    assert runtime.ready is True
    assert any("probe-option" in warning for warning in runtime.warnings)
