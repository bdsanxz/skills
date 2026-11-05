import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { BUNDLED_PLUGIN_DIR, EXIT_FAILED, EXIT_UNAVAILABLE, EXIT_USAGE, LOG_BUFFER, LOG_FILE, PLUGIN_DIR, PLUGIN_FILES, STATE_FILE } from "./config";
import { callDaemon, connect, daemonReachable, finish, NOT_CONNECTED_HELP, rpc, startDaemon } from "./client";
import { showHelp } from "./help";
import { encodeItem } from "./kdl";
import { METHODS } from "./methods";
import { fail, out, parseArgs, parseDuration, parseSince, pidAlive, readState, readStdin, str, type ArgSpec } from "./util";

const COMMON: ArgSpec = { value: ["file", "wait"], bool: ["help"], alias: { h: "help" } };
const HELP_ONLY: ArgSpec = { bool: ["help"], alias: { h: "help" } };

function extend(extra: ArgSpec): ArgSpec {
  return {
    value: [...(COMMON.value ?? []), ...(extra.value ?? [])],
    bool: [...(COMMON.bool ?? []), ...(extra.bool ?? [])],
    alias: { ...COMMON.alias, ...extra.alias },
  };
}

function readDuration(value: string | boolean | undefined, flag: string): number {
  const d = parseDuration(str(value));
  if (d == null || d <= 0) fail(EXIT_USAGE, `--${flag} takes a duration such as 30s or 30000.`);
  return d;
}

export async function setup(argv: string[]) {
  const { flags } = parseArgs(argv, HELP_ONLY);
  if (flags.help) showHelp("setup");
  for (const f of PLUGIN_FILES) {
    if (!existsSync(join(BUNDLED_PLUGIN_DIR, f))) fail(EXIT_UNAVAILABLE, `Bundled plugin file missing: ${join(BUNDLED_PLUGIN_DIR, f)}. Reinstall the skill.`);
  }
  mkdirSync(PLUGIN_DIR, { recursive: true });
  for (const f of PLUGIN_FILES) copyFileSync(join(BUNDLED_PLUGIN_DIR, f), join(PLUGIN_DIR, f));
  const code = readFileSync(join(PLUGIN_DIR, "code.js"), "utf8");
  const manifest = join(PLUGIN_DIR, "manifest.json");
  out({
    ok: true,
    pluginDir: PLUGIN_DIR,
    manifest,
    pluginVersion: /PLUGIN_VERSION = '([^']+)'/.exec(code)?.[1] ?? "unknown",
    steps: [
      "Open Figma Desktop (the browser version cannot run development plugins).",
      "Open any design file, then the main menu: Plugins > Development > Import plugin from manifest...",
      `Choose ${manifest}.`,
      "Run it in each file to work on: Plugins > Development > Figma Desktop Bridge. Keep its window open (it may be minimized).",
      "Then run `figma-access status` to see the file connected.",
    ],
    note: "This is the Desktop Bridge plugin that figma-console-mcp also uses. If it is already imported, it works as is; re-import after an update so Figma loads the new files.",
  });
}

export async function status(argv: string[]) {
  const { flags } = parseArgs(argv, HELP_ONLY);
  if (flags.help) showHelp("status");
  const state = await connect(flags, false);
  const reply = await callDaemon(state, { op: "status" }, 5000);
  if (!reply.files?.length) reply.help = NOT_CONNECTED_HELP;
  out(reply);
}

export async function files(argv: string[]) {
  const { flags } = parseArgs(argv, { value: ["wait"], bool: ["help"], alias: { h: "help" } });
  if (flags.help) showHelp("files");
  const state = await connect(flags);
  const reply = await callDaemon(state, { op: "status" }, 5000);
  out({ ok: true, files: reply.files });
}

export async function daemon(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, HELP_ONLY);
  if (flags.help || positionals.length === 0) showHelp("daemon");
  const stop = async (): Promise<boolean> => {
    const s = readState();
    if (!s || !pidAlive(s.pid)) {
      rmSync(STATE_FILE, { force: true });
      return false;
    }
    try {
      await fetch(`http://127.0.0.1:${s.port}/cli`, {
        method: "POST",
        headers: { "x-figma-access-token": s.token },
        body: JSON.stringify({ op: "stop" }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // fall through to the signal below
    }
    const deadline = Date.now() + 4000;
    while (pidAlive(s.pid) && Date.now() < deadline) await Bun.sleep(100);
    if (pidAlive(s.pid)) process.kill(s.pid, "SIGKILL");
    rmSync(STATE_FILE, { force: true });
    return true;
  };
  switch (positionals[0]) {
    case "start": {
      const { state, started } = await startDaemon();
      return out({ ok: true, started, pid: state.pid, port: state.port, logFile: LOG_FILE });
    }
    case "stop":
      return out({ ok: true, stopped: await stop() });
    case "restart": {
      await stop();
      const { state } = await startDaemon();
      return out({ ok: true, restarted: true, pid: state.pid, port: state.port, logFile: LOG_FILE });
    }
    case "status": {
      const s = readState();
      const running = await daemonReachable(s);
      return out({ ok: true, running, pid: running ? s?.pid : null, port: running ? s?.port : null, logFile: LOG_FILE });
    }
    case "log": {
      const text = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "";
      process.stdout.write(text.split("\n").slice(-61).join("\n") + "\n");
      return;
    }
    default:
      fail(EXIT_USAGE, `Unknown daemon action "${positionals[0]}". Use start, stop, restart, status or log.`);
  }
}

export async function exec(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, extend({ value: ["code-file", "timeout"], alias: { f: "code-file", t: "timeout" } }));
  if (flags.help) showHelp("exec");
  let code: string | undefined;
  const codeFile = str(flags["code-file"]);
  if (codeFile) {
    if (!existsSync(codeFile)) fail(EXIT_USAGE, `Code file not found: ${codeFile}`);
    code = readFileSync(codeFile, "utf8");
  } else if (positionals.length && positionals[0] !== "-") {
    code = positionals.join(" ");
  } else if (!process.stdin.isTTY) {
    code = await readStdin();
  }
  if (!code?.trim()) fail(EXIT_USAGE, "No code given. Pass it as an argument, with -f <file>, or on stdin.");
  const timeout = flags.timeout === undefined ? 5000 : Math.min(readDuration(flags.timeout, "timeout"), 300000);
  // The plugin UI waits timeout + 2 s; the relay adds a further margin.
  const reply = await rpc(flags, "EXECUTE_CODE", { code, timeout }, timeout + 5000);
  finish(reply, (r) => ({
    ok: true,
    result: r.result?.result,
    resultAnalysis: r.result?.resultAnalysis,
    fileContext: r.result?.fileContext ?? r.file,
  }));
}

export async function screenshot(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, extend({ value: ["out", "scale", "format"], alias: { o: "out" } }));
  if (flags.help) showHelp("screenshot");
  const format = (str(flags.format) ?? "PNG").toUpperCase();
  const ext: Record<string, string> = { PNG: ".png", JPG: ".jpg", SVG: ".svg", PDF: ".pdf" };
  if (!ext[format]) fail(EXIT_USAGE, "--format must be PNG, JPG, SVG or PDF.");
  const params: Record<string, unknown> = { format };
  if (positionals[0]) params.nodeId = positionals[0];
  if (flags.scale !== undefined) {
    const s = Number(flags.scale);
    if (!(s > 0)) fail(EXIT_USAGE, "--scale must be a positive number.");
    params.scale = s;
  }
  const reply = await rpc(flags, "CAPTURE_SCREENSHOT", params);
  if (!reply.ok) finish(reply);
  const image = reply.result?.image;
  if (!image?.base64) fail(EXIT_FAILED, "The plugin returned no image data.", { reply });
  let outPath = str(flags.out);
  if (!outPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = String(image.node?.id ?? "page").replace(/[^A-Za-z0-9_-]/g, "-");
    outPath = join(process.cwd(), "_swe", "figma-access", "screenshots", `${safe}-${stamp}${ext[format]}`);
  } else if (!extname(outPath)) {
    outPath += ext[format];
  }
  outPath = resolve(outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(image.base64, "base64"));
  finish({ ok: true }, () => ({
    ok: true,
    path: outPath,
    format,
    scale: image.scale,
    bytes: image.byteLength,
    node: image.node,
    bounds: image.bounds,
    advice: image.formatAdvice || undefined,
    file: reply.file,
  }));
}

const SELECTION_CODE = `
const sel = figma.currentPage.selection;
return {
  page: { id: figma.currentPage.id, name: figma.currentPage.name },
  count: sel.length,
  nodes: sel.slice(0, 100).map((n) => {
    const o = { id: n.id, name: n.name, type: n.type };
    if ('x' in n) { o.x = n.x; o.y = n.y; }
    if ('width' in n) { o.width = n.width; o.height = n.height; }
    if (n.parent) o.parent = { id: n.parent.id, name: n.parent.name, type: n.parent.type };
    return o;
  }),
};`;

export async function selection(argv: string[]) {
  const { flags } = parseArgs(argv, COMMON);
  if (flags.help) showHelp("selection");
  const reply = await rpc(flags, "EXECUTE_CODE", { code: SELECTION_CODE, timeout: 5000 }, 10000);
  finish(reply, (r) => ({ ok: true, ...r.result?.result, file: r.file }));
}

export async function logs(argv: string[]) {
  const { flags } = parseArgs(argv, extend({ value: ["since", "level", "limit"], bool: ["clear", "follow"] }));
  if (flags.help) showHelp("logs");
  const state = await connect(flags);
  let since = parseSince(str(flags.since));
  const body = { op: "logs", file: str(flags.file), since, level: str(flags.level), limit: str(flags.limit), clear: !!flags.clear };
  if (!flags.follow) finish(await callDaemon(state, body, 5000));
  for (;;) {
    const reply = await callDaemon(state, { ...body, since, limit: LOG_BUFFER, clear: false }, 5000);
    if (!reply.ok) finish(reply);
    for (const e of reply.entries as { timestamp: number }[]) {
      process.stdout.write(encodeItem(e) + "\n");
      since = Math.max(since, e.timestamp + 1);
    }
    await Bun.sleep(1000);
  }
}

export async function changes(argv: string[]) {
  const { flags } = parseArgs(argv, extend({ value: ["since"], bool: ["clear"] }));
  if (flags.help) showHelp("changes");
  const state = await connect(flags);
  finish(await callDaemon(state, { op: "changes", file: str(flags.file), since: parseSince(str(flags.since)), clear: !!flags.clear }, 5000));
}

export async function call(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, extend({ value: ["params-file", "timeout"], alias: { p: "params-file", t: "timeout" } }));
  if (flags.help || positionals.length === 0) showHelp("call");
  const method = positionals[0]!.toUpperCase();
  if (!METHODS[method]) fail(EXIT_USAGE, `Unknown method "${method}". Run \`figma-access methods\` for the list.`);
  let text: string | null = null;
  const paramsFile = str(flags["params-file"]);
  if (paramsFile) {
    if (!existsSync(paramsFile)) fail(EXIT_USAGE, `Params file not found: ${paramsFile}`);
    text = readFileSync(paramsFile, "utf8");
  } else if (positionals[1] === "-") {
    text = await readStdin();
  } else if (positionals.length > 1) {
    text = positionals.slice(1).join(" ");
  }
  let params: Record<string, any> = {};
  if (text?.trim()) {
    try {
      params = JSON.parse(text);
    } catch (e) {
      fail(EXIT_USAGE, `Params are not valid JSON: ${(e as Error).message}`);
    }
    if (params === null || typeof params !== "object" || Array.isArray(params)) fail(EXIT_USAGE, "Params must be a JSON object.");
  }
  let timeout = flags.timeout === undefined ? undefined : readDuration(flags.timeout, "timeout");
  if (method === "EXECUTE_CODE") {
    params.timeout = Math.min(Number(params.timeout) || 5000, 300000);
    timeout ??= params.timeout + 5000;
  }
  finish(await rpc(flags, method, params, timeout));
}

export function methods(argv: string[]) {
  const { flags, positionals } = parseArgs(argv, HELP_ONLY);
  if (flags.help) showHelp("methods");
  const filter = (positionals[0] ?? "").toUpperCase();
  const rows = Object.entries(METHODS)
    .filter(([name]) => name.includes(filter))
    .map(([name, [params, timeout]]) => ({ method: name, params, defaultTimeoutMs: timeout ?? "code timeout + 5000" }));
  out({ ok: true, methods: rows });
}
