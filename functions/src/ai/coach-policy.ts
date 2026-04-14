import { getSupabase } from "../lib/supabase.js"

export interface CoachAiPolicyRow {
  coach_id: string
  disallowed_techniques: string[]
  preferred_techniques: string[]
  technique_progression_enabled: boolean
  programming_notes: string | null
}

export async function getCoachPolicyFromFn(coachId: string): Promise<CoachAiPolicyRow | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.from("coach_ai_policy").select("*").eq("coach_id", coachId).maybeSingle()
  if (error) {
    console.warn("[coach-policy] getCoachPolicy failed:", error.message)
    return null
  }
  return (data as CoachAiPolicyRow | null) ?? null
}

export function formatCoachPolicyAsInstructions(policy: CoachAiPolicyRow | null): string {
  if (!policy) return ""
  const lines: string[] = ["COACH INSTRUCTIONS (studio-wide AI policy):"]
  if (policy.disallowed_techniques.length > 0) {
    lines.push(
      `- DO NOT use these techniques: ${policy.disallowed_techniques.join(", ")}. They must be absent from technique_plan for every week.`,
    )
  }
  if (policy.preferred_techniques.length > 0) {
    lines.push(`- Prefer these techniques when multiple are appropriate: ${policy.preferred_techniques.join(", ")}.`)
  }
  if (!policy.technique_progression_enabled) {
    lines.push(
      `- Keep technique_plan static across weeks — use the same default_technique every week. Do not introduce phase-based technique variation.`,
    )
  }
  if (policy.programming_notes && policy.programming_notes.trim().length > 0) {
    lines.push(`- Additional coach notes: ${policy.programming_notes.trim()}`)
  }
  return lines.length === 1 ? "" : "\n\n" + lines.join("\n")
}
