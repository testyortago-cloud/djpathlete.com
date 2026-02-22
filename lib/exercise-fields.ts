import type { ExerciseCategory } from "@/types/database"

export interface CategoryFields {
  showWeight: boolean
  showReps: boolean
  showRpe: boolean
  /** true = show prominently (always visible), false = hide */
  showDuration: boolean | "prominent"
  showTempo: boolean
  showIntensity: boolean
  showRest: boolean
}

const CATEGORY_FIELDS: Record<ExerciseCategory, CategoryFields> = {
  strength: {
    showWeight: true,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: true,
    showRest: true,
  },
  cardio: {
    showWeight: false,
    showReps: false,
    showRpe: true,
    showDuration: "prominent",
    showTempo: false,
    showIntensity: false,
    showRest: true,
  },
  flexibility: {
    showWeight: false,
    showReps: false,
    showRpe: false,
    showDuration: "prominent",
    showTempo: false,
    showIntensity: false,
    showRest: false,
  },
  plyometric: {
    showWeight: false,
    showReps: true,
    showRpe: false,
    showDuration: false,
    showTempo: false,
    showIntensity: false,
    showRest: true,
  },
  sport_specific: {
    showWeight: true,
    showReps: true,
    showRpe: true,
    showDuration: true,
    showTempo: true,
    showIntensity: true,
    showRest: true,
  },
  recovery: {
    showWeight: false,
    showReps: false,
    showRpe: false,
    showDuration: "prominent",
    showTempo: false,
    showIntensity: false,
    showRest: false,
  },
}

/** Merge duration values: "prominent" wins over true, true wins over false */
function mergeDuration(a: boolean | "prominent", b: boolean | "prominent"): boolean | "prominent" {
  if (a === "prominent" || b === "prominent") return "prominent"
  return a || b
}

export function getCategoryFields(category: ExerciseCategory | ExerciseCategory[]): CategoryFields {
  const cats = Array.isArray(category) ? category : [category]
  if (cats.length === 0) return CATEGORY_FIELDS.strength

  // Merge: if ANY category enables a field, it's enabled
  const merged: CategoryFields = { ...CATEGORY_FIELDS[cats[0]] ?? CATEGORY_FIELDS.strength }
  for (let i = 1; i < cats.length; i++) {
    const f = CATEGORY_FIELDS[cats[i]] ?? CATEGORY_FIELDS.strength
    merged.showWeight = merged.showWeight || f.showWeight
    merged.showReps = merged.showReps || f.showReps
    merged.showRpe = merged.showRpe || f.showRpe
    merged.showDuration = mergeDuration(merged.showDuration, f.showDuration)
    merged.showTempo = merged.showTempo || f.showTempo
    merged.showIntensity = merged.showIntensity || f.showIntensity
    merged.showRest = merged.showRest || f.showRest
  }
  return merged
}
