import { buildEvaluatorPrompt, compactTranscript, extractTextFromMessages, extractTextFromPromptResult, goalEvalTimeoutMs, goalTranscriptChars, GOAL_HELPER_TITLE_PREFIX, parseGoalVerdict } from "./goal"

export type GoalVerdict = { met: boolean; reason: string }

export function createGoalEvaluator(options: {
  baseURL: string
  password?: string
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  onHelper?: (helperID: string, active: boolean) => void
}) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const authorization = options.password ? `Basic ${Buffer.from(`opencode:${options.password}`).toString("base64")}` : undefined
  const headers = (): Record<string, string> => ({ ...(authorization ? { authorization } : {}) })
  const base = options.baseURL.replace(/\/$/, "")

  async function readJson(response: Response, operation: string): Promise<any> {
    if (!response.ok) throw new Error(`goal evaluation failed: ${operation} (${response.status})`)
    try {
      return await response.json()
    } catch {
      throw new Error(`goal evaluation failed: ${operation} returned non-JSON`)
    }
  }

  return async (sessionID: string, condition: string): Promise<GoalVerdict> => {
    const timeoutMs = goalEvalTimeoutMs()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = controller.signal
    let helperID: string | undefined
    try {
      // Session info (model reuse). GET carries no body: session.get must be
      // called WITHOUT one or the v2 server rejects it.
      const info = await readJson(
        await fetchImpl(`${base}/api/session/${encodeURIComponent(sessionID)}`, { headers: headers(), signal }),
        "session.get",
      )
      // Live `session.get` carries the model as `{id, providerID, variant?}`
      // (probed 2026-10-30, v2.0.29); `session.create` rejects
      // `{providerID, modelID}` with "Missing key at ["model"]["id"]", so
      // normalize either spelling to `{providerID, id}` (+ variant).
      const model = (info as any)?.data?.model
      const modelID = model !== null && typeof model === "object"
        ? (typeof model.id === "string" ? model.id : (typeof model.modelID === "string" ? model.modelID : undefined))
        : undefined
      const useModel = model !== null && typeof model === "object" && typeof model.providerID === "string" && typeof modelID === "string"
        ? { providerID: model.providerID as string, id: modelID, ...(typeof model.variant === "string" ? { variant: model.variant as string } : {}) }
        : undefined
      // Compact transcript for the evaluator; content is never logged.
      const listed = await readJson(
        await fetchImpl(`${base}/api/session/${encodeURIComponent(sessionID)}/message?limit=50&order=desc`, { headers: headers(), signal }),
        "session.message.list",
      )
      const messages = Array.isArray((listed as any)?.data) ? (listed as any).data : []
      const chronological = [...messages].reverse()
      const transcript = compactTranscript(chronological, goalTranscriptChars())
      const prompt = buildEvaluatorPrompt(condition, transcript)
      // Short-lived helper session: it must never trigger goal checks itself
      // (the sidecar tracks its id) and is deleted before we return.
      const created = await readJson(
        await fetchImpl(`${base}/api/session`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers() },
          body: JSON.stringify({ title: `${GOAL_HELPER_TITLE_PREFIX} ${sessionID}`, ...(useModel ? { model: useModel } : {}) }),
          signal,
        }),
        "session.create",
      )
      const createdData = (created as any)?.data ?? created
      helperID = typeof createdData?.id === "string" ? createdData.id : typeof createdData?.info?.id === "string" ? createdData.info.id : undefined
      if (!helperID) throw new Error("goal evaluation failed: session.create returned no id")
      options.onHelper?.(helperID, true)
      const answered = await readJson(
        await fetchImpl(`${base}/api/session/${encodeURIComponent(helperID)}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers() },
          body: JSON.stringify({ text: prompt }),
          signal,
        }),
        "session.prompt",
      )
      // Live `session.prompt` answers immediately with the submitted user
      // message (`{data:{type:"user", payload:{text}}}`), never the verdict:
      // the assistant reply arrives asynchronously, so poll
      // `session.message.list` until an assistant message carries text.
      let text = extractTextFromPromptResult(answered)
      if (!text) {
        for (;;) {
          if (signal.aborted) throw new Error(`goal evaluation timed out after ${timeoutMs}ms`)
          const helperMessages = await readJson(
            await fetchImpl(`${base}/api/session/${encodeURIComponent(helperID)}/message?limit=5&order=desc`, { headers: headers(), signal }),
            "session.message.list",
          )
          const helperData = Array.isArray((helperMessages as any)?.data) ? (helperMessages as any).data : []
          const found = extractTextFromMessages(helperData)
          if (found) {
            text = found
            break
          }
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 1000)
            if (signal.aborted) {
              clearTimeout(timer)
              reject(new Error(`goal evaluation timed out after ${timeoutMs}ms`))
              return
            }
            signal.addEventListener("abort", () => {
              clearTimeout(timer)
              reject(new Error(`goal evaluation timed out after ${timeoutMs}ms`))
            }, { once: true })
          })
        }
      }
      if (!text) throw new Error("goal evaluation failed: helper session returned no text")
      return parseGoalVerdict(text)
    } catch (error) {
      if (signal.aborted) throw new Error(`goal evaluation timed out after ${timeoutMs}ms`)
      throw error
    } finally {
      clearTimeout(timer)
      if (helperID) {
        options.onHelper?.(helperID, false)
        try {
          await fetchImpl(`${base}/api/session/${encodeURIComponent(helperID)}`, { method: "DELETE", headers: headers() })
        } catch { /* Best effort: the helper is short-lived either way. */ }
      }
    }
  }
}

export function createPromptInjector(options: {
  baseURL: string
  password?: string
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  onError?: (error: unknown, sessionID: string) => Promise<void> | void
}) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const authorization = options.password ? `Basic ${Buffer.from(`opencode:${options.password}`).toString("base64")}` : undefined
  return async (sessionID: string, prompt: string): Promise<void> => {
    const url = `${options.baseURL.replace(/\/$/, "")}/api/session/${encodeURIComponent(sessionID)}/prompt`
    const request = fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify({ text: prompt, delivery: "queue", resume: true }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`session.prompt failed (${response.status}): ${await response.text()}`)
    }).catch(async (error) => { await options.onError?.(error, sessionID) })
    // v2 session.prompt can block until processing ends; keep MCP tools responsive.
    void request
  }
}
