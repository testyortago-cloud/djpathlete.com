"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  FilmIcon,
  Settings,
  LogOut,
  Upload,
  type LucideIcon,
} from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"

function isHrefActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/")
}

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Optional kicker shown to the right of the label (e.g. shortcut hint or count) */
  kicker?: string
}

interface NavSection {
  /** Tracked-uppercase label rendered above the items. Empty string = no header. */
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "",
    items: [{ label: "Dashboard", href: "/editor/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Workshop",
    items: [
      { label: "Submissions", href: "/editor/submissions", icon: FilmIcon },
      { label: "New upload", href: "/editor/upload", icon: Upload },
    ],
  },
  {
    title: "Account",
    items: [{ label: "Settings", href: "/editor/settings", icon: Settings }],
  },
]

interface EditorSidebarProps {
  user: { name: string; email: string }
}

export function EditorSidebar({ user }: EditorSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex lg:flex-col w-60 bg-primary text-primary-foreground fixed top-0 left-0 h-screen z-30">
      {/* Header / brand mark */}
      <div className="px-6 pt-8 pb-5">
        <Link href="/editor/dashboard" className="flex items-center gap-2">
          <Image
            src="/logos/logo-icon-light.png"
            alt="DJP Athlete"
            width={120}
            height={80}
            className="object-contain"
            style={{ height: 56, width: "auto" }}
            priority
          />
          <span className="font-mono font-medium tracking-[0.22em] text-[10px] uppercase text-white">
            Edit Bay
          </span>
        </Link>
        <p className="mt-1 font-mono text-[9px] tracking-[0.18em] uppercase text-white/40">
          Editor Workspace
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-2 space-y-3">
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.title || `top-${sIdx}`} className="space-y-0.5">
            {section.title && (
              <div className="px-3 pt-2 pb-1 font-mono text-[9px] tracking-[0.22em] uppercase text-white/30">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const isActive = isHrefActive(pathname, item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-white/70 hover:text-white hover:bg-white/10",
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={1.5} />
                  <span className="flex-1">{item.label}</span>
                  {item.kicker && (
                    <span
                      className={cn(
                        "font-mono text-[9px] tracking-widest",
                        isActive ? "text-accent-foreground/70" : "text-white/30",
                      )}
                    >
                      {item.kicker}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer plate — REC indicator + identity + signout */}
      <div className="border-t border-white/10 px-3 py-3">
        <div className="rounded-md bg-white/5 px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            {/* Pulsing red dot — workshop "you are at the desk" cue */}
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-white/50">
              REC · Editor
            </span>
          </div>
          <div className="text-sm font-medium leading-tight truncate" title={user.name}>
            {user.name}
          </div>
          <div className="font-mono text-[10px] text-white/40 truncate" title={user.email}>
            {user.email}
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-white/10 px-2 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="size-3.5" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
