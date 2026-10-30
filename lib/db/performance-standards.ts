import { createServiceRoleClient } from "@/lib/supabase"
import type { StandardRow } from "@/lib/coach-intel/test-normalization"

/** Service-role client bypasses RLS — these functions are only called from server-side code. */
function getClient() {
  return createServiceRoleClient()
}

export interface PerformanceStandard extends StandardRow {
  id: string
  business_id: string
}

const COLUMNS = "id, business_id, test_type, age_min, age_max, floor_value, trained_value, elite_value"

/** A business's own Trained / Elite standards (all tests, every age group). */
export async function listStandards(businessId: string): Promise<PerformanceStandard[]> {
  const { data, error } = await getClient()
    .from("performance_standards")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("test_type")
    .order("age_min", { nullsFirst: true })
  if (error) throw new Error(`performance_standards: ${error.message}`)
  return ((data ?? []) as PerformanceStandard[]).map((r) => ({
    ...r,
    floor_value: Number(r.floor_value),
    trained_value: Number(r.trained_value),
    elite_value: Number(r.elite_value),
  }))
}

/**
 * Creates the row, or updates the one with `id` — inside `businessId` only, so one
 * coach can never write another's. Answers "duplicate" when the business already has
 * a row for that test and age group (the performance_standards_band unique index).
 */
export async function saveStandard(
  businessId: string,
  input: StandardRow,
  id?: string,
): Promise<PerformanceStandard | "duplicate" | null> {
  const row = { ...input, business_id: businessId }
  // Two whole chains, not one built in pieces: the select contract test can only read a whole chain.
  const { data, error } = id
    ? await getClient()
        .from("performance_standards")
        .update(row)
        .eq("id", id)
        .eq("business_id", businessId)
        .select(COLUMNS)
        .maybeSingle()
    : await getClient().from("performance_standards").insert(row).select(COLUMNS).maybeSingle()
  if (error?.code === "23505") return "duplicate"
  if (error) throw new Error(`performance_standards: ${error.message}`)
  return (data as PerformanceStandard | null) ?? null
}

/** Deletes one row of `businessId`; false when there was no such row. */
export async function deleteStandard(businessId: string, id: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from("performance_standards")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
    .select("id")
  if (error) throw new Error(`performance_standards: ${error.message}`)
  return (data ?? []).length > 0
}
