// lib/db/seo-agent-memos.ts
// Read-only DAL for the admin /admin/seo-agent/memos page. The agent itself
// writes from inside the Firebase Function via direct Supabase calls.

import { createServiceRoleClient } from "@/lib/supabase"
import type { SeoAgentMemo } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getMemoById(id: string): Promise<SeoAgentMemo | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("seo_agent_memos")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as SeoAgentMemo | null) ?? null
}

export async function listMemos(limit = 25): Promise<SeoAgentMemo[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("seo_agent_memos")
    .select("*")
    .order("run_date", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as SeoAgentMemo[]
}
