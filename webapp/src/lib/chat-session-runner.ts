import {
  appendChatSessionGuideDelta,
  markChatSessionCompleted,
  markChatSessionFailed,
  markChatSessionRunning,
  type ChatSessionStage,
  updateChatSessionProgress,
} from "@/lib/chat-session-store"
import { type SseMessage, readSseStream } from "@/lib/sse"

type PdfAttachment = {
  filename?: string
  base64Data?: string
}

type AssignmentPayload = Record<string, unknown> & {
  pdfAttachments?: PdfAttachment[]
}

type AgentRunEventName =
  | "run.started"
  | "run.stage"
  | "run.delta"
  | "run.completed"
  | "run.error"
  | "run.heartbeat"

function toErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

function parseJsonObject(raw: string) {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected SSE data to be a JSON object.")
  }
  return parsed as Record<string, unknown>
}

function parseAgentRunEvent(message: SseMessage) {
  const eventName = message.event as AgentRunEventName
  if (!eventName.startsWith("run.")) {
    return null
  }

  const data = message.data ? parseJsonObject(message.data) : {}
  return {
    event: eventName,
    data,
  }
}

function toStage(value: unknown): ChatSessionStage {
  if (typeof value !== "string") return "calling_agent"
  if (
    value === "queued" ||
    value === "preparing_payload" ||
    value === "extracting_pdf" ||
    value === "calling_agent" ||
    value === "streaming_output" ||
    value === "validating_output" ||
    value === "parsing_response" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value
  }
  return "calling_agent"
}

function toPercent(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

async function openAgentStream(agentUrl: string, body: string) {
  const primaryUrl = `${agentUrl}/api/v1/runs/stream`
  const primary = await fetch(primaryUrl, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body,
  })

  if (primary.status !== 404) {
    return primary
  }

  return fetch(`${agentUrl}/run-agent/stream`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body,
  })
}

async function runAgentForSession(
  sessionId: string,
  payload: AssignmentPayload
) {
  let flushTimer: ReturnType<typeof setInterval> | null = null
  let bufferedDelta = ""
  let bufferedProgress: number | null = null
  let bufferedStatusMessage: string | null = null

  const flushBufferedDelta = () => {
    if (!bufferedDelta && bufferedProgress === null && !bufferedStatusMessage) {
      return
    }

    if (bufferedDelta) {
      appendChatSessionGuideDelta(sessionId, bufferedDelta, {
        progressPercent: bufferedProgress ?? undefined,
        statusMessage: bufferedStatusMessage ?? undefined,
      })
    } else {
      updateChatSessionProgress(sessionId, {
        stage: "streaming_output",
        progressPercent: bufferedProgress ?? 66,
        statusMessage: bufferedStatusMessage ?? "Generating guide",
      })
    }

    bufferedDelta = ""
    bufferedProgress = null
    bufferedStatusMessage = null
  }

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
      progressPercent: 56,
      statusMessage: "Connecting to agent stream",
    })

    const requestBody = JSON.stringify({
      assignment_uuid: assignmentUuid,
      payload: {
        ...payloadWithoutPdfs,
        assignment_uuid: assignmentUuid,
      },
      pdf_text: "",
      pdf_files: pdfFiles,
    })

    const streamResponse = await openAgentStream(agentUrl, requestBody)
    if (!streamResponse.ok) {
      const rawText = await streamResponse.text()
      throw new Error(`Agent service stream error (${streamResponse.status}): ${rawText}`)
    }

    if (!streamResponse.body) {
      throw new Error("Agent stream response has no body")
    }

    flushTimer = setInterval(flushBufferedDelta, 80)
    let hasCompleted = false

    for await (const message of readSseStream(streamResponse.body)) {
      const parsedEvent = parseAgentRunEvent(message)
      if (!parsedEvent) continue

      const { event, data } = parsedEvent

      if (event === "run.started" || event === "run.stage") {
        flushBufferedDelta()
        updateChatSessionProgress(sessionId, {
          stage: toStage(data.stage),
          progressPercent: toPercent(data.progress_percent, 56),
          statusMessage:
            typeof data.status_message === "string"
              ? data.status_message
              : "Generating guide",
        })
        continue
      }

      if (event === "run.delta") {
        if (typeof data.delta === "string" && data.delta.length > 0) {
          bufferedDelta += data.delta
        }
        if (data.progress_percent !== undefined) {
          bufferedProgress = toPercent(data.progress_percent, bufferedProgress ?? 66)
        }
        if (typeof data.status_message === "string" && data.status_message.trim()) {
          bufferedStatusMessage = data.status_message
        }
        continue
      }

      if (event === "run.completed") {
        flushBufferedDelta()
        const guideMarkdown =
          typeof data.guideMarkdown === "string" ? data.guideMarkdown : ""
        markChatSessionCompleted(sessionId, {
          guideMarkdown,
        })
        hasCompleted = true
        break
      }

      if (event === "run.error") {
        flushBufferedDelta()
        const errorMessage =
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : "Guide generation failed"
        throw new Error(errorMessage)
      }
    }

    flushBufferedDelta()
    if (!hasCompleted) {
      throw new Error("Agent stream ended before completion.")
    }
  } catch (err) {
    markChatSessionFailed(sessionId, toErrorMessage(err))
  } finally {
    if (flushTimer) {
      clearInterval(flushTimer)
    }
  }
}

export function startChatSessionRun(sessionId: string, payload: AssignmentPayload) {
  void runAgentForSession(sessionId, payload)
}
