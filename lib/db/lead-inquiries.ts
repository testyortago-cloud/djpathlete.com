import { createServiceRoleClient } from "@/lib/supabase"
import type { LeadInquiry, LeadPriority } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createLeadInquiry(
  data: Omit<
    LeadInquiry,
    "id" | "created_at" | "ai_priority" | "ai_priority_reason" | "ai_summary" | "ai_draft_reply" | "ai_generated_at" | "ai_generation_log_id"
  >,
) {
  const supabase = getClient()
  const { data: result, error } = await supabase.from("lead_inquiries").insert(data).select().single()
  if (error) throw error
  return result as LeadInquiry
}

export async function updateLeadInquiryAiFields(
  id: string,
  updates: {
    ai_priority: LeadPriority
    ai_priority_reason: string
    ai_summary: string
    ai_draft_reply: string
    ai_generation_log_id: string | null
    ai_generated_at: string
  },
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_inquiries").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as LeadInquiry
}

export async function getLeadInquiryByUserId(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_inquiries")
    .select("*")
    .eq("lead_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as LeadInquiry | null
}

export async function getLeadInquiryById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_inquiries").select("*").eq("id", id).single()
  if (error) throw error
  return data as LeadInquiry
}
