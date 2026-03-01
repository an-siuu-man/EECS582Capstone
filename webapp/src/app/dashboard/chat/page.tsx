"use client"

import { type FormEvent, Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { Bot, FileText, LoaderCircle, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type PdfAttachment = {
  filename?: string
  base64Data?: string
}

type AssignmentPayload = {
  title?: string
  courseName?: string
  courseId?: string | number
  assignmentId?: string | number
  dueAtISO?: string
  pointsPossible?: number
  rubric?: {
    criteria?: unknown[]
  }
  pdfAttachments?: PdfAttachment[]
}

type ChatSessionStatus = "queued" | "running" | "completed" | "failed"

type ChatSessionResponse = {
  ok: boolean
  session_id: string
  created_at: number
  updated_at: number
  status: ChatSessionStatus
  result: unknown | null
  error: string | null
  payload: AssignmentPayload
}

type LocalChatMessage = {
  role: "user" | "assistant"
  content: string
}

function normalizeResult(result: unknown) {
  if (result == null) return result
  if (typeof result === "object") return result
  if (typeof result === "string") {
    try {
      return JSON.parse(result)
    } catch {
      return { tldr: result }
    }
  }
  return result
}

function buildGuideText(result: unknown) {
  const data = normalizeResult(result) as Record<string, unknown> | null
  const lines: string[] = []

  if (typeof data?.description === "string" && data.description.trim()) {
    lines.push(data.description)
    lines.push("")
  } else if (typeof data?.tldr === "string" && data.tldr.trim()) {
    lines.push(data.tldr)
    lines.push("")
  }

  if (Array.isArray(data?.keyRequirements) && data.keyRequirements.length) {
    lines.push("### Key Requirements")
    for (const item of data.keyRequirements) {
      lines.push(`- ${String(item)}`)
    }
    lines.push("")
  }

  if (Array.isArray(data?.deliverables) && data.deliverables.length) {
    lines.push("### Deliverables")
    for (const item of data.deliverables) {
      lines.push(`- ${String(item)}`)
    }
    lines.push("")
  }

  if (Array.isArray(data?.milestones) && data.milestones.length) {
    lines.push("### Milestones")
    for (const milestone of data.milestones as Array<Record<string, unknown>>) {
      const date = milestone?.date ? String(milestone.date) : ""
      const task = milestone?.task ? String(milestone.task) : ""
      const separator = date && task ? " - " : ""
      lines.push(`- ${date}${separator}${task}`.trim())
    }
    lines.push("")
  }

  if (Array.isArray(data?.studyPlan) && data.studyPlan.length) {
    lines.push("### Study Plan")
    for (const step of data.studyPlan as Array<Record<string, unknown>>) {
      const duration = step?.durationMin ? `${String(step.durationMin)} min` : ""
      const focus = step?.focus ? String(step.focus) : ""
      const separator = duration && focus ? " - " : ""
      lines.push(`- ${duration}${separator}${focus}`.trim())
    }
    lines.push("")
  }

  if (Array.isArray(data?.risks) && data.risks.length) {
    lines.push("### Risks")
    for (const item of data.risks) {
      lines.push(`- ${String(item)}`)
    }
    lines.push("")
  }

  if (lines.length === 0) {
    if (typeof result === "string") return result
    return JSON.stringify(result, null, 2)
  }

  return lines.join("\n").trim()
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function renderInlineMarkdown(input: string) {
  let html = escapeHtml(input)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>")
  return html
}

function markdownToHtml(input: string) {
  const lines = input.split("\n")
  const parts: string[] = []
  let listType: "ul" | "ol" | null = null

  const closeList = () => {
    if (listType) {
      parts.push(listType === "ul" ? "</ul>" : "</ol>")
      listType = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      continue
    }

    const headingMatch = trimmed.match(/^###\s+(.+)$/)
    if (headingMatch) {
      closeList()
      parts.push(`<h3>${renderInlineMarkdown(headingMatch[1])}</h3>`)
      continue
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (ulMatch) {
      if (listType !== "ul") {
        closeList()
        parts.push("<ul>")
        listType = "ul"
      }
      parts.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`)
      continue
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/)
    if (olMatch) {
      if (listType !== "ol") {
        closeList()
        parts.push("<ol>")
        listType = "ol"
      }
      parts.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`)
      continue
    }

    closeList()
    parts.push(`<p>${renderInlineMarkdown(trimmed)}</p>`)
  }

  closeList()
  return parts.join("")
}

function ChatPageFallback() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Chat</h1>
        <p className="text-muted-foreground">Loading chat session...</p>
      </div>
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">Preparing dashboard chat...</p>
        </CardContent>
      </Card>
    </div>
  )
}

function DashboardChatPageContent() {
  const searchParams = useSearchParams()
  const sessionId = (searchParams.get("session") || "").trim()

  const [session, setSession] = useState<ChatSessionResponse | null>(null)
  const [isSessionLoading, setIsSessionLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [localMessages, setLocalMessages] = useState<LocalChatMessage[]>([])

  useEffect(() => {
    if (!sessionId) {
      setSession(null)
      setErrorText("Missing session id in URL. Open this page from the extension.")
      return
    }

    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const loadSession = async () => {
      try {
        if (!cancelled) {
          setIsSessionLoading(true)
        }

        const res = await fetch(`/api/chat-session/${encodeURIComponent(sessionId)}`)
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || `Failed to load session (${res.status})`)
        }

        const data = (await res.json()) as ChatSessionResponse
        if (!cancelled) {
          setSession(data)
          setErrorText(null)
        }

        if (!cancelled && (data.status === "queued" || data.status === "running")) {
          pollTimer = setTimeout(loadSession, 2000)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Unknown error"
          setErrorText(`Unable to load chat session: ${message}`)
          pollTimer = setTimeout(loadSession, 3000)
        }
      } finally {
        if (!cancelled) {
          setIsSessionLoading(false)
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [sessionId])

  const payload = session?.payload
  const attachmentCount = payload?.pdfAttachments?.length ?? 0
  const createdAtText = useMemo(() => {
    if (!session?.created_at) return null
    return format(new Date(session.created_at), "MMM d, yyyy h:mm a")
  }, [session?.created_at])

  const guideMarkdown = useMemo(() => {
    if (!session || session.status !== "completed") return ""
    return buildGuideText(session.result)
  }, [session])

  const guideHtml = useMemo(() => markdownToHtml(guideMarkdown), [guideMarkdown])

  const isGenerating = session?.status === "queued" || session?.status === "running"

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return

    setLocalMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      {
        role: "assistant",
        content: "Follow-up chat transport is not wired yet. SSE streaming will be added next.",
      },
    ])
    setDraft("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Chat</h1>
        <p className="text-muted-foreground">
          The guide starts generating automatically after you click Generate Guide in the extension.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Assignment Context
            </CardTitle>
            <CardDescription>Session from extension handoff</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {isSessionLoading && <p className="text-muted-foreground">Loading session...</p>}

            {!isSessionLoading && !payload && (
              <p className="text-destructive">No session payload available.</p>
            )}

            {payload && (
              <>
                <div>
                  <p className="text-muted-foreground">Title</p>
                  <p className="font-medium">{payload.title || "(untitled assignment)"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Course</p>
                  <p className="font-medium">{payload.courseName || String(payload.courseId || "-")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Attachments: {attachmentCount}</Badge>
                  {payload.rubric?.criteria?.length ? (
                    <Badge variant="outline">Rubric: {payload.rubric.criteria.length}</Badge>
                  ) : null}
                </div>
                {payload.dueAtISO ? (
                  <div>
                    <p className="text-muted-foreground">Due</p>
                    <p className="font-medium">
                      {format(new Date(payload.dueAtISO), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                ) : null}
                {createdAtText ? (
                  <div>
                    <p className="text-muted-foreground">Session Created</p>
                    <p className="font-medium">{createdAtText}</p>
                  </div>
                ) : null}
                {session ? (
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-medium capitalize">{session.status}</p>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Assistant Output
            </CardTitle>
            <CardDescription>Guide generation progress and chat thread.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ScrollArea className="h-[430px] rounded-md border">
              <div className="space-y-3 p-4">
                <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm">
                  Assignment context received from extension.
                </div>

                {isGenerating && (
                  <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Generating guide...
                    </span>
                  </div>
                )}

                {session?.status === "completed" && (
                  <div
                    className="rounded-md border bg-card p-3 text-sm leading-6 [&_a]:text-blue-600 [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3:first-child]:mt-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: guideHtml }}
                  />
                )}

                {session?.status === "failed" && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    Error generating guide: {session.error || "Unknown error"}
                  </div>
                )}

                {localMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={
                      message.role === "user"
                        ? "ml-auto w-fit max-w-[85%] rounded-md border bg-blue-50 px-3 py-2 text-sm text-blue-900"
                        : "max-w-[85%] rounded-md border bg-card px-3 py-2 text-sm"
                    }
                  >
                    {message.content}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <form onSubmit={handleSend} className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask a follow-up question..."
              />
              <Button type="submit" disabled={draft.trim().length === 0}>
                <Send className="h-4 w-4" />
              </Button>
            </form>

            {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function DashboardChatPage() {
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <DashboardChatPageContent />
    </Suspense>
  )
}
