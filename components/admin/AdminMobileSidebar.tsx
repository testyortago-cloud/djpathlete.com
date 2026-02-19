"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { X, LayoutDashboard, Users, Dumbbell, ClipboardList, CreditCard, BarChart3, Star, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Exercises", href: "/admin/exercises", icon: Dumbbell },
  { label: "Programs", href: "/admin/programs", icon: ClipboardList },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { label: "Reviews", href: "/admin/reviews", icon: Star },
  { label: "Settings", href: "/admin/settings", icon: Settings },
]

interface AdminMobileSidebarProps {
  open: boolean
  onClose: () => void
}

export function AdminMobileSidebar({ open, onClose }: AdminMobileSidebarProps) {
  const pathname = usePathname()

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-primary text-primary-foreground lg:hidden">
        <div className="flex items-center justify-between p-6">
          <span className="font-heading text-xl font-semibold text-white tracking-tight">
            DJP Athlete
          </span>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="size-5" />
          </button>
        </div>
        <nav className="px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                )}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}
