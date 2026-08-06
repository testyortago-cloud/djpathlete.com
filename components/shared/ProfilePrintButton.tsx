"use client"

import { Printer } from "lucide-react"

/** Floating Save-as-PDF button. Never auto-prints — this is a public page. */
export function ProfilePrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="fixed right-4 top-4 z-50 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3.5 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-card print:hidden"
      aria-label="Save as PDF"
    >
      <Printer className="size-3.5" strokeWidth={1.5} />
      <span className="hidden sm:inline">Save PDF</span>
    </button>
  )
}
