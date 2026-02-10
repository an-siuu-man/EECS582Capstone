"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { Search, Filter, MoreVertical, Calendar as CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { assignments, courses, getCourse } from "@/lib/data"
import { Assignment } from "@/lib/types"
import { cn } from "@/lib/utils"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
}

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 }
}

export default function AssignmentsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("all")

  const filteredAssignments = assignments.filter((assignment) => {
    const matchesSearch = assignment.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTab = 
      activeTab === "all" ? true :
      activeTab === "pending" ? assignment.status !== "Completed" :
      activeTab === "completed" ? assignment.status === "Completed" : true
    
    return matchesSearch && matchesTab
  })

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">Assignments</h2>
          <p className="text-muted-foreground">Manage your tasks and deadlines.</p>
        </div>
        <div className="flex items-center gap-2">
           <Button variant="outline">
              <CalendarIcon className="mr-2 h-4 w-4" />
              Calendar View
           </Button>
           <Button>New Assignment</Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search assignments..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
           <Button variant="outline" size="icon">
              <Filter className="h-4 w-4" />
           </Button>
        </div>
      </div>

      <Tabs defaultValue="all" className="w-full" onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
           <AssignmentList assignments={filteredAssignments} />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
           <AssignmentList assignments={filteredAssignments} />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
           <AssignmentList assignments={filteredAssignments} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AssignmentList({ assignments }: { assignments: Assignment[] }) {
  if (assignments.length === 0) {
     return (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
           <p>No assignments found.</p>
        </div>
     )
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {assignments.map((assignment) => {
         const course = getCourse(assignment.courseId)
         return (
          <motion.div key={assignment.id} variants={item}>
            <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-1">
                   <Badge variant="outline" className={cn("mb-2", course?.color ? `border-${course.color.split("-")[1]}-200 text-${course.color.split("-")[1]}-700 bg-${course.color.split("-")[1]}-50` : "")}>
                      {course?.code}
                   </Badge>
                   <CardTitle className="text-base line-clamp-1" title={assignment.title}>
                      {assignment.title}
                   </CardTitle>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <span className="sr-only">Open menu</span>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>View details</DropdownMenuItem>
                    <DropdownMenuItem>Mark as completed</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="mt-auto pt-4">
                 <div className="flex items-center justify-between text-sm">
                    <div className={cn(
                       "flex items-center gap-1", 
                       new Date(assignment.dueDate) < new Date() && assignment.status !== "Completed" ? "text-destructive" : "text-muted-foreground"
                    )}>
                       <CalendarIcon className="h-4 w-4" />
                       <span>{format(new Date(assignment.dueDate), "MMM d")}</span>
                    </div>
                    <Badge variant={assignment.status === "Completed" ? "default" : "secondary"}>
                       {assignment.status}
                    </Badge>
                 </div>
              </CardContent>
            </Card>
          </motion.div>
        )
      })}
    </motion.div>
  )
}