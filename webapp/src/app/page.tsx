"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { BrainCircuit, BookOpen, Clock, Zap, CheckCircle2, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2
    }
  }
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
}

export default function LandingPage() {
  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, id: string) => {
    e.preventDefault()
    const element = document.getElementById(id)
    if (element) {
      const offset = 64 // height of the fixed navbar
      const bodyRect = document.body.getBoundingClientRect().top
      const elementRect = element.getBoundingClientRect().top
      const elementPosition = elementRect - bodyRect
      const offsetPosition = elementPosition - offset

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      })
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Navbar */}
      <header className="h-16 flex items-center backdrop-blur-sm bg-background/80 fixed w-full z-50 border-b border-brand-gold/20 px-4 md:px-6">
        <div className="container mx-auto flex items-center">
          <Link className="flex items-center justify-center gap-2" href="#" onClick={(e) => {
            e.preventDefault()
            window.scrollTo({ top: 0, behavior: "smooth" })
          }}>
            <BrainCircuit className="h-6 w-6 text-brand-blue" />
            <span className="text-xl font-heading font-bold tracking-wide text-foreground">Headstart AI</span>
          </Link>
          <nav className="ml-auto flex gap-2 sm:gap-6">
            <a 
              className="hidden md:flex text-sm font-medium hover:text-brand-blue transition-colors items-center cursor-pointer" 
              onClick={(e) => scrollToSection(e, "features")}
            >
              Features
            </a>
            <a 
              className="hidden md:flex text-sm font-medium hover:text-brand-blue transition-colors items-center cursor-pointer" 
              onClick={(e) => scrollToSection(e, "how-it-works")}
            >
              How it Works
            </a>
            <ModeToggle />
            <Link href="/login">
              <Button variant="ghost" size="sm">Log In</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="bg-brand-blue hover:bg-brand-blue/90">Get Started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 pt-16">
        {/* Hero Section */}
        <section className="w-full py-24 md:py-32 lg:py-48 xl:py-60 relative overflow-hidden">
           <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>
           {/* KU Crimson and Blue Glows */}
           <div className="absolute left-[20%] top-[20%] -z-10 m-auto h-[310px] w-[310px] rounded-full bg-brand-blue/20 opacity-30 blur-[100px]"></div>
           <div className="absolute right-[20%] bottom-[20%] -z-10 m-auto h-[310px] w-[310px] rounded-full bg-brand-crimson/10 opacity-30 blur-[100px]"></div>
          
          <motion.div 
            className="container mx-auto px-4 md:px-6 flex flex-col items-center text-center space-y-4"
            variants={container}
            initial="hidden"
            animate="show"
          >
            <motion.h1 variants={item} className="text-4xl font-heading font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
              Master Your Assignments with <span className="text-brand-blue">AI</span>
            </motion.h1>
            <motion.p variants={item} className="mx-auto max-w-[700px] text-muted-foreground md:text-xl font-light">
              Headstart AI integrates with Canvas LMS to generate personalized study plans, resources, and insights for every assignment.
            </motion.p>
            <motion.div variants={item} className="space-x-4 pt-4">
              <Link href="/signup">
                <Button size="lg" className="h-12 px-8 text-lg bg-brand-blue text-primary-foreground shadow-lg shadow-brand-blue/20 hover:bg-brand-blue/90">
                  Start Learning
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Button 
                variant="outline" 
                size="lg" 
                className="h-12 px-8 text-lg border-brand-blue/20 text-brand-blue hover:bg-brand-blue/5"
                onClick={(e) => scrollToSection(e, "features")}
              >
                Learn More
              </Button>
            </motion.div>
          </motion.div>
        </section>

        {/* Features Section */}
        <section id="features" className="w-full py-12 md:py-24 lg:py-32 bg-muted/30 border-y border-brand-gold/10">
          <div className="container mx-auto px-4 md:px-6">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-2">
                <h2 className="text-3xl font-sans font-bold tracking-tighter sm:text-5xl">
                  Intelligent Assistance
                </h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  Everything you need to stay ahead of your coursework, automatically synced and generated.
                </p>
              </div>
            </div>
            <div className="mx-auto grid max-w-5xl items-center gap-6 py-12 lg:grid-cols-3">
              <motion.div whileHover={{ y: -5 }} className="flex flex-col items-center space-y-4 p-6 bg-card rounded-xl border border-brand-blue/10 shadow-sm hover:border-brand-blue/30 transition-colors">
                <div className="p-3 rounded-full bg-brand-blue/10 text-brand-blue">
                  <Zap className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-sans font-bold">Instant Integration</h3>
                <p className="text-center text-muted-foreground">
                  Seamlessly connects with Canvas LMS to detect new assignments instantly via our Chrome Extension.
                </p>
              </motion.div>
              <motion.div whileHover={{ y: -5 }} className="flex flex-col items-center space-y-4 p-6 bg-card rounded-xl border border-brand-gold/10 shadow-sm hover:border-brand-gold/30 transition-colors">
                <div className="p-3 rounded-full bg-brand-gold/10 text-brand-gold">
                  <BookOpen className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-sans font-bold">Smart Resources</h3>
                <p className="text-center text-muted-foreground">
                  Automatically generates step-by-step guides, summaries, and curated resources for every task.
                </p>
              </motion.div>
              <motion.div whileHover={{ y: -5 }} className="flex flex-col items-center space-y-4 p-6 bg-card rounded-xl border border-brand-crimson/10 shadow-sm hover:border-brand-crimson/30 transition-colors">
                <div className="p-3 rounded-full bg-brand-crimson/10 text-brand-crimson">
                  <Clock className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-sans font-bold">Time Management</h3>
                <p className="text-center text-muted-foreground">
                  Get realistic time estimates and scheduling suggestions to beat procrastination.
                </p>
              </motion.div>
            </div>
          </div>
        </section>
        
        {/* How it Works / Tech Stack */}
         <section id="how-it-works" className="w-full py-12 md:py-24 lg:py-32">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid gap-10 lg:grid-cols-2 items-center">
               <div className="space-y-4">
                  <h2 className="text-3xl font-sans font-bold tracking-tighter sm:text-4xl md:text-5xl">
                     Agentic Workflow
                  </h2>
                  <p className="text-muted-foreground md:text-lg">
                     Headstart AI isn&apos;t just a todo list. It&apos;s an intelligent agent that works in the background.
                  </p>
                  <ul className="grid gap-3 py-4">
                     <li className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-brand-blue" />
                        <span>Detects assignment updates in real-time.</span>
                     </li>
                     <li className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-brand-blue" />
                        <span>Classifies deliverables and requirements.</span>
                     </li>
                     <li className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-brand-blue" />
                        <span>Generates PDF guides and structured plans.</span>
                     </li>
                     <li className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-brand-blue" />
                        <span>Notifies you via the extension and dashboard.</span>
                     </li>
                  </ul>
                  <Button variant="secondary" className="border border-brand-gold/30 hover:bg-brand-gold/10">View Architecture</Button>
               </div>
               <div className="mx-auto w-full max-w-[500px] aspect-square rounded-xl bg-gradient-to-tr from-brand-blue/20 via-brand-crimson/5 to-background border border-brand-gold/20 flex items-center justify-center relative overflow-hidden">
                   <div className="absolute inset-0 bg-grid-slate-400/12 [mask-image:linear-gradient(0deg,rgba(247,249,252,0.9),rgba(241,245,249,0.55))] dark:[mask-image:linear-gradient(0deg,rgba(226,232,240,0.12),transparent)]" />
                   <BrainCircuit className="h-32 w-32 text-brand-blue/80" />
               </div>
            </div>
          </div>
        </section>
      </main>
      
      <footer className="w-full py-6 px-4 md:px-6 border-t border-brand-gold/20">
        <div className="container mx-auto flex flex-col gap-2 sm:flex-row items-center">
          <p className="text-xs text-muted-foreground">© 2026 Headstart AI. All rights reserved.</p>
          <nav className="sm:ml-auto flex gap-4 sm:gap-6">
            <Link className="text-xs hover:underline underline-offset-4 hover:text-brand-blue" href="#">
              Terms of Service
            </Link>
            <Link className="text-xs hover:underline underline-offset-4 hover:text-brand-blue" href="#">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
