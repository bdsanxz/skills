"""Tests for scripts/knowledge.py. Run: python3 dev/knowledge/test_knowledge.py

Every test uses its own home directory and a web server on this machine; nothing
leaves the machine.
"""

import contextlib
import gzip
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.normpath(os.path.join(HERE, "..", "..", "scripts", "knowledge.py"))
spec = importlib.util.spec_from_file_location("knowledge", SCRIPT)
k = importlib.util.module_from_spec(spec)
spec.loader.exec_module(k)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def answer(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        server = self.server
        server.seen.append({"method": self.command, "path": self.path, "body": body,
                            "headers": {key.lower(): value
                                        for key, value in self.headers.items()}})
        route = server.routes.get(self.path.split("?")[0])
        if callable(route):
            route = route(server.seen[-1])
        if route is None:
            route = (404, {"Content-Type": "text/plain"}, b"not here")
        status, headers, payload = route
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(payload)
        except OSError:
            pass

    do_GET = answer
    do_POST = answer

    def log_message(self, *_):
        pass


class Case(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="gk-home-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.saved = {name: os.environ.get(name)
                      for name in (k.HOME_ENV, "EXA_API_KEY", "KEENABLE_API_KEY",
                                   "PARALLEL_API_KEY")}
        os.environ[k.HOME_ENV] = self.home
        for name in ("EXA_API_KEY", "KEENABLE_API_KEY", "PARALLEL_API_KEY"):
            os.environ.pop(name, None)
        self.addCleanup(self.restore)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.server.routes = {}
        self.server.seen = []
        threading.Thread(target=self.server.serve_forever, args=(0.02,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        self.constants = {name: getattr(k, name) for name in (
            "EXA_MCP_URL", "EXA_REST_URL", "KEENABLE_URL", "KEENABLE_PUBLIC_URL",
            "PARALLEL_URL", "PARALLEL_MCP_URL", "MIN_FETCH_SECONDS")}
        k.EXA_MCP_URL = self.base + "/exa-mcp"
        k.EXA_REST_URL = self.base + "/exa-rest"
        k.KEENABLE_URL = self.base + "/keenable"
        k.KEENABLE_PUBLIC_URL = self.base + "/keenable-public"
        k.PARALLEL_URL = self.base + "/parallel"
        k.PARALLEL_MCP_URL = self.base + "/parallel-mcp"

    def restore(self):
        for name, value in self.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        for name, value in self.constants.items():
            setattr(k, name, value)

    def run_script(self, *arguments):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = k.main(list(arguments))
            except SystemExit as stop:
                code = stop.code
        return code, out.getvalue(), err.getvalue()

    def ok(self, *arguments):
        code, out, err = self.run_script(*arguments)
        self.assertEqual(code, 0, "exit %s\n%s\n%s" % (code, out, err))
        return out

    def serve(self, path, body, content_type="text/html; charset=utf-8", status=200, **headers):
        merged = {"Content-Type": content_type}
        merged.update({key.replace("_", "-"): value for key, value in headers.items()})
        self.server.routes[path] = (status, merged, body)
        return self.base + path

    def wiki(self):
        root = os.path.join(self.home, "wikis")
        return sorted(name for name in os.listdir(root) if name.endswith(".md")) \
            if os.path.isdir(root) else []

    def page(self, name):
        with open(os.path.join(self.home, "wikis", name), encoding="utf-8") as stream:
            return k.parse_page(stream.read())


def markdown(html, url="https://site.test/docs/page", whole=False, fmt="markdown"):
    return k.convert_html(html, url, fmt, whole)[1]


class HtmlTest(unittest.TestCase):
    def test_headings_paragraphs_and_inline_marks(self):
        text = markdown("<h1>Title</h1><p>One <b>bold</b>, <em>soft</em>, <code>x = 1</code> "
                        "and <del>gone</del>.</p><h3>Sub</h3><p>Two<br>lines</p><hr>")
        self.assertEqual(text, "# Title\n\nOne **bold**, *soft*, `x = 1` and ~~gone~~.\n\n"
                               "### Sub\n\nTwo\nlines\n\n---")

    def test_spaces_stay_outside_marks(self):
        self.assertEqual(markdown("<p>a<b> b </b>c</p>"), "a **b** c")

    def test_links_become_absolute_and_page_anchors_are_dropped(self):
        text = markdown('<p><a href="/a/b">rel</a> <a href="c?d=1">near</a> '
                        '<a href="https://x.test/y">abs</a> <a href="#top">jump</a> '
                        '<a href="javascript:void(0)">js</a> <a href="/empty"></a></p>')
        self.assertEqual(text, "[rel](https://site.test/a/b) [near](https://site.test/docs/c?d=1)"
                               " [abs](https://x.test/y) jump js")

    def test_base_element_changes_where_links_point(self):
        text = markdown('<head><base href="https://cdn.test/root/"></head><a href="x">x</a>')
        self.assertEqual(text, "[x](https://cdn.test/root/x)")

    def test_link_with_brackets_in_the_url_is_wrapped(self):
        text = markdown('<a href="/wiki/A_(b)">a</a>')
        self.assertEqual(text, "[a](<https://site.test/wiki/A_(b)>)")

    def test_heading_anchor_marks_are_removed(self):
        text = markdown('<h2>Install<a href="#install">\xb6</a></h2>')
        self.assertEqual(text, "## Install")

    def test_images(self):
        text = markdown('<p><img src="/i.png" alt="A  chart"> <img src="data:image/png;base64,AA" '
                        'alt="dot"> <img alt="nothing"></p>')
        self.assertEqual(text, "![A chart](https://site.test/i.png) dot nothing")

    def test_lists_nest_and_number(self):
        text = markdown("<ul><li>one<ul><li>inner a<li>inner b</ul></li><li>two</li></ul>"
                        "<ol start='3'><li>three</li><li><p>four</p><p>more</p></li></ol>")
        self.assertEqual(text, "- one\n  - inner a\n  - inner b\n- two\n\n"
                               "3. three\n4. four\n\n   more")

    def test_unclosed_paragraphs_and_items_are_closed_like_a_browser_does(self):
        self.assertEqual(markdown("<p>a<p>b<div>c</div>"), "a\n\nb\n\nc")
        self.assertEqual(markdown("<ul><li>a<li>b<li>c</ul>"), "- a\n- b\n- c")

    def test_code_block_keeps_its_text_and_language(self):
        text = markdown('<pre><code class="language-python">def f():\n    return "&lt;b&gt;"\n'
                        '</code></pre>')
        self.assertEqual(text, '```python\ndef f():\n    return "<b>"\n```')

    def test_code_block_language_from_the_wrapper(self):
        text = markdown('<div class="highlight-shell notranslate"><div class="highlight">'
                        '<pre>ls -la</pre></div></div>')
        self.assertEqual(text, "```shell\nls -la\n```")
        text = markdown('<pre class="brush: js notranslate">let a;</pre>')
        self.assertEqual(text, "```js\nlet a;\n```")

    def test_code_block_with_a_fence_inside_gets_a_longer_fence(self):
        text = markdown("<pre>```\ninner\n```</pre>")
        self.assertEqual(text, "````\n```\ninner\n```\n````")

    def test_inline_code_with_a_backtick(self):
        self.assertEqual(markdown("<p><code>a`b</code></p>"), "`` a`b ``")

    def test_blockquote(self):
        self.assertEqual(markdown("<blockquote><p>a</p><p>b</p></blockquote>"), "> a\n>\n> b")

    def test_table_becomes_a_pipe_table(self):
        text = markdown("<table><thead><tr><th>Name<th>Use</tr></thead><tbody>"
                        "<tr><td>a|b<td><code>x</code></tr><tr><td colspan=2>wide</td></tr>"
                        "</tbody></table>")
        self.assertEqual(text, "| Name | Use |\n| --- | --- |\n| a\\|b | `x` |\n| wide |  |")

    def test_table_with_lists_or_one_column_is_read_as_blocks(self):
        text = markdown("<table><tr><td><ul><li>a</li></ul></td><td>b</td></tr></table>")
        self.assertEqual(text, "- a\n\nb")
        self.assertEqual(markdown("<table><tr><td>only</td></tr></table>"), "only")

    def test_scripts_styles_and_hidden_decoration_are_dropped(self):
        text = markdown("<p>keep</p><script>var a = '<p>no</p>';</script><style>p{}</style>"
                        "<noscript>no</noscript><svg><title>no</title></svg>"
                        '<span aria-hidden="true">no</span><template><p>no</p></template>')
        self.assertEqual(text, "keep")

    def test_main_content_is_kept_and_the_rest_dropped(self):
        html = ("<title>Doc</title><header><a href='/'>Home</a></header><nav><a href='/a'>A</a>"
                "</nav><main><h1>Doc</h1><p>" + "word " * 60 + "</p><nav>on this page</nav>"
                "</main><footer>Legal</footer>")
        title, text, trimmed = k.convert_html(html, "https://site.test/", "markdown", False)
        self.assertEqual(title, "Doc")
        self.assertTrue(trimmed)
        self.assertTrue(text.startswith("# Doc\n\nword word"))
        for absent in ("Home", "Legal", "on this page", "[A]"):
            self.assertNotIn(absent, text)
        title, text, trimmed = k.convert_html(html, "https://site.test/", "markdown", True)
        self.assertFalse(trimmed)
        for present in ("Home", "Legal", "on this page", "[A](https://site.test/a)"):
            self.assertIn(present, text)

    def test_small_or_empty_main_does_not_hide_the_page(self):
        text = markdown("<main></main><div><p>" + "real " * 80 + "</p></div>")
        self.assertIn("real real", text)

    def test_a_single_large_article_counts_as_main(self):
        html = "<div>menu</div><article><p>" + "story " * 80 + "</p></article>"
        self.assertNotIn("menu", markdown(html))

    def test_custom_elements_do_not_merge_their_paragraphs(self):
        text = markdown("<my-card><p>one</p><p>two</p></my-card><span><div>three</div></span>")
        self.assertEqual(text, "one\n\ntwo\n\nthree")

    def test_formula_is_given_once_as_tex(self):
        text = markdown('<p>So <math><semantics><mrow><mi>k</mi><mn>1</mn></mrow>'
                        '<annotation encoding="application/x-tex">k_{1}</annotation>'
                        "</semantics></math> holds.</p>")
        self.assertEqual(text, "So $k_{1}$ holds.")

    def test_definition_list(self):
        self.assertEqual(markdown("<dl><dt>Term<dd>Meaning<dt>Next<dd>Other</dl>"),
                         "**Term**\n\nMeaning\n\n**Next**\n\nOther")

    def test_text_format_has_no_markup(self):
        text = markdown("<h1>T</h1><p>a <b>b</b> <a href='/x'>c</a></p><ul><li>i</li></ul>"
                        "<pre>  keep\n    this</pre><script>no</script>", fmt="text")
        self.assertEqual(text, "T\n\na b c\n\ni\n\nkeep\nthis")

    def test_entities_are_decoded(self):
        self.assertEqual(markdown("<p>a &amp; b &lt;c&gt; &#8212; &nbsp;d</p>"),
                         "a & b <c> — d")

    def test_very_deep_and_broken_markup_does_not_fail(self):
        deep = "<div>" * 5000 + "bottom" + "</div>" * 5000
        self.assertIn("bottom", markdown(deep))
        self.assertEqual(markdown("</p></div><p>fine<b>bold"), "fine**bold**")
        self.assertEqual(markdown(""), "")


class WikiTest(Case):
    def test_slugs(self):
        self.assertEqual(k.slugify("  React 19: What's NEW?  "), "react-19-what-s-new")
        self.assertEqual(k.slugify("café crème"), "cafe-creme")
        self.assertEqual(k.slugify("???"), "untitled")
        long_a, long_b = k.slugify("a" * 90 + " one"), k.slugify("a" * 90 + " two")
        self.assertEqual(len(long_a), 80)
        self.assertNotEqual(long_a, long_b)
        self.assertRegex(long_a, r"^[a-z0-9]+(-[a-z0-9]+)*$")

    def test_url_topics(self):
        topic = k.url_topic
        self.assertEqual(topic("https://Docs.Example.com/a/b/?z=1&a=2#frag"),
                         "docs-example-com-a-b-a-2-z-1")
        self.assertEqual(topic("https://x.test:8443/p"), "x-test-8443-p")
        self.assertEqual(topic("https://x.test:443/p"), "x-test-p")
        self.assertEqual(topic("https://x.test/p?api_key=SECRET&q=1"),
                         "x-test-p-api-key-redacted-q-1")
        self.assertEqual(topic("https://me:pw@x.test/p"), "x-test-redacted-p")
        self.assertEqual(topic("https://x.test/p#a"), topic("https://x.test/p#b"))

    def test_pages_are_cut_between_lines_and_keep_every_line(self):
        lines = ["line %d " % number + "x" * (number % 50) for number in range(900)]
        pages = k.split_pages("\n".join(lines), 2000)
        self.assertGreater(len(pages), 5)
        self.assertTrue(all(len(page) <= 2000 for page in pages))
        self.assertEqual("\n".join(pages).split("\n"), lines)

    def test_pages_prefer_to_end_at_an_empty_line(self):
        paragraph = "\n".join("word " * 10 for _ in range(4))
        pages = k.split_pages("\n\n".join([paragraph] * 30), 1000)
        self.assertTrue(all(len(page) <= 1000 for page in pages))
        self.assertTrue(all(page.endswith(paragraph) for page in pages))

    def test_a_line_longer_than_a_page_is_cut(self):
        pages = k.split_pages("short\n" + "y" * 5000 + "\nend", 2000)
        self.assertTrue(all(len(page) <= 2000 for page in pages))
        self.assertEqual("".join(pages).replace("\n", ""), "short" + "y" * 5000 + "end")

    def test_save_and_read_back(self):
        meta = {"source": "web_fetch", "url": "https://x.test/a", "title": "A\nB --> C",
                "format": "markdown", "saved": "2026-01-02T03:04:05Z"}
        text = "first\n-->\n<!-- knowledge-page\nlast"
        files, cut = k.save_topic("x-test-a", meta, text, 24000)
        self.assertEqual((files, cut), (["x-test-a.md"], False))
        read_meta, read_text = self.page("x-test-a.md")
        self.assertEqual(read_text, text)
        self.assertEqual(read_meta["title"], "A B --&gt; C")
        self.assertEqual(read_meta["url"], "https://x.test/a")
        self.assertEqual((read_meta["page"], read_meta["totalPages"]), ("1", "1"))
        self.assertNotIn("next", read_meta)

    def test_a_new_copy_replaces_the_old_one_and_its_extra_pages(self):
        meta = {"source": "web_fetch", "url": "https://x.test/a", "saved": k.now_stamp()}
        files, _cut = k.save_topic("x-test-a", meta, "\n".join(["row"] * 3000), 2000)
        self.assertGreater(len(files), 3)
        self.assertEqual(self.wiki(), sorted(files))
        middle = self.page(files[1])[0]
        self.assertEqual((middle["previous"], middle["next"]), (files[0], files[2]))
        k.save_topic("x-test-a", meta, "short now", 2000)
        self.assertEqual(self.wiki(), ["x-test-a.md"])
        k.save_topic("x-test-ab", meta, "other topic", 2000)
        k.save_topic("x-test-a", meta, "again", 2000)
        self.assertEqual(self.wiki(), ["x-test-a.md", "x-test-ab.md"])

    def keep(self, topic, title, text, saved="2026-05-01T00:00:00Z", **meta):
        meta = dict({"source": "web_fetch", "url": "https://x.test/" + topic, "title": title,
                     "saved": saved}, **meta)
        k.save_topic(topic, meta, text, 24000)

    def test_search_ranks_title_above_body_and_newer_above_older(self):
        self.keep("body", "Other things", "tokio runtime appears once here among many words")
        self.keep("title", "Tokio runtime guide", "an introduction")
        self.keep("none", "Unrelated", "nothing to see")
        ranked = [entry[1]["file"] for entry in k.search_wiki("tokio runtime", 20)]
        self.assertEqual(ranked, ["title.md", "body.md"])
        self.keep("old", "Same words", "same text", saved="2025-01-01T00:00:00Z")
        self.keep("new", "Same words", "same text", saved="2026-01-01T00:00:00Z")
        ranked = [entry[1]["file"] for entry in k.search_wiki("same words", 2)]
        self.assertEqual(ranked, ["new.md", "old.md"])

    def test_search_words(self):
        self.assertEqual(k.tokenize("The useEffect of HTMLParser is résumé_v2"),
                         ["use", "effect", "html", "parser", "resume", "v2"])
        self.assertEqual(k.tokenize("actions classes queries boxes class status js"),
                         ["action", "class", "query", "box", "class", "status", "js"])
        self.keep("hooks", "Hooks", "call useEffect after render")
        self.assertEqual(len(k.search_wiki("effect", 20)), 1)
        self.assertEqual(k.search_wiki("the of and", 20), [])
        self.assertEqual(k.search_wiki("absent", 20), [])
        self.assertEqual(len(k.search_wiki("x.test/hooks", 20)), 1)

    def test_a_page_with_few_of_the_words_is_not_a_match(self):
        self.keep("full", "Checkout action", "fetch depth of the checkout action")
        self.keep("half", "Readme", "actions run tests; fetch the sources")
        self.keep("one", "Notes", "a note about depth")
        found = {entry[1]["file"]: entry for entry in
                 k.search_wiki("actions checkout fetch depth", 20)}
        self.assertEqual(sorted(found), ["full.md", "half.md"])
        self.assertEqual(found["full.md"][2:], (4, 4))
        self.assertEqual(found["half.md"][2:], (2, 4))
        self.assertGreater(found["full.md"][0], 2 * found["half.md"][0])
        out = self.ok("local", "--type", "wikis", "--query", "actions checkout fetch depth")
        self.assertIn("has 4 of 4 words", out.splitlines()[0])
        self.assertIn("has 2 of 4 words", out.splitlines()[1])

    def test_files_that_are_not_pages_are_left_alone(self):
        os.makedirs(os.path.join(self.home, "wikis"))
        for name, text in (("notes.md", "# mine"), ("Upper.md", "x"), ("a.txt", "x")):
            with open(os.path.join(self.home, "wikis", name), "w") as stream:
                stream.write(text)
        self.assertEqual(k.read_wiki(), [])
        self.assertIn("No local wiki pages found.", self.ok("local", "--type", "wikis"))


class LocalTest(Case):
    def keep(self, topic, text="body", saved=None, **meta):
        meta = dict({"source": "web_fetch", "url": "https://x.test/" + topic,
                     "title": topic.title(), "saved": saved or k.now_stamp()}, **meta)
        return k.save_topic(topic, meta, text, 2000)[0]

    def test_nothing_yet(self):
        out = self.ok("local")
        self.assertEqual(out, "--references--\nNo references are set up.\n---\n--wikis--\n"
                              "No local wiki pages found.\n")
        self.assertEqual(self.ok("local", "--query", "anything", "--type", "wikis"),
                         "No local wiki matches found.\n")

    def test_browse_lists_the_newest_topics_first(self):
        self.keep("old", saved="2020-01-01T00:00:00Z")
        self.keep("long", text="\n".join(["row"] * 2000), saved="2026-01-01T00:00:00Z")
        k.save_topic("how-to", {"source": "web_search", "query": "how to", "saved":
                                "2024-01-01T00:00:00Z"}, "results", 2000)
        out = self.ok("local", "--type", "wikis").splitlines()
        self.assertRegex(out[0], r"^- long\.md \(saved 2026-01-01, \d+ days ago, \d+ pages\): "
                                 r"Long <https://x\.test/long>$")
        self.assertRegex(out[1], r"^- how-to\.md \(saved 2024-01-01, \d+ days ago\): "
                                 r"web search: how to$")
        self.assertTrue(out[2].startswith("- old.md (saved 2020-01-01"))
        self.assertEqual(out[3], "Wiki directory: " + os.path.join(self.home, "wikis"))
        out = self.ok("local", "--type", "wikis", "--query", "*", "--max-results", "1")
        self.assertIn("- long.md", out)
        self.assertNotIn("- old.md", out)
        self.assertIn("... and 2 older topics", out)

    def test_query_lists_matching_pages_with_their_page_number(self):
        self.keep("guide", text="\n".join(["filler"] * 600 + ["zebra crossing"]))
        self.keep("other", text="no match")
        out = self.ok("local", "--query", "zebra")
        self.assertIn("--references--", out)
        self.assertRegex(out, r"- guide\.part-00\d\.md \(score \d+\.\d{3}, has 1 of 1 words, "
                              r"saved \S+, today, "
                              r"page \d of \d\): Guide <https://x\.test/guide>")
        self.assertNotIn("other.md", out)

    def test_open_a_page(self):
        files = self.keep("guide", text="\n".join("row %d" % n for n in range(700)))
        self.assertGreaterEqual(len(files), 3)
        wikis = os.path.join(self.home, "wikis")
        out = self.ok("local", "--page", files[1])
        self.assertTrue(out.startswith("Page: %s (page 2 of %d)\nHolds: Guide <https://x.test/"
                                       "guide>\nSaved: " % (os.path.join(wikis, files[1]),
                                                             len(files))))
        self.assertIn("Previous: " + os.path.join(wikis, files[0]), out)
        self.assertIn("Next: " + os.path.join(wikis, files[2]), out)
        self.assertIn("[Page 2 of %d. The text continues in %s]"
                      % (len(files), os.path.join(wikis, files[2])), out)
        body = self.page(files[1])[1]
        self.assertIn("\n\n" + body + "\n\n[Page", out)
        last = self.ok("local", "--page", os.path.join(wikis, files[-1]))
        self.assertIn("[Page %d of %d, the last one.]" % (len(files), len(files)), last)
        short = self.ok("local", "--page", files[0], "--no-content")
        self.assertNotIn("row 0", short)
        self.assertIn("Next: ", short)

    def test_page_names_are_checked(self):
        self.keep("guide")
        for bad in ("../guide.md", "/etc/passwd", "guide", "Guide.md", "guide.part-2.md",
                    os.path.join(self.home, "guide.md")):
            code, _out, err = self.run_script("local", "--page", bad)
            self.assertEqual(code, 2, bad)
            self.assertIn("usage: --page takes the file name", err)
        code, _out, err = self.run_script("local", "--page", "absent.md")
        self.assertEqual(code, 1)
        self.assertIn("There is no wiki page named absent.md", err)

    def test_forget_removes_every_page_of_a_topic(self):
        files = self.keep("guide", text="\n".join("row %d" % n for n in range(700)))
        self.keep("guide-two")
        self.keep("other")
        wikis = os.path.join(self.home, "wikis")
        out = self.ok("forget", files[1], os.path.join(wikis, "other.md"), files[0])
        self.assertEqual(out, "Forgot guide (%d pages)\nForgot other (1 page)\n" % len(files))
        self.assertEqual(self.wiki(), ["guide-two.md"])
        code, _out, err = self.run_script("forget", "guide-two.md", "absent.md")
        self.assertEqual(code, 1)
        self.assertIn("There is no wiki topic named absent", err)
        self.assertEqual(self.wiki(), ["guide-two.md"])
        for bad in ("../guide-two.md", "/etc/hosts", "guide-two", "*.md"):
            code, _out, _err = self.run_script("forget", bad)
            self.assertEqual(code, 2, bad)
        self.assertEqual(self.wiki(), ["guide-two.md"])

    def test_options_that_do_not_go_together(self):
        for arguments in (("--page", "a.md", "--query", "x"),
                          ("--page", "a.md", "--type", "references"),
                          ("--page", "a.md", "--alias", "x"),
                          ("--alias", "x", "--type", "wikis"),
                          ("--type", "other")):
            code, _out, _err = self.run_script("local", *arguments)
            self.assertEqual(code, 2, arguments)

    def test_no_command_prints_help(self):
        code, out, _err = self.run_script()
        self.assertEqual(code, 2)
        self.assertIn("web-fetch", out)


class ReferenceTest(Case):
    def folder(self):
        root = tempfile.mkdtemp(prefix="gk-ref-")
        self.addCleanup(shutil.rmtree, root, True)
        for name in ("src", ".git", "node_modules"):
            os.mkdir(os.path.join(root, name))
        with open(os.path.join(root, "README.md"), "w") as stream:
            stream.write("# hello\n")
        return root

    def test_add_list_select_and_remove_a_directory(self):
        root = self.folder()
        out = self.ok("ref-add", "docs", root, "--description", "The team's handbook")
        self.assertEqual(out, "Added reference docs (local)\nRoot: %s\n" % os.path.realpath(root))
        self.assertEqual(self.ok("local", "--type", "references"),
                         "- docs (local): The team's handbook\n  root: %s\n"
                         % os.path.realpath(root))
        out = self.ok("local", "--alias", "docs")
        self.assertEqual(out, "Reference: docs (local)\nDescription: The team's handbook\n"
                              "Root: %s\nImmediate children:\n  - README.md (file)\n"
                              "  - src (directory)\n%s\n" % (os.path.realpath(root), k.HANDOFF))
        code, _out, err = self.run_script("ref-add", "docs", root)
        self.assertEqual(code, 1)
        self.assertIn("Add --replace", err)
        self.ok("ref-add", "docs", root, "--replace", "--hidden")
        self.assertEqual(self.ok("local", "--type", "references"), "No references are set up.\n")
        self.assertIn("Root: ", self.ok("local", "--alias", "docs"))
        self.assertEqual(self.ok("ref-remove", "docs"), "Removed reference docs\n")
        code, _out, err = self.run_script("local", "--alias", "docs")
        self.assertEqual(code, 1)
        self.assertIn("There is no reference named 'docs'. No references are set up.", err)

    def test_what_cannot_be_added(self):
        root = self.folder()
        cases = ((("has space", root), 2, "alias must be one word"),
                 (("a/b", root), 2, "alias must be one word"),
                 (("gone", "/no/such/dir"), 1, "is not a directory"),
                 (("odd", "not a repo"), 2, "is not a git repository"),
                 (("odd", "just-a-word"), 2, "is not a git repository"),
                 (("br", root, "--branch", "main"), 2, "--branch goes with a git repository"),
                 (("br", "owner/name", "--branch=-x"), 2, "not a safe git branch name"))
        for arguments, expected, message in cases:
            code, _out, err = self.run_script("ref-add", *arguments)
            self.assertEqual(code, expected, arguments)
            self.assertIn(message, err)
        self.assertFalse(os.path.exists(os.path.join(self.home, "references.json")))

    def test_a_directory_that_went_away_is_listed_as_unavailable(self):
        root = self.folder()
        self.ok("ref-add", "docs", root)
        shutil.rmtree(root)
        out = self.ok("local", "--type", "references")
        self.assertIn("- docs (local)\n  unavailable: the directory", out)
        code, _out, err = self.run_script("local", "--alias", "docs")
        self.assertEqual(code, 1)
        self.assertIn("Reference 'docs' is unavailable", err)

    def test_a_file_written_by_hand_is_read_with_care(self):
        root = self.folder()
        document = {"references": {
            "short": root, "home": "~/", "bad alias": root, "relative": "./x",
            "both": {"path": root, "repository": "a/b"}, "repo": "owner/name",
            "typed": {"path": root, "description": 5}}}
        with open(os.path.join(self.home, "references.json"), "w") as stream:
            json.dump(document, stream)
        out = self.ok("local", "--type", "references")
        self.assertIn("- short (local)\n  root: " + os.path.realpath(root), out)
        self.assertIn("- home (local)\n  root: ", out)
        self.assertIn("- repo (git)\n  unavailable: the repository is not cloned", out)
        for ignored in ("relative", "both", "typed"):
            self.assertIn("note: reference '%s' is ignored" % ignored, out)
        self.assertIn("note: an alias with a space", out)
        with open(os.path.join(self.home, "references.json"), "w") as stream:
            stream.write("{not json")
        out = self.ok("local", "--type", "references")
        self.assertIn("No references are set up.\nnote: ", out)
        code, _out, err = self.run_script("ref-add", "x", root)
        self.assertEqual(code, 1)
        self.assertIn("Repair or remove the file first", err)

    def test_many_children_are_cut(self):
        root = self.folder()
        for number in range(k.MAX_CHILDREN + 5):
            open(os.path.join(root, "f%04d" % number), "w").close()
        self.ok("ref-add", "big", root)
        out = self.ok("local", "--alias", "big")
        self.assertEqual(out.count("\n  - "), k.MAX_CHILDREN)
        self.assertIn("  ... and 7 more entries", out)

    def test_repositories_are_recognised(self):
        parse = k.parse_repository
        self.assertEqual(parse("owner/name")["remote"], "https://github.com/owner/name.git")
        self.assertEqual(parse("github:owner/name.git")["segments"], ["owner", "name"])
        self.assertEqual(parse("https://github.com/Owner/Name/")["remote"],
                         "https://github.com/Owner/Name.git")
        self.assertEqual(parse("gitlab.com/group/sub/name")["remote"],
                         "https://gitlab.com/group/sub/name.git")
        scp = parse("git@example.com:team/name.git")
        self.assertEqual((scp["host"], scp["segments"], scp["remote"]),
                         ("example.com", ["team", "name"], "git@example.com:team/name.git"))
        self.assertEqual(parse("https://git.test:8443/a/b.git")["host"], "git.test:8443")
        for bad in ("", "name", "a/b/c", "a b/c", "a/../b", "a/b;rm", "$x/y", "ftp://h/a/b",
                    "https:///a/b", "-x/y:z"):
            self.assertIsNone(parse(bad), bad)
        self.assertTrue(k.cache_path(parse("owner/name"), "feat/x").endswith(
            os.path.join("repos", "github.com", "owner", "name@feat%2Fx")))

    def git(self, *arguments, cwd):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.test"]
                       + list(arguments), cwd=cwd, check=True, capture_output=True)

    @unittest.skipUnless(shutil.which("git"), "git is not installed")
    def test_a_git_reference_is_cloned_refreshed_and_removed(self):
        origin = tempfile.mkdtemp(prefix="gk-origin-")
        self.addCleanup(shutil.rmtree, origin, True)
        self.git("init", "-q", "-b", "main", cwd=origin)
        with open(os.path.join(origin, "a.txt"), "w") as stream:
            stream.write("one\n")
        self.git("add", ".", cwd=origin)
        self.git("commit", "-q", "-m", "one", cwd=origin)
        out = self.ok("ref-add", "lib", "file://" + origin, "--branch", "main")
        root = out.strip().split("Root: ")[1]
        self.assertTrue(root.startswith(os.path.realpath(os.path.join(self.home, "repos"))))
        self.assertTrue(os.path.isfile(os.path.join(root, "a.txt")))
        self.assertIn("- lib (git)\n  root: " + root, self.ok("local", "--type", "references"))
        with open(os.path.join(origin, "b.txt"), "w") as stream:
            stream.write("two\n")
        self.git("add", ".", cwd=origin)
        self.git("commit", "-q", "-m", "two", cwd=origin)
        self.assertRegex(self.ok("ref-refresh"), r"^lib: at [0-9a-f]{7,}\n$")
        self.assertTrue(os.path.isfile(os.path.join(root, "b.txt")))
        code, _out, err = self.run_script("ref-refresh", "nope")
        self.assertEqual(code, 1)
        self.assertIn("Not a git reference: nope", err)
        out = self.ok("ref-remove", "lib")
        self.assertIn("Removed its clone", out)
        self.assertFalse(os.path.exists(root))

    @unittest.skipUnless(shutil.which("git"), "git is not installed")
    def test_a_repository_that_cannot_be_cloned_is_not_added(self):
        code, _out, err = self.run_script("ref-add", "lib", "file:///no/such/repo")
        self.assertEqual(code, 1)
        self.assertIn("git clone failed", err)
        self.assertFalse(os.path.exists(os.path.join(self.home, "references.json")))
        leftovers = [name for _root, dirs, _files in os.walk(os.path.join(self.home, "repos"))
                     for name in dirs if name.startswith(".clone-")]
        self.assertEqual(leftovers, [])
        self.assertEqual(self.ok("ref-refresh"), "There are no git references to refresh.\n")


PAGE = ("<html><head><title>Guide &amp; more</title></head><body><nav><a href='/'>Home</a></nav>"
        "<main><h1>Guide</h1><p>" + "Read <a href='next'>this</a> first. " * 12 + "</p></main>"
        "</body></html>")


class FetchTest(Case):
    def test_html_is_printed_as_markdown_and_saved(self):
        url = self.serve("/docs/guide", PAGE)
        out = self.ok("web-fetch", url)
        file = os.path.join(self.home, "wikis", "127-0-0-1-%d-docs-guide.md"
                            % self.server.server_address[1])
        meta, text = self.page(os.path.basename(file))
        self.assertTrue(out.startswith(
            "URL: %s\nTitle: Guide & more\nType: text/html; charset=utf-8, as markdown, main "
            "content only (--whole-page gives everything)\nSaved: %s (1 page, %d characters)\n\n"
            "# Guide\n\nRead [this](%s/docs/next) first." % (url, file, len(text), self.base)))
        self.assertNotIn("Home", out)
        self.assertEqual((meta["source"], meta["url"], meta["title"], meta["format"]),
                         ("web_fetch", url, "Guide & more", "markdown"))
        self.assertTrue(out.endswith(text + "\n"))
        sent = self.server.seen[0]["headers"]
        self.assertIn("Mozilla/5.0", sent["user-agent"])
        self.assertTrue(sent["accept"].startswith("text/markdown;q=1.0"))

    def test_whole_page_text_format_and_no_content(self):
        url = self.serve("/g", PAGE)
        out = self.ok("web-fetch", url, "--whole-page", "--format", "text", "--no-content")
        self.assertIn("Type: text/html; charset=utf-8, as text\n", out)
        self.assertNotIn("Read this first", out)
        meta, text = self.page(self.wiki()[0])
        self.assertEqual(meta["format"], "text")
        self.assertTrue(text.startswith("Home\n\nGuide\n\nRead this first."))
        self.assertTrue(self.server.seen[0]["headers"]["accept"].startswith("text/plain;q=1.0"))

    def test_fetching_again_keeps_one_copy(self):
        url = self.serve("/g", PAGE)
        self.ok("web-fetch", url)
        self.serve("/g", "<p>changed</p>")
        out = self.ok("web-fetch", url + "#section")
        self.assertTrue(out.endswith("\n\nchanged\n"))
        self.assertEqual(len(self.wiki()), 1)
        self.assertEqual(self.page(self.wiki()[0])[1], "changed")

    def test_a_long_page_is_paged(self):
        body = "".join("<p>paragraph %d %s</p>" % (n, "word " * 30) for n in range(400))
        url = self.serve("/long", "<main>" + body + "</main>")
        out = self.ok("web-fetch", url)
        files = self.wiki()
        self.assertGreater(len(files), 2)
        self.assertRegex(out, r"\(page 1 of %d, \d+ characters in all\)\n" % len(files))
        for name in files[1:]:
            self.assertIn("\n  " + os.path.join(self.home, "wikis", name), out)
        self.assertTrue(out.rstrip().endswith(
            "[Page 1 of %d. The text continues in %s]"
            % (len(files), os.path.join(self.home, "wikis", files[1]))))
        self.assertIn("paragraph 0 ", out)
        self.assertNotIn("paragraph 399 ", out)
        self.assertLess(len(out), 26000)
        whole = "\n\n".join(self.page(name)[1] for name in sorted(
            files, key=k.page_number))
        self.assertEqual(whole.count("paragraph "), 400)
        self.assertIn("paragraph 399 ", self.ok("local", "--page", files[-1]))

    def test_other_text_types_are_kept_as_they_are(self):
        url = self.serve("/a.md", "# Already *markdown*\n\n<b>raw</b>\r\nline",
                         "text/markdown; charset=utf-8")
        out = self.ok("web-fetch", url)
        self.assertIn("Type: text/markdown; charset=utf-8\n", out)
        self.assertTrue(out.endswith("\n\n# Already *markdown*\n\n<b>raw</b>\nline\n"))
        url = self.serve("/a.json", '{"a": [1, 2]}', "application/json")
        self.assertTrue(self.ok("web-fetch", url).endswith('\n\n{"a": [1, 2]}\n'))

    def test_character_sets(self):
        url = self.serve("/latin", "<p>café</p>".encode("latin-1"),
                         "text/html; charset=ISO-8859-1")
        self.assertTrue(self.ok("web-fetch", url).endswith("\n\ncafé\n"))
        url = self.serve("/meta", "<meta charset='windows-1252'><p>naïve</p>".encode(
            "cp1252"), "text/html")
        self.assertTrue(self.ok("web-fetch", url).endswith("\n\nnaïve\n"))
        url = self.serve("/odd", "<p>plain</p>", "text/html; charset=no-such-set")
        self.assertTrue(self.ok("web-fetch", url).endswith("\n\nplain\n"))

    def test_compressed_answers_are_read(self):
        url = self.serve("/z", gzip.compress(b"<p>squeezed</p>"), Content_Encoding="gzip")
        self.assertTrue(self.ok("web-fetch", url).endswith("\n\nsqueezed\n"))
        self.assertEqual(self.server.seen[0]["headers"]["accept-encoding"], "gzip")

    def test_redirects_are_followed_and_named(self):
        final = self.serve("/final", "<p>arrived</p>")
        for status in (301, 302, 307, 308):
            self.serve("/start", "", status=status, Location="/final")
            out = self.ok("web-fetch", self.base + "/start")
            self.assertTrue(out.startswith("URL: %s\nRedirected from: %s/start\n"
                                           % (final, self.base)), status)
        self.assertEqual(len(self.wiki()), 1)
        self.assertIn("-final.md", self.wiki()[0])

    def test_a_file_page_of_a_code_host_is_fetched_as_the_file(self):
        direct = k.direct_source
        self.assertEqual(direct("https://github.com/o/r/blob/main/src/a.py?plain=1#L3"),
                         "https://raw.githubusercontent.com/o/r/main/src/a.py")
        self.assertEqual(direct("https://github.com/o/r/raw/v1.2/README.md"),
                         "https://raw.githubusercontent.com/o/r/v1.2/README.md")
        for same in ("https://github.com/o/r", "https://github.com/o/r/tree/main/src",
                     "https://github.com/o/r/issues/5", "https://x.test/o/r/blob/main/a.py"):
            self.assertEqual(direct(same), same)
        page = self.serve("/o/r/blob/main/a.py", "<main><p>buttons only</p></main>")
        raw = self.serve("/raw/a.py", "print('the file')", "text/plain")
        self.addCleanup(setattr, k, "direct_source", direct)
        k.direct_source = lambda url: raw if url == page else url
        out = self.ok("web-fetch", page)
        self.assertTrue(out.startswith("URL: %s\nRedirected from: %s\n" % (raw, page)))
        self.assertTrue(out.endswith("\n\nprint('the file')\n"))
        self.serve("/raw/a.py", "gone", status=404)
        out = self.ok("web-fetch", page)
        self.assertTrue(out.startswith("URL: %s\nTitle" % page) or out.startswith(
            "URL: %s\nType" % page))
        self.assertTrue(out.endswith("\n\nbuttons only\n"))

    def test_failures(self):
        self.serve("/gone", "no", status=404)
        self.serve("/pdf", b"%PDF-1.7", "application/pdf")
        self.serve("/untyped", b"data", "")
        for path, message in (("/gone", "Failed: HTTP 404: Not Found"),
                              ("/pdf", "Failed: Unsupported binary content-type: "
                                       "application/pdf"),
                              ("/untyped", "Failed: Unsupported binary content-type: unknown")):
            code, out, _err = self.run_script("web-fetch", self.base + path)
            self.assertEqual(code, 1, path)
            self.assertIn(message, out)
        for bad, message in (("ftp://x.test/a", "URL must start with http:// or https://"),
                             ("x.test/a", "URL must start with http:// or https://"),
                             ("http://", "Invalid URL"),
                             ("http://127.0.0.1:1/", "Request failed")):
            code, out, _err = self.run_script("web-fetch", bad)
            self.assertEqual(code, 1, bad)
            self.assertIn("Failed: " + message, out)
        self.assertEqual(self.wiki(), [])

    def test_an_empty_page_is_not_saved(self):
        url = self.serve("/empty", "<html><body><script>app()</script></body></html>")
        out = self.ok("web-fetch", url)
        self.assertIn("The page has no content. Nothing was saved.", out)
        self.assertEqual(self.wiki(), [])

    def test_an_answer_over_the_limit_is_refused(self):
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            json.dump({"maxResponseBytes": 1000}, stream)
        self.serve("/big", "<p>" + "x" * 5000 + "</p>")
        self.serve("/bomb", gzip.compress(b"<p>" + b"x" * 500000 + b"</p>"),
                   Content_Encoding="gzip")
        for path in ("/big", "/bomb"):
            code, out, _err = self.run_script("web-fetch", self.base + path)
            self.assertEqual(code, 1)
            self.assertIn("Failed: Response too large (exceeds the maxResponseBytes setting of "
                          "1000 bytes)", out)

    def test_a_slow_server_times_out(self):
        k.MIN_FETCH_SECONDS = 0.2

        def slow(_request):
            time.sleep(1.5)
            return (200, {"Content-Type": "text/html"}, "<p>late</p>")

        self.server.routes["/slow"] = slow
        started = time.monotonic()
        code, out, _err = self.run_script("web-fetch", self.base + "/slow", "--timeout", "0.2")
        self.assertEqual(code, 1)
        self.assertIn("Failed: Request timed out", out)
        self.assertLess(time.monotonic() - started, 1.4)

    def test_a_challenge_is_retried_once_with_a_plain_agent(self):
        def guarded(request):
            if "Mozilla" in request["headers"]["user-agent"]:
                return (403, {"Content-Type": "text/html", "cf-mitigated": "challenge"}, "no")
            return (200, {"Content-Type": "text/html"}, "<p>let in</p>")

        self.server.routes["/guarded"] = guarded
        self.assertTrue(self.ok("web-fetch", self.base + "/guarded").endswith("\n\nlet in\n"))
        agents = [request["headers"]["user-agent"] for request in self.server.seen]
        self.assertEqual(len(agents), 2)
        self.assertEqual(agents[1], "get-knowledge")
        self.serve("/forbidden", "no", status=403)
        code, out, _err = self.run_script("web-fetch", self.base + "/forbidden")
        self.assertEqual(code, 1)
        self.assertIn("Failed: HTTP 403", out)
        self.assertEqual(len(self.server.seen), 3)

    def test_an_image_is_saved_as_a_file(self):
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
        url = self.serve("/pic.png", png, "image/png")
        out = self.ok("web-fetch", url)
        path = os.path.join(self.home, "files", "127-0-0-1-%d-pic-png.png"
                            % self.server.server_address[1])
        self.assertIn("Image: %s (28 bytes). Open this file to see it." % path, out)
        with open(path, "rb") as stream:
            self.assertEqual(stream.read(), png)
        meta, text = self.page(self.wiki()[0])
        self.assertEqual(meta["format"], "image")
        self.assertIn(path, text)
        url = self.serve("/v.svg", "<svg><text>hi</text></svg>", "image/svg+xml")
        self.assertTrue(self.ok("web-fetch", url).endswith("<svg><text>hi</text></svg>\n"))

    def test_several_urls_are_fetched_together_and_only_summarised(self):
        def slow(text):
            def route(_request):
                time.sleep(0.4)
                return (200, {"Content-Type": "text/html"}, "<p>%s</p>" % text)
            return route

        for name in "abcd":
            self.server.routes["/" + name] = slow("content of " + name)
        self.serve("/missing", "no", status=404)
        urls = [self.base + "/" + name for name in ("a", "b", "missing", "c", "d", "a")]
        started = time.monotonic()
        code, out, err = self.run_script("web-fetch", *urls)
        self.assertLess(time.monotonic() - started, 1.2)
        self.assertEqual(code, 1)
        self.assertIn("1 of 5 URLs failed.", err)
        sections = out.strip().split("\n\n")
        self.assertEqual(len(sections), 5)
        self.assertEqual([section.split("\n")[0] for section in sections],
                         ["URL: " + url for url in urls[:5]])
        self.assertIn("Failed: HTTP 404", sections[2])
        self.assertNotIn("content of", out)
        self.assertEqual(len(self.wiki()), 4)
        self.assertEqual(self.page(self.wiki()[0])[1], "content of a")

    def test_addresses_with_spaces_and_other_alphabets(self):
        self.server.routes["/a%20b/%C3%A9"] = (200, {"Content-Type": "text/html"}, "<p>ok</p>")
        out = self.ok("web-fetch", self.base + "/a b/é?q=x y")
        self.assertTrue(out.startswith("URL: %s/a%%20b/%%C3%%A9?q=x%%20y\n" % self.base))
        self.assertEqual(self.server.seen[0]["path"], "/a%20b/%C3%A9?q=x%20y")

    def test_timeout_values_are_kept_in_range(self):
        url = self.serve("/g", PAGE)
        for value in ("1", "999999"):
            self.ok("web-fetch", url, "--timeout", value)
        code, _out, _err = self.run_script("web-fetch", url, "--timeout", "soon")
        self.assertEqual(code, 2)
        code, _out, _err = self.run_script("web-fetch")
        self.assertEqual(code, 2)


def exa_text(*results):
    blocks = []
    for title, url, highlight in results:
        blocks.append("Title: %s\nURL: %s\nPublished: 2026-01-02\nAuthor: N/A\nHighlights:\n%s"
                      % (title, url, highlight))
    return "\n\n---\n\n".join(blocks)


def exa_event(text, **result):
    payload = {"jsonrpc": "2.0", "id": 1,
               "result": dict({"content": [{"type": "text", "text": text}]}, **result)}
    return "event: message\ndata: %s\n\n" % json.dumps(payload)


KEENABLE = json.dumps({"results": [
    {"title": "From Keenable", "url": "https://k.test/1", "snippet": "found here",
     "published_at": "2026-02-03", "author": "Ann"},
    {"title": "N/A", "url": "https://k.test/2", "description": "second"},
    {"title": "no url"}]})


PARALLEL = {"search_id": "search_1", "session_id": "session_1", "results": [
    {"url": "https://p.test/1", "title": "From Parallel", "publish_date": "2026-03-04",
     "excerpts": ["first part", "second part"]},
    {"url": "https://p.test/2", "title": None, "publish_date": None, "excerpts": []},
    {"title": "no url", "excerpts": ["x"]}]}


def parallel_answer(text, **result):
    return json.dumps({"jsonrpc": "2.0", "id": 1, "result": dict(
        {"content": [{"type": "text", "text": text}]}, **result)})


class SearchTest(Case):
    def exa(self, body, status=200, content_type="text/event-stream"):
        self.serve("/exa-mcp", body, content_type, status=status)

    def parallel(self, body=None, status=200):
        body = parallel_answer(json.dumps(PARALLEL)) if body is None else body
        self.serve("/parallel-mcp", body, "application/json", status=status)

    def keenable(self, body=KEENABLE, status=200):
        self.serve("/keenable-public", body, "application/json", status=status)

    def sent(self, path):
        return [request for request in self.server.seen if request["path"] == path]

    def test_results_are_printed_and_saved(self):
        self.exa(exa_event(exa_text(("First", "https://a.test/1", "alpha\nbeta"),
                                    ("N/A", "https://a.test/2", "gamma"))))
        out = self.ok("web-search", "rust async runtime")
        file = os.path.join(self.home, "wikis", "rust-async-runtime.md")
        self.assertEqual(out, (
            "Web Search: rust async runtime\nProvider: Exa, 2 results\nSaved: %s (1 page, "
            "171 characters)\n\n"
            "Title: First\nURL: https://a.test/1\nPublished: 2026-01-02\nHighlights:\nalpha\nbeta"
            "\n\n---\n\nTitle: https://a.test/2\nURL: https://a.test/2\nPublished: 2026-01-02\n"
            "Highlights:\ngamma\n") % file)
        meta, _text = self.page("rust-async-runtime.md")
        self.assertEqual((meta["source"], meta["query"], meta["provider"]),
                         ("web_search", "rust async runtime", "exa"))
        request = json.loads(self.sent("/exa-mcp")[0]["body"])
        self.assertEqual(request["params"], {"name": "web_search_exa", "arguments": {
            "query": "rust async runtime", "type": "auto", "numResults": 5,
            "livecrawl": "fallback"}})
        self.assertIn("- rust-async-runtime.md", self.ok("local", "--query", "async runtime"))

    def test_options_reach_the_provider_within_their_bounds(self):
        self.exa(exa_event(exa_text(("A", "https://a.test/1", "x"))))
        self.ok("web-search", "q", "--num-results", "99", "--type", "deep", "--livecrawl",
                "preferred", "--context-max-characters", "3000")
        sent = json.loads(self.sent("/exa-mcp")[0]["body"])["params"]["arguments"]
        self.assertEqual(sent, {"query": "q", "type": "deep", "numResults": 20,
                                "livecrawl": "preferred", "contextMaxCharacters": 3000})
        for arguments in (("q", "--context-max-characters", "0"), ("q", "--type", "slow"),
                          ("  ",), ("two", "words"), ()):
            code, _out, _err = self.run_script("web-search", *arguments)
            self.assertEqual(code, 2, arguments)

    def test_an_answer_as_plain_json_is_read_too(self):
        payload = {"jsonrpc": "2.0", "id": 1, "result": {"content": [
            {"type": "text", "text": exa_text(("J", "https://j.test/", "json"))}]}}
        self.exa(json.dumps(payload), content_type="application/json")
        self.assertIn("Title: J\nURL: https://j.test/", self.ok("web-search", "q"))

    def test_text_that_is_not_a_result_list_is_passed_on(self):
        self.exa(exa_event("Here is a summary without the usual shape."))
        out = self.ok("web-search", "q")
        self.assertIn("Provider: Exa, 0 results", out)
        self.assertTrue(out.endswith("\n\nHere is a summary without the usual shape.\n"))

    def test_nothing_found_is_not_saved(self):
        for body in ("", "data: [DONE]\n\n", exa_event(""), exa_event(k.NO_RESULTS)):
            self.exa(body)
            self.assertEqual(self.ok("web-search", "q"), k.NO_RESULTS + "\n")
        self.assertEqual(self.wiki(), [])

    def test_the_same_query_keeps_one_copy(self):
        self.exa(exa_event(exa_text(("Old", "https://a.test/old", "x"))))
        self.ok("web-search", "Same Query!")
        self.exa(exa_event(exa_text(("New", "https://a.test/new", "y"))))
        self.ok("web-search", "same query")
        self.assertEqual(self.wiki(), ["same-query.md"])
        self.assertIn("https://a.test/new", self.page("same-query.md")[1])
        self.assertNotIn("https://a.test/old", self.page("same-query.md")[1])

    def test_a_reached_limit_moves_to_the_other_provider(self):
        limits = (
            (exa_event("You've hit Exa's free MCP rate limit. Create your own key.",
                       _meta={"ai.exa/rateLimited": True}), 200),
            (exa_event("You've hit Exa's free MCP rate limit."), 200),
            (exa_event("Too many requests", isError=True), 200),
            ("data: %s\n\n" % json.dumps({"error": {"message": "Rate limit exceeded"}}), 200),
            ("slow down", 429),
            (json.dumps({"error": "Insufficient credits"}), 402),
        )
        self.keenable()
        for body, status in limits:
            self.exa(body, status=status)
            code, out, err = self.run_script("web-search", "q")
            self.assertEqual(code, 0, body)
            self.assertIn("note: Exa's limit is reached; trying Keenable.", err)
            self.assertIn("Provider: Keenable, 2 results", out)
        self.assertTrue(out.endswith(
            "Title: From Keenable\nURL: https://k.test/1\nPublished: 2026-02-03\nAuthor: Ann\n"
            "Highlights:\nfound here\n\n---\n\nTitle: https://k.test/2\nURL: https://k.test/2\n"
            "Highlights:\nsecond\n"))
        sent = self.sent("/keenable-public")[0]
        self.assertEqual(sent["headers"]["x-keenable-title"], "get-knowledge")
        self.assertEqual(json.loads(sent["body"]), {"query": "q", "max_results": 5})
        self.assertEqual(self.page("q.md")[0]["provider"], "keenable")

    def test_other_failures_do_not_move_to_the_other_provider(self):
        self.keenable()
        failures = (
            ("boom", 500, "HTTP 500"),
            (json.dumps({"error": "rate limit exceeded"}), 503, "HTTP 503"),
            (json.dumps({"error": "bad key"}), 401, "HTTP 401: Unauthorized (bad key)"),
            (json.dumps({"error": "Payment required: credits exhausted"}), 402, "HTTP 402"),
            ("{not json", 200, "Malformed search response body"),
            ("<html>gateway</html>", 200, "Malformed search response body"),
            (exa_event("The query is not rate limited, it is invalid", isError=True), 200,
             "Search request failed: The query is not rate limited"),
        )
        for body, status, message in failures:
            self.exa(body, status=status)
            code, out, err = self.run_script("web-search", "q")
            self.assertEqual((code, out), (1, ""), body)
            self.assertIn("failed: " + message, err)
        self.assertEqual(self.sent("/keenable-public"), [])
        self.assertEqual(self.wiki(), [])

    def test_both_providers_failing_is_reported_as_one(self):
        self.exa("", status=429)
        self.keenable(json.dumps({"error": "Missing app identifier"}), status=400)
        code, _out, err = self.run_script("web-search", "q")
        self.assertEqual(code, 1)
        self.assertIn("failed: Search failed with Exa (HTTP 429: Too Many Requests); the "
                      "Keenable fallback failed: HTTP 400: Bad Request (Missing app identifier)",
                      err)

    def test_keenable_first_falls_back_to_exa(self):
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            json.dump({"provider": "keenable", "defaultNumResults": 3,
                       "defaultSearchType": "fast"}, stream)
        self.keenable()
        self.assertIn("Provider: Keenable", self.ok("web-search", "q"))
        self.assertEqual(json.loads(self.sent("/keenable-public")[0]["body"])["max_results"], 3)
        self.keenable("", status=429)
        self.exa(exa_event(exa_text(("E", "https://e.test/", "x"))))
        code, out, err = self.run_script("web-search", "q", "--context-max-characters", "50")
        self.assertEqual(code, 0)
        self.assertIn("note: Keenable's limit is reached; trying Exa.", err)
        self.assertIn("Provider: Exa, 1 results", out)
        self.assertEqual(json.loads(self.sent("/keenable-public")[1]["body"]),
                         {"query": "q", "max_results": 3, "snippet_max_length": 180})
        self.assertEqual(json.loads(self.sent("/exa-mcp")[0]["body"])["params"]["arguments"]
                         ["type"], "fast")
        self.assertIn("Provider: Exa", self.ok("web-search", "q", "--provider", "exa"))

    def test_parallel_without_a_key(self):
        self.parallel()
        out = self.ok("web-search", "rust async runtime", "--provider", "parallel",
                      "--type", "deep", "--num-results", "9")
        self.assertIn("Provider: Parallel, 2 results", out)
        self.assertTrue(out.endswith(
            "Title: From Parallel\nURL: https://p.test/1\nPublished: 2026-03-04\nHighlights:\n"
            "first part\n\nsecond part\n\n---\n\nTitle: https://p.test/2\n"
            "URL: https://p.test/2\n"))
        sent = self.sent("/parallel-mcp")[0]
        self.assertEqual(json.loads(sent["body"])["params"], {"name": "web_search", "arguments": {
            "objective": "rust async runtime", "search_queries": ["rust async runtime"]}})
        self.assertNotIn("authorization", sent["headers"])
        self.assertNotIn("x-api-key", sent["headers"])
        self.assertEqual(self.page("rust-async-runtime.md")[0]["provider"], "parallel")
        self.assertEqual(self.sent("/exa-mcp"), [])

    def test_parallel_excerpts_are_passed_on_whole(self):
        long = {"results": [{"url": "https://p.test/%d" % number, "title": "T%d" % number,
                             "excerpts": ["word " * 1000]} for number in range(4)]}
        self.parallel(parallel_answer("ignored", structuredContent=long))
        out = self.ok("web-search", "q", "--provider", "parallel", "--num-results", "2",
                      "--context-max-characters", "1000")
        self.assertIn("Provider: Parallel, 2 results", out)
        self.assertEqual(self.page("q.md")[1].count("word"), 2 * 1000)

    def test_a_long_query_is_cut_for_parallel_between_words(self):
        query = " ".join(["keyword"] * 40)
        self.assertEqual(k.parallel_query(query), " ".join(["keyword"] * 25))
        self.assertEqual(k.parallel_query("x" * 300), "x" * 200)
        self.assertEqual(k.parallel_query("  two   words "), "two words")
        self.parallel()
        self.ok("web-search", query, "--provider", "parallel")
        sent = json.loads(self.sent("/parallel-mcp")[0]["body"])["params"]["arguments"]
        self.assertEqual(sent["objective"], query)
        self.assertEqual(sent["search_queries"], [" ".join(["keyword"] * 25)])

    def test_parallel_with_a_key(self):
        os.environ["PARALLEL_API_KEY"] = "par-secret-789"
        self.serve("/parallel", json.dumps(PARALLEL), "application/json")
        out = self.ok("web-search", "q", "--provider", "parallel")
        self.assertIn("Provider: Parallel, 2 results", out)
        self.assertIn("Title: From Parallel\nURL: https://p.test/1\nPublished: 2026-03-04", out)
        sent = self.sent("/parallel")[0]
        self.assertEqual(sent["headers"]["x-api-key"], "par-secret-789")
        asked = {"objective": "q", "search_queries": ["q"], "mode": "advanced"}
        self.assertEqual(json.loads(sent["body"]), asked)
        out = self.ok("web-search", "q", "--provider", "parallel", "--type", "fast",
                      "--livecrawl", "preferred", "--num-results", "1",
                      "--context-max-characters", "4000")
        self.assertEqual(json.loads(self.sent("/parallel")[1]["body"]), asked)
        self.assertIn("Provider: Parallel, 1 results", out)
        self.assertEqual(self.sent("/parallel-mcp"), [])

        error = {"type": "error", "error": {"ref_id": "r", "message": "bad key par-secret-789"}}
        self.serve("/parallel", json.dumps(error), "application/json", status=401)
        code, out, err = self.run_script("web-search", "q", "--provider", "parallel")
        self.assertEqual(code, 1)
        self.assertIn("failed: HTTP 401: Unauthorized (bad key [REDACTED])", err)
        self.assertNotIn("par-secret-789", out + err)
        config = self.ok("config")
        self.assertIn("Parallel API key: set, from the environment variable PARALLEL_API_KEY",
                      config)
        self.assertNotIn("secret", config)

    def test_each_reached_limit_moves_to_the_next_provider(self):
        self.exa("", status=429)
        self.keenable("", status=429)
        self.parallel()
        code, out, err = self.run_script("web-search", "q")
        self.assertEqual(code, 0)
        self.assertIn("note: Exa's limit is reached; trying Keenable.", err)
        self.assertIn("note: Keenable's limit is reached; trying Parallel.", err)
        self.assertIn("Provider: Parallel, 2 results", out)

        for body, status in (("", 429), (parallel_answer("Rate limit exceeded", isError=True),
                                         200),
                             (parallel_answer("You have hit the rate limit. Try later."), 200)):
            self.parallel(body, status=status)
            code, out, err = self.run_script("web-search", "q")
            self.assertEqual((code, out), (1, ""), body)
            self.assertIn("failed: Search failed with Exa (HTTP 429: Too Many Requests); the "
                          "Keenable fallback failed: HTTP 429: Too Many Requests; the Parallel "
                          "fallback failed: ", err)
        self.assertEqual(self.wiki(), ["q.md"])

    def test_parallel_first_falls_back_to_the_others_in_order(self):
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            json.dump({"provider": "parallel"}, stream)
        self.parallel("", status=429)
        self.exa(exa_event(exa_text(("E", "https://e.test/", "x"))))
        code, out, err = self.run_script("web-search", "q")
        self.assertEqual(code, 0)
        self.assertIn("note: Parallel's limit is reached; trying Exa.", err)
        self.assertIn("Provider: Exa, 1 results", out)
        self.assertEqual(self.sent("/keenable-public"), [])

    def test_a_parallel_failure_that_is_no_limit_ends_the_search(self):
        self.exa(exa_event(exa_text(("E", "https://e.test/", "x"))))
        failures = (
            (parallel_answer("Invalid search_queries", isError=True), 200,
             "Search request failed: Invalid search_queries"),
            (parallel_answer("not what was expected"), 200,
             "Search request failed: not what was expected"),
            (json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"message": "Unknown tool"}}), 200,
             "Search request failed: Unknown tool"),
            ("{not json", 200, "Malformed search response body"),
            ("boom", 500, "HTTP 500"),
        )
        for body, status, message in failures:
            self.parallel(body, status=status)
            code, out, err = self.run_script("web-search", "q", "--provider", "parallel")
            self.assertEqual((code, out), (1, ""), body)
            self.assertIn("failed: " + message, err)
        self.assertEqual(self.sent("/exa-mcp"), [])
        self.parallel(parallel_answer(json.dumps({"results": []})))
        self.assertEqual(self.ok("web-search", "q", "--provider", "parallel"),
                         k.NO_RESULTS + "\n")

    def test_keys_select_the_keyed_services_and_never_show(self):
        os.environ["EXA_API_KEY"] = "exa-secret-123"
        os.environ["KEENABLE_API_KEY"] = "keen secret/456"
        rest = {"results": [{"title": "R", "url": "https://r.test/", "publishedDate": "2026",
                             "highlights": ["one", "two"], "author": ""},
                            {"title": "S", "url": "https://s.test/", "summary": "sum"}]}
        self.serve("/exa-rest", json.dumps(rest), "application/json")
        out = self.ok("web-search", "q", "--livecrawl", "preferred",
                      "--context-max-characters", "900")
        self.assertIn("Title: R\nURL: https://r.test/\nPublished: 2026\nHighlights:\none\n\ntwo",
                      out)
        self.assertIn("Title: S\nURL: https://s.test/\nHighlights:\nsum", out)
        sent = self.sent("/exa-rest")[0]
        self.assertEqual(sent["headers"]["authorization"], "Bearer exa-secret-123")
        self.assertEqual(json.loads(sent["body"]), {
            "query": "q", "type": "auto", "numResults": 5, "stream": False,
            "contents": {"highlights": {"query": "q", "maxCharacters": 900}, "maxAgeHours": 0}})
        self.assertEqual(self.sent("/exa-mcp"), [])

        self.serve("/exa-rest", json.dumps({"error": "rate limit for key exa-secret-123"}),
                   "application/json", status=429)
        self.serve("/keenable", json.dumps(
            {"error": "bad key keen secret/456 or keen%20secret%2F456"}), "application/json",
            status=401)
        code, out, err = self.run_script("web-search", "q")
        self.assertEqual(code, 1)
        self.assertEqual(self.sent("/keenable")[0]["headers"]["x-api-key"], "keen secret/456")
        self.assertNotIn("x-keenable-title", self.sent("/keenable")[0]["headers"])
        self.assertIn("bad key [REDACTED] or [REDACTED]", err)
        for secret in ("exa-secret-123", "keen secret/456", "keen%20secret%2F456"):
            self.assertNotIn(secret, out + err)
        config = self.ok("config")
        self.assertIn("Exa API key: set, from the environment variable EXA_API_KEY", config)
        self.assertNotIn("secret", config)

    def test_a_key_in_the_settings_file_is_used_and_the_environment_wins(self):
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            json.dump({"exaApiKey": "from-file"}, stream)
        self.serve("/exa-rest", json.dumps({"results": []}), "application/json")
        self.assertEqual(self.ok("web-search", "q"), k.NO_RESULTS + "\n")
        self.assertEqual(self.sent("/exa-rest")[0]["headers"]["authorization"],
                         "Bearer from-file")
        self.assertIn("Exa API key: set, from the settings.json", self.ok("config"))
        os.environ["EXA_API_KEY"] = "from-env"
        self.ok("web-search", "q")
        self.assertEqual(self.sent("/exa-rest")[1]["headers"]["authorization"],
                         "Bearer from-env")

    def test_settings_that_are_wrong_are_named_and_not_used(self):
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            json.dump({"provider": "google", "defaultNumResults": 500, "pageChars": 10,
                       "searchTimeoutMs": True, "exaApiKey": 5, "colour": "red",
                       "defaultLivecrawl": "preferred"}, stream)
        self.exa(exa_event(exa_text(("A", "https://a.test/1", "x"))))
        code, out, err = self.run_script("web-search", "q")
        self.assertEqual(code, 0)
        self.assertIn("Provider: Exa", out)
        for text in ('provider = "google" is not allowed', "defaultNumResults = 500",
                     "pageChars = 10", "searchTimeoutMs = true", "exaApiKey = (hidden)",
                     "unknown setting 'colour'"):
            self.assertIn(text, err)
        sent = json.loads(self.sent("/exa-mcp")[0]["body"])["params"]["arguments"]
        self.assertEqual((sent["numResults"], sent["livecrawl"]), (5, "preferred"))
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            stream.write("[1, 2]")
        self.assertIn("must hold one JSON object", self.ok("config"))

    def test_long_results_are_paged(self):
        with open(os.path.join(self.home, "settings.json"), "w") as stream:
            json.dump({"pageChars": 2000}, stream)
        results = [("T%d" % n, "https://a.test/%d" % n, "text " * 150) for n in range(8)]
        self.exa(exa_event(exa_text(*results)))
        out = self.ok("web-search", "q", "--num-results", "8")
        self.assertIn("q.md (page 1 of ", out)
        self.assertIn("The text continues in " + os.path.join(self.home, "wikis", "q.part-002.md"),
                      out)

    def test_what_counts_as_a_limit(self):
        yes = ((429, "", ""), (None, "Rate limit exceeded", ""), (None, "too many requests", ""),
               (None, "", "RATE_LIMITED"), (None, "Monthly limit reached", ""),
               (None, "You are out of credits", ""), (402, "credits exhausted", ""),
               (None, "requests are being throttled", ""), (None, "quota exceeded", ""))
        no = ((500, "rate limit exceeded", ""), (401, "rate limit", ""), (400, "quota", ""),
              (402, "rate limit exceeded", ""), (402, "Payment required", ""),
              (None, "payment_required: no credits", ""), (None, "not rate limited", ""),
              (None, "no credits required", ""), (None, "invalid query", ""), (None, "", ""))
        for case in yes:
            self.assertTrue(k.is_limit(*case), case)
        for case in no:
            self.assertFalse(k.is_limit(*case), case)


class ConfigTest(Case):
    def test_config_shows_places_and_defaults(self):
        out = self.ok("config")
        self.assertIn("Home: %s (change it with the environment variable GET_KNOWLEDGE_HOME)"
                      % self.home, out)
        self.assertIn("Wiki: %s (0 topics, 0 pages)" % os.path.join(self.home, "wikis"), out)
        self.assertIn("settings.json (not there)", out)
        self.assertIn('  provider: "exa"\n', out)
        self.assertIn("  pageChars: 24000\n", out)
        self.assertIn("Keenable API key: not set; the keyless service is used", out)

    def test_the_home_can_be_given_with_a_tilde(self):
        os.environ[k.HOME_ENV] = "~/somewhere-else"
        self.assertEqual(k.home(), os.path.join(os.path.expanduser("~"), "somewhere-else"))
        os.environ[k.HOME_ENV] = "  "
        self.assertEqual(k.home(), os.path.join(os.path.expanduser("~"), ".get-knowledge"))

    def test_the_script_runs_as_a_program(self):
        done = subprocess.run([sys.executable, SCRIPT, "local"], capture_output=True, text=True,
                              env=dict(os.environ))
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        self.assertIn("--wikis--", done.stdout)
        done = subprocess.run([sys.executable, SCRIPT, "--help"], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0)
        self.assertIn("ref-refresh", done.stdout)


if __name__ == "__main__":
    unittest.main()
