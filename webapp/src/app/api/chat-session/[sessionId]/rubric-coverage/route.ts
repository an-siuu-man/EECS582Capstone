import { NextResponse } from "next/server";
import {
  assertSessionOwnership,
  getGuideVersionContent,
  getSessionGuideAndHistory,
} from "@/lib/chat-repository";
import { applyAuthCookies, resolveRequestUser } from "@/lib/auth/session";
import { analyzeRubricCoverage } from "@/lib/rubric-coverage";

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
  const version = toPositiveVersion(url.searchParams.get("version"));
  if (!version) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const [guideVersionContent, sessionGuideAndHistory] = await Promise.all([
    getGuideVersionContent(sessionId, version),
    getSessionGuideAndHistory(sessionId),
  ]);

  if (guideVersionContent == null) {
    return NextResponse.json({ error: "Guide version not found" }, { status: 404 });
  }

  if (!sessionGuideAndHistory) {
    return NextResponse.json({ error: "Session not found for user" }, { status: 404 });
  }

  const coverage = analyzeRubricCoverage(
    guideVersionContent,
    sessionGuideAndHistory.payload,
  );

  const response = NextResponse.json({
    ok: true,
    version_number: version,
    rubric_available: coverage.rubric_available,
    criteria: coverage.criteria,
  });

  if (resolvedUser?.refreshedSession) {
    applyAuthCookies(response, resolvedUser.refreshedSession);
  }
  return response;
}
