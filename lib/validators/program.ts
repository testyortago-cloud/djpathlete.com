import { z } from "zod"

export const PROGRAM_CATEGORIES = [
  "strength",
  "conditioning",
  "sport_specific",
  "recovery",
  "nutrition",
  "hybrid",
] as const

export const PROGRAM_DIFFICULTIES = ["beginner", "intermediate", "advanced", "elite"] as const

export const PROGRAM_TIERS = ["generalize", "premium"] as const

export const SPLIT_TYPES = [
  "full_body",
  "upper_lower",
  "push_pull_legs",
  "push_pull",
  "body_part",
  "movement_pattern",
  "custom",
] as const

export const PERIODIZATION_TYPES = ["linear", "undulating", "block", "reverse_linear", "none"] as const

export const PAYMENT_TYPES = ["free", "one_time", "subscription"] as const

export const BILLING_INTERVALS = ["week", "month"] as const

export const programFormSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100, "Name must be under 100 characters"),
    description: z
      .string()
      .max(2000, "Description must be under 2000 characters")
      .nullable()
      .transform((v) => v || null),
    category: z.array(z.enum(PROGRAM_CATEGORIES)).min(1, "Select at least one category"),
    difficulty: z.enum(PROGRAM_DIFFICULTIES, {
      message: "Difficulty is required",
    }),
    tier: z.enum(PROGRAM_TIERS, {
      message: "Tier is required",
    }),
    duration_weeks: z.coerce.number().int("Must be a whole number").positive("Must be at least 1 week"),
    sessions_per_week: z.coerce.number().int("Must be a whole number").positive("Must be at least 1 session"),
    payment_type: z.enum(PAYMENT_TYPES).default("one_time"),
    billing_interval: z
      .enum(BILLING_INTERVALS)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    price_cents: z.coerce
      .number()
      .int("Must be a whole number")
      .positive("Must be greater than 0")
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    split_type: z
      .enum(SPLIT_TYPES)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    periodization: z
      .enum(PERIODIZATION_TYPES)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    is_public: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.payment_type === "subscription" && !data.billing_interval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Billing interval is required for subscription programs",
        path: ["billing_interval"],
      })
    }
    if (data.payment_type !== "free" && !data.price_cents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Price is required for paid programs",
        path: ["price_cents"],
      })
    }
    if (data.payment_type === "free" && data.price_cents) {
      data.price_cents = null
    }
  })

export type ProgramFormData = z.infer<typeof programFormSchema>
