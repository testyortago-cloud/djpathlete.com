// lib/db/lead-magnets.ts — the downloadable/asset offers funnels and blog
// posts hand out in exchange for an email.
//
// TENANCY (G31 / migration 00278): every function takes `businessId` first.
// `lead_magnets` has NO foreign key into the funnel tables — 00278 could not
// give it a composite FK the way it did for `funnel_step_turns` or
// `funnel_submissions` — so the `.eq("business_id", ...)` predicate below is
// the ONLY thing scoping a magnet to its tenant. `findRelevantLeadMagnet` is
// reached from the public blog (`components/marketing/blog/LeadMagnetBlock.tsx`),
// which makes it the read where getting this wrong hands one coach's lead
// magnet to another coach's visitor.

import { createServiceRoleClient } from "@/lib/supabase"
import type { LeadMagnet, BlogCategory } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listLeadMagnets(businessId: string, includeInactive = false): Promise<LeadMagnet[]> {
  const supabase = getClient()
  let query = supabase
    .from("lead_magnets")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
  if (!includeInactive) query = query.eq("active", true)
  const { data, error } = await query
  if (error) throw error
  return data as LeadMagnet[]
}

export async function getLeadMagnetById(businessId: string, id: string): Promise<LeadMagnet | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as LeadMagnet | null) ?? null
}

export async function createLeadMagnet(
  businessId: string,
  input: Omit<LeadMagnet, "id" | "created_at" | "updated_at">,
): Promise<LeadMagnet> {
  const supabase = getClient()
  // STAMPED explicitly, never left to the column default — see CLAUDE.md's
  // tenancy section on why the default cannot be trusted as a source of truth.
  const { data, error } = await supabase
    .from("lead_magnets")
    .insert({ ...input, business_id: businessId })
    .select("*")
    .single()
  if (error) throw error
  return data as LeadMagnet
}

export async function updateLeadMagnet(
  businessId: string,
  id: string,
  input: Partial<Omit<LeadMagnet, "id" | "created_at" | "updated_at">>,
): Promise<LeadMagnet> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .update(input)
    .eq("business_id", businessId)
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw error
  return data as LeadMagnet
}

export async function deleteLeadMagnet(businessId: string, id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("lead_magnets").delete().eq("business_id", businessId).eq("id", id)
  if (error) throw error
}

export interface FindLeadMagnetInput {
  tags?: string[]
  category?: BlogCategory | null
}

/**
 * Best-match selection: prefer magnets whose tag overlap is highest, ties
 * broken by category match. Inactive magnets are excluded. Returns null when
 * no eligible magnet exists.
 */
export async function findRelevantLeadMagnet(
  businessId: string,
  input: FindLeadMagnetInput,
): Promise<LeadMagnet | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .select("*")
    .eq("business_id", businessId)
    .eq("active", true)
  if (error) throw error
  const candidates = (data ?? []) as LeadMagnet[]
  if (candidates.length === 0) return null

  const targetTags = new Set((input.tags ?? []).map((t) => t.toLowerCase()))

  const scored = candidates.map((m) => {
    const overlap = m.tags.filter((t) => targetTags.has(t.toLowerCase())).length
    const categoryMatch = m.category && input.category && m.category === input.category ? 1 : 0
    return { magnet: m, score: overlap * 2 + categoryMatch }
  })

  scored.sort((a, b) => b.score - a.score)
  if (scored[0].score < 1) return null
  return scored[0].magnet
}
