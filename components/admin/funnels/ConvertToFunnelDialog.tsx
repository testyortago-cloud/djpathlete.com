"use client"

// A page outgrows itself the moment it needs a thank-you or an upsell step.
// Conversion is explicit rather than automatic: deriving the type from step
// count would move a live page between screens with no warning and no undo.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function ConvertToFunnelDialog({
  funnelId,
  funnelName,
}: {
  funnelId: string
  funnelName: string
}) {
  const router = useRouter()
  const [converting, setConverting] = useState(false)

  async function handleConvert() {
    setConverting(true)
    try {
      const response = await fetch(`/api/admin/funnels/${funnelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "funnel" }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not convert this page.")
        return
      }
      toast.success(`"${funnelName}" is now a funnel.`)
      // It has left this screen. Refreshing in place would read as a deletion.
      router.push("/admin/funnels")
    } catch {
      toast.error("Could not convert this page.")
    } finally {
      setConverting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" title="Convert to funnel" aria-label="Convert to funnel">
          <GitBranch className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Convert &ldquo;{funnelName}&rdquo; to a funnel?</AlertDialogTitle>
          {/* The reassurance is the point. Moving between admin screens looks
              drastic, and the owner's real question is whether an address that
              is already on an ad is about to break. */}
          <AlertDialogDescription>
            It moves to the Funnels screen and gains multi-step ordering, so you can add a thank-you or
            upsell step after it. Its address does not change and it stays live — anyone visiting the page
            right now sees exactly what they see today.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={converting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConvert} disabled={converting}>
            {converting ? "Converting…" : "Convert"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
