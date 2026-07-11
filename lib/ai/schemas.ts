import { z } from "zod"
import { SPLIT_TYPES, PERIODIZATION_TYPES } from "@/lib/validators/program"
import { MOVEMENT_PATTERNS } from "@/lib/validators/exercise"

// ─── Anthropic Structured Output Compatibility Notes (updated 2026-07-11) ────
// callAgent (lib/ai/anthropic.ts) forces structuredOutputMode "jsonTool", so
// schemas now travel as a tool input_schema — which ACCEPTS .int(), .min()/
// .max(), minItems/maxItems etc., and Zod still validates client-side. The
// old guidance to strip constraints applied to the output_format path (which
// rejects those keywords) and is obsolete; constraints are safe and useful
// again. Keep these schemas as-is or add constraints freely — but if anyone
// ever flips callAgent back to "auto"/"outputFormat", constraint-carrying
// schemas will 400 ("property 'maxItems' is not supported"). See
// __tests__/lib/ai/anthropic-schema.test.ts.

// ─── Agent 1: Profile Analysis Schema ────────────────────────────────────────

const volumeTargetSchema = z.object({
  muscle_group: z.string(),
  sets_per_week: z.number(),
  priority: z.enum(["high", "medium", "low"]),
})

const exerciseConstraintSchema = z.object({
  type: z.enum(["avoid_movement", "avoid_equipment", "avoid_muscle", "limit_load", "require_unilateral"]),
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
  notes: z.string().optional().default(""),
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
    "power",
    "conditioning",
    "activation",
    "testing",
  ]),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  target_muscles: z.array(z.string()).min(1),
  sets: z.number(),
  reps: z.string(),
  rest_seconds: z.number(),
  rpe_target: z.number().nullable(),
  tempo: z.string().nullable(),
  group_tag: z.string().nullable(),
  technique: z
    .enum([
      "straight_set",
      "superset",
      "dropset",
      "giant_set",
      "circuit",
      "rest_pause",
      "amrap",
      "cluster_set",
      "complex",
      "emom",
      "wave_loading",
    ])
    .default("straight_set"),
  intensity_pct: z.number().nullable().optional().default(null),
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
  notes: z.string().optional().default(""),
})

// ─── Agent 3: Exercise Assignment Schema ─────────────────────────────────────

const assignedExerciseSchema = z.object({
  slot_id: z.string(),
  // UUID pattern (accepts standard + seed-style hex UUIDs; rejects non-UUID /
  // empty / wrong-length). Regex pattern is structured-output safe (see notes above).
  exercise_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
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
