# dfont development

- `fixture/` is a small font project (Fixture Sans, three masters) that exercises the
  parts of `scripts/dfont` a starter project does not: refs with flips, dots, cut and
  round caps, flat joins, automatic composites with `.case` marks, dotless i under
  marks, tabular figures and per-master kerning. It must build with no errors or
  warnings.
- `tests/` runs against a temporary copy of the fixture.

Run the tests with the Python of the dfont environment:

```bash
python3 ../../scripts/run.py setup
```

then, with the printed environment path:

```bash
<environment>/bin/python -m unittest discover -s tests -v
```
