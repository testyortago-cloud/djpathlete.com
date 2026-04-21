// lib/db/platform-connections.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { PlatformConnection, SocialPlatform } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listPlatformConnections(): Promise<PlatformConnection[]> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_list_platform_connections")
  if (error) throw error
  return (data ?? []) as PlatformConnection[]
}

export async function getPlatformConnection(
  pluginName: SocialPlatform,
): Promise<PlatformConnection | null> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_get_platform_connection", {
    p_plugin_name: pluginName,
  })
  if (error) throw error
  const rows = (data ?? []) as PlatformConnection[]
  return rows[0] ?? null
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
  const { data, error } = await supabase.rpc("fn_connect_platform", {
    p_plugin_name: pluginName,
    p_credentials: payload.credentials,
    p_account_handle: payload.account_handle ?? null,
    p_connected_by: payload.connected_by ?? null,
  })
  if (error) throw error
  const rows = (data ?? []) as PlatformConnection[]
  if (!rows[0]) throw new Error(`connectPlatform: no row returned for ${pluginName}`)
  return rows[0]
}

export async function pausePlatform(pluginName: SocialPlatform): Promise<PlatformConnection> {
  const supabase = getClient()
  const { error } = await supabase
    .from("platform_connections")
    .update({ status: "paused" })
    .eq("plugin_name", pluginName)
  if (error) throw error
  const row = await getPlatformConnection(pluginName)
  if (!row) throw new Error(`pausePlatform: plugin ${pluginName} not found`)
  return row
}

export async function disconnectPlatform(
  pluginName: SocialPlatform,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_disconnect_platform", {
    p_plugin_name: pluginName,
  })
  if (error) throw error
  const rows = (data ?? []) as PlatformConnection[]
  if (!rows[0]) throw new Error(`disconnectPlatform: no row returned for ${pluginName}`)
  return rows[0]
}

export async function setConnectionError(
  pluginName: SocialPlatform,
  errorMessage: string,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { error } = await supabase
    .from("platform_connections")
    .update({ status: "error", last_error: errorMessage })
    .eq("plugin_name", pluginName)
  if (error) throw error
  const row = await getPlatformConnection(pluginName)
  if (!row) throw new Error(`setConnectionError: plugin ${pluginName} not found`)
  return row
}
