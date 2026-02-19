"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Dumbbell, TrendingUp, User, Settings, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", href: "/client/dashboard", icon: LayoutDashboard },
  { label: "Workouts", href: "/client/workouts", icon: Dumbbell },
  { label: "Progress", href: "/client/progress", icon: TrendingUp },
  { label: "Profile", href: "/client/profile", icon: User },
  { label: "Settings", href: "/client/settings", icon: Settings },
]

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 fixed inset-y-0 left-0 bg-white border-r border-border">
        <div className="p-6">
          <Link href="/client/dashboard">
            <span className="font-heading text-xl font-semibold text-primary tracking-tight">
              DJP Athlete
            </span>
          </Link>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-border">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            <LogOut className="size-5" strokeWidth={1.5} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        <main className="p-6">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-border z-30">
        <div className="flex items-center justify-around h-16">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
