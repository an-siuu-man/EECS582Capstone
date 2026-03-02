import { NextResponse } from "next/server";
import { ensureRuntimeSession, getRuntimeSession } from "@/lib/chat-runtime-store";
import {
  createPersistedChatSession,
  getPersistedSessionSnapshot,
} from "@/lib/chat-repository";
import { startChatSessionRun } from "@/lib/chat-session-runner";
import { buildSessionDto } from "@/lib/chat-types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const payload = body?.payload;
  const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";

  if (!userId) {
    return NextResponse.json(
      { error: "user_id is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json(
      { error: "payload is required and must be an object" },
      { status: 400 },
    );
  }

  const requestId = crypto.randomUUID();

  try {
    const created = await createPersistedChatSession({
      userId,
      payload: payload as Record<string, unknown>,
      requestId,
    });

    ensureRuntimeSession(created.sessionId);

    startChatSessionRun({
      sessionId: created.sessionId,
      assignmentUuid: created.assignmentUuid,
      payload: created.payload,
    });

    const snapshot = await getPersistedSessionSnapshot(created.sessionId);
    if (!snapshot) {
      return NextResponse.json(
        { error: "session created but unavailable" },
        { status: 500 },
      );
    }

    const runtimeState = getRuntimeSession(created.sessionId);
    return NextResponse.json(buildSessionDto(snapshot, runtimeState));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create chat session", detail: message },
      { status: 500 },
    );
  }
}
