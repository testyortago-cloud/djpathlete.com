import { createServiceRoleClient } from "@/lib/supabase"
import type { PromptTemplate } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listPromptTemplates(opts?: { scope?: "week" | "day" }): Promise<PromptTemplate[]> {
  const supabase = getClient()
  let query = supabase.from("prompt_templates").select("*").order("updated_at", { ascending: false })
  if (opts?.scope) {
    query = query.in("scope", [opts.scope, "both"])
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as PromptTemplate[]
}

export async function getPromptTemplateById(id: string): Promise<PromptTemplate | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("prompt_templates").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data ?? null) as PromptTemplate | null
}

export async function createPromptTemplate(
  input: Omit<PromptTemplate, "id" | "created_at" | "updated_at">,
): Promise<PromptTemplate> {
  const supabase = getClient()
  const { data, error } = await supabase.from("prompt_templates").insert(input).select().single()
  if (error) throw error
  return data as PromptTemplate
}

export async function updatePromptTemplate(
  id: string,
  patch: Partial<Omit<PromptTemplate, "id" | "created_at" | "updated_at" | "created_by">>,
): Promise<PromptTemplate> {
  const supabase = getClient()
  const { data, error } = await supabase.from("prompt_templates").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as PromptTemplate
}

export async function deletePromptTemplate(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("prompt_templates").delete().eq("id", id)
  if (error) throw error
}

/**
 * Fetches the most-recently-updated prompt for a given category. Returns
 * null if no row exists yet (callers should fall back gracefully so a
 * fresh-install database doesn't break AI flows).
 */
export async function getLatestPromptByCategory(
  category: string,
): Promise<PromptTemplate | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("*")
    .eq("category", category)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as PromptTemplate | null
}
