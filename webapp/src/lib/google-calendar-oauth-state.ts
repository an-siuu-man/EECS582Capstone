export const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "headstart_google_oauth_state";

export function createGoogleOAuthState() {
  return crypto.randomUUID();
}

export function googleOAuthStateCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.max(60, Math.floor(maxAgeSeconds)),
  };
}
