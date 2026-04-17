"use client"

import type { CartItemResponse } from "@/app/api/shop/cart-items/route"
import { useCart } from "@/lib/shop/cart"

interface QuoteData {
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  shipping_label: string
}

interface CheckoutSummaryProps {
  items: CartItemResponse[]
  quote?: QuoteData
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function CheckoutSummary({ items, quote }: CheckoutSummaryProps) {
  const { lines } = useCart()

  const lineFor = (variantId: string) =>
    lines.find((l) => l.variant_id === variantId)

  const subtotalCents = items.reduce((sum, item) => {
    const qty = lineFor(item.variant_id)?.quantity ?? 1
    return sum + item.unit_price_cents * qty
  }, 0)

  const digitalOnly =
    items.length > 0 && items.every((i) => i.product_type === "digital")

  return (
    <div className="rounded-2xl border border-border bg-background p-6 space-y-4">
      <h2 className="text-lg font-heading font-semibold text-primary">Order Summary</h2>

      {/* Item list */}
      <div className="space-y-3">
        {items.map((item) => {
          const line = lineFor(item.variant_id)
          const qty = line?.quantity ?? 1
          const lineTotal = item.unit_price_cents * qty

          return (
            <div key={item.variant_id} className="flex gap-3">
              {/* Thumbnail */}
              <div className="w-14 h-14 rounded-lg bg-surface overflow-hidden flex-shrink-0">
                {item.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnail_url}
                    alt={item.product_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">—</span>
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium font-body text-primary leading-snug truncate">
                  {item.product_name}
                </p>
                <p className="text-xs text-muted-foreground font-body">{item.variant_name}</p>
                <p className="text-xs text-muted-foreground font-body">Qty: {qty}</p>
              </div>

              {/* Line total */}
              <p className="text-sm font-semibold font-body text-primary flex-shrink-0">
                {formatPrice(lineTotal)}
              </p>
            </div>
          )
        })}
      </div>

      {/* Totals */}
      <div className="border-t border-border pt-4 space-y-2 text-sm font-body">
        {quote ? (
          <>
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-medium text-primary">{formatPrice(quote.subtotal_cents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span className="font-medium text-primary">
                {formatPrice(quote.shipping_cents)}
                {quote.shipping_label && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({quote.shipping_label})
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between text-base font-semibold text-primary pt-2 border-t border-border">
              <span>Total</span>
              <span>{formatPrice(quote.total_cents)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-medium text-primary">{formatPrice(subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span className={digitalOnly ? "font-medium text-primary" : ""}>
                {digitalOnly ? "Free (digital)" : "Calculated after address"}
              </span>
            </div>
            {digitalOnly && (
              <div className="flex justify-between text-base font-semibold text-primary pt-2 border-t border-border">
                <span>Total</span>
                <span>{formatPrice(subtotalCents)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
