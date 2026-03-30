import { NextResponse } from "next/server";
import {
  assertSessionOwnership,
  getGuideVersionContent,
} from "@/lib/chat-repository";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import { buildGuideDiff } from "@/lib/guide-diff";

export const runtime = "nodejs";

function toPositiveVersion(raw: string | null) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const resolvedUser = await resolveRequestUser(req);
  const userId = resolvedUser?.user.id ?? "";

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const session = await assertSessionOwnership(sessionId, userId);
  if (!session) {
    return NextResponse.json({ error: "Session not found for user" }, { status: 404 });
  }

  const url = new URL(req.url);
  const fromVersion = toPositiveVersion(url.searchParams.get("from_version"));
  const toVersion = toPositiveVersion(url.searchParams.get("to_version"));

  if (!fromVersion || !toVersion || fromVersion === toVersion) {
    return NextResponse.json(
      { error: "Invalid from_version or to_version" },
      { status: 400 },
    );
  }

  const [fromText, toText] = await Promise.all([
    getGuideVersionContent(sessionId, fromVersion),
    getGuideVersionContent(sessionId, toVersion),
  ]);

  if (fromText == null || toText == null) {
    return NextResponse.json(
      { error: "Guide version not found" },
      { status: 404 },
    );
  }

  const result = buildGuideDiff(fromText, toText);
  const response = NextResponse.json({
    ok: true,
    from_version: fromVersion,
    to_version: toVersion,
    summary: result.summary,
    diff: result.diff,
  });

  if (resolvedUser?.refreshedSession) {
    applyAuthCookies(response, resolvedUser.refreshedSession);
  }
  return response;
}
