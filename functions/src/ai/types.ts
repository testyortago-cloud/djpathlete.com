// ─── Agent 1: Profile Analyzer Output ────────────────────────────────────────

export type SplitType =
  | "full_body"
  | "upper_lower"
  | "push_pull_legs"
  | "push_pull"
  | "body_part"
  | "movement_pattern"
  | "custom"

export type Periodization =
  | "linear"
  | "undulating"
  | "block"
  | "reverse_linear"
  | "none"

export type MovementPattern =
  | "push"
  | "pull"
  | "squat"
  | "hinge"
  | "lunge"
  | "carry"
  | "rotation"
  | "isometric"
  | "locomotion"
  | "conditioning"

export type ForceType = "push" | "pull" | "static" | null
export type Laterality = "bilateral" | "unilateral" | null

export interface VolumeTarget {
  muscle_group: string
  sets_per_week: number
  priority: "high" | "medium" | "low"
}

export interface ExerciseConstraint {
  type: "avoid_movement" | "avoid_equipment" | "avoid_muscle" | "limit_load" | "require_unilateral"
  value: string
  reason: string
}

export interface SessionStructure {
  warm_up_minutes: number
  main_work_minutes: number
  cool_down_minutes: number
  total_exercises: number
  compound_count: number
  isolation_count: number
}

export interface ProfileAnalysis {
  recommended_split: SplitType
  recommended_periodization: Periodization
  volume_targets: VolumeTarget[]
  exercise_constraints: ExerciseConstraint[]
  session_structure: SessionStructure
  training_age_category: "novice" | "intermediate" | "advanced" | "elite"
  technique_plan: TechniquePlanWeek[]
  difficulty_ceiling: DifficultyCeilingWeek[]
  notes: string
}

// ─── Agent 2: Program Architect Output ───────────────────────────────────────

export interface ExerciseSlot {
  slot_id: string
  role: "warm_up" | "primary_compound" | "secondary_compound" | "accessory" | "isolation" | "cool_down" | "power" | "conditioning" | "activation" | "testing"
  movement_pattern: MovementPattern
  target_muscles: string[]
  sets: number
  reps: string
  rest_seconds: number
  rpe_target: number | null
  tempo: string | null
  group_tag: string | null
  technique: "straight_set" | "superset" | "dropset" | "giant_set" | "circuit" | "rest_pause" | "amrap" | "cluster_set" | "complex" | "emom" | "wave_loading"
  intensity_pct?: number | null
}

export interface ProgramDay {
  day_of_week: number
  label: string
  focus: string
  slots: ExerciseSlot[]
}

export interface ProgramWeek {
  week_number: number
  phase: string
  intensity_modifier: string
  days: ProgramDay[]
}

export interface ProgramSkeleton {
  weeks: ProgramWeek[]
  split_type: SplitType
  periodization: Periodization
  total_sessions: number
  notes: string
}

// ─── Agent 3: Exercise Selector Output ───────────────────────────────────────

export interface AssignedExercise {
  slot_id: string
  exercise_id: string
  exercise_name: string
  notes: string | null
}

export interface ExerciseAssignment {
  assignments: AssignedExercise[]
  substitution_notes: string[]
}

// ─── Agent 4: Validation Agent Output ────────────────────────────────────────

export interface ValidationIssue {
  type: "error" | "warning"
  category: string
  message: string
  slot_ref?: string
}

export interface ValidationResult {
  pass: boolean
  issues: ValidationIssue[]
  summary: string
}

// ─── Cross-Agent Types ───────────────────────────────────────────────────────

export interface AgentCallResult<T> {
  content: T
  tokens_used: number
}

export interface OrchestrationResult {
  program_id: string
  validation: ValidationResult
  token_usage: {
    agent1: number
    agent2: number
    agent3: number
    agent4: number
    total: number
  }
  duration_ms: number
  retries: number
}

// ─── Database-adjacent types ────────────────────────────────────────────────

export type ProgramCategory =
  | "strength"
  | "conditioning"
  | "sport_specific"
  | "recovery"
  | "nutrition"
  | "hybrid"

export type ProgramDifficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "elite"

export type AiFeature =
  | "program_generation"
  | "program_chat"
  | "admin_chat"
  | "ai_coach"

// ─── Compressed exercise for AI context ──────────────────────────────────────

export interface CompressedExercise {
  id: string
  name: string
  category: string[]
  difficulty: string
  difficulty_score: number | null
  muscle_group: string | null
  movement_pattern: MovementPattern | null
  primary_muscles: string[]
  secondary_muscles: string[]
  force_type: ForceType
  laterality: Laterality
  equipment_required: string[]
  is_bodyweight: boolean
  training_intent: ("build" | "shape" | "express")[]
  sport_tags: string[]
  plane_of_motion: string[]
  joints_loaded: { joint: string; load: string }[]
}

// ─── AI Job types (Firestore) ────────────────────────────────────────────────

export type AiJobType = "program_generation" | "program_chat" | "admin_chat" | "ai_coach" | "week_generation"
export type AiJobStatus = "pending" | "processing" | "streaming" | "completed" | "failed" | "cancelled"

export interface AiJob {
  id: string
  type: AiJobType
  status: AiJobStatus
  input: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  userId: string
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
}

export interface AiJobChunk {
  index: number
  type: "delta" | "analysis" | "tool_start" | "tool_result" | "program_created" | "message_id" | "done" | "error"
  data: Record<string, unknown>
  createdAt: FirebaseFirestore.Timestamp
}

// ─── Technique plan & difficulty ceiling (added 2026-04-14) ──

export interface TechniquePlanWeek {
  week_number: number
  allowed_techniques: string[]
  default_technique: string
  notes: string
}

export interface DifficultyCeilingWeek {
  week_number: number
  max_tier: "beginner" | "intermediate" | "advanced"
  max_score: number
}
