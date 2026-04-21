"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { X } from "lucide-react"
import { DrawerContent, type DrawerTab } from "./drawer/DrawerContent"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

interface DetailDrawerProps {
  data: DrawerData
  defaultTab: DrawerTab
  /** Where to navigate when the drawer closes (e.g. back to the tab the user came from). */
  closeHref: string
}

export function DetailDrawer({ data, defaultTab, closeHref }: DetailDrawerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const title =
    data.mode === "video" && data.video ? `Video · ${data.video.title ?? data.video.original_filename}` : "Manual post"

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        router.push(closeHref)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [searchParams, closeHref, router])

  function handleClose() {
    router.push(closeHref)
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 h-screen w-full max-w-[700px] bg-background border-l border-border z-50 flex flex-col"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-heading text-base truncate">{title}</h2>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <DrawerContent data={data} defaultTab={defaultTab} />
        </div>
      </aside>
    </>
  )
}
