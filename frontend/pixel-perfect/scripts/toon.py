"""TOON (Token-Oriented Object Notation) encoder.

Covers the subset the pixel-perfect scripts emit: nested objects, inline arrays
of primitives, uniform arrays of flat objects as tables, and mixed arrays as
dash lists. Indentation is two spaces and the delimiter is a comma.
"""
import math
import re

_BARE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_NUMERIC = re.compile(r"^-?\d+(\.\d+)?([eE][+-]?\d+)?$")
_NEEDS_QUOTES = re.compile(r'[:"\\\[\]{},\n\r\t]')
_ESCAPES = {"\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _plain(value):
    """Convert NumPy scalars, arrays and tuples into plain Python values."""
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if hasattr(value, "tolist") and not isinstance(value, (str, bytes)):
        return _plain(value.tolist())
    return value


def _quote(text):
    return '"' + "".join(_ESCAPES.get(char, char) for char in text) + '"'


def _string(text):
    if (
        text == ""
        or text != text.strip()
        or text in ("true", "false", "null")
        or text.startswith("-")
        or _NUMERIC.match(text)
        or _NEEDS_QUOTES.search(text)
    ):
        return _quote(text)
    return text


def _number(value):
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        return "null"
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    text = format(value, ".6f").rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _primitive(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _number(value)
    return _string(str(value))


def _key(key):
    return key if _BARE_KEY.match(key) else _quote(key)


def _is_primitive(value):
    return not isinstance(value, (dict, list))


def _table_fields(items):
    """Field names when every item is a flat object with the same keys."""
    if not items or not all(isinstance(item, dict) and item for item in items):
        return None
    fields = list(items[0])
    for item in items:
        if set(item) != set(fields) or not all(_is_primitive(v) for v in item.values()):
            return None
    return fields


def _field(key, value, depth, lines, first_prefix=None):
    """Write one object field. `depth` is where the field logically sits."""
    pad = first_prefix if first_prefix is not None else "  " * depth
    if isinstance(value, dict):
        lines.append(pad + key + ":")
        _object(value, depth + 1, lines)
    elif isinstance(value, list):
        _array(key, value, depth, lines, pad)
    else:
        lines.append(pad + key + ": " + _primitive(value))


def _object(mapping, depth, lines):
    for key, value in mapping.items():
        _field(_key(key), value, depth, lines)


def _array(key, items, depth, lines, pad):
    header = pad + (key or "") + "[{}]".format(len(items))
    if not items:
        lines.append(header + ":")
        return
    if all(_is_primitive(item) for item in items):
        lines.append(header + ": " + ",".join(_primitive(item) for item in items))
        return
    fields = _table_fields(items)
    row_pad = "  " * (depth + 1)
    if fields:
        lines.append(header + "{" + ",".join(_key(f) for f in fields) + "}:")
        for item in items:
            lines.append(row_pad + ",".join(_primitive(item[f]) for f in fields))
        return
    lines.append(header + ":")
    for item in items:
        if isinstance(item, dict):
            if not item:
                lines.append(row_pad + "-")
                continue
            first = True
            for name, value in item.items():
                _field(_key(name), value, depth + 2, lines, row_pad + "- " if first else None)
                first = False
        elif isinstance(item, list):
            _array(None, item, depth + 1, lines, row_pad + "- ")
        else:
            lines.append(row_pad + "- " + _primitive(item))


def encode(value):
    """Encode a JSON-like value as a TOON document."""
    value = _plain(value)
    lines = []
    if isinstance(value, dict):
        _object(value, 0, lines)
    elif isinstance(value, list):
        _array(None, value, 0, lines, "")
    else:
        lines.append(_primitive(value))
    return "\n".join(lines)
