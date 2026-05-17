// lib/ads/tracking-verification.ts
// Pre-flight check that runs at apply time: does the blueprint's
// conversion_goal + landing_url combo lead to a page that actually fires a
// Google Ads conversion event? If not, the campaign would spend money
// without ever counting conversions — refuse to apply unless an admin
// explicitly overrides.
//
// The chain we're verifying:
//   blueprint.conversion_goal
//     → expected ConversionKind in lib/ads/conversion-registry.ts
//     → expected landing URL pattern that mounts <ConversionTracker> with
//       getSendTo(kind)
//
// Failure modes this catches:
//   - Agent proposes a purchase goal but lands on a page with no
//     post-checkout success route we know about (e.g. /promotions/foo)
//   - Agent proposes a lead goal but lands on a page that doesn't render
//     <InquiryForm> or <ContactForm> (e.g. a blog post)
//   - Agent proposes an event booking goal but lands somewhere that isn't
//     /clinics/<slug> or /camps/<slug>
//
// Not caught here (out of scope — these are runtime checks Google Ads does):
//   - gtag.js failing to load due to ad-blocker (sitewide)
//   - Conversion action being PAUSED / REMOVED in Google Ads
//   - Tag tampering / browser CSP blocking the fire

import type { CampaignBlueprintArgs } from "./agent/decision-schema"
import type { ConversionKind } from "./conversion-registry"

export interface TrackingVerificationResult {
  /**
   *   tracked   — full chain verified; safe to apply
   *   partial   — gtag loads + kind known, but landing URL doesn't match a
   *               known tracker mount point. May still work if the user
   *               navigates to a known success page; flag for review.
   *   untracked — no matching kind for this goal, OR the landing URL is
   *               clearly outside any tracked flow. Refuse to apply.
   */
  status: "tracked" | "partial" | "untracked"
  /** ConversionKind we expect this campaign to fire (null when untracked). */
  expected_kind: ConversionKind | null
  /** Human-readable notes — surfaced in automation_log + UI banner. */
  notes: string[]
}

/**
 * Path patterns that we KNOW mount a <ConversionTracker> with the named
 * kind. Wildcards use `:slug` / `:n` markers (match any non-slash segment).
 * Update when a new tracker is mounted in the codebase.
 */
const TRACKED_LANDING_PATTERNS: Array<{
  kind: ConversionKind
  /** Pages where, after the user action, the tracker fires. */
  endpoints: RegExp[]
  /**
   * Pages the ad can land on that LEAD TO an endpoint above (the user
   * clicks through). If the landing matches one of these, tracking is
   * considered "tracked" (full chain) — otherwise "partial".
   */
  landing_prefixes: string[]
}> = [
  {
    kind: "shop_purchase",
    endpoints: [/^\/shop\/orders\/[^/]+\/thank-you/],
    landing_prefixes: ["/shop", "/programs"],
  },
  {
    kind: "event_booking",
    endpoints: [
      /^\/clinics\/[^/]+\/success/,
      /^\/camps\/[^/]+\/success/,
    ],
    landing_prefixes: ["/clinics/", "/camps/"],
  },
  {
    kind: "program_purchase",
    endpoints: [/^\/client\/programs\/success/],
    landing_prefixes: ["/programs", "/client/programs"],
  },
  {
    kind: "lead_form",
    // InquiryForm renders + fires after submit on these pages.
    endpoints: [],
    landing_prefixes: [
      "/assessment",
      "/online",
      "/in-person",
      "/programs/rotational-reboot",
      "/services",
    ],
  },
  {
    kind: "contact_form",
    endpoints: [],
    landing_prefixes: ["/contact"],
  },
]

const CONVERSION_GOAL_TO_KIND: Record<
  CampaignBlueprintArgs["conversion_goal"],
  ConversionKind | null
> = {
  // form_submission_lead lands on a page with InquiryForm — that's lead_form.
  form_submission_lead: "lead_form",
  // purchase: depends on landing. /programs/* → program_purchase if
  // /client/programs path; /shop/* → shop_purchase. Resolved per-landing below.
  purchase: null,
  // booking goals send people to event detail pages → event_booking.
  booking: "event_booking",
}

/**
 * Returns the path part of an absolute URL or passes through a relative path.
 * Strips trailing slashes for consistent prefix matching.
 */
function normalizeLandingPath(landing: string): string {
  try {
    if (/^https?:\/\//i.test(landing)) {
      const u = new URL(landing)
      return u.pathname.replace(/\/+$/, "") || "/"
    }
  } catch {
    // fall through
  }
  return landing.replace(/\/+$/, "") || "/"
}

/**
 * For a `purchase` goal, decide between shop_purchase and program_purchase
 * based on where the agent says to land users. /client/* is logged-in client
 * checkout; /shop/* is public shop; /programs/* could be either (inquiry
 * page that converts to a shop or client purchase downstream).
 */
function resolvePurchaseKind(landingPath: string): ConversionKind {
  if (landingPath.startsWith("/client/programs")) return "program_purchase"
  if (landingPath.startsWith("/shop")) return "shop_purchase"
  // /programs/<slug> typically funnels into the shop — default there.
  return "shop_purchase"
}

export function verifyTrackingForBlueprint(
  blueprint: CampaignBlueprintArgs,
): TrackingVerificationResult {
  const notes: string[] = []
  const landingPath = normalizeLandingPath(blueprint.ad_copy.final_url)

  // Step 1: resolve the expected ConversionKind from the goal (+ landing
  // for purchase, where the kind splits by domain).
  let expected: ConversionKind | null
  if (blueprint.conversion_goal === "purchase") {
    expected = resolvePurchaseKind(landingPath)
    notes.push(
      `purchase goal → resolved to ${expected} based on landing path ${landingPath}`,
    )
  } else {
    expected = CONVERSION_GOAL_TO_KIND[blueprint.conversion_goal]
  }

  if (!expected) {
    notes.push(
      `No client-side tracker is wired for conversion_goal=${blueprint.conversion_goal}.`,
    )
    return { status: "untracked", expected_kind: null, notes }
  }

  // Step 2: confirm the landing URL leads to a tracked flow.
  const pattern = TRACKED_LANDING_PATTERNS.find((p) => p.kind === expected)
  if (!pattern) {
    // ConversionKind exists in registry but we have no pattern for it —
    // means a new kind was added without registering tracked landings.
    notes.push(
      `Tracker exists for ${expected} but no landing patterns registered. Add entry to TRACKED_LANDING_PATTERNS.`,
    )
    return { status: "partial", expected_kind: expected, notes }
  }

  // 2a. If the landing IS the success endpoint itself, that's full coverage.
  const isEndpoint = pattern.endpoints.some((rx) => rx.test(landingPath))
  if (isEndpoint) {
    notes.push(`Landing ${landingPath} is itself the tracker mount point.`)
    return { status: "tracked", expected_kind: expected, notes }
  }

  // 2b. Otherwise check the landing falls under a known funnel prefix.
  // Strip any trailing slash on the prefix first so /clinics/ matches both
  // /clinics and /clinics/<slug> without producing a double-slash.
  const matchesPrefix = pattern.landing_prefixes.some((prefix) => {
    const cleanPrefix = prefix.replace(/\/+$/, "")
    return landingPath === cleanPrefix || landingPath.startsWith(`${cleanPrefix}/`)
  })
  if (matchesPrefix) {
    notes.push(
      `Landing ${landingPath} feeds a tracked flow (${expected}). Tracker fires after the user completes the funnel.`,
    )
    return { status: "tracked", expected_kind: expected, notes }
  }

  // 2c. No match — would spend without counting conversions.
  notes.push(
    `Landing ${landingPath} doesn't match any tracked funnel for ${expected}. Tracker won't fire — campaign would spend without conversion attribution.`,
  )
  notes.push(
    `Known landing prefixes for ${expected}: ${pattern.landing_prefixes.join(", ") || "(none — endpoint-only)"}`,
  )
  return { status: "untracked", expected_kind: expected, notes }
}
