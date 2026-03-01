import {
  markChatSessionCompleted,
  markChatSessionFailed,
  markChatSessionRunning,
  updateChatSessionProgress,
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
  let callProgressTimer: ReturnType<typeof setInterval> | null = null
  try {
    markChatSessionRunning(sessionId)

    const assignmentUuid = crypto.randomUUID()
    const { pdfAttachments = [], ...payloadWithoutPdfs } = payload

    updateChatSessionProgress(sessionId, {
      stage: "preparing_payload",
      progressPercent: 30,
      statusMessage: "Preparing attachments",
    })

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

    updateChatSessionProgress(sessionId, {
      stage: "calling_agent",
      progressPercent: 60,
      statusMessage: "Calling agent service",
    })

    // While the LLM call is in flight, advance progress gradually to avoid a long static bar.
    // This is still an estimate (true step-level accuracy needs streaming/progress events).
    const callStartedAt = Date.now()
    let lastProgress = 60
    callProgressTimer = setInterval(() => {
      const elapsedSec = (Date.now() - callStartedAt) / 1000
      const estimated = 60 + Math.round(34 * (1 - Math.exp(-elapsedSec / 18)))
      const next = Math.min(94, Math.max(lastProgress, estimated))
      if (next > lastProgress) {
        lastProgress = next
        updateChatSessionProgress(sessionId, {
          stage: "calling_agent",
          progressPercent: next,
          statusMessage: "Calling agent service",
        })
      }
    }, 1500)

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

    if (callProgressTimer) {
      clearInterval(callProgressTimer)
      callProgressTimer = null
    }

    updateChatSessionProgress(sessionId, {
      stage: "parsing_response",
      progressPercent: 96,
      statusMessage: "Formatting guide output",
    })

    let parsedResult: unknown = rawText
    try {
      parsedResult = JSON.parse(rawText)
    } catch {
      parsedResult = rawText
    }

    markChatSessionCompleted(sessionId, parsedResult)
  } catch (err) {
    if (callProgressTimer) {
      clearInterval(callProgressTimer)
      callProgressTimer = null
    }
    markChatSessionFailed(sessionId, toErrorMessage(err))
  }
}

export function startChatSessionRun(sessionId: string, payload: AssignmentPayload) {
  void runAgentForSession(sessionId, payload)
}
