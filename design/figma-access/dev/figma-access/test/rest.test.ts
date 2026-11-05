import { expect, test } from "bun:test";
import { parseTarget } from "../src/rest";

test("parseTarget reads file key and node id from URLs", () => {
  expect(parseTarget("https://www.figma.com/design/71zrdeZw3uMPOiMhkicp5a/Untitled?node-id=0-1")).toEqual({ fileKey: "71zrdeZw3uMPOiMhkicp5a", nodeId: "0:1" });
  expect(parseTarget("https://www.figma.com/file/ABCDEFGHIJKL/Name")).toEqual({ fileKey: "ABCDEFGHIJKL", nodeId: undefined });
  expect(parseTarget("https://www.figma.com/design/ABCDEFGHIJKL/branch/BRANCHKEY123/Name?node-id=1-2")).toEqual({ fileKey: "BRANCHKEY123", nodeId: "1:2" });
  expect(parseTarget("71zrdeZw3uMPOiMhkicp5a")).toEqual({ fileKey: "71zrdeZw3uMPOiMhkicp5a" });
});
