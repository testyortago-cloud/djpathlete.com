import { createServiceRoleClient } from "@/lib/supabase"
import type { LeadInquiry, LeadPriority } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/**
 * Columns added by migration 00211. Deploys and migrations race on merge to
 * main, so for one deploy production may still be on the 00182 schema where
 * only `gclid` exists.
 */
const POST_00211_CLICK_ID_COLUMNS = ["gbraid", "wbraid", "fbclid"] as const

/** PostgREST's "column not in the schema cache" code. */
function isUnknownColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204") return true
  return POST_00211_CLICK_ID_COLUMNS.some((c) =>
    (error.message ?? "").includes(`'${c}'`),
  )
}

export async function createLeadInquiry(
  data: Omit<
    LeadInquiry,
    | "id"
    | "created_at"
    | "ai_priority"
    | "ai_priority_reason"
    | "ai_summary"
    | "ai_draft_reply"
    | "ai_generated_at"
    | "ai_generation_log_id"
    // Optional so callers that predate 00211 (and the contact-form path, which
    // has no attribution session to read) still compile and insert cleanly.
    | "gbraid"
    | "wbraid"
    | "fbclid"
  > &
    Partial<Pick<LeadInquiry, "gbraid" | "wbraid" | "fbclid">>,
) {
  const supabase = getClient()
  const { data: result, error } = await supabase.from("lead_inquiries").insert(data).select().single()
  if (!error) return result as LeadInquiry

  // Losing a lead because the migration hasn't landed yet is far worse than
  // losing its gbraid/wbraid. Retry without the new columns; `gclid` predates
  // 00211 and is always kept.
  if (!isUnknownColumnError(error)) throw error

  const legacy = { ...data }
  for (const c of POST_00211_CLICK_ID_COLUMNS) delete (legacy as Record<string, unknown>)[c]

  const { data: retried, error: retryError } = await supabase
    .from("lead_inquiries")
    .insert(legacy)
    .select()
    .single()
  if (retryError) throw retryError
  return retried as LeadInquiry
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
