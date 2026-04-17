import type { Metadata } from "next"
import { Truck, RotateCcw, Leaf, ShieldCheck } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { listActiveProducts } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { ComingSoon } from "@/components/public/shop/ComingSoon"
import { ProductCard } from "@/components/public/shop/ProductCard"

// Re-query on every request so admin activate/deactivate shows immediately
// (avoids the static-page cache burning in a now-inactive product).
export const dynamic = "force-dynamic"

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

  const productsWithDetails = await Promise.all(
    products.map(async (product) => {
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

  const totalStyles = productsWithDetails.length

  return (
    <>
      <JsonLd data={shopSchema} />

      {/* Editorial hero */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        {/* ambient background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 20%, oklch(0.7 0.08 60 / 0.35), transparent 45%), radial-gradient(circle at 10% 90%, oklch(0.985 0 0 / 0.08), transparent 40%)",
          }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-32 sm:px-8 lg:pb-20 lg:pt-40">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-8">
              <div className="flex items-center gap-3">
                <div className="h-px w-10 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                  The Shop · Collection 001
                </span>
              </div>

              <h1 className="mt-6 font-heading text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl lg:text-[88px]">
                Performance
                <br />
                <span className="italic text-accent">Gear.</span>
              </h1>

              <p className="mt-6 max-w-xl font-body text-base text-primary-foreground/75 sm:text-lg">
                Worn in the gym, on the pitch, and after the session ends. Every
                piece is built from training-grade materials and printed to order —
                no dead stock, no shortcuts.
              </p>
            </div>

            <aside className="flex flex-col justify-end border-t border-primary-foreground/15 pt-6 lg:col-span-4 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
              <dl className="grid grid-cols-2 gap-6">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/50">
                    Styles live
                  </dt>
                  <dd className="mt-2 font-heading text-3xl font-semibold">
                    {String(totalStyles).padStart(2, "0")}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/50">
                    Season
                  </dt>
                  <dd className="mt-2 font-heading text-3xl font-semibold">SS26</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/50">
                    Ships in
                  </dt>
                  <dd className="mt-2 font-heading text-xl font-semibold">5–7 days</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/50">
                    Printed in
                  </dt>
                  <dd className="mt-2 font-heading text-xl font-semibold">USA / EU</dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </section>

      {/* Category + sort bar */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {["All", "Apparel", "Training", "Accessories"].map((label, i) => (
              <button
                key={label}
                type="button"
                className={`shrink-0 rounded-full px-4 py-1.5 font-body text-sm transition-colors ${
                  i === 0
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-primary"
                }`}
              >
                {label}
                {i === 0 && (
                  <span className="ml-2 font-mono text-[10px] opacity-80">
                    {totalStyles}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Sort
            </span>
            <select
              defaultValue="featured"
              className="rounded-full border border-border bg-background px-3 py-1.5 font-body text-sm text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>
          </div>
        </div>
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
