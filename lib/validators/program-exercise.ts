import { z } from "zod"

export const TRAINING_TECHNIQUE_OPTIONS = [
  "straight_set",
  "superset",
  "dropset",
  "giant_set",
  "circuit",
  "rest_pause",
  "amrap",
  "cluster_set",
] as const

export type TrainingTechniqueOption = (typeof TRAINING_TECHNIQUE_OPTIONS)[number]

/** Techniques that require a group_tag to pair exercises together */
export const GROUPED_TECHNIQUES: TrainingTechniqueOption[] = ["superset", "giant_set", "circuit"]

/**
 * Nullable coerced number — converts null/undefined to undefined BEFORE z.coerce
 * so that Number(null)→0 doesn't bypass .positive()/.min(1) validators.
 */
function nullableNum(schema: z.ZodTypeAny) {
  return z.preprocess(
    (v) => (v == null || v === "" ? undefined : v),
    schema.optional(),
  ).transform((v) => (v as number | undefined) ?? null)
}

export const programExerciseSchema = z.object({
  exercise_id: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid exercise ID"
  ),
  day_of_week: z.coerce.number().int().min(1).max(7),
  week_number: z.coerce.number().int().min(1),
  order_index: z.coerce.number().int().min(0),
  technique: z.enum(TRAINING_TECHNIQUE_OPTIONS).nullable().optional().transform((v) => v ?? "straight_set"),
  sets: nullableNum(z.coerce.number().int().positive()),
  reps: z.string().max(50).nullable().optional().transform((v) => v || null),
  rest_seconds: nullableNum(z.coerce.number().int().min(0)),
  duration_seconds: nullableNum(z.coerce.number().int().min(0)),
  notes: z.string().max(500).nullable().optional().transform((v) => v || null),
  rpe_target: nullableNum(z.coerce.number().min(1).max(10)),
  intensity_pct: nullableNum(z.coerce.number().min(0).max(100)),
  tempo: z.string().max(20).nullable().optional().transform((v) => v || null),
  group_tag: z.string().max(10).nullable().optional().transform((v) => v || null),
  suggested_weight_kg: nullableNum(z.coerce.number().min(0)),
})

export const programExerciseUpdateSchema = programExerciseSchema.partial().omit({ exercise_id: true })

export type ProgramExerciseFormData = z.infer<typeof programExerciseSchema>
