import { createServiceRoleClient } from "@/lib/supabase"
import type { MarketingAttribution } from "@/types/database"
import type { TrackingParams } from "@/lib/validators/marketing"

function getClient() {
  return createServiceRoleClient()
}

/**
 * UPSERT by session_id. Updates last_seen_at on every call;
 * fills tracking params only if previously NULL (first-touch wins).
 */
export async function upsertAttributionBySession(
  session_id: string,
  params: TrackingParams,
): Promise<MarketingAttribution> {
  const supabase = getClient()
  const { data: existing } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("session_id", session_id)
    .maybeSingle()

  if (existing) {
    // First-touch wins: only update tracking params if existing row has nulls.
    const updates: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
    for (const k of [
      "gclid", "gbraid", "wbraid", "fbclid",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    ] as const) {
      if (existing[k] == null && params[k] != null) updates[k] = params[k]
    }
    if (existing.landing_url == null && params.landing_url != null) updates.landing_url = params.landing_url
    if (existing.referrer == null && params.referrer != null) updates.referrer = params.referrer

    const { data, error } = await supabase
      .from("marketing_attribution")
      .update(updates)
      .eq("session_id", session_id)
      .select()
      .single()
    if (error) throw error
    return data as MarketingAttribution
  }

  const { data, error } = await supabase
    .from("marketing_attribution")
    .insert({
      session_id,
      gclid: params.gclid ?? null,
      gbraid: params.gbraid ?? null,
      wbraid: params.wbraid ?? null,
      fbclid: params.fbclid ?? null,
      utm_source: params.utm_source ?? null,
      utm_medium: params.utm_medium ?? null,
      utm_campaign: params.utm_campaign ?? null,
      utm_term: params.utm_term ?? null,
      utm_content: params.utm_content ?? null,
      landing_url: params.landing_url ?? null,
      referrer: params.referrer ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as MarketingAttribution
}

/**
 * Look up the most recent unclaimed attribution row for a session_id.
 * Returns null if not found or already claimed.
 */
export async function getUnclaimedAttribution(
  session_id: string,
): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("session_id", session_id)
    .is("claimed_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingAttribution | null) ?? null
}

/**
 * Read the attribution row for a session REGARDLESS of claim status.
 *
 * Use this anywhere you only need the tracking params (gclid/utm) — e.g.
 * stamping a checkout. `getUnclaimedAttribution` exists to find a row that is
 * still available to CLAIM; using it to read tracking params means the row
 * silently disappears the moment anything claims it, which would drop the gclid
 * off every checkout a registered user makes.
 */
export async function getAttributionBySession(
  session_id: string,
): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("session_id", session_id)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingAttribution | null) ?? null
}

/**
 * Mark an attribution row as claimed by a user. Idempotent.
 */
export async function claimAttribution(
  attributionId: string,
  userId: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("marketing_attribution")
    .update({ user_id: userId, claimed_at: new Date().toISOString() })
    .eq("id", attributionId)
    .is("claimed_at", null)
  if (error) throw error
}

/**
 * Attribution for a contact, keyed on the contact's OWN user_id.
 *
 * marketing_attribution has no business_id and cannot get one in this phase:
 * captureAttribution runs in proxy.ts, where the tenant is not resolved until
 * phase 4, and a column with no correct writer is a labelling gap rather than
 * a feature. So the tenant safety here comes from HOW the userId was obtained
 * -- the caller resolved it from a contact of its own business.
 *
 * The old `users!inner(email)` join is gone, and nothing is lost by it:
 * marketing_attribution.user_id is nullable with a partial index
 * (00101:7,25), so that join only ever matched rows already CLAIMED by a
 * registered user. A contact with no user_id had no match then either -- and
 * an EMAIL match besides was a cross-tenant path once two coaches can share a
 * lead: a click id captured on coach A's funnel would attach to coach B's
 * contact the moment that shared lead typed the same address into both.
 * user_id is unique to one account, never shared across businesses the way an
 * email string can be, so keying on it removes that path with no schema
 * change.
 *
 * The 30-day default window is unchanged -- it is a settled decision.
 */
export async function findAttributionForContact(args: {
  userId: string
  withinDays?: number
}): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const since = new Date(Date.now() - (args.withinDays ?? 30) * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("user_id", args.userId)
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingAttribution | null) ?? null
}

export async function countByAttributionSourceInRange(
  from: Date,
  to: Date,
): Promise<Array<{ source: string; count: number }>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("utm_source")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
  if (error) throw error
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ utm_source: string | null }>) {
    const src = r.utm_source ?? "direct"
    counts.set(src, (counts.get(src) ?? 0) + 1)
  }
  return Array.from(counts, ([source, count]) => ({ source, count })).sort(
    (a, b) => b.count - a.count,
  )
}
