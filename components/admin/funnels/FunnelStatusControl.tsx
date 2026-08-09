"use client"

// Publishing the FUNNEL is separate from publishing a PAGE: a page can have a
// compiled version sitting ready while the funnel itself is still private.
// Only flipping this makes /go/<slug> reachable by the public.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DataTableBadge, type DataTableBadgeTone } from "@/components/ui/data-table"
import type { FunnelStatus } from "@/types/database"

const TONE: Record<FunnelStatus, DataTableBadgeTone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
}

interface FunnelStatusControlProps {
  funnelId: string
  status: FunnelStatus
}

export function FunnelStatusControl({ funnelId, status }: FunnelStatusControlProps) {
  const router = useRouter()
  const [current, setCurrent] = useState<FunnelStatus>(status)
  const [pending, startTransition] = useTransition()

  async function setStatus(next: FunnelStatus) {
    try {
      const response = await fetch(`/api/admin/funnels/${funnelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!response.ok) {
        toast.error("Could not change the status.")
        return
      }
      setCurrent(next)
      toast.success(
        next === "published" ? "Funnel is live." : `Funnel is now ${next}.`,
      )
      startTransition(() => router.refresh())
    } catch {
      toast.error("Could not change the status.")
    }
  }

  return (
    <div className="flex items-center gap-3">
      <DataTableBadge tone={TONE[current]}>{current}</DataTableBadge>
      {current === "published" ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setStatus("draft")}>
          Unpublish
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={() => setStatus("published")}>
          Publish funnel
        </Button>
      )}
    </div>
  )
}
