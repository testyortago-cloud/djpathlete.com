// lib/db/funnel-checkout-grants.ts — the anonymous-purchase idempotency ledger.
//
// Two functions, and between them they are the only thing standing between a
// Stripe retry and a second program grant plus a second "set your password"
// email to someone who has already set one.

import { createServiceRoleClient } from "@/lib/supabase"

export interface FunnelCheckoutGrantRow {
  /**
   * Exactly one of these two is set — the database enforces it with a CHECK
   * (`num_nonnulls(...) = 1`, migration 00235), not just this comment.
   * `stripe_session_id` for a checkout, `opportunity_id` for a grant made by
   * hand from a won pipeline card.
   */
  stripe_session_id?: string | null
  opportunity_id?: string | null
  user_id: string
  email: string
  product_kind: "program"
  product_id: string
  funnel_id: string | null
  step_id: string | null
  lead_id: string | null
  account_created: boolean
}

/**
 * Has this checkout session already been granted?
 *
 * THROWS RATHER THAN RETURNING FALSE when the table cannot be read, and that is
 * deliberate. `grantFunnelPurchase` treats a throw here as a refusal to
 * proceed: being unable to check is not permission to risk a double grant on a
 * path where the money has already moved. A `false` on error would be the
 * opposite — the most dangerous possible default, silently.
 *
 * This is also what makes a MISSING TABLE safe. If 00208 has not been applied,
 * every read throws, the grant refuses, and the failure is alerted — rather
 * than the flow deciding nothing has been processed and granting on every
 * single retry.
 */
export async function hasProcessedCheckoutSession(sessionId: string): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("funnel_checkout_grants")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle()
  if (error) throw new Error(`funnel_checkout_grants read failed: ${error.message}`)
  return data !== null
}

/**
 * Records a completed grant.
 *
 * A UNIQUE VIOLATION IS SUCCESS, NOT AN ERROR. Two webhook deliveries can both
 * pass `hasProcessedCheckoutSession` before either writes; the database refuses
 * the second insert, and that refusal means "the other delivery got there
 * first", which is exactly the outcome wanted. Reporting it as a failure would
 * raise a paid-but-not-delivered alert about a purchase that was delivered.
 */
/**
 * Has this pipeline card already been granted?
 *
 * The manual sibling of `hasProcessedCheckoutSession`, and it inherits that
 * function's posture exactly: it THROWS rather than returning false when the
 * table cannot be read, because being unable to check is not permission to
 * risk a second account and a second "set your password" email to somebody
 * who has already set one.
 */
export async function hasGrantedOpportunity(opportunityId: string): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("funnel_checkout_grants")
    .select("id")
    .eq("opportunity_id", opportunityId)
    .maybeSingle()
  if (error) throw new Error(`funnel_checkout_grants read failed: ${error.message}`)
  return data !== null
}

export async function recordCheckoutGrant(row: FunnelCheckoutGrantRow): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("funnel_checkout_grants").insert(row)
  if (!error) return
  // 23505 = unique_violation.
  if (error.code === "23505") return
  throw new Error(`funnel_checkout_grants insert failed: ${error.message}`)
}
