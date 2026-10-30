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
