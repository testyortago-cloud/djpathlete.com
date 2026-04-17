"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ProductEditor } from "@/components/admin/shop/products/ProductEditor"
import { VariantsPanel } from "@/components/admin/shop/products/VariantsPanel"
import { DigitalFileManager } from "@/components/admin/shop/products/DigitalFileManager"
import type {
  ShopProduct,
  ShopProductFile,
  ShopProductVariant,
} from "@/types/database"

interface Props {
  product: ShopProduct | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface EditPayload {
  product: ShopProduct
  variants?: ShopProductVariant[]
  files?: ShopProductFile[]
  leadsCount?: number
  clickStats?: { total: number; last7d: number; last30d: number }
  taggedUrlPreview?: string
}

export function EditProductDialog({ product, open, onOpenChange }: Props) {
  const [payload, setPayload] = useState<EditPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !product) return
    let cancelled = false
    setPayload(null)
    setLoading(true)
    fetch(`/api/admin/shop/products/${product.id}`)
      .then((r) => r.json())
      .then((data: EditPayload) => {
        if (!cancelled) setPayload(data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, product])

  const current = payload?.product ?? product

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {current ? current.name : "Edit product"}
          </DialogTitle>
          {current && (
            <p className="text-sm text-muted-foreground">
              Slug:{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                {current.slug}
              </code>
            </p>
          )}
        </DialogHeader>

        {loading || !payload ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : payload.product.product_type === "digital" ? (
          <DigitalEditContent
            product={payload.product}
            files={payload.files ?? []}
            leadsCount={payload.leadsCount ?? 0}
          />
        ) : payload.product.product_type === "affiliate" ? (
          <AffiliateEditContent
            product={payload.product}
            clickStats={payload.clickStats ?? { total: 0, last7d: 0, last30d: 0 }}
            taggedUrlPreview={payload.taggedUrlPreview ?? ""}
          />
        ) : (
          <PodEditContent product={payload.product} variants={payload.variants ?? []} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PodEditContent({
  product,
  variants,
}: {
  product: ShopProduct
  variants: ShopProductVariant[]
}) {
  return (
    <div className="space-y-5">
      <ProductEditor product={product} />
      <VariantsPanel variants={variants} />
    </div>
  )
}

function DigitalEditContent({
  product,
  files,
  leadsCount,
}: {
  product: ShopProduct
  files: ShopProductFile[]
  leadsCount: number
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border p-5">
        <h2 className="mb-4 font-heading text-lg text-primary">Access settings</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Mode</dt>
            <dd>{product.digital_is_free ? "Free (email-gated)" : "Paid (cart)"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Signed URL TTL</dt>
            <dd>{product.digital_signed_url_ttl_seconds}s</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Access window</dt>
            <dd>{product.digital_access_days ?? "Forever"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Max downloads</dt>
            <dd>{product.digital_max_downloads ?? "Unlimited"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-border p-5">
        <h2 className="mb-4 font-heading text-lg text-primary">Files</h2>
        <DigitalFileManager productId={product.id} initialFiles={files} />
      </section>

      {product.digital_is_free && (
        <section className="rounded-2xl border border-border p-5">
          <h2 className="mb-2 font-heading text-lg text-primary">Leads captured</h2>
          <div className="font-heading text-3xl">{leadsCount}</div>
        </section>
      )}
    </div>
  )
}

function AffiliateEditContent({
  product,
  clickStats,
  taggedUrlPreview,
}: {
  product: ShopProduct
  clickStats: { total: number; last7d: number; last30d: number }
  taggedUrlPreview: string
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border p-5">
        <h2 className="mb-4 font-heading text-lg text-primary">Link</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Amazon URL</dt>
            <dd className="break-all">{product.affiliate_url}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ASIN</dt>
            <dd>{product.affiliate_asin ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reference price</dt>
            <dd>
              {product.affiliate_price_cents != null
                ? `$${(product.affiliate_price_cents / 100).toFixed(2)}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tagged URL preview</dt>
            <dd className="break-all">{taggedUrlPreview || "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-border p-5">
        <h2 className="mb-4 font-heading text-lg text-primary">Click stats</h2>
        <dl className="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Total</dt>
            <dd className="font-heading text-2xl">{clickStats.total}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Last 7d</dt>
            <dd className="font-heading text-2xl">{clickStats.last7d}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Last 30d</dt>
            <dd className="font-heading text-2xl">{clickStats.last30d}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
