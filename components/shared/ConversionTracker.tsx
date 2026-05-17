"use client"

import { useEffect, useRef } from "react"
import { fireConversion } from "@/lib/google-ads-tag"

interface ConversionTrackerProps {
  /**
   * Full `AW-<account>/<label>` string from getSendTo(kind). Pass from a
   * server component — clients shouldn't know labels directly.
   */
  sendTo: string
  /** Conversion value in cents. Passed in cents so callers don't divide. */
  valueCents?: number
  /** Currency code. Defaults to USD (the only one we use today). */
  currency?: string
  /**
   * Idempotency key for Google's dedup — Stripe checkout session id, order
   * number, signup uuid, etc. If the user refreshes, Google ignores the
   * second hit when transaction_id matches.
   */
  transactionId?: string
  /**
   * Whether the conversion is ready to fire. Pages with async post-checkout
   * reconciliation (Stripe webhook race) pass `false` until the order
   * settles, so a "pending" refresh doesn't burn a conversion that might
   * later refund.
   */
  ready?: boolean
}

/**
 * Generic Google Ads conversion fire. Replaces the per-purpose
 * Purchase / EventBooking trackers — caller picks the kind via the sendTo
 * prop (resolved from getSendTo in lib/ads/conversion-registry.ts).
 *
 * Fires exactly once per mount (StrictMode-safe) and only when ready.
 * No-op in SSR, no-op when gtag isn't loaded.
 */
export function ConversionTracker({
  sendTo,
  valueCents,
  currency = "USD",
  transactionId,
  ready = true,
}: ConversionTrackerProps) {
  const fired = useRef(false)

  useEffect(() => {
    if (!ready) return
    if (fired.current) return
    fired.current = true
    fireConversion({
      send_to: sendTo,
      ...(valueCents !== undefined ? { value: valueCents / 100 } : {}),
      currency,
      ...(transactionId ? { transaction_id: transactionId } : {}),
    })
  }, [sendTo, valueCents, currency, transactionId, ready])

  return null
}
