"use client"

import { useEffect, useRef } from "react"
import { fireEventBooking } from "@/lib/google-ads-tag"

interface EventBookingConversionTrackerProps {
  /** Stripe session id OR event_signup row id — used as transaction_id for dedupe. */
  transactionId: string
  /** Booking value in cents. event.price_cents at signup time. */
  valueCents: number
  /** Signup status — only 'confirmed' fires the conversion. */
  status: "pending" | "confirmed" | "cancelled" | "refunded"
}

/**
 * Fires exactly once per mount when an event booking lands on the success
 * page in `confirmed` state. `pending` (Stripe webhook hasn't fired yet) is
 * intentionally skipped — the user often refreshes that page; we don't want
 * to count a refund/cancellation that resolves later as a conversion. If the
 * webhook arrives during the user's session and they refresh, we get the
 * fire then.
 */
export function EventBookingConversionTracker({
  transactionId,
  valueCents,
  status,
}: EventBookingConversionTrackerProps) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    if (status !== "confirmed") return
    fired.current = true

    fireEventBooking({
      value_usd: valueCents / 100,
      transaction_id: transactionId,
    })
  }, [transactionId, valueCents, status])

  return null
}
