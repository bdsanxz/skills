export function normalizeEvent(frame: any) {
  // v2 frames are {id, type, data}; v1 frames are {id, type, properties}.
  // SSE data lines already contain the event object; tolerate a wrapper
  // {data: event} and stringified payloads for robustness.
  let evt = frame
  if (typeof evt === "string") { try { evt = JSON.parse(evt) } catch { return undefined } }
  if (evt && typeof evt === "object" && !evt.type && evt.data && typeof evt.data === "object" && (evt.data as any).type) evt = evt.data
  if (typeof evt?.data === "string") { try { evt = { ...evt, data: JSON.parse(evt.data) } } catch { /* keep raw string */ } }
  const type = evt?.type ?? evt?.event
  const rawData = evt?.data ?? evt?.properties ?? {}
  const data = typeof rawData === "string" ? {} : rawData
  return { type, data, payload: evt }
}

export type FrameHandlers = {
  onIdle: (sessionID?: string, payload?: unknown) => Promise<unknown>
  onBusy: (sessionID?: string, payload?: unknown) => Promise<unknown>
  onDeleted: (sessionID?: string, payload?: unknown) => Promise<unknown>
}
export type FrameLog = (event: string, sessionID?: string, details?: Record<string, unknown>) => Promise<void>

export const SSE_BACKOFF_START_MS = 500
export const SSE_BACKOFF_MAX_MS = 30000

export function nextSseDelay(currentMs: number, gotFrames: boolean) {
  // Double the wait after a failed or empty connection, up to the cap.
  // Reset to the start delay only after at least one frame arrived.
  return gotFrames ? SSE_BACKOFF_START_MS : Math.min(SSE_BACKOFF_MAX_MS, currentMs * 2)
}

export async function consumeSse(response: Response, onFrame: (frame: any) => Promise<unknown>): Promise<number> {
  if (!response.ok || !response.body) throw new Error(`event.subscribe failed (${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let frames = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) return frames
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split(/\r?\n\r?\n/)
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const data = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")
      if (!data) continue // includes heartbeat comment frames
      let frame: any
      try { frame = JSON.parse(data) } catch { continue }
      frames += 1
      await onFrame(frame)
    }
  }
}

export function exitWhenStdinCloses(proc: { stdin?: { on?: (event: string, listener: () => void) => unknown } | null; exit?: (code?: number) => void } = process) {
  // OpenCode may drop the stdio pipes without killing us. A lingering sidecar
  // keeps its SSE connection open and appends duplicate lines (event_type_seen
  // twice, phantom timer_fired records) to the shared log, so exit instead.
  let done = false
  const exit = () => { if (!done) { done = true; try { proc.exit?.(0) } catch { /* already exiting */ } } }
  try {
    proc.stdin?.on?.("close", exit)
    proc.stdin?.on?.("end", exit)
  } catch { /* stdin without events (tests) */ }
}

export const busyEventTypes = new Set([
  // Live v2 server frames (logs/roster.jsonl samples): a turn starts here.
  "session.execution.started",
  "session.step.started",
  // Legacy SDK shapes (session.next.*, session.status): kept for tolerance.
  "session.next.step.started",
  "session.next.prompted",
  "session.next.prompt.admitted",
])

export const idleEventTypes = new Set([
  // Live v2 server frames: the turn ended (success or failure variants).
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.aborted",
  "session.execution.cancelled",
  // Legacy SDK shapes: kept for tolerance.
  "session.idle",
  "session.next.step.ended",
  "session.next.step.failed",
  "session.error",
])

export async function handleFrameFor(frame: any, handlersArg: FrameHandlers, log: FrameLog, seenTypes: Set<string>) {
  // Live v2 frames are {id, created, type, data, location?, durable?} with the
  // session id in data.sessionID (location only holds the working directory).
  // Legacy SDK frames are {id, type, properties} with sessionID in properties.
  // Both shapes release or set busy through the same handlers.
  const event = normalizeEvent(frame)
  if (!event?.type) return
  if (!seenTypes.has(event.type)) {
    seenTypes.add(event.type)
    await log("event_type_seen", event.data?.sessionID ?? event.data?.properties?.sessionID, { type: event.type, sample: event.payload })
  }
  const id = event.data?.sessionID ?? event.data?.info?.id ?? event.data?.properties?.sessionID
  if (event.type === "session.status") {
    if (event.data?.status?.type === "idle") await handlersArg.onIdle(id, event.payload)
    else if (event.data?.status?.type === "busy" || event.data?.status?.type === "retry") await handlersArg.onBusy(id, event.payload)
  } else if (idleEventTypes.has(event.type)) await handlersArg.onIdle(id, event.payload)
  else if (busyEventTypes.has(event.type)) await handlersArg.onBusy(id, event.payload)
  else if (event.type === "session.deleted") await handlersArg.onDeleted(id, event.payload)
}
