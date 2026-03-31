import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import {
  getAssignmentDetailForUser,
  getLatestGuideVersion,
  listGuideVersions,
  listAssignmentSubmissionStatesForUser,
  listSignedSnapshotPdfFiles,
} from "@/lib/chat-repository";
import { toOptionalString } from "@/lib/utils";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AssignmentPriority = "High" | "Medium" | "Low";

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function derivePriority(dueAtISO: string | null): AssignmentPriority {
  const dueAt = toTimestamp(dueAtISO);
  if (dueAt == null) return "Low";
  const hoursUntilDue = (dueAt - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilDue <= 48) return "High";
  if (hoursUntilDue <= 24 * 7) return "Medium";
  return "Low";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await params;
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const normalizedId = toOptionalString(assignmentId);
  if (!normalizedId || !UUID_PATTERN.test(normalizedId)) {
    return NextResponse.json({ error: "Invalid assignment id" }, { status: 400 });
  }

  try {
    const detail = await getAssignmentDetailForUser({ userId, assignmentId: normalizedId });

    if (!detail) {
      return NextResponse.json(
        { error: "Assignment not found for current user" },
        { status: 404 },
      );
    }

    const {
      payload,
      snapshotDescriptionText,
      snapshotDescriptionHtml,
      snapshotRubricJson,
      snapshotPointsPossible,
      snapshotSubmissionType,
      latestAssignmentUuid,
      sessions,
      latestSessionId,
    } = detail;

    const [submissionStates, guideData, pdfFiles] = await Promise.all([
      listAssignmentSubmissionStatesForUser(userId, [normalizedId]),
      latestSessionId
        ? Promise.all([
            getLatestGuideVersion(latestSessionId),
            listGuideVersions(latestSessionId),
          ])
        : Promise.resolve([null, []] as const),
      latestAssignmentUuid
        ? listSignedSnapshotPdfFiles(latestAssignmentUuid).catch(() => [])
        : Promise.resolve([]),
    ]);

    const submissionState = submissionStates.get(normalizedId) ?? {
      isSubmitted: false,
      submittedAt: null,
    };

    const [latestGuide, versions] = Array.isArray(guideData)
      ? guideData
      : [null, []];

    const guideVersions = versions as Array<{
      version_number: number;
      source: string;
      content_length: number;
      created_at: string;
    }>;
    const firstGuideAt = guideVersions[0]?.created_at ?? null;

    // Prefer dedicated snapshot columns over raw_payload fields
    const dueAtISO =
      toOptionalString(payload.dueAtISO as string | undefined) ?? null;
    const descriptionText =
      snapshotDescriptionText ??
      toOptionalString(payload.descriptionText as string | undefined) ??
      null;
    const descriptionHtml =
      snapshotDescriptionHtml ??
      toOptionalString(payload.descriptionHtml as string | undefined) ??
      null;
    const rubric =
      (snapshotRubricJson as { criteria?: unknown[] } | null) ??
      (payload.rubric as { criteria?: unknown[] } | undefined) ??
      null;
    const pointsPossible =
      snapshotPointsPossible ??
      (payload.pointsPossible as number | undefined) ??
      null;
    const submissionType =
      snapshotSubmissionType ??
      toOptionalString(payload.submissionType as string | undefined) ??
      null;

    const dueAt = toTimestamp(dueAtISO);
    const isSubmitted = submissionState.isSubmitted;
    const isOverdue = !isSubmitted && dueAt != null && dueAt < Date.now();
    const priority = isSubmitted ? "Low" : derivePriority(dueAtISO);
    const attachmentCount = Array.isArray(payload.pdfAttachments)
      ? payload.pdfAttachments.length
      : 0;

    const response = NextResponse.json({
      ok: true,
      assignment_id: normalizedId,
      title:
        toOptionalString(payload.title as string | undefined) ??
        "(untitled assignment)",
      course_name:
        toOptionalString(payload.courseName as string | undefined) ?? null,
      due_at_iso: dueAtISO,
      points_possible: pointsPossible,
      submission_type: submissionType,
      description_text: descriptionText,
      description_html: descriptionHtml,
      canvas_url:
        toOptionalString(payload.url as string | undefined) ?? null,
      rubric,
      attachment_count: attachmentCount,
      is_submitted: isSubmitted,
      submitted_at: submissionState.submittedAt,
      is_overdue: isOverdue,
      priority,
      sessions: sessions.map((s) => ({
        session_id: s.sessionId,
        last_user_message: s.lastUserMessage,
        status: s.status,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      })),
      latest_session_id: latestSessionId,
      latest_guide_content:
        (latestGuide as { content_text?: string } | null)?.content_text ??
        null,
      guide_versions: guideVersions,
      has_guide: latestGuide !== null,
      first_guide_at: firstGuideAt,
      pdf_files: (
        pdfFiles as Array<{
          filename: string;
          byteSize: number | null;
          signedUrl: string;
        }>
      ).map((f) => ({
        filename: f.filename,
        byte_size: f.byteSize,
        signed_url: f.signedUrl,
      })),
    });

    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to load assignment detail", detail: message },
      { status: 500 },
    );
  }
}
