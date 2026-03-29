const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
  }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, init)

  if (res.status === 204) return undefined as T

  const data = await res.json()
  if (!res.ok) {
    throw new ApiError(res.status, data?.title ?? data?.message ?? 'Request failed', data)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

// ── SSE parser for POST fetch responses ──────────
export async function* readSSE(
  path: string,
  body: unknown,
): AsyncGenerator<{ event: string; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    credentials: 'include',
  })

  // Non-2xx → yield a special __http event so caller can handle
  if (!res.ok) {
    const data = await res.json()
    yield { event: '__http', data: { status: res.status, body: data } }
    return
  }

  if (!res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const messages = buffer.split('\n\n')
    buffer = messages.pop() ?? ''

    for (const msg of messages) {
      if (!msg.trim()) continue
      let event = 'message'
      let raw = ''
      for (const line of msg.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) raw = line.slice(6).trim()
      }
      if (raw) {
        try {
          yield { event, data: JSON.parse(raw) }
        } catch {
          yield { event, data: raw }
        }
      }
    }
  }
}
