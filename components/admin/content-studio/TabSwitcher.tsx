"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { LayoutGrid, CalendarDays, Film, Megaphone, Images, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { id: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "videos", label: "Videos", icon: Film },
  { id: "posts", label: "Posts", icon: Megaphone },
  { id: "assets", label: "Assets", icon: Images },
  { id: "insights", label: "Insights", icon: BarChart3 },
] as const

type TabId = (typeof TABS)[number]["id"]

function getActiveTab(searchParams: URLSearchParams): TabId {
  const tab = searchParams.get("tab")
  if (tab === "calendar" || tab === "videos" || tab === "posts" || tab === "assets" || tab === "insights")
    return tab
  return "pipeline"
}

export function TabSwitcher() {
  const searchParams = useSearchParams()
  const active = getActiveTab(searchParams)

  // These tabs are top-level Content Studio navigation, so they ALWAYS point at
  // the studio root -- never at the current path. Until 140a9512 a video opened
  // in a drawer layered over the tab content, so keeping the detail path here
  // kept that drawer open while the tab behind it changed. Once the drawer
  // became a full page at /admin/content/[videoId], that same line turned every
  // tab into a no-op: it navigated the detail page to itself with a new ?tab=,
  // which only moved the underline (getActiveTab reads the query) and re-aimed
  // the Back link, while the video stayed on screen. Keep this constant.
  const basePath = "/admin/content"

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
