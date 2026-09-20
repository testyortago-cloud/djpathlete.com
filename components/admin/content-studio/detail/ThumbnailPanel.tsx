"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ImageIcon, Upload, RotateCcw } from "lucide-react"
import type { ThumbnailSource } from "@/types/database"
import { captureFrameFromElement, commitThumbnail, revertThumbnailToAuto } from "@/lib/firebase-client-thumbnail"

interface ThumbnailPanelProps {
  videoUploadId: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  thumbnailUrl: string | null
  thumbnailSource: ThumbnailSource | null | undefined
}

const SOURCE_LABEL: Record<ThumbnailSource, string> = {
  auto: "Picked automatically",
  frame: "A frame you chose",
  upload: "An image you uploaded",
}

export function ThumbnailPanel({ videoUploadId, videoRef, thumbnailUrl, thumbnailSource }: ThumbnailPanelProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"frame" | "upload" | "revert" | null>(null)

  const isCustom = thumbnailSource === "frame" || thumbnailSource === "upload"

  async function useThisFrame() {
    const el = videoRef.current
    if (!el) {
      toast.error("The video player isn't ready yet.")
      return
    }
    setBusy("frame")
    try {
      const blob = await captureFrameFromElement(el)
      if (!blob) {
        toast.error("Couldn't read that frame. Try playing the video first, then pause on the picture you want.")
        return
      }
      if (!(await commitThumbnail(videoUploadId, blob, "frame"))) {
        toast.error("Couldn't save that thumbnail. Your old one is still in place.")
        return
      }
      toast.success("Thumbnail updated")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setBusy("upload")
    try {
      if (!(await commitThumbnail(videoUploadId, file, "upload"))) {
        toast.error("Couldn't save that image. Your old thumbnail is still in place.")
        return
      }
      toast.success("Thumbnail updated")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function revert() {
    setBusy("revert")
    try {
      if (!(await revertThumbnailToAuto(videoUploadId))) {
        toast.error("The original picture isn't there any more, so there's nothing to go back to.")
        return
      }
      toast.success("Back to the automatic thumbnail")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <div className="flex items-start gap-3">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt="Current video thumbnail"
            className="size-16 shrink-0 rounded-md object-cover ring-1 ring-border bg-surface"
          />
        ) : (
          <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-md bg-accent/10 ring-1 ring-border">
            <ImageIcon className="size-6 text-muted-foreground" strokeWidth={1.5} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-heading text-xs font-semibold text-primary">Thumbnail</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {thumbnailSource ? SOURCE_LABEL[thumbnailSource] : "Picked automatically"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useThisFrame}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-surface/50 disabled:opacity-50"
        >
          <ImageIcon className="size-3.5" strokeWidth={1.75} />
          {busy === "frame" ? "Saving…" : "Use this frame"}
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-surface/50 disabled:opacity-50"
        >
          <Upload className="size-3.5" strokeWidth={1.75} />
          {busy === "upload" ? "Uploading…" : "Upload an image"}
        </button>

        {isCustom && (
          <button
            type="button"
            onClick={revert}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
            {busy === "revert" ? "Reverting…" : "Revert to auto"}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Pause the video on the picture you want, then choose &ldquo;Use this frame&rdquo;.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFilePicked}
        className="hidden"
      />
    </div>
  )
}
