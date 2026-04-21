// lib/db/voice-drift-flags.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { VoiceDriftFlag, VoiceDriftSeverity } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function insertVoiceDriftFlag(row: Omit<VoiceDriftFlag, "id" | "created_at">): Promise<VoiceDriftFlag> {
  const supabase = getClient()
  const { data, error } = await supabase.from("voice_drift_flags").insert(row).select().single()
  if (error) throw error
  return data as VoiceDriftFlag
}

export interface ListRecentVoiceDriftFlagsOptions {
  since?: Date
  severity?: VoiceDriftSeverity | Array<VoiceDriftSeverity>
  limit?: number
}

export async function listRecentVoiceDriftFlags(
  options: ListRecentVoiceDriftFlagsOptions = {},
): Promise<VoiceDriftFlag[]> {
  const supabase = getClient()
  let query = supabase.from("voice_drift_flags").select("*").order("scanned_at", { ascending: false })

  if (options.since) {
    query = query.gte("scanned_at", options.since.toISOString())
  }
  if (options.severity) {
    if (Array.isArray(options.severity)) {
      query = query.in("severity", options.severity)
    } else {
      query = query.eq("severity", options.severity)
    }
  }
  query = query.limit(options.limit ?? 50)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as VoiceDriftFlag[]
}
