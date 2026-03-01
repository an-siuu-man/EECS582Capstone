import { NextResponse } from "next/server"
import { getChatSession } from "@/lib/chat-session-store"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const session = getChatSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { error: "session not found or expired" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    status: session.status,
    result: session.result ?? null,
    error: session.error ?? null,
    payload: session.payload,
  })
}
