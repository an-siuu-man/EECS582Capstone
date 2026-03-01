"use client"

import { type FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Bot, FileText, LoaderCircle, Send } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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
import { Progress } from "@/components/ui/progress"
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
type ChatSessionStage =
  | "queued"
  | "preparing_payload"
  | "calling_agent"
  | "parsing_response"
  | "completed"
  | "failed"

type ChatSessionResponse = {
  ok: boolean
  session_id: string
  created_at: number
  updated_at: number
  status: ChatSessionStatus
  stage: ChatSessionStage
  progress_percent: number
  status_message: string
  result: unknown | null
  error: string | null
  payload: AssignmentPayload
}

type LocalChatMessage = {
  role: "user" | "assistant"
  content: string
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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

function extractGuideMarkdown(result: unknown) {
  const data = normalizeResult(result) as Record<string, unknown> | null
  if (typeof data?.guideMarkdown === "string" && data.guideMarkdown.trim()) {
    return data.guideMarkdown
  }
  if (typeof data?.description === "string" && data.description.trim()) {
    return data.description
  }
  if (typeof data?.tldr === "string" && data.tldr.trim()) {
    return data.tldr
  }
  if (typeof result === "string") {
    return result
  }
  return JSON.stringify(result, null, 2)
}

function stageLabel(stage: ChatSessionStage) {
  switch (stage) {
    case "queued":
      return "Queued"
    case "preparing_payload":
      return "Preparing"
    case "calling_agent":
      return "Calling Agent"
    case "parsing_response":
      return "Parsing Response"
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
    default:
      return stage
  }
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
  const [isInitialLoading, setIsInitialLoading] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [localMessages, setLocalMessages] = useState<LocalChatMessage[]>([])
  const [showProgressPanel, setShowProgressPanel] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(0)
  const threadContainerRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  function scrollThreadToBottom(behavior: ScrollBehavior = "smooth") {
    const viewport = threadContainerRef.current?.querySelector<HTMLDivElement>(
      "[data-slot='scroll-area-viewport']"
    )
    if (!viewport) return
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    })
  }

  useEffect(() => {
    if (!sessionId) {
      setSession(null)
      setErrorText("Missing session id in URL. Open this page from the extension.")
      return
    }

    let cancelled = false
    let controller: AbortController | null = null
    let retryDelayMs = 2000
    let lastSeenUpdatedAt = 0

    const runPollingLoop = async () => {
      setIsInitialLoading(true)
      setErrorText(null)

      while (!cancelled) {
        const waitMs = document.hidden ? 30000 : 25000
        const query = new URLSearchParams()
        query.set("wait_ms", String(lastSeenUpdatedAt > 0 ? waitMs : 0))
        if (lastSeenUpdatedAt > 0) {
          query.set("since", String(lastSeenUpdatedAt))
        }

        const requestUrl = `/api/chat-session/${encodeURIComponent(sessionId)}?${query.toString()}`
        controller = new AbortController()

        try {
          if (lastSeenUpdatedAt > 0) {
            setIsPolling(true)
          }

          const response = await fetch(requestUrl, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          })

          if (cancelled) {
            break
          }

          if (response.status === 204) {
            setIsInitialLoading(false)
            setIsPolling(false)
            continue
          }

          if (!response.ok) {
            const text = await response.text()
            throw new Error(text || `Failed to load session (${response.status})`)
          }

          const data = (await response.json()) as ChatSessionResponse
          if (cancelled) {
            break
          }

          setSession(data)
          setErrorText(null)
          setIsInitialLoading(false)
          setIsPolling(false)
          retryDelayMs = 2000
          lastSeenUpdatedAt = data.updated_at

          if (data.status === "completed" || data.status === "failed") {
            break
          }
        } catch (err) {
          if (cancelled) {
            break
          }

          if (err instanceof DOMException && err.name === "AbortError") {
            break
          }

          const message = err instanceof Error ? err.message : "Unknown error"
          setErrorText(`Unable to load chat session: ${message}`)
          setIsInitialLoading(false)
          setIsPolling(false)
          await sleep(retryDelayMs)
          retryDelayMs = Math.min(retryDelayMs * 2, 12000)
        }
      }
    }

    void runPollingLoop()

    return () => {
      cancelled = true
      if (controller) {
        controller.abort()
      }
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
    return extractGuideMarkdown(session.result)
  }, [session])

  const isGenerating = session?.status === "queued" || session?.status === "running"
  const progressValue = Math.max(0, Math.min(100, session?.progress_percent ?? 0))

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null

    if (isGenerating) {
      setShowProgressPanel(true)
      setDisplayProgress(progressValue)
    } else if (session?.status === "completed") {
      setShowProgressPanel(true)
      setDisplayProgress(100)
      hideTimer = setTimeout(() => {
        setShowProgressPanel(false)
      }, 900)
    } else if (session?.status === "failed") {
      setShowProgressPanel(false)
    }

    return () => {
      if (hideTimer) {
        clearTimeout(hideTimer)
      }
    }
  }, [isGenerating, progressValue, session?.status])

  const progressLabel = session?.status === "completed" ? "Guide ready" : session?.status_message || "Generating guide..."
  const progressPanelTone =
    session?.status === "completed"
      ? "rounded-lg border border-emerald-300/60 bg-emerald-50/80 p-3 text-sm"
      : "rounded-lg border border-brand-gold/40 bg-brand-gold/10 p-3 text-sm"

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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollThreadToBottom("smooth")
      })
    })
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={reduceMotion ? undefined : { duration: 0.45, ease: EASE_OUT }}
      className="relative w-full space-y-6 overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-b from-background via-background to-muted/20 p-4 shadow-[0_30px_90px_-45px_rgba(2,6,23,0.6)] md:p-6"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_-5%,rgba(148,163,184,0.12),transparent_62%),radial-gradient(120%_70%_at_50%_110%,rgba(100,116,139,0.08),transparent_68%)]" />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={reduceMotion ? undefined : { duration: 0.35, ease: EASE_OUT, delay: 0.05 }}
        className="relative flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/60 p-4 backdrop-blur sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-blue">
            Dashboard Chat
          </p>
          <h1 className="text-3xl font-heading font-bold tracking-tight">Guide Workspace</h1>
          <p className="text-muted-foreground">
            The guide starts automatically after you click Generate Guide in the extension.
          </p>
        </div>
        {session ? (
          <Badge variant="outline" className="w-fit border-brand-blue/40 bg-brand-blue/10 px-3 py-1.5 text-brand-blue">
            {stageLabel(session.stage)}
          </Badge>
        ) : null}
      </motion.div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={reduceMotion ? undefined : { duration: 0.4, ease: EASE_OUT, delay: 0.1 }}
        className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]"
      >
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: -8 }}
          animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
          transition={reduceMotion ? undefined : { duration: 0.35, ease: EASE_OUT, delay: 0.15 }}
          className="min-w-0"
        >
          <Card className="h-full border-border/50 bg-card/85 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Assignment Context
            </CardTitle>
            <CardDescription>Session from extension handoff</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {isInitialLoading && !session ? (
              <p className="text-muted-foreground">Loading session...</p>
            ) : null}

            {!isInitialLoading && !payload ? (
              <p className="text-destructive">No session payload available.</p>
            ) : null}

            {payload ? (
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
                  <>
                    <div>
                      <p className="text-muted-foreground">Status</p>
                      <p className="font-medium capitalize">{session.status}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Stage</p>
                      <p className="font-medium">{stageLabel(session.stage)}</p>
                    </div>
                    {isPolling ? (
                      <p className="text-xs text-muted-foreground">Syncing latest state...</p>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: 8 }}
          animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
          transition={reduceMotion ? undefined : { duration: 0.35, ease: EASE_OUT, delay: 0.18 }}
          className="min-w-0"
        >
          <Card className="flex h-[min(70vh,780px)] min-h-[480px] min-w-0 flex-col border-border/50 bg-card/90 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Assistant Output
            </CardTitle>
            <CardDescription>Guide generation progress and chat thread.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div ref={threadContainerRef} className="min-h-0 flex-1">
              <ScrollArea className="h-full rounded-xl border border-border/60 bg-gradient-to-b from-muted/15 via-card to-card">
                <div className="space-y-3 p-4 pr-5">
                <div className="rounded-lg border border-dashed border-brand-blue/35 bg-brand-blue/5 p-3 text-sm">
                  Assignment context received from extension.
                </div>

                <AnimatePresence initial={false}>
                  {showProgressPanel && session ? (
                    <motion.div
                      key={`progress-${session.status}`}
                      initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.98 }}
                      transition={reduceMotion ? undefined : { duration: 0.28, ease: EASE_OUT }}
                      className={progressPanelTone}
                    >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 font-medium text-foreground">
                        {session.status !== "completed" ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : null}
                        {progressLabel}
                      </span>
                      <span className="text-xs font-semibold text-foreground/70">{displayProgress}%</span>
                    </div>
                    <Progress value={displayProgress} />
                  </motion.div>
                  ) : null}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {session?.status === "completed" ? (
                    <motion.div
                      key="guide-body"
                      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                      transition={reduceMotion ? undefined : { duration: 0.35, ease: EASE_OUT }}
                      className="rounded-xl border border-border/60 bg-card p-4 text-sm leading-6 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.55)]"
                    >
                    <div className="[&_a]:font-medium [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1:first-child]:mt-0 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2:first-child]:mt-0 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3:first-child]:mt-0 [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {guideMarkdown}
                      </ReactMarkdown>
                    </div>
                  </motion.div>
                  ) : null}
                </AnimatePresence>

                {session?.status === "failed" ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    Error generating guide: {session.error || "Unknown error"}
                  </div>
                ) : null}

                {localMessages.map((message, index) => (
                  <motion.div
                    key={`${message.role}-${index}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                    transition={reduceMotion ? undefined : { duration: 0.24, ease: EASE_OUT }}
                    className={
                      message.role === "user"
                        ? "ml-auto w-fit max-w-[85%] rounded-2xl border border-brand-blue/35 bg-brand-blue/10 px-3 py-2 text-sm text-blue-900 shadow-sm"
                        : "max-w-[85%] rounded-2xl border border-border/70 bg-card px-3 py-2 text-sm shadow-sm"
                    }
                  >
                    {message.content}
                  </motion.div>
                ))}
                </div>
              </ScrollArea>
            </div>

            <form onSubmit={handleSend} className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask a follow-up question..."
                className="border-transparent bg-transparent focus-visible:ring-0"
              />
              <Button type="submit" disabled={draft.trim().length === 0} className="rounded-lg bg-brand-blue text-primary-foreground hover:bg-brand-blue/90">
                <Send className="h-4 w-4" />
              </Button>
            </form>

            {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
          </CardContent>
        </Card>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

export default function DashboardChatPage() {
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <DashboardChatPageContent />
    </Suspense>
  )
}
