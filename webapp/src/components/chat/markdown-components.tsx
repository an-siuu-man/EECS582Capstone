"use client"

import { useState, useCallback, type ReactNode } from "react"
import { Copy, Check } from "lucide-react"
import type { Components } from "react-markdown"

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: unknown }).props
    if (props && typeof props === "object" && "children" in props) {
      return extractText((props as { children: ReactNode }).children)
    }
  }
  return ""
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [code])

  const Icon = copied ? Check : Copy

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy code"
      className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background/80 group-hover:opacity-100"
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

export const MARKDOWN_COMPONENTS: Components = {
  pre: (props) => {
    const { children, node, ...rest } = props
    void node
    const code = extractText(children)
    return (
      <pre {...rest} className="group relative">
        <CopyCodeButton code={code} />
        {children}
      </pre>
    )
  },
  table: (props) => {
    const { node, ...tableProps } = props
    void node
    return (
      <div className="my-3 w-full overflow-x-auto">
        <table {...tableProps} />
      </div>
    )
  },
}
