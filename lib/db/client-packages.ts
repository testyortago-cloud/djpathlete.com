import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientPackage, ClientPackageStatus } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function createClientPackage(p: Omit<ClientPackage, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").insert(p).select().single()
  if (error) throw error
  return data as ClientPackage
}

export async function getClientPackageById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*").eq("id", id).single()
  if (error) throw error
  return data as ClientPackage
}

/** Like getClientPackageById but returns null instead of throwing when absent. */
export async function getClientPackageByIdMaybe(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data as ClientPackage | null
}

/**
 * Compare-and-swap increment of credits_used (atomic at the row level): only
 * succeeds if credits_used still equals `expectedUsed`, so two concurrent
 * check-ins can't both deduct from the same read value. Returns null when
 * another writer moved first (caller re-reads + retries).
 */
export async function casBumpCreditUsed(id: string, expectedUsed: number, status: ClientPackageStatus) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_packages")
    .update({ credits_used: expectedUsed + 1, status })
    .eq("id", id)
    .eq("credits_used", expectedUsed)
    .select()
    .maybeSingle()
  if (error) throw error
  return data as ClientPackage | null
}

export async function listPackagesForClient(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_packages")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("purchased_at", { ascending: false })
  if (error) throw error
  return data as ClientPackage[]
}

/** Oldest active, non-expired pack with credits remaining — the one to deduct from. */
export async function getActivePackageForClient(clientUserId: string, nowIso: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_packages")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("purchased_at", { ascending: true })
  if (error) throw error
  return (data as ClientPackage[]).find((p) => p.credits_used < p.credits_total) ?? null
}

/** Hard-delete a pack. session_checkins rows cascade (FK on delete cascade). */
export async function deleteClientPackage(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("client_packages").delete().eq("id", id)
  if (error) throw error
}

export async function updateClientPackage(id: string, patch: Partial<ClientPackage>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as ClientPackage
}

export async function getPackageByStripeSession(sessionId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_packages")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .maybeSingle()
  if (error) throw error
  return data as ClientPackage | null
}

export async function getPackageByStripePaymentId(stripePaymentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_packages")
    .select("*")
    .eq("stripe_payment_id", stripePaymentId)
    .maybeSingle()
  if (error) throw error
  return data as ClientPackage | null
}

/** All active packs — used by the renewal-reminder scanner. */
export async function listActivePackages() {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*").eq("status", "active")
  if (error) throw error
  return data as ClientPackage[]
}

export type ClientPackageWithUser = ClientPackage & {
  users: { id: string; first_name: string; last_name: string; email: string } | null
}

/** Active-pack clients for the Today screen / self-check-in roster. */
export async function listActivePackClients() {
  const supabase = getClient()
  // Disambiguate the embed: client_packages has two FKs to users
  // (client_user_id + created_by), so a bare `users` embed is ambiguous
  // (PostgREST PGRST201) and the query throws. Pin it to the client_user_id FK.
  // client_user_id is NOT NULL + FK-enforced, so this always resolves a user
  // (equivalent to an inner join); callers also guard with `if (!r.users)`.
  const { data, error } = await supabase
    .from("client_packages")
    .select("*, users!client_packages_client_user_id_fkey(id, first_name, last_name, email)")
    .eq("status", "active")
    .order("purchased_at", { ascending: true })
  if (error) throw error
  return data as ClientPackageWithUser[]
}
