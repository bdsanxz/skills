#!/usr/bin/env python3
"""Get knowledge from local sources first and from the web second.

Reference roots and a local wiki are looked in first. What a web search or a fetch
brings is kept in the wiki, so that the next lookup is local.

Exit code: 0 done, 1 the request failed, 2 the command was used wrongly.
Needs Python 3.9 or later and nothing else. The ref commands for git need git.
"""

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser

MIB = 1024 * 1024
HOME_ENV = "GET_KNOWLEDGE_HOME"
DEFAULT_HOME = "~/.get-knowledge"


class UsageError(Exception):
    """The command was used wrongly."""


class Problem(Exception):
    """The request could not be carried out."""


def note(text):
    print(text, file=sys.stderr)


# --------------------------------------------------------------------------- places


def home():
    configured = os.environ.get(HOME_ENV, "").strip()
    return os.path.abspath(os.path.expanduser(configured or DEFAULT_HOME))


def wikis_dir():
    return os.path.join(home(), "wikis")


def files_dir():
    return os.path.join(home(), "files")


def repos_dir():
    return os.path.join(home(), "repos")


def references_file():
    return os.path.join(home(), "references.json")


def settings_file():
    return os.path.join(home(), "settings.json")


def atomic_write(path, content, binary=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(path))
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(content if binary else content.encode("utf-8"))
        os.replace(temporary, path)
    except BaseException:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


# --------------------------------------------------------------------------- settings

PROVIDERS = ("exa", "keenable", "parallel")
SEARCH_TYPES = ("auto", "fast", "deep")
LIVECRAWL = ("fallback", "preferred")
MAX_NUM_RESULTS = 20
MIN_FETCH_SECONDS = 30
MAX_FETCH_SECONDS = 3600

DEFAULTS = {
    "provider": "exa",
    "searchTimeoutMs": 30000,
    "fetchTimeoutSeconds": MIN_FETCH_SECONDS,
    "maxResponseBytes": 5 * MIB,
    "defaultNumResults": 5,
    "defaultSearchType": "auto",
    "defaultLivecrawl": "fallback",
    "pageChars": 24000,
    "exaApiKey": "",
    "keenableApiKey": "",
    "parallelApiKey": "",
}


def whole(low, high):
    return lambda value: isinstance(value, int) and not isinstance(value, bool) \
        and low <= value <= high


ACCEPTS = {
    "provider": lambda value: value in PROVIDERS,
    "searchTimeoutMs": whole(1000, 3600 * 1000),
    "fetchTimeoutSeconds": whole(MIN_FETCH_SECONDS, MAX_FETCH_SECONDS),
    "maxResponseBytes": whole(1, 512 * MIB),
    "defaultNumResults": whole(1, MAX_NUM_RESULTS),
    "defaultSearchType": lambda value: value in SEARCH_TYPES,
    "defaultLivecrawl": lambda value: value in LIVECRAWL,
    "pageChars": whole(2000, 400000),
    "exaApiKey": lambda value: isinstance(value, str),
    "keenableApiKey": lambda value: isinstance(value, str),
    "parallelApiKey": lambda value: isinstance(value, str),
}


def load_settings():
    """The settings in effect, and what is wrong with the settings file."""
    settings = dict(DEFAULTS)
    path = settings_file()
    try:
        with open(path, encoding="utf-8") as stream:
            stored = json.load(stream)
    except FileNotFoundError:
        return settings, []
    except (OSError, ValueError) as error:
        return settings, ["%s cannot be read (%s); the defaults are used." % (path, error)]
    if not isinstance(stored, dict):
        return settings, ["%s must hold one JSON object; the defaults are used." % path]
    problems = []
    for key, value in stored.items():
        if key not in ACCEPTS:
            problems.append("%s: unknown setting '%s' is ignored." % (path, key))
        elif not ACCEPTS[key](value):
            shown = "(hidden)" if key.endswith("ApiKey") else json.dumps(value)
            problems.append("%s: %s = %s is not allowed; the default is used."
                            % (path, key, shown))
        else:
            settings[key] = value
    return settings, problems


def settings_or_warn():
    settings, problems = load_settings()
    for problem in problems:
        note("note: " + problem)
    return settings


def api_keys(settings):
    """Each provider's key and where it comes from. The environment wins."""
    keys = {}
    for provider, variable, setting in (("exa", "EXA_API_KEY", "exaApiKey"),
                                        ("keenable", "KEENABLE_API_KEY", "keenableApiKey"),
                                        ("parallel", "PARALLEL_API_KEY", "parallelApiKey")):
        from_env = os.environ.get(variable, "").strip()
        stored = settings[setting].strip()
        if from_env:
            keys[provider] = (from_env, "environment variable %s" % variable)
        elif stored:
            keys[provider] = (stored, "settings.json")
        else:
            keys[provider] = ("", "")
    return keys


# --------------------------------------------------------------------------- http

BROWSER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                 "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")
PLAIN_AGENT = "get-knowledge"


class Redirects(urllib.request.HTTPRedirectHandler):
    """Follow 308 for GET as well, which Python 3.9 does not do by itself."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if code == 308 and req.get_method() in ("GET", "HEAD"):
            code = 307
        return super().redirect_request(req, fp, code, msg, headers, newurl)

    http_error_308 = urllib.request.HTTPRedirectHandler.http_error_302


OPENER = urllib.request.build_opener(Redirects)


class Response:
    def __init__(self, status, reason, headers, url, body):
        self.status = status
        self.reason = reason
        self.headers = headers
        self.url = url
        self.body = body

    @property
    def ok(self):
        return 200 <= self.status < 300

    def header(self, name):
        return self.headers.get(name) or ""


def too_large(limit):
    if limit == 5 * MIB:
        return "Response too large (exceeds 5MB limit)"
    return "Response too large (exceeds the maxResponseBytes setting of %d bytes)" % limit


def http_request(method, url, headers, data, deadline, limit, no_body=()):
    """One request with a deadline for the whole exchange and a bounded body.

    A status listed in no_body is returned without its body being read.
    """
    headers = dict(headers)
    headers.setdefault("Accept-Encoding", "gzip")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise Problem("Request timed out")
    try:
        try:
            raw = OPENER.open(request, timeout=remaining)
        except urllib.error.HTTPError as error:
            raw = error
        with raw:
            status = getattr(raw, "status", None) or raw.code
            reason = getattr(raw, "reason", "") or ""
            if status in no_body:
                return Response(status, reason, raw.headers, raw.geturl(), b"")
            encoding = (raw.headers.get("Content-Encoding") or "").strip().lower()
            if encoding in ("gzip", "x-gzip", "deflate"):
                inflater = zlib.decompressobj(32 + zlib.MAX_WBITS)
            elif encoding in ("", "identity"):
                inflater = None
                declared = (raw.headers.get("Content-Length") or "").strip()
                if declared.isdigit() and int(declared) > limit:
                    raise Problem(too_large(limit))
            else:
                raise Problem("Request failed: the server answered with the content "
                              "encoding '%s', which cannot be read" % encoding)
            chunks, size = [], 0
            read = getattr(raw, "read1", raw.read)
            while True:
                if time.monotonic() > deadline:
                    raise Problem("Request timed out")
                chunk = read(65536)
                if not chunk:
                    break
                if inflater:
                    chunk = inflater.decompress(chunk, limit - size + 1)
                size += len(chunk)
                if size > limit:
                    raise Problem(too_large(limit))
                chunks.append(chunk)
            return Response(status, reason, raw.headers, raw.geturl(), b"".join(chunks))
    except Problem:
        raise
    except socket.timeout:
        raise Problem("Request timed out")
    except urllib.error.URLError as error:
        if isinstance(error.reason, socket.timeout):
            raise Problem("Request timed out")
        raise Problem("Request failed: %s" % (error.reason or error))
    except (OSError, ValueError, zlib.error, EOFError) as error:
        raise Problem("Request failed: %s" % (error or type(error).__name__))
    except Exception as error:  # http.client raises several unrelated classes
        raise Problem("Request failed: %s: %s" % (type(error).__name__, error))


# --------------------------------------------------------------------------- html

VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
DROP = frozenset("script style meta link noscript iframe object embed template svg canvas "
                 "head title base".split())
HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
BLOCK = frozenset(
    "address article aside blockquote body center dd details dialog dir div dl dt fieldset "
    "figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html li main menu nav "
    "ol p pre section summary table tbody td tfoot th thead tr ul caption".split())
CLOSES_P = BLOCK - frozenset("body html td th tr tbody thead tfoot caption".split())
P_SCOPE = frozenset("table td th caption button".split())
CLOSES = {
    "li": (("li",), ("ul", "ol", "menu", "dir")),
    "dt": (("dt", "dd"), ("dl",)),
    "dd": (("dt", "dd"), ("dl",)),
    "tr": (("tr",), ("table",)),
    "td": (("td", "th"), ("tr", "table")),
    "th": (("td", "th"), ("tr", "table")),
    "thead": (("thead", "tbody", "tfoot"), ("table",)),
    "tbody": (("thead", "tbody", "tfoot"), ("table",)),
    "tfoot": (("thead", "tbody", "tfoot"), ("table",)),
    "option": (("option",), ("select", "datalist")),
}
RICH_CELL = frozenset("table ul ol pre blockquote h1 h2 h3 h4 h5 h6 hr dl".split())
CHROME_CLASSES = frozenset("mw-editsection noprint navbox vector-dropdown".split())
MAX_DEPTH = 200
BREAK = "\x00"
SPACE = re.compile(r"[ \t\r\n\f\v\xa0]+")


class Node:
    __slots__ = ("tag", "attrs", "children", "parent", "depth", "_blocky", "_size")

    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = attrs
        self.children = []
        self.parent = parent
        self.depth = parent.depth + 1 if parent else 0
        self._blocky = None
        self._size = None

    def walk(self):
        stack = [self]
        while stack:
            node = stack.pop()
            yield node
            stack.extend(child for child in reversed(node.children)
                         if isinstance(child, Node))

    def blocky(self):
        """Whether a block element is somewhere inside."""
        if self._blocky is None:
            self._blocky = any(isinstance(child, Node) and child.tag not in DROP
                               and (child.tag in BLOCK or child.blocky())
                               for child in self.children)
        return self._blocky

    def size(self):
        """How much readable text is inside."""
        if self._size is None:
            total = 0
            for child in self.children:
                if isinstance(child, str):
                    total += len(child.strip())
                elif child.tag not in DROP:
                    total += child.size()
            self._size = total
        return self._size


class Tree(HTMLParser):
    """A forgiving element tree: enough of the HTML rules to nest lists, tables and
    paragraphs the way a browser does."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", {}, None)
        self.here = self.root

    def close(self, tags, scope):
        node = self.here
        while node is not self.root and node.tag not in scope:
            if node.tag in tags:
                self.here = node.parent
                return
            node = node.parent

    def handle_starttag(self, tag, attrs):
        if tag in CLOSES_P:
            self.close(("p",), P_SCOPE)
        if tag in CLOSES:
            self.close(*CLOSES[tag])
        node = Node(tag, {key: value or "" for key, value in attrs}, self.here)
        self.here.children.append(node)
        if tag not in VOID and node.depth < MAX_DEPTH:
            self.here = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.here.tag == tag and tag not in VOID:
            self.here = self.here.parent

    def handle_endtag(self, tag):
        node = self.here
        while node is not self.root:
            if node.tag == tag:
                self.here = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.here.children.append(data)


def parse_html(text):
    tree = Tree()
    try:
        tree.feed(text.replace(BREAK, ""))
        tree.close()
    except Exception:  # a broken document still yields what was parsed so far
        pass
    return tree.root


def squeeze(text):
    return SPACE.sub(" ", text).strip()


def tidy(text):
    """Inline markdown as final text: one space between words, real line breaks."""
    lines = [line.strip() for line in SPACE.sub(" ", text).split(BREAK)]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def around(inner, mark):
    """Put a mark around text, keeping the spaces at its ends outside the mark."""
    core = inner.strip(" \t\r\n\f\v\xa0" + BREAK)
    if not core:
        return inner
    start = inner.index(core)
    return inner[:start] + mark + core + mark + inner[start + len(core):]


def raw_text(node):
    parts = []
    for child in node.children:
        if isinstance(child, str):
            parts.append(child)
        elif child.tag == "br":
            parts.append("\n")
        elif child.tag not in DROP:
            parts.append(raw_text(child))
    return "".join(parts)


def page_title(root):
    for node in root.walk():
        if node.tag != "title":
            continue
        above = node.parent
        while above is not None and above.tag != "svg":
            above = above.parent
        title = squeeze("".join(c for c in node.children if isinstance(c, str)))
        if above is None and title:
            return title
    return ""


def page_base(root, url):
    for node in root.walk():
        if node.tag == "base" and node.attrs.get("href", "").strip():
            return urllib.parse.urljoin(url, node.attrs["href"].strip())
    return url


def main_part(root):
    """The element that holds the page's own content, when the page marks one."""
    mains, articles = [], []
    for node in root.walk():
        if node.tag == "main" or node.attrs.get("role") == "main":
            mains.append(node)
        elif node.tag == "article":
            articles.append(node)
    if mains:
        best = max(mains, key=Node.size)
        if best.size() >= 200:
            return best
    if articles:
        best = max(articles, key=Node.size)
        if best.size() >= 200 and best.size() * 2 >= root.size():
            return best
    return None


class Markdown:
    def __init__(self, base, whole_page):
        self.base = base
        self.whole_page = whole_page
        self.left_out = False

    def skipped(self, node):
        if node.tag in DROP or node.attrs.get("aria-hidden") == "true":
            return True
        if self.whole_page:
            return False
        if node.tag == "nav" or node.attrs.get("role") == "navigation" \
                or not CHROME_CLASSES.isdisjoint(node.attrs.get("class", "").split()):
            self.left_out = True
            return True
        return False

    def render(self, node):
        return "\n\n".join(text for _kind, text in self.flow(node.children))

    def flow(self, children):
        """Block content: a list of (kind, text), kind being text, list or code."""
        blocks, pending = [], []

        def flush():
            text = tidy("".join(pending))
            del pending[:]
            if text:
                blocks.append(("text", text))

        for child in children:
            if isinstance(child, str):
                pending.append(child)
                continue
            if self.skipped(child):
                continue
            tag = child.tag
            if tag not in BLOCK:
                if child.blocky() and tag != "a":
                    flush()
                    blocks.extend(self.flow(child.children))
                else:
                    pending.append(self.inline(child))
                continue
            flush()
            if tag in HEADINGS:
                text = tidy(self.inline_all(child)).replace("\n", " ")
                text = re.sub(r"\s*[\xb6#\xa7]+$", "", text)
                if text:
                    blocks.append(("text", "#" * HEADINGS[tag] + " " + text))
            elif tag == "hr":
                blocks.append(("text", "---"))
            elif tag == "pre":
                code = self.pre(child)
                if code:
                    blocks.append(("code", code))
            elif tag == "blockquote":
                inner = self.render(child)
                if inner:
                    quoted = "\n".join((">" + (" " + line if line else ""))
                                       for line in inner.split("\n"))
                    blocks.append(("text", quoted))
            elif tag in ("ul", "ol", "menu", "dir"):
                text = self.listing(child)
                if text:
                    blocks.append(("list", text))
            elif tag == "li":
                text = self.item(child.children, "- ")
                if text:
                    blocks.append(("list", text))
            elif tag == "table":
                blocks.extend(self.table(child))
            elif tag == "dt":
                text = tidy(self.inline_all(child))
                if text:
                    blocks.append(("text", around(text, "**")))
            else:
                blocks.extend(self.flow(child.children))
        flush()
        return blocks

    def inline_all(self, node):
        return "".join(self.inline(child) for child in node.children)

    def inline(self, node):
        if isinstance(node, str):
            return node
        if self.skipped(node):
            return ""
        tag = node.tag
        if tag == "br":
            return BREAK
        if tag == "img":
            return self.image(node)
        if tag == "math":
            return self.math(node)
        if tag == "pre":
            return " `" + squeeze(raw_text(node)).replace("`", "'") + "` "
        inner = self.inline_all(node)
        if tag in ("strong", "b"):
            return around(inner, "**")
        if tag in ("em", "i"):
            return around(inner, "*")
        if tag in ("del", "s", "strike"):
            return around(inner, "~~")
        if tag in ("code", "kbd", "samp", "tt"):
            text = squeeze(inner.replace(BREAK, " "))
            if not text:
                return inner
            return "`` %s ``" % text if "`" in text else "`%s`" % text
        if tag == "a":
            return self.link(node, inner)
        if tag in BLOCK:
            return " " + inner + " "
        return inner

    def link(self, node, inner):
        href = node.attrs.get("href", "").strip()
        text = squeeze(inner.replace(BREAK, " "))
        if not text:
            return ""
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            return "" if text in ("\xb6", "#", "\xa7") else inner
        url = urllib.parse.urljoin(self.base, href)
        if re.search(r"[\s()<>]", url):
            url = "<%s>" % url.replace("<", "%3C").replace(">", "%3E")
        lead = " " if inner[:1] in " \t\r\n" + BREAK else ""
        trail = " " if inner[-1:] in " \t\r\n" + BREAK else ""
        return "%s[%s](%s)%s" % (lead, text, url, trail)

    def math(self, node):
        """A formula once, as TeX when the page gives it, and not symbol by symbol."""
        for inner in node.walk():
            if inner.tag == "annotation" and "tex" in inner.attrs.get("encoding", "").lower():
                tex = squeeze(raw_text(inner))
                if tex:
                    return " $%s$ " % tex
        return " %s " % squeeze(node.attrs.get("alttext", "") or raw_text(node))

    def image(self, node):
        alt = squeeze(node.attrs.get("alt", ""))
        source = (node.attrs.get("src") or node.attrs.get("data-src") or "").strip()
        if not source or source.lower().startswith("data:"):
            return alt
        return "![%s](%s)" % (alt, urllib.parse.urljoin(self.base, source))

    def pre(self, node):
        language = ""
        around_it = [above for above in (node.parent, node.parent.parent if node.parent
                                         else None) if above is not None]
        for inner in list(node.walk()) + around_it:
            brush = re.search(r"brush:\s*([\w+#.-]+)", inner.attrs.get("class", ""))
            if brush:
                language = brush.group(1)
                break
            for name in inner.attrs.get("class", "").split():
                found = re.match(r"(?:language|lang|highlight-source|highlight)-([\w+#.-]+)$",
                                 name)
                if found and found.group(1) not in ("default", "none", "text"):
                    language = found.group(1)
                    break
            language = language or inner.attrs.get("data-language", "") \
                or inner.attrs.get("data-lang", "")
            if language:
                break
        text = raw_text(node).replace("\r\n", "\n").strip("\n").rstrip()
        if not text.strip():
            return ""
        fence = "```"
        while fence in text:
            fence += "`"
        return "%s%s\n%s\n%s" % (fence, squeeze(language), text, fence)

    def item(self, children, marker):
        blocks = self.flow(children)
        if not blocks:
            return ""
        body = blocks[0][1]
        for (before, _), (kind, text) in zip(blocks, blocks[1:]):
            body += ("\n" if "list" in (before, kind) else "\n\n") + text
        pad = " " * len(marker)
        lines = body.split("\n")
        return marker + lines[0] + "".join("\n" + (pad + line if line else "")
                                           for line in lines[1:])

    def listing(self, node):
        ordered = node.tag == "ol"
        start = node.attrs.get("start", "").strip()
        number = int(start) if re.fullmatch(r"-?\d{1,9}", start) else 1
        items = []
        for child in node.children:
            if isinstance(child, str):
                if not child.strip():
                    continue
                content = [child]
            elif self.skipped(child):
                continue
            elif child.tag == "li":
                content = child.children
            else:
                content = [child]
            text = self.item(content, "%d. " % number if ordered else "- ")
            if text:
                items.append(text)
                number += 1
        return "\n".join(items)

    def table(self, node):
        blocks, rows = [], []
        for child in node.children:
            if not isinstance(child, Node) or self.skipped(child):
                continue
            if child.tag == "caption":
                text = tidy(self.inline_all(child))
                if text:
                    blocks.append(("text", around(text, "**")))
            elif child.tag == "tr":
                rows.append(child)
            elif child.tag in ("thead", "tbody", "tfoot"):
                rows.extend(row for row in child.children
                            if isinstance(row, Node) and row.tag == "tr")
        cells = [[cell for cell in row.children
                  if isinstance(cell, Node) and cell.tag in ("td", "th")] for row in rows]
        cells = [row for row in cells if row]
        if not cells:
            return blocks + self.flow([c for c in node.children if isinstance(c, Node)
                                       and c.tag not in ("caption", "colgroup", "col")])
        rich = any(inner.tag in RICH_CELL for row in cells for cell in row
                   for inner in cell.walk())
        if rich or max(len(row) for row in cells) < 2:
            for row in cells:
                for cell in row:
                    blocks.extend(self.flow(cell.children))
            return blocks
        lines = []
        for row in cells:
            texts = []
            for cell in row:
                text = tidy(self.inline_all(cell)).replace("\n", " ").replace("|", "\\|")
                texts.append(text)
                span = cell.attrs.get("colspan", "").strip()
                if span.isdigit():
                    texts.extend([""] * (min(int(span), 50) - 1))
            lines.append(texts)
        width = max(len(line) for line in lines)
        table = []
        for index, texts in enumerate(lines):
            texts = texts + [""] * (width - len(texts))
            table.append("| " + " | ".join(texts) + " |")
            if index == 0:
                table.append("|" + " --- |" * width)
        blocks.append(("text", "\n".join(table)))
        return blocks


def plain_text(node, skipped, parts):
    for child in node.children:
        if isinstance(child, str):
            parts.append(SPACE.sub(" ", child))
        elif skipped(child):
            continue
        elif child.tag == "br":
            parts.append("\n")
        elif child.tag == "pre":
            parts.append("\n\n" + raw_text(child).strip("\n") + "\n\n")
        elif child.tag in BLOCK:
            parts.append("\n\n")
            plain_text(child, skipped, parts)
            parts.append("\n\n")
        else:
            plain_text(child, skipped, parts)


def convert_html(html, url, fmt, whole_page):
    """HTML as markdown or text: (title, content, whether the page was cut to its
    main content)."""
    root = parse_html(html)
    writer = Markdown(page_base(root, url), whole_page)
    start = None if whole_page else main_part(root)
    if fmt == "text":
        parts = []
        plain_text(start or root, writer.skipped, parts)
        text = re.sub(r"[ \t]*\n[ \t]*", "\n", "".join(parts))
        content = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]{2,}", " ", text)).strip()
    else:
        content = writer.render(start or root)
    if start is not None and not content.strip():
        return convert_html(html, url, fmt, True)
    return page_title(root), content, start is not None or writer.left_out


# --------------------------------------------------------------------------- wiki

PAGE_START = "<!-- knowledge-page"
PAGE_END = "-->"
PAGE_NAME = re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.part-(\d{3}))?\.md$")
MAX_SLUG = 80
MAX_PAGES = 999
SECRET_KEY = re.compile(r"token|code|secret|password|credential|api[-_]?key|api[-_]?secret|"
                        r"authorization|client[-_]?secret|client[-_]?id|private[-_]?key|"
                        r"signature|sig$", re.I)
STOPWORDS = frozenset(
    "a an and are as at be but by does for from how if in into is it no not of on or such "
    "that the their then there these they this to was will with".split())
BM25_K1 = 1.2
BM25_B = 0.75
TITLE_WEIGHT = 3
META_WEIGHT = 2
BODY_WEIGHT = 1


def slugify(value):
    slug = "".join(char for char in unicodedata.normalize("NFKD", value)
                   if not unicodedata.combining(char)).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    if len(slug) > MAX_SLUG:
        digest = hashlib.sha1(value.encode("utf-8", "replace")).hexdigest()[:8]
        slug = slug[:MAX_SLUG - 9].strip("-") + "-" + digest
    return slug or "untitled"


def url_topic(value):
    """A stable topic for a URL: host, port, path and sorted query. The fragment is
    left out, and so is the value of anything that looks like a secret."""
    try:
        url = urllib.parse.urlsplit(value.strip())
        parts = [url.hostname or ""]
        if url.username or url.password:
            parts.append("redacted")
        if url.port and (url.scheme, url.port) not in (("https", 443), ("http", 80)):
            parts.append(str(url.port))
        if url.path.strip("/"):
            parts.append(urllib.parse.unquote(url.path.strip("/")))
        for key, item in sorted(urllib.parse.parse_qsl(url.query, keep_blank_values=True)):
            parts.extend([key, "redacted" if SECRET_KEY.search(key) else item])
        return slugify("-".join(parts))
    except ValueError:
        return slugify(value)


def page_file(topic, number):
    return "%s.md" % topic if number == 1 else "%s.part-%03d.md" % (topic, number)


def one_line(value):
    return re.sub(r"[\r\n]+", " ", str(value)).replace("-->", "--&gt;").strip()


def format_page(meta, text):
    lines = [PAGE_START]
    lines.extend("%s: %s" % (key, one_line(value)) for key, value in meta.items()
                 if value not in ("", None))
    lines.extend([PAGE_END, "", text.rstrip("\n"), ""])
    return "\n".join(lines)


def parse_page(document):
    """(meta, text) of a page file, or None when the file is not one."""
    if not document.startswith(PAGE_START + "\n"):
        return None
    end = document.find("\n" + PAGE_END + "\n")
    if end < 0:
        return None
    meta = {}
    for line in document[len(PAGE_START) + 1:end].split("\n"):
        key, separator, value = line.partition(":")
        if separator:
            meta[key.strip()] = value.strip()
    return meta, document[end + len(PAGE_END) + 2:].strip("\n")


def split_pages(text, limit):
    """Pages of at most `limit` characters, cut between lines and, where one is near,
    at an empty line."""
    pages, current, size = [], [], 0

    def close(keep):
        pages.append("\n".join(current[:keep]))
        rest = current[keep:]
        while rest and not rest[0].strip():
            rest.pop(0)
        return rest, sum(len(line) + 1 for line in rest)

    for line in text.split("\n"):
        while len(line) > limit:
            if current:
                current, size = close(len(current))
            pages.append(line[:limit])
            line = line[limit:]
        if current and size + len(line) + 1 > limit:
            keep, tail = len(current), 0
            for index in range(len(current) - 1, 0, -1):
                tail += len(current[index]) + 1
                if tail > limit // 5:
                    break
                if not current[index].strip():
                    keep = index
                    break
            current, size = close(keep)
        current.append(line)
        size += len(line) + 1
    if current:
        pages.append("\n".join(current))
    return [page for page in pages if page.strip()] or [""]


class WikiLock:
    """One writer at a time across processes, where the system can lock files."""

    def __init__(self, root):
        self.path = os.path.join(root, ".lock")
        self.stream = None

    def __enter__(self):
        try:
            import fcntl
            self.stream = open(self.path, "w")
            fcntl.flock(self.stream, fcntl.LOCK_EX)
        except (ImportError, OSError):
            pass
        return self

    def __exit__(self, *_):
        if self.stream:
            self.stream.close()


def topic_files(root, topic):
    try:
        names = os.listdir(root)
    except OSError:
        return []
    found = [name for name in names
             if PAGE_NAME.match(name) and PAGE_NAME.match(name).group(1) == topic]
    return sorted(found, key=page_number)


def page_number(name):
    found = PAGE_NAME.match(name)
    return int(found.group(2)) if found and found.group(2) else 1


def now_stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def save_topic(topic, meta, text, page_chars):
    """Keep one copy of a search or a page: the newest replaces the one before.
    Returns the page files and whether the text had to be cut."""
    root = wikis_dir()
    os.makedirs(root, exist_ok=True)
    pages = split_pages(text, page_chars)
    cut = len(pages) > MAX_PAGES
    pages = pages[:MAX_PAGES]
    files = [page_file(topic, index + 1) for index in range(len(pages))]
    with WikiLock(root):
        for index, body in enumerate(pages):
            header = {"topic": topic, "page": index + 1, "totalPages": len(pages)}
            header.update(meta)
            header["previous"] = files[index - 1] if index else ""
            header["next"] = files[index + 1] if index + 1 < len(files) else ""
            atomic_write(os.path.join(root, files[index]), format_page(header, body))
        for stale in topic_files(root, topic):
            if stale not in files:
                os.remove(os.path.join(root, stale))
    return files, cut


def read_wiki():
    """Every page of the wiki: a list of dicts with file, meta and text."""
    root = wikis_dir()
    try:
        names = sorted(name for name in os.listdir(root) if PAGE_NAME.match(name))
    except OSError:
        return []
    pages = []
    for name in names:
        try:
            with open(os.path.join(root, name), encoding="utf-8", errors="replace") as stream:
                parsed = parse_page(stream.read())
        except OSError:
            continue
        if parsed:
            pages.append({"file": name, "meta": parsed[0], "text": parsed[1]})
    return pages


def tokenize(value):
    text = "".join(char for char in unicodedata.normalize("NFD", value)
                   if not unicodedata.category(char).startswith("M"))
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    text = re.sub(r"([a-z\d])([A-Z])", r"\1 \2", text).lower()
    return [singular(token) for token in re.split(r"[\W_]+", text)
            if token and token not in STOPWORDS]


def singular(token):
    """A plural and its singular are one word in a search: actions, action."""
    if len(token) < 4 or not token.isalpha():
        return token
    if token.endswith("ies"):
        return token[:-3] + "y"
    if token.endswith(("sses", "xes", "ches", "shes")):
        return token[:-2]
    if token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def weighted(page):
    terms, length = {}, 0
    meta = page["meta"]
    fields = ((meta.get("title", ""), TITLE_WEIGHT),
              (" ".join(meta.get(key, "") for key in ("query", "url")), META_WEIGHT),
              (page["text"], BODY_WEIGHT))
    for value, weight in fields:
        for token in tokenize(value):
            terms[token] = terms.get(token, 0) + weight
            length += weight
    return terms, length


def search_wiki(query, limit):
    """Pages ranked by BM25 over title, source and body, as (score, page, words
    matched, words asked). A page must hold at least half of the words asked, and
    one that holds only some of them scores lower by that share."""
    pages = read_wiki()
    tokens = sorted(set(tokenize(query)))
    if not pages or not tokens:
        return []
    documents = [weighted(page) for page in pages]
    average = sum(length for _terms, length in documents) / len(documents) or 1
    found = {token: sum(1 for terms, _length in documents if token in terms)
             for token in tokens}
    ranked = []
    for page, (terms, length) in zip(pages, documents):
        score, matched = 0.0, 0
        for token in tokens:
            frequency = terms.get(token, 0)
            if not frequency:
                continue
            matched += 1
            rarity = math.log(1 + (len(documents) - found[token] + 0.5) / (found[token] + 0.5))
            norm = frequency + BM25_K1 * (1 - BM25_B + BM25_B * length / average)
            score += rarity * frequency * (BM25_K1 + 1) / norm
        if score > 0 and matched * 2 >= len(tokens):
            ranked.append((score * matched / len(tokens), page, matched, len(tokens)))
    ranked.sort(key=lambda entry: entry[1]["file"])
    ranked.sort(key=lambda entry: entry[1]["meta"].get("saved", ""), reverse=True)
    ranked.sort(key=lambda entry: round(entry[0], 6), reverse=True)
    return ranked[:limit]


def age(stamp):
    """'2026-10-09, 3 days ago' for a saved stamp."""
    try:
        saved = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return "at an unknown time"
    days = (datetime.now(timezone.utc).date() - saved.date()).days
    if days <= 0:
        ago = "today"
    elif days == 1:
        ago = "1 day ago"
    else:
        ago = "%d days ago" % days
    return "%s, %s" % (stamp[:10], ago)


def subject(meta):
    """What a page holds, in a few words."""
    if meta.get("source") == "web_search":
        return "web search: %s" % meta.get("query", "")
    title, url = meta.get("title", ""), meta.get("url", "")
    return "%s <%s>" % (title, url) if title and title != url else url or title


# --------------------------------------------------------------------------- references

SKIPPED_CHILDREN = frozenset(("node_modules", ".git"))
MAX_CHILDREN = 300
HANDOFF = ("Read, search and list this root with your own file tools. Read a file in full "
           "before you rely on it.")


def valid_alias(alias):
    return bool(alias) and not re.search(r"[/\\\s`,]", alias)


def valid_branch(branch):
    return bool(re.fullmatch(r"[A-Za-z0-9/_.-]+", branch)) and not branch.startswith("-") \
        and ".." not in branch and "//" not in branch \
        and not branch.startswith("/") and not branch.endswith("/") \
        and all(part not in ("", ".", "..") for part in branch.split("/"))


def parse_repository(value):
    """A repository as {host, segments, remote}, or None when the value is not one.
    Takes owner/name (GitHub), github:owner/name, host/path, user@host:path and URLs."""
    if not value.strip() or re.search(r"[\s\\;`$\x00]", value):
        return None
    cleaned = re.sub(r"/+$", "", re.sub(r"#.*$", "", re.sub(r"^git\+", "", value.strip())))
    if not cleaned or any(part in (".", "..") for part in re.split(r"[/\\]+", cleaned)):
        return None

    def parts(path):
        return [re.sub(r"\.git$", "", part).strip() for part in path.split("/")
                if re.sub(r"\.git$", "", part).strip()]

    def remote(host, segments, given=None):
        host = host.lower()
        if not host or host.startswith("-") or not segments:
            return None
        for segment in segments:
            decoded = urllib.parse.unquote(segment)
            if decoded in (".", "..") or ":" in segment or re.search(r"[\s/\\\x00]", decoded):
                return None
        return {"host": host, "segments": segments,
                "remote": given or "https://%s/%s.git" % (host, "/".join(segments))}

    prefixed = re.fullmatch(r"github:([^/\s]+)/([^/\s]+)", cleaned)
    if prefixed:
        return remote("github.com", parts("/".join(prefixed.groups())))
    if "://" not in cleaned:
        scp = re.fullmatch(r"(?:[^@/\s]+@)?([^:/\s]+):(.+)", cleaned)
        if scp:
            return remote(scp.group(1), parts(scp.group(2)), cleaned)
        direct = parts(cleaned)
        if len(direct) >= 2 and ("." in direct[0] or direct[0] == "localhost"):
            return remote(direct[0], direct[1:])
        if len(direct) == 2:
            return remote("github.com", direct)
        return None
    try:
        url = urllib.parse.urlsplit(cleaned)
    except ValueError:
        return None
    if url.scheme == "file":
        path = urllib.parse.unquote(url.path)
        segments = [part for part in path.split("/") if part]
        return {"host": "file", "segments": segments, "remote": cleaned} if segments else None
    if url.scheme not in ("https", "http", "ssh", "git") or not url.hostname:
        return None
    return remote(url.netloc.rpartition("@")[2], parts(url.path),
                  None if url.hostname == "github.com" else cleaned)


def cache_path(repository, branch=None):
    base = os.path.join(repos_dir(), repository["host"].replace(":", "_"),
                        *repository["segments"])
    return "%s@%s" % (base, urllib.parse.quote(branch, safe="")) if branch else base


def read_source(entry):
    """A stored entry as a source dict, or the reason it is not valid."""
    if isinstance(entry, str):
        entry = {"path": entry} if entry[:1] in ("~", ".", "/") else {"repository": entry}
    if not isinstance(entry, dict):
        return None, "the entry must be a string or an object"
    if ("path" in entry) == ("repository" in entry):
        return None, "the entry must have exactly one of path and repository"
    description = entry.get("description", "")
    hidden = entry.get("hidden", False)
    if not isinstance(description, str) or not isinstance(hidden, bool):
        return None, "description must be text, and hidden true or false"
    source = {"description": description, "hidden": hidden}
    if "path" in entry:
        path = entry["path"]
        if not isinstance(path, str) or not (path.startswith("/") or path.startswith("~/")):
            return None, "a local path must be absolute or begin with ~/"
        if "branch" in entry:
            return None, "a local reference has no branch"
        source.update(type="local", path=path)
        return source, ""
    repository, branch = entry["repository"], entry.get("branch")
    if not isinstance(repository, str) or not parse_repository(repository):
        return None, "the repository is not a valid git reference"
    if branch is not None and not (isinstance(branch, str) and valid_branch(branch)):
        return None, "the branch is not a safe git branch name"
    source.update(type="git", repository=repository, branch=branch)
    return source, ""


def locate(source):
    """(root, why it is unavailable) for a source."""
    if source["type"] == "git":
        path = cache_path(parse_repository(source["repository"]), source["branch"])
        if os.path.isdir(path):
            return os.path.realpath(path), ""
        return "", "the repository is not cloned; run ref-refresh"
    path = os.path.expanduser(source["path"])
    if not os.path.isdir(path):
        return "", "the directory %s does not exist" % path
    return os.path.realpath(path), ""


def read_document():
    """The references file as (map of alias to entry, problem)."""
    path = references_file()
    try:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
    except FileNotFoundError:
        return {}, ""
    except (OSError, ValueError) as error:
        return {}, "%s cannot be read: %s" % (path, error)
    entries = document.get("references") if isinstance(document, dict) else None
    if not isinstance(entries, dict):
        return {}, "%s must hold an object named references" % path
    return entries, ""


def read_catalog():
    """(references, notes). A reference is a dict: alias, type, description, hidden,
    root, and why when it is unavailable."""
    entries, problem = read_document()
    notes = [problem] if problem else []
    references = []
    for alias in sorted(entries):
        if not valid_alias(alias):
            notes.append("an alias with a space, a slash, a comma or a backtick is ignored")
            continue
        source, why = read_source(entries[alias])
        if not source:
            notes.append("reference '%s' is ignored: %s" % (alias, why))
            continue
        root, why = locate(source)
        references.append(dict(source, alias=alias, root=root, why=why))
    return references, notes


def write_document(entries):
    text = json.dumps({"references": entries}, indent=2, ensure_ascii=False) + "\n"
    atomic_write(references_file(), text)


def git(arguments, cwd=None):
    environment = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    try:
        done = subprocess.run(["git"] + arguments, cwd=cwd, env=environment, text=True,
                              capture_output=True, timeout=900)
    except FileNotFoundError:
        raise Problem("git is not installed, and a git reference needs it.")
    except subprocess.TimeoutExpired:
        raise Problem("git %s did not finish in 15 minutes." % arguments[0])
    if done.returncode:
        lines = [line for line in done.stderr.strip().splitlines() if line.strip()]
        raise Problem("git %s failed: %s" % (arguments[0], " ".join(lines[-3:]) or "no output"))
    return done.stdout.strip()


def clone(source):
    """Clone a git source into its place in the cache. Returns the root."""
    repository = parse_repository(source["repository"])
    target = cache_path(repository, source["branch"])
    if os.path.isdir(target):
        return os.path.realpath(target)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    staging = tempfile.mkdtemp(prefix=".clone-", dir=os.path.dirname(target))
    try:
        arguments = ["clone", "--depth", "1", "--single-branch"]
        if source["branch"]:
            arguments += ["--branch", source["branch"]]
        git(arguments + ["--", repository["remote"], staging])
        os.replace(staging, target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return os.path.realpath(target)


def refresh(source):
    """Bring a cloned git source up to date. Returns the commit it is at."""
    repository = parse_repository(source["repository"])
    target = cache_path(repository, source["branch"])
    if not os.path.isdir(target):
        clone(source)
    else:
        git(["fetch", "--depth", "1", "origin", source["branch"] or "HEAD"], cwd=target)
        git(["reset", "--hard", "FETCH_HEAD"], cwd=target)
    return git(["rev-parse", "--short", "HEAD"], cwd=target)


# --------------------------------------------------------------------------- web search

EXA_MCP_URL = "https://mcp.exa.ai/mcp"
EXA_REST_URL = "https://api.exa.ai/search"
KEENABLE_URL = "https://api.keenable.ai/v1/search"
KEENABLE_PUBLIC_URL = "https://api.keenable.ai/v1/search/public"
KEENABLE_TITLE = "get-knowledge"
PARALLEL_URL = "https://api.parallel.ai/v1/search"
PARALLEL_MCP_URL = "https://search.parallel.ai/mcp"
PARALLEL_MODE = "advanced"
PARALLEL_QUERY_CHARS = 200
PARALLEL_OBJECTIVE_CHARS = 5000
NO_RESULTS = "No search results found. Please try a different query."
LABELS = {"exa": "Exa", "keenable": "Keenable", "parallel": "Parallel"}
BEEN = r"(?:(?:has|have|is|are|was|were)\s+(?:been\s+)?)?"
CREDIT_GONE = [re.compile(pattern) for pattern in (
    r"\b(?:insufficient|out\s+of)\s+(?:credits?|quota)\b",
    r"\bno\s+(?:more\s+)?(?:credits?|quota)\b(?!\s+" + BEEN +
    r"(?:required|configured|needed|requested|necessary|spent|used|consumed)\b)",
    r"\b(?:credit|credits|quota|budget)\s+(?:exhaustion|depletion)\b",
    r"\b(?:credits?|quota|budget)(?:\s+(?:limit|budget))?\s+" + BEEN +
    r"(?:exhausted|depleted|unavailable|used\s+up|run\s+out|ran\s+out)\b",
)]
THROTTLED = (r"requests?\s+(?:(?:has|have|is|are|was|were)\s+)?(?:currently\s+)?"
             r"(?:been\s+|being\s+)?throttl(?:ed|ing)")
LIMIT_HIT = CREDIT_GONE + [re.compile(pattern) for pattern in (
    r"\brate\s+limit(?:ed|ing)?\b",
    r"\btoo\s+many\s+requests?\b",
    r"\b(?:request|requests|usage|monthly|team|account|api\s+key)\s+" + BEEN +
    r"limit\s+(?:exceeded|exhausted|depleted|reached|hit)\b",
    r"\b(?:quota|credit|credits|budget)(?:\s+(?:limit|budget))?\s+" + BEEN +
    r"(?:exceeded|reached|hit)\b",
    r"\b" + THROTTLED + r"\b",
)]
NOT_A_LIMIT = re.compile(
    r"\b(?:not|never)\s+(?:(?:currently|actually|yet)\s+)?(?:out\s+of\s+(?:credits?|quota)|"
    r"too\s+many\s+requests?|(?:rate\s+)?limit(?:ed|ing)?|(?:credits?|quota|budget)\s+"
    r"(?:exceeded|exhausted|depleted|unavailable|reached|hit|used\s+up|ran\s+out)|"
    + THROTTLED + r")\b")


class ProviderError(Problem):
    def __init__(self, message, limit=False):
        super().__init__(message)
        self.limit = limit


def is_limit(status=None, message="", tag=""):
    """Whether a failure says the provider's rate, quota or credit ran out. Only then
    is the next provider tried."""
    if status == 429:
        return True
    if status in (400, 401, 403, 422) or (status is not None and 500 <= status < 600):
        return False
    text = re.sub(r"[_-]+", " ", ("%s %s" % (tag or "", message or "")).lower())
    if "payment required" in text or NOT_A_LIMIT.search(text):
        return False
    patterns = CREDIT_GONE if status == 402 else LIMIT_HIT
    return any(pattern.search(text) for pattern in patterns)


def record(value):
    return value if isinstance(value, dict) else {}


def words(value):
    text = value.strip() if isinstance(value, str) else ""
    return "" if text == "N/A" else text


def error_of(parsed):
    """(message, tag) of an error body."""
    raw = parsed.get("error")
    messages = []
    if isinstance(raw, str) and raw.strip():
        messages.append(raw.strip())
    if isinstance(record(raw).get("message"), str) and raw["message"].strip():
        messages.append(raw["message"].strip())
    top = parsed.get("message")
    if isinstance(top, str) and top.strip() and top.strip() not in messages:
        messages.append(top.strip())
    tags = (parsed.get("tag"), record(raw).get("tag"), record(record(raw).get("data")).get("tag"),
            record(parsed.get("data")).get("tag"))
    tag = next((item.strip() for item in tags if isinstance(item, str) and item.strip()), "")
    return ": ".join(messages), tag


def load_json(body):
    try:
        return json.loads(body)
    except ValueError:
        return None


def http_failure(response, provider):
    message, tag = error_of(record(load_json(response.body.decode("utf-8", "replace"))))
    detail = "HTTP %d: %s" % (response.status, response.reason or "Request failed")
    if message:
        detail += " (%s)" % message[:200]
    return ProviderError(detail, is_limit(response.status, message, tag))


def normalize(items, limit, published_key, snippet_of):
    results = []
    for item in items:
        url = words(record(item).get("url"))
        if not url:
            continue
        result = {"title": words(item.get("title")) or url, "url": url}
        for key, value in (("published", words(item.get(published_key))),
                           ("author", words(item.get("author"))),
                           ("snippet", snippet_of(item))):
            if value:
                result[key] = value
        results.append(result)
    return results[:limit]


def exa_snippet(item):
    highlights = item.get("highlights")
    if isinstance(highlights, list):
        joined = "\n\n".join(words(part) for part in highlights if words(part))
        if joined:
            return joined
    return words(highlights) or words(item.get("summary")) or words(item.get("text"))


def post_json(url, headers, payload, deadline, limit, provider):
    headers = dict(headers, **{"Content-Type": "application/json", "User-Agent": PLAIN_AGENT})
    response = http_request("POST", url, headers, json.dumps(payload).encode("utf-8"),
                            deadline, limit, no_body=(429,))
    if not response.ok:
        raise http_failure(response, provider)
    return response.body.decode("utf-8", "replace")


def answered(body, results_from):
    """The results of a JSON answer that lists them under `results`."""
    parsed = load_json(body)
    if not isinstance(parsed, dict):
        raise ProviderError("Malformed search response body")
    message, tag = error_of(parsed)
    if message or tag:
        raise ProviderError("Search request failed: %s" % (message or tag),
                            is_limit(None, message, tag))
    if not isinstance(parsed.get("results"), list):
        raise ProviderError("Malformed search response body")
    return {"results": results_from(parsed["results"]), "text": ""}


def search_exa_rest(request, deadline, limit, key):
    contents = {"highlights": True}
    if request.get("contextMaxCharacters"):
        contents["highlights"] = {"query": request["query"],
                                  "maxCharacters": request["contextMaxCharacters"]}
    if request["livecrawl"] == "preferred":
        contents["maxAgeHours"] = 0
    payload = {"query": request["query"], "type": request["type"],
               "numResults": request["numResults"], "stream": False, "contents": contents}
    headers = {"Accept": "application/json", "Authorization": "Bearer %s" % key}
    body = post_json(EXA_REST_URL, headers, payload, deadline, limit, "exa")
    return answered(body, lambda items: normalize(items, request["numResults"],
                                                  "publishedDate", exa_snippet))


def exa_text_results(text, limit):
    """The results in the text an Exa MCP call answers with."""
    normalized = re.sub(r"\r\n?", "\n", text).strip()
    results = []
    for section in re.split(r"\n{2,}---\n{2,}(?=Title:\s*)", normalized):
        lines = section.strip().split("\n")
        if not lines[0].startswith("Title:"):
            continue

        def value(label):
            line = next((entry for entry in lines if entry.startswith(label + ":")), "")
            return words(line[len(label) + 1:])

        url = value("URL")
        if not url:
            continue
        result = {"title": value("Title") or url, "url": url}
        for key, label in (("published", "Published"), ("author", "Author")):
            if value(label):
                result[key] = value(label)
        marks = [index for index, line in enumerate(lines)
                 if re.fullmatch(r"Highlights:\s*", line.strip())]
        snippet = "\n".join(lines[marks[0] + 1:]).strip() if marks else ""
        if snippet:
            result["snippet"] = snippet
        results.append(result)
    return results[:limit]


def tool_answer(parsed):
    """(result, text) of one JSON-RPC answer to a tool call, or None when it holds
    nothing usable."""
    if not isinstance(parsed, dict):
        return None
    if "error" in parsed:
        message, tag = error_of(parsed)
        raise ProviderError("Search request failed: %s" % (message or "Unknown JSON-RPC error"),
                            is_limit(None, message, tag))
    result = parsed.get("result")
    if not isinstance(result, dict):
        return None
    content = result.get("content") if isinstance(result.get("content"), list) else []
    texts = [item["text"] for item in content
             if isinstance(record(item).get("text"), str) and item["text"].strip()]
    return result, texts[0] if texts else ""


def tool_failed(result, text):
    if result.get("isError") is not True:
        return
    message, tag = error_of(result)
    if not message:
        message, tag = error_of(record(load_json(text)))
    message = message or text.strip() or "MCP tool request failed"
    raise ProviderError("Search request failed: %s" % message[:300], is_limit(None, message, tag))


def call_tool(url, headers, name, arguments, deadline, limit, provider, read):
    """Call one tool of a provider's keyless service. The answer comes as JSON or as
    an event stream; `read` turns one JSON-RPC answer into the results, or None."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": name, "arguments": arguments}}
    headers = dict(headers, Accept="application/json, text/event-stream")
    body = post_json(url, headers, payload, deadline, limit, provider).strip()
    if not body:
        return {"results": [], "text": ""}
    direct = load_json(body)
    if direct is not None:
        answer = read(direct)
        if answer is None:
            raise ProviderError("Malformed search response body")
        return answer
    saw_data = False
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        saw_data = True
        payload_text = line[5:].strip()
        if not payload_text or payload_text == "[DONE]":
            continue
        answer = read(load_json(payload_text))
        if answer is not None:
            return answer
    if saw_data:
        return {"results": [], "text": ""}
    raise ProviderError("Malformed search response body")


def exa_payload(parsed, limit):
    """One JSON-RPC answer as a result dict, or None when it holds nothing usable."""
    found = tool_answer(parsed)
    if found is None:
        return None
    result, text = found
    if record(result.get("_meta")).get("ai.exa/rateLimited") is True:
        raise ProviderError("Exa's free rate limit is reached", True)
    tool_failed(result, text)
    if not isinstance(result.get("content"), list):
        return None
    results = exa_text_results(text, limit)
    if not results and is_limit(None, text[:400]):
        raise ProviderError("Search request failed: %s" % squeeze(text)[:200], True)
    return {"results": results, "text": text}


def search_exa_mcp(request, deadline, limit):
    arguments = {"query": request["query"], "type": request["type"],
                 "numResults": request["numResults"], "livecrawl": request["livecrawl"]}
    if request.get("contextMaxCharacters"):
        arguments["contextMaxCharacters"] = request["contextMaxCharacters"]
    return call_tool(EXA_MCP_URL, {}, "web_search_exa", arguments, deadline, limit, "exa",
                     lambda parsed: exa_payload(parsed, request["numResults"]))


def search_keenable(request, deadline, limit, key):
    payload = {"query": request["query"], "max_results": request["numResults"]}
    if request.get("contextMaxCharacters"):
        payload["snippet_max_length"] = min(10000, max(180, request["contextMaxCharacters"]))
    headers = {"Accept": "application/json"}
    if key:
        headers["X-API-Key"] = key
    else:
        headers["X-Keenable-Title"] = KEENABLE_TITLE
    body = post_json(KEENABLE_URL if key else KEENABLE_PUBLIC_URL, headers, payload,
                     deadline, limit, "keenable")
    return answered(body, lambda items: normalize(
        items, request["numResults"], "published_at",
        lambda item: words(item.get("snippet")) or words(item.get("description"))))


def parallel_query(query):
    """The query as one keyword query of Parallel, which takes 200 characters."""
    text = squeeze(query)
    if len(text) <= PARALLEL_QUERY_CHARS:
        return text
    cut = text[:PARALLEL_QUERY_CHARS + 1]
    return (cut[:cut.rindex(" ")] if " " in cut else cut[:PARALLEL_QUERY_CHARS]).strip()


def parallel_results(items, request):
    def excerpts(item):
        parts = item.get("excerpts") if isinstance(item.get("excerpts"), list) else []
        return "\n\n".join(words(part) for part in parts if words(part))

    return normalize(items, request["numResults"], "publish_date", excerpts)


def search_parallel_rest(request, deadline, limit, key):
    """Parallel is always asked in its advanced mode and with no other option; the
    search options only cut its list to the number of results asked for."""
    payload = {"objective": request["query"][:PARALLEL_OBJECTIVE_CHARS],
               "search_queries": [parallel_query(request["query"])], "mode": PARALLEL_MODE}
    headers = {"Accept": "application/json", "x-api-key": key}
    body = post_json(PARALLEL_URL, headers, payload, deadline, limit, "parallel")
    return answered(body, lambda items: parallel_results(items, request))


def parallel_payload(parsed, request):
    """One JSON-RPC answer of Parallel's keyless service as a result dict, or None."""
    found = tool_answer(parsed)
    if found is None:
        return None
    result, text = found
    tool_failed(result, text)
    if not isinstance(result.get("content"), list):
        return None
    data = record(result.get("structuredContent")) or record(load_json(text))
    if isinstance(data.get("results"), list):
        return {"results": parallel_results(data["results"], request), "text": ""}
    message, tag = error_of(data)
    message = message or squeeze(text)
    if not message:
        return {"results": [], "text": ""}
    raise ProviderError("Search request failed: %s" % message[:200],
                        is_limit(None, message[:400], tag))


def search_parallel_mcp(request, deadline, limit):
    arguments = {"objective": request["query"][:PARALLEL_OBJECTIVE_CHARS],
                 "search_queries": [parallel_query(request["query"])]}
    return call_tool(PARALLEL_MCP_URL, {}, "web_search", arguments, deadline, limit, "parallel",
                     lambda parsed: parallel_payload(parsed, request))


def search_with(provider, request, deadline, limit, keys):
    key = keys[provider][0]
    if provider == "keenable":
        return search_keenable(request, deadline, limit, key)
    if provider == "parallel":
        if key:
            return search_parallel_rest(request, deadline, limit, key)
        return search_parallel_mcp(request, deadline, limit)
    if key:
        return search_exa_rest(request, deadline, limit, key)
    return search_exa_mcp(request, deadline, limit)


def search_in_turn(order, request, deadline, limit, keys):
    """Ask the providers in order. The next one is asked only when the one before says
    its limit is reached; any other failure ends the search. Returns the provider that
    answered and its answer."""
    failed = []
    for provider in order:
        if failed:
            note("note: %s's limit is reached; trying %s."
                 % (LABELS[failed[-1][0]], LABELS[provider]))
        try:
            return provider, search_with(provider, request, deadline, limit, keys)
        except Problem as error:
            failed.append((provider, redact(str(error), keys)))
            if not getattr(error, "limit", False):
                break
    if len(failed) == 1:
        raise Problem(failed[0][1])
    parts = ["Search failed with %s (%s)" % (LABELS[failed[0][0]], brief(failed[0][1]))]
    parts.extend("the %s fallback failed: %s" % (LABELS[provider], brief(message))
                 for provider, message in failed[1:])
    raise Problem("; ".join(parts))


def format_results(results):
    blocks = []
    for result in results:
        lines = ["Title: %s" % result["title"], "URL: %s" % result["url"]]
        if result.get("published"):
            lines.append("Published: %s" % result["published"])
        if result.get("author"):
            lines.append("Author: %s" % result["author"])
        if result.get("snippet"):
            lines.extend(["Highlights:", result["snippet"]])
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)


def redact(message, keys):
    """An error message without any API key in it."""
    secrets = sorted((key for key, _origin in keys.values() if key), key=len, reverse=True)
    for secret in secrets:
        message = message.replace(secret, "[REDACTED]")
        message = message.replace(urllib.parse.quote(secret, safe=""), "[REDACTED]")
    return message


def brief(message):
    text = squeeze(message)
    return text if len(text) <= 240 else text[:239].rstrip() + "..."


# --------------------------------------------------------------------------- web fetch

RASTER_SKIPPED = ("image/svg+xml", "image/vnd.fastbidsheet")
IMAGE_SUFFIX = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
                "image/webp": ".webp", "image/avif": ".avif", "image/bmp": ".bmp",
                "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico",
                "image/tiff": ".tiff"}


def normal_url(value):
    url = value.strip()
    if not re.match(r"https?://", url, re.I):
        raise Problem("URL must start with http:// or https://")
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname
        port = parts.port
    except ValueError:
        raise Problem("Invalid URL")
    if not host:
        raise Problem("Invalid URL")
    try:
        host.encode("ascii")
    except UnicodeError:
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError:
            raise Problem("Invalid URL")
    netloc = "[%s]" % host if ":" in host else host
    if port:
        netloc += ":%d" % port
    if parts.username:
        user = urllib.parse.quote(parts.username, safe="")
        if parts.password:
            user += ":" + urllib.parse.quote(parts.password, safe="")
        netloc = user + "@" + netloc
    safe = "%/:=&?~#+!$,;'@()*[]"
    return urllib.parse.urlunsplit((parts.scheme.lower(), netloc,
                                    urllib.parse.quote(parts.path or "/", safe=safe),
                                    urllib.parse.quote(parts.query, safe=safe), ""))


GITHUB_FILE = re.compile(r"https?://github\.com/([^/?#]+)/([^/?#]+)/(?:blob|raw)/([^?#]+)", re.I)


def direct_source(url):
    """The address of the file itself, where a URL is known to show a file inside a
    page of buttons: a GitHub file page becomes its raw file."""
    found = GITHUB_FILE.match(url)
    if found:
        return "https://raw.githubusercontent.com/%s/%s/%s" % found.groups()
    return url


def accept(fmt):
    if fmt == "text":
        return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    return ("text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, "
            "text/html;q=0.7, */*;q=0.1")


def is_text(mime):
    return mime.startswith("text/") or mime.endswith(("+json", "+xml")) or mime in (
        "application/xhtml+xml", "application/json", "application/xml",
        "application/javascript", "application/ld+json", "image/svg+xml")


def decode(body, content_type, html):
    found = re.search(r"charset\s*=\s*\"?([^\";\s]+)", content_type, re.I)
    names = [found.group(1)] if found else []
    if not found and html:
        declared = re.search(rb"<meta[^>]+charset\s*=\s*[\"']?([\w-]+)", body[:4096], re.I)
        if declared:
            names.append(declared.group(1).decode("ascii", "replace"))
    for name in names:
        try:
            return body.decode(name, "replace")
        except LookupError:
            pass
    return body.decode("utf-8", "replace")


def download(url, fmt, timeout, limit):
    """Fetch one URL. Returns the response, or raises Problem."""
    deadline = time.monotonic() + timeout
    headers = {"User-Agent": BROWSER_AGENT, "Accept": accept(fmt),
               "Accept-Language": "en-US,en;q=0.9"}
    response = http_request("GET", url, headers, None, deadline, limit)
    if response.status == 403 and response.header("cf-mitigated") == "challenge":
        # A challenge page answers the browser-like agent; an honest plain agent is
        # tried once, within the same time limit.
        headers["User-Agent"] = PLAIN_AGENT
        response = http_request("GET", url, headers, None, deadline, limit)
    if not response.ok:
        raise Problem("HTTP %d: %s" % (response.status, response.reason or "Request failed"))
    return response


def fetched(url, response, fmt, whole_page):
    """Turn a response into what is kept: a dict with kind (text, image or empty)."""
    content_type = response.header("content-type")
    mime = content_type.split(";", 1)[0].strip().lower()
    final = response.url or url
    result = {"url": final, "requested": url if url != final else "", "type": content_type,
              "format": fmt, "title": "", "trimmed": False}
    if mime.startswith("image/") and mime not in RASTER_SKIPPED:
        result.update(kind="image" if response.body else "empty", mime=mime, body=response.body)
        return result
    if not is_text(mime):
        raise Problem("Unsupported binary content-type: %s" % (mime or "unknown"))
    html = mime in ("text/html", "application/xhtml+xml")
    text = decode(response.body, content_type, html)
    if html:
        result["title"], text, result["trimmed"] = convert_html(text, final, fmt, whole_page)
    text = text.replace("\r\n", "\n").strip("\n")
    result.update(kind="text" if text.strip() else "empty", text=text)
    return result


# --------------------------------------------------------------------------- commands


def wiki_path(name):
    return os.path.join(wikis_dir(), name)


def first_page(name):
    """A saved page as the text to print: its content and where it continues."""
    with open(wiki_path(name), encoding="utf-8", errors="replace") as stream:
        meta, text = parse_page(stream.read())
    return text + page_footer(meta)


def page_footer(meta):
    """The line that tells where a page's text continues."""
    number, total = meta.get("page", "1"), meta.get("totalPages", "1")
    if total in ("1", 1):
        return ""
    following = meta.get("next", "")
    if following:
        return "\n\n[Page %s of %s. The text continues in %s]" % (number, total,
                                                                 wiki_path(following))
    return "\n\n[Page %s of %s, the last one.]" % (number, total)


def saved_lines(files, cut, size):
    if len(files) > 1:
        extent = "page 1 of %d, %d characters in all" % (len(files), size)
    else:
        extent = "1 page, %d characters" % size
    lines = ["Saved: %s (%s)" % (wiki_path(files[0]), extent)]
    if cut:
        lines.append("note: the text was cut after %d pages." % MAX_PAGES)
    return lines


def list_references(references, notes):
    shown = [reference for reference in references if not reference["hidden"]]
    lines = []
    for reference in shown:
        line = "- %s (%s)" % (reference["alias"], reference["type"])
        if reference["description"].strip():
            line += ": %s" % one_line(reference["description"])
        lines.append(line)
        if reference["root"]:
            lines.append("  root: %s" % reference["root"])
        else:
            lines.append("  unavailable: %s" % reference["why"])
    if not shown:
        lines.append("No references are set up.")
    lines.extend("note: %s" % text for text in notes)
    return "\n".join(lines)


def show_reference(alias):
    references, _notes = read_catalog()
    reference = next((item for item in references if item["alias"] == alias), None)
    if not reference:
        known = ", ".join(item["alias"] for item in references if not item["hidden"])
        raise Problem("There is no reference named '%s'. %s"
                      % (alias, "The references are: %s." % known if known
                         else "No references are set up."))
    if not reference["root"]:
        raise Problem("Reference '%s' is unavailable: %s." % (alias, reference["why"]))
    try:
        with os.scandir(reference["root"]) as entries:
            children = sorted((entry.name, "directory" if entry.is_dir() else "file")
                              for entry in entries if entry.name not in SKIPPED_CHILDREN)
    except OSError as error:
        raise Problem("Reference '%s' cannot be listed: %s" % (alias, error))
    lines = ["Reference: %s (%s)" % (reference["alias"], reference["type"])]
    if reference["description"].strip():
        lines.append("Description: %s" % one_line(reference["description"]))
    lines.extend(["Root: %s" % reference["root"], "Immediate children:"])
    lines.extend("  - %s (%s)" % child for child in children[:MAX_CHILDREN])
    if not children:
        lines.append("  (empty root)")
    if len(children) > MAX_CHILDREN:
        lines.append("  ... and %d more entries" % (len(children) - MAX_CHILDREN))
    lines.append(HANDOFF)
    return "\n".join(lines)


def browse_wiki(limit):
    topics = {}
    for page in read_wiki():
        topics.setdefault(page["meta"].get("topic", ""), []).append(page)
    if not topics:
        return "No local wiki pages found."
    first = [sorted(pages, key=lambda page: page_number(page["file"]))[0]
             for pages in topics.values()]
    first.sort(key=lambda page: page["file"])
    first.sort(key=lambda page: page["meta"].get("saved", ""), reverse=True)
    lines = []
    for page in first[:limit]:
        meta = page["meta"]
        count = len(topics[meta.get("topic", "")])
        pages = ", %d pages" % count if count > 1 else ""
        lines.append("- %s (saved %s%s): %s" % (page["file"], age(meta.get("saved", "")),
                                               pages, subject(meta)))
    if len(first) > limit:
        lines.append("... and %d older topics; search with --query to find them."
                     % (len(first) - limit))
    lines.append("Wiki directory: %s" % wikis_dir())
    return "\n".join(lines)


def find_in_wiki(query, limit):
    ranked = search_wiki(query, limit)
    if not ranked:
        return "No local wiki matches found."
    lines = []
    for score, page, matched, asked in ranked:
        meta = page["meta"]
        part = ""
        if meta.get("totalPages", "1") != "1":
            part = ", page %s of %s" % (meta.get("page", "?"), meta.get("totalPages", "?"))
        lines.append("- %s (score %.3f, has %d of %d words, saved %s%s): %s"
                     % (page["file"], score, matched, asked, age(meta.get("saved", "")), part,
                        subject(meta)))
    lines.append("Wiki directory: %s" % wikis_dir())
    return "\n".join(lines)


def open_page(name, with_content):
    name = name.strip()
    base = os.path.basename(name)
    folder = os.path.dirname(name)
    inside = not folder or os.path.realpath(folder) == os.path.realpath(wikis_dir())
    if not PAGE_NAME.match(base) or not inside:
        raise UsageError("--page takes the file name of a wiki page as this script prints it, "
                         "such as react-dev-learn.md or react-dev-learn.part-002.md.")
    try:
        with open(wiki_path(base), encoding="utf-8", errors="replace") as stream:
            parsed = parse_page(stream.read())
    except OSError:
        parsed = None
    if not parsed:
        raise Problem("There is no wiki page named %s in %s." % (base, wikis_dir()))
    meta, text = parsed
    lines = ["Page: %s (page %s of %s)" % (wiki_path(base), meta.get("page", "1"),
                                          meta.get("totalPages", "1")),
             "Holds: %s" % subject(meta),
             "Saved: %s" % age(meta.get("saved", ""))]
    for key, label in (("previous", "Previous"), ("next", "Next")):
        if meta.get(key):
            lines.append("%s: %s" % (label, wiki_path(meta[key])))
    if not with_content:
        return "\n".join(lines)
    return "\n".join(lines) + "\n\n" + text + page_footer(meta)


def cmd_local(args):
    kind = args.type
    if args.page is not None:
        if kind == "references" or args.alias is not None or args.query is not None:
            raise UsageError("--page opens one wiki page; it goes with no --query, no --alias "
                             "and no --type references.")
        print(open_page(args.page, not args.no_content))
        return 0
    if args.alias is not None:
        if kind == "wikis":
            raise UsageError("--alias selects a reference; it does not go with --type wikis.")
        print(show_reference(args.alias))
        return 0
    limit = min(max(args.max_results or 20, 1), 50)
    query = (args.query or "").strip()
    browsing = query in ("", "*")
    parts = []
    if kind in (None, "references"):
        text = list_references(*read_catalog())
        parts.append("--references--\n" + text if kind is None else text)
    if kind in (None, "wikis"):
        text = browse_wiki(limit) if browsing else find_in_wiki(query, limit)
        parts.append("--wikis--\n" + text if kind is None else text)
    print("\n---\n".join(parts))
    return 0


def cmd_web_search(args):
    query = args.query.strip()
    if not query:
        raise UsageError("The query is empty.")
    settings = settings_or_warn()
    keys = api_keys(settings)
    count = args.num_results if args.num_results is not None else settings["defaultNumResults"]
    request = {"query": query, "numResults": min(MAX_NUM_RESULTS, max(1, count)),
               "type": args.type or settings["defaultSearchType"],
               "livecrawl": args.livecrawl or settings["defaultLivecrawl"],
               "contextMaxCharacters": args.context_max_characters}
    if request["contextMaxCharacters"] is not None \
            and not 1 <= request["contextMaxCharacters"] <= 50000:
        raise UsageError("--context-max-characters takes a number from 1 to 50000.")
    first = args.provider or settings["provider"]
    order = [first] + [name for name in PROVIDERS if name != first]
    deadline = time.monotonic() + settings["searchTimeoutMs"] / 1000.0
    provider, answer = search_in_turn(order, request, deadline, settings["maxResponseBytes"],
                                      keys)
    text = format_results(answer["results"]) if answer["results"] else answer["text"].strip()
    if not text or text == NO_RESULTS:
        print(NO_RESULTS)
        return 0
    meta = {"source": "web_search", "query": query, "provider": provider,
            "title": "Web Search: %s" % query, "format": "markdown", "saved": now_stamp()}
    lines = ["Web Search: %s" % query,
             "Provider: %s, %d results" % (LABELS[provider], len(answer["results"]))]
    try:
        files, cut = save_topic(slugify(query), meta, text, settings["pageChars"])
    except OSError as error:
        lines.append("Not saved to the wiki: %s" % error)
        print("\n".join(lines) + "\n\n" + text)
        return 0
    lines.extend(saved_lines(files, cut, len(text)))
    print("\n".join(lines) + "\n\n" + first_page(files[0]))
    return 0


def keep_fetch(result, settings):
    """Save what one fetch brought. Returns the lines to print and the first page."""
    described = result["type"] or "no content type"
    if result["type"].split(";")[0].strip().lower() in ("text/html", "application/xhtml+xml"):
        described += ", as %s" % result["format"]
        if result["trimmed"]:
            described += ", main content only (--whole-page gives everything)"
    lines = ["URL: %s" % result["url"]]
    if result["requested"]:
        lines.append("Redirected from: %s" % result["requested"])
    if result["title"]:
        lines.append("Title: %s" % result["title"])
    lines.append("Type: %s" % described)
    if result["kind"] == "empty":
        lines.append("The page has no content. Nothing was saved.")
        return lines, None
    meta = {"source": "web_fetch", "url": result["url"], "title": result["title"],
            "format": result["format"], "saved": now_stamp()}
    topic = url_topic(result["url"])
    text = result.get("text", "")
    if result["kind"] == "image":
        name = topic + IMAGE_SUFFIX.get(result["mime"], ".img")
        path = os.path.join(files_dir(), name)
        atomic_write(path, result["body"], binary=True)
        lines.append("Image: %s (%d bytes). Open this file to see it."
                     % (path, len(result["body"])))
        meta["format"] = "image"
        text = "Image fetched from %s and saved as %s" % (result["url"], path)
    files, cut = save_topic(topic, meta, text, settings["pageChars"])
    lines.extend(saved_lines(files, cut, len(text)))
    lines.extend("  %s" % wiki_path(name) for name in files[1:])
    return lines, None if result["kind"] == "image" else files[0]


def cmd_web_fetch(args):
    settings = settings_or_warn()
    timeout = settings["fetchTimeoutSeconds"]
    if args.timeout is not None:
        timeout = min(max(args.timeout, MIN_FETCH_SECONDS), MAX_FETCH_SECONDS)
    urls = []
    for value in args.url:
        if value not in urls:
            urls.append(value)

    def attempt(value):
        try:
            url = normal_url(value)
            direct = direct_source(url)
            if direct != url:
                try:
                    return url, download(direct, args.format, timeout,
                                         settings["maxResponseBytes"])
                except Problem:
                    pass
            return url, download(url, args.format, timeout, settings["maxResponseBytes"])
        except Problem as problem:
            return value, problem

    with ThreadPoolExecutor(max_workers=min(8, len(urls))) as pool:
        answers = list(pool.map(attempt, urls))
    failures, sections = 0, []
    show = len(urls) == 1 and not args.no_content
    for url, answer in answers:
        try:
            if isinstance(answer, Problem):
                raise answer
            result = fetched(url, answer, args.format, args.whole_page)
            lines, first = keep_fetch(result, settings)
        except (Problem, OSError) as problem:
            failures += 1
            sections.append("URL: %s\nFailed: %s" % (url, problem))
            continue
        section = "\n".join(lines)
        if show and first:
            section += "\n\n" + first_page(first)
        sections.append(section)
    print("\n\n".join(sections))
    if failures and len(urls) > 1:
        note("%d of %d URLs failed." % (failures, len(urls)))
    return 1 if failures else 0


def cmd_forget(args):
    root = wikis_dir()
    topics = []
    for name in args.page:
        found = PAGE_NAME.match(os.path.basename(name.strip()))
        folder = os.path.dirname(name.strip())
        if not found or (folder and os.path.realpath(folder) != os.path.realpath(root)):
            raise UsageError("forget takes the file name of a wiki page as this script prints "
                             "it, such as react-dev-learn.md.")
        if found.group(1) not in topics:
            topics.append(found.group(1))
    missing = [topic for topic in topics if not topic_files(root, topic)]
    if missing:
        raise Problem("There is no wiki topic named %s in %s. Nothing was removed."
                      % (", ".join(missing), root))
    with WikiLock(root):
        for topic in topics:
            files = topic_files(root, topic)
            for name in files:
                os.remove(os.path.join(root, name))
            print("Forgot %s (%d page%s)" % (topic, len(files), "" if len(files) == 1 else "s"))
    return 0


def cmd_ref_add(args):
    alias = args.alias
    if not valid_alias(alias):
        raise UsageError("The alias must be one word with no space, slash, comma or backtick.")
    entries, problem = read_document()
    if problem:
        raise Problem(problem + ". Repair or remove the file first.")
    if alias in entries and not args.replace:
        raise Problem("A reference named '%s' exists. Add --replace to change it." % alias)
    value = args.source.strip()
    entry = {}
    if value[:1] in ("~", ".", "/"):
        if args.branch:
            raise UsageError("--branch goes with a git repository, not with a directory.")
        path = os.path.abspath(os.path.expanduser(value))
        if not os.path.isdir(path):
            raise Problem("%s is not a directory." % path)
        entry["path"] = path
    else:
        if not parse_repository(value):
            raise UsageError("'%s' is not a git repository. A repository is owner/name for "
                             "GitHub, host/path, user@host:path, or a URL. A directory begins "
                             "with /, ~/ or ./." % value)
        if args.branch and not valid_branch(args.branch):
            raise UsageError("'%s' is not a safe git branch name." % args.branch)
        entry["repository"] = value
        if args.branch:
            entry["branch"] = args.branch
    if args.description:
        entry["description"] = args.description
    if args.hidden:
        entry["hidden"] = True
    source, why = read_source(entry)
    if not source:
        raise UsageError("The reference is not valid: %s." % why)
    root = clone(source) if source["type"] == "git" else locate(source)[0]
    entries[alias] = entry
    write_document(entries)
    print("Added reference %s (%s)\nRoot: %s" % (alias, source["type"], root))
    return 0


def cmd_ref_remove(args):
    entries, problem = read_document()
    if problem:
        raise Problem(problem + ". Repair or remove the file first.")
    if args.alias not in entries:
        raise Problem("There is no reference named '%s'." % args.alias)
    removed, _why = read_source(entries.pop(args.alias))
    write_document(entries)
    print("Removed reference %s" % args.alias)
    if removed and removed["type"] == "git":
        target = cache_path(parse_repository(removed["repository"]), removed["branch"])
        still_used = False
        for entry in entries.values():
            other, _why = read_source(entry)
            if other and other["type"] == "git" and target == cache_path(
                    parse_repository(other["repository"]), other["branch"]):
                still_used = True
        inside = os.path.realpath(target).startswith(os.path.realpath(repos_dir()) + os.sep)
        if os.path.isdir(target) and inside and not still_used:
            shutil.rmtree(target)
            print("Removed its clone %s" % target)
    return 0


def cmd_ref_refresh(args):
    references, notes = read_catalog()
    for text in notes:
        note("note: " + text)
    wanted = [item for item in references if item["type"] == "git"
              and (not args.alias or item["alias"] in args.alias)]
    unknown = [alias for alias in args.alias
               if alias not in [item["alias"] for item in wanted]]
    if unknown:
        raise Problem("Not a git reference: %s." % ", ".join(unknown))
    if not wanted:
        print("There are no git references to refresh.")
        return 0
    failures = 0
    for reference in wanted:
        try:
            print("%s: at %s" % (reference["alias"], refresh(reference)))
        except Problem as problem:
            failures += 1
            print("%s: %s" % (reference["alias"], problem))
    return 1 if failures else 0


def cmd_config(_args):
    settings, problems = load_settings()
    keys = api_keys(settings)
    pages = read_wiki()
    topics = len(set(page["meta"].get("topic", "") for page in pages))
    references, _notes = read_catalog()
    lines = ["Home: %s (change it with the environment variable %s)" % (home(), HOME_ENV),
             "Wiki: %s (%d topics, %d pages)" % (wikis_dir(), topics, len(pages)),
             "References: %s (%d)" % (references_file(), len(references)),
             "Settings: %s%s" % (settings_file(),
                                 "" if os.path.exists(settings_file()) else " (not there)"),
             "", "Settings in effect:"]
    for key in DEFAULTS:
        if not key.endswith("ApiKey"):
            lines.append("  %s: %s" % (key, json.dumps(settings[key])))
    for provider in PROVIDERS:
        origin = keys[provider][1]
        lines.append("  %s API key: %s" % (LABELS[provider], "set, from the %s" % origin
                                          if origin else "not set; the keyless service is used"))
    lines.extend("note: %s" % problem for problem in problems)
    print("\n".join(lines))
    return 0


def parser():
    top = argparse.ArgumentParser(
        prog="knowledge.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = top.add_subparsers(dest="command", metavar="COMMAND")

    local = commands.add_parser(
        "local", help="search or browse the local wiki and the reference roots",
        description="With nothing: list the references and the newest wiki topics. With "
                    "--query: list the references and the wiki pages that match. The lists "
                    "only identify; open a page or a root before relying on it.")
    local.add_argument("--query", metavar="TEXT", help="what to look for; * or nothing browses")
    local.add_argument("--type", choices=("wikis", "references"),
                       help="look in one of the two only")
    local.add_argument("--page", metavar="FILE", help="open this wiki page in full")
    local.add_argument("--alias", metavar="NAME",
                       help="show this reference's root and what is directly in it")
    local.add_argument("--max-results", type=int, metavar="N",
                       help="wiki pages or topics to list (default 20, at most 50)")
    local.add_argument("--no-content", action="store_true",
                       help="with --page: print where the page is and not its text")
    local.set_defaults(run=cmd_local)

    search = commands.add_parser(
        "web-search", help="search the web; the results are kept in the local wiki",
        description="Search the web. The same query asked again replaces the copy kept before.")
    search.add_argument("query", metavar="QUERY", help="the search query, as one argument")
    search.add_argument("--num-results", type=int, metavar="N",
                        help="results to return (at most %d)" % MAX_NUM_RESULTS)
    search.add_argument("--type", choices=SEARCH_TYPES, help="how deep to search")
    search.add_argument("--livecrawl", choices=LIVECRAWL,
                        help="preferred asks for pages crawled now")
    search.add_argument("--context-max-characters", type=int, metavar="N",
                        help="how much text to return for the highlights (1 to 50000)")
    search.add_argument("--provider", choices=PROVIDERS,
                        help="the provider to ask first, for this search only")
    search.set_defaults(run=cmd_web_search)

    fetch = commands.add_parser(
        "web-fetch", help="fetch pages as markdown or text; they are kept in the local wiki",
        description="Fetch one URL and print its first page, or fetch several URLs at the same "
                    "time and print where each was saved. A URL fetched again replaces the "
                    "copy kept before.")
    fetch.add_argument("url", metavar="URL", nargs="+", help="an http or https URL")
    fetch.add_argument("--format", choices=("markdown", "text"), default="markdown",
                       help="what HTML is converted to (default markdown)")
    fetch.add_argument("--timeout", type=float, metavar="SECONDS",
                       help="time allowed for each URL (%d to %d)"
                            % (MIN_FETCH_SECONDS, MAX_FETCH_SECONDS))
    fetch.add_argument("--whole-page", action="store_true",
                       help="keep navigation and everything around the main content")
    fetch.add_argument("--no-content", action="store_true",
                       help="print where the page was saved and not its text")
    fetch.set_defaults(run=cmd_web_fetch)

    forget = commands.add_parser(
        "forget", help="remove a topic from the local wiki",
        description="Remove every page of the topic a wiki page belongs to: a fetched page "
                    "that turned out useless, or one the user wants gone.")
    forget.add_argument("page", metavar="FILE", nargs="+", help="a page file of the topic")
    forget.set_defaults(run=cmd_forget)

    add = commands.add_parser(
        "ref-add", help="add a reference root: a local directory or a git repository",
        description="Add a reference. A git repository is cloned once into the home directory.")
    add.add_argument("alias", metavar="ALIAS", help="the short name of the reference")
    add.add_argument("source", metavar="SOURCE",
                     help="a directory, or a repository: owner/name, host/path, a URL")
    add.add_argument("--branch", help="the branch of a repository")
    add.add_argument("--description", help="what the reference holds and when to look in it")
    add.add_argument("--hidden", action="store_true",
                     help="leave it out of the lists; --alias still selects it")
    add.add_argument("--replace", action="store_true", help="replace a reference of this name")
    add.set_defaults(run=cmd_ref_add)

    remove = commands.add_parser("ref-remove", help="remove a reference root",
                                 description="Remove a reference, and its clone when it had one.")
    remove.add_argument("alias", metavar="ALIAS")
    remove.set_defaults(run=cmd_ref_remove)

    update = commands.add_parser(
        "ref-refresh", help="update the git reference roots",
        description="Fetch the newest commit of every git reference, or of the ones named.")
    update.add_argument("alias", metavar="ALIAS", nargs="*")
    update.set_defaults(run=cmd_ref_refresh)

    config = commands.add_parser(
        "config", help="show where everything is kept and the settings in effect",
        description="Show the home directory, its files and the settings in effect.")
    config.set_defaults(run=cmd_config)
    return top


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 6000))
    top = parser()
    args = top.parse_args(argv)
    if not args.command:
        top.print_help()
        return 2
    try:
        return args.run(args)
    except UsageError as error:
        note("usage: %s" % error)
        return 2
    except Problem as error:
        note("failed: %s" % error)
        return 1
    except OSError as error:
        note("failed: %s" % error)
        return 1
    except KeyboardInterrupt:
        note("failed: interrupted")
        return 1


if __name__ == "__main__":
    sys.exit(main())
