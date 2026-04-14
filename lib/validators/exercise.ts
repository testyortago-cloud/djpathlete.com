import { z } from "zod"

export const EXERCISE_CATEGORIES = [
  "strength",
  "speed",
  "power",
  "plyometric",
  "flexibility",
  "mobility",
  "motor_control",
  "strength_endurance",
  "relative_strength",
] as const

export const TRAINING_INTENTS = ["build", "shape", "express"] as const

export const EXERCISE_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const

export const MOVEMENT_PATTERNS = [
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

export const FORCE_TYPES = ["push", "pull", "static", "dynamic"] as const

export const LATERALITY_OPTIONS = ["bilateral", "unilateral", "alternating"] as const

export const MUSCLE_OPTIONS = [
  "chest",
  "upper_back",
  "lats",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "core",
  "obliques",
  "lower_back",
  "glutes",
  "quadriceps",
  "hamstrings",
  "calves",
  "hip_flexors",
  "adductors",
  "abductors",
  "traps",
  "neck",
] as const

export const EQUIPMENT_OPTIONS = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable_machine",
  "smith_machine",
  "resistance_band",
  "pull_up_bar",
  "bench",
  "squat_rack",
  "leg_press",
  "leg_curl_machine",
  "lat_pulldown_machine",
  "rowing_machine",
  "treadmill",
  "bike",
  "box",
  "plyo_box",
  "medicine_ball",
  "stability_ball",
  "foam_roller",
  "trx",
  "landmine",
  "sled",
  "battle_ropes",
  "agility_ladder",
  "cones",
  "yoga_mat",
  "gliders",
  "wall",
  "weight_plate",
  "short_barbell",
] as const

export const PLANES_OF_MOTION = ["sagittal", "frontal", "transverse"] as const

export const JOINT_NAMES = [
  "ankle",
  "knee",
  "hip",
  "lumbar_spine",
  "thoracic_spine",
  "shoulder",
  "elbow",
  "wrist",
] as const

export const JOINT_LOAD_LEVELS = ["low", "moderate", "high"] as const

export const SPORT_TAG_OPTIONS = [
  "tennis",
  "golf",
  "baseball",
  "softball",
  "soccer",
  "basketball",
  "football",
  "lacrosse",
  "hockey",
  "swimming",
  "track_field",
  "volleyball",
  "rugby",
  "cricket",
  "pickleball",
  "running",
  "cycling",
  "martial_arts",
  "wrestling",
  "rowing",
  "general_athletics",
] as const

export const exerciseFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100, "Name must be under 100 characters"),
  description: z
    .string()
    .max(2000, "Description must be under 2000 characters")
    .nullable()
    .transform((v) => v || null),
  category: z.array(z.enum(EXERCISE_CATEGORIES)).min(1, "Select at least one category"),
  muscle_group: z
    .string()
    .max(100, "Muscle group must be under 100 characters")
    .nullable()
    .transform((v) => v || null),
  difficulty: z.enum(EXERCISE_DIFFICULTIES, {
    message: "Difficulty is required",
  }),
  equipment: z
    .string()
    .max(200, "Equipment must be under 200 characters")
    .nullable()
    .transform((v) => v || null),
  video_url: z
    .string()
    .url("Please enter a valid URL")
    .or(z.literal(""))
    .nullable()
    .transform((v) => v || null),
  instructions: z
    .string()
    .max(5000, "Instructions must be under 5000 characters")
    .nullable()
    .transform((v) => v || null),
  // AI metadata fields (all optional)
  movement_pattern: z
    .enum(MOVEMENT_PATTERNS)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  primary_muscles: z.array(z.string()).optional().default([]),
  secondary_muscles: z.array(z.string()).optional().default([]),
  force_type: z
    .enum(FORCE_TYPES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  laterality: z
    .enum(LATERALITY_OPTIONS)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  equipment_required: z.array(z.string()).optional().default([]),
  is_bodyweight: z.boolean().optional().default(false),
  training_intent: z.array(z.enum(TRAINING_INTENTS)).min(1, "Select at least one training intent").default(["build"]),
  sport_tags: z.array(z.string()).optional().default([]),
  plane_of_motion: z.array(z.enum(PLANES_OF_MOTION)).optional().default([]),
  joints_loaded: z
    .array(
      z.object({
        joint: z.enum(JOINT_NAMES),
        load: z.enum(JOINT_LOAD_LEVELS),
      }),
    )
    .optional()
    .default([]),
  aliases: z.array(z.string().max(100)).optional().default([]),
  difficulty_max: z
    .enum(EXERCISE_DIFFICULTIES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  difficulty_score: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  prerequisite_exercises: z.array(z.string().uuid()).optional().default([]),
  progression_order: z.coerce
    .number()
    .int()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
})

export type ExerciseFormData = z.infer<typeof exerciseFormSchema>
