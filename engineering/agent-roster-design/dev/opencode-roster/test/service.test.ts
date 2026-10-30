import { describe, expect, test } from "bun:test"
import { jsonField, passwordFromGet, resolveService, statusUrl, type ServiceDeps } from "../src/mcp/service"

function deps(over: Partial<ServiceDeps> = {}): ServiceDeps & { calls: string[][] } {
  const calls: string[][] = []
  return {
    env: {},
    home: "/home/tester",
    run: (cmd) => {
      calls.push(cmd)
      return { code: 1, stdout: "" }
    },
    read: () => undefined,
    calls,
    ...over,
  }
}

describe("service discovery", () => {
  test("parses opencode service status output", () => {
    expect(statusUrl("http://127.0.0.1:49374\n")).toBe("http://127.0.0.1:49374")
    expect(statusUrl("  https://example.invalid:8443  \n")).toBe("https://example.invalid:8443")
    expect(statusUrl("")).toBeUndefined()
    expect(statusUrl("not-a-url")).toBeUndefined()
    expect(statusUrl("Error: Unknown service config key: url\n")).toBeUndefined()
  })

  test("parses opencode service get password output", () => {
    expect(passwordFromGet("fixture-password-not-real\n")).toBe("fixture-password-not-real")
    expect(passwordFromGet("")).toBeUndefined()
    expect(passwordFromGet("two words")).toBeUndefined()
  })

  test("reads one field from a service JSON file", () => {
    expect(jsonField('{"url":"http://127.0.0.1:49374","password":"pw"}', "url")).toBe("http://127.0.0.1:49374")
    expect(jsonField('{"url":"http://127.0.0.1:49374","password":"pw"}', "password")).toBe("pw")
    expect(jsonField("not json", "url")).toBeUndefined()
    expect(jsonField('{"url":42}', "url")).toBeUndefined()
    expect(jsonField('{"url":""}', "url")).toBeUndefined()
  })

  test("prefers explicit environment and runs nothing", () => {
    const d = deps({ env: { OPENCODE_URL: "http://127.0.0.1:4097", OPENCODE_SERVER_PASSWORD: "env-pw" } })
    const found = resolveService(d)
    expect(found.baseURL).toBe("http://127.0.0.1:4097")
    expect(found.urlSource).toBe("OPENCODE_URL")
    expect(found.password).toBe("env-pw")
    expect(found.passwordSource).toBe("OPENCODE_SERVER_PASSWORD")
    expect(found.warnings).toEqual([])
    expect(d.calls).toEqual([])
  })

  test("falls back to the opencode CLI before the state files", () => {
    const d = deps({
      run: (cmd) => {
        if (cmd.join(" ") === "opencode service status") return { code: 0, stdout: "http://127.0.0.1:49374\n" }
        if (cmd.join(" ") === "opencode service get password") return { code: 0, stdout: "cli-pw\n" }
        return { code: 1, stdout: "" }
      },
      read: () => '{"url":"http://127.0.0.1:9999","password":"file-pw"}',
    })
    const found = resolveService(d)
    expect(found.baseURL).toBe("http://127.0.0.1:49374")
    expect(found.urlSource).toBe("opencode service status")
    expect(found.password).toBe("cli-pw")
    expect(found.passwordSource).toBe("opencode service get password")
    expect(found.warnings).toEqual([])
  })

  test("reads the state and config files when the CLI is missing", () => {
    const d = deps({
      read: (path) => {
        if (path.endsWith(".local/state/opencode/service.json")) return '{"url":"http://127.0.0.1:5555","password":"state-pw"}'
        if (path.endsWith(".config/opencode/service.json")) return '{"password":"config-pw"}'
        return undefined
      },
    })
    const found = resolveService(d)
    expect(found.baseURL).toBe("http://127.0.0.1:5555")
    expect(found.urlSource).toBe("~/.local/state/opencode/service.json")
    expect(found.password).toBe("config-pw")
    expect(found.passwordSource).toBe("~/.config/opencode/service.json")
    expect(found.warnings).toEqual([])
  })

  test("warns clearly with the exact commands when nothing resolves", () => {
    const found = resolveService(deps())
    expect(found.baseURL).toBe("http://127.0.0.1:4096")
    expect(found.urlSource).toBe("default")
    expect(found.password).toBeUndefined()
    expect(found.passwordSource).toBeUndefined()
    expect(found.warnings.join("\n")).toContain("opencode service status")
    expect(found.warnings.join("\n")).toContain("opencode service get password")
  })

  test("ignores a malformed OPENCODE_URL and keeps discovering", () => {
    const d = deps({
      env: { OPENCODE_URL: "not-a-url" },
      run: (cmd) => (cmd.join(" ") === "opencode service status" ? { code: 0, stdout: "http://127.0.0.1:49374\n" } : { code: 1, stdout: "" }),
    })
    const found = resolveService(d)
    expect(found.baseURL).toBe("http://127.0.0.1:49374")
    expect(found.urlSource).toBe("opencode service status")
  })
})
