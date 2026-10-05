// lib/services/copy-program.ts
import { createServiceRoleClient } from "@/lib/supabase"
import { createProgram, deleteProgram, getProgramById } from "@/lib/db/programs"
import type { Program } from "@/types/database"

const PAGE = 1000 // PostgREST's row cap: a read without .range() stops here silently
const CHUNK = 500

export type ProgramCopyOverrides = Partial<Pick<Program, "name" | "is_template" | "folder_id" | "is_public">>

function strip(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...row }
  for (const k of keys) delete out[k]
  return out
}

/**
 * THE whole-program copy: the programs row, every program_exercises row and
 * the program_week_pricing rows. Exercise rows are copied column-for-column
 * (minus their own identity), so a column added later is carried without
 * touching this file.
 *
 * Stripe ids are NEVER copied. PATCH /api/admin/programs/[id] archives a
 * program's Price when its price changes and renames its Product when its name
 * changes, so two programs sharing them would break each other's checkout. A
 * caller that needs the copy to be sellable creates its own (see the give route).
 *
 * All-or-nothing: if anything after the programs insert fails, the new program
 * is deleted (exercises and pricing cascade) and the error is rethrown.
 */
export async function copyProgram(sourceId: string, overrides: ProgramCopyOverrides): Promise<Program> {
  const source = await getProgramById(sourceId)
  const copy = await createProgram({
    ...strip(source as unknown as Record<string, unknown>, ["id", "created_at", "updated_at"]),
    stripe_product_id: null,
    stripe_price_id: null,
    ...overrides,
  } as Omit<Program, "id" | "created_at" | "updated_at">)

  const supabase = createServiceRoleClient()
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("program_exercises")
        .select("*")
        .eq("program_id", sourceId)
        .order("week_number")
        .order("day_of_week")
        .order("order_index")
        .order("id")
        .range(from, from + PAGE - 1)
      if (error) throw error
      const page = (data ?? []).map((r: Record<string, unknown>) => ({
        ...strip(r, ["id", "created_at", "updated_at"]),
        program_id: copy.id,
      }))
      for (let i = 0; i < page.length; i += CHUNK) {
        const { error: insertError } = await supabase.from("program_exercises").insert(page.slice(i, i + CHUNK))
        if (insertError) throw insertError
      }
      if (page.length < PAGE) break
    }

    const { data: pricing, error: pricingError } = await supabase
      .from("program_week_pricing")
      .select("week_number, price_cents")
      .eq("program_id", sourceId)
    if (pricingError) throw pricingError
    if (pricing && pricing.length > 0) {
      const { error } = await supabase
        .from("program_week_pricing")
        .insert(pricing.map((p: { week_number: number; price_cents: number }) => ({ ...p, program_id: copy.id })))
      if (error) throw error
    }
    return copy
  } catch (err) {
    await deleteProgram(copy.id).catch((e) => console.error(`[copyProgram] rollback of ${copy.id} failed:`, e))
    throw err
  }
}
