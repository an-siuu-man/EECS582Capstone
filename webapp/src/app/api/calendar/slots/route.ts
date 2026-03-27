import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import { getSharedAssignmentCalendarContextForChat } from "@/lib/assignment-calendar-context";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const assignmentId = toOptionalString(body?.assignment_id);
  if (!assignmentId) {
    return NextResponse.json({ error: "assignment_id is required" }, { status: 400 });
  }

  const timezone = toOptionalString(body?.timezone) ?? "UTC";
  if (!isValidTimezone(timezone)) {
    return NextResponse.json(
      { error: "timezone must be a valid IANA time zone" },
      { status: 400 },
    );
  }

  const rawEffort =
    typeof body?.estimated_effort_minutes === "number"
      ? body.estimated_effort_minutes
      : null;
  const estimatedEffortMinutes =
    rawEffort !== null ? Math.max(30, Math.min(480, Math.round(rawEffort))) : undefined;

  try {
    const context = await getSharedAssignmentCalendarContextForChat({
      userId,
      assignmentRecordId: assignmentId,
      requestUrl: req.url,
      timezone,
      estimatedEffortMinutes,
    });

    if (context.availability_reason === "assignment_unresolved") {
      return NextResponse.json(
        { error: "Assignment not found for this user" },
        { status: 404 },
      );
    }
    const response = NextResponse.json(context);

    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to detect free slots", detail: message },
      { status: 500 },
    );
  }
}

function toOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidTimezone(value: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
