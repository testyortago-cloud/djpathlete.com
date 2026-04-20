"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { LayoutGrid, CalendarDays, Film, Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { id: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "videos", label: "Videos", icon: Film },
  { id: "posts", label: "Posts", icon: Megaphone },
] as const

type TabId = (typeof TABS)[number]["id"]

function getActiveTab(searchParams: URLSearchParams): TabId {
  const tab = searchParams.get("tab")
  if (tab === "calendar" || tab === "videos" || tab === "posts") return tab
  return "pipeline"
}

export function TabSwitcher() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = getActiveTab(searchParams)

  // Preserve the /admin/content/[videoId] drawer when switching tabs
  const basePath = pathname.startsWith("/admin/content/") ? pathname : "/admin/content"

  return (
    <nav className="flex items-center gap-1 border-b border-border">
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id
        const href = id === "pipeline" ? basePath : `${basePath}?tab=${id}`
        return (
          <Link
            key={id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
