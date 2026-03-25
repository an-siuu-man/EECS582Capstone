import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import { revokeGoogleToken } from "@/lib/google-calendar";
import {
  getGoogleCalendarIntegration,
  upsertDisconnectedGoogleCalendarIntegration,
} from "@/lib/google-calendar-repository";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const integration = await getGoogleCalendarIntegration(userId);
    let revokeError: string | null = null;

    const tokenToRevoke = integration?.refreshToken ?? integration?.accessToken ?? null;
    if (tokenToRevoke) {
      await revokeGoogleToken(tokenToRevoke).catch((error) => {
        revokeError = error instanceof Error ? error.message : String(error);
      });
    }

    const disconnected = await upsertDisconnectedGoogleCalendarIntegration({
      userId,
      lastError: revokeError,
    });

    const response = NextResponse.json({
      ok: true,
      integration: {
        provider: "google_calendar",
        status: disconnected.status,
        connected: false,
      },
      revoke_error: revokeError,
    });

    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to disconnect Google Calendar", detail: message },
      { status: 500 },
    );
  }
}
