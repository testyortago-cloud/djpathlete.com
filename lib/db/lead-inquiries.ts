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

/**
 * Writes one inquiry, stamped with the business that received it (00280, G45).
 * `business_id` is REQUIRED and non-null here even though the column is
 * nullable: the column has no default (G44), so an insert that left it out
 * would file an inquiry under nobody, invisible to every business's reader.
 */
export async function createLeadInquiry(
  data: Omit<
    LeadInquiry,
    | "id"
    | "business_id"
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
  > & { business_id: string } & Partial<Pick<LeadInquiry, "gbraid" | "wbraid" | "fbclid">>,
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

/** Writes the AI fields onto ONE business's inquiry (G45); another business's same id is untouched. */
export async function updateLeadInquiryAiFields(
  businessId: string,
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
  const { data, error } = await supabase
    .from("lead_inquiries")
    .update(updates)
    .eq("business_id", businessId)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as LeadInquiry
}

/**
 * The newest inquiry by a USER, for the ADMIN client page
 * (app/(admin)/admin/clients/[id]/page.tsx). NO business predicate,
 * deliberately and for now: that page reads a login's record across every
 * business (programmes, assignments and clients are shared: G37, an owner
 * decision still open). When G37 scopes clients to a business, this takes the
 * business too; `lead_inquiries.business_id` (00280) is already there for it.
 *
 * KNOWN GAP until then: the page's "Regenerate" button calls a route that DOES
 * scope by business (G45), so for an inquiry filed under a business other
 * than the admin's selected one it answers "not found" for the inquiry shown
 * right above it. Today every inquiry is the platform business's, so it shows
 * only when an operator has selected another business.
 */
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

/**
 * ONE business's inquiry by id (G45). Null when this business has no such
 * inquiry, including when another business does. A read error THROWS, so the
 * caller can tell "not yours" from "could not read".
 */
export async function getLeadInquiryById(businessId: string, id: string): Promise<LeadInquiry | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_inquiries")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as LeadInquiry | null) ?? null
}
