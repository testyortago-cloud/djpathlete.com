import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientPackage, PackRenewalAttempt } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/**
 * Insert a renewal attempt, relying on the unique source_package_id index for
 * idempotency. Returns null when an attempt already exists for this pack — the
 * caller MUST treat null as "someone else is handling it" and stop, because the
 * insert is the only thing standing between a race and a double charge.
 */
export async function createRenewalAttemptIfAbsent(a: Omit<PackRenewalAttempt, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .upsert(a, { onConflict: "source_package_id", ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw error
  return data as PackRenewalAttempt | null
}

export async function updateRenewalAttempt(id: string, patch: Partial<PackRenewalAttempt>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("pack_renewal_attempts").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as PackRenewalAttempt
}

export async function getAttemptForPackage(sourcePackageId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("*")
    .eq("source_package_id", sourcePackageId)
    .maybeSingle()
  if (error) throw error
  return data as PackRenewalAttempt | null
}

/**
 * I2: count attempts still `pending` older than `beforeIso` — the signature
 * of a crash between createRenewalAttemptIfAbsent's insert and chargeSavedCard
 * in attemptPackRenewal. That insert reserves the row BEFORE the charge call,
 * which is what makes the unique source_package_id index a safe lock — but
 * it also means a process death in that exact gap leaves the row stuck
 * `pending` forever: listDepletedAutoRenewPackages excludes any pack that
 * already has an attempt row, so the pack can never be picked up again, and
 * nothing else ever revisits a `pending` status. Never auto-retried from
 * here (Stripe's idempotency key expires at 24h, so a blind retry past that
 * window risks a genuine double charge) — this only counts, for a human to
 * reconcile against Stripe.
 */
export async function countStalePendingRenewalAttempts(beforeIso: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("pack_renewal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", beforeIso)
  if (error) throw error
  return count ?? 0
}

/**
 * Count renewals that RESOLVED into "a human has to collect this" and still
 * have not been paid: a `skipped` (no card) or `failed` (declined) attempt
 * whose replacement pack is still awaiting payment.
 *
 * Distinct from countStalePendingRenewalAttempts above, which watches for an
 * attempt stuck mid-flight. These attempts are not stuck — they finished, and
 * finished correctly. What goes missing is the part AFTER the status update:
 * attemptPackRenewal emails the payment link and alerts the admins from the
 * inline check-in path, which is deliberately fire-and-forget (Stripe latency
 * must never sit in the door-open path), so the process is free to disappear
 * before the alert lands. It did: a $1,500 renewal skipped with `no_card`,
 * minted its link, and told nobody.
 *
 * Deliberately NOT time-boxed the way the stale check is: an unpaid pack does
 * not stop mattering after an hour. It self-clears instead — paying flips the
 * pack to `paid`, and voiding it moves `status` off `active`, so a renewal the
 * coach has settled or abandoned drops out of the count on its own rather than
 * nagging forever.
 *
 * Two queries rather than one embedded join: PostgREST needs `!inner` for a
 * filter on an embedded table to actually restrict the rows, and getting that
 * subtly wrong fails by counting too MANY — an alert that cries wolf daily is
 * how a real one gets ignored.
 */
export async function countRenewalsAwaitingPayment(): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("new_package_id")
    .in("status", ["skipped", "failed"])
    .not("new_package_id", "is", null)
  if (error) throw error
  const ids = (data ?? []).map((row) => (row as { new_package_id: string }).new_package_id)
  if (ids.length === 0) return 0
  const { count, error: packError } = await supabase
    .from("client_packages")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .eq("payment_status", "pending")
    .eq("status", "active")
  if (packError) throw packError
  return count ?? 0
}

/**
 * The same set countRenewalsAwaitingPayment counts, as rows the cron can act on.
 *
 * DELIBERATELY NOT sharing a query with that function. Its shape was validated
 * against production and its failure mode is counting too many, which is how a
 * real alert gets ignored; a refactor that quietly widened it would be invisible
 * until an alert fired for a pack that was fine. If you change the filters in
 * one of these, change them in the other — they are two readings of one rule.
 */
export async function listRenewalsAwaitingPayment(): Promise<ClientPackage[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("new_package_id")
    .in("status", ["skipped", "failed"])
    .not("new_package_id", "is", null)
  if (error) throw error
  const ids = (data ?? []).map((row) => (row as { new_package_id: string }).new_package_id)
  if (ids.length === 0) return []
  const { data: packs, error: packError } = await supabase
    .from("client_packages")
    .select("*")
    .in("id", ids)
    .eq("payment_status", "pending")
    .eq("status", "active")
  if (packError) throw packError
  return (packs ?? []) as ClientPackage[]
}

export async function listRenewalAttempts(limit = 100) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as PackRenewalAttempt[]
}

/** One client's renewal attempts (newest first) — the trainee, not the payer,
 *  so this reads correctly even when a household payer's card was charged. */
export async function listRenewalAttemptsForUser(userId: string, limit = 20) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as PackRenewalAttempt[]
}
