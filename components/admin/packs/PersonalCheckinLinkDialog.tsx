"use client"

import Image from "next/image"
import { useState } from "react"
import { toast } from "sonner"
import { Ticket, Copy } from "lucide-react"
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
 * A client's PERMANENT personal check-in link/QR. Unlike the daily coach QR,
 * this never changes — send it once (or let them bookmark it). Opening it shows
 * "Check in, <name>" and one tap logs the session. No daily printing, no roster.
 */
export function PersonalCheckinLinkDialog({
  qrDataUrl,
  checkinUrl,
  clientName,
}: {
  qrDataUrl: string
  checkinUrl: string
  clientName: string
}) {
  const [open, setOpen] = useState(false)
  const first = clientName.split(" ")[0] || "this client"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Ticket className="size-4 mr-1.5" />
          Personal check-in link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{first}&apos;s check-in link</DialogTitle>
          <DialogDescription>
            Permanent — send it once or let {first} bookmark it. Opening it shows just their name and checks them in with
            one tap. No daily QR needed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <Image
            src={qrDataUrl}
            alt={`Personal check-in QR for ${first}`}
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
