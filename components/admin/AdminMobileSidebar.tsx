"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useMemo } from "react"
import { X, Settings, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { getAdminNav, getAllHrefs, findActiveHref, type NavItem } from "./admin-nav"
import type { PermissionActor } from "@/lib/permissions/registry"

interface AdminMobileSidebarProps {
  open: boolean
  onClose: () => void
  contentStudioEnabled?: boolean
  actor?: PermissionActor | null
}

export function AdminMobileSidebar({ open, onClose, contentStudioEnabled = false, actor }: AdminMobileSidebarProps) {
  const pathname = usePathname()
  const nav = useMemo(() => getAdminNav({ contentStudioEnabled, actor }), [contentStudioEnabled, actor])
  const canSeeSettings = !actor || actor.role === "admin"
  const allHrefs = useMemo(() => getAllHrefs(nav), [nav])
  const activeHref = findActiveHref(pathname, allHrefs)

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
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-2 space-y-4">
          {/* Top-level links */}
          <div className="space-y-0.5">
            {nav.topLinks.map((item) => (
              <MobileLink key={item.href} item={item} isActive={item.href === activeHref} onClick={onClose} />
            ))}
          </div>

          {/* Grouped sections (always expanded on mobile) */}
          {nav.groupedSections.map((section) => (
            <div key={section.title}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <MobileLink key={item.href} item={item} isActive={item.href === activeHref} onClick={onClose} />
                ))}
              </div>
            </div>
          ))}

          {/* Standalone links */}
          <div className="space-y-0.5 border-t border-white/10 pt-3">
            {nav.standaloneLinks.map((item) => (
              <MobileLink key={item.href} item={item} isActive={item.href === activeHref} onClick={onClose} />
            ))}
          </div>
        </nav>

        {/* Bottom section */}
        <div className="px-3 py-3 space-y-0.5 border-t border-white/10">
          {canSeeSettings && (
            <Link
              href="/admin/settings"
              onClick={onClose}
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
      </div>
    </>
  )
}

function MobileLink({ item, isActive, onClick }: { item: NavItem; isActive: boolean; onClick: () => void }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onClick}
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
