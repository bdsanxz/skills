import { readFileSync, writeFileSync } from "node:fs";
import { decode, encode } from "./kdl";
import { EXIT_USAGE, STATE_FILE } from "./config";

export interface DaemonState {
  pid: number;
  port: number;
  token: string;
  version: string;
  startedAt: number;
}

// Everything the CLI prints or saves for the agent is KDL (see kdl.ts): one node per line, easy to
// grep, awk and sed. Internal files (daemon state, the API cache) stay JSON.
export function kdl(value: unknown): string {
  return encode(value);
}

export function out(value: unknown): void {
  process.stdout.write(kdl(value) + "\n");
}

export function writeData(path: string, value: unknown): void {
  writeFileSync(path, kdl(value) + "\n");
}

// Reads a file this CLI saved (KDL, whatever its extension) or any JSON file, by its content.
export function readData(path: string): any {
  const text = readFileSync(path, "utf8");
  return /^\s*[[{]/.test(text) ? JSON.parse(text) : decode(text);
}

export function fail(code: number, message: string, extra?: Record<string, unknown>): never {
  out({ ok: false, error: message, ...extra });
  process.exit(code);
}

export function readState(): DaemonState | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** "30s", "5m", "2h", "1500ms" or a bare number of ms -> ms; null when unreadable. */
export function parseDuration(text: string | undefined): number | null {
  if (text == null) return null;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(text).trim());
  if (!m) return null;
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return Number(m[1]) * (mult[m[2] ?? "ms"] ?? 1);
}

/** A duration ago or an ISO time -> epoch ms; 0 when absent. */
export function parseSince(text: string | undefined): number {
  if (text == null) return 0;
  const d = parseDuration(text);
  if (d != null) return Date.now() - d;
  const t = Date.parse(text);
  if (!Number.isNaN(t)) return t;
  fail(EXIT_USAGE, `Cannot read --since "${text}". Use a duration such as 30s, 5m, 2h, or an ISO time.`);
}

export interface ArgSpec {
  value?: string[];
  bool?: string[];
  alias?: Record<string, string>;
}

export interface ParsedArgs {
  flags: Record<string, string | boolean | undefined>;
  positionals: string[];
}

/** Minimal parser: valued flags, boolean flags and positionals. Unknown flags are a usage error. */
export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const flags: ParsedArgs["flags"] = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--") || (a.startsWith("-") && a.length === 2 && a !== "-")) {
      let name = a.replace(/^--?/, "");
      let value: string | undefined;
      const eq = name.indexOf("=");
      if (eq >= 0) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const canonical = spec.alias?.[name] ?? name;
      if (spec.bool?.includes(canonical)) {
        flags[canonical] = value === undefined ? true : value !== "false";
      } else if (spec.value?.includes(canonical)) {
        if (value === undefined) {
          value = argv[++i];
          if (value === undefined) fail(EXIT_USAGE, `Option --${canonical} needs a value.`);
        }
        flags[canonical] = value;
      } else {
        fail(EXIT_USAGE, `Unknown option ${a}. Run the command with --help to see its options.`);
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

export function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
