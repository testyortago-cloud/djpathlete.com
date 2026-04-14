import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface CoachAiPolicy {
  coach_id: string
  disallowed_techniques: string[]
  preferred_techniques: string[]
  technique_progression_enabled: boolean
  programming_notes: string | null
  updated_at: string
}

export async function getCoachPolicy(coachId: string): Promise<CoachAiPolicy | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("coach_ai_policy").select("*").eq("coach_id", coachId).maybeSingle()
  if (error) throw error
  return data as CoachAiPolicy | null
}

export interface UpsertCoachPolicyInput {
  disallowed_techniques: string[]
  preferred_techniques: string[]
  technique_progression_enabled: boolean
  programming_notes: string
}

export async function upsertCoachPolicy(coachId: string, input: UpsertCoachPolicyInput): Promise<CoachAiPolicy> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("coach_ai_policy")
    .upsert({ coach_id: coachId, ...input }, { onConflict: "coach_id" })
    .select()
    .single()
  if (error) throw error
  return data as CoachAiPolicy
}
