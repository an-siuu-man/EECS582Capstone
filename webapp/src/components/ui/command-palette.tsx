"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpen, FileText, MessageSquare } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"

type AssignmentResult = {
  id: string
  assignment_id: string | null
  title: string
  course_name: string | null
  status: string
}

type SessionResult = {
  session_id: string
  title: string
  last_user_message: string | null
  status: string
  context: { assignment_title: string; course_name: string | null }
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [assignments, setAssignments] = useState<AssignmentResult[]>([])
  const [sessions, setSessions] = useState<SessionResult[]>([])
  const [loaded, setLoaded] = useState(false)
  const router = useRouter()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!open || loaded) return

    void Promise.all([
      fetch("/api/assignments", { cache: "no-store" })
        .then((r) => r.json())
        .then((body: { assignments?: AssignmentResult[] }) => {
          setAssignments(Array.isArray(body.assignments) ? body.assignments.slice(0, 30) : [])
        })
        .catch(() => {}),
      fetch("/api/chat-session", { cache: "no-store" })
        .then((r) => r.json())
        .then((body: { sessions?: SessionResult[] }) => {
          setSessions(Array.isArray(body.sessions) ? body.sessions.slice(0, 30) : [])
        })
        .catch(() => {}),
    ]).then(() => setLoaded(true))
  }, [open, loaded])

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted md:inline-flex"
        aria-label="Open command palette"
      >
        <span>Search...</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search assignments and chats">
        <CommandInput placeholder="Search assignments, chats..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {assignments.length > 0 && (
            <CommandGroup heading="Assignments">
              {assignments.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`assignment-${a.title}-${a.course_name ?? ""}`}
                  onSelect={() =>
                    navigate(
                      a.assignment_id
                        ? `/dashboard/assignments/${encodeURIComponent(a.assignment_id)}`
                        : "/dashboard/assignments",
                    )
                  }
                >
                  <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{a.title}</p>
                    {a.course_name ? (
                      <p className="truncate text-xs text-muted-foreground">{a.course_name}</p>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {assignments.length > 0 && sessions.length > 0 && <CommandSeparator />}

          {sessions.length > 0 && (
            <CommandGroup heading="Chats">
              {sessions.map((s) => {
                const label =
                  s.last_user_message?.trim() ||
                  s.context.assignment_title ||
                  s.title ||
                  "Chat Session"
                return (
                  <CommandItem
                    key={s.session_id}
                    value={`chat-${label}-${s.context.course_name ?? ""}`}
                    onSelect={() =>
                      navigate(`/dashboard/chat?session=${encodeURIComponent(s.session_id)}`)
                    }
                  >
                    <MessageSquare className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{label}</p>
                      {s.context.assignment_title ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {s.context.assignment_title}
                        </p>
                      ) : null}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          <CommandSeparator />
          <CommandGroup heading="Navigate">
            <CommandItem value="dashboard home" onSelect={() => navigate("/dashboard")}>
              <BookOpen className="mr-2 h-4 w-4 text-muted-foreground" />
              Dashboard
            </CommandItem>
            <CommandItem value="assignments page" onSelect={() => navigate("/dashboard/assignments")}>
              <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
              Assignments
            </CommandItem>
            <CommandItem value="chat page" onSelect={() => navigate("/dashboard/chat")}>
              <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
              Chat
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
