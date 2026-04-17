// app/(admin)/admin/shop/products/new/digital/DigitalProductForm.tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function DigitalProductForm() {
  const router = useRouter()
  const [isFree, setIsFree] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    const f = new FormData(e.currentTarget)
    const payload = {
      name: String(f.get("name") ?? ""),
      slug: String(f.get("slug") ?? ""),
      description: String(f.get("description") ?? ""),
      thumbnail_url: String(f.get("thumbnail_url") ?? ""),
      digital_is_free: isFree,
      retail_price_cents: isFree
        ? undefined
        : Math.round(Number(f.get("price_dollars") ?? 0) * 100),
      digital_signed_url_ttl_seconds: Number(f.get("ttl_seconds") ?? 900),
      digital_access_days: f.get("access_days") ? Number(f.get("access_days")) : null,
      digital_max_downloads: f.get("max_downloads") ? Number(f.get("max_downloads")) : null,
    }
    const res = await fetch("/api/admin/shop/products/digital", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    setSubmitting(false)
    if (!res.ok) { toast.error("Failed"); return }
    const { product } = await res.json()
    toast.success("Digital product created")
    router.push(`/admin/shop/products/${product.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block"><span className="text-sm">Name</span>
        <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block"><span className="text-sm">Slug</span>
        <input name="slug" required pattern="[a-z0-9-]+" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block"><span className="text-sm">Description</span>
        <textarea name="description" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block"><span className="text-sm">Thumbnail URL</span>
        <input name="thumbnail_url" type="url" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
        <span>Free lead magnet (no cart, collects email)</span>
      </label>
      {!isFree && (
        <label className="block"><span className="text-sm">Price (USD)</span>
          <input name="price_dollars" type="number" step="0.01" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      )}
      <fieldset className="rounded border border-border p-4">
        <legend className="px-2 text-sm">Access settings</legend>
        <label className="block"><span className="text-sm">Signed URL TTL (seconds)</span>
          <select name="ttl_seconds" defaultValue="900" className="mt-1 w-full rounded border px-3 py-2">
            <option value="900">15 minutes</option>
            <option value="3600">1 hour</option>
            <option value="14400">4 hours</option>
            <option value="86400">24 hours</option>
          </select>
        </label>
        <label className="mt-3 block"><span className="text-sm">Access window (days — blank = forever)</span>
          <input name="access_days" type="number" min="1" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="mt-3 block"><span className="text-sm">Max downloads per purchase (blank = unlimited)</span>
          <input name="max_downloads" type="number" min="1" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      </fieldset>
      <button type="submit" disabled={submitting} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {submitting ? "Creating…" : "Create"}
      </button>
      <p className="text-xs text-muted-foreground">File uploads happen on the product detail page after creation.</p>
    </form>
  )
}
