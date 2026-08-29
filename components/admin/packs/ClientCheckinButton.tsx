"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Prominent one-tap check-in. Lives in the client detail Quick Actions row.
 *
 * Renders when the client has something to check in AGAINST: active pack credits
 * to deduct, or an attendance arrangement (coached here, billed by a partner
 * facility, so nothing is deducted). With neither, there is nothing to record
 * and the button stays hidden — sell a pack or start an arrangement first.
 */
export function ClientCheckinButton({
  clientUserId,
  hasActiveCredits,
  hasArrangement = false,
}: {
  clientUserId: string
  hasActiveCredits: boolean
  hasArrangement?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (!hasActiveCredits && !hasArrangement) return null

  async function checkIn() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/session-packs/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not check in")
        return
      }
      if (data.reason === "duplicate") toast.info("Already checked in recently")
      // An attendance check-in has no balance to report — saying "0 left" would
      // read as a problem when nothing was ever going to be deducted.
      else if (data.unmetered) toast.success("Checked in — attendance recorded")
      else toast.success(`Checked in — ${data.remaining} left`)
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={checkIn} disabled={busy}>
      <Check className="size-4" />
      Check in
    </Button>
  )
}
