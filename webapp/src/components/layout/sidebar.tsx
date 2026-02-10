"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, FileText, Settings, BookOpen, LogOut, BrainCircuit } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const links = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/dashboard/assignments", label: "Assignments", icon: FileText },
  { href: "/dashboard/resources", label: "Resources", icon: BookOpen },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
]

interface SidebarContentProps {
  className?: string;
  onClick?: () => void;
}

export function SidebarContent({ className, onClick }: SidebarContentProps) {
  const pathname = usePathname()
  
  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="p-6 flex items-center gap-2 border-b">
        <BrainCircuit className="h-6 w-6 text-primary" />
        <span className="text-xl font-heading font-bold tracking-tight">Headstart AI</span>
      </div>
      
      <div className="flex-1 py-6 px-3">
        <nav className="flex flex-col gap-1">
          {links.map((link) => {
             const isActive = pathname === link.href
             return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                <span>{link.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="p-4 border-t">
         <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive">
            <LogOut className="h-4 w-4" />
            <span>Log out</span>
         </Button>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 border-r bg-card h-screen sticky top-0 flex-col">
       <SidebarContent />
    </aside>
  )
}