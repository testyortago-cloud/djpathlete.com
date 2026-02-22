import type { MovementPattern, SplitType, Periodization } from "@/types/database"

// ─── Agent 1: Profile Analyzer Output ────────────────────────────────────────

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
  notes: string
}

// ─── Agent 2: Program Architect Output ───────────────────────────────────────

export interface ExerciseSlot {
  slot_id: string
  role: "warm_up" | "primary_compound" | "secondary_compound" | "accessory" | "isolation" | "cool_down"
  movement_pattern: MovementPattern
  target_muscles: string[]
  sets: number
  reps: string
  rest_seconds: number
  rpe_target: number | null
  tempo: string | null
  group_tag: string | null
  technique: "straight_set" | "superset" | "dropset" | "giant_set" | "circuit" | "rest_pause" | "amrap"
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
