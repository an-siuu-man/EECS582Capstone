import { NextResponse } from "next/server";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import {
  buildGoogleOAuthAuthorizeUrl,
  getGoogleOAuthConfig,
} from "@/lib/google-calendar";
import {
  createGoogleOAuthState,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  googleOAuthStateCookieOptions,
} from "@/lib/google-calendar-oauth-state";

export const runtime = "nodejs";

const OAUTH_STATE_TTL_SECONDS = 60 * 10;

export async function GET(req: Request) {
  const resolvedUser = await resolveRequestUser(req);
  if (!resolvedUser?.user.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const state = createGoogleOAuthState();
    const config = getGoogleOAuthConfig(req.url);
    const authorizeUrl = buildGoogleOAuthAuthorizeUrl({
      config,
      state,
    });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set({
      name: GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
      value: state,
      ...googleOAuthStateCookieOptions(OAUTH_STATE_TTL_SECONDS),
    });

    if (resolvedUser.refreshedSession) {
      applyAuthCookies(response, resolvedUser.refreshedSession);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to initialize Google OAuth", detail: message },
      { status: 500 },
    );
  }
}
