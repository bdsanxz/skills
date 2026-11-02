"""First-use runtime setup behavior (T001).

The skill must prepare its own isolated runtime area on first invocation
with zero manual steps, reuse it on later invocations, and explain
failures plainly. Nothing outside the skill's own area may be modified.
"""

from __future__ import annotations

import json
import os
import subprocess
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

import computer_use.bootstrap as bootstrap
from computer_use.bootstrap import (
    BootstrapError,
    Runtime,
    _run,
    ensure_environment,
    invoke,
    process_environment,
    run_in_runtime,
    runtime_directory,
    runtime_python,
)


def run_python(python: Path, code: str) -> str:
    completed = subprocess.run(
        [str(python), "-c", code],
        check=True,
        text=True,
        capture_output=True,
        timeout=120,
    )
    return completed.stdout.strip()


def test_custom_operation_iterable_is_rejected_before_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "operation-iterated-before-setup.txt"

    class Command:
        def __iter__(self):
            marker.write_text("used", encoding="utf-8")
            return iter(("-c", "print('unexpected')"))

    with pytest.raises(BootstrapError, match="materialized|command"):
        invoke(tmp_path, Command(), required=())

    assert not marker.exists()


def test_required_specs_reject_custom_iterables_before_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "required-specs-iterated.txt"

    class RequiredSpecs:
        def __iter__(self):
            marker.write_text("used", encoding="utf-8")
            return iter(())

    with pytest.raises(BootstrapError, match="Required|materialized"):
        ensure_environment(tmp_path, required=RequiredSpecs())

    assert not marker.exists()


def test_optional_specs_reject_custom_iterables_before_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "optional-specs-iterated.txt"

    class OptionalSpecs:
        def __iter__(self):
            marker.write_text("used", encoding="utf-8")
            return iter(())

    with pytest.raises(BootstrapError, match="Optional|materialized"):
        ensure_environment(tmp_path, required=(), optional=OptionalSpecs())

    assert not marker.exists()


def test_path_callable_metadata_is_read_without_execution(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "path-callable-metadata-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        "class HostileModule:\n"
        "    def __ne__(self, other):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return True\n"
        "Path.__fspath__.__module__ = HostileModule()\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert not marker.exists()


def test_path_callable_descriptor_is_rejected_without_attribute_access(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "path-callable-descriptor-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        "class HostileCode:\n"
        "    @property\n"
        "    def __code__(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return None\n"
        "Path.resolve = HostileCode()\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert not marker.exists()


def test_path_class_metaclass_is_rejected_without_bases_access(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "path-class-bases-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        "class HostileMeta(type):\n"
        "    def __getattribute__(cls, name):\n"
        "        if name == '__bases__':\n"
        f"            open({str(marker)!r}, 'w').write('used')\n"
        "        return super().__getattribute__(name)\n"
        "class HostilePath(pathlib.Path, metaclass=HostileMeta):\n"
        "    pass\n"
        "pathlib.Path = HostilePath\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert not marker.exists()


def test_path_module_metadata_is_read_without_execution(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "path-module-metadata-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys, types\n"
        "from pathlib import Path\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        "class HostileName:\n"
        "    def __eq__(self, other):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return True\n"
        "pathlib_os = pathlib.__dict__['os']\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__file__ = pathlib_os.__file__\n"
        "fake_os.__name__ = HostileName()\n"
        "pathlib.__dict__['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert not marker.exists()


def test_path_fspath_rejects_metadata_spoofed_builtin_type(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "path-fspath-type-spoof-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        "real_str = str\n"
        "class SpoofedStr:\n"
        "    def __new__(cls, value):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return real_str(value)\n"
        "SpoofedStr.__module__ = 'builtins'\n"
        "SpoofedStr.__name__ = 'str'\n"
        "SpoofedStr.__qualname__ = 'str'\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        "pathlib.str = SpoofedStr\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert not marker.exists()


def test_path_fspath_rejects_hostile_module_global(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "path-fspath-global-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        "real_str = str\n"
        "def hostile_str(value):\n"
        f"    open({str(marker)!r}, 'w').write('used')\n"
        "    return real_str(value)\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        "pathlib.str = hostile_str\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert "base interpreter" in result.stderr or "pathlib" in result.stderr
    assert not marker.exists()


def test_monkeypatched_genuine_path_fspath_is_rejected(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "monkeypatched-path-fspath-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        "real_fspath = Path.__fspath__\n"
        "def hostile_fspath(self):\n"
        f"    open({str(marker)!r}, 'w').write('used')\n"
        "    return real_fspath(self)\n"
        "Path.__fspath__ = hostile_fspath\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"base = Path({str(tmp_path / 'not-python')!r})\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert "base interpreter" in result.stderr
    assert not marker.exists()


def test_metadata_spoofed_base_path_is_rejected_without_fspath(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "spoofed-base-fspath-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import pathlib, sys\n"
        "from pathlib import Path\n"
        "class SpoofedPath(type(Path())):\n"
        "    def __fspath__(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return super().__fspath__()\n"
        "SpoofedPath.__module__ = 'pathlib'\n"
        "SpoofedPath.__name__ = 'PosixPath'\n"
        "SpoofedPath.__qualname__ = 'PosixPath'\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"base = SpoofedPath({str(tmp_path / 'not-python')!r})\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=(), base_python=base)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert "base interpreter" in result.stderr
    assert not marker.exists()


def test_explicit_base_interpreter_must_be_authenticated(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "explicit-base-used.txt"
    launcher = tmp_path / "not-python"
    launcher.write_text(
        "#!/bin/sh\n"
        f"echo used > {str(marker)!r}\n"
        "exit 99\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)

    with pytest.raises(BootstrapError, match="base interpreter|authenticated"):
        ensure_environment(tmp_path, required=(), base_python=launcher)

    assert not marker.exists()


def test_executable_candidates_never_derive_from_caller_entries() -> None:
    candidates = bootstrap._bootstrap_executable_candidates(
        ["/caller-controlled/lib/python3.14"]
    )

    assert not any(
        candidate.startswith("/caller-controlled/") for candidate in candidates
    )


def test_clean_frozen_loading_ignores_registry_replaced_imp(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "forged-imp-used.txt"
    code = (
        "import importlib.util, sys, types\n"
        f"spec = importlib.util.spec_from_file_location('computer_use.bootstrap', {str(Path(bootstrap.__file__))!r})\n"
        "code_object = spec.loader.get_code('computer_use.bootstrap')\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "real_imp = sys.modules['_imp']\n"
        "fake_imp = types.SimpleNamespace()\n"
        "def forged_get_frozen_object(name):\n"
        f"    open({str(marker)!r}, 'w').write('used')\n"
        "    return real_imp.get_frozen_object(name)\n"
        "fake_imp.get_frozen_object = forged_get_frozen_object\n"
        "sys.modules['_imp'] = fake_imp\n"
        "sys.modules['computer_use.bootstrap'] = module\n"
        "exec(code_object, module.__dict__)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_setup_does_not_use_a_replaced_active_import_hook(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "forged-import-used.txt"
    source_path = Path(bootstrap.__file__)
    code = (
        "import ast, builtins, importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('computer_use.bootstrap', {str(source_path)!r})\n"
        "code_object = spec.loader.get_code('computer_use.bootstrap')\n"
        "module = importlib.util.module_from_spec(spec)\n"
        f"source = open({str(source_path)!r}, encoding='utf-8').read()\n"
        "tree = ast.parse(source)\n"
        "first = next(node for node in tree.body if isinstance(node, ast.Import))\n"
        "prefix = ast.Module(body=[first], type_ignores=[])\n"
        "rest = ast.Module(body=[node for node in tree.body if node is not first], type_ignores=[])\n"
        "ast.fix_missing_locations(prefix)\n"
        "ast.fix_missing_locations(rest)\n"
        "sys.modules['computer_use.bootstrap'] = module\n"
        "exec(compile(prefix, spec.origin, 'exec'), module.__dict__)\n"
        "real_import = builtins.__import__\n"
        "def forged_import(name, globals=None, locals=None, fromlist=(), level=0):\n"
        "    if name != 'sys':\n"
        f"        open({str(marker)!r}, 'w').write(name)\n"
        "    return real_import(name, globals, locals, fromlist, level)\n"
        "builtins.__import__ = forged_import\n"
        "exec(compile(rest, spec.origin, 'exec'), module.__dict__)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_default_setup_ignores_mutable_base_interpreter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = tmp_path / "mutable-base-used.txt"
    launcher = tmp_path / "launcher"
    launcher.write_text(
        "#!/bin/sh\n"
        f"echo used > {str(marker)!r}\n"
        "exit 99\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)
    monkeypatch.setattr(bootstrap._bootstrap_sys, "executable", str(launcher))

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert not marker.exists()


def test_windows_startup_paths_require_the_captured_interpreter_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        bootstrap, "_bootstrap_initial_prefix", r"C:\Python314"
    )
    monkeypatch.setattr(
        bootstrap, "_bootstrap_initial_base_prefix", r"C:\Python314"
    )

    assert bootstrap._bootstrap_startup_entry_is_trusted(
        r"C:\Python314\Lib"
    )
    assert bootstrap._bootstrap_startup_entry_is_trusted(
        r"C:\Python314\DLLs"
    )
    assert bootstrap._bootstrap_startup_entry_is_trusted(
        r"C:\Python314\python314.zip"
    )
    assert not bootstrap._bootstrap_startup_entry_is_trusted(
        r"C:\attacker\Lib"
    )
    assert not bootstrap._bootstrap_startup_entry_is_trusted(
        r"C:\attacker\DLLs"
    )


def test_fallback_setup_rejects_unverified_base_without_launching_it(
    tmp_path: Path,
) -> None:
    fake_prefix = tmp_path / "captured-prefix"
    fake_bin = fake_prefix / "bin"
    fake_bin.mkdir(parents=True)
    marker = tmp_path / "unverified-base-used.txt"
    launcher = fake_bin / "python3.14"
    launcher.write_text(
        "#!/bin/sh\n"
        f"echo used > {str(marker)!r}\n"
        "exit 99\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        f"sys.executable = {str(launcher)!r}\n"
        f"sys._base_executable = {str(launcher)!r}\n"
        f"sys.prefix = {str(fake_prefix)!r}\n"
        f"sys.base_prefix = {str(fake_prefix)!r}\n"
        "sys._stdlib_dir = ''\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "from pathlib import Path\n"
        "from computer_use.bootstrap import ensure_environment\n"
        f"runtime = ensure_environment(Path({str(tmp_path)!r}), required=())\n"
        "assert runtime.ready is True\n"
    )
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=environment,
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_runtime_rejects_an_external_site_packages_root(
    tmp_path: Path,
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    candidates = list(runtime.directory.glob("lib/python*/site-packages"))
    candidates.extend([runtime.directory / "Lib" / "site-packages"])
    site_packages = next(path for path in candidates if path.is_dir())
    outside = tmp_path / "outside-site-packages"
    outside.mkdir()
    marker = tmp_path / "outside-import-used.txt"
    (outside / "outside_probe.py").write_text(
        f"open({str(marker)!r}, 'w').write('used')\n",
        encoding="utf-8",
    )
    site_packages.rename(tmp_path / "original-site-packages")
    site_packages.symlink_to(outside, target_is_directory=True)

    with pytest.raises(BootstrapError, match="usable|canonical|runtime"):
        run_in_runtime(
            runtime,
            ["-c", "import outside_probe"],
        )

    assert not marker.exists()


def test_runtime_rejects_import_root_with_external_parent(
    tmp_path: Path,
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    candidates = list(runtime.directory.glob("lib/python*/site-packages"))
    candidates.extend([runtime.directory / "Lib" / "site-packages"])
    site_packages = next(path for path in candidates if path.is_dir())
    import_parent = site_packages.parent
    original_parent = runtime.directory / "original-import-parent"
    outside = tmp_path / "outside-import-parent"
    outside_parent = outside / import_parent.name
    outside_site_packages = outside_parent / site_packages.name
    outside_site_packages.mkdir(parents=True)
    marker = tmp_path / "external-parent-import-used.txt"
    (outside_site_packages / "outside_probe.py").write_text(
        f"from pathlib import Path; Path({str(marker)!r}).write_text('used')",
        encoding="utf-8",
    )
    import_parent.rename(original_parent)
    import_parent.symlink_to(outside_parent, target_is_directory=True)

    with pytest.raises(BootstrapError, match="usable|canonical|runtime"):
        run_in_runtime(
            runtime,
            ["-c", "import outside_probe"],
        )

    assert not marker.exists()


def test_fallback_roots_do_not_import_caller_stdlib_code(
    tmp_path: Path,
) -> None:
    fake_prefix = tmp_path / "captured-prefix"
    fake_stdlib = fake_prefix / "lib" / "python3.14"
    fake_stdlib.mkdir(parents=True)
    marker = tmp_path / "fallback-json-used.txt"
    (fake_stdlib / "json.py").write_text(
        f"open({str(marker)!r}, 'w').write('used')\n",
        encoding="utf-8",
    )
    launcher = fake_prefix / "bin" / "python3.14"
    launcher.parent.mkdir()
    launcher.write_text(
        "#!/bin/sh\n"
        "exit 99\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        f"sys.executable = {str(launcher)!r}\n"
        f"sys._base_executable = {str(launcher)!r}\n"
        f"sys.prefix = {str(fake_prefix)!r}\n"
        f"sys.base_prefix = {str(fake_prefix)!r}\n"
        "sys._stdlib_dir = ''\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        f"sys.path.insert(0, {str(fake_stdlib)!r})\n"
        "sys.modules.pop('json', None)\n"
        "import computer_use.bootstrap\n"
    )
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=environment,
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_mimicking_runtime_is_repaired_before_any_probe_execution(
    tmp_path: Path,
) -> None:
    area = runtime_directory(tmp_path)
    fake_bin = area / "bin"
    fake_bin.mkdir(parents=True)
    marker = tmp_path / "mimicking-runtime-used.txt"
    fake_python = fake_bin / "python"
    fake_python.write_text(
        "#!/bin/sh\n"
        f"echo used > {str(marker)!r}\n"
        f"printf 'probe-ok\\n{str(area)}\\n'\n",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)
    (area / "pyvenv.cfg").write_text(
        "home = /untrusted\ninclude-system-site-packages = false\n",
        encoding="utf-8",
    )

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert not marker.exists()


def test_arbitrary_native_helper_with_decoy_python_symbol(
    tmp_path: Path,
) -> None:
    compiler = shutil.which("cc")
    if compiler is None:
        pytest.skip("no C compiler is available for the native-boundary test")
    fake_prefix = tmp_path / "captured-prefix"
    fake_bin = fake_prefix / "bin"
    fake_bin.mkdir(parents=True)
    marker = tmp_path / "decoy-native-used.txt"
    escaped_marker = str(marker).replace("\\", "\\\\").replace('"', '\\"')
    source = tmp_path / "decoy.c"
    source.write_text(
        "#include <stdio.h>\n"
        "static volatile const char decoy[] = \"Py_Initialize\";\n"
        "int main(void) {\n"
        "    if (decoy[0] == '\\0') return 98;\n"
        f"    FILE *stream = fopen(\"{escaped_marker}\", \"w\");\n"
        "    if (stream != NULL) { fputs(\"used\", stream); fclose(stream); }\n"
        "    return 99;\n"
        "}\n",
        encoding="utf-8",
    )
    launcher = fake_bin / "python3.14"
    compiled = subprocess.run(
        [compiler, str(source), "-o", str(launcher)],
        cwd=tmp_path,
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )
    assert compiled.returncode == 0, compiled.stderr
    launcher.chmod(0o755)
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        f"sys.executable = {str(launcher)!r}\n"
        f"sys._base_executable = {str(launcher)!r}\n"
        f"sys.prefix = {str(fake_prefix)!r}\n"
        f"sys.base_prefix = {str(fake_prefix)!r}\n"
        "sys._stdlib_dir = ''\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap\n"
    )
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=environment,
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def write_probe_wheel(root: Path) -> Path:
    wheel = root / "pip_target_probe-1.0.0-py3-none-any.whl"
    files = {
        "pip_target_probe.py": "VALUE = 'target-probe'\n",
        "pip_target_probe-1.0.0.dist-info/METADATA": (
            "Metadata-Version: 2.1\n"
            "Name: pip-target-probe\n"
            "Version: 1.0.0\n"
        ),
        "pip_target_probe-1.0.0.dist-info/WHEEL": (
            "Wheel-Version: 1.0\n"
            "Generator: test\n"
            "Root-Is-Purelib: true\n"
            "Tag: py3-none-any\n"
        ),
        "pip_target_probe-1.0.0.dist-info/RECORD": "",
    }
    with zipfile.ZipFile(wheel, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return wheel


def test_runtime_directory_lives_inside_project_root(tmp_path: Path) -> None:
    area = runtime_directory(tmp_path)

    assert area.is_relative_to(tmp_path)
    assert area != tmp_path


def test_dynamic_loader_controls_are_removed_from_runtime_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LD_PRELOAD", "/outside/injected.dylib")
    monkeypatch.setenv("DYLD_INSERT_LIBRARIES", "/outside/injected.dylib")

    environment = process_environment(tmp_path / "storage")

    assert "LD_PRELOAD" not in environment
    assert "DYLD_INSERT_LIBRARIES" not in environment
    with pytest.raises(BootstrapError, match="Protected"):
        bootstrap._checked_environment_overrides(
            {"LD_PRELOAD": "/outside/injected.dylib"}
        )


def test_process_environment_scopes_temp_and_cache_under_storage_root(
    tmp_path: Path,
) -> None:
    storage = tmp_path / "area"

    env = process_environment(storage)

    assert Path(env["TMPDIR"]).is_relative_to(storage)
    assert Path(env["PIP_CACHE_DIR"]).is_relative_to(storage)
    assert (storage / "tmp").is_dir()
    assert (storage / "pip-cache").is_dir()


def test_first_ensure_creates_usable_isolated_python(tmp_path: Path) -> None:
    runtime = ensure_environment(tmp_path, required=())

    assert runtime.python.exists()
    assert runtime.python.is_relative_to(runtime.directory)
    assert runtime.ready is True
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_second_ensure_reuses_area_without_reinstall(tmp_path: Path) -> None:
    first = ensure_environment(tmp_path, required=())
    marker = first.directory / "keep-me.txt"
    marker.write_text("untouched\n", encoding="utf-8")

    second = ensure_environment(tmp_path, required=())

    assert second.python == first.python
    assert second.ready is True
    assert marker.read_text(encoding="utf-8") == "untouched\n"


def test_uninstallable_required_package_stops_with_its_name(
    tmp_path: Path,
) -> None:
    with pytest.raises(BootstrapError, match="no-such-package-xyz"):
        ensure_environment(
            tmp_path, required=(("no-such-package-xyz==0.0.0", "no_such_module_xyz"),)
        )


def test_corrupt_area_is_repaired_into_working_runtime(tmp_path: Path) -> None:
    area = runtime_directory(tmp_path)
    area.mkdir(parents=True)
    (area / "junk.txt").write_text("not a virtualenv\n", encoding="utf-8")

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_nothing_outside_the_area_is_modified(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    sentinel = tmp_path / "outside.txt"
    sentinel.write_text("pristine\n", encoding="utf-8")
    before = {p.name for p in tmp_path.iterdir()}

    runtime = ensure_environment(project, required=())
    created = {p.name for p in tmp_path.iterdir()} - before - {runtime.directory.name}

    assert runtime.directory.is_relative_to(project)
    assert created == set()
    assert sentinel.read_text(encoding="utf-8") == "pristine\n"


def test_setup_records_readiness_metadata(tmp_path: Path) -> None:
    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert (runtime.directory / "environment.json").is_file()


def _plant_broken_venv(area: Path) -> None:
    fake_bin = area / "bin"
    fake_bin.mkdir(parents=True)
    fake_python = fake_bin / "python"
    fake_python.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
    fake_python.chmod(0o755)
    (area / "pyvenv.cfg").write_text("broken\n", encoding="utf-8")


def test_existing_unusable_interpreter_is_replaced(tmp_path: Path) -> None:
    area = runtime_directory(tmp_path)
    _plant_broken_venv(area)

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_runtime_path_as_regular_file_is_replaced(tmp_path: Path) -> None:
    area = runtime_directory(tmp_path)
    area.parent.mkdir(parents=True)
    area.write_text("not a directory\n", encoding="utf-8")

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert runtime.directory.is_dir()
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_system_site_packages_configuration_is_repaired(
    tmp_path: Path,
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    config = runtime.directory / "pyvenv.cfg"
    contents = config.read_text(encoding="utf-8")
    assert "include-system-site-packages = false" in contents
    config.write_text(
        contents.replace(
            "include-system-site-packages = false",
            "include-system-site-packages = true",
        ),
        encoding="utf-8",
    )

    repaired = ensure_environment(tmp_path, required=())

    assert repaired.ready is True
    assert "include-system-site-packages = false" in config.read_text(
        encoding="utf-8"
    )


def test_duplicate_system_site_settings_are_not_treated_as_isolated(
    tmp_path: Path,
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    config = runtime.directory / "pyvenv.cfg"
    config.write_text(
        config.read_text(encoding="utf-8")
        + "include-system-site-packages = true\n",
        encoding="utf-8",
    )

    repaired = ensure_environment(tmp_path, required=())

    assert repaired.ready is True
    settings = [
        line.strip().lower()
        for line in config.read_text(encoding="utf-8").splitlines()
        if line.strip().lower().startswith("include-system-site-packages")
    ]
    assert settings == ["include-system-site-packages = false"]


def test_pip_destination_override_is_rejected_before_external_install(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "external-pip-target"
    target.mkdir()
    wheel = write_probe_wheel(tmp_path)
    monkeypatch.setenv("PIP_TARGET", str(target))
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError):
        ensure_environment(
            tmp_path,
            required=((str(wheel), "pip_target_probe"),),
            install_timeout=60,
        )

    assert list(target.iterdir()) == []


def test_venv_creation_rejects_caller_shadow_without_executing_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    outer = tmp_path / "outer"
    outer.mkdir()
    marker = tmp_path / "caller-venv-imported.txt"
    (outer / "venv.py").write_text(
        f"from pathlib import Path; Path({str(marker)!r}).write_text('imported')\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("PYTHONPATH", str(outer))

    with pytest.raises(BootstrapError, match="venv|bootstrap|caller"):
        ensure_environment(tmp_path, required=())

    assert not marker.exists()


def test_failed_dependency_setup_invalidates_ready_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    metadata = runtime.directory / "environment.json"
    assert json.loads(metadata.read_text(encoding="utf-8"))["ready"] is True
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError):
        ensure_environment(
            tmp_path,
            required=(("stale-missing==1.0.0", "stale_missing"),),
            install_timeout=1,
        )

    assert not json.loads(metadata.read_text(encoding="utf-8"))["ready"]


def test_runtime_operation_strips_inherited_pip_destinations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    monkeypatch.setenv("PIP_TARGET", str(tmp_path / "outside"))

    result = run_in_runtime(
        runtime,
        ["-c", "import os; print(os.environ.get('PIP_TARGET'))"],
    )

    assert result.stdout.strip() == "None"


def test_required_distribution_version_is_checked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    wheel = tmp_path / "t001_version_probe-1.0.0-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr("version_probe.py", "VALUE = 'old'\n")
        archive.writestr(
            "t001_version_probe-1.0.0.dist-info/METADATA",
            "Metadata-Version: 2.1\n"
            "Name: t001-version-probe\n"
            "Version: 1.0.0\n",
        )
        archive.writestr(
            "t001_version_probe-1.0.0.dist-info/WHEEL",
            "Wheel-Version: 1.0\n"
            "Generator: test\n"
            "Root-Is-Purelib: true\n"
            "Tag: py3-none-any\n",
        )
        archive.writestr("t001_version_probe-1.0.0.dist-info/RECORD", "")

    ensure_environment(
        tmp_path,
        required=((str(wheel), "version_probe"),),
        install_timeout=60,
    )
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError, match="t001-version-probe"):
        ensure_environment(
            tmp_path,
            required=(("t001-version-probe>=2.0", "version_probe"),),
            install_timeout=1,
        )


def test_installer_timeout_reports_a_named_error() -> None:
    with pytest.raises(BootstrapError, match="timed out"):
        _run(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            timeout=0.2,
        )


def test_unreachable_package_index_names_the_dependency(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError, match="no-such-package-xyz"):
        ensure_environment(
            tmp_path, required=(("no-such-package-xyz==0.0.0", "no_such_module_xyz"),)
        )


def test_symlinked_runtime_area_is_replaced_without_touching_target(
    tmp_path: Path,
) -> None:
    area = runtime_directory(tmp_path)
    area.parent.mkdir(parents=True)
    external = tmp_path / "external-target"
    external.mkdir()
    planted = external / "planted.txt"
    planted.write_text("external\n", encoding="utf-8")
    area.symlink_to(external, target_is_directory=True)

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert runtime.directory.is_dir()
    assert not runtime.directory.is_symlink()
    assert planted.read_text(encoding="utf-8") == "external\n"
    assert not (external / "environment.json").exists()
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_invoke_runs_operation_inside_prepared_runtime(tmp_path: Path) -> None:
    runtime = ensure_environment(tmp_path, required=())

    result = invoke(
        tmp_path,
        ["-c", "import sys; print(sys.prefix)"],
        required=(),
    )

    assert result.returncode == 0
    assert Path(result.stdout.strip()).resolve() == runtime.directory.resolve()


def test_invoke_imports_a_module_available_only_in_the_runtime(
    tmp_path: Path,
) -> None:
    runtime = ensure_environment(tmp_path, required=())
    site_packages = Path(run_python(
        runtime.python,
        "import site; print(site.getsitepackages()[0])",
    ))
    (site_packages / "runtime_only_probe.py").write_text(
        "VALUE = 'runtime-only'\n",
        encoding="utf-8",
    )

    result = invoke(
        tmp_path,
        ["-c", "import runtime_only_probe; print(runtime_only_probe.VALUE)"],
        required=(),
    )

    assert result.stdout.strip() == "runtime-only"


def test_invoke_rejects_a_host_callback_that_could_escape_the_runtime(
    tmp_path: Path,
) -> None:
    called: list[str] = []

    def operation(runtime: object) -> str:
        called.append("ran")
        return "must-not-happen"

    with pytest.raises(BootstrapError, match="runtime command"):
        invoke(tmp_path, operation, required=())

    assert called == []


def test_runtime_operation_does_not_inherit_outer_pythonpath(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    external = tmp_path / "outer"
    external.mkdir()
    (external / "outer_only.py").write_text(
        "VALUE = 'outer'\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("PYTHONPATH", str(external))

    with pytest.raises(BootstrapError, match="No module named"):
        invoke(
            tmp_path,
            ["-c", "import outer_only"],
            required=(),
        )


def test_required_dependency_probe_does_not_trust_outer_pythonpath(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    external = tmp_path / "outer"
    external.mkdir()
    (external / "outer_only.py").write_text(
        "VALUE = 'caller-only'\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("PYTHONPATH", str(external))
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError, match="caller-only-distribution"):
        ensure_environment(
            tmp_path,
            required=(("caller-only-distribution==1.0.0", "outer_only"),),
            install_timeout=5,
        )


def test_run_in_runtime_rejects_unprepared_or_noncanonical_runtime(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "forged-runtime-ran.txt"
    operation = [
        "-c",
        f"from pathlib import Path; Path({str(marker)!r}).write_text('ran')",
    ]

    for ready, directory, python in (
        (False, tmp_path / "not-a-runtime", Path(sys.executable)),
        (True, tmp_path / "also-not-a-runtime", Path(sys.executable)),
    ):
        forged = Runtime(
            project_root=tmp_path,
            directory=directory,
            python=python,
            ready=ready,
        )
        with pytest.raises(BootstrapError, match="prepared|canonical|usable"):
            run_in_runtime(forged, operation)

    assert not marker.exists()


def test_runtime_environment_rejects_protected_overrides(
    tmp_path: Path,
) -> None:
    import computer_use.bootstrap as bootstrap

    runtime = ensure_environment(tmp_path, required=())
    for name in (
        "PATH", "PYTHONHOME", "PYTHONNOUSERSITE", "PYTHONPATH", "VIRTUAL_ENV",
        "PIP_TARGET", "PIP_CACHE_DIR", "TMPDIR", "TMP", "TEMP", "pythonpath",
    ):
        with pytest.raises(BootstrapError, match="(?i)protected"):
            bootstrap._runtime_environment(runtime, {name: "outside"})


def test_compatible_release_requirement_has_an_upper_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import builtins
    import computer_use.bootstrap as bootstrap

    original_import = builtins.__import__

    def reject_packaging(name, *args, **kwargs):
        if name == "packaging" or name.startswith("packaging."):
            raise ModuleNotFoundError(name)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_packaging)

    assert not bootstrap._version_satisfies("2.0.0", "~=1.4")


def test_required_module_must_belong_to_named_distribution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError, match="t001-definitely-not-installed"):
        ensure_environment(
            tmp_path,
            required=(("t001-definitely-not-installed", "json"),),
            install_timeout=1,
        )


def test_wildcard_version_matching_normalizes_release_segments() -> None:
    import computer_use.bootstrap as bootstrap

    assert bootstrap._version_satisfies("1", "==1.0.*") is True
    assert bootstrap._version_satisfies("1.0", "==1.*") is True


def test_local_build_tag_wheel_satisfies_its_required_dependency(
    tmp_path: Path,
) -> None:
    wheel = tmp_path / "t001_build_probe-1.0.0-1-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr("build_probe.py", "VALUE = 'build-tag'\n")
        archive.writestr(
            "t001_build_probe-1.0.0.dist-info/METADATA",
            "Metadata-Version: 2.1\n"
            "Name: t001-build-probe\n"
            "Version: 1.0.0\n",
        )
        archive.writestr(
            "t001_build_probe-1.0.0.dist-info/WHEEL",
            "Wheel-Version: 1.0\n"
            "Generator: test\n"
            "Root-Is-Purelib: true\n"
            "Tag: py3-none-any\n",
        )
        archive.writestr("t001_build_probe-1.0.0.dist-info/RECORD", "")

    runtime = ensure_environment(
        tmp_path,
        required=((str(wheel), "build_probe"),),
        install_timeout=60,
    )

    assert runtime.ready is True


def test_requirement_parsing_does_not_import_caller_packaging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import builtins
    import computer_use.bootstrap as bootstrap

    imported: list[str] = []
    original_import = builtins.__import__

    def observe_packaging(name, *args, **kwargs):
        if name == "packaging" or name.startswith("packaging."):
            imported.append(name)
            raise ModuleNotFoundError(name)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", observe_packaging)

    assert bootstrap._package_requirement("probe-package>=1.0") == (
        "probe-package", ">=1.0"
    )
    assert imported == []


def test_invalid_dependency_module_is_rejected_before_runtime_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = tmp_path / "module-probe-ran.txt"
    module = (
        "json; from pathlib import Path; "
        f"Path({str(marker)!r}).write_text('ran')"
    )
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError, match="module|dependency"):
        ensure_environment(
            tmp_path,
            required=(("t001-invalid-probe>=1", module),),
            install_timeout=1,
        )

    assert not marker.exists()


def test_bootstrap_import_ignores_caller_shadowed_stdlib_json(
    tmp_path: Path,
) -> None:
    caller = tmp_path / "caller"
    caller.mkdir()
    marker = tmp_path / "bootstrap-json-imported.txt"
    (caller / "json.py").write_text(
        f"from pathlib import Path; Path({str(marker)!r}).write_text('ran')\n",
        encoding="utf-8",
    )
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join(
        (str(caller), str(Path(__file__).resolve().parents[3] / "scripts"))
    )

    result = subprocess.run(
        [sys.executable, "-c", "import computer_use.bootstrap"],
        cwd=tmp_path,
        env=environment,
        check=False,
        text=True,
        capture_output=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_path_discovery_does_not_trust_caller_suffix(
    tmp_path: Path,
) -> None:
    import computer_use.bootstrap as bootstrap

    fake_stdlib = tmp_path / "lib" / "python3.14"
    fake_stdlib.mkdir(parents=True)

    roots, _ = bootstrap._bootstrap_stdlib_paths([str(fake_stdlib)])

    assert fake_stdlib.resolve() not in roots


def test_bootstrap_does_not_use_preloaded_shadowed_stdlib_module(
    tmp_path: Path,
) -> None:
    caller = tmp_path / "caller"
    caller.mkdir()
    marker = tmp_path / "preloaded-json-used.txt"
    (caller / "json.py").write_text(
        "from pathlib import Path\n"
        f"_marker = Path({str(marker)!r})\n"
        "def dumps(*args, **kwargs):\n"
        "    _marker.write_text('used')\n"
        "    return '{}'\n",
        encoding="utf-8",
    )
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys; "
        f"sys.path.insert(0, {str(caller)!r}); "
        "import json; "
        f"sys.path.insert(0, {str(project)!r}); "
        "import computer_use.bootstrap as bootstrap; "
        f"bootstrap.ensure_environment(__import__('pathlib').Path({str(tmp_path)!r}), required=())"
    )
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)

    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=environment,
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_ignores_caller_meta_path_finders(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "meta-path-json-imported.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import importlib.abc, importlib.util, sys\n"
        "class Loader(importlib.abc.Loader):\n"
        "    def create_module(self, spec): return None\n"
        "    def exec_module(self, module):\n"
        f"        open({str(marker)!r}, 'w').write('ran')\n"
        "        module.dumps = lambda *args, **kwargs: '{}'\n"
        "class Finder(importlib.abc.MetaPathFinder):\n"
        "    def find_spec(self, fullname, path=None, target=None):\n"
        "        if fullname == 'json':\n"
        "            return importlib.util.spec_from_loader(fullname, Loader())\n"
        "        return None\n"
        "sys.meta_path.insert(0, Finder()); "
        f"sys.path.insert(0, {str(project)!r}); "
        "sys.modules.pop('json', None); "
        "import computer_use.bootstrap"
    )
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)

    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=environment,
        check=False,
        text=True,
        capture_output=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_imports_without_site_module_preloading(
    tmp_path: Path,
) -> None:
    project = Path(__file__).resolve().parents[3] / "scripts"
    result = subprocess.run(
        [
            sys.executable,
            "-S",
            "-c",
            f"import sys; sys.path.insert(0, {str(project)!r}); import computer_use.bootstrap",
        ],
        cwd=tmp_path,
        check=False,
        text=True,
        capture_output=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr


def test_invalid_package_option_is_rejected_before_pip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    package = f"--log={outside / 'pip.log'}"
    monkeypatch.setenv("PIP_INDEX_URL", "http://127.0.0.1:9/simple")

    with pytest.raises(BootstrapError):
        ensure_environment(
            tmp_path,
            required=((package, "missing_option_probe"),),
            install_timeout=1,
        )

    assert not (outside / "pip.log").exists()


def test_platform_stdlib_layouts_are_discovered_without_caller_entries() -> None:
    import computer_use.bootstrap as bootstrap

    versioned = f"python{sys.version_info.major}.{sys.version_info.minor}"
    original_prefix = bootstrap._bootstrap_sys.prefix
    original_base_prefix = bootstrap._bootstrap_sys.base_prefix
    original_platlibdir = getattr(bootstrap._bootstrap_sys, "platlibdir", None)
    original_hint = getattr(bootstrap._bootstrap_sys, "_stdlib_dir", None)
    try:
        fake_prefix = "/tmp/t001-platform-prefix"
        bootstrap._bootstrap_sys.prefix = fake_prefix
        bootstrap._bootstrap_sys.base_prefix = fake_prefix
        bootstrap._bootstrap_sys.platlibdir = "lib64"
        bootstrap._bootstrap_sys._stdlib_dir = None

        roots, _ = bootstrap._bootstrap_stdlib_paths(
            [f"{fake_prefix}/lib64/{versioned}"]
        )
        trusted = bootstrap._trusted_bootstrap_paths(
            [f"{fake_prefix}/Lib", f"{fake_prefix}/DLLs"]
        )

        assert bootstrap._canonical_bootstrap_path(
            f"{fake_prefix}/lib64/{versioned}"
        ) in roots
        assert bootstrap._canonical_bootstrap_path(
            f"{fake_prefix}/DLLs"
        ) in trusted
    finally:
        bootstrap._bootstrap_sys.prefix = original_prefix
        bootstrap._bootstrap_sys.base_prefix = original_base_prefix
        bootstrap._bootstrap_sys.platlibdir = original_platlibdir
        bootstrap._bootstrap_sys._stdlib_dir = original_hint


def test_fallback_bootstrap_path_resolves_symlinks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import computer_use.bootstrap as bootstrap

    target = tmp_path / "real-target"
    target.mkdir()
    alias = tmp_path / "symlink-alias"
    alias.symlink_to(target, target_is_directory=True)
    monkeypatch.setattr(bootstrap, "_bootstrap_os", None)

    assert bootstrap._canonical_bootstrap_path(str(alias)) == str(target)


def test_pep440_aliases_and_implicit_post_are_supported() -> None:
    import computer_use.bootstrap as bootstrap

    for actual, canonical in (
        ("1.0alpha1", "1.0a1"),
        ("1.0beta1", "1.0b1"),
        ("1.0pre1", "1.0rc1"),
        ("1.0preview1", "1.0rc1"),
        ("1.0-1", "1.0.post1"),
    ):
        assert bootstrap._parse_pep440_version(actual) is not None
        assert bootstrap._version_satisfies(actual, f"=={canonical}")


def test_pep440_excludes_prereleases_from_stable_ranges() -> None:
    import computer_use.bootstrap as bootstrap

    for actual, specifier in (
        ("1.0a1", "==1.0.*"),
        ("1.0rc1", "==1.0.*"),
        ("2.0a1", ">=1"),
        ("1.0.post1", ">1.0"),
        ("1.0.post1.dev1", "~=1.0"),
    ):
        assert not bootstrap._version_satisfies(actual, specifier)


def test_invalid_compatible_release_requirement_fails_closed() -> None:
    import computer_use.bootstrap as bootstrap

    assert bootstrap._package_requirement("probe-package~=1") is None
    assert not bootstrap._version_satisfies("1.5", "~=1")


def test_runtime_environments_remove_inherited_pythonuserbase(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import computer_use.bootstrap as bootstrap

    outside = tmp_path / "outside-userbase"
    outside.mkdir()
    monkeypatch.setenv("PYTHONUSERBASE", str(outside))
    runtime = ensure_environment(tmp_path, required=())

    assert "PYTHONUSERBASE" not in bootstrap._isolated_environment(tmp_path)
    assert "PYTHONUSERBASE" not in bootstrap._runtime_environment(runtime)


def test_invoke_does_not_run_operation_when_setup_fails(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "operation-ran.txt"
    operation = [
        "-c",
        f"from pathlib import Path; Path({str(marker)!r}).write_text('ran')",
    ]

    with pytest.raises(BootstrapError, match="no-such-package-xyz"):
        invoke(
            tmp_path,
            operation,
            required=(("no-such-package-xyz==0.0.0", "no_such_module_xyz"),),
        )

    assert not marker.exists()


def test_zero_exit_shell_script_is_not_a_usable_runtime(
    tmp_path: Path,
) -> None:
    area = runtime_directory(tmp_path)
    fake_bin = area / "bin"
    fake_bin.mkdir(parents=True)
    fake_python = fake_bin / "python"
    fake_python.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_python.chmod(0o755)
    (area / "pyvenv.cfg").write_text("fake\n", encoding="utf-8")

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_tmp_symlink_is_replaced_without_touching_target(
    tmp_path: Path,
) -> None:
    storage = tmp_path / "area"
    storage.mkdir()
    external = tmp_path / "external-tmp"
    external.mkdir()
    planted = external / "planted.txt"
    planted.write_text("external\n", encoding="utf-8")
    (storage / "tmp").symlink_to(external, target_is_directory=True)

    env = process_environment(storage)

    assert Path(env["TMPDIR"]).is_relative_to(storage)
    assert (storage / "tmp").is_dir()
    assert not (storage / "tmp").is_symlink()
    assert planted.read_text(encoding="utf-8") == "external\n"
    assert list(external.iterdir()) == [planted]


def test_pip_cache_symlink_is_replaced_without_touching_target(
    tmp_path: Path,
) -> None:
    storage = tmp_path / "area"
    storage.mkdir()
    external = tmp_path / "external-cache"
    external.mkdir()
    planted = external / "planted.txt"
    planted.write_text("external\n", encoding="utf-8")
    (storage / "pip-cache").symlink_to(external, target_is_directory=True)

    env = process_environment(storage)

    assert Path(env["PIP_CACHE_DIR"]).is_relative_to(storage)
    assert (storage / "pip-cache").is_dir()
    assert not (storage / "pip-cache").is_symlink()
    assert planted.read_text(encoding="utf-8") == "external\n"
    assert list(external.iterdir()) == [planted]


def test_environment_json_symlink_is_replaced_without_touching_target(
    tmp_path: Path,
) -> None:
    first = ensure_environment(tmp_path, required=())
    external = tmp_path / "external-meta"
    external.mkdir()
    planted = external / "planted.txt"
    planted.write_text("external\n", encoding="utf-8")
    (first.directory / "environment.json").unlink()
    (first.directory / "environment.json").symlink_to(planted)

    second = ensure_environment(tmp_path, required=())

    assert second.ready is True
    metadata = second.directory / "environment.json"
    assert metadata.is_file()
    assert not metadata.is_symlink()
    assert planted.read_text(encoding="utf-8") == "external\n"
    assert list(external.iterdir()) == [planted]


def test_regular_file_parent_is_repaired_into_working_runtime(
    tmp_path: Path,
) -> None:
    area = runtime_directory(tmp_path)
    blocker = area.parent.parent
    blocker.parent.mkdir(parents=True, exist_ok=True)
    blocker.write_text("not a directory\n", encoding="utf-8")

    runtime = ensure_environment(tmp_path, required=())

    assert runtime.ready is True
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_symlinked_parent_is_replaced_without_touching_target(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    area = runtime_directory(workspace)
    link_parent = area.parent
    link_parent.parent.mkdir(parents=True, exist_ok=True)
    external = tmp_path / "external-parent"
    external.mkdir()
    planted = external / "planted.txt"
    planted.write_text("external\n", encoding="utf-8")
    link_parent.symlink_to(external, target_is_directory=True)

    runtime = ensure_environment(workspace, required=())

    assert runtime.ready is True
    assert runtime.directory == area
    assert runtime.directory.is_dir()
    assert not link_parent.is_symlink()
    assert planted.read_text(encoding="utf-8") == "external\n"
    assert list(external.iterdir()) == [planted]
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_parent_symlink_to_valid_runtime_is_replaced(
    tmp_path: Path,
) -> None:
    other = tmp_path / "other"
    other.mkdir()
    other_runtime = ensure_environment(other, required=())
    other_metadata = other_runtime.directory / "environment.json"
    before = other_metadata.read_text(encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    area = runtime_directory(workspace)
    area.parent.parent.mkdir(parents=True, exist_ok=True)
    area.parent.parent.rmdir()
    area.parent.parent.symlink_to(
        other_runtime.directory.parent.parent, target_is_directory=True
    )

    runtime = ensure_environment(workspace, required=())

    assert runtime.ready is True
    assert runtime.directory == area
    assert not area.parent.parent.is_symlink()
    assert other_metadata.read_text(encoding="utf-8") == before
    assert run_python(runtime.python, "print(40 + 2)") == "42"


def test_non_posix_helper_fallback_does_not_open_caller_cwd_file() -> None:
    calls: list[str] = []

    class Native:
        O_CREAT = 1
        O_EXCL = 2
        O_RDWR = 4

        @staticmethod
        def open(path, flags, *args):
            calls.append(path)
            return 1

        @staticmethod
        def close(descriptor):
            return None

        @staticmethod
        def unlink(path):
            calls.append("unlink:" + path)

        @staticmethod
        def getpid():
            return 123

    roots, zips = bootstrap._bootstrap_clean_process_file_fallback(Native())

    assert isinstance(roots, set)
    assert isinstance(zips, set)
    assert calls == ["."]


def test_bootstrap_provenance_rejects_caller_identity_metadata(
    tmp_path: Path,
) -> None:
    project = Path(__file__).resolve().parents[3] / "scripts"
    marker = tmp_path / "provenance-marker.txt"
    code = (
        "import sys, types\n"
        "fake = types.ModuleType('os')\n"
        "fake.path = sys.modules['posixpath']\n"
        "fake.environ = {}\n"
        "fake.__spec__ = types.SimpleNamespace(origin='frozen')\n"
        "fake.pipe = lambda: open(" + repr(str(marker)) + ", 'w')\n"
        "sys.modules['os'] = fake\n"
        "sys.path.insert(0, " + repr(str(project)) + ")\n"
        "import computer_use.bootstrap\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        check=False,
        text=True,
        capture_output=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_ignores_a_preloaded_environment_object(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "environment-object-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "class ForgedEnvironment:\n"
        "    def __iter__(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return iter(())\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = ForgedEnvironment()\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_a_hostile_genuine_environment_backing_map(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "genuine-environment-map-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "class HostileMap(dict):\n"
        "    def __iter__(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return super().__iter__()\n"
        "environment_type = type(real_os.environ)\n"
        "forged_environment = environment_type.__new__(environment_type)\n"
        "forged_environment._data = HostileMap(real_os.environ._data)\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = forged_environment\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_non_string_environment_module_metadata(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "environment-module-metadata-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "environment_type = type(real_os.environ)\n"
        "class HostileModule:\n"
        "    def __eq__(self, other):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return True\n"
        "class SpoofedEnvironment(environment_type):\n"
        "    pass\n"
        "SpoofedEnvironment.__module__ = HostileModule()\n"
        "SpoofedEnvironment.__name__ = '_Environ'\n"
        "forged_environment = environment_type.__new__(SpoofedEnvironment)\n"
        "object.__getattribute__(forged_environment, '__dict__').update(\n"
        "    object.__getattribute__(real_os.environ, '__dict__')\n"
        ")\n"
        "object.__setattr__(forged_environment, '_data',\n"
        "                   dict(real_os.environ._data))\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = forged_environment\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_a_hostile_environment_getattribute(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "environment-getattribute-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "environment_type = type(real_os.environ)\n"
        "class SpoofedEnvironment(environment_type):\n"
        "    def __getattribute__(self, name):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return super().__getattribute__(name)\n"
        "SpoofedEnvironment.__module__ = 'os'\n"
        "SpoofedEnvironment.__name__ = '_Environ'\n"
        "forged_environment = environment_type.__new__(SpoofedEnvironment)\n"
        "object.__getattribute__(forged_environment, '__dict__').update(\n"
        "    object.__getattribute__(real_os.environ, '__dict__')\n"
        ")\n"
        "object.__setattr__(forged_environment, '_data',\n"
        "                   dict(real_os.environ._data))\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = forged_environment\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_code_matching_environment_globals(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "environment-method-globals-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import builtins, os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "environment_type = type(real_os.environ)\n"
        "real_iter = environment_type.__iter__\n"
        "real_list = builtins.list\n"
        "def hostile_list(value):\n"
        f"    open({str(marker)!r}, 'w').write('used')\n"
        "    return real_list(value)\n"
        "forged_iter = types.FunctionType(\n"
        "    real_iter.__code__,\n"
        "    {'list': hostile_list, '__builtins__': builtins.__dict__},\n"
        ")\n"
        "class SpoofedEnvironment(environment_type):\n"
        "    pass\n"
        "SpoofedEnvironment.__module__ = 'os'\n"
        "SpoofedEnvironment.__name__ = '_Environ'\n"
        "SpoofedEnvironment.__iter__ = forged_iter\n"
        "forged_environment = environment_type.__new__(SpoofedEnvironment)\n"
        "forged_environment.__dict__.update(real_os.environ.__dict__)\n"
        "forged_environment._data = dict(real_os.environ._data)\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = forged_environment\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_a_metadata_spoofed_environment_data_property(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "metadata-spoofed-environment-data-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "class SpoofedEnvironment:\n"
        "    @property\n"
        "    def _data(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return {}\n"
        "SpoofedEnvironment.__module__ = 'os'\n"
        "SpoofedEnvironment.__name__ = '_Environ'\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = SpoofedEnvironment()\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_a_hostile_environment_data_property(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "environment-data-property-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "class ForgedEnvironment:\n"
        "    @property\n"
        "    def _data(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return dict(real_os.environ._data)\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = ForgedEnvironment()\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_a_hostile_genuine_environment_callback(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "genuine-environment-callback-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import os, sys, types\n"
        "from pathlib import Path\n"
        "real_os = os\n"
        "environment_type = type(real_os.environ)\n"
        "forged_environment = environment_type.__new__(environment_type)\n"
        "forged_environment.__dict__.update(real_os.environ.__dict__)\n"
        "forged_environment._data = dict(real_os.environ._data)\n"
        "real_decode = forged_environment.decodekey\n"
        "def forged_decode(value):\n"
        f"    open({str(marker)!r}, 'w').write('used')\n"
        "    return real_decode(value)\n"
        "forged_environment.decodekey = forged_decode\n"
        "fake_os = types.ModuleType('os')\n"
        "fake_os.__dict__.update(real_os.__dict__)\n"
        "fake_os.environ = forged_environment\n"
        "sys.modules['os'] = fake_os\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_does_not_reuse_preloaded_transitive_stdlib_modules(
    tmp_path: Path,
) -> None:
    project = Path(__file__).resolve().parents[3] / "scripts"
    marker = tmp_path / "errno-marker.txt"
    code = (
        "import errno as real_errno, sys\n"
        "class ForgedErrno:\n"
        "    def __getattr__(self, name):\n"
        "        with open(" + repr(str(marker)) + ", 'w') as stream:\n"
        "            stream.write(name)\n"
        "        return getattr(real_errno, name)\n"
        "sys.modules['errno'] = ForgedErrno()\n"
        "sys.path.insert(0, " + repr(str(project)) + ")\n"
        "import computer_use.bootstrap\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        check=False,
        text=True,
        capture_output=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_bootstrap_rejects_non_dict_module_registry_without_iterating(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "module-registry-iterated.txt"
    source_path = Path(bootstrap.__file__)
    code = (
        "import importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('computer_use.bootstrap', {str(source_path)!r})\n"
        "code_object = spec.loader.get_code('computer_use.bootstrap')\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "real_modules = sys.modules\n"
        "class ForgedModules:\n"
        "    def __iter__(self):\n"
        f"        open({str(marker)!r}, 'w').write('iterated')\n"
        "        return iter(())\n"
        "    def __getitem__(self, key):\n"
        "        return real_modules[key]\n"
        "    def __setitem__(self, key, value):\n"
        "        return None\n"
        "sys.modules = ForgedModules()\n"
        "exec(code_object, module.__dict__)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert not marker.exists()
    assert result.returncode != 0


def test_pep440_dependency_comparison_matches_supported_boundaries() -> None:
    import computer_use.bootstrap as bootstrap

    assert not bootstrap._version_satisfies("2.0a0", "~=1.0a0")
    assert not bootstrap._version_satisfies(
        "1.0.post1+local", ">1.0.post0"
    )
    assert bootstrap._version_satisfies("1.0alpha1", "===1.0a1")


def test_public_path_data_descriptors_are_not_invoked_during_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "public-path-descriptor-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        "from pathlib import Path\n"
        "class DescriptorPath(type(Path())):\n"
        "    armed = False\n"
        "    @property\n"
        "    def _drv(self):\n"
        "        return self.__dict__.get('_stored_drv', '')\n"
        "    @_drv.setter\n"
        "    def _drv(self, value):\n"
        "        if type(self).armed:\n"
        f"            open({str(marker)!r}, 'w').write('used')\n"
        "        self.__dict__['_stored_drv'] = value\n"
        f"raw_workspace = DescriptorPath({str(tmp_path)!r})\n"
        "DescriptorPath.armed = True\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), "
        "workspace_root=raw_workspace, required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_public_path_hooks_are_not_invoked_during_setup_or_readiness(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "public-path-hooks-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        "from pathlib import Path\n"
        "class RawPath(type(Path())):\n"
        "    armed = False\n"
        "    def __setattr__(self, name, value):\n"
        "        if type(self).armed:\n"
        f"            open({str(marker)!r}, 'w').write('setattr')\n"
        "        return super().__setattr__(name, value)\n"
        "    def __str__(self):\n"
        "        if type(self).armed:\n"
        f"            open({str(marker)!r}, 'a').write('str')\n"
        "        return super().__str__()\n"
        f"raw_workspace = RawPath({str(tmp_path)!r})\n"
        "RawPath.armed = True\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment(Path({str(tmp_path)!r}), "
        "workspace_root=raw_workspace, required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_workspace_root_truthiness_is_not_evaluated_before_validation(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "workspace-truthiness-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        "class HostileWorkspace:\n"
        "    def __bool__(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return True\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "import computer_use.bootstrap as bootstrap\n"
        f"bootstrap.ensure_environment({str(tmp_path)!r}, "
        "workspace_root=HostileWorkspace(), required=())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert not marker.exists()


def test_install_timeout_is_validated_before_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "install-timeout-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        "class HostileTimeout:\n"
        "    def __lt__(self, other):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return False\n"
        "    def __float__(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return 1.0\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "from computer_use.bootstrap import ensure_environment\n"
        f"ensure_environment({str(tmp_path)!r}, required=(), "
        "install_timeout=HostileTimeout())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert "timeout" in result.stderr.lower()
    assert not marker.exists()


def test_operation_environment_mapping_is_validated_before_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "operation-env-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        "class HostileEnvironment:\n"
        "    def items(self):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return ()\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "from computer_use.bootstrap import invoke\n"
        f"invoke({str(tmp_path)!r}, ['-c', 'print(1)'], required=(), "
        "operation_env=HostileEnvironment())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert "environment" in result.stderr.lower()
    assert not marker.exists()


def test_operation_timeout_is_validated_before_setup(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "operation-timeout-used.txt"
    project = Path(__file__).resolve().parents[3] / "scripts"
    code = (
        "import sys\n"
        "class HostileTimeout:\n"
        "    def __lt__(self, other):\n"
        f"        open({str(marker)!r}, 'w').write('used')\n"
        "        return False\n"
        f"sys.path.insert(0, {str(project)!r})\n"
        "from computer_use.bootstrap import invoke\n"
        f"invoke({str(tmp_path)!r}, ['-c', 'print(1)'], required=(), "
        "operation_timeout=HostileTimeout())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
        check=False,
        text=True,
        capture_output=True,
        timeout=120,
    )

    assert result.returncode != 0
    assert "timeout" in result.stderr.lower()
    assert not marker.exists()


def test_preloaded_module_objects_are_not_called_during_bootstrap(
    tmp_path: Path,
) -> None:
    project = Path(__file__).resolve().parents[3] / "scripts"
    cases = (
        (
            "os",
            """
class ForgedOS:
    def __getattribute__(self, name):
        if name == '__dict__':
            open(MARKER, 'w').write('used')
        return object.__getattribute__(self, name)
sys.modules['os'] = ForgedOS()
""",
        ),
        (
            "frozen",
            """
class ForgedFrozen:
    def __getattribute__(self, name):
        if name == 'BuiltinImporter':
            open(MARKER, 'w').write('used')
        return object.__getattribute__(self, name)
sys.modules['_frozen_importlib'] = ForgedFrozen()
""",
        ),
    )
    for label, setup in cases:
        marker = tmp_path / f"preloaded-{label}-used.txt"
        code = (
            "import sys\n"
            f"MARKER = {str(marker)!r}\n"
            + setup
            + f"sys.path.insert(0, {str(project)!r})\n"
            "import computer_use.bootstrap\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=tmp_path,
            env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
            check=False,
            text=True,
            capture_output=True,
            timeout=120,
        )
        assert not marker.exists(), result.stderr


def test_startup_containers_are_not_iterated_before_authentication(
    tmp_path: Path,
) -> None:
    source = Path(bootstrap.__file__)
    project = source.parents[1]
    cases = (
        ("path", "path"),
        ("meta_path", "meta_path"),
        ("path_hooks", "path_hooks"),
        ("path_importer_cache", "path_importer_cache"),
        ("builtin_module_names", "builtin_module_names"),
        ("version_info", "version_info"),
    )
    for label, attribute in cases:
        marker = tmp_path / f"startup-{label}-used.txt"
        if attribute == "version_info":
            hostile = (
                "class Hostile:\n"
                "    def __getattribute__(self, name):\n"
                f"        open({str(marker)!r}, 'w').write('used')\n"
                "        return object.__getattribute__(self, name)\n"
            )
        else:
            hostile = (
                "class Hostile:\n"
                "    def __iter__(self):\n"
                f"        open({str(marker)!r}, 'w').write('used')\n"
                "        return iter(())\n"
            )
        code = (
            "import importlib.util, sys\n"
            f"spec = importlib.util.spec_from_file_location('bootstrap_probe', {str(source)!r})\n"
            "module = importlib.util.module_from_spec(spec)\n"
            "code_object = spec.loader.get_code('bootstrap_probe')\n"
            + hostile
            + f"sys.{attribute} = Hostile()\n"
            "exec(code_object, module.__dict__)\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=tmp_path,
            env={key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
            check=False,
            text=True,
            capture_output=True,
            timeout=120,
        )
        assert not marker.exists(), result.stderr


def test_hardlinked_environment_json_is_replaced_without_touching_external(
    tmp_path: Path,
) -> None:
    first = ensure_environment(tmp_path, required=())
    external = tmp_path / "external-inode"
    external.mkdir()
    planted = external / "planted.txt"
    planted.write_text("external\n", encoding="utf-8")
    metadata = first.directory / "environment.json"
    metadata.unlink()
    os.link(planted, metadata)

    second = ensure_environment(tmp_path, required=())

    assert second.ready is True
    assert planted.read_text(encoding="utf-8") == "external\n"
    assert list(external.iterdir()) == [planted]
    fresh = (second.directory / "environment.json").read_text(encoding="utf-8")
    assert "\"ready\": true" in fresh


if __name__ == "__main__":
    sys.exit(pytest.main([__file__]))
