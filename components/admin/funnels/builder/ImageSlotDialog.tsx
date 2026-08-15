"use client"

// components/admin/funnels/builder/ImageSlotDialog.tsx - what a double-clicked
// media slot opens.
//
// It produces a `HeroMedia` value and hands it back. It does not know about
// ops, documents or revisions - FunnelBuilder turns the value into an
// `update_section`, exactly as it does for a committed text edit.
//
// TWO KINDS, BECAUSE THE SCHEMA HAS TWO. `heroMediaSchema` is
// `{ kind: "image" | "youtube", src, alt, w, h }`, and for `youtube` the `src`
// is a BARE VIDEO ID, not a URL - `render.ts` builds the nocookie embed from
// it. A full URL pasted there compiles cleanly and renders YouTube's "video
// unavailable" frame, which is a broken embed with zero compiler signal, so the
// field extracts the id from whatever the owner pastes rather than trusting it.

import { useCallback, useRef, useState } from "react"
import { ImageIcon, Loader2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface HeroMedia {
  kind: "image" | "youtube"
  src: string
  alt: string
  w: number
  h: number
}

interface ImageSlotDialogProps {
  open: boolean
  /** Which step's storage the upload belongs to. */
  stepId: string
  /** What the slot currently holds, if anything. */
  current: HeroMedia | null
  onClose: () => void
  onChoose: (media: HeroMedia) => void
  /** Only offered when the slot already holds something. */
  onRemove: () => void
}

/**
 * The 11-character id out of any YouTube URL shape, or the id itself.
 *
 * Deliberately permissive about the wrapper and strict about the RESULT:
 * `render.ts` gates on `^[A-Za-z0-9_-]{6,20}$` and degrades to a placeholder
 * otherwise, so anything this returns has to satisfy that or the owner gets a
 * grey box with no explanation.
 */
export function youtubeIdFrom(input: string): string | null {
  const value = input.trim()
  if (value === "") return null

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{6,20})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{6,20})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{6,20})/,
    /(?:youtube(?:-nocookie)?\.com\/embed\/)([A-Za-z0-9_-]{6,20})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,20})/,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match) return match[1]
  }

  // A bare id, which is what the field asks for.
  return /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : null
}

/**
 * The image's intrinsic size, read in the browser.
 *
 * `heroMediaSchema` requires positive integers, and the server refuses an
 * upload without them rather than inventing a default - a wrong aspect ratio
 * baked into a published page is worse than a refused upload.
 */
function measure(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new window.Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

export function ImageSlotDialog({
  open,
  stepId,
  current,
  onClose,
  onChoose,
  onRemove,
}: ImageSlotDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alt, setAlt] = useState(current?.alt ?? "")
  const [youtube, setYoutube] = useState(current?.kind === "youtube" ? current.src : "")
  const fileRef = useRef<HTMLInputElement | null>(null)

  const upload = useCallback(
    async (file: File) => {
      setError(null)
      setBusy(true)
      try {
        const size = await measure(file)
        if (!size) {
          setError("That file could not be read as an image.")
          return
        }

        const body = new FormData()
        body.append("file", file)
        body.append("stepId", stepId)
        body.append("width", String(size.width))
        body.append("height", String(size.height))

        const response = await fetch("/api/upload/funnel-image", { method: "POST", body })
        const data = (await response.json().catch(() => null)) as
          | { url?: string; width?: number; height?: number; error?: string }
          | null

        if (!response.ok || !data?.url) {
          setError(data?.error ?? "That image could not be uploaded.")
          return
        }

        onChoose({
          kind: "image",
          src: data.url,
          // An empty alt is legal in the schema (`max(200)`, no minimum) and is
          // the honest default for decorative art. The field above is how the
          // owner improves it; inventing text from the filename would put
          // "hero_final_v3" in front of a screen reader.
          alt: alt.trim(),
          w: data.width ?? size.width,
          h: data.height ?? size.height,
        })
      } catch {
        setError("That image could not be uploaded. Check your connection and try again.")
      } finally {
        setBusy(false)
      }
    },
    [alt, onChoose, stepId],
  )

  const useYoutube = useCallback(() => {
    const id = youtubeIdFrom(youtube)
    if (!id) {
      setError("That does not look like a YouTube link or video id.")
      return
    }
    // 16:9. The schema wants positive integers and the renderer sizes the
    // iframe by CSS, so these describe the aspect ratio, not pixels.
    onChoose({ kind: "youtube", src: id, alt: alt.trim(), w: 16, h: 9 })
  }, [alt, onChoose, youtube])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hero image or video</DialogTitle>
          <DialogDescription>
            Upload a photo, or paste a YouTube link. This appears on the live page, so use
            something you own the rights to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="media-alt" className="text-xs uppercase tracking-wide text-muted-foreground">
              Describe it (for screen readers)
            </Label>
            <Input
              id="media-alt"
              value={alt}
              maxLength={200}
              disabled={busy}
              placeholder="Athlete sprinting on a track"
              onChange={(event) => setAlt(event.target.value)}
            />
          </div>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared so choosing the SAME file twice still fires a change
                // event — otherwise a failed upload cannot be retried.
                event.target.value = ""
                if (file) void upload(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {busy ? "Uploading…" : "Upload an image"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP, GIF or AVIF, up to 5 MB.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="media-youtube" className="text-xs uppercase tracking-wide text-muted-foreground">
              …or a YouTube link
            </Label>
            <div className="flex gap-2">
              <Input
                id="media-youtube"
                value={youtube}
                disabled={busy}
                placeholder="https://youtu.be/…"
                onChange={(event) => setYoutube(event.target.value)}
              />
              <Button type="button" variant="outline" disabled={busy || youtube.trim() === ""} onClick={useYoutube}>
                Use
              </Button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[var(--error)]">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {current ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onRemove}>
              <X className="size-4" />
              Remove
            </Button>
          ) : (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <ImageIcon className="size-4" aria-hidden />
              Nothing here yet
            </span>
          )}
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
