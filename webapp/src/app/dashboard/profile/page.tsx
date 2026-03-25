"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { motion } from "framer-motion"
import {
  CalendarDays,
  CalendarRange,
  type LucideIcon,
  School,
  ShieldCheck,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuthUser } from "@/hooks/use-auth-user"
import { cn } from "@/lib/utils"

type IntegrationStatus = "Connected" | "Not Connected" | "Needs Attention"
type GoogleIntegrationStatus = "connected" | "disconnected" | "needs_attention"

type StaticIntegration = {
  name: string
  description: string
  note?: string
  icon: LucideIcon
}

type GoogleIntegrationView = {
  status: GoogleIntegrationStatus
  connected: boolean
  googleEmail: string | null
  lastError: string | null
}

const staticIntegrations: StaticIntegration[] = [
  {
    name: "Outlook Calendar",
    description: "Push due dates and reminders to Outlook for cross-device planning.",
    note: "Planned integration. Google Calendar is currently supported.",
    icon: CalendarRange,
  },
  {
    name: "Canvas LMS",
    description: "Import assignment metadata and submission windows from Canvas.",
    note: "To get the latest assignments info, you need to log into your Canvas account.",
    icon: School,
  },
]

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
}

function statusTone(status: IntegrationStatus) {
  if (status === "Connected") {
    return "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
  }

  if (status === "Needs Attention") {
    return "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
  }

  return "border-slate-300/70 bg-slate-50 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-300"
}

function toUiStatus(status: GoogleIntegrationStatus): IntegrationStatus {
  if (status === "connected") return "Connected"
  if (status === "needs_attention") return "Needs Attention"
  return "Not Connected"
}

export default function ProfilePage() {
  const { user } = useAuthUser()
  const searchParams = useSearchParams()
  const [googleIntegration, setGoogleIntegration] = useState<GoogleIntegrationView | null>(null)
  const [isGoogleLoading, setIsGoogleLoading] = useState(true)
  const [isGoogleActionPending, setIsGoogleActionPending] = useState(false)
  const [googleActionError, setGoogleActionError] = useState<string | null>(null)

  const displayName = user?.displayName || "Student"
  const email = user?.email || ""

  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const loadGoogleIntegration = useCallback(async () => {
    setIsGoogleLoading(true)
    try {
      const response = await fetch("/api/integrations/google-calendar", {
        method: "GET",
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error(`Failed to load integration state (${response.status})`)
      }

      const body = (await response.json()) as {
        integration?: {
          status?: GoogleIntegrationStatus
          connected?: boolean
          google_email?: string | null
          last_error?: string | null
        }
      }
      const integration = body.integration
      const status = integration?.status ?? "disconnected"
      setGoogleIntegration({
        status,
        connected: Boolean(integration?.connected),
        googleEmail: integration?.google_email ?? null,
        lastError: integration?.last_error ?? null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setGoogleIntegration({
        status: "needs_attention",
        connected: false,
        googleEmail: null,
        lastError: message,
      })
    } finally {
      setIsGoogleLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGoogleIntegration()
  }, [loadGoogleIntegration])

  const oauthMessage = useMemo(() => {
    const status = searchParams.get("googleCalendar")
    const reason = searchParams.get("reason")

    if (status === "connected") {
      return {
        tone: "success" as const,
        text: "Google Calendar connected successfully.",
      }
    }
    if (status === "error") {
      return {
        tone: "error" as const,
        text: reason
          ? `Google Calendar connection failed: ${reason.replaceAll("_", " ")}.`
          : "Google Calendar connection failed.",
      }
    }
    return null
  }, [searchParams])

  const uiGoogleStatus = toUiStatus(googleIntegration?.status ?? "disconnected")
  const isGoogleConnected = Boolean(googleIntegration?.connected)

  async function handleGoogleDisconnect() {
    setGoogleActionError(null)
    setIsGoogleActionPending(true)
    try {
      const response = await fetch("/api/integrations/google-calendar/disconnect", {
        method: "POST",
        cache: "no-store",
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Failed to disconnect (${response.status})`)
      }
      await loadGoogleIntegration()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setGoogleActionError(message)
    } finally {
      setIsGoogleActionPending(false)
    }
  }

  function handleGoogleConnect() {
    setGoogleActionError(null)
    window.location.assign("/api/integrations/google-calendar/connect")
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item}>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Review your account details and connected academic integrations.
        </p>
      </motion.div>

      <motion.div variants={item}>
        <Card className="border-border/60 bg-card/85 shadow-[0_12px_34px_-22px_rgba(15,23,42,0.45)]">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20 ring-2 ring-border/70">
                <AvatarFallback className="text-lg font-semibold">{initials}</AvatarFallback>
              </Avatar>

              <div>
                <p className="text-2xl font-heading font-bold tracking-tight">{displayName}</p>
                <p className="text-sm text-muted-foreground">{email || "No email"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-border/70 bg-background/70 px-3 py-1">
                    Student Account
                  </Badge>
                  <Badge variant="outline" className="border-border/70 bg-background/70 px-3 py-1">
                    University SSO
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/dashboard/settings">Account settings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card className="border-border/60 bg-card/90 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.5)]">
          <CardHeader>
            <CardTitle className="text-xl">Integrations</CardTitle>
            <CardDescription>
              Connect external tools to sync deadlines, reminders, and course context.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {oauthMessage ? (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  oauthMessage.tone === "success"
                    ? "border-emerald-300/80 bg-emerald-50 text-emerald-800"
                    : "border-red-300/80 bg-red-50 text-red-800"
                )}
              >
                {oauthMessage.text}
              </div>
            ) : null}

            {googleActionError ? (
              <div className="rounded-lg border border-red-300/80 bg-red-50 px-3 py-2 text-sm text-red-800">
                {googleActionError}
              </div>
            ) : null}

            <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-background/70 p-4 shadow-[0_10px_26px_-20px_rgba(15,23,42,0.48)] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-brand-blue/10 p-2 text-brand-blue">
                  <CalendarDays className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">Google Calendar</p>
                  <p className="text-sm text-muted-foreground">
                    Sync assignment deadlines and study blocks to your Google calendar.
                  </p>
                  {googleIntegration?.googleEmail ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connected account: {googleIntegration.googleEmail}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium",
                    statusTone(isGoogleLoading ? "Not Connected" : uiGoogleStatus)
                  )}
                >
                  {isGoogleLoading ? "Loading..." : uiGoogleStatus}
                </Badge>
                <Button
                  size="sm"
                  disabled={isGoogleLoading || isGoogleActionPending}
                  variant={isGoogleConnected ? "outline" : "default"}
                  onClick={isGoogleConnected ? handleGoogleDisconnect : handleGoogleConnect}
                >
                  {isGoogleActionPending
                    ? "Working..."
                    : isGoogleConnected
                      ? "Disconnect"
                      : "Connect"}
                </Button>
              </div>
            </div>

            {staticIntegrations.map((integration) => (
              <div
                key={integration.name}
                className="flex flex-col gap-4 rounded-xl border border-border/70 bg-background/70 p-4 shadow-[0_10px_26px_-20px_rgba(15,23,42,0.48)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-brand-blue/10 p-2 text-brand-blue">
                    <integration.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">{integration.name}</p>
                    <p className="text-sm text-muted-foreground">{integration.description}</p>
                  </div>
                </div>

                {integration.note ? (
                  <p className="text-sm text-muted-foreground sm:max-w-[22rem] sm:text-right">
                    {integration.note}
                  </p>
                ) : null}
              </div>
            ))}

            <div className="mt-4 rounded-lg border border-dashed border-border/80 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand-blue" />
                <span>All integrations use your existing university account permissions.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
