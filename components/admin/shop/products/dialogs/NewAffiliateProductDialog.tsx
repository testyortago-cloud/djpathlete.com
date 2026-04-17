"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageUpload } from "@/components/admin/shop/products/ImageUpload"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewAffiliateProductDialog({ open, onOpenChange }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState("")

  function reset() {
    setSubmitting(false)
    setThumbnailUrl("")
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!thumbnailUrl) {
      toast.error("Thumbnail is required")
      return
    }
    setSubmitting(true)
    const form = new FormData(e.currentTarget)
    const payload = {
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      description: String(form.get("description") ?? ""),
      thumbnail_url: thumbnailUrl,
      affiliate_url: String(form.get("affiliate_url") ?? ""),
      affiliate_asin: String(form.get("affiliate_asin") ?? "") || undefined,
      affiliate_price_cents:
        form.get("affiliate_price_dollars")
          ? Math.round(Number(form.get("affiliate_price_dollars")) * 100)
          : undefined,
    }
    const res = await fetch("/api/admin/shop/products/affiliate", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    setSubmitting(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(
        typeof err.error === "string" ? err.error : `Failed to create product (${res.status})`,
      )
      return
    }
    toast.success("Affiliate product created")
    reset()
    onOpenChange(false)
    router.refresh()
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
          <DialogTitle className="font-heading text-primary">New affiliate product</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" id="new-affiliate-form">
          <div className="space-y-2">
            <Label htmlFor="af-name">Name</Label>
            <Input id="af-name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="af-slug">Slug</Label>
            <Input id="af-slug" name="slug" required pattern="[a-z0-9-]+" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="af-description">Description</Label>
            <textarea
              id="af-description"
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
                  id="af-thumbnail"
                  type="url"
                  placeholder="…or paste an image URL"
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="af-url">Amazon URL</Label>
            <Input id="af-url" name="affiliate_url" type="url" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="af-asin">ASIN (optional — auto-extracted if blank)</Label>
            <Input id="af-asin" name="affiliate_asin" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="af-price">Reference price (USD, optional)</Label>
            <Input id="af-price" name="affiliate_price_dollars" type="number" step="0.01" />
          </div>
        </form>

        <DialogFooter className="flex-row gap-2">
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
            form="new-affiliate-form"
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
