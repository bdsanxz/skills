"""Prepare the skill's private isolated runtime on first use.

Every dependency the skill needs lives inside its own workspace-local
virtual environment. The operator never installs anything manually and the
global Python installation is never modified. Temporary files, caches, and
downloads stay below the runtime area as well.
"""

import sys as _bootstrap_sys
_bootstrap_list_type = type([])
_bootstrap_tuple_type = type(())
_bootstrap_dict_type = type({})
_bootstrap_module_type = type(_bootstrap_sys)
_bootstrap_function_type = type(lambda: None)
_bootstrap_code_type = type((lambda: None).__code__)
_bootstrap_classmethod_type = type(classmethod(lambda: None))
_bootstrap_staticmethod_type = type(staticmethod(lambda: None))
_bootstrap_sys_namespace = object.__getattribute__(
    _bootstrap_sys, "__dict__"
)


def _bootstrap_sys_value(name: str, default=None):
    if type(_bootstrap_sys_namespace) is not _bootstrap_dict_type:
        return default
    return dict.get(_bootstrap_sys_namespace, name, default)


def _bootstrap_copy_sequence(value) -> list:
    if type(value) is _bootstrap_list_type:
        return _bootstrap_list_type(value)
    if type(value) is _bootstrap_tuple_type:
        return _bootstrap_list_type(value)
    if isinstance(value, _bootstrap_list_type):
        return _bootstrap_list_type(_bootstrap_list_type.__iter__(value))
    if isinstance(value, _bootstrap_tuple_type):
        return _bootstrap_list_type(_bootstrap_tuple_type.__iter__(value))
    return []


def _bootstrap_copy_mapping(value):
    if type(value) is _bootstrap_dict_type:
        return _bootstrap_dict_type(value)
    if isinstance(value, _bootstrap_dict_type):
        copied = _bootstrap_dict_type()
        for key in _bootstrap_dict_type.keys(value):
            dict.__setitem__(
                copied, key, _bootstrap_dict_type.__getitem__(value, key)
            )
        return copied
    return None


_bootstrap_initial_executable = _bootstrap_sys_value("executable", "")
if type(_bootstrap_initial_executable) is not str:
    _bootstrap_initial_executable = ""
_bootstrap_initial_prefix = _bootstrap_sys_value("prefix", "")
if type(_bootstrap_initial_prefix) is not str:
    _bootstrap_initial_prefix = ""
_bootstrap_initial_base_prefix = _bootstrap_sys_value(
    "base_prefix", _bootstrap_initial_prefix
)
if type(_bootstrap_initial_base_prefix) is not str:
    _bootstrap_initial_base_prefix = _bootstrap_initial_prefix
_raw_version_info = _bootstrap_sys_value("version_info", ())
try:
    _version_major = tuple.__getitem__(_raw_version_info, 0)
    _version_minor = tuple.__getitem__(_raw_version_info, 1)
    if type(_version_major) is not int or type(_version_minor) is not int:
        raise TypeError
    _bootstrap_initial_version_info = (_version_major, _version_minor)
except (IndexError, TypeError):
    _bootstrap_initial_version_info = ()
_bootstrap_initial_path = [
    value for value in _bootstrap_copy_sequence(
        _bootstrap_sys_value("path", ())
    )
    if type(value) is str
]
_bootstrap_initial_meta_path = _bootstrap_copy_sequence(
    _bootstrap_sys_value("meta_path", ())
)
_bootstrap_initial_path_hooks = _bootstrap_copy_sequence(
    _bootstrap_sys_value("path_hooks", ())
)
_bootstrap_initial_importer_cache = _bootstrap_copy_mapping(
    _bootstrap_sys_value("path_importer_cache", {})
)
if _bootstrap_initial_importer_cache is None:
    _bootstrap_initial_importer_cache = {}
_bootstrap_initial_builtin_module_names = tuple(
    value for value in _bootstrap_copy_sequence(
        _bootstrap_sys_value("builtin_module_names", ())
    )
    if type(value) is str
)
# Replace caller-controlled startup containers before any later bootstrap
# helper can inspect them.  Exact module-dict access avoids module hooks.
dict.__setitem__(_bootstrap_sys_namespace, "path", _bootstrap_initial_path)
dict.__setitem__(
    _bootstrap_sys_namespace, "meta_path", _bootstrap_initial_meta_path
)
dict.__setitem__(
    _bootstrap_sys_namespace, "path_hooks", _bootstrap_initial_path_hooks
)
dict.__setitem__(
    _bootstrap_sys_namespace,
    "path_importer_cache",
    _bootstrap_initial_importer_cache,
)
dict.__setitem__(
    _bootstrap_sys_namespace,
    "builtin_module_names",
    _bootstrap_initial_builtin_module_names,
)
_bootstrap_original_registry_source = _bootstrap_sys_value("modules")
_bootstrap_original_registry = _bootstrap_copy_mapping(
    _bootstrap_original_registry_source
)
if _bootstrap_original_registry is None:
    raise ImportError("Could not establish a clean module registry")
_bootstrap_clean_registry = _bootstrap_copy_mapping(
    _bootstrap_original_registry
)
if _bootstrap_clean_registry is None:
    raise ImportError("Could not establish a clean module registry")
dict.__setitem__(
    _bootstrap_sys_namespace, "modules", _bootstrap_clean_registry
)

# These helpers are populated only after setup imports have crossed the
# trusted import boundary. Caller-preloaded modules are never used for it.
_bootstrap_os = None
_bootstrap_realpath = None
_bootstrap_islink = None
_bootstrap_readlink = None
_bootstrap_abspath = None
_bootstrap_clean_stdlib_names: set[str] = set()
_bootstrap_clean_path_entries: set[str] = set()
_bootstrap_native_module = None
_bootstrap_environment = None
_bootstrap_clean_os = None
_bootstrap_caller_environment = None
_bootstrap_os_executable = ""
_bootstrap_helper_provenance_verified = False


def _bootstrap_registry_get(name: str, default=None):
    registry = _bootstrap_sys_value("modules")
    if type(registry) is not _bootstrap_dict_type:
        return default
    try:
        return dict.__getitem__(registry, name)
    except KeyError:
        return default


def _lexical_bootstrap_path(entry: str) -> str:
    parts: list[str] = []
    normalized = entry.replace(chr(92), "/")
    absolute = normalized.startswith("/") or (
        len(normalized) > 2 and normalized[1] == ":"
    )
    for part in normalized.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            if parts and parts[-1] != "..":
                parts.pop()
            elif not absolute:
                parts.append(part)
            continue
        parts.append(part)
    if len(normalized) > 1 and normalized[1] == ":" and parts:
        parts = parts[1:]
    if normalized.startswith("/"):
        prefix = "/"
    elif len(normalized) > 1 and normalized[1] == ":":
        prefix = normalized[:2] + "/"
    else:
        prefix = ""
    return (prefix + "/".join(parts)).rstrip("/")


def _bootstrap_process_executable() -> str:
    """Read the running interpreter path from an OS-backed boundary."""

    if _bootstrap_os_executable:
        return _bootstrap_os_executable
    native = _bootstrap_native_module
    try:
        readlink = getattr(native, "readlink", None)
        if callable(readlink):
            value = readlink("/proc/self/exe")
            if type(value) is bytes:
                value = value.decode("utf-8")
            if type(value) is str and value:
                globals()["_bootstrap_os_executable"] = value
                return value
    except Exception:
        pass
    clean_frozen = globals().get("_bootstrap_clean_frozen")
    gcd_import = getattr(clean_frozen, "_gcd_import", None)
    if not callable(gcd_import):
        return ""
    saved_path = list(getattr(_bootstrap_sys, "path", ()))
    saved_meta_path = list(getattr(_bootstrap_sys, "meta_path", ()))
    saved_path_hooks = list(getattr(_bootstrap_sys, "path_hooks", ()))
    saved_importer_cache = dict(
        getattr(_bootstrap_sys, "path_importer_cache", {})
    )
    clean_meta_path = globals().get("_bootstrap_standard_meta_path")
    clean_path_hooks = globals().get("_bootstrap_standard_path_hooks")
    try:
        _bootstrap_sys.path[:] = [
            value for value in _bootstrap_initial_path
            if type(value) is str and _bootstrap_startup_entry_is_trusted(value)
        ]
        if clean_meta_path and clean_path_hooks:
            _bootstrap_sys.meta_path[:] = clean_meta_path
            _bootstrap_sys.path_hooks[:] = clean_path_hooks
            _bootstrap_sys.path_importer_cache.clear()
        modules = getattr(_bootstrap_sys, "modules", None)
        if isinstance(modules, dict):
            for name in (
                "ctypes", "_ctypes", "os", "posixpath", "ntpath",
                "genericpath", "struct", "_struct",
            ):
                try:
                    dict.__delitem__(modules, name)
                except KeyError:
                    pass
        ctypes_module = gcd_import("ctypes")
        cdll = getattr(ctypes_module, "CDLL", None)
        uint32 = getattr(ctypes_module, "c_uint32", None)
        void_p = getattr(ctypes_module, "c_void_p", None)
        pointer = getattr(ctypes_module, "POINTER", None)
        byref = getattr(ctypes_module, "byref", None)
        create_buffer = getattr(ctypes_module, "create_string_buffer", None)
        if all(callable(value) for value in (
            cdll, uint32, void_p, pointer, byref, create_buffer
        )):
            size = uint32(4096)
            buffer = create_buffer(size.value)
            function = getattr(cdll(None), "_NSGetExecutablePath", None)
            if callable(function):
                function.argtypes = (void_p, pointer(uint32))
                function.restype = int
                if function(buffer, byref(size)) == 0:
                    value = buffer.value.decode("utf-8")
                    if value:
                        globals()["_bootstrap_os_executable"] = value
                        return value
        windll = getattr(ctypes_module, "windll", None)
        kernel32 = getattr(windll, "kernel32", None)
        create_unicode_buffer = getattr(
            ctypes_module, "create_unicode_buffer", None
        )
        if kernel32 is not None and callable(create_unicode_buffer):
            buffer = create_unicode_buffer(32768)
            length = kernel32.GetModuleFileNameW(None, buffer, len(buffer))
            if type(length) is int and length > 0:
                value = buffer.value
                globals()["_bootstrap_os_executable"] = value
                return value
    except Exception:
        pass
    finally:
        _bootstrap_sys.path[:] = saved_path
        _bootstrap_sys.meta_path[:] = saved_meta_path
        _bootstrap_sys.path_hooks[:] = saved_path_hooks
        _bootstrap_sys.path_importer_cache.clear()
        _bootstrap_sys.path_importer_cache.update(saved_importer_cache)
    return ""


def _bootstrap_executable_is_trusted(path: str) -> bool:
    normalized = _lexical_bootstrap_path(path).casefold()
    if not normalized:
        return False
    parent = normalized.rsplit("/", 1)[0] if "/" in normalized else ""
    if parent.rsplit("/", 1)[-1] in {"bin", "scripts"}:
        parent = parent.rsplit("/", 1)[0]
    prefixes = (
        _bootstrap_initial_prefix, _bootstrap_initial_base_prefix,
    )
    for value in prefixes:
        if type(value) is not str or not value:
            continue
        prefix = _lexical_bootstrap_path(value).casefold()
        anchors = {prefix}
        if "/frameworks/" in prefix:
            anchors.add(prefix.split("/frameworks/", 1)[0])
        if any(parent == anchor or parent.startswith(anchor + "/")
               for anchor in anchors if anchor):
            return True
    return any(
        normalized.startswith(prefix)
        for prefix in (
            "/usr/bin/", "/usr/local/bin/", "/opt/homebrew/",
            "/applications/", "/system/", "/library/frameworks/",
        )
    ) or (
        len(normalized) > 2
        and normalized[1] == ":"
        and parent.rsplit("/", 1)[-1] in {"python", "scripts"}
    )


def _bootstrap_executable_candidates(
    entries: "list[str] | None" = None,
) -> tuple[str, ...]:
    """Return only a process-captured executable in an interpreter root."""

    del entries
    executable = _bootstrap_process_executable()
    if (
        type(executable) is str
        and executable
        and _bootstrap_executable_is_trusted(executable)
    ):
        return (executable,)
    return ()


def _bootstrap_load_frozen(
    name: str, imp_module: object, builtins_map: "dict | None" = None
) -> "object | None":
    getter = getattr(imp_module, "get_frozen_object", None)
    if not callable(getter):
        return None
    try:
        module = type(_bootstrap_sys)(name + "__clean")
        module.__name__ = name
        module.__package__ = ""
        module.__spec__ = None
        if builtins_map is not None:
            module.__builtins__ = builtins_map
        exec(getter(name), module.__dict__)
        return module
    except (AttributeError, ImportError, TypeError, ValueError):
        return None


def _bootstrap_load_builtin(
    name: str, finder: object
) -> "object | None":
    try:
        spec = finder.find_spec(name)
        if spec is None:
            return None
        module = finder.create_module(spec)
        finder.exec_module(module)
        return module
    except (AttributeError, ImportError, TypeError, ValueError):
        return None


def _bootstrap_binary_is_interpreter(
    path: str, native: object
) -> bool:
    authenticated = _bootstrap_process_executable()
    normalized = path.replace(chr(92), "/")
    is_windows_candidate = (
        len(normalized) > 2
        and normalized[1] == ":"
        and normalized.rsplit("/", 1)[-1].casefold() == "python.exe"
    )
    if native is _bootstrap_native_module:
        if (
            not authenticated
            or path != authenticated
            or not _bootstrap_executable_is_trusted(authenticated)
        ):
            return False
    elif not is_windows_candidate:
        return False
    open_file = getattr(native, "open", None)
    read = getattr(native, "read", None)
    close = getattr(native, "close", None)
    if not all(callable(value) for value in (open_file, read, close)):
        return False
    descriptor = None
    try:
        descriptor = open_file(path, getattr(native, "O_RDONLY", 0))
        header = read(descriptor, 1024 * 1024)
    except Exception:
        return False
    finally:
        try:
            if descriptor is not None:
                close(descriptor)
        except Exception:
            pass
    if type(header) is not bytes:
        return False
    native_header = header[:4]
    magic = native_header in {
        b"\x7fELF",
        bytes((0xCF, 0xFA, 0xED, 0xFE)),
        bytes((0xFE, 0xED, 0xFA, 0xCF)),
        bytes((0xCA, 0xFE, 0xBA, 0xBE)),
        bytes((0xBE, 0xBA, 0xFE, 0xCA)),
    }
    if header[:2] == b"MZ":
        magic = True
    if native is _bootstrap_native_module:
        return magic
    return is_windows_candidate and header[:2] == b"MZ"


def _bootstrap_clean_process_file_fallback(
    native: object,
) -> tuple[set[str], set[str]]:
    """Use authenticated startup paths without creating caller-cwd files."""

    open_file = getattr(native, "open", None)
    close = getattr(native, "close", None)
    if callable(open_file) and callable(close):
        descriptor = None
        try:
            descriptor = open_file(
                ".", getattr(native, "O_RDONLY", 0), 0
            )
        except Exception:
            pass
        finally:
            try:
                if descriptor is not None:
                    close(descriptor)
            except Exception:
                pass
    return _bootstrap_startup_stdlib_paths(_bootstrap_initial_path)


def _bootstrap_parse_helper_output(
    output: list[str],
) -> tuple[set[str], set[str]]:
    if not output:
        return set(), set()
    try:
        major, minor = (int(part) for part in output[0].split()[:2])
    except (IndexError, ValueError):
        return set(), set()
    versioned = f"python{major}.{minor}"
    archive = f"python{major}{minor}.zip"
    roots: set[str] = set()
    zips: set[str] = set()
    clean_names: set[str] = set()
    clean_entries: set[str] = set()
    for value in output[1:]:
        if value.startswith("P:"):
            entry = _lexical_bootstrap_path(value[2:])
            clean_entries.add(value[2:])
            lowered = entry.casefold()
            if lowered.endswith("/" + versioned.casefold()) or lowered.endswith(
                "/lib"
            ) or lowered.endswith("/lib64"):
                roots.add(entry)
            if lowered.endswith("/" + archive.casefold()):
                zips.add(entry)
        elif value.startswith("M:"):
            clean_names.add(value[2:])
    _bootstrap_clean_stdlib_names.clear()
    _bootstrap_clean_stdlib_names.update(clean_names)
    _bootstrap_clean_path_entries.clear()
    _bootstrap_clean_path_entries.update(clean_entries)
    return roots, zips


def _bootstrap_clean_process_paths() -> tuple[set[str], set[str]]:
    """Read interpreter paths from a clean child without importing caller code."""

    native = _bootstrap_native_module
    if native is None:
        return set(), set()
    pipe = getattr(native, "pipe", None)
    spawn = getattr(native, "posix_spawn", None)
    waitpid = getattr(native, "waitpid", None)
    read = getattr(native, "read", None)
    close = getattr(native, "close", None)
    dup2 = getattr(native, "dup2", None)
    if not all(callable(value) for value in (pipe, spawn, waitpid, read, close, dup2)):
        return _bootstrap_clean_process_file_fallback(native)
    executable = next(
        (
            candidate for candidate in _bootstrap_executable_candidates()
            if _bootstrap_binary_is_interpreter(candidate, native)
        ),
        "",
    )
    if not executable:
        return set(), set()
    code = (
        "import sys\n"
        "lines = [f'{sys.version_info.major} {sys.version_info.minor}']\n"
        "lines.extend('P:' + value for value in sys.path if value)\n"
        "lines.extend('M:' + value for value in sorted("
        "getattr(sys, 'stdlib_module_names', ())))\n"
        "print('\\n'.join(lines), end='')\n"
    )
    try:
        read_fd, write_fd = pipe()
        environment = {
            "PATH": "/usr/bin:/bin",
            "PYTHONNOUSERSITE": "1",
            "PYTHONPATH": "",
        }
        actions = [
            (getattr(native, "POSIX_SPAWN_DUP2"), write_fd, 1),
            (getattr(native, "POSIX_SPAWN_CLOSE"), read_fd),
            (getattr(native, "POSIX_SPAWN_CLOSE"), write_fd),
        ]
        child = spawn(
            executable,
            [executable, "-S", "-c", code],
            environment,
            file_actions=actions,
        )
        close(write_fd)
        chunks: list[bytes] = []
        while True:
            chunk = read(read_fd, 4096)
            if not chunk:
                break
            chunks.append(chunk)
        close(read_fd)
        _, status = waitpid(child, 0)
        if status != 0:
            return set(), set()
        output = b"".join(chunks).decode("utf-8").splitlines()
    except (OSError, ValueError, TypeError, UnicodeError, AttributeError):
        try:
            close(write_fd)
        except (OSError, UnboundLocalError):
            pass
        try:
            close(read_fd)
        except (OSError, UnboundLocalError):
            pass
        return set(), set()
    return _bootstrap_parse_helper_output(output)


def _fallback_bootstrap_symlink_path(entry: str) -> str:
    candidate = entry
    if _bootstrap_abspath is not None:
        try:
            candidate = _bootstrap_abspath(candidate)
        except (OSError, ValueError):
            pass
    for _ in range(40):
        candidate = _lexical_bootstrap_path(candidate)
        if _bootstrap_islink is None or _bootstrap_readlink is None:
            return candidate
        parts = candidate.split("/")
        resolved = False
        # Keep the leading filesystem anchor lexical while resolving every
        # owned component below it. This preserves portable display paths
        # such as /var while still rejecting a linked runtime subdirectory.
        start = 2 if candidate.startswith("/") else 0
        for index in range(start, len(parts)):
            component = "/".join(parts[: index + 1])
            if candidate.startswith("/"):
                component = "/" + component.lstrip("/")
            try:
                if not _bootstrap_islink(component):
                    continue
                target = _bootstrap_readlink(component)
            except (OSError, ValueError):
                return candidate
            remainder = "/".join(parts[index + 1 :])
            if target.startswith(("/", "\\")):
                candidate = target
            else:
                parent = component.rsplit("/", 1)[0] or "."
                candidate = parent + "/" + target
            if remainder:
                candidate += "/" + remainder
            resolved = True
            break
        if not resolved:
            return candidate
    return _lexical_bootstrap_path(candidate)


def _canonical_bootstrap_path(entry: str) -> str:
    """Canonicalize an import entry before comparing its trust boundary."""

    if _bootstrap_os is None and _bootstrap_islink is not None:
        return _fallback_bootstrap_symlink_path(entry)
    if _bootstrap_realpath is not None:
        try:
            return _bootstrap_realpath(entry).replace(
                chr(92), "/"
            ).rstrip("/")
        except (OSError, ValueError):
            return ""
    return _lexical_bootstrap_path(entry)


def _bootstrap_path_join(*parts: str) -> str:
    if _bootstrap_os is not None:
        return _bootstrap_os.path.join(*parts)
    if not parts:
        return ""
    absolute = parts[0].startswith(("/", "\\"))
    joined = "/".join(part.strip("/\\") for part in parts)
    return ("/" if absolute else "") + joined


def _bootstrap_stdlib_paths(entries: list[str]) -> tuple[set[str], set[str]]:
    """Describe the platform layout requested by a direct helper caller."""

    del entries
    version = _bootstrap_initial_version_info
    if (
        type(version) is not tuple
        or len(version) != 2
        or type(version[0]) is not int
        or type(version[1]) is not int
    ):
        return set(), set()
    versioned = f"python{version[0]}.{version[1]}"
    roots: set[str] = set()
    hint = _bootstrap_sys_value("_stdlib_dir")
    if type(hint) is str and hint:
        roots.add(_canonical_bootstrap_path(hint))
    platlibdir = _bootstrap_sys_value("platlibdir", "lib")
    if type(platlibdir) is not str or not platlibdir.isidentifier():
        platlibdir = "lib"
    libdirs = {"lib", platlibdir}
    for prefix in (
        _bootstrap_sys_value("prefix", ""),
        _bootstrap_sys_value("base_prefix", ""),
    ):
        if type(prefix) is not str or not prefix:
            continue
        for libdir in libdirs:
            roots.add(_canonical_bootstrap_path(
                _bootstrap_path_join(prefix, libdir, versioned)
            ))
        roots.add(_canonical_bootstrap_path(
            _bootstrap_path_join(prefix, "Lib")
        ))
    roots.discard("")
    archive = f"python{version[0]}{version[1]}.zip"
    zip_paths = {
        _canonical_bootstrap_path(
            _bootstrap_path_join(root.rsplit("/", 1)[0], archive)
        )
        for root in roots
    }
    zip_paths.discard("")
    return roots, zip_paths


def _bootstrap_startup_entry_is_trusted(path: str) -> bool:
    normalized = _lexical_bootstrap_path(path).casefold()
    if not normalized:
        return False
    if len(normalized) > 2 and normalized[1] == ":" and normalized[2] == "/":
        return _bootstrap_executable_is_trusted(normalized)
    return any(
        normalized.startswith(prefix)
        for prefix in (
            "/usr/", "/opt/homebrew/", "/applications/",
            "/library/", "/system/",
        )
    )


def _bootstrap_startup_stdlib_paths(
    entries: list[str],
) -> tuple[set[str], set[str]]:
    """Find fallback roots only after static interpreter authentication."""

    version_info = _bootstrap_initial_version_info
    if (
        type(version_info) is not tuple
        or len(version_info) != 2
        or type(version_info[0]) is not int
        or type(version_info[1]) is not int
    ):
        return set(), set()
    versioned = f"python{version_info[0]}.{version_info[1]}".casefold()
    initial_verified = False
    if (
        _bootstrap_native_module is not None
        and type(_bootstrap_initial_executable) is str
        and _bootstrap_initial_executable
    ):
        initial_verified = _bootstrap_binary_is_interpreter(
            _bootstrap_initial_executable, _bootstrap_native_module
        )
    roots: set[str] = set()
    for value in entries:
        if type(value) is not str or not value:
            continue
        canonical = _lexical_bootstrap_path(value)
        lowered = canonical.casefold()
        if not (
            _bootstrap_startup_entry_is_trusted(canonical)
            or (initial_verified and _bootstrap_executable_is_trusted(canonical))
        ):
            continue
        if (
            lowered.endswith("/" + versioned)
            or lowered.endswith("/lib")
            or lowered.endswith("/lib64")
            or lowered.endswith("/lib-dynload")
            or lowered.endswith("/dlls")
        ):
            if lowered.endswith("/lib-dynload") or lowered.endswith("/dlls"):
                canonical = canonical.rsplit("/", 1)[0]
            roots.add(canonical)
    if not roots:
        for value in (
            _bootstrap_initial_prefix, _bootstrap_initial_base_prefix,
        ):
            if type(value) is not str or not value:
                continue
            prefix = _lexical_bootstrap_path(value)
            for libdir in ("lib", "lib64"):
                candidate = _lexical_bootstrap_path(
                    _bootstrap_path_join(prefix, libdir, versioned)
                )
                if (
                    initial_verified
                    and _bootstrap_executable_is_trusted(candidate)
                ):
                    roots.add(candidate)
            candidate = _lexical_bootstrap_path(
                _bootstrap_path_join(prefix, "Lib")
            )
            if (
                initial_verified
                and _bootstrap_executable_is_trusted(candidate)
            ):
                roots.add(candidate)
    roots.discard("")
    archive = f"python{version_info[0]}{version_info[1]}.zip"
    zip_paths = {
        _canonical_bootstrap_path(
            _bootstrap_path_join(root.rsplit("/", 1)[0], archive)
        )
        for root in roots
    }
    zip_paths.discard("")
    return roots, zip_paths


def _trusted_bootstrap_paths(
    entries: list[str],
    roots: "set[str] | None" = None,
    zip_paths: "set[str] | None" = None,
) -> list[str]:
    verified_roots = roots is not None
    roots = roots if roots is not None else _bootstrap_stdlib_paths(entries)[0]
    zip_paths = (
        zip_paths
        if zip_paths is not None
        else _bootstrap_stdlib_paths(entries)[1]
    )
    trusted = set(roots) | set(zip_paths)
    for root in roots:
        trusted.add(
            _canonical_bootstrap_path(
                _bootstrap_path_join(root, "lib-dynload")
            )
        )
    if not verified_roots:
        prefixes = (
            _bootstrap_sys_value("prefix", ""),
            _bootstrap_sys_value("base_prefix", ""),
        )
        for prefix in prefixes:
            if isinstance(prefix, str) and prefix:
                trusted.add(
                    _canonical_bootstrap_path(
                        _bootstrap_path_join(prefix, "DLLs")
                    )
                )
    else:
        for entry in entries:
            canonical = _canonical_bootstrap_path(entry)
            if canonical.endswith("/DLLs"):
                parent = canonical.rsplit("/", 1)[0]
                if _canonical_bootstrap_path(parent + "/Lib") in roots:
                    trusted.add(canonical)
    trusted.discard("")
    return [
        canonical
        for entry in entries
        if (canonical := _canonical_bootstrap_path(entry)) in trusted
    ]


def _bootstrap_executable_prefix(executable: str) -> str:
    executable = executable.replace(chr(92), "/").rstrip("/")
    parent = executable.rsplit("/", 1)[0] if "/" in executable else ""
    if parent.rsplit("/", 1)[-1].casefold() in {"bin", "scripts"}:
        parent = parent.rsplit("/", 1)[0]
    return parent


def _bootstrap_import_stdlib_paths(
    entries: list[str],
) -> tuple[set[str], set[str]]:
    """Obtain roots from a clean helper or authenticated startup paths."""

    global _bootstrap_helper_provenance_verified
    del entries
    roots, zip_paths = _clean_interpreter_paths()
    if roots:
        _bootstrap_helper_provenance_verified = True
        return roots, zip_paths
    return _bootstrap_startup_stdlib_paths(_bootstrap_initial_path)


def _clean_interpreter_paths() -> tuple[set[str], set[str]]:
    """Ask an independently spawned ``-S`` interpreter for setup roots."""

    return _bootstrap_clean_process_paths()


_bootstrap_original_path = _bootstrap_list_type(_bootstrap_initial_path)
_bootstrap_path_entries = _bootstrap_list_type(_bootstrap_initial_path)
_bootstrap_original_meta_path = _bootstrap_list_type(_bootstrap_initial_meta_path)
_bootstrap_original_path_hooks = _bootstrap_list_type(_bootstrap_initial_path_hooks)
_bootstrap_original_importer_cache = _bootstrap_dict_type(
    _bootstrap_initial_importer_cache
)
_bootstrap_caller_os = _bootstrap_registry_get("os")
_bootstrap_caller_pathlib = _bootstrap_registry_get("pathlib")
if type(_bootstrap_caller_os) is _bootstrap_module_type:
    try:
        _bootstrap_caller_namespace = object.__getattribute__(
            _bootstrap_caller_os, "__dict__"
        )
    except AttributeError:
        _bootstrap_caller_namespace = None
    if type(_bootstrap_caller_namespace) is _bootstrap_dict_type:
        _bootstrap_caller_environment = dict.get(
            _bootstrap_caller_namespace, "environ"
        )
def _bootstrap_pathlib_cache_is_safe(candidate: object) -> bool:
    """Restore only a standard pathlib cache without using its methods."""

    try:
        if type(candidate) is not type(_bootstrap_sys):
            return False
        namespace = object.__getattribute__(candidate, "__dict__")
        if type(namespace) is not dict:
            return False
        cached_path = dict.get(namespace, "Path")
        if type(cached_path) is not type:
            return False
        clean_path = Path
        if type(clean_path) is not type:
            return False
        cached_mro = type.__getattribute__(cached_path, "__mro__")
        clean_mro = type.__getattribute__(clean_path, "__mro__")
        if len(cached_mro) != len(clean_mro):
            return False
        for cached_base, clean_base in zip(cached_mro, clean_mro):
            if cached_base is clean_base:
                continue
            if type(cached_base) is not type or type(clean_base) is not type:
                return False
            cached_module = type.__getattribute__(cached_base, "__module__")
            clean_module = type.__getattribute__(clean_base, "__module__")
            cached_name = type.__getattribute__(cached_base, "__name__")
            clean_name = type.__getattribute__(clean_base, "__name__")
            if not all(
                type(value) is str
                for value in (
                    cached_module, clean_module, cached_name, clean_name,
                )
            ) or (
                cached_module != clean_module or cached_name != clean_name
            ):
                return False
        storage_name = _bootstrap_clean_path_storage_name
        clean_descriptor = _bootstrap_clean_raw_paths_descriptor
        if type(storage_name) is not str or clean_descriptor is None:
            return False
        cached_descriptor = None
        for owner in cached_mro:
            owner_namespace = type.__getattribute__(owner, "__dict__")
            if storage_name in owner_namespace:
                cached_descriptor = owner_namespace[storage_name]
                break
        return (
            cached_descriptor is not None
            and type(cached_descriptor) is type(clean_descriptor)
        )
    except (AttributeError, KeyError, TypeError, ValueError):
        return False


def _bootstrap_raw_class_member(
    candidate: object, name: str, default=None
):
    if type(candidate) is not type:
        return default
    try:
        mro = type.__getattribute__(candidate, "__mro__")
        for owner in mro:
            namespace = type.__getattribute__(owner, "__dict__")
            try:
                return namespace[name]
            except KeyError:
                continue
    except (AttributeError, KeyError, TypeError):
        return default
    return default


def _bootstrap_finder_candidate_is_safe(candidate: object) -> bool:
    origin = _bootstrap_raw_class_member(candidate, "_ORIGIN")
    if type(origin) is not str or origin != "built-in":
        return False
    classmethod_names = {
        "find_spec", "get_code", "get_source", "is_package", "load_module",
    }
    for name in (
        "find_spec", "create_module", "exec_module", "get_code",
        "get_source", "is_package", "load_module",
    ):
        descriptor = _bootstrap_raw_class_member(candidate, name)
        expected_types = (
            (_bootstrap_classmethod_type,)
            if name in classmethod_names
            else (_bootstrap_classmethod_type, _bootstrap_staticmethod_type)
        )
        if type(descriptor) not in expected_types:
            return False
        try:
            function = object.__getattribute__(descriptor, "__func__")
            code = object.__getattribute__(function, "__code__")
            filename = object.__getattribute__(code, "co_filename")
        except (AttributeError, TypeError):
            return False
        if (
            type(function) is not _bootstrap_function_type
            or type(code) is not _bootstrap_code_type
            or type(filename) is not str
            or filename != "<frozen importlib._bootstrap>"
        ):
            return False
    return True


def _bootstrap_cached_builtin_finder() -> "object | None":
    frozen_module = _bootstrap_registry_get("_frozen_importlib")
    if type(frozen_module) is _bootstrap_module_type:
        try:
            namespace = object.__getattribute__(frozen_module, "__dict__")
        except AttributeError:
            namespace = None
        if type(namespace) is _bootstrap_dict_type:
            candidate = dict.get(namespace, "BuiltinImporter")
            if _bootstrap_finder_candidate_is_safe(candidate):
                return candidate
    for candidate in _bootstrap_initial_meta_path:
        if _bootstrap_finder_candidate_is_safe(candidate):
            return candidate
    return None


_bootstrap_builtin_source = _bootstrap_cached_builtin_finder()
if _bootstrap_builtin_source is None:
    raise ImportError("Could not establish the builtin importer")
try:
    dict.__delitem__(_bootstrap_sys.modules, "_imp")
except KeyError:
    pass
_bootstrap_imp = _bootstrap_load_builtin("_imp", _bootstrap_builtin_source)
if _bootstrap_imp is None:
    raise ImportError("Could not establish a clean _imp module")
_bootstrap_sys.modules["_imp"] = _bootstrap_imp
_bootstrap_early_native_module = None
for _native_name in ("posix", "nt"):
    _bootstrap_early_native_module = _bootstrap_load_builtin(
        _native_name, _bootstrap_builtin_source
    )
    if _bootstrap_early_native_module is not None:
        _bootstrap_sys.modules[_native_name] = _bootstrap_early_native_module
        if type(_bootstrap_original_registry_source) is _bootstrap_dict_type:
            dict.__setitem__(
                _bootstrap_original_registry_source,
                _native_name,
                _bootstrap_early_native_module,
            )
        break
if _bootstrap_early_native_module is None:
    raise ImportError("Could not establish clean native filesystem support")
_bootstrap_early_io_module = _bootstrap_load_builtin(
    "_io", _bootstrap_builtin_source
)
if _bootstrap_early_io_module is None:
    raise ImportError("Could not establish clean I/O support")
_bootstrap_sys.modules["_io"] = _bootstrap_early_io_module
if type(_bootstrap_original_registry_source) is _bootstrap_dict_type:
    dict.__setitem__(
        _bootstrap_original_registry_source, "_io", _bootstrap_early_io_module
    )
_bootstrap_builtins_module = _bootstrap_registry_get("builtins")
if type(_bootstrap_builtins_module) is not _bootstrap_module_type:
    raise ImportError("Could not establish the builtins module")
_bootstrap_builtins_namespace = object.__getattribute__(
    _bootstrap_builtins_module, "__dict__"
)
if type(_bootstrap_builtins_namespace) is not _bootstrap_dict_type:
    raise ImportError("Could not establish the builtins module")
_bootstrap_original_import = dict.get(
    _bootstrap_builtins_namespace, "__import__"
)
_bootstrap_clean_builtins = _bootstrap_dict_type(_bootstrap_builtins_namespace)


def _bootstrap_bare_import(
    name, globals=None, locals=None, fromlist=(), level=0
):
    if level:
        package = (globals or {}).get("__package__")
        if (
            package
            and globals is not None
            and _bootstrap_clean_frozen is not None
        ):
            absolute = _bootstrap_clean_frozen._resolve_name(
                name, package, level
            )
            imported = _bootstrap_clean_frozen._gcd_import(absolute)
            if fromlist:
                for item in fromlist:
                    if type(item) is not str or item == "*":
                        continue
                    if not hasattr(imported, item):
                        _bootstrap_clean_frozen._gcd_import(
                            absolute + "." + item
                        )
                return imported
            return _bootstrap_clean_frozen._gcd_import(
                absolute.split(".", 1)[0]
            )
        raise ImportError("relative import has no clean package")
    if name == "sys":
        module = _bootstrap_sys
    elif name == "_imp":
        module = _bootstrap_imp
    elif name in {"_thread", "_warnings", "_weakref", "_io", "marshal"}:
        module = _bootstrap_load_builtin(name, _bootstrap_builtin_source)
    else:
        module = _bootstrap_registry_get(name)
        if module is None and _bootstrap_clean_frozen is not None:
            module = _bootstrap_clean_frozen._gcd_import(name)
    if module is None:
        raise ImportError(name)
    if fromlist:
        for item in fromlist:
            if type(item) is not str or item == "*":
                continue
            if not hasattr(module, item) and _bootstrap_clean_frozen is not None:
                _bootstrap_clean_frozen._gcd_import(name + "." + item)
        return module
    if "." in name and _bootstrap_clean_frozen is not None:
        return _bootstrap_clean_frozen._gcd_import(name.split(".", 1)[0])
    return module


_bootstrap_clean_builtins["__import__"] = _bootstrap_bare_import
_bootstrap_clean_frozen = _bootstrap_load_frozen(
    "_frozen_importlib", _bootstrap_imp, _bootstrap_clean_builtins
)
if _bootstrap_clean_frozen is None:
    raise ImportError("Could not establish a clean frozen importer")
_bootstrap_clean_frozen._imp = _bootstrap_imp
_bootstrap_clean_frozen.sys = _bootstrap_sys
for _core_name in ("_thread", "_warnings", "_weakref"):
    _core_value = _bootstrap_registry_get(_core_name)
    if _core_value is not None:
        _bootstrap_clean_frozen.__dict__[_core_name] = _core_value
_bootstrap_clean_builtin = getattr(
    _bootstrap_clean_frozen, "BuiltinImporter", None
)
if not isinstance(_bootstrap_clean_builtin, type):
    raise ImportError("Could not establish a clean builtin importer")
_bootstrap_sys.modules["_frozen_importlib"] = _bootstrap_clean_frozen
_bootstrap_clean_frozen._blocking_on = {}
_bootstrap_native_module = _bootstrap_early_native_module
_bootstrap_clean_io = _bootstrap_early_io_module
_bootstrap_clean_external = _bootstrap_load_frozen(
    "_frozen_importlib_external", _bootstrap_imp, _bootstrap_clean_builtins
)
if _bootstrap_clean_external is None:
    raise ImportError("Could not establish a clean file importer")
_bootstrap_clean_frozen._bootstrap_external = _bootstrap_clean_external
_bootstrap_saved_frozen_module = _bootstrap_registry_get(
    "_frozen_importlib"
)
_bootstrap_saved_external_module = _bootstrap_registry_get(
    "_frozen_importlib_external"
)
_bootstrap_saved_native_module = _bootstrap_registry_get(
    "posix", _bootstrap_registry_get("nt")
)
_bootstrap_saved_io_module = _bootstrap_registry_get("_io")
_bootstrap_sys.modules["_frozen_importlib"] = _bootstrap_clean_frozen
_bootstrap_sys.modules["_frozen_importlib_external"] = _bootstrap_clean_external
_bootstrap_clean_frozen._bootstrap_external = _bootstrap_clean_external
_bootstrap_clean_external._bootstrap = _bootstrap_clean_frozen
_bootstrap_clean_external._imp = _bootstrap_imp
_bootstrap_clean_external._io = _bootstrap_clean_io
_bootstrap_clean_import = _bootstrap_clean_frozen.__dict__.get(
    "__import__"
)
if (
    _bootstrap_builtins_module is None
    or not callable(_bootstrap_clean_import)
):
    raise ImportError("Could not establish a clean import primitive")
_bootstrap_builtins_module.__import__ = _bootstrap_clean_import
try:
    _bootstrap_clean_setup = getattr(_bootstrap_clean_external, "_setup", None)
    if callable(_bootstrap_clean_setup):
        _bootstrap_clean_setup(_bootstrap_clean_frozen)
except (AttributeError, TypeError, ValueError):
    raise ImportError("Could not initialize clean file importer")
_bootstrap_clean_builtin_finder = _bootstrap_clean_builtin
_bootstrap_clean_frozen_finder = getattr(
    _bootstrap_clean_frozen, "FrozenImporter", None
)
_bootstrap_clean_path_finder = getattr(
    _bootstrap_clean_external, "PathFinder", None
)
_bootstrap_clean_file_finder = getattr(
    _bootstrap_clean_external, "FileFinder", None
)
_bootstrap_clean_loader_factory = getattr(
    _bootstrap_clean_external, "_get_supported_file_loaders", None
)
if not all((
    isinstance(_bootstrap_clean_frozen_finder, type),
    isinstance(_bootstrap_clean_path_finder, type),
    isinstance(_bootstrap_clean_file_finder, type),
    callable(_bootstrap_clean_loader_factory),
)):
    raise ImportError("Could not establish clean import machinery")
_bootstrap_clean_file_details = _bootstrap_clean_loader_factory()
_bootstrap_clean_file_path_hook = _bootstrap_clean_file_finder.path_hook(
    *_bootstrap_clean_file_details
)
def _bootstrap_finder_is_authentic(
    candidate: object, name: str
) -> bool:
    if not isinstance(candidate, type):
        return False
    method = getattr(candidate, "find_spec", None)
    function = getattr(method, "__func__", method)
    code = getattr(function, "__code__", None)
    expected_file = (
        "<frozen importlib._bootstrap_external>"
        if name == "PathFinder"
        else "<frozen importlib._bootstrap>"
    )
    if getattr(code, "co_filename", "") != expected_file:
        return False
    if name in {"BuiltinImporter", "FrozenImporter"}:
        expected_origin = {
            "BuiltinImporter": "built-in",
            "FrozenImporter": "frozen",
        }[name]
        return getattr(candidate, "_ORIGIN", None) == expected_origin
    return all(
        hasattr(candidate, attribute)
        for attribute in (
            "invalidate_caches", "_path_hooks", "_path_importer_cache",
            "_get_spec", "find_distributions",
        )
    )


def _bootstrap_named_finder(
    entries: list[object],
    module: object,
    attribute: str,
    name: str,
) -> "object | None":
    """Use frozen finder implementations, not caller metadata or position."""

    for candidate in entries:
        if _bootstrap_finder_is_authentic(candidate, name):
            return candidate
    candidate = getattr(module, attribute, None)
    if _bootstrap_finder_is_authentic(candidate, name):
        return candidate
    return None


_frozen_module = _bootstrap_registry_get("_frozen_importlib")
_external_importlib = _bootstrap_registry_get(
    "_frozen_importlib_external"
)
_builtin_finder = _bootstrap_clean_builtin_finder
_frozen_finder = _bootstrap_clean_frozen_finder
_path_finder = _bootstrap_clean_path_finder
if not all((_builtin_finder, _frozen_finder, _path_finder)):
    raise ImportError("Could not establish the trusted bootstrap importers")
_bootstrap_standard_meta_path = [
    _builtin_finder, _frozen_finder, _path_finder
]

def _bootstrap_loader_details(value: object) -> bool:
    if not isinstance(value, (list, tuple)) or not value:
        return False
    loader_names = {
        "ExtensionFileLoader", "SourceFileLoader", "SourcelessFileLoader"
    }
    for item in value:
        if not (
            isinstance(item, tuple)
            and len(item) == 2
            and isinstance(item[0], type)
            and isinstance(item[1], (list, tuple))
            and all(type(suffix) is str for suffix in item[1])
            and getattr(item[0], "__module__", "")
            == "_frozen_importlib_external"
            and getattr(item[0], "__name__", "") in loader_names
        ):
            return False
    return True


def _bootstrap_unwrap_file_hook(
    candidate: object, seen: "set[int] | None" = None
) -> "object | None":
    """Find the genuine cached FileFinder hook without invoking wrappers."""

    if seen is None:
        seen = set()
    identity = id(candidate)
    if identity in seen or not callable(candidate):
        return None
    seen.add(identity)
    closure = getattr(candidate, "__closure__", None)
    if closure is None:
        return None
    values: list[object] = []
    for cell in closure:
        try:
            values.append(cell.cell_contents)
        except ValueError:
            continue
    candidate_code = getattr(candidate, "__code__", None)
    if (
        getattr(candidate_code, "co_filename", "")
        != "<frozen importlib._bootstrap_external>"
        or getattr(candidate_code, "co_name", "") != "path_hook_for_FileFinder"
    ):
        return None
    if any(_bootstrap_loader_details(value) for value in values):
        return candidate
    for value in values:
        nested = _bootstrap_unwrap_file_hook(value, seen)
        if nested is not None:
            return nested
    return None


_bootstrap_file_path_hook = _bootstrap_clean_file_path_hook
for _hook in ():
    _candidate = _bootstrap_unwrap_file_hook(_hook)
    if _candidate is not None:
        _bootstrap_file_path_hook = _candidate
        break
if _bootstrap_file_path_hook is None:
    _candidate_finder = getattr(_external_importlib, "FileFinder", None)
    _candidate_path_hook = getattr(_candidate_finder, "path_hook", None)
    _candidate_factory = getattr(
        _external_importlib, "_get_supported_file_loaders", None
    )
    _candidate_method = getattr(_candidate_path_hook, "__func__", None)
    _candidate_code = getattr(_candidate_method, "__code__", None)
    _candidate_factory_code = getattr(_candidate_factory, "__code__", None)
    if (
        callable(_candidate_path_hook)
        and callable(_candidate_factory)
        and getattr(_candidate_code, "co_filename", "")
        == "<frozen importlib._bootstrap_external>"
        and getattr(_candidate_factory_code, "co_filename", "")
        == "<frozen importlib._bootstrap_external>"
    ):
        try:
            _candidate_details = _candidate_factory()
            if not _bootstrap_loader_details(_candidate_details):
                raise ValueError("invalid interpreter loader details")
            _bootstrap_file_path_hook = _candidate_path_hook(
                *_candidate_details
            )
        except (AttributeError, TypeError, ValueError):
            _bootstrap_file_path_hook = None
if _bootstrap_file_path_hook is None:
    raise ImportError("Could not establish the trusted file finder")
_bootstrap_standard_path_hooks = [_bootstrap_file_path_hook]
_bootstrap_setup_module_roots = {
    "abc", "ast", "collections", "contextlib", "copy", "dataclasses",
    "dis", "enum", "errno", "fnmatch", "functools", "genericpath", "inspect",
    "io", "json", "keyword", "linecache", "locale", "ntpath", "opcode",
    "operator", "os", "pathlib", "posixpath", "random", "re", "selectors",
    "shutil", "_json", "signal", "stat", "string", "subprocess", "tarfile",
    "threading", "token", "tokenize", "traceback", "types", "typing", "urllib",
    "warnings", "weakref", "glob", "encodings", "_collections_abc",
}
_bootstrap_trusted_roots, _bootstrap_trusted_zips = _bootstrap_import_stdlib_paths(
    _bootstrap_original_path
)
if not _bootstrap_trusted_roots:
    raise ImportError("Could not establish a trusted standard-library root")
_bootstrap_authenticated_base_python = (
    next(iter(_bootstrap_executable_candidates()), "")
    if _bootstrap_helper_provenance_verified
    else ""
)
# Zip import is intentionally not part of the setup boundary.  The clean
# helper's filesystem roots are sufficient for the standard setup modules.
_bootstrap_trusted_zips = set()

_core_modules = {
    "sys", "builtins", "_imp", "_io", "_frozen_importlib",
    "_frozen_importlib_external", "zipimport", "marshal", "posix",
    "nt", "_signal", "_thread", "time", "_warnings", "_weakref",
    "_abc", "_codecs", "_locale", "_stat", "_sre", "_operator",
    "_functools", "_collections", "_collections_abc", "_string", "_ast",
}
for name, module in _bootstrap_original_registry.items():
    if type(name) is not str:
        continue
    root = name.split(".", 1)[0]
    if root in {"importlib", "encodings"}:
        continue
    if (
        root in _bootstrap_setup_module_roots
        or root in _bootstrap_clean_stdlib_names
        or root in _bootstrap_initial_builtin_module_names
    ) and root not in _core_modules:
        _bootstrap_sys.modules.pop(name, None)
_bootstrap_sys.meta_path[:] = _bootstrap_standard_meta_path
_bootstrap_sys.path_hooks[:] = _bootstrap_standard_path_hooks
_bootstrap_sys.path_importer_cache.clear()
_bootstrap_sys.path[:] = _trusted_bootstrap_paths(
    _bootstrap_original_path,
    _bootstrap_trusted_roots,
    _bootstrap_trusted_zips,
)
try:
    json = _bootstrap_clean_import("json", None, None, (), 0)
    os = _bootstrap_clean_import("os", None, None, (), 0)
    _bootstrap_clean_os = os
    re = _bootstrap_clean_import("re", None, None, (), 0)
    shutil = _bootstrap_clean_import("shutil", None, None, (), 0)
    subprocess = _bootstrap_clean_import("subprocess", None, None, (), 0)
    Mapping = getattr(_bootstrap_clean_import(
        "collections.abc", None, None, ("Mapping",), 0
    ), "Mapping")
    dataclass = getattr(_bootstrap_clean_import(
        "dataclasses", None, None, ("dataclass",), 0
    ), "dataclass")
    Path = getattr(_bootstrap_clean_import(
        "pathlib", None, None, ("Path",), 0
    ), "Path")
    clean_path_type = type(Path("."))
    _bootstrap_clean_path_type = clean_path_type
    _bootstrap_clean_path_storage_name = None
    _bootstrap_clean_raw_paths_descriptor = None
    for owner in type.__getattribute__(clean_path_type, "__mro__"):
        namespace = type.__getattribute__(owner, "__dict__")
        for storage_name in ("_raw_paths", "_parts"):
            if storage_name in namespace:
                _bootstrap_clean_path_storage_name = storage_name
                _bootstrap_clean_raw_paths_descriptor = namespace[storage_name]
                break
        if _bootstrap_clean_path_storage_name is not None:
            break
    if _bootstrap_clean_raw_paths_descriptor is None:
        raise ImportError("Could not establish clean pathlib storage")
    _bootstrap_realpath = os.path.realpath
    _bootstrap_islink = os.path.islink
    _bootstrap_readlink = os.readlink
    _bootstrap_abspath = os.path.abspath
finally:
    _bootstrap_sys.path[:] = _bootstrap_original_path
    _bootstrap_sys.meta_path[:] = _bootstrap_original_meta_path
    _bootstrap_sys.path_hooks[:] = _bootstrap_original_path_hooks
    _bootstrap_sys.path_importer_cache.clear()
    _bootstrap_sys.path_importer_cache.update(_bootstrap_original_importer_cache)
    if _bootstrap_original_import is not None:
        _bootstrap_builtins_module.__import__ = _bootstrap_original_import
    if _bootstrap_saved_frozen_module is None:
        _bootstrap_sys.modules.pop("_frozen_importlib", None)
    else:
        _bootstrap_sys.modules["_frozen_importlib"] = _bootstrap_saved_frozen_module
    if _bootstrap_saved_external_module is None:
        _bootstrap_sys.modules.pop("_frozen_importlib_external", None)
    else:
        _bootstrap_sys.modules["_frozen_importlib_external"] = _bootstrap_saved_external_module
    if _bootstrap_saved_native_module is not None:
        _bootstrap_sys.modules[
            "posix" if _bootstrap_native_module.__name__ == "posix" else "nt"
        ] = _bootstrap_saved_native_module
    if _bootstrap_saved_io_module is None:
        _bootstrap_sys.modules.pop("_io", None)
    else:
        _bootstrap_sys.modules["_io"] = _bootstrap_saved_io_module
    if _bootstrap_pathlib_cache_is_safe(_bootstrap_caller_pathlib):
        _pathlib_for_caller = _bootstrap_caller_pathlib
    else:
        _pathlib_for_caller = dict.get(
            _bootstrap_sys_value("modules"), "pathlib"
        )
    _current_modules = _bootstrap_sys_value("modules")
    if (
        _pathlib_for_caller is not None
        and type(_current_modules) is _bootstrap_dict_type
    ):
        dict.__setitem__(_current_modules, "pathlib", _pathlib_for_caller)
    if type(_bootstrap_original_registry_source) is _bootstrap_dict_type:
        if type(_current_modules) is _bootstrap_dict_type:
            for _module_name, _module_value in _bootstrap_original_registry.items():
                if (
                    type(_module_name) is str
                    and not dict.__contains__(
                        _current_modules, _module_name
                    )
                ):
                    dict.__setitem__(
                        _current_modules, _module_name, _module_value
                    )
            dict.clear(_bootstrap_original_registry_source)
            for _module_name, _module_value in _current_modules.items():
                if type(_module_name) is not str:
                    continue
                dict.__setitem__(
                    _bootstrap_original_registry_source,
                    _module_name,
                    _module_value,
                )
        dict.__setitem__(
            _bootstrap_sys_namespace,
            "modules",
            _bootstrap_original_registry_source,
        )

del _bootstrap_original_path

ENV_RELATIVE_PATH = Path(".artifacts") / "computer-use" / ".runtime"
REQUIRED_PACKAGES: tuple[tuple[str, str], ...] = (
    ("mss>=9", "mss"),
    ("Pillow>=10", "PIL"),
    ("pynput>=1.7", "pynput"),
)
OPTIONAL_PACKAGES: tuple[tuple[str, str], ...] = ()

_PIP_DESTINATION_ENVIRONMENT = frozenset({
    "PIP_BUILD_TRACKER",
    "PIP_CONFIG_FILE",
    "PIP_EGG_CACHE",
    "PIP_LOG",
    "PIP_PREFIX",
    "PIP_SRC",
    "PIP_TARGET",
    "PIP_USER",
    "PIP_WHEEL_DIR",
})
_RUNTIME_STORAGE_ENVIRONMENT = frozenset({
    "PIP_CACHE_DIR",
    "PIP_DOWNLOAD_CACHE",
    "PYTHONPYCACHEPREFIX",
    "TEMP",
    "TMP",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
})
_PYTHON_IDENTITY_ENVIRONMENT = frozenset({
    "PATH",
    "PYTHONEXECUTABLE",
    "PYTHONHOME",
    "PYTHONNOUSERSITE",
    "PYTHONPATH",
    "PYTHONPLATLIBDIR",
    "PYTHONUSERBASE",
    "VIRTUAL_ENV",
})
_DYNAMIC_LOADER_ENVIRONMENT = frozenset({
    "LD_PRELOAD", "LD_AUDIT", "LD_LIBRARY_PATH", "LD_LIBRARY_PATH_32",
    "LD_LIBRARY_PATH_64", "LD_ORIGIN_PATH", "LD_DEBUG",
    "LD_DEBUG_OUTPUT", "LD_ASSUME_KERNEL", "LD_BIND_NOW",
    "LD_DYNAMIC_WEAK", "LD_PROFILE", "LD_SHOW_AUXV", "LD_USE_LOAD_BIAS",
    "LD_WARN", "LD_TRACE_LOADED_OBJECTS", "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH", "DYLD_FALLBACK_FRAMEWORK_PATH",
    "DYLD_VERSIONED_LIBRARY_PATH", "DYLD_VERSIONED_FRAMEWORK_PATH",
    "DYLD_ROOT_PATH", "DYLD_SHARED_REGION", "DYLD_PRINT_LIBRARIES",
    "DYLD_PRINT_APIS", "DYLD_FORCE_FLAT_NAMESPACE", "DYLD_IMAGE_SUFFIX",
    "DYLD_NO_FIX_PREBINDING", "DYLD_BIND_AT_LAUNCH", "DYLD_PRINT_RPATHS",
})
_MODULE_NAME_PATTERN = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$"
)


class BootstrapError(RuntimeError):
    """Raised when the isolated runtime cannot be prepared."""


@dataclass(frozen=True)
class Runtime:
    project_root: Path
    directory: Path
    python: Path
    ready: bool
    workspace_root: "Path | None" = None
    warnings: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        workspace_root = self.workspace_root
        if workspace_root is None:
            workspace_root = self.project_root
        return {
            "project_root": _runtime_path_text(self.project_root),
            "workspace_root": _runtime_path_text(workspace_root),
            "directory": _runtime_path_text(self.directory),
            "python": _runtime_path_text(self.python),
            "ready": self.ready,
            "warnings": list(self.warnings),
        }


def _bootstrap_clean_path(value) -> "Path | None":
    if type(value) is str:
        return Path(value)
    try:
        value_type = type(value)
        mro = type.__getattribute__(value_type, "__mro__")
        storage_name = _bootstrap_clean_path_storage_name
        descriptor = None
        for owner in mro:
            namespace = type.__getattribute__(owner, "__dict__")
            if storage_name in namespace:
                descriptor = namespace[storage_name]
                break
        if (
            descriptor is None
            or type(descriptor) is not type(_bootstrap_clean_raw_paths_descriptor)
        ):
            return None
        raw_paths = object.__getattribute__(value, storage_name)
    except (AttributeError, TypeError, ValueError):
        return None
    if type(raw_paths) not in (list, tuple):
        return None
    if any(type(part) is not str for part in raw_paths):
        return None
    try:
        return Path(*raw_paths)
    except (TypeError, ValueError):
        return None


def _runtime_path_text(value) -> str:
    clean_value = _bootstrap_clean_path(value)
    if clean_value is None:
        raise BootstrapError(
            "Runtime paths must use authenticated pathlib storage"
        )
    return os.fspath(clean_value)


def _path_resolve(value) -> Path:
    """Resolve through clean pathlib and OS code without caller methods."""

    return Path(os.path.realpath(_runtime_path_text(value)))


def _bootstrap_public_path_type_is_safe(candidate: object) -> bool:
    if type(candidate) is not type:
        return False
    try:
        candidate_mro = type.__getattribute__(candidate, "__mro__")
        clean_mro = type.__getattribute__(
            _bootstrap_clean_path_type, "__mro__"
        )
    except (AttributeError, TypeError):
        return False
    if len(candidate_mro) != len(clean_mro):
        return False
    for candidate_base, clean_base in zip(candidate_mro, clean_mro):
        if candidate_base is clean_base:
            continue
        if type(candidate_base) is not type or type(clean_base) is not type:
            return False
        try:
            candidate_module = type.__getattribute__(
                candidate_base, "__module__"
            )
            clean_module = type.__getattribute__(clean_base, "__module__")
            candidate_name = type.__getattribute__(candidate_base, "__name__")
            clean_name = type.__getattribute__(clean_base, "__name__")
        except (AttributeError, TypeError):
            return False
        if not all(
            type(value) is str
            for value in (
                candidate_module, clean_module, candidate_name, clean_name,
            )
        ) or candidate_module != clean_module or candidate_name != clean_name:
            return False

    def slot_descriptors(path_type):
        descriptors = {}
        for owner in type.__getattribute__(path_type, "__mro__"):
            namespace = type.__getattribute__(owner, "__dict__")
            slots = namespace.get("__slots__", ())
            if type(slots) is str:
                slots = (slots,)
            if type(slots) not in (tuple, list):
                return None
            for slot in slots:
                if type(slot) is not str or slot in descriptors:
                    continue
                if slot in namespace:
                    descriptors[slot] = namespace[slot]
        return descriptors

    clean_descriptors = slot_descriptors(_bootstrap_clean_path_type)
    candidate_descriptors = slot_descriptors(candidate)
    if clean_descriptors is None or candidate_descriptors is None:
        return False
    if set(clean_descriptors) != set(candidate_descriptors):
        return False
    return all(
        type(candidate_descriptors[name]) is type(clean_descriptors[name])
        for name in clean_descriptors
    )


def _public_path_like(template: object, value: Path) -> Path:
    """Adapt clean storage with raw operations for standard path classes."""

    template_type = type(template)
    if template_type is Path:
        return value
    if not _bootstrap_public_path_type_is_safe(template_type):
        return value
    try:
        adapted = object.__new__(template_type)
        copied = False
        value_type = type(value)
        for owner in type.__getattribute__(value_type, "__mro__"):
            slots = type.__getattribute__(owner, "__dict__").get(
                "__slots__", ()
            )
            if type(slots) is str:
                slots = (slots,)
            if type(slots) not in (tuple, list):
                continue
            for slot in slots:
                if type(slot) is not str:
                    continue
                try:
                    slot_value = object.__getattribute__(value, slot)
                    object.__setattr__(adapted, slot, slot_value)
                except (AttributeError, TypeError, ValueError):
                    continue
                copied = True
        if copied:
            return adapted
    except (AttributeError, TypeError, ValueError):
        pass
    return value


def runtime_directory(project_root: Path) -> Path:
    public_project_root = project_root
    project_root = _path_resolve(project_root)
    clean = Path(
        os.path.join(os.fspath(project_root), os.fspath(ENV_RELATIVE_PATH))
    )
    return _public_path_like(public_project_root, clean)


def runtime_python(directory: Path) -> Path:
    public_directory = directory
    directory = _path_resolve(directory)
    if os.name == "nt":
        clean = Path(os.path.join(os.fspath(directory), "Scripts", "python.exe"))
    else:
        clean = Path(os.path.join(os.fspath(directory), "bin", "python"))
    return _public_path_like(public_directory, clean)


def _checked_operation(operation) -> tuple[str, ...]:
    """Require a shell-free command that the runtime interpreter can run."""

    if callable(operation):
        raise BootstrapError(
            "invoke requires a runtime command; callbacks cannot run"
            " outside the prepared runtime"
        )
    if type(operation) not in (list, tuple):
        raise BootstrapError(
            "Runtime operation must be a materialized list or tuple"
        )
    arguments = tuple(operation)
    if not arguments:
        raise BootstrapError("Runtime command cannot be empty")
    if any(type(argument) is not str for argument in arguments):
        raise BootstrapError("Runtime command arguments must be strings")
    return arguments


def _checked_package_specs(package_specs, label: str) -> tuple[tuple[str, str], ...]:
    if type(package_specs) not in (list, tuple):
        raise BootstrapError(
            f"{label} packages must be a materialized list or tuple"
        )
    checked: list[tuple[str, str]] = []
    for item in package_specs:
        if type(item) not in (list, tuple) or len(item) != 2:
            raise BootstrapError(
                f"{label} packages must contain package/module pairs"
            )
        package, module = item
        if type(package) is not str or type(module) is not str:
            raise BootstrapError(
                f"{label} package and module names must be strings"
            )
        checked.append((package, module))
    return tuple(checked)


def _ensure_owned_dir(path: Path) -> Path:
    """Create a directory owned by the skill area without following links."""

    if path.is_symlink() or path.is_file():
        path.unlink()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_owned_file(path: Path, text: str) -> None:
    """Write a file owned by the skill area on a private inode.

    Any pre-existing name is dropped first without following it, so neither
    symlinks nor hard links can redirect the write outside the skill area.
    """

    if os.path.lexists(path):
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    path.write_text(text, encoding="utf-8")


def _mark_not_ready(
    directory: Path, workspace_root: Path, state: str
) -> None:
    """Invalidate readiness metadata only inside the canonical runtime."""

    if directory.is_symlink() or not directory.is_dir():
        return
    try:
        workspace_root = _path_resolve(workspace_root)
        expected = runtime_directory(workspace_root)
        if directory.absolute() != expected.absolute():
            return
        _check_containment(directory, workspace_root)
        _write_owned_file(
            directory / "environment.json",
            json.dumps({"ready": False, "state": state}, indent=2) + "\n",
        )
    except Exception:
        # A setup error must not be replaced by a metadata cleanup error.
        return


def _bootstrap_class_member(
    candidate: object, name: str, default: object = None
) -> object:
    """Read a class namespace without invoking its metaclass hooks."""

    try:
        mro = type.__getattribute__(candidate, "__mro__")
        for owner in mro:
            namespace = type.__getattribute__(owner, "__dict__")
            try:
                return namespace[name]
            except KeyError:
                continue
    except (AttributeError, KeyError, TypeError):
        pass
    return default


def _bootstrap_environment_type_is_genuine(
    source_type: object, clean_type: object
) -> bool:
    if source_type is clean_type:
        return True
    try:
        source_name = type.__getattribute__(source_type, "__name__")
    except AttributeError:
        return False
    source_module = _bootstrap_class_member(source_type, "__module__", "")
    if (
        type(source_module) is not str
        or type(source_name) is not str
        or source_module != "os"
        or source_name != "_Environ"
    ):
        return False
    missing = object()
    # A real _Environ stores _data on the instance.  A descriptor or a custom
    # attribute hook here would execute caller code when the instance is read.
    source_getattribute = _bootstrap_class_member(
        source_type, "__getattribute__", missing
    )
    clean_getattribute = _bootstrap_class_member(
        clean_type, "__getattribute__", missing
    )
    if (
        source_getattribute is not clean_getattribute
        or _bootstrap_class_member(source_type, "_data", missing)
        is not missing
        or _bootstrap_class_member(source_type, "__getattr__", missing)
        is not missing
    ):
        return False
    # The snapshot path below reads only the instance backing map and clean
    # decoder functions.  No source mapping methods are trusted or invoked.
    return True


def _bootstrap_environment_is_genuine(source: object) -> bool:
    clean_os = _bootstrap_clean_os
    try:
        clean_environment = clean_os.environ
    except AttributeError:
        return False
    source_type = type(source)
    clean_type = type(clean_environment)
    if not _bootstrap_environment_type_is_genuine(source_type, clean_type):
        return False
    try:
        source_data = source._data
    except AttributeError:
        return False
    return type(source_data) is dict


def _environment_snapshot(source: object) -> "dict[str, str] | None":
    """Copy an authenticated environment backing map without source methods."""

    try:
        source_data = source._data
        clean_environment = _bootstrap_clean_os.environ
        decode_key = clean_environment.decodekey
        decode_value = clean_environment.decodevalue
    except AttributeError:
        return None
    if type(source_data) is not dict:
        return None
    snapshot: dict[str, str] = {}
    try:
        for raw_key, raw_value in source_data.items():
            if type(raw_key) not in (bytes, str):
                return None
            if type(raw_value) not in (bytes, str):
                return None
            key = decode_key(raw_key)
            value = decode_value(raw_value)
            if type(key) is not str or type(value) is not str:
                return None
            snapshot[key] = value
    except (AttributeError, KeyError, TypeError, UnicodeError, ValueError):
        return None
    return snapshot


def _caller_environment_copy() -> dict[str, str]:
    source = _bootstrap_caller_environment
    if source is not None and _bootstrap_environment_is_genuine(source):
        snapshot = _environment_snapshot(source)
        if snapshot is not None:
            return snapshot
    clean_os = _bootstrap_clean_os
    try:
        return dict(clean_os.environ)
    except (AttributeError, TypeError, ValueError):
        return {}


def process_environment(storage_root: Path) -> dict[str, str]:
    """Scope installer temporary and cache files below the runtime area."""

    storage_root = _path_resolve(storage_root)
    temp_dir = _ensure_owned_dir(storage_root / "tmp")
    cache_dir = _ensure_owned_dir(storage_root / "pip-cache")
    pycache_dir = _ensure_owned_dir(storage_root / "pycache")
    config_dir = _ensure_owned_dir(storage_root / "config")
    data_dir = _ensure_owned_dir(storage_root / "data")
    environment = _caller_environment_copy()
    for key in tuple(environment):
        if key.upper() in _RUNTIME_STORAGE_ENVIRONMENT | _DYNAMIC_LOADER_ENVIRONMENT:
            environment.pop(key, None)
    environment.update(
        {
            "TMPDIR": str(temp_dir),
            "TMP": str(temp_dir),
            "TEMP": str(temp_dir),
            "PIP_CACHE_DIR": str(cache_dir),
            "PYTHONPYCACHEPREFIX": str(pycache_dir),
            "XDG_CACHE_HOME": str(cache_dir),
            "XDG_CONFIG_HOME": str(config_dir),
            "XDG_DATA_HOME": str(data_dir),
        }
    )
    return environment


def _protected_pip_environment() -> tuple[str, ...]:
    """Find inherited pip settings that can write outside the runtime."""

    environment = _caller_environment_copy()
    return tuple(sorted(
        key for key, value in environment.items()
        if key.upper() in _PIP_DESTINATION_ENVIRONMENT and value
    ))


def _check_protected_pip_environment() -> None:
    """Reject caller-controlled pip destinations before setup or install."""

    blocked = _protected_pip_environment()
    if blocked:
        raise BootstrapError(
            "Protected pip destination variables cannot be set outside"
            f" the runtime: {', '.join(blocked)}"
        )


def _isolated_environment(
    storage_root: Path, python: "Path | None" = None
) -> dict[str, str]:
    """Build a Python environment without caller search-path leakage."""

    storage_root = _path_resolve(storage_root)
    environment = process_environment(storage_root)
    for key in tuple(environment):
        if key.upper() in _PYTHON_IDENTITY_ENVIRONMENT | _DYNAMIC_LOADER_ENVIRONMENT:
            environment.pop(key, None)
    environment["PYTHONNOUSERSITE"] = "1"
    environment["VIRTUAL_ENV"] = _runtime_path_text(storage_root)
    environment["PATH"] = os.defpath
    for key in tuple(environment):
        if key.upper() in _PIP_DESTINATION_ENVIRONMENT:
            environment.pop(key, None)
    environment["PIP_CONFIG_FILE"] = os.devnull
    if python is not None:
        clean_python = _path_resolve(python)
        environment["PATH"] = os.pathsep.join(
            (
                _runtime_path_text(clean_python.parent),
                environment.get("PATH", ""),
            )
        )
    return environment


def _checked_timeout(value, label: str = "Timeout"):
    if type(value) not in (int, float) or type(value) is bool:
        raise BootstrapError(f"{label} must be an exact finite number")
    if value < 0 or (
        type(value) is float
        and (value != value or value == float("inf") or value == float("-inf"))
    ):
        raise BootstrapError(f"{label} must be a non-negative finite number")
    return value


def _run(
    command: list[str],
    *,
    check: bool = True,
    env: "dict[str, str] | None" = None,
    cwd: "Path | None" = None,
    timeout: float = 300,
) -> subprocess.CompletedProcess:
    if type(check) is not bool:
        raise BootstrapError("Check flag must be an exact boolean")
    timeout = _checked_timeout(timeout)
    try:
        result = subprocess.run(
            command, check=False, text=True, capture_output=True, env=env,
            cwd=cwd, timeout=timeout,
        )
    except OSError as exc:
        raise BootstrapError(f"Could not run {command[0]!r}: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise BootstrapError(
            f"Command timed out after {timeout} seconds: {' '.join(command)}"
        ) from exc
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise BootstrapError(
            f"Command failed ({result.returncode}): {' '.join(command)}"
            + (f"\n{detail}" if detail else "")
        )
    return result


def _module_available(python: Path, module: str) -> bool:
    """Probe a validated module name in the isolated interpreter."""

    if type(module) is not str or _MODULE_NAME_PATTERN.fullmatch(module) is None:
        raise BootstrapError(f"Invalid dependency module name: {module!r}")
    python = Path(python)
    storage_root = python.parent.parent
    code = (
        "import importlib; "
        f"importlib.import_module({module!r})"
    )
    result = _run(
        [str(python), "-c", code],
        check=False,
        env=_isolated_environment(storage_root, python),
        cwd=storage_root,
    )
    return result.returncode == 0


def _install(
    python: Path, package: str, storage_root: Path, timeout: float = 300
) -> None:
    if _package_requirement(package) is None:
        raise BootstrapError(
            f"Invalid dependency requirement: {package!r}"
        )
    _check_protected_pip_environment()
    try:
        _run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
                "--timeout",
                "15",
                "--retries",
                "1",
                "--",
                package,
            ],
            env=_isolated_environment(storage_root, python),
            cwd=storage_root,
            timeout=timeout,
        )
    except BootstrapError as exc:
        raise BootstrapError(
            f"Required dependency {package!r} could not be installed: {exc}"
        ) from exc


_REQUIREMENT_CLAUSE = re.compile(
    r"^(===|~=|==|!=|<=|>=|<|>)\s*"
    r"([A-Za-z0-9][A-Za-z0-9.!+*_-]*)$"
)
_WHEEL_BUILD_TAG = re.compile(r"^[0-9][A-Za-z0-9_.]*$")
_VERSION_PATTERN = re.compile(
    r"^v?"
    r"(?:(?P<epoch>[0-9]+)!)?"
    r"(?P<release>[0-9]+(?:\.[0-9]+)*)"
    r"(?:(?:[._-]?)(?P<pre_label>a|b|c|rc)(?P<pre_number>[0-9]*))?"
    r"(?:(?:[._-]?)(?P<post_label>post|rev|r)(?P<post_number>[0-9]*))?"
    r"(?:(?:[._-]?)dev(?P<dev_number>[0-9]*))?"
    r"(?:\+(?P<local>[a-z0-9]+(?:[._-][a-z0-9]+)*))?$",
    re.IGNORECASE,
)


def _package_requirement(package: str) -> "tuple[str, str] | None":
    """Parse the supported PEP 508 requirement subset without host imports."""

    if type(package) is not str:
        return None
    text = package.strip()
    if not text or ";" in text:
        # Markers need an independent environment evaluation; do not guess.
        return None
    if text.lower().endswith(".whl"):
        filename = Path(text).name
        components = filename[:-4].split("-")
        if len(components) < 5:
            return None
        prefix = components[:-3]
        if (
            len(prefix) >= 3
            and _WHEEL_BUILD_TAG.fullmatch(prefix[-1])
            and _parse_pep440_version(prefix[-2]) is not None
        ):
            distribution = "-".join(prefix[:-2])
            version = prefix[-2]
        else:
            distribution = "-".join(prefix[:-1])
            version = prefix[-1]
        if not distribution or _parse_pep440_version(version) is None:
            return None
        return distribution, f"=={version}"

    match = re.fullmatch(
        r"\s*(?P<name>[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)"
        r"(?:\s*\[(?P<extras>[^]]+)\])?"
        r"(?P<tail>.*)",
        text,
    )
    if match is None:
        return None
    extras = match.group("extras")
    if extras is not None and not re.fullmatch(
        r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?"
        r"(?:\s*,\s*[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)*",
        extras,
    ):
        return None
    tail = match.group("tail").strip()
    if not tail:
        return match.group("name"), ""
    clauses = [clause.strip() for clause in tail.split(",")]
    if any(not clause for clause in clauses):
        return None
    specifiers: list[str] = []
    for clause in clauses:
        clause_match = _REQUIREMENT_CLAUSE.fullmatch(clause)
        if clause_match is None:
            return None
        operator, version = clause_match.groups()
        if version.endswith(".*"):
            if operator not in {"==", "!="}:
                return None
            parsed_version = _parse_pep440_version(version[:-2])
        else:
            parsed_version = _parse_pep440_version(version)
        if parsed_version is None:
            return None
        if "+" in version and operator not in {"==", "!=", "==="}:
            return None
        if "+" in version and version.endswith(".*"):
            return None
        if operator == "~=" and len(parsed_version[1]) < 2:
            return None
        specifiers.append(f"{operator}{version}")
    return match.group("name"), ",".join(specifiers)


def _distribution_version(
    python: Path, distribution: str
) -> "str | None":
    """Read a distribution version from the prepared interpreter."""

    code = (
        "from importlib.metadata import PackageNotFoundError, version\n"
        "import sys\n"
        f"name = {distribution!r}\n"
        "try:\n"
        "    print(version(name))\n"
        "except PackageNotFoundError:\n"
        "    sys.exit(1)\n"
    )
    storage_root = Path(python).parent.parent
    result = _run(
        [str(python), "-c", code],
        check=False,
        env=_isolated_environment(storage_root, Path(python)),
        cwd=storage_root,
    )
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value if value and "\n" not in value else None


def _parse_pep440_version(value: str):
    """Parse the PEP 440 forms needed for dependency readiness checks."""

    if type(value) is not str:
        return None
    text = value.strip()
    public, separator, local = text.partition("+")
    public = re.sub(
        r"(?i)(alpha|beta|preview|pre)",
        lambda match: {
            "alpha": "a",
            "beta": "b",
            "preview": "rc",
            "pre": "rc",
        }[match.group(1).casefold()],
        public,
    )
    implicit_post = re.fullmatch(
        r"(?i)(?P<base>v?[0-9]+(?:\.[0-9]+)*)-(?P<post>[0-9]+)",
        public,
    )
    if implicit_post is not None:
        public = (
            f"{implicit_post.group('base')}.post"
            f"{implicit_post.group('post')}"
        )
    text = public + (separator + local if separator else "")
    match = _VERSION_PATTERN.fullmatch(text)
    if match is None:
        return None
    groups = match.groupdict()
    pre_label = groups["pre_label"]
    if pre_label is not None:
        pre = (
            {"a": 0, "b": 1, "c": 2, "rc": 2}[pre_label.casefold()],
            int(groups["pre_number"] or 0),
        )
    else:
        pre = None
    post = (
        int(groups["post_number"] or 0)
        if groups["post_label"] is not None
        else None
    )
    dev = (
        int(groups["dev_number"] or 0)
        if groups["dev_number"] is not None
        else None
    )
    local = None
    if groups["local"] is not None:
        local = tuple(
            (0, int(part)) if part.isdigit() else (1, part.casefold())
            for part in re.split(r"[._-]", groups["local"])
        )
    return (
        int(groups["epoch"] or 0),
        tuple(int(part) for part in groups["release"].split(".")),
        pre,
        post,
        dev,
        local,
    )


def _compare_release(left: tuple[int, ...], right: tuple[int, ...]) -> int:
    length = max(len(left), len(right))
    for index in range(length):
        left_part = left[index] if index < len(left) else 0
        right_part = right[index] if index < len(right) else 0
        if left_part < right_part:
            return -1
        if left_part > right_part:
            return 1
    return 0


def _version_stage(parsed) -> tuple[int, int, int, int, int]:
    _epoch, _release, pre, post, dev, _local = parsed
    if pre is None:
        if post is not None:
            return (3, post, 0 if dev is not None else 1, dev or 0, 0)
        if dev is not None:
            return (0, 0, 0, dev, 0)
        return (2, 0, 0, 0, 0)
    pre_label, pre_number = pre
    if dev is not None:
        return (1, pre_label, pre_number, 0, dev)
    if post is not None:
        return (1, pre_label, pre_number, 2, post)
    return (1, pre_label, pre_number, 1, 0)


def _compare_versions(left, right, *, include_local: bool = False) -> int:
    if left[0] != right[0]:
        return -1 if left[0] < right[0] else 1
    release_result = _compare_release(left[1], right[1])
    if release_result:
        return release_result
    left_stage = _version_stage(left)
    right_stage = _version_stage(right)
    if left_stage != right_stage:
        return -1 if left_stage < right_stage else 1
    if include_local:
        left_local = left[5]
        right_local = right[5]
        if left_local is None and right_local is not None:
            return -1
        if left_local is not None and right_local is None:
            return 1
        if left_local != right_local:
            return -1 if left_local < right_local else 1
    return 0


def _compatible_upper_bound(parsed):
    release = list(parsed[1])
    if len(release) == 1:
        upper_release = (release[0] + 1,)
    else:
        upper_release = tuple(release[:-1])
        upper_release = upper_release[:-1] + (upper_release[-1] + 1,)
    return (parsed[0], upper_release, None, None, None, None)


def _version_is_prerelease(parsed) -> bool:
    return parsed[2] is not None or parsed[4] is not None


def _canonical_pep440_version(parsed) -> str:
    epoch, release, pre, post, dev, local = parsed
    text = ".".join(str(part) for part in release)
    if epoch:
        text = f"{epoch}!" + text
    if pre is not None:
        text += {0: "a", 1: "b", 2: "rc"}[pre[0]] + str(pre[1])
    if post is not None:
        text += f".post{post}"
    if dev is not None:
        text += f".dev{dev}"
    if local is not None:
        text += "+" + ".".join(
            str(part[1]) for part in local
        )
    return text


def _version_satisfies(version: str, specifier: str) -> bool:
    """Check supported PEP 440 specifiers without importing caller packages."""

    actual = _parse_pep440_version(version)
    if actual is None or not specifier:
        return actual is not None
    parsed_clauses = []
    for clause in specifier.split(","):
        match = _REQUIREMENT_CLAUSE.fullmatch(clause.strip())
        if match is None:
            return False
        operator, wanted_text = match.groups()
        if operator == "~=" and wanted_text.casefold().startswith("v"):
            return False
        if "+" in wanted_text and operator not in {"==", "!=", "==="}:
            return False
        if "+" in wanted_text and wanted_text.endswith(".*"):
            return False
        wildcard = wanted_text.endswith(".*")
        if wildcard:
            if operator not in {"==", "!="}:
                return False
            wanted_text = wanted_text[:-2]
        wanted = _parse_pep440_version(wanted_text)
        if wanted is None:
            return False
        if operator == "~=" and len(wanted[1]) < 2:
            return False
        parsed_clauses.append((operator, wanted_text, wanted, wildcard))

    allows_prereleases = any(
        operator in {"==", ">=", "<=", "~=", "===", ">", "<"}
        and _version_is_prerelease(wanted)
        for operator, _wanted_text, wanted, _wildcard in parsed_clauses
    )
    if _version_is_prerelease(actual) and not allows_prereleases:
        return False
    if _version_is_prerelease(actual):
        for operator, _wanted_text, wanted, _wildcard in parsed_clauses:
            if (
                operator == "<"
                and not _version_is_prerelease(wanted)
                and actual[0] == wanted[0]
                and _compare_release(actual[1], wanted[1]) == 0
            ):
                return False

    for operator, wanted_text, wanted, wildcard in parsed_clauses:
        if operator == "===":
            if (
                _canonical_pep440_version(actual).casefold()
                != wanted_text.casefold()
            ):
                return False
            continue
        if wildcard:
            normalized_actual_release = actual[1] + (0,) * max(
                0, len(wanted[1]) - len(actual[1])
            )
            matches = (
                actual[0] == wanted[0]
                and normalized_actual_release[: len(wanted[1])] == wanted[1]
            )
            if (operator == "==" and not matches) or (
                operator == "!=" and matches
            ):
                return False
            continue
        include_local = wanted[5] is not None
        comparison = _compare_versions(
            actual, wanted, include_local=include_local
        )
        same_base = (
            actual[0] == wanted[0]
            and _compare_release(actual[1], wanted[1]) == 0
        )
        if operator == "==" and comparison != 0:
            return False
        if operator == "!=" and comparison == 0:
            return False
        if operator == ">=" and comparison < 0:
            return False
        if operator == "<=" and comparison > 0:
            return False
        if operator == ">" and comparison <= 0:
            return False
        if operator == ">" and same_base and (
            actual[5] is not None
            or (wanted[3] is None and actual[3] is not None)
        ):
            return False
        if operator == "<" and comparison >= 0:
            return False
        if operator == "~=" and (
            comparison < 0
            or _compare_versions(actual, _compatible_upper_bound(wanted)) >= 0
            or (
                _version_is_prerelease(wanted)
                and _version_is_prerelease(actual)
                and _compare_release(
                    actual[1], _compatible_upper_bound(wanted)[1]
                ) >= 0
            )
        ):
            return False
    return True


def _package_satisfies(
    python: Path,
    package: str,
    storage_root: Path,
    *,
    require_distribution: bool = True,
) -> bool:
    requirement = _package_requirement(package)
    if requirement is None:
        return False
    distribution, specifier = requirement
    if not specifier and not require_distribution:
        return True
    installed = _distribution_version(python, distribution)
    if installed is None:
        return False
    return not specifier or _version_satisfies(installed, specifier)


def _ensure_packages(
    python: Path,
    package_specs: tuple[tuple[str, str], ...],
    storage_root: Path,
    timeout: float = 300,
) -> None:
    for package, module in package_specs:
        if _package_requirement(package) is None:
            raise BootstrapError(
                f"Invalid required dependency requirement: {package!r}"
            )
        if (
            _module_available(python, module)
            and _package_satisfies(python, package, storage_root)
        ):
            continue
        _install(python, package, storage_root, timeout)
        if (
            not _module_available(python, module)
            or not _package_satisfies(python, package, storage_root)
        ):
            raise BootstrapError(
                f"Required dependency {package!r} does not satisfy"
                f" module {module!r} and its version requirement"
            )


def _ensure_optional(
    python: Path,
    package_specs: tuple[tuple[str, str], ...],
    storage_root: Path,
    timeout: float = 300,
) -> tuple[str, ...]:
    """Install optional dependencies, warning instead of failing.

    Each unavailable option produces a warning naming it while setup
    continues through the standard fallback (the runtime without that
    option); options already importable are used silently.
    """

    warnings: list[str] = []
    for package, module in package_specs:
        try:
            available = _module_available(python, module)
            satisfied = available and _package_satisfies(
                python, package, storage_root, require_distribution=False
            )
        except BootstrapError as exc:
            warnings.append(
                f"Optional dependency {package!r} could not be probed"
                f" ({module!r}), continuing with the standard"
                f" fallback: {exc}"
            )
            continue
        if satisfied:
            continue
        try:
            _install(python, package, storage_root, timeout)
        except BootstrapError as exc:
            warnings.append(
                f"Optional dependency {package!r} unavailable,"
                f" continuing with the standard fallback: {exc}"
            )
            continue
        try:
            installed = _module_available(python, module)
            satisfied = installed and _package_satisfies(
                python, package, storage_root, require_distribution=False
            )
        except BootstrapError as exc:
            warnings.append(
                f"Optional dependency {package!r} could not be probed"
                f" after install ({module!r}), continuing with the"
                f" standard fallback: {exc}"
            )
            continue
        if not satisfied:
            warnings.append(
                f"Optional dependency {package!r} installed"
                f" but does not satisfy module {module!r},"
                f" continuing with the standard fallback"
            )
    return tuple(warnings)


_PROBE_CODE = "import sys; print('probe-ok'); print(sys.prefix)"


def _isolated_venv_configured(directory: Path) -> bool:
    """Require one explicit venv setting that excludes system packages."""

    config = directory / "pyvenv.cfg"
    if config.is_symlink() or not config.is_file():
        return False
    try:
        lines = config.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return False
    values = []
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key.strip().lower() == "include-system-site-packages":
            values.append(value.strip().lower())
    return len(values) == 1 and values[0] == "false"


def _runtime_import_path_is_owned(path: Path, directory: Path) -> bool:
    """Reject symlinks in every component of a runtime import root."""

    current = path
    try:
        while True:
            if current.is_symlink():
                return False
            if current == directory:
                return True
            parent = current.parent
            if parent == current:
                return False
            current = parent
    except Exception:
        return False


def _runtime_import_roots_are_owned(directory: Path) -> bool:
    version_info = _bootstrap_initial_version_info
    if (
        type(version_info) is not tuple
        or len(version_info) != 2
        or type(version_info[0]) is not int
        or type(version_info[1]) is not int
    ):
        return False
    versioned = f"python{version_info[0]}.{version_info[1]}"
    roots = [
        directory / "lib" / versioned / "site-packages",
        directory / "Lib" / "site-packages",
    ]
    existing = []
    for root in roots:
        try:
            if root.exists():
                if root.is_symlink() or not root.is_dir():
                    return False
                existing.append(root)
        except Exception:
            return False
    if not existing:
        return False
    try:
        resolved_directory = _path_resolve(directory)
    except Exception:
        return False
    for root in existing:
        if not _runtime_import_path_is_owned(root, directory):
            return False
        pending = [root]
        while pending:
            current = pending.pop()
            try:
                children = tuple(current.iterdir())
            except Exception:
                return False
            for child in children:
                try:
                    if child.is_symlink():
                        return False
                    if child.is_dir():
                        pending.append(child)
                        continue
                    if not child.is_file() or child.suffix.lower() not in {
                        ".pth", ".egg-link"
                    }:
                        continue
                    lines = child.read_text(encoding="utf-8").splitlines()
                    for line in lines:
                        stripped = line.strip()
                        if not stripped or stripped.startswith("#"):
                            continue
                        if stripped.startswith("import ") or stripped.startswith(
                            "import\\t"
                        ):
                            return False
                        target = Path(stripped)
                        if not target.is_absolute():
                            target = child.parent / target
                        resolved = _path_resolve(target)
                        if (
                            resolved != resolved_directory
                            and resolved_directory not in resolved.parents
                        ):
                            return False
                except Exception:
                    return False
    return True


def _read_file_bytes(path: Path):
    native = _bootstrap_native_module
    open_file = getattr(native, "open", None)
    read = getattr(native, "read", None)
    close = getattr(native, "close", None)
    if not all(callable(value) for value in (open_file, read, close)):
        return None
    descriptor = None
    chunks: list[bytes] = []
    try:
        descriptor = open_file(
            os.fspath(path), getattr(native, "O_RDONLY", 0)
        )
        total = 0
        while True:
            chunk = read(descriptor, 1024 * 1024)
            if type(chunk) is not bytes:
                return None
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > 32 * 1024 * 1024:
                return None
            chunks.append(chunk)
    except Exception:
        return None
    finally:
        try:
            if descriptor is not None:
                close(descriptor)
        except Exception:
            pass


def _runtime_interpreter_matches_base(
    python: Path, base_python: "Path | None" = None
) -> bool:
    expected = base_python or _bootstrap_authenticated_base_python
    if not expected:
        return False
    try:
        if _path_resolve(python) == _path_resolve(expected):
            return True
    except Exception:
        return False
    try:
        for ancestor in _path_resolve(expected).parents:
            if ancestor.name != "Versions":
                continue
            relative = _path_resolve(expected).relative_to(ancestor)
            if not relative.parts:
                continue
            installation = ancestor / relative.parts[0]
            candidate = _path_resolve(python)
            if candidate == installation or installation in candidate.parents:
                return True
    except Exception:
        pass
    actual_bytes = _read_file_bytes(python)
    expected_bytes = _read_file_bytes(expected)
    return (
        actual_bytes is not None
        and expected_bytes is not None
        and actual_bytes == expected_bytes
    )


def _runtime_usable(
    directory: Path, base_python: "Path | None" = None
) -> bool:
    """Prove an isolated runtime is backed by the authenticated interpreter."""

    if directory.is_symlink() or not directory.is_dir():
        return False
    if not _isolated_venv_configured(directory):
        return False
    if not _runtime_import_roots_are_owned(directory):
        return False
    python = runtime_python(directory)
    if not python.is_file():
        return False
    if not _runtime_interpreter_matches_base(python, base_python):
        return False
    try:
        result = subprocess.run(
            [str(python), "-c", _PROBE_CODE],
            check=False,
            text=True,
            capture_output=True,
            env=_isolated_environment(directory, python),
            cwd=directory,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode != 0:
        return False
    lines = result.stdout.splitlines()
    if len(lines) < 2 or lines[0].strip() != "probe-ok":
        return False
    try:
        reported_prefix = _path_resolve(lines[1].strip())
    except OSError:
        return False
    return reported_prefix == _path_resolve(directory)


def _remove_runtime_shape(directory: Path) -> None:
    """Remove a corrupt shape without following symlinks outward."""

    if directory.is_symlink() or directory.is_file():
        directory.unlink()
    elif directory.is_dir():
        shutil.rmtree(directory)


def _ensure_owned_parents(directory: Path, workspace_root: Path) -> None:
    """Repair every owned parent component without following external links."""

    try:
        relative = directory.parent.relative_to(workspace_root)
    except ValueError:
        raise BootstrapError(
            f"Runtime path escapes the skill-owned area: {directory}"
        ) from None
    current = workspace_root
    for part in relative.parts:
        current = current / part
        if os.path.lexists(current) and (
            current.is_symlink() or not current.is_dir()
        ):
            current.unlink()
        current.mkdir(exist_ok=True)


def _caller_shadows_venv() -> bool:
    """Detect a caller path that could shadow the bootstrap venv module."""

    raw_path = _caller_environment_copy().get("PYTHONPATH", "")
    if not raw_path:
        return False
    for entry in raw_path.split(os.pathsep):
        try:
            candidate = Path(entry or os.curdir) / "venv.py"
            if candidate.is_file():
                return True
        except (OSError, ValueError):
            continue
    return False


def _ensure_venv(
    directory: Path, base_python: Path, workspace_root: Path
) -> Path:
    if _runtime_usable(directory, base_python):
        return runtime_python(directory)
    if _caller_shadows_venv():
        raise BootstrapError(
            "Refusing runtime setup while caller PYTHONPATH shadows venv.py"
        )
    if os.path.lexists(directory):
        _remove_runtime_shape(directory)
    _ensure_owned_parents(directory, workspace_root)
    directory.mkdir(exist_ok=True)
    _run(
        [str(base_python), "-m", "venv", str(directory)],
        env=_isolated_environment(directory, base_python),
        cwd=directory,
    )
    if not _runtime_usable(directory, base_python):
        raise BootstrapError(
            f"Virtualenv creation did not produce a usable runtime at {directory}"
        )
    return runtime_python(directory)


def _check_containment(directory: Path, workspace_root: Path) -> None:
    """Enforce that the runtime path is canonically owned by the skill area.

    Callers normalize the owned chain first (replacing links without
    following them); this check then refuses anything that still resolves
    outside the skill-owned area.
    """

    absolute_directory = directory.absolute()
    absolute_workspace = workspace_root.absolute()
    if (
        absolute_directory != absolute_workspace
        and absolute_workspace not in absolute_directory.parents
    ):
        raise BootstrapError(
            f"Runtime path escapes the skill-owned area: {directory}"
        )
    resolved_workspace = _path_resolve(workspace_root)
    resolved_directory = _path_resolve(directory)
    if directory.is_symlink():
        return
    if (
        resolved_directory != resolved_workspace
        and resolved_workspace not in resolved_directory.parents
    ):
        raise BootstrapError(
            f"Runtime path escapes the skill-owned area: {directory}"
        )


def ensure_environment(
    project_root: Path,
    *,
    workspace_root: "Path | None" = None,
    required: tuple[tuple[str, str], ...] = REQUIRED_PACKAGES,
    optional: tuple[tuple[str, str], ...] = OPTIONAL_PACKAGES,
    base_python: "Path | None" = None,
    install_timeout: float = 300,
) -> Runtime:
    """Create or reuse the isolated runtime and verify required dependencies."""

    required = _checked_package_specs(required, "Required")
    optional = _checked_package_specs(optional, "Optional")
    install_timeout = _checked_timeout(install_timeout, "Install timeout")
    public_project_root = project_root
    if workspace_root is None:
        public_workspace_root = project_root
    else:
        public_workspace_root = workspace_root
    project_root = _path_resolve(project_root)
    workspace_root = _path_resolve(public_workspace_root)
    if not project_root.is_dir():
        raise BootstrapError(f"Project root is not a directory: {project_root}")
    if not workspace_root.is_dir():
        raise BootstrapError(f"Workspace root is not a directory: {workspace_root}")

    directory = runtime_directory(workspace_root)
    _ensure_owned_parents(directory, workspace_root)
    _check_containment(directory, workspace_root)
    _mark_not_ready(directory, workspace_root, "preparing")
    _check_protected_pip_environment()
    if base_python is None:
        if not _bootstrap_authenticated_base_python:
            _mark_not_ready(directory, workspace_root, "failed")
            raise BootstrapError(
                "Could not establish the authenticated base interpreter; retry setup"
            )
        base_python = _bootstrap_authenticated_base_python
    else:
        if type(base_python) is not str and _bootstrap_clean_path(
            base_python
        ) is None:
            _mark_not_ready(directory, workspace_root, "failed")
            raise BootstrapError(
                "Explicit base interpreter must be a path to the authenticated interpreter"
            )
        base_python = _path_resolve(base_python)
        if not _runtime_interpreter_matches_base(base_python):
            _mark_not_ready(directory, workspace_root, "failed")
            raise BootstrapError(
                "Could not run explicit base interpreter: it is not authenticated;"
                " retry setup"
            )
    base_python = _path_resolve(base_python)
    try:
        python = _ensure_venv(directory, base_python, workspace_root)
        if directory.is_symlink():
            raise BootstrapError(
                f"Runtime path is not owned by the skill area: {directory}"
            )
        _check_containment(directory, workspace_root)
        _mark_not_ready(directory, workspace_root, "checking")
        _ensure_packages(python, required, directory, install_timeout)
        warnings = _ensure_optional(python, optional, directory, install_timeout)
    except BootstrapError:
        _mark_not_ready(directory, workspace_root, "failed")
        raise

    public_directory = _public_path_like(public_workspace_root, directory)
    public_python = _public_path_like(public_directory, python)
    runtime = Runtime(
        project_root=_public_path_like(public_project_root, project_root),
        directory=public_directory,
        python=public_python,
        ready=True,
        workspace_root=_public_path_like(
            public_workspace_root, workspace_root
        ),
        warnings=warnings,
    )
    _write_owned_file(
        directory / "environment.json",
        json.dumps(runtime.as_dict(), indent=2) + "\n",
    )
    return runtime


_PROTECTED_RUNTIME_ENVIRONMENT = (
    _PYTHON_IDENTITY_ENVIRONMENT
    | _PIP_DESTINATION_ENVIRONMENT
    | _RUNTIME_STORAGE_ENVIRONMENT
    | _DYNAMIC_LOADER_ENVIRONMENT
)


def _checked_environment_overrides(
    overrides: "Mapping[str, str] | None",
) -> tuple[tuple[str, str], ...]:
    """Reject caller values that could escape the prepared interpreter."""

    if overrides is None:
        return ()
    if type(overrides) is dict:
        items = tuple(dict.items(overrides))
    elif type(overrides) is tuple:
        items = overrides
    else:
        raise BootstrapError(
            "Runtime environment overrides must be an exact mapping or tuple"
        )
    checked: list[tuple[str, str]] = []
    for item in items:
        if type(item) not in (tuple, list) or len(item) != 2:
            raise BootstrapError(
                "Runtime environment overrides must contain string pairs"
            )
        key, value = item
        if type(key) is not str or type(value) is not str:
            raise BootstrapError(
                "Runtime environment overrides must map strings to strings"
            )
        if key.upper() in _PROTECTED_RUNTIME_ENVIRONMENT:
            raise BootstrapError(
                f"Protected runtime environment variable {key!r}"
                " cannot be overridden"
            )
        checked.append((key, value))
    return tuple(checked)


def _checked_runtime(runtime) -> Runtime:
    """Require the exact ready runtime owned by its canonical workspace."""

    if type(runtime) is not Runtime:
        raise BootstrapError("Runtime operation needs a prepared Runtime")
    if runtime.ready is not True:
        raise BootstrapError("Runtime operation needs a ready prepared Runtime")
    try:
        project_root = _path_resolve(runtime.project_root)
        runtime_workspace_root = runtime.workspace_root
        if runtime_workspace_root is None:
            runtime_workspace_root = runtime.project_root
        workspace_root = _path_resolve(runtime_workspace_root)
        directory = _bootstrap_clean_path(runtime.directory)
        python = _bootstrap_clean_path(runtime.python)
        if directory is None or python is None:
            raise BootstrapError("runtime path storage is not clean")
    except Exception as exc:
        raise BootstrapError(
            "Runtime operation needs a usable canonical Runtime"
        ) from exc
    if not project_root.is_dir() or not workspace_root.is_dir():
        raise BootstrapError(
            "Runtime operation needs a usable canonical Runtime"
        )
    if directory.is_symlink() or not directory.is_dir():
        raise BootstrapError(
            "Runtime operation needs the canonical prepared runtime directory"
        )
    expected_directory = runtime_directory(workspace_root)
    if directory.absolute() != expected_directory.absolute():
        raise BootstrapError(
            "Runtime operation needs the canonical prepared runtime directory"
        )
    try:
        _check_containment(directory, workspace_root)
    except BootstrapError as exc:
        raise BootstrapError(
            "Runtime operation needs the canonical prepared runtime directory"
        ) from exc
    expected_python = runtime_python(directory)
    if python.absolute() != expected_python.absolute():
        raise BootstrapError(
            "Runtime operation needs the canonical prepared interpreter"
        )
    if not _runtime_usable(directory):
        raise BootstrapError(
            "Runtime operation needs a usable prepared interpreter"
        )
    return Runtime(
        project_root=project_root,
        directory=directory,
        python=python,
        ready=True,
        workspace_root=workspace_root,
        warnings=runtime.warnings,
    )


def _runtime_environment(
    runtime: Runtime,
    overrides: "Mapping[str, str] | None" = None,
) -> dict[str, str]:
    """Build an environment that cannot inherit outer Python search paths."""

    checked_overrides = _checked_environment_overrides(overrides)
    environment = process_environment(runtime.directory)
    inherited_path = next(
        (
            value for key, value in environment.items()
            if key.upper() == "PATH"
        ),
        os.defpath,
    )
    for key in tuple(environment):
        if key.upper() in (
            _PYTHON_IDENTITY_ENVIRONMENT
            | _PIP_DESTINATION_ENVIRONMENT
            | _DYNAMIC_LOADER_ENVIRONMENT
        ):
            environment.pop(key, None)
    environment["PYTHONNOUSERSITE"] = "1"
    environment["VIRTUAL_ENV"] = _runtime_path_text(runtime.directory)
    environment["PYTHONPATH"] = _runtime_path_text(runtime.project_root)
    environment["PIP_CONFIG_FILE"] = os.devnull
    environment["PATH"] = os.pathsep.join(
        (_runtime_path_text(runtime.python.parent), inherited_path)
    )
    for key, value in checked_overrides:
        environment[key] = value
    return environment


def run_in_runtime(
    runtime: Runtime,
    operation,
    *,
    check: bool = True,
    env: "Mapping[str, str] | None" = None,
    timeout: float = 300,
) -> subprocess.CompletedProcess:
    """Run a shell-free Python operation with the prepared interpreter."""

    runtime = _checked_runtime(runtime)
    arguments = _checked_operation(operation)
    return _run(
        [_runtime_path_text(runtime.python), *arguments],
        check=check,
        env=_runtime_environment(runtime, env),
        cwd=runtime.project_root,
        timeout=timeout,
    )


def invoke(
    project_root: Path,
    operation,
    *,
    operation_timeout: float = 300,
    operation_env: "Mapping[str, str] | None" = None,
    **kwargs,
):
    """Prepare the runtime, then execute a command inside that runtime.

    ``operation`` is a shell-free sequence of arguments for the prepared
    Python interpreter, such as ``["-m", "some_module"]`` or
    ``["-c", "..."]``. It is never executed by the caller's interpreter.
    When setup fails, the operation never runs and the setup error propagates.
    """

    arguments = _checked_operation(operation)
    operation_timeout = _checked_timeout(
        operation_timeout, "Operation timeout"
    )
    checked_operation_env = _checked_environment_overrides(operation_env)
    runtime = ensure_environment(project_root, **kwargs)
    return run_in_runtime(
        runtime,
        arguments,
        env=checked_operation_env,
        timeout=operation_timeout,
    )
