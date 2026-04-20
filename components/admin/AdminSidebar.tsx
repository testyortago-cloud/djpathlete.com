"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
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
  Sparkles,
  Lightbulb,
  Star,
  MessageSquareQuote,
  Video,
  ClipboardCheck,
  CalendarCheck,
  Scale,
  ChevronDown,
  Settings,
  LogOut,
  ShoppingBag,
  Package,
  Megaphone,
  Film,
  Link2,
  TrendingUp,
} from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

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
      { label: "Testimonials", href: "/admin/testimonials", icon: MessageSquareQuote },
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
    title: "AI Automation",
    items: [
      { label: "Social", href: "/admin/social", icon: Megaphone },
      { label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
      { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
      { label: "Videos", href: "/admin/videos", icon: Film },
      { label: "Platform Connections", href: "/admin/platform-connections", icon: Link2 },
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
    title: "Legal",
    items: [{ label: "Legal Documents", href: "/admin/legal", icon: Scale }],
  },
]

export function AdminSidebar() {
  const pathname = usePathname()

  // Sections with a title are collapsible; auto-open if they contain the active route
  const initialOpen = navSections.reduce(
    (acc, section) => {
      if (section.title) {
        acc[section.title] = section.items.some((item) => pathname.startsWith(item.href))
      }
      return acc
    },
    {} as Record<string, boolean>,
  )

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpen)

  function toggleSection(title: string) {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }))
  }

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
          <span className="font-heading font-semibold tracking-[0.2em] text-[11px] uppercase text-white">Athlete</span>
        </Link>
        <p className="text-[10px] text-white/40 mt-1">Admin Dashboard</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-2 space-y-1">
        {navSections.map((section) => {
          const isOpen = !section.title || openSections[section.title]
          const hasActiveChild = section.items.some((item) => pathname.startsWith(item.href))

          return (
            <div key={section.title || "top"}>
              {section.title ? (
                <button
                  onClick={() => toggleSection(section.title)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors",
                    hasActiveChild && !isOpen ? "text-white/60" : "text-white/30 hover:text-white/50",
                  )}
                >
                  {section.title}
                  <ChevronDown
                    className={cn("size-3.5 transition-transform duration-200", isOpen ? "rotate-0" : "-rotate-90")}
                  />
                </button>
              ) : null}
              <div
                className={cn(
                  "space-y-0.5 overflow-hidden transition-all duration-200",
                  isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
                )}
              >
                {section.items.map((item) => {
                  const isActive = pathname.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
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
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 py-3 space-y-0.5 border-t border-white/10">
        <Link
          href="/admin/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            pathname.startsWith("/admin/settings")
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
    </aside>
  )
}
