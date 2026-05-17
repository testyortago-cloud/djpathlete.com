// lib/google-ads-tag.ts
// Constants + helpers for firing Google Ads conversion events from the
// browser. Tag is loaded sitewide via components/shared/GoogleAnalytics.tsx
// (reuses the same gtag.js the GA4 tag installs).
//
// Conversion IDs come from the Google Ads UI: each conversion action's
// "Tag setup" page shows `send_to: AW-<account_id>/<label>`. We pulled the
// labels via the API in scripts/create-conversion-actions.ts.
//
// To change which actions exist, update them in Google Ads (or via
// scripts/create-conversion-actions.ts) and replace the send_to strings
// below. The account id (AW-...) is the same for every action under that
// Google Ads account.

export const GOOGLE_ADS_ACCOUNT_ID = "AW-18133890533" // customer 4974459872

/**
 * Conversion-action `send_to` strings, one per tracked action. Names match
 * the conversion_action.name in Google Ads. Pulled from
 * conversion_action.tag_snippets via GAQL on 2026-05-17.
 */
export const CONVERSION_SEND_TO = {
  /** $79 Rotational Reboot program purchase. Fires on /shop/orders/<n>/thank-you. */
  purchase_rotational_reboot: "AW-18133890533/m76NCLDN3K4cEOXr9MZD",
  /** Assessment / inquiry form submission. Fires on InquiryForm success. */
  lead_form_submission: "AW-18133890533/Vu0HCLPN3K4cEOXr9MZD",
} as const

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

interface ConversionEventParams {
  send_to: string
  value?: number
  currency?: string
  transaction_id?: string
}

/**
 * Fires a `gtag('event', 'conversion', ...)` call if gtag is loaded.
 * No-op in SSR, no-op when the script hasn't loaded yet (Google's tag
 * doesn't queue these — you get one chance, so call this only AFTER the
 * user actually converted, which means the tag should already be live).
 */
export function fireConversion(params: ConversionEventParams): void {
  if (typeof window === "undefined") return
  if (typeof window.gtag !== "function") return
  window.gtag("event", "conversion", params)
}

/** Convenience wrapper for the Rotational Reboot purchase event. */
export function fireRotationalRebootPurchase(args: {
  value_usd: number
  order_number: string
}): void {
  fireConversion({
    send_to: CONVERSION_SEND_TO.purchase_rotational_reboot,
    value: args.value_usd,
    currency: "USD",
    transaction_id: args.order_number,
  })
}

/** Convenience wrapper for inquiry-form lead conversion. */
export function fireLeadFormSubmission(): void {
  fireConversion({
    send_to: CONVERSION_SEND_TO.lead_form_submission,
    value: 0,
    currency: "USD",
  })
}
