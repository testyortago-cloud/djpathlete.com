"use client"

import { useEffect, useState } from "react"
import { Printer, Moon, Sun } from "lucide-react"

export type ReportTheme = "light" | "dark"

const STORAGE_KEY = "djp-report-theme"

/**
 * Document shell for the test report: owns the palette scope and the toolbar.
 *
 * The scope classes (`.report-light` / `.athlete-arena`) define the SAME token
 * names, so every child renders correctly in either theme with no per-component
 * change — that is what makes a runtime toggle possible at all.
 *
 * Children are server-rendered and pass straight through; only the wrapper is
 * client-side, so toggling costs no refetch.
 */
export function ReportShell({
  initialTheme = "light",
  children,
}: {
  initialTheme?: ReportTheme
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<ReportTheme>(initialTheme)

  // Restore the viewer's last choice. Deliberately after mount so the server
  // markup and the first client render agree (no hydration mismatch); the
  // ?theme= param still decides what the very first paint looks like.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === "light" || saved === "dark") setTheme(saved)
    } catch {
      // Private mode / blocked storage — the default theme is fine.
    }
  }, [])

  function toggle() {
    const next: ReportTheme = theme === "dark" ? "light" : "dark"
    setTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Non-fatal: the toggle still works for this visit.
    }
  }

  const scope = theme === "dark" ? "athlete-arena" : "report-light"

  return (
    <main
      className={`${scope} test-report print-document min-h-screen bg-background font-body text-foreground`}
      data-report-theme={theme}
    >
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-card"
        >
          {theme === "dark" ? <Sun className="size-3.5" strokeWidth={1.5} /> : <Moon className="size-3.5" strokeWidth={1.5} />}
          <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Save as PDF"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-card"
        >
          <Printer className="size-3.5" strokeWidth={1.5} />
          <span className="hidden sm:inline">Save PDF</span>
        </button>
      </div>
      {children}
    </main>
  )
}
