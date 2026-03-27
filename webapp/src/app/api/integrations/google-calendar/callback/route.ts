import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import {
  exchangeGoogleCodeForTokens,
  getGoogleOAuthConfig,
} from "@/lib/google-calendar";
import {
  getGoogleCalendarIntegration,
  upsertConnectedGoogleCalendarIntegration,
  upsertDisconnectedGoogleCalendarIntegration,
} from "@/lib/google-calendar-repository";
import { invalidateAssignmentCalendarContextCache } from "@/lib/assignment-calendar-context";
import {
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  googleOAuthStateCookieOptions,
} from "@/lib/google-calendar-oauth-state";

export const runtime = "nodejs";

const OAUTH_STATE_TTL_SECONDS = 60 * 10;

function profileRedirect(req: Request, status: "connected" | "error", reason?: string) {
  const url = new URL("/dashboard/profile", req.url);
  url.searchParams.set("googleCalendar", status);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(url);
}

function readCookieFromRequest(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const segment of cookieHeader.split(";")) {
    const [rawKey, ...rawParts] = segment.split("=");
    if (rawKey?.trim() !== name) continue;
    const joined = rawParts.join("=").trim();
    return joined ? decodeURIComponent(joined) : null;
  }
  return null;
}

function clearOAuthStateCookie(response: NextResponse) {
  response.cookies.set({
    name: GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
    value: "",
    ...googleOAuthStateCookieOptions(OAUTH_STATE_TTL_SECONDS),
    maxAge: 0,
  });
}

function toExpiryIso(expiresInSeconds: number | null) {
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds)) {
    return null;
  }
  return new Date(Date.now() + Math.max(1, expiresInSeconds) * 1000).toISOString();
}

export async function GET(req: Request) {
  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";
  if (!userId) {
    const response = NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
    clearOAuthStateCookie(response);
    return response;
  }

  const url = new URL(req.url);
  const state = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";
  const oauthError = url.searchParams.get("error")?.trim() ?? "";
  const cookieState =
    readCookieFromRequest(req, GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.trim() ?? "";

  const mismatchState = !state || !cookieState || state !== cookieState;
  if (mismatchState) {
    await upsertDisconnectedGoogleCalendarIntegration({
      userId,
      lastError: "OAuth state mismatch.",
    }).catch(() => undefined);
    invalidateAssignmentCalendarContextCache({ userId });
    const response = profileRedirect(req, "error", "state_mismatch");
    clearOAuthStateCookie(response);
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  }

  if (oauthError) {
    await upsertDisconnectedGoogleCalendarIntegration({
      userId,
      lastError: oauthError,
    }).catch(() => undefined);
    invalidateAssignmentCalendarContextCache({ userId });
    const response = profileRedirect(req, "error", oauthError);
    clearOAuthStateCookie(response);
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  }

  if (!code) {
    await upsertDisconnectedGoogleCalendarIntegration({
      userId,
      lastError: "OAuth callback missing code.",
    }).catch(() => undefined);
    invalidateAssignmentCalendarContextCache({ userId });
    const response = profileRedirect(req, "error", "missing_code");
    clearOAuthStateCookie(response);
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  }

  try {
    const config = getGoogleOAuthConfig(req.url);
    const exchanged = await exchangeGoogleCodeForTokens({
      config,
      code,
    });
    const existing = await getGoogleCalendarIntegration(userId);
    const refreshToken = exchanged.refreshToken ?? existing?.refreshToken ?? null;

    if (!refreshToken) {
      throw new Error("Google OAuth did not provide a refresh token.");
    }

    await upsertConnectedGoogleCalendarIntegration({
      userId,
      accessToken: exchanged.accessToken,
      refreshToken,
      scope: exchanged.scope,
      tokenExpiresAt: toExpiryIso(exchanged.expiresIn),
    });
    invalidateAssignmentCalendarContextCache({ userId });

    const response = profileRedirect(req, "connected");
    clearOAuthStateCookie(response);
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertDisconnectedGoogleCalendarIntegration({
      userId,
      lastError: message,
    }).catch(() => undefined);
    invalidateAssignmentCalendarContextCache({ userId });

    const response = profileRedirect(req, "error", "oauth_callback_failed");
    clearOAuthStateCookie(response);
    if (resolvedUser?.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }
    return response;
  }
}
