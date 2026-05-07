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
 * Look up a recent attribution row for an email-match fallback (used by GHL
 * booking webhook when gclid is missing in the payload). Joins through
 * users.email — only finds rows that were claimed by a user with this email.
 */
export async function findAttributionByEmail(
  email: string,
  withinDays = 30,
): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*, users!inner(email)")
    .eq("users.email", email.toLowerCase().trim())
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
