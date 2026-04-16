"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Loader2, ArrowLeft } from "lucide-react"
import { useCart } from "@/lib/shop/cart"
import { AddressForm } from "@/components/public/shop/AddressForm"
import { CheckoutSummary } from "@/components/public/shop/CheckoutSummary"
import type { ShippingAddress } from "@/lib/validators/shop"
import type { CartItemResponse } from "@/app/api/shop/cart-items/route"

type Step = "address" | "quote"

interface QuoteData {
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  shipping_label: string
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function CheckoutPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { lines, hasItems } = useCart()

  const [step, setStep] = useState<Step>("address")
  const [address, setAddress] = useState<ShippingAddress | null>(null)

  // Cart items resolved from API
  const [cartItems, setCartItems] = useState<CartItemResponse[]>([])
  const [cartLoading, setCartLoading] = useState(true)

  // Quote state
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  // Checkout state
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  // Redirect if cart is empty (after hydration)
  useEffect(() => {
    if (!cartLoading && !hasItems) {
      router.replace("/shop/cart")
    }
  }, [cartLoading, hasItems, router])

  // Load cart item details from API
  useEffect(() => {
    if (lines.length === 0) {
      setCartLoading(false)
      return
    }

    const variantIds = lines.map((l) => l.variant_id)
    fetch("/api/shop/cart-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant_ids: variantIds }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load cart")
        return res.json()
      })
      .then((data: { items: CartItemResponse[] }) => setCartItems(data.items))
      .catch((err: Error) => console.error("[checkout] cart load error:", err))
      .finally(() => setCartLoading(false))
  }, [lines])

  // Session-based prefill values
  const sessionPrefill: Partial<ShippingAddress> = {
    name: session?.user?.name ?? undefined,
    email: session?.user?.email ?? undefined,
  }

  async function handleAddressSubmit(submitted: ShippingAddress) {
    setAddress(submitted)
    setQuote(null)
    setQuoteError(null)
    setQuoteLoading(true)
    setStep("quote")

    try {
      const res = await fetch("/api/shop/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines, address: submitted }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ??
            `Failed to get shipping quote (${res.status})`,
        )
      }

      const data = (await res.json()) as QuoteData
      setQuote(data)
    } catch (err: unknown) {
      setQuoteError(err instanceof Error ? err.message : "Failed to get shipping quote.")
    } finally {
      setQuoteLoading(false)
    }
  }

  async function handlePayWithStripe() {
    if (!address || !quote) return
    setCheckoutError(null)
    setCheckoutLoading(true)

    try {
      const res = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines,
          address,
          shipping_cents: quote.shipping_cents,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ??
            `Checkout failed (${res.status})`,
        )
      }

      const data = (await res.json()) as { url: string }
      window.location.href = data.url
    } catch (err: unknown) {
      setCheckoutError(
        err instanceof Error ? err.message : "Checkout failed. Please try again.",
      )
      setCheckoutLoading(false)
    }
  }

  // Loading skeleton while cart resolves
  if (cartLoading) {
    return (
      <div className="pt-28 pb-20 lg:pt-36 lg:pb-28 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto px-4 py-12 flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="pt-28 pb-20 lg:pt-36 lg:pb-28 px-4 sm:px-8">
      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Page heading */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-12 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">Shop</p>
          </div>
          <h1 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight">
            Checkout
          </h1>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-4">
            <span
              className={`text-sm font-body font-medium ${
                step === "address" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              1. Shipping address
            </span>
            <span className="text-muted-foreground">›</span>
            <span
              className={`text-sm font-body font-medium ${
                step === "quote" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              2. Review &amp; pay
            </span>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-8 items-start">
          {/* Main panel (2/3) */}
          <div className="lg:col-span-2 mb-8 lg:mb-0">
            {/* ── Step A: Address form ── */}
            {step === "address" && (
              <div className="rounded-2xl border border-border bg-background p-6">
                <h2 className="text-lg font-heading font-semibold text-primary mb-5">
                  Shipping address
                </h2>
                <AddressForm
                  initial={address ?? sessionPrefill}
                  onSubmit={handleAddressSubmit}
                />
              </div>
            )}

            {/* ── Step B: Quote review ── */}
            {step === "quote" && (
              <div className="rounded-2xl border border-border bg-background p-6 space-y-6">
                {/* Back button */}
                <button
                  type="button"
                  onClick={() => {
                    setStep("address")
                    setQuoteError(null)
                    setCheckoutError(null)
                  }}
                  className="flex items-center gap-1.5 text-sm font-body text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to address
                </button>

                {/* Address recap */}
                {address && (
                  <div className="rounded-xl border border-border bg-surface/50 p-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                      Shipping to
                    </p>
                    <p className="text-sm font-body text-primary">{address.name}</p>
                    <p className="text-sm font-body text-muted-foreground">
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}
                    </p>
                    <p className="text-sm font-body text-muted-foreground">
                      {address.city}, {address.state} {address.postal_code}
                    </p>
                    <p className="text-sm font-body text-muted-foreground">{address.country}</p>
                  </div>
                )}

                {/* Quote loading */}
                {quoteLoading && (
                  <div className="flex items-center gap-3 py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground flex-shrink-0" />
                    <p className="text-sm font-body text-muted-foreground">
                      Calculating shipping…
                    </p>
                  </div>
                )}

                {/* Quote error */}
                {quoteError && !quoteLoading && (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4">
                    <p className="text-sm font-medium text-destructive mb-3">{quoteError}</p>
                    <button
                      type="button"
                      onClick={() => setStep("address")}
                      className="text-sm font-body text-primary underline underline-offset-2 hover:no-underline"
                    >
                      Try a different address
                    </button>
                  </div>
                )}

                {/* Quote result + pay button */}
                {quote && !quoteLoading && (
                  <div className="space-y-5">
                    {/* Totals */}
                    <div className="rounded-xl border border-border bg-surface/50 p-4 space-y-2 text-sm font-body">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span className="font-medium text-primary">
                          {formatPrice(quote.subtotal_cents)}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>
                          Shipping
                          {quote.shipping_label && (
                            <span className="ml-1 text-xs">({quote.shipping_label})</span>
                          )}
                        </span>
                        <span className="font-medium text-primary">
                          {formatPrice(quote.shipping_cents)}
                        </span>
                      </div>
                      <div className="flex justify-between text-base font-semibold text-primary pt-2 border-t border-border">
                        <span>Total</span>
                        <span>{formatPrice(quote.total_cents)}</span>
                      </div>
                    </div>

                    {/* Checkout error */}
                    {checkoutError && (
                      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
                        <p className="text-sm font-medium text-destructive">{checkoutError}</p>
                      </div>
                    )}

                    {/* Pay button */}
                    <button
                      type="button"
                      onClick={handlePayWithStripe}
                      disabled={checkoutLoading}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium font-body text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {checkoutLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {checkoutLoading ? "Redirecting…" : `Pay ${formatPrice(quote.total_cents)} with Stripe`}
                    </button>

                    <p className="text-xs text-center text-muted-foreground font-body">
                      You&apos;ll be redirected to Stripe to complete your payment securely.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary panel (1/3, sticky) */}
          <div className="lg:col-span-1">
            <div className="sticky top-8">
              <CheckoutSummary items={cartItems} quote={quote ?? undefined} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
