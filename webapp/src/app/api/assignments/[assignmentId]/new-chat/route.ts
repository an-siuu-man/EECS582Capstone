import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import {
  getAssignmentDetailForUser,
  createChatSessionFromExistingSnapshot,
} from "@/lib/chat-repository";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await params;
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!UUID_PATTERN.test(assignmentId)) {
    return NextResponse.json({ error: "Invalid assignment id" }, { status: 400 });
  }

  try {
    const detail = await getAssignmentDetailForUser({ userId, assignmentId });

    if (!detail || !detail.latestSnapshotId) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    const title =
      typeof detail.payload.title === "string" && detail.payload.title.trim()
        ? detail.payload.title.trim()
        : "Chat";

    const { sessionId } = await createChatSessionFromExistingSnapshot({
      userId,
      snapshotId: detail.latestSnapshotId,
      title,
    });

    const response = NextResponse.json({ ok: true, session_id: sessionId });
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create chat session", detail: message },
      { status: 500 },
    );
  }
}
