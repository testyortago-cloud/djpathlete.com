import type { TrackingParams } from "@/lib/validators/marketing"
import { TRACKING_PARAM_KEYS } from "@/lib/validators/marketing"

const MAX_PARAM_LEN = 200
const MAX_URL_LEN = 2000

function clip(s: string | null | undefined, max: number): string | undefined {
  if (s == null) return undefined
  return s.slice(0, max)
}

/**
 * The landing_url we record for a visit: origin + pathname, with the query
 * string and fragment dropped (they carry the tracking params themselves, and
 * often a session's worth of personal detail besides), clipped to the 2000
 * chars the Zod schema allows.
 *
 * Exported because proxy.ts needs exactly this string for an ORGANIC /go
 * landing, where `extractTrackingParamsFromUrl` below deliberately leaves
 * landing_url unset (no tracking param was present to hang it off). The
 * middleware calling this rather than re-doing `origin + pathname` by hand is
 * what stops the two clips drifting apart.
 */
export function landingUrlFor(url: URL): string {
  return (url.origin + url.pathname).slice(0, MAX_URL_LEN)
}

/**
 * Pull tracking params out of a URL's query string. Truncates oversize values
 * to 200 chars (Zod schema enforces the same).
 */
export function extractTrackingParamsFromUrl(url: URL): TrackingParams {
  const out: TrackingParams = {}
  for (const k of TRACKING_PARAM_KEYS) {
    const v = url.searchParams.get(k)
    if (v) out[k] = clip(v, MAX_PARAM_LEN)
  }
  // landing_url = origin + pathname (no query/fragment), only set if any tracking param is present
  if (Object.keys(out).length > 0) {
    out.landing_url = landingUrlFor(url)
  }
  return out
}

/**
 * Returns true if any of the 9 tracking-identifier keys (gclid, gbraid, wbraid,
 * fbclid, utm_*) is set. landing_url and referrer alone don't count — those
 * are context we capture only when one of the 9 is also present.
 */
export function hasAnyTrackingParam(params: TrackingParams): boolean {
  return TRACKING_PARAM_KEYS.some((k) => params[k] != null && params[k] !== "")
}
