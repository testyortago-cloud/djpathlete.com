"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  X,
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
}

interface NavSection {
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

interface EditorMobileSidebarProps {
  open: boolean
  onClose: () => void
  user: { name: string; email: string }
}

export function EditorMobileSidebar({ open, onClose, user }: EditorMobileSidebarProps) {
  const pathname = usePathname()

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />

      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-primary text-primary-foreground lg:hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <Image
              src="/logos/logo-icon-light.png"
              alt="DJP Athlete"
              width={120}
              height={80}
              className="object-contain"
              style={{ height: 56, width: "auto" }}
            />
            <span className="font-mono font-medium tracking-[0.22em] text-[10px] uppercase text-white">
              Edit Bay
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="text-white/70 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-2 space-y-3">
          {NAV_SECTIONS.map((section, sIdx) => (
            <div key={section.title || `top-${sIdx}`}>
              {section.title && (
                <p className="px-3 pt-2 pb-1 font-mono text-[9px] tracking-[0.22em] uppercase text-white/30">
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
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
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

        <div className="border-t border-white/10 px-3 py-3">
          <div className="rounded-md bg-white/5 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-2">
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
      </div>
    </>
  )
}
