// lib/ads/geo-target-resolver.ts
// Converts free-form blueprint geo_targets (ISO codes for online programs,
// city/region strings for in-person services and events) into Google Ads
// `geoTargetConstants/{id}` resource names so they can be attached as
// campaign criteria.
//
// Two paths:
//   1. ISO-2 country codes (e.g. "US", "GB") → hardcoded map (fast, free, no API).
//   2. Anything else (e.g. "Tampa Bay, FL", "Phoenix, AZ") → Google Ads
//      `geoTargetConstants:suggest` REST endpoint.
//
// Uses REST (not the gRPC SDK) for the same reason `listAccessibleCustomers`
// does — Webpack-bundled gRPC fails on Vercel with duplicated `@grpc/grpc-js`.
//
// Returns `{ resolved, unresolved }` so callers can decide how to surface
// failures (we don't fail the whole apply when only one city doesn't match).

import { getPlatformConnection } from "@/lib/db/platform-connections"

const GOOGLE_ADS_API_VERSION = "v21"

/**
 * ISO-2 country code → geoTargetConstant numeric ID.
 * Source: https://developers.google.com/google-ads/api/data/geotargets
 * Limited to countries we actually market to — extend as needed.
 */
const COUNTRY_CODE_TO_GEO_ID: Record<string, string> = {
  US: "2840",
  AU: "2036",
  NZ: "2554",
  GB: "2826",
  CA: "2124",
  IE: "2372",
  ZA: "2710",
  DE: "2276",
  FR: "2250",
  ES: "2724",
  IT: "2380",
  NL: "2528",
  SE: "2752",
  NO: "2578",
  DK: "2208",
  FI: "2246",
  MX: "2484",
  BR: "2076",
  AR: "2032",
  CL: "2152",
  IN: "2356",
  JP: "2392",
  SG: "2702",
  PH: "2608",
  AE: "2784",
}

export interface ResolvedGeoTarget {
  /** Original blueprint string (for surfacing in logs / UI). */
  source: string
  /** Full Google Ads resource name, e.g. "geoTargetConstants/2840". */
  resource_name: string
  /** "country" | "region" | "city" | other Google Ads target_type. */
  target_type: string
  /** Canonical name returned by Google (e.g. "Tampa, Florida, United States"). */
  canonical_name: string | null
}

export interface ResolveGeoTargetsResult {
  resolved: ResolvedGeoTarget[]
  unresolved: string[]
}

const ISO_CODE_REGEX = /^[A-Z]{2}$/

function isCountryCode(s: string): boolean {
  return ISO_CODE_REGEX.test(s.trim())
}

interface SuggestResponse {
  geoTargetConstantSuggestions?: Array<{
    geoTargetConstant?: {
      resourceName?: string
      targetType?: string
      canonicalName?: string
      countryCode?: string
    }
    geoTargetConstantParent?: unknown
    locale?: string
    reach?: string
    searchTerm?: string
  }>
}

async function refreshAccessToken(refresh_token: string): Promise<string> {
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!client_id || !client_secret) {
    throw new Error("Google Ads client_id/secret missing")
  }
  const params = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: "refresh_token",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (!res.ok) {
    throw new Error(`OAuth refresh failed: HTTP ${res.status}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("OAuth refresh: missing access_token")
  return json.access_token
}

/**
 * Calls geoTargetConstants:suggest for a batch of free-form location names.
 * Picks the top-reach suggestion per name. Returns a map keyed by the input
 * (lower-cased, trimmed) so callers can correlate back to their source list.
 */
async function suggestGeoTargetConstants(
  names: string[],
): Promise<Map<string, ResolvedGeoTarget>> {
  const out = new Map<string, ResolvedGeoTarget>()
  if (names.length === 0) return out
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!developer_token) {
    // Without a dev token Google rejects the call; fail gracefully (caller
    // treats these as unresolved and the admin will set geo in the UI).
    return out
  }
  const conn = await getPlatformConnection("google_ads")
  const refresh_token = conn?.credentials?.refresh_token as string | undefined
  if (!refresh_token) return out

  const access_token = await refreshAccessToken(refresh_token)
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/geoTargetConstants:suggest`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access_token}`,
      "developer-token": developer_token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      locale: "en",
      countryCode: "US", // bias toward US matches when ambiguous; safe default
      locationNames: { names },
    }),
  })
  if (!res.ok) {
    // Don't throw — caller will note these as unresolved.
    return out
  }
  const body = (await res.json()) as SuggestResponse
  const suggestions = body.geoTargetConstantSuggestions ?? []

  // Suggestions come back without a clear input→suggestion key — Google
  // returns them in input order, but a single input can produce multiple
  // suggestions (city, metro, etc.). We pick the FIRST suggestion per
  // distinct searchTerm if present; otherwise we map by position.
  const byTerm = new Map<string, ResolvedGeoTarget>()
  for (let i = 0; i < suggestions.length; i++) {
    const sug = suggestions[i]
    const gtc = sug.geoTargetConstant
    if (!gtc?.resourceName) continue
    const inputKey = (sug.searchTerm ?? names[i] ?? "").trim().toLowerCase()
    if (!inputKey || byTerm.has(inputKey)) continue
    byTerm.set(inputKey, {
      source: sug.searchTerm ?? names[i] ?? "",
      resource_name: gtc.resourceName,
      target_type: gtc.targetType ?? "unknown",
      canonical_name: gtc.canonicalName ?? null,
    })
  }
  for (const [k, v] of byTerm) out.set(k, v)
  return out
}

/**
 * Resolve a list of blueprint geo strings to Google Ads geoTargetConstant
 * resource names. Country codes are mapped locally; everything else falls
 * through to the suggest API.
 */
export async function resolveGeoTargets(
  geo_targets: string[],
): Promise<ResolveGeoTargetsResult> {
  const resolved: ResolvedGeoTarget[] = []
  const unresolved: string[] = []
  const freeForm: string[] = []

  for (const raw of geo_targets) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (isCountryCode(trimmed)) {
      const id = COUNTRY_CODE_TO_GEO_ID[trimmed.toUpperCase()]
      if (id) {
        resolved.push({
          source: trimmed,
          resource_name: `geoTargetConstants/${id}`,
          target_type: "Country",
          canonical_name: trimmed.toUpperCase(),
        })
      } else {
        // Unknown country code — push to suggest as fallback.
        freeForm.push(trimmed)
      }
    } else {
      freeForm.push(trimmed)
    }
  }

  if (freeForm.length > 0) {
    try {
      const suggestions = await suggestGeoTargetConstants(freeForm)
      for (const term of freeForm) {
        const match = suggestions.get(term.trim().toLowerCase())
        if (match) {
          resolved.push(match)
        } else {
          unresolved.push(term)
        }
      }
    } catch {
      // Suggest API broken or token missing — mark all free-form as unresolved.
      for (const term of freeForm) unresolved.push(term)
    }
  }

  return { resolved, unresolved }
}

/**
 * Decides whether a campaign should be geo-targeted at all. Online programs
 * with worldwide reach can legitimately have NO geo criteria (= all locations).
 * Local services and events must have at least one resolved target — otherwise
 * we'd be paying for impressions everywhere.
 *
 * Returns:
 *   - "ok" — proceed (either has resolved targets, or is intentionally global)
 *   - { error } — block the apply with a human-readable reason
 */
export function validateGeoCoverage(input: {
  conversion_type: "purchase" | "lead" | "booking"
  inventory_kind: "product" | "event"
  resolved_count: number
  unresolved: string[]
  source_count: number
}): { ok: true } | { ok: false; error: string } {
  // Events MUST have a resolved location — no exceptions.
  if (input.inventory_kind === "event" && input.resolved_count === 0) {
    return {
      ok: false,
      error:
        input.unresolved.length > 0
          ? `Couldn't resolve event location(s): ${input.unresolved.join(", ")}. Set geo targeting manually in Google Ads before enabling.`
          : "Event campaign has no geo targets. Set a location in Google Ads before enabling.",
    }
  }
  // Lead-gen and booking campaigns shouldn't run nationwide by accident —
  // require at least one resolved target.
  if (
    (input.conversion_type === "lead" || input.conversion_type === "booking") &&
    input.resolved_count === 0
  ) {
    return {
      ok: false,
      error: `${input.conversion_type === "lead" ? "Lead-gen" : "Booking"} campaign has no resolved geo targets. ${input.unresolved.length > 0 ? `Couldn't resolve: ${input.unresolved.join(", ")}.` : ""} Set geo targeting in Google Ads before enabling.`,
    }
  }
  // Purchase campaigns (online programs) may legitimately go global — if the
  // agent emitted geo_targets and we resolved none, fail loudly; if it
  // emitted none, allow worldwide.
  if (input.source_count > 0 && input.resolved_count === 0) {
    return {
      ok: false,
      error: `Couldn't resolve any geo targets (${input.unresolved.join(", ")}). Set geo targeting in Google Ads before enabling.`,
    }
  }
  return { ok: true }
}
