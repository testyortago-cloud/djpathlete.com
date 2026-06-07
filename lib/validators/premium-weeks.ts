import { z } from "zod"

export const premiumWeeksSchema = z.object({
  weeks: z
    .array(
      z.object({
        week_number: z.coerce.number().int().positive(),
        price_cents: z.coerce.number().int().positive(),
      }),
    )
    .max(52),
})

export type PremiumWeeksData = z.infer<typeof premiumWeeksSchema>
