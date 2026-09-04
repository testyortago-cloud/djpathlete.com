// lib/db/booking-hosts.ts — reads of `booking_hosts` that are keyed on a
// BUSINESS rather than on the platform's singleton.
//
// `platformHostId()` in lib/tenancy/platform.ts answers the same question for
// the one pre-multi-tenant install, and deliberately returns `null` on a read
// failure so the Calendly webhook cannot 5xx over a transient fault. This file
// is the opposite contract on purpose: its callers are admin routes acting for
// a signed-in coach, where "this business has no calendar host" and "the read
// failed" lead to completely different screens — one offers nothing to
// connect, the other is an outage. Conflating them would tell a coach with a
// perfectly good host row that they have none.
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

/**
 * The business's calendar host — the row a coach's Calendly connection hangs
 * off. Oldest first, because `create_business()` seeds exactly one and a
 * second would be a later, deliberate addition.
 *
 * Returns `null` only when the business genuinely has no host row. THROWS on a
 * read failure: PostgREST resolves rather than throwing, so `{data: null,
 * error}` and "nothing matched" arrive in the same shape, and a caller that
 * could not tell them apart would render "there is nothing here to connect"
 * over a database fault.
 */
export async function getPrimaryBookingHostId(businessId: string): Promise<string | null> {
  const { data, error } = await getClient()
    .from("booking_hosts")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getPrimaryBookingHostId failed (${error.code}): ${error.message}`)
  return (data as { id: string } | null)?.id ?? null
}
