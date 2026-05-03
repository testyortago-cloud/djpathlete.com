"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  X,
  LayoutDashboard,
  Bot,
  Users,
  Dumbbell,
  ClipboardList,
  FileText,
  Mail,
  CreditCard,
  BarChart3,
  Brain,
  CalendarDays,
  Lightbulb,
  Sparkles,
  Star,
  Video,
  ClipboardCheck,
  CalendarCheck,
  Settings,
  LogOut,
  ShoppingBag,
  Package,
  Users2,
} from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

function isHrefActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/")
}

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

interface NavSection {
  title: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    title: "",
    items: [{ label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Coaching",
    items: [
      { label: "Clients", href: "/admin/clients", icon: Users },
      { label: "Programs", href: "/admin/programs", icon: ClipboardList },
      { label: "Exercises", href: "/admin/exercises", icon: Dumbbell },
      { label: "Form Reviews", href: "/admin/form-reviews", icon: Video },
      { label: "Assessments", href: "/admin/performance-assessments", icon: ClipboardCheck },
    ],
  },
  {
    title: "Content",
    items: [
      { label: "Blog", href: "/admin/blog", icon: FileText },
      { label: "Newsletter", href: "/admin/newsletter", icon: Mail },
    ],
  },
  {
    title: "AI Tools",
    items: [
      { label: "AI Assistant", href: "/admin/ai-assistant", icon: Bot },
      { label: "AI Usage", href: "/admin/ai-usage", icon: Brain },
      { label: "AI Insights", href: "/admin/ai-insights", icon: Lightbulb },
      { label: "AI Templates", href: "/admin/ai-templates", icon: FileText },
      { label: "AI Policy", href: "/admin/settings/ai-policy", icon: Sparkles },
    ],
  },
  {
    title: "Business",
    items: [
      { label: "Bookings", href: "/admin/bookings", icon: CalendarCheck },
      { label: "Events", href: "/admin/events", icon: CalendarDays },
      { label: "Payments", href: "/admin/payments", icon: CreditCard },
      { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
      { label: "Reviews", href: "/admin/reviews", icon: Star },
    ],
  },
  {
    title: "Shop",
    items: [
      { label: "Products", href: "/admin/shop/products", icon: ShoppingBag },
      { label: "Orders", href: "/admin/shop/orders", icon: Package },
    ],
  },
  {
    title: "Team Videos",
    items: [{ label: "Team Videos", href: "/admin/team-videos", icon: Video }],
  },
  {
    title: "Team",
    items: [{ label: "Team", href: "/admin/team", icon: Users2 }],
  },
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
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-primary text-primary-foreground lg:hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <Image
              src="/logos/logo-icon-light.png"
              alt="DJP Athlete"
              width={120}
              height={80}
              className="object-contain"
              style={{ height: 72, width: "auto" }}
            />
            <span className="font-heading font-semibold tracking-[0.2em] text-[11px] uppercase text-white">
              Athlete
            </span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-2 space-y-4">
          {navSections.map((section) => (
            <div key={section.title || "top"}>
              {section.title && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = isHrefActive(pathname, item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-white/70 hover:text-white hover:bg-white/10",
                      )}
                    >
                      <Icon className="size-[18px]" strokeWidth={1.5} />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="px-3 py-3 space-y-0.5 border-t border-white/10">
          <Link
            href="/admin/settings"
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isHrefActive(pathname, "/admin/settings")
                ? "bg-accent text-accent-foreground"
                : "text-white/70 hover:text-white hover:bg-white/10",
            )}
          >
            <Settings className="size-[18px]" strokeWidth={1.5} />
            Settings
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <LogOut className="size-[18px]" strokeWidth={1.5} />
            Logout
          </button>
        </div>
      </div>
    </>
  )
}
