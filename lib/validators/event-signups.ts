import { z } from "zod"

export const createEventSignupSchema = z.object({
  parent_name: z.string().min(2).max(100),
  parent_email: z.string().email(),
  parent_phone: z.string().min(5).max(30).optional().nullable(),
  athlete_name: z.string().min(2).max(100),
  athlete_age: z.number().int().min(6).max(21),
  sport: z.string().min(1).max(60).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

export type CreateSignupInput = z.infer<typeof createEventSignupSchema>
