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
  speed: {
    showWeight: false,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: false,
    showRest: true,
  },
  power: {
    showWeight: true,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: false,
    showRest: true,
  },
  plyometric: {
    showWeight: false,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: false,
    showRest: true,
  },
  flexibility: {
    showWeight: false,
    showReps: false,
    showRpe: false,
    showDuration: "prominent",
    showTempo: true,
    showIntensity: false,
    showRest: false,
  },
  mobility: {
    showWeight: false,
    showReps: true,
    showRpe: true,
    showDuration: "prominent",
    showTempo: true,
    showIntensity: false,
    showRest: false,
  },
  motor_control: {
    showWeight: false,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: false,
    showRest: true,
  },
  strength_endurance: {
    showWeight: true,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: false,
    showRest: true,
  },
  relative_strength: {
    showWeight: true,
    showReps: true,
    showRpe: true,
    showDuration: false,
    showTempo: true,
    showIntensity: false,
    showRest: true,
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
  const merged: CategoryFields = { ...(CATEGORY_FIELDS[cats[0]] ?? CATEGORY_FIELDS.strength) }
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

/**
 * The subset of a saved `program_exercises` row that can widen the visible field
 * set. Keys are the column names, so a row can be passed straight in.
 */
export interface ProgramExerciseFieldValues {
  reps?: string | null
  rest_seconds?: number | null
  duration_seconds?: number | null
  rpe_target?: number | null
  intensity_pct?: number | null
  tempo?: string | null
  suggested_weight_kg?: number | null
}

/**
 * A value counts as set on exactly the terms ExerciseCard uses to print it —
 * truthy. That parity is the point: if the card shows a detail, the editor has
 * to let a coach change it.
 */
function isSet(value: string | number | null | undefined): boolean {
  return Boolean(value)
}

/**
 * Widen a category's field set to cover whatever the saved row already carries.
 *
 * CATEGORY_FIELDS decides what a coach is OFFERED when adding an exercise, but a
 * saved row can hold values its category hides — a `flexibility` stretch
 * prescribed "8 reps / 45s rest / RPE 7" is common in AI-generated programs, and
 * production has hundreds. Gating the editor on the category alone made those
 * values both invisible and unsaveable: the form rendered no input, so the PATCH
 * body carried `reps: null`, and the route writes every key it is given. Editing
 * the tempo of such a stretch silently erased its reps, rest and RPE.
 */
export function withPopulatedFields(fields: CategoryFields, values: ProgramExerciseFieldValues): CategoryFields {
  return {
    showWeight: fields.showWeight || isSet(values.suggested_weight_kg),
    showReps: fields.showReps || isSet(values.reps),
    showRpe: fields.showRpe || isSet(values.rpe_target),
    showDuration: fields.showDuration || isSet(values.duration_seconds),
    showTempo: fields.showTempo || isSet(values.tempo),
    showIntensity: fields.showIntensity || isSet(values.intensity_pct),
    showRest: fields.showRest || isSet(values.rest_seconds),
  }
}
