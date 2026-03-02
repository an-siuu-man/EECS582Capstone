"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { format, formatDistanceToNow } from "date-fns"
import { ArrowUpRight, BookOpen, CalendarDays, Clock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuthUser } from "@/hooks/use-auth-user"
import { cn } from "@/lib/utils"

type DashboardAssignment = {
  id: string
  title: string
  course_name: string | null
  due_at_iso: string | null
  latest_session_id: string
  updated_at: number
  priority: "High" | "Medium" | "Low"
}

type DashboardGuide = {
  id: string
  session_id: string
  title: string
  assignment_title: string
  course_name: string | null
  due_at_iso: string | null
  updated_at: number
  status: "Ready" | "Processing" | "Failed" | "Archived"
}

type DashboardData = {
  upcomingAssignments: DashboardAssignment[]
  generatedGuides: DashboardGuide[]
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0 },
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function priorityTone(priority: DashboardAssignment["priority"]) {
  if (priority === "High") return "border-red-200/80 bg-red-50 text-red-700"
  if (priority === "Medium") return "border-amber-200/80 bg-amber-50 text-amber-700"
  return "border-emerald-200/80 bg-emerald-50 text-emerald-700"
}

function guideTone(status: DashboardGuide["status"]) {
  if (status === "Ready") return "border-emerald-200/80 bg-emerald-50 text-emerald-700"
  if (status === "Failed") return "border-red-200/80 bg-red-50 text-red-700"
  if (status === "Archived") return "border-slate-200/80 bg-slate-50 text-slate-700"
  return "border-amber-200/80 bg-amber-50 text-amber-700"
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function parseEpochDate(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { user: authUser } = useAuthUser()

  useEffect(() => {
    let isDisposed = false

    const loadDashboard = async () => {
      try {
        const response = await fetch("/api/dashboard", {
          method: "GET",
          cache: "no-store",
        })
        if (!response.ok) {
          const bodyText = await response.text()
          throw new Error(bodyText || `Failed to load dashboard (${response.status})`)
        }

        const body = (await response.json()) as {
          assignments?: DashboardAssignment[]
          guides?: DashboardGuide[]
        }

        if (isDisposed) return
        setData({
          upcomingAssignments: Array.isArray(body.assignments) ? body.assignments : [],
          generatedGuides: Array.isArray(body.guides) ? body.guides : [],
        })
        setLoadError(null)
      } catch (error) {
        if (isDisposed) return
        const message = error instanceof Error ? error.message : String(error)
        setLoadError(message)
        setData({
          upcomingAssignments: [],
          generatedGuides: [],
        })
      }
    }

    void loadDashboard()
    return () => {
      isDisposed = true
    }
  }, [])

  if (!data && !loadError) {
    return (
      <div className="space-y-4">
        <Card className="h-32 animate-pulse bg-muted/30" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Card className="h-[420px] animate-pulse bg-muted/30" />
          <Card className="h-[420px] animate-pulse bg-muted/30" />
        </div>
      </div>
    )
  }

  const dashboardData = data ?? { upcomingAssignments: [], generatedGuides: [] }
  const readyGuides = dashboardData.generatedGuides.filter(
    (guide) => guide.status === "Ready",
  ).length
  const firstName = (authUser?.displayName || "Student").split(" ")[0]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={item}>
        <Card className="border-border/60 bg-card/85 shadow-[0_12px_34px_-22px_rgba(15,23,42,0.45)]">
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-blue">
                Dashboard
              </p>
              <h2 className="text-3xl font-heading font-bold tracking-tight">
                {greeting()}, {firstName}
              </h2>
              <p className="mt-1 text-muted-foreground">
                Live data from your saved assignment sessions and generated guides.
              </p>
              {loadError ? (
                <p className="mt-1 text-sm text-destructive">
                  Unable to refresh dashboard data right now.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-border/70 bg-background/80 px-3 py-1.5">
                Assignments: {dashboardData.upcomingAssignments.length}
              </Badge>
              <Badge variant="outline" className="border-border/70 bg-background/80 px-3 py-1.5">
                Guides ready: {readyGuides}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        variants={item}
        className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
      >
        <Card className="border-border/60 bg-card/90 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.5)]">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Assignments</CardTitle>
                <CardDescription>Upcoming work extracted from your saved contexts.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="gap-1.5">
                <Link href="/dashboard/chat">
                  Open chats
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboardData.upcomingAssignments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 p-6 text-center text-sm text-muted-foreground">
                No assignment context available yet.
              </div>
            ) : (
              dashboardData.upcomingAssignments.map((assignment) => {
                const dueAt = parseIsoDate(assignment.due_at_iso)

                return (
                  <Link
                    key={assignment.id}
                    href={`/dashboard/chat?session=${encodeURIComponent(
                      assignment.latest_session_id,
                    )}`}
                    className="group block rounded-xl border border-border/70 bg-background/70 p-4 shadow-[0_10px_26px_-20px_rgba(15,23,42,0.48)] transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-[0_18px_32px_-22px_rgba(15,23,42,0.55)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="line-clamp-1 font-medium text-foreground group-hover:text-brand-blue">
                          {assignment.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {assignment.course_name || "Unknown course"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0", priorityTone(assignment.priority))}
                      >
                        {assignment.priority}
                      </Badge>
                    </div>

                    {dueAt ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <CalendarDays className="h-4 w-4" />
                          {format(dueAt, "EEE, MMM d • h:mm a")}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          {formatDistanceToNow(dueAt, { addSuffix: true })}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />
                        No due date available
                      </div>
                    )}
                  </Link>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/90 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.5)]">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Generated Guides</CardTitle>
                <CardDescription>Latest outputs tied to your chat sessions.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="gap-1.5">
                <Link href="/dashboard/chat">
                  Open chat
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboardData.generatedGuides.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 p-6 text-center text-sm text-muted-foreground">
                No guides generated yet.
              </div>
            ) : (
              dashboardData.generatedGuides.map((guide) => {
                const generatedAt = parseEpochDate(guide.updated_at)
                return (
                  <Link
                    key={guide.id}
                    href={`/dashboard/chat?session=${encodeURIComponent(guide.session_id)}`}
                    className="group block rounded-xl border border-border/70 bg-background/70 p-4 shadow-[0_10px_26px_-20px_rgba(15,23,42,0.48)] transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-[0_18px_32px_-22px_rgba(15,23,42,0.55)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-1 font-medium text-foreground group-hover:text-brand-blue">
                          {guide.assignment_title || guide.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {guide.course_name || "Unknown course"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0", guideTone(guide.status))}
                      >
                        {guide.status}
                      </Badge>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <BookOpen className="h-4 w-4" />
                      {generatedAt
                        ? `Updated ${formatDistanceToNow(generatedAt, { addSuffix: true })}`
                        : "Recently updated"}
                    </div>
                  </Link>
                )
              })
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
