import { NextResponse } from "next/server"
import { getChatSession } from "@/lib/chat-session-store"

export const runtime = "nodejs"

const DEFAULT_WAIT_MS = 25000
const MIN_WAIT_MS = 0
const MAX_WAIT_MS = 30000

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toBoundedWaitMs(rawValue: string | null) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return DEFAULT_WAIT_MS
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.floor(parsed)))
}

function toSinceEpoch(rawValue: string | null) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

function isTerminalStatus(status: string) {
  return status === "completed" || status === "failed"
}

async function waitForSessionChange(
  sessionId: string,
  sinceEpoch: number,
  waitMs: number
) {
  const startedAt = Date.now()
  let session = getChatSession(sessionId)

  while (session && Date.now() - startedAt < waitMs) {
    if (session.updatedAt > sinceEpoch || isTerminalStatus(session.status)) {
      return session
    }

    await sleep(300)
    session = getChatSession(sessionId)
  }

  return session
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const url = new URL(req.url)
  const sinceEpoch = toSinceEpoch(url.searchParams.get("since"))
  const waitMs = toBoundedWaitMs(url.searchParams.get("wait_ms"))

  let session = getChatSession(sessionId)
  if (!session) {
    return NextResponse.json(
      { error: "session not found or expired" },
      { status: 404 }
    )
  }

  if (
    sinceEpoch &&
    waitMs > 0 &&
    session.updatedAt <= sinceEpoch &&
    !isTerminalStatus(session.status)
  ) {
    session = await waitForSessionChange(sessionId, sinceEpoch, waitMs)
    if (!session) {
      return NextResponse.json(
        { error: "session not found or expired" },
        { status: 404 }
      )
    }

    if (session.updatedAt <= sinceEpoch && !isTerminalStatus(session.status)) {
      return new NextResponse(null, { status: 204 })
    }
  }

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    status: session.status,
    stage: session.stage,
    progress_percent: session.progressPercent,
    status_message: session.statusMessage,
    result: session.result ?? null,
    error: session.error ?? null,
    payload: session.payload,
  })
}
