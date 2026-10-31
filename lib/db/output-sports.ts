import { createServiceRoleClient } from "@/lib/supabase"
import type { ImportRow } from "@/lib/output-sports/map"

/** Service-role client bypasses RLS — these functions are only called from server-side code. */
function getClient() {
  return createServiceRoleClient()
}

/** A business's Output account, without its token. */
export interface OutputConnection {
  business_id: string
  account_email: string
  connected_at: string
  last_error: string | null
}

export interface OutputAthleteLink {
  business_id: string
  client_user_id: string
  output_athlete_id: string
  output_athlete_name: string
  last_synced_at: string | null
}

const LINK_COLUMNS = "business_id, client_user_id, output_athlete_id, output_athlete_name, last_synced_at"

export async function getConnection(businessId: string): Promise<OutputConnection | null> {
  const { data, error } = await getClient()
    .from("output_connections")
    .select("business_id, account_email, connected_at, last_error")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw new Error(`output_connections: ${error.message}`)
  return data as OutputConnection | null
}

/** Stores the refresh token in Vault (never the password) and clears any old error. */
export async function saveConnection(
  businessId: string,
  refreshToken: string,
  accountEmail: string,
  connectedBy: string,
) {
  const { error } = await getClient().rpc("fn_connect_output", {
    p_business_id: businessId,
    p_refresh_token: refreshToken,
    p_account_email: accountEmail,
    p_connected_by: connectedBy,
  })
  if (error) throw new Error(`fn_connect_output: ${error.message}`)
}

export async function getRefreshToken(businessId: string): Promise<string | null> {
  const { data, error } = await getClient().rpc("fn_output_refresh_token", { p_business_id: businessId })
  if (error) throw new Error(`fn_output_refresh_token: ${error.message}`)
  return (data as string | null) ?? null
}

export async function storeRefreshToken(businessId: string, refreshToken: string) {
  const { error } = await getClient().rpc("fn_store_output_refresh_token", {
    p_business_id: businessId,
    p_refresh_token: refreshToken,
  })
  if (error) throw new Error(`fn_store_output_refresh_token: ${error.message}`)
}

export async function setConnectionError(businessId: string, message: string | null) {
  const { error } = await getClient()
    .from("output_connections")
    .update({ last_error: message, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
  if (error) throw new Error(`output_connections: ${error.message}`)
}

export async function disconnect(businessId: string) {
  const { error } = await getClient().rpc("fn_disconnect_output", { p_business_id: businessId })
  if (error) throw new Error(`fn_disconnect_output: ${error.message}`)
}

export async function getLink(businessId: string, clientUserId: string): Promise<OutputAthleteLink | null> {
  const { data, error } = await getClient()
    .from("output_athlete_links")
    .select(LINK_COLUMNS)
    .eq("business_id", businessId)
    .eq("client_user_id", clientUserId)
    .maybeSingle()
  if (error) throw new Error(`output_athlete_links: ${error.message}`)
  return data as OutputAthleteLink | null
}

/** Output athlete id -> the client it is linked to, for the business. */
export async function linkedAthletes(businessId: string): Promise<Map<string, string>> {
  const { data, error } = await getClient()
    .from("output_athlete_links")
    .select("output_athlete_id, client_user_id")
    .eq("business_id", businessId)
  if (error) throw new Error(`output_athlete_links: ${error.message}`)
  return new Map((data ?? []).map((r) => [r.output_athlete_id as string, r.client_user_id as string]))
}

/** Answers "taken" when that Output athlete is already linked to another client. */
export async function linkAthlete(
  businessId: string,
  clientUserId: string,
  athlete: { id: string; name: string },
  linkedBy: string,
): Promise<OutputAthleteLink | "taken"> {
  const { data, error } = await getClient()
    .from("output_athlete_links")
    .upsert(
      {
        business_id: businessId,
        client_user_id: clientUserId,
        output_athlete_id: athlete.id,
        output_athlete_name: athlete.name,
        last_synced_at: null,
        linked_by: linkedBy,
      },
      { onConflict: "business_id,client_user_id" },
    )
    .select(LINK_COLUMNS)
    .single()
  if (error?.code === "23505") return "taken"
  if (error) throw new Error(`output_athlete_links: ${error.message}`)
  return data as OutputAthleteLink
}

export async function unlinkAthlete(businessId: string, clientUserId: string) {
  const { error } = await getClient()
    .from("output_athlete_links")
    .delete()
    .eq("business_id", businessId)
    .eq("client_user_id", clientUserId)
  if (error) throw new Error(`output_athlete_links: ${error.message}`)
}

export async function markSynced(businessId: string, clientUserId: string, at: Date) {
  const { error } = await getClient()
    .from("output_athlete_links")
    .update({ last_synced_at: at.toISOString() })
    .eq("business_id", businessId)
    .eq("client_user_id", clientUserId)
  if (error) throw new Error(`output_athlete_links: ${error.message}`)
}

/**
 * Writes imported results: one row per test per day, keyed on output_key, so a re-sync
 * updates the day's row instead of adding another. Answers how many keys were new.
 * is_pr / pct_change_from_prev are recomputed by the caller afterwards.
 */
export async function upsertImportedTests(clientUserId: string, rows: ImportRow[], createdBy: string): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getClient()
  const { data: existing, error: readError } = await supabase
    .from("performance_tests")
    .select("output_key")
    .eq("client_user_id", clientUserId)
    .in(
      "output_key",
      rows.map((r) => r.output_key),
    )
  if (readError) throw new Error(`performance_tests: ${readError.message}`)
  const known = new Set((existing ?? []).map((r) => r.output_key as string))

  const { error } = await supabase.from("performance_tests").upsert(
    rows.map((r) => ({ ...r, client_user_id: clientUserId, created_by: createdBy, custom_name: null })),
    { onConflict: "client_user_id,output_key" },
  )
  if (error) throw new Error(`performance_tests: ${error.message}`)
  return rows.filter((r) => !known.has(r.output_key)).length
}
