"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { X } from "lucide-react"

interface DetailDrawerProps {
  videoId: string
}

export function DetailDrawer({ videoId }: DetailDrawerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Preserve the current tab when closing (e.g., stay on Calendar tab)
  const handleClose = () => {
    const tab = searchParams.get("tab")
    router.push(tab ? `/admin/content?tab=${tab}` : "/admin/content")
  }

  // ESC to close — re-subscribes when searchParams changes so the
  // handler always closes to the current tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const tab = searchParams.get("tab")
        router.push(tab ? `/admin/content?tab=${tab}` : "/admin/content")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [searchParams, router])

  return (
    <>
      <button
        type="button"
        aria-label="Close overlay"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Video detail: ${videoId}`}
        className="fixed top-0 right-0 h-screen w-full max-w-[700px] bg-background border-l border-border z-50 flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-heading text-lg">Video · {videoId}</h2>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Phase 2 will render the video player + transcript + posts here.
          </div>
        </div>
      </aside>
    </>
  )
}
