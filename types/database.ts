export type UserRole = "admin" | "client"
export type UserStatus = "active" | "inactive" | "suspended"
export type ExerciseCategory = "strength" | "cardio" | "flexibility" | "plyometric" | "sport_specific" | "recovery"
export type ExerciseDifficulty = "beginner" | "intermediate" | "advanced"
export type ProgramCategory = "strength" | "conditioning" | "sport_specific" | "recovery" | "nutrition" | "hybrid"
export type ProgramDifficulty = "beginner" | "intermediate" | "advanced" | "elite"
export type AssignmentStatus = "active" | "paused" | "completed" | "cancelled"
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded"
export type NotificationType = "info" | "success" | "warning" | "error"
export type Gender = "male" | "female" | "other" | "prefer_not_to_say"
export type ExperienceLevel = "beginner" | "intermediate" | "advanced" | "elite"
export type SleepHours = "5_or_less" | "6" | "7" | "8_plus"
export type StressLevel = "low" | "moderate" | "high" | "very_high"
export type OccupationActivityLevel = "sedentary" | "light" | "moderate" | "heavy"
export type MovementConfidence = "learning" | "comfortable" | "proficient" | "expert"

// AI program generation types
export type MovementPattern = "push" | "pull" | "squat" | "hinge" | "lunge" | "carry" | "rotation" | "isometric" | "locomotion"
export type ForceType = "push" | "pull" | "static" | "dynamic"
export type Laterality = "bilateral" | "unilateral" | "alternating"
export type SplitType = "full_body" | "upper_lower" | "push_pull_legs" | "push_pull" | "body_part" | "movement_pattern" | "custom"
export type Periodization = "linear" | "undulating" | "block" | "reverse_linear" | "none"
export type ExerciseRelationshipType = "progression" | "regression" | "alternative" | "variation"
export type AiGenerationStatus = "pending" | "generating" | "completed" | "failed"
export type AchievementType = "pr" | "streak" | "milestone" | "completion"
export type PrType = "weight" | "reps" | "volume" | "estimated_1rm"
export type TargetMetric = "weight" | "reps" | "time"

export interface SetDetail {
  set_number: number
  weight_kg: number | null
  reps: number
  rpe: number | null
}

export interface InjuryDetail {
  area: string
  side?: string
  severity?: string
  notes?: string
}

export interface User {
  id: string
  email: string
  password_hash: string
  first_name: string
  last_name: string
  role: UserRole
  avatar_url: string | null
  phone: string | null
  email_verified: boolean
  status: UserStatus
  created_at: string
  updated_at: string
}

export type TimeEfficiencyPreference = "supersets_circuits" | "shorter_rest" | "fewer_heavier" | "extend_session"
export type TrainingTechnique = "straight_set" | "superset" | "dropset" | "giant_set" | "circuit" | "rest_pause" | "amrap"

export interface ClientProfile {
  id: string
  user_id: string
  date_of_birth: string | null
  gender: Gender | null
  sport: string | null
  position: string | null
  experience_level: ExperienceLevel | null
  goals: string | null
  injuries: string | null
  height_cm: number | null
  weight_kg: number | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  available_equipment: string[]
  preferred_session_minutes: number | null
  preferred_training_days: number | null
  preferred_day_names: number[]
  time_efficiency_preference: TimeEfficiencyPreference | null
  preferred_techniques: string[]
  injury_details: InjuryDetail[]
  training_years: number | null
  sleep_hours: SleepHours | null
  stress_level: StressLevel | null
  occupation_activity_level: OccupationActivityLevel | null
  movement_confidence: MovementConfidence | null
  exercise_likes: string | null
  exercise_dislikes: string | null
  training_background: string | null
  additional_notes: string | null
  created_at: string
  updated_at: string
}

export interface Exercise {
  id: string
  name: string
  description: string | null
  category: ExerciseCategory
  muscle_group: string | null
  difficulty: ExerciseDifficulty
  equipment: string | null
  video_url: string | null
  thumbnail_url: string | null
  instructions: string | null
  created_by: string | null
  is_active: boolean
  movement_pattern: MovementPattern | null
  primary_muscles: string[]
  secondary_muscles: string[]
  force_type: ForceType | null
  laterality: Laterality | null
  equipment_required: string[]
  is_bodyweight: boolean
  is_compound: boolean
  created_at: string
  updated_at: string
}

export interface Program {
  id: string
  name: string
  description: string | null
  category: ProgramCategory
  difficulty: ProgramDifficulty
  duration_weeks: number
  sessions_per_week: number
  price_cents: number | null
  is_active: boolean
  created_by: string | null
  split_type: SplitType | null
  periodization: Periodization | null
  is_ai_generated: boolean
  ai_generation_params: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ProgramExercise {
  id: string
  program_id: string
  exercise_id: string
  day_of_week: number
  week_number: number
  order_index: number
  sets: number | null
  reps: string | null
  duration_seconds: number | null
  rest_seconds: number | null
  notes: string | null
  rpe_target: number | null
  intensity_pct: number | null
  tempo: string | null
  group_tag: string | null
  technique: TrainingTechnique
  created_at: string
}

export interface ProgramAssignment {
  id: string
  program_id: string
  user_id: string
  assigned_by: string | null
  start_date: string
  end_date: string | null
  status: AssignmentStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ExerciseProgress {
  id: string
  user_id: string
  exercise_id: string
  assignment_id: string | null
  completed_at: string
  sets_completed: number | null
  reps_completed: string | null
  weight_kg: number | null
  duration_seconds: number | null
  rpe: number | null
  notes: string | null
  is_pr: boolean
  pr_type: PrType | null
  set_details: SetDetail[] | null
  created_at: string
}

export interface Payment {
  id: string
  user_id: string
  stripe_payment_id: string | null
  stripe_customer_id: string | null
  amount_cents: number
  currency: string
  status: PaymentStatus
  description: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Review {
  id: string
  user_id: string
  rating: number
  comment: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}

export interface Testimonial {
  id: string
  user_id: string | null
  name: string
  role: string | null
  sport: string | null
  quote: string
  avatar_url: string | null
  rating: number | null
  is_featured: boolean
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: NotificationType
  is_read: boolean
  link: string | null
  created_at: string
}

export interface ExerciseRelationship {
  id: string
  exercise_id: string
  related_exercise_id: string
  relationship_type: ExerciseRelationshipType
  notes: string | null
  created_at: string
}

export interface AiGenerationLog {
  id: string
  program_id: string | null
  client_id: string | null
  requested_by: string
  status: AiGenerationStatus
  input_params: Record<string, unknown>
  output_summary: Record<string, unknown> | null
  error_message: string | null
  model_used: string | null
  tokens_used: number | null
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

export interface TrackedExercise {
  id: string
  assignment_id: string
  exercise_id: string
  target_metric: TargetMetric
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Achievement {
  id: string
  user_id: string
  achievement_type: AchievementType
  title: string
  description: string | null
  exercise_id: string | null
  metric_value: number | null
  icon: string
  celebrated: boolean
  earned_at: string
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: Omit<User, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<User, "id" | "created_at">>
      }
      client_profiles: {
        Row: ClientProfile
        Insert: Omit<ClientProfile, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<ClientProfile, "id" | "created_at">>
      }
      exercises: {
        Row: Exercise
        Insert: Omit<Exercise, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Exercise, "id" | "created_at">>
      }
      programs: {
        Row: Program
        Insert: Omit<Program, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Program, "id" | "created_at">>
      }
      program_exercises: {
        Row: ProgramExercise
        Insert: Omit<ProgramExercise, "id" | "created_at">
        Update: Partial<Omit<ProgramExercise, "id" | "created_at">>
      }
      program_assignments: {
        Row: ProgramAssignment
        Insert: Omit<ProgramAssignment, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<ProgramAssignment, "id" | "created_at">>
      }
      exercise_progress: {
        Row: ExerciseProgress
        Insert: Omit<ExerciseProgress, "id" | "created_at">
        Update: Partial<Omit<ExerciseProgress, "id" | "created_at">>
      }
      payments: {
        Row: Payment
        Insert: Omit<Payment, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Payment, "id" | "created_at">>
      }
      reviews: {
        Row: Review
        Insert: Omit<Review, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Review, "id" | "created_at">>
      }
      testimonials: {
        Row: Testimonial
        Insert: Omit<Testimonial, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Testimonial, "id" | "created_at">>
      }
      notifications: {
        Row: Notification
        Insert: Omit<Notification, "id" | "created_at">
        Update: Partial<Omit<Notification, "id" | "created_at">>
      }
      exercise_relationships: {
        Row: ExerciseRelationship
        Insert: Omit<ExerciseRelationship, "id" | "created_at">
        Update: Partial<Omit<ExerciseRelationship, "id" | "created_at">>
      }
      ai_generation_log: {
        Row: AiGenerationLog
        Insert: Omit<AiGenerationLog, "id" | "created_at">
        Update: Partial<Omit<AiGenerationLog, "id" | "created_at">>
      }
      tracked_exercises: {
        Row: TrackedExercise
        Insert: Omit<TrackedExercise, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<TrackedExercise, "id" | "created_at">>
      }
      achievements: {
        Row: Achievement
        Insert: Omit<Achievement, "id" | "created_at">
        Update: Partial<Omit<Achievement, "id" | "created_at">>
      }
    }
  }
}
