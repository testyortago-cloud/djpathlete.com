"use client"

import Image from "next/image"
import { useState } from "react"
import { toast } from "sonner"
import { QrCode, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * Self check-in QR for the Clients list header. Clients scan it, tap their name
 * on /checkin, and a credit comes off their active pack automatically. Replaces
 * the QR that used to live on the standalone /admin/today screen.
 */
export function SelfCheckinQrDialog({ qrDataUrl, checkinUrl }: { qrDataUrl: string; checkinUrl: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4 mr-1.5" />
          Self check-in QR
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Self check-in QR</DialogTitle>
          <DialogDescription>
            Clients scan this, tap their name, and the credit comes off automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <Image
            src={qrDataUrl}
            alt="Check-in QR code"
            width={240}
            height={240}
            unoptimized
            className="rounded-lg border border-border"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(checkinUrl)
              toast.success("Link copied")
            }}
          >
            <Copy className="size-4" />
            Copy check-in link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
