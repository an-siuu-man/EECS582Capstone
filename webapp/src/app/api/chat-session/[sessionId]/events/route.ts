import { NextResponse } from "next/server"
import {
  getChatSession,
  serializeChatSession,
  subscribeToChatSession,
  type ChatSessionRecord,
} from "@/lib/chat-session-store"

export const runtime = "nodejs"

const encoder = new TextEncoder()

function isTerminalStatus(status: string) {
  return status === "completed" || status === "failed"
}

function formatSseEvent(event: string, data: unknown, eventId?: string) {
  const lines: string[] = []
  if (eventId) {
    lines.push(`id: ${eventId}`)
  }
  lines.push(`event: ${event}`)

  const payload = JSON.stringify(data)
  for (const line of payload.split("\n")) {
    lines.push(`data: ${line}`)
  }

  lines.push("")
  return `${lines.join("\n")}\n`
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const initialSession = getChatSession(sessionId)
  if (!initialSession) {
    return NextResponse.json(
      { error: "session not found or expired" },
      { status: 404 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let unsubscribe = () => {}

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        unsubscribe()
        req.signal.removeEventListener("abort", onAbort)
        try {
          controller.close()
        } catch {
          // Ignore close errors caused by racing disconnects.
        }
      }

      const emit = (event: string, data: unknown, eventId?: string) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(formatSseEvent(event, data, eventId)),
          )
        } catch {
          cleanup()
        }
      }

      const emitSession = (eventName: string, session: ChatSessionRecord) => {
        emit(eventName, serializeChatSession(session), String(session.updatedAt))
        if (isTerminalStatus(session.status)) {
          emit(
            "session.terminal",
            {
              session_id: session.id,
              status: session.status,
            },
            `${session.updatedAt}-terminal`,
          )
          cleanup()
        }
      }

      const onAbort = () => {
        cleanup()
      }

      emitSession("session.snapshot", initialSession)
      if (closed) {
        return
      }

      unsubscribe = subscribeToChatSession(sessionId, (session) => {
        emitSession("session.update", session)
      })

      heartbeatTimer = setInterval(() => {
        emit("session.heartbeat", { ts: Date.now() })
      }, 15000)

      req.signal.addEventListener("abort", onAbort)
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  })
}
