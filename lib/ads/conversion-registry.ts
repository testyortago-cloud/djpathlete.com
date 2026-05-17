// lib/ads/conversion-registry.ts
// Single source of truth for client-side gtag `send_to` strings, keyed by
// semantic conversion kind. Adding a new tracked event means:
//
//   1. Create the conversion action in Google Ads (or via
//      scripts/create-conversion-actions.ts).
//   2. Add a row here mapping its kind → conversion_label.
//   3. Add the kind to ConversionKind union.
//   4. Call getSendTo(kind) from any page that needs it.
//
// No component code knows specific product names anymore — pages pick the
// kind, the registry resolves the label. Mirrored in the DB via
// google_ads_conversion_actions.client_trigger_kind + conversion_label for
// auditing + future admin-UI editing, but lookup is in-memory for SSR speed
// (these labels are stable per Google Ads account).

import { GOOGLE_ADS_ACCOUNT_ID } from "@/lib/google-ads-tag"

/**
 * Semantic role for each tracked client-side conversion. Each kind maps to
 * exactly ONE Google Ads conversion action via the label below. Extend by
 * adding a new variant + a row in CONVERSION_LABELS.
 */
export type ConversionKind =
  /** Stripe checkout from /shop (any digital / POD product). */
  | "shop_purchase"
  /** Stripe checkout from a paid camp/clinic signup. */
  | "event_booking"
  /** Stripe checkout from a client-side program buy ($99-$349 tiers). */
  | "program_purchase"
  /** Successful submission of the marketing-side inquiry form. */
  | "lead_form"
  /** Successful submission of the contact form. */
  | "contact_form"

/**
 * Just the suffix after the slash in send_to. Pulled live via GAQL from
 * conversion_action.tag_snippets — see scripts/create-conversion-actions.ts.
 * One label per kind per Google Ads account.
 */
const CONVERSION_LABELS: Record<ConversionKind, string> = {
  shop_purchase: "m76NCLDN3K4cEOXr9MZD", // Rotational Reboot Purchase action; covers all shop SKUs today
  event_booking: "d9FLCLDs3a4cEOXr9MZD", // Event Booking (Camp/Clinic)
  program_purchase: "m76NCLDN3K4cEOXr9MZD", // Reuses shop_purchase action — split if reporting separation matters
  lead_form: "Vu0HCLPN3K4cEOXr9MZD", // Assessment Form Submission action; used by every InquiryForm
  contact_form: "Vu0HCLPN3K4cEOXr9MZD", // Reuses lead_form action
}

/**
 * Returns the full `AW-<account>/<label>` send_to string for a kind.
 * Used by every success page server-side, then passed to the client
 * tracker as a prop — no component hardcodes labels anymore.
 */
export function getSendTo(kind: ConversionKind): string {
  return `${GOOGLE_ADS_ACCOUNT_ID}/${CONVERSION_LABELS[kind]}`
}
