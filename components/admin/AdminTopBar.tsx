"use client"

import { Menu, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { NotificationBell } from "@/components/shared/NotificationBell"
import { useAdminWeightUnit } from "@/hooks/use-admin-weight-unit"
import { cn } from "@/lib/utils"
import type { WeightUnit } from "@/types/database"

interface AdminTopBarProps {
  onMenuClick?: () => void
  avatarUrl?: string | null
  initials?: string
}

const unitOptions: { value: WeightUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "lbs", label: "lbs" },
]

export function AdminTopBar({ onMenuClick, avatarUrl, initials = "A" }: AdminTopBarProps) {
  const { unit, setUnit } = useAdminWeightUnit()

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
        <div className="text-sm text-muted-foreground">Welcome back</div>
      </div>

      <div className="flex items-center gap-3">
        {/* Weight unit toggle */}
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
          {unitOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setUnit(opt.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                unit === opt.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <NotificationBell />

        {/* Logout */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors"
          aria-label="Logout"
        >
          <LogOut className="size-5" />
        </button>

        {/* User avatar */}
        <Avatar>
          {avatarUrl && <AvatarImage src={avatarUrl} alt="Admin avatar" />}
          <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  )
}
