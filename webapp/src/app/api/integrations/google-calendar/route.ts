import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import { getGoogleCalendarIntegration } from "@/lib/google-calendar-repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const integration = await getGoogleCalendarIntegration(userId);
    const status = integration?.status ?? "disconnected";
    const connected =
      status === "connected" && Boolean(integration?.refreshToken || integration?.accessToken);

    const response = NextResponse.json({
      ok: true,
      integration: {
        provider: "google_calendar",
        status,
        connected,
        google_email: integration?.googleEmail ?? null,
        connected_at: integration?.connectedAt ?? null,
        token_expires_at: integration?.tokenExpiresAt ?? null,
        last_error: integration?.lastError ?? null,
      },
    });

    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to load Google Calendar integration status", detail: message },
      { status: 500 },
    );
  }
}
