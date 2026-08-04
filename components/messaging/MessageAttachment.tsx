"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { MessageAttachment as Attachment } from "@/types/database"

/**
 * The src is ALWAYS the app route, never a signed GCS URL.
 *
 * Signed URLs expire; a thread is scrolled back through for weeks, so a stored
 * signature turns into a broken image. The route re-signs on every hit.
 */
function attachmentSrc(id: string) {
  return `/api/messaging/attachments/${id}?redirect=1`
}

export function MessageAttachmentView({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const src = attachmentSrc(attachment.id)
  const label = attachment.original_filename ?? (attachment.kind === "video" ? "Video" : "Photo")

  // Known dimensions reserve the space so the thread does not jump as images
  // load — the scroll position of a chat is the thing you least want moving.
  const ratio =
    attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined

  if (attachment.kind === "video") {
    return (
      <video
        controls
        // metadata gives the browser a first frame without us running a
        // transcode anywhere — a 25 MB clip does not need a poster pipeline.
        preload="metadata"
        className="mt-1 max-h-64 w-full rounded-lg bg-black"
        style={{ aspectRatio: ratio }}
        data-testid="message-video"
        aria-label={label}
      >
        <source src={src} type={attachment.mime_type} />
        Your browser cannot play this video.
      </video>
    )
  }

  return (
    <>
      {/* Images display INLINE. "Tap to view" was the specific complaint. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        loading="lazy"
        onClick={() => setLightboxOpen(true)}
        className={`mt-1 max-h-64 w-auto max-w-full cursor-zoom-in rounded-lg object-cover ${
          mine ? "ml-auto" : ""
        }`}
        style={{ aspectRatio: ratio }}
        data-testid="message-image"
      />
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl p-2">
          <DialogTitle className="sr-only">{label}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={label} className="max-h-[80vh] w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
