import { z } from "zod"

// ─── Shared constants (duplicated from Next.js validators to avoid cross-project deps) ──

const SPLIT_TYPES = [
  "full_body",
  "upper_lower",
  "push_pull_legs",
  "push_pull",
  "body_part",
  "movement_pattern",
  "custom",
] as const

const PERIODIZATION_TYPES = ["linear", "undulating", "block", "reverse_linear", "none"] as const

const MOVEMENT_PATTERNS = [
  "push",
  "pull",
  "squat",
  "hinge",
  "lunge",
  "carry",
  "rotation",
  "isometric",
  "locomotion",
  "conditioning",
] as const

const TECHNIQUES = [
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
] as const

const DIFFICULTY_TIERS = ["beginner", "intermediate", "advanced"] as const

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

const techniquePlanWeekSchema = z.object({
  week_number: z.number().int().min(1),
  allowed_techniques: z.array(z.enum(TECHNIQUES)).min(1),
  default_technique: z.enum(TECHNIQUES),
  notes: z.string().default(""),
})

const difficultyCeilingWeekSchema = z.object({
  week_number: z.number().int().min(1),
  max_tier: z.enum(DIFFICULTY_TIERS),
  max_score: z.number().min(0).max(10),
})

export const profileAnalysisSchema = z.object({
  recommended_split: z.enum(SPLIT_TYPES),
  recommended_periodization: z.enum(PERIODIZATION_TYPES),
  volume_targets: z.array(volumeTargetSchema).min(1),
  exercise_constraints: z.array(exerciseConstraintSchema),
  session_structure: sessionStructureSchema,
  training_age_category: z.enum(["novice", "intermediate", "advanced", "elite"]),
  technique_plan: z.array(techniquePlanWeekSchema).min(1),
  difficulty_ceiling: z.array(difficultyCeilingWeekSchema).min(1),
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
  technique: z.enum(TECHNIQUES).default("straight_set"),
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
  total_sessions: z.number().optional().default(0),
  notes: z.string().optional().default(""),
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

// ─── Cross-layer Validators ──────────────────────────────────────────────────

export type TechniquePlanWeek = z.infer<typeof techniquePlanWeekSchema>
export type DifficultyCeilingWeek = z.infer<typeof difficultyCeilingWeekSchema>

export interface ValidatorResult {
  ok: boolean
  violations: string[]
}

/**
 * Validate the program skeleton (Agent 2 output) against the technique_plan
 * produced by Agent 1. Every slot's technique must be in the allowed_techniques
 * list for that week.
 */
export function validateSkeletonAgainstAnalysis(
  skeleton: z.infer<typeof programSkeletonSchema>,
  analysis: z.infer<typeof profileAnalysisSchema>,
): ValidatorResult {
  const planByWeek = new Map<number, TechniquePlanWeek>()
  for (const wk of analysis.technique_plan) planByWeek.set(wk.week_number, wk)

  const violations: string[] = []
  for (const week of skeleton.weeks) {
    const plan = planByWeek.get(week.week_number)
    if (!plan) {
      violations.push(`week ${week.week_number}: no technique_plan entry from analysis`)
      continue
    }
    const allowed = new Set<string>(plan.allowed_techniques)
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (!allowed.has(slot.technique)) {
          violations.push(
            `week ${week.week_number} slot ${slot.slot_id}: technique "${slot.technique}" not allowed (allowed: ${plan.allowed_techniques.join(", ")})`,
          )
        }
      }
    }
  }
  return { ok: violations.length === 0, violations }
}

/**
 * Validate exercise assignments (Agent 3 output) against the difficulty_ceiling
 * produced by Agent 1. For each week, the assigned exercise must not exceed the
 * ceiling's max_tier; if its tier equals max_tier, its difficulty_score must
 * not exceed max_score.
 */
export function validateAssignmentAgainstCeiling(
  assignment: z.infer<typeof exerciseAssignmentSchema>,
  difficultyCeiling: DifficultyCeilingWeek[],
  slotInWeek: Map<string, number>,
  exerciseLibrary: Array<{ id: string; difficulty: string; difficulty_score: number | null | undefined }>,
): ValidatorResult {
  const ceilingByWeek = new Map<number, DifficultyCeilingWeek>()
  for (const c of difficultyCeiling) ceilingByWeek.set(c.week_number, c)

  const exById = new Map(exerciseLibrary.map((e) => [e.id, e]))
  const tierIdx = (tier: string) => DIFFICULTY_TIERS.indexOf(tier as (typeof DIFFICULTY_TIERS)[number])

  const violations: string[] = []
  for (const a of assignment.assignments) {
    const weekNum = slotInWeek.get(a.slot_id)
    if (weekNum === undefined) continue
    const ceiling = ceilingByWeek.get(weekNum)
    if (!ceiling) {
      violations.push(`week ${weekNum} slot ${a.slot_id}: no difficulty_ceiling entry`)
      continue
    }
    const ex = exById.get(a.exercise_id)
    if (!ex) continue

    const exIdx = tierIdx(ex.difficulty)
    const maxIdx = tierIdx(ceiling.max_tier)
    if (exIdx === -1 || maxIdx === -1) continue

    if (exIdx > maxIdx) {
      violations.push(
        `week ${weekNum} slot ${a.slot_id}: exercise "${ex.id}" tier "${ex.difficulty}" exceeds ceiling "${ceiling.max_tier}"`,
      )
      continue
    }
    if (exIdx === maxIdx && ex.difficulty_score != null && ex.difficulty_score > ceiling.max_score) {
      violations.push(
        `week ${weekNum} slot ${a.slot_id}: exercise "${ex.id}" score ${ex.difficulty_score} exceeds max_score ${ceiling.max_score}`,
      )
    }
  }
  return { ok: violations.length === 0, violations }
}

// ─── Voice drift assessment (Phase 5e) ──
// Used by voice-drift-monitor.ts to structure Claude's audit output.

export const voiceDriftIssueSchema = z.object({
  issue: z.string().min(1).describe("Concrete deviation from the voice profile"),
  suggestion: z.string().min(1).describe("One-sentence actionable fix"),
})

export const voiceDriftAssessmentSchema = z.object({
  drift_score: z.number().int().min(0).max(100).describe("0 = perfectly on-brand, 100 = completely off-brand"),
  severity: z
    .enum(["low", "medium", "high"])
    .describe("low (<40), medium (40-69), high (>=70). Use editorial judgment on the boundary"),
  issues: z.array(voiceDriftIssueSchema).max(4).describe("Empty when on-brand, otherwise 1-4 items"),
})

export type VoiceDriftAssessment = z.infer<typeof voiceDriftAssessmentSchema>
