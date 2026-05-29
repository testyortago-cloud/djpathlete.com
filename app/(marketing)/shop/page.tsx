import type { Metadata } from "next"
import { Truck, RotateCcw, Leaf, ShieldCheck } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SITE_URL } from "@/lib/constants"
import {
  isShopEnabled,
  isShopAffiliateEnabled,
  isShopDigitalEnabled,
} from "@/lib/shop/feature-flag"
import { listActiveProducts } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { ComingSoon } from "@/components/public/shop/ComingSoon"
import { ProductCard } from "@/components/public/shop/ProductCard"
import { ShopFilterBar, type ShopCategory, type ShopSort } from "./ShopFilterBar"

// Re-query on every request so admin activate/deactivate shows immediately
// (avoids the static-page cache burning in a now-inactive product).
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Athletic Performance Apparel & Training Gear",
  description:
    "Athletic performance apparel and training gear from Darren J Paul Sports Performance. Compression wear, training tops, and branded athletic clothing built for serious athletes.",
  alternates: { canonical: "/shop" },
  openGraph: {
    title: "Athletic Performance Apparel & Training Gear | DJP Athlete",
    description:
      "Athletic performance apparel and training gear from Darren J Paul Sports Performance. Compression wear, training tops, and branded athletic clothing.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Athletic Performance Apparel & Training Gear | DJP Athlete",
    description: "Athletic performance apparel and training gear from Darren J Paul Sports Performance.",
  },
}

const shopSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Athletic Performance Apparel — DJP Athlete",
  description:
    "Athletic performance apparel and training gear from DJP Athlete. Compression wear, training tops, and branded athletic clothing built for serious athletes.",
  url: "https://www.darrenjpaul.com/shop",
  publisher: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://www.darrenjpaul.com",
  },
}

const TRUST_ITEMS = [
  {
    icon: Truck,
    title: "Fulfilled on demand",
    body: "Printed and shipped from our partner network in 5–7 business days.",
  },
  {
    icon: RotateCcw,
    title: "30-day returns",
    body: "Not right? Send it back within 30 days for a full refund.",
  },
  {
    icon: Leaf,
    title: "Made to order",
    body: "Zero dead stock. Each piece is produced only when you order.",
  },
  {
    icon: ShieldCheck,
    title: "Secure checkout",
    body: "Payments handled by Stripe. Your details stay protected.",
  },
]

const VALID_CATEGORIES: readonly ShopCategory[] = ["all", "pod", "digital", "affiliate"]
const VALID_SORTS: readonly ShopSort[] = ["featured", "newest", "price-asc", "price-desc"]

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sort?: string }>
}) {
  const shopBreadcrumb = (
    <BreadcrumbSchema
      items={[
        { name: "Home", url: "/" },
        { name: "Shop", url: "/shop" },
      ]}
    />
  )

  if (!isShopEnabled()) {
    return (
      <>
        <JsonLd data={shopSchema} />
        {shopBreadcrumb}
        <ComingSoon />
      </>
    )
  }

  const { category: categoryParam, sort: sortParam } = await searchParams
  const activeCategory: ShopCategory = VALID_CATEGORIES.includes(
    categoryParam as ShopCategory,
  )
    ? (categoryParam as ShopCategory)
    : "all"
  const activeSort: ShopSort = VALID_SORTS.includes(sortParam as ShopSort)
    ? (sortParam as ShopSort)
    : "featured"

  const products = await listActiveProducts()
  const affOn = isShopAffiliateEnabled()
  const digOn = isShopDigitalEnabled()
  const visible = products.filter((p) => {
    if (p.product_type === "affiliate") return affOn
    if (p.product_type === "digital") return digOn
    return true
  })

  const allWithDetails = await Promise.all(
    visible.map(async (product) => {
      const variants = await listVariantsForProduct(product.id)
      const minPriceCents =
        variants.length > 0
          ? variants.reduce(
              (min, v) => Math.min(min, v.retail_price_cents),
              variants[0].retail_price_cents,
            )
          : null
      return { product, minPriceCents, variants }
    }),
  )

  const categoryCounts = {
    pod: allWithDetails.filter((x) => x.product.product_type === "pod").length,
    digital: allWithDetails.filter((x) => x.product.product_type === "digital").length,
    affiliate: allWithDetails.filter((x) => x.product.product_type === "affiliate").length,
  }

  const filtered =
    activeCategory === "all"
      ? allWithDetails
      : allWithDetails.filter((x) => x.product.product_type === activeCategory)

  const productsWithDetails = [...filtered].sort((a, b) => {
    switch (activeSort) {
      case "newest":
        return (
          new Date(b.product.created_at).getTime() -
          new Date(a.product.created_at).getTime()
        )
      case "price-asc":
        return (a.minPriceCents ?? Infinity) - (b.minPriceCents ?? Infinity)
      case "price-desc":
        return (b.minPriceCents ?? -Infinity) - (a.minPriceCents ?? -Infinity)
      case "featured":
      default: {
        const fa = a.product.is_featured ? 0 : 1
        const fb = b.product.is_featured ? 0 : 1
        if (fa !== fb) return fa - fb
        if (a.product.sort_order !== b.product.sort_order) {
          return a.product.sort_order - b.product.sort_order
        }
        return (
          new Date(b.product.created_at).getTime() -
          new Date(a.product.created_at).getTime()
        )
      }
    }
  })

  const totalStyles = allWithDetails.length

  // ItemList of the products actually shown — eligible for Google's product
  // list rich result. Price comes from the cheapest variant (or the affiliate /
  // digital price); free digital downloads list at 0.00.
  const productListSchema =
    productsWithDetails.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "DJP Athlete shop — athletic performance apparel & gear",
          numberOfItems: productsWithDetails.length,
          itemListElement: productsWithDetails.map(({ product, minPriceCents }, i) => {
            const url = `${SITE_URL}/shop/${product.slug}`
            const priceCents =
              minPriceCents ??
              (product.digital_is_free ? 0 : product.affiliate_price_cents) ??
              null
            return {
              "@type": "ListItem",
              position: i + 1,
              item: {
                "@type": "Product",
                name: product.name,
                url,
                image: product.thumbnail_url_override ?? product.thumbnail_url,
                ...(product.product_type === "pod"
                  ? { brand: { "@type": "Brand", name: "DJP Athlete" } }
                  : {}),
                ...(priceCents != null
                  ? {
                      offers: {
                        "@type": "Offer",
                        price: (priceCents / 100).toFixed(2),
                        priceCurrency: "USD",
                        availability: "https://schema.org/InStock",
                        url:
                          product.product_type === "affiliate"
                            ? `${SITE_URL}/shop/go/${product.id}`
                            : url,
                      },
                    }
                  : {}),
              },
            }
          }),
        }
      : null

  return (
    <>
      <JsonLd data={shopSchema} />
      {shopBreadcrumb}
      {productListSchema && <JsonLd data={productListSchema} />}

      {/* Category + sort bar */}
      <section className="border-b border-border bg-background">
        <ShopFilterBar
          activeCategory={activeCategory}
          activeSort={activeSort}
          totalCount={totalStyles}
          categoryCounts={categoryCounts}
        />
      </section>

      {/* Product grid */}
      <section className="px-4 py-12 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-7xl">
          {productsWithDetails.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-muted/40 py-24 text-center">
              <p className="font-heading text-xl text-primary">
                The first drop is on the way.
              </p>
              <p className="mt-2 font-body text-sm text-muted-foreground">
                New pieces land soon. Check back shortly.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {productsWithDetails.map(({ product, minPriceCents, variants }) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  minPriceCents={minPriceCents}
                  variants={variants}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Editorial quote break */}
      <section className="border-y border-border bg-muted/40 px-4 py-20 sm:px-8 lg:py-28">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mx-auto mb-6 h-px w-16 bg-accent" />
          <blockquote className="font-heading text-3xl font-medium leading-tight tracking-tight text-primary sm:text-4xl lg:text-5xl">
            <span className="italic text-accent">“</span>Show up like the work
            matters — because it does.<span className="italic text-accent">”</span>
          </blockquote>
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            — Darren J. Paul
          </p>
        </div>
      </section>

      {/* FAQ (managed via CMS) — renders only when published FAQs exist for this page */}
      <ManagedFaqSection
        pageKey="shop"
        variant="cards"
        eyebrow="Common questions"
        title="Frequently asked questions."
      />

      {/* Trust strip */}
      <section className="px-4 py-14 sm:px-8 lg:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Icon className="size-5" />
                </div>
                <div>
                  <h3 className="font-heading text-base font-semibold text-primary">
                    {title}
                  </h3>
                  <p className="mt-1 font-body text-sm text-muted-foreground">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
