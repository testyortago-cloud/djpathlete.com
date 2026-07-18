export type UserRole = "admin" | "client" | "editor"
export type UserStatus = "active" | "inactive" | "suspended" | "lead"
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
export type LoadType = "total" | "per_dumbbell" | "per_side"
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
  password_hash: string | null
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
  marketing_consent_at: string | null
  marketing_consent_source: string | null
}

export type TeamInviteRole = "editor"

export interface TeamInvite {
  id: string
  email: string
  role: TeamInviteRole
  token: string
  invited_by: string | null
  expires_at: string
  used_at: string | null
  created_at: string
}

export type TeamInviteStatus = "pending" | "accepted" | "expired"

// ====== Team video review (Plan 2) ======

export type TeamVideoSubmissionStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "locked"

export type TeamVideoVersionStatus = "pending" | "uploaded" | "failed"

export type TeamVideoSubmissionKind = "video" | "image_set"

export type TeamVideoCommentStatus = "open" | "resolved"

export interface TeamVideoSubmission {
  id: string
  title: string
  description: string | null
  submitted_by: string
  status: TeamVideoSubmissionStatus
  kind: TeamVideoSubmissionKind
  current_version_id: string | null
  approved_at: string | null
  approved_by: string | null
  locked_at: string | null
  created_at: string
  updated_at: string
}

export interface TeamVideoVersion {
  id: string
  submission_id: string
  version_number: number
  storage_path: string | null
  original_filename: string | null
  duration_seconds: number | null
  size_bytes: number | null
  mime_type: string | null
  image_count: number | null
  status: TeamVideoVersionStatus
  uploaded_at: string | null
  created_at: string
}

export interface TeamSubmissionImage {
  id: string
  version_id: string
  position: number
  storage_path: string
  original_filename: string
  mime_type: "image/jpeg" | "image/png" | "image/webp"
  size_bytes: number
  width: number | null
  height: number | null
  created_at: string
}

export interface TeamVideoComment {
  id: string
  version_id: string
  author_id: string
  /** Null on top-level comments; references another comment.id on replies. */
  parent_id: string | null
  timecode_seconds: number | null
  comment_text: string
  status: TeamVideoCommentStatus
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Author info denormalized via JOIN at read time. Surfaces who wrote each
 * comment + their role (admin / editor) so the UI can show a name + badge.
 */
export interface CommentAuthor {
  id: string
  name: string
  role: UserRole
}

export type DrawingTool = "pen" | "arrow" | "rectangle" | "pin"

export interface DrawingPath {
  tool: DrawingTool
  color: string                       // hex like "#FF3B30"
  width: number                       // stroke width px (2-8)
  points: Array<[number, number]>     // normalized 0-1 coords
}

export interface DrawingJson {
  paths: DrawingPath[]
}

/**
 * image_index annotation — pins a comment to a specific image in an
 * image_set submission. Lives in the same `drawing_json` jsonb column as
 * DrawingJson; the `kind` discriminator separates them at read time.
 */
export interface ImageIndexAnnotation {
  kind: "image_index"
  index: number
}

/**
 * Persisted annotation payload. Either a drawing (video pins/sketches) or
 * an image_index reference (carousel slot pin). Readers narrow via the
 * presence of the `kind` field on ImageIndexAnnotation.
 */
export type StoredAnnotation = DrawingJson | ImageIndexAnnotation

export interface TeamVideoAnnotation {
  id: string
  comment_id: string
  drawing_json: StoredAnnotation
  created_at: string
}

/** API response shape: a comment plus its (optional) annotation drawing,
 *  its author's denormalized name + role, and the version_number it belongs
 *  to (so the thread can show "v1" / "v2" badges across cuts). */
export interface TeamVideoCommentWithAnnotation extends TeamVideoComment {
  annotation: StoredAnnotation | null
  author: CommentAuthor | null
  version_number: number | null
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
  load_type: LoadType
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
  requires_video: boolean
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

export interface ProgramWeekPricing {
  id: string
  program_id: string
  week_number: number
  price_cents: number
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
  session_id: string | null
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
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
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
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

// ── AI Bookkeeper (Phase 1) ───────────────────────────────────────────────
export type BookKind = "business" | "household"
export type LedgerDirection = "income" | "expense"
export type LedgerAccountType = "income" | "expense"
export type LedgerSource = "manual" | "platform_import" | "statement_import" | "receipt"

export interface BookkeepingBook {
  id: string
  name: string
  book_kind: BookKind
  owner_label: string | null
  is_primary: boolean
  currency: string
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface BookkeepingAccount {
  id: string
  book_id: string
  name: string
  account_type: LedgerAccountType
  service_line: string | null
  is_deductible_candidate: boolean
  tax_category: string | null
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
  requires_business_purpose: boolean
}

export interface BookkeepingLedgerEntry {
  id: string
  book_id: string
  account_id: string | null
  direction: LedgerDirection
  amount_cents: number
  currency: string
  occurred_on: string
  memo: string | null
  business_purpose: string | null
  counterparty: string | null
  source: LedgerSource
  source_ref: string | null
  import_batch_id: string | null
  created_at: string
  updated_at: string
  document_id?: string | null
}

export interface BookkeepingDocument {
  id: string
  book_id: string
  kind: "statement" | "receipt"
  original_filename: string | null
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  sha256: string | null
  retain_until: string
  uploaded_by: string | null
  import_batch_id: string | null
  row_count: number | null
  posted_count: number | null
  period_start: string | null
  period_end: string | null
  created_at: string
  updated_at: string
}
export type NewDocument = Pick<
  BookkeepingDocument,
  "book_id" | "kind" | "original_filename" | "storage_path" | "mime_type" | "file_size_bytes" | "sha256" | "retain_until" | "uploaded_by" | "row_count"
>

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
  cache_creation_tokens: number | null
  cache_read_tokens: number | null
  duration_ms: number | null
  current_step: number
  total_steps: number
  generation_trigger?: string | null
  assessment_result_id?: string | null
  created_at: string
  completed_at: string | null
}

export type LeadPriority = "high" | "medium" | "low"

export interface LeadInquiry {
  id: string
  lead_user_id: string | null
  name: string
  email: string
  phone: string | null
  service: string
  sport: string | null
  experience: string | null
  goals: string
  injuries: string | null
  how_heard: string | null
  gclid: string | null
  ai_priority: LeadPriority | null
  ai_priority_reason: string | null
  ai_summary: string | null
  ai_draft_reply: string | null
  ai_generated_at: string | null
  ai_generation_log_id: string | null
  created_at: string
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
  // In-program context (nullable; set only for uploads made from a workout exercise — migration 00172).
  program_id?: string | null
  assignment_id?: string | null
  program_exercise_id?: string | null
  exercise_id?: string | null
  week_number?: number | null
  program_name?: string | null
  exercise_name?: string | null
}

export interface FormReviewMessage {
  id: string
  form_review_id: string
  user_id: string
  message: string | null
  created_at: string
  attachments?: FormReviewMessageAttachment[]
  users?: {
    first_name: string
    last_name: string
    avatar_url?: string | null
    role?: string
  } | null
}

export type FormReviewMessageAttachmentKind = "audio"

export interface FormReviewMessageAttachment {
  id: string
  message_id: string
  kind: FormReviewMessageAttachmentKind
  storage_path: string
  mime_type: string
  duration_seconds: number | null
  byte_size: number
  created_at: string
  /** Populated server-side by `getFormReviewMessages`; signed Firebase URL, ~1 h TTL. */
  playback_url?: string | null
}

// Exercise favorites types
export type ExerciseFavoriteSource = "client" | "admin"

export interface ExerciseFavorite {
  id: string
  client_user_id: string
  exercise_id: string
  created_by: string | null
  source: ExerciseFavoriteSource
  created_at: string
}

export interface ExerciseFavoriteWithExercise extends ExerciseFavorite {
  exercise: Pick<
    Exercise,
    "id" | "name" | "category" | "muscle_group" | "video_url" | "thumbnail_url" | "difficulty"
  > | null
}

// Performance assessment types
export type PerformanceAssessmentStatus = "draft" | "in_progress" | "completed"

export interface PerformanceAssessment {
  id: string
  client_user_id: string | null
  created_by: string
  title: string
  notes: string | null
  status: PerformanceAssessmentStatus
  is_template: boolean
  template_name: string | null
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

// Image quality metadata shared by inline images and cover_image_meta.
// All fields are optional because posts created before migration 00155 (cover_meta)
// and the Task-6 quality-judge rollout will not have these populated.
// Source of truth: functions/src/blog-image-generation.ts (InlineImageRecord, CoverImageMeta).
export interface CoverImageMeta {
  seed?: number
  model?: string
  prompt?: string
  prompt_version?: string
  quality_score?: number
  quality_reasons?: string[]
  judge_failed?: boolean
  attempts?: number
}

export interface InlineImage {
  url: string
  alt: string
  prompt: string
  section_h2: string
  width: number
  height: number
  // Quality/provenance metadata — optional because pre-Task-6 records won't have them.
  seed?: number
  model?: string
  prompt_version?: string
  quality_score?: number
  quality_reasons?: string[]
  judge_failed?: boolean
  attempts?: number
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  category: BlogCategory
  cover_image_url: string | null
  cover_image_meta?: CoverImageMeta | null
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
  inline_images: InlineImage[]
  primary_keyword: string | null
  secondary_keywords: string[]
  search_intent: "informational" | "commercial" | "transactional" | null
  faq: FaqEntry[]
  subcategory: string | null
  last_refreshed_at: string | null
  refresh_count: number
}

export interface FaqEntry {
  question: string
  answer: string
}

export interface Faq {
  id: string
  page_key: string
  category: string | null
  question: string
  answer: string
  link_text: string | null
  link_href: string | null
  sort_order: number
  status: "published" | "draft"
  created_at: string
  updated_at: string
}

export interface LeadMagnet {
  id: string
  slug: string
  title: string
  description: string
  asset_url: string
  category: BlogCategory | null
  tags: string[]
  active: boolean
  created_at: string
  updated_at: string
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
  audience: string[]
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
  waiver_accepted_at: string | null
  waiver_document_id: string | null
  waiver_ip_address: string | null
  waiver_user_agent: string | null
  created_at: string
  updated_at: string
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
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
      form_review_message_attachments: {
        Row: FormReviewMessageAttachment
        Insert: Omit<FormReviewMessageAttachment, "id" | "created_at">
        Update: Partial<Omit<FormReviewMessageAttachment, "id" | "created_at">>
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

/**
 * platform_connections.plugin_name supports social platforms plus ad/marketing
 * platforms (Google Ads, etc.) which don't fit the SocialPlatform semantics.
 */
export type PlatformPluginName = SocialPlatform | "google_ads" | "gmail"

export type PostType = "video" | "image" | "carousel" | "story" | "text"

export type MediaAssetKind = "video" | "image"

export interface MediaAsset {
  id: string
  kind: MediaAssetKind
  storage_path: string
  /**
   * Misnomer: this stores a Firebase Storage *path*, not a public URL (e.g.
   * `images/<uid>/<file>.png`), so it equals `storage_path` for assets we
   * upload. To render or publish it, generate a signed READ URL — pass it
   * through `resolveMediaUrl` (publish path) or sign `storage_path` directly
   * (drawer / asset thumbnails). Never use this value as an <img> src as-is.
   */
  public_url: string
  mime_type: string
  width: number | null
  height: number | null
  duration_ms: number | null
  bytes: number
  derived_from_video_id: string | null
  ai_alt_text: string | null
  ai_analysis: Record<string, unknown> | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SocialPostMediaRow {
  social_post_id: string
  media_asset_id: string
  position: number
  overlay_text: string | null
  overlay_metadata: Record<string, unknown> | null
}

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
  post_type: PostType
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
  plugin_name: PlatformPluginName
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
   * Edit gate. When true the video still needs editing — posts backed by it
   * cannot be approved/scheduled/published until a captioned cut is rendered
   * (auto-clears) or it is manually marked ready. NOT NULL, defaults true.
   */
  needs_edit: boolean
  /**
   * Firebase Storage path of a small JPG thumbnail; null until generated.
   * Optional on insert — the DB column is nullable with no default, so
   * callers (and test fixtures) may omit it entirely.
   */
  thumbnail_path?: string | null
  /**
   * Set when this row was promoted from a team_video_submissions row (the
   * "Send to Content Studio" / captioned-cut promote-or-reuse path); null for
   * direct admin uploads. Optional on insert — nullable column, no default.
   */
  source_submission_id?: string | null
  /**
   * Auto-generated opening hook title for the reel's first-frame card. Written
   * from the transcript by the broll_generation job and (later) editable. Null
   * until generated. Optional on insert — nullable column, no default.
   */
  hook_text?: string | null
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

export type BrollSegmentStatus = "pending" | "generating" | "ready" | "failed" | "dropped"

export interface BrollSegment {
  id: string
  video_upload_id: string
  generation_job_id: string
  segment_index: number
  start_ms: number
  end_ms: number
  concept: string
  prompt: string
  media_asset_id: string | null
  fal_request_id: string | null
  cache_key: string
  status: BrollSegmentStatus
  created_at: string
  updated_at: string
}

export const REEL_MODES = ["split_reel", "captioned_cut"] as const
export type ReelMode = (typeof REEL_MODES)[number]

/**
 * Per-(video, mode) editable "reel project" snapshot for the in-app reel editor.
 * `props` is the MEDIA-AGNOSTIC effective snapshot (shape = ReelProjectProps in
 * lib/validators/reel-projects.ts) — captions, accent, face trajectory, b-roll
 * window timing/enable, hook, music, trim. It holds NO signed URLs; each
 * consumer resolves media itself. `edited_fields` lists the prop keys the
 * operator explicitly locked — the render worker re-derives every other field
 * from live truth, so un-edited fields never go stale.
 */
export interface ReelProject {
  id: string
  video_upload_id: string
  mode: ReelMode
  props: Record<string, unknown>
  edited_fields: string[]
  created_at: string
  updated_at: string
}

export type CalendarDefaultView = "month" | "week" | "day"

export interface UserPreferences {
  user_id: string
  calendar_default_view: CalendarDefaultView
  last_pipeline_filters: Record<string, unknown>
  pipeline_lanes_collapsed: Record<string, boolean>
  updated_at: string
}

export interface MarketingAttribution {
  id: string
  session_id: string
  user_id: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  landing_url: string | null
  referrer: string | null
  first_seen_at: string
  last_seen_at: string
  claimed_at: string | null
  created_at: string
}

export interface MarketingConsentLog {
  id: string
  user_id: string
  granted: boolean
  source: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────
// Google Ads — Phase 1.1 (read-only mirror; OAuth slice)
// ─────────────────────────────────────────────────────────────────

export type GoogleAdsAutomationMode = "auto_pilot" | "co_pilot" | "advisory"
export type GoogleAdsResourceStatus = "ENABLED" | "PAUSED" | "REMOVED"
export type GoogleAdsCampaignType =
  | "SEARCH"
  | "VIDEO"
  | "PERFORMANCE_MAX"
  | "DISPLAY"
  | "SHOPPING"
  | "DEMAND_GEN"
  | "LOCAL_SERVICES"
  | "APP"
  | "HOTEL"
  | "SMART"
  | "UNKNOWN"
export type GoogleAdsKeywordMatchType = "EXACT" | "PHRASE" | "BROAD"

export interface GoogleAdsAccount {
  customer_id: string
  manager_customer_id: string | null
  descriptive_name: string | null
  currency_code: string | null
  time_zone: string | null
  is_active: boolean
  connected_at: string | null
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface GoogleAdsCampaign {
  id: string
  customer_id: string
  campaign_id: string
  name: string
  type: GoogleAdsCampaignType
  status: GoogleAdsResourceStatus
  bidding_strategy: string | null
  budget_micros: number | null
  start_date: string | null
  end_date: string | null
  automation_mode: GoogleAdsAutomationMode
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

export interface GoogleAdsAdGroup {
  id: string
  campaign_id: string
  ad_group_id: string
  name: string
  status: GoogleAdsResourceStatus
  type: string | null
  cpc_bid_micros: number | null
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

export interface GoogleAdsKeyword {
  id: string
  ad_group_id: string
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  status: GoogleAdsResourceStatus
  cpc_bid_micros: number | null
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
}

export interface GoogleAdsNegativeKeyword {
  id: string
  customer_id: string
  scope_type: "campaign" | "ad_group"
  scope_id: string
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
}

export interface GoogleAdsAd {
  id: string
  ad_group_id: string
  ad_id: string
  type: string
  status: GoogleAdsResourceStatus
  headlines: Array<{ text: string }>
  descriptions: Array<{ text: string }>
  final_urls: string[]
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
}

export interface GoogleAdsDailyMetric {
  id: string
  customer_id: string
  campaign_id: string
  ad_group_id: string | null
  keyword_criterion_id: string | null
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value: number
  ctr: number
  avg_cpc_micros: number
  raw_data: Record<string, unknown> | null
  last_synced_at: string
}

export interface GoogleAdsSearchTerm {
  id: string
  customer_id: string
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  matched_keyword_id: string | null
  last_synced_at: string
}

// ─────────────────────────────────────────────────────────────────
// Google Ads — Phase 1.2 (recommendations + audit log)
// ─────────────────────────────────────────────────────────────────

export type GoogleAdsRecommendationType =
  | "add_negative_keyword"
  | "adjust_bid"
  | "pause_keyword"
  | "add_keyword"
  | "add_ad_variant"
  | "pause_ad"
  // Phase 1.6+ — added by migration 00131 to support the full 11-tool ads-agent
  // catalog. Cross-campaign and account-scope actions all land in the same
  // queue with these recommendation_type values.
  | "budget_shift"
  | "audience_expansion"
  | "new_campaign"
  | "campaign_pause"
  | "campaign_split"
  | "match_type_change"
  | "bid_strategy_review"
  | "flag"

export type GoogleAdsRecommendationScope =
  | "campaign"
  | "ad_group"
  | "keyword"
  | "ad"
  // 'account' added by migration 00131 for actions that aren't bound to an
  // existing entity (new_campaign, flag_for_human).
  | "account"

export type GoogleAdsRecommendationStatus =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "auto_applied"
  | "failed"
  | "expired"

export interface GoogleAdsRecommendation {
  id: string
  customer_id: string
  scope_type: GoogleAdsRecommendationScope
  scope_id: string
  recommendation_type: GoogleAdsRecommendationType
  payload: Record<string, unknown>
  reasoning: string
  confidence: number
  status: GoogleAdsRecommendationStatus
  created_by_ai: boolean
  approved_by: string | null
  approved_at: string | null
  applied_at: string | null
  failure_reason: string | null
  expires_at: string
  // memo_id / source added by migration 00131 so the ads-agent can write back
  // a top-level back-reference + provenance tag (other callers may leave these
  // null, which is why both columns are nullable in the DB).
  memo_id: string | null
  source: string | null
  created_at: string
  updated_at: string
}

export type GoogleAdsAutomationLogResult = "success" | "failure" | "partial"

export interface GoogleAdsAutomationLog {
  id: string
  recommendation_id: string | null
  customer_id: string
  mode: string
  actor: string
  api_request: Record<string, unknown>
  api_response: Record<string, unknown> | null
  result_status: GoogleAdsAutomationLogResult
  error_message: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────
// Google Ads — Phase 1.5c + 1.5d (offline conversions + value adjustments)
// ─────────────────────────────────────────────────────────────────

export type GoogleAdsConversionTrigger = "booking_created" | "payment_succeeded"

export interface GoogleAdsConversionAction {
  id: string
  customer_id: string
  conversion_action_id: string
  name: string
  trigger_type: GoogleAdsConversionTrigger
  default_value_micros: number
  default_currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type GoogleAdsConversionUploadType = "click" | "adjustment"
export type GoogleAdsConversionAdjustmentType = "RESTATE" | "RETRACT"
export type GoogleAdsConversionSourceTable = "bookings" | "payments" | "event_signups"
export type GoogleAdsConversionUploadStatus = "pending" | "uploaded" | "failed" | "skipped"

export interface GoogleAdsConversionUpload {
  id: string
  customer_id: string
  conversion_action_id: string
  upload_type: GoogleAdsConversionUploadType
  source_table: GoogleAdsConversionSourceTable
  source_id: string
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  conversion_time: string
  value_micros: number
  currency: string
  adjustment_type: GoogleAdsConversionAdjustmentType | null
  related_upload_id: string | null
  status: GoogleAdsConversionUploadStatus
  attempts: number
  last_attempt_at: string | null
  uploaded_at: string | null
  api_request: Record<string, unknown> | null
  api_response: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────
// Google Ads — Phase 1.5b (Customer Match audience sync)
// ─────────────────────────────────────────────────────────────────

export type GoogleAdsAudienceType = "bookers" | "subscribers" | "icp"

export interface GoogleAdsUserList {
  id: string
  customer_id: string
  user_list_id: string
  name: string
  audience_type: GoogleAdsAudienceType
  is_active: boolean
  last_synced_at: string | null
  last_error: string | null
  member_count: number
  created_at: string
  updated_at: string
}

export interface GoogleAdsUserListMember {
  id: string
  user_list_id: string
  email_hash: string
  email_normalized: string
  added_at: string
}

// ─────────────────────────────────────────────────────────────────
// Google Ads — Phase 1.5g (AI Ads Agent — strategist memos)
// ─────────────────────────────────────────────────────────────────

export type GoogleAdsAgentMemoSource = "scheduled" | "manual"

export interface GoogleAdsAgentRecommendedAction {
  priority: "high" | "medium" | "low"
  title: string
  reasoning: string
  link: string | null
}

export interface GoogleAdsAgentMemoSections {
  executive_summary: string
  whats_working: string[]
  whats_not: string[]
  recommended_actions: GoogleAdsAgentRecommendedAction[]
  watch_list: string
}

export type GoogleAdsAgentMemoOutcomeStatus =
  | "pending"
  | "measured"
  | "rolled_back"
  | "preflight_failed"

export interface GoogleAdsAgentMemoAction {
  rank: number
  tool: string
  args: Record<string, unknown>
  rationale: string
  expected_metric: "CTR" | "CVR" | "CAC" | "ROAS" | "spend_efficiency" | "impression_share"
  expected_direction: "increase" | "decrease"
  confidence: "low" | "medium" | "high"
  audit_confidence: "low" | "medium" | "high"
  significance: "sig" | "underpowered" | "insufficient_data"
  supporting_signals: string[]
  status: "queued" | "applied" | "failed" | "rejected_by_guardrails"
  recommendation_id: string | null
  applied_at: string | null
  clamped: boolean
  /**
   * Why a `status: "failed"` action never became a recommendation. Guardrail
   * rejections carry their reason in guardrail_rejections; execution failures
   * had nowhere to put one, so they vanished from the queue with no trace
   * anywhere — the action just silently wasn't there.
   */
  failure_reason?: string | null
}

export interface GoogleAdsAgentMemoGuardrailRejection {
  rank: number
  tool: string
  reason: string
}

export interface GoogleAdsAgentMemo {
  id: string
  week_of: string
  subject: string
  sections: GoogleAdsAgentMemoSections
  source: GoogleAdsAgentMemoSource
  triggered_by: string | null
  tokens_used: number
  email_sent_at: string | null
  email_recipient: string | null
  signals_summary: Record<string, unknown> | null
  actions: GoogleAdsAgentMemoAction[]
  guardrail_rejections: GoogleAdsAgentMemoGuardrailRejection[]
  outcome_status: GoogleAdsAgentMemoOutcomeStatus
  outcome_metrics: Record<string, unknown> | null
  impact_score: number | null
  // Added 2026-05-15 by strategy-team plan A3 — nullable so prior rows stay valid
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
  agent_confidence: number | null
  dissents_from_brief: boolean
  dissent_reason: string | null
  // Added 2026-05-15 by learning-loop plan E2 — nullable for prior rows
  self_critique_notes: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────
// Agent Outcome Scoring — Phase C1 (added 2026-05-15)
// Per-(channel, tool) running aggregates used to normalize impact_score.
// ─────────────────────────────────────────────────────────────────

export interface AgentToolBaseline {
  channel: "seo" | "ads" | "social"
  tool_name: string
  p95_abs_delta: number
  n_measured: number
  success_rate: number
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────
// Google Ads — Phase 1.5e (GA4 / remarketing audience visibility)
// ─────────────────────────────────────────────────────────────────

export type GoogleAdsGa4ListType =
  | "REMARKETING"
  | "RULE_BASED"
  | "LOGICAL"
  | "SIMILAR"
  | "LOOKALIKE"
  | "EXTERNAL_REMARKETING"
  | "UNKNOWN"

export interface GoogleAdsGa4Audience {
  id: string
  customer_id: string
  user_list_id: string
  name: string
  description: string | null
  list_type: GoogleAdsGa4ListType
  membership_status: string | null
  size_for_search: number | null
  size_for_display: number | null
  membership_life_span_days: number | null
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────
// SEO Agent — Phase 1 (migrations create_gsc_properties + create_gsc_query_daily)
// ─────────────────────────────────────────────────────────────────

export interface GscProperty {
  id: string
  site_url: string
  refresh_token: string
  access_token: string | null
  access_token_expires: string | null  // ISO string
  connected_by_user_id: string
  created_at: string
  updated_at: string
}

export interface GscQueryDailyRow {
  date: string         // YYYY-MM-DD
  query: string
  page: string
  impressions: number
  clicks: number
  ctr: number          // 0–1
  position: number     // 1.0–~50.0
  ingested_at: string  // ISO string
}

// ─── SEO Agent — Phase 4 ───────────────────────────────────────────────────

export type SeoAgentToolName =
  | "queue_new_post"
  | "queue_refresh"
  | "queue_internal_link_sweep"
  | "flag_for_human"

export interface SeoAgentMemoAction {
  rank: 1 | 2
  tool: SeoAgentToolName
  args: Record<string, unknown>
  executed: boolean
  execution_target_id: string | null
  complementary_to_rank_1?: string
}

export interface SeoAgentMemoOutcomeMetric {
  action_index: 0 | 1
  executed: boolean
  target_id: string | null
  clicks_before?: number | null
  clicks_after?: number | null
  position_before?: number | null
  position_after?: number | null
  acknowledged?: boolean
  /** Set when resolution failed mid-way (e.g., target row deleted, Firestore unreachable). */
  error?: string
  /** Diagnostic note for unusual outcomes (e.g., topic_suggestion never picked up by auto-blog). */
  note?: string
}

export interface SeoAgentSignalsSummary {
  gsc_28d: {
    total_clicks: number
    total_impressions: number
    avg_position: number
    top_winnable: Array<{ query: string; avg_position: number; impressions_28d: number; clicks_28d: number }>
    top_decayed: Array<{ slug: string; position_drop: number; clicks_28d: number; avg_position_recent: number }>
  }
  inventory: {
    total_posts: number
    oldest_post_age_days: number
    never_refreshed_count: number
  }
  recent_tavily: Array<{ title: string; score: number; created_at: string }>
  orphan_post_ids: string[]
  last_8_memos_outcomes: Array<{
    run_date: string
    tool: SeoAgentToolName
    outcome_status: SeoAgentMemo["outcome_status"]
    outcome_summary?: string
  }>
  /** Convenience field; the agent stores this in the memo for auditing.
   *  Used by the handler's warm-up gate (skip when < 28). */
  gsc_distinct_dates: number
}

export interface SeoAgentMemo {
  id: string
  run_date: string         // YYYY-MM-DD
  ai_job_id: string
  signals_summary: SeoAgentSignalsSummary
  rationale: string
  actions: SeoAgentMemoAction[]
  outcome_status: "pending" | "measured" | "rolled_back"
  outcome_metrics: SeoAgentMemoOutcomeMetric[] | null
  impact_score: number | null
  created_at: string       // ISO string
  measured_at: string | null
  // Added 2026-05-15 by strategy-team plan A3 — nullable so prior rows stay valid
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
  agent_confidence: number | null
  dissents_from_brief: boolean
  dissent_reason: string | null
  // Added 2026-05-15 by learning-loop plan E2 — nullable for prior rows
  self_critique_notes: string | null
}

// ─────────────────────────────────────────────────────────────────
// Strategy Team (added 2026-05-15)
// cross_channel_signals + strategy_briefs + social_agent_memos
// ─────────────────────────────────────────────────────────────────

export interface CrossChannelSignal {
  id: string
  week_of: string
  winners: unknown[]
  losers: unknown[]
  anomalies: unknown[]
  attribution_summary: Record<string, unknown>
  recommendations_for_brief: unknown[]
  preflight_status: "ok" | "failed"
  preflight_reasons: string[]
  rationale: string
  created_at: string
}

export interface StrategyBrief {
  id: string
  week_of: string
  themes: { tag: string; weight: number }[]
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
  rationale: string
  signal_id: string | null
  approval_status: "draft" | "approved" | "rejected"
  approved_at: string | null
  approved_by: string | null
  created_at: string
}

export interface ChiefStrategistMemoConsideredTheme {
  tag: string
  weight: number
  accepted: boolean
  reason: string
}

export interface ChiefStrategistMemoConsideredChannel {
  channel: "seo" | "ads" | "social" | "balanced"
  score: number
  accepted: boolean
}

export interface ChiefStrategistMemo {
  id: string
  brief_id: string | null
  signal_id: string | null
  themes_considered: ChiefStrategistMemoConsideredTheme[]
  channels_considered: ChiefStrategistMemoConsideredChannel[]
  confidence: number | null
  dissents_from_critic: boolean
  dissent_reason: string | null
  self_critique_notes: string | null
  rationale: string
  brief_was_rejected: boolean
  rejection_reason: string | null
  created_at: string
}

export interface SocialAgentMemoAction {
  kind: string
  payload: unknown
  rationale: string
}

export interface SocialAgentMemo {
  id: string
  run_date: string
  ai_job_id: string | null
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
  signals_summary: Record<string, unknown>
  actions: SocialAgentMemoAction[]
  rationale: string
  outcome_status: "pending" | "measured" | "preflight_failed" | "no_op"
  outcome_metrics: Record<string, unknown> | null
  impact_score: number | null
  social_post_id: string | null
  platform: string | null
  agent_confidence: number | null
  dissents_from_brief: boolean
  dissent_reason: string | null
  created_at: string
  measured_at: string | null
}

// ============================================
// Athlete Performance Core (added 2026-05-13)
// ============================================

export interface DailyReadiness {
  id: string
  client_user_id: string
  date: string // YYYY-MM-DD
  sleep_hours: number | null
  sleep_quality: number // 1-5
  soreness_overall: number // 1-5
  soreness_by_region: Record<string, number> // body_region key -> 1-5
  fatigue: number // 1-5
  mood: number // 1-5
  stress: number // 1-5
  hydration: number // 1-5
  resting_hr: number | null
  hrv_ms: number | null
  notes: string | null
  readiness_score: number // 0-100, generated
  created_at: string
  updated_at: string
}

export type BodyRegion =
  | "head" | "neck" | "shoulder" | "elbow" | "wrist" | "hand"
  | "chest" | "upper_back" | "lower_back" | "hip" | "glute"
  | "hamstring" | "quad" | "knee" | "calf" | "ankle" | "foot" | "other"

export type InjurySide = "left" | "right" | "bilateral" | "n_a"
export type InjurySeverity = "minor" | "moderate" | "severe"
export type InjuryStatus = "active" | "recovering" | "resolved"

export interface RehabMilestone {
  name: string
  target_date: string | null
  completed_date: string | null
  notes: string | null
}

export interface Injury {
  id: string
  client_user_id: string
  body_region: BodyRegion
  side: InjurySide
  injury_type: string
  severity: InjurySeverity
  mechanism: string | null
  description: string | null
  date_occurred: string
  date_resolved: string | null
  days_lost: number
  status: InjuryStatus
  rehab_milestones: RehabMilestone[]
  created_at: string
  updated_at: string
}

export type TestType =
  | "drop_jump" | "cmj" | "squat_jump" | "broad_jump"
  | "sprint_10m" | "sprint_20m" | "sprint_40m" | "sprint_5_10_5" | "t_test" | "beep_test"
  | "sit_reach"
  | "bench_press_1rm" | "back_squat_1rm" | "deadlift_1rm"
  | "pull_up_max" | "push_up_max" | "plank_hold"
  | "custom"

export type BestMethod = "highest" | "lowest" | "mean" | "median"

export interface PerformanceTest {
  id: string
  client_user_id: string
  created_by: string
  test_type: TestType
  custom_name: string | null
  result_value: number
  result_unit: string
  trial_values: number[] | null
  best_method: BestMethod
  test_date: string
  body_weight_kg: number | null
  notes: string | null
  video_url: string | null
  is_pr: boolean
  pct_change_from_prev: number | null
  created_at: string
  updated_at: string
}

export interface PerformanceTestPR {
  client_user_id: string
  test_type: TestType
  custom_name: string | null
  result_value: number
  result_unit: string
  test_date: string
  test_id: string
  best_method: BestMethod
}

// ============================================
// Coach Intelligence (added 2026-05-13)
// ============================================

export type SessionType = "gym" | "sport" | "field" | "conditioning" | "mobility" | "other"

export interface TrainingSession {
  id: string
  client_user_id: string
  date: string // YYYY-MM-DD
  session_type: SessionType
  rpe: number // 1-10
  duration_min: number
  session_load: number // generated = rpe * duration_min
  notes: string | null
  program_assignment_id: string | null
  created_at: string
  updated_at: string
}

export type WorkoutSessionStatus = "in_progress" | "completed"

/** Program-flow workout session: one row per client per program day.
 *  Anchors PRS (start), session RPE (end), volume load, and completion. */
export interface WorkoutSession {
  id: string
  user_id: string
  assignment_id: string
  week_number: number
  day_of_week: number
  session_date: string // YYYY-MM-DD
  prs: number | null // perceived recovery 0-10, at start
  prs_recorded_at: string | null
  session_rpe: number | null // 1-10, at end
  volume_load_kg: number | null // Σ reps × entered weight × load-type multiplier
  duration_seconds: number | null
  status: WorkoutSessionStatus
  started_at: string
  completed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type RiskFlagType =
  | "load_spike"
  | "fatigue"
  | "overtraining"
  | "high_strain"
  | "rpe_creep"

export type RiskFlagSeverity = "low" | "medium" | "high"
export type RiskFlagStatus = "open" | "acknowledged" | "dismissed"

export interface RiskFlagEvidence {
  asOf?: string
  acwr?: number
  acuteLoad?: number
  chronicLoad?: number
  monotony?: number
  strain?: number
  weeklyLoad?: number
  prevWeeklyLoad?: number
  deltaPct?: number
  recentReadinessScores?: { date: string; readiness_score: number }[]
  recentRpes?: { date: string; rpe: number }[]
}

export interface RiskFlag {
  id: string
  client_user_id: string
  flag_type: RiskFlagType
  severity: RiskFlagSeverity
  message: string
  evidence: RiskFlagEvidence
  status: RiskFlagStatus
  triggered_at: string
  created_at: string
  acknowledged_at: string | null
  acknowledged_by: string | null
}

// ============================================
// Visualization & Engagement (added 2026-05-14)
// ============================================

export type GoalMetricKind = "test" | "readiness" | "weekly_load"
export type GoalDirection = "higher" | "lower"
export type GoalStatus = "active" | "achieved" | "missed" | "archived"

export interface AthleteGoal {
  id: string
  client_user_id: string
  metric_kind: GoalMetricKind
  test_type: string | null
  target_value: number
  target_unit: string
  direction: GoalDirection
  start_value: number | null
  deadline: string | null
  status: GoalStatus
  achieved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type BadgeTier = "bronze" | "silver" | "gold"

export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  tier: BadgeTier
}

// ────────────────────────────────────────────────────────────────────────────
// Revenue snapshots (Phase 2, broader-automations)
// ────────────────────────────────────────────────────────────────────────────

export interface RevenueSnapshotAtRisk {
  subscription_id: string
  customer_email: string
  mrr_cents: number
  renewal_at: string
  reason: "cancel_at_period_end" | "failed_payment"
}

export interface RevenueSnapshot {
  id: string
  week_of: string
  generated_at: string
  mrr_cents: number
  mrr_delta_cents: number
  new_customers: number
  churned_customers: number
  failed_payments_7d: number
  failed_payment_value_cents: number
  upcoming_renewals_14d: number
  upcoming_renewals_value_cents: number
  top_at_risk_subscriptions: RevenueSnapshotAtRisk[]
  raw: Record<string, unknown>
}

// ────────────────────────────────────────────────────────────────────────────
// Client engagement / risk (Phase 1, broader-automations)
// ────────────────────────────────────────────────────────────────────────────

export type RiskTier = "none" | "low" | "medium" | "high"

export interface ClientEngagementSnapshot {
  id: string
  client_id: string
  snapshot_date: string
  days_since_last_session: number
  session_frequency_pct_14d: number | null
  open_form_review_days: number | null
  open_performance_assessment_days: number | null
  program_ending_in_days: number | null
  last_renewal_conversation_at: string | null
  risk_score: number
  risk_tier: RiskTier
  reasons: string[]
  created_at: string
}

// ─── Session Packs (in-person credit tracking) ───────────────────────────────
export type PackPaymentMethod = "stripe" | "cash" | "comp"
export type PackPaymentStatus = "pending" | "paid" | "not_required" | "refunded"
export type ClientPackageStatus = "active" | "depleted" | "expired" | "refunded" | "cancelled"
export type CheckinMethod = "qr_self" | "coach_tap" | "manual"
export type PackReminderThreshold = "low" | "empty" | "expiring"

export interface SessionPackProduct {
  id: string
  name: string
  session_type: string
  credits: number
  price_cents: number
  validity_days: number | null
  stripe_price_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ClientPackage {
  id: string
  client_user_id: string
  product_id: string | null
  assignment_id: string | null
  session_type: string
  credits_total: number
  credits_used: number
  price_cents: number
  payment_method: PackPaymentMethod
  payment_status: PackPaymentStatus
  stripe_session_id: string | null
  stripe_payment_id: string | null
  purchased_at: string
  expires_at: string | null
  status: ClientPackageStatus
  last_reminded_threshold: PackReminderThreshold | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SessionCheckin {
  id: string
  client_package_id: string
  client_user_id: string
  checked_in_at: string
  session_date: string
  method: CheckinMethod
  credit_delta: number
  voided: boolean
  voided_reason: string | null
  voided_by: string | null
  voided_at: string | null
  calendar_event_id: string | null
  workout_session_id: string | null
  created_by: string | null
  notes: string | null
  created_at: string
}

// ─── Recurring in-person sessions (00175) ────────────────────────────────────

export type RecurringSessionStatus = "active" | "paused"
export type ScheduledSessionStatus = "scheduled" | "attended" | "no_show" | "cancelled"

export interface RecurringSession {
  id: string
  client_user_id: string
  day_of_week: number // 0=Sun..6=Sat
  start_time: string // "HH:MM:SS"
  duration_minutes: number
  location: string | null
  notes: string | null
  status: RecurringSessionStatus
  /** Hybrid link (00180): attendance on this slot advances this assignment. */
  assignment_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ScheduledSession {
  id: string
  client_user_id: string
  recurring_session_id: string | null
  session_date: string // "YYYY-MM-DD"
  start_time: string // "HH:MM:SS"
  duration_minutes: number
  status: ScheduledSessionStatus
  attended_at: string | null
  checkin_id: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  notes: string | null
  /** Which program day this attendance completed (00180), when a slot link advanced one. */
  workout_session_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Card-on-file (00176) ────────────────────────────────────────────────────

export interface UserPaymentMethod {
  id: string
  user_id: string
  stripe_payment_method_id: string
  brand: string | null
  last4: string | null
  exp_month: number | null
  exp_year: number | null
  is_default: boolean
  created_at: string
}

// ─── Session memberships (00177) ─────────────────────────────────────────────

export type MembershipBillingInterval = "week" | "month"
export type ClientMembershipStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "paused"

export interface MembershipPlan {
  id: string
  name: string
  price_cents: number
  billing_interval: MembershipBillingInterval
  sessions_per_period: number | null
  stripe_price_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ClientMembership {
  id: string
  user_id: string
  plan_id: string | null
  stripe_subscription_id: string
  stripe_customer_id: string | null
  status: ClientMembershipStatus
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  created_at: string
  updated_at: string
}

// ─── Session fee charges (00178) ─────────────────────────────────────────────

export type SessionFeeKind = "no_show" | "late_cancel"
export type SessionFeeStatus = "pending" | "succeeded" | "failed" | "waived"

export interface SessionFeeCharge {
  id: string
  scheduled_session_id: string
  user_id: string
  kind: SessionFeeKind
  amount_cents: number
  status: SessionFeeStatus
  stripe_payment_intent_id: string | null
  failure_reason: string | null
  created_at: string
}

// ─── Household billing payer (00179) ─────────────────────────────────────────

export interface ClientBillingPayer {
  client_user_id: string
  payer_user_id: string
  created_by: string | null
  created_at: string
  updated_at: string
}
