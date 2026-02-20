import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const payload = await req.json();

  console.log("[ingest-assignment] received:", payload);

  const assignment_uuid = crypto.randomUUID();

  return NextResponse.json({ ok: true, assignment_uuid });
}