// lib/google-ads-tag.ts
// Low-level gtag plumbing. The tag is loaded sitewide via
// components/shared/GoogleAnalytics.tsx (same gtag.js as GA4).
//
// Conversion routing (which send_to to pick) lives in
// lib/ads/conversion-registry.ts — components should call getSendTo(kind)
// and pass the result to <ConversionTracker> or fireConversion(), not
// hardcode labels here.

/** Google Ads account ID. One per Google Ads customer (4974459872). */
export const GOOGLE_ADS_ACCOUNT_ID = "AW-18133890533"

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
