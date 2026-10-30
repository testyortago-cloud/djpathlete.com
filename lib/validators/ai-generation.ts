import { z } from "zod"
import { SPLIT_TYPES, PERIODIZATION_TYPES, PROGRAM_TIERS } from "./program"

/** At most this many staples: the coach asked for "four up to six" exercises to track. */
export const MAX_STAPLES = 8

export const aiGenerationRequestSchema = z
  .object({
    client_id: z.string().uuid("Invalid client ID").nullish(),
    goals: z.array(z.string().min(1)).min(1, "At least one goal is required"),
    duration_weeks: z.coerce.number().int().min(1).max(52),
    sessions_per_week: z.coerce.number().int().min(1).max(7),
    session_minutes: z.coerce.number().int().min(15).max(180).optional(),
    split_type: z.enum(SPLIT_TYPES).optional(),
    periodization: z.enum(PERIODIZATION_TYPES).optional(),
    tier: z.enum(PROGRAM_TIERS).optional(),
    additional_instructions: z.string().max(2000).optional(),
    equipment_override: z.array(z.string()).optional(),
    pool_exercise_ids: z.array(z.string().uuid()).max(200).optional(),
    pool_mode: z.enum(["preferred", "strict"]).optional(),
    /** Pool exercises that come back on a schedule: week 1, then every `every_weeks` weeks. */
    staple_exercises: z
      .array(z.object({ exercise_id: z.string().uuid(), every_weeks: z.number().int().min(1).max(4) }))
      .max(MAX_STAPLES)
      .optional(),
    ignore_profile: z.boolean().optional(),
    is_public: z.boolean().optional(),
    price_cents: z.coerce.number().int().min(0).optional(),
    /** Optional recipient — when set, the Firebase function emails this address
     *  on completion (and on failure) so the coach doesn't have to babysit the
     *  dialog. Null/undefined disables the email. */
    notify_email: z.string().email().optional().nullable(),
  })
  // A staple is chosen from the pool, so it is always in the library the AI is given.
  .refine((d) => (d.staple_exercises ?? []).every((s) => d.pool_exercise_ids?.includes(s.exercise_id)), {
    message: "Every staple exercise must be in the exercise pool",
    path: ["staple_exercises"],
  })

export type AiGenerationRequest = z.infer<typeof aiGenerationRequestSchema>
