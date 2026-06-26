"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pause, Play } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { GoogleAdsResourceStatus } from "@/types/database"

interface Props {
  campaignId: string
  campaignName: string
  initialStatus: GoogleAdsResourceStatus
}

const BADGE_CLASSES: Record<GoogleAdsResourceStatus, string> = {
  ENABLED: "bg-success/10 text-success",
  PAUSED: "bg-warning/15 text-warning",
  REMOVED: "bg-muted/40 text-muted-foreground",
}

export function CampaignStatusToggle({ campaignId, campaignName, initialStatus }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<GoogleAdsResourceStatus>(initialStatus)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // REMOVED campaigns can only be restored from the Google Ads UI.
  if (status === "REMOVED") {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${BADGE_CLASSES.REMOVED}`}
        title="Restore in Google Ads to bring this back"
      >
        REMOVED
      </span>
    )
  }

  const isEnabled = status === "ENABLED"
  const next: GoogleAdsResourceStatus = isEnabled ? "PAUSED" : "ENABLED"
  const Icon = isEnabled ? Pause : Play
  const verb = isEnabled ? "Pause" : "Resume"

  function applyToggle() {
    const previous = status
    setStatus(next)
    setConfirmOpen(false)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/ads/campaigns/${campaignId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string; removed?: boolean }
        if (!res.ok) {
          // Campaign was removed in Google Ads; the server reconciled our copy to
          // REMOVED. Reflect that immediately (the REMOVED badge replaces the toggle)
          // instead of reverting to the stale status.
          if (body.removed) {
            setStatus("REMOVED")
            toast.error(body.error ?? "This campaign was removed in Google Ads.")
            router.refresh()
            return
          }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        toast.success(`Campaign ${next === "PAUSED" ? "paused" : "resumed"}.`)
        router.refresh()
      } catch (err) {
        setStatus(previous)
        toast.error(`Update failed: ${(err as Error).message}`)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        aria-label={`${verb} campaign ${campaignName}`}
        title={`Click to ${verb.toLowerCase()} — change is pushed to Google Ads`}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors hover:ring-1 hover:ring-border disabled:opacity-50 disabled:cursor-progress ${BADGE_CLASSES[status]}`}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        <span>{pending ? "Saving…" : status}</span>
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {verb} this campaign?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{campaignName}</span> will be{" "}
              {isEnabled ? "paused" : "resumed"} in Google Ads immediately.{" "}
              {isEnabled
                ? "Spend stops, ads stop serving."
                : "Ads will start serving as soon as Google approves and your budget allows."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyToggle} variant={isEnabled ? "destructive" : "default"}>
              {verb}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
