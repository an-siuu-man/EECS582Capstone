import { NextResponse } from "next/server"
import { createChatSession } from "@/lib/chat-session-store"
import { startChatSessionRun } from "@/lib/chat-session-runner"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = await req.json()
  const payload = body?.payload

  if (!payload || typeof payload !== "object") {
    return NextResponse.json(
      { error: "payload is required and must be an object" },
      { status: 400 }
    )
  }

  const assignmentPayload = payload as Record<string, unknown>
  const session = createChatSession(assignmentPayload)
  startChatSessionRun(session.id, assignmentPayload)

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    status: session.status,
    stage: session.stage,
    progress_percent: session.progressPercent,
    status_message: session.statusMessage,
  })
}
