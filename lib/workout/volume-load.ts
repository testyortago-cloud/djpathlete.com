import type { LoadType } from "@/types/database"
import { loadTypeMeta } from "@/lib/workout/load-type"

export interface VolumeSet {
  weight_kg: number | null
  reps: number | null
}

/**
 * Volume load (training tonnage) for one exercise = Σ over sets of
 * reps × entered-weight × load-type multiplier. Sets missing weight or reps
 * contribute 0. Returns a number in kg.
 */
export function computeVolumeLoad(
  sets: VolumeSet[] | null | undefined,
  loadType: LoadType | null | undefined,
): number {
  if (!sets || sets.length === 0) return 0
  const { multiplier } = loadTypeMeta(loadType)
  let total = 0
  for (const s of sets) {
    const w = typeof s.weight_kg === "number" ? s.weight_kg : 0
    const r = typeof s.reps === "number" ? s.reps : 0
    if (w > 0 && r > 0) total += w * r * multiplier
  }
  return total
}

/** Sum of volume load across a session's exercises. */
export function computeSessionVolumeLoad(
  entries: Array<{ sets: VolumeSet[]; loadType: LoadType | null }>,
): number {
  return entries.reduce((sum, e) => sum + computeVolumeLoad(e.sets, e.loadType), 0)
}
