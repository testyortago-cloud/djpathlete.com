"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Bot,
  Users,
  Dumbbell,
  ClipboardList,
  CreditCard,
  BarChart3,
  Brain,
  Star,
  Settings,
  LogOut,
} from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "AI Assistant", href: "/admin/ai-assistant", icon: Bot },
  { label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Exercises", href: "/admin/exercises", icon: Dumbbell },
  { label: "Programs", href: "/admin/programs", icon: ClipboardList },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { label: "AI Usage", href: "/admin/ai-usage", icon: Brain },
  { label: "Reviews", href: "/admin/reviews", icon: Star },
  { label: "Settings", href: "/admin/settings", icon: Settings },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex lg:flex-col w-64 bg-primary text-primary-foreground fixed top-0 left-0 h-screen z-30">
      {/* Logo */}
      <div className="px-6 pt-8 pb-5">
        <Link href="/admin/dashboard" className="flex items-center gap-2">
          <Image
            src="/logos/logo-icon-light.png"
            alt="DJP Athlete"
            width={120}
            height={80}
            className="object-contain"
            style={{ height: 72, width: "auto" }}
            priority
          />
          <span className="font-heading font-semibold tracking-[0.2em] text-[11px] uppercase text-white">
            Athlete
          </span>
        </Link>
        <p className="text-[10px] text-white/40 mt-1">Admin Dashboard</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
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

      {/* Logout */}
      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <LogOut className="size-5" strokeWidth={1.5} />
          Logout
        </button>
      </div>
    </aside>
  )
}
