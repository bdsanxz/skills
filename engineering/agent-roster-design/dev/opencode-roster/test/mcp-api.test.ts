import { describe, expect, test } from "bun:test"
import { createPromptInjector } from "../src/mcp/api"

describe("v2 HTTP injector", () => {
  test("uses v2 endpoint, POST body, queue delivery and Basic auth", async () => {
    let call: any
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      call = { url: String(input), init }
      return new Response(null, { status: 200 })
    }
    const injector = createPromptInjector({ baseURL: "http://localhost:4097/", password: "pw", fetchImpl: fetchMock })
    await injector("session/a", "tick")
    await Promise.resolve()
    expect(call.url).toBe("http://localhost:4097/api/session/session%2Fa/prompt")
    expect(call.init.method).toBe("POST")
    expect(JSON.parse(call.init.body)).toEqual({ text: "tick", delivery: "queue", resume: true })
    expect(call.init.headers.authorization).toBe(`Basic ${Buffer.from("opencode:pw").toString("base64")}`)
  })

  test("omits authorization when no password is set", async () => {
    let call: any
    const injector = createPromptInjector({ baseURL: "http://localhost:4097", fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => { call = init; return new Response(null, { status: 200 }) } })
    await injector("s", "p")
    expect(call.headers.authorization).toBeUndefined()
  })

  test("logs fire-and-forget failures", async () => {
    let message = ""
    const injector = createPromptInjector({ baseURL: "http://localhost:4097", fetchImpl: async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("bad", { status: 500 }), onError: (error) => { message = String(error) } })
    await injector("s", "p")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(message).toContain("session.prompt failed (500)")
  })
})
