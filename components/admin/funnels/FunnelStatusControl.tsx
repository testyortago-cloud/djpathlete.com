"use client"

// Publishing the FUNNEL is separate from publishing a PAGE: a page can have a
// compiled version sitting ready while the funnel itself is still private.
// Only flipping this makes /go/<slug> reachable by the public.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DataTableBadge, type DataTableBadgeTone } from "@/components/ui/data-table"
import { publishFunnel, publishedSummary } from "./publish-funnel"
import type { FunnelStatus, FunnelKind } from "@/types/database"

const TONE: Record<FunnelStatus, DataTableBadgeTone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
}

interface FunnelStatusControlProps {
  funnelId: string
  status: FunnelStatus
  /**
   * A landing page and a funnel are the same row with a different `kind`, and
   * the owner is never told that. Calling his landing page a "funnel" on the
   * one button that makes it public reads as the wrong screen, not as a shared
   * implementation — he said so: "the landing page still says its not a funnel
   * yet which isnt true its different".
   */
  kind: FunnelKind
}

export function FunnelStatusControl({ funnelId, status, kind }: FunnelStatusControlProps) {
  const noun = kind === "page" ? "Landing page" : "Funnel"
  const router = useRouter()
  const [current, setCurrent] = useState<FunnelStatus>(status)
  const [pending, startTransition] = useTransition()
  // A funnel-wide publish gates and writes every page, so it is measured in
  // seconds, not milliseconds. Without this the owner can press the button
  // again while the first call is still running.
  const [saving, setSaving] = useState(false)
  const busy = saving || pending

  async function setStatus(next: FunnelStatus) {
    setSaving(true)
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
      toast.success(next === "published" ? `${noun} is live.` : `${noun} is now ${next}.`)
      startTransition(() => router.refresh())
    } catch {
      toast.error("Could not change the status.")
    } finally {
      setSaving(false)
    }
  }

  /**
   * ONE FUNNEL-PUBLISH OPERATION, THREE DOORWAYS.
   *
   * This used to `PATCH {status:"published"}`, which writes the row without
   * reading a single step — the unguarded path that lets a funnel go live with
   * unbuilt pages behind it. It now calls the same endpoint the builder's
   * primary Publish and the board's Go live call, so no surface can produce the
   * "funnel published, pages are not" split.
   *
   * A LANDING PAGE KEEPS THE PATCH. Its single step is already gated by the
   * step publish route, whose own comment explains that publishing a page takes
   * the row live; routing it through a funnel-wide planner would add a code
   * path with no second page to justify it.
   *
   * UNPUBLISHING KEEPS THE PATCH TOO, for both kinds. Taking something OFF the
   * air has nothing to gate — refusing to hide a broken funnel because it is
   * broken would be exactly backwards.
   */
  async function publish() {
    if (kind === "page") return setStatus("published")
    setSaving(true)
    try {
      const result = await publishFunnel(funnelId)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setCurrent("published")
      // WITH THE WARNINGS. This is the only surface the owner gets from this
      // screen, so "your video embed was removed" has nowhere else to go.
      toast.success(publishedSummary(result.published, result.warnings))
      startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <DataTableBadge tone={TONE[current]}>{current}</DataTableBadge>
      {current === "published" ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("draft")}>
          Unpublish
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={publish}>
          Publish {noun.toLowerCase()}
        </Button>
      )}
    </div>
  )
}
