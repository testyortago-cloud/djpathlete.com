import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

/**
 * The platform's OWN business -- the tenant that owns darrenjpaul.com.
 *
 * This is a SEAM, not a resolution, and the distinction is the point. Three
 * surfaces genuinely cannot resolve a tenant yet:
 *   - the Calendly webhook, until phase 2 gives each coach a connection row
 *     whose event-type URI identifies the business;
 *   - the GHL booking webhook, which is the calendar Calendly replaces and
 *     will never be per-coach;
 *   - public pages, until phase 4 resolves the Host header.
 *
 * Each of those calls this instead of writing the constant inline, so phase 2
 * and phase 4 have ONE greppable place to change rather than four literals
 * scattered across routes. Calling it a resolution would be a lie; naming it
 * honestly is the whole value.
 */
export function platformBusinessId(): string {
  return SINGLETON_BUSINESS_ID
}
