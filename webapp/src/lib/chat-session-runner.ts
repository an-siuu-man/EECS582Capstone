import {
  markChatSessionCompleted,
  markChatSessionFailed,
  markChatSessionRunning,
} from "@/lib/chat-session-store"

type PdfAttachment = {
  filename?: string
  base64Data?: string
}

type AssignmentPayload = Record<string, unknown> & {
  pdfAttachments?: PdfAttachment[]
}

function toErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

async function runAgentForSession(
  sessionId: string,
  payload: AssignmentPayload
) {
  try {
    markChatSessionRunning(sessionId)

    const assignmentUuid = crypto.randomUUID()
    const { pdfAttachments = [], ...payloadWithoutPdfs } = payload

    const pdfFiles = pdfAttachments
      .filter((item) => typeof item?.base64Data === "string" && item.base64Data.length > 0)
      .map((item) => ({
        filename: item.filename ?? "attachment.pdf",
        base64_data: item.base64Data as string,
      }))

    const agentUrl = process.env.AGENT_SERVICE_URL
    if (!agentUrl) {
      throw new Error("AGENT_SERVICE_URL not set")
    }

    const runResponse = await fetch(`${agentUrl}/run-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignment_uuid: assignmentUuid,
        payload: {
          ...payloadWithoutPdfs,
          assignment_uuid: assignmentUuid,
        },
        pdf_text: "",
        pdf_files: pdfFiles,
      }),
    })

    const rawText = await runResponse.text()
    if (!runResponse.ok) {
      throw new Error(`Agent service error (${runResponse.status}): ${rawText}`)
    }

    let parsedResult: unknown = rawText
    try {
      parsedResult = JSON.parse(rawText)
    } catch {
      parsedResult = rawText
    }

    markChatSessionCompleted(sessionId, parsedResult)
  } catch (err) {
    markChatSessionFailed(sessionId, toErrorMessage(err))
  }
}

export function startChatSessionRun(sessionId: string, payload: AssignmentPayload) {
  void runAgentForSession(sessionId, payload)
}
