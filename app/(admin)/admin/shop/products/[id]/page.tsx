import { notFound } from "next/navigation"
import { getProductById } from "@/lib/db/shop-products"
import { listAllVariantsForProduct } from "@/lib/db/shop-variants"
import {
  countClicksForProduct,
  countClicksForProductSince,
} from "@/lib/db/shop-affiliate-clicks"
import { buildAffiliateUrl } from "@/lib/shop/amazon"
import { ProductEditor } from "@/components/admin/shop/products/ProductEditor"
import { VariantsPanel } from "@/components/admin/shop/products/VariantsPanel"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Edit Product · Admin" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function ShopProductDetailPage({ params }: Props) {
  const { id } = await params
  const product = await getProductById(id)

  if (!product) notFound()

  if (product.product_type === "affiliate") {
    const total = await countClicksForProduct(product.id)
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const c7 = await countClicksForProductSince(product.id, since7)
    const c30 = await countClicksForProductSince(product.id, since30)
    const tag = process.env.AMAZON_ASSOCIATES_TAG ?? ""
    let preview = ""
    if (product.affiliate_url && tag) {
      try {
        preview = buildAffiliateUrl(product.affiliate_url, tag)
      } catch {
        preview = ""
      }
    }

    return (
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <div>
          <Link
            href="/admin/shop/products"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Products
          </Link>
          <h1 className="font-heading text-2xl text-primary">{product.name}</h1>
          <p className="text-sm text-muted-foreground">
            Slug:{" "}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
              {product.slug}
            </code>
          </p>
        </div>

        <section className="rounded-2xl border border-border p-6">
          <h2 className="mb-4 font-heading text-lg">Link</h2>
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
              <dd className="break-all">{preview || "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-border p-6">
          <h2 className="mb-4 font-heading text-lg">Click stats</h2>
          <dl className="grid grid-cols-3 gap-4 text-center">
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Total</dt>
              <dd className="font-heading text-2xl">{total}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Last 7d</dt>
              <dd className="font-heading text-2xl">{c7}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Last 30d</dt>
              <dd className="font-heading text-2xl">{c30}</dd>
            </div>
          </dl>
        </section>
      </div>
    )
  }

  const variants = await listAllVariantsForProduct(id)

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link
          href="/admin/shop/products"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to Products
        </Link>
        <h1 className="text-2xl font-heading text-primary">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          Slug: <code className="font-mono text-xs bg-surface px-1 py-0.5 rounded">{product.slug}</code>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ProductEditor product={product} />
        </div>
        <div className="lg:col-span-1">
          <VariantsPanel variants={variants} />
        </div>
      </div>
    </div>
  )
}
