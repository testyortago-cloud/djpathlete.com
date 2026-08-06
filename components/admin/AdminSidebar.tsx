"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Settings, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { getAdminNav, getAllHrefs, findActiveHref, type NavItem } from "./admin-nav"
import type { PermissionActor } from "@/lib/permissions/registry"

interface AdminSidebarProps {
  contentStudioEnabled?: boolean
  actor?: PermissionActor | null
}

const STORAGE_KEY = "djp:admin-sidebar:open-sections"

export function AdminSidebar({ contentStudioEnabled = false, actor }: AdminSidebarProps) {
  const pathname = usePathname()
  const nav = useMemo(() => getAdminNav({ contentStudioEnabled, actor }), [contentStudioEnabled, actor])
  // Settings is owner-only, so the footer link disappears for staff.
  const canSeeSettings = !actor || actor.role === "admin"
  const allHrefs = useMemo(() => getAllHrefs(nav), [nav])
  const activeHref = findActiveHref(pathname, allHrefs)

  const initialOpen = useMemo(
    () =>
      nav.groupedSections.reduce(
        (acc, section) => {
          acc[section.title] = section.items.some((i) => i.href === activeHref)
          return acc
        },
        {} as Record<string, boolean>,
      ),
    [nav, activeHref],
  )

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpen)

  // Hydrate from localStorage after first paint to avoid SSR mismatch.
  // Drops unknown section titles so stale entries don't accumulate.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as Record<string, boolean>
      const validTitles = new Set(nav.groupedSections.map((s) => s.title))
      const filtered = Object.fromEntries(Object.entries(stored).filter(([k]) => validTitles.has(k)))
      setOpenSections((prev) => ({ ...prev, ...filtered }))
    } catch {
      // localStorage unavailable (private mode) — fall back to active-only default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = { ...prev, [title]: !prev[title] }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
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
        {/* Top-level links (no group wrapper) */}
        <div className="space-y-0.5">
          {nav.topLinks.map((item) => (
            <SidebarLink key={item.href} item={item} isActive={item.href === activeHref} />
          ))}
        </div>

        {/* Grouped sections */}
        {nav.groupedSections.map((section) => {
          const isOpen = section.pinned ? true : (openSections[section.title] ?? false)
          const hasActiveChild = section.items.some((item) => item.href === activeHref)
          const contentId = `admin-sidebar-section-${section.title.toLowerCase()}`

          return (
            <div key={section.title}>
              {section.pinned ? (
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  {section.title}
                </p>
              ) : (
                <button
                  onClick={() => toggleSection(section.title)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
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
              )}
              <div
                id={contentId}
                className={cn(
                  "space-y-0.5 overflow-hidden transition-all duration-200",
                  isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
                )}
              >
                {section.items.map((item) => (
                  <SidebarLink key={item.href} item={item} isActive={item.href === activeHref} />
                ))}
              </div>
            </div>
          )
        })}

        {/* Divider between operational and standalone */}
        <div className="border-t border-white/10 my-2" />

        {/* Standalone links */}
        <div className="space-y-0.5">
          {nav.standaloneLinks.map((item) => (
            <SidebarLink key={item.href} item={item} isActive={item.href === activeHref} />
          ))}
        </div>
      </nav>

      {/* Bottom section */}
      <div className="px-3 py-3 space-y-0.5 border-t border-white/10">
        {canSeeSettings && (
          <Link
            href="/admin/settings"
            aria-current={activeHref === "/admin/settings" ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              activeHref === "/admin/settings"
                ? "bg-accent text-accent-foreground"
                : "text-white/70 hover:text-white hover:bg-white/10",
            )}
          >
            <Settings className="size-[18px]" strokeWidth={1.5} />
            Settings
          </Link>
        )}
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

function SidebarLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "text-white/70 hover:text-white hover:bg-white/10",
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.5} />
      {item.label}
    </Link>
  )
}
