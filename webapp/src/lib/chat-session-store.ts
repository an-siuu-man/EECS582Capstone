export type ChatSessionStatus = "queued" | "running" | "completed" | "failed"
export type ChatSessionStage =
  | "queued"
  | "preparing_payload"
  | "extracting_pdf"
  | "calling_agent"
  | "streaming_output"
  | "validating_output"
  | "parsing_response"
  | "completed"
  | "failed"

export type ChatSessionRecord = {
  id: string
  payload: unknown
  createdAt: number
  updatedAt: number
  status: ChatSessionStatus
  stage: ChatSessionStage
  progressPercent: number
  statusMessage: string
  streamedGuideMarkdown: string
  result?: unknown
  error?: string
}

export type ChatSessionDto = {
  ok: true
  session_id: string
  created_at: number
  updated_at: number
  status: ChatSessionStatus
  stage: ChatSessionStage
  progress_percent: number
  status_message: string
  streamed_guide_markdown: string
  result: unknown | null
  error: string | null
  payload: unknown
}

const SESSION_TTL_MS = 6 * 60 * 60 * 1000

type SessionListener = (session: ChatSessionRecord) => void

declare global {
  var __headstartChatSessions: Map<string, ChatSessionRecord> | undefined
  var __headstartChatSessionListeners: Map<string, Set<SessionListener>> | undefined
}

const chatSessions =
  globalThis.__headstartChatSessions ?? new Map<string, ChatSessionRecord>()
const chatSessionListeners =
  globalThis.__headstartChatSessionListeners ?? new Map<string, Set<SessionListener>>()

if (!globalThis.__headstartChatSessions) {
  globalThis.__headstartChatSessions = chatSessions
}
if (!globalThis.__headstartChatSessionListeners) {
  globalThis.__headstartChatSessionListeners = chatSessionListeners
}

function notifyChatSessionUpdated(session: ChatSessionRecord) {
  const listeners = chatSessionListeners.get(session.id)
  if (!listeners || listeners.size === 0) {
    return
  }

  for (const listener of Array.from(listeners)) {
    try {
      listener(session)
    } catch {
      // Ignore listener errors to protect store writes.
    }
  }
}

function pruneExpiredSessions(now: number) {
  for (const [id, session] of chatSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      chatSessions.delete(id)
      chatSessionListeners.delete(id)
    }
  }
}

function upsertChatSession(session: ChatSessionRecord) {
  chatSessions.set(session.id, session)
  notifyChatSessionUpdated(session)
  return session
}

function toBoundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeGuideMarkdown(result: unknown) {
  if (!result) return ""
  if (typeof result === "object" && result !== null) {
    const objectResult = result as Record<string, unknown>
    if (typeof objectResult.guideMarkdown === "string") {
      return objectResult.guideMarkdown
    }
    return ""
  }
  if (typeof result === "string") {
    return result
  }
  return ""
}

export function serializeChatSession(session: ChatSessionRecord): ChatSessionDto {
  return {
    ok: true,
    session_id: session.id,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    status: session.status,
    stage: session.stage,
    progress_percent: session.progressPercent,
    status_message: session.statusMessage,
    streamed_guide_markdown: session.streamedGuideMarkdown,
    result: session.result ?? null,
    error: session.error ?? null,
    payload: session.payload,
  }
}

export function subscribeToChatSession(
  sessionId: string,
  listener: SessionListener,
) {
  const listeners = chatSessionListeners.get(sessionId) ?? new Set<SessionListener>()
  listeners.add(listener)
  chatSessionListeners.set(sessionId, listeners)

  return () => {
    const current = chatSessionListeners.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      chatSessionListeners.delete(sessionId)
    }
  }
}

export function createChatSession(payload: unknown) {
  const now = Date.now()
  pruneExpiredSessions(now)

  const id = crypto.randomUUID()
  const session: ChatSessionRecord = {
    id,
    payload,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    stage: "queued",
    progressPercent: 5,
    statusMessage: "Queued",
    streamedGuideMarkdown: "",
  }
  return upsertChatSession(session)
}

export function getChatSession(sessionId: string) {
  const now = Date.now()
  pruneExpiredSessions(now)

  const session = chatSessions.get(sessionId)
  if (!session) return null
  if (now - session.createdAt > SESSION_TTL_MS) {
    chatSessions.delete(sessionId)
    return null
  }
  return session
}

export function markChatSessionRunning(sessionId: string) {
  const session = getChatSession(sessionId)
  if (!session) return null

  const updated: ChatSessionRecord = {
    ...session,
    status: "running",
    stage: "preparing_payload",
    progressPercent: 15,
    statusMessage: "Preparing assignment payload",
    updatedAt: Date.now(),
    streamedGuideMarkdown: session.streamedGuideMarkdown ?? "",
    error: undefined,
  }
  return upsertChatSession(updated)
}

export function updateChatSessionProgress(
  sessionId: string,
  input: {
    stage: ChatSessionStage
    progressPercent: number
    statusMessage: string
  }
) {
  const session = getChatSession(sessionId)
  if (!session) return null

  const updated: ChatSessionRecord = {
    ...session,
    status: "running",
    stage: input.stage,
    progressPercent: toBoundedPercent(input.progressPercent),
    statusMessage: input.statusMessage,
    updatedAt: Date.now(),
    streamedGuideMarkdown: session.streamedGuideMarkdown ?? "",
    error: undefined,
  }
  return upsertChatSession(updated)
}

export function appendChatSessionGuideDelta(
  sessionId: string,
  delta: string,
  input?: {
    progressPercent?: number
    statusMessage?: string
  },
) {
  const session = getChatSession(sessionId)
  if (!session || session.status === "completed" || session.status === "failed") return null

  const updated: ChatSessionRecord = {
    ...session,
    status: "running",
    stage: "streaming_output",
    progressPercent: toBoundedPercent(
      input?.progressPercent ?? Math.max(session.progressPercent, 66),
    ),
    statusMessage: input?.statusMessage ?? "Generating guide",
    streamedGuideMarkdown: `${session.streamedGuideMarkdown}${delta}`,
    updatedAt: Date.now(),
    error: undefined,
  }
  return upsertChatSession(updated)
}

export function markChatSessionCompleted(sessionId: string, result: unknown) {
  const session = getChatSession(sessionId)
  if (!session) return null

  const normalizedGuide = normalizeGuideMarkdown(result)
  const updated: ChatSessionRecord = {
    ...session,
    status: "completed",
    stage: "completed",
    progressPercent: 100,
    statusMessage: "Guide ready",
    streamedGuideMarkdown: normalizedGuide || session.streamedGuideMarkdown || "",
    result,
    updatedAt: Date.now(),
    error: undefined,
  }
  return upsertChatSession(updated)
}

export function markChatSessionFailed(sessionId: string, error: string) {
  const session = getChatSession(sessionId)
  if (!session) return null

  const updated: ChatSessionRecord = {
    ...session,
    status: "failed",
    stage: "failed",
    progressPercent: 100,
    statusMessage: "Guide generation failed",
    error,
    updatedAt: Date.now(),
    streamedGuideMarkdown: session.streamedGuideMarkdown ?? "",
  }
  return upsertChatSession(updated)
}
