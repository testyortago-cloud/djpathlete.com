"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Prominent one-tap check-in for a client's active session pack. Lives in the
 * client detail Quick Actions row. Renders nothing when the client has no active
 * credits (nothing to deduct) — selling a pack is the path to create some.
 */
export function ClientCheckinButton({
  clientUserId,
  hasActiveCredits,
}: {
  clientUserId: string
  hasActiveCredits: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (!hasActiveCredits) return null

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
      else toast.success(`Checked in — ${data.remaining} left`)
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={checkIn} disabled={busy} size="sm">
      <Check className="size-4" />
      Check in
    </Button>
  )
}
