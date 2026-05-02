import type { TrackingParams } from "@/lib/validators/marketing"
import { TRACKING_PARAM_KEYS } from "@/lib/validators/marketing"

const MAX_PARAM_LEN = 200
const MAX_URL_LEN = 2000

function clip(s: string | null | undefined, max: number): string | undefined {
  if (s == null) return undefined
  return s.slice(0, max)
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
    out.landing_url = clip(url.origin + url.pathname, MAX_URL_LEN)
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
