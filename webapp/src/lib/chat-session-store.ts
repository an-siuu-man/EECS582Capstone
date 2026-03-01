export type ChatSessionStatus = "queued" | "running" | "completed" | "failed"

export type ChatSessionRecord = {
  id: string
  payload: unknown
  createdAt: number
  updatedAt: number
  status: ChatSessionStatus
  result?: unknown
  error?: string
}

const SESSION_TTL_MS = 6 * 60 * 60 * 1000

declare global {
  var __headstartChatSessions: Map<string, ChatSessionRecord> | undefined
}

const chatSessions =
  globalThis.__headstartChatSessions ?? new Map<string, ChatSessionRecord>()

if (!globalThis.__headstartChatSessions) {
  globalThis.__headstartChatSessions = chatSessions
}

function pruneExpiredSessions(now: number) {
  for (const [id, session] of chatSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      chatSessions.delete(id)
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
  }
  chatSessions.set(id, session)
  return session
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
    updatedAt: Date.now(),
    error: undefined,
  }
  chatSessions.set(sessionId, updated)
  return updated
}

export function markChatSessionCompleted(sessionId: string, result: unknown) {
  const session = getChatSession(sessionId)
  if (!session) return null

  const updated: ChatSessionRecord = {
    ...session,
    status: "completed",
    result,
    updatedAt: Date.now(),
    error: undefined,
  }
  chatSessions.set(sessionId, updated)
  return updated
}

export function markChatSessionFailed(sessionId: string, error: string) {
  const session = getChatSession(sessionId)
  if (!session) return null

  const updated: ChatSessionRecord = {
    ...session,
    status: "failed",
    error,
    updatedAt: Date.now(),
  }
  chatSessions.set(sessionId, updated)
  return updated
}
