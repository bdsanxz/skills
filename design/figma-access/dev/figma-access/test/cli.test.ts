import { decode } from "../src/kdl";
// End-to-end test of the figma-access CLI against a fake Desktop Bridge plugin.
// Run in dev/figma-access: bun run build && bun test
// Uses its own FIGMA_ACCESS_HOME so it never touches a real daemon's state.

import { setDefaultTimeout, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Tests run the built output, so build first: bun run build && bun test
const CLI = resolve(import.meta.dir, "../../../scripts/figma-access.js");
const HOME = mkdtempSync(join(tmpdir(), "figma-access-test-"));
// Ports outside 9223-9232 so a real Desktop Bridge plugin never joins the test daemon.
const env = { ...process.env, FIGMA_ACCESS_HOME: HOME, FIGMA_ACCESS_PORT_START: "19223", FIGMA_ACCESS_PORT_END: "19232" };
let plugin: WebSocket | undefined;
setDefaultTimeout(30000);

// Async on purpose: the fake plugin lives in this process and must keep answering.
async function run(args: string[], stdin?: string) {
  const p = Bun.spawn(["bun", CLI, ...args], { env, cwd: HOME, stdin: stdin ? Buffer.from(stdin) : "ignore", stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  await p.exited;
  let json: any = null;
  try {
    json = decode(text);
  } catch {}
  return { code: p.exitCode, text, json };
}

// A fake plugin: speaks the same protocol as figma-desktop-bridge/ui.html.
async function startFakePlugin(port: number, fileInfo: { fileName: string; fileKey: string }) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((r, j) => {
    ws.onopen = () => r();
    ws.onerror = j;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "SERVER_HELLO") return;
    const reply = (result: unknown) => ws.send(JSON.stringify({ id: msg.id, result }));
    switch (msg.method) {
      case "EXECUTE_CODE":
        if (msg.params.code.includes("throw")) return reply({ success: false, error: "Error: boom" });
        if (msg.params.code.includes("hang")) return; // never answers
        if (msg.params.code.includes("selection"))
          return reply({ success: true, result: { page: { id: "0:1", name: "Page 1" }, count: 1, nodes: [{ id: "1:2", name: "Box", type: "FRAME" }] } });
        ws.send(JSON.stringify({ type: "CONSOLE_CAPTURE", data: { level: "log", message: "ran " + msg.params.code.length, timestamp: Date.now() } }));
        return reply({ success: true, result: { echo: msg.params.code, timeout: msg.params.timeout }, resultAnalysis: { warning: null }, fileContext: { fileName: fileInfo.fileName, fileKey: fileInfo.fileKey } });
      case "CAPTURE_SCREENSHOT":
        return reply({ success: true, image: { base64: Buffer.from("PNGDATA").toString("base64"), format: "PNG", scale: 1, byteLength: 7, node: { id: msg.params.nodeId || "0:1", name: "Box", type: "FRAME" }, bounds: { x: 0, y: 0, width: 10, height: 10 } } });
      case "MOVE_NODE":
        return reply({ success: true, data: msg.params });
      default:
        ws.send(JSON.stringify({ id: msg.id, error: "Unknown method: " + msg.method }));
    }
  };
  ws.send(JSON.stringify({ type: "FILE_INFO", data: { ...fileInfo, pluginVersion: "1.41.5", editorType: "figma", currentPage: "Page 1", currentPageId: "0:1" } }));
  await Bun.sleep(100);
  return ws;
}

beforeAll(async () => {
  const r = await run(["daemon", "start"]);
  expect(r.code).toBe(0);
  const health = (await (await fetch(`http://localhost:${r.json.port}/health`)).json()) as { status: string; version: unknown };
  expect(health.status).toBe("ok");
  expect(typeof health.version).toBe("string");
  plugin = await startFakePlugin(r.json.port, { fileName: "Design System", fileKey: "KEY1" });
});

afterAll(async () => {
  plugin?.close();
  await run(["daemon", "stop"]);
  rmSync(HOME, { recursive: true, force: true });
});

test("status lists the connected file", async () => {
  const r = await run(["status"]);
  expect(r.code).toBe(0);
  expect(r.json.files[0].fileName).toBe("Design System");
});

test("exec from argument, file and stdin", async () => {
  let r = await run(["exec", "return 1"]);
  expect(r.code).toBe(0);
  expect(r.json.result.echo).toBe("return 1");
  expect(r.json.result.timeout).toBe(5000);
  r = await run(["exec", "-", "--timeout", "30s"], "return 2");
  expect(r.json.result.echo).toBe("return 2");
  expect(r.json.result.timeout).toBe(30000);
  writeFileSync(join(HOME, "code.js"), "return 3");
  r = await run(["exec", "-f", join(HOME, "code.js")]);
  expect(r.json.result.echo).toBe("return 3");
});

test("exec failure exits 1 with the error", async () => {
  const r = await run(["exec", "throw new Error('x')"]);
  expect(r.code).toBe(1);
  expect(r.json.error).toContain("boom");
});

test("exec timeout is reported", async () => {
  const r = await run(["exec", "hang", "--timeout", "100"]);
  expect(r.code).toBe(1);
  expect(r.json.timedOut).toBe(true);
});

test("screenshot writes a file", async () => {
  const r = await run(["screenshot", "1:2", "-o", "shot"]);
  expect(r.code).toBe(0);
  expect(r.json.path.endsWith("shot.png")).toBe(true);
  expect(readFileSync(r.json.path, "utf8")).toBe("PNGDATA");
});

test("selection, logs and call", async () => {
  expect((await run(["selection"])).json.nodes[0].id).toBe("1:2");
  const logs = await run(["logs", "--since", "1m"]);
  expect(logs.json.entries.length).toBeGreaterThan(0);
  const call = await run(["call", "MOVE_NODE", '{"nodeId":"1:2","x":5,"y":6}']);
  expect(call.json.result.data.x).toBe(5);
});

test("unknown file and bad usage", async () => {
  expect((await run(["exec", "return 1", "--file", "nope"])).code).toBe(3);
  expect((await run(["call", "NOT_A_METHOD"])).code).toBe(2);
  expect((await run(["exec", "--bogus"])).code).toBe(2);
});

test("cli endpoint needs the token, websocket rejects web origins", async () => {
  const state = JSON.parse(readFileSync(join(HOME, "daemon.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:${state.port}/cli`, { method: "POST", body: '{"op":"status"}' });
  expect(res.status).toBe(403);
  const ws = new WebSocket(`ws://127.0.0.1:${state.port}`, { headers: { Origin: "https://evil.example" } });
  const closed = await new Promise<string>((r) => {
    ws.onopen = () => r("open");
    ws.onerror = () => r("error");
  });
  expect(closed).toBe("error");
});

test("setup copies the plugin", async () => {
  const r = await run(["setup"]);
  expect(r.code).toBe(0);
  expect(existsSync(join(HOME, "plugin", "manifest.json"))).toBe(true);
});

test.skipIf(!Bun.which("node"))("under Node it stops with exit 2 and points to bun", async () => {
  const p = Bun.spawn(["node", CLI, "status"], { env, cwd: HOME, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  await p.exited;
  expect(p.exitCode).toBe(2);
  const out = decode(text);
  expect(out.ok).toBe(false);
  expect(out.error).toContain("runs on Bun, not Node");
});
