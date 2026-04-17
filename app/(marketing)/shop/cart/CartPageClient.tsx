"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Minus, Plus, Trash2, ArrowLeft } from "lucide-react"
import { useCart } from "@/lib/shop/cart"
import type { CartItemResponse } from "@/app/api/shop/cart-items/route"

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function CartPageClient() {
  const { lines, updateQuantity, removeItem } = useCart()
  const [cartItems, setCartItems] = useState<CartItemResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lines.length === 0) {
      setCartItems([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const variantIds = lines.map((l) => l.variant_id)

    fetch("/api/shop/cart-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant_ids: variantIds }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load cart items")
        return res.json()
      })
      .then((data: { items: CartItemResponse[] }) => {
        setCartItems(data.items)
      })
      .catch((err: Error) => {
        console.error("[cart page]", err)
        setError("Could not load cart details. Please refresh and try again.")
      })
      .finally(() => setLoading(false))
  }, [lines])

  const hasUnavailable = cartItems.some((item) => !item.is_available)

  const subtotalCents = lines.reduce((sum, line) => {
    const item = cartItems.find((ci) => ci.variant_id === line.variant_id)
    if (!item) return sum
    return sum + item.unit_price_cents * line.quantity
  }, 0)

  // Empty state
  if (!loading && lines.length === 0) {
    return (
      <div className="pt-28 pb-20 lg:pt-36 lg:pb-28 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-4">
            Your Cart
          </h1>
          <p className="text-muted-foreground font-body mb-8">Your cart is empty.</p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium font-body text-sm hover:opacity-90 transition-opacity"
          >
            Browse the Shop
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-28 pb-20 lg:pt-36 lg:pb-28 px-4 sm:px-8">
      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Back to shop */}
        <Link
          href="/shop"
          className="mb-6 inline-flex items-center gap-2 font-body text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          Continue shopping
        </Link>

        {/* Page heading */}
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Shop</p>
            </div>
            <h1 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight">
              Your Cart
            </h1>
          </div>
        </div>

        {/* Unavailability banner */}
        {hasUnavailable && (
          <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">
              Some items are no longer available. Remove them to continue.
            </p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">{error}</p>
          </div>
        )}

        {/* Two-column layout */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-8">
          {/* Items list (2/3) */}
          <div className="lg:col-span-2 space-y-4 mb-8 lg:mb-0">
            {loading ? (
              <div className="space-y-4">
                {lines.map((line) => (
                  <div
                    key={line.variant_id}
                    className="flex gap-4 rounded-2xl border border-border bg-background p-4 animate-pulse"
                  >
                    <div className="w-20 h-20 rounded-xl bg-surface flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-surface rounded w-2/3" />
                      <div className="h-3 bg-surface rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              lines.map((line) => {
                const item = cartItems.find((ci) => ci.variant_id === line.variant_id)
                if (!item) return null

                const lineSubtotal = item.unit_price_cents * line.quantity

                return (
                  <div
                    key={line.variant_id}
                    className={`flex gap-4 rounded-2xl border p-4 transition-colors ${
                      !item.is_available
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border bg-background"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-20 h-20 rounded-xl bg-surface overflow-hidden flex-shrink-0">
                      {item.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail_url}
                          alt={item.product_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-xs text-muted-foreground">No image</span>
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/shop/${item.product_slug}`}
                            className="text-sm font-semibold font-body text-primary hover:text-accent transition-colors truncate block"
                          >
                            {item.product_name}
                          </Link>
                          <p className="text-xs text-muted-foreground font-body mt-0.5">
                            {item.variant_name}
                          </p>
                          {!item.is_available && (
                            <p className="text-xs font-medium text-destructive mt-1">
                              No longer available
                            </p>
                          )}
                        </div>
                        {/* Remove button */}
                        <button
                          type="button"
                          onClick={() => removeItem(line.variant_id)}
                          aria-label="Remove item"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Qty stepper + line subtotal */}
                      <div className="flex items-center justify-between mt-3">
                        {/* Stepper */}
                        <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => updateQuantity(line.variant_id, line.quantity - 1)}
                            disabled={line.quantity <= 1}
                            aria-label="Decrease quantity"
                            className="w-8 h-8 flex items-center justify-center text-primary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-10 h-8 flex items-center justify-center text-sm font-medium text-primary border-x border-border select-none">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(line.variant_id, line.quantity + 1)}
                            disabled={line.quantity >= 99}
                            aria-label="Increase quantity"
                            className="w-8 h-8 flex items-center justify-center text-primary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Line subtotal */}
                        <p className="text-sm font-semibold font-body text-primary">
                          {formatPrice(lineSubtotal)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Order summary panel (1/3, sticky) */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 rounded-2xl border border-border bg-background p-6 space-y-4">
              <h2 className="text-lg font-heading font-semibold text-primary">Order Summary</h2>

              <div className="space-y-2 text-sm font-body">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-medium text-primary">{formatPrice(subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Shipping</span>
                  <span>Calculated at checkout</span>
                </div>
              </div>

              <div className="border-t border-border pt-4 flex justify-between text-base font-semibold font-body text-primary">
                <span>Estimated Total</span>
                <span>{formatPrice(subtotalCents)}</span>
              </div>

              <Link
                href="/shop/checkout"
                aria-disabled={hasUnavailable || loading}
                onClick={(e) => {
                  if (hasUnavailable || loading) e.preventDefault()
                }}
                className={`block w-full text-center px-6 py-3 rounded-xl font-medium font-body text-sm transition-opacity ${
                  hasUnavailable || loading
                    ? "bg-primary/40 text-primary-foreground cursor-not-allowed pointer-events-none"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                }`}
              >
                Proceed to Checkout
              </Link>

              <Link
                href="/shop"
                className="block text-center text-sm text-muted-foreground hover:text-primary transition-colors font-body"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
