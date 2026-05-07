import { createServiceRoleClient } from "@/lib/supabase"
import type { AiGenerationLog, AiGenerationStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createGenerationLog(data: Omit<AiGenerationLog, "id" | "created_at">) {
  const supabase = getClient()
  const { data: result, error } = await supabase.from("ai_generation_log").insert(data).select().single()
  if (error) throw error
  return result as AiGenerationLog
}

export async function updateGenerationLog(id: string, updates: Partial<Omit<AiGenerationLog, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("ai_generation_log").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as AiGenerationLog
}

export interface GenerationLogFilters {
  status?: AiGenerationStatus
  client_id?: string
  requested_by?: string
  since?: Date
}

export async function getGenerationLogById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("ai_generation_log").select("*").eq("id", id).single()
  if (error) throw error
  return data as AiGenerationLog
}

export async function getGenerationLogs(filters?: GenerationLogFilters) {
  const supabase = getClient()
  let query = supabase.from("ai_generation_log").select("*")

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }
  if (filters?.client_id) {
    query = query.eq("client_id", filters.client_id)
  }
  if (filters?.requested_by) {
    query = query.eq("requested_by", filters.requested_by)
  }
  if (filters?.since) {
    query = query.gte("created_at", filters.since.toISOString())
  }

  const { data, error } = await query.order("created_at", { ascending: false })
  if (error) throw error
  return data as AiGenerationLog[]
}
