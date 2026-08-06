"use client"

import Image from "next/image"
import { useState } from "react"
import { toast } from "sonner"
import { Share2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/** Below this, the report has too little data to look like a premium document. */
const THIN_REPORT_TESTS = 3

/**
 * A client's PERMANENT public test-report link/QR. Coach-generated,
 * HMAC-signed. Anyone with the link can view the public `/athlete/<token>`
 * report — no login required. The coach-only Arena card is a separate,
 * admin-authenticated page.
 */
export function AthleteProfileLinkDialog({
  qrDataUrl,
  profileUrl,
  clientName,
  testCount,
}: {
  qrDataUrl: string
  profileUrl: string
  clientName: string
  testCount: number
}) {
  const [open, setOpen] = useState(false)
  const first = clientName.split(" ")[0] || "this client"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="size-4 mr-1.5" />
          Share test report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{first}&apos;s test report</DialogTitle>
          <DialogDescription>
            Anyone with this link can view {first}&apos;s performance testing report — scores, trends and personal
            bests. The link is permanent, and always shows the latest results.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {testCount < THIN_REPORT_TESTS && (
            <p className="w-full rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-foreground">
              {first} has{" "}
              {testCount === 0
                ? "no logged tests"
                : `only ${testCount} logged ${testCount === 1 ? "test" : "tests"}`}
              . The report will look thin — log more tests before sharing this.
            </p>
          )}
          <Image
            src={qrDataUrl}
            alt={`Test report QR for ${first}`}
            width={240}
            height={240}
            unoptimized
            className="rounded-lg border border-border"
          />
          <p className="font-mono text-xs text-muted-foreground break-all text-center">{profileUrl}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(profileUrl)
              toast.success("Link copied")
            }}
          >
            <Copy className="size-4" />
            Copy link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
