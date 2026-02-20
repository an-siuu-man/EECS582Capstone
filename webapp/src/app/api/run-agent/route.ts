import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json(); // expects { assignment_uuid, payload, pdf_text? }

  const agentUrl = process.env.AGENT_SERVICE_URL;
  if (!agentUrl) {
    return NextResponse.json(
      { error: "AGENT_SERVICE_URL not set" },
      { status: 500 }
    );
  }

  const resp = await fetch(`${agentUrl}/run-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await resp.text();

  if (!resp.ok) {
    return NextResponse.json(
      { error: "Agent service error", detail: text },
      { status: 500 }
    );
  }

  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}