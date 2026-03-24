import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import {
  createGoogleCalendarEvent,
  getGoogleOAuthConfig,
  GoogleCalendarApiError,
  refreshGoogleAccessToken,
} from "@/lib/google-calendar";
import {
  getAssignmentCalendarMetadataForUser,
  getGoogleCalendarIntegration,
  upsertConnectedGoogleCalendarIntegration,
  upsertNeedsAttentionGoogleCalendarIntegration,
} from "@/lib/google-calendar-repository";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIso(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveEventWindow(input: {
  startAt: Date | null;
  endAt: Date | null;
  dueAt: Date | null;
}) {
  let start = input.startAt;
  let end = input.endAt;

  if (!start && !end) {
    if (!input.dueAt) {
      return null;
    }
    end = input.dueAt;
    start = new Date(end.getTime() - 60 * 60 * 1000);
  } else if (start && !end) {
    if (input.dueAt && input.dueAt.getTime() > start.getTime()) {
      end = input.dueAt;
    } else {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
  } else if (!start && end) {
    start = new Date(end.getTime() - 60 * 60 * 1000);
  }

  if (!start || !end) {
    return null;
  }
  if (end.getTime() <= start.getTime()) {
    return null;
  }

  return {
    start,
    end,
  };
}

function toExpiryIso(expiresInSeconds: number | null) {
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds)) {
    return null;
  }
  return new Date(Date.now() + Math.max(1, expiresInSeconds) * 1000).toISOString();
}

function isExpired(expiresAtIso: string | null) {
  if (!expiresAtIso) return true;
  const expiresAt = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - Date.now() <= 30_000;
}

export async function POST(req: Request) {
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const assignmentId = toOptionalString((body as Record<string, unknown> | null)?.assignment_id);
  if (!assignmentId || !UUID_PATTERN.test(assignmentId)) {
    return NextResponse.json(
      { error: "assignment_id must be a valid UUID" },
      { status: 400 },
    );
  }

  const startAtOverride = parseIso(
    toOptionalString((body as Record<string, unknown> | null)?.start_at_iso),
  );
  const endAtOverride = parseIso(
    toOptionalString((body as Record<string, unknown> | null)?.end_at_iso),
  );
  const timezoneOverride = toOptionalString(
    (body as Record<string, unknown> | null)?.timezone,
  );

  try {
    const integration = await getGoogleCalendarIntegration(userId);
    const isConnected = integration?.status === "connected";
    if (!integration || !isConnected) {
      return NextResponse.json(
        { error: "Google Calendar is not connected" },
        { status: 409 },
      );
    }

    const metadata = await getAssignmentCalendarMetadataForUser({
      userId,
      assignmentId,
    });
    if (!metadata) {
      return NextResponse.json(
        { error: "Assignment not found for current user" },
        { status: 404 },
      );
    }

    const dueAt = parseIso(metadata.dueAtISO);
    const window = deriveEventWindow({
      startAt: startAtOverride,
      endAt: endAtOverride,
      dueAt,
    });

    if (!window) {
      return NextResponse.json(
        {
          error:
            "Could not derive event start/end times. Provide start_at_iso/end_at_iso or ensure assignment has a due date.",
        },
        { status: 400 },
      );
    }

    let accessToken = integration.accessToken;
    const needsRefresh = !accessToken || isExpired(integration.tokenExpiresAt);

    if (needsRefresh) {
      const refreshToken = integration.refreshToken;
      if (!refreshToken) {
        await upsertNeedsAttentionGoogleCalendarIntegration({
          userId,
          lastError: "Missing refresh token.",
        }).catch(() => undefined);
        return NextResponse.json(
          { error: "Google Calendar authorization expired. Reconnect required." },
          { status: 409 },
        );
      }

      const config = getGoogleOAuthConfig(req.url);
      const refreshed = await refreshGoogleAccessToken({
        config,
        refreshToken,
      });
      accessToken = refreshed.accessToken;

      await upsertConnectedGoogleCalendarIntegration({
        userId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        scope: refreshed.scope ?? integration.scope,
        tokenExpiresAt: toExpiryIso(refreshed.expiresIn),
        googleEmail: integration.googleEmail,
      });
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Google access token after refresh." },
        { status: 500 },
      );
    }

    const summary = metadata.courseName
      ? `${metadata.title} (${metadata.courseName})`
      : metadata.title;
    const descriptionParts = [
      metadata.courseName ? `Course: ${metadata.courseName}` : null,
      metadata.assignmentUrl ? `Assignment URL: ${metadata.assignmentUrl}` : null,
      "Created by Headstart AI.",
    ].filter((value): value is string => Boolean(value && value.trim().length > 0));

    const createdEvent = await createGoogleCalendarEvent({
      accessToken,
      event: {
        summary,
        description: descriptionParts.join("\n"),
        startIso: window.start.toISOString(),
        endIso: window.end.toISOString(),
        timezone: timezoneOverride ?? metadata.timezone ?? undefined,
      },
    });

    const response = NextResponse.json({
      ok: true,
      event: {
        id: createdEvent.id,
        html_link: createdEvent.htmlLink,
        status: createdEvent.status,
      },
      assignment: {
        assignment_id: metadata.assignmentId,
        title: metadata.title,
        due_at_iso: metadata.dueAtISO,
      },
    });

    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  } catch (error) {
    if (
      error instanceof GoogleCalendarApiError &&
      (error.status === 400 || error.status === 401 || error.status === 403)
    ) {
      await upsertNeedsAttentionGoogleCalendarIntegration({
        userId,
        lastError: "Google authorization rejected by provider.",
      }).catch(() => undefined);
      return NextResponse.json(
        { error: "Google Calendar authorization expired. Reconnect required." },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create Google Calendar event", detail: message },
      { status: 500 },
    );
  }
}

