"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ShieldCheck } from "lucide-react"

interface LiabilityWaiverModalProps {
  programId: string
  programName: string
  waiverContent: string
}

export function LiabilityWaiverModal({
  programId,
  programName,
  waiverContent,
}: LiabilityWaiverModalProps) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch("/api/consents/waiver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to accept waiver. Please try again.")
        setIsSubmitting(false)
        return
      }

      router.refresh()
    } catch {
      setError("An unexpected error occurred. Please try again.")
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open>
      <DialogContent
        className="max-w-2xl max-h-[90vh] flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <DialogTitle>Liability Waiver & Disclaimer</DialogTitle>
          </div>
          <DialogDescription>
            Please review and accept the liability waiver before starting{" "}
            <span className="font-medium text-foreground">{programName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground leading-relaxed">
          <div dangerouslySetInnerHTML={{ __html: markdownToHtml(waiverContent) }} />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-start gap-3 pt-2">
          <Checkbox
            id="waiverAccept"
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked === true)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <Label
            htmlFor="waiverAccept"
            className="text-sm text-muted-foreground leading-relaxed cursor-pointer"
          >
            I have read, understood, and agree to the above Liability Waiver & Disclaimer
          </Label>
        </div>

        <DialogFooter>
          <Button
            onClick={handleAccept}
            disabled={!accepted || isSubmitting}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? "Accepting..." : "Accept and Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/^### (.+)$/gm, "<h3 class='font-heading text-base font-semibold text-foreground mt-4 mb-2'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='font-heading text-lg font-semibold text-foreground mt-6 mb-3'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='font-heading text-xl font-bold text-foreground mt-6 mb-3'>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong class='text-foreground'>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li class='ml-4 list-disc'>$1</li>")
    .replace(/\n{2,}/g, "<br /><br />")
    .replace(/\n---\n/g, "<hr class='my-4 border-border' />")
}
