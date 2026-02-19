"use client"

import { Bell, Menu, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"

interface AdminTopBarProps {
  onMenuClick?: () => void
}

export function AdminTopBar({ onMenuClick }: AdminTopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-white border-b border-border">
      <div className="flex items-center gap-3">
        {/* Mobile menu toggle */}
        <button
          className="lg:hidden p-2 text-foreground hover:bg-surface rounded-lg transition-colors"
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <Menu className="size-5" />
        </button>
        <div className="text-sm text-muted-foreground">
          Welcome back
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors">
          <Bell className="size-5" />
        </button>

        {/* Logout */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors"
          aria-label="Logout"
        >
          <LogOut className="size-5" />
        </button>

        {/* User avatar placeholder */}
        <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
          A
        </div>
      </div>
    </header>
  )
}
