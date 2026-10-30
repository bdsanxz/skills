import { describe, expect, test } from "bun:test"
import { consumeSse, exitWhenStdinCloses, nextSseDelay, SSE_BACKOFF_MAX_MS, SSE_BACKOFF_START_MS } from "../src/mcp/events"

function sseResponse(status: number, body: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status })
}

describe("SSE reconnect backoff", () => {
  test("doubles the wait up to 30s after failures", () => {
    expect(SSE_BACKOFF_START_MS).toBe(500)
    expect(SSE_BACKOFF_MAX_MS).toBe(30000)
    const delays: number[] = []
    let delay = SSE_BACKOFF_START_MS
    for (let i = 0; i < 10; i++) {
      delay = nextSseDelay(delay, false)
      delays.push(delay)
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000])
  })

  test("resets to the start delay only after frames arrived", () => {
    expect(nextSseDelay(30000, true)).toBe(500)
    expect(nextSseDelay(8000, true)).toBe(500)
    expect(nextSseDelay(500, false)).toBe(1000)
  })

  test("counts handled frames and throws on a failed subscribe", async () => {
    const seen: any[] = []
    const frames = await consumeSse(
      sseResponse(200, `: heartbeat\n\ndata: {"id":"1","type":"session.execution.started","data":{"sessionID":"s"}}\n\ndata: not-json\n\ndata: {"id":"2","type":"server.connected","data":{}}\n\n`),
      async (frame) => { seen.push(frame) },
    )
    expect(frames).toBe(2)
    expect(seen.map((frame) => frame.type)).toEqual(["session.execution.started", "server.connected"])
    await expect(consumeSse(new Response(null, { status: 401 }), async () => {})).rejects.toThrow("event.subscribe failed (401)")
  })

  test("exits once when stdin closes or ends", () => {
    const listeners = new Map<string, Array<() => void>>()
    let exits = 0
    const fake = {
      stdin: { on: (event: string, listener: () => void) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]) } },
      exit: () => { exits += 1 },
    }
    exitWhenStdinCloses(fake)
    for (const listener of listeners.get("close") ?? []) listener()
    for (const listener of listeners.get("close") ?? []) listener()
    for (const listener of listeners.get("end") ?? []) listener()
    expect(exits).toBe(1)
  })
})
