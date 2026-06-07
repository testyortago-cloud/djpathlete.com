import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramWeekPricing } from "@/types/database"

/** Service-role client bypasses RLS — called only from server-side admin routes/services. */
function getClient() {
  return createServiceRoleClient()
}

/** All premium-week rows for a program, ascending by week. */
export async function getPremiumWeeks(programId: string): Promise<ProgramWeekPricing[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_week_pricing")
    .select("*")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
  if (error) throw error
  return (data ?? []) as ProgramWeekPricing[]
}

/**
 * Replace-all: the given list becomes the complete set of premium weeks for the program.
 * Weeks not in the list are removed (i.e. become included).
 */
export async function setPremiumWeeks(
  programId: string,
  weeks: { week_number: number; price_cents: number }[],
): Promise<ProgramWeekPricing[]> {
  const supabase = getClient()
  const { error: delError } = await supabase.from("program_week_pricing").delete().eq("program_id", programId)
  if (delError) throw delError
  if (weeks.length === 0) return []
  const rows = weeks.map((w) => ({
    program_id: programId,
    week_number: w.week_number,
    price_cents: w.price_cents,
  }))
  const { data, error } = await supabase.from("program_week_pricing").insert(rows).select()
  if (error) throw error
  return (data ?? []) as ProgramWeekPricing[]
}
