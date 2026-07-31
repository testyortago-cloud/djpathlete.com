"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Image as ImageIcon, X, Upload, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { uploadToSignedUrl } from "@/lib/firebase-client-upload"

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const ACCEPT = ALLOWED_MIME.join(",")
const MAX_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 10

interface Props {
  submissionId: string
  /**
   * Ribbon copy above the picker, varying by status. Comes from
   * editorWorkflowState().uploadPrompt. Pass null to render no ribbon.
   */
  prompt?: string | null
  /** Amber alert styling. Off for the neutral "you may upload" states. */
  urgent?: boolean
}

interface SelectedImage {
  file: File
  previewUrl: string
}

export function PhotoRevisionUploadZone({
  submissionId,
  prompt = null,
  urgent = false,
}: Props) {
  const router = useRouter()
  const [images, setImages] = useState<SelectedImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files) return
    setError(null)
    const incoming = Array.from(files)
    if (images.length + incoming.length > MAX_IMAGES) {
      setError(`You can attach up to ${MAX_IMAGES} photos.`)
      return
    }
    for (const f of incoming) {
      if (!(ALLOWED_MIME as readonly string[]).includes(f.type)) {
        setError(`Unsupported format: ${f.name}. Allowed: JPEG, PNG, WebP.`)
        return
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is too large (max 8 MB).`)
        return
      }
    }
    setImages([
      ...images,
      ...incoming.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ])
  }

  function removeAt(i: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl)
      return prev.filter((_, idx) => idx !== i)
    })
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return
    setImages((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function submit() {
    setError(null)
    if (images.length === 0) {
      setError("Add at least one photo.")
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        images: images.map((img, position) => ({
          filename: img.file.name,
          mimeType: img.file.type,
          sizeBytes: img.file.size,
          position,
        })),
      }
      const res = await fetch(
        `/api/editor/submissions/${submissionId}/photo-versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? "Submission failed")
      }
      const { uploads } = (await res.json()) as {
        uploads: Array<{ position: number; uploadUrl: string }>
      }
      const byPos = new Map(uploads.map((u) => [u.position, u.uploadUrl]))
      await Promise.all(
        images.map((img, position) => {
          const url = byPos.get(position)
          if (!url) throw new Error(`Missing upload URL for position ${position}`)
          return uploadToSignedUrl(url, img.file, () => {})
        }),
      )

      const finRes = await fetch(
        `/api/editor/submissions/${submissionId}/finalize`,
        { method: "POST" },
      )
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }

      toast.success("New photo set submitted")
      images.forEach((i) => URL.revokeObjectURL(i.previewUrl))
      setImages([])
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed"
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      {prompt && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
            urgent ? "border-warning/40 bg-warning/10" : "border-border bg-muted/30"
          }`}
        >
          {urgent ? (
            <AlertTriangle className="size-4 text-warning shrink-0" strokeWidth={1.5} />
          ) : (
            <Upload className="size-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
          )}
          <p
            className={`text-sm font-medium ${urgent ? "text-warning" : "text-muted-foreground"}`}
          >
            {prompt}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label
          htmlFor="prz-files"
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm font-medium hover:bg-muted/40"
        >
          <ImageIcon className="size-4" /> Add photos
        </label>
        <input
          ref={fileRef}
          id="prz-files"
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
          aria-label="Add photos"
        />
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Max {MAX_IMAGES} photos · JPEG · PNG · WebP · 8 MB each
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-2">
          <AlertTriangle className="size-4 text-error shrink-0 mt-0.5" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img, idx) => (
            <li
              key={img.previewUrl}
              className="relative rounded-md border bg-muted/20"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt={img.file.name}
                className="aspect-square w-full rounded-md object-cover"
              />
              <div className="flex items-center justify-between px-2 py-1">
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => move(idx, idx - 1)}
                    aria-label="Move left"
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => move(idx, idx + 1)}
                    aria-label="Move right"
                  >
                    →
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => removeAt(idx)}
                    aria-label="Remove"
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={submitting || images.length === 0}>
          <Upload className="mr-1.5 size-4" />
          {submitting ? "Submitting..." : "Submit revision"}
        </Button>
      </div>
    </div>
  )
}
