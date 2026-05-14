"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Image as ImageIcon, X, Upload, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { uploadToSignedUrl } from "@/lib/firebase-client-upload"

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const ACCEPT = ALLOWED_MIME.join(",")
const MAX_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 10

interface Props {
  open: boolean
  onClose: () => void
}

interface SelectedImage {
  file: File
  previewUrl: string
}

export function PhotoSubmitDialog({ open, onClose }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [images, setImages] = useState<SelectedImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null

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
    const added = incoming.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setImages([...images, ...added])
  }

  function removeAt(index: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
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
    if (!title.trim()) {
      setError("Title is required.")
      return
    }
    if (images.length === 0) {
      setError("Add at least one photo.")
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        images: images.map((img, position) => ({
          filename: img.file.name,
          mimeType: img.file.type,
          sizeBytes: img.file.size,
          position,
        })),
      }
      const res = await fetch("/api/editor/submissions/photos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? "Submission failed")
      }
      const { submission, uploads } = (await res.json()) as {
        submission: { id: string }
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

      const finRes = await fetch(`/api/editor/submissions/${submission.id}/finalize`, {
        method: "POST",
      })
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }

      toast.success("Photo set submitted")
      images.forEach((i) => URL.revokeObjectURL(i.previewUrl))
      setImages([])
      setTitle("")
      setDescription("")
      onClose()
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-md bg-card border shadow-lg max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-heading text-lg text-primary">Submit photo set</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <label
              className="text-xs font-mono uppercase tracking-widest text-muted-foreground"
              htmlFor="ps-title"
            >
              Title
            </label>
            <Input
              id="ps-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Coaching shot, behind-the-scenes..."
            />
          </div>

          <div className="space-y-1">
            <label
              className="text-xs font-mono uppercase tracking-widest text-muted-foreground"
              htmlFor="ps-desc"
            >
              Description (optional)
            </label>
            <Textarea
              id="ps-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="ps-files"
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm font-medium hover:bg-muted/40"
            >
              <ImageIcon className="size-4" /> Add photos
            </label>
            <input
              ref={fileRef}
              id="ps-files"
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
                <li key={img.previewUrl} className="relative rounded-md border bg-muted/20">
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
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            <Upload className="mr-1.5 size-4" />
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </footer>
      </div>
    </div>
  )
}
