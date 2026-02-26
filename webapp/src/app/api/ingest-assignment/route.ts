import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const payload = await req.json();

  const title = payload?.title ?? "(no title)";
  const courseId = payload?.courseId ?? "?";
  const assignmentId = payload?.assignmentId ?? "?";

  console.log(
    `[ingest-assignment] POST | course=${courseId} assignment=${assignmentId} title=${JSON.stringify(title)}`,
  );

  const assignment_uuid = crypto.randomUUID();

  console.log(`[ingest-assignment] Generated UUID: ${assignment_uuid}`);

  return NextResponse.json({ ok: true, assignment_uuid });
}
