import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { getProductBySlug } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { VariantPicker } from "@/components/public/shop/VariantPicker"

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isShopEnabled()) return {}
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product || !product.is_active) return {}

  const imageSrc = product.thumbnail_url_override ?? product.thumbnail_url

  return {
    title: `${product.name} | DJP Athlete Shop`,
    description: `${product.name} — DJP Athlete performance gear.`,
    openGraph: {
      title: `${product.name} | DJP Athlete Shop`,
      description: `${product.name} — DJP Athlete performance gear.`,
      type: "website",
      images: imageSrc ? [{ url: imageSrc }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: `${product.name} | DJP Athlete Shop`,
      description: `${product.name} — DJP Athlete performance gear.`,
    },
  }
}

export default async function ProductDetailPage({ params }: Props) {
  if (!isShopEnabled()) notFound()

  const { slug } = await params
  const product = await getProductBySlug(slug)

  if (!product || !product.is_active) notFound()

  const variants = await listVariantsForProduct(product.id)

  if (variants.length === 0) notFound()

  return (
    <div className="pt-28 pb-20 lg:pt-36 lg:pb-28 px-4 sm:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Back link */}
        <a
          href="/shop"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Shop
        </a>

        <VariantPicker product={product} variants={variants} />
      </div>
    </div>
  )
}
