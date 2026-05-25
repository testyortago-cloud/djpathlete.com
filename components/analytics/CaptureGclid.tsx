"use client"

import { useEffect } from "react"

/**
 * Capture the Google Ads click id (?gclid=...) on first paint and stash it in
 * a 90-day cookie. Inquiry / contact form submissions read the cookie and
 * forward gclid to the API, where it's stored on the lead in GHL so we can
 * later upload qualified-conversion outcomes back to Google Ads.
 *
 * Mounted once site-wide in app/layout.tsx; renders nothing.
 */
export function CaptureGclid() {
  useEffect(() => {
    const gclid = new URLSearchParams(window.location.search).get("gclid")
    if (!gclid) return
    // Sanitize: gclid is opaque but always [A-Za-z0-9_-]; reject anything else
    // so a hostile querystring can't smuggle cookie attributes through.
    if (!/^[A-Za-z0-9_-]+$/.test(gclid)) return
    const maxAge = 90 * 24 * 60 * 60
    document.cookie = `gclid=${gclid};max-age=${maxAge};path=/;SameSite=Lax`
  }, [])
  return null
}
