"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { CalendarDays, CheckCircle2, Clock, BookOpen, ArrowUpRight, MoreHorizontal } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { fetchDashboardData, getCourse } from "@/lib/data"
import { Assignment, Stat, User } from "@/lib/types"
import { cn } from "@/lib/utils"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
}

export default function Dashboard() {
  const [data, setData] = useState<{
    user: User;
    stats: Stat[];
    upcomingAssignments: Assignment[];
    recentActivity: Assignment[];
  } | null>(null)

  useEffect(() => {
    fetchDashboardData().then(setData)
  }, [])

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">{greeting()}, {data.user.name.split(" ")[0]}</h2>
          <p className="text-muted-foreground">Here&apos;s what&apos;s on your schedule today.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button>
            <Clock className="mr-2 h-4 w-4" />
            Study Mode
          </Button>
        </div>
      </motion.div>

      <motion.div variants={item} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {data.stats.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.label}
              </CardTitle>
              {stat.trend === "up" ? (
                <ArrowUpRight className="h-4 w-4 text-green-500" />
              ) : stat.trend === "down" ? (
                 <ArrowUpRight className="h-4 w-4 text-red-500 rotate-90" />
              ) : (
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.change} from last week
              </p>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <motion.div variants={item} className="col-span-4">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Upcoming Assignments</CardTitle>
              <CardDescription>
                You have {data.upcomingAssignments.length} assignments due soon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.upcomingAssignments.map((assignment) => {
                  const course = getCourse(assignment.courseId)
                  return (
                    <div
                      key={assignment.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn("w-2 h-12 rounded-full", course?.color || "bg-gray-200")} />
                        <div className="space-y-1">
                          <p className="font-medium leading-none">{assignment.title}</p>
                          <p className="text-sm text-muted-foreground">{course?.code} - {course?.name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                         <div className="text-right">
                            <p className="text-sm font-medium">{format(new Date(assignment.dueDate), "MMM d")}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(assignment.dueDate), "h:mm a")}</p>
                         </div>
                         <Badge variant={assignment.priority === "High" ? "destructive" : "secondary"}>
                           {assignment.priority}
                         </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div variants={item} className="col-span-3 space-y-4">
           <Card>
            <CardHeader>
              <CardTitle>Recent Resources</CardTitle>
              <CardDescription>
                Generated study guides and summaries.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                     <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
                        <BookOpen className="h-4 w-4" />
                     </div>
                     <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">Chapter {i + 4} Summary</p>
                        <p className="text-xs text-muted-foreground">Generated 2 hours ago</p>
                     </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
             <CardHeader>
                <CardTitle>Study Streak</CardTitle>
                <CardDescription>
                   Keep up the momentum!
                </CardDescription>
             </CardHeader>
             <CardContent>
                <div className="flex items-baseline gap-2">
                   <span className="text-4xl font-bold">12</span>
                   <span className="text-sm font-medium text-muted-foreground">days</span>
                </div>
                <div className="mt-4 h-2 w-full bg-secondary rounded-full overflow-hidden">
                   <div className="h-full bg-primary w-[80%]" />
                </div>
             </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}