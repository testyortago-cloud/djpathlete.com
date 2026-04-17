import { getSyncProduct, listSyncProducts, type SyncVariant } from "@/lib/printful"
import { getProductByPrintfulSyncId, upsertProductFromSync } from "@/lib/db/shop-products"
import { markVariantsUnavailable, upsertVariantFromSync } from "@/lib/db/shop-variants"

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product"
}

function dollarsToCents(s: string): number {
  return Math.round(parseFloat(s) * 100)
}

function extractSizeColor(variant: SyncVariant): { size: string | null; color: string | null } {
  const size = variant.options.find((o) => o.id === "size")?.value ?? null
  const color = variant.options.find((o) => o.id === "color")?.value ?? null
  return { size, color }
}

export interface SyncResult {
  added: number
  updated: number
  deactivated_variants: number
}

export async function syncPrintfulCatalog(): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, deactivated_variants: 0 }
  const summaries = await listSyncProducts()

  for (const summary of summaries) {
    const detail = await getSyncProduct(summary.id)
    const existing = await getProductByPrintfulSyncId(summary.id)

    // Printful may return a null/empty thumbnail_url on products that haven't
    // had mockups generated yet. Fall back to the first variant's preview
    // image so the DB's NOT NULL constraint isn't violated.
    const fallbackVariantImage = detail.sync_variants
      .find((v) => !v.is_ignored)
      ?.files.find((f) => f.type === "preview")?.preview_url
    const thumbnail_url = summary.thumbnail_url || fallbackVariantImage || ""

    const product = await upsertProductFromSync({
      printful_sync_id: summary.id,
      name: summary.name,
      slug: existing?.slug ?? slugify(summary.name),
      thumbnail_url,
    })

    if (existing) result.updated += 1
    else result.added += 1

    const keepIds: number[] = []
    for (const v of detail.sync_variants) {
      if (v.is_ignored) continue
      const { size, color } = extractSizeColor(v)

      // Collect every usable Printful mockup (preview, back, flat, sleeve,
      // lifestyle renders…). Skip "default" — that's the raw artwork file.
      const mockup_urls = Array.from(
        new Set(
          v.files
            .filter(
              (f) =>
                f.type !== "default" &&
                typeof f.preview_url === "string" &&
                f.preview_url.length > 0,
            )
            .map((f) => f.preview_url),
        ),
      )
      const primary =
        v.files.find((f) => f.type === "preview")?.preview_url ??
        mockup_urls[0] ??
        v.product.image ??
        ""

      await upsertVariantFromSync({
        product_id: product.id,
        printful_sync_variant_id: v.id,
        printful_variant_id: v.variant_id,
        sku: v.sku,
        name: v.name,
        size,
        color,
        retail_price_cents: dollarsToCents(v.retail_price),
        printful_cost_cents: 0,
        mockup_url: primary,
        mockup_urls,
      })
      keepIds.push(v.id)
    }
    result.deactivated_variants += await markVariantsUnavailable(product.id, keepIds)
  }
  return result
}
