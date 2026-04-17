import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRight } from "lucide-react"
import {
  isShopEnabled,
  isShopAffiliateEnabled,
  isShopDigitalEnabled,
} from "@/lib/shop/feature-flag"
import { getProductBySlug, listActiveProducts } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import { VariantPicker } from "@/components/public/shop/VariantPicker"
import { ProductCard } from "@/components/public/shop/ProductCard"
import { FreePdfForm } from "@/components/public/shop/FreePdfForm"
import { DigitalAddToCartButton } from "@/components/public/shop/DigitalAddToCartButton"

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
  if (product.product_type === "affiliate" && !isShopAffiliateEnabled()) notFound()
  if (product.product_type === "digital" && !isShopDigitalEnabled()) notFound()

  if (product.product_type === "digital") {
    const digitalVariants = await listVariantsForProduct(product.id)
    const files = await listFilesForProduct(product.id)
    const defaultVariant = digitalVariants[0] ?? null
    return (
      <article className="mx-auto max-w-5xl px-4 py-12 pt-24 sm:pt-28 lg:pt-32">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.thumbnail_url_override ?? product.thumbnail_url}
            alt={product.name}
            className="w-full rounded-2xl"
          />
          <div>
            <h1 className="font-heading text-3xl text-primary">{product.name}</h1>
            {product.digital_is_free ? (
              <p className="mt-2 font-mono text-xs uppercase tracking-widest text-accent">
                Free download
              </p>
            ) : (
              <p className="mt-2 font-mono text-sm text-muted-foreground">
                ${((defaultVariant?.retail_price_cents ?? 0) / 100).toFixed(2)}
              </p>
            )}
            <div
              className="prose mt-6"
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
            {files.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                {files.map((f) => (
                  <li key={f.id}>&#8226; {f.display_name}</li>
                ))}
              </ul>
            )}
            <div className="mt-8">
              {product.digital_is_free ? (
                <FreePdfForm productId={product.id} />
              ) : defaultVariant ? (
                <DigitalAddToCartButton
                  variantId={defaultVariant.id}
                  priceCents={defaultVariant.retail_price_cents}
                />
              ) : null}
            </div>
          </div>
        </div>
      </article>
    )
  }

  if (product.product_type === "affiliate") {
    return (
      <article className="mx-auto max-w-5xl px-4 py-12 pt-24 sm:pt-28 lg:pt-32">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.thumbnail_url_override ?? product.thumbnail_url}
            alt={product.name}
            className="w-full rounded-2xl"
          />
          <div>
            <h1 className="font-heading text-3xl text-primary">{product.name}</h1>
            {product.affiliate_price_cents != null ? (
              <p className="mt-2 font-mono text-sm text-muted-foreground">
                Approx. ${(product.affiliate_price_cents / 100).toFixed(2)}
              </p>
            ) : null}
            <div
              className="prose mt-6"
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
            <a
              href={`/shop/go/${product.id}`}
              target="_blank"
              rel="nofollow sponsored noopener"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
            >
              View on Amazon →
            </a>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              As an Amazon Associate, DJP Athlete earns from qualifying purchases.
            </p>
          </div>
        </div>
      </article>
    )
  }

  const variants = await listVariantsForProduct(product.id)

  if (variants.length === 0) notFound()

  // Related products (exclude current)
  const allActive = await listActiveProducts()
  const relatedRaw = allActive.filter((p) => p.id !== product.id).slice(0, 4)
  const related = await Promise.all(
    relatedRaw.map(async (p) => {
      const vs = await listVariantsForProduct(p.id)
      const minPrice =
        vs.length > 0
          ? vs.reduce((min, v) => Math.min(min, v.retail_price_cents), vs[0].retail_price_cents)
          : null
      return { product: p, minPriceCents: minPrice, variants: vs }
    }),
  )

  return (
    <div className="bg-background pb-20 pt-24 sm:pt-28 lg:pt-32">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="mx-auto mb-8 flex max-w-7xl items-center gap-1.5 px-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:px-8"
      >
        <Link
          href="/"
          className="transition-colors hover:text-primary"
        >
          Home
        </Link>
        <ChevronRight className="size-3 opacity-60" />
        <Link
          href="/shop"
          className="transition-colors hover:text-primary"
        >
          Shop
        </Link>
        <ChevronRight className="size-3 opacity-60" />
        <span className="truncate text-primary">{product.name}</span>
      </nav>

      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <VariantPicker product={product} variants={variants} />
      </div>

      {/* Related products */}
      {related.length > 0 && (
        <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-8 lg:mt-32">
          <div className="mb-10 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                  More from the shop
                </span>
              </div>
              <h2 className="mt-3 font-heading text-3xl font-semibold text-primary sm:text-4xl">
                You might also like
              </h2>
            </div>
            <Link
              href="/shop"
              className="hidden font-body text-sm font-medium text-primary underline underline-offset-4 hover:text-accent sm:inline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
            {related.map(({ product: p, minPriceCents, variants: vs }) => (
              <ProductCard
                key={p.id}
                product={p}
                minPriceCents={minPriceCents}
                variants={vs}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
