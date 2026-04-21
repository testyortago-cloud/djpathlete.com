export type UserRole = "admin" | "client"
export type UserStatus = "active" | "inactive" | "suspended"
export type ExerciseCategory =
  | "strength"
  | "speed"
  | "power"
  | "plyometric"
  | "flexibility"
  | "mobility"
  | "motor_control"
  | "strength_endurance"
  | "relative_strength"
export type TrainingIntent = "build" | "shape" | "express"
export type ExerciseDifficulty = "beginner" | "intermediate" | "advanced"
export type ProgramCategory = "strength" | "conditioning" | "sport_specific" | "recovery" | "nutrition" | "hybrid"
export type ProgramDifficulty = "beginner" | "intermediate" | "advanced" | "elite"
export type ProgramTier = "generalize" | "premium"
export type PaymentType = "free" | "one_time" | "subscription"
export type BillingInterval = "week" | "month"
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "trialing" | "paused"
export type AssignmentStatus = "active" | "paused" | "completed" | "cancelled"
export type AssignmentPaymentStatus = "not_required" | "pending" | "paid" | "subscription_active"
export type WeekAccessType = "included" | "paid"
export type WeekPaymentStatus = "not_required" | "pending" | "paid"
export type BookingStatus = "scheduled" | "completed" | "cancelled" | "no_show"
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded"
export type NotificationType = "info" | "success" | "warning" | "error"
export type BlogPostStatus = "draft" | "published"
export type NewsletterStatus = "draft" | "sent"
export type BlogCategory = "Performance" | "Recovery" | "Coaching" | "Youth Development"
export type Gender = "male" | "female" | "other" | "prefer_not_to_say"
export type ExperienceLevel = "beginner" | "intermediate" | "advanced" | "elite"
export type SleepHours = "5_or_less" | "6" | "7" | "8_plus"
export type StressLevel = "low" | "moderate" | "high" | "very_high"
export type OccupationActivityLevel = "sedentary" | "light" | "moderate" | "heavy"
export type MovementConfidence = "learning" | "comfortable" | "proficient" | "expert"

// AI program generation types
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
export type ForceType = "push" | "pull" | "static" | "dynamic"
export type Laterality = "bilateral" | "unilateral" | "alternating"
export type SplitType =
  | "full_body"
  | "upper_lower"
  | "push_pull_legs"
  | "push_pull"
  | "body_part"
  | "movement_pattern"
  | "custom"
export type Periodization = "linear" | "undulating" | "block" | "reverse_linear" | "none"
export type PlaneOfMotion = "sagittal" | "frontal" | "transverse"
export type JointName = "ankle" | "knee" | "hip" | "lumbar_spine" | "thoracic_spine" | "shoulder" | "elbow" | "wrist"
export type JointLoadLevel = "low" | "moderate" | "high"
export type ExerciseRelationshipType = "progression" | "regression" | "alternative" | "variation"
export type AiGenerationStatus = "pending" | "generating" | "completed" | "failed" | "step_1" | "step_2" | "step_3"
export type AiFeature = "program_generation" | "program_chat" | "admin_chat" | "ai_coach"
export type AiMessageRole = "system" | "user" | "assistant" | "tool"
export type WeightUnit = "kg" | "lbs"
export type AchievementType = "pr" | "streak" | "milestone" | "completion"
export type PrType = "weight" | "reps" | "volume" | "estimated_1rm"
export type TargetMetric = "weight" | "reps" | "time"

// Assessment engine types
export type AssessmentSection = "movement_screen" | "background" | "context" | "preferences"
export type AssessmentQuestionType = "yes_no" | "single_select" | "multi_select" | "number" | "text"
export type AssessmentType = "initial" | "reassessment"
export type AbilityLevel = "beginner" | "intermediate" | "advanced" | "elite"

// Legal compliance types
export type LegalDocumentType = "terms_of_service" | "privacy_policy" | "liability_waiver"
export type ConsentType = "terms_of_service" | "privacy_policy" | "liability_waiver" | "parental_consent"

export interface SetDetail {
  set_number: number
  weight_kg: number | null
  reps: number
  rpe: number | null
}

export interface JointLoading {
  joint: JointName
  load: JointLoadLevel
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
  stripe_customer_id: string | null
  terms_accepted_at: string | null
  privacy_accepted_at: string | null
  created_at: string
  updated_at: string
}

export type TimeEfficiencyPreference = "supersets_circuits" | "shorter_rest" | "fewer_heavier" | "extend_session"
export type TrainingTechnique =
  | "straight_set"
  | "superset"
  | "dropset"
  | "giant_set"
  | "circuit"
  | "rest_pause"
  | "amrap"
  | "cluster_set"
  | "complex"
  | "emom"
  | "wave_loading"

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
  weight_unit: WeightUnit
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
  is_minor: boolean
  guardian_name: string | null
  guardian_email: string | null
  parental_consent_at: string | null
  created_at: string
  updated_at: string
}

export interface LegalDocument {
  id: string
  document_type: LegalDocumentType
  version: number
  title: string
  content: string
  effective_date: string
  is_active: boolean
  created_at: string
}

export interface UserConsent {
  id: string
  user_id: string
  consent_type: ConsentType
  legal_document_id: string | null
  program_id: string | null
  ip_address: string | null
  user_agent: string | null
  guardian_name: string | null
  guardian_email: string | null
  consented_at: string
  revoked_at: string | null
}

export interface Exercise {
  id: string
  name: string
  description: string | null
  category: ExerciseCategory[]
  muscle_group: string | null
  difficulty: ExerciseDifficulty
  difficulty_max: ExerciseDifficulty | null
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
  training_intent: TrainingIntent[]
  sport_tags: string[]
  plane_of_motion: PlaneOfMotion[]
  joints_loaded: JointLoading[]
  aliases: string[]
  difficulty_score: number | null
  prerequisite_exercises: string[]
  progression_order: number | null
  embedding?: number[] | null
  created_at: string
  updated_at: string
}

export interface Program {
  id: string
  name: string
  description: string | null
  category: ProgramCategory[]
  difficulty: ProgramDifficulty
  tier: ProgramTier
  duration_weeks: number
  sessions_per_week: number
  price_cents: number | null
  payment_type: PaymentType
  billing_interval: BillingInterval | null
  stripe_product_id: string | null
  stripe_price_id: string | null
  is_active: boolean
  created_by: string | null
  split_type: SplitType | null
  periodization: Periodization | null
  is_public: boolean
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
  suggested_weight_kg: number | null
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
  current_week: number
  total_weeks: number | null
  payment_status: AssignmentPaymentStatus
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface ProgramWeekAccess {
  id: string
  assignment_id: string
  week_number: number
  access_type: WeekAccessType
  price_cents: number | null
  payment_status: WeekPaymentStatus
  stripe_session_id: string | null
  stripe_payment_id: string | null
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
  ai_next_weight_kg: number | null
  created_at: string
}

export interface Booking {
  id: string
  contact_name: string
  contact_email: string
  contact_phone: string | null
  booking_date: string
  duration_minutes: number
  status: BookingStatus
  source: string
  notes: string | null
  ghl_contact_id: string | null
  ghl_appointment_id: string | null
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  user_id: string | null
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

export interface Subscription {
  id: string
  user_id: string | null
  program_id: string | null
  assignment_id: string | null
  stripe_subscription_id: string
  stripe_customer_id: string
  status: SubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
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

export type PromptTemplateCategory =
  | "structure"
  | "session"
  | "periodization"
  | "sport"
  | "rehab"
  | "conditioning"
  | "specialty"
  | "voice_profile"
  | "social_caption"
  | "blog_generation"
  | "blog_research"
  | "newsletter"

export type PromptTemplateScope =
  | "week"
  | "day"
  | "both"
  | "global"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "youtube_shorts"
  | "linkedin"
  | "blog"
  | "newsletter"

export interface PromptFewShotExample {
  caption: string
  platform: SocialPlatform
  engagement: number
  impressions: number
  recorded_at: string
  social_post_id: string
}

export interface PromptTemplate {
  id: string
  name: string
  category: PromptTemplateCategory
  scope: PromptTemplateScope
  description: string
  prompt: string
  /**
   * Top-performing real examples, populated weekly by performanceLearningLoop.
   * Optional on insert (DB default is `[]`). Always present on read.
   */
  few_shot_examples?: PromptFewShotExample[]
  created_by: string | null
  created_at: string
  updated_at: string
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
  current_step: number
  total_steps: number
  generation_trigger?: string | null
  assessment_result_id?: string | null
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

// Assessment Engine types
export type AssessmentQuestionSection = "movement_screen" | "background" | "context" | "preferences"

export interface AssessmentQuestion {
  id: string
  section: AssessmentQuestionSection
  movement_pattern: string | null
  question_text: string
  question_type: AssessmentQuestionType
  options: { value: string; label: string }[] | null
  parent_question_id: string | null
  parent_answer: string | null
  level_impact: Record<string, number> | null
  order_index: number
  is_active: boolean
  created_at: string
}

export interface ComputedLevels {
  overall: AbilityLevel
  [movementPattern: string]: AbilityLevel
}

export interface AssessmentFeedback {
  overall_feeling: "too_easy" | "just_right" | "too_hard"
  exercises_too_easy: string[]
  exercises_too_hard: string[]
  new_injuries: string
  rpe_average?: number
}

export interface AssessmentResult {
  id: string
  user_id: string
  assessment_type: AssessmentType
  answers: Record<string, string>
  computed_levels: ComputedLevels
  max_difficulty_score: number
  triggered_program_id: string | null
  previous_assessment_id: string | null
  feedback: Record<string, unknown> | null
  completed_at: string
  created_at: string
}

export interface AiConversationHistory {
  id: string
  user_id: string
  feature: AiFeature
  session_id: string
  role: AiMessageRole
  content: string
  metadata: Record<string, unknown>
  embedding?: number[] | null
  tokens_input: number | null
  tokens_output: number | null
  model_used: string | null
  created_at: string
}

export interface AiResponseFeedback {
  id: string
  conversation_message_id: string
  user_id: string
  accuracy_rating: number | null
  relevance_rating: number | null
  helpfulness_rating: number | null
  notes: string | null
  thumbs_up: boolean | null
  feature: AiFeature
  created_at: string
  updated_at: string
}

export type AiRecommendationType =
  | "weight_suggestion"
  | "program_parameters"
  | "exercise_selection"
  | "deload_recommendation"
  | "plateau_detection"

export interface AiOutcomeTracking {
  id: string
  conversation_message_id: string | null
  generation_log_id: string | null
  user_id: string
  exercise_id: string | null
  program_id: string | null
  recommendation_type: AiRecommendationType
  predicted_value: Record<string, unknown>
  actual_value: Record<string, unknown> | null
  accuracy_score: number | null
  outcome_positive: boolean | null
  measured_at: string | null
  created_at: string
}

export type ProgramIssueCategory =
  | "push_pull_imbalance"
  | "missing_movement_pattern"
  | "wrong_difficulty"
  | "bad_exercise_choice"
  | "too_many_exercises"
  | "periodization_issue"
  | "equipment_mismatch"
  | "other"

export interface ProgramFeedbackIssue {
  category: ProgramIssueCategory
  description: string
  severity: "low" | "medium" | "high"
}

export interface AiProgramFeedback {
  id: string
  program_id: string
  generation_log_id: string | null
  reviewer_id: string
  overall_rating: number
  balance_quality: number | null
  exercise_selection_quality: number | null
  periodization_quality: number | null
  difficulty_appropriateness: number | null
  split_type: string | null
  difficulty: string | null
  specific_issues: ProgramFeedbackIssue[]
  corrections_made: Record<string, unknown>
  notes: string | null
  embedding: number[] | null
  created_at: string
  updated_at: string
}

export interface NotificationPreferences {
  id: string
  user_id: string
  notify_new_client: boolean
  notify_payment_received: boolean
  notify_program_completed: boolean
  email_notifications: boolean
  workout_reminders: boolean
  created_at: string
  updated_at: string
}

// Form review types
export type FormReviewStatus = "pending" | "in_progress" | "reviewed"

export interface FormReview {
  id: string
  client_user_id: string
  video_path: string
  thumbnail_url: string | null
  title: string
  notes: string | null
  status: FormReviewStatus
  created_at: string
  updated_at: string
}

export interface FormReviewMessage {
  id: string
  form_review_id: string
  user_id: string
  message: string
  created_at: string
}

// Performance assessment types
export type PerformanceAssessmentStatus = "draft" | "in_progress" | "completed"

export interface PerformanceAssessment {
  id: string
  client_user_id: string
  created_by: string
  title: string
  notes: string | null
  status: PerformanceAssessmentStatus
  created_at: string
  updated_at: string
}

export interface PerformanceAssessmentExercise {
  id: string
  assessment_id: string
  exercise_id: string | null
  custom_name: string | null
  youtube_url: string | null
  video_path: string | null
  admin_notes: string | null
  result_value: number | null
  result_unit: string | null
  order_index: number
  created_at: string
  updated_at: string
}

export interface PerformanceAssessmentMessage {
  id: string
  assessment_exercise_id: string
  user_id: string
  message: string
  created_at: string
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  category: BlogCategory
  cover_image_url: string | null
  status: BlogPostStatus
  tags: string[]
  meta_description: string | null
  author_id: string
  published_at: string | null
  created_at: string
  updated_at: string
  source_video_id: string | null
  seo_metadata: Record<string, unknown>
  tavily_research: Record<string, unknown> | null
  fact_check_status: FactCheckStatus | null
  fact_check_details: Record<string, unknown> | null
}

export interface SeoMetadataInternalLink {
  blog_post_id: string
  title: string
  slug: string
  overlap_score: number
  reason: string
}

export interface SeoMetadata {
  meta_title?: string
  meta_description?: string
  keywords?: string[]
  json_ld?: Record<string, unknown>
  internal_link_suggestions?: SeoMetadataInternalLink[]
  generated_at?: string
}

export interface Newsletter {
  id: string
  subject: string
  preview_text: string
  content: string
  status: NewsletterStatus
  sent_at: string | null
  sent_count: number
  failed_count: number
  source_blog_post_id: string | null
  author_id: string
  created_at: string
  updated_at: string
}

// ---------- Events & event signups ----------

export type EventType = "clinic" | "camp"
export type EventStatus = "draft" | "published" | "cancelled" | "completed"
export type SignupType = "interest" | "paid"
export type SignupStatus = "pending" | "confirmed" | "cancelled" | "refunded"

export interface Event {
  id: string
  type: EventType
  slug: string
  title: string
  summary: string
  description: string
  focus_areas: string[]
  start_date: string
  end_date: string | null
  session_schedule: string | null
  location_name: string
  location_address: string | null
  location_map_url: string | null
  age_min: number | null
  age_max: number | null
  capacity: number
  signup_count: number
  price_cents: number | null
  stripe_product_id: string | null
  stripe_price_id: string | null
  status: EventStatus
  hero_image_url: string | null
  created_at: string
  updated_at: string
}

export interface EventSignup {
  id: string
  event_id: string
  signup_type: SignupType
  parent_name: string
  parent_email: string
  parent_phone: string | null
  athlete_name: string
  athlete_age: number
  sport: string | null
  notes: string | null
  status: SignupStatus
  stripe_session_id: string | null
  stripe_payment_intent_id: string | null
  amount_paid_cents: number | null
  user_id: string | null
  created_at: string
  updated_at: string
}

// ---------- Shop (Printful POD) ----------

export type ProductType = "pod" | "digital" | "affiliate"

export type ShopOrderStatus =
  | "pending"
  | "paid"
  | "draft"
  | "confirmed"
  | "in_production"
  | "shipped"
  | "canceled"
  | "refunded"
  | "fulfilled_digital"

export interface ShopProduct {
  id: string
  printful_sync_id: number | null
  slug: string
  name: string
  description: string
  thumbnail_url: string
  thumbnail_url_override: string | null
  is_active: boolean
  is_featured: boolean
  sort_order: number
  last_synced_at: string | null
  created_at: string
  updated_at: string
  product_type: ProductType
  affiliate_url: string | null
  affiliate_asin: string | null
  affiliate_price_cents: number | null
  digital_access_days: number | null
  digital_signed_url_ttl_seconds: number
  digital_max_downloads: number | null
  digital_is_free: boolean
}

export interface ShopProductFile {
  id: string
  product_id: string
  file_name: string
  display_name: string
  storage_path: string
  file_size_bytes: number
  mime_type: string
  sort_order: number
  created_at: string
}

export interface ShopOrderDownload {
  id: string
  order_id: string
  product_id: string
  file_id: string
  access_expires_at: string | null
  download_count: number
  max_downloads: number | null
  last_downloaded_at: string | null
  created_at: string
}

export interface ShopLead {
  id: string
  product_id: string
  email: string
  resend_contact_id: string | null
  resend_sync_status: string
  resend_sync_error: string | null
  ip_address: string | null
  created_at: string
}

export interface ShopProductVariant {
  id: string
  product_id: string
  printful_sync_variant_id: number
  printful_variant_id: number
  sku: string
  name: string
  size: string | null
  color: string | null
  retail_price_cents: number
  printful_cost_cents: number
  mockup_url: string
  mockup_urls: string[]
  mockup_url_override: string | null
  is_available: boolean
  created_at: string
  updated_at: string
}

export interface ShopOrderItem {
  variant_id: string
  product_id: string
  product_type: "pod" | "digital"
  name: string
  variant_name: string
  thumbnail_url: string
  quantity: number
  unit_price_cents: number
  printful_variant_id: number | null
  /** Cost-of-goods snapshot at order time, for historical margin analytics. */
  printful_cost_cents?: number
}

export interface ShopOrderShippingAddress {
  name: string
  email: string
  phone: string | null
  line1: string
  line2: string | null
  city: string
  state: string
  country: string
  postal_code: string
}

export interface ShopOrder {
  id: string
  order_number: string
  user_id: string | null
  customer_email: string
  customer_name: string
  shipping_address: ShopOrderShippingAddress
  stripe_session_id: string | null
  stripe_payment_intent_id: string | null
  printful_order_id: number | null
  status: ShopOrderStatus
  items: ShopOrderItem[]
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  tracking_number: string | null
  tracking_url: string | null
  carrier: string | null
  refund_amount_cents: number | null
  notes: string | null
  created_at: string
  updated_at: string
  shipped_at: string | null
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
      subscriptions: {
        Row: Subscription
        Insert: Omit<Subscription, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Subscription, "id" | "created_at">>
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
      prompt_templates: {
        Row: PromptTemplate
        Insert: Omit<PromptTemplate, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<PromptTemplate, "id" | "created_at" | "updated_at">>
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
      assessment_questions: {
        Row: AssessmentQuestion
        Insert: Omit<AssessmentQuestion, "id" | "created_at">
        Update: Partial<Omit<AssessmentQuestion, "id" | "created_at">>
      }
      assessment_results: {
        Row: AssessmentResult
        Insert: Omit<AssessmentResult, "id" | "created_at">
        Update: Partial<Omit<AssessmentResult, "id" | "created_at">>
      }
      ai_conversation_history: {
        Row: AiConversationHistory
        Insert: Omit<AiConversationHistory, "id" | "created_at">
        Update: Partial<Omit<AiConversationHistory, "id" | "created_at">>
      }
      ai_response_feedback: {
        Row: AiResponseFeedback
        Insert: Omit<AiResponseFeedback, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<AiResponseFeedback, "id" | "created_at">>
      }
      ai_outcome_tracking: {
        Row: AiOutcomeTracking
        Insert: Omit<AiOutcomeTracking, "id" | "created_at">
        Update: Partial<Omit<AiOutcomeTracking, "id" | "created_at">>
      }
      form_reviews: {
        Row: FormReview
        Insert: Omit<FormReview, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<FormReview, "id" | "created_at">>
      }
      form_review_messages: {
        Row: FormReviewMessage
        Insert: Omit<FormReviewMessage, "id" | "created_at">
        Update: Partial<Omit<FormReviewMessage, "id" | "created_at">>
      }
      performance_assessments: {
        Row: PerformanceAssessment
        Insert: Omit<PerformanceAssessment, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<PerformanceAssessment, "id" | "created_at">>
      }
      performance_assessment_exercises: {
        Row: PerformanceAssessmentExercise
        Insert: Omit<PerformanceAssessmentExercise, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<PerformanceAssessmentExercise, "id" | "created_at">>
      }
      performance_assessment_messages: {
        Row: PerformanceAssessmentMessage
        Insert: Omit<PerformanceAssessmentMessage, "id" | "created_at">
        Update: Partial<Omit<PerformanceAssessmentMessage, "id" | "created_at">>
      }
      newsletters: {
        Row: Newsletter
        Insert: Omit<Newsletter, "id" | "created_at" | "updated_at" | "sent_at" | "sent_count" | "failed_count">
        Update: Partial<Omit<Newsletter, "id" | "created_at">>
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Starter AI Automation types (Phase 1 — migrations 00076–00081)
// ─────────────────────────────────────────────────────────────────

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "youtube" | "youtube_shorts" | "linkedin"

export type SocialApprovalStatus =
  | "draft"
  | "edited"
  | "approved"
  | "scheduled"
  | "published"
  | "rejected"
  | "awaiting_connection"
  | "failed"

export type PlatformConnectionStatus = "not_connected" | "connected" | "paused" | "error"

export type CalendarEntryType = "social_post" | "blog_post" | "newsletter" | "topic_suggestion"
export type CalendarStatus = "planned" | "in_progress" | "published" | "cancelled"

export type VideoUploadStatus = "uploaded" | "transcribing" | "transcribed" | "analyzed" | "failed"

export type FactCheckStatus = "pending" | "passed" | "flagged" | "failed"

export interface SocialPost {
  id: string
  platform: SocialPlatform
  content: string
  media_url: string | null
  approval_status: SocialApprovalStatus
  scheduled_at: string | null
  published_at: string | null
  source_video_id: string | null
  rejection_notes: string | null
  platform_post_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SocialCaption {
  id: string
  social_post_id: string
  caption_text: string
  hashtags: string[]
  version: number
  created_at: string
}

export interface ContentCalendarEntry {
  id: string
  entry_type: CalendarEntryType
  reference_id: string | null
  title: string
  scheduled_for: string
  scheduled_time: string | null
  status: CalendarStatus
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────
// Phase 6 — Admin Operations (migration 00092)
// ─────────────────────────────────────────────────────────────────

export interface SystemSetting {
  key: string
  value: unknown
  description: string | null
  updated_by: string | null
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────
// Starter AI Automation — Phase 5e (migration 00090)
// ─────────────────────────────────────────────────────────────────

export type VoiceDriftEntityType = "social_post" | "blog_post" | "newsletter"
export type VoiceDriftSeverity = "low" | "medium" | "high"

export interface VoiceDriftIssue {
  issue: string
  suggestion: string
}

export interface VoiceDriftFlag {
  id: string
  entity_type: VoiceDriftEntityType
  entity_id: string
  drift_score: number
  severity: VoiceDriftSeverity
  issues: VoiceDriftIssue[]
  content_preview: string
  scanned_at: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────
// Starter AI Automation — Phase 5a (migration 00089)
// ─────────────────────────────────────────────────────────────────

export interface SocialAnalytics {
  id: string
  social_post_id: string
  platform: SocialPlatform
  platform_post_id: string
  impressions: number | null
  engagement: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  views: number | null
  extra: Record<string, unknown> | null
  recorded_at: string
  created_at: string
}

export interface PlatformConnection {
  id: string
  plugin_name: SocialPlatform
  status: PlatformConnectionStatus
  credentials: Record<string, unknown>
  account_handle: string | null
  last_sync_at: string | null
  last_error: string | null
  connected_at: string | null
  connected_by: string | null
  created_at: string
  updated_at: string
}

export interface VideoUpload {
  id: string
  storage_path: string
  original_filename: string
  duration_seconds: number | null
  size_bytes: number | null
  mime_type: string | null
  title: string | null
  uploaded_by: string | null
  status: VideoUploadStatus
  /**
   * Firebase Storage path of a small JPG thumbnail; null until generated.
   * Optional on insert — the DB column is nullable with no default, so
   * callers (and test fixtures) may omit it entirely.
   */
  thumbnail_path?: string | null
  created_at: string
  updated_at: string
}

export type VideoTranscriptSource = "speech" | "vision"

export interface VideoTranscript {
  id: string
  video_upload_id: string
  transcript_text: string
  language: string
  assemblyai_job_id: string | null
  analysis: Record<string, unknown> | null
  source: VideoTranscriptSource
  created_at: string
}

export type CalendarDefaultView = "month" | "week" | "day"

export interface UserPreferences {
  user_id: string
  calendar_default_view: CalendarDefaultView
  last_pipeline_filters: Record<string, unknown>
  pipeline_lanes_collapsed: Record<string, boolean>
  updated_at: string
}
