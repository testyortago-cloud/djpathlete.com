import Link from "next/link"
import type { ShopProduct } from "@/types/database"

interface ProductCardProps {
  product: ShopProduct
  minPriceCents: number | null
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function ProductCard({ product, minPriceCents }: ProductCardProps) {
  const imageSrc = product.thumbnail_url_override ?? product.thumbnail_url

  return (
    <Link href={`/shop/${product.slug}`} className="group block">
      <div className="aspect-square relative bg-surface rounded-xl overflow-hidden mb-3">
        {imageSrc ? (
          // Printful CDN domains are not configured in next.config.mjs remotePatterns,
          // so plain <img> is used here for v1. Add printful.com subdomains to
          // next.config.mjs images.remotePatterns to switch to <Image fill>.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-surface">
            <span className="text-sm text-muted-foreground">No image</span>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-body font-medium text-primary group-hover:text-accent transition-colors leading-snug">
          {product.name}
        </h3>
        {minPriceCents != null ? (
          <p className="text-sm text-muted-foreground mt-0.5">From {formatPrice(minPriceCents)}</p>
        ) : (
          <p className="text-sm text-muted-foreground mt-0.5">Price unavailable</p>
        )}
      </div>
    </Link>
  )
}
