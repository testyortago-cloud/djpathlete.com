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

/**
 * A client's PERMANENT public athlete-profile share link/QR. Coach-generated,
 * HMAC-signed, minors excluded. Anyone with the link can view the public
 * `/athlete/<token>` card — no login required.
 */
export function AthleteProfileLinkDialog({
  qrDataUrl,
  profileUrl,
  clientName,
}: {
  qrDataUrl: string
  profileUrl: string
  clientName: string
}) {
  const [open, setOpen] = useState(false)
  const first = clientName.split(" ")[0] || "this client"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="size-4 mr-1.5" />
          Share profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{first}&apos;s public profile</DialogTitle>
          <DialogDescription>
            Anyone with this link can view {first}&apos;s public athlete card. Links stay live while the feature is
            enabled.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <Image
            src={qrDataUrl}
            alt={`Athlete profile QR for ${first}`}
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
