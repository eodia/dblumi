// RFC 7807 Problem Details for HTTP APIs
export type ProblemDetail = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ProblemDetail }

// SSE event types for streaming
export type StreamEvent =
  | { type: 'row'; data: Record<string, unknown> }
  | { type: 'columns'; data: Array<{ name: string; dataType: string }> }
  | { type: 'done'; rowCount: number; durationMs: number }
  | { type: 'error'; message: string }
  | { type: 'ai_token'; token: string }
  | { type: 'ai_done'; fullText: string }
