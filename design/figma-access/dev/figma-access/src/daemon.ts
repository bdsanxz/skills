// The daemon: listens on the first free port in the range the Desktop Bridge plugin scans,
// answers its /health probe, keeps one WebSocket per open plugin (one per Figma file),
// and relays CLI requests that arrive on the token-protected POST /cli endpoint.

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import { CHANGE_BUFFER, EXIT_UNAVAILABLE, HOME, LOG_BUFFER, LOG_FILE, PORT_END, PORT_START, STATE_FILE, VERSION } from "./config";
import { defaultTimeout } from "./methods";
import { readState } from "./util";

type Ws = ServerWebSocket<undefined>;

interface LogEntry {
  level: string;
  message: string;
  args?: unknown;
  timestamp: number;
}

interface ChangeEntry {
  kind: "document" | "metadata";
  timestamp: number;
  [key: string]: unknown;
}

interface Client {
  ws: Ws;
  identified: boolean;
  fileKey: string | null;
  fileName: string | null;
  editorType: string | null;
  currentPage: string | null;
  currentPageId: string | null;
  pluginVersion: string | null;
  selection: unknown;
  connectedAt: number;
  lastActivity: number;
  logs: LogEntry[];
  changes: ChangeEntry[];
}

export interface RpcReply {
  ok: boolean;
  result?: any;
  error?: string;
  timedOut?: boolean;
}

interface Pending {
  resolve: (r: RpcReply) => void;
  timer: ReturnType<typeof setTimeout>;
  ws: Ws;
}

type Target = { client: Client } | { error: "no-files" | "no-match" | "ambiguous"; files?: unknown[] };

async function portAnswers(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "[::1]"]) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(400) });
      await res.text();
      return true;
    } catch {
      // nothing listening there
    }
  }
  return false;
}

export async function runDaemon(): Promise<void> {
  mkdirSync(HOME, { recursive: true });
  const token = randomBytes(24).toString("hex");
  const startedAt = Date.now();
  const clients = new Map<Ws, Client>();
  const pending = new Map<string, Pending>();
  let activeWs: Ws | null = null;
  let nextId = 1;
  let server: Server<undefined> | null = null;

  const log = (text: string) => process.stdout.write(`[${new Date().toISOString()}] ${text}\n`);
  const identified = () => [...clients.values()].filter((c) => c.identified);

  function describe(c: Client) {
    return {
      fileKey: c.fileKey,
      fileName: c.fileName,
      editorType: c.editorType,
      currentPage: c.currentPage,
      currentPageId: c.currentPageId,
      pluginVersion: c.pluginVersion,
      connectedAt: new Date(c.connectedAt).toISOString(),
      lastActivity: new Date(c.lastActivity).toISOString(),
      active: c.ws === activeWs,
      selection: c.selection,
      bufferedLogs: c.logs.length,
      bufferedChanges: c.changes.length,
    };
  }

  const newest = (list: Client[]) => [...list].sort((a, b) => b.lastActivity - a.lastActivity)[0]!;

  function resolveTarget(file: unknown): Target {
    const list = identified();
    if (list.length === 0) return { error: "no-files" };
    if (file) {
      const needle = String(file).toLowerCase();
      const exact = list.filter((c) => (c.fileKey ?? "").toLowerCase() === needle || (c.fileName ?? "").toLowerCase() === needle);
      const matches = exact.length ? exact : list.filter((c) => (c.fileName ?? "").toLowerCase().includes(needle));
      if (matches.length === 0) return { error: "no-match", files: list.map(describe) };
      // The same file open in two plugin windows counts as one match.
      const distinct = new Set(matches.map((c) => `${c.fileKey}|${c.fileName}`));
      if (distinct.size > 1) return { error: "ambiguous", files: matches.map(describe) };
      return { client: newest(matches) };
    }
    const active = activeWs ? clients.get(activeWs) : undefined;
    if (active?.identified) return { client: active };
    return { client: newest(list) };
  }

  function sendRpc(client: Client, method: string, params: unknown, timeoutMs: number): Promise<RpcReply> {
    return new Promise((resolve) => {
      const id = `fc_${nextId++}_${Date.now()}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          ok: false,
          timedOut: true,
          error:
            `${method} got no answer within ${timeoutMs} ms. Figma cannot stop a running plugin script, so it may still be running; ` +
            "check `figma-access logs` before you retry, and retry with a larger --timeout for long work.",
        });
      }, timeoutMs);
      pending.set(id, { resolve, timer, ws: client.ws });
      try {
        client.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ ok: false, error: `Could not send to the plugin: ${(e as Error).message}` });
      }
    });
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  async function handleCli(req: Request): Promise<Response> {
    // The token in the state file (mode 600) keeps web pages and other users out.
    if (req.headers.get("x-figma-access-token") !== token) return json(403, { ok: false, error: "Bad token." });
    let body: Record<string, any>;
    try {
      body = (await req.json()) as Record<string, any>;
    } catch {
      return json(400, { ok: false, error: "Body must be JSON." });
    }

    switch (body.op) {
      case "status":
        return json(200, {
          ok: true,
          daemon: { pid: process.pid, port: server?.port, version: VERSION, startedAt: new Date(startedAt).toISOString(), logFile: LOG_FILE },
          files: identified().map(describe),
          pendingPluginConnections: [...clients.values()].filter((c) => !c.identified).length,
        });
      case "stop":
        setTimeout(() => shutdown("stop requested"), 50);
        return json(200, { ok: true, stopped: true });
      case "wait": {
        const deadline = Date.now() + Math.max(0, Number(body.waitMs) || 0);
        while (identified().length === 0 && Date.now() < deadline) await Bun.sleep(250);
        return json(200, { ok: true, files: identified().map(describe) });
      }
    }

    const target = resolveTarget(body.file);
    if ("error" in target) {
      const messages = {
        "no-files": "No Figma file is connected.",
        "no-match": `No connected file matches "${body.file}".`,
        ambiguous: `More than one connected file matches "${body.file}"; pass the fileKey.`,
      };
      return json(200, { ok: false, code: target.error, error: messages[target.error], files: target.files });
    }
    const client = target.client;
    const fileRef = { fileKey: client.fileKey, fileName: client.fileName, currentPage: client.currentPage };

    switch (body.op) {
      case "rpc": {
        const method = String(body.method ?? "");
        if (!method) return json(400, { ok: false, error: "Missing method." });
        const timeoutMs = Number(body.timeoutMs) || defaultTimeout(method);
        const reply = await sendRpc(client, method, body.params, timeoutMs);
        client.lastActivity = Date.now();
        return json(200, { ...reply, file: fileRef });
      }
      case "logs": {
        const since = Number(body.since) || 0;
        const levels = body.level ? String(body.level).split(",") : null;
        const all = client.logs.filter((e) => e.timestamp >= since && (!levels || levels.includes(e.level)));
        const entries = all.slice(-(Number(body.limit) || 100));
        if (body.clear) client.logs = [];
        return json(200, { ok: true, file: fileRef, total: all.length, returned: entries.length, entries });
      }
      case "changes": {
        const since = Number(body.since) || 0;
        const entries = client.changes.filter((e) => e.timestamp >= since);
        if (body.clear) client.changes = [];
        return json(200, { ok: true, file: fileRef, entries });
      }
      default:
        return json(400, { ok: false, error: `Unknown op "${body.op}".` });
    }
  }

  function onMessage(ws: Ws, raw: string | Buffer) {
    let msg: any;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      return;
    }
    const c = clients.get(ws);
    if (!c) return;

    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.resolve({ ok: false, error: String(msg.error) });
      } else {
        const r = msg.result;
        const failed = r && typeof r === "object" && r.success === false;
        p.resolve(failed ? { ok: false, result: r, error: r.error || "The plugin reported a failure." } : { ok: true, result: r });
      }
      return;
    }
    if (msg.id && !msg.type) {
      log(`late answer for ${msg.id} discarded (its request had timed out)`);
      return;
    }

    const data = msg.data;
    switch (msg.type) {
      case "FILE_INFO":
        if (!data) return;
        c.identified = true;
        c.fileKey = data.fileKey ?? null;
        c.fileName = data.fileName ?? null;
        c.currentPage = data.currentPage ?? null;
        c.currentPageId = data.currentPageId ?? null;
        c.editorType = data.editorType ?? null;
        c.pluginVersion = data.pluginVersion ?? null;
        c.lastActivity = Date.now();
        if (!activeWs || !clients.get(activeWs)?.identified) activeWs = ws;
        log(`file identified: ${c.fileName} (${c.fileKey}) plugin v${c.pluginVersion}`);
        break;
      case "SELECTION_CHANGE":
        c.selection = data ?? null;
        c.lastActivity = Date.now();
        activeWs = ws;
        break;
      case "PAGE_CHANGE":
        if (data) {
          c.currentPage = data.pageName ?? null;
          c.currentPageId = data.pageId ?? null;
        }
        c.lastActivity = Date.now();
        activeWs = ws;
        break;
      case "CONSOLE_CAPTURE":
        if (data) {
          c.logs.push({ level: data.level || "log", message: data.message || "", args: data.args, timestamp: data.timestamp || Date.now() });
          if (c.logs.length > LOG_BUFFER) c.logs.splice(0, c.logs.length - LOG_BUFFER);
        }
        break;
      case "DOCUMENT_CHANGE":
      case "METADATA_CHANGE":
        if (data) {
          c.changes.push({ ...data, kind: msg.type === "DOCUMENT_CHANGE" ? "document" : "metadata", timestamp: data.timestamp || Date.now() });
          if (c.changes.length > CHANGE_BUFFER) c.changes.splice(0, c.changes.length - CHANGE_BUFFER);
        }
        break;
      default:
        break; // VARIABLES_DATA and other pushes are not needed
    }
  }

  function onClose(ws: Ws) {
    const c = clients.get(ws);
    clients.delete(ws);
    if (activeWs === ws) activeWs = null;
    for (const [id, p] of pending) {
      if (p.ws !== ws) continue;
      clearTimeout(p.timer);
      pending.delete(id);
      p.resolve({ ok: false, error: "The plugin disconnected before it answered (plugin closed, file closed or plugin reloaded)." });
    }
    log(`plugin disconnected${c?.fileName ? `: ${c.fileName}` : ""}`);
  }

  for (let port = PORT_START; port <= PORT_END && !server; port++) {
    // Skip ports another bridge server (for example figma-console-mcp) already answers on,
    // including one bound to the other loopback address.
    if (await portAnswers(port)) continue;
    try {
      server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        async fetch(req, srv) {
          if (req.method === "OPTIONS") {
            return new Response(null, {
              status: 204,
              headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
            });
          }
          if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            // Only the plugin UI (sandboxed iframe, origin "null"), Figma itself, or a local process may connect.
            const origin = req.headers.get("origin");
            const allowed = !origin || origin === "null" || origin === "https://www.figma.com" || origin === "https://figma.com";
            if (!allowed) return new Response("Unauthorized Origin", { status: 403 });
            if (srv.upgrade(req)) return undefined;
            return new Response("Upgrade failed", { status: 400 });
          }
          const path = new URL(req.url).pathname;
          if (path === "/cli" && req.method === "POST") return handleCli(req);
          if (path === "/health" || path === "/") {
            // The plugin dials only ports whose /health has this shape (status, version, clients).
            return json(200, {
              status: "ok",
              version: VERSION,
              server: "figma-access",
              clients: clients.size,
              connectedClients: identified().length,
              uptime: Math.floor((Date.now() - startedAt) / 1000),
            });
          }
          return new Response("Not Found", { status: 404 });
        },
        websocket: {
          maxPayloadLength: 256 * 1024 * 1024,
          idleTimeout: 120,
          sendPings: true,
          open(ws) {
            const now = Date.now();
            clients.set(ws, {
              ws,
              identified: false,
              fileKey: null,
              fileName: null,
              editorType: null,
              currentPage: null,
              currentPageId: null,
              pluginVersion: null,
              selection: null,
              connectedAt: now,
              lastActivity: now,
              logs: [],
              changes: [],
            });
            ws.send(JSON.stringify({ type: "SERVER_HELLO", data: { port: server?.port, pid: process.pid, serverVersion: VERSION, startedAt } }));
            log("plugin connected, waiting for FILE_INFO");
          },
          message: onMessage,
          close: onClose,
        },
      });
    } catch (e) {
      const text = `${(e as any)?.code ?? ""} ${(e as Error)?.message ?? e}`;
      if (!/EADDRINUSE|in use|address already/i.test(text)) throw e;
    }
  }

  if (!server) {
    log(`no free port in ${PORT_START}-${PORT_END}`);
    process.exit(EXIT_UNAVAILABLE);
  }
  const live = server;

  writeFileSync(STATE_FILE, JSON.stringify({ pid: process.pid, port: live.port, token, version: VERSION, startedAt }, null, 2));
  try {
    chmodSync(STATE_FILE, 0o600);
  } catch {
    // best effort on file systems without modes
  }
  log(`figma-access daemon v${VERSION} listening on 127.0.0.1:${live.port} (pid ${process.pid})`);

  function shutdown(reason: string) {
    log(`shutting down: ${reason}`);
    if (readState()?.pid === process.pid) rmSync(STATE_FILE, { force: true });
    live.stop(true);
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
