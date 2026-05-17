import Script from "next/script"
import { GOOGLE_ADS_ACCOUNT_ID } from "@/lib/google-ads-tag"

/**
 * Loads gtag.js once and configures both the GA4 measurement (if
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is set) and the Google Ads conversion
 * account. A single gtag.js script handles both — additional
 * `gtag('config', ...)` calls layer on extra IDs.
 *
 * Renders nothing when neither GA nor Google Ads is configured.
 */
export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const adsId = GOOGLE_ADS_ACCOUNT_ID
  if (!measurementId && !adsId) return null

  // Use whichever ID is available as the gtag.js loader anchor — either
  // works; Google's CDN returns the same script.
  const loaderId = measurementId ?? adsId

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${loaderId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          ${measurementId ? `gtag('config', '${measurementId}');` : ""}
          ${adsId ? `gtag('config', '${adsId}');` : ""}
        `}
      </Script>
    </>
  )
}
