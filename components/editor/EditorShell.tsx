"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { EditorSidebar } from "./EditorSidebar"
import { EditorMobileSidebar } from "./EditorMobileSidebar"

interface EditorShellProps {
  user: { name: string; email: string }
  children: React.ReactNode
}

export function EditorShell({ user, children }: EditorShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-surface">
      <EditorSidebar user={user} />
      <EditorMobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} user={user} />

      <div className="flex-1 flex flex-col min-w-0 lg:ml-60">
        {/* Mobile top bar — only renders below lg */}
        <header className="lg:hidden flex items-center justify-between border-b bg-primary text-primary-foreground px-4 py-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-2 hover:bg-white/10"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/70">
            Edit Bay
          </span>
          <div className="w-9" aria-hidden />
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
