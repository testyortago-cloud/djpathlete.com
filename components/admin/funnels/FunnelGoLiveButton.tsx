"use client"

// components/admin/funnels/FunnelGoLiveButton.tsx — take a funnel live from the
// list, without a trip to the funnel detail page.
//
// WHY THIS EXISTS. "Publish" means two different things in this product and the
// second one used to be invisible:
//
//   * Publishing a PAGE (the builder's Publish) compiles it and writes an
//     immutable version row. It does NOT make anything public.
//   * Publishing the FUNNEL (this) flips `funnels.status`, and ONLY that makes
//     /go/<slug> reachable — the public route serves published funnels only.
//
// The owner published a page on production, was told "Published version 1", and
// got a 404, because the control that actually makes a page public lived one
// navigation away on a page that otherwise just repeats the card he was looking
// at. `silent_gate_reads_as_broken`: a gate that hides its control reads as
// broken. So the control moved to where the pages are.
//
// `FunnelStatusControl` still owns the same job on the funnel detail page. This
// is deliberately NOT that component: that one is a status BADGE plus a toggle,
// and the card already carries a live/draft badge of its own — rendering a
// second one inside the actions row would say the same thing twice, which is
// the confusion this change is trying to remove.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Globe, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { publishFunnel, publishedSummary } from "./publish-funnel"
import type { FunnelStatus, FunnelKind } from "@/types/database"

interface FunnelGoLiveButtonProps {
  funnelId: string
  status: FunnelStatus
  /**
   * A landing page and a funnel are the same row with a different `kind`, and
   * they go live by different routes — see `goLive` below. The board renders
   * this button on both, so it has to be told which one it is holding.
   */
  kind: FunnelKind
  /**
   * The entry page has a published version. A funnel with no compiled page has
   * nothing to serve, so going live would produce a reachable URL rendering
   * nothing — worse than a 404, because it looks deliberate.
   *
   * IT SAYS NOTHING ABOUT PAGES 2..N, which is why it is not the guard for a
   * funnel. Every page of a funnel is gated by the publish route below.
   */
  canGoLive: boolean
}

export function FunnelGoLiveButton({ funnelId, status, kind, canGoLive }: FunnelGoLiveButtonProps) {
  const router = useRouter()
  const [current, setCurrent] = useState<FunnelStatus>(status)
  const [saving, setSaving] = useState(false)
  const [pending, startTransition] = useTransition()

  const live = current === "published"
  const busy = saving || pending
  const noun = kind === "page" ? "page" : "funnel"

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
      toast.success(next === "published" ? `This ${noun} is live.` : "Taken offline.")
      startTransition(() => router.refresh())
    } catch {
      toast.error("Could not change the status.")
    } finally {
      setSaving(false)
    }
  }

  /**
   * ONE FUNNEL-PUBLISH OPERATION, THREE DOORWAYS — and this was the third.
   *
   * `canGoLive` above means "the ENTRY page has a published version". On a
   * landing page that is the whole funnel, so the PATCH is honest. On a FUNNEL
   * it says nothing about pages 2..N, so this button could take a five-step
   * funnel live with four unbuilt pages behind it — a public URL whose own
   * buttons 404, which is the exact defect `POST .../publish` exists to make
   * unreachable. A guard on the builder and the detail page but not on the
   * board is not a guard.
   *
   * TAKING IT OFFLINE STAYS ON THE PATCH for both kinds: there is nothing to
   * gate about hiding something.
   */
  async function goLive() {
    if (kind === "page") return setStatus("published")
    setSaving(true)
    try {
      const result = await publishFunnel(funnelId)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setCurrent("published")
      toast.success(publishedSummary(result.published))
      startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  // THE CLIENT-SIDE GATE IS FOR LANDING PAGES ONLY, because the two kinds no
  // longer run the same operation. A landing page still goes live by the
  // unguarded PATCH, so `canGoLive` is the only thing between it and a public
  // URL with nothing behind it. A funnel goes live through `POST .../publish`,
  // which reads every page, publishes their DRAFTS, and refuses with the reason
  // — so "the entry page has no published version yet" has stopped being a
  // reason to refuse. Leaving the button disabled would tell the owner to go
  // and do by hand the exact thing this button now does for him.
  if (!live && kind === "page" && !canGoLive) {
    // Say why rather than omitting the control. A missing button is
    // indistinguishable from a broken one, which is how this whole class of
    // confusion started.
    return (
      <Button variant="outline" size="sm" disabled title="Publish the page first — there's nothing to serve yet.">
        <Globe className="size-4" />
        Go live
      </Button>
    )
  }

  return (
    <Button
      variant={live ? "outline" : "default"}
      size="sm"
      disabled={busy}
      onClick={() => (live ? setStatus("draft") : goLive())}
      title={
        live
          ? `Stop serving this ${noun} at its public URL.`
          : `Make this ${noun} reachable at its public URL.`
      }
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
      {live ? "Take offline" : "Go live"}
    </Button>
  )
}
