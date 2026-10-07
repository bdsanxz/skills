import unittest

import numpy as np

import toon


class ToonEncodeTest(unittest.TestCase):
    def test_nested_object(self):
        self.assertEqual(toon.encode({"a": 1, "b": {"c": "x", "d": True}}), "a: 1\nb:\n  c: x\n  d: true")

    def test_primitive_array_is_inline(self):
        self.assertEqual(toon.encode({"gaps": [8, 8, 16]}), "gaps[3]: 8,8,16")

    def test_empty_array(self):
        self.assertEqual(toon.encode({"edges": []}), "edges[0]:")

    def test_uniform_objects_become_a_table(self):
        data = {"spans": [{"start": 0, "size": 10}, {"start": 20, "size": 10}]}
        self.assertEqual(toon.encode(data), "spans[2]{start,size}:\n  0,10\n  20,10")

    def test_mixed_objects_become_a_list(self):
        data = {"items": [{"a": 1}, {"a": 2, "b": {"c": 3}}]}
        self.assertEqual(toon.encode(data), "items[2]:\n  - a: 1\n  - a: 2\n    b:\n      c: 3")

    def test_strings_are_quoted_only_when_needed(self):
        self.assertEqual(toon.encode({"hex": "#1a2b3c"}), "hex: #1a2b3c")
        self.assertEqual(toon.encode({"v": "a, b"}), 'v: "a, b"')
        self.assertEqual(toon.encode({"v": "42"}), 'v: "42"')
        self.assertEqual(toon.encode({"v": "true"}), 'v: "true"')
        self.assertEqual(toon.encode({"v": ""}), 'v: ""')
        self.assertEqual(toon.encode({"v": 'say "hi"'}), 'v: "say \\"hi\\""')

    def test_numbers(self):
        self.assertEqual(toon.encode({"a": 2.0, "b": 0.5, "c": None, "d": -0.0}), "a: 2\nb: 0.5\nc: null\nd: 0")

    def test_numpy_values(self):
        data = {"n": np.int64(3), "f": np.float64(1.5), "ok": np.bool_(True), "xs": np.array([1, 2])}
        self.assertEqual(toon.encode(data), "n: 3\nf: 1.5\nok: true\nxs[2]: 1,2")

    def test_keys_with_special_characters_are_quoted(self):
        self.assertEqual(toon.encode({"a b": 1}), '"a b": 1')


if __name__ == "__main__":
    unittest.main()
