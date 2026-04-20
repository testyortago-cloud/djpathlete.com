// lib/db/platform-connections.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { PlatformConnection, SocialPlatform } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listPlatformConnections(): Promise<PlatformConnection[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .select("*")
    .order("plugin_name", { ascending: true })
  if (error) throw error
  return (data ?? []) as PlatformConnection[]
}

export async function getPlatformConnection(
  pluginName: SocialPlatform,
): Promise<PlatformConnection | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .select("*")
    .eq("plugin_name", pluginName)
    .maybeSingle()
  if (error) throw error
  return (data as PlatformConnection | null) ?? null
}

export interface ConnectPayload {
  credentials: Record<string, unknown>
  account_handle?: string | null
  connected_by?: string | null
}

export async function connectPlatform(
  pluginName: SocialPlatform,
  payload: ConnectPayload,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({
      status: "connected",
      credentials: payload.credentials,
      account_handle: payload.account_handle ?? null,
      connected_at: new Date().toISOString(),
      connected_by: payload.connected_by ?? null,
      last_error: null,
    })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}

export async function pausePlatform(pluginName: SocialPlatform): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({ status: "paused" })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}

export async function disconnectPlatform(
  pluginName: SocialPlatform,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({
      status: "not_connected",
      credentials: {},
      account_handle: null,
      connected_at: null,
      connected_by: null,
      last_error: null,
    })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}

export async function setConnectionError(
  pluginName: SocialPlatform,
  errorMessage: string,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({ status: "error", last_error: errorMessage })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}
