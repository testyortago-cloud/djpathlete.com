import { z } from "zod"
import { SPLIT_TYPES, PERIODIZATION_TYPES } from "@/lib/validators/program"
import { MOVEMENT_PATTERNS } from "@/lib/validators/exercise"

// ─── Anthropic Structured Output Compatibility Notes ─────────────────────────
// The Vercel AI SDK passes Zod-generated JSON Schema directly to Anthropic's
// output_format WITHOUT stripping unsupported features. We must avoid:
//   - "integer" type entirely            → use z.number() not z.number()
//     (Anthropic rejects minimum/maximum on integer, and zod-to-json-schema
//      may add implicit safe-integer bounds when .int() is used)
//   - minimum/maximum on numbers         → no .min()/.max() on z.number()
//   - minLength/maxLength on strings     → no .min() on z.string()
//   - minItems > 1 or any maxItems       → use z.array() with only .min(1) at most
// Supported: enum, default, nullable, pattern (basic regex), minItems 0 or 1
// Range/length constraints are enforced by the system prompts instead.

// ─── Agent 1: Profile Analysis Schema ────────────────────────────────────────

const volumeTargetSchema = z.object({
  muscle_group: z.string(),
  sets_per_week: z.number(),
  priority: z.enum(["high", "medium", "low"]),
})

const exerciseConstraintSchema = z.object({
  type: z.enum([
    "avoid_movement",
    "avoid_equipment",
    "avoid_muscle",
    "limit_load",
    "require_unilateral",
  ]),
  value: z.string(),
  reason: z.string(),
})

const sessionStructureSchema = z.object({
  warm_up_minutes: z.number(),
  main_work_minutes: z.number(),
  cool_down_minutes: z.number(),
  total_exercises: z.number(),
  compound_count: z.number(),
  isolation_count: z.number(),
})

export const profileAnalysisSchema = z.object({
  recommended_split: z.enum(SPLIT_TYPES),
  recommended_periodization: z.enum(PERIODIZATION_TYPES),
  volume_targets: z.array(volumeTargetSchema).min(1),
  exercise_constraints: z.array(exerciseConstraintSchema),
  session_structure: sessionStructureSchema,
  training_age_category: z.enum(["novice", "intermediate", "advanced", "elite"]),
  notes: z.string(),
})

// ─── Agent 2: Program Skeleton Schema ────────────────────────────────────────

const exerciseSlotSchema = z.object({
  slot_id: z.string(),
  role: z.enum([
    "warm_up",
    "primary_compound",
    "secondary_compound",
    "accessory",
    "isolation",
    "cool_down",
  ]),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  target_muscles: z.array(z.string()).min(1),
  sets: z.number(),
  reps: z.string(),
  rest_seconds: z.number(),
  rpe_target: z.number().nullable(),
  tempo: z.string().nullable(),
  group_tag: z.string().nullable(),
  technique: z.enum([
    "straight_set",
    "superset",
    "dropset",
    "giant_set",
    "circuit",
    "rest_pause",
    "amrap",
  ]).default("straight_set"),
})

const programDaySchema = z.object({
  day_of_week: z.number(),
  label: z.string(),
  focus: z.string(),
  slots: z.array(exerciseSlotSchema).min(1),
})

const programWeekSchema = z.object({
  week_number: z.number(),
  phase: z.string(),
  intensity_modifier: z.string(),
  days: z.array(programDaySchema).min(1),
})

export const programSkeletonSchema = z.object({
  weeks: z.array(programWeekSchema).min(1),
  split_type: z.enum(SPLIT_TYPES),
  periodization: z.enum(PERIODIZATION_TYPES),
  total_sessions: z.number(),
  notes: z.string(),
})

// ─── Per-Session Agent Schema ────────────────────────────────────────────────

const sessionSlotWithExerciseSchema = z.object({
  slot_id: z.string(),
  role: z.enum([
    "warm_up",
    "primary_compound",
    "secondary_compound",
    "accessory",
    "isolation",
    "cool_down",
  ]),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  target_muscles: z.array(z.string()).min(1),
  sets: z.number(),
  reps: z.string(),
  rest_seconds: z.number(),
  rpe_target: z.number().nullable(),
  tempo: z.string().nullable(),
  group_tag: z.string().nullable(),
  technique: z.enum([
    "straight_set",
    "superset",
    "dropset",
    "giant_set",
    "circuit",
    "rest_pause",
    "amrap",
  ]).default("straight_set"),
  exercise_id: z.string(),
  exercise_name: z.string(),
  notes: z.string().nullable(),
})

export const sessionPlanSchema = z.object({
  label: z.string(),
  focus: z.string(),
  slots: z.array(sessionSlotWithExerciseSchema).min(1),
})

// ─── Agent 3: Exercise Assignment Schema ─────────────────────────────────────

const assignedExerciseSchema = z.object({
  slot_id: z.string(),
  exercise_id: z.string(),
  exercise_name: z.string(),
  notes: z.string().nullable(),
})

export const exerciseAssignmentSchema = z.object({
  assignments: z.array(assignedExerciseSchema).min(1),
  substitution_notes: z.array(z.string()),
})

// ─── Agent 4: Validation Result Schema ───────────────────────────────────────

const validationIssueSchema = z.object({
  type: z.enum(["error", "warning"]),
  category: z.string(),
  message: z.string(),
  slot_ref: z.string().optional(),
})

export const validationResultSchema = z.object({
  pass: z.boolean(),
  issues: z.array(validationIssueSchema),
  summary: z.string(),
})
