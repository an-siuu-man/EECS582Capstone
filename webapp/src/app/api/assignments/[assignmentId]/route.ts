import { NextResponse } from "next/server";
import { invalidateAssignmentCalendarContextCache } from "@/lib/assignment-calendar-context";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import { deletePersistedAssignmentForUser } from "@/lib/chat-repository";
import { removeRuntimeSession } from "@/lib/chat-runtime-store";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await params;
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const normalizedAssignmentId = toOptionalString(assignmentId);
  if (!normalizedAssignmentId || !UUID_PATTERN.test(normalizedAssignmentId)) {
    return NextResponse.json({ error: "Invalid assignment id" }, { status: 400 });
  }

  try {
    const deleted = await deletePersistedAssignmentForUser({
      userId,
      assignmentId: normalizedAssignmentId,
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Assignment not found for current user" },
        { status: 404 },
      );
    }

    for (const sessionId of deleted.deletedSessionIds) {
      removeRuntimeSession(sessionId);
    }
    invalidateAssignmentCalendarContextCache({
      userId,
      assignmentId: normalizedAssignmentId,
    });

    const response = NextResponse.json({
      ok: true,
      assignment_id: deleted.assignmentId,
      deleted_session_ids: deleted.deletedSessionIds,
      deleted_session_count: deleted.deletedSessionCount,
      ingest_deleted_count: deleted.ingestDeletedCount,
      snapshot_deleted_count: deleted.snapshotDeletedCount,
      attachment_records_deleted: deleted.attachmentRecordsDeleted,
      blobs_deleted: deleted.blobsDeleted,
    });
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to delete assignment", detail: message },
      { status: 500 },
    );
  }
}

