// Resolve the OpenCode background service URL and Basic-auth password without
// guessing: explicit environment first, then read-only `opencode` CLI queries,
// then the state and config files the CLI itself maintains. Everything here is
// synchronous so the sidecar knows its target before it serves its first tool.

import { join } from "node:path"

export const DEFAULT_URL = "http://127.0.0.1:4096"

export type ServiceDeps = {
  env: Record<string, string | undefined>
  home: string
  run: (cmd: string[]) => { code: number; stdout: string }
  read: (path: string) => string | undefined
}

export type ResolvedService = {
  baseURL: string
  password: string | undefined
  urlSource: string
  passwordSource: string | undefined
  warnings: string[]
}

/** The first whitespace-separated token of `opencode service status`, when it is an http(s) URL. */
export function statusUrl(output: string): string | undefined {
  const first = output.trim().split(/\s+/)[0] ?? ""
  return /^https?:\/\/\S+$/.test(first) ? first : undefined
}

/** The single-line secret printed by `opencode service get password`. */
export function passwordFromGet(output: string): string | undefined {
  const line = output.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.length > 0)
  return line !== undefined && !/\s/.test(line) ? line : undefined
}

/** One string field of a JSON service file, such as the state file's url or password. */
export function jsonField(text: string, field: "url" | "password"): string | undefined {
  try {
    const value = (JSON.parse(text) as Record<string, unknown>)[field]
    return typeof value === "string" && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function httpUrl(value: string | undefined): string | undefined {
  return value !== undefined && /^https?:\/\/\S+$/.test(value) ? value : undefined
}

export function resolveService(deps: ServiceDeps): ResolvedService {
  const warnings: string[] = []
  let baseURL = httpUrl(deps.env.OPENCODE_URL ?? deps.env.OPENCODE_SERVER_URL)
  let urlSource =
    deps.env.OPENCODE_URL !== undefined && httpUrl(deps.env.OPENCODE_URL) !== undefined
      ? "OPENCODE_URL"
      : deps.env.OPENCODE_SERVER_URL !== undefined && httpUrl(deps.env.OPENCODE_SERVER_URL) !== undefined
        ? "OPENCODE_SERVER_URL"
        : undefined
  if (baseURL === undefined) {
    const status = deps.run(["opencode", "service", "status"])
    const found = status.code === 0 ? statusUrl(status.stdout) : undefined
    if (found !== undefined) {
      baseURL = found
      urlSource = "opencode service status"
    }
  }
  if (baseURL === undefined) {
    const stored = deps.read(join(deps.home, ".local", "state", "opencode", "service.json"))
    const found = stored === undefined ? undefined : httpUrl(jsonField(stored, "url"))
    if (found !== undefined) {
      baseURL = found
      urlSource = "~/.local/state/opencode/service.json"
    }
  }
  if (baseURL === undefined) {
    baseURL = DEFAULT_URL
    urlSource = "default"
    warnings.push(
      "no OpenCode service URL found: `opencode service status` failed and ~/.local/state/opencode/service.json has no url; using http://127.0.0.1:4096",
    )
  }
  let password = deps.env.OPENCODE_SERVER_PASSWORD ?? deps.env.OPENCODE_PASSWORD
  let passwordSource =
    deps.env.OPENCODE_SERVER_PASSWORD !== undefined
      ? "OPENCODE_SERVER_PASSWORD"
      : deps.env.OPENCODE_PASSWORD !== undefined
        ? "OPENCODE_PASSWORD"
        : undefined
  if (password === undefined) {
    const fetched = deps.run(["opencode", "service", "get", "password"])
    const found = fetched.code === 0 ? passwordFromGet(fetched.stdout) : undefined
    if (found !== undefined) {
      password = found
      passwordSource = "opencode service get password"
    }
  }
  if (password === undefined) {
    const stored = deps.read(join(deps.home, ".config", "opencode", "service.json"))
    const found = stored === undefined ? undefined : jsonField(stored, "password")
    if (found !== undefined) {
      password = found
      passwordSource = "~/.config/opencode/service.json"
    }
  }
  if (password === undefined) {
    const stored = deps.read(join(deps.home, ".local", "state", "opencode", "service.json"))
    const found = stored === undefined ? undefined : jsonField(stored, "password")
    if (found !== undefined) {
      password = found
      passwordSource = "~/.local/state/opencode/service.json"
    }
  }
  if (password === undefined) {
    warnings.push(
      "no OpenCode service password found: `opencode service get password` failed and neither ~/.config/opencode/service.json nor ~/.local/state/opencode/service.json holds one; session.prompt calls will fail with 401 until the service password is reachable",
    )
  }
  return { baseURL, password, urlSource: urlSource!, passwordSource, warnings }
}
