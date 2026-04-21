"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { DrawerVideoHeader } from "./DrawerVideoHeader"
import { DrawerPostOnlyHeader } from "./DrawerPostOnlyHeader"
import { TranscriptTab } from "./TranscriptTab"
import { PostsTab } from "./PostsTab"
import { MetaTab } from "./MetaTab"
import type { DrawerData } from "@/lib/content-studio/drawer-data"
import { cn } from "@/lib/utils"

export type DrawerTab = "transcript" | "posts" | "meta"

interface DrawerContentProps {
  data: DrawerData
  defaultTab: DrawerTab
}

function resolveTab(raw: string | null): DrawerTab | null {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return null
}

export function DrawerContent({ data, defaultTab }: DrawerContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // The drawer reads its tab state from `?drawerTab=`. We fall back to the
  // outer `?tab=` value only when it maps to a drawer-specific tab name (for
  // deep-link URLs like `?tab=posts`), and finally to the server-provided
  // default. Using a distinct param keeps the shell tab in `?tab=` intact, so
  // `closeHref` (computed from `?tab=` on the server) stays correct even after
  // the user clicks through drawer tabs.
  const active: DrawerTab =
    resolveTab(searchParams.get("drawerTab")) ?? resolveTab(searchParams.get("tab")) ?? defaultTab

  const setTab = useCallback(
    (nextTab: DrawerTab) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("drawerTab", nextTab)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const postsCount = data.posts.length

  return (
    <div className="flex flex-col h-full">
      {data.mode === "video" && data.video ? (
        <DrawerVideoHeader video={data.video} previewUrl={data.previewUrl} />
      ) : (
        <DrawerPostOnlyHeader />
      )}

      <div
        role="tablist"
        aria-label="Video detail tabs"
        className="flex items-center border-b border-border px-2 bg-background"
      >
        <TabButton label="Transcript" isActive={active === "transcript"} onClick={() => setTab("transcript")} />
        <TabButton label={`Posts (${postsCount})`} isActive={active === "posts"} onClick={() => setTab("posts")} />
        <TabButton label="Meta" isActive={active === "meta"} onClick={() => setTab("meta")} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {active === "transcript" && <TranscriptTab transcript={data.transcript} video={data.video} />}
        {active === "posts" && <PostsTab posts={data.posts} initialExpandedPostId={data.highlightPostId} />}
        {active === "meta" && <MetaTab video={data.video} transcript={data.transcript} posts={data.posts} />}
      </div>
    </div>
  )
}

function TabButton({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}
