import { createServiceRoleClient } from "@/lib/supabase"
import type { PackRenewalAttempt } from "@/types/database"

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
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
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
