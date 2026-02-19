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

export interface User {
  id: string
  email: string
  password_hash: string
  first_name: string
  last_name: string
  role: UserRole
  avatar_url: string | null
  phone: string | null
  status: UserStatus
  created_at: string
  updated_at: string
}

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
    }
  }
}
