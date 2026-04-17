"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function AffiliateProductForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    const form = new FormData(e.currentTarget)
    const payload = {
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      description: String(form.get("description") ?? ""),
      thumbnail_url: String(form.get("thumbnail_url") ?? ""),
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
      toast.error("Failed to create product")
      return
    }
    const { product } = await res.json()
    toast.success("Affiliate product created")
    router.push(`/admin/shop/products/${product.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm">Name</span>
        <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Slug</span>
        <input name="slug" required pattern="[a-z0-9-]+" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Description</span>
        <textarea name="description" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Thumbnail URL</span>
        <input name="thumbnail_url" type="url" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Amazon URL</span>
        <input name="affiliate_url" type="url" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">ASIN (optional — auto-extracted if blank)</span>
        <input name="affiliate_asin" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Reference price (USD, optional)</span>
        <input name="affiliate_price_dollars" type="number" step="0.01" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  )
}
