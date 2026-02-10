"use client"

import { BookOpen, FileText, Download, ExternalLink } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const resources = [
  { title: "AI Ethics Guide", type: "PDF", size: "1.2 MB" },
  { title: "Linear Algebra Summary", type: "Markdown", size: "45 KB" },
  { title: "Web Systems Best Practices", type: "PDF", size: "3.4 MB" },
]

export default function ResourcesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Resources</h1>
        <p className="text-muted-foreground">Generated study materials and external links.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {resources.map((res, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
               <div className="space-y-1">
                  <CardTitle>{res.title}</CardTitle>
                  <CardDescription>{res.type} • {res.size}</CardDescription>
               </div>
               <div className="p-2 bg-brand-blue/10 rounded-lg text-brand-blue">
                  <BookOpen className="h-4 w-4" />
               </div>
            </CardHeader>
            <CardContent>
               <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1">
                     <Download className="mr-2 h-4 w-4" />
                     Download
                  </Button>
                  <Button variant="ghost" size="sm">
                     <ExternalLink className="h-4 w-4" />
                  </Button>
               </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
         <h2 className="text-xl font-sans font-bold">External Links</h2>
         <div className="grid gap-2">
            {["University Library", "Canvas LMS", "Headstart Documentation"].map(link => (
               <a key={link} href="#" className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <span className="font-medium">{link}</span>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
               </a>
            ))}
         </div>
      </div>
    </div>
  );
}
