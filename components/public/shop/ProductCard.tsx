import Link from "next/link"
import { ArrowUpRight, ExternalLink } from "lucide-react"
import type { ShopProduct, ShopProductVariant } from "@/types/database"

interface ProductCardProps {
  product: ShopProduct
  minPriceCents: number | null
  variants?: ShopProductVariant[]
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

const COLOR_DOT_MAP: Record<string, string> = {
  black: "#111111",
  white: "#f4f4f4",
  navy: "#0e1f3a",
  heather: "#9aa3ad",
  gray: "#8a8f95",
  grey: "#8a8f95",
  charcoal: "#2c2c2c",
  red: "#b3261e",
  green: "#2e6f3f",
  olive: "#59663d",
  sand: "#d7c6a5",
  cream: "#efe9da",
}

function colorToSwatch(color: string): string {
  const key = color.toLowerCase().trim()
  for (const k of Object.keys(COLOR_DOT_MAP)) {
    if (key.includes(k)) return COLOR_DOT_MAP[k]
  }
  return "#c9c4bc"
}

export function ProductCard({ product, minPriceCents, variants = [] }: ProductCardProps) {
  const imageSrc = product.thumbnail_url_override ?? product.thumbnail_url

  if (product.product_type === "affiliate") {
    const price = product.affiliate_price_cents
    return (
      <a
        href={`/shop/go/${product.id}`}
        target="_blank"
        rel="nofollow sponsored noopener"
        className="group block"
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br from-muted via-background to-muted ring-1 ring-border/60">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt={product.name}
              className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-sm text-muted-foreground">No image</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="font-heading text-base font-semibold text-primary transition-colors group-hover:text-accent">
              {product.name}
            </h3>
            {price != null ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                ~{formatPrice(price)}
              </p>
            ) : null}
          </div>
          <span className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent">
            Amazon <ExternalLink className="size-3" />
          </span>
        </div>
      </a>
    )
  }

  const uniqueColors = Array.from(
    new Set(
      variants
        .map((v) => v.color)
        .filter((c): c is string => c !== null && c !== ""),
    ),
  )

  const variantCount = variants.length
  const isFeatured = product.is_featured

  return (
    <Link href={`/shop/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br from-muted via-background to-muted ring-1 ring-border/60">
        {/* subtle corner grain */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-multiply"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 10%, black 0.5px, transparent 1.5px)",
            backgroundSize: "6px 6px",
          }}
          aria-hidden="true"
        />

        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={product.name}
            className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm text-muted-foreground">No image</span>
          </div>
        )}

        {/* badge */}
        {isFeatured && (
          <span className="absolute left-4 top-4 rounded-full bg-primary px-3 py-1 text-[10px] font-mono font-medium uppercase tracking-[0.18em] text-primary-foreground">
            Featured
          </span>
        )}

        {/* hover caption */}
        <div className="absolute inset-x-3 bottom-3 translate-y-[120%] rounded-xl bg-primary/95 px-4 py-3 text-primary-foreground backdrop-blur transition-transform duration-500 ease-out group-hover:translate-y-0">
          <div className="flex items-center justify-between">
            <span className="font-body text-sm font-medium">View product</span>
            <ArrowUpRight className="size-4" />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-semibold text-primary transition-colors group-hover:text-accent">
            {product.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {minPriceCents != null ? (
              <span className="font-mono">From {formatPrice(minPriceCents)}</span>
            ) : (
              <span>Price unavailable</span>
            )}
            {variantCount > 0 && (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/60" />
                <span className="font-mono uppercase tracking-wider">
                  {variantCount} {variantCount === 1 ? "option" : "options"}
                </span>
              </>
            )}
          </div>
        </div>

        {uniqueColors.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5 pt-1">
            {uniqueColors.slice(0, 4).map((c) => (
              <span
                key={c}
                title={c}
                aria-label={c}
                className="size-3 rounded-full ring-1 ring-border"
                style={{ backgroundColor: colorToSwatch(c) }}
              />
            ))}
            {uniqueColors.length > 4 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                +{uniqueColors.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}
