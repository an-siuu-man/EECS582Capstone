"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { User, Settings as SettingsIcon, LogOut, Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SidebarContent } from "@/components/layout/sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { useAuthUser } from "@/hooks/use-auth-user"

export function Header() {
  const [open, setOpen] = React.useState(false)
  const [isSigningOut, setIsSigningOut] = React.useState(false)
  const router = useRouter()
  const { user } = useAuthUser()

  const displayName = user?.displayName || "Student"
  const email = user?.email || ""
  const avatarFallback = displayName
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "HS"

  async function handleSignOut() {
    if (isSigningOut) return

    setIsSigningOut(true)
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } finally {
      setIsSigningOut(false)
      router.replace("/login")
      router.refresh()
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border/60 bg-background/85 px-3 md:px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" size="icon-sm" className="rounded-full md:hidden">
              <Menu className="h-4 w-4" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation for the dashboard.
            </SheetDescription>
            <SidebarContent onClick={() => setOpen(false)} />
          </SheetContent>
        </Sheet>

        <p className="hidden text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase md:block">
          Workspace
        </p>
      </div>

      <div className="flex items-center gap-1.5 md:gap-2">
        <ModeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon-sm"
              className="relative rounded-full"
              disabled={isSigningOut}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback>{avatarFallback}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {email || "No email"}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/profile">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">
                <SettingsIcon className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={(event) => {
                event.preventDefault()
                void handleSignOut()
              }}
              disabled={isSigningOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>{isSigningOut ? "Logging out..." : "Log out"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
