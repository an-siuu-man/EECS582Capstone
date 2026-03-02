import { NextResponse } from "next/server";
import {
  assertSessionOwnership,
  createChatMessage,
} from "@/lib/chat-repository";
import { emitChatMessageCreated, getRuntimeSession } from "@/lib/chat-runtime-store";
import { startFollowupChatRun } from "@/lib/chat-session-runner";

export const runtime = "nodejs";

function isGuideReady(sessionStatus: string, runtimeStatus: string | undefined) {
  return sessionStatus === "completed" || runtimeStatus === "completed";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = await req.json();

  const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  if (!userId) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 },
    );
  }

  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 },
    );
  }

  if (content.length > 8000) {
    return NextResponse.json(
      { error: "content is too long" },
      { status: 400 },
    );
  }

  const session = await assertSessionOwnership(sessionId, userId);
  if (!session) {
    return NextResponse.json(
      { error: "session not found for user" },
      { status: 404 },
    );
  }

  const runtime = getRuntimeSession(sessionId);
  if (!isGuideReady(session.status, runtime?.status)) {
    return NextResponse.json(
      { error: "Guide generation is still in progress" },
      { status: 409 },
    );
  }

  try {
    const userMessage = await createChatMessage({
      sessionId,
      role: "user",
      content,
      format: "markdown",
      metadata: {
        source: "dashboard",
      },
    });

    const assistantMessage = await createChatMessage({
      sessionId,
      role: "assistant",
      content: "",
      format: "markdown",
      metadata: {
        streaming: true,
      },
    });

    emitChatMessageCreated(sessionId, userMessage);
    emitChatMessageCreated(sessionId, assistantMessage);

    startFollowupChatRun({
      sessionId,
      assistantMessageId: assistantMessage.id,
      userMessageContent: content,
    });

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Unable to send message", detail: message },
      { status: 500 },
    );
  }
}
