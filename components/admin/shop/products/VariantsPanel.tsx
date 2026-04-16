"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ImageUpload } from "./ImageUpload"
import type { ShopProductVariant } from "@/types/database"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface VariantsPanelProps {
  variants: ShopProductVariant[]
}

export function VariantsPanel({ variants }: VariantsPanelProps) {
  if (variants.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-5">
        <h2 className="text-base font-heading text-primary mb-3">Variants</h2>
        <p className="text-sm text-muted-foreground">
          No variants found. Run a Printful sync to import variants.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <h2 className="text-base font-heading text-primary mb-4">
        Variants <span className="text-sm font-normal text-muted-foreground">({variants.length})</span>
      </h2>
      <div className="space-y-3">
        {variants.map((variant) => (
          <VariantRow key={variant.id} variant={variant} />
        ))}
      </div>
    </div>
  )
}

function VariantRow({ variant }: { variant: ShopProductVariant }) {
  const [overrideUrl, setOverrideUrl] = useState<string | null>(variant.mockup_url_override)
  const [saving, setSaving] = useState(false)

  async function saveOverride(url: string | null) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/shop/variants/${variant.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mockup_url_override: url }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Save failed (${res.status})`)
      }
      setOverrideUrl(url)
      toast.success("Variant image updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update variant")
    } finally {
      setSaving(false)
    }
  }

  const displayUrl = overrideUrl || variant.mockup_url
  const priceFormatted = `$${(variant.retail_price_cents / 100).toFixed(2)}`

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border border-border bg-surface/40",
        !variant.is_available && "opacity-60",
      )}
    >
      {/* Mockup thumbnail */}
      <div className="relative size-12 rounded-md overflow-hidden border border-border shrink-0 bg-white">
        {displayUrl ? (
          <Image
            src={displayUrl}
            alt={variant.name}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="size-full bg-muted" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{variant.name}</p>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
          {variant.size && (
            <span className="text-xs text-muted-foreground">Size: {variant.size}</span>
          )}
          {variant.color && (
            <span className="text-xs text-muted-foreground">Color: {variant.color}</span>
          )}
          <span className="text-xs text-muted-foreground">{priceFormatted}</span>
          {!variant.is_available && (
            <span className="text-xs text-error">Unavailable</span>
          )}
        </div>
        {overrideUrl && (
          <p className="text-[10px] text-muted-foreground mt-0.5">Using custom mockup</p>
        )}

        {/* Upload override */}
        <div className="flex items-center gap-2 mt-1.5">
          <ImageUpload
            label={saving ? "Saving…" : "Upload mockup"}
            onUploaded={(url) => saveOverride(url)}
            className={saving ? "pointer-events-none opacity-60" : undefined}
          />
          {overrideUrl && (
            <button
              type="button"
              onClick={() => saveOverride(null)}
              disabled={saving}
              className="text-[10px] text-muted-foreground hover:text-error transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
