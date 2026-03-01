/**
 * Artifact: webapp/src/app/api/chat-session/route.ts
 * Purpose: Creates an in-memory chat session for an assignment payload and starts asynchronous agent run orchestration.
 * Author: Ansuman Sharma
 * Created: 2026-03-01
 * Revised:
 * - 2026-03-01: Added standardized file-level prologue metadata and interface contracts. (Ansuman Sharma)
 * Preconditions:
 * - Executed in Next.js Node.js runtime with chat session store and runner modules available.
 * Inputs:
 * - Acceptable: HTTP POST JSON body containing `payload` as an object.
 * - Unacceptable: Missing `payload`, non-object payload values, or malformed JSON bodies.
 * Postconditions:
 * - On valid input, a chat session is created, background run execution is started, and session DTO is returned.
 * - On invalid input, a 400 JSON error response is returned.
 * Returns:
 * - HTTP JSON response containing serialized chat session state or validation error object.
 * Errors/Exceptions:
 * - Unhandled parsing/runtime failures may surface as route-level errors from Next.js runtime.
 */

import { NextResponse } from "next/server"
import { createChatSession, serializeChatSession } from "@/lib/chat-session-store"
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

  return NextResponse.json(serializeChatSession(session))
}
