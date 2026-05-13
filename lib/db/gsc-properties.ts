// lib/db/gsc-properties.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GscProperty } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getGscProperty(): Promise<GscProperty | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("gsc_properties")
    .select("*")
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as GscProperty | null) ?? null
}

export interface UpsertGscPropertyInput {
  site_url: string
  refresh_token: string
  access_token: string | null
  access_token_expires: string | null
  connected_by_user_id: string
}

export async function upsertGscProperty(
  input: UpsertGscPropertyInput,
): Promise<GscProperty> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("gsc_properties")
    .upsert(
      {
        ...input,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "site_url" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GscProperty
}

export async function updateAccessToken(
  id: string,
  accessToken: string,
  expiresAtIso: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("gsc_properties")
    .update({
      access_token: accessToken,
      access_token_expires: expiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw error
}

export async function deleteGscProperty(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("gsc_properties").delete().eq("id", id)
  if (error) throw error
}
