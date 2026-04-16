import type { Metadata } from "next"
import { JsonLd } from "@/components/shared/JsonLd"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { listActiveProducts } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { ComingSoon } from "@/components/public/shop/ComingSoon"
import { ProductCard } from "@/components/public/shop/ProductCard"

export const metadata: Metadata = {
  title: "Shop | DJP Athlete",
  description:
    "Shop DJP Athlete performance apparel and training gear. Compression wear, training tops, and branded athletic clothing.",
  openGraph: {
    title: "Shop | DJP Athlete",
    description: "Shop DJP Athlete performance apparel and training gear.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shop | DJP Athlete",
    description: "Shop DJP Athlete performance apparel and training gear.",
  },
}

const shopSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Shop — DJP Athlete",
  description: "Shop DJP Athlete performance apparel and training gear.",
  url: "https://djpathlete.com/shop",
  publisher: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
}

export default async function ShopPage() {
  if (!isShopEnabled()) {
    return (
      <>
        <JsonLd data={shopSchema} />
        <ComingSoon />
      </>
    )
  }

  const products = await listActiveProducts()

  // Fetch min variant price for each product in parallel
  const productsWithPrices = await Promise.all(
    products.map(async (product) => {
      const variants = await listVariantsForProduct(product.id)
      const minPriceCents =
        variants.length > 0
          ? variants.reduce(
              (min, v) => Math.min(min, v.retail_price_cents),
              variants[0].retail_price_cents,
            )
          : null
      return { product, minPriceCents }
    }),
  )

  return (
    <>
      <JsonLd data={shopSchema} />

      {/* Header */}
      <section className="pt-32 pb-8 lg:pt-40 lg:pb-10 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-12 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">Shop</p>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight">
            Performance Gear
          </h1>
        </div>
      </section>

      {/* Product Grid */}
      <section className="pb-16 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          {productsWithPrices.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-lg text-muted-foreground">
                No products yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {productsWithPrices.map(({ product, minPriceCents }) => (
                <ProductCard key={product.id} product={product} minPriceCents={minPriceCents} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
