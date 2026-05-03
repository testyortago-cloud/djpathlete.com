import { createServiceRoleClient } from "@/lib/supabase"
import type { LeadMagnet, BlogCategory } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listLeadMagnets(includeInactive = false): Promise<LeadMagnet[]> {
  const supabase = getClient()
  let query = supabase.from("lead_magnets").select("*").order("created_at", { ascending: false })
  if (!includeInactive) query = query.eq("active", true)
  const { data, error } = await query
  if (error) throw error
  return data as LeadMagnet[]
}

export async function getLeadMagnetById(id: string): Promise<LeadMagnet | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_magnets").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as LeadMagnet | null) ?? null
}

export async function createLeadMagnet(
  input: Omit<LeadMagnet, "id" | "created_at" | "updated_at">,
): Promise<LeadMagnet> {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_magnets").insert(input).select("*").single()
  if (error) throw error
  return data as LeadMagnet
}

export async function updateLeadMagnet(
  id: string,
  input: Partial<Omit<LeadMagnet, "id" | "created_at" | "updated_at">>,
): Promise<LeadMagnet> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .update(input)
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw error
  return data as LeadMagnet
}

export async function deleteLeadMagnet(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("lead_magnets").delete().eq("id", id)
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
export async function findRelevantLeadMagnet(input: FindLeadMagnetInput): Promise<LeadMagnet | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .select("*")
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
