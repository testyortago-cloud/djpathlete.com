"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageUpload } from "@/components/admin/shop/products/ImageUpload"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  slug: "Slug",
  description: "Description",
  thumbnail_url: "Thumbnail",
  retail_price_cents: "Price",
  digital_signed_url_ttl_seconds: "Signed URL TTL",
  digital_access_days: "Access window",
  digital_max_downloads: "Max downloads",
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ALLOWED_FILE_MIMES = [
  "application/pdf",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
]

export function NewDigitalProductDialog({ open, onOpenChange }: Props) {
  const router = useRouter()
  const [isFree, setIsFree] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState("")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [progressMessage, setProgressMessage] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  function reset() {
    setIsFree(false)
    setSubmitting(false)
    setThumbnailUrl("")
    setPendingFiles([])
    setProgressMessage("")
    setFormError(null)
    setFieldErrors({})
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return
    const valid: File[] = []
    for (const f of Array.from(fileList)) {
      if (!ALLOWED_FILE_MIMES.includes(f.type)) {
        toast.error(`${f.name}: unsupported type`)
        continue
      }
      if (f.size > 500 * 1024 * 1024) {
        toast.error(`${f.name}: exceeds 500MB`)
        continue
      }
      valid.push(f)
    }
    if (valid.length) setPendingFiles((prev) => [...prev, ...valid])
  }

  async function uploadFileToProduct(productId: string, file: File) {
    const uploadForm = new FormData()
    uploadForm.append("file", file)
    const uploadRes = await fetch("/api/uploads/shop-pdf", {
      method: "POST",
      body: uploadForm,
    })
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}))
      throw new Error(
        typeof err.error === "string"
          ? `${file.name}: ${err.error}`
          : `upload failed for ${file.name}`,
      )
    }
    const { storage_path, file_name, file_size_bytes, mime_type } = await uploadRes.json()

    const attach = await fetch(`/api/admin/shop/products/${productId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name,
        display_name: file_name,
        storage_path,
        file_size_bytes,
        mime_type,
      }),
    })
    if (!attach.ok) {
      const err = await attach.json().catch(() => ({}))
      throw new Error(
        typeof err.error === "string"
          ? `${file.name}: ${err.error}`
          : `attach failed for ${file.name}`,
      )
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setProgressMessage("Creating product…")
    setFormError(null)
    setFieldErrors({})
    const f = new FormData(e.currentTarget)
    const payload = {
      name: String(f.get("name") ?? ""),
      slug: String(f.get("slug") ?? ""),
      description: String(f.get("description") ?? ""),
      thumbnail_url: thumbnailUrl || undefined,
      digital_is_free: isFree,
      retail_price_cents: isFree
        ? undefined
        : Math.round(Number(f.get("price_dollars") ?? 0) * 100),
      digital_signed_url_ttl_seconds: Number(f.get("ttl_seconds") ?? 900),
      digital_access_days: f.get("access_days") ? Number(f.get("access_days")) : null,
      digital_max_downloads: f.get("max_downloads") ? Number(f.get("max_downloads")) : null,
    }

    try {
      const res = await fetch("/api/admin/shop/products/digital", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(res, err, "Failed to create product")
        setFormError(message)
        setFieldErrors(fe)
        toast.error(message)
        setSubmitting(false)
        setProgressMessage("")
        return
      }
      const { product } = await res.json()

      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i]
        setProgressMessage(`Uploading ${i + 1}/${pendingFiles.length}: ${file.name}`)
        await uploadFileToProduct(product.id, file)
      }

      toast.success(
        pendingFiles.length
          ? `Digital product created with ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}`
          : "Digital product created",
      )
      reset()
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't reach the server. Please try again."
      setFormError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
      setProgressMessage("")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">New digital product</DialogTitle>
          <DialogDescription>
            Upload a thumbnail and one or more downloadable files.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" id="new-digital-form">
          <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={PRODUCT_FIELD_LABELS} />
          <div className="space-y-2">
            <Label htmlFor="dg-name">Name</Label>
            <Input id="dg-name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dg-slug">Slug</Label>
            <Input id="dg-slug" name="slug" required pattern="[a-z0-9-]+" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dg-description">Description</Label>
            <textarea
              id="dg-description"
              name="description"
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-2">
            <Label>Thumbnail</Label>
            <div className="flex items-start gap-3">
              {thumbnailUrl && (
                <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
                  <Image
                    src={thumbnailUrl}
                    alt="Thumbnail preview"
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              <div className="flex-1 space-y-2">
                <ImageUpload
                  label="Upload image"
                  onUploaded={(url) => setThumbnailUrl(url)}
                />
                <Input
                  id="dg-thumbnail"
                  type="url"
                  placeholder="…or paste an image URL"
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isFree}
              onChange={(e) => setIsFree(e.target.checked)}
              className="rounded border-border"
            />
            Free lead magnet (no cart, collects email)
          </label>

          {!isFree && (
            <div className="space-y-2">
              <Label htmlFor="dg-price">Price (USD)</Label>
              <Input id="dg-price" name="price_dollars" type="number" step="0.01" required />
            </div>
          )}

          <div className="space-y-2">
            <Label>Files (PDF / ZIP / MP4 / MP3, max 500MB each)</Label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface/50 px-3 py-4 text-sm hover:bg-surface">
              <input
                type="file"
                accept="application/pdf,application/zip,video/mp4,audio/mpeg"
                multiple
                onChange={(e) => {
                  addFiles(e.target.files)
                  e.target.value = ""
                }}
                disabled={submitting}
                className="hidden"
              />
              <span className="text-muted-foreground">Click to add files</span>
            </label>
            {pendingFiles.length > 0 && (
              <ul className="space-y-1.5">
                {pendingFiles.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      disabled={submitting}
                      className="text-muted-foreground hover:text-error"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <fieldset className="rounded-md border border-border p-4 space-y-3">
            <legend className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Access settings
            </legend>
            <div className="space-y-2">
              <Label htmlFor="dg-ttl">Signed URL TTL (seconds)</Label>
              <select
                id="dg-ttl"
                name="ttl_seconds"
                defaultValue="900"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="900">15 minutes</option>
                <option value="3600">1 hour</option>
                <option value="14400">4 hours</option>
                <option value="86400">24 hours</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dg-access-days">Access window (days — blank = forever)</Label>
              <Input id="dg-access-days" name="access_days" type="number" min="1" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dg-max-downloads">
                Max downloads per purchase (blank = unlimited)
              </Label>
              <Input id="dg-max-downloads" name="max_downloads" type="number" min="1" />
            </div>
          </fieldset>
        </form>

        <DialogFooter className="flex-row items-center gap-2">
          {progressMessage && (
            <p className="mr-auto text-xs text-muted-foreground">{progressMessage}</p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-digital-form"
            disabled={submitting}
            className="flex-1 sm:flex-none"
          >
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
